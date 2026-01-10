/**
 * Risk Calculator Service
 * Professional position sizing for precision trading
 * 
 * Formula: S = (C × r) / |Entry - SL|
 * Where:
 *   S = Position size (in asset units)
 *   C = Total capital
 *   r = Risk per trade (as decimal, e.g., 0.015 for 1.5%)
 *   Entry = Entry price
 *   SL = Stop Loss price
 */

/**
 * Calculate position size based on risk parameters
 * @param {Object} params - Position parameters
 * @param {number} params.capital - Total capital in EUR
 * @param {number} params.riskPercent - Risk per trade as decimal (e.g., 0.015 = 1.5%)
 * @param {number} params.entryPrice - Entry price in USD
 * @param {number} params.stopLossPrice - Stop loss price in USD
 * @param {number} params.maxLeverage - Maximum leverage (1 = spot, no leverage)
 * @param {number} params.eurToUsd - EUR/USD exchange rate (default ~1.08)
 * @returns {Object} Position sizing details
 */
export const calculatePosition = ({
    capital = 3400,
    riskPercent = 0.015,
    entryPrice,
    stopLossPrice,
    maxLeverage = 1,
    eurToUsd = 1.08
}) => {
    // Validate inputs
    if (!entryPrice || !stopLossPrice) {
        return {
            error: 'Entry and Stop Loss prices are required',
            positionSize: 0,
            positionValue: 0,
            riskAmount: 0
        };
    }

    // Convert capital to USD for calculation
    const capitalUSD = capital * eurToUsd;

    // Calculate risk amount
    const riskAmount = capital * riskPercent;
    const riskAmountUSD = capitalUSD * riskPercent;

    // Calculate stop loss distance (absolute and percentage)
    const slDistance = Math.abs(entryPrice - stopLossPrice);
    const slPercent = slDistance / entryPrice;

    // Determine trade direction
    const isBuy = entryPrice > stopLossPrice;

    // Calculate raw position value (before capital cap)
    // Position Value = Risk Amount / SL Percentage
    let positionValueUSD = riskAmountUSD / slPercent;

    // Cap position value at available capital * max leverage
    const maxPositionValue = capitalUSD * maxLeverage;
    const isCapped = positionValueUSD > maxPositionValue;

    if (isCapped) {
        positionValueUSD = maxPositionValue;
    }

    // Calculate position size in asset units
    const positionSize = positionValueUSD / entryPrice;

    // Calculate actual risk if position was capped
    const actualRiskPercent = isCapped
        ? (slPercent * positionValueUSD / capitalUSD)
        : riskPercent;

    // Calculate leverage used
    const leverageUsed = positionValueUSD / capitalUSD;

    return {
        // Core values
        positionSize: parseFloat(positionSize.toFixed(8)),
        positionValueUSD: parseFloat(positionValueUSD.toFixed(2)),
        positionValueEUR: parseFloat((positionValueUSD / eurToUsd).toFixed(2)),

        // Risk metrics
        riskAmountEUR: parseFloat(riskAmount.toFixed(2)),
        riskAmountUSD: parseFloat(riskAmountUSD.toFixed(2)),
        riskPercent: parseFloat((riskPercent * 100).toFixed(2)),
        actualRiskPercent: parseFloat((actualRiskPercent * 100).toFixed(2)),

        // Stop loss info
        slDistance: parseFloat(slDistance.toFixed(8)),
        slPercent: parseFloat((slPercent * 100).toFixed(2)),

        // Position info
        direction: isBuy ? 'LONG' : 'SHORT',
        isCapped,
        leverageUsed: parseFloat(leverageUsed.toFixed(2)),

        // Formatted strings for UI
        formatted: {
            position: `${positionSize.toFixed(6)} units`,
            value: `€${(positionValueUSD / eurToUsd).toFixed(0)}`,
            risk: `€${riskAmount.toFixed(0)} (${(riskPercent * 100).toFixed(1)}%)`,
            sl: `${(slPercent * 100).toFixed(2)}% from entry`
        }
    };
};

