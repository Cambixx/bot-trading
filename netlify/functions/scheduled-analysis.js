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

// MEXC API V3 (Highly permissive for public market data)
const MEXC_API = 'https://api.mexc.com/api/v3';

// Top 20 Liquidity Coins (Sniper Focus)
const COINS_TO_MONITOR = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX',
  'TRX', 'LINK', 'DOT', 'MATIC', 'LTC', 'BCH', 'UNI',
  'APT', 'NEAR', 'FIL', 'ATOM', 'ARB'
];

// ==================== HELPERS ====================

function escapeMarkdownV2(text = '') {
  return String(text).replace(/([_\*\[\]\(\)~`>#\+\-=\|\{\}\.\!])/g, '\\$1');
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

// ==================== MEXC DATA ====================

async function getCandles(symbol, interval, limit = 100) {
  const mexcSymbol = `${symbol}USDT`;
  const url = `${MEXC_API}/klines?symbol=${mexcSymbol}&interval=${interval}&limit=${limit}`;

  const response = await fetchWithTimeout(url);

  if (!response.ok) throw new Error(`MEXC HTTP error: ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error(`MEXC: Invalid response for ${symbol}`);

  return json.map(candle => ({
    time: parseInt(candle[0]),
    open: parseFloat(candle[1]),
    high: parseFloat(candle[2]),
    low: parseFloat(candle[3]),
    close: parseFloat(candle[4]),
    volume: parseFloat(candle[5])
  }));
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

function calculateADX(candles, period = 14) {
  if (candles.length < period * 2) return null;

  const tr = [];
  const dmPlus = [];
  const dmMinus = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;

    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));

    const moveUp = high - prevHigh;
    const moveDown = prevLow - low;

    if (moveUp > 0 && moveUp > moveDown) {
      dmPlus.push(moveUp);
    } else {
      dmPlus.push(0);
    }

    if (moveDown > 0 && moveDown > moveUp) {
      dmMinus.push(moveDown);
    } else {
      dmMinus.push(0);
    }
  }

  // Smoothed averages
  const smooth = (data, p) => {
    let smoothed = [data.slice(0, p).reduce((a, b) => a + b, 0)];
    for (let i = p; i < data.length; i++) {
      smoothed.push(smoothed[i - 1] - (smoothed[i - 1] / p) + data[i]);
    }
    return smoothed;
  };

  const trSmooth = smooth(tr, period);
  const dmPlusSmooth = smooth(dmPlus, period);
  const dmMinusSmooth = smooth(dmMinus, period);

  const dx = [];
  for (let i = 0; i < trSmooth.length; i++) {
    const diPlus = (dmPlusSmooth[i] / trSmooth[i]) * 100;
    const diMinus = (dmMinusSmooth[i] / trSmooth[i]) * 100;
    const sum = diPlus + diMinus;
    if (sum === 0) dx.push(0);
    else dx.push(Math.abs(diPlus - diMinus) / sum * 100);
  }

  // ADX is SMA of DX
  if (dx.length < period) return null;
  const adx = dx.slice(-period).reduce((a, b) => a + b, 0) / period;
  return adx;
}

// ==================== SIGNAL GENERATION (SNIPER MODE) ====================

// Trend Analysis Helper
function analyzeTrend(candles, periodSMA = 20, periodEMA = 200) {
  if (!candles || candles.length < periodEMA) return 'UNKNOWN';
  const closes = candles.map(c => c.close);
  const lastClose = closes[closes.length - 1];

  const sma = calculateSMA(closes, periodSMA);
  const ema = calculateEMA(closes, periodEMA);

  if (lastClose > sma && lastClose > ema) return 'BULLISH';
  if (lastClose < sma && lastClose < ema) return 'BEARISH';
  return 'NEUTRAL';
}

function generateSniperSignal(symbol, candles1h, candles4h, candles1d) {
  // 1. DATA VALIDATION
  if (!candles1h || candles1h.length < 200 || !candles4h || candles4h.length < 50 || !candles1d || candles1d.length < 50) {
    return null;
  }

  const price = candles1h[candles1h.length - 1].close;

  // 2. CONTEXT (THE GREEN LIGHT)
  // Daily Trend
  const closes1d = candles1d.map(c => c.close);
  const dailySMA20 = calculateSMA(closes1d, 20);
  const dailyTrend = price > dailySMA20 ? 'BULLISH' : 'BEARISH';

  // 4H Trend (Structure)
  const closes4h = candles4h.map(c => c.close);
  const ema200_4h = calculateEMA(closes4h, 200);
  const ema50_4h = calculateEMA(closes4h, 50);
  const structureTrend = price > ema200_4h ? 'BULLISH' : 'BEARISH';

  // HARD GATE: Trend Alignment
  if (dailyTrend !== structureTrend) return null; // No Conflict Allowed
  const marketBias = dailyTrend; // 'BULLISH' or 'BEARISH'

  // 3. SETUPS
  // Indicators for 1H (Trigger)
  const closes1h = candles1h.map(c => c.close);
  const rsi1h = calculateRSI(closes1h, 14);
  const macd1h = calculateMACD(closes1h);
  const atr1h = calculateATR(candles1h, 14);
  const adx1h = calculateADX(candles1h, 14);
  const volumeSMA = calculateVolumeSMA(candles1h, 20);
  const currentVolume = candles1h[candles1h.length - 1].volume;

  // Indicators for 4H (Context)
  const bb4h = calculateBollingerBands(closes4h, 20, 2);
  const adx4h = calculateADX(candles4h, 14);

  let signal = null;
  let reasons = [];
  let score = 0;

  // --- SETUP A: GOLDEN PULLBACK (Trend Continuation) ---
  // Context: Strong Trend (ADX 4h > 20)
  if (adx4h > 20) {
    if (marketBias === 'BULLISH') {
      // Price dipping to 4H EMA 50 (Support Area)
      const distToEma50 = Math.abs(price - ema50_4h) / price;
      const isNearSupport = distToEma50 < 0.015; // Within 1.5%

      // Trigger: 1H Oversold
      if (isNearSupport && rsi1h < 45) {
        // Sniper Entry
        signal = 'BUY';
        score = 85;
        reasons.push('🟢 Setup A: Golden Pullback');
        reasons.push(`Trend fuerte (ADX 4H: ${adx4h.toFixed(1)})`);
        reasons.push(`Rebote en EMA50 4H + RSI 1H Sobreventa (${rsi1h.toFixed(1)})`);
      }
    }
    // (Short setup logic omitted for spot, but can be added if needed)
  }

  // --- SETUP B: VOLATILITY BREAKOUT (Squeeze) ---
  // Context: BB Squeeze on 4H
  const bbWidth = (bb4h.upper - bb4h.lower) / bb4h.middle;
  const isSqueeze = bbWidth < 0.10; // Expanded slightly for crypto

  if (isSqueeze) {
    // Breakout Condition
    if (marketBias === 'BULLISH' && price > bb4h.upper) {
      // Confirmation: Volume + MACD
      const isVolSpike = currentVolume > (volumeSMA * 1.5);
      if (isVolSpike && macd1h.histogram > 0) {
        signal = 'BUY';
        score = 90;
        reasons.push('🚀 Setup B: Volatility Breakout');
        reasons.push(`Squeeze 4H (Width: ${(bbWidth * 100).toFixed(2)}%)`);
        reasons.push(`Ruptura con Volumen (x${(currentVolume / volumeSMA).toFixed(1)}) y MACD`);
      }
    }
  }

  // 4. RISK MANAGEMENT (THE SHIELD)
  if (signal) {
    // Filter: Avoid Extreme Choppiness if not a breakout
    if (!reasons[0].includes('Breakout') && adx1h < 15) return null;

    // Calculate Position Sizing Logic
    const atr = calculateATR(candles4h, 14); // Use 4H ATR for wider safe stops
    const stopLoss = price - (atr * 2.0); // 2 ATR Stop
    const risk = price - stopLoss;
    const takeProfit = price + (risk * 2.5); // 2.5R Target

    return {
      symbol,
      type: signal,
      price,
      score,
      confidence: 'HIGH', // Sniper is always High confidence
      reasons,
      levels: {
        entry: price,
        stopLoss: Number(stopLoss.toFixed(4)),
        takeProfit: Number(takeProfit.toFixed(4))
      },
      indicators: {
        rsi: Number(rsi1h.toFixed(1)),
        adx: Number(adx4h.toFixed(1)),
        trend: marketBias
      }
    };
  }

  return null;
}

async function processCoin(symbol) {
  try {
    // SNIPER DATA: 1H, 4H, 1D
    const [candles1h, candles4h, candles1d] = await Promise.all([
      getCandles(symbol, '60m', 200),
      getCandles(symbol, '4h', 100),
      getCandles(symbol, '1d', 50)
    ]);

    const signal = generateSniperSignal(symbol, candles1h, candles4h, candles1d);

    if (signal) {
      console.log(`🎯 SNIPER SIGNAL: ${symbol} [${signal.type}] Score: ${signal.score}`);
      return signal;
    }
  } catch (error) {
    console.error(`Error analyzing ${symbol}:`, error.message);
    // Don't throw to keep batch processing alive
  }
  return null;
}

// ==================== TELEGRAM ====================

export async function sendTelegramNotification(signals) {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram disabled or missing credentials');
    return { success: false, reason: 'disabled' };
  }

  if (signals.length === 0) {
    return { success: true, sent: 0 };
  }

  let message = '🎯 *SNIPER SIGNAL ACTIVE* 🎯\n\n';

  for (const sig of signals) {
    let icon = '🟢';
    if (sig.type === 'SELL') icon = '🔴';

    message += `${icon} *${escapeMarkdownV2(sig.symbol)}* \\| SCORE: ${sig.score}\n`;
    message += `💰 Entry: $${escapeMarkdownV2(sig.price.toFixed(4))}\n`;

    // Levels
    const levels = sig.levels;
    message += `🛑 SL: $${escapeMarkdownV2(levels.stopLoss)} \\(2.0 ATR\\)\n`;
    message += `🎯 TP: $${escapeMarkdownV2(levels.takeProfit)} \\(2.5R\\)\n`;

    // Indicators
    const inds = sig.indicators;
    message += `📊 Trend: ${inds.trend} \\| RSI: ${inds.rsi} \\| ADX: ${inds.adx}\n`;

    // Reasons
    message += `\n📝 _Logic:_\n`;
    sig.reasons.forEach(r => {
      message += `• ${escapeMarkdownV2(r)}\n`;
    });

    message += `───────────────────\n`;
  }

  const timeStr = new Date().toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });
  message += `🤖 _CryptoSniper Bot_ • ${escapeMarkdownV2(timeStr)}`;

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
  console.log('--- SNIPER MODE ANALYSIS STARTED ---');
  console.log('Time:', new Date().toISOString());

  const signals = [];
  let analyzed = 0;
  let errors = 0;

  // Process in batches
  const BATCH_SIZE = 3;

  for (let i = 0; i < COINS_TO_MONITOR.length; i += BATCH_SIZE) {
    const batch = COINS_TO_MONITOR.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(COINS_TO_MONITOR.length / BATCH_SIZE)}...`);

    const promises = batch.map(symbol =>
      processCoin(symbol)
        .then(res => {
          analyzed++;
          if (res) signals.push(res);
        })
        .catch(err => {
          console.error(`Failed ${symbol}:`, err.message);
          errors++;
        })
    );

    await Promise.all(promises);

    // Delay between batches
    if (i + BATCH_SIZE < COINS_TO_MONITOR.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`Analysis complete: ${analyzed} coins, ${signals.length} signals, ${errors} errors`);

  if (signals.length > 0) {
    await sendTelegramNotification(signals);
  } else {
    console.log('No Sniper Signals found this run.');
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Sniper Analysis complete', signals })
  };
}

export const handler = schedule('*/30 * * * *', runAnalysis);