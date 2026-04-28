# Quantum Algorithm Audit & Redesign Guide

> **Version:** `4.0.0-QuantumSniper`
> **Last Updated:** `2026-04-28`
> **Applies To:** `netlify/functions/trader-bot.js` (Bot 1: QuantumEdge) and `netlify/functions/knife-catcher.js` (Bot 2: Knife Catcher)
>
> This document is the working guide for auditing, diagnosing, and redesigning both trading algorithms.
> Use it when reviewing live behavior, diagnosing no-signal periods, auditing exit geometry, or proposing code changes.
>
> **If this guide and the runtime disagree, the code wins.** Update the guide after the code, not instead of it.

---

## 1. Directives for the AI Auditor

These directives are non-negotiable constraints. They override any instruction given during the conversation.

### 1.1 Hard Rules

| Rule | Detail |
|------|--------|
| **DO NOT hallucinate data** | If the user has not provided the JSON blobs for the target bot, halt immediately and list exactly which files are missing. Do not infer or fabricate numbers. |
| **DO NOT mix bot data** | Always explicitly label every data point as belonging to `Bot 1 (QuantumEdge)` or `Bot 2 (Knife Catcher)`. Cross-contamination invalidates the entire audit. |
| **Calculate before speaking** | Before any recommendation, you must have computed: Win Rate, Expectancy (in R units), avg MFE, avg MAE, and funnel throughput for the specific module in question. If sample size < 20 resolved trades, state that the data is inconclusive and widen the window or use shadow data. |
| **Cite the source** | Every claim must cite the specific file and field it came from. `"win rate is 62%"` is inadmissible. `"win rate is 62% per autopsies.json, n=26 decisive trades, window 2026-04-01 to 2026-04-18"` is admissible. |
| **Be ruthless, not cruel** | State failures mathematically. Do not flatter. Do not catastrophize. If the data shows a module with 55% win rate and 2.0 R:R, that is a healthy positive-expectancy edge. If the data shows 40% win rate and 1.5 R:R, that is a -EV system. Say so. |
| **Separate production from research** | Never describe an experimental idea as if it were live in production. Always label proposals as `[PROPOSED]`, never `[ACTIVE]`. |

### 1.2 The Audit Standard

> **The goal is not to make the bot trade more. The goal is to preserve and improve real edge without regressing telemetry, execution safety, or observability.**

This means:

1. **Evidence over intuition.** Every recommendation must be backed by `history.json`, `shadow_trades.json`, `autopsies.json`, `persistent_logs.json`, or direct runtime code.
2. **Pure Edge over Score Soup.** A setup is valid because it passes a deterministic module. Score ranks valid candidates and influences sizing. Score does not manufacture trades from weak evidence.
3. **Production safety is non-negotiable.** A "better strategy" that silently breaks logs, blob writes, the scheduler, or Telegram payloads is a regression, not an improvement.
4. **Silence requires proof.** If no signals have fired in 72 hours, prove whether the market was genuinely poor (BTC_RED, low ATR, all TRANSITION regime) or whether the funnel is incorrectly choking valid setups. "Conditions were bad" is a hypothesis, not a finding.

---

## 2. Runtime Baseline — What Is Actually Live

Before auditing anything, anchor to the current deployed state. If you are reviewing code that has been recently updated, explicitly note the version delta and what changed.

### 2.1 Bot 1: Quantum Sniper (`trader-bot.js`)

**Current version:** `v12.0.0-QuantumSniper`
**Scope:** High-confluence institutional setups (SMC, ML, Volatility, Momentum).
**Schedule:** Every 15 minutes (`0,15,30,45 * * * *`).

#### Active Live Modules

##### `CONFLUENCE_SNIPER`
A signal is only considered if the aggregate score (confluence) is $\ge$ 70/100.

| Module | Purpose | Weight/Gate |
|--------|---------|-------------|
| **SMC (Smart Money)** | Market Structure | **Hard Gate:** BOS (Break of Structure) within last 5 bars OR price near Order Block (OB). |
| **ML Trend (GPR)** | Directional Bias | **Hard Gate:** ML Slope must be positive (GPR Trend > 0). |
| **Squeeze Momentum** | Volatility State | **Hard Gate:** Must NOT be in a "black squeeze" (BB inside KC without expansion). |
| **MACD Custom** | Momentum Confirmation | **Hard Gate:** MACD Histogram > 0 and crossing up. |

**Score Distribution (Max 100):**
- **SMC Strength:** 30 pts (Alignment with OB/BOS)
- **ML Confidence:** 25 pts (Strength of GPR slope)
- **Squeeze Intensity:** 25 pts (Expansion magnitude)
- **Momentum (MACD):** 20 pts (Multi-timeframe alignment)

**Risk Model (v12.0.0):**
- **Stop Loss:** Dynamic. Set at recent Swing Low (0.5% buffer).
- **Take Profit:** Reward-to-Risk (RR) target of 2.0x (dynamic based on volatility).
- **Time Stop:** 12 hours.

#### Runtime Gates Outside the Modules

| Gate | Effect |
|------|--------|
| `BTC_RED` | Blocks ALL live signals via `REGIME_RISK_OFF`. |
| `TRANSITION` Regime | **Hard Block** (Added v12.0.0). No trading allowed in this regime. |
| `LOW` Liquidity | Blocked unless 24h Vol > $2M or depth floor met. |
| Score < 70 | `SCORE_BELOW_FLOOR` — Signal is discarded or shadowed. |

