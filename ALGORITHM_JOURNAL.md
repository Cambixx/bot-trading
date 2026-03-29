# Algorithm Tuning Journal (`scheduled-analysis.js`)

This file tracks the evolution of the trading algorithm, the logic behind parameter changes, and the lessons learned from market behavior. 

**Rule:** NEVER update `scheduled-analysis.js` without first reviewing past mistakes and logging the intended change here.

---

## Current Version: v7.4.2 (Active)
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
