/**
 * Netlify Scheduled Function - Advanced Day Trading Analysis (15m)
 * Optimized for aggressive day trading with 15m timeframe
 * Uses MEXC Public API for OHLCV + Order Book metrics
 * Implements: RSI, MACD, Bollinger, ATR, VWAP, Stochastic, CCI, EMAs, Pivot Points, S/R, Candle Patterns
 * Calculates TP/SL levels and provides detailed entry signals with multi-timeframe confirmation
 */

import { schedule } from "@netlify/functions";

console.log('--- MEXC Advanced Analysis Module Loaded ---');

// Environment Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 60;
const MAX_SPREAD_BPS = process.env.MAX_SPREAD_BPS ? Number(process.env.MAX_SPREAD_BPS) : 10;
const MIN_DEPTH_QUOTE = process.env.MIN_DEPTH_QUOTE ? Number(process.env.MIN_DEPTH_QUOTE) : 50000;
const MIN_ATR_PCT = process.env.MIN_ATR_PCT ? Number(process.env.MIN_ATR_PCT) : 0.5;
const MAX_ATR_PCT = process.env.MAX_ATR_PCT ? Number(process.env.MAX_ATR_PCT) : 5;
const QUOTE_ASSET = (process.env.QUOTE_ASSET || 'USDT').toUpperCase();
const MAX_SYMBOLS = process.env.MAX_SYMBOLS ? Number(process.env.MAX_SYMBOLS) : 15;
const MIN_QUOTE_VOL_24H = process.env.MIN_QUOTE_VOL_24H ? Number(process.env.MIN_QUOTE_VOL_24H) : 5000000;
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || '';
const ALERT_COOLDOWN_MIN = process.env.ALERT_COOLDOWN_MIN ? Number(process.env.ALERT_COOLDOWN_MIN) : 60;

const lastNotifiedAtByKey = new Map();

