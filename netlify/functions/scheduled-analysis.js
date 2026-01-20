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
const MAX_SYMBOLS = process.env.MAX_SYMBOLS ? Number(process.env.MAX_SYMBOLS) : 20;
const MIN_QUOTE_VOL_24H = process.env.MIN_QUOTE_VOL_24H ? Number(process.env.MIN_QUOTE_VOL_24H) : 2000000;
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || '';
const ALERT_COOLDOWN_MIN = process.env.ALERT_COOLDOWN_MIN ? Number(process.env.ALERT_COOLDOWN_MIN) : 30;
const USE_MULTI_TF = (process.env.USE_MULTI_TF || 'true').toLowerCase() === 'true';

// Persistent cooldown storage using Netlify Blobs
const COOLDOWN_STORE_KEY = 'signal-cooldowns';
const COOLDOWN_EXPIRY_HOURS = 24;

// const lastNotifiedAtByKey = new Map(); // Replaced by Blobs

const MEXC_API = 'https://api.mexc.com/api/v3';

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

async function loadCooldowns(context) {
  try {
    const store = getStore({ name: 'trading-signals' });
    const data = await store.get(COOLDOWN_STORE_KEY, { type: 'json' });
    if (!data) return {};

    // Cleanup expired
    const now = Date.now();
    const fresh = {};
    const expiryMs = COOLDOWN_EXPIRY_HOURS * 3600 * 1000;
    for (const [k, ts] of Object.entries(data)) {
      if (Number(ts) && (now - Number(ts) < expiryMs)) fresh[k] = ts;
    }
    return fresh;
  } catch (e) {
    console.error('Error loading cooldowns:', e.message);
    return {};
  }
}

async function saveCooldowns(cooldowns, context) {
  try {
    const store = getStore({ name: 'trading-signals' });
    await store.setJSON(COOLDOWN_STORE_KEY, cooldowns);
  } catch (error) {
    // Only warn if we're theoretically in production or if it's a real error
    if (process.env.NETLIFY) console.error('Error saving cooldowns to Blob:', error.message);
  }
}

// ==================== SIGNAL HISTORY & BACKTESTING ====================

const HISTORY_STORE_KEY = 'signal-history-v2';

async function recordSignalHistory(signal, context) {
  try {
    const store = getStore({ name: 'trading-signals' });
    const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];

    // Risk/Reward Setup (1:1.5)
    // ATR is used for dynamic SL/TP
    const atrFactor = signal.atrPercent || 1;
    const entryPrice = signal.price;
    let tp, sl;

    if (signal.type === 'BUY') {
      tp = entryPrice * (1 + (atrFactor / 100) * 1.5);
      sl = entryPrice * (1 - (atrFactor / 100) * 1.0);
    } else {
      tp = entryPrice * (1 - (atrFactor / 100) * 1.5);
      sl = entryPrice * (1 + (atrFactor / 100) * 1.0);
    }

    const record = {
      id: `${Date.now()}-${signal.symbol}`,
      symbol: signal.symbol,
      entry: entryPrice,
      tp,
      sl,
      type: signal.type,
      time: Date.now(),
      status: 'OPEN',
      score: signal.score,
      regime: signal.regime
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
    const store = getStore({ name: 'trading-signals' });
    let history = await store.get(HISTORY_STORE_KEY, { type: 'json' });
    if (!history || !history.length) return { open: 0, wins: 0, losses: 0 };

    const prices = new Map(tickers.map(t => [t.symbol, Number(t.lastPrice)]));
    let updated = false;

    for (const item of history) {
      if (item.status === 'OPEN') {
        const currentPrice = prices.get(item.symbol);
        if (!currentPrice) continue;

        if (item.type === 'BUY') {
          if (currentPrice >= item.tp) { item.status = 'CLOSED'; item.outcome = 'WIN'; updated = true; }
          else if (currentPrice <= item.sl) { item.status = 'CLOSED'; item.outcome = 'LOSS'; updated = true; }
        } else {
          if (currentPrice <= item.tp) { item.status = 'CLOSED'; item.outcome = 'WIN'; updated = true; }
          else if (currentPrice >= item.sl) { item.status = 'CLOSED'; item.outcome = 'LOSS'; updated = true; }
        }

        // Auto-expire after 48 hours
        if (item.status === 'OPEN' && Date.now() - item.time > 48 * 3600 * 1000) {
          item.status = 'EXPIRED';
          updated = true;
        }
      }
    }

    if (updated) await store.setJSON(HISTORY_STORE_KEY, history);

    const closed = history.filter(h => h.status === 'CLOSED');
    const wins = closed.filter(h => h.outcome === 'WIN').length;
    return {
      open: history.filter(h => h.status === 'OPEN').length,
      wins,
      losses: closed.length - wins,
      winRate: closed.length > 0 ? (wins / closed.length * 100).toFixed(1) : 0
    };
  } catch (error) {
    console.error('Error updating history:', error.message);
    return null;
  }
}

