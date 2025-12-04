import { performTechnicalAnalysis } from './technicalAnalysis.js';

// Configurable weights and thresholds (tune these as needed)
// Configuration presets for different trading modes
const MODES = {
    CONSERVATIVE: {
        categoryThresholdForConvergence: 0.25, // Stricter: needs higher subscores
        requiredCategories: 2,                 // Needs at least 2 strong categories
        scoreToEmit: 0.65,                     // Only high quality signals (>65)
        weights: {
            momentum: 0.15,
            trend: 0.25,      // Trend is key for safety
            trendStrength: 0.10,
            levels: 0.20,     // Support/Resistance crucial
            volume: 0.10,
            patterns: 0.05,
            divergence: 0.05,
            accumulation: 0.10 // Smart money detection
        }
    },
    BALANCED: {
        categoryThresholdForConvergence: 0.20,
        requiredCategories: 1,
        scoreToEmit: 0.50,
        weights: {
            momentum: 0.15,
            trend: 0.20,
            trendStrength: 0.10,
            levels: 0.20,
            volume: 0.15,
            patterns: 0.05,
            divergence: 0.05,
            accumulation: 0.10
        }
    },
    RISKY: {
        categoryThresholdForConvergence: 0.15, // Looser
        requiredCategories: 1,
        scoreToEmit: 0.40,                     // Lower threshold (>40)
        weights: {
            momentum: 0.25,   // Momentum is key for quick scalps
            trend: 0.10,
            trendStrength: 0.05,
            levels: 0.15,
            volume: 0.20,     // Volume spikes matter more
            patterns: 0.15,   // Speculative patterns included
            divergence: 0.05,
            accumulation: 0.05
        }
    }
};

