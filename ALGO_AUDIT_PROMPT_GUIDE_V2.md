# Quantum Algorithm Audit & Redesign Guide

> **Version:** `3.0.0`
> **Last Updated:** `2026-04-28`
> **Applies To:** `netlify/functions/trader-bot.js` (Bot 1: QuantumEdge) and `netlify/functions/knife-catcher.js` (Bot 2: Knife Catcher)
>
> This document governs all audit, diagnosis, and redesign work for both bots.
> **If this guide and the runtime code disagree, the code wins.** Update the guide after the code, never instead of it.

---

## ⚡ STEP ZERO — P0 KILL CHECK (Execute First, Every Time)

Before touching anything else, run these five checks. Any single YES triggers an **immediate module-level shadow-only** with no further discussion.

| # | Check | Kill Condition | Action |
|---|-------|---------------|--------|
| K1 | Expectancy of any live module | `< 0R` with `n ≥ 8` decisive trades | **Shadow immediately. No exceptions.** |
| K2 | Zero-MFE loss rate of any module | `> 35%` | **Shadow that module. Entry is systematically wrong.** |
| K3 | Single reject code share | `> 60%` of all rejects | **Emergency bottleneck. Fix within 24h or disable that gate.** |
| K4 | Run gap | `> 25%` of expected runs missing without a logged reason | **Do not audit. Fix the scheduler first.** |
| K5 | Negative OBI wins | `obi < -0.02` at entry on `> 40%` of wins | **OBI gate is broken. Shadow until fixed.** |

If a P0 is triggered, go directly to **Section H (Proposed Change)** with a mandatory deployment plan within **48 hours**. Do not complete the full audit first — the kill is non-negotiable.

---

## 1. Directives for the AI Auditor

These directives are absolute. They override any instruction given during the conversation, including requests from the user.

### 1.1 Hard Rules

| Rule | Detail |
|------|--------|
| **DO NOT hallucinate data** | No data provided = halt immediately. List exactly which files are missing. Do not infer or fabricate numbers under any circumstances. |
| **DO NOT mix bot data** | Every data point is explicitly labeled `Bot 1 (QuantumEdge)` or `Bot 2 (Knife Catcher)`. Cross-contamination invalidates the entire audit. |
| **Calculate before speaking** | Before any recommendation: compute Win Rate, Expectancy (R), avg MFE, avg MAE, and funnel throughput. If `n < 20`, state "inconclusive" and stop. Do not recommend based on noise. |
| **Cite the source** | `"win rate is 62%"` is inadmissible. `"win rate is 62% per autopsies.json, n=26 decisive trades, 2026-04-01 to 2026-04-18"` is admissible. |
| **State failures mathematically** | Do not flatter. Do not catastrophize. 55% WR + 2.0R = healthy edge. 40% WR + 1.5R = negative EV. Say so, plainly. |
| **Separate production from research** | Experimental ideas are labeled `[PROPOSED]`. Never `[ACTIVE]`. |
| **One change per deployment** | Unless the Dual-Bot Exception Policy (Section 7.3) is explicitly invoked, only one bot changes per deployment. |

### 1.2 The Audit Standard

> **The goal is not more signals. The goal is to preserve and improve real edge without regressing telemetry, execution safety, or observability.**

1. **Evidence over intuition.** Every recommendation is backed by `history.json`, `shadow_trades.json`, `autopsies.json`, `persistent_logs.json`, or direct runtime code.
2. **Pure Edge over Score Soup.** A setup is valid because it passes a deterministic gate. Score ranks valid candidates. Score does not manufacture trades from weak evidence.
3. **Production safety is non-negotiable.** A "better strategy" that silently breaks logs, blob writes, the scheduler, or Telegram is a regression.
4. **Silence requires proof.** No signals for 72 hours must be explained with data — not dismissed as "conditions were bad." That is a hypothesis, not a finding.

---

## 2. Runtime Baseline — What Is Actually Live

### 2.1 Bot 1: QuantumEdge (`trader-bot.js`)

**Current version:** `v11.1.2-QuantumEdge`
**Scope:** Short-term trend following and momentum breakouts on spot long-only.
**Schedule:** Every 15 minutes (`0,15,30,45 * * * *`).

#### Active Live Modules

##### `VWAP_PULLBACK`
Hard gates (all must pass, in order):

| Gate | Condition | Reject Code |
|------|-----------|-------------|
| Trend alignment | `bull4h = true` | `VWAP_TREND_ALIGN` |
| Price above VWAP floor | `currentPrice >= vwap15m * 0.997` | `VWAP_BELOW` |
| Price below VWAP ceiling | `currentPrice <= vwap15m * (1.015 or 1.020 in TRENDING)` | `VWAP_TOO_FAR` |
| 4H relative strength | `rs4h >= 0.005` | `VWAP_NO_RS` |
| Volume confirmation | `volumeRatio >= 1.1` | `VWAP_LOW_VOL` |
| Order book imbalance | `OBI >= -0.05` | `VWAP_NEG_OBI` |
| RSI not falling knife | `rsi15m >= 45` | `VWAP_FALLING_KNIFE` |
| 1H relative strength | `rs1h >= 0` | `VWAP_WEAK_MOMENTUM` |
| 1H EMA slope | `emaSlope1h >= -0.002` | `VWAP_EMA_DECLINING` |
| ADX trend structure | `adx15m.adx >= 16` (if available) | `VWAP_NO_TREND_STRUCTURE` |
| RSI overbought guard | `rsi15m <= 72` | `VWAP_RSI_OB` |

