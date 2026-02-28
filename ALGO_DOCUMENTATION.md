# 🦅 Documentación del Algoritmo de Trading (v5.4)

Esta documentación sirve como guía técnica para entender, mantener y optimizar el sistema de señales de trading de contado (Spot-Only) alojado en Netlify Functions.

> ⚠️ **Regla de mantenimiento:** Cualquier cambio en `scheduled-analysis.js` debe reflejarse en este documento Y en `ALGORITHM_JOURNAL.md` antes de considerarse completo.

---

## 1. Arquitectura del Sistema

El bot opera como un ecosistema serverless interconectado:

- **Netlify Functions:**
  - `scheduled-analysis`: Ejecuta el análisis cada **15 minutos** (cron job). Core del sistema.
  - `telegram-bot`: Gestiona comandos interactivos y alertas manuales.
- **MEXC API**: Fuente de datos en tiempo real (Klines OHLCV y Order Book).
- **Netlify Blobs**: Almacena `history.json`, cooldowns y run-lock.
- **Telegram API**: Interfaz bidireccional para alertas e informes de rendimiento.

---

## 2. Sistema de Scoring

El puntaje final (0–100) utiliza pesos fijos y una validación binaria final (Pasa / No Pasa).

| Categoría | Peso | Indicadores |
|-----------|------|-------------|
| **Momentum** | 25% | RSI 14, StochRSI, MACD (histograma) |
| **Trend** | 30% | SuperTrend, EMA alignment (9/21/50), ADX, SOTT |
| **Structure** | 25% | Order Blocks (OB), Fair Value Gaps (FVG), BB%, MSS, Sweep |
| **Volume** | 15% | Volume ratio vs SMA20, Delta (taker flow), OBI |
| **Patterns** | 5% | Candlestick patterns, divergencias RSI |

### Bonus de Score
- SOTT value > 0.5 → **+5 pts**
- SOTT signal > 0.2 → **+5 pts**
- 3+ categorías fuertes (>60) → **+3 pts** | 4+ → **+5 pts**

---

## 3. Modos de Operación

### 💎 MODO SNIPER
- **Requisitos:** Score ≥ 88 + Trend 4H BULLISH + Alineación MTF Total (15m/1h/4h) + Volumen > 1.5x
- **Filosofía:** "Solo disparar cuando el blanco está perfectamente quieto."

### ⚡ MODO AGRESIVO
- **Requisitos:** Score ≥ umbral de régimen (ver tabla) + OBI/Delta favorables
- **Permite:** Trend 4H Neutral con RSI < 70 y BB% < 0.88

---

## 4. Regímenes de Mercado y Umbrales (v5.2a — activo)

| Régimen | Score Mínimo | Estrategia | Size Sugerido |
|---------|-------------|------------|---------------|
| **RANGING** | 68 | Mean reversion — comprar en soporte, vender en resistencia | 1.0% – 4.0% |
| **TRENDING** | 75 | Solo pullbacks a EMA21/50 — no perseguir rupturas | 1.5% – 6.0% |
| **HIGH_VOLATILITY** | 80 | Estructura obligatoria (MSS o Sweep) — size reducido | 0.8% – 3.5% |
| **TRANSITION** | 75 | Alta selectividad — Revertido a 75 tras auditoría v5.3 (FIX v5.4) | 1.0% – 4.0% |
| **DOWNTREND** | 82 | Solo bounce con score > 82 y confluencia extrema | 0.5% – 2.0% |

> **Nota v5.4:** El umbral de TRANSITION sube a 75 para filtrar falsas rupturas detectadas en la auditoría de v5.3. Se mantiene el BB% Hard Filter (>0.92 → REJECT).

---

## 5. Gestión de Riesgo

### SL/TP Adaptativo por Régimen (v5.2a — activos)

| Régimen | SL (×ATR) | TP (×ATR) | R:R Real |
|---------|-----------|-----------|----------|
| **TRENDING** | 2.2× | 4.5× | **2.05:1** |
| **RANGING** | 1.8× | 3.0× | **1.67:1** |
| **HIGH_VOL** | 1.0× | 2.5× | **2.50:1** |
| **DOWNTREND** | 1.8× | 3.8× | **2.11:1** |
| **TRANSITION** | 1.6× | 3.2× | **2.00:1** |

> **FIX v5.2a — R:R Real Gate:** Se añadió un gate pre-emisión que calcula el R:R real (TP_mult / SL_mult) y rechaza cualquier señal con R:R < 1.5. El `entryMetrics.riskRewardRatio` ahora refleja el R:R real, no un valor teórico fijo.

### Protecciones Activas
- **Stale Exit:** Cierre automático a las 12h si el movimiento favorable acumulado es < 0.3%.
- **Auto-Expiración:** Trades abiertos más de 48h se marcan como EXPIRED.
- **Cooldown:** 4 horas entre señales del mismo par (configurable con `ALERT_COOLDOWN_MIN`).
- **Break-Even:** ❌ **ELIMINADO en v5.2** — los trades cierran solo en TP (WIN) o SL (LOSS).
- **BTC-SEM Filter:**
  - RED → Score mínimo 88 para pasar
  - AMBER → Score mínimo 70-78 (dependiendo del momentum)
  - GREEN → Umbral normal por régimen

---

## 6. Filtros de Entrada (Pipeline Completo)

El orden de evaluación para cada señal es:

```
1. Sesión Asia (00-07 UTC)      → REJECT si AVOID_ASIA_SESSION=true
2. Volume DEAD (ratio < 0.3)    → REJECT siempre
3. RSI > 70 o BB% > 0.88-0.90   → REJECT (excepto isBreakout o Trending Bullish SOTT>0.5)
4. Dist EMA21 > 1.8%            → REJECT (precio demasiado lejos para comprar)
5. Dist EMA9 > 2.0% (!breakout) → REJECT (chasing filter)
6. BTC-SEM RED y score < 88     → REJECT
7. BTC-SEM AMBER y score < 70-78→ REJECT
8. Volume DEAD global (< 0.3)   → REJECT
9. HIGH_VOLATILITY: score < 90 + sin estructura + vol < 1.5x → REJECT
10. TRENDING: sin pullback ni estructura → REJECT
11. RANGING: BB% > 0.75 (BUY) o sin MSS/Sweep (score < 85) → REJECT
12. TRANSITION: BB% > 0.92 (BUY) → REJECT [FIX v5.2a]
13. DOWNTREND: Capitulation Bounce requerimientos especiales [v5.3]
14. Score < MIN_QUALITY_SCORE por régimen → REJECT
15. Score < 80 sin confirmación visual → REJECT
16. Strong Categories < mínimo por régimen → REJECT
17. R:R real < 1.5 → REJECT [FIX v5.2a]
```

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
| `/informe` | Resumen de ganancias, pérdidas y operaciones abiertas |
| `/scan` | Fuerza ejecución inmediata del scanner |
| `/cooldowns` | Lista pares bloqueados y tiempo restante |
| `/reset_cooldowns` | Elimina todos los bloqueos temporales |
| `/settings` | Muestra configuración técnica activa |
| `/limpiar` | Borra el historial almacenado |
| `/help` | Lista completa de comandos |

---

## 9. Historial de Versiones (Changelog)

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

**Documentación actualizada a v5.4 — 28 Febrero 2026**