#### Runtime Gates Outside the Modules

| Gate | Effect |
|------|--------|
| `BTC_RED` (4H trend break or RSI4h < 44) | Blocks ALL live signals via `REGIME_RISK_OFF` |
| `btcRisk = AMBER` (1H stretched > EMA21 × 1.018 or RSI1h > 68) | Increases required score; blocks VCP_BREAKOUT |
| `MEDIUM` liquidity tier | Only VWAP_PULLBACK can trade live; VCP blocked |
| `LOW` liquidity tier | Blocked unless depth ≥ $200k (depth-floor promotion, half sizing) |
| Score below `requiredScore` | `SCORE_BELOW_FLOOR` — enters shadow, not live |
| Open position on same symbol | `OPEN_POSITION_BLOCK` |
| Cooldown (default 240 min) | `COOLDOWN_BLOCK` |
| Sector already selected | `SECTOR_CORRELATION` — only one signal per sector allowed per cycle |

#### v11.0.0 New Features (Audit Must Verify These Are Active)

- **VWAP anchor**: 96 candles (24h) instead of 50
- **`multiDelta`**: 3-candle cumulative taker buying pressure (field visible in `entryMetrics.multiDelta`)
- **ADX gates**: Both modules have ADX hard gates and score bonuses
- **`momentumAdjustment`**: Signal memory-based ±3 pts score adjustment (field `momentumAdjustment` must not be `0` for recurring symbols)
- **Trailing stop to break-even**: When price reaches 50% of TP distance, SL moves to entry + 0.1% (`trailingStopActive` field in history)
- **Regime-aware risk model**: `HIGH_VOL_BREAKOUT` → TP ×1.25; `TRANSITION` → SL ×0.9
- **ELITE tier ATR ceiling**: `MAX_ATR × 1.2` for ELITE liquidity assets
- **Improved stale exit**: Favorable move 0.1–0.3% at time stop → `BREAK_EVEN` instead of `STALE_EXIT`
- **Telegram bug fix**: Module label was checking `BREAKOUT_CONTINUATION` (nonexistent); now correctly shows `VCP_BREAKOUT` vs `VWAP_PULLBACK`

### 2.2 Bot 2: Knife Catcher (`knife-catcher.js`)

**Current version:** `v2.2.0-KnifeCatcher-Quantum`
**Scope:** Multi-strategy mean reversion and reversal.

#### Active Live Modules

- **`STREAK_REVERSAL`**: ONLY live module. Reversion after ≥ 5 red candles.
- **`SHADOW_ONLY`**: `KNIFE_CATCHER`, `PIVOT_REVERSION`, `KELTNER_REVERSION`.

#### `STREAK_REVERSAL` (Live)

| Gate | Condition |
|------|-----------|
| Streak Length | `streak <= -5` |
| Volume Ratio | `volumeRatio >= 0.8x` |
| Regime Check | Must NOT be `TRANSITION` or `HIGH_VOL_BREAKOUT`. |

Risk model: TP = `atrPct × 1.5`, SL = `atrPct × 1.2`, time stop = 2h.

### 2.3 Dual-Bot Interaction Rules

- The two bots are architecturally independent. They share no blob state, no cooldowns, no locks.
- They can fire on the same symbol simultaneously. This is a position-sizing concern for the trader, not a code bug.
- When proposing changes, always specify the target bot. A mean-reversion enhancement belongs in `knife-catcher.js`. A trend-following enhancement belongs in `trader-bot.js`.
- If the user provides data without labeling the bot, ask before proceeding.

---

## 3. Audit Philosophy

### 3.1 Core Principles

1. **Do not confuse throughput with quality.** More signals are only good if the extra signals preserve or improve expectancy. A bot that fires 10 signals with 40% win rate and 1.5 R:R is worse than one that fires 3 signals with 65% win rate and 2.0 R:R.

2. **Do not confuse silence with discipline.** No signals for 72 hours is either a sign of rigorous filtering (if BTC was RED or regime was TRANSITION) or a sign of a broken funnel (if BTC was GREEN and shadow data shows many WOULD_WIN near-misses). Prove which.

3. **Do not relax gates blindly.** A filter may be correct even if it generates zero signals. The question is always: *does this gate reject profitable setups more than it rejects losing ones, as evidenced by shadow outcomes?*

4. **Do not hide structural conditions inside scores.** If an asset must show positive RS to be tradeable, that is a gate (binary, enforced). If RS quality can range from acceptable to exceptional, that belongs in the score. Never use a soft score penalty to do what a hard gate should do.

5. **Do not remove observability to simplify code.** Reject codes, stage counts, shadow near-misses, and autopsies are the feedback loop that makes future audits possible. Removing them is a permanent loss of diagnostic capability.

6. **Expectancy is the north star.** Win rate alone is meaningless without R:R. R:R alone is meaningless without win rate. The only metric that decides if a module has edge is:
   > `Expectancy (R) = (Win Rate × Avg Win in R) − (Loss Rate × Avg Loss in R)`
   > A positive expectancy > 0.2R per trade is a meaningful edge. Below 0.1R, the edge may be noise.

7. **MAE tells you if the entry is right. MFE tells you if the exit is right.**
   - `0% MAE losses` (price went immediately against us) → wrong entry timing or wrong market context
   - `High MFE before loss` (price went +1.5% before hitting SL) → exit geometry is too tight or trailing stop is needed
   - `Low MFE wins` (barely made it to TP) → TP may be set too far; consider partial exits

### 3.2 What Makes a Valid Change