Scoring weights: `trend × 0.4 + participation × 0.4 + execution × 0.2`

Score bonuses: RSI 50–65 (+3), `bull1h` (+2), ADX ≥ 22 (+2), ADX ≥ 30 (+4), `multiDelta > 0.15` (+3), `emaSlope1h > 0.003` (+2).

Risk model: TP = `atrPct × 3.0`, SL = `atrPct × 1.4`, time stop = 12h (regime-adjusted).

##### `VCP_BREAKOUT`
Hard gates (all must pass, in order):

| Gate | Condition | Reject Code |
|------|-----------|-------------|
| BB compression | BB Width rank ≤ bottom 15% | `VCP_NOT_TIGHT` |
| Breakout state | `bbPercent >= 0.90` | `VCP_NO_BREAKOUT` |
| Volume explosion | `volumeRatio >= 2.3` | `VCP_LOW_VOL` |
| Bid support | `OBI >= 0.05` | `VCP_NO_BID_SUPPORT` |
| BTC context | not `AMBER` or `RED` | `VCP_BTC_RESISTANCE` |
| 1H relative strength | `rs1h >= 0` | `VCP_WEAK_MOMENTUM` |
| ADX base | `adx15m.adx >= 14` (if available) | `VCP_NO_ADX_BASE` |
| Taker delta | `multiDelta >= 0.05` (if available) | `VCP_WEAK_TAKER_DELTA` |

Scoring weights: `trend × 0.30 + expansion × 0.25 + participation × 0.30 + execution × 0.15`

Score bonuses: ADX ≥ 20 (+2), ADX ≥ 28 (+4), `multiDelta > 0.10` (+2), `multiDelta > 0.25` (+4).

Risk model: TP = `atrPct × 2.5`, SL = `atrPct × 1.2`, time stop = 6h (regime-adjusted).

#### Runtime Gates Outside the Modules

| Gate | Effect |
|------|--------|
| `BTC_RED` (4H trend break or RSI4h < 44) | Blocks ALL live signals via `REGIME_RISK_OFF` |
| `btcRisk = AMBER` (1H stretched > EMA21 × 1.018 or RSI1h > 68) | Increases required score; blocks VCP_BREAKOUT |
| `MEDIUM` liquidity tier | Only VWAP_PULLBACK can trade live; VCP blocked |
| `LOW` liquidity tier | Blocked unless depth ≥ $200k (half sizing) |
| Score below `requiredScore` | `SCORE_BELOW_FLOOR` — enters shadow, not live |
| Open position on same symbol | `OPEN_POSITION_BLOCK` |
| Cooldown (default 240 min) | `COOLDOWN_BLOCK` |
| Sector already selected | `SECTOR_CORRELATION` |

#### v11.0.0 Features — Must Be Verified Active

- VWAP anchor: 96 candles (24h)
- `multiDelta`: 3-candle cumulative taker buying pressure
- ADX gates on both modules
- `momentumAdjustment`: signal memory ±3 pts
- Trailing stop to break-even at 50% of TP distance
- Regime-aware risk model
- ELITE tier ATR ceiling: `MAX_ATR × 1.2`
- Improved stale exit: favorable move 0.1–0.3% at time stop → `BREAK_EVEN`
- Telegram: module label shows `VCP_BREAKOUT` not `BREAKOUT_CONTINUATION`

### 2.2 Bot 2: Knife Catcher (`knife-catcher.js`)

**Current version:** `v2.1.2-KnifeCatcher-Quantum`
**Scope:** Multi-strategy mean reversion and capitulation/reversion buying.
**Schedule:** Every 15 minutes, offset 5 minutes from Bot 1.

#### Active Live Modules

- `KNIFE_CATCHER`
- `STREAK_REVERSAL`
- `PIVOT_REVERSION`
- `KELTNER_REVERSION`

#### `KNIFE_CATCHER`

| Gate | Condition |
|------|-----------|
| Extreme oversold price | `bbPercent <= -0.04` |
| RSI capitulation | `rsi15m <= 25` |
| Volume climax | `volumeRatio >= 4.0x` |

Risk model: TP = `atrPct × 3.5`, SL = `atrPct × 1.0`, time stop = 4h.

**Design note:** KNIFE_CATCHER is intentionally aggressive. Short time stop + tight SL is by design to avoid bag-holding. Do not compare its SL tightness to Bot 1's as a flaw.

**Exit telemetry:** From `v2.1.2`, every closure must persist `exitPrice`, `exitReason`, and `closedAt`. Missing any of these is a data integrity failure.

### 2.3 Dual-Bot Interaction Rules

- The two bots are architecturally independent. They share no blob state, no cooldowns, no locks.
- They can fire on the same symbol simultaneously. That is a position-sizing concern for the trader, not a code bug.
- When proposing changes, always name the target bot explicitly.
- If data is provided without a bot label, **stop and ask before proceeding.** Never assume.

