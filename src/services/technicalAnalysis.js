/**
 * Servicio de Análisis Técnico
 * Implementa indicadores técnicos para análisis de criptomonedas
 */

/**
 * Calcular SMA (Simple Moving Average)
 * @param {Array<number>} data - Array de precios
 * @param {number} period - Período de la media
 * @returns {Array<number>} SMA values
 */
export function calculateSMA(data, period) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            sma.push(null);
        } else {
            const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            sma.push(sum / period);
        }
    }
    return sma;
}

/**
 * Calcular EMA (Exponential Moving Average)
 * @param {Array<number>} data - Array de precios
 * @param {number} period - Período de la media
 * @returns {Array<number>} EMA values
 */
export function calculateEMA(data, period) {
    const ema = [];
    const multiplier = 2 / (period + 1);

    // Primera EMA es SMA
    let sum = 0;
    for (let i = 0; i < period; i++) {
        if (i < data.length) {
            sum += data[i];
            ema.push(null);
        }
    }

    if (data.length >= period) {
        ema[period - 1] = sum / period;

        // Calcular EMA subsecuentes
        for (let i = period; i < data.length; i++) {
            const currentEMA = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
            ema.push(currentEMA);
        }
    }

    return ema;
}

/**
 * Calcular RSI (Relative Strength Index)
 * @param {Array<number>} prices - Array de precios de cierre
 * @param {number} period - Período del RSI (típicamente 14)
 * @returns {Array<number>} RSI values (0-100)
 */
export function calculateRSI(prices, period = 14) {
    const rsi = [];
    const gains = [];
    const losses = [];

    // Calcular cambios de precio
    for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
    }

    // Calcular RSI
    for (let i = 0; i < prices.length; i++) {
        if (i < period) {
            rsi.push(null);
        } else {
            const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
            const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;

            if (avgLoss === 0) {
                rsi.push(100);
            } else {
                const rs = avgGain / avgLoss;
                rsi.push(100 - (100 / (1 + rs)));
            }
        }
    }

    return rsi;
}

/**
 * Calcular MACD (Moving Average Convergence Divergence)
 * @param {Array<number>} prices - Array de precios de cierre
 * @param {number} fastPeriod - Período rápido (típicamente 12)
 * @param {number} slowPeriod - Período lento (típicamente 26)
 * @param {number} signalPeriod - Período de señal (típicamente 9)
 * @returns {Object} { macd, signal, histogram }
 */
export function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = calculateEMA(prices, fastPeriod);
    const slowEMA = calculateEMA(prices, slowPeriod);

    // Calcular línea MACD
    const macdLine = fastEMA.map((fast, i) => {
        if (fast === null || slowEMA[i] === null) return null;
        return fast - slowEMA[i];
    });

    // Calcular línea de señal (EMA del MACD)
    const validMacd = macdLine.filter(v => v !== null);
    const signalLine = calculateEMA(validMacd, signalPeriod);

    // Ajustar longitud de signal line
    const paddedSignal = Array(macdLine.length - signalLine.length).fill(null).concat(signalLine);

    // Calcular histograma
    const histogram = macdLine.map((macd, i) => {
        if (macd === null || paddedSignal[i] === null) return null;
        return macd - paddedSignal[i];
    });

    return {
        macd: macdLine,
        signal: paddedSignal,
        histogram
    };
}

/**
 * Calcular Bandas de Bollinger
 * @param {Array<number>} prices - Array de precios de cierre
 * @param {number} period - Período (típicamente 20)
 * @param {number} stdDev - Desviaciones estándar (típicamente 2)
 * @returns {Object} { upper, middle, lower }
 */
export function calculateBollingerBands(prices, period = 20, stdDev = 2) {
    const middle = calculateSMA(prices, period);
    const upper = [];
    const lower = [];

    for (let i = 0; i < prices.length; i++) {
        if (i < period - 1) {
            upper.push(null);
            lower.push(null);
        } else {
            const slice = prices.slice(i - period + 1, i + 1);
            const mean = middle[i];
            const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
            const sd = Math.sqrt(variance);

            upper.push(mean + (stdDev * sd));
            lower.push(mean - (stdDev * sd));
        }
    }

    return { upper, middle, lower };
}

/**
 * Detectar niveles de soporte y resistencia
 * @param {Array<Object>} candles - Datos de velas con high, low, close
 * @param {number} lookback - Velas para mirar atrás
 * @returns {Object} { support, resistance }
 */
