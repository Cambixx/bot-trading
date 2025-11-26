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
 * Detectar patrón Three White Soldiers (3 velas alcistas consecutivas)
 * @param {Array<Object>} candles - Últimas 3 velas
 * @returns {boolean} True si es three white soldiers
 */
export function isThreeWhiteSoldiers(candles) {
    if (candles.length < 3) return false;

    const last3 = candles.slice(-3);

    // Todas las 3 deben ser alcistas
    const allBullish = last3.every(c => c.close > c.open);

    if (!allBullish) return false;

    // Cada vela debe cerrar progresivamente más alta
    const progressiveHigher = (
        last3[1].close > last3[0].close &&
        last3[2].close > last3[1].close
    );

    // Volumes en ascenso
    const volumeIncreasing = (
        last3[1].volume > last3[0].volume &&
        last3[2].volume > last3[1].volume
    );

    return progressiveHigher && volumeIncreasing;
}

/**
 * Detectar patrón Morning Star (reversión de tendencia bajista)
 * @param {Array<Object>} candles - Últimas 3 velas
 * @returns {boolean} True si es morning star
 */
export function isMorningStar(candles) {
    if (candles.length < 3) return false;

    const last3 = candles.slice(-3);

    // Primera vela: bajista (roja)
    const firstBearish = last3[0].close < last3[0].open;

    // Segunda vela: pequeño cuerpo (indecisión) - puede ser cualquier color
    const secondSmall = Math.abs(last3[1].close - last3[1].open) < Math.abs(last3[0].close - last3[0].open) * 0.5;

    // Tercera vela: alcista (verde) y cierra en mitad o arriba de la primera
    const thirdBullish = last3[2].close > last3[2].open;
    const thirdCloseAboveFirst = last3[2].close > last3[0].open;

    return firstBearish && secondSmall && thirdBullish && thirdCloseAboveFirst;
}

/**
 * Detectar patrón Evening Star (reversión de tendencia alcista)
 * @param {Array<Object>} candles - Últimas 3 velas
 * @returns {boolean} True si es evening star
 */
export function isEveningStar(candles) {
    if (candles.length < 3) return false;

    const last3 = candles.slice(-3);

    // Primera vela: alcista (verde)
    const firstBullish = last3[0].close > last3[0].open;

    // Segunda vela: pequeño cuerpo (indecisión)
    const secondSmall = Math.abs(last3[1].close - last3[1].open) < Math.abs(last3[0].close - last3[0].open) * 0.5;

    // Tercera vela: bajista (roja) y cierra en mitad o debajo de la primera
    const thirdBearish = last3[2].close < last3[2].open;
    const thirdCloseBelowFirst = last3[2].close < last3[0].open;

    return firstBullish && secondSmall && thirdBearish && thirdCloseBelowFirst;
}

/**
 * Detectar patrón Double Bottom (soporte doble, reversión alcista)
 * @param {Array<Object>} candles - Últimas 5-10 velas
 * @param {number} tolerance - Tolerancia en % para considerar "mismo nivel"
 * @returns {boolean} True si es double bottom
 */
export function isDoubleBottom(candles, tolerance = 1) {
    if (candles.length < 5) return false;

    const lows = candles.slice(-10).map(c => c.low);
    const closes = candles.slice(-10).map(c => c.close);

    // Encontrar dos mínimos similares
    const lowestIdx1 = lows.indexOf(Math.min(...lows.slice(0, -3)));
    const lowestIdx2 = lows.indexOf(Math.min(...lows.slice(-3)));

    if (lowestIdx1 >= lowestIdx2 || lowestIdx2 - lowestIdx1 < 2) return false;

    const low1 = lows[lowestIdx1];
    const low2 = lows[lowestIdx2];

    const priceTolerance = (low1 * tolerance) / 100;

    // Los dos mínimos deben ser similares
    if (Math.abs(low1 - low2) > priceTolerance) return false;

    // Debe haber un pico entre los dos mínimos
    const peakBetween = Math.max(...lows.slice(lowestIdx1 + 1, lowestIdx2));
    if (peakBetween < Math.max(low1, low2)) return false;

    // La última vela debe estar en recuperación
    const lastClose = closes[closes.length - 1];
    return lastClose > (low1 + low2) / 2;
}

/**
 * Detectar patrón Double Top (resistencia doble, reversión bajista)
 * @param {Array<Object>} candles - Últimas 5-10 velas
 * @param {number} tolerance - Tolerancia en % para considerar "mismo nivel"
 * @returns {boolean} True si es double top
 */
