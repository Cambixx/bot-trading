# Algorithm Tuning Journal (`scheduled-analysis.js`)

This file tracks the evolution of the trading algorithm, the logic behind parameter changes, and the lessons learned from market behavior. 

**Rule:** NEVER update `scheduled-analysis.js` without first reviewing past mistakes and logging the intended change here.

---

## Current Version: v5.2a (Active)
**Date:** Feb 24, 2026
**Theme:** "SURGICAL FIXES" (Dos bugs de filtrado corregidos post-auditoría)

### Core Logic & Parameters:
- **Break-Even Logic:** [REMOVED] Per user request. Trades now only close at TP (WIN) or SL (LOSS).
- **Entry Filter Thresholds:** [UNCHANGED desde v5.2]
  - TRANSITION: **72**
  - TRENDING: **75**
  - RANGING: **68**
- **FIX #1 — BB% Hard Filter en TRANSITION:** [NUEVO] Si `bbPercent > 0.92` en régimen TRANSITION y señal BUY → REJECT. El path MSS/Sweep en TRANSITION bypaseaba el check general de overextension. TRXUSDT (Feb 22) entró con BB%=1.01, precio en la BB superior (resistencia).
- **FIX #2 — R:R Real Gate:** [NUEVO] El R:R en `entryMetrics` era un ratio teórico fijo. Ahora se calcula con los multiplicadores ATR reales (TP_mult / SL_mult). Se rechaza cualquier señal con R:R real < 1.5. El trade TRXUSDT tenía R:R real = 1.39.

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

---

## 🧪 Pending Hypotheses (Ideas to Test in Future)

- **~~Risk:Reward Adjustment~~:** ~~Si win rate cae bajo 50% con MODO AGRESIVO, considera subir el Target/R:R de 1.5 a 1.8.~~ **RESUELTO en v5.2a:** El gate de R:R mínimo 1.5 ya garantiza este mínimo usando el R:R real de ATR. Si el mercado no ofrece R:R ≥ 1.5, simplemente no se emite la señal.
- **Time-based filtering:** El sistema restringe el trading durante la sesión Asia (baja liquidez). Hay que evaluar explícitamente el WR de trades que entran en la apertura London vs. NY. El único trade perdedor (TRXUSDT) parece haberse gestado antes de London.
- **DOWNTREND Bounce Mode [NUEVA — Feb 24]:** Cuando BTC-SEM=GREEN y el mercado está en oversold extremo (RSI4H BTC < 35), permitir entradas de rebote con umbral elevado (score > 80) + RSI15m < 45 (no sobreextendido) + estructura confirmada (MSS o Sweep). El 23-Feb a las ~17:15 UTC, ETH/DOT/BTC tenían score ~70, estructura OK y BTC verde, pero fueron rechazados por DOWNTREND. Este patrón de rebote merece ser capturado con controles de seguridad.
