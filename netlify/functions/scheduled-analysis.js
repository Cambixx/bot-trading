/**
 * Netlify Scheduled Function for Automatic Trading Analysis
 * Executes every 20 minutes (or as configured in netlify.toml)
 * Reuses core services from source to match frontend logic.
 */

console.log('--- Scheduled Analysis Module Loaded ---');

import BinanceService from '../../src/services/binanceService.js';
import { performTechnicalAnalysis } from '../../src/services/technicalAnalysis.js';
import { generateSignal } from '../../src/services/signalGenerator.js';
import { calculateMLMovingAverage } from '../../src/services/mlMovingAverage.js';

// Environment Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || null;
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 60;

// Helper: Escape MarkdownV2
function escapeMarkdownV2(text = '') {
  return String(text).replace(/([_\*\[\]\(\)~`>#\+\-=\|\{\}\.\!])/g, '\\$1');
}

// Helper: Send Telegram Notification
async function sendGroupedTelegramNotification(signals) {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram notifications skipped (Disabled or Missing Credentials)');
    return { success: false, error: 'Disabled/Missing Creds' };
  }

  let message = '🔔 *MERCADO AL DIA* 🔔\n';
  message += `_${escapeMarkdownV2('Oportunidades detectadas en tiempo real')}_\n\n`;

  // Sort by Score desc
  signals.sort((a, b) => b.score - a.score);

  for (const sig of signals) {
    // Icon & Type
    const isML = Array.isArray(sig.reasons) && sig.reasons.some(r => typeof r === 'string' && r.includes('ML Alert'));
    let icon = '📊';
    let typeLabel = 'TRADING';

    if (isML) {
      // ML Logic: Upper Extremity = Bearish (High risk), Lower = Bullish (Opp)
      // But let's check the signal direction
      if (sig.type === 'SELL') {
        icon = '🔴'; typeLabel = 'ML ALERT (SELL)';
      } else {
        icon = '🟢'; typeLabel = 'ML ALERT (BUY)';
      }
    } else {
      if (sig.score >= 80) icon = '💎';
      else if (sig.score >= 70) icon = '🟢';
      else icon = '🟡';
      typeLabel = sig.type === 'BUY' ? 'LONG' : 'SHORT';
    }

    const symbol = sig.symbol.replace('USDC', '').replace('USDT', '');
    message += `${icon} *${escapeMarkdownV2(symbol)}*   •   ${escapeMarkdownV2(typeLabel)}\n`;

    const priceStr = Number(sig.price).toFixed(4);
    message += `💰 $${escapeMarkdownV2(priceStr)}   \\|   🎯 Score: ${escapeMarkdownV2(String(sig.score))}\n`;

    // ML Confidence or Reasons
    if (sig.mlData) {
      message += `🤖 ML Signal: ${escapeMarkdownV2(sig.mlData.signal)}\n`;
    }

    // Top 2 Reasons
    if (sig.reasons && sig.reasons.length > 0) {
      const readableReasons = sig.reasons
        .map(r => typeof r === 'string' ? r : r.text)
        .filter(Boolean)
        .filter(t => !t.includes('ML Alert')) // Clean up
        .slice(0, 2);

      if (readableReasons.length > 0) {
        message += `🔍 _${escapeMarkdownV2(readableReasons.join(', '))}_\n`;
      }
    }
    message += `───────────────────\n`;
  }

  const timeStr = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  message += `🤖 _Bot AI_ • ${escapeMarkdownV2(timeStr)}`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'MarkdownV2' })
    });
    if (!response.ok) {
      console.error('Telegram Error:', await response.text());
      return { success: false };
    }
    return { success: true };
  } catch (e) {
    console.error('Telegram Exception:', e);
    return { success: false };
  }
}

export async function handler(event, context) {
  console.log('--- Scheduled Analysis Handler Started ---');
  console.log('Event structure:', JSON.stringify({ httpMethod: event.httpMethod, path: event.path }));

  console.log('Starting Scheduled Analysis...');

  // 1. Get Opportunities
  // We reuse binanceService via axios (Node compatible)
  let symbols = [];
  try {
    symbols = await BinanceService.getSmartOpportunityCoins(10); // Check top 10 to stay within timeout
  } catch (e) {
    console.error('Error fetching opportunities:', e);
    // Fallback
    symbols = ['BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'XRPUSDC', 'DOGEUSDC'];
  }

  console.log(`Analyzing: ${symbols.join(', ')}`);

  const detectedSignals = [];

  // 2. Analyze each symbol
  // Run in parallel? Better sequential to avoid rate limits? 
  // Binance limit is generous, but Lambda CPU is low. Let's do Promise.all with chunking if needed.
  // For 10 symbols, parallel is fine.

  await Promise.all(symbols.map(async (symbol) => {
    try {
      // Get 200 candles for 1h (enough for ML and TA warmup)
      const candles = await BinanceService.getKlines(symbol, '1h', 200);
      if (!candles || candles.length < 100) return;

      // A. Technical Analysis
      const analysis = performTechnicalAnalysis(candles);

      // B. ML Analysis
      // Need closes array
      const closes = candles.map(c => c.close);
      const mlResult = calculateMLMovingAverage(closes, { window: 30, forecast: 5, mult: 2 }); // Using typical settings

      const signalsForSymbol = [];

      // C. Generate Strategy Signal
      const stratSignal = generateSignal(analysis, symbol, {}, 'BALANCED'); // Default to BALANCED
      if (stratSignal && stratSignal.score >= SIGNAL_SCORE_THRESHOLD) {
        signalsForSymbol.push({
          ...stratSignal,
          source: 'STRATEGY'
        });
      }

      // D. Generate ML Signal
      // ML Logic: if signal is UPPER_EXTREMITY (Sell) or LOWER_EXTREMITY (Buy)
      if (mlResult && mlResult.signal) {
        // If pure ML signal logic implies a trade
        // Lower Extremity -> Buy
        // Upper Extremity -> Sell
        let mlType = null;
        if (mlResult.signal === 'LOWER_EXTREMITY') mlType = 'BUY';
        if (mlResult.signal === 'UPPER_EXTREMITY') mlType = 'SELL';

        if (mlType) {
          signalsForSymbol.push({
            symbol,
            type: mlType,
            price: candles[candles.length - 1].close,
            score: 85, // High confidence for ML extremes
            reasons: [`ML Alert: ${mlResult.signal}`],
            mlData: mlResult,
            source: 'ML'
          });
        }
      }

      // Add unique signals to detected
      if (signalsForSymbol.length > 0) {
        detectedSignals.push(...signalsForSymbol);
      }

    } catch (err) {
      console.error(`Error analyzing ${symbol}:`, err.message);
    }
  }));

  // 3. Send Notifications
  if (detectedSignals.length > 0) {
    console.log(`Sending notifications for ${detectedSignals.length} signals.`);
    await sendGroupedTelegramNotification(detectedSignals);
  } else {
    console.log('No signals found above threshold.');
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, signals: detectedSignals.length })
  };
}