// Migrado a MEXC para evitar bloques territoriales (HTTP 451) de Binance en Netlify
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
  return String(text).replace(/([[\]_*()~`>#+\-=|{}.!])/g, '\\$1');
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

// ==================== MARKET DATA ====================

async function getKlines(symbol, interval = '60m', limit = 300) {
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

  return json.map(candle => ({
    time: Number(candle[0]),
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5]),
    quoteVolume: Number(candle[7]),
    trades: candle[8] ? Number(candle[8]) : 0,
    takerBuyBaseVolume: candle[9] ? Number(candle[9]) : null,
    takerBuyQuoteVolume: candle[10] ? Number(candle[10]) : null
  }));
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

/**
 * Selecciona los mejores símbolos para trading basándose en una combinación
 * de Volumen (liquidez) y Volatilidad (oportunidad de movimiento).
 */
function getTopSymbolsByOpportunity(tickers, quoteAsset, limit, minQuoteVolume) {
  const stableBases = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI', 'EUR', 'GBP']);

  const candidates = tickers
    .filter(t => typeof t.symbol === 'string' && t.symbol.endsWith(quoteAsset))
    .filter(t => {
      const base = t.symbol.slice(0, -quoteAsset.length);
      if (!base || stableBases.has(base)) return false;
      // Filtrar tokens apalancados o basura
      if (base.endsWith('UP') || base.endsWith('DOWN') || base.endsWith('BULL') || base.endsWith('BEAR')) return false;

      const quoteVol = Number(t.quoteVolume);
      return Number.isFinite(quoteVol) && quoteVol >= minQuoteVolume;
    })
    .map(t => {
      const high = Number(t.highPrice || 0);
      const low = Number(t.lowPrice || 0);
      const volume = Number(t.quoteVolume || 0);

      // Volatilidad 24h en %
      const volatility = low > 0 ? ((high - low) / low) * 100 : 0;

      // Score de Oportunidad: combina volumen (logarítmico para no sesgar solo a BTC)
      // con la volatilidad. Buscamos monedas líquidas que se estén moviendo.
      const opportunityScore = (Math.log10(volume) * 0.4) + (volatility * 0.6);

      return { symbol: t.symbol, opportunityScore };
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


// Calculate ATR (Average True Range) for volatility
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

// Calculate volume SMA for volume analysis
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

  const depthQuoteTopN = totalNotional;

  return { spreadBps, depthQuoteTopN, obi };
}

function calculateStochastic(candles, kPeriod = 14, dPeriod = 3, smoothK = 3) {
  if (!candles || candles.length < kPeriod + smoothK) return null;

  const lows = candles.map(c => c.low);
  const highs = candles.map(c => c.high);
  const closes = candles.map(c => c.close);

  const rawKValues = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const recentHigh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const recentLow = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    const rawK = recentHigh - recentLow === 0 ? 50 : ((closes[i] - recentLow) / (recentHigh - recentLow)) * 100;
    rawKValues.push(rawK);
  }

  if (rawKValues.length < smoothK + dPeriod) return null;

  const kValues = [];
  for (let i = smoothK - 1; i < rawKValues.length; i++) {
    const smoothedK = rawKValues.slice(i - smoothK + 1, i + 1).reduce((a, b) => a + b, 0) / smoothK;
    kValues.push(smoothedK);
  }

  const dValues = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    const d = kValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod;
    dValues.push(d);
  }

  const lastK = kValues[kValues.length - 1];
  const lastD = dValues[dValues.length - 1];
  const prevK = kValues.length > 1 ? kValues[kValues.length - 2] : lastK;
  const prevD = dValues.length > 1 ? dValues[dValues.length - 2] : lastD;

  return {
    k: lastK,
    d: lastD,
    prevK,
    prevD,
    oversold: lastK < 20 && lastD < 20,
    overbought: lastK > 80 && lastD > 80,
    bullishCross: prevK <= prevD && lastK > lastD,
    bearishCross: prevK >= prevD && lastK < lastD,
    bullish: lastK > lastD
  };
}

function calculateCCI(candles, period = 20) {
  if (!candles || candles.length < period) return null;

  const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
  const sma = typicalPrices.slice(-period).reduce((a, b) => a + b, 0) / period;
  const meanDeviation = typicalPrices.slice(-period).reduce((sum, tp) => sum + Math.abs(tp - sma), 0) / period;

  if (meanDeviation === 0) return null;

  const currentCCI = (typicalPrices[typicalPrices.length - 1] - sma) / (0.015 * meanDeviation);

  return {
    value: currentCCI,
    oversold: currentCCI < -100,
    overbought: currentCCI > 100,
    bullish: currentCCI > 0
  };
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

function calculateMACDCrossover(candles) {
  if (!candles || candles.length < 26 + 9) return null;

  const closes = candles.map(c => c.close);
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

  const signalSeries = calculateEMASeries(macdValues, 9);
  if (!signalSeries) return null;

  const lastMACD = macdValues[macdValues.length - 1];
  const lastSignal = signalSeries[signalSeries.length - 1];
  const prevMACD = macdValues.length > 1 ? macdValues[macdValues.length - 2] : lastMACD;
  const prevSignal = signalSeries.length > 1 ? signalSeries[signalSeries.length - 2] : lastSignal;

  return {
    macd: lastMACD,
    signal: lastSignal,
    histogram: lastMACD - lastSignal,
    bullish: lastMACD > lastSignal,
    bullishCross: prevMACD <= prevSignal && lastMACD > lastSignal,
    bearishCross: prevMACD >= prevSignal && lastMACD < lastSignal
  };
}

function calculateEMACrossover(candles, fastPeriod = 9, slowPeriod = 21) {
  if (!candles || candles.length < slowPeriod + 1) return null;

  const closes = candles.map(c => c.close);
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  const emaFastPrev = calculateEMA(closes.slice(0, -1), fastPeriod);
  const emaSlowPrev = calculateEMA(closes.slice(0, -1), slowPeriod);

  if (emaFast === null || emaSlow === null || emaFastPrev === null || emaSlowPrev === null) return null;

  return {
    emaFast,
    emaSlow,
    bullish: emaFast > emaSlow,
    bullishCross: emaFastPrev <= emaSlowPrev && emaFast > emaSlow,
    bearishCross: emaFastPrev >= emaSlowPrev && emaFast < emaSlow
  };
}

async function getDailyKlines(symbol, limit = 2) {
  const url = `${MEXC_API}/klines?symbol=${symbol}&interval=1d&limit=${limit}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) return null;

  const json = await response.json();
  if (!Array.isArray(json)) return null;

  return json.map(candle => ({
    time: Number(candle[0]),
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5])
  }));
}

function calculatePivotPoints(dailyCandle) {
  if (!dailyCandle) return null;

  const { high, low, close } = dailyCandle;
  const pp = (high + low + close) / 3;
  const r1 = (2 * pp) - low;
  const s1 = (2 * pp) - high;
  const r2 = pp + (high - low);
  const s2 = pp - (high - low);

  return { pp, r1, r2, s1, s2 };
}

function calculateDynamicLevels(candles, lookback = 20) {
  if (!candles || candles.length < lookback) return null;

  const recent = candles.slice(-lookback);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);
  const close = candles[candles.length - 1].close;

  const highest = Math.max(...highs);
  const lowest = Math.min(...lows);

  const resistanceLevels = [];
  const supportLevels = [];

  highs.forEach(h => {
    if (h > close && !resistanceLevels.includes(h)) resistanceLevels.push(h);
  });

  lows.forEach(l => {
    if (l < close && !supportLevels.includes(l)) supportLevels.push(l);
  });

  resistanceLevels.sort((a, b) => a - close);
  supportLevels.sort((a, b) => close - a);

  const nearestResistance = resistanceLevels[0] || null;
  const nearestSupport = supportLevels[0] || null;

  const resistanceDistance = nearestResistance ? ((nearestResistance - close) / close) * 100 : null;
  const supportDistance = nearestSupport ? ((close - nearestSupport) / close) * 100 : null;

  return {
    highest,
    lowest,
    nearestResistance,
    nearestSupport,
    resistanceDistance,
    supportDistance,
    isNearResistance: resistanceDistance !== null && resistanceDistance < 1,
    isNearSupport: supportDistance !== null && supportDistance < 1
  };
}

