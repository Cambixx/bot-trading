# Algorithm Tuning Journal (`scheduled-analysis.js`)

This file tracks the evolution of the trading algorithm, the logic behind parameter changes, and the lessons learned from market behavior. 

**Rule:** NEVER update `scheduled-analysis.js` without first reviewing past mistakes and logging the intended change here.

---

## Current Version: v7.2.0 (Active)
**Date:** Mar 14, 2026
**Theme:** "MYSTIC PULSE & STRICT MOMENTUM" (Anti-Knife Catching)

### Core Logic & Parameters:
- **Runtime Version:** `v7.2.0-SelfLearn`.
- **Mystic Pulse V2.0:** Se reemplaza el RSI y BB% como disparadores primarios de momentum por un oscilador de INERCIA direccional basado en racha (streak) del ADX (+DI vs -DI) suavizado con EMA. Otorga 40 puntos de momentum al cruzar o tener un spread contundente.
- **Strict BB% Cutoff:** Se eliminan los bypass de breakout. Si una operación se trata de ejecutar con `bbPercent > 0.85` (o `> 0.82` en TRANSITION), es rechazada automáticamente de forma incondicional.

### Hypothesis / Goal:
La auditoría de métricas evidenció que el Win Rate real era de <30%. La vasta mayoría de trades se iniciaban persiguiendo "velas extendidas" muy cerca de la banda Bollinger superior sin inercia real (fake breakouts). Al introducir Mystic Pulse exigimos inercia direccional sostenida, y al poner techos duros en las Bandas de Bollinger, prevenimos directamente las compras en techos locales. Esperamos que el WR repunte dramáticamente por encima del 55-60%, a coste de una drástica reducción en la frecuencia de operaciones.

### Verdict (v7.2.0 Audit — Mar 17, 2026):
**MANTENER.** La configuración v7.2.0 está logrando exactamente lo pretendido. 
- **WR Real:** 61.5% (16W / 10L).
- El tiempo promedio en trades ganadores (7.9h) vs perdedores (3.9h) muestra que las purgas son rápidas y los ganadores corren.
- El "Shadow Trading" reciente (últimos 100 ciclos en mercado tóxico/AMBER) muestra solo un 26% de WR si se hubieran ignorado los filtros, comprobando que el algoritmo nos ahorró múltiples pérdidas por "Knife Catching". El sistema no necesita ajustes por ahora.

---

## Past Versions (Audit History)

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

---

## 🧪 Pending Hypotheses (Ideas to Test in Future)

- **~~Risk:Reward Adjustment~~:** ~~Si win rate cae bajo 50% con MODO AGRESIVO, considera subir el Target/R:R de 1.5 a 1.8.~~ **RESUELTO en v5.2a:** El gate de R:R mínimo 1.5 ya garantiza este mínimo usando el R:R real de ATR. Si el mercado no ofrece R:R ≥ 1.5, simplemente no se emite la señal.
- **Time-based filtering:** El sistema restringe el trading durante la sesión Asia (baja liquidez). Hay que evaluar explícitamente el WR de trades que entran en la apertura London vs. NY. El único trade perdedor (TRXUSDT) parece haberse gestado antes de London.
- **DOWNTREND Bounce Mode [NUEVA — Feb 24]:** Cuando BTC-SEM=GREEN y el mercado está en oversold extremo (RSI4H BTC < 35), permitir entradas de rebote con umbral elevado (score > 80) + RSI15m < 45 (no sobreextendido) + estructura confirmada (MSS o Sweep). El 23-Feb a las ~17:15 UTC, ETH/DOT/BTC tenían score ~70, estructura OK y BTC verde, pero fueron rechazados por DOWNTREND. Este patrón de rebote merece ser capturado con controles de seguridad.
- **TRANSITION Hard Lock Validation [NUEVA — Mar 6]:** Monitorizar los próximos near-misses resueltos de score 71-74 en `TRANSITION`. Si el shadow trading demuestra que la mayoría de esos rechazos vuelven a ser `WOULD_WIN`, habrá que refinar por contexto (BTC/session/structure), no relajar de nuevo el umbral global.
