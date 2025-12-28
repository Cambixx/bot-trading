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
        const { topCoins, btcDominance, totalVolumeUSD, marketAvgChange, topGainers, topLosers } = globalMarketData || {};

        prompt = `Eres un estratega jefe de mercado de criptomonedas (Chief Market Strategist).
            Tu trabajo es analizar la "Salud del Mercado" global y dar una directriz clara para el día.

            DATOS DEL MERCADO GLOBAL:
            - Dominancia BTC: ${btcDominance}% (Si sube, BTC absorbe liquidez; si baja, dinero fluye a Alts)
            - Volumen Total 24h: $${totalVolumeUSD}
            - Cambio Promedio Mercado: ${marketAvgChange}
            
            GANADORES (Heat): ${topGainers?.map(g => `${g.symbol} (${g.change}%)`).join(', ')}
            PERDEDORES: ${topLosers?.map(l => `${l.symbol} (${l.change}%)`).join(', ')}
            
            DETALLE TOP ASSETS:
            ${JSON.stringify(topCoins?.slice(0, 10), null, 2)}

            Tu tarea:
            1. Analizar el SENTIMIENTO GENERAL: ¿Hay apetito por el riesgo (Risk-On) o miedo (Risk-Off)?
            2. Definir el ESTADO DEL MERCADO: RISK_ON, RISK_OFF, CHOPPY, ALT_SEASON.
            3. Redactar un TITULAR impactante basado en los datos.
            4. Escribir un RESUMEN narrativo explicando el flujo de dinero (BTC vs Alts).
            5. Sugerir 2-3 "MONEDAS A VIGILAR" hoy y el TIME-FRAME sugerido (ej: 15m para Scalping, 1H para Intraday).

            Responde SOLO con este JSON:
            {
              "marketState": "RISK_ON / RISK_OFF / CHOPPY / ALT_SEASON",
              "headline": "Titular corto y directo (max 6 palabras)",
              "summary": "Resumen narrativo del estado del mercado (max 2 frases).",
              "strategy": "BREAKOUTS / DIPS / SCALPING / WAIT",
              "sentimentScore": 0-100 (0=Pánico, 100=Euforia),
              "coinsToWatch": ["BTCUSDC", "SYMBOL"],
              "suggestedTimeframe": "15m / 1h / 4h",
              "volatility": "LOW / MEDIUM / HIGH"
            }`;
    } else if (mode === 'TRADE_DOCTOR') {
        prompt = `Eres "Dr. Market", un cirujano de day trading cínico, directo y extremadamente perspicaz.
            Tu paciente es el par ${symbol} a $${price}.
            
            DATOS CLÍNICOS MULTI-TIMEFRAME:
            📊 RSI 15m: ${indicators?.rsi15m || 'N/A'} | RSI 1H: ${indicators?.rsi1h || 'N/A'}
            📈 MACD 15m: ${indicators?.macd15m || 'N/A'} | MACD 1H: ${indicators?.macd1h || 'N/A'}
            📉 Bollinger: ${indicators?.bbPosition || 'N/A'}
            💪 ADX 1H: ${indicators?.adx1h || 'N/A'} (Fuerza de tendencia)
            🔥 Tendencia 1H: ${indicators?.trend1h || 'N/A'}
            📊 ATR 1H: ${indicators?.atr1h || 'N/A'} (${indicators?.atrPercent || 'N/A'} volatilidad)
            📢 Volumen: ${indicators?.volumeRatio || 'N/A'} (Estado: ${indicators?.volumeStatus || 'N/A'})

            Tu tarea como ESPECIALISTA EN DAY TRADING:
            1. DIAGNÓSTICO: ¿Qué "enfermedad" tiene el precio? (ej: "Agotamiento de Momentum", "Fiebre de FOMO", "Consolidación Lateral", "Breakout Inminente").
            2. SÍNTOMAS: Lista 3-4 evidencias técnicas que apoyan tu diagnóstico usando los datos multi-timeframe.
            3. RECETA: ¿Qué debe hacer el trader AHORA? Sé específico (ej: "Long si rompe $X con stop en $Y", "Esperar pullback a EMA21", "No tocar, muy choppy").
            4. NIVELES CRÍTICOS: Sugiere Entry, Stop Loss y Take Profit basados en el ATR.
            5. PRONÓSTICO: ¿Qué esperar en las próximas 1-4 horas?

            Responde SOLO con este JSON:
            {
              "diagnosis": "Diagnóstico médico creativo y técnico",
              "symptoms": ["Síntoma 1 con datos", "Síntoma 2 con datos", "Síntoma 3 con datos"],
              "prescription": "Consejo de acción directo y específico",
              "levels": {
                "entry": "Precio de entrada sugerido o 'Esperar'",
                "stopLoss": "Nivel de SL basado en ATR",
                "takeProfit": "Nivel de TP con ratio R:R"
              },
              "prognosis": "Predicción a corto plazo (1-4h)",
              "tradability": "HIGH/MEDIUM/LOW (qué tan operable es ahora)",
              "healthScore": 0-100 (0=Crash inminente, 100=Pump fuerte)
            }`;
    } else if (mode === 'PATTERN_HUNTER') {
        const { prices, context } = inputData;
        // prices can be array of close prices OR array of OHLCV objects
        const isOHLCV = prices && prices[0] && typeof prices[0] === 'object';

        let priceData = '';
        if (isOHLCV) {
            // Format OHLCV for better pattern detection
            const last20 = prices.slice(-20);
            priceData = last20.map((c, i) =>
                `${i + 1}: O:${c.open?.toFixed(2)} H:${c.high?.toFixed(2)} L:${c.low?.toFixed(2)} C:${c.close?.toFixed(2)} V:${(c.volume / 1000).toFixed(0)}k`
            ).join('\n');
        } else if (prices && Array.isArray(prices)) {
            priceData = prices.slice(-30).join(', ');
        } else {
            priceData = 'No price data available';
        }

        prompt = `Eres "The Pattern Hunter", un algoritmo de IA especializado en análisis técnico y reconocimiento de patrones gráficos para DAY TRADING.
            
            DATOS OHLCV (Últimas 20 velas, 1H):
            ${priceData}
            
            CONTEXTO DE VOLUMEN:
            ${context ? `Tendencia: ${context.volumeTrend}, Volumen promedio: ${context.avgVolume?.toFixed(0)}` : 'No disponible'}
            ${context?.priceRange ? `Rango 24h: $${context.priceRange.low24h?.toFixed(2)} - $${context.priceRange.high24h?.toFixed(2)} | Actual: $${context.priceRange.current?.toFixed(2)}` : ''}
            
            Tu tarea es analizar la ESTRUCTURA DE PRECIOS y buscar:
            1. PATRONES CLÁSICOS: H&S, Doble Techo/Suelo, Cuñas, Banderas, Triángulos
            2. SOPORTES Y RESISTENCIAS: Niveles clave basados en los highs/lows
            3. BREAKOUT ZONES: Dónde se activaría el patrón
            4. TARGETS: Objetivo estimado basado en el patrón
            
            IMPORTANTE: 
            - El volumen DEBE confirmar los patrones (volumen creciente en breakouts)
            - Sé HONESTO: si no hay patrón claro, dilo
            - Da NIVELES ESPECÍFICOS para operar

            Responde SOLO con este JSON:
            {
              "detected": true/false,
              "patterns": [
                { 
                  "name": "Nombre del Patrón", 
                  "confidence": "High/Medium/Low", 
                  "signal": "BULLISH/BEARISH",
                  "description": "Dónde se ve el patrón",
                  "breakoutLevel": "Precio de activación",
                  "target": "Objetivo del patrón",
                  "stopLoss": "Stop sugerido",
                  "volumeConfirmed": true/false
                }
              ],
              "keyLevels": {
                "resistance": "Nivel de resistencia principal",
                "support": "Nivel de soporte principal"
              },
              "summary": "Resumen ejecutivo para day trading",
              "actionable": "NOW/WAIT/AVOID"
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
        // Validate API key
        if (!OPENROUTER_API_KEY) {
            console.error('❌ OpenRouter API Key no configurada');
            console.warn('💡 Configura VITE_OPENROUTER_API_KEY en tu archivo .env');
            return {
                success: false,
                error: 'API Key no configurada. Revisa la configuración.',
                analysis: getFallbackAnalysis(mode)
            };
        }

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
            if (response.status === 429 || response.status === 503) {
                console.warn('⚠️ OpenRouter Rate Limit Hit or Service Unavailable. Using Fallback.');
                return {
                    success: true,
                    analysis: getFallbackAnalysis(mode),
                    timestamp: new Date().toISOString(),
                    isFallback: true,
                    error: 'Rate limit hit'
                };
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

export async function getMarketOracleAnalysis(marketData) {
    return await getAIAnalysis({ mode: 'MARKET_ORACLE', marketData });
}

export async function getTradeDoctorAnalysis(symbol, price, technicals) {
    return await getAIAnalysis({
        mode: 'TRADE_DOCTOR',
        symbol,
        price,
        indicators: technicals.indicators || {},
        reasons: technicals.reasons || []
    });
}

export async function getPatternAnalysis(symbol, prices, context) {
    // Validate inputs
    if (!symbol) {
        console.error('❌ Pattern Analysis: Symbol is required');
        return { success: false, error: 'Symbol is required', analysis: null };
    }

    if (!prices || !Array.isArray(prices) || prices.length === 0) {
        console.error('❌ Pattern Analysis: Invalid or empty prices array');
        return { success: false, error: 'Invalid price data', analysis: null };
    }

    console.log('🔍 Pattern Analysis Request:', {
        symbol,
        pricesCount: prices.length,
        hasContext: !!context
    });

    return await getAIAnalysis({ mode: 'PATTERN_HUNTER', symbol, prices: prices || [], context });
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