export function isDoubleTop(candles, tolerance = 1) {
    if (candles.length < 5) return false;

    const highs = candles.slice(-10).map(c => c.high);
    const closes = candles.slice(-10).map(c => c.close);

    // Encontrar dos máximos similares
    const highestIdx1 = highs.indexOf(Math.max(...highs.slice(0, -3)));
    const highestIdx2 = highs.indexOf(Math.max(...highs.slice(-3)));

    if (highestIdx1 >= highestIdx2 || highestIdx2 - highestIdx1 < 2) return false;

    const high1 = highs[highestIdx1];
    const high2 = highs[highestIdx2];

    const priceTolerance = (high1 * tolerance) / 100;

    // Los dos máximos deben ser similares
    if (Math.abs(high1 - high2) > priceTolerance) return false;

    // Debe haber un valle entre los dos máximos
    const valleyBetween = Math.min(...highs.slice(highestIdx1 + 1, highestIdx2));
    if (valleyBetween > Math.min(high1, high2)) return false;

    // La última vela debe estar en caída
    const lastClose = closes[closes.length - 1];
    return lastClose < (high1 + high2) / 2;
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
 * Calcular ATR (Average True Range) - Medida de volatilidad
 * @param {Array<Object>} candles - Datos de velas con high, low, close
 * @param {number} period - Período del ATR (típicamente 14)
 * @returns {Array<number>} ATR values
 */
export function calculateATR(candles, period = 14) {
    const trueRanges = [];

    // Calcular True Range para cada vela
    for (let i = 0; i < candles.length; i++) {
        let tr;

        if (i === 0) {
            tr = candles[i].high - candles[i].low;
        } else {
            const hl = candles[i].high - candles[i].low;
            const hc = Math.abs(candles[i].high - candles[i - 1].close);
            const lc = Math.abs(candles[i].low - candles[i - 1].close);
            tr = Math.max(hl, hc, lc);
        }

        trueRanges.push(tr);
    }

    // Calcular ATR como EMA del True Range
    const atrValues = [];

    for (let i = 0; i < trueRanges.length; i++) {
        if (i < period - 1) {
            atrValues.push(null);
        } else if (i === period - 1) {
            // Primera ATR es SMA del TR
            const sum = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
            atrValues.push(sum / period);
        } else {
            // ATRs subsecuentes es EMA del TR
            const prevATR = atrValues[i - 1];
            const currentATR = (trueRanges[i] - prevATR) * (2 / (period + 1)) + prevATR;
            atrValues.push(currentATR);
        }
    }

    return atrValues;
}

/**
 * Calcular presión de compradores (Buy/Sell Pressure)
 * Usa takerBuyBaseVolume para determinar qué % del volumen fue de compradores
 * @param {Array<Object>} candles - Datos de velas
 * @returns {Object} { current, average, pressure }
 *   - current: % de volumen compradores en vela actual
 *   - average: % promedio de últimas 20 velas
 *   - pressure: 'BULLISH' si >60%, 'BEARISH' si <40%, 'NEUTRAL' si entre 40-60%
 */
export function calculateBuyerPressure(candles) {
    if (candles.length === 0) return null;

    // Calcular buyer pressure para últimas 20 velas
    const recentCandles = candles.slice(-20);
    const pressures = recentCandles.map(candle => {
        const buyVolume = candle.takerBuyBaseVolume || 0;
        const totalVolume = candle.volume || 1;
        return (buyVolume / totalVolume) * 100;
    });

    const currentPressure = pressures[pressures.length - 1];
    const averagePressure = pressures.reduce((a, b) => a + b, 0) / pressures.length;

    // Determinar presión general
    let pressure = 'NEUTRAL';
    if (currentPressure > 60) {
        pressure = 'BULLISH';
    } else if (currentPressure < 40) {
        pressure = 'BEARISH';
    }

    return {
        current: currentPressure,
        average: averagePressure,
        pressure
    };
}

/**
 * Calcular Stochastic Oscillator - Detecta sobreventa/sobrecompra
 * @param {Array<Object>} candles - Datos de velas
 * @param {number} period - Período lookback (típicamente 14)
 * @param {number} smoothK - Suavizado K (típicamente 3)
 * @param {number} smoothD - Suavizado D (típicamente 3)
 * @returns {Object} { stochK, stochD, stochHistogram }
 */
export function calculateStochastic(candles, period = 14, smoothK = 3, smoothD = 3) {
    const closes = candles.map(c => c.close);

    const rawStoch = [];

    // Calcular %K raw (fast stochastic)
    for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) {
            rawStoch.push(null);
        } else {
            const slice = candles.slice(i - period + 1, i + 1);
            const periodHigh = Math.max(...slice.map(c => c.high));
            const periodLow = Math.min(...slice.map(c => c.low));
            const currentClose = closes[i];

            const k = ((currentClose - periodLow) / (periodHigh - periodLow)) * 100;
            rawStoch.push(isNaN(k) ? 50 : k);
        }
    }

    // Suavizar K con SMA
    const stochK = calculateSMA(rawStoch, smoothK);

    // Suavizar D (SMA de K)
    const stochD = calculateSMA(stochK, smoothD);

    // Calcular histograma
    const stochHistogram = stochK.map((k, i) => {
        if (k === null || stochD[i] === null) return null;
        return k - stochD[i];
    });

    return {
        stochK,
        stochD,
        stochHistogram
    };
}

