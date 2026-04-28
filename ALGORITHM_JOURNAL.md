# Algorithm Tuning Journal (`trader-bot.js`)

This file tracks the evolution of the trading algorithm, the logic behind parameter changes, and the lessons learned from market behavior. 

**Rule:** NEVER update `trader-bot.js` without first reviewing past mistakes and logging the intended change here.

---

### Current Version: v11.2.0 (QuantumEdge) & v2.2.0 (Knife Catcher)
**Date:** Apr 28, 2026
**Theme:** "P0 AUDIT REMEDIATION — MODULE SHADOW, MULTIDELTA FIX, REGIME BLOCK"

### Core Logic & Parameters:
- **Runtime Versions:** `v11.2.0-QuantumEdge` / `v2.2.0-KnifeCatcher-Quantum`.
- **Audit Window:** Apr 26–28, 2026, using Quantum Algorithm Audit v3.0.0 protocol.
- **Data Basis:** Bot 2: 10 decisive trades (2W/8L), 107 resolved shadow archive entries. Bot 1: 2 decisive trades (insufficient for module changes), 13 live signals with multiDelta=null globally.

### Changes Made:

#### [H1] P0: Shadow KELTNER, KNIFE, PIVOT Modules (knife-catcher.js)
- **Problem:** Bot 2 triggered 3 P0 Kill Checks (K1, K2, K5). Overall expectancy: `-0.384R` (n=10). Module breakdown:
  - `KELTNER_REVERSION`: 0W/4L, -1.0R expectancy, 75% zero-MFE rate.
  - `KNIFE_CATCHER`: 0W/1L, 100% zero-MFE rate.
  - `PIVOT_REVERSION`: 0W/1L, entered with volumePass=false AND obiPass=false (execution gate bypass bug).
  - `STREAK_REVERSAL`: 2W/1L, +1.054R expectancy (only positive module).
- **Fix:** `KELTNER_REVERSION`, `KNIFE_CATCHER`, and `PIVOT_REVERSION` now route to shadow-only via `liveAllowed` set. `STREAK_REVERSAL` is the sole live module. Shadowed candidates are tracked with `MODULE_SHADOW_ONLY_<name>` reject codes for continued data collection.
- **Shadow Archive Validation:** 107 resolved shadows show 11.2% WOULD_WIN rate → gates are correctly filtering poor setups.
- **Expected Effect:** Immediate halt of capital hemorrhage from -1.0R modules while preserving the +1.054R STREAK_REVERSAL edge.
- **Falsification:** If STREAK_REVERSAL expectancy drops below +0.3R over next 10 decisive trades, it should also be shadowed.

#### [H2] P1: Fix multiDelta Null Bug (trader-bot.js)
- **Problem:** `multiDelta` field returned `null` in ALL autopsies and ALL shadow trades. The v11.0.0 anti-falling-knife taker delta filter was completely non-functional. Two root causes identified:
  1. **Parser bug:** `candle[9] ? Number(candle[9]) : null` treats `0` (a valid value) as falsy → assigns null.
  2. **No fallback:** When MEXC API omits `takerBuyBaseVolume`, the function returns null with no alternative.
- **Fix:** (a) Changed parser to explicit null/undefined/empty-string check. (b) Added price-action delta fallback: when taker data is unavailable, computes directional pressure from close-vs-open × volume across the lookback window. Same -1 to +1 scale.
- **Expected Effect:** `multiDelta` will populate on every signal. VWAP_PULLBACK and VCP_BREAKOUT modules will now correctly apply the taker buying pressure filter, blocking falling-knife entries.
- **Falsification:** If multiDelta is still null in any of the next 20 signals, the MEXC API is not returning data AND the fallback has a bug.

#### [H3] P1: Block TRANSITION Regime (knife-catcher.js)
- **Problem:** All 4 Bot 2 trades in `TRANSITION` regime resulted in losses (-1.0R expectancy). Mean-reversion strategies structurally require a stable mean to revert to; TRANSITION (by definition) lacks one.
- **Fix:** Added `TRANSITION_REGIME_BLOCK` check that shadows any TRANSITION candidate before execution gates. Combined with the existing `RISK_OFF` block, Bot 2 now only trades in `TRENDING` and `HIGH_VOL_BREAKOUT` regimes (with existing +5 score penalties for both).
- **Expected Effect:** Removes the 4 TRANSITION losses (-4.0R total) from the expected distribution.
- **Falsification:** If TRANSITION shadow trades show >50% WOULD_WIN over n≥15, the block is overly conservative and should be relaxed.

### Validation Criteria:
- **H1:** Bot 2 overall expectancy ≥ +0.3R over next 10 decisive trades (STREAK_REVERSAL only).
- **H2:** `multiDelta` shows non-null values in 100% of next 20 Bot 1 signals.
- **H3:** Zero TRANSITION live trades. Shadow data collection continues for future rehabilitation analysis.
- **Check at:** 14 calendar days or 10 decisive trades per bot.

---

## Previous Version: v11.1.2 (QuantumEdge) & v2.1.2 (Knife Catcher) 
**Date:** Apr 26, 2026
**Theme:** "EXIT ACCOUNTING FIX & FORENSIC TELEMETRY"

### Core Logic & Parameters:
- **Runtime Versions:** `v11.1.2-QuantumEdge` / `v2.1.2-KnifeCatcher-Quantum`.
- **Audit Window:** Apr 24–26, 2026 (~58.5 hours, 235 observed Bot 1 runs).
- **Data Basis:** Bot 1: 9 autopsies (2W/7L), 3 resolved shadows, 235 observed runs with 0% gaps. Bot 2: 22 autopsies (6W/14L/2S), telemetry schema review.

### Changes Made:

#### [H5] Trailing Stop Outcome Repair (trader-bot.js)
- **Problem:** Audit found a Bot 1 trade (`LTCUSDT`) with `trailingStopActive=true`, stop moved above entry, `maePct=0`, and yet `outcome=LOSS`. That is a telemetry lie, not a real losing trade.
- **Fix:** Stop-hit exits now call a dedicated classifier. If a BUY trade has `trailingStopActive=true`, `sl >= entry`, and the observed stop-hit price is still `>= entry`, the outcome is recorded as `BREAK_EVEN` with `exitReason=TRAIL_BE_STOP`. Gap-through cases still remain `LOSS`.
- **Expected Effect:** Loss counts and expectancy stop being artificially depressed by protected trades that never traded below entry after the stop was advanced.
- **Falsification:** Any future trade with `trailingStopActive=true` and `exitPrice >= entry` still recorded as `LOSS` means the fix failed.

#### [T2] Exit Forensics Telemetry (trader-bot.js)
- **Problem:** `history.json` and `autopsies.json` did not persist `exitPrice` or `exitReason`, forcing audits to infer whether a stop was a true loss, a break-even save, or a stale time-stop.
- **Fix:** Exit records now persist `exitPrice`, `exitReason`, `closedAt`, and explicit `trailingStopActive` state in both history and autopsy payloads.
- **Expected Effect:** Future audits can distinguish `TAKE_PROFIT`, `STOP_LOSS`, `TRAIL_BE_STOP`, `TRAIL_STOP_GAP_LOSS`, and time-stop outcomes directly from stored data.
- **Falsification:** If a closed trade is missing any of those fields in the next deployment window, the telemetry upgrade is incomplete.

