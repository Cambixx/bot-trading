import { useState, useEffect } from 'react';

const STORAGE_KEY = 'paper_trading_portfolio';
const INITIAL_BALANCE = 10000; // $10,000 USDT

export function usePaperTrading() {
    const [portfolio, setPortfolio] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : {
            balance: INITIAL_BALANCE,
            positions: [],
            history: []
        };
    });

    // Persist to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
    }, [portfolio]);

    // Open a new position
    const openPosition = (signal, amount = 1000) => {
        if (portfolio.balance < amount) {
            return { success: false, error: 'Saldo insuficiente' };
        }

        const quantity = amount / signal.price;
        const newPosition = {
            id: Date.now().toString(),
            symbol: signal.symbol,
            entryPrice: signal.price,
            quantity: quantity,
            amount: amount, // Collateral used
            timestamp: new Date().toISOString(),
            type: signal.type || 'BUY', // Support SELL
            status: 'OPEN'
        };

        setPortfolio(prev => ({
            ...prev,
            balance: prev.balance - amount,
            positions: [newPosition, ...prev.positions]
        }));

        return { success: true };
    };

    // Close a position
    const closePosition = (positionId, currentPrice) => {
        const position = portfolio.positions.find(p => p.id === positionId);
        if (!position) return { success: false, error: 'Posición no encontrada' };

        let pnl = 0;
        let exitValue = 0;

        if (position.type === 'SELL') {
            // Short: Profit if price goes down
            // PnL = (Entry Price - Exit Price) * Quantity
            pnl = (position.entryPrice - currentPrice) * position.quantity;
            // Return collateral + PnL
            exitValue = position.amount + pnl;
        } else {
            // Long: Profit if price goes up
            exitValue = position.quantity * currentPrice;
            pnl = exitValue - position.amount;
        }

        const pnlPercent = (pnl / position.amount) * 100;

        const closedPosition = {
            ...position,
            exitPrice: currentPrice,
            exitValue: exitValue,
            pnl: pnl,
            pnlPercent: pnlPercent,
            closeTimestamp: new Date().toISOString(),
            status: 'CLOSED'
        };

        setPortfolio(prev => ({
            ...prev,
            balance: prev.balance + exitValue,
            positions: prev.positions.filter(p => p.id !== positionId),
            history: [closedPosition, ...prev.history]
        }));

        return { success: true };
    };

    // Reset portfolio
    const resetPortfolio = () => {
        setPortfolio({
            balance: INITIAL_BALANCE,
            positions: [],
            history: []
        });
    };

    // Calculate total portfolio value (Balance + Unrealized PnL)
    const getPortfolioValue = (currentPrices) => {
        let unrealizedPnL = 0;

        portfolio.positions.forEach(pos => {
            const currentPrice = currentPrices[pos.symbol]?.price || pos.entryPrice;

            if (pos.type === 'SELL') {
                unrealizedPnL += (pos.entryPrice - currentPrice) * pos.quantity;
            } else {
                unrealizedPnL += (pos.quantity * currentPrice) - pos.amount;
            }
        });

        // Total Value = Cash Balance + Collateral + Unrealized PnL
        // Note: We subtracted collateral (amount) from balance when opening.
        // So we need to add it back effectively in the "Value" calculation.
        // Value = Balance + Sum(Position Value)
        // For Long: Position Value = Quantity * Current Price
        // For Short: Position Value = Collateral + PnL

        let totalPositionValue = 0;
        portfolio.positions.forEach(pos => {
            const currentPrice = currentPrices[pos.symbol]?.price || pos.entryPrice;
            if (pos.type === 'SELL') {
                const pnl = (pos.entryPrice - currentPrice) * pos.quantity;
                totalPositionValue += pos.amount + pnl;
            } else {
                totalPositionValue += pos.quantity * currentPrice;
            }
        });

        return portfolio.balance + totalPositionValue;
    };

    return {
        portfolio,
        openPosition,
        closePosition,
        resetPortfolio,
        getPortfolioValue
    };
}