/**
 * Calcular On-Balance Volume (OBV)
 * @param {Array<Object>} candles - Datos de velas
 * @returns {Array<number>} OBV values
 */
export function calculateOBV(candles) {
    const obv = [0];

    for (let i = 1; i < candles.length; i++) {
        let change = 0;

        if (candles[i].close > candles[i - 1].close) {
            change = candles[i].volume;
        } else if (candles[i].close < candles[i - 1].close) {
            change = -candles[i].volume;
        }

        obv.push(obv[i - 1] + change);
    }

    return obv;
}

/**
 * Detectar divergencias entre precio e indicador
 * @param {Array<number>} prices - Array de precios
 * @param {Array<number>} indicator - Array de valores del indicador (RSI, MACD, etc)
 * @param {number} lookback - Velas atrás para buscar divergencia
 * @returns {Object} { bullish, bearish, strength }
 */
export function detectDivergence(prices, indicator, lookback = 5) {
    if (prices.length < lookback + 1 || indicator.length < lookback + 1) {
        return { bullish: false, bearish: false, strength: 0 };
    }

    const recentPrices = prices.slice(-lookback);
    const recentIndicator = indicator.slice(-lookback);

    // Validar que tenemos valores válidos
    if (recentIndicator.some(v => v === null)) {
        return { bullish: false, bearish: false, strength: 0 };
    }

    const currentPrice = recentPrices[recentPrices.length - 1];
    const prevPrice = recentPrices[0];

    const currentIndicator = recentIndicator[recentIndicator.length - 1];
    const prevIndicator = recentIndicator[0];

    const priceGain = currentPrice > prevPrice;
    const indicatorGain = currentIndicator > prevIndicator;

    // Divergencia alcista: precio baja, indicador sube (señal bullish)
    const bullish = !priceGain && indicatorGain;

    // Divergencia bajista: precio sube, indicador baja (señal bearish)
    const bearish = priceGain && !indicatorGain;

    // Calcular fuerza de divergencia (0-1)
    let strength = 0;
    if (bullish || bearish) {
        const priceChange = Math.abs(currentPrice - prevPrice) / prevPrice;
        const indicatorChange = Math.abs(currentIndicator - prevIndicator) / (Math.abs(prevIndicator) + 1);
        strength = Math.min(1, (priceChange + indicatorChange) / 2);
    }

    return { bullish, bearish, strength };
}

/**
 * Detectar acumulación (precio bajo pero volumen alto)
 * @param {Array<Object>} candles - Datos de velas
 * @param {number} lookback - Velas a analizar
 * @returns {Object} { isAccumulating, strength }
 */
export function detectAccumulation(candles, lookback = 5) {
    if (candles.length < lookback) {
        return { isAccumulating: false, strength: 0 };
    }

    const recent = candles.slice(-lookback);
    const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / lookback;
    const avgPrice = recent.reduce((sum, c) => sum + c.close, 0) / lookback;

    // Detectar si hay estabilidad de precio con volumen consistente
    const prices = recent.map(c => c.close);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const priceRange = ((maxPrice - minPrice) / avgPrice) * 100;

    // Si rango pequeño (<2%) pero volumen constante = acumulación
    const volumeConsistency = recent.filter(c => c.volume > avgVolume * 0.8).length / lookback;

    const isAccumulating = priceRange < 2 && volumeConsistency > 0.6;
    const strength = isAccumulating ? volumeConsistency : 0;

    return { isAccumulating, strength };
}

/**
 * Calcular ADX (Average Directional Index)
 * @param {Array<Object>} candles - Datos de velas
 * @param {number} period - Período (típicamente 14)
 * @returns {Object} { adx, pdi, mdi }
 */
