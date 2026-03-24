# 🦅 Documentación del Algoritmo de Trading (v7.4.1 Spot Regime Scalper)

Esta documentación sirve como guía técnica para entender, mantener y optimizar el sistema de señales de trading de contado (Spot-Only) alojado en Netlify Functions.

> ⚠️ **Regla de mantenimiento:** Cualquier cambio en `scheduled-analysis.js` debe reflejarse en este documento Y en `ALGORITHM_JOURNAL.md` antes de considerarse completo.

---

## 1. Arquitectura del Sistema

El bot opera como un ecosistema serverless interconectado con capacidades de auto-aprendizaje:

- **Netlify Functions:**
  - `scheduled-analysis`: Ejecuta el análisis cada **15 minutos** (cron job). Core del sistema.
  - `auto-digest`: Ejecuta un análisis de rendimiento, autopsias y shadow trading cada día a las **09:00 UTC**.
  - `telegram-bot`: Gestiona comandos interactivos, alertas manuales y diagnósticos bajo demanda.
- **MEXC API**: Fuente de datos en tiempo real (Klines OHLCV y Order Book).
- **Netlify Blobs**: Almacena de manera persistente `history.json`, `shadow_trades.json` (activo), `shadow_trades_archive.json` (histórico), `signal_memory.json`, `autopsies.json`, cooldowns y run-lock.
- **Telegram API**: Interfaz bidireccional para alertas e informes de rendimiento y diagnósticos.

---

## 2. Sistema de Scoring

El puntaje final (0–100) utiliza pesos fijos y una validación binaria final (Pasa / No Pasa).

| Categoría | Peso | Indicadores |
|-----------|------|-------------|
| **Momentum** | 25% | **Mystic Pulse V2.0 (ADX Streak EMA)**, RSI 14, StochRSI, MACD (histograma) |
| **Trend** | 30% | SuperTrend, EMA alignment (9/21/50), ADX, SOTT |
| **Structure** | 25% | Order Blocks (OB), Fair Value Gaps (FVG), BB%, MSS, Sweep |
| **Volume** | 15% | Volume ratio vs SMA20, Delta (taker flow), OBI |
| **Patterns** | 5% | Candlestick patterns, divergencias RSI |
| **Alpha (RS)** | Bonus | **Relative Strength vs BTC** (Desacoplamiento) |

### Bonus de Score
- SOTT value > 0.5 → **+5 pts**
- SOTT signal > 0.2 → **+5 pts**
- 3+ categorías fuertes (>60) → **+3 pts** | 4+ → **+5 pts**

### 🧠 Ajuste de Momentum (Self-Learning v6.0)
El sistema sigue rastreando los scores de un símbolo en los últimos ciclos (`Signal Memory`), pero desde `v7.3.0` el ajuste quedó **desactivado en runtime**:
- **Momentum Alcista Sano:** se sigue midiendo y persistiendo, pero el bonus live está neutralizado a `0`.
- **Spike Sospechoso:** se sigue midiendo y persistiendo, pero la penalización live está neutralizada a `0`.
- **Objetivo actual:** conservar trazabilidad para auditoría sin contaminar entradas live con una señal estadísticamente débil.

### 🚀 Alpha & Relative Strength (v7.0)
El bot mide cuánto se desvía un token del rendimiento de BTC en ventanas de 4h y 1h.
- **Outperforming BTC (>2.0%):** **+8 pts** al Score final.
- **Outperforming BTC (>1.0%):** **+4 pts** al Score final.
- **Alpha Signal:** Si un token tiene RS positiva fuerte, el bot **suaviza los umbrales de BTC-SEM** y regímenes, permitiendo operar activos desacoplados en mercados bajistas.

---

## 3. Modos de Operación

### 💎 MODO SNIPER
- **Requisitos:** Score ≥ 88 + Trend 4H BULLISH + Alineación MTF Total (15m/1h/4h) + Volumen > 1.5x
- **Filosofía:** "Solo disparar cuando el blanco está perfectamente quieto."

### ⚡ MODO AGRESIVO
- **Requisitos:** Score ≥ umbral de régimen (ver tabla) + OBI/Delta favorables
- **Permite:** Trend 4H Neutral con RSI < 70 y BB% < 0.88

