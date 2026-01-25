# 📖 Guía de Uso de Alertas de Trading (v2.7)

Esta guía explica cómo interpretar y ejecutar las señales enviadas por el bot a través de Telegram.

---

## 1. Tipos de Alerta 🚦

Cada mensaje de Telegram contiene una o varias señales. Los tipos principales son:

*   **🟢 COMPRA (BUY)**: Indica una oportunidad para abrir una posición de contado (Spot). Comprar barato para vender más caro.
*   **🔴 VENTA (SELL_ALERT)**: [Desactivado] El bot solo opera compras en modo Spot.
*   **👁️ VIGILAR**: Monedas con puntaje alto pero que no han cumplido todos los filtros estrictos.

---

## 2. Niveles de Operación 💰

Dentro de cada tarjeta de moneda en Telegram, verás tres precios clave:

1.  **Precio Actual (💰)**: Es el precio de entrada sugerido en el momento de la alerta. También muestra la distancia al VWAP.
2.  **Take Profit (🎯 TP)**: El precio objetivo donde deberías cerrar la operación con **ganancias**.
3.  **Stop Loss (🛡️ SL)**: El precio límite donde deberías cerrar la operación para **minimizar pérdidas**.

### Niveles Dinámicos por Régimen (v2.7):

El bot **ajusta automáticamente** el TP y SL según las condiciones del mercado:

| Régimen | Stop Loss | Take Profit | Ratio | Cuándo Ocurre |
|:-------:|:---------:|:-----------:|:-----:|:--------------|
| **📈 TRENDING** | 3.0x ATR | 3.5x ATR | 1.17:1 | Tendencia clara. Deja correr ganancias. |
| **↔️ RANGING** | 2.0x ATR | 2.0x ATR | 1:1 | Mercado lateral. TP conservador. |
| **⚠️ HIGH_VOL** | 4.5x ATR | 4.0x ATR | 0.89:1 | Alta volatilidad. Stops MUY amplios. |

> **Ejemplo Real:**
> ```
> 🟢 BTCUSDT | 🛒 COMPRA
> 💰 $90,000 📉 -0.2% (VWAP)
> 🎯 TP: $91,575 | 🛡️ SL: $88,650
> 📈 Regime: TRENDING | 🎯 Score: 92/100
> ```
> - **Entrada**: $90,000
> - **TP**: $91,575 (+1.75%) [3.5x ATR en TRENDING]
> - **SL**: $88,650 (-1.50%) [3.0x ATR en TRENDING]
> - **Ratio**: 1.17:1 (por cada $1 arriesgado, ganas $1.17)

---

## 3. Entendiendo los Indicadores 📊

### A. Score (0-100)
Cuanto más alto sea el puntaje, más indicadores están alineados:
- **75-79**: Señal válida (mínimo aceptable)
- **80-84**: Buena señal (múltiples confirmaciones)
- **85-94**: Excelente señal (confluencia fuerte)
- **95-100**: Señal excepcional (setup perfecto) [Raro]

### B. Régimen de Mercado
- **📈 TRENDING**: El mercado tiene una dirección clara. Las señales de continuación de tendencia son las más fuertes.
- **↔️ RANGING**: El mercado rebota entre niveles. Las señales de "reversión" funcionan mejor.
- **⚠️ HIGH_VOL**: Alta volatilidad. Requiere Score ≥85 y stops muy amplios.

### C. Badges de Confluencia ✨
- **🏦 OB_BULL/OB_BEAR**: Order Block (zona institucional)
- **🏦 FVG_BULL/FVG_BEAR**: Fair Value Gap (desequilibrio de precio)
- **🔄 MSS**: Market Structure Shift (cambio de estructura confirmado) [+35 pts]
- **🧹 SWP**: Liquidity Sweep (barrido de stops detectado) [+40 pts]
- **🔥 DIV**: Divergencia RSI/Precio (señal de reversión)
- **🕯️ PAT**: Patrón de velas (Hammer, Engulfing, etc.)

### D. Indicadores Técnicos
- **RSI (15m / 1h)**: Mide sobrecompra/sobreventa. Ideal: 30-60.
- **Stoch**: Stochastic RSI. Sobreventa < 20, Sobrecompra > 80.
- **BB (Bollinger Bands)**: Posición entre bandas. 0% = banda baja, 100% = banda alta.
- **ST (SuperTrend)**: BULL = tendencia alcista, BEAR = bajista.
- **MACD**: 🟢 = alcista, 🔴 = bajista.

### E. Volumen y Order Flow
- **Vol x1.5**: Volumen actual es 1.5x el promedio (confirmación fuerte).
- **Spread**: Diferencia bid/ask en bps. < 6 bps es excelente.
- **OBI (Order Book Imbalance)**: > 0 = presión compradora, < 0 = vendedora.
- **ATR%**: Volatilidad. 0.5% = baja, 2% = alta.

### F. Contexto BTC (Semáforo Global) 🚦
El bot analiza Bitcoin antes de enviar señales:
- **🔴 BTC Rojo**: Mercado macro bajista. Solo señales Score > 95.
- **🟡 BTC Ámbar**: BTC sobreextendido. Solo señales Score > 85.
- **🟢 BTC Verde**: BTC saludable. Filtros estándar (Score > 80).

---

## 4. Cómo Ejecutar una Señal 🎯