/**
 * Calculate Risk/Reward ratio
 * @param {number} entry - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {number} takeProfit - Take profit price
 * @returns {number} Risk:Reward ratio (e.g., 2.0 means 1:2)
 */
export const calculateRiskReward = (entry, stopLoss, takeProfit) => {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);

    if (risk === 0) return 0;

    return parseFloat((reward / risk).toFixed(2));
};

/**
 * Kelly Criterion for optimal bet sizing
 * Used when you have edge statistics from backtesting
 * 
 * @param {Object} params - Kelly parameters
 * @param {number} params.winRate - Win rate as decimal (e.g., 0.55 = 55%)
 * @param {number} params.avgWin - Average win as multiple of risk (e.g., 2.0 = 2R)
 * @param {number} params.avgLoss - Average loss as multiple of risk (default 1.0)
 * @param {number} params.capital - Total capital
 * @returns {Object} Kelly position sizing recommendations
 */
export const calculateKelly = ({
    winRate = 0.55,
    avgWin = 2.0,
    avgLoss = 1.0,
    capital = 3400
}) => {
    // Kelly Formula: f* = (bp - q) / b
    // Where: b = avgWin/avgLoss, p = winRate, q = 1 - winRate
    const b = avgWin / avgLoss;
    const p = winRate;
    const q = 1 - winRate;

    const kelly = (b * p - q) / b;

    // Half Kelly is safer for real trading
    const halfKelly = kelly / 2;

    // Quarter Kelly is even more conservative
    const quarterKelly = kelly / 4;

    // Cap at reasonable maximum (3%)
    const suggestedRisk = Math.min(Math.max(halfKelly, 0), 0.03);

    return {
        kellyPercent: parseFloat((kelly * 100).toFixed(2)),
        halfKellyPercent: parseFloat((halfKelly * 100).toFixed(2)),
        quarterKellyPercent: parseFloat((quarterKelly * 100).toFixed(2)),
        suggestedRiskPercent: parseFloat((suggestedRisk * 100).toFixed(2)),
        suggestedRiskAmount: parseFloat((capital * suggestedRisk).toFixed(2)),
        hasEdge: kelly > 0,
        edgeDescription: kelly > 0.05
            ? 'Strong edge - Half Kelly recommended'
            : kelly > 0
                ? 'Positive edge - Quarter Kelly safer'
                : 'No edge detected - Consider re-evaluating strategy'
    };
};

/**
 * Calculate maximum drawdown risk
 * @param {number} capital - Current capital
 * @param {number} riskPerTrade - Risk per trade as decimal
 * @param {number} consecutiveLosses - Expected max consecutive losses
 * @returns {Object} Drawdown projections
 */
export const calculateDrawdownRisk = (capital, riskPerTrade, consecutiveLosses = 5) => {
    let remainingCapital = capital;
    const drawdownPath = [];

    for (let i = 0; i < consecutiveLosses; i++) {
        const loss = remainingCapital * riskPerTrade;
        remainingCapital -= loss;
        drawdownPath.push({
            trade: i + 1,
            loss: parseFloat(loss.toFixed(2)),
            remaining: parseFloat(remainingCapital.toFixed(2)),
            drawdownPercent: parseFloat(((capital - remainingCapital) / capital * 100).toFixed(2))
        });
    }

    const totalDrawdown = capital - remainingCapital;

    return {
        maxDrawdownEUR: parseFloat(totalDrawdown.toFixed(2)),
        maxDrawdownPercent: parseFloat((totalDrawdown / capital * 100).toFixed(2)),
        remainingCapital: parseFloat(remainingCapital.toFixed(2)),
        drawdownPath,
        recoveryRequired: parseFloat(((capital / remainingCapital - 1) * 100).toFixed(2))
    };
};

// Default export for convenience
export default {
    calculatePosition,
    calculateRiskReward,
    calculateKelly,
    calculateDrawdownRisk
};
