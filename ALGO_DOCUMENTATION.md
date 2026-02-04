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

## 2. Pilares de Análisis Técnico (v2.9 - "Precision Core")

### A. Smart Money Concepts (SMC) & Estructura 🏦
El algoritmo busca huellas de dinero institucional:
- **Fair Value Gaps (FVG) y Order Blocks (OB)**: Zonas de interés institucional.
- **Market Structure Shift (MSS)**: Confirma reversiones de tendencia. Penalizado en regímenes volátiles.
- **Liquidity Sweeps**: Detecta "cacería de stops". **CRÍTICO:** En alta volatilidad, se requiere confirmación de volumen o MSS para evitar falsos positivos.

### B. Análisis Multi-Timeframe (3-TF) 📊
- **4H (Macro)**: Define la dirección permitida. Solo compras en tendencia alcista macro.
- **1H (Contexto)**: Mide la fuerza del movimiento y el **Volume Profile (POC)**. Filtro de sobreextensión.
- **15M (Ejecución)**: Busca el timing preciso con confluencia de indicadores, incluyendo el **nuevo Chaikin Money Flow (CMF)**.

### C. Contexto Global (BTC Semaphore) 🚦
Evalúa la salud de Bitcoin para ajustar el rigor del filtrado:
- **🔴 ROJO (Bearish)**: BTC bajista en 4H. Filtro ultra estricto (Score > 96).
- **🟡 ÁMBAR (Caution)**: BTC sobreextendido. Filtro moderado (Score > 85).
- **🟢 VERDE (Healthy)**: BTC saludable. Filtros estándar (Score > 75).

---

## 3. Sistema de Scoring y Calidad (v2.9)

El puntaje final (0-100) es una **media ponderada ajustada por régimen**:

### Regímenes Refinados:
1. **DOWNTREND**: ADX > 20 y tendencia bajista. **OPERATIVA BLOQUEADA**.
2. **TRANSITION**: Volatilidad media, tendencia débil. **OPERATIVA BLOQUEADA** (Históricamente 0% WR).
3. **HIGH_VOLATILITY**: ATR > 85%. Req score 90 + MSS + Volumen fuerte.
4. **TRENDING**: ADX > 25, ATR bajo. Solo opera **Pullbacks** a medias móviles.
5. **RANGING**: Regimen "Estrella" (75% WR). Busca reversiones a la media con protecciones.

### Pesos por Régimen:

| Régimen | Trend | Volume | Structure | Momentum | Patterns | Min Score |
|:-------:|:-----:|:------:|:---------:|:--------:|:--------:|:---------:|
| **TRENDING** | 45% | 10% | 25% | 15% | 5% | **88** |
| **RANGING** | 10% | 15% | 40% | 30% | 5% | **75** |
| **HIGH_VOL** | 15% | 35% | 40% | 5% | 5% | **92** |

---

## 4. Gestión de Riesgo Dinámica ⚙️

### A. SL/TP Adaptativo por Régimen
| Régimen | SL (ATR) | TP (ATR) | Ratio | Notas |
|:-------:|:--------:|:--------:|:-----:|:------|
| **TRENDING** | 2.5x | 4.0x | 1.6:1 | Busca expansión de tendencia. |
| **RANGING** | 2.0x | 3.0x | 1.5:1 | Targets amplios en rangos. |
| **HIGH_VOL** | 1.2x | 2.0x | 1.6:1 | Scalping rápido y protegido. |

---

## 5. Nuevos Filtros "Anti-Bulls Trap" (v2.9)

### 1. Protección "Falling Knife" (RANGING)
Evita comprar cuando el activo cae aceleradamente sin suelo:
- **MACD Check**: Si el histograma es negativo y *decreciente* (acelerando a la baja), se bloquea la señal.
- **Distancia EMA9**: Si el precio está muy lejos (>1.5%) de la EMA9 por debajo, se considera caída libre.

### 2. Confirmación de Dinero Inteligente (CMF)
Nuevo indicador **Chaikin Money Flow**:
- Se requiere `CMF > -0.05` para cualquier compra en Rango.
- Esto asegura que, aunque el precio baje, hay volumen acumulándose (divergencia de flujo).

### 3. StochRSI Cross
Ya no basta con estar "sobrevendido". La línea rápida (K) debe haber cruzado hacia arriba a la lenta (D), confirmando el giro.

---

## 6. Mantenimiento y Auditoría

### Fixes v2.9 (02/02/2026) - "Precision Core":
1. ✅ **CMF Indicator**: Integrado para filtrar caídas sin volumen de compra.
2. ✅ **Regime Lockdown**: `TRANSITION` y `DOWNTREND` deshabilitados para proteger capital.
3. ✅ **Falling Knife Protection**: Bloqueo de compras con inercia bajista fuerte en rangos.
4. ✅ **Trend Pullbacks**: En tendencia, solo se opera si el precio retrocede a la EMA21/50.

### Fixes v2.9.1 (04/02/2026):
1. ✅ **Swing Structure Bands**: Indicador de ChartPrime integrado para detectar estructura de precios dinámica.
2. ✅ **Deep History**: Aumento de descarga de velas a 500 para cálculos de alta precisión (Swing Length 100).

---

**Documentación actualizada a v2.9.1 - 04 Febrero 2026**
