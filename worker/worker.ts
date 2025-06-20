import { Command } from 'commander';
import * as child_process from 'child_process';
import * as os from 'os';
import * as util from 'util';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { GenerateResponse, Ollama } from 'ollama';
import { v4 as uuidv4 } from 'uuid';
import * as version from './version.json';

// Load environment variables from .env file
dotenv.config();

// Promisify exec for cleaner async/await usage
const exec = util.promisify(child_process.exec);

// Read worker ID from worker.json
if (!fs.existsSync('worker.json')) {
  fs.writeFileSync('worker.json', JSON.stringify({ id: uuidv4() }));
}
const workerConfig = JSON.parse(fs.readFileSync('worker.json', 'utf8'));
const workerId = process.env.WORKER_ID || workerConfig.id;

const ollama = new Ollama();
const OLLAMA_INSTALL_URL = 'https://ollama.com/install.sh';

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
  const models = await ollama.list();
  return models.models.map((model) => model.name);
}
async function getLoadedModels(): Promise<string[]> {
  const running = await ollama.ps();
  return running.models.map((model) => model.model);
}

/**
 * Should I use this? When should I fetch missing models? How do I know a worker can handle it?
 * Do I let the user choose a set of models, disk space? Do I look at their RAM and cpu?
 * Do users get a choice?
 */
async function fetchMissingModels(models: string[]) {
  const requiredModels: string[] = await fetch(`${options.host}/api/worker/models`)
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
  const path = `${options.host}/api/worker/fetch-query`;
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
    console.log(`No pending prompts found at ${path}. Sleeping for ${options.polling} seconds...`);
    sleep(options.polling * 1000);
    return null;
  }

  // Post a status update to the server via fetch to api
  const prompt = data;
  console.log(`Found pending prompt ID: ${prompt.id}, query: "${prompt.query}"`);
  // Update the prompt status to 'processing' (status = 1)
  fetch(`${options.host}/api/worker/query/${prompt.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${workerId}`,
    },
    body: JSON.stringify({ status: 1 }), // Set status to 'processing'
  });

  return prompt;
}

/**
 * Runs a prompt against the Ollama API. Models should already match because we fetch with our preferred and available models.
 *
 * @param promptText The text of the prompt.
 * @param modelName The name of the model to use (e.g., "llama3:latest").
 * @returns A promise that resolves to a tuple: [responseText, processingTimeMs].
 */
export async function runOllamaPrompt(promptText: string, modelName: string): Promise<[string, number]> {
  // Initialize the Ollama client. Assumes Ollama server is running on default host (http://localhost:11434).
  // You can configure the host if needed: new Ollama({ host: "http://custom_host:port" })
  console.log(`Running prompt with model "${modelName}".`);
  const models = await ollama.list();

  const response: GenerateResponse = await ollama.generate({
    model: modelName,
    prompt: promptText,
    stream: false, // Get the full response at once
  });

  console.log(
    `Finished running with model "${modelName}". Time: ${Math.round(response.eval_duration / 1000 / 1000)}ms. Reason: ${
      response.done_reason
    }`
  );
  return [response.response, response.eval_duration];
}

/**
 * Updates a prompt in the database with the result or an error message.
 */
