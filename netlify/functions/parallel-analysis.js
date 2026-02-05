
/**
 * Netlify Scheduled Function - PARALLEL STRATEGIST (CRAWLER_V1)
 * Independent algorithmic trading crawler using specialized skills
 */

import { schedule } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

console.log('--- [CRAWLER-V1] Starting Parallel Analysis ---');

// === CONFIGURATION ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SIGNAL_SCORE_THRESHOLD = 70; // Higher threshold for parallel bot
const MEXC_API = 'https://api.mexc.com/api/v3';
const CRAWLER_COOLDOWN_MIN = 240; // 4 hour cooldown per symbol for Crawler
const CRAWLER_STORE_KEY = 'crawler-cooldowns';

// === UTILS ===
function escapeMarkdownV2(text = '') {
    if (typeof text !== 'string') text = String(text);
    return text.replace(/([_*\u005B\u005D()~`>#+=|{}.!-])/g, '\\$1');
}

async function fetchKlines(symbol, interval, limit = 100) {
    const url = `${MEXC_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
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

// === STRATEGY FUNCTIONS (Skills-Based) ===

function calculateDonchianChannels(candles, period = 20) {
    const slice = candles.slice(-period - 1, -1); // Exclude current forming candle
    const upper = Math.max(...slice.map(c => c.high));
    const lower = Math.min(...slice.map(c => c.low));
    return { upper, lower };
}

function detectWyckoffClimax(candles) {
    const last = candles[candles.length - 1]; // Current
    const prev = candles.slice(-21, -1); // Last 20 closed
    const avgVol = prev.reduce((sum, c) => sum + c.volume, 0) / prev.length;
    const avgRange = prev.reduce((sum, c) => sum + (c.high - c.low), 0) / prev.length;

    const isVolumeClimax = last.volume > (avgVol * 3.0);
    const isSpreadClimax = (last.high - last.low) > (avgRange * 2.0);

    // Bottom climax often has long lower wick
    const body = Math.abs(last.close - last.open);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const isBullishResponse = lowerWick > body;

    return isVolumeClimax && isSpreadClimax && isBullishResponse;
}

function detectRegime(candles) {
    // Simplified version for CRAWLER
    const closes = candles.map(c => c.close);
    const ema20 = closes.slice(-20).reduce((a, b) => a + b) / 20;
    const lastPrice = closes[closes.length - 1];

    // Very basic regime: Trending if far from EMA, else Choppy
    const dist = ((lastPrice - ema20) / ema20) * 100;
    if (Math.abs(dist) < 0.2) return 'MIXED_CHOPPY';
    return dist > 0 ? 'TRENDING_UP' : 'TRENDING_DOWN';
}

// === MAIN LOGIC ===

async function analyzeSymbol(symbol) {
    try {
        const candles = await fetchKlines(symbol, '15m', 100);
        if (candles.length < 50) return null;

        const regime = detectRegime(candles);
        if (regime === 'MIXED_CHOPPY') return null; // Skill advice: No trade in choppy

        const donchian = calculateDonchianChannels(candles, 20);
        const wyckoff = detectWyckoffClimax(candles);
        const currentPrice = candles[candles.length - 1].close;

        let signals = [];
        let score = 0;

        // Strategy 1: Turtle Breakout
        if (currentPrice > donchian.upper) {
            score += 50;
            signals.push('🌊 Turtle Breakout (20-bar High)');
        }

        // Strategy 2: Wyckoff Climax
        if (wyckoff) {
            score += 40;
            signals.push('🐋 Institutional Climax (VSA)');
        }

        if (score >= SIGNAL_SCORE_THRESHOLD) {
            return {
                symbol,
                price: currentPrice,
                regime,
                score,
                signals
            };
        }
    } catch (e) {
        console.error(`Error analyzing ${symbol}:`, e.message);
    }
    return null;
}

async function sendAlert(signal) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

    const message = `
🌊 *[CRAWLER-V1] MULTI-STRATEGY ALERT* 🌊
------------------------------------------
💎 *Symbol:* ${escapeMarkdownV2(signal.symbol)}
📈 *Price:* ${escapeMarkdownV2(signal.price.toFixed(4))}
🎯 *Score:* ${signal.score}/100
🌐 *Regime:* ${escapeMarkdownV2(signal.regime)}

*Confluence Strategy:*
${signal.signals.map(s => `✅ ${escapeMarkdownV2(s)}`).join('\n')}

_Crawler V1 uses Turtle & Wyckoff logic independent of Core strategy._
    `.trim();

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'MarkdownV2'
        })
    });
}

const handler = async (event, context) => {
    const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'FETUSDT', 'XRPUSDT', 'BNBUSDT'];
    const store = getStore(CRAWLER_STORE_KEY);

    console.log(`Analyzing ${SYMBOLS.length} symbols...`);

    for (const sym of SYMBOLS) {
        // Cooldown check
        const lastAlert = await store.get(sym);
        if (lastAlert) {
            const age = (Date.now() - parseInt(lastAlert)) / (1000 * 60);
            if (age < CRAWLER_COOLDOWN_MIN) continue;
        }

        const signal = await analyzeSymbol(sym);
        if (signal) {
            console.log(`🎯 SIGNAL FOUND for ${sym}: ${signal.score}`);
            await sendAlert(signal);
            await store.set(sym, Date.now().toString());
        }
    }

    return { statusCode: 200, body: JSON.stringify({ message: "Analysis complete" }) };
};

const scheduledHandler = schedule("*/15 * * * *", handler);

export { scheduledHandler as handler };
