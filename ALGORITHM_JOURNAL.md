# Algorithm Tuning Journal (`scheduled-analysis.js`)

This file tracks the evolution of the trading algorithm, the logic behind parameter changes, and the lessons learned from market behavior. 

**Rule:** NEVER update `scheduled-analysis.js` without first reviewing past mistakes and logging the intended change here.

---

## Current Version: v6.0.1 (Active)
**Date:** Mar 6, 2026
**Theme:** "TRANSITION HARD LOCK" (Surgical Adjustment)

### Core Logic & Parameters:
- **Runtime Version:** `v6.0.1-SelfLearn` (alinea journal, documentación y logs).
- **TRANSITION Threshold:** **75 fijo**. Ya no puede bajar por `requirementsReduction` / SOTT.
- **DOWNTREND Bounce Mode:** [Mantener] Bypass de régimen DOWNTREND si BTC RSI4H < 35 (Capitulación) + BTC-SEM GREEN + RSI15m < 45. Score requerido: 82.
- **Dynamic BB% in TRENDING:** [Mantener] Límite de overextension sube a **0.90** si `SOTT > 0.5` en tendencia alcista 4H.

### Hypothesis / Goal:
La auditoría del 6-Mar detectó que `TRANSITION` seguía siendo más laxo de lo documentado: el código aplicaba `75 - requirementsReduction`, permitiendo entradas efectivas en 70-71 cuando SOTT era favorable. Esto reabrió exactamente el patrón que v5.4 intentaba cerrar: fake breakouts en mercado choppy / de transición. v6.0.1 endurece el gate para que **75 sea un suelo real**, no solo documental.

### Bugs Found:
- **Threshold drift oculto:** `TRANSITION` figuraba como 75 en el journal/documentación, pero el código lo relajaba implícitamente a 70 o 65 mediante `requirementsReduction`.
- **Desalineación de versión:** el runtime/logs ya corrían `v6.0-SelfLearn`, mientras el journal seguía declarando `v5.4` como versión activa.

---

## Past Versions (Audit History)

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

---

## 🧪 Pending Hypotheses (Ideas to Test in Future)

- **~~Risk:Reward Adjustment~~:** ~~Si win rate cae bajo 50% con MODO AGRESIVO, considera subir el Target/R:R de 1.5 a 1.8.~~ **RESUELTO en v5.2a:** El gate de R:R mínimo 1.5 ya garantiza este mínimo usando el R:R real de ATR. Si el mercado no ofrece R:R ≥ 1.5, simplemente no se emite la señal.
- **Time-based filtering:** El sistema restringe el trading durante la sesión Asia (baja liquidez). Hay que evaluar explícitamente el WR de trades que entran en la apertura London vs. NY. El único trade perdedor (TRXUSDT) parece haberse gestado antes de London.
- **DOWNTREND Bounce Mode [NUEVA — Feb 24]:** Cuando BTC-SEM=GREEN y el mercado está en oversold extremo (RSI4H BTC < 35), permitir entradas de rebote con umbral elevado (score > 80) + RSI15m < 45 (no sobreextendido) + estructura confirmada (MSS o Sweep). El 23-Feb a las ~17:15 UTC, ETH/DOT/BTC tenían score ~70, estructura OK y BTC verde, pero fueron rechazados por DOWNTREND. Este patrón de rebote merece ser capturado con controles de seguridad.
- **TRANSITION Hard Lock Validation [NUEVA — Mar 6]:** Monitorizar los próximos near-misses resueltos de score 71-74 en `TRANSITION`. Si el shadow trading demuestra que la mayoría de esos rechazos vuelven a ser `WOULD_WIN`, habrá que refinar por contexto (BTC/session/structure), no relajar de nuevo el umbral global.
