# 🦅 Documentación del Algoritmo de Trading "Élite" (v4.0 - "Clean Slate")

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

## 2. Novedades v4.0 - "Clean Slate"

### 🚀 Mejoras de Performance
- **Caché de Candles**: Reduce llamadas API en un 80% durante volatilidad
- **Batch Processing**: Procesamiento optimizado de símbolos
- **Reducción de MAX_SYMBOLS**: 100 → 50 (calidad sobre cantidad)

### 🎯 Scoring System Simplificado
- **Pesos Fijos**: Eliminado sistema dinámico complejo
- **Sin Bonuses Inflacionarios**: MSS/Sweep añaden +5pts fijos (no multiplicadores)
- **Mayor Transparencia**: Scores más fáciles de interpretar y debuggear

### 📊 Filtros de Volumen Mejorados
- **Mínimo 1.5x**: Volumen debe ser 1.5x la media (antes 1.0x)
- **Delta Direccional**: BUY requiere delta > 0.1, SELL requiere delta < -0.1
- **Protección Anti-Trampa**: Rechazo si alto volumen pero presión vendedora

### 🕐 Filtro de Sesión Horaria
- **Evitar Asia Session**: 00:00-07:00 UTC (baja liquidez)
- **Mejor Ejecución**: Operar durante London/NY overlap (08:00-22:00 UTC)

### 🏭 Protección de Correlación
- **Diversificación por Sector**: Máximo 1 señal por sector (L1, DeFi, AI, etc.)
- **Mapa de Sectores**: Clasificación automática de 20+ criptomonedas

### 🎚️ Regime Detection Mejorado
- **ADX Threshold**: Aumentado a 25 (antes 20) para mayor confiabilidad
- **EMA Slope**: Confirmación adicional de tendencia
- **Menos Falsos Positivos**: Mejor distinción entre TRENDING/RANGING

---

## 3. Sistema de Scoring v4.0

El puntaje final (0-100) usa pesos fijos para máxima transparencia:

| Categoría | Peso | Descripción |
|-----------|------|-------------|
| **Momentum** | 25% | RSI, StochRSI, MACD |
| **Trend** | 30% | SuperTrend, EMA alignment, ADX |
| **Structure** | 25% | Order Blocks, FVGs, Bollinger Bands |
| **Volume** | 15% | Volume ratio, Delta, OBI |
| **Patterns** | 5% | Candlestick patterns, divergences |

### Bonuses (Fijos):
- MSS confirmado: +5 pts
- Sweep confirmado: +5 pts
- Confluencia excepcional (4+ categorías >60): +5 pts
- Alta confluencia (3+ categorías >60): +3 pts

---

## 4. Regímenes de Mercado

| Régimen | Threshold | Estrategia |
|---------|-----------|------------|
| **RANGING** | Score ≥ 75 | Mean reversion, comprar en soporte |
| **TRENDING** | Score ≥ 85 | Solo pullbacks a EMA21/50 |
| **HIGH_VOLATILITY** | Score ≥ 90 | Ultra estricto, estructura obligatoria |
| **DOWNTREND** | BLOQUEADO | No operar contra tendencia bajista |
| **TRANSITION** | BLOQUEADO | 0% WR histórico |

---

## 5. Gestión de Riesgo

### SL/TP Adaptativo por Régimen
| Régimen | SL (ATR) | TP (ATR) | Ratio |
|---------|----------|----------|-------|
| **TRENDING** | 2.5x | 4.0x | 1.6:1 |
| **RANGING** | 2.0x | 2.0x | 1.0:1 |
| **HIGH_VOL** | 1.2x | 2.0x | 1.6:1 |

### Protecciones
- **Stale Exit**: Cierre automático a las 12h si no hay movimiento favorable
- **Cooldown**: 4 horas entre señales del mismo par
- **Breakeven**: Trigger a 0.8:1 R:R para proteger capital

---

## 6. Configuración

### Variables de Entorno
```bash
MAX_SYMBOLS=50                    # Reducido de 100
ALERT_COOLDOWN_MIN=240            # 4 horas (antes 2h)
AVOID_ASIA_SESSION=true           # Evitar sesión Asia
MIN_QUOTE_VOL_24H=3000000         # Mínimo volumen 24h
SIGNAL_SCORE_THRESHOLD=65         # Threshold base
```

### Mapa de Sectores (Sectores Clasificados)
- **BLUE_CHIP**: BTC, ETH, BNB, XRP
- **L1**: SOL, AVAX, ADA, DOT, NEAR, ATOM
- **L2**: MATIC, ARB, OP, STRK
- **DEFI**: LINK, UNI, AAVE, COMP, MKR
- **AI**: RENDER, FET, AGIX, WLD
- **MEME**: DOGE, SHIB, PEPE, FLOKI

---

## 7. Parámetros de Escaneo

- **MAX_SYMBOLS**: 50 monedas analizadas por ciclo (v4.0)
- **MIN_QUOTE_VOL_24H**: 3,000,000 USDT (filtro de liquidez)
- **MAX_ATR_PCT**: 8% (evita shitcoins hiper-volátiles)
- **Intervalo**: Cada 15 minutos
- **Cache TTL**: 5 minutos para candles

---

## 8. Comandos de Telegram (Panel de Control) 🤖

El bot de Telegram ahora permite gestionar el scanner en tiempo real (solo para el ADMIN):

- `/informe`: Resumen de ganancias, pérdidas y operaciones abiertas.
- `/scan`: Fuerza una ejecución inmediata del scanner (útil para pruebas).
- `/cooldowns`: Muestra qué monedas están bloqueadas y cuánto tiempo les queda.
- `/reset_cooldowns`: Elimina todos los bloqueos temporales.
- `/settings`: Muestra la configuración técnica activa (MAX_SYMBOLS, etc.).
- `/limpiar`: Borra el historial almacenado (v2).
- `/help`: Muestra la lista completa de comandos.

---

## 9. Historial de Versiones (Changelog)

### v4.1 - "Admin Pro" (12/02/2026)
- ✅ **Panel de Control**: Implementados comandos administrativos en Telegram.
- ✅ **Scan Manual**: Posibilidad de disparar análisis vía comando `/scan`.
- ✅ **Gestión de Cooldowns**: Comandos para ver y resetear bloqueos.

### v4.0 - "Clean Slate" (11/02/2026)
- ✅ **Sistema de Caché**: Reduce llamadas API en 80%
- ✅ **Scoring Simplificado**: Pesos fijos, sin bonuses inflacionarios
- ✅ **Filtros de Volumen**: Mínimo 1.5x + delta direccional
- ✅ **Filtro de Sesión**: Evitar Asia session (00:00-07:00 UTC)
- ✅ **Protección de Correlación**: Máximo 1 señal por sector
- ✅ **Mejor Regime Detection**: ADX threshold 25 + EMA slope
- ✅ **MAX_SYMBOLS**: Reducido a 50 (calidad sobre cantidad)
- ✅ **Cooldown**: Aumentado a 4 horas
- ✅ **Fix Bugs**: Typos y variables undefined corregidos

### v3.0 - "Shield & Sniper" (11/02/2026)
- ✅ Capado de bonuses MSS/Sweep
- ✅ Filtro BB% superior
- ✅ MACD obligatorio en RANGING
- ✅ Bloqueo de régimen TRANSITION
- ✅ TP realista en RANGING (2.0 ATR)
- ✅ Estrategia Stale Exit

---

**Documentación actualizada a v4.1 - 12 Febrero 2026**
