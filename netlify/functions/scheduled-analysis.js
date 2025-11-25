/**
 * Netlify Scheduled Function para análisis automático de señales de trading
 * Se ejecuta cada 20 minutos para detectar oportunidades y enviar notificaciones
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
// Minimum score threshold to create/send a signal (can be overridden by env var)
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 60;

// Helper: escape text for Telegram MarkdownV2
function escapeMarkdownV2(text = '') {
  // Escape characters as required by MarkdownV2
  // Characters to escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
  return String(text).replace(/([_\*\[\]\(\)~`>#\+\-=\|\{\}\.\!])/g, '\\$1');
}

// Retry helper
async function fetchWithRetries(url, opts = {}, attempts = 3, backoff = 500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, opts);
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, backoff * (i + 1)));
    }
  }
  throw lastErr;
}
const BINANCE_API_BASE = 'https://api.binance.com/api/v3';

// Lista de criptomonedas a monitorear
const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT',
  'XRPUSDT', 'DOTUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LTCUSDT'
];

// Función para obtener datos de velas de Binance
async function getKlines(symbol, interval = '1h', limit = 100) {
  const url = `${BINANCE_API_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch klines for ${symbol}`);
  return await response.json();
}

// Análisis técnico simplificado (versión serverless)
function calculateIndicators(klines) {
  const closes = klines.map(k => parseFloat(k[4]));
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const volumes = klines.map(k => parseFloat(k[5]));

  // RSI
  const rsi = calculateRSI(closes);

  // MACD
  const macd = calculateMACD(closes);

  // Bollinger Bands
  const bb = calculateBollingerBands(closes);

  // ATR
  const atr = calculateATR(highs, lows, closes);

  return {
    rsi: rsi,
    macd: macd,
    bollingerBands: bb,
    atr: atr,
    currentPrice: closes[closes.length - 1],
    volume: volumes[volumes.length - 1]
  };
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices) {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = ema12 - ema26;
  const signalLine = calculateEMA([macdLine], 9);
  const histogram = macdLine - signalLine;

  return {
    value: macdLine,
    signal: signalLine,
    histogram: histogram
  };
}

function calculateEMA(prices, period) {
  const multiplier = 2 / (period + 1);
  let ema = prices[0];

  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
  }

  return ema;
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;

  const sma = prices.slice(-period).reduce((a, b) => a + b, 0) / period;
  const variance = prices.slice(-period).reduce((acc, price) => acc + Math.pow(price - sma, 2), 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: sma + (stdDev * std),
    middle: sma,
    lower: sma - (stdDev * std)
  };
}

function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period) return null;

  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }

  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// Generar señal basada en indicadores
function generateSignal(symbol, indicators) {
  const { rsi, macd, bollingerBands, atr, currentPrice } = indicators;

  let score = 0;
  const reasons = [];

  // RSI sobreventa
  if (rsi < 30) {
    score += 25;
    reasons.push('RSI sobreventa');
  }

  // MACD alcista
  if (macd.histogram > 0 && macd.value > macd.signal) {
    score += 20;
    reasons.push('MACD cruce alcista');
  }

  // Precio cerca de banda inferior
  if (bollingerBands && currentPrice <= bollingerBands.lower) {
    score += 20;
    reasons.push('Precio en banda inferior Bollinger');
  }

  // Umbral mínimo para señal (configurable via SIGNAL_SCORE_THRESHOLD)
  if (score >= SIGNAL_SCORE_THRESHOLD) {
    return {
      symbol,
      price: currentPrice,
      score,
      reasons,
      timestamp: new Date().toISOString()
    };
  }

  return null;
}

// Enviar notificación por Telegram
async function sendTelegramNotification(signal) {
  if (!TELEGRAM_ENABLED) {
    console.log('Telegram notifications disabled by TELEGRAM_ENABLED flag');
    return;
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram credentials not configured');
    return;
  }

  // Kept for backward compatibility; prefer grouped sender
  const message = `*🚀 NUEVA SEÑAL DE TRADING*\n\n*Criptomoneda:* ${escapeMarkdownV2(signal.symbol)}\n*Precio:* $${escapeMarkdownV2(signal.price.toFixed(2))}\n*Score:* ${escapeMarkdownV2(String(signal.score))}\n\n${signal.reasons.map(r => `• ${escapeMarkdownV2(r)}`).join('\n')}\n\n${escapeMarkdownV2(new Date().toLocaleString('es-ES'))}`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetchWithRetries(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'MarkdownV2' })
    }, 3, 500);

    if (!response.ok) {
      console.error('Failed to send Telegram notification:', await response.text());
    } else {
      console.log('Telegram notification sent for', signal.symbol);
    }
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
  }
}

async function sendGroupedTelegramNotification(signals) {
  if (!TELEGRAM_ENABLED) {
    console.log('Telegram notifications disabled by TELEGRAM_ENABLED flag');
    return;
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram credentials not configured');
    return;
  }

  // Build message using MarkdownV2 and escaping
  let message = '*🚀 NUEVAS SEÑALES DE TRADING*\n\n';
  message += `_Generadas:_ ${escapeMarkdownV2(new Date().toLocaleString('es-ES'))}\n\n`;
  message += `*Total:* ${signals.length} \n\n`;

  for (const sig of signals) {
    message += `*${escapeMarkdownV2(sig.symbol)}*\n`;
    message += `Precio: \$${escapeMarkdownV2(sig.price.toFixed(2))}  \n`;
    message += `Score: ${escapeMarkdownV2(String(sig.score))}  \n`;
    if (sig.reasons && sig.reasons.length > 0) {
      message += `Razones:\n`;
      for (const r of sig.reasons) {
        message += `• ${escapeMarkdownV2(r)}\n`;
      }
    }
    message += `\n`;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetchWithRetries(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'MarkdownV2' })
    }, 3, 500);

    if (!response.ok) {
      const text = await response.text();
      console.error('Failed to send Telegram notification (grouped):', text);
    } else {
      console.log('Grouped Telegram notification sent for', signals.map(s => s.symbol).join(', '));
    }
  } catch (error) {
    console.error('Error sending grouped Telegram notification:', error);
  }
}

export async function handler(event, context) {
  console.log('Starting scheduled analysis at', new Date().toISOString());

  try {
    const signals = [];

    // Analizar cada criptomoneda
    for (const symbol of SYMBOLS) {
      try {
        // Obtener datos de velas
        const klines = await getKlines(symbol, '1h', 100);

        // Calcular indicadores
        const indicators = calculateIndicators(klines);

        // Generar señal
        const signal = generateSignal(symbol, indicators);

        if (signal) {
          signals.push(signal);
          console.log('Signal generated for', symbol, 'Score:', signal.score);
        }

      } catch (error) {
        console.error(`Error analyzing ${symbol}:`, error);
      }
    }

    // Enviar notificaciones para señales detectadas
    if (signals.length > 0) {
      console.log(`Sending notifications for ${signals.length} signals`);

      for (const signal of signals) {
        await sendTelegramNotification(signal);
        // Pequeño delay para evitar rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } else {
      console.log('No signals detected');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        signalsFound: signals.length,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Scheduled analysis error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
}