#### [T3] Knife Catcher Exit Telemetry Parity (knife-catcher.js)
- **Problem:** `knife_history.json` and `knife_autopsies.json` also lacked `exitPrice` and `exitReason`, making Bot 2 forensic review asymmetrical with Bot 1 even though 22 Bot 2 autopsies already existed.
- **Fix:** Added explicit close-time telemetry for `TAKE_PROFIT`, `STOP_LOSS`, and `TIME_STOP_STALE_EXIT` in Bot 2. No signal-generation, risk-model, or gate logic was changed.
- **Expected Effect:** Bot 2 audits can now segment exits by actual closure mechanism without inferring from raw price paths.
- **Falsification:** If any newly closed Bot 2 trade is missing `exitPrice`, `exitReason`, or `closedAt`, parity was not achieved.

### Validation Criteria:
- **H5:** Zero trades with `trailingStopActive=true` and `exitPrice >= entry` should be labeled `LOSS`.
- **T2:** Every newly closed Bot 1 trade should contain `exitPrice`, `exitReason`, and `closedAt` in both history and autopsy records.
- **T3:** Every newly closed Bot 2 trade should contain `exitPrice`, `exitReason`, and `closedAt` in both history and autopsy records.
- **Check at:** 14 calendar days or 20 decisive trades per bot.

---

## Previous Version: v11.1.1 (QuantumEdge) & v2.1.1 (Knife Catcher)
**Date:** Apr 24, 2026
**Theme:** "REGIME HARDENING & TELEMETRY ALIGNMENT"

### Core Logic & Parameters:
- **Runtime Versions:** `v11.1.1-QuantumEdge` / `v2.1.1-KnifeCatcher-Quantum`.
- **Audit Window:** Apr 21–23, 2026 (~51 hours, 205-206 runs per bot).
- **Data Basis:** Bot 1: 0 autopsies, 2 resolved shadows, 206 observed runs. Bot 2: 29 autopsies (9W/18L/2S), 517 resolved shadows.

### Changes Made:

#### [H4] HIGH_VOL_BREAKOUT Regime Score Floor +5 (knife-catcher.js)
- **Problem:** Bot 2 mean-reversion modules underperformed sharply in `HIGH_VOL_BREAKOUT`: 25.0% WR (4W/12L), `-0.18R` expectancy, and 75.0% zero-MFE losses. `TRANSITION` was the opposite at 57.1% WR (4W/3L), `+1.05R`.
- **Fix:** Added `required += 5` in `getRequiredScore()` when regime is `HIGH_VOL_BREAKOUT` and module is `STREAK_REVERSAL`, `PIVOT_REVERSION`, or `KELTNER_REVERSION`.
- **Expected Effect:** Filters marginal mean-reversion entries during violent trend-expansion conditions while preserving `KNIFE_CATCHER` and healthy `TRANSITION` behavior.
- **Falsification:** If the next 20 decisive Bot 2 trades still leave overall expectancy below `+0.10R`, this penalty did not fix the live edge problem.

#### [T1] Accepted `LIVE_SIGNAL` Telemetry (trader-bot.js / knife-catcher.js)
- **Problem:** `[THROUGHPUT] LIVE_SIGNAL` was incrementing inside `generateSignal()` before sector-correlation filtering and before persistence, overstating accepted live signals in both bots.
- **Fix:** Moved `LIVE_SIGNAL` counting to the acceptance path immediately before `recordSignalHistory()`, after sector dedupe passes.
- **Expected Effect:** Throughput logs now match actual accepted/persisted live signals, making future audits trustworthy without changing trading behavior.
- **Falsification:** If future runs still show `LIVE_SIGNAL` counts above persisted history growth for the same window, there is another telemetry mismatch downstream.

### Validation Criteria:
- **H4:** `HIGH_VOL_BREAKOUT` expectancy improves from `-0.18R` to `>= 0R`, or Bot 2 overall expectancy improves to `>= +0.25R`.
- **T1:** `[THROUGHPUT] LIVE_SIGNAL` increments should now line up with accepted history entries instead of pre-sector candidates.
- **Check at:** 14 calendar days or 20 decisive Bot 2 trades.

---

## Previous Version: v11.1.0 (QuantumEdge) & v2.1.0 (Knife Catcher)
**Date:** Apr 21, 2026
**Theme:** "AUDIT-DRIVEN SURGICAL FIXES — VOLUME GATE, REGIME PENALTY, DELTA DIAGNOSTICS"

### Core Logic & Parameters:
- **Runtime Versions:** `v11.1.0-QuantumEdge` / `v2.1.0-KnifeCatcher-Quantum`.
- **Audit Window:** Apr 17–21, 2026 (~92 hours, ~375 runs per bot).
- **Data Basis:** Bot 1: 7 autopsies, 6 shadow archive. Bot 2: 24 autopsies (13W/9L/2S), 30 active shadows.

### Changes Made:

#### [H1] STREAK_REVERSAL Volume Hard Gate (knife-catcher.js)
- **Problem:** STREAK_REVERSAL showed 33.3% WR (2W/4L), +0.03R expectancy. 3 of 4 losses had `volumePass=false` (vol ratios 0.33x–0.72x).
- **Fix:** Added hard volume gate in `evaluateStreakReversalModule()`. Rejects with `STREAK_LOW_VOL` if `volumeRatio < 0.8x`.
- **Expected Effect:** Removes 3 of 4 STREAK losses (saves ~3R). Also removes 1 lucky STREAK win (DOGE 0.28x). Net positive.
- **Falsification:** If STREAK shadow shows `STREAK_LOW_VOL` blocking >60% WOULD_WIN with n≥10, relax to 0.6x.

#### [H2] TRENDING Regime Score Floor +5 (knife-catcher.js)
- **Problem:** TRENDING regime showed 33.3% WR (2W/4L, +0.10R) vs TRANSITION at 73.3% (11W/4L, +1.42R). Mean reversion structurally underperforms in trending markets.
- **Fix:** Added `required += 5` in `getRequiredScore()` when regime is TRENDING and module is a mean-reversion type (STREAK/PIVOT/KELTNER).
- **Expected Effect:** Raises bar for TRENDING entries, filtering marginal setups. TRENDING volume may drop to near-zero (acceptable for MR bot).
- **Falsification:** If TRENDING shadows show >65% WOULD_WIN for SCORE_BELOW_FLOOR candidates, revert the +5.

#### [H3] MultiDelta Pipeline Diagnostics (trader-bot.js)
- **Problem:** `multiDelta` field is `null` in ALL 7 autopsies and ALL 6 shadow archive entries. The v11.0.0 anti-falling-knife taker delta feature is completely non-functional. 60% of losses had 0% MFE.
- **Fix:** Added diagnostic logging after `calculateMultiCandleDelta()` call. Logs raw `takerBuyBaseVolume` from last 3 candles when multiDelta returns null.
- **Expected Effect:** First deployment will reveal whether MEXC API provides taker data or not. No trading behavior change.
- **Next Step:** If API does provide data, fix the field mapping. If not, document limitation and consider alternative delta computation.

### Key Audit Metrics:

| Bot | n_decisive | WR | Expectancy | Status |
|-----|-----------|------|-----------|--------|
| Bot 1 (QuantumEdge) | 7 | 28.6% | −0.10R | ⚠️ Negative (low-n) |
| Bot 2 (Knife Catcher) | 22 | 59.1% | +0.72R | ✅ Positive edge |