---

## 4. Regímenes de Mercado y Umbrales (v7.4.1 — activo)

| Régimen | Score Mínimo Live | Estrategia | Size Sugerido |
|---------|-------------------|------------|---------------|
| **RANGING** | 60 | Mean reversion long-only; comprar barato con estructura | 1.5% – 5.0% |
| **TRENDING** | 65 | Pullback continuation; Alpha puede bajar a 60 | 2.5% – 7.0% |
| **HIGH_VOLATILITY** | 70 | Breakout ultra-estricto con estructura y volumen fuerte | 1.0% – 4.0% |
| **TRANSITION** | **Shadow-only** | No se opera live; se monitoriza edge real con `REGIME_SHADOW_ONLY` | 0% live |
| **DOWNTREND** | **55–75 + subset gate** | Rebote spot long-only solo si `BTC GREEN` + `MSS/Sweep` + `bbPercent <= 0` + volumen categórico `>= 50` | 0.5% – 2.0% *(subset)* |

> **Nota v7.4.1:** El motor sigue orientado a spot long-only para scalping/day trading. `TRANSITION` permanece completamente en `shadow-only`. `DOWNTREND` solo puede volver a live en un micro-subset auditado; el resto del régimen sigue en cuarentena.

---

## 5. Gestión de Riesgo

### SL/TP Adaptativo por Régimen (parámetros del motor)

| Régimen | SL (×ATR) | TP (×ATR) | R:R Real |
|---------|-----------|-----------|----------|
| **TRENDING** | 2.2× | 4.5× | **2.05:1** |
| **RANGING** | 1.8× | 3.0× | **1.67:1** |
| **HIGH_VOL** | 1.0× | 2.5× | **2.50:1** |
| **DOWNTREND** | 1.8× | 3.8× | **2.11:1** *(subset live auditado)* |
| **TRANSITION** | 1.6× | 3.2× | **2.00:1** *(shadow-only)* |

> **FIX v5.2a — R:R Real Gate:** Se añadió un gate pre-emisión que calcula el R:R real (TP_mult / SL_mult) y rechaza cualquier señal con R:R < 1.5. El `entryMetrics.riskRewardRatio` ahora refleja el R:R real, no un valor teórico fijo.

### Protecciones Activas
- **Stale Exit:** Cierre automático a las 12h si el movimiento favorable acumulado es < 0.3%.
- **Auto-Expiración:** Trades abiertos más de 48h se marcan como EXPIRED.
- **Cooldown:** 4 horas entre señales del mismo par (configurable con `ALERT_COOLDOWN_MIN`).
- **Break-Even:** ❌ **ELIMINADO en v5.2** — los trades cierran solo en TP (WIN) o SL (LOSS).
- **BTC-SEM Filter (v7.0 Decoupled):**
  - **RED** → Score $\geq$ 88. Pero si el token tiene **Alpha fuerte (RS)**, el umbral baja a **78**.
  - **AMBER** → Score $\geq$ 75. Pero si el token tiene **Alpha**, el umbral baja a **68**.
  - **GREEN** → Umbral normal por régimen.

---

## 5.5. Módulos de Self-Learning (v6.0)

El bot no solo emite señales, sino que **aprende** monitoreando continuamente su desempeño:

### 1. Shadow Trading (Paper Trading Fantasma)
Si una señal logra un score $\geq$ 50 pero es rechazada en la fase final (por un filtro de BTC, score menor al umbral de régimen, o falta de categorías fuertes), se guarda como un *near-miss* (casi acierto). En análisis posteriores, el bot rastrea qué hubiera pasado (WOULD_WIN o WOULD_LOSE) para decirnos qué filtros nos están quitando trades ganadores.

- **Shadow Activo:** mantiene solo near-misses `PENDING` en una ventana reciente y ligera para evaluación operativa del runtime.
- **Shadow Histórico (v6.0.2):** cada near-miss resuelto o expirado se archiva de forma permanente en un store separado.
- **Benchmark Persistido (v6.0.3):** cada near-miss guarda el benchmark con el que fue evaluado.
- **Resolución Hifi (v7.0):** El bot ya no usa "checkpoints" de precio fijos. Ahora descarga el historial de velas de 15m para simular el path exacto del precio y resolver TP/SL con precisión real de exchange.
- **Saneamiento v7.4.1:** al archivarse, los near-misses resueltos/expirados se purgan del shadow activo para evitar solape con `shadow_trades_archive.json`.

