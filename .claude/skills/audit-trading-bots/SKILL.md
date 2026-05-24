---
name: audit-trading-bots
description: Audit, tune, or extend the Trader/Knife crypto bots in this repo. Invoke when the user asks to "audit el bot", "improve win rate", "test a new strategy", "tune knobs", "validate v14/v4", or anything strategy/backtest related on trader-bot or knife-catcher.
---

# Audit Trading Bots — Operational Skill

Quick-reference for auditing and iterating on the two scheduled bots in this repo. The slow path is reading 5 docs and re-deriving everything; this skill is the fast path.

## Repo mental model

| Layer | Files | Role |
|---|---|---|
| **Indicators core** | [netlify/functions/tradingview-strategy-core.js](../../../netlify/functions/tradingview-strategy-core.js) | VIDYA, Squeeze, MACD, RSI, EMA, SMC, SOTT, Two-Pole, ATR, regime detection, BTC context, order-book metrics, liquidity tier, execution gates, kline fetch (MEXC) |
| **Bot 1 core (no cron)** | [netlify/functions/trader-bot.js](../../../netlify/functions/trader-bot.js) | Fusion v13: 6 modules (3 live, 3 shadow), `generateSignal()`, `runAnalysis(ctx, options)`, scheduledHandler. Cron **disabled** as of 2026-05-23. |
| **Bot 2 core (no cron)** | [netlify/functions/knife-catcher.js](../../../netlify/functions/knife-catcher.js) | Reversal Lab v3: 3 modules (all shadowOnly internally), `generateSignal()`, `runAnalysis(ctx, options)`. Cron **disabled** as of 2026-05-23. |
| **Production wrappers** | [trader-bot-v14.js](../../../netlify/functions/trader-bot-v14.js), [knife-catcher-v4.js](../../../netlify/functions/knife-catcher-v4.js) | Scheduled functions that import `runAnalysis` from the v13/v3 core and pass a `signalFilter` to apply entry-quality filters post-generateSignal |
| **Backtest engine** | [scripts/v13-backtest.js](../../../scripts/v13-backtest.js) | `Backtester` class. Binance data with disk cache (TTL 6h), all knobs, OOS split, HTML+JSON reports |
| **Tournament** | [scripts/strategy-tournament.js](../../../scripts/strategy-tournament.js) | Runs preconfigured strategy variants on shared loaded data, single consolidated HTML output |
| **Verification** | [scripts/verify-wrappers.js](../../../scripts/verify-wrappers.js) | Proves wrapper filters ≡ equivalent backtest knobs |

## Bot 1 (Trader) — what to know fast

- **Live modules**: `VIDYA_SQUEEZE_EXPANSION` (~96% of trades), `SMC_DISCOUNT_RECLAIM` (rare but high quality, PF 1.62 isolated), `TWO_POLE_PULLBACK_CONTINUATION` (PF 0.53, excluded by v14).
- **Shadow modules**: `QUANTUM_REVERSION`, `VELOCITY_BREAKOUT`, `MACD_DIVERGENCE_REVERSAL`. Internally `shadowOnly: true`. Activating them in backtest with `--shadow` showed they don't improve results.
- **Hard pre-module filters** (`trader-bot.js:1241+`): `LIQUIDITY_FLOOR` (quoteVol<15M), `ATR_FILTER` (0.05-5.5%), `HTF_TREND_BEARISH`, `WEAK_RELATIVE_STRENGTH` (rs1h<0 AND rs4h<0), `OVEREXTENDED_EMA9` (|distEma9|>2%), `REGIME_RANGING_BLOCK`.
- **Score floor**: base 65, penalized +3 if liquidity MEDIUM, +3 if BTC AMBER, +4 if RANGING regime with VIDYA, +3 if VOLATILE_TRANSITION.
- **Risk model**: realRR ≥ 1.8 hard floor. Default slAtr/tpR per module: VIDYA 1.35/2.25, SMC 1.2/2.4, TWO_POLE 1.15/2.05.
- **Order-flow gate** (v13.2): rejects `ORDERFLOW_ASK_HEAVY` if OBI<-0.3, `ORDERFLOW_WEAK_BUY_PRESSURE` if deltaRatio<-0.05 without supportive OBI.

