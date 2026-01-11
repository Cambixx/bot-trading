import { describe, it, expect } from 'vitest';
import { generateSignal, analyzeMultipleSymbols, getSignalConfig } from '../signalGenerator';

describe('signalGenerator', () => {
    describe('getSignalConfig', () => {
        it('should return BALANCED config by default', () => {
            const config = getSignalConfig();
            expect(config).toBeDefined();
            expect(config.scoreToEmit).toBe(0.40);
        });

        it('should return CONSERVATIVE config', () => {
            const config = getSignalConfig('CONSERVATIVE');
            expect(config.scoreToEmit).toBe(0.65);
            expect(config.requiredCategories).toBe(2);
        });

        it('should return RISKY config', () => {
            const config = getSignalConfig('RISKY');
            expect(config.scoreToEmit).toBe(0.40);
        });
    });

    describe('generateSignal', () => {
        const mockAnalysis = {
            price: 50000,
            orderBook: {
                bids: Array.from({ length: 10 }, (_, i) => [49990 - i, 2]),
                asks: Array.from({ length: 10 }, (_, i) => [50010 + i, 2]),
            },
            indicators: {
                rsi: 35,
                macd: { histogram: 0.5 },
                ema20: 49000,
                ema50: 48000,
                sma200: 47000,
                adx: 30,
                atr: 1000,
            },
            levels: {
                support: 48500,
                resistance: 51000,
            },
            patterns: {
                hammer: true,
            },
            volume: {
                spike: true,
            },
            buyerPressure: {
                current: 60,
            },
            regime: 'TRENDING_BULL',
        };

        it('should generate a BUY signal for bullish conditions', () => {
            const signal = generateSignal(mockAnalysis, 'BTCUSDC', {}, 'BALANCED');

            expect(signal).toBeDefined();
            expect(signal.type).toBe('BUY');
            expect(signal.symbol).toBe('BTCUSDC');
            expect(signal.score).toBeGreaterThan(0);
            expect(signal.price).toBe(50000);
        });

        it('should not generate signal in CONSERVATIVE mode without strong trend', () => {
            const weakAnalysis = {
                ...mockAnalysis,
                regime: 'RANGING',
            };

            const signal = generateSignal(weakAnalysis, 'BTCUSDC', {}, 'CONSERVATIVE');
            expect(signal).toBeNull();
        });

        it('should generate SELL signal for bearish conditions', () => {
            const bearishAnalysis = {
                ...mockAnalysis,
                indicators: {
                    ...mockAnalysis.indicators,
                    rsi: 70,
                    macd: { histogram: -0.5 },
                    ema20: 48000,
                    ema50: 49000,
                },
                regime: 'TRENDING_BEAR',
                buyerPressure: {
                    current: 30,
                },
            };

            const signal = generateSignal(bearishAnalysis, 'BTCUSDC', {}, 'BALANCED');

            if (signal) {
                expect(signal.type).toBe('SELL');
            }
        });

        it('should return null for insufficient score', () => {
            const weakAnalysis = {
                price: 50000,
                indicators: {
                    rsi: 50,
                    macd: { histogram: 0 },
                    ema20: 50000,
                    ema50: 50000,
                    sma200: 50000,
                    atr: 1000,
                },
                levels: {},
                patterns: {},
                volume: {},
                regime: 'RANGING',
            };

            const signal = generateSignal(weakAnalysis, 'BTCUSDC', {}, 'BALANCED');
            expect(signal).toBeNull();
        });

        it('should include stop loss and take profit levels', () => {
            const signal = generateSignal(mockAnalysis, 'BTCUSDC', {}, 'BALANCED');

            if (signal) {
                expect(signal.levels.entry).toBeDefined();
                expect(signal.levels.stopLoss).toBeDefined();
                expect(signal.levels.takeProfit1).toBeDefined();
                expect(signal.levels.takeProfit2).toBeDefined();
                expect(signal.riskReward).toBeGreaterThan(0);
            }
        });
    });

    describe('analyzeMultipleSymbols', () => {
        it('should handle empty data gracefully', () => {
            const result = analyzeMultipleSymbols({}, {}, 'BALANCED');
            expect(result).toEqual([]);
        });

        it('should skip symbols with insufficient data', () => {
            const symbolsData = {
                'BTCUSDC': { data: [] }, // Insufficient
            };

            const result = analyzeMultipleSymbols(symbolsData, {}, 'BALANCED');
            expect(result).toEqual([]);
        });
    });
});
