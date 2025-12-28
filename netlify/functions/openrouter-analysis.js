
/**
 * Fallback data if AI fails
 */
function getFallbackAnalysis(mode) {
    if (mode === 'MARKET_ORACLE') {
        return { marketState: 'CHOPPY', headline: 'Market Analysis Paused', summary: 'AI service busy. Proceed with caution.', strategy: 'WAIT', sentimentScore: 50 };
    } else if (mode === 'TRADE_DOCTOR') {
        return { diagnosis: "System Overload", symptoms: ["API Rate Limit", "High Traffic"], prescription: "Wait 60s and retry.", prognosis: "Temporary congestion", healthScore: 50, tradability: "LOW" };
    } else if (mode === 'PATTERN_HUNTER') {
        return { detected: false, patterns: [], summary: "Radar jammed. Retrying..." };
    }
    return { sentiment: 'NEUTRAL', recommendation: 'HOLD', insights: ['System busy, try again later.'], riskAssessment: 'MEDIUM', confidenceScore: 50, reasoning: 'Fallback due to technical issues.' };
}

export async function handler(event, context) {
    // Solo permitir POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Headers CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Manejar preflight request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    try {
        // Obtener API key de variables de entorno (Configurar en Netlify!)
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

        if (!OPENROUTER_API_KEY) {
            console.error('OPENROUTER_API_KEY not found in environment variables');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'API key not configured in Netlify environment variables'
                })
            };
        }

        // Parsear datos del request
        let inputData;
        try {
            inputData = JSON.parse(event.body);
        } catch (parseError) {
            console.error('Error parsing request body:', parseError);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid request body'
                })
            };
        }

        const AI_MODELS = {
            DEFAULT: 'deepseek/deepseek-chat',
            REASONING: 'deepseek/deepseek-chat',
            FAST: 'deepseek/deepseek-chat', // Switched from Gemini to avoid 404s
            FREE: 'google/gemini-2.0-flash-exp:free'
        };

        const { mode, symbol, price, indicators, patterns, reasons, warnings, regime, levels, riskReward, marketData: globalMarketData, tradingMode } = inputData;

        // Seleccionar modelo según el modo
        let selectedModel = AI_MODELS.DEFAULT;
        if (mode === 'MARKET_ORACLE') selectedModel = AI_MODELS.FAST;

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
            // Análisis estándar de señal
            let modeContext = '';
            if (tradingMode === 'CONSERVATIVE') modeContext = 'Prioriza la seguridad.';
            else if (tradingMode === 'RISKY') modeContext = 'Busca alto rendimiento/riesgo.';
            else modeContext = 'Equilibrio riesgo/beneficio.';

            prompt = `Eres analista experto de trading. ${modeContext}
                Par: ${symbol}, Precio: $${price}, Régimen: ${regime || 'Desconocido'}.
                Indicadores: RSI ${indicators?.rsi}, MACD ${indicators?.macd}.
                Señales: ${reasons && reasons.length > 0 ? reasons.map(r => r.text).join(', ') : 'N/A'}.

                Responde SOLO con este JSON:
                {
                  "sentiment": "BULLISH/NEUTRAL/BEARISH",
                  "recommendation": "STRONG_BUY/BUY/HOLD/AVOID",
                  "insights": ["...", "...", "..."],
                  "riskAssessment": "LOW/MEDIUM/HIGH",
                  "confidenceScore": 0-100,
                  "reasoning": "Explicación breve."
                }`;
        }

        // Llamar a OpenRouter con lógica de reintento simple
        let response;
        let retryCount = 0;
        const maxRetries = 1;

        while (retryCount <= maxRetries) {
            response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://cambixx-bot.netlify.app",
                    "X-Title": "Cambixx Bot Production"
                },
                body: JSON.stringify({
                    "model": selectedModel,
                    "messages": [
                        { "role": "system", "content": "Eres un asistente de trading experto. Responde siempre en formato JSON puro." },
                        { "role": "user", "content": prompt }
                    ],
                    "temperature": 0.3
                })
            });

            if (response.ok) break;

            if (response.status === 429 && retryCount < maxRetries) {
                console.warn(`⚠️ Rate limit hit, retrying in 2s... (Attempt ${retryCount + 1})`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                retryCount++;
            } else {
                break;
            }
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ OpenRouter Error (${response.status}):`, errorText);

            // Si es 429 u otro error de limitación, devolvemos un éxito con el fallback
            if (response.status === 429 || response.status === 503) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: true,
                        analysis: getFallbackAnalysis(mode),
                        isFallback: true,
                        error: 'Rate limit hit'
                    })
                };
            }

            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ success: false, error: 'OpenRouter API Error', details: errorText })
            };
        }

        const data = await response.json();
        const generatedText = data.choices[0]?.message?.content;

        if (!generatedText) throw new Error('No content from OpenRouter');

        // Parsear JSON
        const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
        const analysis = JSON.parse(jsonMatch ? jsonMatch[0] : generatedText);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                analysis,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Function error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
}
