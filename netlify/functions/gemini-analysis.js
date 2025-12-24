/**
 * Netlify Serverless Function para análisis con Gemini AI
 * Protege la API key del lado del servidor
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
        // Obtener API key de variables de entorno
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

        console.log('Environment check:', {
            hasApiKey: !!GEMINI_API_KEY,
            apiKeyLength: GEMINI_API_KEY?.length || 0
        });

        if (!GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY not found in environment variables');
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

        const { mode, symbol, price, indicators, patterns, reasons, warnings, marketData: globalMarketData } = inputData;

        let prompt = '';

        if (mode === 'MARKET_ORACLE') {
            // PROMPT FOR MARKET ORACLE (MACRO ANALYSIS)
            const { topCoins, volume24h, dominance } = globalMarketData || {};

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
            // PROMPT FOR TRADE DOCTOR (DIAGNOSTIC)
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
            // PROMPT FOR PATTERN HUNTER (GEOMETRIC ANALYSIS)
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
            // STANDARD PROMPT (SINGLE ASSET)
            prompt = `Eres un experto analista de trading de criptomonedas especializado en day trading en spot (comprar bajo, vender alto).

            Analiza la siguiente oportunidad de trading:

            **Criptomoneda**: ${symbol}
            **Precio Actual**: $${price}

            **Indicadores Técnicos**:
            - RSI: ${indicators?.rsi || 'N/A'}
            - MACD: ${indicators?.macd || 'N/A'}
            - Posición en Bandas de Bollinger: ${indicators?.bbPosition || 'N/A'}

            **Patrones Detectados**: ${patterns && patterns.length > 0 ? patterns.join(', ') : 'Ninguno'}

            **Razones para Compra**:
            ${reasons ? reasons.map(r => `- ${r}`).join('\n') : 'N/A'}

            ${warnings && warnings.length > 0 ? `**Advertencias**:\n${warnings.map(w => `- ${w}`).join('\n')}` : ''}

            Proporciona un análisis conciso en formato JSON con la siguiente estructura:
            {
              "sentiment": "BULLISH/NEUTRAL/BEARISH",
              "recommendation": "STRONG_BUY/BUY/HOLD/AVOID",
              "insights": ["insight1", "insight2", "insight3"],
              "riskAssessment": "LOW/MEDIUM/HIGH",
              "reasoning": "Step-by-step reasoning explaining the recommendation"
            }

            Responde SOLO con el JSON, sin texto adicional. Asegúrate de incluir el campo "reasoning" con tu proceso de pensamiento.`;
        }

        // Llamar a Gemini API (usando formato correcto según documentación oficial)
        // Usamos Gemini 2.0 Flash (Stable)
        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': GEMINI_API_KEY
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
            const errorText = await response.text();
            console.error(`❌ Gemini API Error (${response.status}):`, errorText);

            if (response.status === 429) {
                console.warn('⚠️ Gemini Rate Limit Hit (429).');
                // ... (existing 429 logic if any, or just throw to let client handle)
            }

            return {
                statusCode: response.status,
                headers, // Include headers for CORS
                body: JSON.stringify({ success: false, error: `Gemini API Error: ${response.statusText}`, details: errorText })
            };
        }

        const data = await response.json();

        // Extraer respuesta
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!generatedText) {
            throw new Error('No response from Gemini');
        }

        // Parsear JSON de la respuesta
        let analysis;
        try {
            // Intentar extraer JSON si viene con markdown
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
            const jsonText = jsonMatch ? jsonMatch[0] : generatedText;
            analysis = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('Error parsing Gemini response:', generatedText);
            // Retornar análisis por defecto
            analysis = {
                sentiment: 'NEUTRAL',
                recommendation: 'HOLD',
                insights: ['Análisis no disponible, usar solo indicadores técnicos'],
                riskAssessment: 'MEDIUM'
            };
        }

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
            body: JSON.stringify({
                success: false,
                error: error.message,
                analysis: null
            })
        };
    }
}
