🦅 Documentación del Algoritmo de Trading "Élite" (Spot Sniper Edition)

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

## 2. Pilares de Análisis Técnico (v2.4)

### A. Smart Money Concepts (SMC) & Estructura 🏦
El algoritmo busca huellas de dinero institucional:
- **Fair Value Gaps (FVG) y Order Blocks (OB)**: Zonas de interés.
- **Market Structure Shift (MSS)**: [NUEVO] Confirma reversiones de tendencia al romper máximos/mínimos previos con impulso.
- **Liquidity Sweeps**: [NUEVO] Detecta "cacería de stops" (tomas de liquidez) antes de un movimiento real.

### B. Análisis Multi-Timeframe (3-TF) 📊
- **4H (Macro)**: Define la dirección permitida.
- **1H (Contexto)**: Mide la fuerza del movimiento y el **Volume Profile (POC)**.
- **15M (Ejecución)**: Busca el timing preciso.

### C. Contexto Global (BTC Semaphore) 🚦 [NUEVO]
Antes de analizar cualquier Altcoin, el bot evalúa la salud de Bitcoin:
- **🔴 ROJO (Bearish)**: BTC bajista en 4H. Filtro extremo (Score > 95 requerido).
- **🟡 ÁMBAR (Neutral/Overextended)**: BTC sobreextendido. Filtro moderado (Score > 85).
- **🟢 VERDE (Bullish)**: BTC saludable. Filtros estándar.

---

## 3. Sistema de Scoring y Calidad

El puntaje final (0-100) es una media ponderada:
1. **Momentum (25%)**: RSI, MACD, Stochastic.
2. **Trend (30%)**: SuperTrend y alineación de medias.
3. **Structure (25%)**: SMC + **POC** + Bandas de Bollinger.
4. **Volume/Order Flow (15%)**: OBI (Imbalance del libro) y Volumen relativo.
5. **Patterns (5%)**: Martillos, Envolventes y Divergencias.

**Bonificaciones Especiales**:
- **MSS Confirmado**: +35 puntos.
- **Liquidity Sweep**: +40 puntos.

---

## 4. Gestión de Riesgo Dinámica (v2.4) ⚙️

### A. SL/TP Adaptativo por Régimen
Ya no usamos ratios fijos. El bot ajusta el riesgo según el mercado:

| Régimen | SL (ATR) | TP (ATR) | Notas |
|:-------:|:--------:|:--------:|:------|
| **TRENDING** | 1.5x | 3.5x | Deja correr las ganancias. Stops ajustados. |
| **RANGING** | 2.0x | 2.0x | TP conservador. Stop más amplio para ruido. |
| **HIGH_VOL** | 2.5x | 4.0x | Stops muy amplios para evitar mechas. |

### B. Trailing Stop Virtual
El sistema rastrea internamente el precio máximo alcanzado. Si una operación llega a 1:1 de beneficio y luego regresa a la entrada, se registra como **BREAK_EVEN** en el historial (no como pérdida).

---

## 5. Mantenimiento

- `NETLIFY_AUTH_TOKEN`: Token para BD.
- `MIN_QUOTE_VOL_24H`: 5M USDT.
- `ALERT_COOLDOWN_MIN`: 120 min.

---
**Documentación actualizada a v2.4 "Institutional Grade" - 24 Enero 2026**
