import { useState, useEffect } from 'react';
import binanceService from '../services/binanceService';

const STORAGE_KEY = 'signal_history';
const VERIFICATION_WINDOW = 24 * 60 * 60 * 1000; // 24 hours
const CHECK_INTERVAL = 60 * 60 * 1000; // Check every 1 hour

export function useSignalHistory() {
    const [history, setHistory] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
    });

    // Persist to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }, [history]);

    // Add a new signal to track
    const trackSignal = (signal) => {
        const tracked = {
            id: `${signal.symbol}-${Date.now()}`,
            symbol: signal.symbol,
            timestamp: Date.now(),
            entryPrice: signal.price,
            tp1: signal.levels.takeProfit1,
            stopLoss: signal.levels.stopLoss,
            status: 'PENDING', // PENDING, WIN, LOSS, EXPIRED
            verifiedAt: null
        };

        setHistory(prev => [tracked, ...prev]);
    };

    // Verify signals periodically
    const verifySignals = async () => {
        const now = Date.now();
        const pendingSignals = history.filter(s => s.status === 'PENDING');

        for (const signal of pendingSignals) {
            const age = now - signal.timestamp;

            // If expired (>24h), mark as EXPIRED
            if (age > VERIFICATION_WINDOW) {
                updateSignalStatus(signal.id, 'EXPIRED');
                continue;
            }

            try {
                // Fetch recent price data
                const klines = await binanceService.getKlines(signal.symbol, '1h', 24);

                // Check if TP1 or SL was hit
                const hitTP1 = klines.some(k => k.high >= signal.tp1);
                const hitSL = klines.some(k => k.low <= signal.stopLoss);

                if (hitTP1 && !hitSL) {
                    updateSignalStatus(signal.id, 'WIN');
                } else if (hitSL) {
                    updateSignalStatus(signal.id, 'LOSS');
                }
            } catch (error) {
                console.error(`Error verifying signal ${signal.id}:`, error);
            }

            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    };

    // Update signal status
    const updateSignalStatus = (id, status) => {
        setHistory(prev => prev.map(s =>
            s.id === id
                ? { ...s, status, verifiedAt: Date.now() }
                : s
        ));
    };

    // Calculate statistics
    const getStats = () => {
        const verified = history.filter(s => s.status === 'WIN' || s.status === 'LOSS');
        const wins = verified.filter(s => s.status === 'WIN').length;
        const losses = verified.filter(s => s.status === 'LOSS').length;
        const total = verified.length;
        const winRate = total > 0 ? (wins / total) * 100 : 0;

        // Last 24h stats
        const oneDayAgo = Date.now() - VERIFICATION_WINDOW;
        const recent = verified.filter(s => s.timestamp >= oneDayAgo);
        const recentWins = recent.filter(s => s.status === 'WIN').length;
        const recentTotal = recent.length;
        const recentWinRate = recentTotal > 0 ? (recentWins / recentTotal) * 100 : 0;

        return {
            total,
            wins,
            losses,
            winRate,
            pending: history.filter(s => s.status === 'PENDING').length,
            recentTotal,
            recentWinRate
        };
    };

    // Verify signals on mount and periodically
    useEffect(() => {
        verifySignals();
        const interval = setInterval(verifySignals, CHECK_INTERVAL);
        return () => clearInterval(interval);
    }, [history]);

    return {
        history,
        trackSignal,
        verifySignals,
        getStats
    };
}
