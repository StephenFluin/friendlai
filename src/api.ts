import { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import mysql, { RowDataPacket, OkPacket, ResultSetHeader, FieldPacket } from 'mysql2/promise';

export const registerAPI = (app: Express) => {
  // MySQL Connection Pool
  const dbPool = mysql.createPool({
    host: process.env['DB_HOST'] || undefined,
    user: process.env['DB_USER'] || 'friendlai' || 'root',
    password: process.env['DB_PASSWORD_FRIENDLAI'] || 'password',
    database: process.env['DB_NAME'] || 'friendlai',
    socketPath: process.env['INSTANCE_UNIX_SOCKET'] || undefined, // e.g. '/cloudsql/project:region:instance'
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  if (process.env['INSTANCE_UNIX_SOCKET']) {
    console.log('Connecting to DB host via socket ', process.env['INSTANCE_UNIX_SOCKET']);
  } else {
    console.log('Connecting to remote DB host ', process.env['DB_HOST']);
  }

  app.post('/api/queries', (req, res) => {
    const queryId = uuidv4();
    const query = req.body.query;
    executeQuery('INSERT INTO queries (id, query) VALUES (?, ?)', [queryId, query])
      .then(() => {
        // Respond with the generated ID
        console.log('Inserted query with ID:', queryId);
        res.send({ id: queryId });
      })
      .catch((err) => {
        console.error('Error inserting query:', err);
        res.status(500).send({ status: 'error', context: 'Error inserting query', msg: err });
      });
  });
  app.get('/api/queries', async (req, res) => {
    const result = await executeQuery('SELECT id, query, date_created FROM queries');
    res.json({ queryList: result });
  });

  app.get('/api/queries/:id', async (req, res) => {
    const queryId = req.params.id;
    const results = await executeQuery<RowDataPacket[]>('SELECT query FROM results WHERE id = ?', [queryId]);
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
    executeQuery('UPDATE results SET result = ? WHERE id = ?', [result, queryId])
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
    const results = await executeQuery<RowDataPacket[]>('SELECT result FROM results WHERE id = ?', [queryId]);
    if (results.length > 0) {
      res.json(results[0]);
    }
    res.json({ id: queryId });
  });

  console.log('env is', process.env);

  /**
   * Executes a SQL query against the database pool.
   * @param sql The SQL query string. Can contain '?' placeholders for parameters.
   * @param params An optional array of parameters to be safely substituted into the query.
   * @returns A promise that resolves with the query results.
   *          For SELECT queries, this is typically an array of RowDataPacket objects.
   *          For INSERT/UPDATE/DELETE, this can be an OkPacket or ResultSetHeader.
   * @throws Re-throws any error encountered during query execution.
   */
  async function executeQuery<T = RowDataPacket[] | OkPacket | ResultSetHeader>(
    sql: string,
    params?: any[]
  ): Promise<T> {
    let connection;
    try {
      // The pool's query method handles connection acquisition and release
      const [results, fields] = await dbPool.query(sql, params);
      return results as T;
    } catch (error) {
      console.error('SQL Error executing query:', sql, 'Params:', params, 'Error:', error);
      throw error; // Re-throw the error for the caller to handle
    }
  }
};
