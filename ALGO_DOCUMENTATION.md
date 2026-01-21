# 🦅 Documentación del Algoritmo de Trading "Élite"

Esta documentación sirve como guía técnica para entender, mantener y optimizar el sistema de señales de trading institucional alojado en Netlify Functions.

---

## 1. Arquitectura del Sistema

El bot opera como un ecosistema serverless interconectado:
- **Netlify Functions**: Ejecuta el análisis cada 15 minutos (cron job).
- **MEXC API**: Fuente de datos en tiempo real (Klines y Order Book).
- **Netlify Blobs**: "Cerebro" de persistencia (Historial y Cooldowns).
- **Telegram API**: Interfaz de salida para alertas y métricas de performance.

---

## 2. Pilares de Análisis Técnico

### A. Smart Money Concepts (SMC) 🏦
El algoritmo busca huellas de dinero institucional para evitar "trampas" de retail:
- **Fair Value Gaps (FVG)**: Identifica desequilibrios entre oferta y demanda.
- **Order Blocks (OB)**: Zonas de acumulación/distribución institucional.
- **Scoring**: Se otorga alta prioridad a señales que rebotan o nacen en estas zonas.

### B. Análisis Multi-Timeframe (3-TF) 📊
- **4H (Macro)**: Define la dirección permitida. *Filtro estricto*: Solo se permiten compras si la tendencia macro es favorable.
- **1H (Contexto)**: Mide la fuerza del movimiento (ADX) y la alineación de tendencia media.
- **15M (Ejecución)**: Busca el timing preciso usando RSI, StochRSI y Patrones de Velas.

### C. Detección de Régimen de Mercado 🌐
El bot adapta su estrategia según la volatilidad y la fuerza de tendencia:
- **TRENDING**: Pesos altos en SuperTrend y Medias Móviles.
- **RANGING**: Pesos altos en RSI y Bandas de Bollinger (reversión a la media).
- **HIGH_VOLATILITY**: Aumenta los umbrales de exigencia para filtrar el ruido.

---

## 3. Sistema de Scoring y Calidad

El puntaje final (0-100) es una media ponderada de 5 categorías:
1. **Momentum (25%)**: RSI, MACD, Stochastic.
2. **Trend (30%)**: SuperTrend y alineación de medias.
3. **Structure (25%)**: SMC (OB/FVG) y posición en Bandas de Bollinger.
4. **Volume/Order Flow (15%)**: OBI (Imbalance del libro) y Volumen relativo.
5. **Patterns (5%)**: Martillos, Envolventes y Divergencias.

**Bonus de Confluencia**: Si 3 o más categorías son "excelentes" (>60), se aplica un multiplicador de bonificación.

---

## 4. Backtesting Automático y Performance ⚙️

Cada señal generada se registra en el almacén `signal-history-v2` con:
- **Stop Loss (SL)**: Precio - 1.0 * ATR.
- **Take Profit (TP)**: Precio + 1.5 * ATR (Ratio Riesgo/Beneficio 1.5).

En cada ejecución, el bot recorre las señales abiertas y las actualiza a `WIN` o `LOSS` comparándolas con el precio actual. El **Win Rate** que ves en Telegram es el resultado real de este seguimiento.

---

## 5. Guía de Optimización Futura 🚀

Cuando el historial tenga suficientes datos (ej. 100+ señales), es el momento de ajustar las "tuercas" del algoritmo.

### Cómo dar contexto a la IA para una mejora:
Para pedirme (o pedir a otra IA) una optimización, debes seguir estos pasos:

1.  **Extraer el Historial**: Ve a Netlify > Data > Blobs > `trading-signals` > `signal-history-v2` y copia el contenido JSON.
2.  **Identificar Errores**: Observa cuáles fueron las señales marcadas como `LOSS`.
    - ¿Ocurrieron en un régimen específico (ej. todas en RANGING)?
    - ¿Tenían un score bajo (ej. entre 70 y 75)?
3.  **Proveer los Datos**: Pásame el JSON y dime: *"Aquí tienes el historial de las últimas 100 señales. Optimiza los pesos de las categorías o los umbrales de score por régimen para subir el Win Rate del actual X% al Y%."*

### Ajustes posibles:
- **Subir el Mínimo Score**: Si hay muchos fallos con score 70, lo subiremos a 75.
- **Ajustar Pesos**: Si el mercado cambia, podemos dar más peso al Volumen y menos al Momentum.
- **Ajustar SL/TP**: Cambiar el ratio de 1.5 a 2.0 si el mercado está muy tendencial.

---

## 6. Mantenimiento y Variables de Entorno

Si el bot deja de enviar mensajes o de guardar datos, verifica estas variables en Netlify:
- `NETLIFY_AUTH_TOKEN`: Tu Personal Access Token de Netlify (necesario para los Blobs).
- `NETLIFY_SITE_ID`: El ID de tu sitio.
- `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`: Para las notificaciones.

---
**Documentación creada el 20 de Enero, 2026**
*Estado del Algoritmo: v2.0 "Institutional Elite"*
