# 🦅 Documentación del Algoritmo de Trading "Élite" (v3.0 - "Shield & Sniper")

Esta documentación sirve como guía técnica para entender, mantener y optimizar el sistema de señales de trading de contado (Spot-Only) alojado en Netlify Functions. El bot está configurado exclusivamente para operaciones de compra ("Buy Cheap, Sell Dear").

---

## 1. Arquitectura del Sistema

El bot opera como un ecosistema serverless interconectado:
- **Netlify Functions**: 
    - `scheduled-analysis`: Ejecuta el análisis cada 15-60 minutos (cron job).
    - `telegram-bot`: Gestiona comandos interactivos y alertas.
- **MEXC API**: Fuente de datos en tiempo real (Klines y Order Book).
- **Netlify Blobs**: Almacena el historial (`history.json`) y cooldowns.
- **Telegram API**: Interfaz bidireccional para alertas e informes.

---

## 2. Pilares de Análisis Técnico (v3.0 - "Shield & Sniper")

### A. Smart Money Concepts (SMC) & Estructura 🏦
- **Order Blocks (OB) & Fair Value Gaps (FVG)**: Zonas de interés institucional.
- **Market Structure Shift (MSS)**: Confirma reversiones. **NUEVO v3.0:** El bonus de MSS se limita al 40% del score base para evitar inflación artificial del puntaje.
- **Liquidity Sweeps**: Detecta barridos de stops. **NUEVO v3.0:** Ahora requiere confirmación de volumen direccional.

### B. Análisis Multi-Timeframe (3-TF) 📊
- **4H (Macro)**: Define la dirección permitida. Solo compras si la tendencia macro es alcista.
- **1H (Contexto)**: Volume Profile (POC) y filtro de sobreextensión RSI.
- **15M (Ejecución)**: Timing preciso con confluencia de indicadores (RSI, StochRSI, MACD, BB%, CMF).

### C. Contexto Global (BTC Semaphore) 🚦
- **🔴 ROJO (Bearish)**: BTC bajista en 4H. Filtro ultra estricto (Score > 96).
- **🟡 ÁMBAR (Caution)**: BTC volátil/sobreextendido. Filtro moderado (Score > 85).
- **🟢 VERDE (Healthy)**: BTC estable/alcista. Filtros estándar (Score > 75).

---

## 3. Sistema de Scoring y Regímenes (v3.0)

El puntaje final (0-100) es una media ponderada ajustada por el escenario del mercado.

### Regímenes de Seguridad:
1. **DOWNTREND**: Tendencia bajista clara. **OPERATIVA BLOQUEADA**.
2. **TRANSITION**: Incertidumbre total. **OPERATIVA BLOQUEADA** (0% Win Rate histórico).
3. **HIGH_VOLATILITY**: ATR extremo. Requiere score 92 + MSS obligatorio + Volumen fuerte.
4. **TRENDING**: Solo opera **Pullbacks** a medias móviles (EMA21/50).
5. **RANGING**: Régimen optimizado para reversión a la media.

### Los "Filtros de Oro" v3.0 (Anti-Trampas):
- **Cero Compras Caras**: En Rango, se bloquea cualquier BUY si `BB% > 0.75`. No compramos cerca del techo.
- **Momentum Obligatorio**: En Rango, se requiere `MACD Alcista` para emitir una alerta.
- **Filtro de Volumen Engañoso**: Si el volumen es > 2x la media pero el `Delta` es negativo, la señal se cancela (trampa de venta).

---

## 4. Gestión de Riesgo y Salida ⚙️

### A. SL/TP Adaptativo
| Régimen | SL (ATR) | TP (ATR) | Ratio | Nota |
|:-------:|:--------:|:--------:|:-----:|:------|
| **TRENDING** | 2.5x | 4.0x | 1.6:1 | Captura tendencias extendidas. |
| **RANGING** | 2.0x | 2.0x | 1.0:1 | **AJUSTADO v3.0**: Realista para spot day trading. |
| **HIGH_VOL** | 1.2x | 2.0x | 1.6:1 | Entradas y salidas ultra rápidas. |

### B. Estrategia de Salida Especial: STALE_EXIT
- **Time-Based Exit**: Si un trade lleva **12 horas** abierto y no se ha movido al menos un **0.3% a favor**, el algoritmo lo cierra automáticamente como "STALE_EXIT".
- **Objetivo**: Evitar quedar atrapado en activos estancados que suelen terminar en pérdida.

---

## 5. Parámetros de Escaneo
- **MAX_SYMBOLS**: 100 monedas analizadas por ciclo (Aumentado v3.0).
- **MIN_QUOTE_VOL_24H**: 3,000,000 USDT (Filtro de liquidez).
- **MAX_ATR_PCT**: 8% (Evita shitcoins hiper-volátiles).

---

## 6. Historial de Versiones (Changelog)

### v3.0 - "Shield & Sniper" (11/02/2026)
- ✅ **Desinflado de Scores**: Capado de bonuses MSS/Sweep para que no oculten debilidades técnicas.
- ✅ **Filtro BB% Superior**: Prohibido comprar en el 25% superior del rango Bollinger.
- ✅ **MACD Mandatory**: Requisito de histograma alcista para señales de compra.
- ✅ **Veto de Transición**: Bloqueo total del régimen TRANSITION tras auditoría de 0% WR.
- ✅ **TP Realista**: Reducción de Take Profit en RANGING (3.0 -> 2.0 ATR) para asegurar ganancias.
- ✅ **Estrategia Stale Exit**: Cierre automático a las 12h si el trade no despega.
- ✅ **Escaneo Expandido**: MAX_SYMBOLS subido a 100 para compensar el rigor de los nuevos filtros.

### v2.9 - "Precision Core" (02/02/2026)
- ✅ Integración de Chaikin Money Flow (CMF).
- ✅ Detección de caída libre (Falling Knife).
- ✅ Filtros de Pullback en tendencia.

---
**Documentación actualizada a v3.0 - 11 Febrero 2026**
