
// Audit for Crawler V1 logic
const MEXC_API = 'https://api.mexc.com/api/v3';

async function fetchKlines(symbol, limit = 100) {
    const res = await fetch(`${MEXC_API}/klines?symbol=${symbol}&interval=15m&limit=${limit}`);
    const data = await res.json();
    return data.map(d => ({
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5])
    }));
}

function calculateDonchianChannels(candles, period = 20) {
    const slice = candles.slice(-period - 1, -1);
    const upper = Math.max(...slice.map(c => c.high));
    const lower = Math.min(...slice.map(c => c.low));
    return { upper, lower };
}

function detectWyckoffClimax(candles) {
    const last = candles[candles.length - 1];
    const prev = candles.slice(-21, -1);
    const avgVol = prev.reduce((sum, c) => sum + c.volume, 0) / prev.length;
    const avgRange = prev.reduce((sum, c) => sum + (c.high - c.low), 0) / prev.length;

    const isVolumeClimax = last.volume > (avgVol * 3.0);
    const isSpreadClimax = (last.high - last.low) > (avgRange * 2.0);

    const body = Math.abs(last.close - last.open);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const isBullishResponse = lowerWick > body;

    return { isVolumeClimax, isSpreadClimax, isBullishResponse, final: isVolumeClimax && isSpreadClimax && isBullishResponse };
}

async function runAudit() {
    console.log("🌊 AUDIT CRAWLER V1 (Turtle & Wyckoff) 🌊\n");
    const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

    for (const sym of SYMBOLS) {
        const candles = await fetchKlines(sym);
        const dc = calculateDonchianChannels(candles);
        const wy = detectWyckoffClimax(candles);
        const price = candles[candles.length - 1].close;

        console.log(`[${sym}] Price: ${price}`);
        console.log(`   - 20-bar High (Donchian): ${dc.upper}`);
        console.log(`   - Status: ${price > dc.upper ? '🟢 BREAKOUT' : '⚪ Inside Range'}`);
        console.log(`   - Wyckoff Climax: ${wy.final ? '🟢 DETECTED' : '⚪ No Climax'}`);
        if (wy.isVolumeClimax) console.log(`     (Volume spike detected!)`);
        console.log('---');
    }
}

runAudit();
