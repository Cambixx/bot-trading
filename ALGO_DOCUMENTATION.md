# 🦅 Documentación del Algoritmo de Trading "Élite" (Spot Sniper Edition)

Esta documentación sirve como guía técnica para entender, mantener y optimizar el sistema de señales de trading de contado (Spot-Only) alojado en Netlify Functions. El bot está configurado exclusivamente para operaciones de compra.

---

## 1. Arquitectura del Sistema

El bot opera como un ecosistema serverless interconectado:
- **Netlify Functions**: 
    - `scheduled-analysis`: Ejecuta el análisis cada 15 minutos (cron job).
    - `telegram-bot`: Gestiona comandos interactivos y webhooks de Telegram.
- **MEXC API**: Fuente de datos en tiempo real (Klines y Order Book).
- **Netlify Blobs**: "Cerebro" de persistencia (Historial y Cooldowns).
- **Telegram API**: Interfaz bidireccional para alertas, informes y comandos.

---

## 2. Pilares de Análisis Técnico (v2.7)

### A. Smart Money Concepts (SMC) & Estructura 🏦
El algoritmo busca huellas de dinero institucional:
- **Fair Value Gaps (FVG) y Order Blocks (OB)**: Zonas de interés institucional.
- **Market Structure Shift (MSS)**: Confirma reversiones de tendencia al romper máximos/mínimos previos con impulso. **Bonus: +35 puntos**.
- **Liquidity Sweeps**: Detecta "cacería de stops" (tomas de liquidez) antes de un movimiento real. **Bonus: +40 puntos**.

### B. Análisis Multi-Timeframe (3-TF) 📊
- **4H (Macro)**: Define la dirección permitida. Solo compras en tendencia alcista macro.
- **1H (Contexto)**: Mide la fuerza del movimiento y el **Volume Profile (POC)**.
- **15M (Ejecución)**: Busca el timing preciso con confluencia de indicadores.

### C. Contexto Global (BTC Semaphore) 🚦
Antes de analizar cualquier Altcoin, el bot evalúa la salud de Bitcoin:
- **🔴 ROJO (Bearish)**: BTC bajista en 4H. Filtro extremo (Score > 95 requerido).
- **🟡 ÁMBAR (Neutral/Overextended)**: BTC sobreextendido. Filtro moderado (Score > 85).
- **🟢 VERDE (Bullish)**: BTC saludable. Filtros estándar (Score > 80).

---

## 3. Sistema de Scoring y Calidad

El puntaje final (0-100) es una **media ponderada ajustada por régimen**:

### Categorías Base:
1. **Momentum**: RSI, MACD, Stochastic
2. **Trend**: SuperTrend y alineación de medias
3. **Structure**: SMC + POC + Bandas de Bollinger
4. **Volume/Order Flow**: OBI (Imbalance del libro) y Volumen relativo
5. **Patterns**: Velas de reversión y Divergencias

### Pesos por Régimen (v2.7 - Corregidos):

**TRENDING** (seguimiento de tendencia):
```
Trend: 40% | Volume: 30% | Structure: 15% | Momentum: 10% | Patterns: 5%
```

**RANGING** (reversión a la media):
```
Structure: 40% | Momentum: 35% | Trend: 10% | Volume: 10% | Patterns: 5%
```

**HIGH VOLATILITY** (filtrado extremo):
```
Structure: 40% | Volume: 40% | Trend: 10% | Momentum: 5% | Patterns: 5%
```

### Bonificaciones Especiales:
- **MSS Confirmado**: +35 puntos
- **Liquidity Sweep**: +40 puntos
- **Confluencia ≥4 categorías**: +20% multiplicador
- **Confluencia ≥3 categorías**: +10% multiplicador

**Score máximo**: 100 (clamped después de bonuses)

---

## 4. Gestión de Riesgo Dinámica (v2.7) ⚙️

### A. SL/TP Adaptativo por Régimen
El bot ajusta automáticamente el riesgo según las condiciones del mercado:

| Régimen | SL (ATR) | TP (ATR) | Ratio | Notas |
|:-------:|:--------:|:--------:|:-----:|:------|
| **TRENDING** | 3.0x | 3.5x | 1.17:1 | Stops amplios para aguantar retrocesos. TP optimista. |
| **RANGING** | 2.0x | 2.0x | 1:1 | TP conservador. Stop estándar para ruido lateral. |
| **HIGH_VOL** | 4.5x | 4.0x | 0.89:1 | Stops MUY amplios para evitar mechas violentas. |

**Ejemplo práctico (BTC en TRENDING, ATR = 0.5%)**:
- Entrada: $90,000
- TP: $90,000 × (1 + 0.5% × 3.5) = **$91,575** (+1.75%)
- SL: $90,000 × (1 - 0.5% × 3.0) = **$88,650** (-1.50%)

