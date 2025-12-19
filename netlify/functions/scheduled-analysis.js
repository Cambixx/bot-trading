/**
 * Netlify Scheduled Function - Advanced Background Trading Analysis
 * Uses CryptoCompare API (free, serverless-friendly) for OHLCV data.
 * Implements real technical indicators: RSI, MACD, Bollinger Bands.
 * Runs every 20 minutes to detect opportunities and send Telegram alerts.
 */

console.log('--- CryptoCompare Advanced Analysis Module Loaded ---');

// Environment Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 60;

// CryptoCompare API (Free, no key required for basic endpoints)
const CRYPTOCOMPARE_API = 'https://min-api.cryptocompare.com/data/v2';

// Top coins to monitor (by popularity/volume)
const COINS_TO_MONITOR = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX',
  'DOT', 'LINK', 'MATIC', 'SHIB', 'LTC', 'BCH', 'UNI',
  'ATOM', 'XLM', 'FIL', 'APE', 'NEAR', 'OP', 'ARB', 'INJ', 'SUI', 'PEPE',
  'TAO' // Added
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
  const url = `${CRYPTOCOMPARE_API}/histohour?fsym=${symbol}&tsym=USD&limit=${limit}`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`CryptoCompare API error: ${response.status}`);
  }

  const json = await response.json();

  if (json.Response !== 'Success' || !json.Data?.Data) {
    throw new Error(`CryptoCompare data error for ${symbol}`);
  }

  // Transform to standard candle format
  return json.Data.Data.map(candle => ({
    time: candle.time * 1000, // Convert to ms
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volumefrom
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

  // Use last 'period' values
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

  // For signal line, we'd need historical MACD values
  // Simplified: use current MACD line and check if positive/negative
  return {
    value: macdLine,
    bullish: macdLine > 0,
    histogram: macdLine // Simplified
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

// ==================== SIGNAL GENERATION ====================

function generateSignal(symbol, candles) {
  if (!candles || candles.length < 50) return null;

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];

  // Calculate indicators
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const sma50 = calculateSMA(closes, 50);

  if (!rsi || !macd || !bb) return null;

  let score = 0;
  const reasons = [];
  let signalType = null;

  // === BULLISH SIGNALS ===

  // RSI Oversold
  if (rsi < 30) {
    score += 25;
    reasons.push(`RSI sobreventa: ${rsi.toFixed(1)}`);
    signalType = 'BUY';
  } else if (rsi < 40 && rsi > closes.length > 1 ? calculateRSI(closes.slice(0, -1), 14) : 0) {
    // RSI recovering from low
    score += 15;
    reasons.push(`RSI recuperándose: ${rsi.toFixed(1)}`);
    signalType = signalType || 'BUY';
  }

  // MACD Bullish
  if (macd.bullish && macd.value > 0) {
    score += 20;
    reasons.push('MACD positivo');
    signalType = signalType || 'BUY';
  }

  // Price near lower Bollinger Band
  if (currentPrice <= bb.lower * 1.01) {
    score += 20;
    reasons.push('Precio en banda inferior Bollinger');
    signalType = 'BUY';
  }

  // Price above SMA50 (trend confirmation)
  if (sma50 && currentPrice > sma50) {
    score += 10;
    reasons.push('Sobre SMA50');
  }

  // Price momentum (1h gain)
  const priceChange1h = ((currentPrice - prevPrice) / prevPrice) * 100;
  if (priceChange1h > 2) {
    score += 15;
    reasons.push(`Subida 1h: +${priceChange1h.toFixed(1)}%`);
    signalType = signalType || 'BUY';
  }

  // === BEARISH / WARNING SIGNALS ===

  // RSI Overbought
  if (rsi > 70) {
    score += 20;
    reasons.push(`RSI sobrecompra: ${rsi.toFixed(1)}`);
    signalType = 'SELL_ALERT';
  }

  // Price near upper Bollinger Band
  if (currentPrice >= bb.upper * 0.99) {
    score += 15;
    reasons.push('Precio en banda superior Bollinger');
    signalType = signalType || 'SELL_ALERT';
  }

  // Strong drop
  if (priceChange1h < -3) {
    score += 20;
    reasons.push(`Caída 1h: ${priceChange1h.toFixed(1)}%`);
    signalType = 'SELL_ALERT';
  }

  // === RETURN SIGNAL ===

  if (score >= SIGNAL_SCORE_THRESHOLD && reasons.length > 0) {
    return {
      symbol,
      price: currentPrice,
      score,
      type: signalType || 'WATCH',
      rsi: rsi.toFixed(1),
      macdBullish: macd.bullish,
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

  // Build message
  let message = '🔔 *ANÁLISIS TÉCNICO AUTOMÁTICO* 🔔\n';
  message += `_${escapeMarkdownV2('Indicadores: RSI, MACD, Bollinger')}_\n\n`;

  for (const sig of signals.slice(0, 5)) {
    // Icon based on type
    let icon = '📊';
    if (sig.type === 'BUY') icon = '🟢';
    else if (sig.type === 'SELL_ALERT') icon = '🔴';

    // Symbol line
    message += `${icon} *${escapeMarkdownV2(sig.symbol)}*\n`;

    // Price line
    const priceStr = sig.price < 1 ? sig.price.toFixed(6) : sig.price.toFixed(2);
    message += `💰 $${escapeMarkdownV2(priceStr)}  🎯 Score: ${escapeMarkdownV2(String(sig.score))}\n`;

    // RSI
    message += `📉 RSI: ${escapeMarkdownV2(sig.rsi)}  ${sig.macdBullish ? '📈 MACD\\+' : '📉 MACD\\-'}\n`;

    // Reasons
    if (sig.reasons.length > 0) {
      message += `🔍 _${escapeMarkdownV2(sig.reasons.slice(0, 2).join(', '))}_\n`;
    }

    message += `───────────────────\n`;
  }

  // Footer
  const timeStr = new Date().toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });
  message += `🤖 _Ejecutado cada 20 min_ • ${escapeMarkdownV2(timeStr)}`;

  // Send
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

// ==================== HANDLER ====================

export async function handler(event, context) {
  console.log('--- CryptoCompare Advanced Analysis Started ---');
  console.log('Time:', new Date().toISOString());

  const signals = [];
  let analyzed = 0;
  let errors = 0;

  // Analyze each coin
  for (const symbol of COINS_TO_MONITOR) {
    try {
      const candles = await getOHLCVData(symbol, 100);
      analyzed++;

      const signal = generateSignal(symbol, candles);
      if (signal) {
        signals.push(signal);
        console.log(`Signal: ${symbol} - Score: ${signal.score} - Type: ${signal.type}`);
      }

      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 100));

    } catch (error) {
      console.error(`Error analyzing ${symbol}:`, error.message);
      errors++;
    }
  }

  console.log(`Analysis complete: ${analyzed} coins, ${signals.length} signals, ${errors} errors`);

  // Send notifications
  let telegramResult = { success: true, sent: 0 };
  if (signals.length > 0) {
    telegramResult = await sendTelegramNotification(signals);
  } else {
    console.log('No significant signals detected this cycle');
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      analyzed,
      signals: signals.length,
      errors,
      telegram: telegramResult,
      timestamp: new Date().toISOString()
    })
  };
}