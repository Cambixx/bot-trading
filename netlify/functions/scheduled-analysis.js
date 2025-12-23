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

// Top coins to monitor (MEXC format: SYMBOL + USDT)
const COINS_TO_MONITOR = [
  'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX',
  'DOT', 'LINK', 'LTC', 'BCH', 'SHIB', 'XLM', 'UNI', 'ATOM',
  'FIL', 'SUI', 'TAO', 'AAVE', 'RUNE', 'MKR', 'INJ', 'FET',
  'NEAR', 'APE', 'OP', 'ARB', 'RNDR', 'GRT', 'IMX', 'ALGO',
  'VET', 'MANA', 'SAND', 'AXS', 'THETA', 'EOS', 'XTZ', 'EGLD',
  'PEPE'
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

async function getOHLCVData(symbol, limit = 300) {
  const mexcSymbol = `${symbol}USDT`;
  // MEXC V3: /klines?symbol=BTCUSDT&interval=60m&limit=300
  const url = `${MEXC_API}/klines?symbol=${mexcSymbol}&interval=60m&limit=${limit}`;

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`MEXC HTTP error: ${response.status}`);
  }

  const json = await response.json();

  if (!Array.isArray(json)) {
    throw new Error(`MEXC: Invalid response for ${symbol}`);
  }

  return json.map(candle => ({
    time: parseInt(candle[0]),
    open: parseFloat(candle[1]),
    high: parseFloat(candle[2]),
    low: parseFloat(candle[3]),
    close: parseFloat(candle[4]),
    volume: parseFloat(candle[5])
  }));
}

// Fetch daily candles for multi-timeframe analysis
async function getDailyCandles(symbol, limit = 30) {
  const mexcSymbol = `${symbol}USDT`;
  const url = `${MEXC_API}/klines?symbol=${mexcSymbol}&interval=1d&limit=${limit}`;

  const response = await fetchWithTimeout(url);
  if (!response.ok) return null;

  const json = await response.json();
  if (!Array.isArray(json)) return null;

  return json.map(candle => ({
    time: parseInt(candle[0]),
    open: parseFloat(candle[1]),
    high: parseFloat(candle[2]),
    low: parseFloat(candle[3]),
    close: parseFloat(candle[4]),
    volume: parseFloat(candle[5])
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

function generateSignal(symbol, candles) {
  if (!candles || candles.length < 200) return null; // Need 200 for EMA200

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];

  // Core indicators
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const ema200 = calculateEMA(closes, 200); // Trend Filter
  const ema50 = calculateEMA(closes, 50);

  // Advanced indicators
  const volumeSMA = calculateVolumeSMA(candles, 20);
  const currentVolume = candles[candles.length - 1].volume;
  const divergences = detectDivergences(candles, closes);

  if (!rsi || !macd || !bb || !ema200) return null;

  let score = 0;
  const reasons = [];
  let signalType = null; // BUY, SELL_ALERT, WATCH

  // Trend Direction (EMA 200)
  const isUptrend = currentPrice > ema200;

  // Volume Validation
  const volumeRatio = volumeSMA ? currentVolume / volumeSMA : 1;
  const volumeMultiplier = volumeRatio > 1.5 ? 1.2 : (volumeRatio > 1.0 ? 1.05 : 0.95);

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
  const bbWidth = (bb.upper - bb.lower) / bb.middle;
  const isSqueeze = bbWidth < 0.05; // Low volatility

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

  // Apply Volume Multiplier
  score = Math.round(score * volumeMultiplier);
  if (volumeRatio > 1.5) reasons.push(`📊 Alto Volumen x${volumeRatio.toFixed(1)}`);

  // Final Decision Threshold
  const bbPercentage = ((currentPrice - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(0);

  // Need higher score for non-trend trades
  const effectiveThreshold = isUptrend ? SIGNAL_SCORE_THRESHOLD : SIGNAL_SCORE_THRESHOLD + 10;

  if (score >= effectiveThreshold && reasons.length > 0) {
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
  console.log('--- MEXC Advanced Analysis Started ---');
  console.log('Time:', new Date().toISOString());

  const signals = [];
  let analyzed = 0;
  let errors = 0;

  for (const symbol of COINS_TO_MONITOR) {
    try {
      const candles = await getOHLCVData(symbol, 300);
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
// Cron: "0 * * * *" = Every hour
export const handler = schedule("0 * * * *", scheduledHandler);