---

## 3. Audit Philosophy

### 3.1 Core Principles

1. **Throughput ≠ quality.** More signals are only better if they preserve or improve expectancy. 3 signals at 65% WR / 2.0R beats 10 signals at 40% WR / 1.5R — every time.

2. **Silence requires proof.** Zero signals for 72h is either rigorous filtering (BTC RED, low ATR) or a broken funnel (BTC GREEN, shadow data full of WOULD_WIN). Prove which. "Market was bad" is not a finding.

3. **Gates are innocent until proven guilty.** A filter that generates zero signals may be exactly right. The test is: does this gate reject winning setups more than losing ones? Shadow data answers that.

4. **Scores rank; gates filter.** If an asset needs positive RS to be tradeable, that is a gate (binary). If RS quality ranges from acceptable to exceptional, that's a score. Never use a soft score penalty to do what a hard gate should do.

5. **Observability is a hard asset.** Reject codes, shadow near-misses, and autopsies are the feedback loop that makes future audits possible. Removing them is permanent and forbidden.

6. **Expectancy is the only north star.**
   > `Expectancy (R) = (Win Rate × Avg Win in R) − (Loss Rate × Avg Loss in R)`
   > Positive expectancy > 0.2R is meaningful edge. Below 0.1R, it may be noise. Below 0R, shadow-only immediately.

7. **MAE = entry quality. MFE = exit quality.**
   - Zero-MFE losses → wrong entry direction or market context
   - High MFE before loss → exit geometry too tight or trailing stop needed
   - Low MFE wins → TP may be set too far; consider partial exits

### 3.2 What Makes a Valid Change

All three must be true:
1. Addresses a **specific, measured problem** backed by data from at least one source file.
2. Does **not introduce new unmeasured risk** — no simultaneous gate loosening, no log removal, no new magic numbers without justification.
3. Has a **testable falsification criterion** — one metric that proves the change wrong if it moves incorrectly.

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
| `knife_shadow_archive.json` | `knife-shadow-archive-v1` | Bot 2 | Resolved near-misses |
| `knife_persistent_logs.json` | `knife-persistent-logs-v1` | Bot 2 | Runtime log stream |

### 4.2 Minimum Required Files for a Valid Audit

Missing any of these = **state what is absent, state what conclusions are blocked, and do not proceed with incomplete findings.**

- **Bot 1:** `persistent_logs.json` + `autopsies.json` + `shadow_trades_archive.json`
- **Bot 2:** `knife_persistent_logs.json` + `knife_autopsies.json` + `knife_shadow_archive.json`

### 4.3 High-Value Diagnostic Fields

#### `qualityBreakdown` (autopsies + shadow)
- Losses concentrated at `participation < 60` despite `trend > 85` → volume gate needs tightening
- Wins concentrated where all four components > 70 → confirm minimum quality floor
- `WOULD_WIN` shadows with consistently higher `execution` scores → execution quality is genuinely predictive

#### `relativeStrengthSnapshot` (`rs1h`, `rs4h`, `rs24h`)
- VWAP_PULLBACK losses at `rs1h < 0.005` (barely positive) → tighten gate from `>= 0` to `>= 0.003`
- Calculate avg `rs4h` for wins vs. losses. A gap of 0.005+ suggests raising the gate.

#### `entryMetrics`
- `distToEma9 > 2.5%` at VWAP_PULLBACK entry + high `maePct` → add ceiling gate
- `adx < 20` entries showing worse outcomes → validates ADX gate threshold
- `multiDelta < 0.05` entries showing 0% MFE → validates anti-falling-knife function

#### `mfePct` and `maePct` — Most Direct Entry/Exit Quality Signal

| Pattern | Diagnosis | Action |
|---------|-----------|--------|
| Loss with `mfePct = 0` | Entry is wrong direction or regime | Fix entry gating |
| Loss with `mfePct >= 1.0%` | Price went our way before reversal | Exit geometry too loose |
| Win with `mfePct` barely above TP% | TP appropriately set | No action |
| Win with `mfePct` far above TP% | Leaving money on the table | Consider partial exits |
| High `maePct` on wins | Lucky wins, not edge | Entry needs tightening |

Compute benchmarks per module:

```
Avg MFE wins       = mean(mfePct) for outcome=WIN
Avg MAE wins       = mean(maePct) for outcome=WIN
Avg MFE losses     = mean(mfePct) for outcome=LOSS
Avg MAE losses     = mean(maePct) for outcome=LOSS
Zero-MFE rate      = count(mfePct=0 AND outcome=LOSS) / count(outcome=LOSS)
```

**`Zero-MFE rate > 35%` on losses = entry timing is systematically wrong. Fix the gate, do not adjust the score.**
**`Avg MFE on losses > 0.8%` = the TP/SL geometry is the problem, not the entry.**

#### `rejectReasonCode` in shadow archive

For each code with at least 5 resolved shadows:

```
Shadow Win Rate (code X)   = WOULD_WIN / (WOULD_WIN + WOULD_LOSE)
Expected Gain (R)          = Shadow_WR × R:R_benchmark − (1 − Shadow_WR) × 1.0
```