export function calculateADX(candles, period = 14) {
    if (candles.length < period * 2) return { adx: [], pdi: [], mdi: [] };

    const tr = [];
    const dmPlus = [];
    const dmMinus = [];

    // 1. Calcular TR, +DM, -DM
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevHigh = candles[i - 1].high;
        const prevLow = candles[i - 1].low;
        const prevClose = candles[i - 1].close;

        const mTr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        tr.push(mTr);

        const upMove = high - prevHigh;
        const downMove = prevLow - low;

        if (upMove > downMove && upMove > 0) {
            dmPlus.push(upMove);
        } else {
            dmPlus.push(0);
        }

        if (downMove > upMove && downMove > 0) {
            dmMinus.push(downMove);
        } else {
            dmMinus.push(0);
        }
    }

    // 2. Suavizar (Smoothed averages)
    // Primera iteración es SMA, siguientes son (prev * (period-1) + curr) / period
    const smooth = (data, period) => {
        const smoothed = [];
        let sum = 0;
        // Primer valor
        for (let i = 0; i < period; i++) sum += data[i];
        smoothed.push(sum); // Guardamos la suma inicial para el índice 'period-1' relativo al input

        // Siguientes
        for (let i = period; i < data.length; i++) {
            const prev = smoothed[smoothed.length - 1];
            const curr = data[i];
            // Wilder's Smoothing
            smoothed.push(prev - (prev / period) + curr);
        }
        return smoothed;
    };

    // Ajustar índices
    // tr, dmPlus, dmMinus empiezan en índice 1 de candles
    const trSmooth = smooth(tr, period);
    const dmPlusSmooth = smooth(dmPlus, period);
    const dmMinusSmooth = smooth(dmMinus, period);

    const adx = [];
    const pdi = [];
    const mdi = [];

    // Calcular DI y DX
    // Los arrays smooth empiezan en el índice (period-1) de los arrays originales
    // que corresponde al índice (period) de candles
    for (let i = 0; i < trSmooth.length; i++) {
        const trVal = trSmooth[i];
        const plusVal = dmPlusSmooth[i];
        const minusVal = dmMinusSmooth[i];

        if (trVal === 0) {
            pdi.push(0);
            mdi.push(0);
            continue;
        }

        const p = (plusVal / trVal) * 100;
        const m = (minusVal / trVal) * 100;
        pdi.push(p);
        mdi.push(m);

        const sum = p + m;
        const dx = sum === 0 ? 0 : (Math.abs(p - m) / sum) * 100;

        // ADX es el suavizado del DX
        // Necesitamos acumular DX para calcular el primer ADX
        if (adx.length === 0) {
            // Esperar a tener suficientes DX?
            // Simplificación: usar DX directo o implementar otro suavizado
            // Para ser precisos, ADX requiere otro periodo de suavizado sobre DX
        }
    }

    // Simplificación para ADX: Calcular SMA del DX
    // Recalculamos DX completo para simplificar
    const dxList = [];
    for (let i = 0; i < trSmooth.length; i++) {
        const trVal = trSmooth[i];
        if (trVal === 0) { dxList.push(0); continue; }
        const p = (dmPlusSmooth[i] / trVal) * 100;
        const m = (dmMinusSmooth[i] / trVal) * 100;
        const sum = p + m;
        dxList.push(sum === 0 ? 0 : (Math.abs(p - m) / sum) * 100);
    }

    // ADX final
    const adxValues = calculateSMA(dxList, period);

    // Rellenar con nulls al principio para alinear con candles
    // tr empieza en 1. smooth empieza en period. adx empieza en period + period.
    const offset = 1 + period + period - 2; // Aproximado
    const alignedAdx = Array(candles.length).fill(null);
    const alignedPdi = Array(candles.length).fill(null);
    const alignedMdi = Array(candles.length).fill(null);

    // Mapear valores finales al final del array
    for (let i = 0; i < adxValues.length; i++) {
        const idx = candles.length - adxValues.length + i;
        alignedAdx[idx] = adxValues[i];
    }
    // Mapear DI (son más largos que ADX)
    for (let i = 0; i < pdi.length; i++) {
        const idx = candles.length - pdi.length + i;
        alignedPdi[idx] = pdi[i];
        alignedMdi[idx] = mdi[i];
    }

    return { adx: alignedAdx, pdi: alignedPdi, mdi: alignedMdi };
}

/**
 * Calcular Pivot Points (Standard)
 * @param {Array<Object>} candles - Datos de velas
 * @returns {Object} { p, r1, r2, s1, s2 }
 */
