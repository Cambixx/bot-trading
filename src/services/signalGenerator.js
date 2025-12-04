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
        scoreToEmit: 0.40,
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
    let signalType = 'BUY'; // Default

    // === 1. Market Regime Detection (Screen 1: Daily/4h) ===
    const dailyRegime = multiTimeframeData['1d']?.regime || 'UNKNOWN';
    const h4Regime = multiTimeframeData['4h']?.regime || 'UNKNOWN';
    const currentRegime = dailyRegime !== 'UNKNOWN' ? dailyRegime : (h4Regime !== 'UNKNOWN' ? h4Regime : regime);

    // Determine Bias based on Regime
    let bias = 'NEUTRAL';
    if (currentRegime === 'TRENDING_BULL') bias = 'BULLISH';
    else if (currentRegime === 'TRENDING_BEAR') bias = 'BEARISH';

    // Determine Signal Type
    // Prioritize Regime, fallback to Price Structure
    if (bias === 'BULLISH') signalType = 'BUY';
    else if (bias === 'BEARISH') signalType = 'SELL';
    else {
        // In Ranging/Unknown, look at immediate structure
        if (indicators.ema50 && price < indicators.ema50) signalType = 'SELL';
        else signalType = 'BUY';
    }

    // In Conservative mode, enforce strict adherence to bias
    if (mode === 'CONSERVATIVE') {
        if (bias === 'NEUTRAL') return null; // No trade in ranging for conservative
        // If signalType doesn't match bias (e.g. counter-trend), skip
        if ((bias === 'BULLISH' && signalType === 'SELL') || (bias === 'BEARISH' && signalType === 'BUY')) {
            return null;
        }
    }

    // Adjust weights based on regime
    let activeWeights = { ...config.weights };
    if (currentRegime === 'RANGING') {
        activeWeights.momentum = 0.25;
        activeWeights.levels = 0.30;
        activeWeights.trend = 0.05;
    } else if (currentRegime === 'TRENDING_BULL' || currentRegime === 'TRENDING_BEAR') {
        activeWeights.trend = 0.35;
        activeWeights.momentum = 0.10;
        activeWeights.levels = 0.15;
    }

    // === 2. Triple Screen Logic ===

    // Screen 1: Long Term Trend (Daily/4h)
    let longTermTrendScore = 0;
    const dailyEMA20 = multiTimeframeData['1d']?.indicators?.ema20;
    const dailyEMA50 = multiTimeframeData['1d']?.indicators?.ema50;

    if (dailyEMA20 && dailyEMA50) {
        if (signalType === 'BUY') {
            if (dailyEMA20 > dailyEMA50) longTermTrendScore = 1;
            else longTermTrendScore = -1;
        } else { // SELL
            if (dailyEMA20 < dailyEMA50) longTermTrendScore = 1;
            else longTermTrendScore = -1;
        }
    } else {
        // Fallback to 4h
        const h4EMA20 = multiTimeframeData['4h']?.indicators?.ema20;
        const h4EMA50 = multiTimeframeData['4h']?.indicators?.ema50;
        if (h4EMA20 && h4EMA50) {
            if (signalType === 'BUY' && h4EMA20 > h4EMA50) longTermTrendScore = 0.8;
            else if (signalType === 'SELL' && h4EMA20 < h4EMA50) longTermTrendScore = 0.8;
        }
    }

    if (mode === 'CONSERVATIVE' && longTermTrendScore === -1) {
        return null;
    }

    // Screen 2: Intermediate Setup (1h)

    // === Momentum (RSI, MACD, Stochastic) ===
    let rsiScore = 0;
    if (indicators.rsi != null) {
        if (signalType === 'BUY') {
            if (currentRegime === 'TRENDING_BULL') {
                if (indicators.rsi < 60 && indicators.rsi > 40) rsiScore = 1;
                else if (indicators.rsi < 40) rsiScore = 0.8;
            } else {
                if (indicators.rsi < 35) rsiScore = 1;
                else if (indicators.rsi < 55) rsiScore = clamp((55 - indicators.rsi) / 20, 0, 1);
            }
        } else { // SELL
            if (currentRegime === 'TRENDING_BEAR') {
                // In downtrend, RSI 40-60 is a sell (pullback up), >60 is better
                if (indicators.rsi > 40 && indicators.rsi < 60) rsiScore = 1;
                else if (indicators.rsi > 60) rsiScore = 0.8;
            } else {
                // In range, sell overbought
                if (indicators.rsi > 65) rsiScore = 1;
                else if (indicators.rsi > 45) rsiScore = clamp((indicators.rsi - 45) / 20, 0, 1);
            }
        }
    }

    let macdScore = 0;
    if (indicators.macd && indicators.macd.histogram != null) {
        if (signalType === 'BUY') macdScore = indicators.macd.histogram > 0 ? 1 : 0;
        else macdScore = indicators.macd.histogram < 0 ? 1 : 0;
    }

    let stochScore = 0;
    if (indicators.stochastic && indicators.stochastic.k != null) {
        if (signalType === 'BUY') {
            if (indicators.stochastic.k < 20) stochScore = 1;
            else if (indicators.stochastic.k < 40) stochScore = clamp((40 - indicators.stochastic.k) / 20, 0, 1);
        } else { // SELL
            if (indicators.stochastic.k > 80) stochScore = 1;
            else if (indicators.stochastic.k > 60) stochScore = clamp((indicators.stochastic.k - 60) / 20, 0, 1);
        }
    }

    const momentumScore = clamp(0.4 * rsiScore + 0.4 * macdScore + 0.2 * stochScore, 0, 1);
    if (momentumScore > 0.6) reasons.push({ text: `Momentum favorable (${signalType})`, weight: percent(momentumScore) });

    // === Trend (EMA cross, SMA200) ===
    let emaScore = 0;
    if (indicators.ema20 != null && indicators.ema50 != null) {
        if (signalType === 'BUY') {
            if (indicators.ema20 > indicators.ema50) {
                emaScore = 0.7;
                if (price < indicators.ema20) emaScore = 1.0; // Dip buy
            } else if (indicators.ema20 > indicators.ema50 * 0.99) emaScore = 0.3;
        } else { // SELL
            if (indicators.ema20 < indicators.ema50) {
                emaScore = 0.7;
                if (price > indicators.ema20) emaScore = 1.0; // Rally sell
            } else if (indicators.ema20 < indicators.ema50 * 1.01) emaScore = 0.3;
        }
    }

    let smaScore = 0;
    if (indicators.sma200 != null && price != null) {
        if (signalType === 'BUY') smaScore = price > indicators.sma200 ? 1 : 0;
        else smaScore = price < indicators.sma200 ? 1 : 0;
    }

    // VWAP Confirmation
    let vwapScore = 0;
    if (indicators.vwap != null) {
        if (signalType === 'BUY' && price > indicators.vwap) {
            vwapScore = 1;
            reasons.push({ text: 'Precio sobre VWAP', weight: 10 });
        } else if (signalType === 'SELL' && price < indicators.vwap) {
            vwapScore = 1;
            reasons.push({ text: 'Precio bajo VWAP', weight: 10 });
        }
    }

    let trendScore = clamp(0.5 * emaScore + 0.35 * smaScore + 0.15 * vwapScore, 0, 1);
    if (trendScore > 0.6) reasons.push({ text: `Tendencia ${signalType === 'BUY' ? 'alcista' : 'bajista'} (1h)`, weight: percent(trendScore) });

    // === Trend Strength (ADX) ===
    let trendStrengthScore = 0;
    if (indicators.adx != null) {
        if (indicators.adx > 25) {
            trendStrengthScore = clamp((indicators.adx - 25) / 25, 0, 1);
            if (trendStrengthScore > 0.6) reasons.push({ text: 'Tendencia fuerte (ADX)', weight: percent(trendStrengthScore) });
        }
    }

    // === Levels & Order Blocks ===
    let supportScore = 0; // Or Resistance Score for SELL

    if (signalType === 'BUY') {
        if (levels.support != null && price != null) {
            const dist = ((price - levels.support) / price) * 100;
            if (dist <= 2) supportScore = 0.8;
        }
        if (levels.orderBlocks && levels.orderBlocks.bullish.length > 0) {
            const nearestOB = levels.orderBlocks.bullish[levels.orderBlocks.bullish.length - 1];
            if (price >= nearestOB.bottom && price <= nearestOB.top * 1.01) {
                supportScore = 1;
                reasons.push({ text: 'Rebote en Order Block (Institucional)', weight: 35 });
            }
        }
        if (levels.fibPivot) {
            const checkFib = (level) => Math.abs((price - level) / price) * 100 < 1.0;
            if (checkFib(levels.fibPivot.s1) || checkFib(levels.fibPivot.s2) || checkFib(levels.fibPivot.p)) {
                supportScore = Math.max(supportScore, 0.9);
                reasons.push({ text: 'Soporte Fibonacci', weight: 20 });
            }
        }
    } else { // SELL
        if (levels.resistance != null && price != null) {
            const dist = ((levels.resistance - price) / price) * 100;
            if (dist <= 2) supportScore = 0.8;
        }
        if (levels.orderBlocks && levels.orderBlocks.bearish.length > 0) {
            const nearestOB = levels.orderBlocks.bearish[levels.orderBlocks.bearish.length - 1];
            if (price <= nearestOB.top && price >= nearestOB.bottom * 0.99) {
                supportScore = 1;
                reasons.push({ text: 'Rechazo en Order Block (Institucional)', weight: 35 });
            }
        }
        if (levels.fibPivot) {
            const checkFib = (level) => Math.abs((price - level) / price) * 100 < 1.0;
            if (checkFib(levels.fibPivot.r1) || checkFib(levels.fibPivot.r2) || checkFib(levels.fibPivot.p)) {
                supportScore = Math.max(supportScore, 0.9);
                reasons.push({ text: 'Resistencia Fibonacci', weight: 20 });
            }
        }
    }

    const levelsScore = supportScore;

    // === Volume ===
    const spikeScore = volume.spike ? 1 : 0;
    let buyerScore = 0;
    if (buyerPressure) {
        if (signalType === 'BUY' && buyerPressure.current > 55) buyerScore = (buyerPressure.current - 50) / 10;
        else if (signalType === 'SELL' && buyerPressure.current < 45) buyerScore = (50 - buyerPressure.current) / 10;
    }
    const volumeScore = clamp(0.6 * spikeScore + 0.4 * buyerScore, 0, 1);
    if (volumeScore > 0.7) reasons.push({ text: `Volumen ${signalType === 'BUY' ? 'comprador' : 'vendedor'} fuerte`, weight: percent(volumeScore) });

    // === Patterns ===
    let patternCount = 0;
    if (signalType === 'BUY') {
        const positivePatterns = ['bullishEngulfing', 'threeWhiteSoldiers', 'morningStar', 'doubleBottom', 'hammer'];
        positivePatterns.forEach(p => { if (patterns[p]) patternCount += 1; });
    } else {
        const negativePatterns = ['bearishEngulfing', 'threeBlackCrows', 'eveningStar', 'doubleTop', 'shootingStar']; // Assuming these exist or will exist
        // Mapping existing patterns if names differ or just using what we have
        if (patterns.eveningStar) patternCount++;
        if (patterns.doubleTop) patternCount++;
        // Add more bearish patterns to technicalAnalysis if needed, for now using what's available
    }
    const patternScore = clamp(patternCount / 2, 0, 1);
    if (patternScore > 0) reasons.push({ text: `Patrón de velas ${signalType === 'BUY' ? 'alcista' : 'bajista'}`, weight: percent(patternScore) });

    // === Divergence ===
    let divergenceScore = 0;
    const rsiDiv = analysis.divergence?.rsi;
    const macdDiv = analysis.divergence?.macd;

    if (signalType === 'BUY') {
        if (rsiDiv?.bullish) {
            divergenceScore = Math.max(divergenceScore, rsiDiv.strength || 0.5);
            reasons.push({ text: 'Divergencia alcista RSI', weight: percent(divergenceScore) });
        }
        if (macdDiv?.bullish) {
            divergenceScore = Math.max(divergenceScore, macdDiv.strength || 0.5);
            reasons.push({ text: 'Divergencia alcista MACD', weight: percent(divergenceScore) });
        }
    } else { // SELL
        if (rsiDiv?.bearish) {
            divergenceScore = Math.max(divergenceScore, rsiDiv.strength || 0.5);
            reasons.push({ text: 'Divergencia bajista RSI', weight: percent(divergenceScore) });
        }
        if (macdDiv?.bearish) {
            divergenceScore = Math.max(divergenceScore, macdDiv.strength || 0.5);
            reasons.push({ text: 'Divergencia bajista MACD', weight: percent(divergenceScore) });
        }
    }

    // === Accumulation / Distribution ===
    let accumulationScore = 0;
    if (signalType === 'BUY' && analysis.accumulation?.isAccumulating) {
        accumulationScore = analysis.accumulation.strength || 0.8;
        reasons.push({ text: 'Acumulación detectada', weight: percent(accumulationScore) });
    }
    // TODO: Implement Distribution detection for SELL

    // === Screen 3: Trigger (15m Momentum) ===
    let triggerScore = 0;
    if (multiTimeframeData['15m']) {
        const tf15 = multiTimeframeData['15m'];
        if (signalType === 'BUY') {
            if (tf15.indicators.rsi > 30 && tf15.indicators.rsi < 70) triggerScore += 0.5;
            if (tf15.indicators.macd.histogram > 0) triggerScore += 0.5;
        } else { // SELL
            if (tf15.indicators.rsi > 30 && tf15.indicators.rsi < 70) triggerScore += 0.5;
            if (tf15.indicators.macd.histogram < 0) triggerScore += 0.5;
        }

        if (triggerScore > 0.8) reasons.push({ text: 'Gatillo 15m activado', weight: 15 });
    } else {
        triggerScore = 0.5;
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
        finalNormalized += 0.1;
        reasons.push({ text: 'Alineación Multi-Timeframe (Triple Screen)', weight: 25 });
    }

    // Regime specific adjustments
    if (currentRegime === 'TRENDING_BULL' && signalType === 'BUY' && trendScore > 0.7) finalNormalized += 0.1;
    if (currentRegime === 'TRENDING_BEAR' && signalType === 'SELL' && trendScore > 0.7) finalNormalized += 0.1;

    finalNormalized = clamp(finalNormalized, 0, 1);

    // Threshold check
    if (finalNormalized < config.scoreToEmit) return null;

    // === Stop Loss & Take Profit Strategy ===
    const entryPrice = price;
    let stopLoss, takeProfit1, takeProfit2;
    const atr = indicators.atr || (price * 0.02);

    if (signalType === 'BUY') {
        if (levels.orderBlocks && levels.orderBlocks.bullish.length > 0) {
            const nearestOB = levels.orderBlocks.bullish[levels.orderBlocks.bullish.length - 1];
            stopLoss = Math.min(nearestOB.bottom * 0.995, price - atr);
        } else if (levels.support) {
            stopLoss = Math.min(levels.support * 0.99, price - atr);
        } else {
            stopLoss = price - (atr * 1.5);
        }

        if (levels.fibPivot && levels.fibPivot.r1 > price) {
            takeProfit1 = levels.fibPivot.r1;
            takeProfit2 = levels.fibPivot.r2;
        } else {
            takeProfit1 = price + (atr * 2);
            takeProfit2 = price + (atr * 4);
        }
    } else { // SELL
        if (levels.orderBlocks && levels.orderBlocks.bearish.length > 0) {
            const nearestOB = levels.orderBlocks.bearish[levels.orderBlocks.bearish.length - 1];
            stopLoss = Math.max(nearestOB.top * 1.005, price + atr);
        } else if (levels.resistance) {
            stopLoss = Math.max(levels.resistance * 1.01, price + atr);
        } else {
            stopLoss = price + (atr * 1.5);
        }

        if (levels.fibPivot && levels.fibPivot.s1 < price) {
            takeProfit1 = levels.fibPivot.s1;
            takeProfit2 = levels.fibPivot.s2;
        } else {
            takeProfit1 = price - (atr * 2);
            takeProfit2 = price - (atr * 4);
        }
    }

    const riskRewardRatio = Math.abs(takeProfit1 - entryPrice) / Math.abs(entryPrice - stopLoss);
    const scoreOut = Math.round(finalNormalized * 100);

    return {
        symbol,
        type: signalType,
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