## Bot 2 (Knife) — what to know fast

- **All 3 modules are `shadowOnly: true` in the bot code itself**: `TWO_POLE_CAPITULATION_RESET`, `VIDYA_LIQUIDITY_SWEEP`, `SOTT_BAND_RECLAIM`. The bot will not emit live signals on its own unless you override `signal.shadowOnly` (which is what v4 wrapper does).
- **Effective module**: `VIDYA_LIQUIDITY_SWEEP` accounts for ~97% of trades. The other 2 are dead in practice (~2-4 trades/month).
- **5m timeframe required** — knife uses 5m as the capitulation/momentum signal.
- **Hard filter**: `BTC_RED_BLOCK` (regime RISK_OFF or BTC RED). No HTF bullish requirement (unlike Trader).
- **Score floor**: base 72 (vs 65 Trader, more selective).
- **`GLOBAL_SHADOW_MODE`** env var (`KNIFE_GLOBAL_SHADOW_MODE`): if true, all signals become shadow regardless. Should be `false` to let v4 wrapper work.

## v14/v4 wrappers — current production

**Trader v14** ([trader-bot-v14.js](../../../netlify/functions/trader-bot-v14.js)) applies 5 filters in chain:
1. `htfMomentumRising` — MACD 1h `histDeltaConsecutive >= 2`
2. `recent15mBullish` — ≥2 of last 3 15m candles green
3. `pullbackReclaimedEma9` — touched EMA9 in last 5 bars + close > EMA9
4. Exclude `TWO_POLE_PULLBACK_CONTINUATION`
5. `rs1h ≥ 0.003`

**Knife v4** ([knife-catcher-v4.js](../../../netlify/functions/knife-catcher-v4.js)):
1. Module restrict to `VIDYA_LIQUIDITY_SWEEP`
2. `rsiOversoldReclaim`: RSI 5m dipped <30 in last 8 bars, now >38, close > dip price
3. Override `signal.shadowOnly = false` to promote to live

Validated 3-month OOS top-5 USDT (BTC/ETH/SOL/BNB/XRP): Trader v14 PF 1.75 WR 39%, Knife v4 PF 2.00 WR 38%. Holdout verdicts "robust".

## Standard audit workflow

```bash
# 1. Get the baseline picture (1 min)
npm run backtest:trader -- --no-open    # current production behaviour
npm run backtest:knife  -- --no-open

# 2. Run preconfigured tournament (10-15 min for trader, 15-25 for knife)
npm run tournament:trader -- --no-open
npm run tournament:knife  -- --no-open

# 3. Inspect winners in backtests/{bot}-tournament.html — collapsible variant sections
# 4. If a new variant beats current wrapper, validate on 3 months:
node scripts/v13-backtest.js --bot=trader --months=3 [winning flags] --no-open

# 5. Verify wrappers still match (sanity check)
node scripts/verify-wrappers.js
```

## How to add a new strategy variant

1. Edit `buildStrategies()` in [scripts/strategy-tournament.js](../../../scripts/strategy-tournament.js) — append a new `{ label, desc, knobs }` object.
2. `npm run tournament:trader -- --no-open` (or knife) — see if it ranks well.
3. If it wins on 1 month, re-validate on 3 months with `--months=3`.
4. If 3-month holdout PF > 1.4, promote: add the filter logic to the wrapper file and update its `vXSignalFilter()` function.

## How to add a new entry-quality filter

