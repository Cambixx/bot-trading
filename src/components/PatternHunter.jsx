import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanEye, Radar, Target, Info, RefreshCw } from 'lucide-react';
import { getPatternAnalysis } from '../services/aiAnalysis';
import binanceService from '../services/binanceService';
import './PatternHunter.css';

const PatternHunter = ({ defaultSymbol, availableSymbols }) => {
    const [selectedSymbol, setSelectedSymbol] = useState(defaultSymbol || (availableSymbols && availableSymbols[0]) || 'BTCUSDC');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [lastScan, setLastScan] = useState(null);
    const [error, setError] = useState(null);

    // Load persisted scan results on mount
    useEffect(() => {
        const savedResult = localStorage.getItem(`hunter_result_${selectedSymbol}`);
        const savedTime = localStorage.getItem(`hunter_time_${selectedSymbol}`);

        if (savedResult) {
            try {
                setResult(JSON.parse(savedResult));
                if (savedTime) setLastScan(new Date(savedTime));
            } catch (e) {
                console.error("Error parsing saved hunter result", e);
            }
        }
    }, [selectedSymbol]);

    const [cooldown, setCooldown] = useState(false);

    const handleScan = async () => {
        if (!selectedSymbol || cooldown) return;

        setLoading(true);
        setResult(null);
        setError(null);
        setCooldown(true);

        try {
            console.log('🔍 Pattern Hunter: Iniciando escaneo para', selectedSymbol);

            // Fetch OHLCV candles (not just close prices)
            const klines = await binanceService.getKlines(selectedSymbol, '1h', 120);

            if (!klines || klines.length === 0) {
                throw new Error('No se pudieron obtener datos de velas');
            }

            // Build structured OHLCV data for better pattern detection
            const ohlcvData = klines.map(k => ({
                open: parseFloat(k.open),
                high: parseFloat(k.high),
                low: parseFloat(k.low),
                close: parseFloat(k.close),
                volume: parseFloat(k.volume)
            }));

            // Validate OHLCV data
            const isValid = ohlcvData.every(candle =>
                !isNaN(candle.open) && !isNaN(candle.high) &&
                !isNaN(candle.low) && !isNaN(candle.close) &&
                !isNaN(candle.volume)
            );

            if (!isValid) {
                throw new Error('Datos OHLCV inválidos detectados');
            }

            // Calculate volume context
            const volumes = klines.map(k => parseFloat(k.volume));
            const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const volumeTrend = recentVolume > avgVolume ? 'INCREASING' : 'DECREASING';

            // Current price context
            const currentPrice = parseFloat(klines[klines.length - 1].close);
            const priceRange = {
                high24h: Math.max(...klines.slice(-24).map(k => parseFloat(k.high))),
                low24h: Math.min(...klines.slice(-24).map(k => parseFloat(k.low))),
                current: currentPrice
            };

            // 2. Algorithmic Pattern Detection (New)
            let algoPatterns = [];
            try {
                const { findChartPatterns } = await import('../services/technicalAnalysis');
                const algoResult = findChartPatterns(ohlcvData);
                if (algoResult.detected) {
                    algoPatterns = algoResult.patterns;
                    console.log(`🎯 Algoritmo detectó ${algoPatterns.length} patrones:`, algoPatterns.map(p => p.name));
                }
            } catch (err) {
                console.error("Algo Pattern Error:", err);
            }

            // Call AI with enhanced data + algorithmic results
            const response = await getPatternAnalysis(selectedSymbol, ohlcvData, {
                volumeTrend,
                avgVolume,
                priceRange,
                algoPatterns // Pass detected patterns to AI
            });

            if (response.success && response.analysis) {
                setResult(response.analysis);
                const now = new Date();
                setLastScan(now);
                localStorage.setItem(`hunter_result_${selectedSymbol}`, JSON.stringify(response.analysis));
                localStorage.setItem(`hunter_time_${selectedSymbol}`, now.toISOString());
            } else {
                setError(response.error || "Radar jammed by rate limits. Try again soon.");
            }

        } catch (error) {
            console.error('❌ Error en Pattern Hunter:', error);
            setError(error.message.includes("Rate Limit") ? "Too many requests. Radar cooling down..." : (error.message || 'Error al escanear patrones'));
        } finally {
            setLoading(false);
            // 5s cooling period
            setTimeout(() => setCooldown(false), 5000);
        }
    };

    return (
        <motion.div
            className="pattern-hunter-container glass-card"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
        >
            <div className="hunter-header">
                <div className="hunter-title">
                    <ScanEye size={20} className="hunter-icon" />
                    <h3>PATTERN HUNTER</h3>
                </div>

                <div className="hunter-controls">
                    <select
                        className="hunter-select"
                        value={selectedSymbol}
                        onChange={(e) => {
                            setSelectedSymbol(e.target.value);
                            setResult(null);
                        }}
                    >
                        {availableSymbols && availableSymbols.map(sym => (
                            <option key={sym} value={sym}>{sym}</option>
                        ))}
                    </select>

                    <button
                        className={`scan-btn ${loading ? 'scanning' : ''}`}
                        onClick={handleScan}
                        disabled={loading}
                    >
                        {loading ? <RefreshCw className="spin" size={16} /> : <Radar size={16} />}
                        {loading ? 'SCANNING...' : 'SCAN'}
                    </button>
                </div>
            </div>

            <div className="hunter-body">
                {error && (
                    <div className="hunter-error">
                        <div className="error-icon">⚠️</div>
                        <p className="error-message">{error}</p>
                        <button className="retry-btn" onClick={handleScan}>
                            Reintentar
                        </button>
                    </div>
                )}

                {!result && !loading && !error && (
                    <div className="hunter-empty">
                        <Target size={40} className="target-icon" />
                        <p>Radar Ready. Initiate scan to detect chart patterns.</p>
                    </div>
                )}

                {loading && (
                    <div className="radar-animation">
                        <div className="radar-sweep"></div>
                        <div className="radar-grid"></div>
                    </div>
                )}

                {result && (
                    <motion.div
                        className="scan-results"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        <div className="scan-summary">
                            <Info size={14} className="info-icon" />
                            <p>{result.summary}</p>
                        </div>

                        {result.detected && result.patterns && result.patterns.length > 0 ? (
                            <div className="patterns-list">
                                {result.patterns.map((pat, idx) => (
                                    <motion.div
                                        key={idx}
                                        className={`pattern-card ${pat.signal === 'BULLISH' ? 'pat-bull' : 'pat-bear'}`}
                                        initial={{ x: -20, opacity: 0 }}
                                        animate={{ x: 0, opacity: 1 }}
                                        transition={{ delay: idx * 0.1 }}
                                    >
                                        <div className="pat-header">
                                            <span className="pat-name">{pat.name}</span>
                                            <span className={`pat-conf ${pat.confidence.toLowerCase()}`}>{pat.confidence} Conf.</span>
                                        </div>
                                        <p className="pat-desc">{pat.description}</p>

                                        {(pat.breakoutLevel || pat.target) && (
                                            <div className="pat-levels-mini">
                                                {pat.breakoutLevel && <div><span>Breakout:</span> {pat.breakoutLevel}</div>}
                                                {pat.target && <div><span>Target:</span> {pat.target}</div>}
                                                {pat.stopLoss && <div><span>SL:</span> {pat.stopLoss}</div>}
                                            </div>
                                        )}

                                        {pat.volumeConfirmed !== undefined && (
                                            <div className={`pat-volume-tag ${pat.volumeConfirmed ? 'confirmed' : 'unconfirmed'}`}>
                                                {pat.volumeConfirmed ? '✓ Volume Confirmed' : '⚠ Low Volume'}
                                            </div>
                                        )}
                                    </motion.div>
                                ))}
                            </div>
                        ) : (
                            <div className="no-patterns">
                                <p>No clear geometric patterns detected in the last 60 candles.</p>
                            </div>
                        )}

                        {result.keyLevels && (
                            <div className="hunter-key-levels">
                                <div className="key-level">
                                    <span className="lvl-label">Resistance</span>
                                    <span className="lvl-val">{result.keyLevels.resistance}</span>
                                </div>
                                <div className="key-level">
                                    <span className="lvl-label">Support</span>
                                    <span className="lvl-val">{result.keyLevels.support}</span>
                                </div>
                            </div>
                        )}

                        <div className="hunter-footer-info">
                            {result.actionable && (
                                <div className={`action-badge ${result.actionable.toLowerCase()}`}>
                                    Action: {result.actionable}
                                </div>
                            )}
                            {lastScan && (
                                <div className="scan-timestamp">
                                    Last Scan: {lastScan.toLocaleTimeString()}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </div>
        </motion.div>
    );
};

export default PatternHunter;
