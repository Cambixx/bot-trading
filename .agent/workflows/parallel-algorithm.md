---
description: Plan for creating a parallel trading algorithm independent of scheduled-analysis
---

# Parallel Strategist (CRAWLER_V1)

## 🎯 Goal
Implement a second, independent trading algorithm that complements current strategy by focusing on high-probability breakouts and institutional volume footprints.

## 🛠 Skills Integration
- `trading-signals`: Regime-weighted confluence.
- `market-regimes`: Strict "Mixed Choppy" avoid logic.
- `trading-strategies`: Turtle Breakout (Donchian).

## 📐 Algorithm Structure

1. **Donchian Breakout**: High of last 20 periods.
2. **Wyckoff Climax**: Volume spike > 300% of avg + long wick.
3. **Regime Check**: Strictly follow `market-regimes` advice.

## 🚀 Execution Steps

1. Create `netlify/functions/parallel-analysis.js`.
2. Implement signal logic based on skills.
3. Create audit script to verify logic.
