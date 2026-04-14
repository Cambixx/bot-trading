# 🚀 Quantum Algorithm Audit & Redesign Guide

> **Last Updated:** `2026-04-12`
>
> This guide is the **source of truth** for auditing and redesigning `netlify/functions/trader-bot.js`. 
> If you are an AI reading this, you are instructed to execute a **ruthless, evidence-based evaluation** of the algorithm. We do not want iterative tweaks on failing logic. We want robust, statistically sound strategies.

---

## 🎯 The Core Philosophy: "Pure Edge Over Score Soup"

For months, the algorithm relied on progressive "quality penalties" and "score soups"—combining RSI, EMA distances, BB%, and ADX into a single 0-100 score. **This approach fails because it obscures the actual edge.** A perfect score can hide a fatal flaw (like negative order flow or buying the top of a parabolic expansion).

**From now on, we follow these non-negotiable principles:**

1. **Deterministic Edge, Not Ambiguous Scores:** A setup either exists or it doesn't. We use strict binary conditions to validate a setup, and use scoring *only* to rank valid setups and determine position sizing.
2. **Cross-Sectional Relative Strength:** Only buy the leaders. If a token isn't outperforming BTC and its sector in the last 4H/24H, it's dead money.
3. **Volume > Everything:** In crypto, price without volume is noise. Breakouts must feature extreme volume anomalies (e.g., > 250% of moving average). 
4. **Order Flow Confirmation:** Spot long strategies must wait for strong bid-side liquidity. Negative Order Book Imbalance (OBI) immediately invalidates a setup.
5. **No "Magic Numbers":** Avoid arbitrary thresholds like `RSI > 52`. Use mathematically sound concepts like Volatility Contraction (BB Width percentiles) and Volume-Weighted Average Price (VWAP) relationships.

---

## 🔬 Approved Strategy Modules (State of the Art)

When auditing or redesigning the algorithm, explicitly evaluate these specific setups. Do not invent complex heuristic models. Stick to what institutional traders use in crypto.

### 1. VCP Breakout (Volatility Contraction Pattern)
**Rationale:** Crypto assets consolidate in tight ranges (low volatility) before explosive directional moves. We want to catch the first candle of the expansion.
- **Trigger:** Bollinger Band Width is in the bottom 10th percentile historically.
- **Action:** Price breaks the upper band with an extreme volume spike (`volumeRatio > 2.5`).
- **Filter:** Asset must have positive Relative Strength (RS) vs BTC. Orderbook imbalance must be heavily skewed to the bid side.

### 2. Institutional VWAP Pullback
**Rationale:** In a strong trend, institutional algorithms defend the VWAP. VWAP is the true "cost basis" of the session.
- **Trigger:** Asset is in a strong uptrend (e.g., Daily/4H EMA alignment, strong RS vs BTC).
- **Action:** Price pulls back to touch VWAP and reclaims it (closes above) with volume support.
- **Filter:** Deep wicks (rejection) at VWAP are required. Cannot be in the Asian session dead zone.

### 3. Mean Reversion from Extreme Deviation
**Rationale:** Liquid assets stretch only so far before reverting to the mean.
- **Trigger:** Price extends > 3 ATR beyond the 50 EMA on the 15m chart.
- **Action:** Enter on the first candle that closes back inside the Bollinger Band with strong bullish order flow.
- **Filter:** Only valid on highly liquid (ELITE) majors.

---

## 🛠 Auditing the Algorithm

If you are asked to audit `trader-bot.js`, execute the following protocol:

### Step 1: Telemetry Data Assessment
Read exactly what happened using the synchronized blobs:
1. `history.json` & `autopsies.json`: Identify exactly why recent Live trades lost or won. Did they hit Stop Loss instantly? Were they stale exits?
2. `shadow_trades.json`: Analyze the near-misses. Were there setups that would have won but were blocked by an overly aggressive filter?
3. `persistent_logs.json`: Verify that the scheduler actually ran and didn't crash.

### Step 2: The "72-Hour No Signal" Protocol
If the system has fired 0 live signals in 72 hours, do **not** just say "the market was bad." Find out *why*.
- Was the `LIQUIDITY_TIER` filter too strict?
- Were we rejecting everything due to `EXEC_SPREAD`?
- Was the `REGIME` classifier falsely locking the market in `RISK_OFF`?
Identify the exact bottleneck using the log output (`[THROUGHPUT] Rejects:`).

### Step 3: Redesign & Deployment
When redesigning the algorithm:
1. **Remove Legacy Code:** Strip out unused functions, old score penalties, and deprecated regime variables.
2. **Implement Pure Modules:** Rewrite the module evaluators to use strict Boolean gates for validation and pure scaling combinations for ranking.
3. **Log the Reasons:** Ensure every signal explicitly states its "reasons" (e.g., `["Massive VCP Breakout", "Volume 3.5x", "Strong OBI Support"]`).
4. **Enforce Shadow Testing:** If introducing a new high-risk module (like Mean Reversion), set it to **shadow-only** initially.

---

## 🧪 Validating New Code (Post-Implementation)
Always ensure that the new `trader-bot.js`:
1. Maintains strict `TELEGRAM` formatting for new indicators.
2. Does NOT break the telemetry reporting (`history.json`).
3. Handles Asian session liquidity adjustments properly.
4. Actually returns the correct entry/tp/sl prices.

If you understand this guide, proceed to completely obliterate the old logic and write the strongest algorithm possible. No mercy to failing strategies.
