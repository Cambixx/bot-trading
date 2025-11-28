import { performTechnicalAnalysis } from '../src/services/technicalAnalysis.js';

async function debugAnalysis() {
  const symbol = 'BTCUSDT';
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`;
  const res = await fetch(url);
  const rawKlines = await res.json();

  console.log('Raw kline format:', rawKlines[0]);

  // Convert to proper format with objects
  const klines = rawKlines.map(k => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[7])
  }));

  console.log('Converted format:', klines[0]);
  console.log('Total klines:', klines.length);

  console.log('\nPerforming analysis...');
  const analysis = performTechnicalAnalysis(klines);

  console.log('\nIndicators:');
  console.log('RSI:', analysis.indicators?.rsi);
  console.log('MACD:', analysis.indicators?.macd);
  console.log('EMA20:', analysis.indicators?.ema20);
  console.log('EMA50:', analysis.indicators?.ema50);
  console.log('SMA200:', analysis.indicators?.sma200);
  console.log('Stochastic:', analysis.indicators?.stochastic);
  console.log('ADX:', analysis.indicators?.adx);
  console.log('VWAP:', analysis.indicators?.vwap);
  console.log('Support:', analysis.levels?.support);
}

debugAnalysis().catch(console.error);