export function calculatePivotPoints(candles) {
    if (candles.length < 2) return null;

    // Usar la vela anterior completa (ayer/periodo anterior)
    const prev = candles[candles.length - 2];
    const high = prev.high;
    const low = prev.low;
    const close = prev.close;

    const p = (high + low + close) / 3;
    const r1 = 2 * p - low;
    const s1 = 2 * p - high;
    const r2 = p + (high - low);
    const s2 = p - (high - low);

    return { p, r1, r2, s1, s2 };
}

/**
 * Calcular VWAP (Volume Weighted Average Price)
 * @param {Array<Object>} candles - Datos de velas
 * @returns {Array<number>} VWAP values
 */
export function calculateVWAP(candles) {
    const vwap = [];
    let cumTPV = 0; // Cumulative Typical Price * Volume
    let cumVol = 0; // Cumulative Volume

    // En trading real, VWAP se reinicia cada día.
    // Aquí asumimos que candles es el dataset relevante (ej: últimas 24h o sesión)
    // O calculamos un "Rolling VWAP" sobre el periodo dado.

    for (let i = 0; i < candles.length; i++) {
        const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
        const volume = candles[i].volume;

        cumTPV += typicalPrice * volume;
        cumVol += volume;

        vwap.push(cumTPV / cumVol);
    }

    return vwap;
}

/**
 * Realizar análisis técnico completo
 * @param {Array<Object>} candles - Datos de velas
 * @returns {Object} Análisis técnico completo
 */
export function performTechnicalAnalysis(candles) {
    const closes = candles.map(c => c.close);

    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes);
    const bb = calculateBollingerBands(closes, 20, 2);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const sma200 = calculateSMA(closes, 200);
    const atr = calculateATR(candles, 14);
    const buyerPressure = calculateBuyerPressure(candles);
    const stochastic = calculateStochastic(candles, 14, 3, 3);
    const obv = calculateOBV(candles);
    const { support, resistance } = findSupportResistance(candles, 20);
    const adxData = calculateADX(candles, 14);
    const pivotPoints = calculatePivotPoints(candles);
    const vwap = calculateVWAP(candles);

    // Detectar divergencias
    const rsiDivergence = detectDivergence(closes, rsi, 5);
    const macdDivergence = detectDivergence(closes, macd.histogram, 5);

    // Detectar acumulación
    const accumulation = detectAccumulation(candles, 5);

    // Obtener valores actuales (último índice con datos válidos)
    const lastIndex = closes.length - 1;
    const currentCandle = candles[lastIndex];
    const prevCandle = candles[lastIndex - 1];

    // Detectar patrones
    const patterns = {
        hammer: isHammer(currentCandle),
        bullishEngulfing: isBullishEngulfing(prevCandle, currentCandle),
        doji: isDoji(currentCandle),
        threeWhiteSoldiers: isThreeWhiteSoldiers(candles),
        morningStar: isMorningStar(candles),
        eveningStar: isEveningStar(candles),
        doubleBottom: isDoubleBottom(candles, 1),
        doubleTop: isDoubleTop(candles, 1)
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
            stochastic: {
                k: stochastic.stochK[lastIndex],
                d: stochastic.stochD[lastIndex],
                histogram: stochastic.stochHistogram[lastIndex]
            },
            bollingerBands: {
                upper: bb.upper[lastIndex],
                middle: bb.middle[lastIndex],
                lower: bb.lower[lastIndex]
            },
            ema20: ema20[lastIndex],
            ema50: ema50[lastIndex],
            sma200: sma200[lastIndex],
            sma200: sma200[lastIndex],
            atr: atr[lastIndex],
            adx: adxData.adx[lastIndex],
            pdi: adxData.pdi[lastIndex],
            mdi: adxData.mdi[lastIndex],
            vwap: vwap[lastIndex]
        },
        levels: {
            support,
            resistance,
            pivot: pivotPoints
        },
        patterns,
        volume: {
            current: currentCandle.volume,
            average: calculateAverageVolume(candles, 20),
            spike: hasVolumeSpike(candles, 1.5)
        },
        buyerPressure,
        divergence: {
            rsi: rsiDivergence,
            macd: macdDivergence
        },
        accumulation,
        obv: obv[lastIndex],
        // Datos completos para gráficos
        fullData: {
            rsi,
            macd,
            stochastic,
            bollingerBands: bb,
            ema20,
            ema50,
            sma200,
            atr,
            obv,
            adx: adxData,
            vwap
        }
    };
}
