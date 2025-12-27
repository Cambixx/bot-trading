/**
 * Netlify Scheduled Function - Day Trading Signal Analysis
 * Uses MEXC API for OHLCV data with 15m/1H/4H timeframes.
 * Implements momentum, pullback, and breakout setups for intraday trading.
 * Runs every 15 minutes to detect quick opportunities and send Telegram alerts.
 */

import { schedule } from "@netlify/functions";

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
  'TRX', 'LINK', 'DOT', 'POL', 'LTC', 'BCH', 'UNI',
  'APT', 'NEAR', 'FIL', 'ATOM', 'ARB', 'OP', 'HBAR',
  'PEPE', 'ORDI', 'WIF', 'FET', 'RENDER', 'SUI', 'SEI', 'INJ',
  'TIA', 'BONK', 'PYTH', 'JUP', 'DYM', 'STRK', 'ENA', 'W', 'TNSR'
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

  // Smoothed averages (Wilder's Smoothing)
  const smooth = (data, p) => {
    let smoothed = [data.slice(0, p).reduce((a, b) => a + b, 0)];
    for (let i = p; i < data.length; i++) {
      const prev = smoothed[smoothed.length - 1];
      smoothed.push(prev - (prev / p) + data[i]);
    }
    return smoothed;
  };

  const trSmooth = smooth(tr, period);
  const dmPlusSmooth = smooth(dmPlus, period);
  const dmMinusSmooth = smooth(dmMinus, period);

  const dx = [];
  for (let i = 0; i < trSmooth.length; i++) {
    if (trSmooth[i] === 0) {
      dx.push(0);
      continue;
    }
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

function generateDayTradingSignal(symbol, candles15m, candles1h, candles4h) {
  // 1. DATA VALIDATION
  if (!candles15m || candles15m.length < 100 || !candles1h || candles1h.length < 100 || !candles4h || candles4h.length < 50) {
    return null;
  }

  const price = candles15m[candles15m.length - 1].close;

  // 2. CONTEXT - Multi-timeframe analysis
  // 4H Trend (Structure)
  const closes4h = candles4h.map(c => c.close);
  const ema50_4h = calculateEMA(closes4h, 50);
  const structureTrend = price > ema50_4h ? 'BULLISH' : 'BEARISH';

  // 1H Trend (Intermediate)
  const closes1h = candles1h.map(c => c.close);
  const ema21_1h = calculateEMA(closes1h, 21);
  const ema50_1h = calculateEMA(closes1h, 50);
  const trend1h = price > ema21_1h ? 'BULLISH' : 'BEARISH';

  // 15m Indicators (Trigger)
  const closes15m = candles15m.map(c => c.close);
  const rsi15m = calculateRSI(closes15m, 14);
  const rsi1h = calculateRSI(closes1h, 14);
  const macd15m = calculateMACD(closes15m);
  const ema9_15m = calculateEMA(closes15m, 9);
  const ema21_15m = calculateEMA(closes15m, 21);
  const atr1h = calculateATR(candles1h, 14);
  const adx1h = calculateADX(candles1h, 14);
  const volumeSMA = calculateVolumeSMA(candles15m, 20);
  const currentVolume = candles15m[candles15m.length - 1].volume;
  const bb1h = calculateBollingerBands(closes1h, 20, 2);

  // Trend Alignment Score
  let trendScore = 0;
  if (structureTrend === 'BULLISH' && trend1h === 'BULLISH') trendScore = 15;
  else if (structureTrend === trend1h) trendScore = 10;
  else trendScore = -5;

  const marketBias = trend1h; // Focus on 1H for day trading

  let signal = null;
  let reasons = [];
  let score = 0;

  // --- SETUP A: MOMENTUM BURST (New - Day Trading) ---
  // RSI cruza 50 desde abajo con volumen
  const prevRsi15m = calculateRSI(closes15m.slice(0, -1), 14);
  const rsiCrossUp = prevRsi15m < 50 && rsi15m >= 50;
  const isVolSpike = currentVolume > (volumeSMA * 1.5);

  if (marketBias === 'BULLISH' && rsiCrossUp && isVolSpike && price > ema21_15m) {
    signal = 'BUY';
    score = 72 + trendScore;
    reasons.push('⚡ Setup A: Momentum Burst');
    reasons.push(`RSI cruza 50 (${rsi15m.toFixed(1)}) + Volumen x${(currentVolume / volumeSMA).toFixed(1)}`);
    reasons.push(`Precio sobre EMA21 15m`);
  }

  // --- SETUP B: EMA PULLBACK (Day Trading version) ---
  // Precio retrocede a EMA21 en 15m con tendencia 1H alcista
  if (!signal && marketBias === 'BULLISH' && adx1h > 20) {
    const distToEma21 = Math.abs(price - ema21_15m) / price;
    const isNearEma = distToEma21 < 0.005; // 0.5% de la EMA
    const isPriceAboveEma = price >= ema21_15m * 0.998; // Tocando o ligeramente por encima

    if (isNearEma && isPriceAboveEma && rsi15m > 40 && rsi15m < 60) {
      signal = 'BUY';
      score = 75 + trendScore;
      reasons.push('🎯 Setup B: EMA21 Pullback');
      reasons.push(`Rebote en EMA21 15m + Tendencia fuerte (ADX: ${adx1h.toFixed(1)})`);
      reasons.push(`RSI neutral (${rsi15m.toFixed(1)})`);
    }
  }

  // --- SETUP C: BREAKOUT (Improved) ---
  // Ruptura de Bollinger con volumen
  if (!signal && bb1h) {
    const bbWidth = (bb1h.upper - bb1h.lower) / bb1h.middle;
    const isSqueeze = bbWidth < 0.08;

    if (isSqueeze && price > bb1h.upper && isVolSpike && macd15m && macd15m.histogram > 0) {
      signal = 'BUY';
      score = 80 + trendScore;
      reasons.push('🚀 Setup C: Squeeze Breakout');
      reasons.push(`BB Squeeze (${(bbWidth * 100).toFixed(1)}%) + Ruptura`);
      reasons.push(`Volumen confirmado + MACD positivo`);
    }
  }

  // --- SETUP D: OVERSOLD BOUNCE (Adjusted for crypto) ---
  if (!signal && rsi15m < 32 && rsi1h < 40) {
    // Check for bullish divergence hint: price making lows but RSI not as low
    const recentLow15m = Math.min(...closes15m.slice(-5));
    const isAtRecent = Math.abs(price - recentLow15m) / price < 0.01;

    if (isAtRecent) {
      signal = 'BUY';
      score = 70;
      reasons.push('📉 Setup D: Oversold Bounce');
      reasons.push(`RSI 15m: ${rsi15m.toFixed(1)} + RSI 1H: ${rsi1h.toFixed(1)}`);
      reasons.push(`Posible rebote técnico`);
    }
  }

  // --- SETUP E: GOLDEN CROSS MINI (EMA9 cruza EMA21) ---
  if (!signal && marketBias === 'BULLISH') {
    const prevEma9 = calculateEMA(closes15m.slice(0, -1), 9);
    const prevEma21 = calculateEMA(closes15m.slice(0, -1), 21);
    const emaCrossUp = prevEma9 < prevEma21 && ema9_15m >= ema21_15m;

    if (emaCrossUp && rsi15m > 50 && rsi15m < 70) {
      signal = 'BUY';
      score = 73 + trendScore;
      reasons.push('✨ Setup E: Golden Cross Mini');
      reasons.push(`EMA9 cruza EMA21 en 15m`);
      reasons.push(`RSI confirmando (${rsi15m.toFixed(1)})`);
    }
  }

  // 4. RISK MANAGEMENT (DAY TRADING STYLE)
  if (signal) {
    if (score < SIGNAL_SCORE_THRESHOLD) {
      console.log(`[${symbol}] Signal rejected by score: ${score} < ${SIGNAL_SCORE_THRESHOLD}`);
      return null;
    }

    // Use 1H ATR for tighter stops (day trading)
    const atr = atr1h;
    const stopLoss = price - (atr * 1.5); // Tighter: 1\.5 ATR
    const risk = price - stopLoss;
    const takeProfit = price + (risk * 2.0); // 2:1 R:R for day trading

    return {
      symbol,
      type: signal,
      price,
      score,
      confidence: score > 85 ? 'HIGH' : 'MEDIUM',
      reasons,
      levels: {
        entry: price,
        stopLoss: Number(stopLoss.toFixed(4)),
        takeProfit: Number(takeProfit.toFixed(4))
      },
      indicators: {
        rsi15m: Number(rsi15m.toFixed(1)),
        rsi1h: Number(rsi1h.toFixed(1)),
        adx: Number(adx1h.toFixed(1)),
        trend: marketBias
      }
    };
  }

  return null;
}

async function processCoin(symbol) {
  try {
    // DAY TRADING DATA: 15m, 1H, 4H
    const [candles15m, candles1h, candles4h] = await Promise.all([
      getCandles(symbol, '15m', 100),
      getCandles(symbol, '60m', 100),
      getCandles(symbol, '4h', 100)
    ]);

    const signal = generateDayTradingSignal(symbol, candles15m, candles1h, candles4h);

    if (signal) {
      console.log(`🎯 DAY TRADING SIGNAL: ${symbol} [${signal.type}] Score: ${signal.score}`);
      return signal;
    }
  } catch (error) {
    console.error(`Error analyzing ${symbol}:`, error.message);
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

  let message = '🎯 *DAY TRADING SIGNAL* 🎯\n\n';

  for (const sig of signals) {
    let icon = '🟢';
    if (sig.type === 'SELL') icon = '🔴';

    message += `${icon} *${escapeMarkdownV2(sig.symbol)}* \\| SCORE: ${sig.score}\n`;
    message += `💰 Entry: \$${escapeMarkdownV2(String(sig.price.toFixed(4))}\n`;

    // Levels
    const levels = sig.levels;
    message += `🛑 SL: \$${escapeMarkdownV2(String(levels.stopLoss))} \\(1\.5 ATR\\)\n`;
    message += `🎯 TP: \$${escapeMarkdownV2(String(levels.takeProfit))} \\(2:1 R\\)\n`;

    // Indicators
    const inds = sig.indicators;
    message += `📊 Trend: ${escapeMarkdownV2(inds.trend)} \\| RSI: ${escapeMarkdownV2(String(inds.rsi15m || inds.rsi || 0))} \\| ADX: ${escapeMarkdownV2(String(inds.adx))}\n`;

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

  console.log('--------------------------------------------------');
  console.log(`📊 RESUMEN FINAL:`);
  console.log(`✅ Monedas Analizadas: ${analyzed}`);
  console.log(`🎯 Señales Encontradas: ${signals.length}`);
  console.log(`❌ Errores: ${errors}`);
  console.log('--------------------------------------------------');

  if (signals.length > 0) {
    await sendTelegramNotification(signals);
  } else {
    console.log('ℹ️ No se encontraron señales en esta ejecución.');
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Day Trading Analysis complete', signals })
  };
}

export const handler = schedule('*/15 * * * *', runAnalysis);