/**
 * Servicio para análisis con IA usando OpenRouter API
 * Se comunica con la función serverless de Netlify en producción
 * En desarrollo llama directamente a la API de OpenRouter
 */

const NETLIFY_FUNCTION_URL = '/.netlify/functions/openrouter-analysis';

// Detectar si estamos en desarrollo local
const isDevelopment = (import.meta.env && import.meta.env.DEV) || (typeof window !== 'undefined' && window.location.hostname === 'localhost');

// La API key debe estar en .env (nunca hardcodeada)
const OPENROUTER_API_KEY = (import.meta.env && import.meta.env.VITE_OPENROUTER_API_KEY) || process.env.VITE_OPENROUTER_API_KEY;

/**
 * Llamar directamente a OpenRouter API (solo en desarrollo)
 */
async function callOpenRouterDirectly(inputData, tradingMode = 'BALANCED') {
    const { mode, symbol, price, indicators, patterns, reasons, warnings, regime, levels, riskReward, marketData: globalMarketData } = inputData;

    let prompt = '';

    if (mode === 'MARKET_ORACLE') {
        const { topCoins } = globalMarketData || {};
        prompt = `Eres un estratega jefe de mercado de criptomonedas (Chief Market Strategist).
            Tu trabajo es analizar la "Salud del Mercado" global y dar una directriz clara para el día.

            DATOS DEL MERCADO GLOBAL (Top Assets):
            ${JSON.stringify(topCoins, null, 2)}

            Tu tarea:
            1. Analizar el SENTIMIENTO GENERAL (¿Están subiendo las alts? ¿Bitcoin está absorbiendo liquidez? ¿Hay miedo?).
            2. Definir el ESTADO DEL MERCADO:
               - RISK_ON: Todo sube, buscar longs agresivos.
               - RISK_OFF: Todo baja, buscar shorts o cash.
               - CHOPPY: Rango/Indecisión, cuidado con falsos breakouts.
               - ALT_SEASON: BTC estable/baja, Alts vuelan.
            3. Redactar un TITULAR periodístico corto e impactante.
            4. Escribir un RESUMEN narrativo de 2 frases explicando el "Por qué".

            Responde SOLO con este JSON:
            {
              "marketState": "RISK_ON / RISK_OFF / CHOPPY / ALT_SEASON",
              "headline": "Titular corto y directo (max 6 palabras)",
              "summary": "Resumen narrativo del estado del mercado (max 2 frases).",
              "strategy": "BREAKOUTS / DIPS / SCALPING / WAIT",
              "sentimentScore": 0-100 (0=Pánico Extremo, 100=Euforia)
            }`;
    } else if (mode === 'TRADE_DOCTOR') {
        prompt = `Eres "Dr. Market", un cirujano de trading cínico, directo y extremadamente perspicaz. 
            Tu paciente es el par ${symbol}.
            
            DATOS DEL PACIENTE:
            - Precio: $${price}
            - RSI: ${indicators?.rsi || 'N/A'}
            - MACD: ${indicators?.macd || 'N/A'}
            - Bandas Bollinger: ${indicators?.bbPosition || 'N/A'}
            - Señales Previas: ${reasons ? reasons.map(r => r).join(', ') : 'Ninguna'}

            Tu tarea es realizar un DIAGNÓSTICO MÉDICO del chart:
            1. DIAGNÓSTICO: ¿Qué "enfermedad" tiene el precio? (ej: "Agotamiento de Tendencia Aguda", "Fiebre de FOMO", "Soporte Fracturado").
            2. SÍNTOMAS: Lista 3 evidencias técnicas que apoyan tu diagnóstico.
            3. RECETA: ¿Qué debe hacer el trader? (ej: "Reposo absoluto (No operar)", "Inyección de liquidez en $X (Long)", "Amputación de pérdidas (Stop Loss)").
            4. PRONÓSTICO: ¿Sobrevivirá a las próximas 4 horas?

            Responde SOLO con este JSON:
            {
              "diagnosis": "Diagnóstico médico creativo y técnico",
              "symptoms": ["Síntoma 1", "Síntoma 2", "Síntoma 3"],
              "prescription": "Consejo de acción directo",
              "prognosis": "Predicción a corto plazo",
              "healthScore": 0-100 (0=Muerto/Crash, 100=Atleta Olímpico/Pump)
            }`;
    } else if (mode === 'PATTERN_HUNTER') {
        const { prices } = inputData;
        prompt = `Eres "The Pattern Hunter", un algoritmo de IA especializado en reconocimiento de patrones gráficos (Chartismo).
            
            Se te proporciona una serie de precios (Close prices) de un activo:
            [${prices.slice(-60).join(', ')}]
            
            Tu tarea es visualizar la geometría de estos números y buscar patrones clásicos:
            - Hombro-Cabeza-Hombro (H&S) o Inverso
            - Doble Techo / Doble Suelo
            - Cuñas (Wedges) Alcistas/Bajistas
            - Banderas (Flags) y Banderines (Pennants)
            - Triángulos (Ascendentes/Descendentes/Simétricos)

            Analiza la ESTRUCTURA.
            Si no detectas nada claro, sé honesto y di "Ningún patrón claro".

            Responde SOLO con este JSON:
            {
              "detected": true/false,
              "patterns": [
                { 
                  "name": "Nombre del Patrón (ej: Bull Flag)", 
                  "confidence": "High/Medium/Low", 
                  "signal": "BULLISH/BEARISH",
                  "description": "Breve explicación de dónde se ve el patrón."
                }
              ],
              "summary": "Resumen general de la estructura de precios."
            }`;
    } else {
        let modeContext = '';
        if (tradingMode === 'CONSERVATIVE') {
            modeContext = 'El usuario opera en modo CONSERVADOR. Prioriza la preservación de capital. Sé escéptico con señales débiles y busca confirmación de tendencia fuerte.';
        } else if (tradingMode === 'RISKY') {
            modeContext = 'El usuario opera en modo ARRIESGADO. Busca oportunidades de alto rendimiento/riesgo. Acepta mayor volatilidad si el potencial de subida es alto.';
        } else {
            modeContext = 'El usuario opera en modo EQUILIBRADO. Busca un balance entre riesgo y beneficio.';
        }

        prompt = `Eres un experto analista de trading de criptomonedas especializado en day trading en spot.
${modeContext}

Analiza la siguiente oportunidad de trading:

**Contexto de Mercado**:
- Símbolo: ${symbol}
- Precio Actual: $${price}
- Régimen de Mercado Detectado: ${regime || 'Desconocido'}

**Análisis Técnico**:
- RSI: ${indicators.rsi || 'N/A'}
- MACD: ${indicators.macd || 'N/A'}
- ADX: ${indicators.adx || 'N/A'}

**Señales Detectadas**:
${reasons && reasons.length > 0 ? reasons.map(r => `- ${r.text} (Peso: ${r.weight}%)`).join('\n') : 'N/A'}

**Niveles Propuestos (si existen)**:
${levels ? `- Entrada: $${levels.entry}
- Stop Loss: $${levels.stopLoss}
- Take Profit 1: $${levels.takeProfit1}
- Take Profit 2: $${levels.takeProfit2}` : ''}
- Ratio Riesgo/Beneficio: ${riskReward || 'N/A'}

${warnings && warnings.length > 0 ? `**Advertencias**:\n${warnings.map(w => `- ${w}`).join('\n')}` : ''}

Tu tarea:
1. Validar la calidad de la señal considerando el Régimen de Mercado.
2. Criticar los niveles de Stop Loss y Take Profit.
3. Dar un veredicto final.

Responde SOLO con este JSON:
{
  "sentiment": "BULLISH/NEUTRAL/BEARISH",
  "recommendation": "STRONG_BUY/BUY/HOLD/AVOID",
  "insights": ["insight1", "insight2", "insight3"],
  "riskAssessment": "LOW/MEDIUM/HIGH",
  "confidenceScore": 0-100,
  "reasoning": "Step-by-step reasoning explaining the recommendation"
}`;
    }

    try {
        const response = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "HTTP-Referer": window.location.origin, // Opcional, para OpenRouter rankings
                    "X-Title": "Cambixx Bot", // Opcional
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "model": "google/gemini-2.0-flash-exp:free",
                    "messages": [
                        { "role": "system", "content": "Eres un experto asistente de trading especializado en criptomonedas." },
                        { "role": "user", "content": prompt }
                    ],
                    "temperature": 0.3,
                    "max_tokens": 1000
                })
            }
        );

        if (!response.ok) {
            if (response.status === 429) {
                console.warn('⚠️ OpenRouter Rate Limit Hit. Using Fallback.');
                return { success: true, analysis: getFallbackAnalysis(mode), timestamp: new Date().toISOString() };
            }
            throw new Error(`OpenRouter API failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const generatedText = data.choices[0]?.message?.content;

        if (!generatedText) throw new Error('No response from OpenRouter');

        let analysis;
        try {
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
            const jsonText = jsonMatch ? jsonMatch[0] : generatedText;
            analysis = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('Error parsing response:', generatedText);
            analysis = getFallbackAnalysis(mode);
        }

        return { success: true, analysis, timestamp: new Date().toISOString() };
    } catch (error) {
        console.error('Error calling OpenRouter directly:', error);
        return { success: false, error: error.message, analysis: null };
    }
}

function getFallbackAnalysis(mode) {
    if (mode === 'MARKET_ORACLE') {
        return { marketState: 'CHOPPY', headline: 'Market Analysis Paused', summary: 'AI service busy. Proceed with caution.', strategy: 'WAIT', sentimentScore: 50 };
    } else if (mode === 'TRADE_DOCTOR') {
        return { diagnosis: "System Overload", symptoms: ["API Rate Limit", "High Traffic"], prescription: "Wait 60s and retry.", prognosis: "Temporary congestion", healthScore: 50 };
    } else if (mode === 'PATTERN_HUNTER') {
        return { detected: false, patterns: [], summary: "Radar jammed. Retrying..." };
    }
    return { sentiment: 'NEUTRAL', recommendation: 'HOLD', insights: ['System busy, try again later.'], riskAssessment: 'MEDIUM', confidenceScore: 50, reasoning: 'Fallback due to technical issues.' };
}

/**
 * Enviar datos de mercado para análisis con IA
 */
export async function getAIAnalysis(marketData, tradingMode = 'BALANCED') {
    if (isDevelopment) {
        console.log('💡 Usando OpenRouter API directamente (desarrollo)');
        return await callOpenRouterDirectly(marketData, tradingMode);
    }

    try {
        const response = await fetch(NETLIFY_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...marketData, tradingMode })
        });

        if (!response.ok) throw new Error(`AI Analysis failed: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        if (isDevelopment) console.error('Error getting AI analysis:', error);
        return { success: false, error: error.message, analysis: null };
    }
}

