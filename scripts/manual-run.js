import dotenv from 'dotenv';
import { resolve, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SITE_ID = 'be80fad2-39f0-4f8f-b67c-871b07ce7b97';

function parseArgs(argv) {
  const options = {
    envFile: resolve(__dirname, '../.env'),
    siteID: process.env.SITE_ID || process.env.NETLIFY_SITE_ID || DEFAULT_SITE_ID,
    telegramEnabled: null,
    json: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--no-telegram') {
      options.telegramEnabled = false;
      continue;
    }

    if (arg === '--telegram') {
      options.telegramEnabled = true;
      continue;
    }

    if (arg.startsWith('--env-file=')) {
      const value = arg.slice('--env-file='.length).trim();
      options.envFile = isAbsolute(value) ? value : resolve(process.cwd(), value);
      continue;
    }

    if (arg === '--env-file' && argv[i + 1]) {
      const value = argv[i + 1].trim();
      options.envFile = isAbsolute(value) ? value : resolve(process.cwd(), value);
      i++;
      continue;
    }

    if (arg.startsWith('--site-id=')) {
      options.siteID = arg.slice('--site-id='.length).trim();
      continue;
    }

    if (arg === '--site-id' && argv[i + 1]) {
      options.siteID = argv[i + 1].trim();
      i++;
      continue;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage: node scripts/manual-run.js [options]

Options:
  --no-telegram        Disable Telegram notifications for this run
  --telegram           Force Telegram notifications on for this run
  --env-file <path>    Load a specific .env file
  --site-id <id>       Override Netlify site ID
  --json               Print the final result as JSON only
  --help, -h           Show this help

Notes:
  - This script uses the real Netlify Blobs context.
  - It may update cooldowns, history, shadows and persistent logs.
  - Use --no-telegram when you want a quieter validation run.
`.trim());
}

function loadEnvironment(envFile) {
  if (envFile && existsSync(envFile)) {
    dotenv.config({ path: envFile });
    return envFile;
  }

  dotenv.config();
  return existsSync(resolve(process.cwd(), '.env')) ? resolve(process.cwd(), '.env') : null;
}

function getNetlifyToken() {
  const home = os.homedir();
  const paths = [
    resolve(home, '.netlify/config.json'),
    resolve(home, 'Library/Preferences/netlify/config.json')
  ];

  for (const configPath of paths) {
    if (!existsSync(configPath)) continue;

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      if (config.authId) return config.authId;

      if (config.users && Object.keys(config.users).length > 0) {
        const token = Object.values(config.users)[0]?.auth?.token;
        if (token) return token;
      }
    } catch (error) {
      console.error(`Error reading ${configPath}:`, error.message);
    }
  }

  return process.env.NETLIFY_AUTH_TOKEN;
}

function printPreflight(options, envPath, context) {
  console.log('Manual analysis preflight');
  console.log(`- env file: ${envPath || 'not found'}`);
  console.log(`- site ID: ${options.siteID}`);
  console.log(`- token available: ${context.token ? 'yes' : 'no'}`);
  console.log(`- TELEGRAM_ENABLED: ${process.env.TELEGRAM_ENABLED ?? 'unset'}`);
  console.log(`- QUOTE_ASSET: ${process.env.QUOTE_ASSET || 'USDT'}`);
  console.log(`- MAX_SYMBOLS: ${process.env.MAX_SYMBOLS || 'default'}`);
  console.log(`- MIN_QUOTE_VOL_24H: ${process.env.MIN_QUOTE_VOL_24H || 'default'}`);
  console.log(`- AVOID_ASIA_SESSION: ${process.env.AVOID_ASIA_SESSION || 'default'}`);
}

async function start() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const envPath = loadEnvironment(options.envFile);

  if (options.telegramEnabled !== null) {
    process.env.TELEGRAM_ENABLED = options.telegramEnabled ? 'true' : 'false';
  }

  const token = getNetlifyToken();
  if (!token) {
    console.error("Error: Netlify token not found. Run 'netlify login' or set NETLIFY_AUTH_TOKEN.");
    process.exit(1);
  }

  const context = {
    siteID: options.siteID,
    token
  };

  if (!options.json) {
    printPreflight(options, envPath, context);
    console.log('');
  }

  const startedAt = Date.now();

  try {
    const { runAnalysis } = await import('../netlify/functions/scheduled-analysis.js');
    const result = await runAnalysis(context);
    const durationMs = Date.now() - startedAt;
    const enrichedResult = {
      ...result,
      durationMs
    };

    if (options.json) {
      console.log(JSON.stringify(enrichedResult, null, 2));
    } else {
      console.log('--- Analysis Result ---');
      console.log(JSON.stringify(enrichedResult, null, 2));
      console.log('');
      console.log(result.success
        ? `Manual test completed successfully in ${durationMs} ms.`
        : `Manual test failed in ${durationMs} ms: ${result.error}`);
    }

    if (!result.success) process.exit(2);
  } catch (error) {
    console.error('\nCRITICAL ERROR during manual run:', error.message);
    process.exit(1);
  }
}

start();