### 2. Signal Memory (Momentum Cross-Cycle)
El algoritmo rompe la limitación de la falta de estado (statelessness). Guarda los puntajes de los activos ciclo tras ciclo. En el momento de calificar, lee este historial y registra el ajuste de momentum potencial, aunque desde `v7.3.0` su impacto live está neutralizado a `0`.

- **Trazabilidad v6.0.3:** `scoreBeforeMomentum` y `momentumAdjustment` se persisten en señales, near-misses y autopsias para medir el edge real del self-learning.

### 3. Post-Trade Autopsy
Al cerrar un trade (ya sea en WIN, LOSS o STALE_EXIT), el sistema guarda instantáneamente una radiografía completa: duración en horas (hoursOpen), movimiento favorable máximo (maxFavorable), score original, régimen en el que estaba vs régimen en el que cerró. 

### 4. Auto-Digest
Una Netlify function (`auto-digest.js`) corre diariamente a las 09:00 UTC. Analiza el historial, las autopsias, la memoria y el shadow trading. Envia un reporte de diagnóstico por Telegram con los WR por régimen, el costo de los filtros restrictivos y sugerencias adaptativas automáticas (ej. "Baja el score en TRENDING 3 puntos").

---

## 6. Filtros de Entrada (Pipeline Completo)

El orden de evaluación para cada señal es:

```
1. Sesión Asia (00-07 UTC)      → REJECT si AVOID_ASIA_SESSION=true
2. Volume DEAD (ratio < 0.3)    → REJECT siempre
3. bbPercent > 0.85 general, 0.82 en `TRANSITION`, 0.65 en `TRENDING` → REJECT estricto
4. Dist EMA21 > 1.8%            → REJECT (precio demasiado lejos para comprar)
5. Dist EMA9 > 2.0% (!breakout) → REJECT (chasing filter)
6. BTC-SEM RED y score < 88     → REJECT
7. BTC-SEM AMBER y score < 70-78→ REJECT
8. Volume DEAD global (< 0.3)   → REJECT
9. HIGH_VOLATILITY: score < 90 + sin estructura + vol < 1.5x → REJECT
10. TRENDING: sin pullback ni estructura → REJECT
11. RANGING: BB% > 0.75 (BUY) o sin MSS/Sweep (score < 85) → REJECT
12. `TRANSITION`: BB% > 0.82 (BUY) → REJECT
13. `TRANSITION`: si pasa el pipeline, se guarda como `REGIME_SHADOW_ONLY`
14. `DOWNTREND`: solo puede emitirse live si `BTC GREEN` + `MSS/Sweep` + `bbPercent <= 0` + score de volumen `>= 50`; si no, `REGIME_SHADOW_ONLY`
15. Score < MIN_QUALITY_SCORE por régimen → REJECT
16. Score < 80 sin confirmación visual → REJECT
17. Strong Categories < mínimo por régimen → REJECT
18. R:R real < 1.5 → REJECT [FIX v5.2a]
19. Correlación sectorial protegida → REJECT operativo + shadow `SECTOR_CORRELATION`
```

> **Nota v6.0.3:** solo los sectores taxonomizados (`L1`, `DEFI`, `AI`, etc.) activan el filtro de correlación. `OTHER` deja de actuar como pseudo-sector global.

---

## 7. Configuración (Variables de Entorno)

```bash
MAX_SYMBOLS=50                # Top 50 monedas por Opportunity Score
ALERT_COOLDOWN_MIN=240        # 4 horas entre señales del mismo par
AVOID_ASIA_SESSION=true       # Bloquear 00:00-07:00 UTC
MIN_QUOTE_VOL_24H=3000000     # Volumen 24h mínimo en USDT
SIGNAL_SCORE_THRESHOLD=65     # Threshold base (sobrescrito por umbral de régimen)
MAX_SPREAD_BPS=8              # Spread máximo permitido
MIN_DEPTH_QUOTE=75000         # Profundidad mínima del order book
```

---