export async function getMarketOracleAnalysis(topCoins) {
    return await getAIAnalysis({ mode: 'MARKET_ORACLE', marketData: { topCoins } });
}

export async function getTradeDoctorAnalysis(symbol, price, technicals) {
    return await getAIAnalysis({ mode: 'TRADE_DOCTOR', symbol, price, indicators: technicals.indicators || {}, reasons: technicals.reasons || [] });
}

export async function getPatternAnalysis(symbol, prices) {
    return await getAIAnalysis({ mode: 'PATTERN_HUNTER', symbol, prices: prices || [] });
}

export async function enrichSignalWithAI(signal, technicalData = {}, tradingMode = 'BALANCED') {
    const marketData = {
        symbol: signal.symbol,
        price: signal.price,
        indicators: signal.indicators,
        patterns: signal.patterns,
        reasons: signal.reasons,
        warnings: signal.warnings,
        levels: signal.levels,
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

    return { ...signal, aiEnriched: false, aiError: aiResult.error };
}

class AIAnalysisCache {
    constructor(ttl = 300000) {
        this.cache = new Map();
        this.ttl = ttl;
    }

    getKey(symbol, price) {
        const roundedPrice = Math.round(price / 10) * 10;
        return `${symbol}-${roundedPrice}`;
    }

    get(symbol, price) {
        const key = this.getKey(symbol, price);
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.ttl) return cached.data;
        return null;
    }

    set(symbol, price, data) {
        const key = this.getKey(symbol, price);
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    clear() { this.cache.clear(); }
}

export const aiCache = new AIAnalysisCache();

export async function getCachedAIAnalysis(marketData) {
    const cached = aiCache.get(marketData.symbol, marketData.price);
    if (cached) return cached;

    const analysis = await getAIAnalysis(marketData);
    if (analysis.success) aiCache.set(marketData.symbol, marketData.price, analysis);
    return analysis;
}
