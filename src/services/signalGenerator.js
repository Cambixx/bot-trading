import { performTechnicalAnalysis } from './technicalAnalysis';

/**
 * Generador de señales de trading para day trading spot
 * Enfocado en identificar oportunidades de COMPRA (buy low, sell high)
 */

/**
 * Generar señal de trading basada en análisis técnico
 * @param {Object} analysis - Análisis técnico del símbolo
 * @param {string} symbol - Símbolo de la criptomoneda
 * @param {Object} multiTimeframeData - Datos de múltiples timeframes (opcional)
 * @returns {Object|null} Señal de trading o null si no hay señal
 */
export function generateSignal(analysis, symbol, multiTimeframeData = null) {
    const { indicators, levels, patterns, volume, price } = analysis;

    let score = 0;
    const reasons = [];
    const warnings = [];

    // === ANÁLISIS RSI ===
    if (indicators.rsi !== null) {
        if (indicators.rsi < 30) {
            score += 25;
            reasons.push('RSI sobreventa (<30)');
        } else if (indicators.rsi < 40) {
            score += 15;
            reasons.push('RSI bajo (<40)');
        } else if (indicators.rsi > 70) {
            score -= 20;
            warnings.push('RSI sobrecompra (>70)');
        }
    }

    // === ANÁLISIS MACD ===
    if (indicators.macd.histogram !== null) {
        // Crossover bullish (histograma cambia de negativo a positivo)
        if (indicators.macd.histogram > 0 && indicators.macd.value > indicators.macd.signal) {
            score += 20;
            reasons.push('MACD cruce alcista');
        }
        // Divergencia o momentum positivo
        if (indicators.macd.histogram > 0) {
            score += 10;
            reasons.push('MACD momentum positivo');
        }
    }

    // === ANÁLISIS BOLLINGER BANDS ===
    if (indicators.bollingerBands.lower !== null) {
        const distanceToLower = ((price - indicators.bollingerBands.lower) / price) * 100;

        // Precio cerca o debajo de banda inferior (oportunidad de compra)
        if (price <= indicators.bollingerBands.lower) {
            score += 20;
            reasons.push('Precio en banda inferior de Bollinger');
        } else if (distanceToLower < 2) {
            score += 15;
            reasons.push('Precio cerca de banda inferior');
        }

        // Precio cerca de banda superior (evitar compra)
        const distanceToUpper = ((indicators.bollingerBands.upper - price) / price) * 100;
        if (distanceToUpper < 2) {
            score -= 15;
            warnings.push('Precio cerca de banda superior');
        }
    }

    // === ANÁLISIS EMA ===
    if (indicators.ema20 !== null && indicators.ema50 !== null) {
        // Golden cross (EMA20 cruza por arriba de EMA50)
        if (indicators.ema20 > indicators.ema50) {
            score += 15;
            reasons.push('EMA20 > EMA50 (tendencia alcista)');
        }

        // Precio por debajo de EMAs (posible rebote)
        if (price < indicators.ema20 && price < indicators.ema50) {
            score += 10;
            reasons.push('Precio bajo EMAs (posible rebote)');
        }
    }

    // Tendencia general con SMA200
    if (indicators.sma200 !== null && price > indicators.sma200) {
        score += 10;
        reasons.push('Precio sobre SMA200 (tendencia alcista largo plazo)');
    }

    // === ANÁLISIS DE SOPORTE/RESISTENCIA ===
    const distanceToSupport = ((price - levels.support) / price) * 100;

    if (distanceToSupport < 2) {
        score += 20;
        reasons.push('Precio cerca de soporte');
    } else if (distanceToSupport < 5) {
        score += 10;
        reasons.push('Precio acercándose a soporte');
    }

    // === PATRONES DE VELAS ===
    if (patterns.hammer) {
        score += 15;
        reasons.push('Patrón Hammer detectado');
    }

    if (patterns.bullishEngulfing) {
        score += 20;
        reasons.push('Patrón Engulfing Alcista detectado');
    }

    if (patterns.doji) {
        score += 5;
        reasons.push('Patrón Doji (indecisión)');
    }

    // === ANÁLISIS DE VOLUMEN ===
    if (volume.spike) {
        score += 15;
        reasons.push('Volumen inusualmente alto');
    }

    // === ANÁLISIS MULTI-TIMEFRAME (si está disponible) ===
    if (multiTimeframeData && multiTimeframeData['4h']) {
        // Usar análisis de 4h para confirmar tendencia
        const tf4h = multiTimeframeData['4h'];
        if (tf4h.indicators && tf4h.indicators.ema20 && tf4h.indicators.ema50) {
            if (tf4h.indicators.ema20 > tf4h.indicators.ema50) {
                score += 10;
                reasons.push('Tendencia alcista en 4h');
            }
        }
    }

    // === DETERMINAR SI GENERAR SEÑAL ===
    // Solo generar señal si el score es suficientemente alto (umbral: 50)
    if (score < 50) {
        return null;
    }

    // Calcular niveles de entrada, stop loss y take profit
    const entryPrice = price;
    const stopLoss = levels.support * 0.98; // 2% debajo del soporte
    const takeProfit1 = price * 1.02; // 2% de ganancia
    const takeProfit2 = price * 1.05; // 5% de ganancia
    const riskRewardRatio = (takeProfit1 - entryPrice) / (entryPrice - stopLoss);

    return {
        symbol,
        type: 'BUY',
        timestamp: new Date().toISOString(),
        price: entryPrice,
        score: Math.min(score, 100), // Cap a 100
        confidence: score >= 80 ? 'HIGH' : score >= 65 ? 'MEDIUM' : 'LOW',
        reasons,
        warnings,
        levels: {
            entry: entryPrice,
            stopLoss,
            takeProfit1,
            takeProfit2,
            support: levels.support,
            resistance: levels.resistance
        },
        riskReward: riskRewardRatio.toFixed(2),
        indicators: {
            rsi: indicators.rsi?.toFixed(2),
            macd: indicators.macd.histogram?.toFixed(4),
            bbPosition: indicators.bollingerBands.lower ?
                ((price - indicators.bollingerBands.lower) / (indicators.bollingerBands.upper - indicators.bollingerBands.lower) * 100).toFixed(1) + '%'
                : 'N/A'
        },
        patterns: Object.keys(patterns).filter(key => patterns[key]),
        volumeSpike: volume.spike
    };
}

