/**
 * Netlify Scheduled Function para análisis automático de señales de trading
 * Se ejecuta cada 20 minutos para detectar oportunidades y enviar notificaciones
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
// Optional secret to protect POST notify endpoint. If set, incoming POSTs must include
// header `x-notify-secret` equal to this value. If not set, POSTs are accepted (warned).
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || null;
// Minimum score threshold to create/send a signal (can be overridden by env var)
// Default updated to 70 to align with signalGenerator's calibrated default (0..100 scale)
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 70;

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
  'BTCUSDC', 'ETHUSDC', 'BNBUSDC', 'SOLUSDC', 'ADAUSDC',
  'XRPUSDC', 'DOTUSDC', 'DOGEUSDC', 'AVAXUSDC', 'LTCUSDC'
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
  // Build message handling both legacy (string reasons) and new formats
  let message = '*🚀 NUEVA SEÑAL DE TRADING*\n\n';
  message += `*Criptomoneda:* ${escapeMarkdownV2(signal.symbol)}\n`;
  message += `*Precio:* $${escapeMarkdownV2(signal.price.toFixed(2))}\n`;
  message += `*Score:* ${escapeMarkdownV2(String(signal.score))}\n`;
  if (typeof signal.categoriesAligned !== 'undefined') {
    message += `*Categorías alineadas:* ${escapeMarkdownV2(String(signal.categoriesAligned))}\n`;
  }

  if (signal.subscores && typeof signal.subscores === 'object') {
    message += '\n*Subscores:*\n';
    for (const [k, v] of Object.entries(signal.subscores)) {
      message += `• ${escapeMarkdownV2(k)}: ${escapeMarkdownV2(String(v))}%\n`;
    }
  }

  if (signal.reasons && Array.isArray(signal.reasons) && signal.reasons.length > 0) {
    message += '\n*Razones:*\n';
    for (const r of signal.reasons) {
      if (typeof r === 'string') {
        message += `• ${escapeMarkdownV2(r)}\n`;
      } else if (r && typeof r === 'object' && r.text) {
        const weightText = r.weight ? ` (${escapeMarkdownV2(String(r.weight))}%)` : '';
        message += `• ${escapeMarkdownV2(r.text)}${weightText}\n`;
      }
    }
  }

  message += `\n${escapeMarkdownV2(new Date().toLocaleString('es-ES'))}`;

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

  // Header styling
  let message = '🔔 *MERCADO AL DIA* 🔔\n';
  message += `_${escapeMarkdownV2('Detectando oportunidades en tiempo real...')}_\n\n`;

  for (const sig of signals) {
    // 1. Icon & Header
    const isML = Array.isArray(sig.reasons) && sig.reasons.some(r => r.includes && r.includes('ML Alert'));
    let icon = '📊';
    let typeLabel = 'TRADING';

    // Custom icons for ML signals
    if (isML) {
      if (sig.reasons.some(r => r.includes('UPPER_EXTREMITY'))) {
        icon = '🟢'; // Buy/Bullish (Changed from Red/Sell)
        typeLabel = 'ML BUY';
      } else {
        icon = '🔴'; // Sell/Bearish (Changed from Green/Buy)
        typeLabel = 'ML SELL';
      }
    } else {
      if (sig.score >= 80) icon = '💎';
      else if (sig.score >= 70) icon = '🟢';
      else icon = '🟡';
    }

    // 2. Symbol Line
    const cleanSymbol = sig.symbol.replace('USDC', '').replace('USDT', '');
    message += `${icon} *${escapeMarkdownV2(cleanSymbol)}*   •   ${escapeMarkdownV2(typeLabel)}\n`;

    // 3. Price & Score Line
    const priceStr = Number(sig.levels && sig.levels.entry ? sig.levels.entry : sig.price).toFixed(4);
    message += `💰 *Precio:* $${escapeMarkdownV2(priceStr)}   \\|   🎯 *Score:* ${escapeMarkdownV2(String(sig.score))}\n`;

    // 4. AI Sentiment (Optional)
    if (sig.aiAnalysis && sig.aiAnalysis.sentiment) {
      const sentimentEmoji = sig.aiAnalysis.sentiment === 'BULLISH' ? '🐂' : '🐻';
      message += `🧠 *IA:* ${sentimentEmoji} ${escapeMarkdownV2(sig.aiAnalysis.sentiment)}\n`;
    }

    // 5. Reasons (Cleaned up)
    if (sig.reasons && sig.reasons.length > 0) {
      // Filter out raw ML internal strings if present
      const readableReasons = sig.reasons.map(r => {
        const text = typeof r === 'string' ? r : (r.text || '');
        if (text.includes('ML Alert')) return null; // Skip raw ML alert line for cleaner look
        return text;
      }).filter(Boolean).slice(0, 3);

      if (readableReasons.length > 0) {
        message += `🔍 _${escapeMarkdownV2(readableReasons.join(', '))}_\n`;
      }
    }

    message += `───────────────────\n`;
  }

  // Footer
  const timeStr = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  message += `🤖 _Generado por Trading Bot AI_  •  ${escapeMarkdownV2(timeStr)}`;

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
      return { success: false, error: text };
    } else {
      console.log('Grouped Telegram notification sent for', signals.map(s => s.symbol).join(', '));
      const result = await response.json();
      return { success: true, telegramResponse: result };
    }
  } catch (error) {
    console.error('Error sending grouped Telegram notification:', error);
    return { success: false, error: error.message };
  }
}

export async function handler(event, context) {
  console.log('Starting scheduled analysis at', new Date().toISOString());
  // If invoked via HTTP POST with a `signals` payload, send them as notifications
  if (event && event.httpMethod === 'POST') {
    try {
      // If NOTIFY_SECRET is set, require header match
      const provided = event.headers && (event.headers['x-notify-secret'] || event.headers['X-Notify-Secret']);
      if (NOTIFY_SECRET) {
        if (!provided || provided !== NOTIFY_SECRET) {
          console.warn('POST notify rejected: missing or invalid x-notify-secret');
          return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
        }
      } else {
        console.warn('NOTIFY_SECRET not configured; accepting POST notify without secret');
      }

      const body = event.body ? JSON.parse(event.body) : null;
      const incomingSignals = body && body.signals ? body.signals : null;

      if (!incomingSignals || !Array.isArray(incomingSignals) || incomingSignals.length === 0) {
        return {
          statusCode: 400,
          body: JSON.stringify({ success: false, error: 'No signals provided' })
        };
      }

      console.log('Received POST request to send notifications for', incomingSignals.length, 'signals');
      // Optionally filter by threshold
      const filtered = incomingSignals.filter(s => (typeof s.score === 'number' ? s.score >= SIGNAL_SCORE_THRESHOLD : true));

      if (filtered.length === 0) {
        console.log('No signals meet the threshold for sending');
        return { statusCode: 200, body: JSON.stringify({ success: true, sent: 0 }) };
      }

      const telegramResult = await sendGroupedTelegramNotification(filtered);

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: telegramResult.success,
          sent: filtered.length,
          telegramResult
        })
      };
    } catch (err) {
      console.error('Error handling POST notify:', err);
      return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
    }
  }

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
      console.log(`Sending grouped notification for ${signals.length} signals`);
      // Send a single grouped message for scheduled runs to avoid spamming
      await sendGroupedTelegramNotification(signals);
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