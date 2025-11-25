/**
 * Servicio para análisis con IA usando Gemini API
 * Se comunica con la función serverless de Netlify
 */

const NETLIFY_FUNCTION_URL = '/.netlify/functions/gemini-analysis';

/**
 * Enviar datos de mercado para análisis con IA
 * @param {Object} marketData - Datos del mercado y análisis técnico
 * @returns {Promise<Object>} Análisis de IA
 */
export async function getAIAnalysis(marketData) {
    try {
        const response = await fetch(NETLIFY_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(marketData)
        });

        if (!response.ok) {
            throw new Error(`AI Analysis failed: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error getting AI analysis:', error);
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
 * @returns {Promise<Object>} Señal enriquecida con análisis IA
 */
export async function enrichSignalWithAI(signal, technicalData = {}) {
    const marketData = {
        symbol: signal.symbol,
        price: signal.price,
        indicators: signal.indicators,
        patterns: signal.patterns,
        reasons: signal.reasons,
        warnings: signal.warnings,
        ...technicalData
    };

    const aiResult = await getAIAnalysis(marketData);

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

    // Si falla el análisis de IA, retornar señal original
    return {
        ...signal,
        aiEnriched: false,
        aiError: aiResult.error
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
