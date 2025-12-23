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
    },
    // SCALPING: Optimizado para day trading / scalping (4-5 operaciones/día)
    // Prioriza momentum rápido y volumen, ignora tendencias largas
    SCALPING: {
        categoryThresholdForConvergence: 0.10,  // Muy bajo, buscamos cualquier señal
        requiredCategories: 1,
        scoreToEmit: 0.28,  // Umbral bajo para mayor frecuencia de señales
        weights: {
            momentum: 0.40,      // Momentum domina (RSI, MACD rápidos)
            trend: 0.10,         // Tendencia tiene menos peso
            trendStrength: 0.05,
            levels: 0.10,        // S/R para entradas precisas
            volume: 0.25,        // Volumen crítico para confirmar
            patterns: 0.05,      // Patrones de vela
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
 * Core scoring logic extracted for reuse
 * Returns the full analysis object or null if it fails hard gates
 */
export function calculateDetailedScore(analysis, symbol, multiTimeframeData = {}, mode = 'BALANCED') {
    const config = getSignalConfig(mode);
    const { indicators = {}, levels = {}, patterns = {}, volume = {}, price, buyerPressure, regime, choppiness } = analysis;
    
    // Initialize dynamic weights
    let dynamicWeights = { ...config.weights };

    const reasons = [];
    const warnings = [];
    let signalType = 'BUY';
    let trendStrengthScore = 0;
    let divergenceScore = 0;
    let accumulationScore = 0;

    // ============================================
    // GATE 1: REGIME & FILTER (Noisy Market check)
    // ============================================

    const isChoppy = choppiness > 60;

    if (isChoppy) {
        if (mode === 'CONSERVATIVE') return null; // Abort in conservative
        
        // RANGING MARKET: Strategy Switch -> Mean Reversion
        warnings.push({ text: 'Mercado Lateral - Reversión activada', type: 'warning' });
        
        // Adjust weights: Kill Trend, Boost Momentum/Levels
        dynamicWeights.trend = 0;
        dynamicWeights.trendStrength = 0;
        dynamicWeights.momentum = Math.min(1, dynamicWeights.momentum * 1.5);
        dynamicWeights.levels = Math.min(1, dynamicWeights.levels * 1.5);
    } else {
        // TRENDING MARKET
        // Check for weak trend
        if (indicators.adx != null && indicators.adx < 20) {
            if (mode === 'CONSERVATIVE') return null;
            warnings.push({ text: 'Tendencia débil (ADX < 20)', type: 'risk' });
        }
    }

    // ============================================
    // GATE 2: TREND ALIGNMENT & BIAS
    // ============================================

    // Determine Bias based on Multi-Timeframe
    const dailyRegime = multiTimeframeData['1d']?.regime || 'UNKNOWN';
    const h4Regime = multiTimeframeData['4h']?.regime || 'UNKNOWN';
    const currentRegime = dailyRegime !== 'UNKNOWN' ? dailyRegime : (h4Regime !== 'UNKNOWN' ? h4Regime : regime);

    if (isChoppy) {
        // === REVERSION STRATEGY ===
        // Ignore trend bias, look for band extremes
        if (indicators.bollingerBands) {
             const bb = indicators.bollingerBands;
             // Allow 1% tolerance
             if (price <= bb.lower * 1.01) signalType = 'BUY';
             else if (price >= bb.upper * 0.99) signalType = 'SELL';
             else {
                 // Secondary check: RSI Extremes
                 if (indicators.rsi < 30) signalType = 'BUY';
                 else if (indicators.rsi > 70) signalType = 'SELL';
                 else return null; // No reversion signal found in chop
             }
        } else {
            return null; // Cannot trade chop without bands
        }
    } else {
        // === TREND FOLLOWING STRATEGY ===
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
        if (bias === 'BULLISH') signalType = 'BUY';
        else if (bias === 'BEARISH') signalType = 'SELL';
        else {
            // Flat market but not choppy? Unlikely, but fallback
            if (indicators.ema50 && price < indicators.ema50) signalType = 'SELL';
            else signalType = 'BUY';
        }
    }

    // Strict Trend Filter for Conservative
    if (mode === 'CONSERVATIVE') {
        if (bias === 'BULLISH' && signalType === 'SELL') return null; // No counter-trend
        if (bias === 'BEARISH' && signalType === 'BUY') return null;
        if (bias === 'NEUTRAL') return null;
    }

    // Filter against SMA200 (Major Trend Line)
    if (indicators.sma200) {
        if (signalType === 'BUY' && price < indicators.sma200) {
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
    const w = dynamicWeights;

    // --- 3.1 Momentum (RSI, MACD, Stoch) ---
    let impScore = 0;

    // ===== SCALPING MODE: Enhanced Momentum Scoring =====
    if (mode === 'SCALPING') {
        // RSI
        if (indicators.rsi) {
            if (signalType === 'BUY') {
                if (indicators.rsi >= 25 && indicators.rsi <= 45) impScore += 1.0;
                else if (indicators.rsi < 25) impScore += 1.2;
                else if (indicators.rsi >= 45 && indicators.rsi <= 55) impScore += 0.6;
            } else { // SELL
                if (indicators.rsi >= 55 && indicators.rsi <= 75) impScore += 1.0;
                else if (indicators.rsi > 75) impScore += 1.2;
                else if (indicators.rsi >= 45 && indicators.rsi < 55) impScore += 0.6;
            }
        }

        // RSI Velocity
        if (indicators.rsiVelocity != null) {
            if (signalType === 'BUY' && indicators.rsiVelocity > 5) {
                impScore += 0.8;
                reasons.push({ text: 'RSI acelerando ↑', weight: 80 });
            }
            if (signalType === 'SELL' && indicators.rsiVelocity < -5) {
                impScore += 0.8;
                reasons.push({ text: 'RSI cayendo ↓', weight: 80 });
            }
        }

        // Stochastic
        if (indicators.stochastic?.k != null && indicators.stochastic?.d != null) {
            const stochK = indicators.stochastic.k;
            const stochD = indicators.stochastic.d;

            if (signalType === 'BUY') {
                if (stochK < 25 && stochK > stochD) {
                    impScore += 1.0;
                    reasons.push({ text: 'Stoch cruce alcista', weight: 100 });
                } else if (stochK < 40) {
                    impScore += 0.5;
                }
            } else { // SELL
                if (stochK > 75 && stochK < stochD) {
                    impScore += 1.0;
                    reasons.push({ text: 'Stoch cruce bajista', weight: 100 });
                } else if (stochK > 60) {
                    impScore += 0.5;
                }
            }
        }

        // MACD
        if (indicators.macd?.histogram != null) {
            const hist = indicators.macd.histogram;
            if (signalType === 'BUY' && hist > 0) impScore += 0.6;
            if (signalType === 'SELL' && hist < 0) impScore += 0.6;
        }

        // EMA9 Alignment
        if (indicators.ema9 != null) {
            if (signalType === 'BUY' && price > indicators.ema9) {
                impScore += 0.5;
                reasons.push({ text: 'Sobre EMA9 (micro-trend)', weight: 50 });
            }
            if (signalType === 'SELL' && price < indicators.ema9) {
                impScore += 0.5;
                reasons.push({ text: 'Bajo EMA9 (micro-trend)', weight: 50 });
            }
        }

        subscores.momentum = clamp(impScore / 4.5, 0, 1);

    } else if (mode === 'CONSERVATIVE') {
        // RSI
        if (indicators.rsi) {
            if (signalType === 'BUY') {
                if (indicators.rsi >= 30 && indicators.rsi <= 45) impScore += 1.0;
                else if (indicators.rsi < 30) impScore += 0.8;
            } else {
                if (indicators.rsi >= 55 && indicators.rsi <= 70) impScore += 1.0;
                else if (indicators.rsi > 70) impScore += 0.8;
            }
        }

        // RSI Velocity
        if (indicators.rsiVelocity != null) {
            if (signalType === 'BUY' && indicators.rsiVelocity > 3) {
                impScore += 0.6;
                reasons.push({ text: 'RSI recuperando ↑', weight: 60 });
            }
            if (signalType === 'SELL' && indicators.rsiVelocity < -3) {
                impScore += 0.6;
                reasons.push({ text: 'RSI cayendo ↓', weight: 60 });
            }
        }

        // Stochastic
        if (indicators.stochastic?.k != null) {
            const stochK = indicators.stochastic.k;
            if (signalType === 'BUY' && stochK > 20 && stochK < 50) impScore += 0.5;
            if (signalType === 'SELL' && stochK > 50 && stochK < 80) impScore += 0.5;
        }

        // MACD
        if (indicators.macd?.histogram != null) {
            const hist = indicators.macd.histogram;
            if (signalType === 'BUY' && hist > 0) impScore += 0.4;
            if (signalType === 'SELL' && hist < 0) impScore += 0.4;
        }

        subscores.momentum = clamp(impScore / 2.5, 0, 1);

    } else if (mode === 'RISKY') {
        // RSI
        if (indicators.rsi) {
            if (signalType === 'BUY') {
                if (indicators.rsi < 30) impScore += 1.2;
                else if (indicators.rsi >= 30 && indicators.rsi <= 50) impScore += 0.8;
                else if (indicators.rsi > 50 && indicators.rsi < 65) impScore += 0.5;
            } else {
                if (indicators.rsi > 70) impScore += 1.2;
                else if (indicators.rsi >= 50 && indicators.rsi <= 70) impScore += 0.8;
                else if (indicators.rsi > 35 && indicators.rsi < 50) impScore += 0.5;
            }
        }

        // RSI Velocity
        if (indicators.rsiVelocity != null) {
            if (signalType === 'BUY' && indicators.rsiVelocity > 8) {
                impScore += 1.0;
                reasons.push({ text: 'Aceleración fuerte ↑↑', weight: 100 });
            } else if (signalType === 'BUY' && indicators.rsiVelocity > 4) {
                impScore += 0.5;
            }
            if (signalType === 'SELL' && indicators.rsiVelocity < -8) {
                impScore += 1.0;
                reasons.push({ text: 'Aceleración fuerte ↓↓', weight: 100 });
            } else if (signalType === 'SELL' && indicators.rsiVelocity < -4) {
                impScore += 0.5;
            }
        }

        // Stochastic
        if (indicators.stochastic?.k != null && indicators.stochastic?.d != null) {
            const stochK = indicators.stochastic.k;
            const stochD = indicators.stochastic.d;
            if (signalType === 'BUY') {
                if (stochK < 20) impScore += 0.8;
                if (stochK < 30 && stochK > stochD) {
                    impScore += 0.6;
                    reasons.push({ text: 'Stoch cruce alcista', weight: 60 });
                }
            } else {
                if (stochK > 80) impScore += 0.8;
                if (stochK > 70 && stochK < stochD) {
                    impScore += 0.6;
                    reasons.push({ text: 'Stoch cruce bajista', weight: 60 });
                }
            }
        }

        // MACD
        if (indicators.macd?.histogram != null) {
            const hist = indicators.macd.histogram;
            if (signalType === 'BUY' && hist > 0) impScore += 0.5;
            if (signalType === 'SELL' && hist < 0) impScore += 0.5;
        }

        subscores.momentum = clamp(impScore / 3.5, 0, 1);

    } else {
        // BALANCED
        if (indicators.rsi) {
            if (signalType === 'BUY') {
                if (indicators.rsi >= 35 && indicators.rsi <= 50) impScore += 1.0;
                else if (indicators.rsi < 35) impScore += 0.8;
                else if (indicators.rsi > 50 && indicators.rsi < 60) impScore += 0.4;
            } else {
                if (indicators.rsi >= 50 && indicators.rsi <= 65) impScore += 1.0;
                else if (indicators.rsi > 65) impScore += 0.8;
                else if (indicators.rsi > 40 && indicators.rsi < 50) impScore += 0.4;
            }
        }

        // RSI Velocity
        if (indicators.rsiVelocity != null) {
            if (signalType === 'BUY' && indicators.rsiVelocity > 4) {
                impScore += 0.6;
                reasons.push({ text: 'RSI acelerando ↑', weight: 60 });
            }
            if (signalType === 'SELL' && indicators.rsiVelocity < -4) {
                impScore += 0.6;
                reasons.push({ text: 'RSI cayendo ↓', weight: 60 });
            }
        }

        // Stochastic
        if (indicators.stochastic?.k != null && indicators.stochastic?.d != null) {
            const stochK = indicators.stochastic.k;
            const stochD = indicators.stochastic.d;
            if (signalType === 'BUY' && stochK < 35 && stochK > stochD) {
                impScore += 0.6;
                reasons.push({ text: 'Stoch alcista', weight: 60 });
            }
            if (signalType === 'SELL' && stochK > 65 && stochK < stochD) {
                impScore += 0.6;
                reasons.push({ text: 'Stoch bajista', weight: 60 });
            }
        }

        // MACD
        if (indicators.macd?.histogram != null) {
            const hist = indicators.macd.histogram;
            if (signalType === 'BUY' && hist > 0) impScore += 0.5;
            if (signalType === 'SELL' && hist < 0) impScore += 0.5;
        }

        subscores.momentum = clamp(impScore / 2.7, 0, 1);
    }

    if (subscores.momentum > 0.6) reasons.push({ text: 'Momentum fuerte', weight: percent(subscores.momentum) });

    // --- 3.2 Trend Quality ---
    let tScore = 0;
    if (indicators.ema20 && indicators.ema50) {
        if (signalType === 'BUY' && indicators.ema20 > indicators.ema50) tScore += 0.6;
        if (signalType === 'SELL' && indicators.ema20 < indicators.ema50) tScore += 0.6;
    }
    if (signalType === 'BUY' && price > indicators.ema20) tScore += 0.2;
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
        if (levels.support) {
            const dist = Math.abs(price - levels.support) / price;
            if (dist < 0.02) lScore += 0.8;
        }
        if (levels.resistance) {
            const rewardRoom = (levels.resistance - price) / price;
            if (rewardRoom > 0.04) lScore += 0.2;
            else if (rewardRoom < 0.01) warnings.push({ text: 'Resistencia muy cerca (<1%)', type: 'risk' });
        }
    } else {
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
        finalNormalized += (subscores[k] || 0) * (w[k] || 0);
    }

    // Boosts
    if (choppiness < 30) {
        finalNormalized += 0.1;
        reasons.push({ text: 'Tendencia muy limpia (Low Chop)', weight: 10 });
    }

    if (mode === 'SCALPING') {
        if (subscores.momentum >= 0.6) {
            finalNormalized += 0.20;
            reasons.push({ text: '⚡ Scalping Momentum Boost', weight: 20 });
        }
        if (indicators.ema9 && indicators.ema20) {
            if (signalType === 'BUY' && indicators.ema9 > indicators.ema20 && price > indicators.ema9) {
                finalNormalized += 0.15;
                reasons.push({ text: 'EMA9 > EMA20 (Micro-tendencia)', weight: 15 });
            }
            if (signalType === 'SELL' && indicators.ema9 < indicators.ema20 && price < indicators.ema9) {
                finalNormalized += 0.15;
                reasons.push({ text: 'EMA9 < EMA20 (Micro-tendencia)', weight: 15 });
            }
        }
        if (buyerPressure?.current > 50 && signalType === 'BUY') finalNormalized += 0.10;
        if (buyerPressure?.current < 50 && signalType === 'SELL') finalNormalized += 0.10;
        if (patterns.hammer || patterns.bullishEngulfing) {
            finalNormalized += 0.15;
            reasons.push({ text: 'Patrón de vela alcista', weight: 15 });
        }
    }

    if (mode === 'CONSERVATIVE') {
        if (indicators.ema20 && indicators.ema50 && indicators.sma200) {
            if (signalType === 'BUY' && indicators.ema20 > indicators.ema50 && price > indicators.sma200) {
                finalNormalized += 0.20;
                reasons.push({ text: '🛡️ Triple alineación alcista', weight: 20 });
            }
            if (signalType === 'SELL' && indicators.ema20 < indicators.ema50 && price < indicators.sma200) {
                finalNormalized += 0.20;
                reasons.push({ text: '🛡️ Triple alineación bajista', weight: 20 });
            }
        }
        if (indicators.adx && indicators.adx > 30) {
            finalNormalized += 0.15;
            reasons.push({ text: 'Tendencia fuerte (ADX)', weight: 15 });
        }
        if (choppiness < 40) finalNormalized += 0.10;
    }

    if (mode === 'BALANCED') {
        if (indicators.ema20 && indicators.ema50) {
            if (signalType === 'BUY' && indicators.ema20 > indicators.ema50) {
                finalNormalized += 0.12;
                reasons.push({ text: '⚖️ EMA alineación', weight: 12 });
            }
            if (signalType === 'SELL' && indicators.ema20 < indicators.ema50) {
                finalNormalized += 0.12;
                reasons.push({ text: '⚖️ EMA alineación', weight: 12 });
            }
        }
        if (analysis.divergence?.rsi?.bullish && signalType === 'BUY') {
            finalNormalized += 0.15;
            reasons.push({ text: 'Divergencia RSI alcista', weight: 15 });
        }
        if (analysis.divergence?.rsi?.bearish && signalType === 'SELL') {
            finalNormalized += 0.15;
            reasons.push({ text: 'Divergencia RSI bajista', weight: 15 });
        }
        if (volume.spike) finalNormalized += 0.10;
    }

    if (mode === 'RISKY') {
        if (patterns.hammer || patterns.bullishEngulfing || patterns.morningStar) {
            finalNormalized += 0.20;
            reasons.push({ text: '🚀 Patrón de reversión', weight: 20 });
        }
        if (patterns.eveningStar || patterns.doubleTop) {
            finalNormalized += 0.20;
            reasons.push({ text: '🚀 Patrón bajista', weight: 20 });
        }
        if (subscores.momentum >= 0.7) {
            finalNormalized += 0.15;
            reasons.push({ text: 'Momentum explosivo', weight: 15 });
        }
        if (indicators.stochastic?.k < 15 && signalType === 'BUY') {
            finalNormalized += 0.10;
            reasons.push({ text: 'Stoch extremo (oversold)', weight: 10 });
        }
        if (indicators.stochastic?.k > 85 && signalType === 'SELL') {
            finalNormalized += 0.10;
            reasons.push({ text: 'Stoch extremo (overbought)', weight: 10 });
        }
    }

    finalNormalized = clamp(finalNormalized, 0, 1);

    // === Stop Loss & Take Profit Strategy ===
    const atr = indicators.atr || (price * 0.02);
    let stopLoss, takeProfit1, takeProfit2;
    let volMult;
    if (mode === 'SCALPING') {
        volMult = choppiness > 50 ? 1.2 : 0.8;
    } else {
        volMult = choppiness > 50 ? 2.5 : 1.5;
    }

    if (signalType === 'BUY') {
        stopLoss = price - (atr * volMult);
        if (levels.support) stopLoss = Math.max(stopLoss, levels.support * 0.98);
        takeProfit1 = price + (Math.abs(price - stopLoss) * 1.5);
        takeProfit2 = price + (Math.abs(price - stopLoss) * 2.5);
    } else {
        stopLoss = price + (atr * volMult);
        if (levels.resistance) stopLoss = Math.min(stopLoss, levels.resistance * 1.02);
        takeProfit1 = price - (Math.abs(stopLoss - price) * 1.5);
        takeProfit2 = price - (Math.abs(stopLoss - price) * 2.5);
    }

    const riskRewardRatio = Math.abs(takeProfit1 - price) / Math.abs(price - stopLoss);

    return {
        score: finalNormalized,
        signalType,
        reasons,
        warnings,
        subscores,
        levels: {
            entry: price,
            stopLoss,
            takeProfit1,
            takeProfit2,
            support: levels.support,
            resistance: levels.resistance
        },
        riskReward: Number(riskRewardRatio.toFixed(2)),
        currentRegime
    };
}

/**
 * Generar señal de trading basada en análisis técnico
 * Wrapper alrededor de calculateDetailedScore
 */
export function generateSignal(analysis, symbol, multiTimeframeData = {}, mode = 'BALANCED') {
    const raw = calculateDetailedScore(analysis, symbol, multiTimeframeData, mode);
    
    // Si calculateDetailedScore retorna null (por Gate 1/2), no hay señal
    if (!raw) return null;

    const { score, signalType, reasons, warnings, subscores, levels, riskReward, currentRegime } = raw;
    const config = getSignalConfig(mode);

    // Threshold Check
    if (score <= config.scoreToEmit) {
        console.log(`Rejected ${symbol}: Score ${score.toFixed(2)} <= ${config.scoreToEmit}`);
        return null;
    }

    // Volume Validation Gate for RISKY
    if (mode === 'RISKY' && subscores.momentum < 0.4) return null;

    const scoreOut = Math.round(score * 100);

    return {
        symbol,
        type: signalType,
        timestamp: new Date().toISOString(),
        price: analysis.price,
        score: scoreOut,
        confidence: scoreOut >= 80 ? 'HIGH' : scoreOut >= 60 ? 'MEDIUM' : 'LOW',
        subscores: Object.fromEntries(Object.entries(subscores).map(([k, v]) => [k, Math.round(v * 100)])),
        reasons,
        warnings,
        levels,
        riskReward,
        indicators: {
            rsi: analysis.indicators.rsi != null ? Number(analysis.indicators.rsi.toFixed(2)) : null,
            macd: analysis.indicators.macd?.histogram != null ? Number(analysis.indicators.macd.histogram.toFixed(6)) : null,
            atr: Number((analysis.indicators.atr || 0).toFixed(8)),
            adx: analysis.indicators.adx != null ? Number(analysis.indicators.adx.toFixed(1)) : null,
            choppiness: analysis.choppiness != null ? Number(analysis.choppiness.toFixed(1)) : null
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
