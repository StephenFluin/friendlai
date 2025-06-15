import * as child_process from 'child_process';
import * as os from 'os';
import * as util from 'util';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { GenerateResponse, Ollama } from 'ollama';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables from .env file
dotenv.config();

// Promisify exec for cleaner async/await usage
const exec = util.promisify(child_process.exec);

// --- Configuration ---
// Database credentials will now be primarily sourced from the .env file
const config = {
  host: process.env.HOST || 'https://friendlai.xyz',
};

// Read worker ID from worker.json
if (!fs.existsSync('worker.json')) {
  fs.writeFileSync('worker.json', JSON.stringify({ id: uuidv4() }));
}
const workerConfig = JSON.parse(fs.readFileSync('worker.json', 'utf8'));
const workerId = process.env.WORKER_ID || workerConfig.id;

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
    const models = await getAvailableModels();
    console.log('Available models:', models.join(', ') || 'No models found.');
    //await fetchMissingModels(models);
  } catch (error) {
    console.warn('Ollama server might not be running or responding. `ollama run` might start it.');
    console.warn('If you encounter issues, ensure the Ollama application/service is running.');
  }
}

async function getAvailableModels(): Promise<string[]> {
  const modelsRaw = await exec('ollama list');

  console.log('Ollama server appears to be running.');
  const models = modelsRaw.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.split(/\s+/)[0].trim());
  return models;
}
async function getLoadedModels(): Promise<string[]> {
  const ollama = new Ollama();
  const running = await ollama.ps();
  return running.models.map((model) => model.model);
}

async function fetchMissingModels(models: string[]) {
  const requiredModels: string[] = await fetch(`${config.host}/api/worker/models`)
    .then((response) => response.json())
    .then((data) => data || [])
    .catch((error) => {
      console.error('Failed to fetch required models:', error);
      return [];
    });

  console.log('Required models:', requiredModels.join(', '));
  const missingModels = requiredModels.filter((model) => !models.includes(model));
  if (missingModels.length > 0) {
    console.log('Missing models found:', missingModels.join(', '));
    // Logic to fetch missing models goes here
    for (const model of missingModels) {
      try {
        console.log(`Pulling missing model: ${model}`);
        const ollama = new Ollama();
        const stream = await ollama.pull({ model, stream: true });
        // Give progress updates every 10 seconds
        let time = Date.now() - 10000;
        for await (const progress of stream) {
          if (Date.now() - time > 10000) {
            time = Date.now();
            console.log(
              `Pulling ${model}: ${progress.status} ${
                Math.round((progress.completed / 1024 / 1024 / 1024) * 10) / 10 || ''
              }GB/${Math.round((progress.total / 1024 / 1024 / 1024) * 10) / 10 || ''}GB`
            );
          }
        }
        console.log(`Successfully pulled model: ${model}`);
      } catch (error) {
        console.error(`Failed to pull model "${model}":`, error);
      }
      console.log('moving to next model...');
    }
  }
  console.log('All required models are available.');
}

/**
 * Fetches the oldest pending prompt from the database and sets its status to 'processing'.
 * @param db - The MySQL connection object.
 * @returns The prompt object or null if no pending prompts are found.
 */
