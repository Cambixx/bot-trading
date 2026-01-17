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

const lastNotifiedAtByKey = new Map();

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
  });
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

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  const gains = [];
  const losses = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  const recentGains = gains.slice(-period);
  const recentLosses = losses.slice(-period);

  const avgGain = recentGains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = recentLosses.reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
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
  if (candles.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  const recentTR = trueRanges.slice(-period);
  return recentTR.reduce((a, b) => a + b, 0) / period;
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

  const rsiValues = [];
  for (let i = rsiPeriod; i < closes.length; i++) {
    const slice = closes.slice(i - rsiPeriod, i + 1);
    const rsi = calculateRSI(slice, rsiPeriod);
    if (rsi !== null) rsiValues.push(rsi);
  }

  if (rsiValues.length < stochasticPeriod) return null;

  const lowest = Math.min(...rsiValues.slice(-stochasticPeriod));
  const highest = Math.max(...rsiValues.slice(-stochasticPeriod));
  const currentRSI = rsiValues[rsiValues.length - 1];

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

function generateSignal(symbol, candles15m, candles1h, orderBook, ticker24h) {
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

  let score = 0;
  const reasons = [];
  let signalType = null;

  const isUptrend = ema9_15m > ema21_15m && ema21_15m > ema50_15m;
  const volumeRatio = volumeSMA15m ? currentVolume15m / volumeSMA15m : 1;
  const volumeMultiplier = volumeRatio > 1.5 ? 1.15 : (volumeRatio > 1.0 ? 1.05 : 0.95);

  const quoteVol24h = ticker24h ? Number(ticker24h.quoteVolume) : null;
  if (!quoteVol24h || !Number.isFinite(quoteVol24h) || quoteVol24h < MIN_QUOTE_VOL_24H) return null;

  // === MOMENTUM SCORE (0-40) ===

  // RSI Conditions
  if (rsi15m < 30) {
    score += 15;
    reasons.push(`⚡ RSI Sobrevendido (${rsi15m.toFixed(1)})`);
    signalType = 'BUY';
  } else if (rsi15m > 70) {
    score += 15;
    reasons.push(`⚠️ RSI Sobrecomprado (${rsi15m.toFixed(1)})`);
    signalType = 'SELL_ALERT';
  } else if (rsi15m < 40 && rsi1h < 45) {
    score += 10;
    reasons.push(`📊 RSI zona de compra (${rsi15m.toFixed(1)})`);
    if (!signalType) signalType = 'BUY';
  } else if (rsi15m > 60 && rsi1h > 55) {
    score += 10;
    reasons.push(`📊 RSI zona de venta (${rsi15m.toFixed(1)})`);
    if (!signalType) signalType = 'SELL_ALERT';
  }

  // Stochastic RSI
  if (stoch15m) {
    if (stoch15m.oversold) {
      score += 10;
      reasons.push('🎯 StochRSI Sobrevendido');
      if (!signalType) signalType = 'BUY';
    } else if (stoch15m.overbought) {
      score += 10;
      reasons.push('🎯 StochRSI Sobrecomprado');
      if (!signalType) signalType = 'SELL_ALERT';
    }
  }

  // MACD Confirmation
  if (macd15m.bullish) {
    score += 8;
    reasons.push('📈 MACD Alcista');
    if (signalType === 'BUY') score += 3;
  } else {
    score -= 5;
    reasons.push('📉 MACD Bajista');
    if (signalType === 'SELL_ALERT') score += 3;
  }

  // === TECHNICAL SCORE (0-40) ===

  // SuperTrend Direction
  if (superTrend15m.bullish) {
    score += 12;
    reasons.push('🟢 SuperTrend Alcista');
    if (!signalType || signalType === 'BUY') signalType = 'BUY';
  } else if (superTrend15m.bearish) {
    score += 12;
    reasons.push('🔴 SuperTrend Bajista');
    if (!signalType || signalType === 'SELL_ALERT') signalType = 'SELL_ALERT';
  }

  // SuperTrend Flip (strong signal)
  if (superTrend15m.flipped) {
    score += 10;
    reasons.push(superTrend15m.bullish ? '🔄 SuperTrend FLIP ALCISTA' : '🔄 SuperTrend FLIP BAJISTA');
  }

  // Bollinger Bands Position
  const bbPercent = (currentPrice - bb15m.lower) / (bb15m.upper - bb15m.lower);
  if (bbPercent < 0.1) {
    score += 8;
    reasons.push('🏀 Precio en Banda Inferior BB');
    if (!signalType) signalType = 'BUY';
  } else if (bbPercent > 0.9) {
    score += 8;
    reasons.push('🎈 Precio en Banda Superior BB');
    if (!signalType) signalType = 'SELL_ALERT';
  }

  // Price breakout from BB
  if (currentPrice > bb15m.upper && macd15m.bullish) {
    score += 12;
    reasons.push('🚀 Breakout BB Superior + MACD');
    signalType = 'BUY';
  }

  // === TREND & CONFLUENCE SCORE (0-20) ===

  // Multi-timeframe Trend Alignment
  if (USE_MULTI_TF) {
    const stAligned = superTrend15m.bullish === superTrend1h.bullish;
    const trendAligned = (superTrend15m.bullish && ema9_15m > ema21_15m) ||
      (superTrend15m.bearish && ema9_15m < ema21_15m);

    if (stAligned && trendAligned) {
      score += 15;
      reasons.push('✅ Multi-TF Alineado');
    } else if (stAligned) {
      score += 8;
    }

    // ADX Trend Strength
    if (adx15m && adx15m.trending) {
      score += 5;
      const trendDir = adx15m.bullishTrend ? 'Alcista' : 'Bajista';
      reasons.push(`💨 ADX confirma tendencia ${trendDir}`);
    }
  } else {
    if (isUptrend) {
      score += 10;
      reasons.push('✅ Tendencia Alcista (EMA9>21>50)');
      if (signalType === 'BUY') signalType = 'BUY';
    } else {
      score += 10;
      reasons.push('🔻 Tendencia Bajista');
      if (signalType === 'SELL_ALERT') signalType = 'SELL_ALERT';
    }
  }

  // === PATTERNS & DIVERGENCES (0-25) ===

  if (patterns.length > 0) {
    const bestPattern = patterns.sort((a, b) => b.strength - a.strength)[0];
    if (signalType === 'BUY' && bestPattern.type === 'BULLISH') {
      score += bestPattern.strength;
      reasons.unshift(`🕯️ ${bestPattern.name}`);
    } else if (signalType === 'SELL_ALERT' && bestPattern.type === 'BEARISH') {
      score += bestPattern.strength;
      reasons.unshift(`🕯️ ${bestPattern.name}`);
    } else if (bestPattern.type === 'BULLISH') {
      score += bestPattern.strength * 0.5;
      reasons.push(`🕯️ ${bestPattern.name}`);
      if (!signalType) signalType = 'BUY';
    } else if (bestPattern.type === 'BEARISH') {
      score += bestPattern.strength * 0.5;
      reasons.push(`🕯️ ${bestPattern.name}`);
      if (!signalType) signalType = 'SELL_ALERT';
    }
  }

  if (divergences.length > 0) {
    const sortedDivs = divergences.sort((a, b) => b.strength - a.strength);
    const bestDiv = sortedDivs[0];

    if (bestDiv.type === 'BULLISH' && signalType === 'BUY') {
      score += 20;
      reasons.unshift(`🔥 ${bestDiv.name}`);
    } else if (bestDiv.type === 'BEARISH' && signalType === 'SELL_ALERT') {
      score += 20;
      reasons.unshift(`🔥 ${bestDiv.name}`);
    } else if (bestDiv.type === 'BULLISH') {
      score += 10;
      reasons.push(`🔥 ${bestDiv.name}`);
    } else if (bestDiv.type === 'BEARISH') {
      score += 10;
      reasons.push(`🔥 ${bestDiv.name}`);
    }
  }

  // === ORDER FLOW SCORE (0-15) ===

  const direction = signalType === 'BUY' ? 1 : signalType === 'SELL_ALERT' ? -1 : 0;
  if (direction !== 0 && deltaRatio !== null) {
    const aligned = direction === 1 ? deltaRatio > 0 : deltaRatio < 0;
    if (aligned) {
      score += 10;
      reasons.push('📊 Order Flow Comprador' + (direction === 1 ? '↑' : '↓'));
    } else {
      score -= 5;
    }
  }

  if (direction !== 0) {
    const obiAligned = direction === 1 ? obMetrics.obi > 0.05 : obMetrics.obi < -0.05;
    if (obiAligned) {
      score += 5;
      reasons.push('📚 Book Imbalance Favorable');
    }
  }

  // Apply Volume Multiplier
  score = Math.max(0, Math.min(100, Math.round(score * volumeMultiplier)));
  if (volumeRatio > 1.5) {
    reasons.push(`📊 Volumen x${volumeRatio.toFixed(1)}`);
  }

  // VWAP Distance
  if (vwap15m) {
    const vwapDist = ((currentPrice - vwap15m) / vwap15m) * 100;
    if (signalType === 'BUY' && vwapDist > -2) {
      score += 5;
      reasons.push('📍 Sobre VWAP');
    } else if (signalType === 'SELL_ALERT' && vwapDist < 2) {
      score += 5;
      reasons.push('📍 Bajo VWAP');
    }
  }

  score = Math.max(0, Math.min(100, score));

  // === FINAL FILTERS ===

  const effectiveThreshold = signalType === 'BUY' ? SIGNAL_SCORE_THRESHOLD : SIGNAL_SCORE_THRESHOLD + 5;

  if (score >= effectiveThreshold && reasons.length > 0 && signalType) {
    return {
      symbol,
      price: currentPrice,
      price1h: currentPrice1h,
      score,
      type: signalType,
      rsi: rsi15m.toFixed(1),
      rsi1h: rsi1h.toFixed(1),
      stochRSI: stoch15m ? stoch15m.k.toFixed(1) : null,
      macdBullish: macd15m.bullish,
      macdBullish1h: macd1h.bullish,
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

async function sendTelegramNotification(signals) {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram disabled or missing credentials');
    return { success: false, reason: 'disabled' };
  }

  if (signals.length === 0) {
    return { success: true, sent: 0 };
  }

  // Helper to ensure values are safe for MarkdownV2
  const esc = (val) => escapeMarkdownV2(val !== undefined && val !== null ? val : '');

  let message = '🔔 *DAY TRADE ALERT* 🔔\n';
  message += `_${esc('15m • Multi-TF • Order Flow')}_\n\n`;

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

    // Score and Badges
    if (sig.hasPattern || sig.hasDivergence) {
      let badges = [];
      if (sig.hasDivergence) badges.push('🔥DIV');
      if (sig.hasPattern) badges.push('🕯️PAT');
      message += `🎯 Score: ${esc(sig.score)}/100 ${badges.join(' ')}\n`;
    } else {
      message += `🎯 Score: ${esc(sig.score)}/100\n`;
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

async function runAnalysis() {
  console.log('--- DAY TRADE Analysis Started ---');
  console.log('Time:', new Date().toISOString());

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
      if (USE_MULTI_TF) {
        candles1h = await getKlines(symbol, '60m', 200);
      } else {
        candles1h = candles15m.slice(-200);
      }

      analyzed++;

      const signal = generateSignal(symbol, candles15m, candles1h, orderBook, ticker24h);
      if (signal) {
        const reasonKey = Array.isArray(signal.reasons) && signal.reasons.length > 0 ? signal.reasons[0] : '';
        const key = `${signal.symbol}:${signal.type}:${reasonKey}`;
        const now = Date.now();
        const lastTs = lastNotifiedAtByKey.get(key) || 0;
        const cooldownMs = Math.max(0, ALERT_COOLDOWN_MIN) * 60 * 1000;
        if (cooldownMs > 0 && now - lastTs < cooldownMs) {
          console.log(`Signal skipped (cooldown): ${symbol} - Type: ${signal.type}`);
        } else {
          lastNotifiedAtByKey.set(key, now);
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

  let telegramResult = { success: true, sent: 0 };
  if (signals.length > 0) {
    telegramResult = await sendTelegramNotification(signals);
  } else {
    console.log('No significant signals detected this cycle');
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

const scheduledHandler = async (event) => {
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
      const result = await runAnalysis();
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

  const result = await runAnalysis();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  };
};

export const handler = schedule("*/15 * * * *", scheduledHandler);
