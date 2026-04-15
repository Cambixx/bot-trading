# Quantum Algorithm Audit & Redesign Guide

> **Last Updated:** `2026-04-14`
>
> This document is the working guide for auditing and redesigning `netlify/functions/trader-bot.js`.
> Use it when reviewing live behavior, diagnosing no-signal periods, or proposing algorithm changes.
>
> If this guide and the runtime disagree, **the code wins**. Update the guide after the code, not instead of the code.

---

## 1. Objective

The goal is not to "make the bot trade more." The goal is to preserve and improve **real edge** in a `spot`, `long-only`, intraday system without regressing telemetry, execution safety, or observability.

This means:

1. **Evidence over intuition.** Every meaningful recommendation must be backed by `history.json`, `shadow_trades.json`, `autopsies.json`, `persistent_logs.json`, or direct runtime code.
2. **Pure Edge Over Score Soup.** A setup is valid because it passes a deterministic module. Score is used to rank valid candidates and influence sizing, not to manufacture trades from weak evidence.
3. **Production safety matters.** A "better strategy" that breaks logs, blobs, scheduler behavior, or Telegram payloads is not an improvement.
4. **Current production logic and experimental ideas are separate.** Do not describe a research idea as if it were already active in live trading.

---

## 2. Current Runtime Baseline

Before auditing, anchor yourself to what is actually live today. The architecture now runs **two independent Netlify Functions** scheduled 5 minutes apart to capture different market anomalies without API collisions.

### Bot 1: QuantumEdge (`v10.1.0`, `trader-bot.js`)
*Scope: Short-term trend following and momentum breakouts.*

### Active live modules

#### `VWAP_PULLBACK`
- Requires `bull4h = true`.
- Requires price to be above VWAP reclaim zone:
  - `currentPrice >= vwap15m * 0.997`
  - `currentPrice <= vwap15m * 1.015`
- Requires `rs4h >= 0.005`.
- Requires `volumeRatio >= 1.1`.
- Requires `OBI >= -0.05`.
- Produces a scored candidate only after those hard gates pass.

#### `VCP_BREAKOUT`
- Requires Bollinger Band Width rank in the bottom `15%` of recent history.
- Requires breakout state: `bbPercent >= 0.90`.
- Requires `volumeRatio >= 2.3`.
- Requires `OBI >= 0.05`.
- Requires BTC risk context to be neither `AMBER` nor `RED`.
- Produces a scored candidate only after those hard gates pass.

### Runtime gates outside the modules

- `BTC_RED` blocks live trading completely.
- `MEDIUM` liquidity is **shadow-only**.
- Execution quality still matters after a module passes:
  - spread gate
  - depth gate
  - order book sanity
- Required score can increase based on:
  - `btcRisk`
  - `regime`
  - `liquidityTier`

### Bot 2: Knife Catcher (`v1.0.0`, `knife-catcher.js`)
*Scope: Extreme mean reversion and capitulation.*

#### `KNIFE_CATCHER`
- Requires pure panic: `bbPercent <= -0.04` (4% below lower Bollinger Band).
- Requires extreme oversold: `rsi15m <= 25`.
- Requires volume absorption climax: `volumeRatio >= 4.0x`.
- Aggressive Risk Model: TP 3.5x ATR, SL 1.0x ATR, 4h Time Stop.

### Important implication

If proposing changes, specify *which* bot architecture you are editing. A `Mean Reversion` module belongs in `knife-catcher.js`, while a `Breakout` belongs in `trader-bot.js`.

---

## 3. Audit Philosophy

When reviewing the algorithm, follow these rules:

1. **Do not confuse throughput with quality.** More signals are only good if the extra signals preserve or improve expectancy.
2. **Do not confuse silence with discipline.** If there are no signals for 72 hours, prove whether the market was truly poor or whether the funnel is choking good setups.
3. **Do not relax gates blindly.** A filter may be correct even if it feels "too strict." The question is whether it rejects profitable setups too often in shadow and telemetry.
4. **Do not hide logic inside scores.** If a condition is structurally required, make it a gate, not a soft penalty.
5. **Do not remove observability to simplify code.** Reject reasons, stage counts, shadow near-misses, and trade autopsies are part of the trading system.

---

## 4. Source Data Map

Use the synced local files for forensic work. They are mirrors of the Netlify Blobs stores.

| Local File | Blob Key | Main Use |
| --- | --- | --- |
| `history.json` | `signal-history-v2` | Bot 1: Live signal history |
| `autopsies.json` | `trade-autopsies-v1` | Bot 1: Closed-trade diagnosis |
| `shadow_trades.json` | `shadow-trades-v1` | Bot 1: Blocked candidates |
| `persistent_logs.json` | `persistent-logs-v1` | Bot 1: Runtime evidence |
| `knife_history.json` | `knife-history-v1` | Bot 2: Live signal history |
| `knife_shadow_trades.json`| `knife-shadow-trades-v1` | Bot 2: Blocked candidates |
| `knife_persistent_logs.json`| `knife-persistent-logs-v1` | Bot 2: Runtime evidence |

### High-value fields to inspect

- `module`
- `reasons`
- `qualityBreakdown`
- `relativeStrengthSnapshot`
- `volumeLiquidityConfirmation`
- `rejectReasonCode`
- `riskModel`
- `requiredScore`
- `mfePct`
- `maePct`

