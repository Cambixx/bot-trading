#!/usr/bin/env node
/**
 * Diagnostic script: Shows exactly how many candles pass each filter stage
 * Usage: node scripts/diagnose-filters.js [SYMBOL] [--months N]
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const symbol = args.find(a => !a.startsWith('--')) || 'BTCUSDT';
const monthsArg = args.find(a => a.startsWith('--months'));
const months = monthsArg ? Number(monthsArg.split('=')[1] || monthsArg.split(' ')[1]) : 3;

const now = Date.now();
const startTime = now - months * 30 * 24 * 60 * 60 * 1000;

async function fetchKlines(sym, interval, start, end) {
  const allCandles = [];
  let cursor = start;
  while (cursor < end) {
    const url = `https://api.mexc.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=500&startTime=${cursor}&endTime=${end}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    const parsed = data.map(k => ({
      time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
    }));
    allCandles.push(...parsed);
    cursor = parsed[parsed.length - 1].time + 1;
    if (parsed.length < 500) break;
  }
  return allCandles;
}

// Simple EMA calculation
function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// Simple RSI
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  gains /= period; losses /= period;
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

async function main() {
  console.log(`\n🔬 FILTER DIAGNOSTIC for ${symbol} (${months} months)\n`);
  console.log('Loading data...');

  const [candles15m, candles1h, candles4h] = await Promise.all([
    fetchKlines(symbol, '15m', startTime, now),
    fetchKlines(symbol, '60m', startTime, now),
    fetchKlines(symbol, '4h', startTime, now),
  ]);

  console.log(`  15m: ${candles15m.length} candles`);
  console.log(`  1h:  ${candles1h.length} candles`);
  console.log(`  4h:  ${candles4h.length} candles\n`);

  // Walk through 15m candles and check filters at each point
  const counters = {
    total: 0,
    pass_data: 0,
    pass_bull4h: 0,
    pass_bull4h_OR_bull1h: 0,
    pass_ema9_dist_125: 0,
    pass_ema9_dist_200: 0,
    pass_ema9_dist_300: 0,
    pass_rsi_range: 0,
    pass_all_strict: 0,   // bull4h + ema9 < 1.25
    pass_all_relaxed: 0,  // bull1h OR bull4h + ema9 < 2.0
    pass_all_moderate: 0, // bull4h + ema9 < 2.0
  };

  // We need enough history for EMAs
  const minHistory4h = 60; // for EMA50
  const minHistory1h = 60;
  const minHistory15m = 60;

  for (let i = 250; i < candles15m.length; i++) {
    const t = candles15m[i].time;
    counters.total++;

    // Get matching 1h and 4h snapshots
    const snapshot4h = candles4h.filter(c => c.time <= t);
    const snapshot1h = candles1h.filter(c => c.time <= t);

    if (snapshot4h.length < minHistory4h || snapshot1h.length < minHistory1h) continue;
    counters.pass_data++;

    const closes4h = snapshot4h.map(c => c.close);
    const closes1h = snapshot1h.map(c => c.close);
    const closes15m_slice = candles15m.slice(Math.max(0, i - 200), i + 1).map(c => c.close);

    // Calculate EMAs
    const ema21_4h = calcEMA(closes4h, 21);
    const ema50_4h = calcEMA(closes4h, 50);
    const ema21_1h = calcEMA(closes1h, 21);
    const ema50_1h = calcEMA(closes1h, 50);
    const ema9_15m = calcEMA(closes15m_slice, 9);
    const price = candles15m[i].close;

    // Bull checks
    const bull4h = ema21_4h && ema50_4h && price > ema21_4h && ema21_4h > ema50_4h;
    const bull1h = ema21_1h && ema50_1h && price > ema21_1h && ema21_1h > ema50_1h;

    if (bull4h) counters.pass_bull4h++;
    if (bull4h || bull1h) counters.pass_bull4h_OR_bull1h++;

    // EMA9 distance
    const dist = ema9_15m ? Math.abs((price - ema9_15m) / ema9_15m) * 100 : 99;
    if (dist <= 1.25) counters.pass_ema9_dist_125++;
    if (dist <= 2.0) counters.pass_ema9_dist_200++;
    if (dist <= 3.0) counters.pass_ema9_dist_300++;

    // RSI
    const rsi = calcRSI(closes15m_slice, 14);
    if (rsi && rsi >= 30 && rsi <= 75) counters.pass_rsi_range++;

    // Combined
    if (bull4h && dist <= 1.25) counters.pass_all_strict++;
    if ((bull4h || bull1h) && dist <= 2.0) counters.pass_all_relaxed++;
    if (bull4h && dist <= 2.0) counters.pass_all_moderate++;
  }

  const pct = (n) => ((n / counters.total) * 100).toFixed(1);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  FILTER PASS RATES');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total 15m candles evaluated:     ${counters.total}`);
  console.log(`  With sufficient MTF data:        ${counters.pass_data} (${pct(counters.pass_data)}%)`);
  console.log('');
  console.log('  --- Individual Filters ---');
  console.log(`  bull4h (Price>EMA21>EMA50):       ${counters.pass_bull4h} (${pct(counters.pass_bull4h)}%)`);
  console.log(`  bull4h OR bull1h:                  ${counters.pass_bull4h_OR_bull1h} (${pct(counters.pass_bull4h_OR_bull1h)}%)`);
  console.log(`  EMA9 distance ≤ 1.25%:            ${counters.pass_ema9_dist_125} (${pct(counters.pass_ema9_dist_125)}%)`);
  console.log(`  EMA9 distance ≤ 2.0%:             ${counters.pass_ema9_dist_200} (${pct(counters.pass_ema9_dist_200)}%)`);
  console.log(`  EMA9 distance ≤ 3.0%:             ${counters.pass_ema9_dist_300} (${pct(counters.pass_ema9_dist_300)}%)`);
  console.log(`  RSI in [30, 75]:                   ${counters.pass_rsi_range} (${pct(counters.pass_rsi_range)}%)`);
  console.log('');
  console.log('  --- Combined (Gateway pass) ---');
  console.log(`  STRICT  (bull4h + EMA9≤1.25%):    ${counters.pass_all_strict} (${pct(counters.pass_all_strict)}%)`);
  console.log(`  MODERATE(bull4h + EMA9≤2.0%):     ${counters.pass_all_moderate} (${pct(counters.pass_all_moderate)}%)`);
  console.log(`  RELAXED (bull4h|1h + EMA9≤2.0%):  ${counters.pass_all_relaxed} (${pct(counters.pass_all_relaxed)}%)`);
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(console.error);
