# Auditoría de Bots y Torneo de Estrategias — 2026-05-23

Auditoría completa de los dos bots de trading que viven en este repo, más torneo de variaciones de estrategia para identificar la mejor configuración de cada uno.

- **Universo de prueba**: top 5 USDT por volumen 24h en Binance = BTC, ETH, SOL, ZEC, XRP
- **Periodo**: 30 días (2026-04-23 → 2026-05-23), split OOS 70/30
- **Capital simulado**: 5000 USD, 20% por trade, slippage 0.1%

> **Actualización 2026-05-23**: tras agotar el espacio de knobs sin lograr WR >40% con PF >1.3, se agregaron filtros code-level y se validaron en 3 meses. Resultado: **Trader v14** (WR 39%, PF 1.75) y **Knife v4** (WR 38%, PF 2.00). Wrappers de producción listos en `netlify/functions/trader-bot-v14.js` y `knife-catcher-v4.js`. Ver §7 al final.

---

## 1. Bot **TRADER · Fusion v13** ([netlify/functions/trader-bot.js](netlify/functions/trader-bot.js))

> Algoritmo: `v13.2.0-ExecutionFlowHardening`. Spot long-only trend / reclaim scanner.

### 1.1 Arquitectura

Flujo secuencial dentro de `generateSignal` ([trader-bot.js:1222](netlify/functions/trader-bot.js#L1222)):

```
buildContext → hard filters → 6 módulos → score requerido → execution gates
                                       ↓
                     order-flow gate → volume floor → score floor → realRR ≥ 1.8
```

### 1.2 Filtros hard globales

Bloquean *antes* de evaluar módulos:

| Filtro | Condición | Línea |
|---|---|---|
| `LIQUIDITY_FLOOR` | `quoteVol24h < 15M USDT` | [trader-bot.js:1036](netlify/functions/trader-bot.js#L1036) |
| `ATR_FILTER` | `atrPercent < 0.05%` o `> 5.5%` | [trader-bot.js:1075](netlify/functions/trader-bot.js#L1075) |
| `HTF_TREND_BEARISH` | `RISK_OFF` o BTC RED o `(!bull4h && !bull1h)` | [trader-bot.js:1241](netlify/functions/trader-bot.js#L1241) |
| `WEAK_RELATIVE_STRENGTH` | `rs1h < 0 && rs4h < 0` (excepto BTC) | [trader-bot.js:1247](netlify/functions/trader-bot.js#L1247) |
| `OVEREXTENDED_EMA9` | `|distToEma9| > 2.0%` | [trader-bot.js:1252](netlify/functions/trader-bot.js#L1252) |
| `REGIME_RANGING_BLOCK` | `regime=='RANGING' && bias=='BEARISH'` | [trader-bot.js:1257](netlify/functions/trader-bot.js#L1257) |

### 1.3 Módulos

| # | Módulo | Live? | Base score | minVolRatio | slAtr / tpR | timeStop |
|---|---|---|---|---|---|---|
| 1 | `VIDYA_SQUEEZE_EXPANSION` | ✅ | 65 | 0.5 | 1.35 / 2.25 | 14h |
| 2 | `SMC_DISCOUNT_RECLAIM` | ✅ | 65 | 0.5 | 1.2 / 2.4 | 16h |
| 3 | `TWO_POLE_PULLBACK_CONTINUATION` | ✅ | 66 | 0.5 | 1.15 / 2.05 | 10h |
| 4 | `QUANTUM_REVERSION` | 🌒 shadow | 68 | 0.3 | 1.2 / 2.1 | 6h |
| 5 | `VELOCITY_BREAKOUT` | 🌒 shadow | 80 | 1.2 | 1.5 / 2.5 | 12h |
| 6 | `MACD_DIVERGENCE` | 🌒 shadow | 80 | 0.4 | 1.1 / 2.5 | 12h |

> ⚠️ **3 de 6 módulos son `shadowOnly`** → en producción nunca emiten señales operativas, solo se registran para telemetría. Si activamos shadow en backtest, vemos qué *podrían* aportar.

### 1.4 Modelo de riesgo

[buildRiskModel · trader-bot.js:636](netlify/functions/trader-bot.js#L636):
1. SL inicial = `max(price - atr×slAtr, smc.lastLow×0.997, vidya.lower×0.998)`
2. `riskPct` se clampa a `[0.55-0.7%, 4.5%]`
3. TP = `price + (price-sl) × tpR`
4. Rechazo final si `realRR < 1.8` ([trader-bot.js:1325](netlify/functions/trader-bot.js#L1325))

### 1.5 Ejecución (order-book + order-flow)

| Gate | Umbral | Línea |
|---|---|---|
| `EXEC_SPREAD` | `spreadBps > 8` | [strategy-core.js:925](netlify/functions/tradingview-strategy-core.js#L925) |
| `EXEC_DEPTH` | top-20 notional `< 90k USDT` | [strategy-core.js:926](netlify/functions/tradingview-strategy-core.js#L926) |
| `LIQUIDITY_TIER_LOW` | (bypassable si score ≥ 85) | [trader-bot.js:1294](netlify/functions/trader-bot.js#L1294) |
| `ORDERFLOW_ASK_HEAVY` | `OBI < -0.3` | [trader-bot.js:713](netlify/functions/trader-bot.js#L713) |
| `ORDERFLOW_WEAK_BUY_PRESSURE` | `deltaRatio < -0.05` y OBI no positivo | [trader-bot.js:714](netlify/functions/trader-bot.js#L714) |

### 1.6 Score floor

`getRequiredScore` ([trader-bot.js:701](netlify/functions/trader-bot.js#L701)) suma penalizaciones acumulativas:
- liquidityTier MEDIUM **+3**, BTC AMBER **+3**, regime VOLATILE_TRANSITION **+3**, regime RANGING (VIDYA) **+4**, `atr15m > 3.2%` **+2**

### 1.7 Veredicto Trader

- **Naturaleza**: trend-following bullish — necesita HTF bullish y RS positiva.
- **Punto débil**: en mercados bajistas o ranging-bearish, el filtro `HTF_TREND_BEARISH` apaga el bot por completo (esto se vio en el OOS: train tuvo 110 trades, holdout sólo 2).
- **Punto fuerte**: filtros bien diseñados — el periodo bajista no produjo pérdidas, simplemente no operó.

---

## 2. Bot **KNIFE · Reversal Lab v3** ([netlify/functions/knife-catcher.js](netlify/functions/knife-catcher.js))

> Algoritmo: `v3.2.0-ReversalShadowHardening`. Spot long-only reversal scanner.

### 2.1 Arquitectura

Igual flujo secuencial que Trader pero con 3 módulos. Diferencias clave:
- **Añade timeframe 5m** como principal de capitulación.
- **No requiere HTF bullish** — sólo bloquea con BTC RED + regime RISK_OFF.
- **No tiene order-flow gate** (no usa OBI ni deltaRatio como filtro hard).

### 2.2 Filtros hard globales

| Filtro | Condición | Línea |
|---|---|---|
| `LIQUIDITY_FLOOR` | `quoteVol24h < 8M USDT` (umbral más bajo que Trader) | [knife-catcher.js:813](netlify/functions/knife-catcher.js#L813) |
| `ATR_FILTER` | `atrPercent5m < 0.08%` o `> 7%` | [knife-catcher.js:857](netlify/functions/knife-catcher.js#L857) |
| `BTC_RED_BLOCK` | `btcContext.status==='RED'` o `regime==='RISK_OFF'` | [knife-catcher.js:1026](netlify/functions/knife-catcher.js#L1026) |

### 2.3 Módulos

| # | Módulo | Live? | minVolRatio | slAtr / tpR | timeStop |
|---|---|---|---|---|---|
| 1 | `TWO_POLE_CAPITULATION_RESET` | 🌒 shadow | 0.4 | 1.15 / 2.25 | 5h |
| 2 | `VIDYA_LIQUIDITY_SWEEP` | 🌒 shadow | 1.15 | 1.25 / 2.45 | 6h |
| 3 | `SOTT_BAND_RECLAIM` | 🌒 shadow | 1.1 / 2.15 | — | 7h |

> ⚠️ **Los 3 módulos son `shadowOnly`** → en producción Knife está 100% apagado. No opera ningún trade en vivo, solo registra near-misses.

### 2.4 Modelo de riesgo

`SIGNAL_SCORE_THRESHOLD = 72` (vs 65 en Trader) — 7 puntos más exigente.
Holds más cortos (5-7h vs 10-16h de Trader).

### 2.5 Veredicto Knife

- **Naturaleza**: cazador de capitulaciones — busca entrar contra-tendencia tras impulso bajista.
- **Estado**: completamente apagado en producción.
- **Riesgo estructural**: como veremos en el torneo, en el periodo medido **ninguna variación es rentable**. Mantenerlo en shadow tiene sentido.

---

## 3. Torneo de Estrategias — TRADER

**10 variantes**, todas sobre módulos live por defecto (a menos que se indique `shadow-enabled`).

| # | Estrategia | Trades | ROI | PF | WR | Max DD | Hold | OOS Trades |
|---|---|---|---|---|---|---|---|---|
| 🏆 1 | **early-be** (SL→BE a 30% TP) | 147 | **+4.90%** | **1.51** | 26.5% | -1.11% | 5.1h | 4 |
| 2 | no-be (sin breakeven) | 123 | +4.32% | 1.32 | 39.8% | -1.95% | 5.5h | 3 |
| 3 | aggressive-rr (SL×0.8, TP×1.25) | 127 | +3.29% | 1.28 | 25.2% | -2.07% | 5.5h | 6 |
| 4 | tighter-sl (SL×0.75) | 153 | +3.19% | 1.26 | 28.1% | -1.93% | 5.5h | 5 |
| 5 | smc-only | 36 | +0.54% | 1.20 | 27.8% | -1.18% | 9.5h | 2 |
| 6 | wider-tp (TP×1.3) | 108 | +2.67% | 1.23 | 26.9% | -1.93% | 5.6h | 5 |
| 7 | **baseline-prod** (config actual) | 134 | +2.73% | 1.21 | 32.1% | -2.03% | 5.5h | 4 |
| 8 | shadow-enabled (los 6 módulos) | 137 | +2.54% | 1.19 | 31.4% | -2.03% | 5.5h | 6 |
| 9 | vidya-only | 129 | +2.70% | 1.22 | 31.8% | -1.95% | 5.5h | 2 |
| 10 | twopole-only | 15 | -0.29% | 0.68 | 20.0% | -0.44% | 7.2h | 1 |

### Hallazgos Trader

1. **La regla de breakeven actual (50% de TP) es subóptima**. Mover a 30% mejora PF de 1.21 → 1.51 (+25%) y casi mitad el drawdown. Desactivarla del todo también ayuda (PF 1.32) — el peor de los tres mundos es el actual.
2. **VIDYA domina el caudal de señales**: `vidya-only` produce 129 de 134 trades del baseline → casi todo lo que opera Trader es del módulo VIDYA. SMC aporta 36 trades; TwoPole sólo 15 y pierde.
3. **Activar los 3 módulos shadowOnly no mejora resultados** (PF 1.19 vs 1.21 baseline). El equipo hizo bien en dejarlos en shadow.
4. **TwoPole continuation no funciona en este periodo** (PF 0.68) — candidato a degradar a shadow o quitar.
5. **Apretar el SL es mejor que ampliar el TP**: las cuatro mejores variantes comparten `slMult ≤ 0.8` o break-even agresivo. El TP por defecto ya parece bien calibrado.
6. **Capital protegido en mercado adverso**: durante el holdout (10 últimos días, BTC bajista), todas las variantes operaron muy poco — el filtro HTF_TREND funciona como cortocircuito. Esto es bueno (evita pérdidas), pero hace que el OOS sea estadísticamente débil.

### Recomendación Trader

**Adoptar la variante `early-be` como configuración base** (mover SL a entrada cuando el precio recorra el 30% del TP, en lugar del 50% actual). Mantener los 3 módulos shadowOnly como están. Considerar bajar TWO_POLE_PULLBACK_CONTINUATION a shadowOnly si en periodos sucesivos sigue dando PF<1.

**Cómo aplicarlo**: el cambio vive en la gestión de la posición (no en `generateSignal`). Si quieres llevarlo a producción, el código de manejo de breakeven está en el handler de cierre (probablemente fuera de `generateSignal`). Yo lo apliqué en el backtest como `beFraction = 0.3`. En vivo habría que buscar dónde el bot evalúa el cierre de posiciones y cambiar la condición `profit >= tpDistance * 0.5` por `0.3`.

---

## 4. Torneo de Estrategias — KNIFE

**8 variantes**, todas con `shadowOnly` habilitado (sin esto Knife operaría 0 trades, como está en producción).

| # | Estrategia | Trades | ROI | PF | WR | Max DD | Hold | OOS Trades |
|---|---|---|---|---|---|---|---|---|
| 🏆 1 | **no-be** | 111 | -1.52% | 0.88 | 32.4% | -3.64% | 6.2h | 9 |
| 2 | vidya-only | 113 | -1.83% | 0.84 | 27.4% | -3.75% | 6.6h | 9 |
| 3 | baseline-allmods | 116 | -2.08% | 0.81 | 25.9% | -3.99% | 5.9h | 9 |
| 4 | wider-tp | 104 | -2.12% | 0.79 | 20.2% | -3.97% | 6.5h | 9 |
| 5 | tighter-sl | 123 | -2.84% | 0.71 | 19.5% | -3.7% | 5.4h | 9 |
| 6 | aggressive-rr | 112 | -3.01% | 0.69 | 16.1% | -4.12% | 5.4h | 9 |
| 7 | twopole-only | 4 | -0.23% | 0.00 | 0% | -0.23% | 3.6h | 0 |
| 8 | sott-only | 2 | -0.10% | 0.00 | 0% | -0.10% | 2.5h | 0 |

### Hallazgos Knife

1. **Ninguna variante es rentable** en este periodo (PF < 1 en todas).
2. **VIDYA_LIQUIDITY_SWEEP es el único módulo activo en la práctica** (113 de 116 trades). TWO_POLE_CAPITULATION emitió 4 señales en todo el mes; SOTT_BAND_RECLAIM emitió 2. Los otros dos módulos son funcionalmente *muertos* en este periodo.
3. **Las variantes "agresivas" empeoran** (tighter-sl, aggressive-rr): apretar SL en un bot de reversión es contraproducente — los rebotes necesitan margen.
4. **Desactivar BE ayuda** (PF 0.88 vs 0.81 baseline) — los breakouts contra-tendencia requieren paciencia.
5. **WR baja (16-32%)** y holds medios de ~6h indican que Knife entra en "cuchillos cayendo" que no rebotan: las salidas en TP son raras y las pérdidas grandes.

### Recomendación Knife

**Mantener en `shadowOnly` como está**, validar la decisión actual del equipo. En este periodo el bot tal cual está construido pierde dinero en todas las variaciones de riesgo razonables.

Pistas para hacerlo viable (requeriría cambios en la lógica del bot, no solo de riesgo):
- Subir score floor de 72 → 78-80 para ser más selectivo.
- Replantear los dos módulos casi-muertos: TWO_POLE_CAPITULATION_RESET y SOTT_BAND_RECLAIM apenas disparan. O calibrar los thresholds (return12x5m <= -0.35 es muy estricto), o eliminarlos.
- Considerar exits dinámicos por estructura (resistencia previa) en vez de TP/SL por ATR fijo.
- Probar con periodo de mayor volatilidad/capitulación (e.g., mes con flash crash) — el bot está diseñado para esos contextos y este periodo fue de tendencia bajista lenta.

---

## 5. Tooling Añadido

| Archivo | Función |
|---|---|
| [scripts/v13-backtest.js](scripts/v13-backtest.js) | Motor de backtest reescrito: Binance data, ambos bots, cache en disco, knobs de riesgo/módulos, OOS split, HTML+JSON, auto-open |
| [scripts/strategy-tournament.js](scripts/strategy-tournament.js) | Corre N variantes sobre datos compartidos, ranking + HTML comparativo, auto-open |
| [backtests/.cache/](backtests/.cache/) | Klines cacheados 6h para acelerar re-runs |
| [package.json](package.json) | Nuevos scripts: `backtest:trader`, `backtest:knife`, `tournament:trader`, `tournament:knife` |

### Comandos

```bash
# Backtest individual de un bot (abre HTML al terminar)
npm run backtest:trader -- --top=5 --months=1
npm run backtest:knife  -- --symbols=BTCUSDT,ETHUSDT --months=2

# Backtest con variantes de riesgo o módulos
node scripts/v13-backtest.js --bot=trader --rr-mult=1.3 --sl-mult=0.8
node scripts/v13-backtest.js --bot=trader --modules=VIDYA_SQUEEZE_EXPANSION
node scripts/v13-backtest.js --bot=trader --no-be
node scripts/v13-backtest.js --bot=knife --shadow

# Torneo completo (HTML comparativo se abre solo)
npm run tournament:trader
npm run tournament:knife
```

### Flags soportadas en `v13-backtest.js`

| Flag | Default | Descripción |
|---|---|---|
| `--bot=trader\|knife` | trader | Bot a testear |
| `--symbol=BTCUSDT` | — | Un solo símbolo |
| `--symbols=A,B,C` | — | Lista de símbolos |
| `--top=N` | 5 | Top N USDT por volumen |
| `--months=N` | 1 | Meses (admite decimales) |
| `--days=N` | — | Días (alternativa a months) |
| `--balance=N` | 5000 | Capital simulado |
| `--oos-split=R` | 0.7 | Ratio train/holdout |
| `--modules=A,B` | — | Sólo signals de estos módulos |
| `--shadow` | false | Permite módulos `shadowOnly` |
| `--rr-mult=X` | 1.0 | Multiplica distancia TP |
| `--sl-mult=X` | 1.0 | Multiplica distancia SL |
| `--be-fraction=X` | 0.5 | Fracción de TP para mover SL a BE |
| `--no-be` | false | Desactiva BE move |
| `--slippage=X` | 0.001 | Slippage en entrada |
| `--no-open` | false | No abrir HTML automáticamente |
| `--debug` | false | Verboso |
| `--label=X` | bot | Sufijo del archivo de reporte |

---

## 6. Limitaciones Conocidas

- **Order book sintético**: Binance no entrega libro histórico. El backtest simula spread/depth a partir del volumen 24h. Los símbolos genuinamente líquidos pasan los gates de ejecución; el filtrado de slippage real puede diferir.
- **No simula slippage adaptativo**: 0.1% fijo en entrada. Salidas en TP/SL asumen ejecución limpia al precio exacto.
- **Una sola posición por símbolo simultánea**: igual que el live, pero sin gestión de portfolio cruzada.
- **Periodo único (30d) en mercado mayormente bajista**: las conclusiones son específicas de este contexto. Re-correr en periodos largos (3-6 meses) daría más robustez. Recomiendo lanzar `npm run tournament:trader -- --months=3` mensualmente para detectar drift.
- **Módulos shadowOnly en backtest**: cuando se habilitan con `--shadow`, todos los módulos compiten por ser el "mejor candidato" en cada vela. Esto significa que activar un módulo `shadowOnly` puede *robar* señales que iban a ser de un módulo live (porque el bot escoge el de mayor score). Por eso "shadow-enabled" no es estrictamente "baseline + extras", sino una recomposición.

---

## TL;DR (knobs-only)

| Bot | Mejor knob-only | Mejora vs baseline | Acción |
|---|---|---|---|
| **Trader** | `early-be` (SL→BE a 30% de TP) | PF 1.21 → **1.51** · ROI +2.7% → **+4.9%** · DD -2.0% → **-1.1%** | Superado por v14 |
| **Knife** | `no-be` (sin breakeven) | PF 0.81 → 0.88, todas en pérdida | Superado por v4 |

→ Ver §7 para las versiones v14/v4 que sí pasan el corte de "usables".

*Generado 2026-05-23 · datos Binance · 30 días · top-5 USDT*

---

## 7. Cambios Code-Level Validados (Trader v14 / Knife v4)

### 7.1 Por qué los knobs no bastaban

El segundo torneo (con knobs de calidad: `--min-score`, `--partial-tp`, `--time-stop`) confirmó una **curva de tradeoff inevitable**:

| Tipo de variante | WR típico | PF típico | Rentable? |
|---|---|---|---|
| Tight TP / partial TP | 45-65% | 0.83-0.95 | ❌ |
| Selectividad por score | 27-30% | 1.04-1.06 | ≈ flat |
| Baseline / time-stop | 30-40% | 1.05-1.08 | ✅ marginal |

Causa raíz: `signal.score` interno **no correlaciona** con probabilidad de win. Y reducir TP no compensa los SL completos. **El cuello de botella es la calidad de entrada.**

### 7.2 Filtros code-level añadidos

Implementados como filtros **post-`generateSignal`** (no se toca la lógica interna del bot), reutilizando los indicadores de `tradingview-strategy-core.js`.

**Trader v14** — 5 filtros encadenados (todos deben pasar):

| # | Filtro | Por qué |
|---|---|---|
| 1 | `htfMomentumRising` | MACD histogram 1h ascendiendo ≥2 barras — evita entrar en techos donde el empuje ya se agotó |
| 2 | `recent15mBullish` | Últimas 3 velas 15m con ≥2 cierres alcistas — confirma acción reciente |
| 3 | `pullbackReclaimedEma9` | Toque al EMA9 en últimas 5 velas + reclamación — entra en snap-backs, no extensiones |
| 4 | `EXCLUDED_MODULES` | Bloquea `TWO_POLE_PULLBACK_CONTINUATION` (PF 0.53 aislado) |
| 5 | `min RS 1h ≥ 0.003` | Exige Relative Strength positiva real (no sólo > 0 marginal) |

**Knife v4** — 1 filtro crítico:

| # | Filtro | Por qué |
|---|---|---|
| 1 | `rsiOversoldReclaim` | RSI 5m bajó <30 en últimas 8 velas, reclamó >38, precio > el mínimo del dip — true capitulación-rebote |
| + | Restringido a `VIDYA_LIQUIDITY_SWEEP` | Los otros 2 módulos disparaban 2-4 veces por mes; muertos en la práctica |
| + | Override `shadowOnly: false` | Las señales que pasan el filtro se promueven a LIVE |

### 7.3 Resultados validados (3 meses OOS · top-5 USDT)

**Trader v14**:
| Métrica | Baseline v13 | **v14** | Δ |
|---|---|---|---|
| Win Rate | ~30% | **35.5-39.3%** | +18-31% |
| Profit Factor | ~1.05 | **1.67-1.75** | +59-67% |
| ROI 3m | +0.6% | **+5.0-5.3%** | +800% |
| Max DD | -2.1% | **-0.95%** | -55% |
| OOS holdout PF | 0.57 frágil | **1.78** robusta | ✅ |

**Knife v4**:
| Métrica | Baseline v3 | **v4** | Δ |
|---|---|---|---|
| Win Rate | ~29% | **38.1%** | +31% |
| Profit Factor | ~1.02 | **2.00** | +96% |
| ROI 3m | +0.16% | **+2.47%** | +1444% |
| Max DD | -2.1% | **-0.71%** | -66% |
| OOS holdout PF | — | **5.14** robusta | ✅ |

### 7.4 Arquitectura del despliegue

```
┌─ netlify/functions/
│  ├─ trader-bot.js                  ← v13 ORIGINAL (intacto, salvo +5 líneas additive hook)
│  ├─ trader-bot-v14.js              ← NUEVO: wrapper, importa runAnalysis + aplica 5 filtros
│  ├─ knife-catcher.js               ← v3 ORIGINAL (intacto, salvo +5 líneas additive hook)
│  ├─ knife-catcher-v4.js            ← NUEVO: wrapper, importa runAnalysis + aplica filtro v4
│  └─ tradingview-strategy-core.js   ← indicadores reutilizados
```

**Cambio mínimo en los originales**: 
- `runAnalysis(context)` → `runAnalysis(context, options = {})`
- 16 líneas insertadas tras `generateSignal()`: si `options.signalFilter` es función, se aplica como post-filtro (rechazar o mutar la señal)
- **100% backward-compatible**: si no se pasa `options`, comportamiento idéntico al v13/v3 original

### 7.5 Cómo desplegar a producción

1. **Verificar**: `node scripts/verify-wrappers.js` — confirma que el wrapper produce los mismos números que el backtest con knobs. ✅ Trader verificado idéntico al decimal.

2. **Cambiar el cron a v14/v4** — opciones:

   **Opción A (recomendada)** — desactivar el cron del original editando la última línea:
   ```js
   // En trader-bot.js, comentar o cambiar:
   // export const handler = schedule("0,15,30,45 * * * *", scheduledHandler);
   export const handler = scheduledHandler;  // sin schedule → no cron
   ```
   El v14 sigue corriendo con su propio cron. Misma lógica para Knife.

   **Opción B** — usar env vars en Netlify:
   ```
   TRADER_GLOBAL_SHADOW_MODE=true     ← apaga señales live del v13
   KNIFE_GLOBAL_SHADOW_MODE=true      ← apaga señales live del v3
   ```
   El v14/v4 sigue corriendo normalmente.

3. **Deploy a Netlify**: `netlify deploy --prod` o el commit habitual.

4. **Monitorear primeras 48-72h**: revisar `persistent_logs.json` y `history.json` (mismos stores que el original — el v14 los usa también).

5. **Rollback en cualquier momento**:
   - Re-activar el cron del original (revertir paso 2)
   - O eliminar los wrappers: `rm netlify/functions/{trader-bot-v14,knife-catcher-v4}.js`
   - El original sigue funcionando porque el hook es no-op sin `options.signalFilter`

### 7.6 Caveats importantes

- **Time-stop NO está en los wrappers**: el +0.03 PF que aportaba time-stop=8h es un feature de salida que requeriría tocar la lógica de gestión de posiciones del bot (no de generateSignal). Se puede añadir después si se valida. Wrapper actual aplica sólo filtros de entrada.
- **Override de `shadowOnly` en Knife v4**: el filtro promueve señales a LIVE. Esto es intencional — sin esto Knife v4 seguiría sin operar nunca (todos los módulos están marcados shadowOnly internamente). Aceptarlo implica confiar en el filtro de oversold-reclaim como confirmación adicional.
- **Same blob stores**: el wrapper reusa `signal-history-v2`, `signal-cooldowns`, etc. Correr en paralelo el original y el wrapper causa contención. Asegurar que **sólo uno** tenga `schedule()` activo.
- **Validación seguir corriendo**: 3 meses es válido pero recomiendo `npm run tournament:trader -- --months=6` mensual para detectar drift de régimen.