function detectCandlePatterns(candles) {
  if (!candles || candles.length < 3) return [];

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  const bodySize = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const totalRange = last.high - last.low;
  const prevBodySize = Math.abs(prev.close - prev.open);

  const patterns = [];

  const isBullish = last.close > last.open;
  const isBearish = last.close < last.open;

  if (totalRange === 0) return patterns;

  const bodyRatio = bodySize / totalRange;
  const upperWickRatio = upperWick / totalRange;
  const lowerWickRatio = lowerWick / totalRange;

  if (lowerWickRatio > 0.6 && bodyRatio < 0.3 && upperWickRatio < 0.1) {
    patterns.push({ name: 'Hammer', type: 'BULLISH', strength: 20 });
  }

  if (upperWickRatio > 0.6 && bodyRatio < 0.3 && lowerWickRatio < 0.1) {
    patterns.push({ name: 'Shooting Star', type: 'BEARISH', strength: 20 });
  }

  if (isBullish && prev.isBearish && last.open <= prev.low && last.close >= prev.open) {
    patterns.push({ name: 'Bullish Engulfing', type: 'BULLISH', strength: 25 });
  }

  if (isBearish && prev.isBullish && last.open >= prev.high && last.close <= prev.open) {
    patterns.push({ name: 'Bearish Engulfing', type: 'BEARISH', strength: 25 });
  }

  if (bodyRatio < 0.05 && upperWickRatio < 0.1 && lowerWickRatio < 0.1) {
    patterns.push({ name: 'Doji', type: 'NEUTRAL', strength: 10 });
  }

  if (prev2.close > prev2.open && prev.close < prev.open && last.close > last.open &&
      last.close > (prev.open + prev.close) / 2 && prev2.close > prev.open) {
    patterns.push({ name: 'Morning Star', type: 'BULLISH', strength: 30 });
  }

  if (prev2.close < prev2.open && prev.close > prev.open && last.close < last.open &&
      last.close < (prev.open + prev.close) / 2 && prev2.close < prev.open) {
    patterns.push({ name: 'Evening Star', type: 'BEARISH', strength: 30 });
  }

  if (last.isBullish && prev.isBullish && prev2.isBullish &&
      last.close > prev.close && prev.close > prev2.close &&
      last.close > last.open && prev.close > prev.open && prev2.close > prev2.open) {
    patterns.push({ name: 'Three White Soldiers', type: 'BULLISH', strength: 35 });
  }

  if (last.isBearish && prev.isBearish && prev2.isBearish &&
      last.close < prev.close && prev.close < prev2.close &&
      last.close < last.open && prev.close < prev.open && prev2.close < prev2.open) {
    patterns.push({ name: 'Three Black Crows', type: 'BEARISH', strength: 35 });
  }

  return patterns;
}

function calculateTPSL(price, atr, signalType, riskMultiplier = 1.5) {
  if (!atr || !price) return null;

  const slDistance = atr * riskMultiplier;
  const tp1Distance = atr * 2;
  const tp2Distance = atr * 3;

  let sl, tp1, tp2;

  if (signalType === 'BUY') {
    sl = price - slDistance;
    tp1 = price + tp1Distance;
    tp2 = price + tp2Distance;
  } else {
    sl = price + slDistance;
    tp1 = price - tp1Distance;
    tp2 = price - tp2Distance;
  }

  const riskReward1 = Math.abs(tp1Distance / slDistance);
  const riskReward2 = Math.abs(tp2Distance / slDistance);

  return {
    sl,
    tp1,
    tp2,
    slPercent: ((sl - price) / price * 100).toFixed(2),
    tp1Percent: ((tp1 - price) / price * 100).toFixed(2),
    tp2Percent: ((tp2 - price) / price * 100).toFixed(2),
    riskReward1: riskReward1.toFixed(1),
    riskReward2: riskReward2.toFixed(1)
  };
}

// ==================== SIGNAL GENERATION ====================

