/**
 * Servicio para análisis con IA usando Gemini API
 * Se comunica con la función serverless de Netlify en producción
 * En desarrollo llama directamente a Gemini API
 */

const NETLIFY_FUNCTION_URL = '/.netlify/functions/gemini-analysis';

// IMPORTANTE: La API key debe estar en .env (nunca hardcodeada)
// Crear archivo .env con: VITE_GEMINI_API_KEY=tu_api_key
// Detectar si estamos en desarrollo local
const isDevelopment = (import.meta.env && import.meta.env.DEV) || (typeof window !== 'undefined' && window.location.hostname === 'localhost');

// IMPORTANTE: La API key debe estar en .env (nunca hardcodeada)
const GEMINI_API_KEY = (import.meta.env && import.meta.env.VITE_GEMINI_API_KEY) || process.env.VITE_GEMINI_API_KEY;

/**
 * Llamar directamente a Gemini API (solo en desarrollo)
 */
async function callGeminiDirectly(marketData, tradingMode = 'BALANCED') {
    const { symbol, price, indicators, patterns, reasons, warnings, regime, levels, riskReward } = marketData;

    let modeContext = '';
    if (tradingMode === 'CONSERVATIVE') {
        modeContext = 'El usuario opera en modo CONSERVADOR. Prioriza la preservación de capital. Sé escéptico con señales débiles y busca confirmación de tendencia fuerte.';
    } else if (tradingMode === 'RISKY') {
        modeContext = 'El usuario opera en modo ARRIESGADO. Busca oportunidades de alto rendimiento/riesgo. Acepta mayor volatilidad si el potencial de subida es alto.';
    } else {
        modeContext = 'El usuario opera en modo EQUILIBRADO. Busca un balance entre riesgo y beneficio.';
    }

    const prompt = `Eres un experto analista de trading de criptomonedas especializado en day trading en spot.
${modeContext}

Analiza la siguiente oportunidad de trading:

**Contexto de Mercado**:
- Símbolo: ${symbol}
- Precio Actual: $${price}
- Régimen de Mercado Detectado: ${regime || 'Desconocido'} (Importante: Ajusta tu sesgo según esto)

**Análisis Técnico**:
- RSI: ${indicators.rsi || 'N/A'}
- MACD: ${indicators.macd || 'N/A'}
- ADX: ${indicators.adx || 'N/A'} (Fuerza de tendencia)

**Señales Detectadas**:
${reasons.map(r => `- ${r.text} (Peso: ${r.weight}%)`).join('\n')}

**Niveles Propuestos**:
- Entrada: $${levels.entry}
- Stop Loss: $${levels.stopLoss}
- Take Profit 1: $${levels.takeProfit1}
- Take Profit 2: $${levels.takeProfit2}
- Ratio Riesgo/Beneficio: ${riskReward}

${warnings && warnings.length > 0 ? `**Advertencias**:\n${warnings.map(w => `- ${w}`).join('\n')}` : ''}

Tu tarea:
1. Validar la calidad de la señal considerando el Régimen de Mercado.
2. Criticar los niveles de Stop Loss y Take Profit. ¿Son lógicos según la estructura?
3. Dar un veredicto final.

Proporciona un análisis conciso en formato JSON con la siguiente estructura:
{
  "sentiment": "BULLISH/NEUTRAL/BEARISH",
  "recommendation": "STRONG_BUY/BUY/HOLD/AVOID",
  "insights": ["insight1 (sobre régimen)", "insight2 (sobre niveles)", "insight3 (conclusión)"],
  "riskAssessment": "LOW/MEDIUM/HIGH",
  "confidenceScore": 0-100
}

Responde SOLO con el JSON, sin texto adicional.`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 2048,
                        topP: 0.95,
                        topK: 40
                    }
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.text();
            console.error(`Gemini API error (${response.status}):`, errorData);

            // Handle rate limiting specifically
            if (response.status === 429) {
                throw new Error('Rate limit exceeded - too many requests');
            }

            throw new Error(`Gemini API failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Gemini API response:', data); // Debug logging

        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!generatedText) {
            console.error('No text in Gemini response:', JSON.stringify(data, null, 2));
            throw new Error('No response from Gemini');
        }

        // Parsear JSON de la respuesta
        let analysis;
        try {
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
            const jsonText = jsonMatch ? jsonMatch[0] : generatedText;
            analysis = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('Error parsing Gemini response:', generatedText);
            analysis = {
                sentiment: 'NEUTRAL',
                recommendation: 'HOLD',
                insights: ['Análisis no disponible, usar solo indicadores técnicos'],
                riskAssessment: 'MEDIUM'
            };
        }

        return {
            success: true,
            analysis,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error calling Gemini directly:', error);
        return {
            success: false,
            error: error.message,
            analysis: null
        };
    }
}

/**
 * Enviar datos de mercado para análisis con IA
 * @param {Object} marketData - Datos del mercado y análisis técnico
 * @returns {Promise<Object>} Análisis de IA
 */
export async function getAIAnalysis(marketData, tradingMode = 'BALANCED') {
    // En desarrollo, llamar directamente a Gemini
    if (isDevelopment) {
        console.log('💡 Usando Gemini API directamente (desarrollo)');
        return await callGeminiDirectly(marketData, tradingMode);
    }

    // En producción, usar función serverless
    try {
        const response = await fetch(NETLIFY_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...marketData, tradingMode })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.warn('AI Analysis failed:', response.status, errorText);
            throw new Error(`AI Analysis failed: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        // Solo log en desarrollo, silencioso en producción
        if (isDevelopment) {
            console.error('Error getting AI analysis:', error);
        }
        return {
            success: false,
            error: error.message,
            analysis: null
        };
    }
}

