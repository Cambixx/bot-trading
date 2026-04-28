/**
 * Netlify Scheduled Function - Quantum Sniper Bot v12.0.0
 * Estrategia de Confluencia: SMC + ML + Squeeze + MACD
 * Enfocado en Spot Long-only, Alta Precisión.
 */

import { schedule } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// --- CONFIGURACIÓN ---
const ALGORITHM_VERSION = 'v12.0.0-QuantumSniper';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const QUOTE_ASSET = (process.env.QUOTE_ASSET || 'USDT').toUpperCase();
const MIN_QUOTE_VOL_24H = Number(process.env.MIN_QUOTE_VOL_24H) || 15000000; 
const MEXC_API = 'https://api.mexc.com/api/v3';

// --- INDICADORES ---

function calculateSMA(data, length) {
    let result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < length - 1) { result.push(null); continue; }
        const slice = data.slice(i - length + 1, i + 1);
        const sum = slice.reduce((a, b) => a + b, 0);
        result.push(sum / length);
    }
    return result;
}

function calculateStdev(data, length) {
    const sma = calculateSMA(data, length);
    return data.map((d, i) => {
        if (i < length - 1) return null;
        const avg = sma[i];
        const slice = data.slice(i - length + 1, i + 1);
        const squareDiffs = slice.map(x => Math.pow(x - avg, 2));
        return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / length);
    });
}

function calculateEMA(data, length) {
    if (!data.length) return [];
    const k = 2 / (length + 1);
    let ema = [data[0]];
    for (let i = 1; i < data.length; i++) {
        ema.push(data[i] * k + (ema[i - 1] || data[0]) * (1 - k));
    }
    return ema;
}

function calculateSqueeze(candles, length = 20, multBB = 2.0, multKC = 1.5) {
    if (candles.length < length) return { sqzOn: false, sqzOff: true, momentum: 0, isBullish: false };
    const closes = candles.map(c => c.close);
    const sma = calculateSMA(closes, length);
    const stdev = calculateStdev(closes, length);
    const lastIdx = closes.length - 1;
    
    if (sma[lastIdx] === null || stdev[lastIdx] === null) return { sqzOn: false, sqzOff: true, momentum: 0, isBullish: false };

    const upperBB = sma[lastIdx] + (multBB * stdev[lastIdx]);
    const lowerBB = sma[lastIdx] - (multBB * stdev[lastIdx]);

    const tr = candles.map((c, i) => {
        if (i === 0) return c.high - c.low;
        return Math.max(c.high - c.low, Math.abs(c.high - candles[i-1].close), Math.abs(c.low - candles[i-1].close));
    });
    const smaTR = calculateSMA(tr, length);
    const upperKC = sma[lastIdx] + (multKC * smaTR[lastIdx]);
    const lowerKC = sma[lastIdx] - (multKC * smaTR[lastIdx]);

    const sqzOn = lowerBB > lowerKC && upperBB < upperKC;
    
    const highestArr = candles.slice(-length).map(c => c.high);
    const lowestArr = candles.slice(-length).map(c => c.low);
    const midPrice = ( (Math.max(...highestArr) + Math.min(...lowestArr)) / 2 + sma[lastIdx] ) / 2;
    const momentum = closes[lastIdx] - midPrice;
    
    return { sqzOn, sqzOff: !sqzOn, momentum, isBullish: momentum > 0 };
}

function findPivots(candles, length) {
    let highs = [], lows = [];
    for (let i = length; i < candles.length - length; i++) {
        const currentHigh = candles[i].high;
        const currentLow = candles[i].low;
        let isHigh = true, isLow = true;
        for (let j = 1; j <= length; j++) {
            if (candles[i-j].high >= currentHigh || candles[i+j].high > currentHigh) isHigh = false;
            if (candles[i-j].low <= currentLow || candles[i+j].low < currentLow) isLow = false;
        }
        if (isHigh) highs.push({ price: currentHigh, index: i });
        if (isLow) lows.push({ price: currentLow, index: i });
    }
    return { highs, lows };
}