| Module | n | WR | Exp (R) | Verdict |
|--------|---|------|---------|---------|
| KELTNER_REVERSION | 12 | 66.7% | +1.19R | ✅ Strong |
| PIVOT_REVERSION | 4 | 75.0% | +1.63R | 📊 Directional |
| STREAK_REVERSAL | 6 | 33.3% | +0.03R | ⚠️ Fixed in H1 |

### Validation Criteria:
- **H1:** STREAK WR ≥ 50% over next 10 decisive, or shadow confirms gate is correct.
- **H2:** TRENDING regime expectancy ≥ +0.2R, or zero TRENDING signals (acceptable).
- **H3:** `multiDelta` field shows non-null values in next 10 signals.
- **Check at:** 14 calendar days or 10 decisive trades per module.

---

## Previous Version: v11.0.0 (QuantumEdge) & v2.0.0 (Knife Catcher)
**Date:** Apr 19, 2026
**Theme:** "QUANTUM REVERSAL UPGRADE - 5M PRECISION & MULTI-STRATEGY"

### Core Logic & Parameters:
- **Runtime Version:** `v2.0.0-KnifeCatcher-Quantum`.
- **Changes Made:** 
    - **5-Minute Candle Analysis:** Upgraded the data pipeline to fetch and process 5-minute klines (200 periods) alongside the existing MTF stack. This allows for surgical precision in detecting micro-reversions.
    - **Strategy Expansion (3 New Modules):** 
        - `STREAK_REVERSAL`: Inspired by the XRP/LDO 5-red candle strategy. It detects exhaustive selling pressure (≥5 consecutive red candles on 5m) for high-probability bounces.
        - `PIVOT_REVERSION`: Implements a 4-hour Rolling Pivot Point (calculated from previous 48 x 5m candles). Generates signals when price deviates significantly below the central pivot.
        - `KELTNER_REVERSION`: A fade strategy using Keltner Channels (EMA 20 + 1.5 ATR). Fades the lower band when the deviation is extreme.
    - **Threshold Relaxation:** The original `KNIFE_CATCHER` module was found to be mathematically over-constrained (requiring 4% BB deviation + 25 RSI + 4x Volume simultaneously). The new version balances these strict requirements across the three new modules to ensure a healthy signal throughput.
    - **Risk Model Adaptation:**
        - **Streak/Keltner:** 10-hour time-stop (120 x 5m candles) and ~1.2-1.5% Stop Loss.
        - **Pivot:** 5-hour time-stop (60 x 5m candles) and ~1.0% Stop Loss.
- **Hypothesis / Goal:** Solve the zero-signal issue of the original Knife Catcher by diversifying the reversal archetypes and moving to a more granular timeframe (5m). These strategies have been backtested to show >50% win rates on high-liquidity assets like XRP, LDO, WLD, and BCH.

---

## Previous Version: v11.0.0 (QuantumEdge) & v1.0.0 (Knife Catcher)
**Date:** Apr 17, 2026
**Theme:** "MOMENTUM & FLOW UPGRADE - SECTOR ROTATION & MULTI-DELTA"

### Core Logic & Parameters:
- **Runtime Version:** `v11.0.0-QuantumEdge`.
- **Changes Made:** 
    - **Trailing Stops (Break-Even):** Activated a sliding break-even stop logic. Once an asset reaches 50% of the distance to the TP, the SL is dynamically moved to +0.1% for risk-free trades.
    - **Sector Rotation Bonus:** Core-leading assets (like BTC, ETH, SOL) receive a `+0.8` opportunity score bump, aligning entries with sector-wide outperformance.
    - **VWAP Anchor Calibration:** Expanded the VWAP rolling anchor from 50 (12.5h) to 96 (24h) periods, ensuring a full daily session is used to find institutional bounds.
    - **Multi-Candle Cumulative Delta:** Implemented a `calculateMultiCandleDelta` function (looking back 3 periods) to ensure sustained taker buying pressure exists before entering breakouts or pullbacks.
    - **Regime-Aware Risk Adjustments:** Widen TP and tighten time-stops in `HIGH_VOL_BREAKOUT`; tightened SL in `TRANSITION` (0.9x). Max ATR expanded limits slightly (1.2x) for ELITE liquidity tokens.
    - **Signal Memory Momentum:** Past trade memory is now weighed. A symbol with recent high scores gets a momentum adjustment (up to +3), and a symbol with constantly low scores gets penalized (up to -3).
    - **Module Quality Adjustments:**
        - `VWAP_PULLBACK`: Added hard rejections for declining 1H EMA, lacking ADX trend structure (ADX < 16), and overbought RSI (>72). Added point bonuses for 'sweet spot' momentum (RSI 50-65), ADX trend strength, multi-candle taker delta, and 4H+1H alignment.
        - `VCP_BREAKOUT`: Added rejections for lacking ADX bases (<14) and weak multi-candle taker delta (<0.05). Refined score weights: trend (30%), expansion (25%), participation (30%), and execution (15%), giving more weight to execution metrics and momentum.
- **Hypothesis / Goal:** Ensure that entries are backed by structural taker-buying pressure rather than just algorithmic threshold crossings. With sliding trailing stops, we intend to protect trades that perform well early on but fade out, significantly boosting the strategy's overall expected value.

---

## Previous Version: v10.2.0 (Quantum) & v1.0.0 (Knife Catcher)
**Date:** Apr 16, 2026
**Theme:** "KNIFE CATCHER DEFENSE - MFE 0% FIX"

### Core Logic & Parameters:
- **Runtime Version:** `v10.2.0-QuantumEdge`.
- **Changes Made:** Inserted structural confirmation gates to prevent buying falling knives.
    - `VWAP_PULLBACK`: Added `rsi15m < 45` rejection (VWAP_FALLING_KNIFE) and `rs1h < 0` rejection (VWAP_WEAK_MOMENTUM).
    - `VCP_BREAKOUT`: Added `rs1h < 0` rejection (VCP_WEAK_MOMENTUM).
- **Audit Evidence:** 10 out of the latest 11 losses from `VWAP_PULLBACK` had exactly `0.00%` MFE (Maximum Favorable Excursion), meaning trades were absorbing immediate drawdown without any bounce. This indicated the module was buying the fall *into* VWAP rather than the bounce *off* VWAP.
- **Hypothesis / Goal:** The structural gates will discard poor setups before execution. While throughput will slightly drop, the quality of `VWAP_PULLBACK` setups should rise, eliminating the 0% MFE streak and turning the system +EV, as the rejected shadow trades natively held a +EV profile on the 2.1:1 real R:R base.

---

## Previous Version: v1.0.0 (Knife Catcher) & v10.1.0 (Quantum)
**Date:** Apr 15, 2026
**Theme:** "PARALLEL ARCHITECTURE - UNCORRELATED EDGE"

### Core Logic & Parameters:
- **Architecture Change:** Instead of stuffing Mean Reversion logic into a trend-following bot (leading to complex code and `score soup` regressions), the system was split into a **Multi-Bot Topology**. 
- **Bot 1 (`trader-bot.js`):** Continues running `v10.1.0-QuantumEdge` checking 15m/1h/4h for high momentum breakouts and VWAP pullbacks at min. `0,15,30,45`.
- **Bot 2 (`knife-catcher.js`):** Spawned as `v1.0.0-KnifeCatcher` running at min. `5,20,35,50`. Pure extreme mean reversion. Hunts exclusively for:
    - Drops reaching 4% completely below the lower BB (`bbPercent <= -0.04`).
    - Severe oversold state (`rsi15m < 25`).
    - Massive capitulation volume (`volumeRatio > 4`).