/**
 * Enriquecer una señal con análisis de IA
 * @param {Object} signal - Señal de trading
 * @param {Object} technicalData - Datos técnicos adicionales
 * @param {string} tradingMode - Modo de trading actual
 * @returns {Promise<Object>} Señal enriquecida con análisis IA
 */
export async function enrichSignalWithAI(signal, technicalData = {}, tradingMode = 'BALANCED') {
    const marketData = {
        symbol: signal.symbol,
        price: signal.price,
        indicators: signal.indicators,
        patterns: signal.patterns,
        reasons: signal.reasons,
        warnings: signal.warnings,
        ...technicalData
    };

    const aiResult = await getAIAnalysis(marketData, tradingMode);

    if (aiResult.success && aiResult.analysis) {
        return {
            ...signal,
            aiAnalysis: {
                sentiment: aiResult.analysis.sentiment,
                recommendation: aiResult.analysis.recommendation,
                insights: aiResult.analysis.insights,
                riskAssessment: aiResult.analysis.riskAssessment
            },
            aiEnriched: true
        };
    }

    // Si falla el análisis de IA o estamos en dev, retornar señal original
    return {
        ...signal,
        aiEnriched: false,
        aiError: aiResult.devMode ? 'Development mode' : aiResult.error
    };
}

/**
 * Cachear análisis de IA para evitar llamadas repetidas
 */
class AIAnalysisCache {
    constructor(ttl = 300000) { // 5 minutos por defecto
        this.cache = new Map();
        this.ttl = ttl;
    }

    getKey(symbol, price) {
        // Redondear precio para cachear análisis similares
        const roundedPrice = Math.round(price / 10) * 10;
        return `${symbol}-${roundedPrice}`;
    }

    get(symbol, price) {
        const key = this.getKey(symbol, price);
        const cached = this.cache.get(key);

        if (cached && Date.now() - cached.timestamp < this.ttl) {
            return cached.data;
        }

        return null;
    }

    set(symbol, price, data) {
        const key = this.getKey(symbol, price);
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    clear() {
        this.cache.clear();
    }
}

export const aiCache = new AIAnalysisCache();

/**
 * Obtener análisis de IA con caché
 * @param {Object} marketData - Datos del mercado
 * @returns {Promise<Object>} Análisis de IA
 */
export async function getCachedAIAnalysis(marketData) {
    // Intentar obtener de caché
    const cached = aiCache.get(marketData.symbol, marketData.price);
    if (cached) {
        console.log(`Using cached AI analysis for ${marketData.symbol}`);
        return cached;
    }

    // Si no está en caché, obtener nuevo análisis
    const analysis = await getAIAnalysis(marketData);

    // Guardar en caché si fue exitoso
    if (analysis.success) {
        aiCache.set(marketData.symbol, marketData.price, analysis);
    }

    return analysis;
}