async function updatePrompt(
  promptId: number,
  status: 3 | 4, // success or failure
  {
    resultText,
    errorMessage,
    processing_time_ms,
  }: { resultText?: string; errorMessage?: string; processing_time_ms?: number }
): Promise<void> {
  try {
    await fetch(`${options.host}/api/worker/query/${promptId}`, {
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

async function sendStartupInfo() {
  // Gather system info
  const cpu = os.cpus()[0]?.model || 'unknown';
  const platform = os.platform();
  const totalmem = os.totalmem();
  // Try to get GPU info (best effort, platform dependent)
  let gpu: string | null = null;
  let gpu_memory: number | null = null;
  try {
    if (platform === 'linux' || platform === 'darwin') {
      const { stdout } = await exec('lspci | grep -i vga || system_profiler SPDisplaysDataType');
      gpu = stdout.trim() || 'unknown';
      // Try to get GPU memory (Linux/NVIDIA only)
      if (platform === 'linux') {
        try {
          const { stdout: nvidiaSmi } = await exec('nvidia-smi --query-gpu=memory.total --format=csv,noheader');
          gpu_memory = parseInt(nvidiaSmi.trim()) * 1024 * 1024; // MB to bytes
        } catch {}
      }
    } else if (platform === 'win32') {
      const { stdout } = await exec('wmic path win32_VideoController get name');
      gpu = stdout.split('\n')[1]?.trim() || 'unknown';
      // Try to get GPU memory (Windows)
      const { stdout: memOut } = await exec('wmic path win32_VideoController get AdapterRAM');
      const memLine = memOut.split('\n')[1]?.trim();
      gpu_memory = memLine ? parseInt(memLine) : null;
    }
  } catch {}

  // POST to /api/worker/startup
  try {
    await fetch(`${options.host}/api/worker/startup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerId}`,
      },
      body: JSON.stringify({
        cpu,
        platform,
        system_memory: totalmem,
        gpu,
        gpu_memory,
      }),
    });
    console.log('Startup info sent to server.');
  } catch (err) {
    console.error('Failed to send startup info:', err);
  }
}

async function checkLatestVersion() {
  const info = await fetch('https://github.com/StephenFluin/friendlai/releases/latest/download/release-info.json');
  const latestRelease = await info.json();

  // Compare the version attribute against version.version
  const currentVersion = version.version;
  // If the patch is 0, we consider it a pre-release
  if (currentVersion.endsWith('.0') || currentVersion === latestRelease.version) {
    console.log('Up to date or prerelease. Latest:', latestRelease.version, ' Current: ', currentVersion);
    return;
  }
  console.log(`New version available: ${latestRelease.version}`);
  // Download the latest release and execute it instead of this one
  // latest release will be in linux, windows, or macos property of latestRelease, grab the right one for our platform
  const platform = os.platform();
  let downloadUrl = '';
  let binaryName = '';
  if (platform === 'linux') {
    binaryName = latestRelease.linux;
  } else if (platform === 'darwin') {
    binaryName = latestRelease.macos;
  } else if (platform === 'win32') {
    binaryName = latestRelease.windows;
  } else {
    console.error(`Unsupported platform: ${platform}. Cannot download latest release.`);
    return;
  }
  downloadUrl = `https://github.com/stephenfluin/friendlai/releases/latest/download/${binaryName}`;
  console.log(`Downloading latest release from ${downloadUrl}...`);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    console.error(`Failed to download latest release: ${response.statusText}`);
    return;
  }
  // Replace the existing binary with the new one
  const buffer = await response.arrayBuffer();
  // get current binary path
  console.log('Replacing current binary with the latest release...');
  const currentBinaryPath = binaryName;

  // Write the new binary to the current path
  fs.writeFileSync(currentBinaryPath, Buffer.from(buffer));
  fs.chmodSync(currentBinaryPath, 0o755); // Make it executable
  console.log('New binary downloaded. Please restart the worker to use the latest version.');
  console.log('Exiting current worker process...');
  process.exit(0);
}

async function main() {
  console.log('Starting Friendlai Worker...');
  console.log(`Worker ID: ${workerId}`);
  sendStartupInfo();

  if (!options.skipUpdateCheck) {
    await checkLatestVersion();
  }

  try {
    await ensureOllamaIsReady();
  } catch (error) {
    console.error('Failed to ensure Ollama is ready:', error);
    process.exit(1);
  }

  while (true) {
    let prompt: any = null;
    try {
      prompt = await getPendingPrompt();

      if (prompt) {
        try {
          fetch(`${options.host}/api/worker/query/${prompt.id}`, {
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
        await sleep(options.polling * 1000);
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
      console.log(`Sleeping for ${options.polling} seconds before retrying...`);
    }
  }
}

// Initialize Commander
const program = new Command();
program.name('friendlai-worker').description('CLI for managing Friendlai Worker').version(version.version);

// Add options and commands
program
  .option(
    '-p, --polling <seconds>',
    'Set polling interval in seconds',
    (value) => parseInt(value, 10), // Explicitly specify base 10
    20
  )
  .option('-h, --host <url>', 'Set the host URL for the Friendlai server', process.env.HOST || 'https://friendlai.xyz')
  .option('--skip-update-check', 'Skip checking for updates on startup', false);

program.command('run', { isDefault: true }).description('Run the Friendlai Worker').action(main);
program.command('fetch').description('Fetch popularly used models from the ollama').action(fetchMissingModels);

program.parse(process.argv);
const options = program.opts();