// Detect regular and hidden RSI divergences
function detectDivergences(candles, closes) {
  if (candles.length < 50) return [];

  const lookback = 30; // Look deeper for divergences
  const recentCloses = closes.slice(-lookback);

  // Calculate RSI sequence
  const rsiValues = [];
  // Need enough data for RSI calculation
  const rsiStartIndex = closes.length - lookback - 15;
  if (rsiStartIndex < 0) return [];

  for (let i = rsiStartIndex; i < closes.length; i++) {
    // This is a bit inefficient (recalculating full RSI each step) but safe given function structure
    // Optimally we'd calc all RSIs once. Let's rely on the main simple logic for now or optimize slightly
    // Actually, let's just use the RSI function which returns scalar, so we loop:
    const subset = closes.slice(0, i + 1);
    const val = calculateRSI(subset, 14);
    if (val !== null) rsiValues.push({ index: i, value: val });
  }

  // We need at least lookback amount of RSI values aligned with closes
  if (rsiValues.length < lookback) return [];

  // Align RSI with Price for the lookback window
  const alignedRSI = rsiValues.slice(-lookback);
  const alignedPrice = recentCloses.map((price, idx) => ({
    index: closes.length - lookback + idx,
    value: price
  }));

  // Find pivots
  const findPivots = (data, isHigh) => {
    const pivots = [];
    // Check 2 bars left/right for pivot
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

  // Helper to check conditions
  const checkDiv = (p1, p2, r1, r2, type, name) => {
    // Ensure sufficient time separation but not too far
    const timeDiff = Math.abs(p2.index - p1.index);
    if (timeDiff < 5 || timeDiff > 40) return; // Must be at least 5 candles apart

    // Ensure strict pivot matching within tolerance (2 candles)
    const match1 = Math.abs(p1.index - r1.index) <= 2;
    const match2 = Math.abs(p2.index - r2.index) <= 2;

    if (match1 && match2) {
      divergences.push({ type, name, strength: Math.abs(r1.value - r2.value) });
    }
  };

  // 1. Regular Bullish: Price Lower Low, RSI Higher Low
  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const p2 = priceLows[priceLows.length - 1]; // Recent
    const p1 = priceLows[priceLows.length - 2]; // Previous
    const r2 = rsiLows[rsiLows.length - 1];
    const r1 = rsiLows[rsiLows.length - 2];

    if (p2.value < p1.value && r2.value > r1.value) {
      checkDiv(p1, p2, r1, r2, 'BULLISH', 'Regular Bullish Divergence');
    }
  }

  // 2. Regular Bearish: Price Higher High, RSI Lower High
  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const p2 = priceHighs[priceHighs.length - 1];
    const p1 = priceHighs[priceHighs.length - 2];
    const r2 = rsiHighs[rsiHighs.length - 1];
    const r1 = rsiHighs[rsiHighs.length - 2];

    if (p2.value > p1.value && r2.value < r1.value) {
      checkDiv(p1, p2, r1, r2, 'BEARISH', 'Regular Bearish Divergence');
    }
  }

  // 3. Hidden Bullish: Price Higher Low, RSI Lower Low (Trend Continuation)
  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const p2 = priceLows[priceLows.length - 1];
    const p1 = priceLows[priceLows.length - 2];
    const r2 = rsiLows[rsiLows.length - 1];
    const r1 = rsiLows[rsiLows.length - 2];

    if (p2.value > p1.value && r2.value < r1.value) {
      checkDiv(p1, p2, r1, r2, 'BULLISH', 'Hidden Bullish Divergence (Trend Cont.)');
    }
  }

  // 4. Hidden Bearish: Price Lower High, RSI Higher High (Trend Continuation)
  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const p2 = priceHighs[priceHighs.length - 1];
    const p1 = priceHighs[priceHighs.length - 2];
    const r2 = rsiHighs[rsiHighs.length - 1];
    const r1 = rsiHighs[rsiHighs.length - 2];

    if (p2.value < p1.value && r2.value > r1.value) {
      checkDiv(p1, p2, r1, r2, 'BEARISH', 'Hidden Bearish Divergence (Trend Cont.)');
    }
  }

  return divergences;
}