- Expected Gain > **0.2R** → gate is leaving edge. Investigate loosening (requires n ≥ 15 before acting).
- Expected Gain 0.1–0.2R → marginal. Needs wider sample before acting.
- Expected Gain < 0.1R → gate is earning its cost. Do not touch.
- Expected Gain < 0 → gate is saving money. Definitely do not touch.

---

## 5. Priority Classification System

Every finding must be classified before a recommendation is made.

| Priority | Condition | Mandatory Action | Deadline |
|----------|-----------|-----------------|----------|
| **P0 — Kill** | Module expectancy < 0R (n ≥ 8) OR zero-MFE rate > 35% | Shadow-only immediately | Deploy within 48h |
| **P1 — Critical** | Module expectancy 0–0.1R (n ≥ 15) OR single gate > 50% of rejects | Fix within current sprint | Deploy within 7 days |
| **P2 — Investigate** | Expectancy 0.1–0.2R OR shadow edge > 0.2R blocked | Validate with wider window | Next audit session |
| **P3 — Monitor** | Expectancy 0.2–0.5R, healthy funnel | No action needed | Recheck in 30 days |
| **Healthy** | Expectancy > 0.5R | Protect it. Do not over-optimize. | — |

**A P0 blocks all other changes.** You cannot propose a P2 scoring improvement while a P0 is active.

---

## 6. Required Audit Protocol

Execute in strict order. No step is skipped, even if you think you already know the answer.

### Step 0 — P0 Kill Check

Run the five kill conditions from the header. If any trigger, go directly to Section H. Otherwise, proceed.

### Step 1 — Confirm the Active Runtime

Verify from deployed code:

- [ ] `ALGORITHM_VERSION` matches documentation
- [ ] All active module evaluators are in `liveAllowed`
- [ ] Score floor logic matches docs (`baseRequiredScore`, `getRequiredScore` modifiers)
- [ ] Liquidity tier restrictions match docs
- [ ] BTC context restrictions match docs
- [ ] v11.0.0 features are active (96-candle VWAP, multiDelta, ADX gates, trailing BE stop)
- [ ] Telegram uses `VCP_BREAKOUT` not `BREAKOUT_CONTINUATION`

**Code/docs mismatch = note it explicitly before proceeding. Do not assume the docs are right.**

### Step 2 — Define the Data Window

State:
- Window start and end (ISO timestamps)
- Bot identity
- Expected runs (window_hours × 4) vs. observed runs
- Runs that were locked, blocked, or errored

**If > 25% of expected runs are missing without explanation: halt audit, fix scheduler first.**

### Step 3 — Build the Throughput Funnel

Extract from `[THROUGHPUT]` lines in `persistent_logs.json`:

```
Stage                 | Count  | % of Universe | Flag
----------------------|--------|---------------|------
Universe selected     | X      | 100%          |
ORDERBOOK_OK          | X      | X%            | ⚠️ if drop > 35%
LIQUIDITY_BASE_OK     | X      | X%            | ⚠️ if drop > 35%
REGIME_OK             | X      | X%            | ⚠️ if drop > 35%
MODULE_OK             | X      | X%            | ⚠️ if drop > 35%
EXECUTION_OK          | X      | X%            | ⚠️ if drop > 35%
SCORE_OK              | X      | X%            | ⚠️ if drop > 35%
LIVE_SIGNAL           | X      | X%            |
```

Reject breakdown:

```
Reject Code                | Count | % of total rejects | Priority
--------------------------|-------|--------------------|---------
[most frequent]            | X     | X%                 | P0 if > 60%
[second most frequent]     | X     | X%                 | P1 if > 50%
```

**The audit must name one dominant bottleneck, not a list of possibilities.** If two codes compete, compare absolute candidate removal and name the larger one.

Collapse pattern diagnosis:

| Collapse point | Primary suspects | Next action |
|---|---|---|
| Universe → REGIME_OK | BTC predominantly RED/AMBER | Confirm via `btcRisk` field. If true, no action needed. |
| REGIME_OK → MODULE_OK | Module gates too strict for regime | Pull shadow WOULD_WIN rate per reject code |
| MODULE_OK → EXECUTION_OK | Spread/depth/OBI blocking qualified assets | Check if blocked symbols are majors |
| EXECUTION_OK → SCORE_OK | Score floor too high vs. scoring range | Check score distribution of near-miss shadows |
| SCORE_OK → LIVE_SIGNAL | RR floor or sector deduplication | Check `realRR < 1.5` rate and sector block frequency |

### Step 4 — Compute Core Performance Metrics

Per module, using `autopsies.json`:

```
Sample size (n_decisive)  = WIN + LOSS (exclude PENDING, EXPIRED, STALE_EXIT handled separately)
Win Rate                  = WIN / n_decisive
Stale Exit Rate           = STALE_EXIT / (n_decisive + STALE_EXIT)
Avg win R                 = mean(tp_pct / sl_pct) for WIN
Expectancy (R)            = (Win Rate × Avg_win_R) − (Loss Rate × 1.0)
Avg MFE wins              = mean(mfePct) for WIN
Avg MAE losses            = mean(maePct) for LOSS
Zero-MFE loss rate        = count(mfePct=0 AND LOSS) / count(LOSS)
```