/**
 * Analizar múltiples criptomonedas y generar señales
 * @param {Object} symbolsData - Objeto con datos de velas por símbolo
 * @param {Object} multiTimeframeData - Datos multi-timeframe (opcional)
 * @returns {Array<Object>} Array de señales generadas
 */
export function analyzeMultipleSymbols(symbolsData, multiTimeframeData = {}) {
    const signals = [];

    for (const [symbol, candleData] of Object.entries(symbolsData)) {
        if (!candleData || !candleData.data || candleData.data.length < 50) {
            console.warn(`Datos insuficientes para ${symbol}`);
            continue;
        }

        try {
            // Realizar análisis técnico
            const analysis = performTechnicalAnalysis(candleData.data);

            // Obtener datos multi-timeframe para este símbolo
            const mtfData = multiTimeframeData[symbol] || null;

            // Generar señal
            const signal = generateSignal(analysis, symbol, mtfData);

            if (signal) {
                signals.push(signal);
            }
        } catch (error) {
            console.error(`Error analizando ${symbol}:`, error);
        }
    }

    // Ordenar señales por score (mayor a menor)
    return signals.sort((a, b) => b.score - a.score);
}

/**
 * Filtrar señales por nivel de confianza
 * @param {Array<Object>} signals - Array de señales
 * @param {string} minConfidence - Confianza mínima ('LOW', 'MEDIUM', 'HIGH')
 * @returns {Array<Object>} Señales filtradas
 */
export function filterSignalsByConfidence(signals, minConfidence = 'LOW') {
    const confidenceLevels = { 'LOW': 0, 'MEDIUM': 1, 'HIGH': 2 };
    const minLevel = confidenceLevels[minConfidence];

    return signals.filter(signal =>
        confidenceLevels[signal.confidence] >= minLevel
    );
}