The filters live in [scripts/v13-backtest.js](../../../scripts/v13-backtest.js) at top (the `htfMomentumRising`, `rsiOversoldReclaim`, etc. helpers). To add a new one:
1. Implement helper at top of `v13-backtest.js` using indicators from `tradingview-strategy-core.js`.
2. Add a knob in the constructor (e.g., `this.requireMyNewFilter = !!opts['require-my-new-filter']`).
3. Apply in `runSymbol` after the bot's `generateSignal()` returns.
4. Add to the tournament `buildStrategies()` as a new variant.
5. Run tournament, see if it helps.
6. If promoted to production: copy the helper into the wrapper file and call it from `vXSignalFilter()`.

## How to extend a bot (NOT wrap, modify core)

**Don't unless necessary.** The wrapper pattern (`runAnalysis(ctx, { signalFilter })`) covers most needs. Reasons to modify the bot core:
- Need to change the signal-generation logic itself (new module, threshold)
- Need to change risk model / exit logic (TP/SL, time-stop in live, partial-TP)

If you must:
1. Branch the original (don't edit in place): `cp trader-bot.js trader-bot-vNN.js` and rename `ALGORITHM_VERSION`.
2. Update `ALGORITHM_JOURNAL.md` BEFORE editing — describe the hypothesis + falsification.
3. Update `ALGO_DOCUMENTATION.md` to reflect the new behaviour.
4. Add equivalent backtest knobs to test the change.
5. Run full tournament + 3-month validation before considering deployment.

## Tournament / verification quirks

- **Cache lives 6h** at `backtests/.cache/`. Delete to force re-fetch. Gitignored.
- **Top-5 by volume** can include weird outliers (ZEC inflated metrics in early runs). The `DEFAULT_PAIRS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT']` is fixed blue-chip to keep results reproducible.
- **5m fetch is heavy** — Knife backtests download 60k+ candles/symbol on first run. Binance occasionally drops the HTTP/2 connection (`UND_ERR_SOCKET` / GOAWAY); the engine retries up to 3 times with backoff.
- **`scripts/verify-wrappers.js` is the integration test**. If wrapper logic drifts from the backtest filters, this fails. Always run after touching either side.
- **OOS holdout statistical strength**: 30% of the period. With 30-day backtest = ~9 days holdout, can be as few as 2-7 trades — too thin. Use `--months=3` for trustworthy OOS.

## Common questions & answers

**"Why does X variant have 0 trades?"** → score floor too high (e.g., min-score-85), or module filter too narrow, or the period was bearish and HTF_TREND_BEARISH locked the bot out.

**"Why is `--shadow` needed for Knife?"** → all 3 Knife modules are `shadowOnly: true` in the code. Without `--shadow` the bot generates 0 signals.

**"Why don't tighter SL / wider TP help?"** → empirical finding from 2026-05-23 tournament: bot's score doesn't correlate with hit-rate. The bottleneck is entry quality, not exit management.

**"How to roll back v14/v4?"** → uncomment the `import { schedule }` + `export const handler = schedule(...)` at top/bottom of each original (`trader-bot.js`, `knife-catcher.js`), delete the wrapper file (or rename so Netlify doesn't deploy it).

## Required reading order for a deep audit

If you've never touched this repo, read in this order (~30 min):
1. [AUDIT_BOTS_2026-05.md](../../../AUDIT_BOTS_2026-05.md) — the latest full audit + v14/v4 justification
2. [ALGO_DOCUMENTATION.md](../../../ALGO_DOCUMENTATION.md) — current module architecture
3. [BACKTEST_GUIDE.md](../../../BACKTEST_GUIDE.md) — engine usage
4. [ALGORITHM_JOURNAL.md](../../../ALGORITHM_JOURNAL.md) §current — what changed and why
5. [ALGORITHM_AUDIT_PROMPT_GUIDE.md](../../../ALGORITHM_AUDIT_PROMPT_GUIDE.md) — comprehensive checklist (only if doing a deep formal audit)

For lighter touch work, this skill page + the validation/audit doc is usually enough.
