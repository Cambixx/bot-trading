/**
 * Netlify Serverless Function para análisis con IA usando OpenRouter
 * Sustituye a gemini-analysis.js con soporte multimodelo y mayor flexibilidad
 */

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

        const { mode, symbol, price, indicators, patterns, reasons, warnings, regime, levels, riskReward, marketData: globalMarketData, tradingMode } = inputData;

        let prompt = '';

        if (mode === 'MARKET_ORACLE') {
            const { topCoins } = globalMarketData || {};
            prompt = `Eres un estratega jefe de mercado de criptomonedas (Chief Market Strategist).
                Tu trabajo es analizar la "Salud del Mercado" global y dar una directriz clara para el día.

                DATOS DEL MERCADO GLOBAL (Top Assets):
                ${JSON.stringify(topCoins, null, 2)}

                Tu tarea:
                1. Analizar el SENTIMIENTO GENERAL.
                2. Definir el ESTADO DEL MERCADO (RISK_ON, RISK_OFF, CHOPPY, ALT_SEASON).
                3. Redactar titular y resumen narrativo.

                Responde SOLO con este JSON:
                {
                  "marketState": "RISK_ON / RISK_OFF / CHOPPY / ALT_SEASON",
                  "headline": "Titular corto (max 6 palabras)",
                  "summary": "Resumen narrativo (max 2 frases).",
                  "strategy": "BREAKOUTS / DIPS / SCALPING / WAIT",
                  "sentimentScore": 0-100
                }`;
        } else if (mode === 'TRADE_DOCTOR') {
            prompt = `Eres "Dr. Market", un cirujano de trading. Tu paciente: ${symbol}.
                - Precio: $${price}
                - RSI: ${indicators?.rsi || 'N/A'}
                - MACD: ${indicators?.macd || 'N/A'}
                - Bandas Bollinger: ${indicators?.bbPosition || 'N/A'}
                - Señales: ${reasons ? reasons.map(r => r).join(', ') : 'Ninguna'}

                Responde SOLO con este JSON:
                {
                  "diagnosis": "Diagnóstico médico creativo",
                  "symptoms": ["Síntoma 1", "Síntoma 2", "Síntoma 3"],
                  "prescription": "Consejo de acción",
                  "prognosis": "Predicción corto plazo",
                  "healthScore": 0-100
                }`;
        } else if (mode === 'PATTERN_HUNTER') {
            const { prices } = inputData;
            prompt = `Eres "The Pattern Hunter". Analiza esta serie de precios de cierre:
                [${prices?.slice(-60).join(', ')}]

                Busca patrones clásicos (H&S, Cuñas, Banderas, etc.).
                Responde SOLO con este JSON:
                {
                  "detected": true/false,
                  "patterns": [
                    { "name": "Nombre", "confidence": "High/Med/Low", "signal": "BULLISH/BEARISH", "description": "..." }
                  ],
                  "summary": "Resumen estructural."
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

        // Llamar a OpenRouter
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "deepseek/deepseek-chat",
                "messages": [
                    { "role": "system", "content": "Eres un asistente de trading experto. Responde siempre en formato JSON puro." },
                    { "role": "user", "content": prompt }
                ],
                "temperature": 0.3
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ OpenRouter Error (${response.status}):`, errorText);
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
