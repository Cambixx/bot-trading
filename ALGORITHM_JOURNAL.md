# Algorithm Tuning Journal (`scheduled-analysis.js`)

This file tracks the evolution of the trading algorithm, the logic behind parameter changes, and the lessons learned from market behavior. 

**Rule:** NEVER update `scheduled-analysis.js` without first reviewing past mistakes and logging the intended change here.

---

## Current Version: v9.1.0 (Active)
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