**Confidence thresholds — no exceptions:**

| n | Status |
|---|--------|
| < 10 | Anecdotal. Do not recommend gate changes. |
| 10–19 | Indicative. State direction only; flag low confidence. |
| ≥ 20 | Sufficient for threshold calibration. |
| ≥ 50 | Sufficient for module-level redesign. |

If n is insufficient: widen window or supplement with shadow archive. **Do not make threshold recommendations on noise.**

### Step 5 — Diagnose the Primary Bottleneck

One answer. One dominant bottleneck. If your analysis produces a list, you have not computed which stage removes the most candidates. Compute it. Then name one.

### Step 6 — Regime-Stratified Analysis

Break down outcomes by regime:

```
Regime           | n_signals | Win Rate | Avg MFE | Avg MAE | Expectancy (R) | Priority
-----------------|-----------|----------|---------|---------|----------------|----------
TRENDING         |           |          |         |         |                |
HIGH_VOL_BREAKOUT|           |          |         |         |                |
TRANSITION       |           |          |         |         |                |
```

**Expectancy < 0 with n ≥ 8 in any regime = P0. That regime goes shadow-only immediately.**

Also stratify by `btcRisk`:

```
btcRisk  | n_signals | Win Rate | Expectancy (R)
---------|-----------|----------|---------------
GREEN    |           |          |
AMBER    |           |          |
```

### Step 7 — Live Trade Forensics

Classify every loss in the window using this taxonomy. If window > 20 losses, classify the most recent 20:

| Failure Mode | Diagnostic Signal |
|---|---|
| **Entry overextension** | `distToEma9 > 2.5%` AND `mfePct < 0.2%` |
| **Regime mismatch** | Entered in TRANSITION or `btcRisk=AMBER` with `mfePct = 0%` |
| **Weak order flow** | `deltaPass = false` OR `obi < -0.02` at entry |
| **False breakout** | VCP entry, immediate rejection, `mfePct = 0%`, `maePct > 0.8%` |
| **Exit too tight** | `mfePct > 1.0%` before hitting SL |
| **Exit too loose** | Win, but `mfePct` far above TP% |
| **Good entry, adverse luck** | `mfePct > 0.5%`, `maePct < 0.3%`, price ground lower after move |

The dominant failure mode defines the fix. A scattered distribution across all categories with no dominant mode suggests the sample is too small — widen the window.

### Step 8 — Shadow Edge Analysis

For every reject code with at least 5 resolved shadows:

```
Reject Code    | n_resolved | WOULD_WIN | WOULD_LOSE | Shadow WR | Expected Gain (R) | Priority
---------------|------------|-----------|------------|-----------|-------------------|----------
[code]         |            |           |            |           |                   |
```

VWAP_PULLBACK R:R benchmark: 3.0 / 1.4 ≈ 2.14
VCP_BREAKOUT R:R benchmark: 2.5 / 1.2 ≈ 2.08

Any code showing Expected Gain > 0.2R with n ≥ 10 is a P1 finding. Do not act on n < 10 shadow wins regardless of the Expected Gain number.

### Step 9 — Validate v11.0.0 Features (Bot 1 Only)

| Feature | Validation Check | Status |
|---------|-----------------|--------|
| `momentumAdjustment` | At least one `autopsies.json` entry with `momentumAdjustment ≠ 0` | ✅ / ⚠️ / ❌ |
| Trailing stop | At least one `history.json` entry with `trailingStopActive = true` | ✅ / ⚠️ / ❌ |
| ADX gates | `VWAP_NO_TREND_STRUCTURE` and `VCP_NO_ADX_BASE` appear in logs | ✅ / ⚠️ / ❌ |
| `multiDelta` | `entryMetrics.multiDelta` contains non-null values | ✅ / ⚠️ / ❌ |
| VWAP 24h anchor | `vwapDistance` values differ from 50-candle expectation on trended assets | ✅ / ⚠️ / ❌ |

**Any ❌ is a P1 finding. Any ⚠️ must be explained.**

### Step 10 — Propose the Smallest High-Leverage Change

**Maximum 3 changes per audit session.** If the data supports more, schedule a follow-up audit after the first change is deployed and measured. Rank by expected impact: H1, H2, H3.

Use this exact format for each:

```
## [H1] Proposed Change: [SHORT TITLE]
Priority:       [P0 / P1 / P2]
Target Bot:     [Bot 1 / Bot 2]

Problem (data-backed):
  [Finding from audit steps above. Numbers required. No numbers = no recommendation.]

Root Cause:
  [Exact code mechanism causing the problem. Function name and parameter.]

Proposed Change:
  [Exact function name, parameter, old value → new value, or new logic block.]

Expected Effect:
  [Specific metric, direction, and magnitude. "Expectancy improves from 0.18R to ≥ 0.25R over 30 trades."]

Primary Risk:
  [What goes wrong. Which metric detects it.]

Validation Criteria:
  [Must be true after 14 days or 20 decisive trades, whichever comes first.]

Falsification Criteria:
  [Single outcome that proves this change was wrong and triggers revert.]

Deployment Deadline:
  [P0 = 48h. P1 = 7 days. P2 = next audit session.]
```

