import { useState, useEffect, useRef } from 'react';

/**
 * Hook to monitor BTC volatility in real-time via WebSocket
 * Calculates Standard Deviation of returns over a rolling window.
 */
export const useBTCVolatility = () => {
    const [volatilityData, setVolatilityData] = useState({
        price: 0,
        volatility: 0, // Standard Deviation
        trend: 'NEUTRAL',
        isFlashCrash: false,
        percentChange: 0
    });

    const pricesRef = useRef([]);
    const pendingUpdate = useRef(null);

    useEffect(() => {
        const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@miniTicker');

        ws.onopen = () => {
            // console.log('⚡ BTC Volatility Monitor Connected');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const price = parseFloat(data.c); // Close price

            // Pending update throttling (1 sec updates is fine, but just in case)
            // Actually miniTicker is 1s, so we can process every message.

            // Maintain rolling window of 60 seconds (approx 60 ticks)
            pricesRef.current.push(price);
            if (pricesRef.current.length > 60) {
                pricesRef.current.shift();
            }

            if (pricesRef.current.length > 10) {
                const volatility = calculateStandardDeviation(pricesRef.current);
                const firstPrice = pricesRef.current[0];
                const percentChange = ((price - firstPrice) / firstPrice) * 100;

                // Detect Flash Crash (Drop > 0.5% in < 1 min with High Volatility)
                const isFlashCrash = percentChange < -0.5 && volatility > 50;
                // Note: Volatility value depends on absolute price, 50 is heuristic for BTC ($100k implies 0.05%)
                // Better to use normalized volatility (Sigma / Price) * 100
                const normalizedVolId = (volatility / price) * 10000; // Basis points volatility

                setVolatilityData({
                    price,
                    volatility: normalizedVolId, // Normalized score
                    trend: percentChange > 0.2 ? 'BULLISH' : percentChange < -0.2 ? 'BEARISH' : 'NEUTRAL',
                    isFlashCrash,
                    percentChange
                });
            }
        };

        ws.onerror = (err) => {
            console.error('BTC Monitor Error:', err);
        };

        return () => {
            ws.close();
        };
    }, []);

    return volatilityData;
};

// Helper: Calculate Standard Deviation (Population)
const calculateStandardDeviation = (arr) => {
    const n = arr.length;
    if (n === 0) return 0;
    const mean = arr.reduce((a, b) => a + b) / n;
    const variance = arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n;
    return Math.sqrt(variance);
};
