/**
 * Verify that the v14/v4 production wrappers produce the same backtest metrics
 * as the equivalent --knob settings on the original bots.
 *
 * This proves that deploying the wrapper to Netlify will perform identically to
 * the validated backtest results.
 */

import { Backtester } from './v13-backtest.js';
import { v14SignalFilter } from '../netlify/functions/trader-bot-v14.js';
import { v4SignalFilter } from '../netlify/functions/knife-catcher-v4.js';

async function runBoth(label, knobOpts, customFilterOpts) {
  // Run A: with knob-based filters (the validated approach)
  const a = new Backtester({ ...knobOpts, 'no-open': true });
  await a.loadModule();
  await a.loadSymbols();
  await a.loadHistoricalData();
  const aTrades = [];
  const aDiag = [];
  for (const sym of a.symbols) {
    const res = await a.runSymbol(sym);
    aTrades.push(...res.trades);
    aDiag.push(res);
  }
  const aReport = a.buildReport(aTrades, aDiag);

  // Run B: with wrapper's custom filter, reusing A's loaded data.
  const b = new Backtester({ ...customFilterOpts, 'no-open': true });
  b.mod = a.mod;
  b.tfs = a.tfs;
  b.data = a.data;
  b.simStart = a.simStart;
  b.simEnd = a.simEnd;
  b.symbols = a.symbols;
  const bTrades = [];
  const bDiag = [];
  for (const sym of b.symbols) {
    const res = await b.runSymbol(sym);
    bTrades.push(...res.trades);
    bDiag.push(res);
  }
  const bReport = b.buildReport(bTrades, bDiag);

  const sA = aReport.summary, sB = bReport.summary;
  const match = sA.totalTrades === sB.totalTrades && Math.abs(sA.roi - sB.roi) < 0.05 && Math.abs(sA.winRate - sB.winRate) < 0.5;

  console.log(`\n${label}:`);
  console.log(`  Knob-based:   ${sA.totalTrades} trades, WR ${sA.winRate}%, PF ${sA.profitFactor}, ROI ${sA.roi}%`);
  console.log(`  Wrapper:      ${sB.totalTrades} trades, WR ${sB.winRate}%, PF ${sB.profitFactor}, ROI ${sB.roi}%`);
  console.log(`  Equivalent?   ${match ? '✅ YES' : '❌ MISMATCH'}`);
  return match;
}

(async () => {
  console.log('Verifying that production wrappers produce same metrics as backtest knobs...');

  // Trader v14: knob equivalent uses 5 entry filters (no time-stop because the wrapper
  // doesn't apply position-management changes — those are pure backtest features)
  const traderOk = await runBoth(
    'TRADER v14 (3 months)',
    {
      bot: 'trader',
      months: 3,
      'require-htf-momentum': true,
      'require-5m-bullish': true,
      'require-pullback': true,
      'exclude-modules': 'TWO_POLE_PULLBACK_CONTINUATION',
      'min-rs1h': 0.003
    },
    {
      bot: 'trader',
      months: 3,
      customSignalFilter: v14SignalFilter
    }
  );

  // Knife v4: knob equivalent uses module restrict + oversold-reclaim + shadow override
  const knifeOk = await runBoth(
    'KNIFE v4 (3 months)',
    {
      bot: 'knife',
      months: 3,
      shadow: true,
      modules: 'VIDYA_LIQUIDITY_SWEEP',
      'require-oversold-reclaim': true
    },
    {
      bot: 'knife',
      months: 3,
      shadow: true, // wrapper also enables this via signal mutation, but backtest needs it pre-set
      customSignalFilter: v4SignalFilter
    }
  );

  console.log(`\n${traderOk && knifeOk ? '✅ Both wrappers verified equivalent.' : '❌ At least one wrapper differs.'}`);
  process.exit(traderOk && knifeOk ? 0 : 1);
})().catch(e => {
  console.error('[FATAL]', e);
  process.exit(2);
});