---

## 7. Statistical Guardrails

### 7.1 Minimum Sample Requirements — Hard Floors

| Change type | Min resolved trades | Below floor: |
|-------------|---------------------|-------------|
| Tighten a hard gate | 15 losses showing the pattern | State as hypothesis only |
| Loosen a hard gate | 20 `WOULD_WIN` shadows from that exact code | State as hypothesis only |
| Adjust score floor | 25 signals near the old boundary | State as hypothesis only |
| Change R:R multipliers | 30 decisive trades from that module | State as hypothesis only |
| Add a new module gate | 10 validated shadow wins without gate AND 10 losses the gate would have prevented | State as hypothesis only |

### 7.2 Expectancy Benchmarks

| Expectancy (R) | Assessment | Action |
|----------------|------------|--------|
| > 0.5R | Strong edge | Protect it. Do not touch. |
| 0.2R – 0.5R | Healthy edge | Incremental improvement only |
| 0.1R – 0.2R | Marginal | One bad streak flips it negative. Investigate now. |
| < 0.1R | Likely noise | Module needs fundamental redesign or retirement |
| < 0R | Negative expectancy | **Shadow immediately. No exceptions.** |

### 7.3 Win Rate Trap

Never interpret win rate in isolation.

```
WR=70%, avg win = 1.0R, avg loss = 1.0R → Expectancy = +0.40R ✓
WR=45%, avg win = 2.5R, avg loss = 1.0R → Expectancy = +0.575R ✓✓
WR=55%, avg win = 0.8R, avg loss = 1.0R → Expectancy = −0.01R ✗ (losing system, kill it)
```

---

## 8. Approved and Forbidden Changes

### 8.1 Approved Changes

1. **Threshold calibration** — Gate is directionally correct but measurably too strict. Shadow evidence shows > 0.2R expected gain in blocked cohort with n ≥ 10.
2. **Gate geometry correction** — Entry buying too far from VWAP, or breakout firing without real compression. Evidence: `distToEma` or `vwapDistance` distribution of losses.
3. **Execution gate correction** — Spread/depth logic blocking viable majors or allowing toxic microstructure.
4. **Ranking / sizing refinement** — Score is misordering valid candidates. Evidence: lower-scored trades win more often than higher-scored ones.
5. **Telemetry upgrade** — Missing reject codes or context fields. Always approved.
6. **Risk model calibration** — TP consistently undershooting MFE, or SL too tight relative to adverse excursion. Evidence: 30+ trades showing systematic pattern.

### 8.2 Forbidden Changes — Zero Tolerance

| Forbidden Action | Why |
|---|---|
| Vague "confidence" bonuses without discrete, testable conditions | Score soup. Makes audits impossible. |
| Loosening multiple gates simultaneously | Cannot attribute outcome changes to any single gate. |
| Promoting a new module directly to live | Must pass shadow-only validation first (Section 9). |
| Removing reject codes or log entries | Destroys audit trail permanently. Forbidden always. |
| Changing thresholds based on < 10 trades | Noise disguised as signal. |
| Modifying both bots in the same deployment without invoking Section 7.3 explicitly | Cannot isolate causality. |
| Removing the run lock mechanism | Risk of concurrent execution and blob corruption. |
| Hardcoding thresholds that were previously env-configurable | Reduces operational flexibility with no benefit. |

### 8.3 Dual-Bot Exception Policy

Both bots in the same deployment is allowed **only if all five conditions hold**:

1. The change is a shared telemetry/observability/safety fix that does not loosen live entry criteria, OR two bot-specific changes backed by separate datasets and separate root-cause statements.
2. Every data point is labeled by bot. No mixed performance claims.
3. The deployment plan includes separate falsification criteria per bot.
4. Documentation explicitly states both bots changed in the same deployment and why that was acceptable.
5. If either bot's change affects trade selection, score floors, or risk geometry, the other bot's concurrent change must be limited to telemetry/safety only.

If any of these five conditions is not met: single-bot deployment only.

---

## 9. New Module Lifecycle

No shortcuts. No exceptions.

### Stage 1: Shadow-Only (Minimum 2 weeks, n ≥ 30 resolved)
- Module never creates a live signal
- All candidates recorded in `shadowCandidates` with explicit `rejectReasonCode` (e.g., `MODULE_SHADOW_ONLY`)
- Required fields: `score`, `qualityBreakdown`, `entryMetrics`, `riskModel`, `reasons`
- **Exit criterion:** Shadow Win Rate must produce Expectancy > 0.2R with n ≥ 30. Below this, do not promote.

### Stage 2: Restricted Live (2 weeks, max 1 live signal per cycle)
- Module added to `liveAllowed` with score floor + 10 above baseline
- ELITE or HIGH liquidity only
- Monitor shadow archive for regression vs. Stage 1

### Stage 3: Full Live
- Remove artificial score floor penalty
- Open to standard liquidity tiers
- Document in `ALGO_DOCUMENTATION.md` and `ALGORITHM_JOURNAL.md`

**A module is never described as "live" until Stage 3 is complete with documentation.**

---

## 10. Change Safety Checklist

