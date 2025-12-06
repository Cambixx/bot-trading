import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../context/AuthContext';

const INITIAL_BALANCE = 10000; // $10,000 USDT

export function usePaperTrading() {
    const { user } = useAuth();
    const [portfolio, setPortfolio] = useState({
        balance: INITIAL_BALANCE,
        positions: [],
        history: []
    });
    const [loading, setLoading] = useState(false);

    // Load portfolio from Supabase
    const loadPortfolio = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('transactions')
                .select('*')
                .eq('user_id', user.id)
                .order('timestamp', { ascending: false });

            if (error) throw error;

            if (data) {
                // Helper to map DB transaction to Frontend Position format
                const mapTransaction = (t) => ({
                    ...t,
                    entryPrice: Number(t.price), // Map DB 'price' to 'entryPrice'
                    amount: Number(t.price) * Number(t.quantity), // Derive amount
                    price: Number(t.price),
                    quantity: Number(t.quantity), // Ensure number
                    pnl: Number(t.pnl),
                    pnlPercent: (Number(t.price) * Number(t.quantity)) ? (Number(t.pnl) / (Number(t.price) * Number(t.quantity))) * 100 : 0
                });

                const positions = data.filter(t => t.status === 'OPEN').map(mapTransaction);
                const history = data.filter(t => t.status === 'CLOSED').map(mapTransaction);

                // Calculate Balance
                // Initial + Sum(Realized PnL of CLOSED) - Sum(Amount of OPEN)
                const totalRealizedPnL = history.reduce((sum, t) => sum + (t.pnl || 0), 0);
                // For open positions, amount is the collateral locked
                const totalOpenCollateral = positions.reduce((sum, t) => sum + (t.amount || 0), 0);

                const derivedBalance = INITIAL_BALANCE + totalRealizedPnL - totalOpenCollateral; // Wait, original logic: balance decreases by amount when open. And increases by exitValue (amount+pnl) when close.
                // So: Initial + Sum(ExitValue) - Sum(EntryAmount) ?
                // For Closed: ExitValue - EntryAmount = PnL. So Initial + PnL.
                // For Open: -EntryAmount.
                // So yes: Initial + Sum(PnL of Closed) - Sum(Amount of Open). Correct.

                setPortfolio({
                    balance: derivedBalance,
                    positions,
                    history
                });
            }
        } catch (err) {
            console.error('Error loading portfolio:', err);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        loadPortfolio();
    }, [loadPortfolio]);

    // Open a new position
    const openPosition = async (signal, amount = 1000) => {
        if (portfolio.balance < amount) {
            return { success: false, error: 'Saldo insuficiente' };
        }

        if (!user) return { success: false, error: 'Debes iniciar sesión' };

        const quantity = amount / signal.price;
        const newPosition = {
            user_id: user.id,
            symbol: signal.symbol,
            price: signal.price,
            quantity: quantity,
            type: signal.type || 'BUY',
            status: 'OPEN',
            timestamp: new Date().toISOString()
        };

        try {
            // Need to insert into 'transactions' which has columns: user_id, symbol, type, price, quantity, status
            const { error } = await supabase.from('transactions').insert([newPosition]);
            if (error) throw error;

            await loadPortfolio(); // Reload to ensure sync
            return { success: true };
        } catch (err) {
            console.error('Error opening position:', err);
            return { success: false, error: err.message };
        }
    };

    // Close a position
    const closePosition = async (positionId, currentPrice) => {
        const position = portfolio.positions.find(p => p.id === positionId);
        if (!position) return { success: false, error: 'Posición no encontrada' };

        const amount = position.quantity * position.price; // Original amount
        let pnl = 0;
        let exitValue = 0;

        if (position.type === 'SELL') {
            pnl = (position.price - currentPrice) * position.quantity;
            exitValue = amount + pnl;
        } else {
            exitValue = position.quantity * currentPrice;
            pnl = exitValue - amount;
        }

        try {
            // Update transaction
            const { error } = await supabase.from('transactions').update({
                status: 'CLOSED',
                pnl: pnl,
                // I don't have exit_price column in plan? 
                // Plan: "pnl numeric default 0, status text default 'OPEN'". 
                // I missed exit_price. But pnl is enough for history.
            }).eq('id', positionId);

            if (error) throw error;
            await loadPortfolio();
            return { success: true };
        } catch (err) {
            console.error('Error closing position:', err);
            return { success: false, error: err.message };
        }
    };

    // Reset portfolio
    const resetPortfolio = async () => {
        if (!user) return;
        if (confirm('¿Estás seguro de reiniciar tu cartera? Se borrará todo el historial.')) {
            try {
                const { error } = await supabase.from('transactions').delete().eq('user_id', user.id);
                if (error) throw error;
                loadPortfolio();
            } catch (err) {
                console.error('Error resetting portfolio:', err);
            }
        }
    };

    // Calculate total portfolio value (Balance + Unrealized PnL)
    const getPortfolioValue = (currentPrices) => {
        let unrealizedPnL = 0;

        // Need to adapt property names if DB returns snake_case?
        // Supabase returns columns as is. My SQL was lowercase.
        // Positions are from DB. 
        // DB columns: symbol, type, price, quantity...
        // My code uses position.entryPrice usually. 
        // NOTE: DB has 'price' for entry price.

        portfolio.positions.forEach(pos => {
            const currentPrice = currentPrices[pos.symbol]?.price || pos.price;
            // Original Amount = pos.price * pos.quantity (approx)
            const amount = pos.price * pos.quantity;

            if (pos.type === 'SELL') {
                unrealizedPnL += (pos.price - currentPrice) * pos.quantity;
            } else {
                unrealizedPnL += (pos.quantity * currentPrice) - amount;
            }
        });

        // Value = Balance (Cash) + Collateral (Locked) + Unrealized PnL
        // Current Balance (Cash) = Initial + Realized - Locked Collateral
        // So Value = (Initial + Realized - Locked) + Locked + Unrealized
        // Value = Initial + Realized + Unrealized.

        // Wait, Derived Balance IS Cash.
        // So I need to add back the Collateral to get Total Equity?
        // Usually Portfolio Value = Cash + Market Value of Positions.
        // For Long: Market Value = Qty * CurrPrice.
        // For Short: It's trickier. Margined account. 
        // Let's stick to Equity = Balance (Cash available) + Margin (Locked) + Unrealized PnL.
        // My derived balance subtracted Margin. 
        // So Equity = DerivedBalance + Margin + Unrealized.

        const totalOpenCollateral = portfolio.positions.reduce((sum, p) => sum + (p.price * p.quantity), 0);
        return portfolio.balance + totalOpenCollateral + unrealizedPnL;
    };

    return {
        portfolio,
        openPosition,
        closePosition,
        resetPortfolio,
        getPortfolioValue,
        loading
    };
}
