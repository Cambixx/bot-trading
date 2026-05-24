# 📊 Guía del Motor de Backtesting

Guía operativa del motor de backtesting que vive en [scripts/v13-backtest.js](scripts/v13-backtest.js). Si buscas la auditoría completa de los bots y por qué se llegó a Trader v14 / Knife v4, lee [AUDIT_BOTS_2026-05.md](AUDIT_BOTS_2026-05.md).

---

## 🚀 Comandos rápidos

```bash
# Backtest individual (1 archivo HTML+JSON por bot, se sobrescribe en cada run)
npm run backtest:trader              # default: 5 USDT pairs · 1 mes
npm run backtest:knife

# Torneo: corre N variantes sobre los mismos datos y elige ganador
npm run tournament:trader            # 14 variantes (último set focado en WR)
npm run tournament:knife             # 12 variantes

# Verificar que los wrappers de producción (v14/v4) producen los mismos números
node scripts/verify-wrappers.js
```

Por defecto se abre el HTML en el navegador al terminar. Añade `--no-open` para evitarlo.

---

## 🎯 Pares y periodo por defecto

```js
DEFAULT_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']  // blue chips
```

Periodo por defecto: 30 días, split OOS 70/30 (validación train/holdout). Cambialos con `--months=N` o `--days=N`.

---

## 📁 Archivos generados (sólo 4-6 estables, todos sobrescritos)

```
backtests/
├── trader-backtest.{html,json}      ← último backtest individual del Trader
├── knife-backtest.{html,json}       ← último backtest individual del Knife
├── trader-tournament.{html,json}    ← último torneo del Trader
├── knife-tournament.{html,json}     ← último torneo del Knife
└── .cache/                          ← klines de Binance (gitignored, TTL 6h)
```

No se generan archivos por variante en los torneos — cada variante se renderiza como sección plegable (`<details>`) dentro del HTML consolidado.

---

## 🎛️ Knobs del motor `v13-backtest.js`

### Universo y periodo
| Flag | Default | Descripción |
|---|---|---|
| `--bot=trader\|knife` | trader | Bot a testear |
| `--symbol=BTCUSDT` | — | Un solo símbolo (override de defaults) |
| `--symbols=A,B,C` | — | Lista de símbolos (override de defaults) |
| `--top=N` | — | Top N USDT por volumen 24h en Binance (sin esto se usan los `DEFAULT_PAIRS`) |
| `--months=N` | 1 | Periodo en meses (admite decimales: `0.5`) |
| `--days=N` | — | Periodo en días (alternativa a `--months`) |
| `--balance=N` | 5000 | Capital simulado USD |
| `--oos-split=R` | 0.7 | Ratio train/holdout para OOS |
| `--no-open` | false | No abrir HTML al terminar |
| `--debug` | false | Logs verbosos |

### Filtros de módulos
| Flag | Default | Descripción |
|---|---|---|
| `--modules=A,B` | — | Sólo aceptar señales de estos módulos |
| `--exclude-modules=A,B` | — | Rechazar señales de estos módulos |
| `--shadow` | false | Permitir módulos marcados `shadowOnly` (necesario para Knife) |

### Risk management (knobs de salida)
| Flag | Default | Descripción |
|---|---|---|
| `--rr-mult=X` | 1.0 | Multiplica la distancia del TP. `0.6` → target más cerca, más WR |
| `--sl-mult=X` | 1.0 | Multiplica la distancia del SL. `0.75` → stop más ajustado |
| `--be-fraction=X` | 0.5 | Mover SL a entrada cuando el precio recorre X% del TP |
| `--no-be` | false | Desactivar el move a breakeven |
| `--partial-tp=trigger,size` | — | Tomar parcial. `0.5,0.5` = 50% al 50% del TP |
| `--time-stop=Xh` | — | Cerrar forzosamente tras X horas |
| `--slippage=X` | 0.001 | Slippage en entrada (0.1% por defecto) |

### Filtros de calidad de entrada (los que mueven la aguja del WR)
| Flag | Default | Descripción |
|---|---|---|
| `--min-score=X` | — | Rechazar señales con `score < X` |
| `--min-rs1h=X` | — | Exigir `relativeStrengthSnapshot.rs1h ≥ X` |
| `--require-htf-momentum` | false | MACD histogram 1h ascendiendo ≥2 barras |
| `--require-5m-bullish` | false | Acción 5m alcista reciente (Knife) o 15m proxy (Trader) |
| `--require-pullback` | false | Toque a EMA9 + reclamación en últimas 5 velas (Trader) |
| `--require-oversold-reclaim` | false | RSI 5m <30 → reclamó >38 (Knife) |
| `--require-volume-spike=X` | — | Volumen 5m ≥ X× del avg-20 |