Before any deployment:

### Data Integrity
- [ ] `history.json` receives new entries with all required fields
- [ ] `autopsies.json` records written on every trade close (WIN, LOSS, STALE_EXIT, BREAK_EVEN)
- [ ] `shadow_trades.json` records near-misses with non-null `score`, `price`, `rejectReasonCode`
- [ ] `persistent_logs.json` writes `[THROUGHPUT]` lines on every run
- [ ] `signal_memory.json` receives entries for both signal and near-miss symbols
- [ ] Bot 2 files update correctly if Bot 2 was touched

### Telegram
- [ ] Messages send without errors for both module types
- [ ] Module label correct (`📉 PULLBACK` for VWAP_PULLBACK, `🚀 BREAKOUT` for VCP_BREAKOUT)
- [ ] New fields display correctly
- [ ] `escapeMarkdownV2` applied to all dynamic values

### Runtime Safety
- [ ] Run lock acquired and released correctly (`[LOCK]` in logs)
- [ ] Cooldown check occurs before analysis, not after
- [ ] Sector deduplication still works
- [ ] Open position block still works
- [ ] `getClosedCandles` called before any indicator computation

### Signal Coherence
- [ ] `score` in signal object between 0 and 100
- [ ] `tp > price > sl` invariant holds on every signal
- [ ] `riskModel.realRR >= 1.5` enforced
- [ ] `scoreBeforeMomentum + momentumAdjustment = score`
- [ ] `requiredScore` present in signal object

### Build Validation
```bash
npm run lint
npm run build
npm run test
node --check netlify/functions/trader-bot.js
node --check netlify/functions/knife-catcher.js
```

---

## 11. Required Audit Output Format

Use exactly these sections. Do not omit any section even if data is thin.

---

### Section A — Audit Identity

```
Bot:                [Bot 1 / Bot 2 / Both]
Algorithm Version:  [from deployed code]
Data Window:        [ISO start] → [ISO end]  ([N] hours)
Files Provided:     [list]
Files Missing:      [list — conclusions blocked by each missing file]
Runs Expected:      [window_hours × 4]
Runs Observed:      [from logs]
Run Gaps:           [% missing, cause if known]
P0 Status:          [CLEAR / TRIGGERED — state which condition]
```

---

### Section B — Throughput Funnel

Full funnel table from Step 3. Flag any stage with > 35% drop-off.

State the single primary bottleneck:
> "The dominant signal suppressor in this window is `[REJECT_CODE]`, which eliminated `[N]` candidates (`[X]%` of all rejects). The next largest is `[REJECT_CODE]` at `[Y]%`. Priority: `[P0/P1/P2]`."

---

### Section C — Live Trade Performance

Per module:

```
Module:           [VWAP_PULLBACK / VCP_BREAKOUT]
Window:           [dates]
n_decisive:       [n]    (WIN: N | LOSS: N | STALE: N | BE: N)
Win Rate:         X%     ⚠️ flag if < 50% and n ≥ 15
Expectancy:       X.XX R ⚠️ flag if < 0.1R | 🚨 P0 if < 0R
Avg MFE (wins):   X.X%
Avg MAE (losses): X.X%
Zero-MFE losses:  X%     ⚠️ flag if > 35%
Priority:         [Healthy / P3 / P2 / P1 / P0]
```

---

### Section D — Regime Stratification

Full regime table from Step 6. Flag any regime with negative expectancy and n ≥ 8.

---

### Section E — Live Trade Forensics

Classify every loss (or top 20). Summarize:
> "Of [N] losses: [X] entry overextension, [Y] regime mismatch, [Z] false breakouts, [W] exit geometry. Dominant mode: [MODE]. Root cause action: [SPECIFIC FIX]."

---

### Section F — Shadow Edge Analysis

Full dark edge table from Step 8. For any code showing Expected Gain > 0.2R:
> "Reject code `[CODE]` blocked `[N]` candidates with Shadow WR `[X]%`, Expected Gain `[Y]R`. Sample is [conclusive n ≥ 15 / marginal n = 10–14 / insufficient n < 10]. Priority: `[P1/P2]`."

---

### Section G — v11.0.0 Feature Validation (Bot 1 Only)

Per feature: ✅ confirmed / ⚠️ ambiguous / ❌ broken. Every ❌ is a P1 finding.

---

### Section H — Proposed Change(s)

Maximum 3. Ranked H1/H2/H3 by expected impact. Use the exact format from Step 10. P0 changes are mandatory and listed first regardless of expected impact ranking.

---

### Section I — Validation Plan

1. Which metric(s) must improve and by how much
2. What would falsify the hypothesis and trigger a revert
3. Exact date or trade count checkpoint
4. Who is responsible for the check

---

## 12. Session Timing Analysis

Optional. Include when diagnosing persistent underperformance.

### Session Boundaries (UTC)
```
Asia:    00:00 – 07:00   (can be blocked via AVOID_ASIA_SESSION=true)
London:  07:00 – 12:00   (highest liquidity for BTC/ETH majors)
New York:12:00 – 21:00   (highest volume, most volatile)
Overlap: 12:00 – 16:00   (NY+London crossover, highest-quality signals)
Quiet:   21:00 – 00:00   (low volume, higher spread risk)
```

