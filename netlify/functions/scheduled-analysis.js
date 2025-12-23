/**
 * Netlify Scheduled Function - Advanced Background Trading Analysis
 * Uses CryptoCompare API (free, serverless-friendly) for OHLCV data.
 * Implements real technical indicators: RSI, MACD, Bollinger Bands.
 * Runs every 20 minutes to detect opportunities and send Telegram alerts.
 */

import { schedule } from "@netlify/functions";

console.log('--- CryptoCompare Advanced Analysis Module Loaded ---');

// Environment Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 70; // Raised to 70 for fewer, stronger alerts
const CRYPTOCOMPARE_API_KEY = process.env.CRYPTOCOMPARE_API_KEY || '';

// CryptoCompare API (Free, no key required for basic endpoints)
const CRYPTOCOMPARE_API = 'https://min-api.cryptocompare.com/data/v2';

// Top 40 coins to monitor (with API key we have higher rate limits)
const COINS_TO_MONITOR = [
  'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX',
  'DOT', 'LINK', 'LTC', 'BCH', 'SHIB', 'XLM', 'UNI', 'ATOM',
  'FIL', 'SUI', 'TAO', 'AAVE', 'RUNE', 'MKR', 'INJ', 'FET',
  'NEAR', 'APE', 'OP', 'ARB', 'RNDR', 'GRT', 'IMX', 'ALGO',
  'VET', 'MANA', 'SAND', 'AXS', 'THETA', 'EOS', 'XTZ', 'EGLD'
  // Note: PEPE is not available on CryptoCompare
];

// ==================== HELPERS ====================

