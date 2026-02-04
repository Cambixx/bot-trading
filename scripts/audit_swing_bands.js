
const MEXC_API = 'https://api.mexc.com/api/v3';

async function fetchKlines(symbol, limit = 500) {
    console.log(`Fetching ${limit} candles for ${symbol}...`);
    try {
        const res = await fetch(`${MEXC_API}/klines?symbol=${symbol}&interval=15m&limit=${limit}`);
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        return data.map(d => ({
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5])
        }));
    } catch (e) {
        console.error('Fetch error:', e);
        return [];
    }
}

function calculateATRSeries(candles, period = 14) {
    if (!candles || candles.length < period + 1) return null;
    const atrSeries = new Array(candles.length).fill(null);
    let trSum = 0;
    for (let i = 1; i <= period; i++) {
        const current = candles[i];
        const prevClose = candles[i - 1].close;
        const tr = Math.max(
            current.high - current.low,
            Math.abs(current.high - prevClose),
            Math.abs(current.low - prevClose)
        );
        trSum += tr;
    }
    let atr = trSum / period;
    atrSeries[period] = atr;
    for (let i = period + 1; i < candles.length; i++) {
        const current = candles[i];
        const prevClose = candles[i - 1].close;
        const tr = Math.max(
            current.high - current.low,
            Math.abs(current.high - prevClose),
            Math.abs(current.low - prevClose)
        );
        atr = ((atr * (period - 1)) + tr) / period;
        atrSeries[i] = atr;
    }
    return atrSeries;
}

function calculateSwingStructureBands(candles, lenSwing = 100) {
    if (!candles || candles.length < lenSwing + 50) return null;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const atrSeries = calculateATRSeries(candles, 200);
    if (!atrSeries || !atrSeries[candles.length - 1]) return null;

    // Pine State Variables imitation
    const ubSeries = new Array(candles.length).fill(NaN);
    const lbSeries = new Array(candles.length).fill(NaN);
    const ucSeries = new Array(candles.length).fill(0);
    const lcSeries = new Array(candles.length).fill(0);

    let lh = 1, ll = 1;
    let maHiHistory = new Array(candles.length).fill(0);
    let maLoHistory = new Array(candles.length).fill(0);

    const getHighest = (arr, len, idx) => {
        let max = -Infinity;
        const start = Math.max(0, idx - len + 1);
        for (let k = start; k <= idx; k++) if (arr[k] > max) max = arr[k];
        return max;
    };
    const getLowest = (arr, len, idx) => {
        let min = Infinity;
        const start = Math.max(0, idx - len + 1);
        for (let k = start; k <= idx; k++) if (arr[k] < min) min = arr[k];
        return min;
    };
    const getSma = (arr, len, idx) => {
        let sum = 0, count = 0;
        const start = Math.max(0, idx - len + 1);
        for (let k = start; k <= idx; k++) { sum += arr[k]; count++; }
        return count ? sum / count : 0;
    };

    for (let i = 0; i < candles.length; i++) {
        if (i < lenSwing) continue;

        const hiMax = getHighest(highs, lenSwing, i);
        const loMin = getLowest(lows, lenSwing, i);
        const currentHigh = highs[i];
        const currentLow = lows[i];
        const prevHigh = highs[i - 1];
        const prevLow = lows[i - 1];

        const isHiSw = (prevHigh === hiMax) && (currentHigh < hiMax);
        const isLoSw = (prevLow === loMin) && (currentLow > loMin);

        // Logic from pine implementation
        if (isLoSw) ll = 1;
        if (isHiSw) lh = 1;
        ll++;
        lh++;

        const maHi = getSma(highs, lh, i);
        const maLo = getSma(lows, ll, i);
        maHiHistory[i] = maHi;
        maLoHistory[i] = maLo;

        if (i === 0) continue;

        const atr = atrSeries[i];
        const prevMaHi = maHiHistory[i - 1];
        const prevMaLo = maLoHistory[i - 1];

        const dHi = Math.abs(maHi - prevMaHi) > atr;
        const dLo = Math.abs(maLo - prevMaLo) > atr;

        const prevUc = ucSeries[i - 1] || 0;
        const prevLc = lcSeries[i - 1] || 0;

        ucSeries[i] = !dHi ? prevUc + 1 : 0;
        lcSeries[i] = !dLo ? prevLc + 1 : 0;

        // Bands
        const ub = dHi ? NaN : maHi;
        const lb = dLo ? NaN : maLo;

        ubSeries[i] = ub;
        lbSeries[i] = lb;
    }

    const lastIdx = candles.length - 1;
    const prevIdx = lastIdx - 1;
    const low = lows[lastIdx];
    const prevLow = lows[prevIdx];
    const lb = lbSeries[lastIdx];
    const prevLb = lbSeries[prevIdx]; // Important: check crossover against band history
    const lc = lcSeries[lastIdx];

    // Debug info
    const debug = {
        lastPrice: candles[lastIdx].close,
        lb: lb,
        ub: ubSeries[lastIdx],
        lc: lc,
        uc: ucSeries[lastIdx]
    };

    // Buy Logic: Crossover(low, lb) and lc > 15
    // Note: lb can be NaN if deviating.
    const buySignal = (!Number.isNaN(lb) && !Number.isNaN(prevLb) && prevLow < prevLb && low > lb && lc > 15);

    return { buy: buySignal, debug };
}

async function runAudit() {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
    console.log("=== SWING STRUCTURE BANDS AUDIT ===");

    for (const sym of symbols) {
        const candles = await fetchKlines(sym);
        if (candles.length < 500) {
            console.log(`[${sym}] Insufficient data: ${candles.length} candles`);
            continue;
        }

        const t0 = performance.now();
        const result = calculateSwingStructureBands(candles);
        const t1 = performance.now();

        if (!result) {
            console.log(`[${sym}] Calculation Failed`);
            continue;
        }

        console.log(`[${sym}] Status: OK (${(t1 - t0).toFixed(2)}ms)`);
        console.log(`   Price: ${result.debug.lastPrice}`);
        console.log(`   LowerBand: ${result.debug.lb ? result.debug.lb.toFixed(4) : 'NaN (Volatile)'}`);
        console.log(`   UpperBand: ${result.debug.ub ? result.debug.ub.toFixed(4) : 'NaN (Volatile)'}`);
        console.log(`   LowerCount (Stability): ${result.debug.lc}`);
        console.log(`   SIGNAL: ${result.buy ? '🟢 BUY' : '⚪ NEUTRAL'}`);
        console.log('---');
    }
}

runAudit();
