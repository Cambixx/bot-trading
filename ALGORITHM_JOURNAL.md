# Algorithm Tuning Journal (`scheduled-analysis.js`)

This file tracks the evolution of the trading algorithm, the logic behind parameter changes, and the lessons learned from market behavior. 

**Rule:** NEVER update `scheduled-analysis.js` without first reviewing past mistakes and logging the intended change here.

---

## Current Version: v5.2 (Active)
**Date:** Feb 22, 2026
**Theme:** "REVERT & REFINE" (Return to quality over quantity)

### Core Logic & Parameters:
- **Break-Even Logic:** [REMOVED] Per user request. Trades now only close at TP (WIN) or SL (LOSS).
- **Entry Filter Thresholds:** [RESTORED/TIGHTENED]
  - TRANSITION: Increased from 65 to **72**.
  - TRENDING: Increased from 70 to **75**.
  - RANGING: Increased from 60 to **68**.
- **Downtrend Logic:** [TEHIGHTENED] Disabled secondary bounce fallbacks. Requires score > 82 and extreme confluence for oversold bounces.

### Hypothesis / Goal:
The v5.1 Aggressive Mode resulted in a win rate of ~17.6%. Many trades were entering on weak structure breakouts in the TRANSITION regime which frequently failed. v5.2 aims to restore the win rate to > 65% by prioritizing high-conviction signals and removing the "protection" of break-evens that often cut winning trades short prematurely.

### Verdict (v5.1 Audit):
**FAILURE.** Aggressive mode was too lax for the current market volatility in TRANSITION regimes. Reverted to stricter filters.

---

## Past Versions (Audit History)

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

---

## 🧪 Pending Hypotheses (Ideas to Test in Future)
- *Risk:Reward Adjustment:* If win rate drops under 50% with `MODO AGRESIVO`, consider bumping the Target/R:R from 1.5 to 1.8 to compensate, rather than tightening the entry conditions again.
- *Time-based filtering:* The system currently restricts trading during the Asia Session (Low liquidity). We need to explicitly evaluate the win-rate of trades that enter right at the open of London session vs NY session.
