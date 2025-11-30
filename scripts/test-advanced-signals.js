
import { performTechnicalAnalysis, detectMarketRegime } from '../src/services/technicalAnalysis.js';
import { generateSignal } from '../src/services/signalGenerator.js';

// Mock Data Generator
function generateMockCandles(startPrice, trend = 'UP', volatility = 0.01, count = 100) {
    const candles = [];
    let price = startPrice;

    for (let i = 0; i < count; i++) {
        const open = price;
        let change = (Math.random() - 0.5) * volatility;

        if (trend === 'UP') change += volatility * 0.2;
        if (trend === 'DOWN') change -= volatility * 0.2;

        const close = open * (1 + change);
        const high = Math.max(open, close) * (1 + Math.random() * 0.005);
        const low = Math.min(open, close) * (1 - Math.random() * 0.005);
        const volume = Math.random() * 1000;

        candles.push({ open, high, low, close, volume });
        price = close;
    }
    return candles;
}

console.log('=== Testing Advanced Signal Logic ===');

// 1. Simulate Trending Bull Market (Daily)
console.log('\n1. Generating Mock Data (Trending Bull)...');
const dailyCandles = generateMockCandles(50000, 'UP', 0.02, 100);
const h4Candles = generateMockCandles(55000, 'UP', 0.01, 50);
const h1Candles = generateMockCandles(56000, 'UP', 0.005, 50); // Pullback?
const m15Candles = generateMockCandles(56000, 'UP', 0.002, 50); // Trigger

// 2. Perform Analysis
console.log('2. Performing Technical Analysis...');
const analysisDaily = performTechnicalAnalysis(dailyCandles);
const analysisH4 = performTechnicalAnalysis(h4Candles);
const analysisH1 = performTechnicalAnalysis(h1Candles);
const analysisM15 = performTechnicalAnalysis(m15Candles);

console.log('Daily Regime Detected:', analysisDaily.regime);
console.log('H4 Regime Detected:', analysisH4.regime);

// 3. Generate Signal
console.log('3. Generating Signal...');
const multiTimeframeData = {
    '1d': analysisDaily,
    '4h': analysisH4,
    '15m': analysisM15
};

const signal = generateSignal(analysisH1, 'BTCUSDC', multiTimeframeData, 'BALANCED');

if (signal) {
    console.log('✅ Signal Generated!');
    console.log('Score:', signal.score);
    console.log('Regime Used:', signal.regime);
    console.log('Reasons:', signal.reasons.map(r => r.text));
    console.log('Stop Loss:', signal.levels.stopLoss);
    console.log('Take Profit 1:', signal.levels.takeProfit1);
} else {
    console.log('❌ No Signal Generated (Expected if criteria not met)');
}

// 4. Test Ranging Market
console.log('\n4. Testing Ranging Market...');
const rangingCandles = generateMockCandles(100, 'FLAT', 0.05, 100);
const analysisRanging = performTechnicalAnalysis(rangingCandles);
console.log('Ranging Regime Detected:', analysisRanging.regime);

console.log('\n=== Test Complete ===');