A valid change must satisfy all three:
1. **Addresses a specific, measured problem** backed by data from at least one source file.
2. **Does not introduce new unmeasured risk** (no simultaneous loosening of multiple gates, no removal of logs, no new hard-coded magic numbers without justification).
3. **Has a testable falsification criterion** — a specific metric that would prove the change was wrong if it moved in the wrong direction after deployment.

---

## 4. Source Data Map

### 4.1 File Reference

| Local File | Blob Key | Bot | Primary Use |
|---|---|---|---|
| `history.json` | `signal-history-v2` | Bot 1 | Live signal history (open + closed) |
| `autopsies.json` | `trade-autopsies-v1` | Bot 1 | Closed-trade forensics with MFE/MAE |
| `shadow_trades.json` | `shadow-trades-v1` | Bot 1 | Active near-misses (PENDING) |
| `shadow_trades_archive.json` | `shadow-trades-archive-v1` | Bot 1 | Resolved near-misses (WOULD_WIN/WOULD_LOSE) |
| `persistent_logs.json` | `persistent-logs-v1` | Bot 1 | Runtime log stream |
| `signal_memory.json` | `signal-memory-v1` | Bot 1 | Per-symbol recent score history |
| `knife_history.json` | `knife-history-v1` | Bot 2 | Live signal history |
| `knife_autopsies.json` | `knife-trade-autopsies-v1` | Bot 2 | Closed-trade forensics with MFE/MAE |
| `knife_shadow_trades.json` | `knife-shadow-trades-v1` | Bot 2 | Active near-misses |
| `knife_shadow_archive.json` | `knife-shadow-archive-v1` | Bot 2 | Resolved near-misses (WOULD_WIN/WOULD_LOSE) |
| `knife_persistent_logs.json` | `knife-persistent-logs-v1` | Bot 2 | Runtime log stream |

### 4.2 Minimum Required Files for a Complete Audit

You cannot perform a valid audit without at minimum:

- **Bot 1:** `persistent_logs.json`, `autopsies.json`, `shadow_trades_archive.json`
- **Bot 2:** `knife_persistent_logs.json`, `knife_autopsies.json`, `knife_shadow_archive.json`
- **Both bots:** both complete file sets above, kept explicitly separated in the analysis

If any of these is missing, state which is absent and what conclusions cannot be drawn without it.

### 4.3 High-Value Fields — The "Why" Data

These fields are the most diagnostically powerful. Always cross-reference outcomes against them.

#### `qualityBreakdown` (in autopsies and shadow)
Decomposed score: `trend`, `expansion`, `participation`, `execution`.

Key questions:
- Are losses concentrated in trades where `participation < 60` despite `trend > 85`? → volume is needed but not enforced strictly enough
- Are wins concentrated where all four components are > 70? → confirm minimum quality floor
- Do `WOULD_WIN` shadows have systematically higher `execution` scores than `WOULD_LOSE` shadows? → execution quality is genuinely predictive

#### `relativeStrengthSnapshot` (`rs1h`, `rs4h`, `rs24h`)
- Are `VWAP_PULLBACK` losses concentrated when `rs1h < 0.005` (i.e., just barely positive)? → the current `rs1h >= 0` gate may need tightening to `rs1h >= 0.003`
- Is `rs4h` predictive of win/loss in VWAP_PULLBACK? Calculate avg `rs4h` for wins vs. losses. A large gap suggests raising the gate.

#### `volumeLiquidityConfirmation`
- `obi` field: Is `OBI < 0` at entry correlated with higher `maePct`? If yes, the `OBI >= -0.05` gate is directionally correct but the threshold may be too lenient.
- `spreadBps`: Trades with `spreadBps > 5` should show systematically worse execution. If they don't, the spread gate isn't earning its filtering cost.
- `deltaPass`: Does failing `deltaPass` (taker delta < 0) predict losses? This tests whether the delta computation is genuinely informative.

#### `entryMetrics`
- `distToEma9`, `distToEma21`: Overextended entries (distToEma9 > +2.5%) on VWAP_PULLBACK should show higher MAE. If they do, add a ceiling gate.
- `atrPercent`: Do high ATR% entries have better MFE but also higher MAE? This is the ATR position-sizing problem — higher ATR means wider stops, larger dollar risk per unit.
- `adx` (v11.0.0): Do entries with `adx < 20` show systematically worse outcomes? This validates or invalidates the ADX gate threshold.
- `multiDelta` (v11.0.0): Do entries with `multiDelta < 0.05` show 0% MFE losses? This validates the anti-falling-knife function.

#### `mfePct` and `maePct`
These are the most direct measures of entry and exit quality.

| Pattern | Diagnosis |
|---------|-----------|
| Loss with `mfePct = 0` | Price never went in our favor → wrong entry direction or regime |
| Loss with `mfePct >= 1.0%` | Price moved favorably before reversing → exit geometry too loose |
| Win with `mfePct` barely above TP% | TP is appropriately set |
| Win with `mfePct` far above TP% | TP is too conservative; money left on table |
| High `maePct` on wins | Entry is wrong but survivable → lucky wins, not edge |

Compute these benchmarks for each module:

```
Avg MFE wins     = mean(mfePct) for outcome=WIN
Avg MAE wins     = mean(maePct) for outcome=WIN
Avg MFE losses   = mean(mfePct) for outcome=LOSS
Avg MAE losses   = mean(maePct) for outcome=LOSS
Zero-MFE rate    = count(mfePct=0 AND outcome=LOSS) / count(outcome=LOSS)
```

