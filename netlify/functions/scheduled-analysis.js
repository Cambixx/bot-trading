/**
 * Netlify Scheduled Function - Advanced Day Trading Analysis
 * Optimized for SPOT DAY TRADING with multi-timeframe confluence
 * Uses MEXC Public API for OHLCV + Order Book metrics
 * 
 * Key Features:
 * - Multi-timeframe analysis (15m + 1h confluence)
 * - Stochastic RSI, ADX, SuperTrend for momentum
 * - Price action patterns detection
 * - Enhanced order flow scoring
 */

import { schedule } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

console.log('--- DAY TRADE Analysis Module Loaded ---');

// Environment Configuration - Optimized for Day Trading
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 65;
const MAX_SPREAD_BPS = process.env.MAX_SPREAD_BPS ? Number(process.env.MAX_SPREAD_BPS) : 8;
const MIN_DEPTH_QUOTE = process.env.MIN_DEPTH_QUOTE ? Number(process.env.MIN_DEPTH_QUOTE) : 75000;
const MIN_ATR_PCT = process.env.MIN_ATR_PCT ? Number(process.env.MIN_ATR_PCT) : 0.08;
const MAX_ATR_PCT = process.env.MAX_ATR_PCT ? Number(process.env.MAX_ATR_PCT) : 8;
const QUOTE_ASSET = (process.env.QUOTE_ASSET || 'USDT').toUpperCase();
const MAX_SYMBOLS = process.env.MAX_SYMBOLS ? Number(process.env.MAX_SYMBOLS) : 50; // REDUCED: Better quality over quantity
const MIN_QUOTE_VOL_24H = process.env.MIN_QUOTE_VOL_24H ? Number(process.env.MIN_QUOTE_VOL_24H) : 3000000;
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || '';
const ALERT_COOLDOWN_MIN = process.env.ALERT_COOLDOWN_MIN ? Number(process.env.ALERT_COOLDOWN_MIN) : 240; // INCREASED: 4 hours to avoid overtrading
const USE_MULTI_TF = (process.env.USE_MULTI_TF || 'true').toLowerCase() === 'true';
const AVOID_ASIA_SESSION = (process.env.AVOID_ASIA_SESSION || 'true').toLowerCase() === 'true'; // NEW: Avoid low liquidity sessions

// Persistent cooldown storage using Netlify Blobs
export const COOLDOWN_STORE_KEY = 'signal-cooldowns';
const COOLDOWN_EXPIRY_HOURS = 24;

// const lastNotifiedAtByKey = new Map(); // Replaced by Blobs

const MEXC_API = 'https://api.mexc.com/api/v3';

// ==================== PERFORMANCE OPTIMIZATION: CACHING ====================
// Simple in-memory cache for candles (reduces API calls)
const candleCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

function getCachedCandles(key) {
  const cached = candleCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    candleCache.delete(key);
    return null;
  }
  return cached.data;
}

function setCachedCandles(key, data) {
  candleCache.set(key, { data, timestamp: Date.now() });
}

// Sector classification for correlation analysis
const SECTOR_MAP = {
  'BTC': 'BLUE_CHIP', 'ETH': 'BLUE_CHIP', 'BNB': 'BLUE_CHIP', 'XRP': 'BLUE_CHIP',
  'SOL': 'L1', 'AVAX': 'L1', 'ADA': 'L1', 'DOT': 'L1', 'NEAR': 'L1', 'ATOM': 'L1',
  'DOGE': 'MEME', 'SHIB': 'MEME', 'PEPE': 'MEME', 'FLOKI': 'MEME',
  'LINK': 'DEFI', 'UNI': 'DEFI', 'AAVE': 'DEFI', 'COMP': 'DEFI', 'MKR': 'DEFI',
  'MATIC': 'L2', 'ARB': 'L2', 'OP': 'L2', 'STRK': 'L2',
  'RENDER': 'AI', 'FET': 'AI', 'AGIX': 'AI', 'WLD': 'AI'
};

function getSector(symbol) {
  const base = symbol.replace(QUOTE_ASSET, '');
  return SECTOR_MAP[base] || 'OTHER';
}

// NEW: Session filter - avoid low liquidity periods
function isTradingAllowed() {
  if (!AVOID_ASIA_SESSION) return true;

  // Use UTC time for session checking
  const now = new Date();
  const utcHour = now.getUTCHours();

  // Asia session: 00:00 - 08:00 UTC (roughly)
  // London session: 08:00 - 16:00 UTC
  // NY session: 14:00 - 22:00 UTC
  // Best liquidity: 08:00 - 22:00 UTC (London + NY overlap)

  if (utcHour >= 0 && utcHour < 7) {
    console.log(`[SESSION] Asia session detected (${utcHour}:00 UTC) - trading restricted`);
    return false;
  }

  return true;
}

const FALLBACK_SYMBOLS = [
  `BTC${QUOTE_ASSET}`,
  `ETH${QUOTE_ASSET}`,
  `SOL${QUOTE_ASSET}`,
  `BNB${QUOTE_ASSET}`,
  `XRP${QUOTE_ASSET}`,
  `DOGE${QUOTE_ASSET}`
];

// ==================== HELPERS ====================

