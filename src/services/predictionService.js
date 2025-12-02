import { calculateRSI, calculateMACD, calculateEMA, calculateBollingerBands } from './technicalAnalysis';

/**
 * Calculate trend prediction based on historical data and Monte Carlo simulation
 * @param {Array<Object>} candles - Array of candle data (open, high, low, close, volume)
 * @returns {Object} Prediction result { bullishProbability, bearishProbability, predictedTrend, confidence }
 */
export function calculateTrendPrediction(candles) {
    if (!candles || candles.length < 50) {
        return null;
    }

    // 1. Get Technical Indicators
    const closes = candles.map(c => c.close);
    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const bb = calculateBollingerBands(closes, 20, 2);

    const lastClose = closes[closes.length - 1];
    const lastRSI = rsi[rsi.length - 1];
    const lastMACD = macd.histogram[macd.histogram.length - 1];
    const lastEMA20 = ema20[ema20.length - 1];
    const lastEMA50 = ema50[ema50.length - 1];

    // 2. Determine Base Bias from Indicators
    let bias = 0; // -1 to 1

    // RSI Bias
    if (lastRSI < 30) bias += 0.3; // Oversold -> Bullish bias
    else if (lastRSI > 70) bias -= 0.3; // Overbought -> Bearish bias

    // MACD Bias
    if (lastMACD > 0) bias += 0.2;
    else bias -= 0.2;

    // Trend Bias (EMA)
    if (lastEMA20 > lastEMA50) bias += 0.2;
    else bias -= 0.2;

    // Price vs EMA
    if (lastClose > lastEMA20) bias += 0.1;
    else bias -= 0.1;

    // 3. Monte Carlo Simulation
    const iterations = 1000;
    const steps = 10; // Predict next 10 candles
    let bullishPaths = 0;
    let bearishPaths = 0;

    // Calculate historical volatility (log returns)
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
        returns.push(Math.log(closes[i] / closes[i - 1]));
    }

    // Calculate mean and standard deviation of returns
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.map(x => Math.pow(x - meanReturn, 2)).reduce((a, b) => a + b, 0) / returns.length);

    for (let i = 0; i < iterations; i++) {
        let currentPrice = lastClose;

        for (let j = 0; j < steps; j++) {
            // Random walk with drift (bias)
            // drift = mean - 0.5 * vol^2
            // shock = vol * random_normal
            // We add our technical bias to the drift

            const randomShock = boxMullerTransform();
            const drift = meanReturn + (bias * 0.001); // Scale bias impact
            const change = drift + stdDev * randomShock;

            currentPrice = currentPrice * Math.exp(change);
        }

        if (currentPrice > lastClose) {
            bullishPaths++;
        } else {
            bearishPaths++;
        }
    }

    const bullishProbability = Math.round((bullishPaths / iterations) * 100);
    const bearishProbability = Math.round((bearishPaths / iterations) * 100);

    let predictedTrend = 'NEUTRAL';
    if (bullishProbability > 55) predictedTrend = 'UP';
    if (bearishProbability > 55) predictedTrend = 'DOWN';

    // Confidence based on how strong the probability is
    const confidence = Math.max(bullishProbability, bearishProbability);

    return {
        bullishProbability,
        bearishProbability,
        predictedTrend,
        confidence
    };
}

// Helper for generating normal distribution random numbers
function boxMullerTransform() {
    const u1 = Math.random();
    const u2 = Math.random();

    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0;
}
