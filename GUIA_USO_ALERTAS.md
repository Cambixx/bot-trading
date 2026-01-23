# 📖 Guía de Uso de Alertas de Trading

Esta guía explica cómo interpretar y ejecutar las señales enviadas por el bot a través de Telegram.

---

## 1. Tipos de Alerta 🚦

Cada mensaje de Telegram contiene una o varias señales. Los tipos principales son:

*   **🟢 COMPRA (BUY)**: Indica una oportunidad para abrir una posición de contado (Spot). Comprar barato para vender más caro.
*   **👁️ VIGILAR**: Monedas con puntaje alto pero que no han cumplido todos los filtros estrictos.

---

## 2. Niveles de Operación 💰

Dentro de cada tarjeta de moneda en Telegram, verás tres precios clave:

1.  **Precio Actual (💰)**: Es el precio de entrada sugerido en el momento de la alerta.
2.  **Take Profit (🎯 TP)**: El precio objetivo donde deberías cerrar la operación con **ganancias**. Calculado para un ratio de **2.5x beneficio** (Ratio 2.5:2.0).
3.  **Stop Loss (🛡️ SL)**: El precio límite donde deberías cerrar la operación para **minimizar pérdidas**. Calculado a **2.0x el ATR** (volatilidad) para dar un margen de seguridad frente a mechas.

> **Ejemplo de Ejecución:**
> Si recibes: `🟢 BTCUSDT | COMPRA | $90,000 | TP: $92,000 | SL: $88,500`
> 1. Abres una orden de compra en $90,000.
> 2. Pones una orden de venta (TP) en $92,000.
> 3. Pones una orden de protección (SL) en $88,500.

---

## 3. Entendiendo los Indicadores Extra 📊

*   **Score (0-100)**: Cuanto más alto sea el puntaje, más indicadores están alineados. **75+ es bueno, 85+ es excelente.**
*   **Regime**:
    *   **📈 TRENDING**: El mercado tiene una dirección clara. Las señales de tendencia son las más fuertes.
    *   **↔️ RANGING**: El mercado rebota entre niveles. Las señales de "reversión" son mejores aquí.
*   **SMC (Smart Money Concepts)**:
    *   **OB (Order Block)**: Indica que bancos o instituciones han dejado órdenes en esa zona.
    *   **FVG (Fair Value Gap)**: Indica un desequilibrio de precio que el mercado suele ir a "rellenar".
*   **Volumen (Vol x1.5)**: Indica que hay una entrada de capital significativa. El bot solo analiza monedas con volumen diario > 5.0M USDT.
*   **Agotamiento Macro**: El bot filtra automáticamente compras si el RSI en 1H es > 65.

---

## 4. Consejos de Seguridad ⚠️

1.  **No entres tarde**: Si el precio ya se alejó más de un 0.5% del precio de entrada de la alerta, es mejor esperar a la siguiente.
2.  **Gestión de Riesgo**: No inviertas más del 1-2% de tu capital total en una sola señal.
3.  **Alineación 4H**: El bot ya filtra por la tendencia de 4 horas, lo cual aumenta mucho la probabilidad de éxito.

4.  **Notificaciones Silenciosas**: El bot solo enviará un mensaje cuando encuentre una **nueva oportunidad**. Si no hay señales, no recibirás nada (evitando ruido innecesario). Además, si ya tienes una operación abierta con una moneda, el bot no enviará alertas repetidas de ese símbolo.

---
*Esta guía corresponde a la versión v2.2 "Spot Sniper Edition".*
