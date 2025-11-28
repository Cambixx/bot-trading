import { generateSignal } from '../src/services/signalGenerator.js';

console.log('🧪 Testing Spot Trading Logic...');

// Mock basic analysis data
const baseAnalysis = {
    price: 100,
    indicators: {
        rsi: 50,
        macd: { histogram: 0.1 },
        ema20: 100,
        ema50: 95,
        sma200: 90, // Uptrend
        adx: 30 // Stronger trend
    },
    levels: { support: 98 }, // Closer to support (price 100) -> Higher levels score
    volume: { spike: false },
    patterns: {},
    accumulation: { isAccumulating: false }
};

// Test 1: Accumulation
console.log('\n--- Test 1: Accumulation ---');
const accAnalysis = {
    ...baseAnalysis,
    accumulation: { isAccumulating: true }
};
const accSignal = generateSignal(accAnalysis, 'TEST', null, 'BALANCED');
if (accSignal && accSignal.reasons.some(r => r.text.includes('Acumulación'))) {
    console.log('✅ Accumulation detected and boosted score.');
} else {
    console.error('❌ Accumulation failed.');
}

// Test 2: Dip Buying
console.log('\n--- Test 2: Dip Buying ---');
const dipAnalysis = {
    ...baseAnalysis,
    price: 95.5, // Near EMA50 (95)
    indicators: {
        ...baseAnalysis.indicators,
        ema50: 95,
        sma200: 90 // Price > SMA200
    }
};
const dipSignal = generateSignal(dipAnalysis, 'TEST', null, 'BALANCED');
if (dipSignal && dipSignal.reasons.some(r => r.text.includes('Dip Buy'))) {
    console.log('✅ Dip Buy detected.');
} else {
    console.error('❌ Dip Buy failed.');
}

// Test 3: Trend Filter (Conservative)
console.log('\n--- Test 3: Trend Filter (Conservative) ---');
const downtrendAnalysis = {
    ...baseAnalysis,
    price: 80,
    indicators: {
        ...baseAnalysis.indicators,
        sma200: 90 // Price < SMA200 (Downtrend)
    }
};
const blockedSignal = generateSignal(downtrendAnalysis, 'TEST', null, 'CONSERVATIVE');
if (blockedSignal === null) {
    console.log('✅ Downtrend signal blocked in Conservative mode.');
} else {
    console.error('❌ Downtrend signal NOT blocked:', blockedSignal);
}

// Test 4: Trend Filter (Risky)
console.log('\n--- Test 4: Trend Filter (Risky) ---');
const riskySignal = generateSignal(downtrendAnalysis, 'TEST', null, 'RISKY');
if (riskySignal !== null) {
    console.log('✅ Downtrend signal allowed in Risky mode.');
} else {
    console.error('❌ Downtrend signal blocked in Risky mode.');
}