- **Risk Model:** The Knife Catcher uses an extremely tight SL (1.0x ATR) because valid flush-rebotes recover rapidly. The TP is wide (3.5x ATR), providing a 3.5:1 reward ratio. Time stop is ruthlessly short (4 hours).

### Hypothesis / Goal:
The main system inherently dies during extreme market sell-offs (BTC RED block) or ranges. By having a parallel bot that ONLY wakes up during violent flushes, we can capture high-R:R opportunities when the primary bot is safely on the sidelines. We use isolated Netlify Blob storage (`knife-history`, `knife-shadows`) and an offset cron-job so Netlify metrics, shadow backtests, and MEXC API limits never collide.

---

## Previous Version: v10.1.0 (Active)
**Date:** Apr 14, 2026
**Theme:** "DEPTH-FLOOR PROMOTION — EVIDENCE-BASED FUNNEL UNBLOCK"

### Core Logic & Parameters:
- **Runtime Version:** `v10.1.0-QuantumEdge`.
- **Changes Made:** Three surgical modifications based on quantitative audit of 125 runs / 33 resolved shadow trades over a 32-hour operating window.

### Audit Evidence (32h window: Apr 12 21:40 → Apr 14 05:46):
- **125 runs, ZERO live signals.** Module candidates were generated in 33 cycles but ALL were blocked post-module by `LIQUIDITY_TIER_LOW` (17), `EXEC_SPREAD` (9), `EXEC_DEPTH` (8), `LIQUIDITY_TIER_MEDIUM` (6).
- **Shadow pool: 7W / 26L (21.2% WR).** Net negative overall — filters were broadly correct.
- **But discriminating by reject reason:** `LIQUIDITY_TIER_LOW` shadows showed 33.3% WR (5W/10L) — just above breakeven for 2.14 RR.
- **All 7 wins were `VWAP_PULLBACK`** (0-for-4 on VCP_BREAKOUT).
- **Depth discriminates:** 5 of 7 winners had `depthQuoteTopN >= $200k`. The 10 ULTIMAUSDT serial losers all had `depth < $36k`.
- **HYPEUSDT** (3W/1L, 75% WR) and **WLDUSDT** (2W/0L, 100% WR) showed genuine edge in the shadow pool.

### Changes Made:
1. **Depth-Floor Promotion (PRIMARY):**
   - `VWAP_PULLBACK` candidates with `liquidityTier=LOW` but `depthQuoteTopN >= $200,000` can now trade live.
   - Position sizing reduced to 0.5x for promoted trades.
   - Tracked via `promotedFromLow: true` flag in signal history.
   - Throughput logged as `PROMOTED_LOW` stage counter.
   - **Expected impact:** Would have allowed 5 of 7 shadow winners live while blocking all 10 ULTIMAUSDT losers.

2. **MEDIUM-Tier Live for VWAP_PULLBACK:**
   - `MEDIUM` liquidity tier no longer forces shadow-only for `VWAP_PULLBACK` candidates.
   - `VCP_BREAKOUT` remains shadow-only at MEDIUM tier (0% WR evidence).
   - Score floor +3 penalty for MEDIUM tier is preserved (from `getRequiredScore`).
   - **Expected impact:** 6 additional candidates that were MEDIUM+VWAP_PULLBACK can now reach live evaluation.

3. **VWAP_TOO_FAR Regime-Aware Ceiling:**
   - In confirmed `TRENDING` regime (bull4h = true, not risk-off), VWAP proximity ceiling widened from 1.5% to 2.0%.
   - Non-TRENDING regimes retain the strict 1.5% ceiling.
   - **Expected impact:** Reduces the 447 `VWAP_TOO_FAR` rejects observed during extended trending sessions. The module still requires bull4h, rs4h > 0.005, volumeRatio > 1.1, and positive OBI.

### Hypothesis / Goal:
The v10.0.0 modules are correct strategic tools — they found setups. The problem was a structural chokepoint in post-module execution gates that killed 100% of candidates for 32+ hours. This version surgically opens three controlled pathways while maintaining all module-level quality gates, ATR-based risk management, and BTC context protection. The half-sizing on promoted LOW-tier trades limits downside exposure during validation.

### Risk Assessment:
- **Small sample:** 7 shadow wins is not statistically significant. The 33.3% WR on LOW-tier could be lucky.
- **Execution risk:** Real fills on LOW-tier coins may underperform shadow benchmarks due to slippage.
- **Mitigation:** 0.5x position sizing + `promotedFromLow` tracking for isolated performance analysis.

### Falsification Criteria:
- If first 10 `promotedFromLow` live trades show WR ≤ 20%, disable the depth-floor exception.
- If real execution slippage exceeds 30bps consistently on promoted trades, tighten depth floor to $300k.
- If MAE avg on promoted trades exceeds 1.5%, the entries are structurally weak and the exception should be reverted.

### Pending Hypotheses:
1. Will the depth-floor at $200k correctly separate tradeable LOW-tier coins from thin-book garbage?
2. Will MEDIUM-tier VWAP_PULLBACK trades match the win profile of HIGH-tier equivalents?
3. Does the 2% VWAP ceiling in TRENDING produce entries with better or worse MFE than the 1.5% window?
4. Is `VWAP_TREND_ALIGN` (45.6% of all rejects) the next bottleneck to investigate if throughput remains low?

---

## Previous Version: v10.0.0
**Date:** Apr 12, 2026
**Theme:** "QUANTUM EDGE - PURE STRATEGY MODULES"

### Core Logic & Parameters:
- **Runtime Version:** `v10.0.0-QuantumEdge`.
- **Changes Made:** A total architectural overhaul of the `scheduled-analysis.js` decision engine. Replaced the convoluted arbitrary mathematical "score soup" logic with two strict, professional edge trading models:
    - `VCP_BREAKOUT`: Volatility Contraction Pattern (BB width in lowest 15%) combined with extreme explosive volume (>2.3x) and solid bid-side liquidity.
    - `VWAP_PULLBACK`: Reclaim of the intraday Volume-Weighted Average Price on strongly trending tokens (high relative strength tracking).
- **Hypothesis / Goal:** The old code was suffering from infinite iterative loops because of overlapping variables (EMA distances + BB percentages + subjective scores), hiding real edge under arbitrary numbers. The pure modules strategy expects to achieve over 55-60% WR by ruthlessly rejecting "okay" setups and only executing highly confirmed institutional maneuvers. Score now dictates position sizing instead of trade validity validation.
- **Infrastructure Patch (Apr 14):** Core file renamed from `scheduled-analysis.js` to `trader-bot.js` to bypass a persistent Netlify/AWS EventBridge scheduler lock. Cron expression updated to explicit `0,15,30,45 * * * *` to force trigger registration. Verified active and triggering correctly.

---

## Previous Version: v9.1.3
**Date:** Apr 12, 2026
**Theme:** "ASIAN VOLUME PREMIUM"

