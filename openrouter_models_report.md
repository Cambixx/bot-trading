# Informe de Modelos OpenRouter para Trading (Enero 2026)

Este documento detalla las opciones de modelos de IA disponibles a través de **OpenRouter** para el sistema de trading, optimizando el balance entre precisión analítica (razonamiento) y costo operativo.

## 1. Clasificación de Modelos Recomendados

Para un sistema de trading, dividimos los modelos en tres categorías según su uso:

### A. Modelos de Razonamiento (Deep Reasoning)
*Ideales para `Trade Doctor` y `Nexus Hub` donde se requiere análisis profundo de múltiples factores.*
- **DeepSeek-R1**: La opción líder en costo/beneficio para razonamiento lógico. Excelente para detectar confluencias complejas.
- **OpenAI o1-mini**: Muy rápido para tareas de razonamiento técnico y optimización de código.
- **Claude 3.5 Sonnet / 4.5 (Preview)**: El estándar de oro en precisión y seguimiento de instrucciones complejas.

### B. Modelos de Alta Velocidad (Flash/Speed)
*Ideales para `Market Oracle` o pre-filtrado de señales donde la latencia es crítica.*
- **Gemini 2.0 Flash**: Extremadamente barato y rápido con una ventana de contexto masiva.
- **Llama 3.3 70B**: Rendimiento de nivel GPT-4 a una fracción del costo.
- **DeepSeek V3**: Modelo general de alta eficiencia, muy balanceado.

### C. Modelos Gratuitos / Low Cost
*Ideales para tareas repetitivas de formateo o logs.*
- **Mistral 7B Instruct**: A menudo disponible de forma gratuita o a costo casi cero.
- **Qwen 2.5 72B**: Excelente rendimiento en tareas técnicas y matemáticas.

---

## 2. Tabla Comparativa de Costos (Estimados por 1M de Tokens)

| Modelo | Input ($) | Output ($) | Fortaleza |
| :--- | :--- | :--- | :--- |
| **DeepSeek-V3** | $0.01 - $0.14 | $0.28 - $0.50 | Máximo ahorro, alta inteligencia |
| **Claude 3.5 Sonnet** | $3.00 | $15.00 | Máxima precisión analítica |
| **Gemini 2.0 Flash** | $0.10 | $0.40 | Velocidad y contexto masivo |
| **GPT-4o** | $2.50 | $10.00 | Versatilidad y estabilidad |
| **Llama 3.3 70B** | $0.60 | $0.80 | Excelente open-source |
| **GPT-5.2 (Latest)** | $1.75 | $14.00 | Estado del arte (Enero 2026) |

*Nota: Los precios en OpenRouter pueden variar según el proveedor seleccionado dentro de la plataforma.*

---

## 3. Estrategia Sugerida para el Bot de Trading

Para maximizar la rentabilidad del bot, sugiero una arquitectura **híbrida**:

1.  **Pattern Hunter (Validación)**: Usar `Gemini 2.0 Flash`. La IA solo debe validar lo que el algoritmo ya detectó. Es rápido y barato.
2.  **Trade Doctor (Diagnóstico)**: Usar `DeepSeek-R1` o `Claude 3.5 Sonnet`. Aquí el costo se justifica porque una mala decisión de riesgo es más cara que la API.
3.  **Market Oracle (Resumen Macro)**: Usar `DeepSeek-V3` o `Llama 3.3 70B`. Dan una narrativa excelente sin el costo de los modelos "Top Tier".
4.  **Nexus Hub**: Usar `GPT-4o mini` o `Gemini Flash`. Tareas de agregación de datos no requieren modelos pesados.

---

## 4. Implementación en el Proyecto

Actualmente, el proyecto usa una función centralizada en `src/services/aiAnalysis.js`. Para cambiar de modelo, solo necesitas actualizar la constante o el parámetro `model` en las llamadas a OpenRouter:

```javascript
// Ejemplo de configuración sugerida en aiAnalysis.js
const MODELS = {
  REASONING: "deepseek/deepseek-r1",
  ANALYSIS: "anthropic/claude-3.5-sonnet",
  FAST: "google/gemini-flash-1.5", // o 2.0 según disponibilidad
  ECONOMY: "deepseek/deepseek-chat" // DeepSeek-V3
};
```

---

## 5. Conclusión y Recomendación

Si buscas **minimizar costos sin perder calidad**, la mejor configuración actual es usar **la familia DeepSeek (V3 y R1)**. Son significativamente más baratos (hasta 10-20 veces) que los modelos de OpenAI o Anthropic, manteniendo un rendimiento comparable en análisis técnico.

> [!TIP]
> Monitorea tu consumo en el dashboard de OpenRouter. Usar modelos "Flash" para tareas simples puede reducir tu factura mensual en un 80% manteniendo el mismo rendimiento del bot.
