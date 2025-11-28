import { performTechnicalAnalysis } from './technicalAnalysis.js';

// Configurable weights and thresholds (tune these as needed)
export const SIGNAL_CONFIG = {
    categoryWeights: {
        momentum: 0.40,      // Increased from 0.30
        trend: 0.30,         // Increased from 0.25
        trendStrength: 0.15, // Unchanged
        levels: 0.10,        // Decreased from 0.15
        volume: 0.05,        // Decreased from 0.10
        patterns: 0.00,      // Removed (was 0.05)
        divergence: 0.00     // Removed
    },
    categoryThresholdForConvergence: 0.4,
    requiredCategories: 1,
    scoreToEmit: 0.50 // Increased from 0.45 to be more selective
};

function clamp(v, a = 0, b = 1) {
    return Math.max(a, Math.min(b, v));
}

function percent(v) {
    return Math.round(v * 100);
}

/**
 * Generar señal de trading basada en análisis técnico
 * Implementación basada en subscores por categoría para evitar double-counting
 */
export function generateSignal(analysis, symbol, multiTimeframeData = null) {
    const { indicators = {}, levels = {}, patterns = {}, volume = {}, price, buyerPressure } = analysis;

    const reasons = [];
    const warnings = [];

    // === Momentum (RSI, MACD, Stochastic) ===
    let rsiScore = 0;
    if (indicators.rsi != null) {
        // 30 => strong (1), 40 => neutral (0)
        rsiScore = clamp((45 - indicators.rsi) / 15, 0, 1); // Relaxed: <45 starts scoring
    }

    const macdScore = (indicators.macd && indicators.macd.histogram != null) ? (indicators.macd.histogram > 0 ? 1 : 0) : 0;

    let stochScore = 0;
    if (indicators.stochastic && indicators.stochastic.k != null) {
        if (indicators.stochastic.k < 20) stochScore = 1;
        else if (indicators.stochastic.k < 40) stochScore = clamp((40 - indicators.stochastic.k) / 20, 0, 1); // Relaxed
    }

    const momentumScore = clamp(0.4 * rsiScore + 0.4 * macdScore + 0.2 * stochScore, 0, 1);
    if (momentumScore > 0) reasons.push({ text: 'Momentum positivo', weight: percent(momentumScore) });

    // === Trend (EMA cross, SMA200) ===
    let emaScore = 0;
    if (indicators.ema20 != null && indicators.ema50 != null) {
        if (indicators.ema20 > indicators.ema50) {
            emaScore = 0.7; // Base score for uptrend
            // Bonus for dip in uptrend (price < ema20) - Align with CryptoCard
            if (price < indicators.ema20) {
                emaScore = 1.0;
                reasons.push({ text: 'Oportunidad en retroceso (Dip)', weight: 20 });
            }
        }
    }
    const smaScore = (indicators.sma200 != null && price != null) ? (price > indicators.sma200 ? 1 : 0) : 0;

    // VWAP Confirmation
    let vwapScore = 0;
    if (indicators.vwap != null) {
        if (price > indicators.vwap) {
            vwapScore = 1;
            reasons.push({ text: 'Precio sobre VWAP', weight: 10 });
        }
    }

    const trendScore = clamp(0.4 * emaScore + 0.3 * smaScore + 0.3 * vwapScore, 0, 1);
    if (trendScore > 0) reasons.push({ text: 'Tendencia favorable', weight: percent(trendScore) });

    // === Trend Strength (ADX) ===
    let adxScore = 0;
    if (indicators.adx != null) {
        if (indicators.adx > 25) {
            adxScore = 1; // Strong trend
            reasons.push({ text: `Tendencia fuerte (ADX ${indicators.adx.toFixed(1)})`, weight: 20 });
        } else if (indicators.adx > 20) {
            adxScore = 0.5;
        }
    }
    const trendStrengthScore = adxScore;

    // === Levels (support, bollinger lower) ===
    let supportScore = 0;
    if (levels.support != null && price != null) {
        const distanceToSupport = ((price - levels.support) / price) * 100; // percent
        if (distanceToSupport <= 2) supportScore = 1;
        else if (distanceToSupport <= 5) supportScore = 0.6;
    }

    let bollScore = 0;
    if (indicators.bollingerBands && indicators.bollingerBands.lower != null) {
        const distanceToLower = ((price - indicators.bollingerBands.lower) / price) * 100;
        if (price <= indicators.bollingerBands.lower) bollScore = 1;
        else if (distanceToLower < 2) bollScore = 0.7;
    }

    // Pivot Points Support
    let pivotScore = 0;
    if (levels.pivot) {
        // Check proximity to S1, S2 or Pivot (if bullish reversal)
        const checkLevel = (level) => {
            const dist = Math.abs((price - level) / price) * 100;
            return dist < 1.5;
        };
        if (checkLevel(levels.pivot.s1) || checkLevel(levels.pivot.s2) || (price > levels.pivot.p && checkLevel(levels.pivot.p))) {
            pivotScore = 0.8;
            reasons.push({ text: 'Cerca de nivel Pivot/Soporte', weight: 15 });
        }
    }

    const levelsScore = clamp(Math.max(supportScore, bollScore, pivotScore), 0, 1);
    if (levelsScore > 0) reasons.push({ text: 'Niveles favorables', weight: percent(levelsScore) });

    // === Volume (spike, buyer pressure) ===
    const spikeScore = volume.spike ? 1 : 0;
    let buyerScore = 0;
    if (buyerPressure && typeof buyerPressure.current === 'number') {
        if (buyerPressure.current > 60) buyerScore = 1;
        else if (buyerPressure.current > 50) buyerScore = (buyerPressure.current - 50) / 10; // 0..1
    }
    const volumeScore = clamp(0.7 * spikeScore + 0.3 * buyerScore, 0, 1);
    if (volumeScore > 0) reasons.push({ text: 'Señal de volumen', weight: percent(volumeScore) });

    // === Patterns ===
    const positivePatterns = ['bullishEngulfing', 'threeWhiteSoldiers', 'morningStar', 'doubleBottom', 'hammer', 'doji'];
    let patternCount = 0;
    positivePatterns.forEach(p => { if (patterns[p]) patternCount += 1; });
    const patternScore = clamp(patternCount / 3, 0, 1); // 3 patterns -> 1.0
    if (patternScore > 0) reasons.push({ text: 'Patrones alcistas', weight: percent(patternScore) });

    // === Divergence ===
    let divScore = 0;
    if (analysis.divergence) {
        if (analysis.divergence.rsi && analysis.divergence.rsi.bullish) divScore = Math.max(divScore, analysis.divergence.rsi.strength || 0);
        if (analysis.divergence.macd && analysis.divergence.macd.bullish) divScore = Math.max(divScore, (analysis.divergence.macd.strength || 0) * 0.8);
    }
    const divergenceScore = clamp(divScore, 0, 1);
    if (divergenceScore > 0) reasons.push({ text: 'Divergencia alcista', weight: percent(divergenceScore) });

    // Combine categories with weights
    const weights = SIGNAL_CONFIG.categoryWeights;
    const subscores = {
        momentum: momentumScore,
        trend: trendScore,
        trendStrength: trendStrengthScore,
        levels: levelsScore,
        volume: volumeScore,
        patterns: patternScore,
        divergence: divergenceScore
    };

    let finalNormalized = 0;
    for (const k of Object.keys(subscores)) {
        finalNormalized += (subscores[k] || 0) * (weights[k] || 0);
    }
    finalNormalized = clamp(finalNormalized, 0, 1);

    // Count aligned categories
    const categoriesAligned = Object.values(subscores).filter(s => s >= SIGNAL_CONFIG.categoryThresholdForConvergence).length;

    // Multi-timeframe confirmation (lightweight)
    if (multiTimeframeData && multiTimeframeData['4h']) {
        const tf4h = multiTimeframeData['4h'];
        if (tf4h.indicators && tf4h.indicators.ema20 != null && tf4h.indicators.ema50 != null && tf4h.indicators.ema20 > tf4h.indicators.ema50) {
            // small boost for agreement on higher timeframe
            finalNormalized = clamp(finalNormalized + 0.05, 0, 1);
            reasons.push({ text: 'Confirmación 4h', weight: 5 });
        }
    }

    // Emit condition
    if (categoriesAligned < SIGNAL_CONFIG.requiredCategories || finalNormalized < SIGNAL_CONFIG.scoreToEmit) {
        return null;
    }

    // Levels: entry, stopLoss, takeProfit (use ATR when available)
    const entryPrice = price;
    let stopLoss, takeProfit1, takeProfit2;

    if (indicators.atr != null && indicators.atr > 0) {
        stopLoss = price - indicators.atr * 1.5;
        // ensure stopLoss is not far below support if support exists
        if (levels.support && stopLoss < levels.support * 0.98) stopLoss = Math.max(stopLoss, levels.support * 0.98);
        takeProfit1 = price + indicators.atr * 2.5;
        takeProfit2 = price + indicators.atr * 5;
    } else {
        stopLoss = levels.support ? Math.max(levels.support * 0.98, price * 0.98) : price * 0.98;
        takeProfit1 = price * 1.02;
        takeProfit2 = price * 1.05;
    }

    // Adjust TP/SL with Pivot Points if available
    if (levels.pivot) {
        if (levels.pivot.r1 > price && (!takeProfit1 || levels.pivot.r1 < takeProfit1)) takeProfit1 = levels.pivot.r1;
        if (levels.pivot.r2 > price && (!takeProfit2 || levels.pivot.r2 < takeProfit2)) takeProfit2 = levels.pivot.r2;
        // If S1 is below price, it can be a stop loss reference
        if (levels.pivot.s1 < price && levels.pivot.s1 > stopLoss) stopLoss = levels.pivot.s1 * 0.99;
    }

    const riskRewardRatio = (takeProfit1 - entryPrice) / Math.max(0.0000001, (entryPrice - stopLoss));

    const scoreOut = Math.round(finalNormalized * 100);

    return {
        symbol,
        type: 'BUY',
        timestamp: new Date().toISOString(),
        price: entryPrice,
        score: scoreOut,
        confidence: scoreOut >= 80 ? 'HIGH' : scoreOut >= 60 ? 'MEDIUM' : 'LOW',
        categoriesAligned,
        subscores: Object.fromEntries(Object.entries(subscores).map(([k, v]) => [k, Math.round(v * 100)])),
        reasons,
        warnings,
        levels: {
            entry: entryPrice,
            stopLoss,
            takeProfit1,
            takeProfit2,
            support: levels.support,
            resistance: levels.resistance,
            pivot: levels.pivot
        },
        riskReward: Number(riskRewardRatio.toFixed(2)),
        indicators: {
            rsi: indicators.rsi != null ? Number(indicators.rsi.toFixed(2)) : null,
            macd: indicators.macd?.histogram != null ? Number(indicators.macd.histogram.toFixed(6)) : null,
            atr: indicators.atr != null ? Number(indicators.atr.toFixed(8)) : null,
            bbPosition: indicators.bollingerBands && indicators.bollingerBands.lower ?
                ((price - indicators.bollingerBands.lower) / (indicators.bollingerBands.upper - indicators.bollingerBands.lower) * 100).toFixed(1) + '%'
                : 'N/A',
            buyerPressure: buyerPressure ? `${Number(buyerPressure.current.toFixed(1))}%` : 'N/A',
            adx: indicators.adx != null ? Number(indicators.adx.toFixed(1)) : null,
            vwap: indicators.vwap != null ? Number(indicators.vwap.toFixed(2)) : null
        },
        patterns: Object.keys(patterns).filter(key => patterns[key]),
        volumeSpike: Boolean(volume.spike)
    };
}

export function analyzeMultipleSymbols(symbolsData, multiTimeframeData = {}) {
    const signals = [];

    for (const [symbol, candleData] of Object.entries(symbolsData)) {
        if (!candleData || !candleData.data || candleData.data.length < 50) {
            console.warn(`Datos insuficientes para ${symbol}`);
            continue;
        }

        try {
            const analysis = performTechnicalAnalysis(candleData.data);
            const mtfData = multiTimeframeData[symbol] || null;
            const signal = generateSignal(analysis, symbol, mtfData);
            if (signal) signals.push(signal);
        } catch (err) {
            console.error(`Error analizando ${symbol}:`, err);
        }
    }

    return signals.sort((a, b) => b.score - a.score);
}

export function filterSignalsByConfidence(signals, minConfidence = 'LOW') {
    const confidenceLevels = { 'LOW': 0, 'MEDIUM': 1, 'HIGH': 2 };
    const minLevel = confidenceLevels[minConfidence];
    return signals.filter(signal => confidenceLevels[signal.confidence] >= minLevel);
}