### Core Logic & Parameters:
- **Runtime Version:** `v9.1.3-AsianVolumePremium`.
- **Changes Made:** Implemented a dynamic `minVolumeRatio` requirement based on the UTC hour. During the Asian session (00:00 - 07:00 UTC), the minimum volume required to validate signals increases significantly:
    - `TREND_PULLBACK`: `0.70x` → `1.20x`
    - `BREAKOUT_CONTINUATION` (Transition): `1.50x` → `2.00x`
    - `BREAKOUT_CONTINUATION` (Other): `1.20x` → `1.70x`
- **Hypothesis / Goal:** Since `v9.1.2` opened the gates to 24/7 trading by disabling the Asian session hard block, it exposed the system to the notoriously low-liquidity and fakeout-prone hours of the Asian session. By applying an "Asian Premium" to volume requirements, we allow genuine high-participation anomalies to be traded while filtering out the low-volume noise that typically traps intraday systems during the night.

---

## Previous Version: v9.1.2

### Core Logic & Parameters:
- **Runtime Version:** `v9.1.2-24hOperation`.
- **Changes Made:** Disabled the `AVOID_ASIA_SESSION` block by default. The algorithm will now analyze the market and emit signals 24/7.
- **Hypothesis / Goal:** User requested to remove the Asian session pause to maximize throughput and test edge during all market hours.
- **Risk Assessment:** Asian session (00:00 - 07:00 UTC) historically has lower liquidity and higher frequency of fake breakouts. We rely heavily on the `LIQUIDITY_TIER` filter (ELITE/HIGH) to mitigate this.

---

## Previous Version: v9.1.1
**Date:** Apr 10, 2026
**Theme:** "QUALITY REFINEMENT — PULLBACK LOCATION & ORDERFLOW"

### Core Logic & Parameters:
- **Runtime Version:** `v9.1.1-QualityRefinement`.
- **Diagnosed problem:** `v9.1.0` increased throughput successfully but the resulting `TREND_PULLBACK` signals resulted in an unacceptable `0% MFE` in 3 out of 4 trades. The algorithm bought toxic pullbacks that were either overextended at the upper band or had negative order book imbalance.
- **Root cause:** The relaxation of hard gates into progressive quality penalties inadvertently created a "score soup" loophole. Perfect trend and execution scores (100) masked the fact that `bbPercent` was up to `0.86` (near the high, not a pullback) and `OBI` was negative. A pullback by definition cannot occur at the upper band edge with sellers dominating.

### Changes Made:
1. **Re-instated Location Gate:** `bbPercent > 0.75` is once again a hard gate for `TREND_PULLBACK`. This blocks buying local tops disguised as pullbacks.
2. **Re-instated Orderflow Gate:** `obi < -0.10` is now a hard gate for `TREND_PULLBACK`. Buying a dip requires buyers to actually be present in the orderbook.

### Hypothesis / Goal:
Throughput was successfully restored in v9.1.0, but at the cost of structural logic. By re-instituting these two baseline filters specifically for pullbacks, we expect to maintain the increased signal frequency from the relaxed regime gates while drastically reducing the `0% MFE` (zero favorable move) false positives.

---

## Previous Version: v9.1.0
**Date:** Apr 7, 2026
**Theme:** "GATE RELAXATION — THROUGHPUT OVER PERFECTION"

### Core Logic & Parameters:
- **Runtime Version:** `v9.1.0-GateRelax`.
- **Diagnosed problem:** `REGIME_RISK_OFF` was killing 77-84% of the universe per run even with BTC GREEN. Triple redundancy in trend alignment (regime + pullback module + breakout module all requiring `bull4h AND bull1h`) made the conjunctive probability of passing all gates ~1%.
- **Root cause:** `detectMarketRegime()` returned `RISK_OFF` whenever `!bull4h OR price < ema50_15m`, eliminating symbols in early recovery or temporary pullbacks. Both modules additionally required `bull1h`, which is logically contradictory for a pullback module (a pullback temporarily breaks 1H EMA alignment).
- **Only trade in v9.0.x era:** ZECUSDT (MEDIUM, sector OTHER) → LOSS with 0% MFE. All CORE_LEADERS (BTC, ETH, SOL) were blocked by REGIME_RISK_OFF.

### Changes Made:
1. **Regime classifier relaxed:** `RISK_OFF` now requires BOTH `!bull4h AND price < ema50_15m` (was OR). Symbols with bull4h=true but temporarily below EMA50, or price above EMA50 without perfect 4H alignment, proceed to TRANSITION.
2. **TREND_PULLBACK:** `bull1h` moved from hard gate to quality factor (+15 trendQuality). 6 former hard gates (bbPercent, pullbackDepth, RSI ranges, rs1h, deltaRatio, reclaim) converted to progressive quality penalties. Location/volume thresholds widened.
3. **BREAKOUT_CONTINUATION:** Same `bull1h` → quality factor treatment. Gates relaxed (breakoutDistance, candleStrength, RSI, volume requirements, deltaRatio, rs1h). TRANSITION+MEDIUM block removed (handled globally).
4. **MEDIUM liquidity → shadow only:** Live signals restricted to ELITE and HIGH tiers. MEDIUM goes to shadow with `LIQUIDITY_TIER_MEDIUM` reject code.
5. **TRANSITION regime:** Now allows both TREND_PULLBACK and BREAKOUT_CONTINUATION live (was breakout-only).

### Hypothesis / Goal:
The strategy families (trend pullback + breakout) are correct per evidence (Liu & Tsyvinski 2021, Huang et al. SSRN 2024, Brauneis et al. 2024). The problem was gate architecture, not strategy selection. This version should generate significantly more signals (and shadows) for learning, while maintaining quality through the scoring system and requiring ELITE/HIGH liquidity for live signals.

### Risk Assessment:
- More throughput may include more false positives → mitigated by score floors (67+/70+) and liquidity restriction
- Pullbacks without bull1h are inherently riskier → mitigated by -15 trendQuality penalty and score floor
- Required monitoring: 72h window comparing REGIME_OK rate, MODULE_OK rate, shadow outcomes, and live win rate

---

## Previous Version: v9.0.1
**Date:** Apr 7, 2026
**Theme:** "EXECUTION GATE AUDIT"

### Core Logic & Parameters:
- **Runtime Version:** `v9.0.1-ExecutionAware`.
- **Observed validation window:** `2026-04-05 09:31:19 UTC` to `2026-04-07 09:30:28 UTC`.
- **Observed active-session runs in that window:** `139`, versus ~`136` expected runs once the `00:00-07:00 UTC` Asia block is excluded. Lectura: no hay evidencia fuerte de fallo operativo en el scheduler dentro de la sesión activa.
- **Observed result in synced blobs:** `history.json = 0`, `shadow_trades.json = 0`, `shadow_trades_archive.json = 0`, `autopsies.json = 0`, `signal_memory.json = 0`.
- **Dominant reject stack in the observed window:** `LIQUIDITY_TIER_LOW`, `EXEC_SPREAD`, `EXEC_DEPTH`, `REGIME_RISK_OFF`.
- **Execution-depth measurement fix:** la profundidad deja de resumirse sobre `top 10` niveles y pasa a usar todo el snapshot ya descargado (`limit=20`), para no degradar majors por una vista truncada del libro.
- **Execution gate relocation:** `EXEC_SPREAD`, `EXEC_DEPTH` y `LIQUIDITY_TIER_LOW` ya no matan el símbolo antes de evaluar módulos. Primero se calcula si existe un proto-setup razonable; después se decide si puede pasar a `live`. Así `shadow` puede capturar near-misses reales bloqueados por ejecutabilidad.
- **Throughput funnel telemetry:** cada run añade `[THROUGHPUT] Stages ...` para mostrar cuántos símbolos sobreviven a `ORDERBOOK`, `LIQUIDITY_BASE`, `REGIME`, `MODULE`, `EXECUTION` y `SCORE`.
- **Session observability fix:** las ejecuciones bloqueadas por `AVOID_ASIA_SESSION=true` ahora también se persisten en `persistent_logs`, para que la próxima auditoría pueda distinguir mejor entre runs esperados, runs observados y runs intencionalmente pausados.

