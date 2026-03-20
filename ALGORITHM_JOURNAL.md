# Algorithm Tuning Journal (`scheduled-analysis.js`)

This file tracks the evolution of the trading algorithm, the logic behind parameter changes, and the lessons learned from market behavior. 

**Rule:** NEVER update `scheduled-analysis.js` without first reviewing past mistakes and logging the intended change here.

---

## Current Version: v7.4.0 (Active)
**Date:** Mar 20, 2026
**Theme:** "SPOT REGIME SCALPER"

### Core Logic & Parameters:
- **Runtime Version:** `v7.4.0-SelfLearn`.
- **Live Scope:** El runtime prioriza el estilo `spot` long-only de scalping/day trading. `RANGING` y `TRENDING` siguen operativos en live; `TRANSITION` y `DOWNTREND` pasan a modo **shadow-only** para cortar compras estructuralmente frágiles.
- **Shadow Quarantine:** Si un setup de `TRANSITION` o `DOWNTREND` supera calidad, volumen, confirmación visual, categorías fuertes y R:R, no se ejecuta en live; se registra como near-miss con rechazo `REGIME_SHADOW_ONLY (...)` para seguir midiendo edge sin pagar pérdidas reales.
- **Bug Fix Crítico:** Se corrige el uso de `hasMSS` / `hasSweep` fuera de scope dentro del bloque de capitulación. El runtime debe usar `mss` / `sweep` detectados en la señal. Este bug generó miles de errores en logs y redujo la fiabilidad operacional.
- **Capitulation Tightening:** La hipótesis de capitulación ya no se interpreta como licencia agresiva. Queda restringida a contexto más extremo (`BTC RSI4H < 35`, `RSI15m < 45`, estructura confirmada) y se observa primero vía shadow.
- **Momentum Deprecation:** Se mantiene el impacto de Signal Memory neutralizado a `0`; la métrica sigue guardándose para auditoría, pero no altera entradas.

### Hypothesis / Goal:
El objetivo es elevar el WR real cortando por completo la exposición live a los dos regímenes que acaban de mostrar `0% WR` (`TRANSITION` y `DOWNTREND`) sin perder aprendizaje. Si el shadow demuestra que un subconjunto muy concreto de esas señales vuelve a tener edge, se reintroducirá con reglas explícitas y tamaño conservador.

### Verdict (v7.4.0 Audit — Pendiente):
Pendiente de muestra nueva en producción.

---

## Past Versions (Audit History)

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

---

## 🧪 Pending Hypotheses (Ideas to Test in Future)

- **~~Risk:Reward Adjustment~~:** ~~Si win rate cae bajo 50% con MODO AGRESIVO, considera subir el Target/R:R de 1.5 a 1.8.~~ **RESUELTO en v5.2a:** El gate de R:R mínimo 1.5 ya garantiza este mínimo usando el R:R real de ATR. Si el mercado no ofrece R:R ≥ 1.5, simplemente no se emite la señal.
- **Time-based filtering:** El sistema restringe el trading durante la sesión Asia (baja liquidez). Hay que evaluar explícitamente el WR de trades que entran en la apertura London vs. NY. El único trade perdedor (TRXUSDT) parece haberse gestado antes de London.
- **DOWNTREND Bounce Mode [NUEVA — Feb 24]:** Cuando BTC-SEM=GREEN y el mercado está en oversold extremo (RSI4H BTC < 35), permitir entradas de rebote con umbral elevado (score > 80) + RSI15m < 45 (no sobreextendido) + estructura confirmada (MSS o Sweep). El 23-Feb a las ~17:15 UTC, ETH/DOT/BTC tenían score ~70, estructura OK y BTC verde, pero fueron rechazados por DOWNTREND. Este patrón de rebote merece ser capturado con controles de seguridad.
- **TRANSITION Hard Lock Validation [NUEVA — Mar 6]:** Monitorizar los próximos near-misses resueltos de score 71-74 en `TRANSITION`. Si el shadow trading demuestra que la mayoría de esos rechazos vuelven a ser `WOULD_WIN`, habrá que refinar por contexto (BTC/session/structure), no relajar de nuevo el umbral global.
- **Regime Shadow Re-Entry [NUEVA — Mar 20]:** Si los near-misses `REGIME_SHADOW_ONLY` muestran durante varias sesiones un WR > 55% en un subconjunto claro (`BTC GREEN`, estructura confirmada, RSI15m < 45 y score alto), reintroducir ese subset con tamaño reducido antes de reabrir el régimen completo.