Key questions:
- Are `STALE_EXIT` outcomes concentrated in Asia or quiet sessions?
- Is `volumeRatio` systematically lower in Asia? (Explains high `VWAP_LOW_VOL` reject rate at those hours.)
- Does `spreadBps` exceed gate thresholds more frequently outside London/NY?

If Asia-session stale rate > 2× London-session stale rate, enable `AVOID_ASIA_SESSION` and measure impact.

---

## 13. Anti-Pattern Catalogue

Recognize these immediately. Each has a mandatory action.

### 13.1 The Score Mirage
**Symptom:** High signal scores (78–85) but expectancy near 0.
**Cause:** One score component (usually participation) is not genuinely predictive.
**Mandatory action:** Compute expectancy separately for each component above/below 80. If a component shows no predictive power, reduce its weight or convert it to a hard gate. Do not leave a non-predictive score component in place.

### 13.2 The Regime Trap
**Symptom:** Win rate 60%+ overall but 35% in TRANSITION regime.
**Cause:** TRANSITION is producing live signals with only a minor score floor increase.
**Mandatory action:** If TRANSITION expectancy < 0 with n ≥ 8, shadow-only immediately. This is a P0.

### 13.3 The False Volume Signal
**Symptom:** `volumeRatio` passes (e.g., 2.5x) but `multiDelta` is negative. Trade loses with 0% MFE.
**Cause:** Volume present but directional — it's selling pressure, not buying.
**Mandatory action:** Verify `multiDelta` gate is active and producing non-null values. If null on > 30% of signals, tighten `volumeRatio` threshold to compensate. Do not leave the system running without a direction filter on volume.

### 13.4 The Liquidity Illusion
**Symptom:** ELITE liquidity tier, but spread at execution > 5 bps and MAE is immediate.
**Cause:** Tier based on 24h volume; OBI was not thin at signal generation.
**Mandatory action:** Cross-reference `liquidityTier = ELITE` with `spreadBps > 5` in losses. If correlation exists, tighten the real-time OBI gate. The 24h volume tier is not a substitute for real-time book quality.

### 13.5 The Stale Memory Problem
**Symptom:** `momentumAdjustment = +3` consistently on a losing symbol.
**Cause:** Signal memory storing scores from a previous market regime; 2-hour TTL may be too long.
**Mandatory action:** Compare expectancy for `momentumAdjustment > 0` vs. `= 0` trades. If bonus trades underperform, the memory is maladaptive. Reduce TTL or add a regime-change invalidation.

### 13.6 The Sector Deduplication Blind Spot
**Symptom:** A strong MEME signal (e.g., PEPE) blocked by `SECTOR_CORRELATION` because a weaker DOGE fired first.
**Cause:** Sector leader determined by arrival order, not score.
**Mandatory action:** Check if shadow records with `blockedBySector` have systematically higher scores than the live signal that blocked them. If yes, change sector selection to prefer highest score. This is a P1 fix.

### 13.7 The Slow Bleed
**Symptom:** Expectancy slowly declining week-over-week. No single bad streak — just drift.
**Cause:** Market regime has shifted. Entry conditions valid 3 months ago are now marginally negative.
**Mandatory action:** Run regime-stratified analysis. If any regime has expectancy < 0.1R on n ≥ 20 and was previously healthy, flag as P1. If < 0R, P0. Do not dismiss drift as noise.

---

## 14. Definition of Done

A change is complete only when ALL of the following are true:

### Data Layer
- [ ] `history.json`, `autopsies.json`, `shadow_trades.json`, `persistent_logs.json` update correctly
- [ ] No new null or undefined fields in any blob record
- [ ] `[THROUGHPUT]` log lines still appear and are parseable

### Signal Quality
- [ ] Non-empty `reasons` array on every signal
- [ ] `entry`, `tp`, `sl`, `requiredScore`, `riskModel`, `qualityBreakdown` present and coherent
- [ ] `tp > price > sl` on every BUY signal
- [ ] `realRR >= 1.5` on every live signal

### Observability
- [ ] New gates have unique, explicit reject codes
- [ ] New scoring bonuses are logged in `reasons`
- [ ] `ALGORITHM_VERSION` updated

### Telegram
- [ ] All signals rendered without MarkdownV2 errors
- [ ] No fields render as `undefined` or `null`

### Documentation
- [ ] `ALGO_DOCUMENTATION.md` updated
- [ ] `ALGORITHM_JOURNAL.md` updated with change rationale, supporting data, and version tag

---

## 15. Final Rules

1. **Data or silence.** A well-structured narrative without numbers is not an audit.
2. **Quality over quantity.** Three high-quality signals per week beats twenty marginal ones.
3. **P0 findings block everything else.** Do not propose P2 improvements while a module is in emergency.
4. **Own failures.** If you propose a change and the data proves it was wrong, say so. Accountability is how trust is built.
5. **Ruthless is good. Blind is not. Reckless is the worst.**

> If the data doesn't support the change, the change doesn't happen.
> If the data supports the change, deploy it within the deadline, measure it against the validation criteria, and report back.
> If you're not certain, widen the window — never lower the evidence bar.