import { performTechnicalAnalysis } from '../src/services/technicalAnalysis.js';
import { generateSignal, SIGNAL_CONFIG } from '../src/services/signalGenerator.js';

// Simple helper to fetch klines from Binance public API
async function fetchKlines(symbol = 'BTCUSDT', interval = '1h', limit = 500) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch klines: ${res.status} ${res.statusText}`);
    const data = await res.json();
    // map to {open, high, low, close, volume, takerBuyBaseVolume}
    return data.map(k => ({
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        takerBuyBaseVolume: Number(k[9])
    }));
}

// Evaluate simple hit: did price reach TP1 within horizon or did it hit SL
function evaluateSignal(candles, entryIndex, levels, horizon = 4) {
    // look at next `horizon` candles after entryIndex (entry is at entryIndex)
    const end = Math.min(candles.length - 1, entryIndex + horizon);
    const entryPrice = levels.entry;
    const tp1 = levels.takeProfit1;
    const sl = levels.stopLoss;

    let result = { hitTP1: false, hitSL: false, maxReturnPct: 0 };
    for (let i = entryIndex + 1; i <= end; i++) {
        const c = candles[i];
        // if high crosses tp1
        if (c.high >= tp1) {
            result.hitTP1 = true;
            break;
        }
        if (c.low <= sl) {
            result.hitSL = true;
            break;
        }
        const ret = (c.close - entryPrice) / entryPrice;
        if (ret > result.maxReturnPct) result.maxReturnPct = ret;
    }
    return result;
}

async function runForSymbol(symbol = 'BTCUSDT', interval = '1h', limit = 600) {
    console.log(`Fetching ${symbol} ${interval} ...`);
    const candles = await fetchKlines(symbol, interval, limit);
    console.log('Candles:', candles.length);

    const window = 200; // use lookback window for indicators
    const stats = {
        signals: []
    };

    for (let i = window; i < candles.length - 5; i++) {
        const slice = candles.slice(i - window, i + 1);
        const analysis = performTechnicalAnalysis(slice);
        const signal = generateSignal(analysis, symbol);
        if (signal) {
            // entry at candle i (last candle of slice)
            const evalRes = evaluateSignal(candles, i, signal.levels, 4); // check next 4 candles
            stats.signals.push({ index: i, signal, eval: evalRes });
        }
    }

    return { symbol, totalSignals: stats.signals.length, signals: stats.signals };
}

async function main() {
    const symbols = ['BTCUSDT', 'ETHUSDT'];
    const results = [];
    // Try different scoreToEmit thresholds to calibrate
    const thresholds = [0.6, 0.7, 0.75];
    const requiredCatsOptions = [2, 3];

    for (const th of thresholds) {
        for (const req of requiredCatsOptions) {
            SIGNAL_CONFIG.scoreToEmit = th;
            SIGNAL_CONFIG.requiredCategories = req;
            console.log(`\n--- Testing scoreToEmit=${th}, requiredCategories=${req} ---`);

            for (const s of symbols) {
                try {
                    const r = await runForSymbol(s, '1h', 600);
                    const total = r.totalSignals;
                    const hitTP = r.signals.filter(sig => sig.eval.hitTP1).length;
                    const hitSL = r.signals.filter(sig => sig.eval.hitSL).length;
                    const avgMaxRet = (r.signals.reduce((a, b) => a + b.eval.maxReturnPct, 0) / Math.max(1, r.signals.length)) * 100;
                    console.log(`\n=== ${r.symbol} ===`);
                    console.log('Signals found:', total);
                    console.log('TP1 hits within 4 candles:', hitTP);
                    console.log('SL hits within 4 candles:', hitSL);
                    console.log('Avg max return% (next 4 candles):', avgMaxRet.toFixed(2));
                } catch (err) {
                    console.error('Error for', s, err.message);
                }
            }
        }
    }

    console.log('\nFinal SIGNAL_CONFIG used (mutated for tests):', SIGNAL_CONFIG);
}

main().catch(err => { console.error(err); process.exit(1); });
