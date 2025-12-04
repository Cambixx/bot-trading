import { generateSignal, getSignalConfig } from './src/services/signalGenerator.js';

// Mock analysis data with strong signals
const mockAnalysis = {
    price: 100,
    indicators: {
        rsi: 50, // Neutral-Bullish in trend
        macd: { histogram: 0.5 }, // Bullish momentum
        ema20: 105,
        ema50: 100, // Bullish trend
        sma200: 90, // Price > SMA200
        adx: 50, // Strong trend
        vwap: 95
    },
    levels: {
        support: 99,
        resistance: 110,
        orderBlocks: { bullish: [{ bottom: 98, top: 101 }] }, // Price in OB
        fibPivot: { s1: 98, r1: 105 }
    },
    volume: {
        spike: true,
        buyerPressure: { current: 70 } // Strong buying
    },
    patterns: {
        bullishEngulfing: true,
        hammer: true
    },
    divergence: {
        rsi: { bullish: true, strength: 0.8 },
        macd: { bullish: true, strength: 0.7 }
    },
    accumulation: {
        isAccumulating: true,
        strength: 0.9
    },
    regime: 'TRENDING_BULL'
};

const mockMultiTimeframeData = {
    '1d': {
        indicators: { ema20: 105, ema50: 100 },
        regime: 'TRENDING_BULL'
    },
    '4h': {
        indicators: { ema20: 105, ema50: 100 },
        regime: 'TRENDING_BULL'
    },
    '15m': {
        indicators: { rsi: 45, macd: { histogram: 0.2 } }
    }
};

console.log('Testing Signal Generation...');
const signal = generateSignal(mockAnalysis, 'BTCUSDT', mockMultiTimeframeData, 'BALANCED');

if (signal) {
    console.log('Signal Generated:');
    console.log(`Score: ${signal.score}`);
    console.log('Subscores:', signal.subscores);
    console.log('Reasons:', signal.reasons.map(r => `${r.text} (${r.weight}%)`));

    if (signal.score > 60) {
        console.log('SUCCESS: Score is high enough!');
    } else {
        console.error('FAILURE: Score is still too low.');
    }
} else {
    console.error('FAILURE: No signal generated.');
}
