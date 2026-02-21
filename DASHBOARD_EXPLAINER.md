# 📊 Guía de Funcionamiento: Cambixx Executive Dashboard

Este documento explica la arquitectura, el flujo de datos y la veracidad de la información mostrada en el dashboard de trading profesional Cambixx.

## 1. Veracidad de los Datos (Data Veracity)
**Respondiente a la pregunta del usuario:** Sí, todos los datos mostrados son **reales y provienen de fuentes oficiales en tiempo real**. El sistema no utiliza datos inventados o simulados para el análisis técnico.

### Fuentes de Información:
- **Precios y Volúmenes**: Conexión directa con la API de **Binance** (REST y WebSockets para actualización milimétrica).
- **Libro de Órdenes (OBI)**: Datos de profundidad real de Binance.
- **Indicadores Macroeconómicos**: S&P 500 y DXY (Índice del Dólar) obtenidos vía **Alpha Vantage**.
- **Sentimiento Global**: Fear & Greed Index de **Alternative.me**.
- **Noticias**: Flujo de noticias financieras de cripto vía **NewsAPI**.

---

## 2. ¿Cómo funciona el Dashboard?

El dashboard está dividido en tres capas fundamentales que trabajan en sincronía:

### A. Capa de Captura (Data Layer)
Cada 20 minutos (o por actualización manual), el "Smart Scan" de Binance recorre el mercado buscando las monedas con mayor volatilidad y volumen relevante.
- **WebSocket**: Mantiene los precios de la interfaz latiendo en tiempo real.
- **Multi-Timeframe**: Se analizan velas de 15m, 1h, 4h y 1d para detectar confluencias.

### B. Capa de Inteligencia (Executive Layer)
Aquí es donde reside el "cerebro" del bot, dividido en sub-módulos:
- **Market Oracle**: Analiza la salud global del mercado. Determina si estamos en un régimen de *Risk-On* (apetito por riesgo) o *Risk-Off* (protección).
- **Nexus Intelligence**: Correlaciona noticias, datos macro y flujos de capital para dar un resumen ejecutivo de "qué está pasando ahora".
- **Trade Doctor**: Analiza una señal específica y da un "diagnóstico médico" (técnico) sobre si la operación es saludable o peligrosa.

### C. Generación de Señales (Execution Layer)
1. **Filtro Algorítmico**: El motor matemático detecta patrones técnicos (RSI, MACD, EMAs, Bandas de Bollinger).
2. **Scoring**: Se asigna una puntuación del 0 al 100.
3. **Enriquecimiento con IA**: Las mejores señales se envían a modelos de razonamiento avanzado (DeepSeek) para que critiquen la operación y definan niveles precisos de Stop Loss y Take Profit basados en la volatilidad real (ATR).

---

## 3. Glosario de Métricas en el Panel Ejecutivo
- **OBI (Order Book Imbalance)**: Diferencia entre la presión de compra y venta en el libro de órdenes.
- **CVD20 (Cumulative Volume Delta)**: Indica si el volumen agresivo (market orders) es de compra o venta.
- **Regime (Chop Index)**: <38 indica tendencia clara; >61 indica rango/lateralización (peligroso para muchos algoritmos).

---

## 4. Notas sobre "Simular Compra"
Aunque los datos de precio son 100% reales, el botón de **"Simular Compra"** utiliza un sistema de **Paper Trading**. Esto significa que:
1. Se abre una posición virtual con el saldo ficticio del bot.
2. Se sigue el precio real de Binance en tiempo real.
3. Se calcula el Profit/Loss real que hubieras tenido, pero sin arriesgar capital verdadero.

---
> [!IMPORTANT]
> El sistema está diseñado para que la IA actúe como un **intérprete experto de datos reales**, nunca como una fuente de datos por sí misma. Su poder reside en leer miles de puntos de datos de Binance y Alpha Vantage en segundos para darte una conclusión accionable.