async function generateSignal(symbol, candles, orderBook, ticker24h) {
  if (!candles || candles.length < 101) return null;

  const closedCandles = candles.slice(0, -1);
  if (closedCandles.length < 100) return null;

  const closes = closedCandles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];

  const obMetrics = calculateOrderBookMetrics(orderBook);
  if (!obMetrics) return null;

  if (obMetrics.spreadBps > MAX_SPREAD_BPS) return null;
  if (obMetrics.depthQuoteTopN < MIN_DEPTH_QUOTE) return null;

  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACDCrossover(closedCandles);
  const bb = calculateBollingerBands(closes, 15, 2);
  const ema200 = calculateEMA(closes, 200);

  const stochastic = calculateStochastic(closedCandles, 14, 3, 3);
  const cci = calculateCCI(closedCandles, 20);
  const emaCrossover = calculateEMACrossover(closedCandles, 9, 21);
  
  let pivotPoints = null;
  try {
    const dailyKlines = await getDailyKlines(symbol, 2);
    if (dailyKlines && dailyKlines.length > 0) {
      pivotPoints = calculatePivotPoints(dailyKlines[0]);
    }
  } catch (e) {
    console.log(`Could not fetch daily data for ${symbol}`);
  }

  const dynamicLevels = calculateDynamicLevels(closedCandles, 20);
  const candlePatterns = detectCandlePatterns(closedCandles);

  const volumeSMA = calculateVolumeSMA(closedCandles, 20);
  const currentVolume = closedCandles[closedCandles.length - 1].volume;
  const divergences = detectDivergences(closedCandles, closes);
  const atr = calculateATR(closedCandles, 14);
  const atrPercent = atr ? (atr / currentPrice) * 100 : null;
  if (!atrPercent || atrPercent < MIN_ATR_PCT || atrPercent > MAX_ATR_PCT) return null;

  const vwap = calculateVWAP(closedCandles, 20);
  const vwapDistancePct = vwap ? ((currentPrice - vwap) / vwap) * 100 : null;

  const lastCandle = closedCandles[closedCandles.length - 1];
  const takerBuyBase = Number.isFinite(lastCandle.takerBuyBaseVolume) ? lastCandle.takerBuyBaseVolume : null;
  const totalBaseVol = Number(lastCandle.volume);
  const buyRatio = takerBuyBase !== null && totalBaseVol > 0 ? takerBuyBase / totalBaseVol : null;
  const deltaRatio = buyRatio === null ? null : (2 * buyRatio - 1);

  if (!rsi || !macd || !bb || !ema200) return null;

  let score = 0;
  const reasons = [];
  let signalType = null;

  const isUptrend = currentPrice > ema200;
  const volumeRatio = volumeSMA ? currentVolume / volumeSMA : 1;
  const volumeMultiplier = volumeRatio > 2 ? 1.15 : (volumeRatio > 1.5 ? 1.1 : (volumeRatio > 1.0 ? 1.05 : 0.9));

  const quoteVol24h = ticker24h ? Number(ticker24h.quoteVolume) : null;
  if (!quoteVol24h || !Number.isFinite(quoteVol24h) || quoteVol24h < MIN_QUOTE_VOL_24H) return null;

  // === 1. DIVERGENCES RSI/CCI (30 points) ===
  if (divergences.length > 0) {
    const sortedDivs = divergences.sort((a, b) => b.strength - a.strength);
    const bestDiv = sortedDivs[0];

    if (bestDiv.type === 'BULLISH') {
      if (bestDiv.name.includes('Hidden')) {
        if (isUptrend) {
          score += 30;
          reasons.unshift(`💎 ${bestDiv.name}`);
          signalType = 'BUY';
        }
      } else {
        if (rsi < 50) {
          score += 30;
          reasons.unshift(`🔥 ${bestDiv.name}`);
          signalType = 'BUY';
        }
      }
    } else if (bestDiv.type === 'BEARISH') {
      if (bestDiv.name.includes('Hidden')) {
        if (!isUptrend) {
          score += 30;
          reasons.unshift(`🔻 ${bestDiv.name}`);
          signalType = 'SELL_ALERT';
        }
      } else {
        if (rsi > 50) {
          score += 30;
          reasons.unshift(`⚠️ ${bestDiv.name}`);
          signalType = 'SELL_ALERT';
        }
      }
    }
  }

  // === 2. STOCHASTIC EXTREME ZONES (20 points) ===
  if (stochastic) {
    if (stochastic.oversold && stochastic.bullishCross) {
      score += 20;
      reasons.push(`📊 Stochastic Sobreventa & Cruzamiento Alcista`);
      signalType = signalType || 'BUY';
    } else if (stochastic.overbought && stochastic.bearishCross) {
      score += 20;
      reasons.push(`📊 Stochastic Sobrecompra & Cruzamiento Bajista`);
      signalType = signalType || 'SELL_ALERT';
    } else if (stochastic.oversold) {
      score += 15;
      reasons.push(`📊 Stochastic Sobreventa (${stochastic.k.toFixed(1)})`);
      signalType = signalType || 'BUY';
    } else if (stochastic.overbought) {
      score += 15;
      reasons.push(`📊 Stochastic Sobrecompra (${stochastic.k.toFixed(1)})`);
      signalType = signalType || 'SELL_ALERT';
    }
  }

  // === 3. CCI EXTREME ZONES (15 points) ===
  if (cci) {
    if (cci.oversold) {
      score += 15;
      reasons.push(`📈 CCI Sobreventa (${cci.value.toFixed(0)})`);
      signalType = signalType || 'BUY';
    } else if (cci.overbought) {
      score += 15;
      reasons.push(`📉 CCI Sobrecompra (${cci.value.toFixed(0)})`);
      signalType = signalType || 'SELL_ALERT';
    }
  }

  // === 4. EMA CROSSOVER (15 points) ===
  if (emaCrossover) {
    if (emaCrossover.bullishCross) {
      score += 15;
      reasons.push(`📈 EMA9 > EMA21 (Cruzamiento Alcista)`);
      signalType = signalType || 'BUY';
    } else if (emaCrossover.bearishCross) {
      score += 15;
      reasons.push(`📉 EMA9 < EMA21 (Cruzamiento Bajista)`);
      signalType = signalType || 'SELL_ALERT';
    } else if (emaCrossover.bullish && signalType === 'BUY') {
      score += 8;
      reasons.push(`✅ Alineado EMA9 > EMA21`);
    } else if (!emaCrossover.bullish && signalType === 'SELL_ALERT') {
      score += 8;
      reasons.push(`✅ Alineado EMA9 < EMA21`);
    }
  }

  // === 5. MACD + BOLLINGER COMBO (15 points) ===
  if (currentPrice > bb.upper && macd.bullish && macd.histogram > 0) {
    if (isUptrend) {
      score += 15;
      reasons.push('🚀 Breakout Bollinger + MACD Bullish (Tendencia)');
      signalType = signalType || 'BUY';
    } else {
      score += 10;
      reasons.push('🚀 Breakout Bollinger + MACD Bullish');
    }
  }

  if (currentPrice <= bb.lower * 1.005 && currentPrice > prevPrice && macd.bullish) {
    score += 15;
    reasons.push('🛡️ Rebote Bollinger Inferior + MACD');
    signalType = signalType || 'BUY';
  }

  // === 6. CANDLE PATTERNS (15 points) ===
  if (candlePatterns.length > 0) {
    const bullishPatterns = candlePatterns.filter(p => p.type === 'BULLISH');
    const bearishPatterns = candlePatterns.filter(p => p.type === 'BEARISH');
    
    if (bullishPatterns.length > 0 && signalType !== 'SELL_ALERT') {
      const bestBullish = bullishPatterns.sort((a, b) => b.strength - a.strength)[0];
      score += bestBullish.strength;
      reasons.push(`🕯️ ${bestBullish.name}`);
      signalType = signalType || 'BUY';
    } else if (bearishPatterns.length > 0 && signalType !== 'BUY') {
      const bestBearish = bearishPatterns.sort((a, b) => b.strength - a.strength)[0];
      score += bestBearish.strength;
      reasons.push(`🕯️ ${bestBearish.name}`);
      signalType = signalType || 'SELL_ALERT';
    }
  }

  // === 7. DYNAMIC S/R LEVELS (10 points) ===
  if (dynamicLevels) {
    if (dynamicLevels.isNearSupport && signalType !== 'SELL_ALERT') {
      score += 10;
      reasons.push(`📍 Cercano a Soporte Dinámico`);
    } else if (dynamicLevels.isNearResistance && signalType !== 'BUY') {
      score += 10;
      reasons.push(`📍 Cercano a Resistencia Dinámica`);
    }
  }

  // === 8. PIVOT POINTS (10 points) ===
  if (pivotPoints) {
    const ppDistance = Math.abs((currentPrice - pivotPoints.pp) / currentPrice) * 100;
    if (ppDistance < 0.5) {
      score += 10;
      reasons.push(`📊 Pivot Point cercano`);
    } else if (signalType === 'BUY' && Math.abs((currentPrice - pivotPoints.s1) / currentPrice) * 100 < 0.5) {
      score += 8;
      reasons.push(`📊 Pivot S1 cercano`);
    } else if (signalType === 'SELL_ALERT' && Math.abs((currentPrice - pivotPoints.r1) / currentPrice) * 100 < 0.5) {
      score += 8;
      reasons.push(`📊 Pivot R1 cercano`);
    }
  }

  // === 9. TREND CONFLUENCE (10 points) ===
  if (signalType === 'BUY' && isUptrend) {
    score += 10;
    reasons.push('✅ A favor tendencia (EMA200)');
  } else if (signalType === 'SELL_ALERT' && !isUptrend) {
    score += 10;
    reasons.push('✅ A favor tendencia bajista (EMA200)');
  }

  // === 10. ORDER FLOW + OBI (10 points) ===
  const direction = signalType === 'BUY' ? 1 : signalType === 'SELL_ALERT' ? -1 : 0;
  if (direction !== 0 && deltaRatio !== null) {
    const aligned = direction === 1 ? deltaRatio > 0.05 : deltaRatio < -0.05;
    if (aligned) {
      score += 10;
      reasons.push('📈 Order flow alineado');
    } else {
      score -= 10;
      reasons.push('⚠️ Order flow no alineado');
    }
  }

  if (direction !== 0) {
    const obiAligned = direction === 1 ? obMetrics.obi > 0.08 : obMetrics.obi < -0.08;
    if (obiAligned) {
      score += 10;
      reasons.push('📚 Book imbalance favorable');
    } else {
      score -= 5;
    }
  }

  // === 11. VOLUME SPIKE (8 points) ===
  if (volumeRatio > 2) {
    score += 8;
    reasons.push(`📊 Volume Spike x${volumeRatio.toFixed(1)}`);
  } else if (volumeRatio > 1.5) {
    score += 5;
    reasons.push(`📊 Volumen Alto x${volumeRatio.toFixed(1)}`);
  }

  score = Math.max(0, Math.min(100, Math.round(score * volumeMultiplier)));

  const bbPercentage = ((currentPrice - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(0);

  if (score >= SIGNAL_SCORE_THRESHOLD && reasons.length > 0 && signalType) {
    const tpsl = calculateTPSL(currentPrice, atr, signalType, 1.5);

    return {
      symbol,
      price: currentPrice,
      score,
      type: signalType || 'WATCH',
      rsi: rsi.toFixed(1),
      rsiValue: rsi,
      stochastic: stochastic ? { k: stochastic.k.toFixed(1), d: stochastic.d.toFixed(1) } : null,
      cci: cci ? cci.value.toFixed(0) : null,
      ema9: emaCrossover ? emaCrossover.emaFast.toFixed(2) : null,
      ema21: emaCrossover ? emaCrossover.emaSlow.toFixed(2) : null,
      macdBullish: macd.bullish,
      macdHistogram: macd.histogram.toFixed(6),
      priceChange15m: ((currentPrice - prevPrice) / prevPrice * 100).toFixed(2),
      bbPosition: `${bbPercentage}%`,
      hasDivergence: divergences.length > 0,
      candlePatterns: candlePatterns.length > 0 ? candlePatterns.map(p => p.name).join(', ') : null,
      volumeConfirmed: volumeRatio > 1.2,
      volumeRatio: volumeRatio.toFixed(2),
      spreadBps: Number(obMetrics.spreadBps.toFixed(1)),
      depthQuoteTopN: Math.round(obMetrics.depthQuoteTopN),
      obi: Number(obMetrics.obi.toFixed(3)),
      atrPercent: atrPercent ? Number(atrPercent.toFixed(2)) : null,
      atrValue: atr ? atr.toFixed(2) : null,
      vwapDistancePct: vwapDistancePct ? Number(vwapDistancePct.toFixed(2)) : null,
      deltaRatio: deltaRatio === null ? null : Number(deltaRatio.toFixed(3)),
      pivotPoints: pivotPoints ? { pp: pivotPoints.pp.toFixed(2), r1: pivotPoints.r1.toFixed(2), s1: pivotPoints.s1.toFixed(2) } : null,
      dynamicLevels: dynamicLevels ? { support: dynamicLevels.nearestSupport?.toFixed(2), resistance: dynamicLevels.nearestResistance?.toFixed(2) } : null,
      tpsl,
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

  let message = '🎯 *ANÁLISIS DAY TRADING 15m* 🎯\n';
  message += `_${escapeMarkdownV2('RSI • MACD • Stoch • CCI • EMAs • Pivots • S/R • Patrones')}_\n\n`;

  const sortedSignals = [...signals].sort((a, b) => b.score - a.score);

  for (const sig of sortedSignals.slice(0, 5)) {
    let icon = '📊';
    let typeEmoji = '';
    if (sig.type === 'BUY') { icon = '🟢'; typeEmoji = 'COMPRA'; }
    else if (sig.type === 'SELL_ALERT') { icon = '🔴'; typeEmoji = 'ALERTA VENTA'; }
    else { typeEmoji = 'VIGILAR'; }

    message += `${icon} *${escapeMarkdownV2(sig.symbol)}* \\| ${escapeMarkdownV2(typeEmoji)}\n`;

    if (Number.isFinite(sig.price)) {
      const priceStr = sig.price < 1 ? sig.price.toFixed(6) : sig.price.toFixed(2);
      if (sig.priceChange15m !== undefined && sig.priceChange15m !== null) {
        const ch = Number(sig.priceChange15m);
        const changeIcon = Number.isFinite(ch) && ch >= 0 ? '📈' : '📉';
        const changeSign = Number.isFinite(ch) && ch >= 0 ? '+' : '';
        message += `💰 $${escapeMarkdownV2(priceStr)} ${changeIcon} ${escapeMarkdownV2(changeSign + sig.priceChange15m)}% \\(15m\\)\n`;
      } else {
        message += `💰 $${escapeMarkdownV2(priceStr)}\n`;
      }
    }

    // TP/SL Section
    if (sig.tpsl) {
      const slIcon = sig.type === 'BUY' ? '🛑' : '🛑';
      const tpIcon = sig.type === 'BUY' ? '🎯' : '🎯';
      message += `${tpIcon} TP1: $${escapeMarkdownV2(sig.tpsl.tp1.toFixed(sig.price < 1 ? 6 : 2))} (${escapeMarkdownV2(sig.tpsl.tp1Percent)}%) \\| `;
      message += `${slIcon} SL: $${escapeMarkdownV2(sig.tpsl.sl.toFixed(sig.price < 1 ? 6 : 2))} (${escapeMarkdownV2(sig.tpsl.slPercent)}%)\n`;
      if (sig.tpsl.riskReward1) {
        message += `📊 R:R ${escapeMarkdownV2(sig.tpsl.riskReward1)}:1 \\| ATR: ${sig.atrPercent ? escapeMarkdownV2(sig.atrPercent + '%') : 'N/A'}\n`;
      }
    }

    // Key Indicators
    let indicators = [];
    if (sig.rsi !== null) indicators.push(`RSI:${escapeMarkdownV2(sig.rsi)}`);
    if (sig.stochastic && sig.stochastic.k !== null) indicators.push(`Stoch:${escapeMarkdownV2(sig.stochastic.k)}`);
    if (sig.cci !== null) indicators.push(`CCI:${escapeMarkdownV2(sig.cci)}`);
    if (indicators.length > 0) {
      message += `📊 ${indicators.join(' \\| ')}\n`;
    }

    // EMAs
    if (sig.ema9 !== null && sig.ema21 !== null) {
      message += `📈 EMA9:${escapeMarkdownV2(sig.ema9)} \\| EMA21:${escapeMarkdownV2(sig.ema21)}`;
      if (sig.ema9 > sig.ema21) message += ` ✅`;
      else message += ` ❌`;
      message += `\n`;
    }

    // MACD + Bollinger
    if (sig.macdBullish !== null || sig.bbPosition !== null) {
      const macdIcon = sig.macdBullish === true ? 'MACD\\+' : 'MACD\\-';
      message += `📊 ${macdIcon} \\| BB:${escapeMarkdownV2(sig.bbPosition)}\n`;
    }

    // Pivot Points & S/R
    let levels = [];
    if (sig.pivotPoints && sig.pivotPoints.pp !== null) {
      levels.push(`PP:${escapeMarkdownV2(sig.pivotPoints.pp)}`);
    }
    if (sig.dynamicLevels) {
      if (sig.dynamicLevels.support !== null) levels.push(`S:${escapeMarkdownV2(sig.dynamicLevels.support)}`);
      if (sig.dynamicLevels.resistance !== null) levels.push(`R:${escapeMarkdownV2(sig.dynamicLevels.resistance)}`);
    }
    if (levels.length > 0) {
      message += `📍 ${levels.join(' \\| ')}\n`;
    }

    // Order Flow
    if (sig.obi !== null || sig.deltaRatio !== null) {
      const obiText = sig.obi !== null ? `OBI:${escapeMarkdownV2(String(sig.obi))}` : '';
      const deltaText = sig.deltaRatio !== null ? `Δ:${escapeMarkdownV2(String(sig.deltaRatio))}` : '';
      if (obiText || deltaText) {
        message += `📚 ${obiText} ${obiText && deltaText ? '\\| ' : ''}${deltaText}\n`;
      }
    }

    // Badges
    let badges = [];
    if (sig.hasDivergence) badges.push('🔥DIV');
    if (sig.volumeConfirmed) badges.push('📊VOL');
    if (sig.candlePatterns && sig.candlePatterns.length > 0) badges.push('🕯️VELA');
    const badgeStr = badges.length > 0 ? ` ${badges.join(' ')}` : '';

    const scoreText = Number.isFinite(sig.score) ? String(sig.score) : 'N/A';
    message += `🎯 Score: ${escapeMarkdownV2(scoreText)}/100${escapeMarkdownV2(badgeStr)}\n`;

    // Main Reason
    const reasonsArr = Array.isArray(sig.reasons) ? sig.reasons : [];
    if (reasonsArr.length > 0) {
      message += `💡 _${escapeMarkdownV2(reasonsArr[0])}_\n`;
    }

    // Candle Pattern
    if (sig.candlePatterns && sig.candlePatterns.length > 0) {
      message += `🕯️ ${escapeMarkdownV2(sig.candlePatterns)}\n`;
    }

    message += `───────────────────\n`;
  }

  const timeStr = new Date().toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });
  message += `🤖 _Day Trading 15m • Análisis avanzado_ • ${escapeMarkdownV2(timeStr)}`;

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
  console.log('--- MEXC Advanced Analysis Started ---');
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
      const candles = await getKlines(symbol, '15m', 200);
      const orderBook = await getOrderBookDepth(symbol, 20);
      const ticker24h = tickersBySymbol.get(symbol) || null;
      analyzed++;

      const signal = await generateSignal(symbol, candles, orderBook, ticker24h);
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

      await new Promise(r => setTimeout(r, 150));

    } catch (error) {
      console.error(`Error analyzing ${symbol}:`, error.message);
      errors++;
      await new Promise(r => setTimeout(r, 150));
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

    const nextRun = payload && typeof payload.next_run === 'string' ? payload.next_run : null;
    const isSchedule = nfEvent === 'schedule' || nextRun !== null;

    console.log('scheduled-analysis invocation:', {
      method,
      isSchedule,
      nfEvent: nfEvent || null
    });

    if (isSchedule) {
      const result = await runAnalysis();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    const clientSecret = headers['x-notify-secret'] || headers['X-Notify-Secret'] || headers['x-notify-Secret'] || '';
    if (NOTIFY_SECRET && clientSecret !== NOTIFY_SECRET) {
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

// Export the scheduled function using Netlify's schedule helper
export const handler = schedule("*/20 * * * *", scheduledHandler);