If `zero-MFE rate > 40%` on losses, the entry timing is systematically wrong for that module.
If `avg MFE on losses > 0.8%`, the TP/SL geometry is the primary problem, not the entry.

#### `rejectReasonCode` in shadow archive
The shadow archive is the most important source of dark edge. For each reject code that produced `WOULD_WIN` outcomes, calculate:

```
Shadow Win Rate (code X) = WOULD_WIN / (WOULD_WIN + WOULD_LOSE)  [for that code]
Expected Gain if promoted = Shadow Win Rate × (TP_pct / SL_pct) − (1 − Shadow Win Rate)
```

If `Expected Gain > 0.2R`, the gate is leaving real edge on the table. If `Expected Gain < 0`, the gate is doing its job.

---

## 5. Required Audit Protocol

Execute these steps in strict order. Do not skip steps even if you think you already know the answer.

### Step 1 — Confirm the Active Runtime

Before making any claims, read the deployed code and verify:

- [ ] `ALGORITHM_VERSION` matches what is documented here
- [ ] All active module evaluators are in `liveAllowed` set
- [ ] Score floor logic matches documentation (`baseRequiredScore`, `getRequiredScore` modifiers)
- [ ] Liquidity tier restrictions match documentation
- [ ] BTC context restrictions match documentation
- [ ] v11.0.0 features are active (VWAP 96-candle anchor, multiDelta computation, ADX gates, trailing BE stop)
- [ ] Telegram module label uses `VCP_BREAKOUT` (not `BREAKOUT_CONTINUATION`)

**If the code and docs disagree on any of the above, note the mismatch explicitly before proceeding.**

### Step 2 — Define the Data Window

State clearly:
- Window start and end (ISO timestamps)
- Which bot the data belongs to
- Total number of scheduled runs expected vs. observed (expected = window_hours × 4 for 15-min schedule)
- Number of runs that were locked, Asia-blocked, or errored

**Do not proceed to analysis if > 20% of expected runs are missing without explanation.**

### Step 3 — Build the Throughput Funnel

Extract from `[THROUGHPUT]` lines in `persistent_logs.json`. Build this table:

```
Stage                 | Count  | % of Universe | Note
---------------------|--------|---------------|------
Universe selected     | X      | 100%          |
ORDERBOOK_OK          | X      | X%            |
LIQUIDITY_BASE_OK     | X      | X%            |
REGIME_OK             | X      | X%            |
MODULE_OK             | X      | X%            |
EXECUTION_OK          | X      | X%            |
SCORE_OK              | X      | X%            |
LIVE_SIGNAL           | X      | X%            |
```

Also build the reject breakdown:

```
Reject Code                | Count | % of total rejects
--------------------------|-------|-------------------
[most frequent code]       | X     | X%
[second most frequent]     | X     | X%
...
```

**Critical flag: If any single reject code accounts for > 50% of all rejects, that gate is the primary bottleneck and must be investigated in Step 5.**

### Step 4 — Compute Core Performance Metrics

Using `autopsies.json`, compute for each module separately (`VWAP_PULLBACK` and `VCP_BREAKOUT`):

```
Sample size (n_decisive)  = WIN + LOSS [exclude PENDING, EXPIRED, STALE_EXIT handled separately]
Win Rate                  = WIN / n_decisive
Loss Rate                 = LOSS / n_decisive
Stale Exit Rate           = STALE_EXIT / (n_decisive + STALE_EXIT)
Avg win R                 = mean(tp_pct / sl_pct) for WIN trades [proxy for realized R]
Avg loss R                = 1.0 (by definition, stopped out at 1R)
Expectancy (R)            = (Win Rate × Avg_win_R) − (Loss Rate × 1.0)
Avg MFE wins              = mean(mfePct) for WIN
Avg MAE losses            = mean(maePct) for LOSS
Zero-MFE loss rate        = count(mfePct=0 AND LOSS) / count(LOSS)
```

**Minimum sample sizes for conclusive findings:**
- n < 10: Data is anecdotal. State findings as directional only.
- 10 ≤ n < 20: Data is indicative. Flag low confidence.
- n ≥ 20: Data is sufficient for threshold calibration.
- n ≥ 50: Data is sufficient for module-level redesign decisions.

If sample is insufficient, widen the window or supplement with shadow archive.

### Step 5 — Diagnose the Primary Bottleneck

Using the funnel from Step 3, identify where signal count drops most sharply. Then drill into that stage.

**Funnel collapse patterns and their diagnoses:**

| Collapse point | Primary suspects |
|---------------|-----------------|
| Universe → REGIME_OK | BTC is predominantly RED/AMBER in the window; confirm via `btcRisk` field in logs |
| REGIME_OK → MODULE_OK | Module gates are too strict for current regime; check shadow for `WOULD_WIN` rate by module reject code |
| MODULE_OK → EXECUTION_OK | Spread/depth/OBI filters are blocking qualified assets; check if blocked symbols are majors or alts |
| EXECUTION_OK → SCORE_OK | Score floor is too high relative to the scoring range; check score distribution of near-miss shadows |
| SCORE_OK → LIVE_SIGNAL | RR floor (`realRR < 1.5`) or sector deduplication is the final filter |

**Your answer in Step 5 must name one dominant bottleneck, not a list of possibilities.** If two stages are competing, calculate which removes more candidates and name that one as primary.

### Step 6 — Perform Regime-Stratified Analysis

