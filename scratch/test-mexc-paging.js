import { getKlines } from '../netlify/functions/tradingview-strategy-core.js';

async function test() {
  const symbol = 'BTCUSDT';
  const start = Date.now() - (10 * 24 * 60 * 60 * 1000);
  const end = Date.now() + (365 * 24 * 60 * 60 * 1000); // 1 year in future
  
  const k1 = await getKlines(symbol, '15m', 10, start, end);
  console.log('K1 (Start + Future End):', k1.length, 'First:', k1.length > 0 ? new Date(k1[0].time).toISOString() : 'N/A', 'Last:', k1.length > 0 ? new Date(k1[k1.length-1].time).toISOString() : 'N/A');
}

test();
