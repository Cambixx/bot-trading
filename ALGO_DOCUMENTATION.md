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

## 2. Pilares de Análisis Técnico (v2.8 - "Relax & Diagnose")

### A. Smart Money Concepts (SMC) & Estructura 🏦
El algoritmo busca huellas de dinero institucional:
- **Fair Value Gaps (FVG) y Order Blocks (OB)**: Zonas de interés institucional.
- **Market Structure Shift (MSS)**: Confirma reversiones de tendencia al romper máximos/mínimos previos con impulso. **Bonus: +45 puntos** (Incrementado para priorizar cambios estructurales).
- **Liquidity Sweeps**: Detecta "cacería de stops" antes de un movimiento real. **Bonus: +40 puntos** (Requiere confirmación en alta volatilidad).

### B. Análisis Multi-Timeframe (3-TF) 📊
- **4H (Macro)**: Define la dirección permitida. Solo compras en tendencia alcista macro.
- **1H (Contexto)**: Mide la fuerza del movimiento y el **Volume Profile (POC)**. Filtro de sobreextensión (RSI1h < 65).
- **15M (Ejecución)**: Busca el timing preciso con confluencia de indicadores.

### C. Contexto Global (BTC Semaphore) 🚦 (Optimizado)
Evalúa la salud de Bitcoin para ajustar el rigor del filtrado:
- **🔴 ROJO (Bearish)**: BTC bajista en 4H. Filtro extremo (Score > 96 requerido).
- **🟡 ÁMBAR (Caution)**: BTC sobreextendido. Filtro moderado (Score > 85).
- **🟢 VERDE (Healthy)**: BTC saludable. Filtros estándar (Score > 75).

---

## 3. Sistema de Scoring y Calidad

El puntaje final (0-100) es una **media ponderada ajustada por régimen**:

### Pesos por Régimen (v2.8):

| Régimen | Trend | Volume | Structure | Momentum | Patterns | Min Score |
|:-------:|:-----:|:------:|:---------:|:--------:|:--------:|:---------:|
| **TRENDING** | 40% | 30% | 15% | 10% | 5% | **75** |
| **RANGING** | 10% | 10% | 40% | 35% | 5% | **75** |
| **HIGH_VOL** | 10% | 40% | 40% | 5% | 5% | **88*** |
| **TRANSITION**| 40% | 10% | 25% | 20% | 5% | **85** |

*\*En HIGH_VOLATILITY se requiere además (MSS o Volumen > 1.2x) y BTC no puede estar en ROJO.*

### Bonificaciones Especiales:
- **MSS Confirmado**: +45 puntos
- **Liquidity Sweep**: +40 puntos (si está confirmado por MSS/Volumen)
- **Confluencia ≥4 categorías**: +20% multiplicador
- **Confluencia ≥3 categorías**: +10% multiplicador

---

## 4. Gestión de Riesgo Dinámica (v2.8) ⚙️

### A. SL/TP Adaptativo por Régimen
| Régimen | SL (ATR) | TP (ATR) | Ratio | Notas |
|:-------:|:--------:|:--------:|:-----:|:------|
| **TRENDING** | 3.0x | 3.5x | 1.17:1 | Captura tendencias extendidas. |
| **RANGING** | 2.0x | 2.0x | 1:1 | Reversión rápida a la media. |
| **HIGH_VOL** | 1.5x | 2.5x | 1.66:1 | **Relajado**: Captura movimientos rápidos antes de reversión. |
| **TRANSITION**| 2.0x | 2.0x | 1:1 | Precaución en cambio de tendencia. |

---

## 5. Filtros de Calidad (Anti-Ruido v2.8)

### Filtros de Sobreextensión (Relajados):
Para evitar entrar en el pico de un movimiento pero permitir capturar impulsos reales:
1. **RSI 15m**: < 70 (antes 65)
2. **Bandas Bollinger**: %B < 0.88 (antes 0.82)
3. **Distancia EMA21**: < 1.8% (antes 1.2%)
4. **Distancia EMA9**: < 2.0% (antes 1.5%)

### Sistema de Diagnóstico [REJECT]:
Implementado para total transparencia en los logs de Netlify. Cada moneda descartada genera un log indicando el motivo:
- `[REJECT] SYMBOL: Score X < Y`
- `[REJECT] SYMBOL: Overextended RSI/BB`
- `[REJECT] SYMBOL: Bearish signal against Bullish 4H Trend`

---

## 6. Escaneo de Mercado

1. **Smart Selection**: Top 50 monedas basadas en Opportunity Score (Volumen + Volatilidad + Cambio%).
2. **Multi-TF**: Análisis simultáneo de 15m, 1h y 4h.
3. **Smart Money**: Detección de FVG y OB cercanos al precio actual.

---

## 7. Mantenimiento y Auditoría

### Fixes v2.8 (27/01/2026):
1. ✅ **Relax Filter**: Aumentada la tolerancia a la sobreextensión para generar más señales.
2. ✅ **Transition Regime**: Se permite operar en transiciones con score 85+.
3. ✅ **High Vol Optimization**: Bajado score requerido de 95 a 88 y SL/TP optimizados para reversiones rápidas.
4. ✅ **Full Observability**: Logs de rechazo detallados instalados en el motor de análisis.

---

**Documentación actualizada a v2.8 "Relax & Diagnose" - 27 Enero 2026**