Performance varies significantly by regime. Always break down outcomes by:

```
Regime           | n_signals | Win Rate | Avg MFE | Avg MAE | Expectancy (R)
-----------------|-----------|----------|---------|---------|---------------
TRENDING         |           |          |         |         |
HIGH_VOL_BREAKOUT|           |          |         |         |
TRANSITION       |           |          |         |         |
```

If a regime shows Expectancy < 0 with n ≥ 10, that is an actionable finding: that regime should either increase the required score threshold or be shadow-only.

Also stratify by `btcRisk`:
```
btcRisk  | n_signals | Win Rate | Expectancy (R)
---------|-----------|----------|---------------
GREEN    |           |          |
AMBER    |           |          |
```

### Step 7 — Audit Live Trade Forensics

For each loss in the window, classify the failure mode using this taxonomy:

| Failure Mode | Diagnostic Signal |
|---|---|
| **Entry overextension** | `distToEma9 > 2.5%` at entry OR `vwapDistance > 1.8%` AND `mfePct < 0.2%` |
| **Regime mismatch** | Entered in TRANSITION or with `btcRisk=AMBER`, `mfePct = 0%` |
| **Weak order flow** | `deltaPass = false` OR `obi < -0.02` at entry |
| **False breakout** | VCP entry, price immediately rejected, `mfePct = 0%`, `maePct > 0.8%` |
| **Exit too tight** | `mfePct > 1.0%` before hitting SL; price recovered after stop |
| **Exit too loose** | Win, but `mfePct` far above TP% — profit was capped unnecessarily |
| **Good entry, bad luck** | `mfePct > 0.5%`, `maePct < 0.3%`, price ground lower after initial move |

Count how many losses belong to each category. The dominant category defines the fix.

### Step 8 — Audit Dark Edge in Shadow Data

Using `shadow_trades_archive.json`, compute for every reject code with at least 5 resolved shadows:

```
Reject Code              | n_resolved | WOULD_WIN | WOULD_LOSE | Shadow WR | Expected Gain (R)
-------------------------|------------|-----------|------------|-----------|------------------
[code]                   |            |           |            |           |
```

For `Expected Gain (R)`, use the module's benchmark R:R (e.g., VWAP_PULLBACK uses 3.0/1.4 ≈ 2.14 R:R):
```
Expected Gain (R) = Shadow_WR × 2.14 − (1 − Shadow_WR) × 1.0
```

**Interpretation:**
- Expected Gain > 0.3R → strong case for relaxing the gate (but validate against minimum n ≥ 10)
- Expected Gain 0.1–0.3R → weak case, needs larger sample before acting
- Expected Gain < 0.1R → gate is working correctly, do not touch
- Expected Gain < 0 → gate is saving us from bad trades, definitely do not relax

### Step 9 — Validate v11.0.0 Specific Features

For any audit of Bot 1 after the v11.0.0 deployment, specifically validate these new features are working as intended:

- **`momentumAdjustment`**: Check `autopsies.json` for trades where `momentumAdjustment ≠ 0`. If all entries show `0`, the signal memory is not being threaded correctly.
- **Trailing stop**: Check `history.json` for entries with `trailingStopActive = true`. If none exist despite many trades, the trailing stop is not triggering. Calculate at what % of open trades the trailing stop should have theoretically activated.
- **ADX gates**: Verify in `persistent_logs.json` that `VWAP_NO_TREND_STRUCTURE` and `VCP_NO_ADX_BASE` appear as reject codes. If they never appear, ADX data is not being computed.
- **`multiDelta`**: Verify in signal output or autopsies that `entryMetrics.multiDelta` contains non-null values. All nulls indicate taker data is unavailable from the exchange.
- **VWAP 24h anchor**: This is an internal computation; validate by checking that `vwapDistance` values in signals are different from what would be expected with a 50-candle anchor on strongly trended assets.

### Step 10 — Propose the Smallest High-Leverage Change

Structure every recommendation using this exact format:

```
## Proposed Change: [SHORT TITLE]

**Problem (data-backed):**
[Specific finding from audit steps above, with numbers]

**Root Cause:**
[The exact code mechanism causing the problem]

**Proposed Change:**
[Exact function name, parameter, and new value or logic]

**Expected Effect:**
[Specific metric expected to improve, with direction and magnitude]

**Primary Risk:**
[What could go wrong; which metric would detect it]

**Validation Criteria:**
[What must be true after 2 weeks of deployment to consider this a success]

**Falsification Criteria:**
[What single outcome would prove this change was wrong]
```

Prefer one well-scoped change over five speculative tweaks. If multiple changes are justified by data, rank them by expected impact and implement sequentially, not simultaneously.

---

## 6. Statistical Guardrails

### 6.1 Minimum Sample Requirements

Never use findings to justify threshold changes without meeting these minimums:

| Change type | Min resolved trades |
|-------------|---------------------|
| Tighten a hard gate | 15 losses showing the pattern |
| Loosen a hard gate | 20 `WOULD_WIN` shadows from that exact code |
| Adjust score floor | 25 signals near the old boundary |
| Change R:R multipliers | 30 decisive trades from that module |
| Add a new module gate | 10 validated shadow wins without the new gate AND 10 losses that would have been prevented |

If the sample is below threshold, state the finding as a hypothesis and request a wider window.

### 6.2 Expectancy Benchmarks

Use these as reference points when evaluating module health:

