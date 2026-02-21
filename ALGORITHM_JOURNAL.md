# Algorithm Tuning Journal (`scheduled-analysis.js`)

This file tracks the evolution of the trading algorithm, the logic behind parameter changes, and the lessons learned from market behavior. 

**Rule:** NEVER update `scheduled-analysis.js` without first reviewing past mistakes and logging the intended change here.

---

## Current Version: v5.1 (Active)
**Date:** Feb 20, 2026
**Theme:** "MODO AGRESIVO" (Aggressive Mode for earlier pivot detection)

### Core Logic & Parameters:
- **TRANSITION Score Threshold:** Lowered from 75 to 65.
- **DOWNTREND Score Threshold:** Lowered for specific oversold bounce criteria.
- **Ranging Structure:** Allowed 'MODO AGRESIVO' fallback when standard '💎 MODO SNIPER' (score > 88, Vol > 1.5x, etc.) isn't fully met but momentum exists.

### Hypothesis / Goal:
The algorithm was missing valid trades because the filters were too restrictive, demanding perfect "Sniper" conditions. By relaxing the score threshold in Transition regimes, the system can catch earlier breakouts and structural shifts, tagging them as `⚡ MODO AGRESIVO`.

### Results so far (as of Feb 21, 2026):
- Captured `ASTERUSDT` (Score 65, TRANSITION) -> Closed as **WIN** (Target Reached).
- Captured `GOLD(XAUT)USDT` (Score 69, TRANSITION) -> Currently **OPEN**.
- Captured `PEPEUSDT` (Score 65, TRANSITION) -> Currently **OPEN**.

### Next Actions / Verdict:
**LEAVE RUNNING.** The relaxed thresholds correctly identified early momentum shifts. We need to wait for a larger sample size (at least 15-20 aggressive trades) to analyze if `MODO AGRESIVO` introduces too many false positives during fakeouts before adjusting code again.

---

## 🛑 Lessons Learned (Avoiding Past Mistakes)
*Add key takeaways here as they are discovered.*

1. **Over-tuning on small data:** Adjusting filters after 1 win and 2 open trades is a mistake. Let a strategy play out so we get statistically significant data to optimize.
2. **Strictness vs. Frequency:** Too strict (v5.0 Sniper) = High Win Rate but almost no trades. Too loose = Many bad trades. `MODO AGRESIVO` is currently the balancing test.

---

## 🧪 Pending Hypotheses (Ideas to Test in Future)
- *Risk:Reward Adjustment:* If win rate drops under 50% with `MODO AGRESIVO`, consider bumping the Target/R:R from 1.5 to 1.8 to compensate, rather than tightening the entry conditions again.
- *Time-based filtering:* The system currently restricts trading during the Asia Session (Low liquidity). We need to explicitly evaluate the win-rate of trades that enter right at the open of London session vs NY session.