### Hypothesis / Goal:
No hay evidencia suficiente para un rediseño completo dos días después de v9.0.0. La hipótesis más defendible es más estrecha: el problema dominante actual es de `throughput` y de observabilidad del gate de ejecución, no de invalidez estratégica de la baseline `trend pullback + breakout`.

### Bug Found:
- **Early hard gating nos dejaba sin aprendizaje.** Si un símbolo moría por `EXEC_SPREAD`, `EXEC_DEPTH` o `LIQUIDITY_TIER_LOW`, el runtime no llegaba a revelar si detrás había un candidato razonable que merecía `shadow`.
- **La ventana reciente estaba infra-observable para auditorías de 72h.** Las pausas por sesión Asia no quedaban persistidas en los logs sincronizados, complicando la lectura de runs esperados vs. observados.
- **La profundidad efectiva estaba sesgada por truncamiento.** El código pedía `20` niveles al exchange pero solo sumaba `10`, endureciendo artificialmente el filtro de profundidad.

### Lesson Learned:
- **Antes de bajar thresholds, hay que auditar la geometría del gate.** Un filtro correcto en principio puede ser demasiado duro en la práctica si mide mal la liquidez.
- **Sin `shadow` ni funnel stages, “0 BUY” no enseña suficiente.** La falta de señales puede ser una decisión defendible o una asfixia del embudo; sin telemetría adicional no se puede separar bien.
- **Un rediseño completo con `history/shadow/autopsies` vacíos sería convicción fabricada.** Primero toca mejorar la honestidad observacional del runtime actual.

### Pending Hypotheses:
1. ¿Cuántos near-misses empezará a registrar `shadow` ahora que el gate de ejecución se evalúa al final del funnel?
2. ¿El cuello dominante seguirá estando en ejecución o migrará hacia `BREAKOUT_DISTANCE`, `PULLBACK_RS` o `SCORE_BELOW_FLOOR`?
3. ¿La combinación `RISK_OFF + execution gates` sigue dejando throughput suficiente en majors líquidas durante sesiones Europa/EE. UU.?

---

## Previous Version: v9.0.0
**Date:** Apr 5, 2026
**Theme:** "EVIDENCE-FIRST THROUGHPUT RESET"

### Core Logic & Parameters:
- **Runtime Version:** `v9.0.0-EvidenceFirst`.
- **Decision engine re-write:** Se conserva la capa operativa de Netlify/Blobs/Telegram, pero el motor de decisión se reescribe para quedar centrado solo en dos familias con mejor racional empírico para `spot long-only`:
  - `TREND_PULLBACK`
  - `BREAKOUT_CONTINUATION`
- **Universe hardening:** Se excluyen wrappers/sintéticos no alineados con el objetivo del sistema (por ejemplo tokenized metals). También sube el sesgo hacia liquidez real: `MIN_DEPTH_QUOTE` por defecto a `90000`, `MIN_QUOTE_VOL_24H` por defecto a `8000000`.
- **Regime simplification:** El runtime pasa a usar `TRENDING`, `RANGING`, `HIGH_VOL_BREAKOUT`, `TRANSITION` y `RISK_OFF`. `RISK_OFF` no opera live.
- **BTC context simplificado:** El semáforo deja de depender de una mezcla de indicadores legacy; ahora actúa como contexto simple `GREEN / AMBER / RED`.
- **Score simplificado:** Se elimina el `score soup` basado en MSS/FVG/sweeps/divergencias/patrones como eje. Cada módulo se puntúa con pocas piezas explicables:
  - `trend`
  - `location/expansion`
  - `participation`
  - `execution`
- **Telemetry upgrade real:** `history`, `shadow` y `autopsies` ahora guardan también:
  - `qualityBreakdown`
  - `relativeStrengthSnapshot`
  - `volumeLiquidityConfirmation`
  - `rejectReasonCode`
  - `mfePct`
  - `maePct`
- **Throughput instrumentation:** Cada run registra top rechazos agregados (`[THROUGHPUT] Rejects ...`) y cuántos candidatos llegó a producir cada módulo.

### Hypothesis / Goal:
Resolver el problema detectado en producción de `0 signals` repetidos durante decenas de ejecuciones seguidas sin caer de nuevo en el patrón de “bajar thresholds a ojo”. La nueva hipótesis es: menos filtros ornamentales, más rechazo explícito e información de throughput.

### Observed Runtime Context Before v9:
- **Ventana observada en `persistent_logs.json`:** desde `2026-04-02 08:31:54 UTC` hasta `2026-04-05 08:30:43 UTC`.
- **Ejecuciones observadas en esa ventana de 72h:** `211`.
- **Promedio de símbolos analizados por run:** `33.28`.
- **Resultados:** `0 signals`, `0 errors`.
- **Lectura:** el problema dominante ya no parecía ser operativo. El motor estaba corriendo, pero casi no dejaba señales ni `shadow` útil reciente.

### Bug Found:
- **Desalineación entre intención y observabilidad:** el motor v8 seguía siendo más opaco de lo que aparentaba. Si un símbolo moría pronto en el pipeline, no quedaba claro qué gate lo bloqueó con más frecuencia.
- **Sesgo de muestra engañoso:** `history.json` mostraba `2/4` wins, pero `2` de esas victorias provenían de `GOLD(PAXG)USDT` y `GOLD(XAUT)USDT`, que no encajan bien con el objetivo de un sistema de trading cripto spot intradía.
- **Threshold global ignorado:** `SIGNAL_SCORE_THRESHOLD` existía en runtime pero no estaba guiando realmente el gating final del motor.

### Lesson Learned:
- **Un archivo “modular” puede seguir siendo conceptualmente barroco.** Dos módulos no bastan si cada uno depende de una docena de validaciones de herencia histórica.
- **La ausencia total de señales durante 72h con mercado operativo no es una prueba de calidad; es una hipótesis que exige instrumentación.**
- **Ganar con wrappers no valida el edge cripto.** Hay que evitar que activos fuera del dominio objetivo maquillen la lectura del sistema.

### Pending Hypotheses:
1. ¿La nueva instrumentación de rechazos mostrará que el cuello de botella dominante está en `PULLBACK_LOCATION`, `BREAKOUT_VOLUME` o en el filtro de universo/liquidez?
2. ¿`TRANSITION` merece seguir permitiendo solo `BREAKOUT_CONTINUATION` live o conviene convertirlo en shadow-only completo si su throughput sigue siendo improductivo?
3. ¿La exclusión de wrappers mejorará la honestidad del dataset aunque empeore temporalmente el win rate observado?

---

## Previous Version: v8.0.0
**Date:** Mar 30, 2026
**Theme:** "RESEARCH-DRIVEN MODULAR RESET"

