# manual de Configuración de IA (OpenRouter)

Este documento explica cómo funciona la integración de Inteligencia Artificial en el bot de trading, cómo cambiar los modelos y qué opciones gratuitas tienes disponibles a través de **OpenRouter**.

## 🚀 Cómo funciona la Arquitectura de IA

El sistema utiliza una arquitectura de **capa dual** para máxima seguridad y flexibilidad:

1.  **Entorno de Desarrollo (Local)**:
    *   El frontend (`aiAnalysis.js`) se comunica directamente con OpenRouter.
    *   Utiliza la variable `VITE_OPENROUTER_API_KEY` de tu archivo `.env`.
2.  **Entorno de Producción (Netlify)**:
    *   El frontend se comunica con una **Netlify Function** (`openrouter-analysis.js`).
    *   Esta función actúa como un puente seguro, manteniendo tu API Key oculta del público.
    *   Utiliza la variable `OPENROUTER_API_KEY` configurada en el panel de Netlify.

---

## 🛠 Cómo Cambiar el Modelo de IA

Si deseas probar un modelo diferente (por ejemplo, cambiar de DeepSeek a un modelo de Google o Meta), debes realizar el cambio en **dos lugares**:

### 1. En el Frontend (Para desarrollo local)
Abre [src/services/aiAnalysis.js](file:///Users/carlosrabago/trading/src/services/aiAnalysis.js) y busca la función `callOpenRouterDirectly`. Cambia el valor de `"model"`:

```javascript
body: JSON.stringify({
    "model": "google/gemini-2.0-flash-exp:free", // Cambia esto
    "messages": [...]
})
```

### 2. En el Backend (Para producción)
Abre [netlify/functions/openrouter-analysis.js](file:///Users/carlosrabago/trading/netlify/functions/openrouter-analysis.js) y busca la sección donde se llama a fetch. Cambia el valor de `"model"`:

```javascript
body: JSON.stringify({
    "model": "google/gemini-2.0-flash-exp:free", // Cambia esto
    "messages": [...]
})
```

---

## 💎 Modelos Gratuitos Recomendados (Free Tier)

OpenRouter ofrece modelos con costo 0 (marcados con `:free`). Aquí tienes los más estables y potentes actualmente:

| Modelo | ID para el código | Especialidad | Costo Aprox. |
| :--- | :--- | :--- | :--- |
| **DeepSeek Chat (V3)** | `deepseek/deepseek-chat` | **Recomendado para Análisis**. Alta precisión y lógica. | $0.27 / 1M tokens |
| **Gemini 1.5 Flash** | `google/gemini-flash-1.5` | **Recomendado para Oracle**. Velocidad extrema. | $0.07 / 1M tokens |
| **Google Gemini 2.0 (Free)** | `google/gemini-2.0-flash-exp:free` | Plan de respaldo gratuito. | $0.00 |

> [!NOTE]
> Actualmente el bot está configurado en **Modo Optimizado (Paid)**:
> *   **DeepSeek V3**: Se encarga del razonamiento técnico complejo (Doctor, Hunter).
> *   **Gemini 1.5 Flash**: Maneja los resúmenes de mercado globales para ahorrar costos.
> *   **Fallback Automático**: Si el saldo se agota, el sistema está preparado para intentar usar modelos gratuitos.

> [!TIP]
> Puedes consultar la lista completa y actualizada de modelos en: [openrouter.ai/models](https://openrouter.ai/models?max_price=0)

---

## ⚠️ Consideraciones Importantes

*   **Rate Limits**: Los modelos gratuitos tienen límites de peticiones por minuto (generalmente 20 RPM). Si los superas, el bot activará automáticamente el **Modo Fallback** (análisis técnico básico).
*   **API Key Segura**: Nunca subas tu archivo `.env` a GitHub. El archivo `.gitignore` ya está configurado para protegerlo.
*   **Latencia**: Los modelos gratuitos pueden tardar un poco más en responder durante horas de mucho tráfico.

---

## 🩺 Sistema de Fallback (Resiliencia)
Si la IA no responde o hay un error de red, el sistema no se detiene. Hemos implementado la función `getFallbackAnalysis(mode)` que devuelve una respuesta coherente basada en los indicadores técnicos actuales para que el Oráculo, el Doctor y el Hunter sigan mostrando información útil.
