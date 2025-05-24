import * as child_process from 'child_process';
import * as os from 'os';
import * as util from 'util';
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Promisify exec for cleaner async/await usage
const exec = util.promisify(child_process.exec);

// --- Configuration ---
// Database credentials will now be primarily sourced from the .env file
const dbConfig = {
  host: process.env.DB_HOST || undefined,
  user: process.env.DB_USER || 'friendlai', // Default if not in .env
  password: process.env.DB_PASSWORD_FRIENDLAI || undefined, // Default if not in .env
  database: process.env.DB_NAME || 'friendlai', // Default if not in .env
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
};

if (!dbConfig.host || !dbConfig.password) {
  console.log('Database connection not configured properly.');
  process.exit(1);
}

const OLLAMA_INSTALL_URL = 'https://ollama.com/install.sh';
const POLLING_INTERVAL_SECONDS = process.env.POLLING_INTERVAL_SECONDS
  ? parseInt(process.env.POLLING_INTERVAL_SECONDS, 10)
  : 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks if Ollama is installed and accessible in the PATH.
 * @returns True if Ollama is installed, false otherwise.
 */
async function isOllamaInstalled(): Promise<boolean> {
  try {
    await exec('ollama --version');
    console.log('Ollama is already installed.');
    return true;
  } catch (error) {
    console.log('Ollama not found. Attempting installation...');
    return false;
  }
}

/**
 * Installs Ollama based on the operating system.
 */
async function installOllama(): Promise<void> {
  const platform = os.platform();
  try {
    if (platform === 'linux' || platform === 'darwin') {
      // Linux or macOS
      console.log(`Detected ${platform}. Installing Ollama using curl...`);
      try {
        await exec('curl --version');
      } catch (curlError) {
        console.error('curl is not installed. Please install curl and try again.');
        throw new Error('curl not found');
      }
      const { stdout, stderr } = await exec(`curl -fsSL ${OLLAMA_INSTALL_URL} | sh`);
      console.log('Ollama installation script stdout:', stdout);
      if (stderr) {
        console.error('Ollama installation script stderr:', stderr);
      }
      console.log('Ollama installation attempted. Please ensure it was successful and ollama is in your PATH.');
      console.log('You might need to restart your terminal or source your profile script (e.g., .bashrc, .zshrc).');
    } else if (platform === 'win32') {
      // Windows
      console.log('Detected Windows. Automatic installation of Ollama via script is not supported.');
      console.log('Please download and install Ollama manually from: https://ollama.com/download');
      console.log('After installation, ensure "ollama" is in your system PATH and restart this script.');
      throw new Error('Manual Ollama installation required for Windows.');
    } else {
      console.log(`Unsupported platform: ${platform}. Cannot automatically install Ollama.`);
      throw new Error(`Unsupported platform: ${platform}`);
    }
  } catch (error) {
    console.error('Error during Ollama installation:', error);
    throw error;
  }
}

/**
 * Ensures Ollama is installed, attempting installation if necessary.
 */
async function ensureOllamaIsReady(): Promise<void> {
  if (!(await isOllamaInstalled())) {
    await installOllama();
    if (os.platform() === 'win32') {
      console.log('Exiting script. Please install Ollama and run the script again.');
      process.exit(1);
    }
    console.log(
      'Please ensure Ollama is properly installed and the `ollama` command is available in a new terminal session before running again if issues persist.'
    );
    await sleep(5000);
    if (!(await isOllamaInstalled())) {
      console.error('Ollama still not found after attempted installation. Please check your installation and PATH.');
      throw new Error('Ollama installation verification failed.');
    }
  }
  try {
    await exec('ollama list');
    console.log('Ollama server appears to be running.');
  } catch (error) {
    console.warn('Ollama server might not be running or responding. `ollama run` might start it.');
    console.warn('If you encounter issues, ensure the Ollama application/service is running.');
  }
}

// --- Database Functions ---

let dbConnection: mysql.Connection | null = null;

/**
 * Establishes a connection to the MySQL database.
 */