## Previous Version: v7.4.2
**Date:** Mar 29, 2026
**Theme:** "DOWNTREND RE-QUARANTINE + RANGING TIGHTENING"

### Core Logic & Parameters:
- **Runtime Version:** `v7.4.2-SelfLearn`.
- **Live Scope:** `RANGING`, `TRENDING` y `HIGH_VOLATILITY` operativos en live. `TRANSITION` y `DOWNTREND` en **shadow-only** completo.
- **DOWNTREND Re-Quarantine:** El subset live reintroducido en v7.4.1 se desactiva por completo. Resultado empírico: **1W / 4L (20% WR)** con **0% favorable move** en las 4 LOSS. El edge shadow (51.9%) no se trasladaba a live porque el benchmark shadow (R:R 1.25:1) es mucho más laxo que el R:R live (2.11:1).
- **RANGING BB% Cutoff: 0.75 → 0.65:** Las LOSS de TAO (BB%=0.70) y LTC (BB%=0.71) entraron overextended en la banda superior. Las 6 WIN tenían BB% ≤ 0.37. Se reduce el cutoff para eliminar compras en la parte alta del rango.
- **Low Vol Hard Rejection:** Si el `volumeRatio < 0.8` (que ya dispara Low Vol Penalty -10), ahora se rechaza directamente. LTC LOSS (score 71→61, volRatio 0.69×) entró con volumen muerto y cayó en 12 minutos. El near-miss se registra como `LOW_VOL_HARD`.

### Hypothesis / Goal:
Subir el WR live de 43.8% hacia ~54.5% eliminando las dos fuentes de LOSS más claras: entradas DOWNTREND sin edge real y entradas RANGING en la banda superior con volumen débil.

### Bug Found:
- Low Vol Penalty (-10) era insuficiente como protección sola. El score penalizado seguía superando el umbral de RANGING (60), permitiendo trades con volumen muerto que flash-stopped.

### Lesson Learned:
- **Shadow benchmark laxo (R:R 1.25:1) exagera el edge de regímenes frágiles respecto al R:R live (2.11:1).** No confiar en el WR shadow como predictor directo del WR live sin ajustar por discrepancia de benchmark.
- **BB% > 0.65 en RANGING correlacionó 100% con LOSS en la muestra (n=2 LOSS, 0 WIN).** Las WIN en RANGING compran barato (BB% medio ~0.32).

### Pending Hypotheses:
1. ¿El DOWNTREND podría funcionar con TP más ajustado (3.0× → 2.5× ATR)?
2. ¿El filtro BTC_RED es excesivamente conservador? (Shadow: 81.8% WR pero con benchmark laxo)
3. ¿Un trailing stop parcial mejoraría la recuperación en trades direccionalmente correctos que no alcanzan TP?

---

## Past Versions (Audit History)

### v7.4.1 — Downtrend Subset Re-Entry (Mar 24, 2026)
- **Reapertura quirúrgica:** `DOWNTREND` dejaba de ser un bloqueo absoluto. Solo volvía a live un subset muy estrecho: `BTC GREEN` + estructura confirmada (`MSS/Sweep`) + `bbPercent <= 0` + `categoryScores.volume >= 50`.
- **Shadow Hygiene Fix:** Near-misses resueltos/expirados se archivan y se purgan del shadow activo.
- **Bug Found:** El shadow activo retenía registros ya resueltos tras archivarlos (solapamiento).
- **Verdict (Auditoría Mar 29):** **AJUSTE QUIRÚRGICO.** El subset DOWNTREND mostró 1W / 4L (20% WR) con 0% favorable move en todas las LOSS. Se revierte a shadow-only completo en v7.4.2.

### v7.4.0 (SPOT REGIME SCALPER)
- **Status:** Superseded by v7.4.1 (Mar 24, 2026)
- **Runtime Version:** `v7.4.0-SelfLearn`.
- **Key Change:** `TRANSITION` y `DOWNTREND` pasaron a cuarentena total `shadow-only` para proteger el estilo `spot` long-only.
- **Observation:** La cuarentena protegió capital frente a `TRANSITION`, pero la auditoría posterior detectó dos hechos clave: un subset barato y estructurado de `DOWNTREND` seguía teniendo edge en shadow, y el shadow activo retenía filas ya archivadas, contaminando la lectura de la ventana reciente.

### v7.3.0 (CAPITULATION & TREND DISCIPLINE)
- **Status:** Superseded by v7.4.0 (Mar 20, 2026)
- **Runtime Version:** `v7.3.0-SelfLearn`.
- **Key Change:** Endureció `TRENDING` con BB% máximo de 0.65, pero abrió `DOWNTREND`/`TRANSITION` para compras agresivas si BTC seguía GREEN.
- **Observation:** La auditoría del 20-Mar mostró una degradación severa: **WR real 6.25% (1W / 15L)**, con `0% WR` tanto en `TRANSITION` como en `DOWNTREND`. Además, el runtime acumuló miles de errores `hasMSS is not defined`, invalidando parte del throughput observado. La lectura estratégica fue clara: no era un problema de frecuencia ni de R:R, sino de calidad de entrada y disciplina de régimen.

### v7.2.0 (MYSTIC PULSE & STRICT MOMENTUM)
- **Status:** Superseded by v7.3.0 (Mar 18, 2026)
- **Runtime Version:** `v7.2.0-SelfLearn`.
- **Key Change:** Reemplazó RSI por Mystic Pulse (ADX Streak) y estableció BB% cutoff global en 0.85 para evitar overextension.
- **Observation:** El veredicto temprano de "MANTENER, 61.5% WR" probó ser prematuro en una muestra más amplia (62 trades reales). La auditoría exhaustiva reveló un **Win Rate real del 31.67%**, fuertemente lastrado por el régimen `TRENDING` (19% WR) donde el filtro de 0.85 de BB% permitía la compra en techos locales antes de la reversión. DOWNTREND, sorpresivamente, operó excelente (55%).

### v7.1.1 (INERTIA FILTER)
- **Status:** Superseded by v7.2.0 (Mar 14, 2026)
- **Runtime Version:** `v7.1.1-SelfLearn`.
- **Key Change:** En régimen `TRANSITION`, se exige `volumeRatio > 2.0` (antes ~1.5) para evitar fake breakouts.
- **Observation:** El mercado bajista forzó múltiples rechazos correctos pero el sistema seguía arrastrando el error base de entrar con el precio pagado a las bandas superiores basándose solo en falsos breakouts de corto plazo.

### v7.1.0 (CAPITULATION SCALPING)
- **Status:** Superseded by v7.1.1 (Mar 12, 2026)
- **Runtime Version:** `v7.1.0-SelfLearn`.
- **Key Change:** Desbloqueo de rebotes con umbrales de 55-60 en DOWNTREND/TRANSITION si BTC es GREEN y RSI4H < 40.
- **Observation:** Aumentó el throughput (de 0 a 8 señales), pero expuso fragilidad en TRANSITION (25% WR).


### v6.0.3 (AUDIT TRACEABILITY / v7.0 Alpha Gen)
- **Status:** Superseded by v7.1.0 (Mar 11, 2026)
- **Runtime Version:** `v6.0.3-SelfLearn` (Conocida luego como v7.0).
- **Key Change:** Sector correlation mitigations and initial Alpha Gen metrics.
- **Observation:** El sistema ganaba trazabilidad y detectaba correlación, pero seguía asfixiado por el threshold de 75 en `TRANSITION` y `DOWNTREND`. La muestra de trades reales cayó a 2 (0% WR) a pesar de un mercado fuertemente rebotador detectado por el shadow trading (98% WR en ventana activa).