### Paso 1: Verificar Validez
Antes de entrar, confirma:
- ✅ El precio actual NO se ha alejado > 0.5% del precio de alerta
- ✅ No tienes ya una posición abierta en ese símbolo
- ✅ El Score es ≥ 80 (mínimo recomendado)

### Paso 2: Calcular Tamaño de Posición
**Regla de Oro**: No arriesgues más del **1-2% de tu capital** por operación.

Ejemplo:
- Capital: $10,000
- Riesgo permitido: 2% = $200
- Entrada: $90,000
- SL: $88,650
- Riesgo por unidad: $90,000 - $88,650 = $1,350

**Tamaño de posición**: $200 / $1,350 = **0.148 unidades** (o $200 / porcentaje de riesgo)

### Paso 3: Colocar Órdenes
1. **Orden Market/Limit** en el precio de entrada (o ligeramente mejor)
2. **Orden TP (Take Profit)** en el nivel indicado
3. **Orden SL (Stop Loss)** en el nivel indicado

### Paso 4: Trailing Manual (Opcional)
Si la operación alcanza **50% del TP** (medio camino):
- Mueve el SL a **break-even** (precio de entrada)
- Esto garantiza que no pierdas dinero incluso si revierte

---

## 5. Comandos Interactivos 💬

Puedes hablar directamente al bot en Telegram:

### Comandos Disponibles:
- **`informe`** o **`/informe`**: Resumen completo de rendimiento
- **`status`** o **`/status`**: Sinónimo de informe
- **`stats`**: Estadísticas rápidas

### Ejemplo de Respuesta:
```
📊 INFORME DE RENDIMIENTO (v2.7)

📈 Win Rate: 35.0%
✅ Ganadoras: 7
❌ Perdedoras: 13
🤝 Break-Even: 3
⏳ Abiertas: 2

🔔 OPERACIONES ABIERTAS:
• ETHUSDT ($2,950)
• SOLUSDT ($127)

📜 ÚLTIMOS RESULTADOS:
✅ BTCUSDT: WIN
❌ BNBUSDT: LOSS
🤝 DOGEUSDT: BREAK_EVEN
...
```

**Nota sobre Win Rate**: Los trades en **Break-Even** NO se cuentan como pérdidas. El Win Rate se calcula como: `Wins / (Wins + Losses)`.

---

## 6. Preguntas Frecuentes ❓

### ¿Por qué el TP y SL cambian entre señales?
El bot ajusta dinámicamente según:
1. **Régimen detectado** (TRENDING/RANGING/HIGH_VOL)
2. **Volatilidad (ATR)** de cada moneda
3. **Condiciones macro** (BTC saludable o estresado)

### ¿Qué significa "🧹 Liquidity Sweep"?
Es una táctica institucional donde el precio "barre" los stops de retail (toca mínimos previos) para luego revertir fuertemente. El bot detecta estos patrones y da +40 puntos al score.

### ¿Cuántas monedas analiza el bot?
1. Obtiene ~2000 pares de MEXC
2. Filtra por volumen ≥ 3M USDT y liquidez
3. Selecciona **Top 50** por "Opportunity Score"
4. Analiza esas 50 en profundidad cada 15 minutos

### ¿Por qué no llegan señales?
Posibles razones:
- Mercado muy lateral sin oportunidades claras
- BTC en contexto ROJO (filtro extremo activo)
- Todas las monedas con Score < 80
- Ya tienes posiciones abiertas en las monedas candidatas

### ¿Qué es el "Trailing Stop Virtual"?
El bot rastrea internamente el precio máximo. Si tu operación sube hasta 1:1 (ganancia = riesgo inicial) y luego regresa a la entrada, se cierra automáticamente como **BREAK_EVEN** en el historial (no cuenta como pérdida).

---

## 7. Consejos Avanzados 🚀

### 1. Prioriza Alta Confluencia
Señales con **≥3 badges** (MSS, Sweep, Divergencia, Patrón) son las más fiables.

### 2. Respeta el Régimen
- En **TRENDING**: Confía en el TP amplio (3.5x ATR)
- En **RANGING**: Toma ganancias rápido (2.0x ATR)
- En **HIGH_VOL**: Ten paciencia con el SL amplio (4.5x ATR)

### 3. No Persigas el Precio
Si el precio subió 1% desde la alerta, **espera la siguiente**. El bot envía nuevas señales cada 15 minutos.

### 4. Gestión de Capital
Nunca pongas todo tu capital en una sola señal. Diversifica entre 5-10 operaciones simultáneas.

### 5. Revisa el Contexto BTC
Si BTC está en rojo/ámbar, reduce tu exposición al 0.5-1% por trade (en lugar de 2%).

---

## 8. Actualizaciones Recientes (v2.7)

### Lo Nuevo:
- ✅ Stops más amplios en TRENDING (3.0x vs 1.5x antes)
- ✅ Filtro anti-chase relajado (menos falsos negativos)
- ✅ Escaneo ampliado a 50 monedas (vs 10-25 antes)
- ✅ Win Rate corregido (excluye Break-Even del denominador)
- ✅ Optimización de velocidad (análisis 5x más rápido)

### Resultado Esperado:
- Win Rate objetivo: **30-40%**
- Señales por día: **3-8** (vs 1-3 antes)
- Precisión mejorada: Menos señales, más calidad

---

*Esta guía corresponde a la versión v2.7 "Audit Fix" - Actualizada 25 Enero 2026*