async function getPendingPrompt(): Promise<any | null> {
  // Use fetch to fetch queries from /api/worker/queries
  const path = `${config.host}/api/worker/fetch-query`;
  const queries = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${workerId}`,
    },
    body: JSON.stringify({
      preferredModels: await getLoadedModels(),
      availableModels: await getAvailableModels(),
    }),
  });
  if (!queries.ok) {
    console.log(queries);
    console.error(`Failed to fetch pending prompts from ${path}: ${queries.statusText}`);
    return null;
  }
  const data = await queries.json();
  if (Array.isArray(data) && data.length === 0) {
    console.log(`No pending prompts found at ${path}.`);
    return null;
  } else {
    console.log(`Found ${data.length} pending prompts at ${path}.`);
  }

  // Post a status update to the server via fetch to api
  const prompt = data;
  console.log(`Found pending prompt ID: ${prompt.id}, query: "${prompt.query}"`);
  // Update the prompt status to 'processing' (status = 1)
  fetch(`${config.host}/api/worker/query/${prompt.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${workerId}`,
    },
    body: JSON.stringify({ status: 1 }), // Set status to 'processing'
  });

  return prompt;
}

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
export async function runOllamaPrompt(promptText: string, modelName: string): Promise<[string, number]> {
  // Initialize the Ollama client. Assumes Ollama server is running on default host (http://localhost:11434).
  // You can configure the host if needed: new Ollama({ host: "http://custom_host:port" })
  const ollama = new Ollama();
  console.log(`Running prompt with model "${modelName}" using Ollama JS API...`);
  const models = await ollama.list();
  models.models[0].model;
  if (!models.models.find((item) => item.model === modelName)) {
    console.log(`Model "${modelName}" not found. Pulling requested models...`);
    await ollama.pull({ model: modelName });
    console.log('model downloaded!');
  }

  const response: GenerateResponse = await ollama.generate({
    model: modelName,
    prompt: promptText,
    stream: false, // Get the full response at once
  });

  console.log(`Ran prompt with model "${modelName}". Time: ${response.eval_duration}ms.`);
  console.log('Finished because:', response.done_reason);
  return [response.response, response.eval_duration];
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
  promptId: number,
  status: 3 | 4,
  {
    resultText,
    errorMessage,
    processing_time_ms,
  }: { resultText?: string; errorMessage?: string; processing_time_ms?: number }
): Promise<void> {
  try {
    await fetch(`${config.host}/api/worker/query/${promptId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerId}`,
      },
      body: JSON.stringify({
        status,
        result: resultText || null,
        error_message: errorMessage || null,
        processing_time_ms: processing_time_ms || null,
      }),
    });
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

  while (true) {
    let prompt: any = null;
    try {
      prompt = await getPendingPrompt();

      if (prompt) {
        try {
          fetch(`${config.host}/api/worker/query/${prompt.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${workerId}`,
            },
            body: JSON.stringify({ id: prompt.id, status: 1 }), // Set status to 'processing'
          });
          const [resultText, processing_time_ns] = await runOllamaPrompt(prompt.query, prompt.model);
          const processing_time_ms = Math.round(processing_time_ns / 1000000);
          await updatePrompt(prompt.id, 3, { resultText, processing_time_ms });
        } catch (ollamaError: any) {
          console.error(`Failed to process prompt ID ${prompt.id}:`, ollamaError.message);

          await updatePrompt(prompt.id, 4, { errorMessage: ollamaError.message });
        }
      } else {
        console.log(`No pending prompts found. Sleeping for ${POLLING_INTERVAL_SECONDS} seconds...`);
        await sleep(POLLING_INTERVAL_SECONDS * 1000);
      }
    } catch (error: any) {
      console.error('An error occurred in the main loop:', error.message);
      if (prompt && prompt.id) {
        try {
          await updatePrompt(prompt.id, 4, { errorMessage: `Main loop error: ${error.message.substring(0, 500)}` });
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
    process.exit(1);
  });
}

function pull() {
  // if (isModelNotFoundError) {
  //     console.log(`Model "${modelName}" not found or inaccessible. Attempting to pull model...`);
  //     const pullAbortController = new AbortController();
  //     let pullTimeoutId: NodeJS.Timeout;
  //     const pullTimeoutPromise = new Promise<never>((_, reject) => {
  //       pullTimeoutId = setTimeout(() => {
  //         const timeoutMessage = `Ollama pull for model "${modelName}" timed out after ${PULL_TIMEOUT_MS}ms.`;
  //         console.warn(timeoutMessage);
  //         pullAbortController.abort();
  //       }, PULL_TIMEOUT_MS);
  //     });
  //     try {
  //       const pullOperation = async () => {
  //         const pullStream = await ollama.pull({
  //           model: modelName,
  //           stream: true, // Iterate over progress
  //           signal: pullAbortController.signal,
  //         });
  //         let lastStatus = '';
  //         let pullFailedInStream = false;
  //         console.log(`Pulling "${modelName}" (this may take up to ${PULL_TIMEOUT_MS / 60000} minutes)...`);
  //         for await (const progress of pullStream) {
  //           lastStatus = progress.status;
  //           if (progress.error) {
  //             console.error(`Error detail during pull stream for "${modelName}": ${progress.error}`);
  //             pullFailedInStream = true;
  //             throw new Error(`Streamed pull for "${modelName}" reported an error: ${progress.error}`);
  //           }
  //           // You can log more detailed progress here if desired:
  //           // console.log(`Pulling ${modelName}: ${progress.status} ${progress.completed || ''}/${progress.total || ''}`);
  //         }
  //         if (!pullFailedInStream) {
  //           // A successful pull typically ends with a status like "success".
  //           // If the stream completes without `progress.error`, it's generally successful.
  //           console.log(`Pull stream for "${modelName}" completed. Last status: ${lastStatus}`);
  //         }
  //       };
  //       await Promise.race([pullOperation(), pullTimeoutPromise]);
  //       clearTimeout(pullTimeoutId!);
}
