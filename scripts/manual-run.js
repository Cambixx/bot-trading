import dotenv from 'dotenv';
import { resolve, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import os from 'os';
import {
  detectBTCContext,
  getAllTickers24h,
  getKlines,
  getOrderBookDepth,
  selectTopSymbols,
  sleep,
  toSummaryPairs
} from '../netlify/functions/tradingview-strategy-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SITE_ID = 'be80fad2-39f0-4f8f-b67c-871b07ce7b97';

function parseArgs(argv) {
  const options = {
    envFile: resolve(__dirname, '../.env'),
    siteID: process.env.SITE_ID || process.env.NETLIFY_SITE_ID || DEFAULT_SITE_ID,
    telegramEnabled: null,
    json: false,
    help: false,
    bot: 'trader',
    dryRun: false,
    maxSymbols: null,
    symbols: []
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

    if (arg === '--knife') {
      options.bot = 'knife';
      continue;
    }

    if (arg === '--trader') {
      options.bot = 'trader';
      continue;
    }

    if (arg === '--both') {
      options.bot = 'both';
      continue;
    }

    if (arg === '--dry-run' || arg === '--preview') {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith('--bot=')) {
      const value = arg.slice('--bot='.length).trim();
      if (['trader', 'knife', 'both'].includes(value)) options.bot = value;
      continue;
    }

    if (arg === '--bot' && argv[i + 1]) {
      const value = argv[i + 1].trim();
      if (['trader', 'knife', 'both'].includes(value)) options.bot = value;
      i++;
      continue;
    }

    if (arg.startsWith('--max-symbols=')) {
      const value = Number(arg.slice('--max-symbols='.length).trim());
      if (Number.isFinite(value) && value > 0) options.maxSymbols = value;
      continue;
    }

    if (arg === '--max-symbols' && argv[i + 1]) {
      const value = Number(argv[i + 1].trim());
      if (Number.isFinite(value) && value > 0) options.maxSymbols = value;
      i++;
      continue;
    }

    if (arg.startsWith('--symbols=')) {
      options.symbols = arg.slice('--symbols='.length).split(',').map(s => s.trim()).filter(Boolean);
      continue;
    }

    if (arg === '--symbols' && argv[i + 1]) {
      options.symbols = argv[i + 1].split(',').map(s => s.trim()).filter(Boolean);
      i++;
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
  --knife              Run the Knife Catcher algorithm instead of Trader Bot
  --trader             Run the Trader Bot algorithm
  --both               Run Trader Bot and Knife Catcher sequentially
  --bot <name>         trader, knife, or both
  --dry-run            Fetch market data and test generateSignal without Blobs writes
  --max-symbols <n>    Limit the dry-run universe size
  --symbols <list>     Comma-separated symbols or bases for dry-run, e.g. BTC,SOL or BTCUSDT,SOLUSDT
  --help, -h           Show this help

Notes:
  - Default mode uses the real Netlify Blobs context.
  - Default mode may update cooldowns, history, shadows and persistent logs.
  - --dry-run does not require a Netlify token and does not write Blobs or send Telegram.
`.trim());
}

function loadEnvironment(envFile) {
  if (envFile && existsSync(envFile)) {
    dotenv.config({ path: envFile, quiet: true });
    return envFile;
  }

  dotenv.config({ quiet: true });
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
  console.log(`- mode: ${options.dryRun ? 'dry-run (no Blobs writes, no Telegram)' : 'live manual run'}`);
  console.log(`- site ID: ${options.dryRun ? 'not used' : options.siteID}`);
  console.log(`- bot algorithm: ${formatBotLabel(options.bot)}`);
  console.log(`- token available: ${context.token ? 'yes' : 'no'}${options.dryRun ? ' (not required)' : ''}`);
  console.log(`- TELEGRAM_ENABLED: ${process.env.TELEGRAM_ENABLED ?? 'unset'}`);
  console.log(`- QUOTE_ASSET: ${process.env.QUOTE_ASSET || 'USDT'}`);
  console.log(`- MAX_SYMBOLS: ${process.env.MAX_SYMBOLS || 'default'}`);
  console.log(`- dry-run MAX_SYMBOLS override: ${options.maxSymbols || 'default'}`);
  console.log(`- dry-run symbols: ${options.symbols.length ? options.symbols.join(',') : 'auto universe'}`);
  console.log(`- MIN_QUOTE_VOL_24H: ${process.env.MIN_QUOTE_VOL_24H || 'default'}`);
  console.log(`- AVOID_ASIA_SESSION: ${process.env.AVOID_ASIA_SESSION || 'default'}`);
}

function formatBotLabel(bot) {
  if (bot === 'knife') return 'Knife Catcher / Reversal Lab';
  if (bot === 'both') return 'Trader Bot + Knife Catcher';
  return 'Trader Bot / TradingView Fusion';
}

function getSelectedBots(bot) {
  return bot === 'both' ? ['trader', 'knife'] : [bot];
}

function normalizeDryRunSymbol(symbol, quoteAsset) {
  const clean = String(symbol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean) return null;
  return clean.endsWith(quoteAsset) ? clean : `${clean}${quoteAsset}`;
}

function getBotConfig(bot, options) {
  const quoteAsset = (process.env.QUOTE_ASSET || 'USDT').toUpperCase();
  if (bot === 'knife') {
    return {
      label: 'Knife Catcher / Reversal Lab',
      quoteAsset,
      modulePath: '../netlify/functions/knife-catcher.js',
      universeMode: 'reversion',
      maxSymbols: options.maxSymbols || Number(process.env.KNIFE_MAX_SYMBOLS) || 64,
      minQuoteVolume: Number(process.env.KNIFE_MIN_QUOTE_VOL_24H) || 8000000
    };
  }

  return {
    label: 'Trader Bot / TradingView Fusion',
    quoteAsset,
    modulePath: '../netlify/functions/trader-bot.js',
    universeMode: 'momentum',
    maxSymbols: options.maxSymbols || Number(process.env.MAX_SYMBOLS) || 48,
    minQuoteVolume: Number(process.env.MIN_QUOTE_VOL_24H) || 15000000
  };
}

async function buildBTCContext(quoteAsset, tickersBySymbol) {
  const btcSymbol = `BTC${quoteAsset}`;
  try {
    const [btcCandles4h, btcCandles1h] = await Promise.all([
      getKlines(btcSymbol, '4h', 120),
      getKlines(btcSymbol, '60m', 160)
    ]);
    return detectBTCContext(btcCandles4h, btcCandles1h, tickersBySymbol.get(btcSymbol));
  } catch (error) {
    return {
      status: 'GREEN',
      reason: `BTC fallback: ${error.message}`,
      closes4h: [],
      closes1h: [],
      priceChange24h: 0
    };
  }
}

function summarizeSignal(signal) {
  return {
    symbol: signal.symbol,
    module: signal.module,
    score: signal.score,
    requiredScore: signal.requiredScore,
    regime: signal.regime,
    price: signal.price,
    tp: signal.tp,
    sl: signal.sl,
    liquidityTier: signal.liquidityTier,
    recommendedSize: signal.recommendedSize,
    reasons: signal.reasons
  };
}

async function runDryBot(bot, options) {
  const config = getBotConfig(bot, options);
  const mod = await import(config.modulePath);
  const tickers24h = await getAllTickers24h();
  const tickersBySymbol = new Map(tickers24h.map(ticker => [ticker.symbol, ticker]));
  const btcContext = await buildBTCContext(config.quoteAsset, tickersBySymbol);
  const selectedSymbols = options.symbols.length
    ? options.symbols.map(symbol => normalizeDryRunSymbol(symbol, config.quoteAsset)).filter(Boolean)
    : selectTopSymbols(tickers24h, config.quoteAsset, config.maxSymbols, config.minQuoteVolume, config.universeMode);

  const analysisState = { rejectCounts: {}, moduleCandidates: {}, stageCounts: {} };
  const shadowCandidates = [];
  const signals = [];
  const errors = [];
  let analyzed = 0;

  for (const symbol of selectedSymbols) {
    try {
      const ticker = tickersBySymbol.get(symbol) || null;
      let signal = null;

      if (bot === 'knife') {
        const [candles5m, candles15m, candles1h, candles4h, orderBook] = await Promise.all([
          getKlines(symbol, '5m', 320),
          getKlines(symbol, '15m', 240),
          getKlines(symbol, '60m', 160),
          getKlines(symbol, '4h', 120),
          getOrderBookDepth(symbol, 20)
        ]);
        signal = mod.generateSignal(
          symbol,
          candles5m,
          candles15m,
          candles1h,
          candles4h,
          orderBook,
          ticker,
          btcContext,
          analysisState,
          shadowCandidates
        );
      } else {
        const [candles15m, candles1h, candles4h, orderBook] = await Promise.all([
          getKlines(symbol, '15m', 320),
          getKlines(symbol, '60m', 180),
          getKlines(symbol, '4h', 120),
          getOrderBookDepth(symbol, 20)
        ]);
        signal = mod.generateSignal(
          symbol,
          candles15m,
          candles1h,
          candles4h,
          orderBook,
          ticker,
          btcContext,
          analysisState,
          shadowCandidates
        );
      }

      analyzed++;
      if (signal) signals.push(signal);
      await sleep(8);
    } catch (error) {
      errors.push({ symbol, error: error.message });
      await sleep(8);
    }
  }

  return {
    success: true,
    dryRun: true,
    bot,
    label: config.label,
    btcContext: {
      status: btcContext.status,
      reason: btcContext.reason,
      rsi4h: btcContext.rsi4h ?? null,
      rsi1h: btcContext.rsi1h ?? null
    },
    universe: {
      mode: config.universeMode,
      selected: selectedSymbols.length,
      symbols: selectedSymbols
    },
    analyzed,
    signals: signals.length,
    signalPreview: signals.map(summarizeSignal),
    shadowCandidates: shadowCandidates.length,
    moduleCandidates: analysisState.moduleCandidates,
    stages: Object.fromEntries(toSummaryPairs(analysisState.stageCounts, 10).map(pair => {
      const [key, value] = pair.split('=');
      return [key, Number(value)];
    })),
    topRejects: Object.fromEntries(toSummaryPairs(analysisState.rejectCounts, 12).map(pair => {
      const [key, value] = pair.split('=');
      return [key, Number(value)];
    })),
    errors: errors.length,
    errorPreview: errors.slice(0, 8)
  };
}

async function runLiveBot(bot, context) {
  const mod = bot === 'knife'
    ? await import('../netlify/functions/knife-catcher.js')
    : await import('../netlify/functions/trader-bot.js');
  return mod.runAnalysis(context);
}

async function start() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const envPath = loadEnvironment(options.envFile);

  if (options.dryRun && options.telegramEnabled === null) {
    process.env.TELEGRAM_ENABLED = 'false';
  }

  if (options.telegramEnabled !== null) {
    process.env.TELEGRAM_ENABLED = options.telegramEnabled ? 'true' : 'false';
  }

  const token = options.dryRun ? null : getNetlifyToken();
  if (!options.dryRun && !token) {
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
    const results = [];
    for (const bot of getSelectedBots(options.bot)) {
      const result = options.dryRun
        ? await runDryBot(bot, options)
        : await runLiveBot(bot, context);
      results.push({ bot, ...result });
    }

    const durationMs = Date.now() - startedAt;
    const enrichedResult = results.length === 1
      ? { ...results[0], durationMs }
      : { success: results.every(result => result.success), dryRun: options.dryRun, results, durationMs };

    if (options.json) {
      console.log(JSON.stringify(enrichedResult, null, 2));
    } else {
      console.log('--- Analysis Result ---');
      console.log(JSON.stringify(enrichedResult, null, 2));
      console.log('');
      console.log(enrichedResult.success
        ? `Manual test completed successfully in ${durationMs} ms.`
        : `Manual test failed in ${durationMs} ms: ${enrichedResult.error || 'see result payload'}`);
    }

    if (!enrichedResult.success) process.exit(2);
  } catch (error) {
    console.error('\nCRITICAL ERROR during manual run:', error.message);
    process.exit(1);
  }
}

start();
