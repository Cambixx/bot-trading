# 🦅 Documentación del Algoritmo de Trading "Expert Edition" (v4.5)

Esta documentación sirve como guía técnica para entender, mantener y optimizar el sistema de señales de trading de contado (Spot-Only) alojado en Netlify Functions.

---

## 1. Arquitectura del Sistema

El bot opera como un ecosistema serverless interconectado:
- **Netlify Functions**: 
    - `scheduled-analysis`: Ejecuta el análisis cada 15 minutos (cron job).
    - `telegram-bot`: Gestiona comandos interactivos y alertas.
- **MEXC API**: Fuente de datos en tiempo real (Klines y Order Book).
- **Netlify Blobs**: Almacena el historial (`history.json`) y cooldowns.
- **Telegram API**: Interfaz bidireccional para alertas e informes.

---

## 2. Novedades v4.5 - "Expert Edition"

### 🛡️ Capa de Validación Experta
- **Order Flow Validation**: No basta con que el precio suba. El bot analiza el **Delta de Volumen** y el **OBI (Order Book Imbalance)**.
- **Regla de Oro**: Si el precio sube pero el flujo de órdenes es negativo (venta neta), la señal se descarta automáticamente como "Fakeout".

### 💎 Sniper 2.0 (Máxima Seguridad)
- **Alineación MTF Total**: Requiere confirmación de tendencia en **15m, 1h Y 4h** simultáneamente.
- **Volumen Institucional**: Umbral de volumen aumentado a **1.5x** (antes 1.2x).
- **RSI Estricto**: Entrada solo si RSI 1H < 63 (antes 65) para evitar compras en techos.

### 💰 Gestión de Riesgo Adaptativa
- **Sugerencia de Size**: Cada alerta incluye una recomendación de % de capital (0.5% - 3.5%) basada en la calidad de la señal y la volatilidad.
- **Circuitos de Régimen**: En mercados volátiles, el bot sube automáticamente la exigencia de Score mínimo (+4 puntos).

---

## 3. Sistema de Scoring v4.5

El puntaje final (0-100) usa pesos fijos pero incorpora una validación binaria final (Pasa/No Pasa).

| Categoría | Peso | Descripción |
|-----------|------|-------------|
| **Momentum** | 25% | RSI, StochRSI, MACD |
| **Trend** | 30% | SuperTrend, EMA alignment, ADX |
| **Structure** | 25% | Order Blocks, FVGs, Bollinger Bands |
| **Volume** | 15% | Volume ratio, Delta, OBI |
| **Patterns** | 5% | Candlestick patterns, divergences |

### Modos de Operación

#### 💎 MODO SNIPER
- **Requisitos**: Score ≥ 88 + Trend 4H a favor + Alineación MTF Total + Volumen > 1.5x.
- **Filosofía**: "Solo disparar cuando el blanco está inmóvil y perfecto".

#### ⚡ MODO AGRESIVO
- **Requisitos**: Score ≥ 75 + Validación Experta (OBI/Delta) OK.
- **Flexibilidad**: Permite entrar con Trend 4H "Neutral" y RSI hasta 78.

---

## 4. Regímenes de Mercado

| Régimen | Threshold | Estrategia | Size Sugerido |
|---------|-----------|------------|---------------|
| **RANGING** | Score ≥ 75 | Mean reversion, comprar en soporte | ~2.0% |
| **TRENDING** | Score ≥ 85 | Solo pullbacks a EMA21/50 | ~2.5% |
| **HIGH_VOLATILITY** | Score ≥ 90 | Ultra estricto, estructura obligatoria | ~0.5% - 1.0% |
| **DOWNTREND** | BLOQUEADO | No operar contra tendencia bajista | 0% |
| **TRANSITION** | Score ≥ 82 | Alta selectividad | ~1.5% |

---

## 5. Gestión de Riesgo