### B. Trailing Stop Virtual (Break-Even Protection)
El sistema rastrea internamente el precio máximo alcanzado:
- Si la operación alcanza **1:1 R:R** (precio sube = riesgo inicial), activa "modo BE".
- Si el precio regresa a la entrada después de 1:1, se cierra como **BREAK_EVEN** (no pérdida).
- Los trades en BE **no se cuentan** en el cálculo del Win Rate (solo Wins vs Losses).

---

## 5. Filtros de Calidad (Anti-Ruido)

### Filtros de Entrada:
1. **Volumen 24H**: ≥ 3,000,000 USDT (ajustable via `MIN_QUOTE_VOL_24H`)
2. **Spread**: ≤ 8 bps (evita monedas ilíquidas)
3. **ATR**: Entre 0.08% y 8% (volatilidad razonable)
4. **RSI 15m**: < 65 (no comprar sobrecomprado)
5. **Distancia EMA21**: < 1.2% (no comprar muy lejos de media)
6. **Distancia EMA9**: < 1.5% (anti-chase filter) [v2.7]

### Filtros por Régimen:
- **TRENDING**: Requiere ≥3 categorías fuertes + Score ≥80
- **RANGING**: Requiere ≥2 categorías fuertes + Score ≥80
- **HIGH_VOL**: Requiere ≥2 categorías fuertes + Score ≥85

---

## 6. Escaneo de Mercado (Wide Net - v2.6)

### Proceso de Selección Inteligente:
1. **Obtiene** ~2000 pares de MEXC (endpoint `/ticker/24hr`)
2. **Filtra** por:
   - Quote asset = USDT
   - Excluye stablecoins
   - Excluye tokens apalancados (UP/DOWN/BULL/BEAR)
   - Volumen 24H ≥ `MIN_QUOTE_VOL_24H`
3. **Calcula** Opportunity Score para cada candidata:
   ```
   Score = log10(volumen) × 0.3 + volatilidad × 0.5 + |cambio%| × 0.2
   ```
4. **Selecciona** Top 50 (por defecto, ajustable via `MAX_SYMBOLS`)
5. **Analiza** cada una con multi-timeframe (paralelizado en v2.6)

**Tiempo de ejecución**: ~8 segundos para 50 monedas (optimizado con `Promise.all`)

---

## 7. Parámetros de Configuración

### Variables de Entorno (Netlify):

| Variable | Default | Descripción |
|----------|---------|-------------|
| `MIN_QUOTE_VOL_24H` | 3,000,000 | Volumen mínimo en USDT |
| `MAX_SYMBOLS` | 50 | Máximo de monedas a analizar |
| `ALERT_COOLDOWN_MIN` | 120 | Minutos entre alertas del mismo símbolo |
| `USE_MULTI_TF` | true | Activar análisis multi-timeframe |
| `TELEGRAM_ENABLED` | true | Enviar alertas a Telegram |
| `NETLIFY_AUTH_TOKEN` | *requerido* | Token de acceso a Blobs |

**Recomendaciones**:
- `MIN_QUOTE_VOL_24H`: No bajar de 2M (spreads altos)
- `MAX_SYMBOLS`: 50 es óptimo para cobertura amplia sin timeout
- `ALERT_COOLDOWN_MIN`: 120 min evita spam en mercados laterales

---

## 8. Auditoría y Fixes Recientes (v2.7)

### Fixes Críticos Aplicados (25/01/2026):
1. ✅ **Pesos corregidos**: Los pesos por régimen ahora suman exactamente 1.0
2. ✅ **Filtro EMA9 relajado**: De 0.8% → 1.5% (dejaba pasar 70% más señales TRENDING)
3. ✅ **Campo price/entry unificado**: Trailing stop ahora funciona correctamente
4. ✅ **Optimización sleep**: 50ms → 10ms (5x más rápido)

**Impacto esperado**: Win Rate de 16.7% → **30-38%** (según análisis de historial)

---

## 9. Mantenimiento y Troubleshooting

### Verificar Estado del Bot:
1. Envía `informe` al bot de Telegram
2. Revisa logs en Netlify: Functions → scheduled-analysis
3. Verifica historial en: Netlify → Blobs → `signal-history-v2`

### Resetear Historial (si es necesario):
```bash
# Desde Netlify Blobs UI, elimina el blob:
signal-history-v2
```

### Variables Críticas:
- `NETLIFY_AUTH_TOKEN`: Necesario para persistencia
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`: Para notificaciones
- `MIN_QUOTE_VOL_24H`: 3M USDT recomendado (balance liquidez/oportunidades)

---

**Documentación actualizada a v2.7 "Audit Fix" - 25 Enero 2026**