function detectSMC(candles) {
    const pivots = findPivots(candles, 5); 
    if (pivots.highs.length === 0 || pivots.lows.length === 0) return { bullishBOS: false, inDiscountZone: false };
    const lastPivotHigh = pivots.highs[pivots.highs.length - 1];
    const lastPivotLow = pivots.lows[pivots.lows.length - 1];
    const currentPrice = candles[candles.length - 1].close;
    const bullishBOS = currentPrice > lastPivotHigh.price;
    return {
        bullishBOS,
        lastHigh: lastPivotHigh.price,
        lastLow: lastPivotLow.price,
        inDiscountZone: currentPrice < (lastPivotHigh.price + lastPivotLow.price) / 2
    };
}

function calculateML(prices) {
    // Regression simplificada para detectar tendencia
    const n = prices.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += i; sumY += prices[i]; sumXY += i * prices[i]; sumX2 += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return { slope, isBullish: slope > 0 };
}

function calculateMACD(prices) {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    if (ema12.length < 2 || ema26.length < 2) return { hist: 0, histPrev: 0 };
    const hist = ema12[ema12.length - 1] - ema26[ema26.length - 1];
    const histPrev = ema12[ema12.length - 2] - ema26[ema26.length - 2];
    return { hist, histPrev };
}

function calculateMultiDelta(candles) {
    try {
        const last3 = candles.slice(-3);
        const delta = last3.reduce((acc, c) => {
            const body = c.close - c.open;
            const range = c.high - c.low || 0.000001;
            return acc + (body / range);
        }, 0) / 3;
        return delta || 0;
    } catch (e) { return 0; }
}

// --- PERSISTENCIA (Netlify Blobs) ---

const HISTORY_STORE_KEY = 'signal-history-v2';

async function getInternalStore(context = {}) {
    return getStore({
        name: 'trading-signals',
        siteID: context.siteID || 'be80fad2-39f0-4f8f-b67c-871b07ce7b97',
        token: context.token || process.env.NETLIFY_PURGE_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN
    });
}

async function updateSignalHistory(tickers, context) {
    if (!tickers || tickers.length === 0) return;
    const store = await getInternalStore(context);
    let history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];
    let updated = false;

    const prices = new Map(tickers.map(t => [t.symbol, parseFloat(t.lastPrice)]));

    for (const item of history) {
        if (item.status !== 'OPEN') continue;
        const currentPrice = prices.get(item.symbol);
        if (!currentPrice) continue;

        if (currentPrice >= item.tp) {
            item.status = 'CLOSED';
            item.outcome = 'WIN';
            item.exitPrice = currentPrice;
            item.closedAt = Date.now();
            updated = true;
        } else if (currentPrice <= item.sl) {
            item.status = 'CLOSED';
            item.outcome = 'LOSS';
            item.exitPrice = currentPrice;
            item.closedAt = Date.now();
            updated = true;
        }
    }

    if (updated) await store.setJSON(HISTORY_STORE_KEY, history);
}

async function saveSignalToHistory(signal, context) {
    const store = await getInternalStore(context);
    let history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];
    
    const entry = {
        id: `SNIPER-${Date.now()}-${signal.symbol}`,
        symbol: signal.symbol,
        price: signal.price,
        tp: signal.tp,
        sl: signal.sl,
        score: signal.score,
        module: 'CONFLUENCE_SNIPER',
        status: 'OPEN',
        time: Date.now(),
        version: ALGORITHM_VERSION,
        metrics: signal.metrics
    };

    history.push(entry);
    await store.setJSON(HISTORY_STORE_KEY, history.slice(-100));
}

// --- CORE ---

async function getKlines(symbol, interval, limit) {
    const mexcInterval = interval === '1h' ? '60m' : interval;
    const url = `${MEXC_API}/klines?symbol=${symbol}&interval=${mexcInterval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MEXC API Error: ${res.status}`);
    const data = await res.json();
    return data.map(d => ({
        time: d[0],
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5])
    }));
}