## 8. Comandos de Telegram (Panel de Control)

Solo disponibles para el ADMIN configurado:

| Comando | Función |
|---------|---------|
| `/informe` | Resumen de rendimiento tradicional |
| `/scan` | Fuerza ejecución inmediata del scanner |
| `/diagnostico` | **(NUEVO v6.0)** Fuerza la recolección y envío del reporte completo de self-learning |
| `/cooldowns` | Lista pares bloqueados y tiempo restante |
| `/reset_cooldowns` | Elimina todos los bloqueos temporales |
| `/settings` | Muestra configuración técnica activa y sub-módulos activados |
| `/limpiar` | Borra el historial almacenado |
| `/help` | Lista completa de comandos |

---

---

## 8.5. Herramientas de Desarrollo y Diagnóstico Local

Para facilitar las pruebas y el mantenimiento sin depender exclusivamente de los ciclos de 15 minutos de Netlify, se han implementado herramientas locales:

| Comando | Script | Propósito |
|---------|--------|-----------|
| `npm run sync` | `sync-blobs.js` | Descarga los archivos JSON (history, shadow, logs, etc.) desde Netlify Blobs a local. |
| `npm run scan` | `manual-run.js` | Ejecuta el runtime actual localmente usando los datos más recientes de la API de MEXC. Útil para verificar señales en tiempo real. |

> 💡 **Tip:** Usa `npm run sync` antes de una auditoría para asegurarte de que tus archivos locales coinciden con la realidad de producción.

---

## 9. Historial de Versiones (Changelog)

### v7.4.1 — Downtrend Subset Re-Entry (Mar 24, 2026) - ACTUAL
- **Reapertura quirúrgica:** `DOWNTREND` deja de ser un bloqueo absoluto. Solo vuelve a live un subset muy estrecho: `BTC GREEN` + estructura confirmada (`MSS/Sweep`) + compra barata (`bbPercent <= 0`) + soporte real de volumen (`categoryScores.volume >= 50`).
- **TRANSITION sigue cerrado:** el régimen permanece en `shadow-only` sin cambios por falta de edge suficiente.
- **Shadow activo saneado:** los near-misses resueltos/expirados se archivan y se purgan del store activo para que `shadow_trades.json` vuelva a representar solo la ventana pendiente reciente.
- **Objetivo:** recuperar edge live desde el único subset con respaldo histórico sin volver a abrir el régimen bajista completo ni contaminar las métricas de self-learning.

### v7.4.0 — Spot Regime Scalper (Mar 20, 2026)
- **Scope live reorientado:** `TRANSITION` y `DOWNTREND` salen de producción live y pasan a `shadow-only` para proteger el estilo `spot` long-only frente a compras de baja calidad estructural.
- **Nuevo rechazo trazable:** Los setups válidos que pertenecen a esos regímenes se persisten como near-misses `REGIME_SHADOW_ONLY (...)`, permitiendo seguir midiendo si realmente había edge sin asumir riesgo real.
- **Bug fix crítico:** El runtime deja de referenciar `hasMSS` / `hasSweep` fuera de scope y usa la estructura detectada (`mss` / `sweep`), eliminando una fuente de errores operativos en producción.
- **Capitulation más estricta:** La observación de rebotes se estrecha a contexto más extremo: `BTC RSI4H < 35`, `RSI15m < 45` y estructura confirmada.

### v7.3.0 — Capitulation & Trend Discipline (Mar 18, 2026)
- **Trend BB% Hard Limit:** En régimen `TRENDING`, el límite máximo permitido de las Bandas de Bollinger se aprieta dramáticamente de 0.85 a **0.65**. Suprime compras sobre-extendidas para mitigar masivamente los *fake-breakouts* detectados (19% WR). 
- **Green Capitulation:** Los umbrales mínimos de `DOWNTREND` se deprimen a 55-60 cuando BTC-SEM es GREEN, incrementando las oportunidades de los rebotes sobrevendidos (históricamente el régimen más rentable, 55% WR).
- **Momentum Deprecation:** El ajuste predictivo transversal transversal `+3/-5` (Signal Memory) se neutralizó a 0, puesto que estadísticamente agregaba ruido sin ganancia real.

