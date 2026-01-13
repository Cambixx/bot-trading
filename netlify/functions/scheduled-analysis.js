/**
 * Netlify Scheduled Function - Advanced Background Trading Analysis
 * Uses Binance Public API for OHLCV + Order Book metrics.
 * Implements real indicators: RSI, MACD, Bollinger Bands, ATR, VWAP, Order Book Imbalance.
 * Runs on a schedule to detect fewer, stronger alerts and send Telegram notifications.
 */

import { schedule } from "@netlify/functions";

console.log('--- MEXC Advanced Analysis Module Loaded ---');

// Environment Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 70;
const MAX_SPREAD_BPS = process.env.MAX_SPREAD_BPS ? Number(process.env.MAX_SPREAD_BPS) : 10;
const MIN_DEPTH_QUOTE = process.env.MIN_DEPTH_QUOTE ? Number(process.env.MIN_DEPTH_QUOTE) : 50000;
const MIN_ATR_PCT = process.env.MIN_ATR_PCT ? Number(process.env.MIN_ATR_PCT) : 0.25;
const MAX_ATR_PCT = process.env.MAX_ATR_PCT ? Number(process.env.MAX_ATR_PCT) : 8;
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

function generateSignal(symbol, candles, orderBook, ticker24h) {
  if (!candles || candles.length < 201) return null;

  const closedCandles = candles.slice(0, -1);
  if (closedCandles.length < 200) return null;

  const closes = closedCandles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];

  const obMetrics = calculateOrderBookMetrics(orderBook);
  if (!obMetrics) return null;

  if (obMetrics.spreadBps > MAX_SPREAD_BPS) return null;
  if (obMetrics.depthQuoteTopN < MIN_DEPTH_QUOTE) return null;

  // Core indicators
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const ema200 = calculateEMA(closes, 200); // Trend Filter

  // Advanced indicators
  const volumeSMA = calculateVolumeSMA(closedCandles, 20);
  const currentVolume = closedCandles[closedCandles.length - 1].volume;
  const divergences = detectDivergences(closedCandles, closes);
  const atr = calculateATR(closedCandles, 14);
  const atrPercent = atr ? (atr / currentPrice) * 100 : null;
  if (!atrPercent || atrPercent < MIN_ATR_PCT || atrPercent > MAX_ATR_PCT) return null;

  const vwap = calculateVWAP(closedCandles, 50);
  const vwapDistancePct = vwap ? ((currentPrice - vwap) / vwap) * 100 : null;

  const lastCandle = closedCandles[closedCandles.length - 1];
  const takerBuyBase = Number.isFinite(lastCandle.takerBuyBaseVolume) ? lastCandle.takerBuyBaseVolume : null;
  const totalBaseVol = Number(lastCandle.volume);
  const buyRatio = takerBuyBase !== null && totalBaseVol > 0 ? takerBuyBase / totalBaseVol : null;
  const deltaRatio = buyRatio === null ? null : (2 * buyRatio - 1);

  if (!rsi || !macd || !bb || !ema200) return null;

  let score = 0;
  const reasons = [];
  let signalType = null; // BUY, SELL_ALERT, WATCH

  // Trend Direction (EMA 200)
  const isUptrend = currentPrice > ema200;

  // Volume Validation
  const volumeRatio = volumeSMA ? currentVolume / volumeSMA : 1;
  const volumeMultiplier = volumeRatio > 1.5 ? 1.2 : (volumeRatio > 1.0 ? 1.05 : 0.95);

  const quoteVol24h = ticker24h ? Number(ticker24h.quoteVolume) : null;
  if (!quoteVol24h || !Number.isFinite(quoteVol24h) || quoteVol24h < MIN_QUOTE_VOL_24H) return null;

  // === 1. DIVERGENCES (High Weight) ===
  if (divergences.length > 0) {
    const sortedDivs = divergences.sort((a, b) => b.strength - a.strength); // Strongest first
    const bestDiv = sortedDivs[0];

    if (bestDiv.type === 'BULLISH') {
      // Filter: Only take Regular Bullish if RSI < 45 (Not too high)
      // Filter: Only take Hidden Bullish if in Uptrend (EMA200)
      if (bestDiv.name.includes('Hidden')) {
        if (isUptrend) {
          score += 35;
          reasons.unshift(`💎 ${bestDiv.name}`);
          signalType = 'BUY';
        }
      } else {
        // Regular divergence - good for reversal
        if (rsi < 50) {
          score += 30;
          reasons.unshift(`🔥 ${bestDiv.name}`);
          signalType = 'BUY';
        }
      }
    } else if (bestDiv.type === 'BEARISH') {
      if (bestDiv.name.includes('Hidden')) {
        if (!isUptrend) {
          score += 35;
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

  // === 2. MACD + BOLLINGER COMBO (Squeeze & Breakout) ===
  // Bullish Breakout w/ MACD
  if (currentPrice > bb.upper && macd.bullish && macd.histogram > 0) {
    if (isUptrend) {
      score += 25;
      reasons.push('🚀 Breakout Bollinger + MACD Bullish (Tendencia)');
      signalType = signalType || 'BUY';
    } else {
      score += 15;
      reasons.push('🚀 Breakout Bollinger + MACD Bullish');
    }
  }

  // Reversal from Lower Band
  if (currentPrice <= bb.lower * 1.005 && currentPrice > prevPrice && macd.bullish) {
    score += 20;
    reasons.push('🛡️ Rebote en Bollinger Inferior + MACD');
    signalType = signalType || 'BUY';
  }

  // === 3. RSI EXTREME ZONES ===
  if (rsi < 30) {
    score += 25;
    reasons.push(`⚡ RSI Sobreventa extrema (${rsi.toFixed(1)})`);
    signalType = signalType || 'BUY';
  } else if (rsi > 70) {
    score += 25;
    reasons.push(`⚠️ RSI Sobrecompra (${rsi.toFixed(1)})`);
    signalType = signalType || 'SELL_ALERT';
  }

  // === 4. TREND CONFLUENCE ===
  if (signalType === 'BUY' && isUptrend) {
    score += 15;
    reasons.push('✅ A favor de tendencia principal (EMA200)');
  }

  if (signalType === 'SELL_ALERT' && !isUptrend) {
    score += 15;
    reasons.push('✅ A favor de tendencia bajista (EMA200)');
  }

  const direction = signalType === 'BUY' ? 1 : signalType === 'SELL_ALERT' ? -1 : 0;
  if (direction !== 0 && deltaRatio !== null) {
    const aligned = direction === 1 ? deltaRatio > 0.05 : deltaRatio < -0.05;
    if (aligned) {
      score += 10;
      reasons.push('📈 Order flow alineado (taker imbalance)');
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

  // Apply Volume Multiplier
  score = Math.max(0, Math.min(100, Math.round(score * volumeMultiplier)));
  if (volumeRatio > 1.5) reasons.push(`📊 Alto Volumen x${volumeRatio.toFixed(1)}`);

  // Final Decision Threshold
  const bbPercentage = ((currentPrice - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(0);

  // Need higher score for non-trend trades
  const effectiveThreshold = isUptrend ? SIGNAL_SCORE_THRESHOLD : SIGNAL_SCORE_THRESHOLD + 10;

  if (score >= effectiveThreshold && reasons.length > 0 && signalType) {
    return {
      symbol,
      price: currentPrice,
      score,
      type: signalType || 'WATCH',
      rsi: rsi.toFixed(1),
      rsiValue: rsi,
      macdBullish: macd.bullish,
      priceChange1h: ((currentPrice - prevPrice) / prevPrice * 100).toFixed(2),
      bbPosition: `${bbPercentage}%`,
      hasDivergence: divergences.length > 0,
      volumeConfirmed: volumeRatio > 1.2,
      spreadBps: Number(obMetrics.spreadBps.toFixed(1)),
      depthQuoteTopN: Math.round(obMetrics.depthQuoteTopN),
      obi: Number(obMetrics.obi.toFixed(3)),
      atrPercent: atrPercent ? Number(atrPercent.toFixed(2)) : null,
      vwapDistancePct: vwapDistancePct ? Number(vwapDistancePct.toFixed(2)) : null,
      deltaRatio: deltaRatio === null ? null : Number(deltaRatio.toFixed(3)),
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

  let message = '🔔 *ANÁLISIS TÉCNICO AUTOMÁTICO* 🔔\n';
  message += `_${escapeMarkdownV2('Volumen • Order Book • RSI • MACD • Bollinger')}_\n\n`;

  const sortedSignals = [...signals].sort((a, b) => {
    const rsiA = Number.isFinite(a.rsiValue) ? a.rsiValue : 50;
    const rsiB = Number.isFinite(b.rsiValue) ? b.rsiValue : 50;
    const extremityA = Math.abs(rsiA - 50);
    const extremityB = Math.abs(rsiB - 50);
    return extremityB - extremityA;
  });

  for (const sig of sortedSignals.slice(0, 5)) {
    let icon = '📊';
    let typeEmoji = '';
    if (sig.type === 'BUY') { icon = '🟢'; typeEmoji = 'COMPRA'; }
    else if (sig.type === 'SELL_ALERT') { icon = '🔴'; typeEmoji = 'ALERTA VENTA'; }
    else { typeEmoji = 'VIGILAR'; }

    message += `${icon} *${escapeMarkdownV2(sig.symbol)}* \\| ${escapeMarkdownV2(typeEmoji)}\n`;

    if (Number.isFinite(sig.price)) {
      const priceStr = sig.price < 1 ? sig.price.toFixed(6) : sig.price.toFixed(2);
      if (sig.priceChange1h !== undefined && sig.priceChange1h !== null) {
        const ch = Number(sig.priceChange1h);
        const changeIcon = Number.isFinite(ch) && ch >= 0 ? '📈' : '📉';
        const changeSign = Number.isFinite(ch) && ch >= 0 ? '+' : '';
        message += `💰 $${escapeMarkdownV2(priceStr)} ${changeIcon} ${escapeMarkdownV2(changeSign + sig.priceChange1h)}% \\(1h\\)\n`;
      } else {
        message += `💰 $${escapeMarkdownV2(priceStr)}\n`;
      }
    }

    if (sig.rsi !== undefined || sig.bbPosition !== undefined || sig.macdBullish !== undefined) {
      const rsiText = sig.rsi !== undefined && sig.rsi !== null ? String(sig.rsi) : 'N/A';
      const bbText = sig.bbPosition !== undefined && sig.bbPosition !== null ? String(sig.bbPosition) : 'N/A';
      const macdText = sig.macdBullish === true ? 'MACD\\+' : sig.macdBullish === false ? 'MACD\\-' : 'MACD\\?';
      message += `📊 RSI: ${escapeMarkdownV2(rsiText)} \\| BB: ${escapeMarkdownV2(bbText)} \\| ${macdText}\n`;
    }

    if (sig.spreadBps !== undefined || sig.obi !== undefined || sig.depthQuoteTopN !== undefined) {
      const spreadText = sig.spreadBps !== undefined && sig.spreadBps !== null ? String(sig.spreadBps) : 'N/A';
      const obiText = sig.obi !== undefined && sig.obi !== null ? String(sig.obi) : 'N/A';
      const depthText = sig.depthQuoteTopN !== undefined && sig.depthQuoteTopN !== null ? String(sig.depthQuoteTopN) : 'N/A';
      message += `📚 Spread: ${escapeMarkdownV2(spreadText)} bps \\| OBI: ${escapeMarkdownV2(obiText)} \\| Depth: ${escapeMarkdownV2(depthText)}\n`;
    }

    if (sig.atrPercent !== undefined && sig.atrPercent !== null) {
      message += `🌀 ATR: ${escapeMarkdownV2(String(sig.atrPercent))}%`;
      if (sig.vwapDistancePct !== undefined && sig.vwapDistancePct !== null) message += ` \\| VWAPΔ: ${escapeMarkdownV2(String(sig.vwapDistancePct))}%`;
      if (sig.deltaRatio !== undefined && sig.deltaRatio !== null) message += ` \\| Δ: ${escapeMarkdownV2(String(sig.deltaRatio))}`;
      message += `\n`;
    }

    // Show special badges for divergence and volume
    let badges = [];
    if (sig.hasDivergence) badges.push('🔥DIV');
    if (sig.volumeConfirmed) badges.push('📊VOL');
    const badgeStr = badges.length > 0 ? ` ${badges.join(' ')}` : '';

    const scoreText = Number.isFinite(sig.score) ? String(sig.score) : 'N/A';
    message += `🎯 Score: ${escapeMarkdownV2(scoreText)}/100${escapeMarkdownV2(badgeStr)}\n`;

    const reasonsArr = Array.isArray(sig.reasons) ? sig.reasons : [];
    if (reasonsArr.length > 0) {
      message += `💡 _${escapeMarkdownV2(reasonsArr[0])}_\n`;
    }

    message += `───────────────────\n`;
  }

  const timeStr = new Date().toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });
  message += `🤖 _Análisis avanzado_ • ${escapeMarkdownV2(timeStr)}`;

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
      const candles = await getKlines(symbol, '60m', 300);
      const orderBook = await getOrderBookDepth(symbol, 20);
      const ticker24h = tickersBySymbol.get(symbol) || null;
      analyzed++;

      const signal = generateSignal(symbol, candles, orderBook, ticker24h);
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
  const method = event && event.httpMethod ? String(event.httpMethod).toUpperCase() : '';

  if (method) {
    if (method !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Method not allowed' })
      };
    }

    const headers = event.headers || {};
    const clientSecret = headers['x-notify-secret'] || headers['X-Notify-Secret'] || headers['x-notify-Secret'] || '';
    if (NOTIFY_SECRET && clientSecret !== NOTIFY_SECRET) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Unauthorized' })
      };
    }

    let payload = null;
    try {
      payload = event.body ? JSON.parse(event.body) : null;
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid JSON body' })
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