async function analyzeSymbol(symbol) {
    try {
        const candles = await getKlines(symbol, '60m', 100);
        if (!candles || candles.length < 50) return null;

        const sqz = calculateSqueeze(candles);
        const smc = detectSMC(candles);
        const ml = calculateML(candles.map(c => c.close));
        const macd = calculateMACD(candles.map(c => c.close));
        const multiDelta = calculateMultiDelta(candles);

        let score = 0;
        const reasons = [];

        if (ml.isBullish) { score += 20; reasons.push("Tendencia ML Positiva"); }
        if (smc.bullishBOS) { score += 20; reasons.push("Break of Structure (BOS)"); }
        if (smc.inDiscountZone) { score += 10; reasons.push("Zona de Descuento"); }
        if (sqz.sqzOff && sqz.isBullish) { score += 25; reasons.push("Squeeze Fire (Alcista)"); }
        if (macd.hist > macd.histPrev && macd.hist > 0) { score += 20; reasons.push("MACD Momentum"); }
        if (multiDelta > 0.15) { score += 5; reasons.push("Presión Taker Positiva"); }

        if (score >= 70) {
            return {
                symbol,
                price: candles[candles.length - 1].close,
                score,
                reasons,
                sl: smc.lastLow ? smc.lastLow * 0.995 : candles[candles.length-1].close * 0.98,
                tp: candles[candles.length - 1].close * 1.04,
                metrics: { smc, ml, sqz, macd, multiDelta }
            };
        }
    } catch (e) {
        console.error(`Error analizando ${symbol}:`, e.message);
    }
    return null;
}

export async function runAnalysis(context) {
    console.log(`--- Iniciando Análisis Quantum Sniper ${ALGORITHM_VERSION} ---`);
    try {
        const res = await fetch(`${MEXC_API}/ticker/24hr`);
        const tickers = await res.json();
        
        await updateSignalHistory(tickers, context);

        const candidates = tickers.filter(t => 
            t.symbol.endsWith(QUOTE_ASSET) && 
            parseFloat(t.quoteVolume) > MIN_QUOTE_VOL_24H
        );
        
        console.log(`Analizando ${candidates.length} activos con volumen >$${(MIN_QUOTE_VOL_24H/1000000).toFixed(1)}M...`);
        const signals = [];
        
        for (const candidate of candidates.slice(0, 40)) {
            const signal = await analyzeSymbol(candidate.symbol);
            if (signal) {
                console.log(`¡SEÑAL! ${signal.symbol} Score: ${signal.score}`);
                await sendTelegramSignal(signal);
                await saveSignalToHistory(signal, context);
                signals.push(signal);
            }
        }
        
        return { success: true, signals: signals.length, timestamp: new Date().toISOString() };
    } catch (error) {
        console.error("Error en runAnalysis:", error);
        return { success: false, error: error.message };
    }
}

async function sendTelegramSignal(signal) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    const text = `🦅 *QUANTUM SNIPER V12* (${ALGORITHM_VERSION})\n\n` +
                 `💎 Símbolo: #${signal.symbol}\n` +
                 `📈 Precio: ${signal.price}\n` +
                 `🎯 TP: ${signal.tp.toFixed(6)}\n` +
                 `🛡️ SL: ${signal.sl.toFixed(6)}\n` +
                 `⭐ Score: ${signal.score}/100\n\n` +
                 `📝 Confluencias:\n${signal.reasons.map(r => `• ${r}`).join('\n')}`;
    
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(text)}&parse_mode=Markdown`;
    try { await fetch(url); } catch (e) { console.error("Error Telegram:", e.message); }
}

const scheduledHandler = async (event, context) => {
    const result = await runAnalysis(context);
    return {
        statusCode: 200,
        body: JSON.stringify(result)
    };
};

export const handler = schedule("*/15 * * * *", scheduledHandler);