### SL/TP Adaptativo por Régimen
| Régimen | SL (ATR) | TP (ATR) | Ratio |
|---------|----------|----------|-------|
| **TRENDING** | 2.5x | 4.0x | 1.6:1 |
| **RANGING** | 2.0x | 2.0x | 1.0:1 |
| **HIGH_VOL** | 1.2x | 2.0x | 1.6:1 |

### Protecciones
- **Stale Exit**: Cierre automático a las 12h si no hay movimiento favorable.
- **Cooldown**: 4 horas entre señales del mismo par.
- **Breakeven**: Trigger a 0.8:1 R:R para proteger capital.

---

## 6. Configuración

### Variables de Entorno
```bash
MAX_SYMBOLS=50                    # Reducido de 100
ALERT_COOLDOWN_MIN=240            # 4 horas (antes 2h)
AVOID_ASIA_SESSION=true           # Evitar sesión Asia
MIN_QUOTE_VOL_24H=3000000         # Mínimo volumen 24h
SIGNAL_SCORE_THRESHOLD=65         # Threshold base
TELEGRAM_CHAT_ID=...              # ID del Canal/Grupo Privado
```

### Mapa de Sectores (Sectores Clasificados)
- **BLUE_CHIP**: BTC, ETH, BNB, XRP
- **L1**: SOL, AVAX, ADA, DOT, NEAR, ATOM
- **L2**: MATIC, ARB, OP, STRK
- **DEFI**: LINK, UNI, AAVE, COMP, MKR
- **AI**: RENDER, FET, AGIX, WLD
- **MEME**: DOGE, SHIB, PEPE, FLOKI

---

## 7. Comandos de Telegram (Panel de Control) 🤖

El bot de Telegram ahora permite gestionar el scanner en tiempo real (solo para el ADMIN):

- `/informe`: Resumen de ganancias, pérdidas y operaciones abiertas.
- `/scan`: Fuerza una ejecución inmediata del scanner (útil para pruebas).
- `/cooldowns`: Muestra qué monedas están bloqueadas y cuánto tiempo les queda.
- `/reset_cooldowns`: Elimina todos los bloqueos temporales.
- `/settings`: Muestra la configuración técnica activa (MAX_SYMBOLS, etc.).
- `/limpiar`: Borra el historial almacenado (v2).
- `/help`: Muestra la lista completa de comandos.

---

## 8. Historial de Versiones (Changelog)

### v4.9 - "Smart Downtrend" (Pullback Unlock)
- **Modo Pullback Inteligente**: Se permite operar en régimen `DOWNTREND` (15m) **SI Y SOLO SI** la tendencia 4H es `BULLISH`.
- **Validación Estructural**: Para estos setups de "Buy the Dip", se exige **MSS (Market Structure Shift)** o **Sweep de Liquidez** obligatorio.
- **Score Exigente**: Score mínimo de 85 para confirmar calidad en retrocesos.

### v4.8 - "Sunday Mode" (Low Volatility Fix)
- **Eliminación de Bloqueo por Volumen Bajo**: Se reemplaza el rechazo duro (< 0.8) por una **Penalización de Score** (-10 puntos).
- **Suelo de Liquidez**: Se mantiene un rechazo absoluto solo si el volumen es "Nulo" (< 0.3x del promedio).
- **Filosofía**: *"Si la configuración técnica es perfecta (Score > 90), vale la pena entrar aunque el volumen sea bajo (Score final ~80)."*

### v4.7 - Bull Run Unlock
- **Filtro de Sobreextensión Inteligente**: Permite RSI > 70 y BB Breakouts si la tendencia 4H es ALCISTA.
- **Trend Awareness**: Indicadores bajistas ignorados en tendencias alcistas fuertes.

### v4.5 - Expert Edition
- **Validación Binaria**: Capa de validación OBI/Delta (Pasa/No Pasa).
- **Sniper 2.0**: Alineación MTF Total (15m+1h+4h) obligatoria.

### v4.3 - Filtro Rebalanceado
- Rehabilitado Régimen TRANSITION.
- Relajación Macro RSI.

---

**Documentación actualizada a v4.9 - 17 Febrero 2026**