| Expectancy (R) | Assessment |
|----------------|------------|
| > 0.5R | Strong edge. Priority: protect it, do not over-optimize. |
| 0.2R – 0.5R | Healthy edge. Can be improved incrementally. |
| 0.1R – 0.2R | Marginal edge. One bad streak could make it negative. Investigate. |
| < 0.1R | Likely noise. Module needs fundamental redesign or retirement. |
| < 0 | Negative expectancy. Module should be immediately shadow-only until fixed. |

### 6.3 Win Rate Trap

**Never interpret win rate in isolation.** A 70% win rate with 1:1 R:R is worse than a 45% win rate with 3:1 R:R.

Always pair win rate with the realized average R per trade:
```
WR=70%, avg win = 1.0R, avg loss = 1.0R → Expectancy = 0.70 × 1.0 − 0.30 × 1.0 = +0.40R ✓
WR=45%, avg win = 2.5R, avg loss = 1.0R → Expectancy = 0.45 × 2.5 − 0.55 × 1.0 = +0.575R ✓✓
WR=55%, avg win = 0.8R, avg loss = 1.0R → Expectancy = 0.55 × 0.8 − 0.45 × 1.0 = −0.01R ✗
```

---

## 7. Approved and Forbidden Change Types

### 7.1 Approved Changes

1. **Threshold calibration** — A hard gate is directionally correct but measurably too strict, with shadow evidence showing > 0.3R expected gain in blocked cohort.
2. **Gate geometry correction** — A pullback module is buying too far from VWAP, or a breakout module fires without real compression. Evidence: `distToEma` or `vwapDistance` distribution of losses.
3. **Execution gate correction** — Spread/depth logic is blocking viable majors or allowing toxic microstructure. Evidence: blocked symbols are top-tier assets, or wins show negative OBI at entry.
4. **Ranking / sizing refinement** — Score is misordering valid candidates. Evidence: lower-scored trades win more often than higher-scored ones for the same module.
5. **Telemetry upgrade** — Missing reject codes or missing context fields prevent trustworthy future audits. Always approved.
6. **Risk model calibration** — TP multiplier is consistently undershooting MFE (leaving money), or SL is too tight relative to typical adverse excursion. Evidence: 30+ trades showing systematic pattern.

### 7.2 Forbidden Changes

| Forbidden Action | Why |
|---|---|
| Adding vague "confidence" bonuses without discrete, testable conditions | Creates score soup; makes audits impossible |
| Loosening multiple gates simultaneously | Cannot attribute which gate caused change in outcomes |
| Promoting a new module directly to live | Must pass shadow-only validation first (see Section 8) |
| Removing reject codes or log entries | Destroys audit trail permanently |
| Changing thresholds based on < 10 trades | Noise disguised as signal |
| Modifying both bots in the same deployment without a dual-bot exception record | Cannot isolate causality if outcomes change, unless the deployment is intentionally structured for separation |
| Removing the run lock mechanism | Risk of concurrent execution and blob corruption |
| Hardcoding thresholds that were previously env-configurable | Reduces operational flexibility without benefit |

### 7.3 Dual-Bot Exception Policy

Modifying both bots in the same deployment is allowed **only** if all of the following are true:

1. The change is either:
   - a shared **telemetry / observability / safety** fix that does not loosen live entry criteria, or
   - two **bot-specific** changes backed by separate datasets, separate root-cause statements, and separate validation criteria.
2. The audit output labels every change by target bot and never mixes Bot 1 and Bot 2 metrics in the same performance claim.
3. The deployment plan includes **separate falsification criteria per bot**.
4. Documentation and journal entries explicitly state that both bots changed in the same deployment and why that was acceptable.
5. If either bot’s change affects trade selection, score floors, or risk geometry, the other bot’s concurrent change must be limited to telemetry/safety only.

If these conditions are not met, default back to single-bot deployments.

---

## 8. New Module Lifecycle

New module ideas are welcome, but they follow a strict lifecycle:

### Stage 1: Shadow-Only (Minimum 2 weeks, n ≥ 30 resolved)
- Module evaluator returns a candidate but never creates a live signal
- All candidates are recorded in `shadowCandidates` with their own explicit `rejectReasonCode` (e.g., `MODULE_SHADOW_ONLY`)
- Mandatory fields: `score`, `qualityBreakdown`, `entryMetrics`, `riskModel`, `reasons`
- **Exit criterion:** Shadow Win Rate using the module's proposed R:R must show Expectancy > 0.2R with n ≥ 30

### Stage 2: Restricted Live (2 weeks, max 1 live signal per cycle)
- Module is added to `liveAllowed` but with score floor + 10 above baseline
- Only ELITE or HIGH liquidity tier
- Monitor shadow archive for any regression vs. Stage 1

### Stage 3: Full Live
- Remove artificial score floor penalty
- Open to standard liquidity tiers
- Document in `ALGO_DOCUMENTATION.md` and `ALGORITHM_JOURNAL.md`

**A module is never described as "live" until it has completed Stage 3.**

---

## 9. Change Safety Checklist

Before deploying any code change, verify all of the following:

### Data Integrity
- [ ] `history.json` still receives new entries with all required fields
- [ ] `autopsies.json` records are written on trade close (WIN, LOSS, STALE_EXIT, BREAK_EVEN)
- [ ] `shadow_trades.json` records near-misses with non-null `score`, `price`, `rejectReasonCode`
- [ ] `persistent_logs.json` still writes `[THROUGHPUT]` lines on every run
- [ ] `signal_memory.json` receives entries for both signal and near-miss symbols
- [ ] `knife_history.json`, `knife_autopsies.json`, `knife_shadow_trades.json`, and `knife_persistent_logs.json` still update correctly if Bot 2 was touched

