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

## 2. Pilares de Análisis Técnico

### A. Smart Money Concepts (SMC) 🏦
El algoritmo busca huellas de dinero institucional para evitar "trampas" de retail:
- **Fair Value Gaps (FVG)**: Identifica desequilibrios entre oferta y demanda.
- **Order Blocks (OB)**: Zonas de acumulación/distribución institucional.
- **Scoring**: Se otorga alta prioridad a señales que rebotan o nacen en estas zonas.

### B. Análisis Multi-Timeframe (3-TF) 📊
- **4H (Macro)**: Define la dirección permitida. *Filtro estricto*: Solo se permiten compras si la tendencia macro es alcista.
- **1H (Contexto)**: Mide la fuerza del movimiento (ADX) y filtra el **Agotamiento Macro**. *Filtro*: Se rechazan compras si el RSI 1H es > 65.
- **15M (Ejecución)**: Busca el timing preciso usando RSI, StochRSI y Patrones de Velas. Requiere RSI < 68 para evitar Fomo.

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

**Umbrales de Calidad (Mínimo Score)**:
- **TRENDING/RANGING**: 75/100
- **HIGH_VOLATILITY**: 85/100
*Nota: En modo Trending se exigen al menos 3 categorías fuertes (confluencia) para entrar.*

---

## 4. Gestión de Riesgo y Duplicidad ⚙️

### A. Backtesting Dinámico
Cada señal generada se registra en el almacén `signal-history-v2` con:
- **Stop Loss (SL)**: Precio - 2.0 * ATR (Mayor margen para absorber volatilidad).
- **Take Profit (TP)**: Precio + 2.5 * ATR (Ratio de Beneficio mejorado).

### B. Control de Duplicidad
El bot implementa un check de seguridad antes de cada análisis:
1. **Filtro de Posición Abierta**: Si una moneda ya tiene una operación `OPEN` en el historial, el bot la ignora por completo hasta que se cierre.
2. **Cooldown Extendido**: Tiempo de espera de **120 minutos** entre señales de la misma moneda para evitar ruido.

### C. Comandos Interactivos 💬
El sistema incorpora un "oyente" de Telegram dedicado:
- **Comando `informe`**: Genera un resumen en tiempo real del Win Rate, operaciones abiertas y resultados recientes extrayendo datos de Netlify Blobs.
- **Seguridad por ID**: Solo responde a mensajes enviados desde el `TELEGRAM_CHAT_ID` autorizado.

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

### Plan de Investigación V3.0
Para una visión detallada de las próximas mejoras institucionales (Volume Profile, Liquidity Sweeps, MSS), consulta el archivo:
👉 `ROADMAP_V3_RESEARCH.md`

---

## 6. Mantenimiento y Parámetros del Sistema

Si el bot deja de enviar mensajes o de guardar datos, verifica estas variables en Netlify:
- `NETLIFY_AUTH_TOKEN`: Personal Access Token (necesario para Blobs).
- `MIN_QUOTE_VOL_24H`: Configurado en **5,000,000 USDT** (Filtro de liquidez).
- `ALERT_COOLDOWN_MIN`: Configurado en **120 minutos**.
- `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`: Para las notificaciones.

---
**Documentación actualizada el 23 de Enero, 2026**
*Estado del Algoritmo: v2.3 "Interactive Sniper"*