export function findSupportResistance(candles, lookback = 20) {
    const recent = candles.slice(-lookback);

    const highs = recent.map(c => c.high);
    const lows = recent.map(c => c.low);

    const resistance = Math.max(...highs);
    const support = Math.min(...lows);

    return { support, resistance };
}

/**
 * Detectar patrón de vela Hammer
 * @param {Object} candle - Datos de una vela
 * @returns {boolean} True si es hammer
 */
export function isHammer(candle) {
    const body = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.close, candle.open);
    const lowerWick = Math.min(candle.close, candle.open) - candle.low;
    const totalRange = candle.high - candle.low;

    // Hammer: cuerpo pequeño, mecha inferior larga, mecha superior pequeña
    return (
        lowerWick > body * 2 &&
        upperWick < body * 0.5 &&
        body / totalRange < 0.3
    );
}

/**
 * Detectar patrón Engulfing Bullish
 * @param {Object} prevCandle - Vela anterior
 * @param {Object} currentCandle - Vela actual
 * @returns {boolean} True si es engulfing bullish
 */
export function isBullishEngulfing(prevCandle, currentCandle) {
    const prevBearish = prevCandle.close < prevCandle.open;
    const currentBullish = currentCandle.close > currentCandle.open;

    return (
        prevBearish &&
        currentBullish &&
        currentCandle.open < prevCandle.close &&
        currentCandle.close > prevCandle.open
    );
}

/**
 * Detectar patrón Doji
 * @param {Object} candle - Datos de una vela
 * @returns {boolean} True si es doji
 */
export function isDoji(candle) {
    const body = Math.abs(candle.close - candle.open);
    const totalRange = candle.high - candle.low;

    // Doji: cuerpo muy pequeño comparado con el rango total
    return body / totalRange < 0.1;
}

/**
 * Calcular volumen promedio
 * @param {Array<Object>} candles - Datos de velas
 * @param {number} period - Período
 * @returns {number} Volumen promedio
 */
export function calculateAverageVolume(candles, period = 20) {
    const recent = candles.slice(-period);
    const totalVolume = recent.reduce((sum, c) => sum + c.volume, 0);
    return totalVolume / period;
}

/**
 * Analizar si hay volumen inusual (spike)
 * @param {Array<Object>} candles - Datos de velas
 * @param {number} threshold - Multiplicador del promedio (ej: 1.5 = 50% más)
 * @returns {boolean} True si hay volumen inusual
 */
export function hasVolumeSpike(candles, threshold = 1.5) {
    if (candles.length < 2) return false;

    const avgVolume = calculateAverageVolume(candles.slice(0, -1), 20);
    const currentVolume = candles[candles.length - 1].volume;

    return currentVolume > avgVolume * threshold;
}

/**
 * Realizar análisis técnico completo
 * @param {Array<Object>} candles - Datos de velas
 * @returns {Object} Análisis técnico completo
 */
export function performTechnicalAnalysis(candles) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes);
    const bb = calculateBollingerBands(closes, 20, 2);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const sma200 = calculateSMA(closes, 200);
    const { support, resistance } = findSupportResistance(candles, 20);

    // Obtener valores actuales (último índice con datos válidos)
    const lastIndex = closes.length - 1;
    const currentCandle = candles[lastIndex];
    const prevCandle = candles[lastIndex - 1];

    // Detectar patrones
    const patterns = {
        hammer: isHammer(currentCandle),
        bullishEngulfing: isBullishEngulfing(prevCandle, currentCandle),
        doji: isDoji(currentCandle)
    };

    return {
        price: closes[lastIndex],
        indicators: {
            rsi: rsi[lastIndex],
            macd: {
                value: macd.macd[lastIndex],
                signal: macd.signal[lastIndex],
                histogram: macd.histogram[lastIndex]
            },
            bollingerBands: {
                upper: bb.upper[lastIndex],
                middle: bb.middle[lastIndex],
                lower: bb.lower[lastIndex]
            },
            ema20: ema20[lastIndex],
            ema50: ema50[lastIndex],
            sma200: sma200[lastIndex]
        },
        levels: {
            support,
            resistance
        },
        patterns,
        volume: {
            current: currentCandle.volume,
            average: calculateAverageVolume(candles, 20),
            spike: hasVolumeSpike(candles, 1.5)
        },
        // Datos completos para gráficos
        fullData: {
            rsi,
            macd,
            bollingerBands: bb,
            ema20,
            ema50,
            sma200
        }
    };
}