### Telegram
- [ ] Message sends without errors for both module types
- [ ] Module label renders correctly (`📉 PULLBACK` for VWAP_PULLBACK, `🚀 BREAKOUT` for VCP_BREAKOUT)
- [ ] New fields (ADX, multiDelta, R:R, momentum adjustment) display correctly
- [ ] `escapeMarkdownV2` is applied to all dynamic values

### Runtime Safety
- [ ] Run lock still acquired and released correctly (check for `[LOCK]` in logs)
- [ ] Cooldown check occurs before analysis, not after
- [ ] Sector deduplication still works (`selectedSectors`, `selectedSectorLeaders`)
- [ ] Open position block still works (`OPEN_POSITION_BLOCK` appears in rejects)
- [ ] `getClosedCandles` is called before any indicator computation

### Score and Signal Coherence
- [ ] `score` in signal object ≤ 100 and ≥ 0
- [ ] `tp > price > sl` invariant holds
- [ ] `riskModel.realRR >= 1.5` (enforced gate)
- [ ] `scoreBeforeMomentum` and `momentumAdjustment` sum to `score`
- [ ] `requiredScore` is documented in signal object

### Build Validation
```bash
npm run lint
npm run build
npm run test  # if test suite exists
node --check netlify/functions/trader-bot.js
node --check netlify/functions/knife-catcher.js
```

### Dual-Bot Deployment Checks
- [ ] Each bot touched in the deployment has its own version bump and changelog/journal note
- [ ] Each bot touched in the deployment has bot-specific validation metrics and falsification criteria
- [ ] Any cross-bot shared change is limited to telemetry, observability, or execution safety

---

## 10. Required Audit Output Format

When delivering an audit, structure the response using exactly these sections. Do not omit any section even if the data is thin.

---

### Section A — Audit Identity

```
Bot:              [Bot 1 / Bot 2 / Both]
Algorithm Version:[as read from deployed code]
Data Window:      [ISO start] → [ISO end]  ([N] hours)
Files Provided:   [list of files provided by user]
Files Missing:    [list of required files NOT provided]
Runs Expected:    [window_hours × 4]
Runs Observed:    [from persistent_logs.json]
Run Gaps:         [% of expected runs missing, cause if known]
```

---

### Section B — Throughput Funnel

Present the funnel table from Step 3 in full. Flag any stage with > 40% drop-off.

Identify the **single primary bottleneck** with this statement:
> "The dominant signal suppressor in this window is `[REJECT_CODE]`, which eliminated `[N]` candidates (`[X]%` of all rejects). The next largest is `[REJECT_CODE]` at `[Y]%`."

---

### Section C — Live Trade Performance

Present the metrics table from Step 4. For each module:

```
Module:          VWAP_PULLBACK
Window:          [dates]
n_decisive:      [n]    (WIN: N | LOSS: N | STALE: N | BE: N)
Win Rate:        X%     [flag if < 50% and n ≥ 15]
Expectancy:      X.XX R [flag if < 0.1R]
Avg MFE (wins):  X.X%
Avg MAE (losses):X.X%
Zero-MFE losses: X%     [flag if > 40%]
```

---

### Section D — Regime Stratification

Present the regime table from Step 6. Flag any regime with negative expectancy and n ≥ 10.

---

### Section E — Live Trade Forensics

For each loss in the window (or top 5 if window is large), classify the failure mode from the taxonomy in Step 7. Summarize:
> "Of [N] losses, [X] were entry overextension, [Y] were regime mismatch, [Z] were false breakouts."

Cite exact `mfePct` and `maePct` values for the most diagnostic cases.

---

### Section F — Shadow Edge Analysis

Present the dark edge table from Step 8. For any code showing Expected Gain > 0.2R:

> "Reject code `[CODE]` blocked `[N]` candidates with Shadow Win Rate `[X]%`, implying Expected Gain of `[Y]R` per promoted trade. This represents a statistically [meaningful / marginal / insufficient] sample."

---

### Section G — v11.0.0 Feature Validation (Bot 1 Only)

Check each v11 feature from Step 9 and report:
- ✅ Confirmed active with evidence
- ⚠️ Ambiguous — data absent but no error
- ❌ Not working as expected — cite evidence

---

### Section H — Proposed Change

Use the exact format from Step 10. One change per section. If multiple changes are warranted, rank by expected impact and label them `[H1]`, `[H2]`, `[H3]`.

Do not propose more than 3 changes per audit session. If the data supports more, schedule a follow-up audit after the first change has been deployed and measured.

---

### Section I — Validation Plan

State exactly:
1. **Which metric(s) must improve** and by how much (e.g., "Expectancy increases from 0.18R to ≥ 0.25R over the next 30 decisive trades")
2. **What would falsify the hypothesis** (e.g., "If Expectancy drops below 0.10R or zero-MFE loss rate rises above 50% within 20 trades, the change should be reverted")
3. **When to check** (e.g., "Review after 14 calendar days or 20 decisive trades, whichever comes first")

---

## 11. Session Timing Analysis

The bot runs 24/7 but market conditions are not uniform across UTC hours. Optionally include this analysis when diagnosing persistent underperformance.

