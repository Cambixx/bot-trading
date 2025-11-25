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
        let marketData;
        try {
            marketData = JSON.parse(event.body);
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

        const { symbol, price, indicators, patterns, reasons, warnings } = marketData;

        // Construir prompt para Gemini
        const prompt = `Eres un experto analista de trading de criptomonedas especializado en day trading en spot (comprar bajo, vender alto).

Analiza la siguiente oportunidad de trading:

**Criptomoneda**: ${symbol}
**Precio Actual**: $${price}

**Indicadores Técnicos**:
- RSI: ${indicators.rsi || 'N/A'}
- MACD: ${indicators.macd || 'N/A'}
- Posición en Bandas de Bollinger: ${indicators.bbPosition || 'N/A'}

**Patrones Detectados**: ${patterns && patterns.length > 0 ? patterns.join(', ') : 'Ninguno'}

**Razones para Compra**:
${reasons.map(r => `- ${r}`).join('\n')}

${warnings && warnings.length > 0 ? `**Advertencias**:\n${warnings.map(w => `- ${w}`).join('\n')}` : ''}

Proporciona un análisis conciso en formato JSON con la siguiente estructura:
{
  "sentiment": "BULLISH/NEUTRAL/BEARISH",
  "recommendation": "STRONG_BUY/BUY/HOLD/AVOID",
  "insights": ["insight1", "insight2", "insight3"],
  "riskAssessment": "LOW/MEDIUM/HIGH"
}

Responde SOLO con el JSON, sin texto adicional.`;

        // Llamar a Gemini API
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
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
                        maxOutputTokens: 500
                    }
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.text();
            console.error('Gemini API error:', errorData);
            throw new Error(`Gemini API failed: ${response.statusText}`);
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