### v7.2.0 — Mystic Pulse & Strict Momentum (Mar 14, 2026)
- **Mystic Pulse V2.0:** Se instaura un disparador de momentum contundente utilizando las racas direccionales del ADX suavizadas por EMA, filtrando los spikes de RSI como drivers principales de las compras.
- **BB% Hard Limits Globales:** Se erradica por completo la asunción de "breakout seguro" en topes de la banda. El bot ahora corta estrictamente de tajo cualquier compra que ocurra en el 85% superior general, o 82% superior dentro de TRANSITION. El falso breakout ahora es rechazado sin excepción.
- **Limpieza Estructural:** Mystic Pulse pasa a dictaminar en la categoría Momentum, dándole prioridad direccional al impulso prolongado sobre explosiones que atrapaban en los local-tops.

### v7.1.0 — Capitulation Scalping (Mar 11, 2026)
- **Capitulation Bounce Mode:** Cuando BTC es GREEN pero el RSI 4h de BTC < 40, se desbloquean los umbrales mínimos a niveles ultra-agresivos (55-60) siempre que el token muestre MSS o Sweep.
- **Relajación de Baseline:** Revertido el freno de los \`75 puntos\` en \`TRANSITION\`. Retorna a un baseline de 65, habiendo auditado que los trades de bajo score perdidos registraban WR histórico masivo.
- **Resolución de Late Entries:** La corrección relaja thresholds generales para no ser forzado a comprar cuando la moneda ya completó gran parte de la correción al alza.

### v7.0 — Alpha Generation (Mar 10, 2026)
- **Relative Strength (RS) Index:** Nuevo cálculo de fuerza relativa vs BTC incorporado en el scoring.
- **Decoupled BTC Filters:** Los umbrales de BTC RED/AMBER ahora son dinámicos. Los activos que demuestran "Alpha" (desacoplamiento) pueden emitir señales en mercados bajistas con umbrales reducidos.
- **Hifi Shadow Engine:** Resolución de shadow trades mediante análisis de historial de velas de 15m (simulación de path real).
- **Ajuste de Throughput:** Relajación de umbrales estáticos en todos los regímenes para aumentar la frecuencia de señales de alta calidad.
- **Smart Selection v7.0:** El scanner de activos ahora prioriza tokens por RS24h sobre el volumen bruto.

### v6.0.3 — Audit Traceability (Mar 09, 2026)
- **Sector gate refinado:** `OTHER` deja de bloquear señales por correlación; solo se protegen sectores clasificados explícitamente.
- **Shadow de correlación:** las señales válidas bloqueadas por sector se guardan como near-misses `SECTOR_CORRELATION`.
- **Benchmark shadow explícito:** cada entrada shadow persiste benchmark, flags `wouldHaveTP` / `wouldHaveSL` y `resolvedAt`.
- **Momentum medible:** `scoreBeforeMomentum` y `momentumAdjustment` quedan guardados en history, shadow y autopsies.

### v6.0.2 — Shadow Archive (Mar 07, 2026)
- **Nuevo store histórico:** se añade un archivo persistente separado para near-misses resueltos/expirados (`shadow archive`).
- **Objetivo:** mantener el `shadow` activo liviano para operación, pero conservar histórico completo para auditoría, comparación de versiones y validación de hipótesis.
- **Migración runtime:** cualquier near-miss resuelto existente y no archivado se copia al histórico en ciclos posteriores.

### v6.0.1 — Transition Hard Lock (Mar 06, 2026)
- **TRANSITION Threshold:** Se convierte en **suelo duro de 75**. `requirementsReduction` / SOTT ya no pueden rebajar el umbral efectivo.
- **Bug corregido:** La documentación indicaba 75, pero el runtime todavía permitía entradas efectivas de 70-71 en `TRANSITION`.
- **Objetivo:** Cortar fake breakouts tardíos en mercado de transición sin tocar TP/SL ni relajar otros filtros.

### v6.0 — The Self-Learning Upgrade (Mar 01, 2026)
- **4 Módulos de Aprendizaje Añadidos:** Shadow Trading, Signal Memory, Post-Trade Autopsy, y Auto-Digest.
- **Objetivo:** Superar el over-tuning observacional y la naturaleza sin memoria (statelessness) entre ciclos de 15 minutos.
- **Telegram:** Comando `/diagnostico` añadido para análisis on-demand de métricas fantasmas.
- **Modificación de Arquitectura:** Integración de cron separada a las 09:00 UTC para digerir datos en Netlify.

### v5.4 — Quality over Frequency (Feb 28, 2026)
- **TRANSITION Threshold:** Revertido a **75** (desde 70).
- **Justificación:** Los trades con score < 75 en este régimen mostraron un 0% WR (Trampas de liquidez).

### v5.3 — Performance Tuning (Feb 25, 2026)
- **TRANSITION Threshold:** Reducido a **70** (desde 72). FALLIDO — Demasiado laxo.
- **DOWNTREND Bounce Logic:** Permitir rebotes si BTC RSI4H < 35 y BTC-SEM es GREEN.
- **Dynamic BB%:** Límite de overextension sube a **0.90** en TRENDING BULLISH si SOTT > 0.5.

### v5.2a — Surgical Fixes (Feb 24, 2026)
- **FIX #1 — BB% Hard Filter TRANSITION:** Añadido gate explícito: `bbPercent > 0.92 en TRANSITION → REJECT`. Path de MSS/Sweep bypaseaba el filtro general de overextension. Causa raíz del LOSS en TRXUSDT (bbPercent=1.01).
- **FIX #2 — R:R Real Gate:** El R:R se calculaba como un valor teórico fijo (e.g. 2.5/1.8). Ahora se calcula con los multiplicadores ATR reales y se rechaza si R:R < 1.5. `entryMetrics.riskRewardRatio` ahora es el R:R real.
- **Sin cambios en umbrales de score** — los umbrales de v5.2 funcionaron correctamente en mercado bajista.

### v5.2 — REVERT & REFINE (Feb 22, 2026)
- **Eliminación Break-Even:** Trades solo cierran en TP (WIN) o SL (LOSS). BE paradójicamente cortaba trades ganadores.
- **Umbrales restaurados/endurecidos:** TRANSITION: 72, TRENDING: 75, RANGING: 68.
- **Downtrend logic endurecida:** Score > 82 + confluencia extrema requeridos.
- **Performance:** 0% WR (1 trade, muestra sin validez estadística). Supersedida por v5.2a.

### v5.1 — Structure Sensitivity Boost + Aggressive Mode (Feb 2026)
- **MSS Ultra-Sensible:** Swing points reducidos de 5 a 3 velas (Fractal mode).
- **Ventana de Break Ampliada:** Detección de MSS en últimas 5 velas (antes 3).
- **Umbrales agresivos:** TRANSITION: 65, TRENDING: 70, RANGING: 60.
- **Performance:** 17.6% WR (3W / 8L / 5BE). Retirado — demasiado laxo en TRANSITION.

### v5.0 — Signs of the Times (Feb 2026)
- **Integración SOTT:** Framework LucF para medir convicción de tendencia.
- **Bonus de Confirmación:** +20 pts al Score de Tendencia si SOTT alineado.
- **Filtro de Debilidad:** Alerta si SOTT cae bajo -0.2 en tendencia alcista.

### v4.9 — Smart Downtrend Pullback Unlock (Ene 2026)
- **Modo Pullback Inteligente:** Opera en DOWNTREND (15m) si Trend 4H es BULLISH.
- **Requisito estructural:** MSS o Sweep obligatorio + score > 85.

### v4.8 — Sunday Mode / Low Volatility Fix (Ene 2026)
- **Volumen bajo:** Reemplaza rechazo duro (<0.8x) por penalización de score (-10).
- **Suelo absoluto:** Rechazo solo si volumen < 0.3x del promedio.

### v4.7 — Bull Run Unlock (Ene 2026)
- **Filtro de sobreextensión inteligente:** Permite RSI>70 + BB Breakout si Trend 4H es BULLISH.

### v4.5 — Expert Edition (Dic 2025)
- **Validación OBI/Delta binaria:** Capa Pasa/No Pasa.
- **Sniper 2.0:** Alineación MTF Total (15m+1h+4h) obligatoria. Volumen > 1.5x.

---

**Documentación actualizada a v7.2.0 — 14 Marzo 2026**