async function connectToDB(): Promise<mysql.Connection> {
  if (dbConnection) {
    try {
      await dbConnection.ping();
      return dbConnection;
    } catch (pingError) {
      console.warn('Database connection lost, attempting to reconnect...');
      dbConnection.destroy(); // Properly close the broken connection
      dbConnection = null;
    }
  }
  try {
    console.log('Attempting to connect to database with config:', {
      host: dbConfig.host,
      user: dbConfig.user,
      // Avoid logging password directly
      password: dbConfig.password ? '******' : undefined,
      database: dbConfig.database,
      port: dbConfig.port,
    });
    const connection = await mysql.createConnection(dbConfig);
    console.log('Successfully connected to the MySQL database.');
    dbConnection = connection;
    return connection;
  } catch (error) {
    console.error('Error connecting to MySQL database:', error);
    throw error;
  }
}

/**
 * Fetches the oldest pending prompt from the database and sets its status to 'processing'.
 * @param db - The MySQL connection object.
 * @returns The prompt object or null if no pending prompts are found.
 */
async function getPendingPrompt(db: mysql.Connection): Promise<any | null> {
  await db.beginTransaction();
  const [rows]: [any[], any] = await db.execute(
    'SELECT id, query, model FROM queries WHERE status = 0 ORDER BY date ASC LIMIT 1 FOR UPDATE'
  );

  if (rows.length === 0) {
    await db.commit();
    return null;
  }
  const prompt = rows[0];
  await db.execute('UPDATE queries SET status = 1, updated = NOW() WHERE id = ?', [prompt.id]);
  await db.commit();
  console.log(`Processing prompt ID: ${prompt.id}`);
  return prompt;
}

/**
 * Runs the given prompt with the specified Ollama model.
 * @param promptText - The text of the prompt.
 * @param modelName - The name of the Ollama model to use.
 * @returns The result text from Ollama.
 */
import { Ollama, GenerateResponse, ProgressResponse } from 'ollama';

// Define timeouts based on the original script's values
const DEFAULT_RUN_TIMEOUT_MS = 30 * 1000; // 30 seconds for initial attempt
const PULL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for model pulling
const RETRY_RUN_TIMEOUT_MS = 1 * 60 * 1000; // 1 minute for retry attempt after pull

/**
 * Runs a prompt against the Ollama API, with logic to pull the model if not found.
 *
 * @param promptText The text of the prompt.
 * @param modelName The name of the model to use (e.g., "llama3:latest").
 * @returns A promise that resolves to a tuple: [responseText, processingTimeMs].
 */
