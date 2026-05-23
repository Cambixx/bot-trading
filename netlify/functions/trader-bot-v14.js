/**
 * Netlify Scheduled Function — Trader Bot v14 (Entry-Quality Filters)
 *
 * Wrapper around trader-bot.js v13 that adds 5 post-signal entry-quality filters
 * validated to lift Win Rate from ~30% to ~39%+ and Profit Factor from 1.05 to 1.75
 * on 3-month OOS backtests (see AUDIT_BOTS_2026-05.md).
 *
 * Filters applied (all must pass):
 *  1. HTF momentum rising — MACD histogram on 1h has been increasing ≥2 consecutive bars
 *  2. Recent 15m bullish action — last 3 15m candles contain ≥2 green closes
 *  3. Pullback to EMA9 + reclaim — entered after a snap-back, not on extension
 *  4. Module exclusion — TWO_POLE_PULLBACK_CONTINUATION rejected (PF 0.53 isolated)
 *  5. Positive HTF RS — relativeStrengthSnapshot.rs1h ≥ 0.003
 *
 * Deployment notes:
 *  - To go live: keep this scheduled function active and remove the schedule from
 *    trader-bot.js (or set TRADER_GLOBAL_SHADOW_MODE=true on the original).
 *  - Reuses the SAME state stores as the original bot (cooldowns, history, blobs).
 *    Running both schedules in parallel will cause state contention — pick one.
 *  - Rollback: just delete this file. The original trader-bot.js works as-is.
 */

import { schedule } from "@netlify/functions";
import { runAnalysis } from './trader-bot.js';
import { calculateMACD, calculateEMA } from './tradingview-strategy-core.js';

export const ALGORITHM_VERSION = 'v14.0.0-EntryQualityFilters';

// --- v14 filter helpers ---

function htfMomentumRising(candles1h) {
  if (!candles1h || candles1h.length < 40) return false;
  const macd = calculateMACD(candles1h.map(c => c.close));
  if (!macd) return false;
  return macd.histDeltaConsecutive >= 2;
}

function recent15mBullish(candles15m, lookback = 3) {
  if (!candles15m || candles15m.length < lookback) return false;
  const last = candles15m.slice(-lookback);
  return last.filter(c => c.close > c.open).length >= 2;
}

function pullbackReclaimedEma9(candles15m, lookback = 5) {
  if (!candles15m || candles15m.length < 30) return false;
  const closes = candles15m.map(c => c.close);
  const ema9 = calculateEMA(closes, 9);
  if (!Number.isFinite(ema9)) return false;
  const recent = candles15m.slice(-lookback - 1, -1);
  const touched = recent.some(c => c.low <= ema9 * 1.001);
  const reclaimed = candles15m[candles15m.length - 1].close > ema9;
  return touched && reclaimed;
}

const EXCLUDED_MODULES = new Set(['TWO_POLE_PULLBACK_CONTINUATION']);
const MIN_RS_1H = 0.003;

export function v14SignalFilter(signal, ctx) {
  if (EXCLUDED_MODULES.has(signal.module)) return null;
  if (!htfMomentumRising(ctx.candles1h)) return null;
  if (!recent15mBullish(ctx.candles15m)) return null;
  if (!pullbackReclaimedEma9(ctx.candles15m)) return null;
  const rs1h = signal.relativeStrengthSnapshot?.rs1h;
  if (!Number.isFinite(rs1h) || rs1h < MIN_RS_1H) return null;
  // Tag the signal so downstream knows it passed v14 filters.
  return { ...signal, v14Filtered: true, version: ALGORITHM_VERSION };
}

// --- Scheduled handler ---

const scheduledHandler = async (event, context) => {
  return runAnalysis(context, { signalFilter: v14SignalFilter });
};

export const handler = schedule("0,15,30,45 * * * *", scheduledHandler);
