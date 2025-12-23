// Detect regular and hidden RSI divergences
function detectDivergences(candles, closes) {
  if (candles.length < 50) return [];

  const lookback = 30; // Look deeper for divergences
  const recentCloses = closes.slice(-lookback);

  // Calculate RSI sequence
  const rsiValues = [];
  const rsiStartIndex = closes.length - lookback - 15;
  if (rsiStartIndex < 0) return [];

  for (let i = rsiStartIndex; i < closes.length; i++) {
    const subset = closes.slice(0, i + 1);
    const val = calculateRSI(subset, 14);
    if (val !== null) rsiValues.push({ index: i, value: val });
  }

  if (rsiValues.length < lookback) return [];

  const alignedRSI = rsiValues.slice(-lookback);
  const alignedPrice = recentCloses.map((price, idx) => ({
    index: closes.length - lookback + idx,
    value: price
  }));

  const findPivots = (data, isHigh) => {
    const pivots = [];
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

  const checkDiv = (p1, p2, r1, r2, type, name) => {
    const timeDiff = Math.abs(p2.index - p1.index);
    if (timeDiff < 5 || timeDiff > 40) return;

    const match1 = Math.abs(p1.index - r1.index) <= 2;
    const match2 = Math.abs(p2.index - r2.index) <= 2;

    if (match1 && match2) {
      divergences.push({ type, name, strength: Math.abs(r1.value - r2.value) });
    }
  };

  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const p2 = priceLows[priceLows.length - 1];
    const p1 = priceLows[priceLows.length - 2];
    const r2 = rsiLows[rsiLows.length - 1];
    const r1 = rsiLows[rsiLows.length - 2];
    if (p2.value < p1.value && r2.value > r1.value) {
      checkDiv(p1, p2, r1, r2, 'BULLISH', 'Regular Bullish Divergence');
    }
    if (p2.value > p1.value && r2.value < r1.value) {
      checkDiv(p1, p2, r1, r2, 'BULLISH', 'Hidden Bullish Divergence (Trend Cont.)');
    }
  }

  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const p2 = priceHighs[priceHighs.length - 1];
    const p1 = priceHighs[priceHighs.length - 2];
    const r2 = rsiHighs[rsiHighs.length - 1];
    const r1 = rsiHighs[rsiHighs.length - 2];
    if (p2.value > p1.value && r2.value < r1.value) {
      checkDiv(p1, p2, r1, r2, 'BEARISH', 'Regular Bearish Divergence');
    }
    if (p2.value < p1.value && r2.value > r1.value) {
      checkDiv(p1, p2, r1, r2, 'BEARISH', 'Hidden Bearish Divergence (Trend Cont.)');
    }
  }

  return divergences;
}

