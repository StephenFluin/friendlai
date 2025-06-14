import { Express, Request, Response } from 'express';
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
    const query = req.body.query;
    const model = req.body.model;
    const user = getBearer(req);
    const result = newQuery(query, model, user, res);
    result
      .then((queryId) => {
        res.send({ id: queryId });
      })
      .catch((err) => {
        console.error('Error creating query:', err);
        res.status(500).send({ status: 'error', context: 'Error inserting query', msg: err });
      });
  });

  app.post('/api/multis', async (req, res) => {
    const query = req.body.query;
    const models = req.body.checkedModels;
    const user = getBearer(req);
    if (!query || !models || models.length < 2) {
      res.status(400).send({ status: 'error', message: 'Query and at least two models are required' });
      return;
    }
    const multiId = uuidv4();
    const queryIds: string[] = [];
    for (const model of models) {
      const newId = await newQuery(query, model, user, res);
      if (newId) {
        queryIds.push(newId);
      } else {
        console.log('Failed to create query for model:', model);
        res.status(500).send({ status: 'error', message: 'Failed to create query for model: ' + model });
        return;
      }
    }
    const inserts = queryIds.map((id) => [multiId, id, user, query]);
    console.log('Inserting a bunch of row:', inserts);
    runQuery('INSERT INTO multis (id, query, user, prompt) VALUES ?', [inserts])
      .then(() => {
        console.log('Inserted multi with ID:', multiId);
        res.send({ id: multiId });
      })
      .catch((err) => {
        console.error('Error inserting multi:', err);
        res.status(500).send({ status: 'error', message: 'Error inserting multi', error: err.message });
      });
  });

  app.get('/api/multis/:id', async (req, res) => {
    const multiId = req.params.id;
    const results = await runQuery<RowDataPacket[]>(
      'SELECT q.* FROM multis m LEFT JOIN queries q ON q.id = m.query WHERE m.id = ? ORDER BY q.model DESC',
      [multiId]
    );
    if (results.length > 0) {
      res.json(results);
    } else {
      res.status(404).send('Multi not found');
    }
  });

  app.get('/api/multis', async (req, res) => {
    const user = getBearer(req);
    const results = await runQuery<RowDataPacket[]>(
      'SELECT m.id, m.prompt FROM multis m WHERE user = ? GROUP BY m.id,m.prompt,m.date ORDER BY date DESC ',
      [user]
    );
    res.json(results);
  });

  app.get('/api/queries', async (req, res) => {
    const user = getBearer(req);

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
    const r = req;
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

  app.get('/api/worker/models', async (req, res) => {
    // This endpoint is for the worker to fetch the list of models
    const results = await runQuery<RowDataPacket[]>(`SELECT DISTINCT model
      FROM queries
      WHERE date >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`);
    res.json(results.map((row) => row['model']));
  });
  app.get('/api/worker/query', async (req, res) => {
    // Check and clean up any timed out queries
    const timeoutThreshold = 10 * 60 * 1000; // 10 minute
    const worker = getBearer(req);
    console.log(`Worker ${worker} fetching query`);
    // This endpoint is for the worker to fetch a query to process
    const results = await runQuery<RowDataPacket[]>('SELECT * FROM queries WHERE status = 0 ORDER BY date ASC LIMIT 1');
    if (results.length > 0) {
      res.json(results[0]);
      // Mark worker as in progress
      // await runQuery('UPDATE queries SET status = 1 WHERE id = ? LIMIT 1', [results[0]['id']]);
      await runQuery('INSERT INTO works (id, query, worker, status) VALUES (?, ?, ?, ?)', [
        uuidv4(),
        results[0]['id'],
        worker,
        0, // Pending
      ]);
    } else {
      res.send([]);
    }
  });

  app.put('/api/worker/query/:id', async (req, res) => {
    // This endpoint is for the worker to update the status of a query after processing
    const queryId = req.params.id;
    const [status, result, error_message, processing_time_ms] = [
      req.body.status || -1,
      req.body.result || null,
      req.body.error_message || null,
      req.body.processing_time_ms || null,
    ];
    const worker = getBearer(req);

    console.log(
      `Using ${status}, ${result}, ${error_message}, ${processing_time_ms} for query ${queryId} by worker ${worker}`
    );

    await runQuery(
      'UPDATE queries SET status = ?, result = ?, error_message = ?, processing_time_ms = ? WHERE id = ?',
      [status, result, error_message, processing_time_ms, queryId]
    );
    await runQuery(
      'INSERT INTO works (id, query, worker, status, processing_time_ms, error_message) VALUES (?, ?, ?, ?)',
      [uuidv4(), queryId, worker, status, processing_time_ms, error_message || null]
    );
    res.send({ status: 'success' });
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
  /*
  Create a query /prompt in the system
  */
  function newQuery(query: string, model: string, user: string, res: Response): Promise<string | null> {
    const queryId = uuidv4();
    return runQuery('INSERT INTO queries (id, query, model, user) VALUES (?, ?, ?, ?)', [queryId, query, model, user])
      .then(() => {
        // Respond with the generated ID
        console.log('Inserted query with ID:', queryId);
        return queryId;
      })
      .catch((err: any) => {
        console.error('Error inserting query:', err);
        return null;
      });
  }
  function getBearer(req: Request): string {
    return req.body?.user || req.headers.authorization?.replace('Bearer ', '') || 'anonymous';
  }
};