function escapeMarkdownV2(text = '') {
  return String(text).replace(/([_\*\[\]\(\)~`>#\+\-=\|\{\}\.\!])/g, '\\$1');
}

async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// ==================== CRYPTOCOMPARE DATA ====================

async function getOHLCVData(symbol, limit = 100) {
  let url = `${CRYPTOCOMPARE_API}/histohour?fsym=${symbol}&tsym=USD&limit=${limit}`;
  if (CRYPTOCOMPARE_API_KEY) {
    url += `&api_key=${CRYPTOCOMPARE_API_KEY}`;
  }

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`CryptoCompare HTTP error: ${response.status}`);
  }

  const json = await response.json();

  if (json.Response !== 'Success') {
    throw new Error(`CryptoCompare: ${json.Message || 'Unknown error'}`);
  }

  if (!json.Data?.Data || json.Data.Data.length === 0) {
    throw new Error(`No data available for ${symbol}`);
  }

  return json.Data.Data.map(candle => ({
    time: candle.time * 1000,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volumefrom
  }));
}

// Fetch daily candles for multi-timeframe analysis
async function getDailyCandles(symbol, limit = 30) {
  let url = `${CRYPTOCOMPARE_API}/histoday?fsym=${symbol}&tsym=USD&limit=${limit}`;
  if (CRYPTOCOMPARE_API_KEY) {
    url += `&api_key=${CRYPTOCOMPARE_API_KEY}`;
  }

  const response = await fetchWithTimeout(url);
  if (!response.ok) return null;

  const json = await response.json();
  if (json.Response !== 'Success' || !json.Data?.Data) return null;

  return json.Data.Data.map(candle => ({
    time: candle.time * 1000,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volumefrom
  }));
}

// Analyze daily trend for multi-timeframe confirmation
function analyzeDailyTrend(dailyCandles) {
  if (!dailyCandles || dailyCandles.length < 20) return null;

  const closes = dailyCandles.map(c => c.close);
  const sma20 = calculateSMA(closes, 20);
  const currentPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];

  if (!sma20) return null;

  const aboveSMA = currentPrice > sma20;
  const priceChange = ((currentPrice - prevPrice) / prevPrice) * 100;

  // Determine trend
  let trend = 'NEUTRAL';
  if (aboveSMA && priceChange > 0) trend = 'BULLISH';
  else if (!aboveSMA && priceChange < 0) trend = 'BEARISH';
  else if (aboveSMA) trend = 'BULLISH_WEAK';
  else trend = 'BEARISH_WEAK';

  return {
    trend,
    aboveSMA20: aboveSMA,
    dailyChange: priceChange.toFixed(1)
  };
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

function calculateMACD(closes) {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  if (ema12 === null || ema26 === null) return null;

  const macdLine = ema12 - ema26;

  return {
    value: macdLine,
    bullish: macdLine > 0,
    histogram: macdLine
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

function calculateSMA(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
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

// Detect RSI divergence - one of the most powerful trading signals
function detectRSIDivergence(candles, closes) {
  if (candles.length < 30) return null;

  // Get price and RSI data for last 20 periods
  const lookback = 20;
  const recentCandles = candles.slice(-lookback);
  const recentCloses = closes.slice(-lookback);

  // Calculate RSI for each point in the lookback period
  const rsiValues = [];
  for (let i = 14; i <= closes.length; i++) {
    const rsi = calculateRSI(closes.slice(0, i), 14);
    if (rsi !== null) rsiValues.push(rsi);
  }

  if (rsiValues.length < lookback) return null;

  const recentRSI = rsiValues.slice(-lookback);

  // Find local lows and highs in the last 10-15 candles
  const findLocalExtremes = (data, isLow = true) => {
    const extremes = [];
    for (let i = 2; i < data.length - 2; i++) {
      if (isLow) {
        if (data[i] < data[i - 1] && data[i] < data[i - 2] &&
          data[i] < data[i + 1] && data[i] < data[i + 2]) {
          extremes.push({ index: i, value: data[i] });
        }
      } else {
        if (data[i] > data[i - 1] && data[i] > data[i - 2] &&
          data[i] > data[i + 1] && data[i] > data[i + 2]) {
          extremes.push({ index: i, value: data[i] });
        }
      }
    }
    return extremes;
  };

  const priceLows = findLocalExtremes(recentCloses, true);
  const priceHighs = findLocalExtremes(recentCloses, false);
  const rsiLows = findLocalExtremes(recentRSI, true);
  const rsiHighs = findLocalExtremes(recentRSI, false);

  // Bullish Divergence: Price makes lower low, RSI makes higher low
  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const lastPriceLow = priceLows[priceLows.length - 1];
    const prevPriceLow = priceLows[priceLows.length - 2];
    const lastRSILow = rsiLows[rsiLows.length - 1];
    const prevRSILow = rsiLows[rsiLows.length - 2];

    // Price lower low + RSI higher low = bullish divergence
    if (lastPriceLow.value < prevPriceLow.value &&
      lastRSILow.value > prevRSILow.value &&
      Math.abs(lastPriceLow.index - lastRSILow.index) <= 3) {
      return { type: 'BULLISH', strength: Math.abs(lastRSILow.value - prevRSILow.value) };
    }
  }

  // Bearish Divergence: Price makes higher high, RSI makes lower high
  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const lastPriceHigh = priceHighs[priceHighs.length - 1];
    const prevPriceHigh = priceHighs[priceHighs.length - 2];
    const lastRSIHigh = rsiHighs[rsiHighs.length - 1];
    const prevRSIHigh = rsiHighs[rsiHighs.length - 2];

    // Price higher high + RSI lower high = bearish divergence
    if (lastPriceHigh.value > prevPriceHigh.value &&
      lastRSIHigh.value < prevRSIHigh.value &&
      Math.abs(lastPriceHigh.index - lastRSIHigh.index) <= 3) {
      return { type: 'BEARISH', strength: Math.abs(prevRSIHigh.value - lastRSIHigh.value) };
    }
  }

  return null;
}

// ==================== SIGNAL GENERATION ====================

function generateSignal(symbol, candles) {
  if (!candles || candles.length < 50) return null;

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];

  // Core indicators
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const sma50 = calculateSMA(closes, 50);

  // Advanced indicators
  const atr = calculateATR(candles, 14);
  const volumeSMA = calculateVolumeSMA(candles, 20);
  const currentVolume = candles[candles.length - 1].volume;
  const divergence = detectRSIDivergence(candles, closes);

  if (!rsi || !macd || !bb) return null;

  let score = 0;
  const reasons = [];
  let signalType = null;

  // Volume multiplier: high volume confirms signals
  const volumeRatio = volumeSMA ? currentVolume / volumeSMA : 1;
  const volumeMultiplier = volumeRatio > 1.5 ? 1.3 : (volumeRatio > 1.0 ? 1.1 : 0.9);

  // === DIVERGENCE SIGNALS (HIGHEST PRIORITY) ===
  if (divergence) {
    if (divergence.type === 'BULLISH') {
      score += 40; // Very high weight for divergence
      reasons.unshift(`� DIVERGENCIA ALCISTA detectada`);
      signalType = 'BUY';
    } else if (divergence.type === 'BEARISH') {
      score += 40;
      reasons.unshift(`🔥 DIVERGENCIA BAJISTA detectada`);
      signalType = 'SELL_ALERT';
    }
  }

  // === BULLISH SIGNALS ===
  // Priority 1: RSI
  if (rsi < 30) {
    score += 30;
    reasons.push(`⚡ RSI sobreventa: ${rsi.toFixed(1)}`);
    signalType = signalType || 'BUY';
  } else if (rsi < 40 && !signalType) {
    score += 15;
    reasons.push(`RSI bajo: ${rsi.toFixed(1)}`);
  }

  // Priority 2: Bollinger Bands
  if (currentPrice <= bb.lower * 1.01) {
    score += 20;
    reasons.push('📉 Precio en banda inferior Bollinger');
    signalType = signalType || 'BUY';
  }

  // Priority 3: MACD
  if (macd.bullish && macd.value > 0) {
    score += 12;
    reasons.push('MACD positivo');
    signalType = signalType || 'BUY';
  }

  // Trend confirmation
  if (sma50 && currentPrice > sma50) {
    score += 8;
  }

  const priceChange1h = ((currentPrice - prevPrice) / prevPrice) * 100;
  if (priceChange1h > 3) {
    score += 15;
    reasons.push(`Subida fuerte 1h: +${priceChange1h.toFixed(1)}%`);
    signalType = signalType || 'BUY';
  }

  // === BEARISH / WARNING SIGNALS ===
  // Priority 1: RSI
  if (rsi > 70) {
    score += 25;
    if (!reasons.some(r => r.includes('DIVERGENCIA'))) {
      reasons.unshift(`⚡ RSI sobrecompra: ${rsi.toFixed(1)}`);
    }
    signalType = signalType || 'SELL_ALERT';

    // Extra points for extreme RSI
    if (rsi > 80) score += 10;
  }

  // Priority 2: Bollinger Bands
  if (currentPrice >= bb.upper * 0.99) {
    score += 15;
    reasons.push('📈 Precio en banda superior Bollinger');
    signalType = signalType || 'SELL_ALERT';
  }

  // Priority 3: Strong drop
  if (priceChange1h < -3) {
    score += 20;
    reasons.push(`Caída fuerte 1h: ${priceChange1h.toFixed(1)}%`);
    signalType = signalType || 'SELL_ALERT';
  }

  // Apply volume multiplier to score
  score = Math.round(score * volumeMultiplier);

  // Add volume confirmation info
  if (volumeRatio > 1.5) {
    reasons.push(`📊 Volumen alto: ${(volumeRatio * 100).toFixed(0)}%`);
  }

  // === RETURN SIGNAL ===
  const bbPercentage = ((currentPrice - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(0);

  if (score >= SIGNAL_SCORE_THRESHOLD && reasons.length > 0) {
    return {
      symbol,
      price: currentPrice,
      score,
      type: signalType || 'WATCH',
      rsi: rsi.toFixed(1),
      rsiValue: rsi,
      macdBullish: macd.bullish,
      priceChange1h: priceChange1h.toFixed(1),
      bbPosition: `${bbPercentage}%`,
      hasDivergence: divergence !== null,
      volumeConfirmed: volumeRatio > 1.2,
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
  message += `_${escapeMarkdownV2('RSI • MACD • Bollinger')}_\n\n`;

  // Sort signals by RSI extremity (most extreme first)
  const sortedSignals = [...signals].sort((a, b) => {
    const extremityA = Math.abs(a.rsiValue - 50);
    const extremityB = Math.abs(b.rsiValue - 50);
    return extremityB - extremityA;
  });

  for (const sig of sortedSignals.slice(0, 5)) {
    let icon = '📊';
    let typeEmoji = '';
    if (sig.type === 'BUY') { icon = '🟢'; typeEmoji = 'COMPRA'; }
    else if (sig.type === 'SELL_ALERT') { icon = '🔴'; typeEmoji = 'ALERTA VENTA'; }
    else { typeEmoji = 'VIGILAR'; }

    message += `${icon} *${escapeMarkdownV2(sig.symbol)}* \\| ${escapeMarkdownV2(typeEmoji)}\n`;

    const priceStr = sig.price < 1 ? sig.price.toFixed(6) : sig.price.toFixed(2);
    const changeIcon = parseFloat(sig.priceChange1h) >= 0 ? '📈' : '📉';
    const changeSign = parseFloat(sig.priceChange1h) >= 0 ? '+' : '';
    message += `💰 $${escapeMarkdownV2(priceStr)} ${changeIcon} ${escapeMarkdownV2(changeSign + sig.priceChange1h)}% \\(1h\\)\n`;

    message += `📊 RSI: ${escapeMarkdownV2(sig.rsi)} \\| BB: ${escapeMarkdownV2(sig.bbPosition)} \\| ${sig.macdBullish ? 'MACD\\+' : 'MACD\\-'}\n`;

    // Show special badges for divergence and volume
    let badges = [];
    if (sig.hasDivergence) badges.push('🔥DIV');
    if (sig.volumeConfirmed) badges.push('📊VOL');
    const badgeStr = badges.length > 0 ? ` ${badges.join(' ')}` : '';

    message += `🎯 Score: ${escapeMarkdownV2(String(sig.score))}/100${escapeMarkdownV2(badgeStr)}\n`;

    if (sig.reasons.length > 0) {
      message += `💡 _${escapeMarkdownV2(sig.reasons[0])}_\n`;
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
  console.log('--- CryptoCompare Advanced Analysis Started ---');
  console.log('Time:', new Date().toISOString());

  const signals = [];
  let analyzed = 0;
  let errors = 0;

  for (const symbol of COINS_TO_MONITOR) {
    try {
      const candles = await getOHLCVData(symbol, 100);
      analyzed++;

      const signal = generateSignal(symbol, candles);
      if (signal) {
        signals.push(signal);
        console.log(`Signal: ${symbol} - Score: ${signal.score} - Type: ${signal.type}`);
      }

      await new Promise(r => setTimeout(r, 500));

    } catch (error) {
      console.error(`Error analyzing ${symbol}:`, error.message);
      errors++;
      await new Promise(r => setTimeout(r, 500));
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

// This is the scheduled handler that runs every 20 minutes
const scheduledHandler = async (event) => {
  const result = await runAnalysis();

  return {
    statusCode: 200
  };
};

// Export the scheduled function using Netlify's schedule helper
// Cron: "*/20 * * * *" = Every 20 minutes
export const handler = schedule("*/45 * * * *", scheduledHandler);