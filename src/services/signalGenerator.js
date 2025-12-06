import { performTechnicalAnalysis } from './technicalAnalysis.js';

// Configurable weights and thresholds (tune these as needed)
// Configuration presets for different trading modes
const MODES = {
    CONSERVATIVE: {
        categoryThresholdForConvergence: 0.25,
        requiredCategories: 2,
        scoreToEmit: 0.60,
        weights: {
            momentum: 0.20,
            trend: 0.30,      // Trend is key for safety
            trendStrength: 0.15,
            levels: 0.10,     // Support/Resistance 
            volume: 0.15,
            patterns: 0.05,
            divergence: 0.025,
            accumulation: 0.025
        }
    },
    BALANCED: {
        categoryThresholdForConvergence: 0.20,
        requiredCategories: 1,
        scoreToEmit: 0.35,  // Temporarily lowered for debugging
        weights: {
            momentum: 0.25,
            trend: 0.25,
            trendStrength: 0.10,
            levels: 0.10,
            volume: 0.20,
            patterns: 0.05,
            divergence: 0.025,
            accumulation: 0.025
        }
    },
    RISKY: {
        categoryThresholdForConvergence: 0.15,
        requiredCategories: 1,
        scoreToEmit: 0.40,
        weights: {
            momentum: 0.35,   // Momentum is king
            trend: 0.15,
            trendStrength: 0.05,
            levels: 0.10,
            volume: 0.25,     // Volatility/Volume
            patterns: 0.05,
            divergence: 0.025,
            accumulation: 0.025
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
    const { indicators = {}, levels = {}, patterns = {}, volume = {}, price, buyerPressure, regime, choppiness } = analysis;

    // DEBUG: Trace execution
    console.log(`Analyzing ${symbol} [${mode}]: Chop=${choppiness}, RSI=${indicators.rsi}, ScoreThreshold=${config.scoreToEmit}`);

    const reasons = [];
    const warnings = [];
    let signalType = 'BUY';

    // Initialize score variables
    let trendStrengthScore = 0;
    let divergenceScore = 0;
    let accumulationScore = 0;

    // ============================================
    // GATE 1: REGIME & FILTER (Noisy Market check)
    // ============================================

    // 1.1 Choppiness Index Check
    // If Choppiness > 60, market is sideways/erratic. 
    // In Conservative/Balanced, we generally avoid unless it's a specific Range Strategy (future).
    // For now, we penalize or abort.
    if (choppiness > 61.8) {
        if (mode === 'CONSERVATIVE') return null; // Abort in conservative
        warnings.push({ text: 'Mercado muy lateral (Choppy)', type: 'risk' });
    }

    // 1.2 ADX Trend Strength Check
    // If ADX < 20, trend is very weak.
    if (indicators.adx != null && indicators.adx < 20) {
        if (mode === 'CONSERVATIVE') return null;
        warnings.push({ text: 'Tendencia muy débil (ADX < 20)', type: 'risk' });
    }

    // ============================================
    // GATE 2: TREND ALIGNMENT & BIAS
    // ============================================

    // Determine Bias based on Multi-Timeframe
    const dailyRegime = multiTimeframeData['1d']?.regime || 'UNKNOWN';
    const h4Regime = multiTimeframeData['4h']?.regime || 'UNKNOWN';
    const currentRegime = dailyRegime !== 'UNKNOWN' ? dailyRegime : (h4Regime !== 'UNKNOWN' ? h4Regime : regime);

    let bias = 'NEUTRAL';
    // Prioritize Daily Regime
    if (dailyRegime === 'TRENDING_BULL') bias = 'BULLISH';
    else if (dailyRegime === 'TRENDING_BEAR') bias = 'BEARISH';
    else {
        // Fallback to 4h or SMA200 check
        if (h4Regime === 'TRENDING_BULL') bias = 'BULLISH';
        else if (h4Regime === 'TRENDING_BEAR') bias = 'BEARISH';
        else if (indicators.sma200) {
            if (price > indicators.sma200) bias = 'BULLISH';
            else bias = 'BEARISH';
        }
    }

    // Initial Signal Direction
    // Logic: Look for dips in Bullish, rallies in Bearish
    if (bias === 'BULLISH') signalType = 'BUY';
    else if (bias === 'BEARISH') signalType = 'SELL';
    else {
        // Flat market: mean reversion?
        // For simplicity, verify local trend (EMA50) because we filtered chop already
        if (indicators.ema50 && price < indicators.ema50) signalType = 'SELL';
        else signalType = 'BUY';
    }

    console.log(`  → Bias: ${bias}, SignalType: ${signalType}, Regime: ${currentRegime}`);

    // Strict Trend Filter for Conservative
    if (mode === 'CONSERVATIVE') {
        if (bias === 'BULLISH' && signalType === 'SELL') return null; // No counter-trend
        if (bias === 'BEARISH' && signalType === 'BUY') return null;
        if (bias === 'NEUTRAL') return null;
    }

    // Filter against SMA200 (Major Trend Line)
    if (indicators.sma200) {
        if (signalType === 'BUY' && price < indicators.sma200) {
            // Trying to buy below 200 SMA? Risky.
            if (mode === 'CONSERVATIVE') return null;
            warnings.push({ text: 'Contra tendencia mayor (Bajo SMA200)', type: 'warning' });
        }
        if (signalType === 'SELL' && price > indicators.sma200) {
            if (mode === 'CONSERVATIVE') return null;
            warnings.push({ text: 'Contra tendencia mayor (Sobre SMA200)', type: 'warning' });
        }
    }



    // ============================================
    // GATE 3: SCORING (The "Engine")
    // ============================================

    let score = 0;
    const subscores = {};
    const w = config.weights;

    // --- 3.1 Momentum (RSI, MACD, Stoch) ---
    let impScore = 0;
    // RSI Logic: Dynamic based on Regime
    if (indicators.rsi) {
        if (signalType === 'BUY') {
            // In strong uptrend, 40-50 is a dip. In range, <30 is buy.
            if (bias === 'BULLISH') {
                if (indicators.rsi >= 40 && indicators.rsi <= 60) impScore += 0.6; // Good dip
                if (indicators.rsi < 40) impScore += 1.0; // Deep dip
            } else {
                if (indicators.rsi < 35) impScore += 1.0;
                else if (indicators.rsi < 45) impScore += 0.5;
            }
        } else { // SELL
            if (bias === 'BEARISH') {
                if (indicators.rsi >= 40 && indicators.rsi <= 60) impScore += 0.6; // Pullback up
                if (indicators.rsi > 60) impScore += 1.0;
            } else {
                if (indicators.rsi > 65) impScore += 1.0;
                else if (indicators.rsi > 55) impScore += 0.5;
            }
        }
    }
    // MACD Logic
    if (indicators.macd && indicators.macd.histogram) {
        const hist = indicators.macd.histogram;
        if (signalType === 'BUY' && hist > 0) impScore += 0.5; // Momentum shifting up
        if (signalType === 'BUY' && hist > 0 && hist > (indicators.macd.prevHistogram || 0)) impScore += 0.5; // Growing

        if (signalType === 'SELL' && hist < 0) impScore += 0.5;
        if (signalType === 'SELL' && hist < 0 && hist < (indicators.macd.prevHistogram || 0)) impScore += 0.5; // Growing down
    }

    subscores.momentum = clamp(impScore / 2, 0, 1);
    if (subscores.momentum > 0.6) reasons.push({ text: 'Momentum fuerte', weight: percent(subscores.momentum) });

    // --- 3.2 Trend Quality ---
    let tScore = 0;
    // EMA Alignment
    if (indicators.ema20 && indicators.ema50) {
        if (signalType === 'BUY' && indicators.ema20 > indicators.ema50) tScore += 0.6;
        if (signalType === 'SELL' && indicators.ema20 < indicators.ema50) tScore += 0.6;
    }
    // Price relative to EMA20 (Pullback factor)
    if (signalType === 'BUY' && price > indicators.ema20) tScore += 0.2; // Momentum continuation
    if (signalType === 'SELL' && price < indicators.ema20) tScore += 0.2;

    subscores.trend = clamp(tScore, 0, 1);

    // --- 3.3 Volume ---
    let vScore = 0;
    if (volume.spike) vScore += 0.6;
    if (buyerPressure) {
        if (signalType === 'BUY' && buyerPressure.current > 55) vScore += 0.4;
        if (signalType === 'SELL' && buyerPressure.current < 45) vScore += 0.4;
    }
    subscores.volume = clamp(vScore, 0, 1);
    if (volume.spike) reasons.push({ text: 'Pico de Volumen', weight: 20 });

    // --- 3.4 Levels (S/R) ---
    let lScore = 0;
    if (signalType === 'BUY') {
        // Near Support?
        if (levels.support) {
            const dist = Math.abs(price - levels.support) / price;
            if (dist < 0.02) lScore += 0.8; // Within 2% of support
        }
        // Is Resistance far away? (Room to run)
        if (levels.resistance) {
            const rewardRoom = (levels.resistance - price) / price;
            if (rewardRoom > 0.04) lScore += 0.2; // >4% room
            else if (rewardRoom < 0.01) warnings.push({ text: 'Resistencia muy cerca (<1%)', type: 'risk' });
        }
    } else { // SELL
        if (levels.resistance) {
            const dist = Math.abs(levels.resistance - price) / price;
            if (dist < 0.02) lScore += 0.8;
        }
        if (levels.support) {
            const room = (price - levels.support) / price;
            if (room < 0.01) warnings.push({ text: 'Soporte muy cerca (<1%)', type: 'risk' });
        }
    }
    subscores.levels = clamp(lScore, 0, 1);
    if (lScore > 0.7) reasons.push({ text: 'Zona Clave (S/R)', weight: percent(lScore) });

    // --- 3.5 Trend Strength (ADX) ---
    if (indicators.adx != null && indicators.adx > 25) {
        trendStrengthScore = clamp((indicators.adx - 25) / 25, 0, 1);
    }
    subscores.trendStrength = trendStrengthScore;

    // --- 3.6 Accumulation/Distribution ---
    if (signalType === 'BUY' && analysis.accumulation?.isAccumulating) {
        accumulationScore = analysis.accumulation.strength || 0.8;
        reasons.push({ text: 'Acumulación detectada', weight: percent(accumulationScore) });
    }
    subscores.accumulation = accumulationScore;

    // --- 3.7 Patterns & Divergence ---
    subscores.patterns = patterns[signalType === 'BUY' ? 'bullishEngulfing' : 'bearishEngulfing'] ? 1 : 0;
    subscores.divergence = divergenceScore;

    // --- FINAL SCORE CALCULATION ---
    let finalNormalized = 0;
    for (const k of Object.keys(w)) {
        // If subscore doesn't exist (e.g. trendStrength), treat as neutral 0.5 or 0 depending on philosophy.
        // Let's treat missing as 0 to be strict, but core ones (mom, trend, vol) must exist.
        finalNormalized += (subscores[k] || 0) * (w[k] || 0);
    }

    // Boost for high-quality setups
    if (choppiness < 30) {
        finalNormalized += 0.1; // Trending boost
        reasons.push({ text: 'Tendencia muy limpia (Low Chop)', weight: 10 });
    }

    finalNormalized = clamp(finalNormalized, 0, 1);

    // ============================================
    // GATE 4: VALIDATION (Deal Breakers)
    // ============================================

    // Threshold Check
    // We lower the strict requirement for patterns/divs, so core indicators carry the load.
    // If score    // Threshold check
    if (finalNormalized <= config.scoreToEmit) {
        console.log(`Rejected ${symbol}: Score ${finalNormalized.toFixed(2)} <= ${config.scoreToEmit}`);
        return null;
    }

    // Volume Validation Gate
    // Signal candle MUST have some decent activity logic, or at least not be dead.
    // But we already factored volume in score. 
    // Let's force a minimum momentum for RISKY mode.
    if (mode === 'RISKY' && subscores.momentum < 0.4) return null; // No momentum, no scalp.

    // === Stop Loss & Take Profit Strategy ===
    const atr = indicators.atr || (price * 0.02);
    let stopLoss, takeProfit1;

    // Dynamic SL based on volatility state
    const volMult = choppiness > 50 ? 2.5 : 1.5; // Wider SL in chop

    if (signalType === 'BUY') {
        stopLoss = price - (atr * volMult);
        if (levels.support) stopLoss = Math.max(stopLoss, levels.support * 0.98); // Use structure if valid
        takeProfit1 = price + (Math.abs(price - stopLoss) * 1.5); // 1.5R target default
    } else {
        stopLoss = price + (atr * volMult);
        if (levels.resistance) stopLoss = Math.min(stopLoss, levels.resistance * 1.02);
        takeProfit1 = price - (Math.abs(stopLoss - price) * 1.5);
    }

    const riskRewardRatio = Math.abs(takeProfit1 - price) / Math.abs(price - stopLoss);
    const scoreOut = Math.round(finalNormalized * 100);

    return {
        symbol,
        type: signalType,
        timestamp: new Date().toISOString(),
        price: price,
        score: scoreOut,
        confidence: scoreOut >= 80 ? 'HIGH' : scoreOut >= 60 ? 'MEDIUM' : 'LOW',
        subscores: Object.fromEntries(Object.entries(subscores).map(([k, v]) => [k, Math.round(v * 100)])),
        reasons,
        warnings,
        levels: {
            entry: price,
            stopLoss,
            takeProfit1,
            support: levels.support,
            resistance: levels.resistance
        },
        riskReward: Number(riskRewardRatio.toFixed(2)),
        indicators: {
            rsi: indicators.rsi != null ? Number(indicators.rsi.toFixed(2)) : null,
            macd: indicators.macd?.histogram != null ? Number(indicators.macd.histogram.toFixed(6)) : null,
            atr: Number(atr.toFixed(8)),
            adx: indicators.adx != null ? Number(indicators.adx.toFixed(1)) : null,
            choppiness: choppiness != null ? Number(choppiness.toFixed(1)) : null
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