### Session Boundaries (UTC)
```
Asia:    00:00 – 07:00   [can be blocked via AVOID_ASIA_SESSION=true]
London:  07:00 – 12:00   [typically highest liquidity for BTC/ETH majors]
New York:12:00 – 21:00   [highest volume, most volatile]
Overlap: 12:00 – 16:00   [NY+London crossover, highest-quality signals]
Quiet:   21:00 – 00:00   [low volume, higher spread risk]
```

If segmenting performance by session:
- Are stale exits (`STALE_EXIT`) concentrated in Asia or quiet sessions?
- Is `volumeRatio` systematically lower in Asia (which would explain high `VWAP_LOW_VOL` reject rates at those hours)?
- Does `spreadBps` exceed gate thresholds more frequently outside London/NY?

---

## 12. Anti-Pattern Catalogue

These are specific patterns that have appeared or are likely to appear in practice. Recognize them immediately.

### 12.1 The Score Mirage
**Symptom:** High signal scores (78–85) but expectancy close to 0.
**Cause:** All four score components (trend, expansion, participation, execution) contribute to score, but one of them (usually participation) is not genuinely predictive of outcome. Score averages out the noise.
**Fix:** Calculate expectancy separately for signals where each component was > 80 vs. < 60. If a component shows no predictive power, reduce its weight or make it a gate.

### 12.2 The Regime Trap
**Symptom:** Win rate is 60%+ overall but breaks down to 35% in TRANSITION regime.
**Cause:** TRANSITION regime is being allowed to produce live signals with only a minor score floor increase, when it may warrant being shadow-only or requiring much higher scores.
**Fix:** Check regime-stratified table. If TRANSITION expectancy < 0 with n ≥ 10, make it shadow-only immediately.

### 12.3 The False Volume Signal
**Symptom:** `volumeRatio` gate passes (e.g., 2.5x), but `deltaRatio` or `multiDelta` is negative. Trade loses with 0% MFE.
**Cause:** Volume is there, but it is selling volume, not buying volume. Total volume ratio does not distinguish direction.
**Fix:** Ensure `multiDelta` gate is not disabled or null for a large fraction of trades. If it is null due to exchange data unavailability, consider tightening `volumeRatio` threshold to compensate.

### 12.4 The Liquidity Illusion
**Symptom:** Trade fired on ELITE liquidity tier but spread at execution was > 5 bps and MAE was immediate.
**Cause:** Order book was thinly bid at the moment of signal generation but classified as ELITE based on 24h volume. The OBI was not checked carefully.
**Fix:** Cross-reference `liquidityTier` with `spreadBps` and `obi` in losses. If ELITE-tier trades show high spread or negative OBI, the real-time OBI gate is more important than the 24h volume tier.

### 12.5 The Stale Memory Problem
**Symptom:** `momentumAdjustment` is consistently +3 for a symbol across multiple cycles, but the trades are losing.
**Cause:** Signal memory is storing old scores from a different market regime. The 2-hour TTL on memory entries may be too long if the market context has shifted.
**Fix:** Check if +3 momentum bonus trades have worse outcomes than 0 adjustment trades. If yes, the memory bonus is maladaptive.

### 12.6 The Sector Deduplication Blind Spot
**Symptom:** A strong MEME sector signal (e.g., PEPE) is blocked by `SECTOR_CORRELATION` because DOGE fired first and was weaker. The PEPE setup was better.
**Cause:** Sector leader is determined by which symbol appears first in the ranked list, not by which has the highest score.
**Fix:** Check if shadow records with `blockedBySector` show systematically higher scores than the live signal that blocked them. If so, the sector selection logic should prefer the highest score, not first-come.

---

## 13. Definition of Done

A redesign is complete only when ALL of the following are true:

**Data Layer**
- [ ] `history.json`, `autopsies.json`, `shadow_trades.json`, `persistent_logs.json` update correctly post-deployment
- [ ] No new null or undefined fields introduced in any blob record
- [ ] `[THROUGHPUT]` log lines still appear and are parseable

**Signal Quality**
- [ ] Signals include human-readable `reasons` array (non-empty)
- [ ] `entry`, `tp`, `sl`, `requiredScore`, `riskModel`, and `qualityBreakdown` are present and coherent in every signal
- [ ] `tp > price > sl` on every BUY signal
- [ ] `realRR >= 1.5` on every live signal

**Observability**
- [ ] New gates have explicit, unique reject codes
- [ ] New scoring bonuses are logged in `reasons` array
- [ ] Version string is updated in `ALGORITHM_VERSION`

**Telegram**
- [ ] All signals rendered without MarkdownV2 parse errors
- [ ] No fields render as `undefined` or `null` in the message

**Documentation**
- [ ] `ALGO_DOCUMENTATION.md` updated to reflect new gates, thresholds, and field descriptions
- [ ] `ALGORITHM_JOURNAL.md` updated with the change rationale, data that justified it, and version tag

---

## 14. Final Rules

1. **Do not optimize for narrative elegance.** A well-structured story that isn't backed by numbers is not an audit.
2. **Do not optimize for trade frequency.** A bot that fires three high-quality signals per week is better than one that fires twenty marginal ones.
3. **Do not retroactively justify changes.** If you propose a change and the data shows it was wrong, say so. Accountability is how trust is built.
4. **Ruthless is good. Blind is not. Reckless is the worst.**

The goal is a system that:
- explains every decision it makes
- preserves real, measurable edge
- rejects weak setups deliberately and traceably
- leaves enough evidence to prove whether any change helped or hurt

> If the data doesn't support the change, the change doesn't happen.
> If the data supports the change, deploy it, measure it, and report back.
