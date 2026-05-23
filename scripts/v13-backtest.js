/**
 * Backtest engine for Trader (Fusion v13) and Knife (Reversal Lab v3).
 *
 * - Data source: Binance public mirror (data-api.binance.vision) — no geo-block.
 * - Dual-bot support: loads the right module and timeframes per --bot.
 * - Realistic context: real ticker24h from data, real BTC context via
 *   detectBTCContext, heuristic order book derived from recent volume.
 * - Disk cache: klines cached in backtests/.cache (TTL 6h).
 * - Tournament-friendly: Backtester class is exportable; reuse loaded data
 *   across multiple strategy variations.
 *
 * Usage:
 *   node scripts/v13-backtest.js                              # Trader, top 5 USDT, 1 month
 *   node scripts/v13-backtest.js --bot=knife                  # Knife
 *   node scripts/v13-backtest.js --symbols=BTCUSDT,ETHUSDT
 *   node scripts/v13-backtest.js --modules=VIDYA_SQUEEZE_EXPANSION
 *   node scripts/v13-backtest.js --rr-mult=1.3 --sl-mult=0.8  # tighter SL, wider TP
 *   node scripts/v13-backtest.js --shadow                     # include shadowOnly modules
 *   node scripts/v13-backtest.js --no-be                      # disable breakeven move
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { detectBTCContext, calculateRSI, calculateEMA, calculateMACD } from '../netlify/functions/tradingview-strategy-core.js';

// --- Entry-quality filters (applied post-signal to improve win rate) ---

function htfMomentumRising(candles1h) {
  // Require MACD histogram on 1h to be rising for ≥2 consecutive bars
  if (!candles1h || candles1h.length < 40) return false;
  const macd = calculateMACD(candles1h.map(c => c.close));
  if (!macd) return false;
  return macd.histDeltaConsecutive >= 2;
}

function recent5mBullish(candles5m, lookback = 3) {
  // Require last `lookback` 5m candles to show bullish momentum (close > 5m EMA5)
  if (!candles5m || candles5m.length < 10) return false;
  const closes = candles5m.map(c => c.close);
  const ema5 = calculateEMA(closes, 5);
  if (!Number.isFinite(ema5)) return false;
  const recent = candles5m.slice(-lookback);
  const bullishCloses = recent.filter(c => c.close > ema5).length;
  const greenCount = recent.filter(c => c.close > c.open).length;
  return bullishCloses >= 2 && greenCount >= 2;
}

function pullbackReclaimedEma9(candles15m, lookback = 5) {
  // Recent (within lookback bars) low touched EMA9 from below, and current close > EMA9
  if (!candles15m || candles15m.length < 30) return false;
  const closes = candles15m.map(c => c.close);
  const ema9 = calculateEMA(closes, 9);
  if (!Number.isFinite(ema9)) return false;
  const recent = candles15m.slice(-lookback - 1, -1);
  const touched = recent.some(c => c.low <= ema9 * 1.001);
  const reclaimed = candles15m[candles15m.length - 1].close > ema9;
  return touched && reclaimed;
}

function volumeSpike5m(candles5m, multiplier = 1.5, window = 20) {
  if (!candles5m || candles5m.length < window + 2) return false;
  const slice = candles5m.slice(-window - 1, -1);
  const avg = slice.reduce((s, c) => s + c.volume, 0) / slice.length;
  if (avg <= 0) return false;
  return candles5m[candles5m.length - 1].volume >= avg * multiplier;
}

function rsiOversoldReclaim(candles5m, oversoldLevel = 30, reclaimLevel = 38, lookback = 8) {
  // Bullish reclaim from oversold: RSI dipped below `oversoldLevel` in last `lookback`
  // candles, now above `reclaimLevel`, and current close > close at the dip.
  if (!candles5m || candles5m.length < 30) return false;
  const closes = candles5m.map(c => c.close);
  const currRsi = calculateRSI(closes, 14);
  if (!Number.isFinite(currRsi) || currRsi < reclaimLevel) return false;
  // Walk back computing RSI on truncated series — find any dip below oversoldLevel
  let dipFound = false;
  let dipPrice = null;
  for (let i = closes.length - lookback - 1; i < closes.length - 1; i++) {
    const r = calculateRSI(closes.slice(0, i + 1), 14);
    if (Number.isFinite(r) && r <= oversoldLevel) {
      dipFound = true;
      dipPrice = closes[i];
    }
  }
  if (!dipFound) return false;
  return closes[closes.length - 1] > dipPrice;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BINANCE_API = 'https://data-api.binance.vision/api/v3';
const CACHE_DIR = path.join(__dirname, '..', 'backtests', '.cache');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const STABLECOIN_BASES = new Set(['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USTC', 'EUR', 'GBP', 'USD1']);

// Default symbol set: 5 blue-chip USDT pairs known to be reliably liquid on Binance.
// Used when neither --symbols nor --top is provided. Keeps results comparable across runs.
export const DEFAULT_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { bot: 'trader' };
  for (const a of args) {
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      opts[k] = v === undefined ? true : v;
    } else {
      opts.symbol = a.toUpperCase();
    }
  }
  return opts;
}

async function fetchJson(url, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${url}\n${body.slice(0, 200)}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cacheKey(symbol, interval, startTime, endTime) {
  return `${symbol}-${interval}-${startTime}-${endTime}.json`;
}

function readCache(key) {
  const file = path.join(CACHE_DIR, key);
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  if (Date.now() - st.mtimeMs > CACHE_TTL_MS) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return null; }
}

function writeCache(key, data) {
  ensureDir(CACHE_DIR);
  fs.writeFileSync(path.join(CACHE_DIR, key), JSON.stringify(data));
}

async function getKlinesPaged(symbol, interval, startTime, endTime, { useCache = true } = {}) {
  const key = cacheKey(symbol, interval, startTime, endTime);
  if (useCache) {
    const cached = readCache(key);
    if (cached) return cached;
  }
  const all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const url = `${BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=1000&startTime=${cursor}&endTime=${endTime}`;
    const rows = await fetchJson(url);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      all.push({
        time: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
        closeTime: Number(r[6]),
        quoteVolume: Number(r[7])
      });
    }
    const last = rows[rows.length - 1][0];
    if (last <= cursor) break;
    cursor = last + 1;
    if (rows.length < 1000) break;
  }
  if (useCache) writeCache(key, all);
  return all;
}

async function getTopUsdtSymbols(limit) {
  const data = await fetchJson(`${BINANCE_API}/ticker/24hr`);
  return data
    .filter(t => t.symbol.endsWith('USDT'))
    .filter(t => !STABLECOIN_BASES.has(t.symbol.replace('USDT', '')))
    .filter(t => !/UP|DOWN|BULL|BEAR/.test(t.symbol.slice(0, -4)))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit)
    .map(t => t.symbol);
}

function sliceUpTo(arr, t, lastIdx) {
  let i = Math.max(0, lastIdx);
  while (i < arr.length && arr[i].time <= t) i++;
  return i;
}

function buildTicker24h(candles15mSlice) {
  const last = candles15mSlice[candles15mSlice.length - 1];
  if (!last) return { quoteVolume: 0, priceChangePercent: 0 };
  const cutoff = last.time - 24 * 60 * 60 * 1000;
  let quoteVolume = 0;
  let priceStart = null;
  for (let i = candles15mSlice.length - 1; i >= 0; i--) {
    const c = candles15mSlice[i];
    if (c.time < cutoff) break;
    quoteVolume += c.quoteVolume || (c.close * c.volume);
    priceStart = c.open;
  }
  const priceChange = priceStart ? ((last.close - priceStart) / priceStart) * 100 : 0;
  return { quoteVolume, priceChangePercent: priceChange };
}

function buildOrderBook(price, ticker24h) {
  const qv = Math.max(ticker24h.quoteVolume || 0, 1);
  const spreadBps = qv >= 50_000_000 ? 2
    : qv >= 20_000_000 ? 3
    : qv >= 8_000_000 ? 5
    : qv >= 2_000_000 ? 8
    : 12;
  const halfSpread = price * (spreadBps / 2) / 10000;
  const depthTotal = qv * 0.0015;
  const sideDepth = depthTotal / 2;
  const levels = 20;
  const bids = [], asks = [];
  for (let i = 0; i < levels; i++) {
    const offset = halfSpread * (1 + i * 0.5);
    const sliceUsd = sideDepth / levels;
    const bidPx = price - offset;
    const askPx = price + offset;
    bids.push([bidPx, sliceUsd / bidPx]);
    asks.push([askPx, sliceUsd / askPx]);
  }
  return { bids, asks };
}

export class Backtester {
  constructor(opts = {}) {
    this.bot = opts.bot === 'knife' ? 'knife' : 'trader';
    this.symbols = opts.symbols
      ? (Array.isArray(opts.symbols) ? opts.symbols : String(opts.symbols).split(',').map(s => s.toUpperCase()))
      : (opts.symbol ? [String(opts.symbol).toUpperCase()] : null);
    // --top fetches the top-N USDT pairs by volume; without it (and without --symbols)
    // we use the predetermined DEFAULT_PAIRS list so reports are reproducible.
    this.useTopUniverse = opts.top !== undefined;
    this.top = opts.top ? parseInt(opts.top, 10) : DEFAULT_PAIRS.length;
    this.months = opts.months ? parseFloat(opts.months) : (opts.days ? parseFloat(opts.days) / 30 : 1);
    this.days = Math.round(this.months * 30);
    this.startBalance = opts.balance ? parseFloat(opts.balance) : 5000;
    this.allocPct = opts.allocPct ? parseFloat(opts.allocPct) : 0.20;
    this.oosSplitRatio = opts.oosSplit ? parseFloat(opts.oosSplit) : 0.7;
    this.noOpen = !!opts['no-open'] || !!opts.noOpen;
    this.debug = !!opts.debug;
    this.relax = !!opts.relax;

    // Strategy knobs
    this.allowShadowOnly = !!opts.shadow || !!opts.allowShadowOnly;
    this.moduleFilter = opts.modules
      ? new Set((Array.isArray(opts.modules) ? opts.modules : String(opts.modules).split(',')).map(s => s.trim()))
      : null;
    this.moduleExclude = opts['exclude-modules'] || opts.excludeModules
      ? new Set((Array.isArray(opts['exclude-modules'] || opts.excludeModules)
          ? (opts['exclude-modules'] || opts.excludeModules)
          : String(opts['exclude-modules'] || opts.excludeModules).split(',')).map(s => s.trim()))
      : null;
    this.rrMult = opts['rr-mult'] !== undefined ? parseFloat(opts['rr-mult']) : (opts.rrMult ?? 1.0);
    this.slMult = opts['sl-mult'] !== undefined ? parseFloat(opts['sl-mult']) : (opts.slMult ?? 1.0);
    this.beFraction = opts['no-be'] ? 0 : (opts.beFraction !== undefined ? parseFloat(opts.beFraction) : 0.5);
    this.slippagePct = opts.slippage !== undefined ? parseFloat(opts.slippage) : 0.001; // 0.1%

    // Quality / exit knobs
    this.minScore = opts['min-score'] !== undefined ? parseFloat(opts['min-score'])
      : (opts.minScore !== undefined ? parseFloat(opts.minScore) : null);
    // --partial-tp=trigger,size — e.g., 0.5,0.5 = take 50% off at 50% of TP travel
    this.partialTpTrigger = null;
    this.partialTpSize = 0;
    const partialArg = opts['partial-tp'] || opts.partialTp;
    if (partialArg) {
      const [trig, size] = String(partialArg).split(',').map(parseFloat);
      this.partialTpTrigger = Number.isFinite(trig) ? trig : 0.5;
      this.partialTpSize = Number.isFinite(size) ? size : 0.5;
    }
    // --time-stop=Xh — force close after X hours
    this.timeStopHours = opts['time-stop'] !== undefined ? parseFloat(opts['time-stop'])
      : (opts.timeStopHours !== undefined ? parseFloat(opts.timeStopHours) : null);

    // Entry-quality filters (boolean; trader-oriented unless noted)
    this.requireHtfMomentum = !!opts['require-htf-momentum'] || !!opts.requireHtfMomentum;
    this.require5mBullish = !!opts['require-5m-bullish'] || !!opts.require5mBullish;
    this.requirePullback = !!opts['require-pullback'] || !!opts.requirePullback;
    this.requireOversoldReclaim = !!opts['require-oversold-reclaim'] || !!opts.requireOversoldReclaim;
    this.requireVolumeSpike = opts['require-volume-spike'] !== undefined ? parseFloat(opts['require-volume-spike'])
      : (opts.requireVolumeSpike !== undefined ? parseFloat(opts.requireVolumeSpike) : null);
    this.minRs1h = opts['min-rs1h'] !== undefined ? parseFloat(opts['min-rs1h'])
      : (opts.minRs1h !== undefined ? parseFloat(opts.minRs1h) : null);

    // Optional: import a wrapper module's signal filter function (e.g. trader-bot-v14).
    // When set, this filter is applied AFTER all other knobs and can mutate/reject the signal.
    this.customSignalFilter = opts.customSignalFilter || null;

    this.label = opts.label || this.bot;
    this.useCache = opts.useCache !== false;

    // Preloaded data (set by tournament runner to skip fetch)
    this.preloadedData = opts.preloadedData || null;
    this.preloadedRange = opts.preloadedRange || null;
  }

  async loadModule() {
    if (this.bot === 'knife') {
      this.mod = await import('../netlify/functions/knife-catcher.js');
      this.tfs = ['5m', '15m', '1h', '4h'];
    } else {
      this.mod = await import('../netlify/functions/trader-bot.js');
      this.tfs = ['15m', '1h', '4h'];
    }
  }

  async loadSymbols() {
    if (!this.symbols) {
      if (this.useTopUniverse) {
        console.log(`[UNIVERSE] Fetching top ${this.top} USDT pairs by 24h volume...`);
        this.symbols = await getTopUsdtSymbols(this.top);
      } else {
        this.symbols = [...DEFAULT_PAIRS];
        console.log(`[UNIVERSE] Using default pairs (override with --symbols=A,B,C or --top=N)`);
      }
    }
    console.log(`[UNIVERSE] ${this.symbols.join(', ')}`);
  }

  async loadHistoricalData() {
    if (this.preloadedData) {
      this.data = this.preloadedData;
      ({ simStart: this.simStart, simEnd: this.simEnd } = this.preloadedRange);
      return;
    }

    const end = Date.now();
    const warmupMs = 12 * 24 * 60 * 60 * 1000;
    const start = end - this.days * 24 * 60 * 60 * 1000 - warmupMs;
    this.simStart = end - this.days * 24 * 60 * 60 * 1000;
    this.simEnd = end;

    console.log(`[DATA] Range: ${new Date(start).toISOString().slice(0, 10)} → ${new Date(end).toISOString().slice(0, 10)} (incl. ${Math.round(warmupMs / 86400000)}d warmup)`);

    this.data = {};
    for (const sym of [...this.symbols, 'BTCUSDT']) {
      this.data[sym] = {};
      for (const tf of this.tfs) {
        process.stdout.write(`  ${sym} ${tf}... `);
        this.data[sym][tf] = await getKlinesPaged(sym, tf, start, end, { useCache: this.useCache });
        console.log(`${this.data[sym][tf].length} candles`);
      }
    }
  }

  async runSymbol(symbol) {
    const D = this.data[symbol];
    const BTC = this.data['BTCUSDT'];
    if (!D || !D['15m']?.length) return { trades: [], rejections: {}, stages: {}, modules: {} };
    const main15m = D['15m'];

    let i0 = main15m.findIndex(c => c.time >= this.simStart);
    if (i0 === -1) i0 = Math.max(200, Math.floor(main15m.length * 0.3));
    i0 = Math.max(120, i0);

    const trades = [];
    let position = null;
    const analysisState = { rejectCounts: {}, stageCounts: {}, moduleCandidates: {}, relaxedMode: this.relax, debug: this.debug };

    const idx = {};
    for (const tf of this.tfs) idx[tf] = 0;
    const btcIdx = { '1h': 0, '4h': 0, '15m': 0 };

    for (let i = i0; i < main15m.length; i++) {
      const candle = main15m[i];
      const t = candle.time;

      if (position) {
        // Partial TP: take fraction of position off when price reaches the partial trigger.
        if (this.partialTpTrigger && !position.partialTaken) {
          const partialPrice = position.entry + (position.tp - position.entry) * this.partialTpTrigger;
          if (candle.high >= partialPrice) {
            // Record the partial exit as a separate trade row, scaled by partialTpSize.
            this.closePartial(trades, position, partialPrice, t, this.partialTpSize);
            position.partialTaken = true;
            // Move SL to entry after partial — let the runner go free.
            position.sl = Math.max(position.sl, position.entry);
          }
        }

        // Time-stop: force close after N hours if still open.
        if (this.timeStopHours && (t - position.openTime) >= this.timeStopHours * 3600 * 1000) {
          this.closePosition(trades, position, candle.close, t, 'TIME_STOP');
          position = null;
        }
      }
      if (position) {
        const hitTp = candle.high >= position.tp;
        const hitSl = candle.low <= position.sl;
        if (hitTp && hitSl) {
          this.closePosition(trades, position, position.sl, t, 'STOP_LOSS_AMBIGUOUS');
          position = null;
        } else if (hitTp) {
          this.closePosition(trades, position, position.tp, t, 'TAKE_PROFIT');
          position = null;
        } else if (hitSl) {
          this.closePosition(trades, position, position.sl, t, position.beActive ? 'BREAKEVEN' : 'STOP_LOSS');
          position = null;
        } else if (this.beFraction > 0 && !position.beActive) {
          const tpDist = position.tp - position.entry;
          const traveled = candle.high - position.entry;
          if (tpDist > 0 && traveled >= tpDist * this.beFraction) {
            position.sl = position.entry;
            position.beActive = true;
          }
        }
      }

      if (position) continue;

      for (const tf of this.tfs) idx[tf] = sliceUpTo(D[tf], t, idx[tf]);
      btcIdx['1h'] = sliceUpTo(BTC['1h'], t, btcIdx['1h']);
      btcIdx['4h'] = sliceUpTo(BTC['4h'], t, btcIdx['4h']);
      btcIdx['15m'] = sliceUpTo(BTC['15m'], t, btcIdx['15m']);

      const slice = tf => D[tf].slice(0, idx[tf]);
      const candles15m = slice('15m');
      const candles1h = slice('1h');
      const candles4h = slice('4h');
      const candles5m = this.bot === 'knife' ? slice('5m') : null;

      if (candles15m.length < 100 || candles1h.length < 50 || candles4h.length < 30) continue;
      if (this.bot === 'knife' && candles5m.length < 100) continue;

      const ticker24h = buildTicker24h(candles15m);
      const orderBook = buildOrderBook(candle.close, ticker24h);

      const btc15m = BTC['15m'].slice(0, btcIdx['15m']);
      const btcTicker24h = buildTicker24h(btc15m);
      const btcContext = detectBTCContext(
        BTC['4h'].slice(0, btcIdx['4h']),
        BTC['1h'].slice(0, btcIdx['1h']),
        btcTicker24h
      );

      let signal = null;
      try {
        if (this.bot === 'knife') {
          signal = this.mod.generateSignal(symbol, candles5m, candles15m, candles1h, candles4h, orderBook, ticker24h, btcContext, analysisState);
        } else {
          signal = this.mod.generateSignal(symbol, candles15m, candles1h, candles4h, orderBook, ticker24h, btcContext, analysisState);
        }
      } catch (e) {
        if (this.debug) console.error(`[ERR] ${symbol} @${new Date(t).toISOString()}: ${e.message}`);
        continue;
      }

      if (!signal) continue;
      if (!this.allowShadowOnly && signal.shadowOnly) continue;
      if (this.moduleFilter && !this.moduleFilter.has(signal.module)) continue;
      if (this.moduleExclude && this.moduleExclude.has(signal.module)) continue;
      if (this.minScore !== null && signal.score < this.minScore) continue;

      // Entry-quality filters — applied post-signal to improve win rate.
      if (this.requireHtfMomentum && !htfMomentumRising(candles1h)) {
        if (this.debug) console.log(`[FILTER] ${symbol} ${new Date(t).toISOString().slice(0,16)} rejected: HTF momentum not rising`);
        continue;
      }
      if (this.require5mBullish && this.bot === 'knife') {
        if (!recent5mBullish(candles5m)) continue;
      } else if (this.require5mBullish && this.bot === 'trader') {
        // Trader doesn't load 5m by default — recompute from 15m direction
        const last3 = candles15m.slice(-3);
        const greens = last3.filter(c => c.close > c.open).length;
        if (greens < 2) continue;
      }
      if (this.requirePullback && !pullbackReclaimedEma9(candles15m)) continue;
      if (this.requireOversoldReclaim && candles5m && !rsiOversoldReclaim(candles5m)) continue;
      if (this.requireVolumeSpike !== null && candles5m && !volumeSpike5m(candles5m, this.requireVolumeSpike)) continue;
      if (this.minRs1h !== null) {
        const rs1h = signal.relativeStrengthSnapshot?.rs1h;
        if (!Number.isFinite(rs1h) || rs1h < this.minRs1h) continue;
      }

      // Optional external wrapper filter (validates that production wrapper produces same result)
      if (this.customSignalFilter) {
        const filtered = this.customSignalFilter(signal, {
          candles5m: this.bot === 'knife' ? candles5m : null,
          candles15m, candles1h, candles4h, btcContext, ticker24h, orderBook
        });
        if (!filtered) continue;
        signal = filtered;
      }

      if (!Number.isFinite(signal.tp) || !Number.isFinite(signal.sl)) continue;
      if (signal.tp <= candle.close || signal.sl >= candle.close) continue;

      // Apply RR/SL overrides centered on entry.
      let tp = signal.tp;
      let sl = signal.sl;
      if (this.slMult !== 1.0) {
        const slDist = candle.close - sl;
        sl = candle.close - slDist * this.slMult;
      }
      if (this.rrMult !== 1.0) {
        const tpDist = tp - candle.close;
        tp = candle.close + tpDist * this.rrMult;
      }

      const entry = candle.close * (1 + this.slippagePct);
      const tpPct = ((tp - entry) / entry) * 100;
      const slPct = ((entry - sl) / entry) * 100;
      if (tpPct <= 0 || slPct <= 0) continue;

      position = {
        symbol,
        entry,
        tp,
        sl,
        tpPct,
        slPct,
        module: signal.module,
        score: signal.score,
        openTime: t,
        beActive: false,
        shadowOnly: !!signal.shadowOnly
      };
      if (this.debug) console.log(`[OPEN] ${symbol} ${new Date(t).toISOString().slice(0, 16)} ${signal.module} entry=${entry.toFixed(4)} tp=${tp.toFixed(4)} sl=${sl.toFixed(4)} (shadow=${signal.shadowOnly})`);
    }

    if (position) {
      const last = main15m[main15m.length - 1];
      this.closePosition(trades, position, last.close, last.time, 'END_OF_BACKTEST');
    }

    return { trades, rejections: analysisState.rejectCounts, stages: analysisState.stageCounts, modules: analysisState.moduleCandidates };
  }

  closePosition(trades, pos, exitPrice, exitTime, reason) {
    // Account for size after partial — what's left of the position scales the pnl impact.
    const remainingFraction = 1 - (pos.partialTaken ? this.partialTpSize : 0);
    const pnlPct = ((exitPrice - pos.entry) / pos.entry) * 100 * remainingFraction;
    trades.push({
      symbol: pos.symbol,
      module: pos.module,
      score: pos.score,
      entry: pos.entry,
      exit: exitPrice,
      tp: pos.tp,
      sl: pos.sl,
      openTime: new Date(pos.openTime).toISOString(),
      closeTime: new Date(exitTime).toISOString(),
      openTimeMs: pos.openTime,
      closeTimeMs: exitTime,
      pnlPct: Number(pnlPct.toFixed(3)),
      sizeFraction: Number(remainingFraction.toFixed(3)),
      reason,
      shadowOnly: pos.shadowOnly
    });
  }

  closePartial(trades, pos, exitPrice, exitTime, sizeFraction) {
    const pnlPct = ((exitPrice - pos.entry) / pos.entry) * 100 * sizeFraction;
    trades.push({
      symbol: pos.symbol,
      module: pos.module,
      score: pos.score,
      entry: pos.entry,
      exit: exitPrice,
      tp: pos.tp,
      sl: pos.sl,
      openTime: new Date(pos.openTime).toISOString(),
      closeTime: new Date(exitTime).toISOString(),
      openTimeMs: pos.openTime,
      closeTimeMs: exitTime,
      pnlPct: Number(pnlPct.toFixed(3)),
      sizeFraction: Number(sizeFraction.toFixed(3)),
      reason: 'PARTIAL_TP',
      shadowOnly: pos.shadowOnly
    });
  }

  computeMetrics(trades, initialBalance) {
    let balance = initialBalance;
    let peak = initialBalance;
    let maxDD = 0;
    const equityCurve = [{ time: this.simStart, equity: balance }];
    const sorted = [...trades].sort((a, b) => a.closeTimeMs - b.closeTimeMs);
    let grossWin = 0, grossLoss = 0, wins = 0, losses = 0;
    let totalDurHrs = 0;
    const byReason = {}, bySymbol = {}, byModule = {};

    for (const t of sorted) {
      const stake = balance * this.allocPct;
      const profit = stake * (t.pnlPct / 100);
      balance += profit;
      if (balance > peak) peak = balance;
      const dd = (peak - balance) / peak * 100;
      if (dd > maxDD) maxDD = dd;
      equityCurve.push({ time: t.closeTimeMs, equity: Number(balance.toFixed(2)) });

      if (profit > 0) { wins++; grossWin += profit; } else { losses++; grossLoss += Math.abs(profit); }
      totalDurHrs += (t.closeTimeMs - t.openTimeMs) / 3600000;
      byReason[t.reason] = (byReason[t.reason] || 0) + 1;
      bySymbol[t.symbol] = bySymbol[t.symbol] || { trades: 0, wins: 0, profit: 0 };
      bySymbol[t.symbol].trades++;
      if (profit > 0) bySymbol[t.symbol].wins++;
      bySymbol[t.symbol].profit += profit;
      byModule[t.module] = byModule[t.module] || { trades: 0, wins: 0 };
      byModule[t.module].trades++;
      if (profit > 0) byModule[t.module].wins++;
    }

    const total = sorted.length;
    const winRate = total ? (wins / total) * 100 : 0;
    const avgWin = wins ? grossWin / wins : 0;
    const avgLoss = losses ? grossLoss / losses : 0;
    const expectancy = total ? (grossWin - grossLoss) / total : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
    const roi = ((balance - initialBalance) / initialBalance) * 100;

    return {
      totalTrades: total,
      wins, losses,
      winRate: Number(winRate.toFixed(2)),
      finalBalance: Number(balance.toFixed(2)),
      totalProfit: Number((balance - initialBalance).toFixed(2)),
      roi: Number(roi.toFixed(2)),
      profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : profitFactor,
      maxDrawdown: Number(maxDD.toFixed(2)),
      avgWin: Number(avgWin.toFixed(2)),
      avgLoss: Number(avgLoss.toFixed(2)),
      expectancy: Number(expectancy.toFixed(2)),
      avgDurationHours: total ? Number((totalDurHrs / total).toFixed(1)) : 0,
      byReason,
      bySymbol,
      byModule,
      equityCurve
    };
  }

  buildReport(allTrades, perSymbolDiagnostics) {
    const splitTime = this.simStart + (this.simEnd - this.simStart) * this.oosSplitRatio;
    const trainTrades = allTrades.filter(t => t.openTimeMs < splitTime);
    const holdoutTrades = allTrades.filter(t => t.openTimeMs >= splitTime);

    const overall = this.computeMetrics(allTrades, this.startBalance);
    const train = this.computeMetrics(trainTrades, this.startBalance);
    const balanceAtSplit = train.finalBalance;
    const holdout = this.computeMetrics(holdoutTrades, balanceAtSplit);

    const rejAgg = {}, stageAgg = {}, modAgg = {};
    for (const d of perSymbolDiagnostics) {
      for (const [k, v] of Object.entries(d.rejections || {})) rejAgg[k] = (rejAgg[k] || 0) + v;
      for (const [k, v] of Object.entries(d.stages || {})) stageAgg[k] = (stageAgg[k] || 0) + v;
      for (const [k, v] of Object.entries(d.modules || {})) modAgg[k] = (modAgg[k] || 0) + v;
    }

    return {
      meta: {
        bot: this.bot,
        botVersion: this.mod.ALGORITHM_VERSION,
        label: this.label,
        symbols: this.symbols,
        days: this.days,
        months: this.months,
        oosSplitRatio: this.oosSplitRatio,
        splitDate: new Date(splitTime).toISOString().slice(0, 10),
        startBalance: this.startBalance,
        allocPct: this.allocPct,
        knobs: {
          allowShadowOnly: this.allowShadowOnly,
          moduleFilter: this.moduleFilter ? [...this.moduleFilter] : null,
          moduleExclude: this.moduleExclude ? [...this.moduleExclude] : null,
          rrMult: this.rrMult,
          slMult: this.slMult,
          beFraction: this.beFraction,
          slippagePct: this.slippagePct,
          minScore: this.minScore,
          partialTpTrigger: this.partialTpTrigger,
          partialTpSize: this.partialTpSize || null,
          timeStopHours: this.timeStopHours,
          requireHtfMomentum: this.requireHtfMomentum,
          require5mBullish: this.require5mBullish,
          requirePullback: this.requirePullback,
          requireOversoldReclaim: this.requireOversoldReclaim,
          requireVolumeSpike: this.requireVolumeSpike,
          minRs1h: this.minRs1h
        },
        generatedAt: new Date().toISOString()
      },
      summary: overall,
      trainSummary: train,
      holdoutSummary: holdout,
      trades: allTrades.sort((a, b) => a.openTimeMs - b.openTimeMs),
      diagnostics: { rejections: rejAgg, stages: stageAgg, moduleCandidates: modAgg }
    };
  }

  oosVerdict(train, holdout) {
    const verdicts = [];
    if (train.totalTrades === 0 && holdout.totalTrades === 0) return ['⚠️ Sin trades en ningún periodo'];
    if (train.profitFactor < 1 || holdout.profitFactor < 1) verdicts.push('🔴 PF<1 en alguna fase → no rentable');
    const degraded = (a, b, pct) => a !== 0 && ((a - b) / Math.abs(a)) * 100 > pct;
    if (degraded(train.profitFactor, holdout.profitFactor, 25)) verdicts.push('🟡 PF cae >25% en holdout → posible overfit');
    if (degraded(train.winRate, holdout.winRate, 15)) verdicts.push('🟡 WR cae >15% relativo en holdout');
    if (holdout.maxDrawdown > train.maxDrawdown * 1.5 && holdout.maxDrawdown > 5) verdicts.push('🟡 Max DD holdout 50%+ peor que train');
    if (!verdicts.length) verdicts.push('✅ Estrategia robusta: métricas consistentes train ↔ holdout');
    return verdicts;
  }

  renderHTML(report) {
    const s = report.summary, tr = report.trainSummary, ho = report.holdoutSummary;
    const verdicts = this.oosVerdict(tr, ho);
    const reasonRows = Object.entries(s.byReason).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    const symRows = Object.entries(s.bySymbol).map(([k, v]) => `<tr><td>${k}</td><td>${v.trades}</td><td>${v.trades ? ((v.wins / v.trades) * 100).toFixed(1) : 0}%</td><td>${v.profit >= 0 ? '+' : ''}${v.profit.toFixed(2)}</td></tr>`).join('');
    const modRows = Object.entries(s.byModule).map(([k, v]) => `<tr><td>${k}</td><td>${v.trades}</td><td>${v.trades ? ((v.wins / v.trades) * 100).toFixed(1) : 0}%</td></tr>`).join('');
    const rejRows = Object.entries(report.diagnostics.rejections).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    const tradeRows = report.trades.slice(-200).map(t => `<tr><td>${t.openTime.slice(0, 16).replace('T', ' ')}</td><td>${t.symbol}</td><td>${t.module || ''}</td><td>${t.reason}</td><td class="${t.pnlPct >= 0 ? 'win' : 'loss'}">${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%</td></tr>`).join('');
    const knobsRow = Object.entries(report.meta.knobs).map(([k, v]) => `<span class="chip"><b>${k}</b>: ${Array.isArray(v) ? v.join(',') : v}</span>`).join('');

    return `<!doctype html><html><head><meta charset="utf-8"><title>Backtest ${report.meta.label} · ${report.meta.botVersion}</title>
<style>
  body{font-family:-apple-system,Inter,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px;line-height:1.5}
  h1{color:#38bdf8;margin:0 0 4px} h2{color:#94a3b8;margin:32px 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:0.08em}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
  .stat{background:#0f172a;border-radius:8px;padding:12px;text-align:center}
  .stat .v{font-size:22px;font-weight:700;color:#38bdf8} .stat .l{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em}
  table{width:100%;border-collapse:collapse;font-size:13px} th,td{padding:8px 10px;border-bottom:1px solid #334155;text-align:left}
  th{background:#0f172a;color:#94a3b8;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:0.06em}
  .win{color:#4ade80} .loss{color:#f87171} .muted{color:#64748b}
  .row{display:flex;gap:16px;flex-wrap:wrap} .row>.col{flex:1;min-width:280px}
  .verdict{font-size:14px;margin:6px 0}
  .chip{display:inline-block;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:4px 8px;margin:2px 4px 2px 0;font-size:11px}
</style></head><body>
<h1>Backtest · ${report.meta.label.toUpperCase()}</h1>
<div class="muted">${report.meta.botVersion} · ${report.meta.symbols.join(', ')} · ${report.meta.days} días · split ${(report.meta.oosSplitRatio * 100).toFixed(0)}/${((1 - report.meta.oosSplitRatio) * 100).toFixed(0)} en ${report.meta.splitDate}</div>
<div style="margin-top:8px">${knobsRow}</div>

<h2>Resumen Global</h2>
<div class="card"><div class="grid">
  <div class="stat"><div class="v">${s.totalTrades}</div><div class="l">Trades</div></div>
  <div class="stat"><div class="v ${s.roi >= 0 ? 'win' : 'loss'}">${s.roi >= 0 ? '+' : ''}${s.roi}%</div><div class="l">ROI</div></div>
  <div class="stat"><div class="v">${s.winRate}%</div><div class="l">Win Rate</div></div>
  <div class="stat"><div class="v">${s.profitFactor}</div><div class="l">Profit Factor</div></div>
  <div class="stat"><div class="v loss">-${s.maxDrawdown}%</div><div class="l">Max DD</div></div>
  <div class="stat"><div class="v">${s.expectancy}</div><div class="l">Expectancy USD</div></div>
  <div class="stat"><div class="v">${s.avgDurationHours}h</div><div class="l">Avg Hold</div></div>
  <div class="stat"><div class="v">${s.finalBalance}</div><div class="l">Final Balance</div></div>
</div></div>

<h2>Validación Out-of-Sample</h2>
<div class="card">
  <table><thead><tr><th>Métrica</th><th>Train</th><th>Holdout</th></tr></thead><tbody>
    <tr><td>Trades</td><td>${tr.totalTrades}</td><td>${ho.totalTrades}</td></tr>
    <tr><td>Win Rate</td><td>${tr.winRate}%</td><td>${ho.winRate}%</td></tr>
    <tr><td>Profit Factor</td><td>${tr.profitFactor}</td><td>${ho.profitFactor}</td></tr>
    <tr><td>ROI</td><td>${tr.roi}%</td><td>${ho.roi}%</td></tr>
    <tr><td>Max DD</td><td>-${tr.maxDrawdown}%</td><td>-${ho.maxDrawdown}%</td></tr>
    <tr><td>Expectancy</td><td>${tr.expectancy}</td><td>${ho.expectancy}</td></tr>
  </tbody></table>
  ${verdicts.map(v => `<div class="verdict">${v}</div>`).join('')}
</div>

<div class="row">
  <div class="col"><h2>Por Símbolo</h2><div class="card"><table><thead><tr><th>Símbolo</th><th>Trades</th><th>WR</th><th>Profit</th></tr></thead><tbody>${symRows || '<tr><td class="muted" colspan="4">Sin datos</td></tr>'}</tbody></table></div></div>
  <div class="col"><h2>Por Módulo</h2><div class="card"><table><thead><tr><th>Módulo</th><th>Trades</th><th>WR</th></tr></thead><tbody>${modRows || '<tr><td class="muted" colspan="3">Sin datos</td></tr>'}</tbody></table></div></div>
</div>

<div class="row">
  <div class="col"><h2>Por Motivo Salida</h2><div class="card"><table><thead><tr><th>Motivo</th><th>Conteo</th></tr></thead><tbody>${reasonRows || '<tr><td class="muted" colspan="2">Sin datos</td></tr>'}</tbody></table></div></div>
  <div class="col"><h2>Top Rechazos</h2><div class="card"><table><thead><tr><th>Código</th><th>Conteo</th></tr></thead><tbody>${rejRows || '<tr><td class="muted" colspan="2">Sin datos</td></tr>'}</tbody></table></div></div>
</div>

<h2>Últimos ${Math.min(200, report.trades.length)} Trades</h2>
<div class="card"><table><thead><tr><th>Apertura</th><th>Símbolo</th><th>Módulo</th><th>Cierre</th><th>PnL</th></tr></thead><tbody>${tradeRows || '<tr><td class="muted" colspan="5">Sin trades</td></tr>'}</tbody></table></div>

</body></html>`;
  }

  printConsole(report) {
    const s = report.summary, tr = report.trainSummary, ho = report.holdoutSummary;
    const c = (n, color) => `\x1b[${color}m${n}\x1b[0m`;
    const roiC = s.roi >= 0 ? 32 : 31;
    console.log('\n════════════════════════════════════════════════════════');
    console.log(`  BACKTEST ${this.label.toUpperCase()} · ${report.meta.botVersion}`);
    console.log('════════════════════════════════════════════════════════');
    console.log(`  Símbolos:        ${report.meta.symbols.join(', ')}`);
    console.log(`  Periodo:         ${report.meta.days} días`);
    console.log(`  Modules filter:  ${report.meta.knobs.moduleFilter ? report.meta.knobs.moduleFilter.join(',') : '(all live)'}`);
    console.log(`  Shadow allowed:  ${report.meta.knobs.allowShadowOnly}`);
    console.log(`  rrMult/slMult:   ${report.meta.knobs.rrMult} / ${report.meta.knobs.slMult}`);
    console.log(`  ROI:             ${c((s.roi >= 0 ? '+' : '') + s.roi + '%', roiC)}`);
    console.log(`  Trades:          ${s.totalTrades} (${s.wins}W / ${s.losses}L)`);
    console.log(`  Win Rate:        ${s.winRate}%`);
    console.log(`  Profit Factor:   ${s.profitFactor}`);
    console.log(`  Max Drawdown:    -${s.maxDrawdown}%`);
    console.log(`  Expectancy:      ${s.expectancy} USD/trade`);
    console.log('────────────────────────────────────────────────────────');
    console.log(`  OOS (split ${report.meta.splitDate}): train WR=${tr.winRate}% PF=${tr.profitFactor} | holdout WR=${ho.winRate}% PF=${ho.profitFactor}`);
    for (const v of this.oosVerdict(tr, ho)) console.log(`    ${v}`);
    console.log('════════════════════════════════════════════════════════');
  }

  async run() {
    await this.loadModule();
    await this.loadSymbols();
    await this.loadHistoricalData();

    const allTrades = [];
    const diagnostics = [];
    for (const sym of this.symbols) {
      const res = await this.runSymbol(sym);
      allTrades.push(...res.trades);
      diagnostics.push(res);
    }

    const report = this.buildReport(allTrades, diagnostics);
    this.printConsole(report);

    const reportDir = path.join(__dirname, '..', 'backtests');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    // Single stable filename per bot — overwritten on each run.
    const jsonPath = path.join(reportDir, `${this.bot}-backtest.json`);
    const htmlPath = path.join(reportDir, `${this.bot}-backtest.html`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(htmlPath, this.renderHTML(report));
    console.log(`\n[EXPORT] ${jsonPath}`);
    console.log(`[EXPORT] ${htmlPath}`);

    if (process.platform === 'darwin' && !this.noOpen) {
      exec(`open "${htmlPath}"`);
    }
    return report;
  }
}

// Run as CLI when invoked directly
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const opts = parseArgs();
  new Backtester(opts).run().catch(err => {
    console.error('\n[FATAL]', err);
    process.exit(1);
  });
}