// ==================== MARKET DATA ====================

async function getKlines(symbol, interval = '15m', limit = 200) {
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

  return json.map(candle => {
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

function detectMarketRegime(candles, adx) {
  const atrPercentile = calculateVolatilityPercentile(candles);
  const trendStrength = adx ? adx.adx : 0;

  if (trendStrength > 25 && atrPercentile < 70) {
    return 'TRENDING';
  } else if (trendStrength < 20 && atrPercentile < 40) {
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
  const candles1h = await getKlines(symbol, '60m', 200);

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
    vwap: calculateVWAP(closedCandles, 50)
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

function generateSignal(symbol, candles15m, candles1h, candles4h, orderBook, ticker24h) {
  if (!candles15m || candles15m.length < 201) return null;

  const closedCandles15m = getClosedCandles(candles15m, '15m');
  if (closedCandles15m.length < 200) return null;

  const closes15m = closedCandles15m.map(c => c.close);
  const currentPrice = closes15m[closes15m.length - 1];
  const prevPrice = closes15m[closes15m.length - 2];

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

  // === CATEGORY-BASED QUALITY FRAMEWORK ===
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

  // RSI (0-40)
  if (rsi15m < 30) {
    momentumScore += 40;
    reasons.push(`⚡ RSI Sobrevendido (${rsi15m.toFixed(1)})`);
    signalType = 'BUY';
  } else if (rsi15m > 70) {
    momentumScore += 40;
    reasons.push(`⚠️ RSI Sobrecomprado (${rsi15m.toFixed(1)})`);
    signalType = 'SELL_ALERT';
  } else if (rsi15m < 40 && rsi1h < 45) {
    momentumScore += 25;
    reasons.push(`📊 RSI zona de compra (${rsi15m.toFixed(1)})`);
    if (!signalType) signalType = 'BUY';
  } else if (rsi15m > 60 && rsi1h > 55) {
    momentumScore += 25;
    reasons.push(`📊 RSI zona de venta (${rsi15m.toFixed(1)})`);
    if (!signalType) signalType = 'SELL_ALERT';
  }

  // Stochastic RSI (0-30)
  if (stoch15m) {
    if (stoch15m.oversold) {
      momentumScore += 30;
      reasons.push('🎯 StochRSI Sobrevendido');
      if (!signalType) signalType = 'BUY';
    } else if (stoch15m.overbought) {
      momentumScore += 30;
      reasons.push('🎯 StochRSI Sobrecomprado');
      if (!signalType) signalType = 'SELL_ALERT';
    }
  }

  // MACD (0-30)
  if (macd15m.bullish) {
    momentumScore += 20;
    reasons.push('📈 MACD Alcista');
    if (signalType === 'BUY') momentumScore += 10; // Alignment bonus
  } else {
    reasons.push('📉 MACD Bajista');
    if (signalType === 'SELL_ALERT') momentumScore += 20;
  }

  categoryScores.momentum = Math.min(100, momentumScore);

  // === CATEGORY 2: TREND (0-100) ===
  let trendScore = 0;

  // SuperTrend 15m (0-40)
  if (superTrend15m.bullish) {
    trendScore += 30;
    reasons.push('🟢 SuperTrend Alcista');
    if (!signalType || signalType === 'BUY') signalType = 'BUY';
  } else if (superTrend15m.bearish) {
    trendScore += 30;
    reasons.push('🔴 SuperTrend Bajista');
    if (!signalType || signalType === 'SELL_ALERT') signalType = 'SELL_ALERT';
  }

  if (superTrend15m.flipped) {
    trendScore += 10;
    reasons.push(superTrend15m.bullish ? '🔄 FLIP ALCISTA' : '🔄 FLIP BAJISTA');
  }

  // Multi-TF Confluence (0-50)
  if (USE_MULTI_TF) {
    // Strict 4H filter already applied above
    const stAligned1h = superTrend15m.bullish === superTrend1h.bullish;
    const stAligned4h = superTrend4h ? superTrend15m.bullish === superTrend4h.bullish : false;

    if (stAligned1h && stAligned4h) {
      trendScore += 50;
      reasons.push('✅ Confluencia Total (3-TF)');
    } else if (stAligned1h) {
      trendScore += 25;
      reasons.push('✅ Confluencia 1H');
    }
  }

  // ADX Strength (0-10)
  if (adx15m && adx15m.trending) {
    trendScore += 10;
    const trendDir = adx15m.bullishTrend ? 'Alcista' : 'Bajista';
    reasons.push(`💨 ADX ${trendDir}`);
  }

  categoryScores.trend = Math.min(100, trendScore);

  // === CATEGORY 3: STRUCTURE (Smart Money + BB) (0-100) ===
  let structureScore = 0;

  // Smart Money Concepts (0-70)
  const smc = detectSmartMoneyConcepts(closedCandles15m, 100);
  const nearbyBullishFVG = smc.fvgs.find(f => f.type === 'BULLISH' && currentPrice <= f.top * 1.002 && currentPrice >= f.bottom * 0.998);
  const nearbyBullishOB = smc.orderBlocks.find(ob => ob.type === 'BULLISH' && currentPrice <= ob.top * 1.005 && currentPrice >= ob.bottom * 0.995);
  const nearbyBearishFVG = smc.fvgs.find(f => f.type === 'BEARISH' && currentPrice >= f.bottom * 0.998 && currentPrice <= f.top * 1.002);
  const nearbyBearishOB = smc.orderBlocks.find(ob => ob.type === 'BEARISH' && currentPrice >= ob.bottom * 0.995 && currentPrice <= ob.top * 1.005);

  if (nearbyBullishOB && (signalType === 'BUY' || !signalType)) {
    structureScore += 70;
    reasons.unshift('🏦 Order Block Alcista');
    if (!signalType) signalType = 'BUY';
  } else if (nearbyBullishFVG && (signalType === 'BUY' || !signalType)) {
    structureScore += 50;
    reasons.unshift('🏦 FVG Alcista');
    if (!signalType) signalType = 'BUY';
  }

  if (nearbyBearishOB && (signalType === 'SELL_ALERT' || !signalType)) {
    structureScore += 70;
    reasons.unshift('🏦 Order Block Bajista');
    if (!signalType) signalType = 'SELL_ALERT';
  } else if (nearbyBearishFVG && (signalType === 'SELL_ALERT' || !signalType)) {
    structureScore += 50;
    reasons.unshift('🏦 FVG Bajista');
    if (!signalType) signalType = 'SELL_ALERT';
  }

  // Bollinger Bands (0-30)
  const bbPercent = (currentPrice - bb15m.lower) / (bb15m.upper - bb15m.lower);
  if (bbPercent < 0.1) {
    structureScore += 25;
    reasons.push('🏀 BB Inferior');
    if (!signalType) signalType = 'BUY';
  } else if (bbPercent > 0.9) {
    structureScore += 25;
    reasons.push('🎈 BB Superior');
    if (!signalType) signalType = 'SELL_ALERT';
  }

  categoryScores.structure = Math.min(100, structureScore);

  // === CATEGORY 4: VOLUME & ORDER FLOW (0-100) ===
  let volumeScore = 0;

  // Volume Confirmation (0-40)
  if (volumeRatio > 1.5) {
    volumeScore += 40;
    reasons.push(`📊 Vol x${volumeRatio.toFixed(1)}`);
  } else if (volumeRatio > 1.2) {
    volumeScore += 25;
  }

  // Order Flow Delta (0-35)
  const direction = signalType === 'BUY' ? 1 : signalType === 'SELL_ALERT' ? -1 : 0;
  if (direction !== 0 && deltaRatio !== null) {
    const aligned = direction === 1 ? deltaRatio > 0 : deltaRatio < 0;
    if (aligned) {
      volumeScore += 35;
      reasons.push('📊 Order Flow Aligned');
    }
  }

  // OBI (0-25)
  if (direction !== 0) {
    const obiAligned = direction === 1 ? obMetrics.obi > 0.05 : obMetrics.obi < -0.05;
    if (obiAligned) {
      volumeScore += 25;
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
    } else if (bestPattern.type === 'BULLISH' || bestPattern.type === 'BEARISH') {
      patternsScore += 30;
      reasons.push(`🕯️ ${bestPattern.name}`);
    }
  }

  // Divergences (0-50)
  if (divergences.length > 0) {
    const bestDiv = divergences.sort((a, b) => b.strength - a.strength)[0];
    if ((bestDiv.type === 'BULLISH' && signalType === 'BUY') ||
      (bestDiv.type === 'BEARISH' && signalType === 'SELL_ALERT')) {
      patternsScore += 50;
      reasons.unshift(`🔥 ${bestDiv.name}`);
    } else {
      patternsScore += 30;
      reasons.push(`🔥 ${bestDiv.name}`);
    }
  }

  categoryScores.patterns = Math.min(100, patternsScore);

  // === CALCULATE FINAL SCORE ===
  const quoteVol24h = ticker24h ? Number(ticker24h.quoteVolume) : null;
  if (!quoteVol24h || !Number.isFinite(quoteVol24h) || quoteVol24h < MIN_QUOTE_VOL_24H) return null;

  let score = 0;

  // Apply 4H Trend Filter
  if (USE_MULTI_TF) {
    if (trend4h === 'BULLISH' && signalType === 'SELL_ALERT') return null;
    if (trend4h === 'BEARISH' && signalType === 'BUY') return null;
  }

  // Detect Market Regime
  const regime = detectMarketRegime(closedCandles15m, adx15m);
  reasons.push(`🌐 Regime: ${regime}`);

  if (regime === 'TRANSITION') return null; // Avoid low-probability transition phases

  let MIN_QUALITY_SCORE = 70;
  const weights = {
    momentum: 0.25,
    trend: 0.30,
    structure: 0.25,
    volume: 0.15,
    patterns: 0.05
  };

  // Adaptive Strategy by Regime
  if (regime === 'TRENDING') {
    weights.trend = 0.45;    // Trend is king
    weights.momentum = 0.20;
    MIN_QUALITY_SCORE = 70;
  } else if (regime === 'RANGING') {
    weights.structure = 0.40; // S/R and OBs are king
    weights.momentum = 0.35;  // RSI extremes are important
    weights.trend = 0.10;     // Trend is less relevant
    MIN_QUALITY_SCORE = 75;   // Higher bar for range trades
  } else if (regime === 'HIGH_VOLATILITY') {
    weights.structure = 0.40;
    weights.volume = 0.40;    // Volume/OrderFlow is king
    weights.trend = 0.10;
    MIN_QUALITY_SCORE = 82;   // Very high bar for volatile markets
  }

  score = Math.round(
    categoryScores.momentum * weights.momentum +
    categoryScores.trend * weights.trend +
    categoryScores.structure * weights.structure +
    categoryScores.volume * weights.volume +
    categoryScores.patterns * weights.patterns
  );

  // Count strong categories (>60%)
  const strongCategories = Object.values(categoryScores).filter(s => s >= 60).length;

  // Confluence bonus
  if (strongCategories >= 4) {
    score = Math.round(score * 1.20); // +20% bonus
    reasons.push('🎯 CONFLUENCIA EXCEPCIONAL');
  } else if (strongCategories >= 3) {
    score = Math.round(score * 1.10); // +10% bonus
    reasons.push('🎯 Alta Confluencia');
  }

  score = Math.min(100, score);

  // === STRICT FILTERS ===
  // Reject low-volume setups
  if (volumeRatio < 0.8) return null;

  if (score < MIN_QUALITY_SCORE) return null;

  // Must have at least 2 strong categories
  if (strongCategories < 2) return null;

  // === FINAL OUTPUT ===
  if (score >= MIN_QUALITY_SCORE && reasons.length > 0 && signalType) {
    return {
      symbol,
      price: currentPrice,
      price1h: currentPrice1h,
      score,
      regime,
      categoryScores, // Include breakdown
      strongCategories,
      type: signalType,
      rsi: rsi15m.toFixed(1),
      rsi1h: rsi1h.toFixed(1),
      stochRSI: stoch15m ? stoch15m.k.toFixed(1) : null,
      macdBullish: macd15m.bullish,
      macdBullish1h: macd1h.bullish,
      hasSMC: !!(nearbyBullishOB || nearbyBullishFVG || nearbyBearishOB || nearbyBearishFVG),
      smcSignal: nearbyBullishOB ? 'OB_BULL' : nearbyBearishOB ? 'OB_BEAR' : nearbyBullishFVG ? 'FVG_BULL' : nearbyBearishFVG ? 'FVG_BEAR' : null,
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
      reasons
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

    // Symbol and Type
    message += `${icon} *${esc(sig.symbol)}* \\| ${esc(typeEmoji)}\n`;

    // Price
    if (Number.isFinite(sig.price)) {
      const priceStr = sig.price < 1 ? sig.price.toFixed(6) : sig.price.toFixed(2);
      const ch = sig.vwapDistance;
      if (ch !== undefined && ch !== null) {
        const changeIcon = ch >= 0 ? '📈' : '📉';
        const changeSign = ch >= 0 ? '+' : '';
        message += `💰 $${esc(priceStr)} ${changeIcon} ${esc(changeSign + ch)}% \\(VWAP\\)\n`;
      } else {
        message += `💰 $${esc(priceStr)}\n`;
      }
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

    // SMC & Confluence
    let badges = [];
    if (sig.hasSMC) badges.push(`🏦 ${sig.smcSignal}`);
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

async function runAnalysis(context = null) {
  console.log('--- DAY TRADE Analysis Started ---');
  console.log('Time:', new Date().toISOString());

  // Load persistent cooldowns
  const cooldowns = await loadCooldowns(context);
  console.log(`Loaded ${Object.keys(cooldowns).length} cooldown entries`);

  const signals = [];
  let analyzed = 0;
  let errors = 0;

  let tickers24h = [];
  try {
    tickers24h = await getAllTickers24h();
  } catch (error) {
    console.error('Error fetching 24h tickers:', error.message);
  }

  const topSymbols = tickers24h.length > 0
    ? getTopSymbolsByOpportunity(tickers24h, QUOTE_ASSET, MAX_SYMBOLS, MIN_QUOTE_VOL_24H)
    : FALLBACK_SYMBOLS;

  const tickersBySymbol = new Map(tickers24h.map(t => [t.symbol, t]));

  for (const symbol of topSymbols) {
    try {
      const candles15m = await getKlines(symbol, '15m', 300);
      const orderBook = await getOrderBookDepth(symbol, 20);
      const ticker24h = tickersBySymbol.get(symbol) || null;

      let candles1h = [];
      let candles4h = [];
      if (USE_MULTI_TF) {
        candles1h = await getKlines(symbol, '60m', 200);
        candles4h = await getKlines(symbol, '4h', 100);
      } else {
        candles1h = candles15m.slice(-200);
        // Fallback for 4h if disabled? Just empty.
      }

      analyzed++;

      const signal = generateSignal(symbol, candles15m, candles1h, candles4h, orderBook, ticker24h);
      if (signal) {
        const reasonKey = Array.isArray(signal.reasons) && signal.reasons.length > 0 ? signal.reasons[0] : '';
        const key = `${signal.symbol}:${signal.type}:${reasonKey}`;
        const now = Date.now();
        const lastTs = cooldowns[key] || 0;
        const cooldownMs = Math.max(0, ALERT_COOLDOWN_MIN) * 60 * 1000;
        if (cooldownMs > 0 && now - lastTs < cooldownMs) {
          console.log(`Signal skipped (cooldown): ${symbol} - Type: ${signal.type}`);
        } else {
          cooldowns[key] = now;
          signals.push(signal);
          console.log(`Signal: ${symbol} - Score: ${signal.score} - Type: ${signal.type}`);
        }
      }

      await sleep(150);

    } catch (error) {
      console.error(`Error analyzing ${symbol}:`, error.message, error.stack?.split('\n')[0]);
      errors++;
      await sleep(150);
    }
  }

  console.log(`Analysis complete: ${analyzed} coins, ${signals.length} signals, ${errors} errors`);

  // Update Backtesting History & Stats
  const stats = await updateSignalHistory(tickers24h, context);
  if (stats) console.log('Performance Stats:', stats);

  // Record signals to persistent history
  for (const sig of signals) {
    await recordSignalHistory(sig, context);
  }

  let telegramResult = { success: true, sent: 0 };
  if (signals.length > 0 || stats) {
    telegramResult = await sendTelegramNotification(signals, stats);
  } else {
    console.log('No significant signals detected this cycle');
  }

  // Save updated cooldowns
  if (Object.keys(cooldowns).length > 0) {
    await saveCooldowns(cooldowns, context);
  }

  return {
    success: true,
    analyzed,
    signals: signals.length,
    errors,
    telegram: telegramResult,
    timestamp: new Date().toISOString()
  };
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

    console.log('scheduled-analysis invocation:', {
      method,
      isSchedule,
      nfEvent: nfEvent || null,
      hasNextRun
    });

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
