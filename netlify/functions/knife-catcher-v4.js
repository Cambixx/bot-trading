/**
 * Netlify Scheduled Function — Knife Catcher v4 (Oversold-Reclaim Filter)
 *
 * Wrapper around knife-catcher.js v3 that:
 *   1. Restricts to the only meaningfully active module: VIDYA_LIQUIDITY_SWEEP
 *      (TWO_POLE_CAPITULATION_RESET and SOTT_BAND_RECLAIM fire ~4 and ~2 times
 *       per month respectively — effectively dead)
 *   2. Requires 5m RSI to have dipped below 30 in the last 8 candles AND reclaimed
 *      above 38 with current close > the dip close (true oversold-reclaim setup)
 *   3. Overrides the shadowOnly flag on signals that pass, allowing them to be
 *      treated as LIVE rather than tracked-only.
 *
 * Validation (see AUDIT_BOTS_2026-05.md):
 *   - 3-month OOS backtest top-5 USDT pairs:
 *     PF 2.00 · WR 38.1% · ROI +2.47% · Max DD -0.71%
 *     Holdout: PF 5.14 · WR 58.3% (robust)
 *
 * Deployment notes:
 *  - To go live: keep this scheduled function active and remove the schedule from
 *    knife-catcher.js (or set KNIFE_GLOBAL_SHADOW_MODE=true on the original).
 *  - Reuses the SAME state stores as the original bot. Run only ONE schedule.
 *  - Rollback: delete this file. The original knife-catcher.js works as-is.
 */

import { schedule } from "@netlify/functions";
import { runAnalysis } from './knife-catcher.js';
import { calculateRSI } from './tradingview-strategy-core.js';

export const ALGORITHM_VERSION = 'v4.0.0-OversoldReclaim';

const ALLOWED_MODULE = 'VIDYA_LIQUIDITY_SWEEP';
const OVERSOLD_LEVEL = 30;
const RECLAIM_LEVEL = 38;
const LOOKBACK_5M = 8;

function rsiOversoldReclaim(candles5m) {
  if (!candles5m || candles5m.length < 30) return false;
  const closes = candles5m.map(c => c.close);
  const currRsi = calculateRSI(closes, 14);
  if (!Number.isFinite(currRsi) || currRsi < RECLAIM_LEVEL) return false;
  let dipFound = false;
  let dipPrice = null;
  for (let i = closes.length - LOOKBACK_5M - 1; i < closes.length - 1; i++) {
    const r = calculateRSI(closes.slice(0, i + 1), 14);
    if (Number.isFinite(r) && r <= OVERSOLD_LEVEL) {
      dipFound = true;
      dipPrice = closes[i];
    }
  }
  if (!dipFound) return false;
  return closes[closes.length - 1] > dipPrice;
}

export function v4SignalFilter(signal, ctx) {
  if (signal.module !== ALLOWED_MODULE) return null;
  if (!rsiOversoldReclaim(ctx.candles5m)) return null;
  // Override the bot's shadowOnly contract so this signal counts as LIVE,
  // since the v4 filter provides the additional confirmation that was missing.
  return { ...signal, shadowOnly: false, v4Filtered: true, version: ALGORITHM_VERSION };
}

const scheduledHandler = async (event, context) => {
  return runAnalysis(context, { signalFilter: v4SignalFilter });
};

export const handler = schedule("5,20,35,50 * * * *", scheduledHandler);
