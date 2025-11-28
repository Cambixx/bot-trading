import { performTechnicalAnalysis } from '../src/services/technicalAnalysis.js';
import { analyzeMultipleSymbols } from '../src/services/signalGenerator.js';
import { SIGNAL_CONFIG } from '../src/services/signalGenerator.js';

// Fetch real data from Binance
async function getKlines(symbol) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`;
  const res = await fetch(url);
  const raw = await res.json();
  // Convert to proper format
  return raw.map(k => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[7])
  }));
}

async function testSignalGeneration() {
  console.log('=== Signal Generation Test (Using Real analyzeMultipleSymbols) ===\n');
  console.log('Current SIGNAL_CONFIG:');
  console.log(JSON.stringify(SIGNAL_CONFIG, null, 2));
  console.log('\n');

  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
  const candleData = {};
  
  for (const symbol of symbols) {
    try {
      const klines = await getKlines(symbol);
      if (klines && klines.length >= 50) {
        candleData[symbol] = { data: klines };
      }
    } catch (err) {
      console.error(`Error fetching ${symbol}:`, err.message);
    }
  }

  console.log(`Fetched data for ${Object.keys(candleData).length} symbols\n`);

  // Use the same function the app uses
  const signals = analyzeMultipleSymbols(candleData);
  
  console.log(`Generated ${signals.length} signals:\n`);
  
  if (signals.length === 0) {
    console.log('❌ No signals generated');
    console.log('\nDebug info for first symbol:');
    const firstSymbol = Object.keys(candleData)[0];
    if (firstSymbol) {
      const analysis = performTechnicalAnalysis(candleData[firstSymbol].data);
      console.log(`${firstSymbol} Analysis:
        RSI: ${analysis.indicators?.rsi}
        MACD Histogram: ${analysis.indicators?.macd?.histogram}
        EMA20: ${analysis.indicators?.ema20}
        EMA50: ${analysis.indicators?.ema50}
        Support: ${analysis.levels?.support}
        Price: ${candleData[firstSymbol].data[candleData[firstSymbol].data.length-1][4]}
      `);
    }
  } else {
    signals.forEach((sig, i) => {
      console.log(`${i+1}. ${sig.symbol}`);
      console.log(`   Score: ${sig.score} | Confidence: ${sig.confidence}`);
      console.log(`   Categories aligned: ${sig.categoriesAligned}`);
      if (sig.reasons && sig.reasons.length > 0) {
        console.log(`   Reasons: ${sig.reasons.slice(0, 2).map(r => r.text).join(', ')}`);
      }
      console.log();
    });
  }
}

testSignalGeneration().catch(console.error);