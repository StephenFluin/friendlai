import { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import mysql, { RowDataPacket, OkPacket, ResultSetHeader, FieldPacket } from 'mysql2/promise';

export const registerAPI = (app: Express) => {
  // MySQL Connection Pool
  const dbConfig = {
    host: process.env['DB_HOST'] || undefined,
    user: process.env['DB_USER'] || 'friendlai' || 'root',
    password: process.env['DB_PASSWORD_FRIENDLAI'] || undefined,
    database: process.env['DB_NAME'] || 'friendlai',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  };

  if (!dbConfig.host || !dbConfig.password) {
    console.log('Database connection not configured properly.');
    process.exit(1);
  }
  const dbPool = mysql.createPool(dbConfig);
  console.log('Database connection details:', dbConfig);

  if (process.env['INSTANCE_UNIX_SOCKET']) {
    console.log('Connecting to DB host via socket ', process.env['INSTANCE_UNIX_SOCKET']);
  } else {
    console.log('Connecting to remote DB host ', process.env['DB_HOST']);
  }

  app.post('/api/queries', (req, res) => {
    const queryId = uuidv4();
    const query = req.body.query;
    const model = req.body.model;
    // get user from bearer token or from body
    const user = req.body.user || req.headers.authorization?.replace('Bearer ', '') || 'anonymous';
    runQuery('INSERT INTO queries (id, query, model, user) VALUES (?, ?, ?, ?)', [queryId, query, model, user])
      .then(() => {
        // Respond with the generated ID
        console.log('Inserted query with ID:', queryId);
        res.send({ id: queryId });
      })
      .catch((err: any) => {
        console.error('Error inserting query:', err);
        res.status(500).send({ status: 'error', context: 'Error inserting query', msg: err });
      });
  });
  app.get('/api/queries', async (req, res) => {
    const user = req.body?.user || req.headers.authorization?.replace('Bearer ', '') || 'anonymous';

    const result = await runQuery('SELECT * FROM queries WHERE user = ? ORDER BY updated DESC', [user]);
    res.json(result);
  });
  app.post('/api/queries/:id/retry', async (req, res) => {
    const queryId = req.params.id;
    const [results, fields] = await dbPool.execute<ResultSetHeader>('UPDATE queries SET status = 0 WHERE id = ?', [
      queryId,
    ]);
    if (results.affectedRows > 0) {
      res.send({ status: 'success', message: 'Query refreshed successfully' });
    } else {
      res.status(404).send({ status: 'error', message: 'Query not found' });
    }
  });

  app.get('/api/queries/:id', async (req, res) => {
    const queryId = req.params.id;
    const results = await runQuery<RowDataPacket[]>('SELECT * FROM queries WHERE id = ?', [queryId]);
    if (results.length > 0) {
      res.json(results[0]);
    } else {
      res.status(404).send('Query not found');
    }
  });

  app.post('/api/queries/:id/results', (req, res) => {
    const queryId = req.params.id;
    const result = req.body.result;
    // Update the results table with the provided `result` for the given `queryId`
    runQuery('UPDATE results SET result = ? WHERE id = ?', [result, queryId])
      .then(() => {
        console.log('Updated result for ID:', queryId);
        res.status(200).send('Result updated');
      })
      .catch((err) => {
        console.error('Error updating result:', err);
        res.status(500).send('Error updating result');
      });
  });

  app.get('/api/queries/:id/results', async (req, res) => {
    const queryId = req.params.id;
    const results = await runQuery<RowDataPacket[]>('SELECT result FROM results WHERE id = ?', [queryId]);
    if (results.length > 0) {
      res.json(results[0]);
    }
    res.json({ id: queryId });
  });

  /**
   * Executes a SQL query against the database pool.
   * @param sql The SQL query string. Can contain '?' placeholders for parameters.
   * @param params An optional array of parameters to be safely substituted into the query.
   * @returns A promise that resolves with the query results.
   *          For SELECT queries, this is typically an array of RowDataPacket objects.
   *          For INSERT/UPDATE/DELETE, this can be an OkPacket or ResultSetHeader.
   * @throws Re-throws any error encountered during query execution.
   */
  async function runQuery<T = RowDataPacket[] | ResultSetHeader>(sql: string, params?: any[]): Promise<T> {
    let connection;
    try {
      // The pool's query method handles connection acquisition and release
      const [results, fields] = await dbPool.query(sql, params);
      return results as T;
    } catch (error) {
      //console.error('SQL Error executing query:', sql, 'Params:', params, 'Error:', error);
      throw error; // Re-throw the error for the caller to handle
    }
  }
};