---

## 5. Required Audit Protocol

If asked to audit `trader-bot.js`, do the following in order.

### Step 1. Confirm the active runtime

Verify these before making claims:

- `ALGORITHM_VERSION`
- active module evaluators
- `liveAllowed` set
- score floor logic
- liquidity restrictions
- BTC context restrictions

If the code and docs disagree, note the mismatch explicitly.

### Step 2. Read the latest operating window

Use at least the most recent `72h` window, or a longer one if the sample is too thin.

Quantify:

- number of observed runs
- number of module candidates by module
- top reject reasons
- number of live signals
- number of shadow candidates
- win/loss/stale-exit mix
- MFE/MAE profile by module

Do not summarize this as "market bad" without numbers.

### Step 3. Diagnose the primary bottleneck

Use `[THROUGHPUT]` logs to determine where the funnel collapses:

- universe selection
- regime / BTC context
- module validation
- execution quality
- score floor / ranking
- operational issue

Your answer should identify the dominant failure mode, not just list several possible causes.

### Step 4. Audit live trades

For recent wins and losses, determine whether the problem came from:

- bad entry geometry
- weak order flow / execution
- overextension
- insufficient relative strength
- poor exit design
- market context mismatch

Use `autopsies.json` and `history.json` together. A loss is more informative when paired with:

- `reasons`
- `qualityBreakdown`
- `entryMetrics`
- `volumeLiquidityConfirmation`
- `mfePct`
- `maePct`

### Step 5. Audit blocked opportunities

Use `shadow_trades.json` and `shadow_trades_archive.json` to answer:

- Which reject codes are blocking setups that later worked?
- Which reject codes are correctly filtering junk?
- Are we rejecting for the right reason, but too early?
- Are we using a good module but with the wrong geometry?

Do not recommend threshold reductions unless shadow evidence shows systematic false negatives.

### Step 6. Propose the smallest high-leverage change

Every recommendation must include:

- the exact problem
- the exact mechanism causing it
- the proposed code-level change
- the expected effect
- the main risk of the change
- how it will be validated

Prefer one strong fix over five speculative tweaks.

---

## 6. Approved Change Types

The following are usually valid redesign directions:

1. **Threshold calibration**
   - Example: a hard gate is directionally correct but measurably too strict.
2. **Module geometry correction**
   - Example: a pullback module is buying too far from VWAP, or a breakout module is firing without real compression.
3. **Execution gate correction**
   - Example: spread/depth logic is blocking viable majors or allowing toxic microstructure.
4. **Ranking / sizing refinement**
   - Example: score is ordering valid candidates poorly, even though gating is correct.
5. **Telemetry upgrades**
   - Example: missing reject codes or missing context prevent trustworthy audits.

The following are **not** valid by default:

- adding vague "confidence" bonuses
- reintroducing blended heuristic score soup
- loosening multiple gates at once without attribution
- promoting a brand-new module straight to live
- removing logs because they are noisy

---

## 7. Guardrails for New Modules

New ideas are welcome, but they are not live until proven.

If proposing a new module such as mean reversion:

1. Start it as **shadow-only**.
2. Give it its own explicit reject codes and reasons.
3. Keep its risk model separate from the live modules if needed.
4. Validate it across multiple sessions, not a single anecdotal run.
5. Compare it against the current modules using actual shadow outcomes, not intuition.

Do not describe an experimental module as "approved" unless it has already been integrated into the runtime and documented elsewhere.

---

## 8. Definition of Done for a Redesign

A redesign is only complete if all of the following remain true:

1. `history.json`, `autopsies.json`, `shadow_trades.json`, and `persistent_logs.json` still update correctly.
2. `[THROUGHPUT] Stages`, `[THROUGHPUT] Module candidates`, and `[THROUGHPUT] Rejects` remain readable and useful.
3. Signals still include human-readable `reasons`.
4. Entry, TP, SL, `requiredScore`, `riskModel`, and `qualityBreakdown` remain coherent.
5. Telegram formatting is not broken.
6. Shadow-only flows still work for blocked or experimental candidates.
7. The change is reflected in:
   - `ALGO_DOCUMENTATION.md`
   - `ALGORITHM_JOURNAL.md`

If code changes are made, validate them with the project's available checks whenever relevant, such as:

- `npm run build`
- `npm run test`
- `npm run lint`

---

## 9. Required Audit Output Format

When delivering an audit, structure the answer like this:

### A. Observed Facts
- What the runtime is actually doing now.
- What the data shows in the latest operating window.

### B. Primary Bottleneck
- The single most important reason performance or throughput is failing.

### C. Live Trade Diagnosis
- What the recent wins/losses reveal about entry quality and exit quality.

### D. Shadow Evidence
- Which blocked setups look promising.
- Which filters are correctly rejecting noise.

### E. Proposed Change
- Exact code-level adjustment.
- Why it addresses the bottleneck.
- Main tradeoff or risk.

### F. Validation Plan
- What metrics or files must improve after deployment.
- What would falsify the hypothesis.

---

## 10. Final Rule

Do not optimize for narrative elegance. Optimize for a bot that:

- explains its decisions
- preserves real edge
- rejects weak setups on purpose
- leaves enough evidence behind to prove whether a change helped or hurt

Ruthless is good. Blind is not.
