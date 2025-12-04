import binanceService from './binanceService';
import { performTechnicalAnalysis } from './technicalAnalysis';
import { generateSignal } from './signalGenerator';

/**
 * Run a backtest for a specific symbol and configuration
 * @param {string} symbol - Trading pair (e.g., 'BTCUSDC')
 * @param {string} interval - Timeframe (e.g., '1h')
 * @param {Object} config - Strategy configuration
 * @returns {Promise<Object>} Backtest results
 */
export async function runBacktest(symbol, interval = '1h', config = { initialCapital: 10000, mode: 'BALANCED' }) {
    console.log(`Starting backtest for ${symbol} on ${interval}...`);

    // 1. Fetch Historical Data (Max 1000 candles)
    // We need enough data to warm up indicators (e.g., 200 candles for SMA200)
    // So effective backtest range will be 1000 - 200 = 800 candles
    const limit = 1000;
    const candles = await binanceService.getKlines(symbol, interval, limit);

    if (!candles || candles.length < 200) {
        throw new Error('Insufficient historical data for backtesting');
    }

    // 2. Simulation State
    let balance = config.initialCapital;
    let position = null; // { type: 'BUY'|'SELL', entryPrice, quantity, stopLoss, takeProfit1, takeProfit2 }
    const trades = [];
    const equityCurve = [{ time: candles[0].closeTime, value: balance }];

    // Warmup period for indicators
    const warmupPeriod = 200;

    // 3. Simulation Loop
    // We iterate through the data, simulating "live" arrival of each candle
    for (let i = warmupPeriod; i < candles.length; i++) {
        const currentCandle = candles[i];
        const currentPrice = currentCandle.close;
        const timestamp = currentCandle.closeTime;

        // A. Check Open Position (Exit Logic)
        if (position) {
            let exitPrice = null;
            let exitReason = '';
            let pnl = 0;

            // Check Low/High of the candle to see if SL or TP was hit within the period
            // Conservative assumption: Hit SL first if both are in range (worst case)

            if (position.type === 'BUY') {
                if (currentCandle.low <= position.stopLoss) {
                    exitPrice = position.stopLoss;
                    exitReason = 'Stop Loss';
                } else if (currentCandle.high >= position.takeProfit1) {
                    // Simplified: Exit 100% at TP1 for MVP
                    exitPrice = position.takeProfit1;
                    exitReason = 'Take Profit';
                }
            } else { // SELL
                if (currentCandle.high >= position.stopLoss) {
                    exitPrice = position.stopLoss;
                    exitReason = 'Stop Loss';
                } else if (currentCandle.low <= position.takeProfit1) {
                    exitPrice = position.takeProfit1;
                    exitReason = 'Take Profit';
                }
            }

            // Force close if still open at end of backtest
            if (!exitPrice && i === candles.length - 1) {
                exitPrice = currentPrice;
                exitReason = 'End of Backtest';
            }

            if (exitPrice) {
                // Calculate PnL
                if (position.type === 'BUY') {
                    pnl = (exitPrice - position.entryPrice) * position.quantity;
                } else {
                    pnl = (position.entryPrice - exitPrice) * position.quantity;
                }

                balance += position.collateral + pnl;

                trades.push({
                    id: i,
                    symbol,
                    type: position.type,
                    entryPrice: position.entryPrice,
                    exitPrice,
                    pnl,
                    pnlPercent: (pnl / position.collateral) * 100,
                    entryTime: position.entryTime,
                    exitTime: timestamp,
                    reason: exitReason
                });

                position = null;
            }
        }

        // B. Check Entry Logic (if no position)
        if (!position) {
            // Prepare data slice for analysis (0 to i)
            // Note: In a real efficient backtester, we'd update indicators incrementally.
            // For MVP, we slice. This is slow O(N^2) but acceptable for N=1000.
            const historySlice = candles.slice(0, i + 1);

            // Perform Analysis
            const analysis = performTechnicalAnalysis(historySlice);

            // Generate Signal
            // We mock multiTimeframeData with just current timeframe for MVP
            const mockMultiTF = {
                [interval]: { indicators: analysis.indicators, regime: analysis.regime }
            };

            const signal = generateSignal(analysis, symbol, mockMultiTF, config.mode);

            if (signal && signal.score >= 60) { // Threshold
                // Enter Position
                const riskAmount = balance * 0.1; // Fixed 10% risk per trade for MVP
                const quantity = riskAmount / currentPrice;

                position = {
                    type: signal.type,
                    entryPrice: currentPrice,
                    quantity,
                    collateral: riskAmount,
                    stopLoss: signal.levels.stopLoss,
                    takeProfit1: signal.levels.takeProfit1,
                    takeProfit2: signal.levels.takeProfit2,
                    entryTime: timestamp
                };

                balance -= riskAmount;
            }
        }

        // Record Equity
        // If position open, add unrealized PnL
        let currentEquity = balance;
        if (position) {
            let unrealizedPnL = 0;
            if (position.type === 'BUY') {
                unrealizedPnL = (currentPrice - position.entryPrice) * position.quantity;
            } else {
                unrealizedPnL = (position.entryPrice - currentPrice) * position.quantity;
            }
            currentEquity += position.collateral + unrealizedPnL;
        }
        equityCurve.push({ time: timestamp, value: currentEquity });
    }

    // 4. Calculate Statistics
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl <= 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const totalPnL = equityCurve[equityCurve.length - 1].value - config.initialCapital;
    const totalPnLPercent = (totalPnL / config.initialCapital) * 100;

    // Calculate Max Drawdown
    let maxDrawdown = 0;
    let peak = -Infinity;
    for (const point of equityCurve) {
        if (point.value > peak) peak = point.value;
        const drawdown = (peak - point.value) / peak * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return {
        symbol,
        interval,
        stats: {
            totalTrades: trades.length,
            winRate: parseFloat(winRate.toFixed(2)),
            netProfit: parseFloat(totalPnL.toFixed(2)),
            netProfitPercent: parseFloat(totalPnLPercent.toFixed(2)),
            maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
            profitFactor: losingTrades.length > 0
                ? parseFloat((winningTrades.reduce((sum, t) => sum + t.pnl, 0) / Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0))).toFixed(2))
                : '∞'
        },
        trades: trades.reverse(), // Newest first
        equityCurve
    };
}