function generateSignal(symbol, candles) {
  if (!candles || candles.length < 200) return null;

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];

  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const ema200 = calculateEMA(closes, 200);

  const volumeSMA = calculateVolumeSMA(candles, 20);
  const currentVolume = candles[candles.length - 1].volume;
  const divergences = detectDivergences(candles, closes);

  if (!rsi || !macd || !bb || !ema200) return null;

  let score = 0;
  const reasons = [];
  let signalType = null;

  const isUptrend = currentPrice > ema200;
  const volumeRatio = volumeSMA ? currentVolume / volumeSMA : 1;
  const volumeMultiplier = volumeRatio > 1.5 ? 1.2 : (volumeRatio > 1.0 ? 1.05 : 0.95);

  if (divergences.length > 0) {
    const sortedDivs = divergences.sort((a, b) => b.strength - a.strength);
    const bestDiv = sortedDivs[0];
    if (bestDiv.type === 'BULLISH') {
      if (bestDiv.name.includes('Hidden') ? isUptrend : rsi < 50) {
        score += 35;
        reasons.unshift(`💎 ${bestDiv.name}`);
        signalType = 'BUY';
      }
    } else if (bestDiv.type === 'BEARISH') {
      if (bestDiv.name.includes('Hidden') ? !isUptrend : rsi > 50) {
        score += 35;
        reasons.unshift(`🔻 ${bestDiv.name}`);
        signalType = 'SELL_ALERT';
      }
    }
  }

  if (currentPrice > bb.upper && macd.bullish && macd.histogram > 0) {
    score += isUptrend ? 25 : 15;
    reasons.push('🚀 Breakout Bollinger + MACD Bullish');
    signalType = signalType || 'BUY';
  }

  if (currentPrice <= bb.lower * 1.005 && currentPrice > prevPrice && macd.bullish) {
    score += 20;
    reasons.push('🛡️ Rebote en Bollinger Inferior + MACD');
    signalType = signalType || 'BUY';
  }

  if (rsi < 30) { score += 25; reasons.push('⚡ RSI Sobreventa'); signalType = signalType || 'BUY'; }
  else if (rsi > 70) { score += 25; reasons.push('⚠️ RSI Sobrecompra'); signalType = signalType || 'SELL_ALERT'; }

  if (signalType === 'BUY' && isUptrend) { score += 15; reasons.push('✅ Con tendencia principal'); }
  if (signalType === 'SELL_ALERT' && !isUptrend) { score += 15; reasons.push('✅ Con tendencia bajista'); }

  score = Math.round(score * volumeMultiplier);
  const effectiveThreshold = isUptrend ? SIGNAL_SCORE_THRESHOLD : SIGNAL_SCORE_THRESHOLD + 10;
  const bbPercentage = ((currentPrice - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(0);

  if (score >= effectiveThreshold && reasons.length > 0) {
    return {
      symbol, price: currentPrice, score, type: signalType || 'WATCH',
      rsi: rsi.toFixed(1), rsiValue: rsi, macdBullish: macd.bullish,
      priceChange1h: ((currentPrice - prevPrice) / prevPrice * 100).toFixed(2),
      bbPosition: `${bbPercentage}%`, hasDivergence: divergences.length > 0,
      volumeConfirmed: volumeRatio > 1.2, reasons
    };
  }
  return null;
}

async function sendTelegramNotification(signals) {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return { success: false };
  if (signals.length === 0) return { success: true, sent: 0 };

  let message = '🔔 *ANÁLISIS TÉCNICO AVANZADO* 🔔\n\n';
  const sortedSignals = [...signals].sort((a, b) => b.score - a.score);

  for (const sig of sortedSignals.slice(0, 5)) {
    const icon = sig.type === 'BUY' ? '🟢' : (sig.type === 'SELL_ALERT' ? '🔴' : '📊');
    const typeStr = sig.type === 'BUY' ? 'COMPRA' : 'VENTA';
    message += `${icon} *${escapeMarkdownV2(sig.symbol)}* \\| ${typeStr}\n`;
    message += `💰 $${escapeMarkdownV2(sig.price.toFixed(2))} \\| ${sig.priceChange1h}% \\(1h\\)\n`;
    message += `📊 RSI: ${sig.rsi} \\| Score: ${sig.score}/100\n`;
    if (sig.reasons.length > 0) message += `💡 _${escapeMarkdownV2(sig.reasons[0])}_\n`;
    message += `───────────────────\n`;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'MarkdownV2' })
    });
    return { success: response.ok };
  } catch (e) { return { success: false }; }
}

async function runAnalysis() {
  console.log('--- CryptoCompare Analysis Started ---');
  if (!CRYPTOCOMPARE_API_KEY) console.warn('TIP: Use a free API Key to increase rate limits.');

  const signals = [];
  let analyzed = 0;
  let errors = 0;

  for (const symbol of COINS_TO_MONITOR) {
    try {
      const candles = await getOHLCVData(symbol, 300);
      analyzed++;
      const signal = generateSignal(symbol, candles);
      if (signal) signals.push(signal);
      console.log(`Analyzed ${symbol}: ${signal ? 'Signal found!' : 'No signal'}`);

      // Aggressive delay: 6 seconds between coins to avoid free tier rate limit
      await new Promise(r => setTimeout(r, 6000));
    } catch (error) {
      console.error(`Error analyzing ${symbol}:`, error.message);
      errors++;
      await new Promise(r => setTimeout(r, 6000));
    }
  }

  if (signals.length > 0) await sendTelegramNotification(signals);
  return { success: true, signals: signals.length };
}

const scheduledHandler = async () => {
  await runAnalysis();
  return { statusCode: 200 };
};

export const handler = schedule("0 * * * *", scheduledHandler);