function escapeMarkdownV2(text = '') {
  if (typeof text !== 'string') text = String(text);
  // Escape ALL reserved MarkdownV2 characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // Note: We need to escape parentheses \(\) in the regex pattern
  return text.replace(/([_*\u005B\u005D()~`>#+=|{}.!-])/g, '\\$1');
}

async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function intervalToMs(interval) {
  if (typeof interval !== 'string' || interval.length < 2) return null;
  const match = interval.trim().match(/^(\d+)\s*([mhd])$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return null;

  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  return null;
}

function getClosedCandles(candles, interval, now = Date.now()) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const intervalMs = intervalToMs(interval);

  if (candles.length === 1) {
    const only = candles[0];
    const closeTime = Number.isFinite(only?.closeTime)
      ? only.closeTime
      : (Number.isFinite(intervalMs) && Number.isFinite(only?.time) ? (only.time + intervalMs) : null);
    if (!Number.isFinite(closeTime)) return [];
    const toleranceMs = 2000;
    return now < (closeTime - toleranceMs) ? [] : candles;
  }

  const last = candles[candles.length - 1];
  const lastCloseTime = Number.isFinite(last?.closeTime)
    ? last.closeTime
    : (Number.isFinite(intervalMs) && Number.isFinite(last?.time) ? (last.time + intervalMs) : null);

  if (!Number.isFinite(lastCloseTime)) return candles.slice(0, -1);

  const toleranceMs = 2000;
  if (now < (lastCloseTime - toleranceMs)) return candles.slice(0, -1);

  return candles;
}

export function getInternalStore(context) {
  const options = { name: 'trading-signals' };

  // Try to get Site ID from context or environment
  const siteID = context?.site?.id || context?.siteID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  // Try to get Token from context or environment
  const token = context?.token || process.env.NETLIFY_AUTH_TOKEN;

  if (siteID) options.siteID = siteID;
  if (token) options.token = token;

  return getStore(options);
}

export async function loadCooldowns(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(COOLDOWN_STORE_KEY, { type: 'json' });
    if (!data) return {};

    // Cleanup expired
    const now = Date.now();
    const fresh = {};
    const expiryMs = COOLDOWN_EXPIRY_HOURS * 3600 * 1000;
    for (const [k, ts] of Object.entries(data)) {
      // Logic for backward compatibility with old keys
      if (Number(ts) && (now - Number(ts) < expiryMs)) fresh[k] = ts;
    }
    return fresh;
  } catch (e) {
    console.error('Error loading cooldowns:', e.message);
    return {};
  }
}

// ==================== EXECUTION LOCKING ====================
const RUN_LOCK_KEY = 'global-run-lock';

async function acquireRunLock(context) {
  try {
    const store = getInternalStore(context);
    const lock = await store.get(RUN_LOCK_KEY, { type: 'json' });
    const now = Date.now();

    // If lock is less than 3 minutes old, it's considered active
    if (lock && (now - lock.timestamp < 3 * 60000)) {
      console.warn(`[LOCK] Analysis already in progress (started ${((now - lock.timestamp) / 1000).toFixed(0)}s ago). Aborting.`);
      return false;
    }

    await store.setJSON(RUN_LOCK_KEY, { timestamp: now, id: `run-${now}` });
    return true;
  } catch (error) {
    console.error('[LOCK] Error acquiring lock:', error.message);
    return true; // Proceed anyway on error as fail-safe
  }
}

async function releaseRunLock(context) {
  try {
    const store = getInternalStore(context);
    await store.delete(RUN_LOCK_KEY);
  } catch (error) {
    console.error('[LOCK] Error releasing lock:', error.message);
  }
}

export async function saveCooldowns(cooldowns, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(COOLDOWN_STORE_KEY, cooldowns);
  } catch (e) {
    console.error('Error saving cooldowns:', e.message);
  }
}

// ==================== SIGNAL HISTORY & BACKTESTING ====================

export const HISTORY_STORE_KEY = 'signal-history-v2';

async function recordSignalHistory(signal, context) {
  try {
    const store = getInternalStore(context);
    const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];

    // === ENHANCED: Record more metrics for post-analysis ===
    const record = {
      id: `${Date.now()}-${signal.symbol}`,
      symbol: signal.symbol,
      price: signal.price,
      tp: signal.tp,
      sl: signal.sl,
      type: signal.type,
      time: Date.now(),
      status: 'OPEN',
      score: signal.score,
      regime: signal.regime,
      hasMSS: !!signal.hasMSS,
      hasSweep: !!signal.hasSweep,
      btcRisk: signal.btcContext?.status || 'UNKNOWN',

      // Enhanced metrics for analysis
      entryMetrics: signal.entryMetrics || null,
      categoryScores: signal.categoryScores || null,
      volumeRatio: signal.volumeRatio || null,
      strongCategories: signal.strongCategories || null,
      reasons: signal.reasons || []
    };

    history.push(record);
    await store.setJSON(HISTORY_STORE_KEY, history.slice(-200)); // Last 200 signals
  } catch (error) {
    console.error('Error recording history:', error.message);
  }
}

async function updateSignalHistory(tickers, context) {
  if (!tickers || !tickers.length) return { open: 0, wins: 0, losses: 0 };

  try {
    const store = getInternalStore(context);
    let history = await store.get(HISTORY_STORE_KEY, { type: 'json' });
    if (!history || !history.length) return { open: 0, wins: 0, losses: 0 };

    const prices = new Map(tickers.map(t => [t.symbol, Number(t.lastPrice)]));
    let updated = false;

    for (const item of history) {
      if (item.status === 'OPEN') {
        const currentPrice = prices.get(item.symbol);
        if (!currentPrice) continue;

        // Initialize maxFavorable if not present
        const entryPrice = item.price || item.entry; // [FIX] Backward compatibility
        if (item.maxFavorable === undefined) item.maxFavorable = entryPrice;

        if (item.type === 'BUY') {
          // Update Max Favorable Excursion
          if (currentPrice > item.maxFavorable) item.maxFavorable = currentPrice;

          // Check for Break Even Trigger (0.8:1 R:R reached - more conservative)
          // Risk = Entry - SL. If price moves Entry + (Risk * 0.8), set BE.
          // This protects capital earlier - key for improving win rate
          const risk = entryPrice - item.sl;
          const beTrigger = entryPrice + (risk * 0.8); // 0.8:1 instead of 1:1
          if (!item.breakeven && currentPrice >= beTrigger) {
            item.breakeven = true;
            updated = true;
          }

          if (currentPrice >= item.tp) { item.status = 'CLOSED'; item.outcome = 'WIN'; updated = true; }
          else if (currentPrice <= item.sl) {
            // If we hit SL but had moved to BE, it's a BE outcome (simulated)
            // Or if price hit entry after being at BE
            item.status = 'CLOSED';
            item.outcome = item.breakeven ? 'BREAK_EVEN' : 'LOSS';
            updated = true;
          }
          // Virtual BE hit (price returned to entry after 1:1)
          else if (item.breakeven && currentPrice <= entryPrice) {
            item.status = 'CLOSED';
            item.outcome = 'BREAK_EVEN';
            updated = true;
          }

        } else {
          // SELL LOGIC
          if (currentPrice < item.maxFavorable) item.maxFavorable = currentPrice;

          const risk = item.sl - entryPrice;
          const beTrigger = entryPrice - (risk * 0.8); // 0.8:1 instead of 1:1
          if (!item.breakeven && currentPrice <= beTrigger) {
            item.breakeven = true;
            updated = true;
          }

          if (currentPrice <= item.tp) { item.status = 'CLOSED'; item.outcome = 'WIN'; updated = true; }
          else if (currentPrice >= item.sl) {
            item.status = 'CLOSED';
            item.outcome = item.breakeven ? 'BREAK_EVEN' : 'LOSS';
            updated = true;
          }
          else if (item.breakeven && currentPrice >= entryPrice) {
            item.status = 'CLOSED';
            item.outcome = 'BREAK_EVEN';
            updated = true;
          }
        }

        // AUDIT v3.0: Early exit if no favorable movement after 12 hours
        // Historical data: 50% of LOSS trades never moved in favorable direction
        const hoursOpen = (Date.now() - item.time) / 3600000;
        const favorableMove = item.type === 'BUY'
          ? (item.maxFavorable - entryPrice) / entryPrice
          : (entryPrice - item.maxFavorable) / entryPrice;

        if (item.status === 'OPEN' && hoursOpen > 12 && favorableMove < 0.003) {
          item.status = 'CLOSED';
          item.outcome = 'STALE_EXIT';
          updated = true;
          console.log(`[STALE_EXIT] ${item.symbol}: ${hoursOpen.toFixed(1)}h open, favorable move only ${(favorableMove * 100).toFixed(2)}%`);
        }
        // Auto-expire after 48 hours
        else if (item.status === 'OPEN' && Date.now() - item.time > 48 * 3600 * 1000) {
          item.status = 'EXPIRED';
          updated = true;
        }
      }
    }

    if (updated) await store.setJSON(HISTORY_STORE_KEY, history);

    const closed = history.filter(h => h.status === 'CLOSED');
    // Win Rate Calculation considering BE as neutral (excludes from denominator or counts as 0.5?)
    // Standard approach: BE doesn't count as Loss, but not a Win either. 
    // Win Rate = Wins / (Wins + Losses). BE excluded.
    const wins = closed.filter(h => h.outcome === 'WIN').length;
    const losses = closed.filter(h => h.outcome === 'LOSS' || h.outcome === 'STALE_EXIT').length;
    const bes = closed.filter(h => h.outcome === 'BREAK_EVEN').length;
    const staleExits = closed.filter(h => h.outcome === 'STALE_EXIT').length;

    const totalDecisive = wins + losses;
    const winRate = totalDecisive > 0 ? (wins / totalDecisive * 100).toFixed(1) : 0;
    const openSignals = history.filter(h => h.status === 'OPEN');

    return {
      stats: {
        open: openSignals.length,
        wins,
        losses,
        bes,
        staleExits,
        winRate
      },
      openSymbols: openSignals.map(s => s.symbol)
    };
  } catch (error) {
    console.error('Error updating history:', error.message);
    return { stats: { open: 0, wins: 0, losses: 0, winRate: 0 }, openSymbols: [] };
  }
}

// ==================== MARKET DATA ====================

async function getKlines(symbol, interval = '15m', limit = 200) {
  const cacheKey = `${symbol}-${interval}-${limit}`;
  const cached = getCachedCandles(cacheKey);
  if (cached) {
    console.log(`[CACHE] Hit for ${cacheKey}`);
    return cached;
  }

  const url = `${MEXC_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'No body');
    throw new Error(`MEXC HTTP error: ${response.status} - ${errorBody}`);
  }

  const json = await response.json();
  if (!Array.isArray(json)) {
    throw new Error(`MEXC: Invalid klines response for ${symbol}`);
  }

  const intervalMs = intervalToMs(interval);

  const candles = json.map(candle => {
    const openTime = Number(candle[0]);
    const closeTimeRaw = candle[6] ? Number(candle[6]) : null;
    const closeTime = Number.isFinite(closeTimeRaw) && Number.isFinite(openTime) && Number.isFinite(intervalMs)
      ? (closeTimeRaw >= openTime && closeTimeRaw <= (openTime + intervalMs * 2) ? closeTimeRaw : null)
      : (Number.isFinite(closeTimeRaw) ? closeTimeRaw : null);

    return {
      time: openTime,
      open: Number(candle[1]),
      high: Number(candle[2]),
      low: Number(candle[3]),
      close: Number(candle[4]),
      volume: Number(candle[5]),
      closeTime,
      quoteVolume: Number(candle[7]),
      trades: candle[8] ? Number(candle[8]) : 0,
      takerBuyBaseVolume: candle[9] ? Number(candle[9]) : null,
      takerBuyQuoteVolume: candle[10] ? Number(candle[10]) : null
    };
  }).filter(c => validateCandle(c));

  // Cache the result
  setCachedCandles(cacheKey, candles);
  return candles;
}

function validateCandle(candle) {
  return (
    Number.isFinite(candle.open) && candle.open > 0 &&
    Number.isFinite(candle.high) && candle.high > 0 &&
    Number.isFinite(candle.low) && candle.low > 0 &&
    Number.isFinite(candle.close) && candle.close > 0 &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close &&
    Number.isFinite(candle.volume) && candle.volume >= 0
  );
}

async function getOrderBookDepth(symbol, limit = 20) {
  const url = `${MEXC_API}/depth?symbol=${symbol}&limit=${limit}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) return null;

  const json = await response.json();
  if (!json || !Array.isArray(json.bids) || !Array.isArray(json.asks)) return null;

  return {
    bids: json.bids.map(([p, q]) => [Number(p), Number(q)]),
    asks: json.asks.map(([p, q]) => [Number(p), Number(q)])
  };
}

async function getAllTickers24h() {
  const url = `${MEXC_API}/ticker/24hr`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'No body');
    throw new Error(`MEXC HTTP error: ${response.status} - ${errorBody}`);
  }
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error('MEXC: Invalid ticker/24hr response');
  return json;
}

function getTopSymbolsByOpportunity(tickers, quoteAsset, limit, minQuoteVolume) {
  const stableBases = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI', 'EUR', 'GBP']);

  const candidates = tickers
    .filter(t => typeof t.symbol === 'string' && t.symbol.endsWith(quoteAsset))
    .filter(t => {
      const base = t.symbol.slice(0, -quoteAsset.length);
      if (!base || stableBases.has(base)) return false;
      if (base.endsWith('UP') || base.endsWith('DOWN') || base.endsWith('BULL') || base.endsWith('BEAR')) return false;

      const quoteVol = Number(t.quoteVolume);
      return Number.isFinite(quoteVol) && quoteVol >= minQuoteVolume;
    })
    .map(t => {
      const high = Number(t.highPrice || 0);
      const low = Number(t.lowPrice || 0);
      const volume = Number(t.quoteVolume || 0);

      const volatility = low > 0 ? ((high - low) / low) * 100 : 0;
      const priceChange = Number(t.priceChangePercent || 0);

      const opportunityScore = (Math.log10(volume) * 0.3) + (volatility * 0.5) + (Math.abs(priceChange) * 0.2);

      return { symbol: t.symbol, opportunityScore, volatility, priceChange };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, limit);

  console.log(`Smart Selection: Top ${candidates.length} coins selected based on Opportunity Score.`);
  return candidates.map(t => t.symbol);
}

// ==================== TECHNICAL INDICATORS ====================

function calculateRSISeries(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;

  const series = new Array(closes.length).fill(null);

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain += change > 0 ? change : 0;
    avgLoss += change < 0 ? -change : 0;
  }

  avgGain /= period;
  avgLoss /= period;

  const firstRSI = avgLoss === 0 ? 100 : (100 - (100 / (1 + (avgGain / avgLoss))));
  series[period] = firstRSI;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    const rsi = avgLoss === 0 ? 100 : (100 - (100 / (1 + (avgGain / avgLoss))));
    series[i] = rsi;
  }

  return series;
}

function calculateRSI(closes, period = 14) {
  const series = calculateRSISeries(closes, period);
  if (!series) return null;

  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (Number.isFinite(v)) return v;
  }

  return null;
}

function calculateEMA(data, period) {
  if (data.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateEMASeries(data, period) {
  if (!Array.isArray(data) || data.length === 0) return null;
  if (data.length < period) return null;

  const multiplier = 2 / (period + 1);
  const result = new Array(data.length).fill(null);

  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
    result[i] = ema;
  }

  return result;
}

// NEW: Calculate EMA slope for trend strength
function calculateEMASlope(closes, period = 50) {
  const emaSeries = calculateEMASeries(closes, period);
  if (!emaSeries || emaSeries.length < period + 10) return null;

  const validEmas = emaSeries.filter(v => v !== null);
  if (validEmas.length < 10) return null;

  const recent = validEmas.slice(-10);
  const slope = (recent[recent.length - 1] - recent[0]) / recent[0];
  return slope;
}

function calculateMACD(closes) {
  const ema12Series = calculateEMASeries(closes, 12);
  const ema26Series = calculateEMASeries(closes, 26);
  if (!ema12Series || !ema26Series) return null;

  const macdSeries = closes.map((_, idx) => {
    const e12 = ema12Series[idx];
    const e26 = ema26Series[idx];
    if (e12 === null || e26 === null) return null;
    return e12 - e26;
  });

  const macdValues = macdSeries.filter(v => v !== null);
  if (macdValues.length < 9) return null;

  const signalSeriesCompact = calculateEMASeries(macdValues, 9);
  if (!signalSeriesCompact) return null;
  const signal = signalSeriesCompact[signalSeriesCompact.length - 1];
  const macd = macdValues[macdValues.length - 1];
  if (!Number.isFinite(macd) || !Number.isFinite(signal)) return null;

  const histogram = macd - signal;

  return {
    macd,
    signal,
    histogram,
    bullish: histogram > 0
  };
}

function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
  const sd = Math.sqrt(variance);

  return {
    upper: mean + (stdDev * sd),
    middle: mean,
    lower: mean - (stdDev * sd)
  };
}

function calculateATR(candles, period = 14) {
  const series = calculateATRSeries(candles, period);
  if (!series) return null;

  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (Number.isFinite(v)) return v;
  }

  return null;
}

function calculateVolumeSMA(candles, period = 20) {
  if (candles.length < period) return null;
  const volumes = candles.slice(-period).map(c => c.volume);
  return volumes.reduce((a, b) => a + b, 0) / period;
}

function calculateVWAP(candles, lookback = 50) {
  if (!candles || candles.length < Math.min(lookback, 5)) return null;

  const slice = candles.slice(-lookback);
  let pv = 0;
  let v = 0;
  for (const c of slice) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    v += c.volume;
  }
  if (v === 0) return null;
  return pv / v;
}

function calculateStochasticRSI(closes, rsiPeriod = 14, stochasticPeriod = 14, smoothK = 3, smoothD = 3) {
  if (closes.length < rsiPeriod + stochasticPeriod) return null;

  const rsiSeries = calculateRSISeries(closes, rsiPeriod);
  if (!rsiSeries) return null;

  const rsiWindow = [];
  for (let i = rsiSeries.length - 1; i >= 0 && rsiWindow.length < stochasticPeriod; i--) {
    const v = rsiSeries[i];
    if (Number.isFinite(v)) rsiWindow.unshift(v);
  }

  if (rsiWindow.length < stochasticPeriod) return null;

  const lowest = Math.min(...rsiWindow);
  const highest = Math.max(...rsiWindow);
  const currentRSI = rsiWindow[rsiWindow.length - 1];

  if (highest === lowest) return null;

  const rawK = ((currentRSI - lowest) / (highest - lowest)) * 100;

  return {
    k: rawK,
    d: rawK,
    oversold: rawK < 20,
    overbought: rawK > 80
  };
}

function calculateADX(candles, period = 14) {
  if (!candles || candles.length < (period * 2 + 1)) return null;

  let trSum = 0;
  let plusDMSum = 0;
  let minusDMSum = 0;

  for (let i = 1; i <= period; i++) {
    const current = candles[i];
    const prev = candles[i - 1];

    const upMove = current.high - prev.high;
    const downMove = prev.low - current.low;

    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );

    trSum += tr;
    plusDMSum += plusDM;
    minusDMSum += minusDM;
  }

  let atr = trSum;
  let plusDM14 = plusDMSum;
  let minusDM14 = minusDMSum;

  const dxSeries = new Array(candles.length).fill(null);

  for (let i = period; i < candles.length; i++) {
    if (i > period) {
      const current = candles[i];
      const prev = candles[i - 1];

      const upMove = current.high - prev.high;
      const downMove = prev.low - current.low;

      const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
      const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prev.close),
        Math.abs(current.low - prev.close)
      );

      atr = atr - (atr / period) + tr;
      plusDM14 = plusDM14 - (plusDM14 / period) + plusDM;
      minusDM14 = minusDM14 - (minusDM14 / period) + minusDM;
    }

    if (!Number.isFinite(atr) || atr <= 0) continue;

    const plusDI = (plusDM14 / atr) * 100;
    const minusDI = (minusDM14 / atr) * 100;
    const denom = plusDI + minusDI;
    if (!Number.isFinite(denom) || denom === 0) continue;

    const dx = (Math.abs(plusDI - minusDI) / denom) * 100;
    if (!Number.isFinite(dx)) continue;
    dxSeries[i] = dx;
  }

  let adx = null;
  const firstADXIndex = period * 2;
  let dxSum = 0;
  for (let i = period; i < firstADXIndex; i++) {
    const dx = dxSeries[i];
    if (!Number.isFinite(dx)) return null;
    dxSum += dx;
  }
  adx = dxSum / period;

  for (let i = firstADXIndex; i < candles.length; i++) {
    const dx = dxSeries[i];
    if (!Number.isFinite(dx) || adx === null) continue;
    adx = ((adx * (period - 1)) + dx) / period;
  }

  if (adx === null || !Number.isFinite(adx)) return null;

  if (!Number.isFinite(atr) || atr <= 0) return null;
  const plusDI = (plusDM14 / atr) * 100;
  const minusDI = (minusDM14 / atr) * 100;
  if (!Number.isFinite(plusDI) || !Number.isFinite(minusDI)) return null;

  return {
    adx,
    plusDI,
    minusDI,
    trending: adx > 20,
    bullishTrend: plusDI > minusDI,
    bearishTrend: minusDI > plusDI
  };
}

function calculateCMF(candles, period = 20) {
  if (!candles || candles.length < period) return null;

  const series = [];
  let adSum = 0;

  // Calculate Money Flow Multiplier and Volume for each candle
  const moneyFlowVol = candles.map(c => {
    const range = c.high - c.low;
    if (range === 0) return 0;

    // MFM = ((Close - Low) - (High - Close)) / (High - Low)
    const mfm = ((c.close - c.low) - (c.high - c.close)) / range;
    return mfm * c.volume;
  });

  // Calculate CMF for the latest candle
  if (moneyFlowVol.length < period) return null;

  let volSum = 0;
  let mfSum = 0;

  // Simple sum for the lookback period
  for (let i = moneyFlowVol.length - period; i < moneyFlowVol.length; i++) {
    mfSum += moneyFlowVol[i];
    volSum += candles[i].volume;
  }

  if (volSum === 0) return 0;
  return mfSum / volSum;
}

function calculateATRSeries(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;

  const atrSeries = new Array(candles.length).fill(null);

  let trSum = 0;
  for (let i = 1; i <= period; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );
    trSum += tr;
  }

  let atr = trSum / period;
  if (!Number.isFinite(atr) || atr === 0) return null;
  atrSeries[period] = atr;

  for (let i = period + 1; i < candles.length; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );
    atr = ((atr * (period - 1)) + tr) / period;
    atrSeries[i] = atr;
  }

  return atrSeries;
}

function calculateSuperTrend(candles, period = 10, multiplier = 3) {
  if (!candles || candles.length < period + 1) return null;

  const atrSeries = calculateATRSeries(candles, period);
  if (!atrSeries) return null;

  let finalUpper = null;
  let finalLower = null;
  let superTrend = null;
  let direction = 1;
  let prevDirection = null;
  let flipped = false;

  for (let i = 0; i < candles.length; i++) {
    const atr = atrSeries[i];
    if (atr === null) continue;

    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUpper = hl2 + (multiplier * atr);
    const basicLower = hl2 - (multiplier * atr);

    if (finalUpper === null || finalLower === null || superTrend === null) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      const close = candles[i].close;
      superTrend = close <= finalUpper ? finalUpper : finalLower;
      direction = superTrend === finalLower ? 1 : -1;
      prevDirection = direction;
      flipped = false;
      continue;
    }

    const prevClose = candles[i - 1].close;
    finalUpper = (basicUpper < finalUpper || prevClose > finalUpper) ? basicUpper : finalUpper;
    finalLower = (basicLower > finalLower || prevClose < finalLower) ? basicLower : finalLower;

    const close = candles[i].close;
    if (superTrend === finalUpper) {
      superTrend = close <= finalUpper ? finalUpper : finalLower;
    } else {
      superTrend = close >= finalLower ? finalLower : finalUpper;
    }

    direction = superTrend === finalLower ? 1 : -1;
    flipped = prevDirection !== null && direction !== prevDirection;
    prevDirection = direction;
  }

  if (superTrend === null || finalUpper === null || finalLower === null) return null;

  return {
    superTrend,
    direction,
    bullish: direction === 1,
    bearish: direction === -1,
    flipped,
    upperBand: finalUpper,
    lowerBand: finalLower
  };
}

function calculateSimpleVolumeProfile(candles, lookback = 200) {
  if (!candles || candles.length < 50) return null;
  const data = candles.slice(-lookback);

  let min = Infinity, max = -Infinity;
  data.forEach(c => {
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  });

  if (min === max) return null;

  const bins = 24;
  const binSize = (max - min) / bins;
  const volumeProfile = new Array(bins).fill(0);

  data.forEach(c => {
    // Distribute volume across bins intersected by candle
    const startBin = Math.floor((c.low - min) / binSize);
    const endBin = Math.floor((c.high - min) / binSize);
    // Simple approach: add full volume to midpoint bin (faster)
    const mid = (c.low + c.high) / 2;
    const binIndex = Math.floor((mid - min) / binSize);
    if (binIndex >= 0 && binIndex < bins) {
      volumeProfile[binIndex] += Number(c.volume);
    }
  });

  let maxVol = 0;
  let pocIndex = 0;
  volumeProfile.forEach((vol, i) => {
    if (vol > maxVol) {
      maxVol = vol;
      pocIndex = i;
    }
  });

  const pocPrice = min + (pocIndex + 0.5) * binSize;
  return { poc: pocPrice, min, max };
}

// ==================== SWING STRUCTURE BANDS (ChartPrime) ====================
// Optimized Helper with State
function calculateSwingStructureBands(candles, lenSwing = 100) {
  if (!candles || candles.length < lenSwing + 50) return null; // Need warmup

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const atrSeries = calculateATRSeries(candles, 200);
  if (!atrSeries || !atrSeries[candles.length - 1]) return null;

  // Pine State Variables
  let lh = 1;
  let ll = 1;
  let dir = 0;

  // History for previous values
  const maHiHistory = new Array(candles.length).fill(0);
  const maLoHistory = new Array(candles.length).fill(0);
  const ubSeries = new Array(candles.length).fill(NaN); // Upper Band Middle
  const lbSeries = new Array(candles.length).fill(NaN); // Lower Band Middle
  const ucSeries = new Array(candles.length).fill(0); // Upper Count
  const lcSeries = new Array(candles.length).fill(0); // Lower Count

  // Helper for Highest/Lowest/SMA over window
  const getHighest = (arr, len, idx) => {
    let max = -Infinity;
    const start = Math.max(0, idx - len + 1);
    for (let k = start; k <= idx; k++) if (arr[k] > max) max = arr[k];
    return max;
  };
  const getLowest = (arr, len, idx) => {
    let min = Infinity;
    const start = Math.max(0, idx - len + 1);
    for (let k = start; k <= idx; k++) if (arr[k] < min) min = arr[k];
    return min;
  };
  const getSma = (arr, len, idx) => {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, idx - len + 1);
    for (let k = start; k <= idx; k++) { sum += arr[k]; count++; }
    return count ? sum / count : 0;
  };

  // Main Loop
  for (let i = 0; i < candles.length; i++) {
    if (i < lenSwing) continue;

    const hiMax = getHighest(highs, lenSwing, i);
    const loMin = getLowest(lows, lenSwing, i);
    const currentHigh = highs[i];
    const currentLow = lows[i];
    const prevHigh = highs[i - 1];
    const prevLow = lows[i - 1];

    // Swing Detection
    const isHiSw = (prevHigh === hiMax) && (currentHigh < hiMax);
    const isLoSw = (prevLow === loMin) && (currentLow > loMin);

    if (currentHigh === hiMax) dir = 1;
    if (currentLow === loMin) dir = -1;

    if (isLoSw) ll = 1;
    if (isHiSw) lh = 1;

    // Increment (Post-reset logic from Pine: reset then increment? or increment existing?
    // Script: `if isLoSw ... ll := 1` then `ll += 1`
    // So effective LL at swing start is 2? Yes.
    ll++;
    lh++;

    // Calculate MAs
    const maHi = getSma(highs, lh, i);
    const maLo = getSma(lows, ll, i);

    maHiHistory[i] = maHi;
    maLoHistory[i] = maLo;

    if (i === 0) continue; // No prev metric

    const atr = atrSeries[i];
    const prevMaHi = maHiHistory[i - 1];
    const prevMaLo = maLoHistory[i - 1];

    // Deviation Logic
    const dHi = Math.abs(maHi - prevMaHi) > atr;
    const dLo = Math.abs(maLo - prevMaLo) > atr;

    // Counters
    const prevUc = ucSeries[i - 1] || 0;
    const prevLc = lcSeries[i - 1] || 0;

    ucSeries[i] = !dHi ? prevUc + 1 : 0;
    lcSeries[i] = !dLo ? prevLc + 1 : 0;

    // Bands (Middle)
    // script: ub = dHi ? na : maHi
    const ub = dHi ? NaN : maHi;
    const lb = dLo ? NaN : maLo;

    ubSeries[i] = ub;
    lbSeries[i] = lb;
  }

  // Return the latest Signal state
  const lastIdx = candles.length - 1;
  const prevIdx = lastIdx - 1;

  // Buy Logic: Crossover(low, lb) and lc > 15
  // Sell Logic: Crossunder(high, ub) and uc > 20

  // We check specifically the crossover event on the LAST candle
  const low = lows[lastIdx];
  const prevLow = lows[prevIdx];
  const lb = lbSeries[lastIdx];
  const prevLb = lbSeries[prevIdx];
  const lc = lcSeries[lastIdx];

  const high = highs[lastIdx];
  const prevHigh = highs[prevIdx];
  const ub = ubSeries[lastIdx];
  const prevUb = ubSeries[prevIdx];
  const uc = ucSeries[lastIdx];

  // Crossover Low/LB: (prevLow < prevLb) && (low > lb) ? 
  // Wait, Pine `ta.crossover(source, target)`: source crosses OVER target.
  // `ta.crossover(low, lb)` -> Low was below LB, now is above LB.
  const buySignal = (!Number.isNaN(lb) && !Number.isNaN(prevLb) && prevLow < prevLb && low > lb && lc > 15);

  // Sell Logic: `ta.crossunder(high, ub)` -> High was above UB, now is below UB.
  const sellSignal = (!Number.isNaN(ub) && !Number.isNaN(prevUb) && prevHigh > prevUb && high < ub && uc > 20);

  return {
    buy: buySignal,
    sell: sellSignal,
    lb: lbSeries[lastIdx],
    ub: ubSeries[lastIdx],
    lc,
    uc
  };
}

function calculateOrderBookMetrics(orderBook) {
  if (!orderBook || !orderBook.bids?.length || !orderBook.asks?.length) return null;

  const [bestBidPrice] = orderBook.bids[0];
  const [bestAskPrice] = orderBook.asks[0];
  if (!Number.isFinite(bestBidPrice) || !Number.isFinite(bestAskPrice) || bestAskPrice <= 0 || bestBidPrice <= 0) return null;

  const mid = (bestAskPrice + bestBidPrice) / 2;
  const spreadBps = ((bestAskPrice - bestBidPrice) / mid) * 10000;

  const topBids = orderBook.bids.slice(0, 10);
  const topAsks = orderBook.asks.slice(0, 10);

  const bidNotional = topBids.reduce((sum, [p, q]) => sum + (p * q), 0);
  const askNotional = topAsks.reduce((sum, [p, q]) => sum + (p * q), 0);
  const totalNotional = bidNotional + askNotional;
  const obi = totalNotional > 0 ? (bidNotional - askNotional) / totalNotional : 0;

  const bidVolume = orderBook.bids.reduce((sum, [p, q]) => sum + q, 0);
  const askVolume = orderBook.asks.reduce((sum, [p, q]) => sum + q, 0);
  const volumeImbalance = bidVolume + askVolume > 0 ? (bidVolume - askVolume) / (bidVolume + askVolume) : 0;

  return { spreadBps, depthQuoteTopN: totalNotional, obi, volumeImbalance };
}

// ==================== MARKET REGIME DETECTION ====================

function calculateVolatilityPercentile(candles, atrPeriod = 14) {
  const atrs = calculateATRSeries(candles, atrPeriod);
  if (!atrs || atrs.length < 50) return 50; // Neutral if not enough data

  const currentATR = atrs[atrs.length - 1];
  const last50ATRs = atrs.slice(-50).filter(v => v !== null);

  const sorted = [...last50ATRs].sort((a, b) => a - b);
  const rank = sorted.findIndex(v => v >= currentATR);

  if (sorted.length === 0) return 50;
  return (rank / sorted.length) * 100;
}

function detectMarketRegime(candles, adx, closes) {
  const atrPercentile = calculateVolatilityPercentile(candles);
  const trendStrength = adx ? adx.adx : 0;
  const isBearish = adx ? adx.bearishTrend : false;
  const isBullish = adx ? adx.bullishTrend : false;

  // NEW: Use EMA slope for additional trend confirmation
  const emaSlope = closes ? calculateEMASlope(closes, 50) : null;
  const hasValidTrend = emaSlope !== null && Math.abs(emaSlope) > 0.0005; // 0.05% slope threshold

  // IMPROVED: Higher ADX threshold (25 instead of 20) for more reliable trend detection
  // IMPROVED: Require both ADX and EMA slope alignment

  // Strict Downtrend detection
  if (trendStrength > 25 && isBearish && hasValidTrend) {
    return 'DOWNTREND';
  } else if (trendStrength > 25 && isBullish && hasValidTrend && atrPercentile < 70) {
    return 'TRENDING';
  } else if (trendStrength < 20 && atrPercentile < 40 && (!hasValidTrend || Math.abs(emaSlope) < 0.001)) {
    return 'RANGING';
  } else if (atrPercentile > 85) {
    return 'HIGH_VOLATILITY';
  } else {
    return 'TRANSITION';
  }
}

// ==================== SMART MONEY CONCEPTS ====================

function detectSmartMoneyConcepts(candles, lookback = 50) {
  const fvgs = [];
  const orderBlocks = [];

  if (candles.length < 5) return { fvgs: [], orderBlocks: [] };

  const start = Math.max(2, candles.length - lookback);

  for (let i = start; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c1 = candles[i - 1];
    const c2 = candles[i];

    // --- FVG Detection ---
    // Bullish FVG: Gap between c0.high and c2.low
    if (c2.low > c0.high) {
      fvgs.push({
        type: 'BULLISH',
        top: c2.low,
        bottom: c0.high,
        price: (c2.low + c0.high) / 2,
        time: c1.time
      });
    }
    // Bearish FVG: Gap between c0.low and c2.high
    else if (c2.high < c0.low) {
      fvgs.push({
        type: 'BEARISH',
        top: c0.low,
        bottom: c2.high,
        price: (c0.low + c2.high) / 2,
        time: c1.time
      });
    }

    // --- Order Block Detection ---
    const bodySize = Math.abs(c2.close - c2.open);
    const prevBody = Math.abs(c1.close - c1.open);

    // Bullish OB: Bearish candle followed by strong bullish move
    if (c1.close < c1.open && c2.close > c2.open && bodySize > prevBody * 1.5 && c2.close > c1.high) {
      orderBlocks.push({
        type: 'BULLISH',
        top: c1.high,
        bottom: c1.low,
        price: (c1.high + c1.low) / 2,
        time: c1.time
      });
    }
    // Bearish OB: Bullish candle followed by strong bearish move
    else if (c1.close > c1.open && c2.close < c2.open && bodySize > prevBody * 1.5 && c2.close < c1.low) {
      orderBlocks.push({
        type: 'BEARISH',
        top: c1.high,
        bottom: c1.low,
        price: (c1.high + c1.low) / 2,
        time: c1.time
      });
    }
  }

  return { fvgs, orderBlocks };
}

// ==================== PRICE ACTION PATTERNS ====================

function detectMarketStructureShift(candles, lookback = 50) {
  if (candles.length < lookback) return null;

  const relevantCandles = candles.slice(-lookback);
  // Find Swing Points (Highs and Lows)
  const swings = [];

  for (let i = 2; i < relevantCandles.length - 2; i++) {
    const current = relevantCandles[i];
    const prev = relevantCandles[i - 1];
    const prev2 = relevantCandles[i - 2];
    const next = relevantCandles[i + 1];
    const next2 = relevantCandles[i + 2];

    // Swing High
    if (current.high > prev.high && current.high > prev2.high &&
      current.high > next.high && current.high > next2.high) {
      swings.push({ type: 'HIGH', price: current.high, time: current.time, index: i });
    }

    // Swing Low
    if (current.low < prev.low && current.low < prev2.low &&
      current.low < next.low && current.low < next2.low) {
      swings.push({ type: 'LOW', price: current.low, time: current.time, index: i });
    }
  }

  if (swings.length < 2) return null;

  const lastCandle = relevantCandles[relevantCandles.length - 1];
  const prevCandle = relevantCandles[relevantCandles.length - 2];

  // Check for Bullish MSS (Break of last Swing High)
  // Needs to happen recently (last 3 candles)
  const lastSwingHigh = swings.filter(s => s.type === 'HIGH').pop();

  if (lastSwingHigh) {
    // Check if price broke above the last swing high RECENTLY
    const brokenIndex = relevantCandles.findIndex((c, idx) => idx > lastSwingHigh.index && c.close > lastSwingHigh.price);

    if (brokenIndex !== -1 && brokenIndex >= relevantCandles.length - 3) {
      const breakCandle = relevantCandles[brokenIndex];
      const bodySize = Math.abs(breakCandle.close - breakCandle.open);
      const totalSize = breakCandle.high - breakCandle.low;

      // Validation: Break must be impulsive (large body)
      if (bodySize > totalSize * 0.5) {
        return {
          type: 'BULLISH_MSS',
          price: lastSwingHigh.price,
          breakTime: breakCandle.time
        };
      }
    }
  }

  // Check for Bearish MSS (Break of last Swing Low)
  const lastSwingLow = swings.filter(s => s.type === 'LOW').pop();

  if (lastSwingLow) {
    const brokenIndex = relevantCandles.findIndex((c, idx) => idx > lastSwingLow.index && c.close < lastSwingLow.price);

    if (brokenIndex !== -1 && brokenIndex >= relevantCandles.length - 3) {
      const breakCandle = relevantCandles[brokenIndex];
      return {
        type: 'BEARISH_MSS',
        price: lastSwingLow.price,
        breakTime: breakCandle.time
      };
    }
  }

  return null;
}

function detectLiquiditySweep(candles, lookback = 50) {
  if (candles.length < lookback) return null;
  // Exclude last few candles to find established lows
  const analysisCandles = candles.slice(-lookback, -3);
  const recentCandles = candles.slice(-3);

  // Find significant lowest low in established window
  let minLow = Infinity;

  for (let i = 0; i < analysisCandles.length; i++) {
    if (analysisCandles[i].low < minLow) {
      minLow = analysisCandles[i].low;
    }
  }

  if (minLow === Infinity) return null;

  // Check if any recent candle swept the low
  for (const candle of recentCandles) {
    // Bullish Sweep: Price went below establish low but closed ABOVE it
    if (candle.low < minLow && candle.close > minLow) {
      return {
        type: 'BULLISH_SWEEP',
        level: minLow,
        time: candle.time
      };
    }
  }

  // Find significant highest high for bearish sweep
  let maxHigh = -Infinity;
  for (let i = 0; i < analysisCandles.length; i++) {
    if (analysisCandles[i].high > maxHigh) {
      maxHigh = analysisCandles[i].high;
    }
  }

  for (const candle of recentCandles) {
    // Bearish Sweep: Price went above established high but closed BELOW it
    if (candle.high > maxHigh && candle.close < maxHigh) {
      return {
        type: 'BEARISH_SWEEP',
        level: maxHigh,
        time: candle.time
      };
    }
  }

  return null;
}


function detectPriceActionPatterns(candles) {
  if (candles.length < 3) return [];

  const patterns = [];
  const recent = candles.slice(-3);

  const c0 = recent[0], c1 = recent[1], c2 = recent[2];
  const body0 = Math.abs(c0.close - c0.open);
  const body1 = Math.abs(c1.close - c1.open);
  const body2 = Math.abs(c2.close - c2.open);

  const upperWick0 = c0.high - Math.max(c0.open, c0.close);
  const lowerWick0 = Math.min(c0.open, c0.close) - c0.low;
  const upperWick1 = c1.high - Math.max(c1.open, c1.close);
  const lowerWick1 = Math.min(c1.open, c1.close) - c1.low;
  const upperWick2 = c2.high - Math.max(c2.open, c2.close);
  const lowerWick2 = Math.min(c2.open, c2.close) - c2.low;

  // Bullish Engulfing
  if (c0.close > c0.open && c1.close < c1.open) {
    if (c0.close > c1.open && c0.open < c1.close) {
      patterns.push({ type: 'BULLISH', name: 'Bullish Engulfing', strength: 35 });
    }
  }

  // Bearish Engulfing
  if (c0.close < c0.open && c1.close > c1.open) {
    if (c0.open > c1.close && c0.close < c1.open) {
      patterns.push({ type: 'BEARISH', name: 'Bearish Engulfing', strength: 35 });
    }
  }

  // Hammer (bullish reversal)
  if (body1 > 0 && lowerWick1 > body1 * 2 && upperWick1 < body1 * 0.5) {
    patterns.push({ type: 'BULLISH', name: 'Hammer', strength: 25 });
  }

  // Shooting Star (bearish reversal)
  if (body1 > 0 && upperWick1 > body1 * 2 && lowerWick1 < body1 * 0.5) {
    patterns.push({ type: 'BEARISH', name: 'Shooting Star', strength: 25 });
  }

  // Morning Star (3-candle bullish reversal)
  if (recent.length >= 3) {
    if (c0.close < c0.open && c1.close < c1.open && c2.close > c2.open) {
      const totalBody = body0 + body1 + body2;
      if (body1 < body0 * 0.3 && body1 < body2 * 0.3 && c1.close < c0.close && c1.close < c2.close) {
        patterns.push({ type: 'BULLISH', name: 'Morning Star', strength: 40 });
      }
    }

    // Evening Star (3-candle bearish reversal)
    if (c0.close > c0.open && c1.close > c1.open && c2.close < c2.open) {
      if (body1 < body0 * 0.3 && body1 < body2 * 0.3 && c1.close > c0.close && c1.close > c2.close) {
        patterns.push({ type: 'BEARISH', name: 'Evening Star', strength: 40 });
      }
    }
  }

  // Doji
  if (body1 < (upperWick1 + lowerWick1) * 0.1) {
    patterns.push({ type: 'NEUTRAL', name: 'Doji', strength: 10 });
  }

  return patterns;
}

function detectDivergences(candles, closes) {
  if (candles.length < 50) return [];

  const lookback = 30;
  const recentCloses = closes.slice(-lookback);

  const rsiValues = [];
  const rsiStartIndex = closes.length - lookback - 15;
  if (rsiStartIndex < 0) return [];

  for (let i = rsiStartIndex; i < closes.length; i++) {
    const subset = closes.slice(0, i + 1);
    const val = calculateRSI(subset, 14);
    if (val !== null) rsiValues.push({ index: i, value: val });
  }

  if (rsiValues.length < lookback) return [];

  const alignedRSI = rsiValues.slice(-lookback);
  const alignedPrice = recentCloses.map((price, idx) => ({
    index: closes.length - lookback + idx,
    value: price
  }));

  const findPivots = (data, isHigh) => {
    const pivots = [];
    for (let i = 2; i < data.length - 2; i++) {
      const curr = data[i].value;
      if (isHigh) {
        if (curr > data[i - 1].value && curr > data[i - 2].value &&
          curr > data[i + 1].value && curr > data[i + 2].value) {
          pivots.push(data[i]);
        }
      } else {
        if (curr < data[i - 1].value && curr < data[i - 2].value &&
          curr < data[i + 1].value && curr < data[i + 2].value) {
          pivots.push(data[i]);
        }
      }
    }
    return pivots;
  };

  const priceHighs = findPivots(alignedPrice, true);
  const priceLows = findPivots(alignedPrice, false);
  const rsiHighs = findPivots(alignedRSI, true);
  const rsiLows = findPivots(alignedRSI, false);

  const divergences = [];

  const checkDiv = (p1, p2, r1, r2, type, name) => {
    const timeDiff = Math.abs(p2.index - p1.index);
    if (timeDiff < 5 || timeDiff > 40) return;

    const match1 = Math.abs(p1.index - r1.index) <= 2;
    const match2 = Math.abs(p2.index - r2.index) <= 2;

    if (match1 && match2) {
      divergences.push({ type, name, strength: Math.abs(r1.value - r2.value) });
    }
  };

  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const p2 = priceLows[priceLows.length - 1];
    const p1 = priceLows[priceLows.length - 2];
    const r2 = rsiLows[rsiLows.length - 1];
    const r1 = rsiLows[rsiLows.length - 2];

    if (p2.value < p1.value && r2.value > r1.value) {
      checkDiv(p1, p2, r1, r2, 'BULLISH', 'Regular Bullish Div');
    }
  }

  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const p2 = priceHighs[priceHighs.length - 1];
    const p1 = priceHighs[priceHighs.length - 2];
    const r2 = rsiHighs[rsiHighs.length - 1];
    const r1 = rsiHighs[rsiHighs.length - 2];

    if (p2.value > p1.value && r2.value < r1.value) {
      checkDiv(p1, p2, r1, r2, 'BEARISH', 'Regular Bearish Div');
    }
  }

  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const p2 = priceLows[priceLows.length - 1];
    const p1 = priceLows[priceLows.length - 2];
    const r2 = rsiLows[rsiLows.length - 1];
    const r1 = rsiLows[rsiLows.length - 2];

    if (p2.value > p1.value && r2.value < r1.value) {
      checkDiv(p1, p2, r1, r2, 'BULLISH', 'Hidden Bullish Div');
    }
  }

  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const p2 = priceHighs[priceHighs.length - 1];
    const p1 = priceHighs[priceHighs.length - 2];
    const r2 = rsiHighs[rsiHighs.length - 1];
    const r1 = rsiHighs[rsiHighs.length - 2];

    if (p2.value < p1.value && r2.value > r1.value) {
      checkDiv(p1, p2, r1, r2, 'BEARISH', 'Hidden Bearish Div');
    }
  }

  return divergences;
}

// ==================== MULTI-TIMEFRAME ANALYSIS ====================

async function analyzeMultiTimeframe(symbol, candles15m, ticker24h) {
  const candles1h = await getKlines(symbol, '60m', 500);

  const analysis15m = analyzeTimeframe(symbol, candles15m, '15m');
  const analysis1h = analyzeTimeframe(symbol, candles1h, '60m');

  return {
    tf15m: analysis15m,
    tf1h: analysis1h,
    confluence: calculateConfluence(analysis15m, analysis1h)
  };
}

function analyzeTimeframe(symbol, candles, interval) {
  if (!candles || candles.length < 200) return null;

  const closedCandles = getClosedCandles(candles, interval);
  if (closedCandles.length < 200) return null;
  const closes = closedCandles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  return {
    closes,
    currentPrice,
    rsi: calculateRSI(closes, 14),
    stochRSI: calculateStochasticRSI(closes),
    macd: calculateMACD(closes),
    bb: calculateBollingerBands(closes, 20, 2),
    ema9: calculateEMA(closes, 9),
    ema21: calculateEMA(closes, 21),
    ema50: calculateEMA(closes, 50),
    superTrend: calculateSuperTrend(closedCandles, 10, 3),
    adx: calculateADX(closedCandles, 14),
    atr: calculateATR(closedCandles, 14),
    vwap: calculateVWAP(closedCandles, 50),
    cmf: calculateCMF(closedCandles, 20)
  };
}

function calculateConfluence(analysis15m, analysis1h) {
  if (!analysis15m || !analysis1h) return null;

  let score = 0;
  const factors = [];

  const isUptrend15m = analysis15m.ema9 > analysis15m.ema21;
  const isUptrend1h = analysis1h.ema9 > analysis1h.ema21;

  if (isUptrend15m && isUptrend1h) {
    score += 20;
    factors.push('UPTREND');
  } else if (!isUptrend15m && !isUptrend1h) {
    score -= 20;
    factors.push('DOWNTREND');
  }

  const rsiAligned = (analysis15m.rsi > 50 && analysis1h.rsi > 50) || (analysis15m.rsi < 50 && analysis1h.rsi < 50);
  if (rsiAligned) {
    score += 10;
    factors.push('RSI_ALIGNED');
  }

  const macdAligned = analysis15m.macd.bullish === analysis1h.macd.bullish;
  if (macdAligned) {
    score += 10;
    factors.push('MACD_ALIGNED');
  }

  const stochAligned = (analysis15m.stochRSI && analysis1h.stochRSI) &&
    ((analysis15m.stochRSI.k < 20 && analysis1h.stochRSI.k < 20) ||
      (analysis15m.stochRSI.k > 80 && analysis1h.stochRSI.k > 80));
  if (stochAligned) {
    score += 15;
    factors.push('STOCH_ALIGNED');
  }

  const superTrendAligned = analysis15m.superTrend && analysis1h.superTrend &&
    analysis15m.superTrend.bullish === analysis1h.superTrend.bullish;
  if (superTrendAligned) {
    score += 15;
    factors.push('ST_ALIGNED');
  }

  return {
    score,
    factors,
    strong: score >= 50,
    moderate: score >= 30
  };
}

// ==================== SIGNAL GENERATION ====================

/**
 * expert Validation Layer - v4.5
 * Validates signal using order flow (OBI/Delta) alignment.
 */
function validateSignalExpert(symbol, type, volRatio, delta, obMetrics) {
  if (delta === null) return { passed: true, confidence: 0.7 }; // No delta, proceed with caution

  const isBuy = type === 'BUY';
  const deltaAligned = isBuy ? delta > 0.05 : delta < -0.05;

  if (!deltaAligned) {
    return { passed: false, reason: `Delta flow anti-aliñado (${delta.toFixed(2)})` };
  }

  // OBI Alignment if available
  if (obMetrics && Math.abs(obMetrics.obi) > 0.1) {
    const obiAligned = isBuy ? obMetrics.obi > 0 : obMetrics.obi < 0;
    if (!obiAligned) {
      return { passed: false, reason: `Desequilibrio de Libro (OBI) en contra (${obMetrics.obi.toFixed(2)})` };
    }
  }

  const confidence = Math.min(0.95, 0.7 + (volRatio > 1.5 ? 0.15 : 0) + (Math.abs(delta) > 0.3 ? 0.1 : 0));
  return { passed: true, confidence };
}

/**
 * Calculates a recommended position size as % of equity.
 */
function calculateRecommendedSize(score, atrPct, regime) {
  let size = 1.0; // Base 1%
  if (score >= 90) size += 1.0;
  if (score >= 95) size += 0.5;

  // Volatility adjustment
  if (atrPct > 2.5) size *= 0.6;
  else if (atrPct > 1.5) size *= 0.8;

  // Regime adjustment
  if (regime === 'HIGH_VOLATILITY') size *= 0.5;
  if (regime === 'TRANSITION') size *= 0.7;
  if (regime === 'RANGING') size *= 1.2; // Ranging is lower risk generally

  return Math.max(0.5, Math.min(size, 3.5)).toFixed(1); // Cap between 0.5% and 3.5%
}

function generateSignal(symbol, candles15m, candles1h, candles4h, orderBook, ticker24h, btcContext = null) {
  if (!candles15m || candles15m.length < 201) return null;

  const closedCandles15m = getClosedCandles(candles15m, '15m');
  if (closedCandles15m.length < 200) return null;

  const closes15m = closedCandles15m.map(c => c.close);
  const currentPrice = closes15m[closes15m.length - 1];
  const prevPrice = closes15m[closes15m.length - 2];

  const btcRisk = btcContext?.status || 'UNKNOWN';

  const obMetrics = calculateOrderBookMetrics(orderBook);
  if (!obMetrics) return null;

  if (obMetrics.spreadBps > MAX_SPREAD_BPS) return null;
  if (obMetrics.depthQuoteTopN < MIN_DEPTH_QUOTE) return null;

  const closedCandles1h = getClosedCandles(candles1h, '60m');
  if (closedCandles1h.length < 50) return null;
  const closes1h = closedCandles1h.map(c => c.close);
  const currentPrice1h = closes1h[closes1h.length - 1];

  const rsi15m = calculateRSI(closes15m, 14);
  const stoch15m = calculateStochasticRSI(closes15m);
  const macd15m = calculateMACD(closes15m);
  const bb15m = calculateBollingerBands(closes15m, 20, 2);
  const ema9_15m = calculateEMA(closes15m, 9);
  const ema21_15m = calculateEMA(closes15m, 21);
  const ema50_15m = calculateEMA(closes15m, 50);
  const superTrend15m = calculateSuperTrend(closedCandles15m, 10, 3);
  const adx15m = calculateADX(closedCandles15m, 14);
  const atr15m = calculateATR(closedCandles15m, 14);
  const atrPercent15m = atr15m ? (atr15m / currentPrice) * 100 : null;
  if (!atrPercent15m || atrPercent15m < MIN_ATR_PCT || atrPercent15m > MAX_ATR_PCT) return null;

  const cmf15m = calculateCMF(closedCandles15m, 20);
  const swingBands = calculateSwingStructureBands(closedCandles15m, 100);

  const rsi1h = calculateRSI(closes1h, 14);
  const macd1h = calculateMACD(closes1h);
  const superTrend1h = calculateSuperTrend(closedCandles1h, 10, 3);

  let superTrend4h = null;
  let trend4h = 'NEUTRAL';
  if (candles4h && candles4h.length > 20) {
    const closedCandles4h = getClosedCandles(candles4h, '4h');
    const closes4h = closedCandles4h.map(c => c.close);
    superTrend4h = calculateSuperTrend(closedCandles4h, 10, 3);
    const ema50_4h = calculateEMA(closes4h, 50);

    if (superTrend4h && ema50_4h) {
      const lastClose = closes4h[closes4h.length - 1];
      if (superTrend4h.bullish && lastClose > ema50_4h) trend4h = 'BULLISH';
      else if (superTrend4h.bearish && lastClose < ema50_4h) trend4h = 'BEARISH';
    }
  }

  const vwap15m = calculateVWAP(closedCandles15m, 50);
  const volumeSMA15m = calculateVolumeSMA(closedCandles15m, 20);
  const currentVolume15m = closedCandles15m[closedCandles15m.length - 1].volume;

  const divergences = detectDivergences(closedCandles15m, closes15m);
  const patterns = detectPriceActionPatterns(closedCandles15m);

  const lastCandle = closedCandles15m[closedCandles15m.length - 1];
  const takerBuyBase = Number.isFinite(lastCandle.takerBuyBaseVolume) ? lastCandle.takerBuyBaseVolume : null;
  const totalBaseVol = Number(lastCandle.volume);
  const buyRatio = takerBuyBase !== null && totalBaseVol > 0 ? takerBuyBase / totalBaseVol : null;
  const deltaRatio = buyRatio === null ? null : (2 * buyRatio - 1);

  // Relaxed indicator validation - allow some indicators to fail
  if (!rsi15m && !macd15m && !bb15m) return null; // At least one major indicator must work

  // === SIMPLIFIED CATEGORY-BASED SCORING FRAMEWORK v4.0 ===
  // Fixed weights for transparency and easier debugging
  let signalType = null;
  const reasons = [];
  const volumeRatio = volumeSMA15m ? currentVolume15m / volumeSMA15m : 1;

  const categoryScores = {
    momentum: 0,
    trend: 0,
    structure: 0,
    volume: 0,
    patterns: 0
  };

  // === CATEGORY 1: MOMENTUM (0-100) ===
  let momentumScore = 0;

  // RSI (0-35)
  if (rsi15m < 30) {
    momentumScore += 35;
    reasons.push(`⚡ RSI Sobrevendido (${rsi15m.toFixed(1)})`);
    signalType = 'BUY';
  } else if (rsi15m > 70) {
    // v4.6 FIX: Bull Run Blindness
    if (trend4h === 'BULLISH') {
      if (rsi15m > 85) {
        momentumScore += 35;
        reasons.push(`⚠️ RSI Extremo (>85)`);
        signalType = 'SELL_ALERT';
      } else {
        momentumScore += 25; // Treat as strong momentum
        reasons.push(`🚀 Momentum Fuerte (RSI > 70)`);
        // Do NOT force SELL_ALERT in uptrend
      }
    } else {
      momentumScore += 35;
      reasons.push(`⚠️ RSI Sobrecomprado (${rsi15m.toFixed(1)})`);
      signalType = 'SELL_ALERT';
    }
  } else if (rsi15m < 40 && rsi1h < 45) {
    momentumScore += 20;
    reasons.push(`📊 RSI zona de compra (${rsi15m.toFixed(1)})`);
    if (!signalType) signalType = 'BUY';
  } else if (rsi15m > 60 && rsi1h > 55) {
    // v4.6 FIX: Don't force sell based on zone if bullish
    if (trend4h !== 'BULLISH') {
      momentumScore += 20;
      reasons.push(`📊 RSI zona de venta (${rsi15m.toFixed(1)})`);
      if (!signalType) signalType = 'SELL_ALERT';
    }
  }

  // Stochastic RSI (0-35)
  if (stoch15m) {
    if (stoch15m.oversold && stoch15m.k > stoch15m.d) {
      momentumScore += 35;
      reasons.push('🎯 StochRSI Cross Up');
      if (!signalType) signalType = 'BUY';
    } else if (stoch15m.overbought && stoch15m.k < stoch15m.d) {
      // v4.6 FIX: Ignore stoch sell in strong uptrend unless confirmed by structure
      if (trend4h !== 'BULLISH') {
        momentumScore += 35;
        reasons.push('🎯 StochRSI Cross Down');
        if (!signalType) signalType = 'SELL_ALERT';
      }
    }
  }

  // MACD (0-30)
  if (macd15m?.bullish) {
    momentumScore += 30;
    reasons.push('📈 MACD Alcista');
    if (!signalType) signalType = 'BUY';
  } else if (!macd15m?.bullish) {
    // v4.6 FIX: Ignore MACD Sell in strong uptrend (it's just a pullback)
    if (trend4h !== 'BULLISH') {
      reasons.push('📉 MACD Bajista');
      if (!signalType) signalType = 'SELL_ALERT';
    }
  }

  categoryScores.momentum = Math.min(100, momentumScore);

  // === CATEGORY 2: TREND (0-100) ===
  let trendScore = 0;

  // SuperTrend 15m (0-40)
  if (superTrend15m?.bullish) {
    trendScore += 40;
    reasons.push('🟢 SuperTrend Alcista');
    if (!signalType || signalType === 'BUY') signalType = 'BUY';
  } else if (superTrend15m?.bearish) {
    trendScore += 40;
    reasons.push('🔴 SuperTrend Bajista');
    // v4.6 FIX: SuperTrend Bearish in 4H Bullish = Pullback Opportunity, NOT Sell
    if (trend4h !== 'BULLISH') {
      if (!signalType || signalType === 'SELL_ALERT') signalType = 'SELL_ALERT';
    }
  }

  if (superTrend15m?.flipped) {
    reasons.push(superTrend15m.bullish ? '🔄 FLIP ALCISTA' : '🔄 FLIP BAJISTA');
  }

  // Multi-TF Confluence (0-40)
  if (USE_MULTI_TF) {
    const stAligned1h = superTrend15m?.bullish === superTrend1h?.bullish;
    const stAligned4h = superTrend4h ? superTrend15m?.bullish === superTrend4h.bullish : false;

    if (stAligned1h && stAligned4h) {
      trendScore += 40;
      reasons.push('✅ Confluencia Total (3-TF)');
      // v4.6 FIX: If total confluence, FORCE BUY signal if undef
      if (!signalType && trend4h === 'BULLISH') signalType = 'BUY';
    } else if (stAligned1h) {
      trendScore += 20;
      reasons.push('✅ Confluencia 1H');
    }
    // Added for Sniper 2.0 check
    if (stAligned1h && stAligned4h) {
      reasons.push('🌐 MTF_ALIGNED_TOTAL');
    }
  }

  // ADX Strength (0-20)
  if (adx15m?.trending) {
    trendScore += 20;
    const trendDir = adx15m.bullishTrend ? 'Alcista' : 'Bajista';
    reasons.push(`💨 ADX ${trendDir}`);
  }

  categoryScores.trend = Math.min(100, trendScore);

  // === CATEGORY 3: STRUCTURE (0-100) ===
  let structureScore = 0;

  // Smart Money Concepts (0-60)
  const smc = detectSmartMoneyConcepts(closedCandles15m, 100);
  const nearbyBullishFVG = smc.fvgs.find(f => f.type === 'BULLISH' && currentPrice <= f.top * 1.002 && currentPrice >= f.bottom * 0.998);
  const nearbyBullishOB = smc.orderBlocks.find(ob => ob.type === 'BULLISH' && currentPrice <= ob.top * 1.005 && currentPrice >= ob.bottom * 0.995);
  const nearbyBearishFVG = smc.fvgs.find(f => f.type === 'BEARISH' && currentPrice >= f.bottom * 0.998 && currentPrice <= f.top * 1.002);
  const nearbyBearishOB = smc.orderBlocks.find(ob => ob.type === 'BEARISH' && currentPrice >= ob.bottom * 0.995 && currentPrice <= ob.top * 1.005);

  if (nearbyBullishOB && (signalType === 'BUY' || !signalType)) {
    structureScore += 60;
    reasons.unshift('🏦 Order Block Alcista');
    if (!signalType) signalType = 'BUY';
  } else if (nearbyBullishFVG && (signalType === 'BUY' || !signalType)) {
    structureScore += 40;
    reasons.unshift('🏦 FVG Alcista');
    if (!signalType) signalType = 'BUY';
  }

  if (nearbyBearishOB && (signalType === 'SELL_ALERT' || !signalType)) {
    structureScore += 60;
    reasons.unshift('🏦 Order Block Bajista');
    // v4.6 FIX: Hitting bearish OB in uptrend is expected resistance, not auto-sell
    if (trend4h !== 'BULLISH') {
      if (!signalType) signalType = 'SELL_ALERT';
    }
  } else if (nearbyBearishFVG && (signalType === 'SELL_ALERT' || !signalType)) {
    structureScore += 40;
    reasons.unshift('🏦 FVG Bajista');
    // v4.6 FIX: Hitting bearish FVG in uptrend is expected resistance, not auto-sell
    if (trend4h !== 'BULLISH') {
      if (!signalType) signalType = 'SELL_ALERT';
    }
  }

  // Bollinger Bands (0-25)
  const bbPercent = bb15m ? (currentPrice - bb15m.lower) / (bb15m.upper - bb15m.lower) : 0.5;
  if (bbPercent < 0.1) {
    structureScore += 25;
    reasons.push('🏀 BB Inferior');
    if (!signalType) signalType = 'BUY';
  } else if (bbPercent > 0.9) {
    // v4.6 FIX: Upper BB in uptrend is breakout, not sell
    if (trend4h !== 'BULLISH') {
      structureScore += 25;
      reasons.push('🎈 BB Superior');
      if (!signalType) signalType = 'SELL_ALERT';
    } else {
      reasons.push('🚀 BB Breakout Potential');
      // Do not force sell
    }
  }

  // Swing Structure Bands (0-15)
  if (swingBands?.buy && (signalType === 'BUY' || !signalType)) {
    structureScore += 15;
    reasons.unshift('🎯 Swing Structure Buy');
    if (!signalType) signalType = 'BUY';
  }

  categoryScores.structure = Math.min(100, structureScore);

  // === CATEGORY 4: VOLUME & ORDER FLOW (0-100) ===
  let volumeScore = 0;

  // Volume Confirmation (0-50) - IMPROVED: Higher threshold
  if (volumeRatio > 1.5) {
    volumeScore += 50;
    reasons.push(`📊 Vol x${volumeRatio.toFixed(1)}`);
  } else if (volumeRatio > 1.2) {
    volumeScore += 25;
  }

  // Order Flow Delta (0-30) - IMPROVED: Stronger directional requirement
  const direction = signalType === 'BUY' ? 1 : signalType === 'SELL_ALERT' ? -1 : 0;
  if (direction !== 0 && deltaRatio !== null) {
    const aligned = direction === 1 ? deltaRatio > 0.1 : deltaRatio < -0.1; // IMPROVED: 0.1 threshold
    if (aligned) {
      volumeScore += 30;
      reasons.push('📊 Order Flow Aligned');
    }
  }

  // OBI (0-20)
  if (direction !== 0 && obMetrics) {
    const obiAligned = direction === 1 ? obMetrics.obi > 0.05 : obMetrics.obi < -0.05;
    if (obiAligned) {
      volumeScore += 20;
      reasons.push('📚 OBI Favorable');
    }
  }

  categoryScores.volume = Math.min(100, volumeScore);

  // === CATEGORY 5: PATTERNS & DIVERGENCES (0-100) ===
  let patternsScore = 0;

  // Candlestick Patterns (0-50)
  if (patterns.length > 0) {
    const bestPattern = patterns.sort((a, b) => b.strength - a.strength)[0];
    if (signalType === 'BUY' && bestPattern.type === 'BULLISH') {
      patternsScore += 50;
      reasons.unshift(`🕯️ ${bestPattern.name}`);
    } else if (signalType === 'SELL_ALERT' && bestPattern.type === 'BEARISH') {
      patternsScore += 50;
      reasons.unshift(`🕯️ ${bestPattern.name}`);
    }
  }

  // Divergences (0-50)
  if (divergences.length > 0) {
    const bestDiv = divergences.sort((a, b) => b.strength - a.strength)[0];
    if ((bestDiv.type === 'BULLISH' && signalType === 'BUY') ||
      (bestDiv.type === 'BEARISH' && signalType === 'SELL_ALERT')) {
      patternsScore += 50;
      reasons.unshift(`🔥 ${bestDiv.name}`);
    }
  }

  categoryScores.patterns = Math.min(100, patternsScore);

  // === CALCULATE FINAL SCORE ===
  const quoteVol24h = ticker24h ? Number(ticker24h.quoteVolume) : null;
  if (!quoteVol24h || !Number.isFinite(quoteVol24h) || quoteVol24h < MIN_QUOTE_VOL_24H) return null;

  // --- SNIPER MODE FILTERS (MAX SECURITY) ---
  const mtfAlignedTotal = reasons.includes('🌐 MTF_ALIGNED_TOTAL');
  const sniperTrendOk = (signalType === 'BUY' && trend4h === 'BULLISH') || (signalType === 'SELL_ALERT' && trend4h === 'BEARISH');
  const sniperRsiOk = (signalType === 'BUY' && rsi1h <= 63); // Toughened to 63 from 65

  // --- AGGRESSIVE MODE FILTERS (FLEXIBILITY) ---
  // Allow trend if it's compatible with signal or if no signal yet (to allow MSS/Sweep detection)
  const isTrendPotentialBuy = trend4h === 'BULLISH' || trend4h === 'NEUTRAL';
  const isTrendPotentialSell = trend4h === 'BEARISH' || trend4h === 'NEUTRAL';

  const aggressiveTrendOk = signalType === 'BUY' ? isTrendPotentialBuy :
    signalType === 'SELL_ALERT' ? isTrendPotentialSell :
      trend4h !== 'DOWNTREND'; // Allow reaching MSS/Sweep if not a heavy downtrend

  if (!aggressiveTrendOk) {
    console.log(`[REJECT] ${symbol}: Aggressive Trend check failed (4H: ${trend4h}, Signal: ${signalType})`);
    return null;
  }

  const aggressiveRsiOk = rsi1h <= 78;

  if (signalType === 'BUY' && !aggressiveRsiOk) {
    console.log(`[REJECT] ${symbol}: 1H RSI (${rsi1h.toFixed(1)}) too high even for Aggressive`);
    return null;
  }

  // --- EXPERT VALIDATION LAYER (OBI/DELTA) ---
  const expertVal = validateSignalExpert(symbol, signalType, volumeRatio, deltaRatio, obMetrics);
  if (!expertVal.passed) {
    console.log(`[REJECT] ${symbol}: Expert Validation failed: ${expertVal.reason}`);
    return null;
  }
  reasons.push(`🛡️ Validado v4.5 (Conf: ${(expertVal.confidence * 100).toFixed(0)}%)`);

  // Determine Mode based on Trend and RSI
  // Sniper 2.0 requirements: MTF Total alignment + Volume 1.5x + Score 88+
  const isSniperQuality = mtfAlignedTotal && sniperRsiOk && volumeRatio >= 1.5;
  reasons.push(isSniperQuality ? '💎 MODO SNIPER' : '⚡ MODO AGRESIVO');

  // Detect Market Regime - IMPROVED: Pass closes for EMA slope
  const regime = detectMarketRegime(closedCandles15m, adx15m, closes15m);
  reasons.push(`🌐 Regime: ${regime}`);

  // === SIMPLIFIED REGIME FILTERS v4.0 ===
  let MIN_QUALITY_SCORE = 75;

  if (regime === 'DOWNTREND') {
    console.log(`[REJECT] ${symbol}: DOWNTREND regime - Safe mode enabled.`);
    return null;
  } else if (regime === 'TRANSITION') {
    MIN_QUALITY_SCORE = 82; // RE-ENABLED: High threshold for stability
  } else if (regime === 'TRENDING') {
    MIN_QUALITY_SCORE = 85;
  } else if (regime === 'HIGH_VOLATILITY') {
    MIN_QUALITY_SCORE = 90; // REDUCED from 92
  } else if (regime === 'RANGING') {
    MIN_QUALITY_SCORE = 75; // RANGING is our best regime
  }

  // === SIMPLIFIED FIXED WEIGHTS v4.0 ===
  // No dynamic weight changes - easier to debug and optimize
  const weights = {
    momentum: 0.25,
    trend: 0.30,
    structure: 0.25,
    volume: 0.15,
    patterns: 0.05
  };

  let score = Math.round(
    categoryScores.momentum * weights.momentum +
    categoryScores.trend * weights.trend +
    categoryScores.structure * weights.structure +
    categoryScores.volume * weights.volume +
    categoryScores.patterns * weights.patterns
  );

  // Count strong categories (>60%) - simplified confluence check
  const strongCategories = Object.values(categoryScores).filter(s => s >= 60).length;

  // Minimal confluence bonus (removed aggressive multipliers)
  if (strongCategories >= 4) {
    score += 5; // Small fixed bonus instead of percentage
    reasons.push('🎯 CONFLUENCIA EXCEPCIONAL');
  } else if (strongCategories >= 3) {
    score += 3;
    reasons.push('🎯 Alta Confluencia');
  }

  // Ensure score is non-negative before clamping
  score = Math.max(0, score);

  // === ENHANCED OVEREXTENSION AND PULLBACK FILTERS ===
  const ema21 = ema21_15m;
  const ema50 = ema50_15m;
  const distToEma21 = ema21 ? (currentPrice - ema21) / ema21 * 100 : 0;
  const distToEma50 = ema50 ? (currentPrice - ema50) / ema50 * 100 : 0;
  const distToEma9 = ema9_15m ? (currentPrice - ema9_15m) / ema9_15m * 100 : 0;

  if (signalType === 'BUY') {
    // 1. RSI/BB Overextension
    // v4.6 FIX: Allow overextension if trend is BULLISH (Breakout/Momentum)
    const isBreakout = trend4h === 'BULLISH' && rsi15m < 85;

    if ((rsi15m > 70 || bbPercent > 0.88) && !isBreakout) {
      console.log(`[REJECT] ${symbol}: Overextended RSI(${rsi15m.toFixed(1)}) or BB(${bbPercent.toFixed(2)}) - Trend: ${trend4h}`);
      return null;
    }

    // 2. Distance to EMA21 - Standard filter
    if (distToEma21 > 1.8) {
      console.log(`[REJECT] ${symbol}: Dist to EMA21 too high (${distToEma21.toFixed(2)}%)`);
      return null;
    }

    // 3. Distance to EMA9 - Chase filter
    if (distToEma9 > 2.0 && !isBreakout) {
      // Allow chasing a bit more in breakouts
      console.log(`[REJECT] ${symbol}: Chase Filter - Dist to EMA9 too high (${distToEma9.toFixed(2)}%)`);
      return null;
    }

    // === NEW: TRENDING REGIME PULLBACK FILTER ===
    // In TRENDING regime, only buy pullbacks (near EMA21 or EMA50)
    // v4.6 FIX: Disable pullback requirement for strong breakouts
    if (regime === 'TRENDING' && !isBreakout) {
      const nearEMA21 = Math.abs(distToEma21) < 0.8;  // Within 0.8% of EMA21
      const nearEMA50 = Math.abs(distToEma50) < 1.5;  // Within 1.5% of EMA50
      const priceAboveEMA21 = distToEma21 > 0;        // Price above EMA21 (uptrend)
      const priceAboveEMA50 = distToEma50 > 0;        // Price above EMA50 (uptrend)

      // Must be in uptrend
      if (!priceAboveEMA21 || !priceAboveEMA50) {
        console.log(`[REJECT] ${symbol}: TRENDING but not in uptrend (EMA21: ${distToEma21.toFixed(2)}%, EMA50: ${distToEma50.toFixed(2)}%)`);
        return null;
      }

      // Must be at pullback (near EMA21 or EMA50)
      if (!nearEMA21 && !nearEMA50) {
        console.log(`[REJECT] ${symbol}: TRENDING but no pullback to EMA21/50 (dist21: ${distToEma21.toFixed(2)}%, dist50: ${distToEma50.toFixed(2)}%)`);
        return null;
      }

      if (nearEMA21) reasons.push('📉 Pullback EMA21');
      if (nearEMA50 && !nearEMA21) reasons.push('📉 Pullback EMA50');
    }

    // === NEW: RANGING REGIME STRUCTURE FILTER ===
    // In RANGING, require MSS or Sweep for entry
    if (regime === 'RANGING') {
      // Will check mss and sweep after they're calculated
      // This is a placeholder - actual check comes later
    }
  }

  if (signalType === 'SELL_ALERT') return null;

  // === BTC CONTEXT FILTER (GLOBAL) ===
  // btcContext is now passed as the last argument
  if (btcContext) {
    if (btcContext.status === 'RED') {
      // Extreme Filter during BTC corrections
      if (score < 88) {
        console.log(`[REJECT] ${symbol}: BTC RED requires score 88, got ${score}`);
        return null;
      }
      reasons.push('⚠️ Mercado Macro Bajista (BTC Rojo)');
    } else if (btcContext.status === 'AMBER') {
      // Moderate Filter
      // v4.6 FIX: Relax BTC AMBER requirement if coin has strong momentum
      const requiredScore = (trend4h === 'BULLISH' && volumeRatio > 1.2) ? 70 : 78;
      if (score < requiredScore) {
        console.log(`[REJECT] ${symbol}: BTC AMBER requires score ${requiredScore}, got ${score}`);
        return null;
      }
      reasons.push('⚠️ Precaución Macro (BTC Ambar)');
    }
  }

  // === MSS DETECTION ===
  const mss = detectMarketStructureShift(closedCandles15m);

  // SIMPLIFIED v4.0: Small fixed bonus for MSS (no percentage caps)
  // MSS is a confirmation factor, not a score multiplier
  if (mss && mss.type === 'BULLISH_MSS' && (signalType === 'BUY' || !signalType)) {
    score += 10; // Fixed bonus — enough to help reach threshold without inflating
    reasons.unshift('🔄 MSS Confirm (+10)');
    if (!signalType) signalType = 'BUY';
  } else if (mss && mss.type === 'BEARISH_MSS' && (signalType === 'SELL_ALERT' || !signalType)) {
    score += 10;
    if (!signalType) signalType = 'SELL_ALERT';
  }

  // === LIQUIDITY SWEEP DETECTION ===
  const sweep = detectLiquiditySweep(closedCandles15m);

  // SIMPLIFIED v4.0: Small fixed bonus for confirmed Sweep only
  let sweepConfirmed = false;

  if (sweep && sweep.type === 'BULLISH_SWEEP' && (signalType === 'BUY' || !signalType)) {
    // Require MSS or strong volume for confirmation
    sweepConfirmed = (mss || volumeRatio > 1.5);

    if (sweepConfirmed) {
      score += 10; // Fixed bonus for confirmed sweeps
      reasons.unshift('🧹 Liquidity Sweep ✓');
    } else {
      reasons.unshift('🧹 Liquidity Sweep (⚠️ débil)');
    }

    if (!signalType) signalType = 'BUY';

  } else if (sweep && sweep.type === 'BEARISH_SWEEP' && (signalType === 'SELL_ALERT' || !signalType)) {
    sweepConfirmed = (mss || volumeRatio > 1.5);

    if (sweepConfirmed) {
      score += 10;
    }

    reasons.unshift(sweepConfirmed ? '🧹 Liquidity Sweep ✓' : '🧹 Liquidity Sweep (⚠️ débil)');
    if (!signalType) signalType = 'SELL_ALERT';
  }

  // Volume checks per mode
  const sniperVolOk = volumeRatio >= 1.2;
  const aggressiveVolOk = volumeRatio >= 0.8; // v4.6 FIX: Lowered from 1.0 to 0.8

  if (!aggressiveVolOk) {
    console.log(`[REJECT] ${symbol}: Volume ratio too low even for Aggressive (${volumeRatio.toFixed(2)})`);
    return null;
  }

  // Directional volume check: volume must flow in signal direction
  // BUY: net buying pressure (delta > 0). SELL: net selling pressure (delta < 0)
  if (signalType === 'BUY' && deltaRatio !== null && deltaRatio < 0) {
    console.log(`[REJECT] ${symbol}: BUY requires positive delta, got ${deltaRatio.toFixed(3)}`);
    return null;
  }
  if (signalType === 'SELL_ALERT' && deltaRatio !== null && deltaRatio > 0) {
    console.log(`[REJECT] ${symbol}: SELL requires negative delta, got ${deltaRatio.toFixed(3)}`);
    return null;
  }


  // Final Score Clamping
  score = Math.min(100, Math.max(0, score));

  // --- FINAL MODE DETERMINATION ---
  // A signal remains "SNIPER" only if IT PASSED ALL sniper filters
  const isSniperTrendRsi = reasons.includes('💎 MODO SNIPER');
  const isSniperVol = volumeRatio >= 1.5; // Upgraded from 1.2
  const isSniperScore = score >= 88;

  const finalMode = (isSniperTrendRsi && isSniperVol && isSniperScore) ? 'SNIPER' : 'AGGRESSIVE';

  // Update internal tag
  reasons.forEach((r, i) => {
    if (r === '💎 MODO SNIPER' || r === '⚡ MODO AGRESIVO') reasons.splice(i, 1);
  });
  reasons.unshift(finalMode === 'SNIPER' ? '💎 SEGURIDAD SNIPER' : '⚡ MODO AGRESIVO');

  // HIGH_VOLATILITY: Ultra strict
  if (regime === 'HIGH_VOLATILITY') {
    const passesVolatilityFilter =
      score >= 90 &&
      (mss || sweep) &&                       // Must have structure
      volumeRatio > 1.5 &&                    // Strong volume required
      btcRisk !== 'RED';

    if (!passesVolatilityFilter) {
      console.log(`[REJECT] ${symbol} (HighVol): score=${score}, structure=${!!(mss || sweep)}, btcRisk=${btcRisk}, volRatio=${volumeRatio.toFixed(2)}`);
      return null;
    }
    reasons.push('✅ HIGH_VOL_FILTER_PASSED');
  }

  // TRENDING: Require pullback confirmation
  if (regime === 'TRENDING') {
    const hasStructure = mss || sweep;
    const hasPullback = Math.abs(distToEma21) < 0.8 || Math.abs(distToEma50) < 1.5;

    if (!hasStructure && !hasPullback) {
      console.log(`[REJECT] ${symbol} (TRENDING): No structure or pullback (dist21: ${distToEma21.toFixed(2)}%)`);
      return null;
    }

    if (hasStructure) reasons.push('✅ TREND_STRUCTURE');
    if (hasPullback) reasons.push('✅ TREND_PULLBACK');
  }

  // RANGING: Require structure + buy cheap principle
  if (regime === 'RANGING') {
    // Don't buy in the upper part of the range
    if (signalType === 'BUY' && bbPercent > 0.75) {
      console.log(`[REJECT] ${symbol} (RANGING): BB% too high (${bbPercent.toFixed(2)})`);
      return null;
    }

    // Require structure (Unless exceptionally high score)
    if (!mss && !sweep && score < 85) {
      console.log(`[REJECT] ${symbol} (RANGING): Sin MSS ni Sweep y score ${score} < 85`);
      return null;
    }
  }

  // Final score check
  if (score < MIN_QUALITY_SCORE) {
    console.log(`[REJECT] ${symbol}: Score ${score} < ${MIN_QUALITY_SCORE}`);
    return null;
  }

  // Require visual confirmation for borderline scores
  const hasVisualConfirmation = divergences.length > 0 || patterns.length > 0 || mss || sweep;
  if (score < 80 && !hasVisualConfirmation) {
    console.log(`[REJECT] ${symbol}: Score ${score} < 80 and no confirmation`);
    return null;
  }

  // Minimum strong categories
  const requiredStrong = (regime === 'TRENDING' || regime === 'HIGH_VOLATILITY') ? 3 : 2;
  if (strongCategories < requiredStrong) {
    console.log(`[REJECT] ${symbol}: Strong Categories ${strongCategories} < ${requiredStrong}`);
    return null;
  }

  // === FINAL OUTPUT ===
  if (score >= MIN_QUALITY_SCORE && reasons.length > 0 && signalType) {
    return {
      symbol,
      price: currentPrice,
      price1h: currentPrice1h,
      score,
      regime,
      categoryScores,
      strongCategories,
      type: signalType,
      rsi: rsi15m.toFixed(1),
      rsi1h: rsi1h.toFixed(1),
      stochRSI: stoch15m ? stoch15m.k.toFixed(1) : null,
      macdBullish: macd15m.bullish,
      macdBullish1h: macd1h.bullish,

      hasSMC: !!(nearbyBullishOB || nearbyBullishFVG || nearbyBearishOB || nearbyBearishFVG),
      smcSignal: nearbyBullishOB ? 'OB_BULL' : nearbyBearishOB ? 'OB_BEAR' : nearbyBullishFVG ? 'FVG_BULL' : nearbyBearishFVG ? 'FVG_BEAR' : null,
      hasMSS: !!mss,
      hasSweep: !!sweep,
      superTrend: superTrend15m.bullish ? 'BULL' : 'BEAR',
      superTrendFlipped: superTrend15m.flipped,
      bbPosition: Math.round(bbPercent * 100),
      bbUpper: bb15m.upper,
      bbLower: bb15m.lower,
      hasDivergence: divergences.length > 0,
      hasPattern: patterns.length > 0,
      volumeRatio: Number(volumeRatio.toFixed(2)),
      volumeConfirmed: volumeRatio > 1.2,
      spreadBps: Number(obMetrics.spreadBps.toFixed(1)),
      depthQuoteTopN: Math.round(obMetrics.depthQuoteTopN),
      obi: Number(obMetrics.obi.toFixed(3)),
      deltaRatio: deltaRatio === null ? null : Number(deltaRatio.toFixed(3)),
      atrPercent: Number(atrPercent15m.toFixed(2)),
      vwap: vwap15m,
      vwapDistance: vwap15m ? Number((((currentPrice - vwap15m) / vwap15m) * 100).toFixed(2)) : null,
      // === ENHANCED SL/TP BASED ON REGIME ANALYSIS ===
      // RANGING (75% WR): Standard targets work well
      // TRANSITION (33% WR): Tighter targets - take profit quicker
      // TRENDING (27% WR): Wider targets to capture trend, but strict entry
      // HIGH_VOLATILITY (23% WR): Very tight targets - quick in/out
      tp: signalType === 'BUY'
        ? currentPrice * (1 + (atrPercent15m / 100) * (
          regime === 'TRENDING' ? 4.0 :
            regime === 'HIGH_VOLATILITY' ? 2.0 :
              regime === 'TRANSITION' ? 2.5 :
                2.0  // RANGING — AUDIT v3.0: Reduced from 3.0 (4 BE showed 3.0 is too aggressive)
        ))
        : currentPrice * (1 - (atrPercent15m / 100) * (
          regime === 'TRENDING' ? 4.0 :
            regime === 'HIGH_VOLATILITY' ? 2.0 :
              regime === 'TRANSITION' ? 2.5 :
                2.0  // RANGING — AUDIT v3.0: Reduced from 3.0
        )),
      sl: signalType === 'BUY'
        ? currentPrice * (1 - (atrPercent15m / 100) * (
          regime === 'TRENDING' ? 2.5 :
            regime === 'HIGH_VOLATILITY' ? 1.2 :
              regime === 'TRANSITION' ? 1.8 :
                2.0  // RANGING
        ))
        : currentPrice * (1 + (atrPercent15m / 100) * (
          regime === 'TRENDING' ? 2.5 :
            regime === 'HIGH_VOLATILITY' ? 1.2 :
              regime === 'TRANSITION' ? 1.8 :
                2.0  // RANGING
        )),
      // Enhanced metrics for post-analysis
      entryMetrics: {
        distToEma9: Number(distToEma9.toFixed(2)),
        distToEma21: Number(distToEma21.toFixed(2)),
        distToEma50: Number(distToEma50.toFixed(2)),
        bbPercent: Number((bbPercent || 0).toFixed(2)),
        riskRewardRatio: Number(((regime === 'TRENDING' ? 4.0 : regime === 'HIGH_VOLATILITY' ? 2.0 : regime === 'TRANSITION' ? 2.5 : 2.0) /
          (regime === 'TRENDING' ? 2.5 : regime === 'HIGH_VOLATILITY' ? 1.2 : regime === 'TRANSITION' ? 1.8 : 2.0)).toFixed(2))
      },
      reasons,
      mode: finalMode,
      recommendedSize: calculateRecommendedSize(score, atrPercent15m, regime),
      btcContext // Include context in result
    };
  }

  return null;
}

// ==================== TELEGRAM ====================

async function sendTelegramNotification(signals, stats = null) {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram disabled or missing credentials');
    return { success: false, reason: 'disabled' };
  }

  const hasHistory = stats && (stats.open > 0 || stats.wins > 0 || stats.losses > 0);
  if (signals.length === 0 && !hasHistory) {
    return { success: true, sent: 0 };
  }

  // Helper to ensure values are safe for MarkdownV2
  const esc = (val) => escapeMarkdownV2(val !== undefined && val !== null ? val : '');

  let message = '🔔 *DAY TRADE ALERT* 🔔\n';

  if (stats) {
    message += `📊 _Win Rate: ${esc(stats.winRate)}% \\| Open: ${esc(stats.open)} \\| W/L: ${esc(stats.wins)}/${esc(stats.losses)}_\n`;
  }

  message += `_${esc('15m • Multi-TF • Institutional Quality')}_\n\n`;

  const sortedSignals = [...signals].sort((a, b) => b.score - a.score);

  for (const sig of sortedSignals.slice(0, 5)) {
    let icon = '📊';
    let typeEmoji = '';
    if (sig.type === 'BUY') { icon = '🟢'; typeEmoji = '🛒 COMPRA'; }
    else if (sig.type === 'SELL_ALERT') { icon = '🔴'; typeEmoji = '📤 VENTA'; }
    else { typeEmoji = '👁️ VIGILAR'; }

    // Symbol and Mode
    const modeLabel = sig.mode === 'SNIPER' ? '💎 SNIPER' : '⚡ AGRESIVO';
    message += `${icon} *${esc(sig.symbol)}* \\| ${esc(typeEmoji)} \\| ${esc(modeLabel)}\n`;

    // Price & Levels
    if (Number.isFinite(sig.price)) {
      const priceStr = sig.price < 1 ? sig.price.toFixed(6) : sig.price.toFixed(2);
      const tpStr = sig.tp < 1 ? sig.tp.toFixed(6) : sig.tp.toFixed(2);
      const slStr = sig.sl < 1 ? sig.sl.toFixed(6) : sig.sl.toFixed(2);

      const ch = sig.vwapDistance;
      if (ch !== undefined && ch !== null) {
        const changeIcon = ch >= 0 ? '📈' : '📉';
        const changeSign = ch >= 0 ? '+' : '';
        message += `💰 *$${esc(priceStr)}* ${changeIcon} ${esc(changeSign + ch)}% \\(VWAP\\)\n`;
      } else {
        message += `💰 *$${esc(priceStr)}*\n`;
      }
      message += `🎯 *TP: ${esc(tpStr)}* \\| 🛡️ *SL: ${esc(slStr)}*\n`;
    }

    // Indicators
    message += `📊 RSI: ${esc(sig.rsi)} \\(15m\\) / ${esc(sig.rsi1h)} \\(1h\\)`;
    if (sig.stochRSI) message += ` \\| Stoch: ${esc(sig.stochRSI)}`;
    message += `\n`;

    message += `📍 BB: ${esc(sig.bbPosition)}%`;
    if (sig.superTrend) message += ` \\| ST: ${esc(sig.superTrend)}`;
    if (sig.superTrendFlipped) message += ` 🔄`;
    if (sig.macdBullish !== undefined) message += ` \\| MACD: ${sig.macdBullish ? '🟢' : '🔴'}`;
    message += `\n`;

    // Regime & Score
    const regimeIcon = sig.regime === 'TRENDING' ? '📈' : (sig.regime === 'RANGING' ? '↔️' : '⚠️');
    message += `${regimeIcon} Regime: ${esc(sig.regime)} \\| 🎯 Score: *${esc(sig.score)}*/100\n`;
    message += `💰 *Size Sugerido: ${esc(sig.recommendedSize)}%*\n`;

    if (sig.btcContext && sig.btcContext.status !== 'GREEN') {
      const btcIcon = sig.btcContext.status === 'RED' ? '🔴' : '🟡';
      message += `${btcIcon} BTC Risk: ${esc(sig.btcContext.status)}\n`;
    }

    // SMC & Confluence
    let badges = [];
    if (sig.hasSMC) badges.push(`🏦 ${sig.smcSignal}`);
    if (sig.hasMSS) badges.push('🔄MSS');
    if (sig.hasSweep) badges.push('🧹SWP');
    if (sig.hasDivergence) badges.push('🔥DIV');
    if (sig.hasPattern) badges.push('🕯️PAT');
    if (badges.length > 0) {
      const escapedBadges = badges.map(b => esc(b));
      message += `✨ ${escapedBadges.join(' ')}\n`;
    }

    // Volume
    if (sig.volumeConfirmed) message += `📊 Vol: ${esc(sig.volumeRatio)}x\n`;

    // Order Flow
    if (sig.spreadBps !== undefined || sig.obi !== undefined) {
      const spreadText = sig.spreadBps !== undefined ? String(sig.spreadBps) : 'N/A';
      const obiText = sig.obi !== undefined ? String(sig.obi) : 'N/A';
      message += `📚 Spread: ${esc(spreadText)} bps \\| OBI: ${esc(obiText)}\n`;
    }

    // ATR & Delta
    if (sig.atrPercent !== undefined) {
      message += `🌀 ATR: ${esc(sig.atrPercent)}%`;
      if (sig.deltaRatio !== undefined && sig.deltaRatio !== null) message += ` \\| Δ: ${esc(sig.deltaRatio)}`;
      message += `\n`;
    }

    // Reasons
    const reasonsArr = Array.isArray(sig.reasons) ? sig.reasons : [];
    if (reasonsArr.length > 0) {
      message += `💡 _${esc(reasonsArr[0])}_\n`;
    }

    message += `───────────────────\n`;
  }

  const timeStr = new Date().toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });
  message += `🤖 _Day Trade Scanner_ • ${esc(timeStr)}`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'MarkdownV2'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telegram API Error:', errorText);
      return { success: false, error: errorText };
    }

    console.log(`Telegram notification sent for ${signals.length} signals`);
    return { success: true, sent: signals.length };

  } catch (error) {
    console.error('Telegram Exception:', error.message);
    return { success: false, error: error.message };
  }
}

// ==================== MAIN ANALYSIS FUNCTION ====================

export async function runAnalysis(context) {
  // 0. Check trading session
  if (!isTradingAllowed()) {
    console.log('[SESSION] Trading paused - Low liquidity session');
    return { success: true, signals: 0, reason: 'Asia session - trading restricted' };
  }

  // 1. Acquire Global Lock
  const canProceed = await acquireRunLock(context);
  if (!canProceed) return { success: false, error: 'Locked' };

  try {
    console.log('--- DAY TRADE Analysis Started v4.0 ---');
    const runId = `RUN-${Date.now().toString().slice(-6)}`;
    console.log('Execution ID:', runId);

    // Load persistent cooldowns
    const cooldowns = await loadCooldowns(context);
    console.log(`Loaded ${Object.keys(cooldowns).length} cooldown entries`);

    const signals = [];
    let analyzed = 0;
    let errors = 0;
    const selectedSectors = new Set(); // NEW: Track sectors to avoid correlation

    // === BTC GLOBAL CONTEXT ANALYSIS ===
    let btcContext = { status: 'GREEN', reason: 'BTC Analysis Passed (Default)' };
    try {
      const btcSymbol = `BTC${QUOTE_ASSET}`;
      const [btcCandles4h, btcCandles1h] = await Promise.all([  // FIXED: typo
        getKlines(btcSymbol, '4h', 100),
        getKlines(btcSymbol, '60m', 100)
      ]);

      if (btcCandles4h && btcCandles4h.length > 50) {  // FIXED: typo
        const closed4h = getClosedCandles(btcCandles4h, '4h');
        const closes4h = closed4h.map(c => c.close);
        const closes1h = getClosedCandles(btcCandles1h, '60m').map(c => c.close);

        const btcSt4h = calculateSuperTrend(closed4h, 10, 3);
        const btcRsi4h = calculateRSI(closes4h, 14);
        const btcRsi1h = calculateRSI(closes1h, 14);

        if (btcSt4h.bearish || btcRsi4h > 75) {
          btcContext = { status: 'RED', reason: 'BTC 4H Bearish or Overextended' };
          console.log(`[BTC-SEM] 🔴 RED: ST=${btcSt4h.bearish ? 'Bear' : 'Bull'}, RSI4H=${btcRsi4h.toFixed(1)}`);
        } else if (btcSt4h.bullish && btcRsi1h > 65) {
          btcContext = { status: 'AMBER', reason: 'BTC 1H Overbought' };
          console.log(`[BTC-SEM] 🟡 AMBER: RSI1H=${btcRsi1h.toFixed(1)}`);
        } else {
          btcContext = { status: 'GREEN', reason: 'BTC Healthy' };
          console.log(`[BTC-SEM] 🟢 GREEN: Trend Healthy`);
        }
      }
    } catch (btcErr) {
      console.warn('Failed to analyze BTC context:', btcErr.message);
    }

    const tickers24h = await getAllTickers24h();
    const tickersBySymbol = new Map(tickers24h.map(t => [t.symbol, t]));

    const topSymbols = tickers24h.length > 0
      ? getTopSymbolsByOpportunity(tickers24h, QUOTE_ASSET, MAX_SYMBOLS, MIN_QUOTE_VOL_24H)
      : FALLBACK_SYMBOLS;

    // Update Backtesting History & Stats BEFORE scanning
    const histData = await updateSignalHistory(tickers24h, context);
    const stats = histData?.stats || { open: 0, wins: 0, losses: 0, winRate: 0 };
    const openSymbols = histData?.openSymbols || [];

    if (stats) console.log(`[${runId}] Performance Stats:`, stats);

    for (const symbol of topSymbols) {
      if (openSymbols.includes(symbol)) {
        console.log(`[${runId}] Skipping ${symbol} - Already have an OPEN position`);
        continue;
      }

      if (cooldowns[symbol] && (Date.now() - cooldowns[symbol] < ALERT_COOLDOWN_MIN * 60000)) {
        continue;
      }

      // NEW: Sector correlation check - skip if we already have signal from same sector
      const sector = getSector(symbol);
      if (selectedSectors.has(sector)) {
        console.log(`[${runId}] Skipping ${symbol} - Sector ${sector} already selected`);
        continue;
      }

      try {
        const [candles15m, orderBook, candles1hRaw, candles4hRaw] = await Promise.all([
          getKlines(symbol, '15m', 500),
          getOrderBookDepth(symbol, 20),
          USE_MULTI_TF ? getKlines(symbol, '60m', 200) : Promise.resolve([]),
          USE_MULTI_TF ? getKlines(symbol, '4h', 100) : Promise.resolve([])
        ]);

        const ticker24h = tickersBySymbol.get(symbol) || null;
        let candles1h = candles1hRaw;
        let candles4h = candles4hRaw;

        if (!USE_MULTI_TF) {
          candles1h = (candles15m && candles15m.length > 0) ? candles15m.slice(-200) : [];
        }

        analyzed++;

        const signal = generateSignal(symbol, candles15m, candles1h, candles4h, orderBook, ticker24h, btcContext);
        if (signal) {
          // IMMEDIATE COOLDOWN PROTECTION
          cooldowns[symbol] = Date.now();
          await saveCooldowns(cooldowns, context);

          // NEW: Track sector for correlation protection
          selectedSectors.add(sector);

          await recordSignalHistory(signal, context);
          signals.push(signal);
          console.log(`[${runId}] 🎯 SIGNAL GENERATED: ${symbol} | Score: ${signal.score} | Sector: ${sector}`);
        }

        await sleep(10);

      } catch (error) {
        console.error(`Error analyzing ${symbol}:`, error.message);
        errors++;
        await sleep(10);
      }
    }

    console.log(`Analysis complete: ${analyzed} coins, ${signals.length} signals, ${errors} errors`);

    let telegramResult = { success: true, sent: 0 };
    if (signals.length > 0) {
      telegramResult = await sendTelegramNotification(signals, stats);
    }

    // Release lock on success
    await releaseRunLock(context);

    return {
      success: true,
      id: runId,
      analyzed,
      signals: signals.length,
      errors,
      telegram: telegramResult,
      timestamp: new Date().toISOString()
    };
  } catch (globalErr) {
    console.error('CRITICAL ERROR in runAnalysis:', globalErr.message);
    await releaseRunLock(context);
    return { success: false, error: globalErr.message };
  }
}

// ==================== SCHEDULED HANDLER (Netlify) ====================

const scheduledHandler = async (event, context) => {
  const method = event && (event.httpMethod || event.method) ? String(event.httpMethod || event.method).toUpperCase() : '';

  if (method) {
    const headers = event.headers || {};
    const nfEvent = (headers['x-nf-event'] || headers['X-NF-Event'] || headers['x-nf-Event'] || '').toString().toLowerCase();

    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, x-notify-secret',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Content-Type': 'application/json'
        },
        body: ''
      };
    }

    if (method !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Method not allowed' })
      };
    }

    let payload = null;
    if (event.body) {
      try {
        payload = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Invalid JSON body' })
        };
      }
    }

    const hasNextRun = payload && typeof payload.next_run === 'string';
    const isSchedule = nfEvent === 'schedule' || hasNextRun;

    if (isSchedule) {
      const result = await runAnalysis(context);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    if (!NOTIFY_SECRET) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'NOTIFY_SECRET not configured' })
      };
    }

    const clientSecret = headers['x-notify-secret'] || headers['X-Notify-Secret'] || headers['x-notify-Secret'] || '';
    if (clientSecret !== NOTIFY_SECRET) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Unauthorized' })
      };
    }

    const incomingSignals = payload && Array.isArray(payload.signals) ? payload.signals : null;
    if (!incomingSignals || incomingSignals.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'No signals provided' })
      };
    }

    const telegram = await sendTelegramNotification(incomingSignals);
    return {
      statusCode: telegram.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: telegram.success, telegram })
    };
  }

  const result = await runAnalysis(context);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  };
};

export const handler = schedule("*/15 * * * *", scheduledHandler);

export { detectSmartMoneyConcepts };