export const getSignalConfig = (mode = 'BALANCED') => {
    const key = mode.toUpperCase();
    return MODES[key] || MODES.BALANCED;
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
/**
 * Generar señal de trading basada en análisis técnico avanzado (Triple Screen + Regímenes)
 */
export function generateSignal(analysis, symbol, multiTimeframeData = {}, mode = 'BALANCED') {
    const config = getSignalConfig(mode);
    const { indicators = {}, levels = {}, patterns = {}, volume = {}, price, buyerPressure, regime } = analysis;

    const reasons = [];
    const warnings = [];

    // === 1. Market Regime Detection (Screen 1: Daily/4h) ===
    // Prioritize Daily regime, fallback to 4h, then 1h (self)
    const dailyRegime = multiTimeframeData['1d']?.regime || 'UNKNOWN';
    const h4Regime = multiTimeframeData['4h']?.regime || 'UNKNOWN';
    const currentRegime = dailyRegime !== 'UNKNOWN' ? dailyRegime : (h4Regime !== 'UNKNOWN' ? h4Regime : regime);

    // Adjust weights based on regime
    let activeWeights = { ...config.weights };
    if (currentRegime === 'RANGING') {
        activeWeights.momentum = 0.25; // Oscillators matter more in ranges
        activeWeights.levels = 0.30;   // Support/Resistance key in ranges
        activeWeights.trend = 0.05;    // Trend matters less
    } else if (currentRegime === 'TRENDING_BULL') {
        activeWeights.trend = 0.35;    // Trend is king
        activeWeights.momentum = 0.10; // RSI can stay overbought
        activeWeights.levels = 0.15;   // Pullbacks to support
    }

    // === 2. Triple Screen Logic ===

    // Screen 1: Long Term Trend (Daily/4h)
    let longTermTrendScore = 0;
    const dailyEMA20 = multiTimeframeData['1d']?.indicators?.ema20;
    const dailyEMA50 = multiTimeframeData['1d']?.indicators?.ema50;

    if (dailyEMA20 && dailyEMA50) {
        if (dailyEMA20 > dailyEMA50) longTermTrendScore = 1; // Bullish context
        else longTermTrendScore = -1; // Bearish context
    } else {
        // Fallback to 4h
        const h4EMA20 = multiTimeframeData['4h']?.indicators?.ema20;
        const h4EMA50 = multiTimeframeData['4h']?.indicators?.ema50;
        if (h4EMA20 && h4EMA50 && h4EMA20 > h4EMA50) longTermTrendScore = 0.8;
    }

    // Filter: In Conservative mode, DO NOT trade against Daily Trend
    if (mode === 'CONSERVATIVE' && longTermTrendScore === -1) {
        return null;
    }

    // Screen 2: Intermediate Setup (1h - Current Timeframe)
    // ... (Existing logic refined) ...

    // === Momentum (RSI, MACD, Stochastic) ===
    let rsiScore = 0;
    if (indicators.rsi != null) {
        if (currentRegime === 'TRENDING_BULL') {
            // In strong uptrend, RSI 40-60 is a buy (pullback), >70 is fine
            if (indicators.rsi < 60 && indicators.rsi > 40) rsiScore = 1;
            else if (indicators.rsi < 40) rsiScore = 0.8; // Deep pullback
        } else {
            // In range, standard RSI rules apply
            if (indicators.rsi < 35) rsiScore = 1;
            else if (indicators.rsi < 55) rsiScore = clamp((55 - indicators.rsi) / 20, 0, 1);
        }
    }

    const macdScore = (indicators.macd && indicators.macd.histogram != null) ? (indicators.macd.histogram > 0 ? 1 : 0) : 0;

    let stochScore = 0;
    if (indicators.stochastic && indicators.stochastic.k != null) {
        if (indicators.stochastic.k < 20) stochScore = 1;
        else if (indicators.stochastic.k < 40) stochScore = clamp((40 - indicators.stochastic.k) / 20, 0, 1);
    }

    const momentumScore = clamp(0.4 * rsiScore + 0.4 * macdScore + 0.2 * stochScore, 0, 1);
    if (momentumScore > 0.6) reasons.push({ text: 'Momentum favorable', weight: percent(momentumScore) });

    // === Trend (EMA cross, SMA200) ===
    let emaScore = 0;
    if (indicators.ema20 != null && indicators.ema50 != null) {
        if (indicators.ema20 > indicators.ema50) {
            emaScore = 0.7;
            if (price < indicators.ema20) emaScore = 1.0; // Dip buy
        } else if (indicators.ema50 != null && indicators.ema20 > indicators.ema50 * 0.99) {
            emaScore = 0.3;
        }
    }
    const smaScore = (indicators.sma200 != null && price != null) ? (price > indicators.sma200 ? 1 : 0) : 0;

    // VWAP Confirmation
    let vwapScore = 0;
    if (indicators.vwap != null && price > indicators.vwap) {
        vwapScore = 1;
        reasons.push({ text: 'Precio sobre VWAP', weight: 10 });
    }

    let trendScore = clamp(0.5 * emaScore + 0.35 * smaScore + 0.15 * vwapScore, 0, 1);
    if (trendScore > 0.6) reasons.push({ text: 'Tendencia alcista (1h)', weight: percent(trendScore) });

    // === Levels & Order Blocks ===
    let supportScore = 0;
    // Check standard support
    if (levels.support != null && price != null) {
        const dist = ((price - levels.support) / price) * 100;
        if (dist <= 2) supportScore = 0.8;
    }

    // Check Order Blocks (Smart Money)
    if (levels.orderBlocks && levels.orderBlocks.bullish.length > 0) {
        const nearestOB = levels.orderBlocks.bullish[levels.orderBlocks.bullish.length - 1];
        // Check if price is inside or near the OB
        if (price >= nearestOB.bottom && price <= nearestOB.top * 1.01) {
            supportScore = 1; // Strongest support signal
            reasons.push({ text: 'Rebote en Order Block (Institucional)', weight: 35 });
        }
    }

    // Check Fib Pivots
    if (levels.fibPivot) {
        const checkFib = (level) => Math.abs((price - level) / price) * 100 < 1.0;
        if (checkFib(levels.fibPivot.s1) || checkFib(levels.fibPivot.s2) || checkFib(levels.fibPivot.p)) {
            supportScore = Math.max(supportScore, 0.9);
            reasons.push({ text: 'Soporte Fibonacci', weight: 20 });
        }
    }

    const levelsScore = supportScore;

    // === Volume ===
    const spikeScore = volume.spike ? 1 : 0;
    let buyerScore = 0;
    if (buyerPressure && buyerPressure.current > 55) buyerScore = (buyerPressure.current - 50) / 10;
    const volumeScore = clamp(0.6 * spikeScore + 0.4 * buyerScore, 0, 1);
    if (volumeScore > 0.7) reasons.push({ text: 'Volumen comprador fuerte', weight: percent(volumeScore) });

    // === Patterns ===
    const positivePatterns = ['bullishEngulfing', 'threeWhiteSoldiers', 'morningStar', 'doubleBottom', 'hammer'];
    let patternCount = 0;
    positivePatterns.forEach(p => { if (patterns[p]) patternCount += 1; });
    const patternScore = clamp(patternCount / 2, 0, 1);
    if (patternScore > 0) reasons.push({ text: 'Patrón de velas alcista', weight: percent(patternScore) });

    // === Trend Strength (ADX) ===
    let trendStrengthScore = 0;
    if (indicators.adx != null) {
        if (indicators.adx > 25) {
            trendStrengthScore = clamp((indicators.adx - 25) / 25, 0, 1); // 25->0, 50->1
            if (trendStrengthScore > 0.6) reasons.push({ text: 'Tendencia fuerte (ADX)', weight: percent(trendStrengthScore) });
        }
    }

    // === Divergence ===
    let divergenceScore = 0;
    const rsiDiv = analysis.divergence?.rsi;
    const macdDiv = analysis.divergence?.macd;

    if (rsiDiv?.bullish) {
        divergenceScore = Math.max(divergenceScore, rsiDiv.strength || 0.5);
        reasons.push({ text: 'Divergencia alcista RSI', weight: percent(divergenceScore) });
    }
    if (macdDiv?.bullish) {
        divergenceScore = Math.max(divergenceScore, macdDiv.strength || 0.5);
        reasons.push({ text: 'Divergencia alcista MACD', weight: percent(divergenceScore) });
    }

    // === Accumulation ===
    let accumulationScore = 0;
    if (analysis.accumulation?.isAccumulating) {
        accumulationScore = analysis.accumulation.strength || 0.8;
        reasons.push({ text: 'Acumulación detectada', weight: percent(accumulationScore) });
    }

    // === Screen 3: Trigger (15m Momentum) ===
    let triggerScore = 0;
    if (multiTimeframeData['15m']) {
        const tf15 = multiTimeframeData['15m'];
        // Check for 15m RSI turning up or MACD crossover
        if (tf15.indicators.rsi > 30 && tf15.indicators.rsi < 70) triggerScore += 0.5;
        if (tf15.indicators.macd.histogram > 0) triggerScore += 0.5;

        if (triggerScore > 0.8) reasons.push({ text: 'Gatillo 15m activado', weight: 15 });
    } else {
        triggerScore = 0.5; // Neutral if no data
    }

    // === Final Calculation ===
    const subscores = {
        momentum: momentumScore,
        trend: trendScore,
        trendStrength: trendStrengthScore,
        levels: levelsScore,
        volume: volumeScore,
        patterns: patternScore,
        divergence: divergenceScore,
        accumulation: accumulationScore
    };

    let finalNormalized = 0;
    for (const k of Object.keys(subscores)) {
        finalNormalized += (subscores[k] || 0) * (activeWeights[k] || 0);
    }

    // Boost for Triple Screen Alignment
    if (longTermTrendScore > 0 && triggerScore > 0.5) {
        finalNormalized += 0.1; // Bonus
        reasons.push({ text: 'Alineación Multi-Timeframe (Triple Screen)', weight: 25 });
    }

    // Regime specific adjustments
    if (currentRegime === 'TRENDING_BULL' && trendScore > 0.7) {
        finalNormalized += 0.1; // Trend following bonus
    }

    finalNormalized = clamp(finalNormalized, 0, 1);

    // Threshold check
    if (finalNormalized < config.scoreToEmit) return null;

    // === Stop Loss & Take Profit Strategy ===
    const entryPrice = price;
    let stopLoss, takeProfit1, takeProfit2;

    // ATR Based
    const atr = indicators.atr || (price * 0.02);

    // Smart Stop Loss: Below nearest Order Block or Support
    if (levels.orderBlocks && levels.orderBlocks.bullish.length > 0) {
        const nearestOB = levels.orderBlocks.bullish[levels.orderBlocks.bullish.length - 1];
        stopLoss = Math.min(nearestOB.bottom * 0.995, price - atr);
    } else if (levels.support) {
        stopLoss = Math.min(levels.support * 0.99, price - atr);
    } else {
        stopLoss = price - (atr * 1.5);
    }

    // Take Profit: Fib levels or ATR multiples
    if (levels.fibPivot && levels.fibPivot.r1 > price) {
        takeProfit1 = levels.fibPivot.r1;
        takeProfit2 = levels.fibPivot.r2;
    } else {
        takeProfit1 = price + (atr * 2);
        takeProfit2 = price + (atr * 4);
    }

    const riskRewardRatio = (takeProfit1 - entryPrice) / (entryPrice - stopLoss);
    const scoreOut = Math.round(finalNormalized * 100);

    return {
        symbol,
        type: 'BUY',
        timestamp: new Date().toISOString(),
        price: entryPrice,
        score: scoreOut,
        confidence: scoreOut >= 80 ? 'HIGH' : scoreOut >= 60 ? 'MEDIUM' : 'LOW',
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
            fibPivot: levels.fibPivot
        },
        riskReward: Number(riskRewardRatio.toFixed(2)),
        indicators: {
            rsi: indicators.rsi != null ? Number(indicators.rsi.toFixed(2)) : null,
            macd: indicators.macd?.histogram != null ? Number(indicators.macd.histogram.toFixed(6)) : null,
            atr: Number(atr.toFixed(8)),
            adx: indicators.adx != null ? Number(indicators.adx.toFixed(1)) : null,
        },
        regime: currentRegime
    };
}

export function analyzeMultipleSymbols(symbolsData, multiTimeframeData = {}, mode = 'BALANCED') {
    const signals = [];

    for (const [symbol, candleData] of Object.entries(symbolsData)) {
        if (!candleData || !candleData.data || candleData.data.length < 50) {
            console.warn(`Datos insuficientes para ${symbol}`);
            continue;
        }

        try {
            const analysis = performTechnicalAnalysis(candleData.data);
            const mtfData = multiTimeframeData[symbol] || null;
            const signal = generateSignal(analysis, symbol, mtfData, mode);
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