export async function runOllamaPromptJs(promptText: string, modelName: string): Promise<[string, number]> {
  // Initialize the Ollama client. Assumes Ollama server is running on default host (http://localhost:11434).
  // You can configure the host if needed: new Ollama({ host: "http://custom_host:port" })
  const ollama = new Ollama();

  console.log(`Running prompt with model "${modelName}" using Ollama JS API...`);

  // Helper function to perform the generate call with timeout
  const performGenerate = async (
    currentModelName: string,
    currentPromptText: string,
    timeoutMs: number
  ): Promise<[string, number]> => {
    const abortController = new AbortController();
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutMessage = `Ollama JS API call for model "${currentModelName}" timed out after ${timeoutMs}ms.`;
        console.warn(timeoutMessage);
        abortController.abort(); // Signal the ollama call to abort
        // Note: AbortError will be thrown by ollama.generate, this timeoutPromise is a safeguard.
        // We don't reject here directly to let AbortError propagate if ollama respects the signal.
      }, timeoutMs);
    });

    try {
      const startTimeForFallback = Date.now(); // Fallback if total_duration is missing

      // The actual API call, raced with our timeout
      // `ollama.generate` should throw an AbortError if `abortController.abort()` is called.
      const response: GenerateResponse = await Promise.race([
        ollama.generate({
          model: currentModelName,
          prompt: currentPromptText,
          stream: false, // Get the full response at once
          signal: abortController.signal,
        }),
        timeoutPromise, // This promise will ensure timeout if generate doesn't respond to abort quickly
      ]);

      clearTimeout(timeoutId!); // Clear the timeout if generate completed/failed on its own

      const processing_time_ms = response.total_duration
        ? Math.round(response.total_duration / 1_000_000)
        : Date.now() - startTimeForFallback;

      if (response.total_duration === undefined) {
        console.warn(
          `total_duration missing in Ollama response for model "${currentModelName}". Using manual timing: ${processing_time_ms}ms.`
        );
      }

      console.log(`Successfully ran prompt with model "${currentModelName}". Time: ${processing_time_ms}ms.`);
      return [response.response.trim(), processing_time_ms];
    } catch (error: any) {
      clearTimeout(timeoutId!); // Ensure timeout is cleared on any error
      if (error.name === 'AbortError') {
        // This error comes from abortController.abort() being respected by ollama.generate or fetch
        const message = `Ollama prompt generation for model "${currentModelName}" timed out after ${timeoutMs}ms.`;
        console.error(message);
        throw new Error(message);
      }
      // Rethrow other errors to be handled by the main try-catch
      throw error;
    }
  };

  try {
    // Initial attempt
    return await performGenerate(modelName, promptText, DEFAULT_RUN_TIMEOUT_MS);
  } catch (error: any) {
    console.error(`Error running Ollama prompt for model "${modelName}": ${error.message}`);
    if (error.cause) {
      console.error('Error cause:', error.cause);
    }

    // Check for model not found error
    // Ollama API error for missing model typically includes "not found" and the model name.
    const isModelNotFoundError =
      error.message && error.message.toLowerCase().includes('not found') && error.message.includes(modelName);

    if (isModelNotFoundError) {
      console.log(`Model "${modelName}" not found or inaccessible. Attempting to pull model...`);

      const pullAbortController = new AbortController();
      let pullTimeoutId: NodeJS.Timeout;

      const pullTimeoutPromise = new Promise<never>((_, reject) => {
        pullTimeoutId = setTimeout(() => {
          const timeoutMessage = `Ollama pull for model "${modelName}" timed out after ${PULL_TIMEOUT_MS}ms.`;
          console.warn(timeoutMessage);
          pullAbortController.abort();
        }, PULL_TIMEOUT_MS);
      });

      try {
        const pullOperation = async () => {
          const pullStream = await ollama.pull({
            model: modelName,
            stream: true, // Iterate over progress
            signal: pullAbortController.signal,
          });

          let lastStatus = '';
          let pullFailedInStream = false;
          console.log(`Pulling "${modelName}" (this may take up to ${PULL_TIMEOUT_MS / 60000} minutes)...`);

          for await (const progress of pullStream) {
            lastStatus = progress.status;
            if (progress.error) {
              console.error(`Error detail during pull stream for "${modelName}": ${progress.error}`);
              pullFailedInStream = true;
              throw new Error(`Streamed pull for "${modelName}" reported an error: ${progress.error}`);
            }
            // You can log more detailed progress here if desired:
            // console.log(`Pulling ${modelName}: ${progress.status} ${progress.completed || ''}/${progress.total || ''}`);
          }

          if (!pullFailedInStream) {
            // A successful pull typically ends with a status like "success".
            // If the stream completes without `progress.error`, it's generally successful.
            console.log(`Pull stream for "${modelName}" completed. Last status: ${lastStatus}`);
          }
        };

        await Promise.race([pullOperation(), pullTimeoutPromise]);
        clearTimeout(pullTimeoutId!);

        console.log(`Successfully pulled model "${modelName}" (or it was already up-to-date). Retrying prompt...`);
        // Retry the prompt generation with the retry timeout
        return await performGenerate(modelName, promptText, RETRY_RUN_TIMEOUT_MS);
      } catch (pullError: any) {
        clearTimeout(pullTimeoutId!);
        const baseMessage = `Failed to pull model "${modelName}"`;
        if (pullError.name === 'AbortError') {
          console.error(`${baseMessage}: Pull operation timed out after ${PULL_TIMEOUT_MS}ms.`);
          throw new Error(`${baseMessage} (timeout).`);
        }
        console.error(`${baseMessage}: ${pullError.message}`);
        // Include original model-not-found error as cause if helpful, or just the pull error
        throw new Error(`${baseMessage}. Original error: ${error.message}. Pull error: ${pullError.message}`);
      }
    }

    // If the error was not a "model not found" error, or if retrying after pull also failed,
    // rethrow the current error.
    throw error;
  }
}

