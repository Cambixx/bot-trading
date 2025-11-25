import { performTechnicalAnalysis } from '../src/services/technicalAnalysis.js';
import { generateSignal } from '../src/services/signalGenerator.js';

function makeSyntheticCandles(n = 300, startPrice = 100) {
    const candles = [];
    let price = startPrice;
    for (let i = 0; i < n; i++) {
        const open = price;
        // random walk
        const change = (Math.random() - 0.48) * 0.02 * price; // small volatility
        const close = Math.max(0.0001, open + change);
        const high = Math.max(open, close) * (1 + Math.random() * 0.01);
        const low = Math.min(open, close) * (1 - Math.random() * 0.01);
        const volume = Math.round(100 + Math.random() * 1000);
        const takerBuyBaseVolume = Math.round(volume * (0.4 + Math.random() * 0.6));

        candles.push({ open, high, low, close, volume, takerBuyBaseVolume });
        price = close;
    }
    return candles;
}

async function run() {
    const candles = makeSyntheticCandles(400, 120);
    console.log('Generated synthetic candles:', candles.length);

    const analysis = performTechnicalAnalysis(candles);
    const signal = generateSignal(analysis, 'SYNTH/USDT');

    if (!signal) {
        console.log('No signal generated with the current configuration.');
        console.log('Categories subscores (example):', JSON.stringify(analysis.indicators ? { rsi: analysis.indicators.rsi } : {}, null, 2));
        return;
    }

    console.log('Signal generated:');
    console.log(JSON.stringify(signal, null, 2));
}

run().catch(err => {
    console.error('Backtest script error:', err);
    process.exit(1);
});