### v6.0.2 (SHADOW ARCHIVE)
- **Status:** Superseded by v6.0.3 (Mar 9, 2026)
- **Runtime Version:** `v6.0.2-SelfLearn`
- **Key Change:** shadow activo corto + archivo histórico append-only para near-misses resueltos/expirados.
- **Observation:** solucionó el histórico truncado, pero seguían faltando trazas del benchmark efectivo, del efecto de momentum y del coste de la correlación sectorial.

### v6.0.1 (TRANSITION HARD LOCK)
- **Status:** Superseded by v6.0.2 (Mar 7, 2026)
- **Runtime Version:** `v6.0.1-SelfLearn`
- **Key Change:** `TRANSITION` pasa a umbral duro de 75 sin reductores implícitos.
- **Observation:** la lógica de régimen quedó alineada, pero la capa de shadow seguía sin conservar histórico completo para validarla en el tiempo.

---

### v5.3 (PERFORMANCE TUNING — Post-Auditoría de Frecuencia)
- **Status:** Superseded by v5.4 (Feb 28, 2026)
- **Performance:** 40% WR (2W / 3L) - Muestra pequeña pero con patrón de fallo claro en TRANSITION.
- **Issue:** El umbral de 70 en TRANSITION permitió la entrada de "Fake Breakouts" (DOT, ONDO, SHIB) que no tenían suficiente inercia.

### Hypothesis / Goal:
v5.2a mantiene todos los umbrales de score de v5.2 (que funcionaron correctamente filtrando el mercado bajista del 23-Feb). Los dos fixes quirúrgicos eliminan la causa raíz del único trade perdedor documentado. Se espera que el WR mejore con señales de mayor calidad geométrica.

### Verdict (v5.2 Audit — Feb 24, 2026):
**AJUSTE QUIRÚRGICO.** La configuración general de v5.2 es correcta. El único trade emitido (TRXUSDT, LOSS) tenía dos defectos identificables: entrada overextended (BB%=1.01) y R:R subóptimo (1.39 < 1.5). Los umbrales de score rechazaron correctamente ~70 ciclos sin señal durante un mercado bajista global. No se revierte nada.

---

## Past Versions (Audit History)

### v5.2 (REVERT & REFINE)
- **Status:** Superseded by v5.2a (Feb 24, 2026)
- **Performance:** 0% WR (0W / 1L) — muestra de 1 trade, sin validez estadística
- **Issue #1:** Path TRANSITION/MSS bypaseaba el filtro `bbPercent > 0.88` de la línea general de overextension.
- **Issue #2:** R:R reportado era teórico fijo, no el R:R real de los multiplicadores ATR. TRXUSDT tuvo R:R real = 1.39, por debajo del mínimo de 1.5.

### v5.1 (Aggressive Mode)
- **Status:** Retired (Feb 22, 2026)
- **Performance:** 17.6% WR (3W / 8L / 5BE)
- **Issue:** TRANSITION regime entries were too loose (Threshold 65).

---

## 🛑 Lessons Learned (Avoiding Past Mistakes)
*Add key takeaways here as they are discovered.*

1. **Over-tuning on small data:** Adjusting filters after 1 win and 2 open trades is a mistake. However, waiting too long when a clear failure pattern (17% WR) emerges is also risky.
2. **TRANSITION Fragility:** Aggressive modes (Threshold < 70) in Transition regimes are prone to fake breakouts. Quality beats frequency in these zones.
3. **Break-Even Paradox:** While BE protects capital, it often exits trades right before the real move starts. High-quality entries shouldn't need a 0.8:1 BE trigger to be profitable.
4. **BB% Bypass en MSS/Sweep:** [Feb 24] Los paths de confirmación de estructura (MSS, Sweep) pueden bypassear filtros de overextension generales. Cada régimen necesita su propio gate de BB%, independiente del path de entrada.
5. **R:R Teórico vs. Real:** [Feb 24] Reportar R:R teórico (ratio de multiplicadores fijos por tipo de régimen) enmascara el R:R real que el mercado ofrece a través del ATR. Siempre gatear con el R:R real antes de emitir la señal.
6. **Threshold documentado != threshold efectivo:** [Mar 6] Si un régimen necesita un suelo duro, no puede compartir reductores globales de score. SOTT puede mejorar el setup, pero no debe rebajar el gate de `TRANSITION`.
7. **BTC-SEM GREEN no basta:** [Mar 20] Un BTC saludable no autoriza compras agresivas en altcoins si el régimen local sigue en `DOWNTREND` o `TRANSITION`. El contexto macro puede estar verde mientras la estructura operable de los alts sigue rota.
8. **Shadow Quarantine > Threshold Whiplash:** [Mar 20] Cuando un régimen entero entra en sospecha, es mejor moverlo temporalmente a `shadow-only` que seguir oscilando thresholds live sin edge confirmado.
9. **Shadow activo != shadow histórico:** [Mar 24] El store activo debe contener solo near-misses pendientes. Si mezcla resueltos ya archivados, la ventana reciente deja de ser interpretable.
10. **No todo `DOWNTREND` es basura:** [Mar 24] El régimen completo sigue siendo frágil, pero el subset "barato + estructura + BTC GREEN + volumen suficiente" sí merece validación live controlada.

---

## 🧪 Pending Hypotheses (Ideas to Test in Future)

- **~~Risk:Reward Adjustment~~:** ~~Si win rate cae bajo 50% con MODO AGRESIVO, considera subir el Target/R:R de 1.5 a 1.8.~~ **RESUELTO en v5.2a:** El gate de R:R mínimo 1.5 ya garantiza este mínimo usando el R:R real de ATR. Si el mercado no ofrece R:R ≥ 1.5, simplemente no se emite la señal.
- **Time-based filtering:** El sistema restringe el trading durante la sesión Asia (baja liquidez). Hay que evaluar explícitamente el WR de trades que entran en la apertura London vs. NY. El único trade perdedor (TRXUSDT) parece haberse gestado antes de London.
- **~~DOWNTREND Bounce Mode~~:** **PARCIALMENTE VALIDADA en v7.4.1.** No se reabre el régimen completo. Solo pasa a live el subset con `BTC GREEN` + `MSS/Sweep` + `bbPercent <= 0` + volumen categórico `>= 50`. Falta validar WR live antes de ampliar.
- **~~TRANSITION Hard Lock Validation~~:** **REFUTADA en auditoría Mar 24.** Los near-misses `TRANSITION` de score 71-74 resolvieron `1W / 9L`; no hay base para relajar el lock.
- **~~Regime Shadow Re-Entry~~:** **PARCIALMENTE VALIDADA en v7.4.1.** La reapertura se limita a `DOWNTREND`; `TRANSITION` sigue fuera por falta de edge.
- **Downtrend Live Subset Validation [NUEVA — Mar 24]:** Si el subset `DOWNTREND` reintroducido mantiene WR > 55% con drawdown controlado durante varias sesiones, evaluar si merece una ampliación por horario o por score.
- **Shadow Window Sanity [NUEVA — Mar 24]:** Verificar en los próximos ciclos que `shadow_trades.json` quede compuesto solo por near-misses `PENDING` y sin solape estructural con `shadow_trades_archive.json`.