---

## 🏆 Torneos preconfigurados

Los torneos viven en [scripts/strategy-tournament.js](scripts/strategy-tournament.js) y combinan los knobs en variantes predefinidas. Los archivos de salida son `trader-tournament.html` y `knife-tournament.html`, con:
- Tabla de ranking ordenada por score compuesto (PF + ROI + OOS robustness + DD)
- Sección plegable por variante con stats, OOS, por símbolo, por módulo, top rechazos, últimos 30 trades
- Ganador marcado con 🏆

El **score compuesto** prioriza profit factor robusto en holdout. Variantes con <8 trades se penalizan hasta `-Infinity` (muestra demasiado fina).

---

## 🔬 Wrappers v14/v4 (producción)

Los ganadores validados del torneo están encapsulados como **wrappers de producción** en:
- [netlify/functions/trader-bot-v14.js](netlify/functions/trader-bot-v14.js)
- [netlify/functions/knife-catcher-v4.js](netlify/functions/knife-catcher-v4.js)

Estos importan `runAnalysis` del bot original y aplican un `signalFilter` post-`generateSignal`. Para verificar que producen los mismos números que el backtest con flags:

```bash
node scripts/verify-wrappers.js
```

Debe imprimir `✅ Both wrappers verified equivalent.` con métricas idénticas al decimal.

---

## 🧪 Workflows típicos

### Validar un solo bot con la config de producción
```bash
# Trader v14 equivalent (replica los 5 filtros del wrapper)
node scripts/v13-backtest.js --bot=trader --months=3 \
  --require-htf-momentum --require-5m-bullish --require-pullback \
  --exclude-modules=TWO_POLE_PULLBACK_CONTINUATION --min-rs1h=0.003 --time-stop=8

# Knife v4 equivalent
node scripts/v13-backtest.js --bot=knife --months=3 --shadow \
  --modules=VIDYA_LIQUIDITY_SWEEP --require-oversold-reclaim
```

### Buscar drift mensual
```bash
npm run tournament:trader -- --months=6 --no-open
npm run tournament:knife -- --months=6 --no-open
```
Si el ganador cambia o el PF del wrapper actual cae <1.3, revisar.

### Iterar una hipótesis nueva
1. Añadir variante en `buildStrategies()` de [scripts/strategy-tournament.js](scripts/strategy-tournament.js)
2. Correr `npm run tournament:trader -- --no-open`
3. Revisar la sección plegable en `trader-tournament.html`
4. Si gana, promover los flags al wrapper correspondiente

### Test rápido de hipótesis sin tocar el torneo
```bash
node scripts/v13-backtest.js --bot=trader --months=1 --min-score=78 --partial-tp=0.5,0.5
```

---

## ⚠️ Limitaciones conocidas

- **Order book sintético**: Binance no entrega libro histórico. El motor simula spread/depth desde el volumen 24h. Activos genuinamente líquidos pasan los gates; el slippage real puede diferir.
- **Una sola posición por símbolo simultánea** (igual que el live).
- **Cache TTL 6h**: si necesitas datos frescos antes, borra `backtests/.cache/` manualmente.
- **5m heavy**: backtests del Knife descargan 5m del periodo completo. Top-5 × 3 meses ≈ 60k velas/símbolo, ~3-5 min de descarga inicial. Luego va en caché.
- **OOS estadísticamente débil con <50 trades**: el holdout es 30% del periodo. Si quieres OOS robusto, usa `--months=3` o más.

---

## 📚 Documentación relacionada

- [AUDIT_BOTS_2026-05.md](AUDIT_BOTS_2026-05.md) — auditoría completa + justificación de v14/v4
- [ALGO_DOCUMENTATION.md](ALGO_DOCUMENTATION.md) — arquitectura de módulos de los bots
- [ALGORITHM_AUDIT_PROMPT_GUIDE.md](ALGORITHM_AUDIT_PROMPT_GUIDE.md) — prompt maestro para auditar
- [ALGORITHM_JOURNAL.md](ALGORITHM_JOURNAL.md) — historial de cambios algorítmicos
- `.claude/skills/audit-trading-bots/SKILL.md` — skill interno para futuras auditorías

*Última actualización: 2026-05-24*