/**
 * Updates a prompt in the database with the result or an error message.
 * @param db - The MySQL connection object.
 * @param promptId - The ID of the prompt to update.
 * @param status - The new status ('completed' or 'error').
 * @param resultText - The result text from Ollama (optional).
 * @param errorMessage - An error message if processing failed (optional).
 */
async function updatePrompt(
  db: mysql.Connection,
  promptId: number,
  status: 3 | 4,
  {
    resultText,
    errorMessage,
    processing_time_ms,
  }: { resultText?: string; errorMessage?: string; processing_time_ms?: number }
): Promise<void> {
  try {
    await db.execute(
      'UPDATE queries SET status = ?, result = ?, error_message = ?, processing_time_ms = ?, updated = NOW() WHERE id = ?',
      [status || 4, resultText || null, errorMessage || null, processing_time_ms || null, promptId]
    );
    console.log(`Prompt ID: ${promptId} updated to status: ${status}.`);
  } catch (error) {
    console.error(`Error updating prompt ID ${promptId}:`, error);
  }
}

// --- Main Application Logic ---

async function main() {
  console.log('Starting Ollama Prompt Processor...');

  try {
    await ensureOllamaIsReady();
  } catch (ollamaError) {
    console.error('Failed to ensure Ollama is ready. Exiting.', ollamaError);
    process.exit(1);
  }

  let db: mysql.Connection;
  try {
    db = await connectToDB();
  } catch (dbError) {
    console.error('Failed to connect to database initially. Exiting.', dbError);
    process.exit(1);
  }

  const gracefulShutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    if (dbConnection) {
      try {
        await dbConnection.end();
        console.log('Database connection closed.');
      } catch (err) {
        console.error('Error closing database connection:', err);
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let prompt: any = null;
    try {
      // Ensure DB connection is alive before attempting to get a prompt
      if (!dbConnection) {
        console.log('Database connection is not active. Attempting to reconnect...');
        db = await connectToDB(); // This will re-assign to the global dbConnection as well
      } else {
        // Ping to check, mysql2/promise might handle some reconnections internally
        // but an explicit check can be good.
        try {
          await db.ping();
        } catch (pingErr) {
          console.warn('DB Ping failed. Attempting to reconnect...', pingErr);
          db = await connectToDB();
        }
      }

      prompt = await getPendingPrompt(db);

      if (prompt) {
        try {
          const [resultText, processing_time_ms] = await runOllamaPrompt(prompt.query, prompt.model);
          await updatePrompt(db, prompt.id, 3, { resultText, processing_time_ms });
        } catch (ollamaError: any) {
          console.error(`Failed to process prompt ID ${prompt.id}:`, ollamaError.message);
          await updatePrompt(db, prompt.id, 4, { errorMessage: ollamaError.message });
        }
      } else {
        console.log(`No pending prompts found. Sleeping for ${POLLING_INTERVAL_SECONDS} seconds...`);
        await sleep(POLLING_INTERVAL_SECONDS * 1000);
      }
    } catch (error: any) {
      console.error('An error occurred in the main loop:', error.message);
      if (prompt && prompt.id && dbConnection) {
        try {
          await updatePrompt(db, prompt.id, 4, { errorMessage: `Main loop error: ${error.message.substring(0, 500)}` });
        } catch (updateErr) {
          console.error('Additionally, failed to update prompt status after main loop error:', updateErr);
        }
      }
      // If DB connection fails, connectToDB() inside the loop will try to re-establish.
      // If other errors, sleep and retry.
      console.log(`Sleeping for ${POLLING_INTERVAL_SECONDS} seconds before retrying...`);
      await sleep(POLLING_INTERVAL_SECONDS * 1000);
    }
  }
}

// --- Script Execution ---
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error in main execution:', error);
    if (dbConnection) {
      dbConnection.end().catch((err) => console.error('Error closing DB on unhandled main error:', err));
    }
    process.exit(1);
  });
}
