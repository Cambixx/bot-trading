/**
 * Fallback data if AI fails
 */
function getFallbackAnalysis(mode) {
    if (mode === 'MARKET_ORACLE') {
        return {
            marketState: 'CHOPPY',
            headline: 'Data Feed Interrupted',
            summary: 'Unable to calculate global market regime. Maintain neutral positioning.',
            strategy: 'WAIT',
            sentimentScore: 50,
            volatility: 'LOW',
            coinsToWatch: ['BTCUSDC']
        };
    } else if (mode === 'TRADE_DOCTOR') {
        return {
            diagnosis: "Connection Lost",
            symptoms: ["Vital signs missing", "Telemetry offline"],
            prescription: "Check internet connection and retry.",
            prognosis: "Unknown",
            healthScore: 50,
            tradability: "LOW"
        };
    } else if (mode === 'PATTERN_HUNTER') {
        return {
            detected: false,
            patterns: [],
            summary: "Pattern recognition module offline.",
            actionable: "NO_TRADE"
        };
    } else if (mode === 'NEXUS') {
        return {
            success: true,
            sentiment: { score: 50, label: 'NEUTRAL', summary: 'System recalibrating. Using technical baseline.' },
            hotlist: [],
            marketStats: { volatility: 'MEDIUM', trend: 'RANGE', btcDominance: '0%' }
        };
    }
    return { sentiment: 'NEUTRAL', recommendation: 'HOLD', insights: ['System busy.'], riskAssessment: 'MEDIUM', confidenceScore: 50, reasoning: 'Fallback.' };
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
        // Check both with and without VITE_ prefix for local dev compatibility
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY;
        const NEWS_API_KEY = process.env.NEWS_API_KEY || process.env.VITE_NEWS_API_KEY;

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

        // Cost optimization: Use FREE models for most operations
        const AI_MODELS = {
            DEFAULT: 'google/gemini-2.0-flash-exp:free',     // FREE - General analysis
            REASONING: 'deepseek/deepseek-chat',              // Paid - Only for Trade Doctor
            FAST: 'google/gemini-2.0-flash-exp:free',         // FREE - Quick validation
            FREE: 'google/gemini-2.0-flash-exp:free',         // FREE - Explicit free
            NEXUS: 'google/gemini-2.0-flash-exp:free',        // FREE - Market intelligence
            ORACLE: 'google/gemini-2.0-flash-exp:free'        // FREE - Market Oracle
        };

        const { mode, symbol, price, indicators, patterns, reasons, warnings, regime, levels, riskReward, marketData: globalMarketData, tradingMode } = inputData;
        const safeIndicators = indicators || {};


        // Seleccionar modelo según el modo
        let selectedModel = AI_MODELS.DEFAULT;
        if (mode === 'TRADE_DOCTOR') selectedModel = AI_MODELS.REASONING;
        if (mode === 'MARKET_ORACLE') selectedModel = AI_MODELS.FAST;
        if (mode === 'NEXUS') selectedModel = AI_MODELS.NEXUS;
        if (mode === 'PATTERN_HUNTER') selectedModel = AI_MODELS.FAST;

        let prompt = '';

        if (mode === 'MARKET_ORACLE') {
            const { topCoins, btcDominance, totalVolumeUSD, marketAvgChange, topGainers, topLosers } = globalMarketData || {};

            // 1. Fetch News
            let newsContext = "No real-time news available.";
            try {
                if (NEWS_API_KEY) {
                    const newsResponse = await fetch(`https://newsapi.org/v2/everything?q=crypto OR bitcoin OR ethereum&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`);
                    if (newsResponse.ok) {
                        const newsData = await newsResponse.json();
                        if (newsData.articles) {
                            newsContext = newsData.articles.map(a => `- ${a.title} (${a.source.name})`).join('\n');
                        }
                    } else {
                        console.warn("NewsAPI Error:", newsResponse.status);
                    }
                }
            } catch (err) {
                console.warn("News Fetch Error:", err);
            }

            prompt = `Eres un Analista Cuantitatvo de Mercado (Quant Analyst) y un experto en Geopolítica Financiera.
                Tu trabajo es sintetizar los DATOS TÉCNICOS con las NOTICIAS GLOBALES para ofrecer una visión de mercado profunda y profesional.

                NOTICIAS DE ÚLTIMA HORA (NewsAPI):
                ${newsContext}

                DATOS DEL MERCADO GLOBAL (Binance USDC):
                - Dominancia BTC: ${btcDominance}%
                - Volumen Total 24h: $${totalVolumeUSD}
                - Cambio Promedio (Top 20): ${marketAvgChange}
                
                MOMENTUM DEL MERCADO:
                - Ganadores (Hot): ${topGainers?.map(g => `${g.symbol} (${g.change}%)`).join(', ')}
                - Perdedores (Cold): ${topLosers?.map(l => `${l.symbol} (${l.change}%)`).join(', ')}

                Tu tarea:
                1. DETERMINAR RÉGIMEN: Cruza los datos técnicos con las noticias. ¿El mercado sube por fundamentales o solo por flujo?
                2. GENERAR NARRATIVA: Escribe un análisis detallado (2-3 oraciones) que explique POR QUÉ el mercado se mueve así, citando las noticias si son relevantes.
                3. IDENTIFICAR DRIVER: ¿Cuál es el evento principal? (Fed, Guerra, Earnings, o "Technical Rebound").

                Responde SOLO con este JSON:
                {
                  "marketState": "RISK_ON / RISK_OFF / BTC_LED / ALT_SEASON / CHOPPY",
                  "headline": "Titular Profesional e Impactante (basado en noticias/datos)",
                  "summary": "Análisis rico y contextual. Úsalo para explicar la correlación entre las noticias y el precio. Sé específico.",
                  "keyDriver": "El factor principal moviendo el mercado hoy (ej: 'Datos de inflación de EE.UU.')",
                  "strategy": "MOMENTUM / MEAN_REVERSION / SCALPING / WAIT",
                  "sentimentScore": 0-100,
                  "coinsToWatch": ["SYMBOL1", "SYMBOL2"],
                  "suggestedTimeframe": "5m / 15m / 1h",
                  "volatility": "LOW / MEDIUM / HIGH"
                }`;
        } else if (mode === 'TRADE_DOCTOR') {
            prompt = `Eres "Dr. Market", un algoritmo de diagnóstico de trading. Eres cínico, técnico y directo.
                Tu paciente es el par ${symbol} a $${price}.
                
                SIGNOS VITALES (Datos Reales):
                - RSI: 15m=${safeIndicators?.rsi15m} | 1H=${safeIndicators?.rsi1h}
                - MACD: 15m=${safeIndicators?.macd15m} | 1H=${safeIndicators?.macd1h}
                - Tendencia (EMA): ${safeIndicators?.trend1h}
                - Volatilidad (ATR): ${safeIndicators?.atrPercent}
                - Volumen: ${safeIndicators?.volumeRatio} (${safeIndicators?.volumeStatus})
                - Bollinger: ${safeIndicators?.bbPosition}

                TU DIAGNÓSTICO PROFESIONAL:
                1. Analiza la congruencia de los indicadores. ¿Confirman una dirección o divergen?
                2. Identifica la condición: Sobrecompra, Sobreventa, Acumulación, Distribución, o Extensión de Tendencia.
                3. RECETA: Da una instrucción precisa. Si no hay setup claro, receta "PACIENCIA".

                Responde SOLO con este JSON:
                {
                  "diagnosis": "Diagnóstico técnico corto (ej: 'Divergencia Bajista en 1H')",
                  "symptoms": ["RSI en sobrecompra", "Volumen decreciente", "Rechazo en BB Superior"],
                  "prescription": "Instrucción clara (ej: 'Buscar cortos en rebote a $XXXX')",
                  "levels": {
                    "entry": "Precio ideal o 'NOW'",
                    "stopLoss": "Precio exacto",
                    "takeProfit": "Precio exacto"
                  },
                  "prognosis": "Proyección técnica probable",
                  "tradability": "HIGH (Setup claro) / MEDIUM / LOW (Riesgo alto/Confuso)",
                  "healthScore": 0-100 (Salud de la tendencia/movimiento)
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

            prompt = `Eres "The Pattern Hunter". Tu ÚNICO trabajo es encontrar patrones geométricos validos en los datos OHLCV proporcionados. Eres escéptico: si no hay patrón, di que no hay.

                DATOS OHLCV (1H, Últimas 20 velas):
                ${priceData}
                
                CONTEXTO:
                Precio Actual: ${context?.priceRange?.current?.toFixed(2)}
                Tendencia Volumen: ${context?.volumeTrend}

                TAREA DE RECONOCIMIENTO:
                Busca patrones de libro de texto:
                - Triángulos (Ascendente/Descendente/Simétrico)
                - Banderas / Banderines
                - Doble Suelo / Doble Techo
                - Hombro-Cabeza-Hombro (Normal/Invertido)

                REGLAS:
                1. El patrón debe ser visible en las últimas 20 velas.
                2. El volumen debe apoyar la formación.
                3. Calcula Targets y Stop Loss basados en la altura del patrón.

                Responde SOLO con este JSON:
                {
                  "detected": true/false,
                  "patterns": [
                    { 
                      "name": "Nombre Exacto (ej: Bull Flag)", 
                      "confidence": "High/Medium/Low", 
                      "signal": "BULLISH/BEARISH",
                      "description": "Breve descripción técnica",
                      "breakoutLevel": "Nivel de ruptura exacto",
                      "target": "Nivel objetivo",
                      "stopLoss": "Validación de fallo",
                      "volumeConfirmed": true/false
                    }
                  ],
                  "keyLevels": {
                    "resistance": "Resistencia más cercana",
                    "support": "Soporte más cercano"
                  },
                  "summary": "Resumen técnico de la estructura de mercado.",
                  "actionable": "ENTER_NOW / WAIT_BREAKOUT / WAIT_PULLBACK / NO_TRADE"
                }`;
        } else if (mode === 'NEXUS') {
            const { btcDominance, totalVolumeUSD, marketAvgChange, topGainers, topLosers } = globalMarketData || {};

            prompt = `Eres "Nexus Intelligence", un mentor de Day Trading profesional que analiza datos en tiempo real para traders de alto rendimiento.
            
            DATOS REALES DEL MERCADO (Binance USDC Pairs):
            - Dominancia BTC (Proxy en Binance): ${btcDominance}%
            - Volumen Total 24h: $${totalVolumeUSD}
            - Cambio Promedio Top 20: ${marketAvgChange}
            - Top Ganadores (Momentum): ${topGainers?.map(g => `${g.symbol} (+${g.change}%)`).join(', ')}
            - Top Perdedores (Corrección): ${topLosers?.map(l => `${l.symbol} (${l.change}%)`).join(', ')}

            TU MISIÓN:
            Analizar estos datos empíricos para dar una dirección de trading clara. NO inventes noticias ni datos macro que no tienes. Basa tu análisis SOLO en la estructura del mercado actual.
            
            1. SENTIMIENTO TÉCNICO: Basado en el avance/retroceso de los activos y el volumen.
            2. FOCUS LIST: Selecciona 2-3 monedas de los 'Top Ganadores' que parezcan tener continuación o monedas volátiles para day trading.
            3. ESTRATEGIA DEL DÍA: ¿Es día de scalp rápido, de swing, o de no operar?

            Responde SOLO con este JSON:
            {
              "success": true,
              "sentiment": {
                "score": 0-100,
                "label": "BEARISH / NEUTRAL / BULLISH / EUPHORIA",
                "summary": "Análisis técnico conciso de la situación actual."
              },
              "hotlist": [
                { "symbol": "SYMBOL", "reason": "Breve motivo técnico (ej: ruptura de volumen)", "action": "Watch for Long/Short" }
              ],
              "marketStats": {
                "volatility": "LOW/MEDIUM/HIGH",
                "trend": "UP/DOWN/RANGE",
                "btcDominance": "${btcDominance}%"
              }
            }`;
        } else {
            // Análisis estándar de señal
            let modeContext = '';
            if (tradingMode === 'CONSERVATIVE') modeContext = 'Prioriza la seguridad.';
            else if (tradingMode === 'RISKY') modeContext = 'Busca alto rendimiento/riesgo.';
            else modeContext = 'Equilibrio riesgo/beneficio.';

            prompt = `Eres analista experto de trading. ${modeContext}
                Par: ${symbol}, Precio: $${price}, Régimen: ${regime || 'Desconocido'}.
                Indicadores: RSI ${safeIndicators?.rsi}, MACD ${safeIndicators?.macd}.
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
