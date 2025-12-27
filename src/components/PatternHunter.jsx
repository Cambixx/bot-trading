import React, { useState } from 'react';
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

    const handleScan = async () => {
        if (!selectedSymbol) return;

        setLoading(true);
        setResult(null);

        try {
            // Fetch OHLCV candles (not just close prices)
            const klines = await binanceService.getKlines(selectedSymbol, '1h', 60);

            // Build structured OHLCV data for better pattern detection
            const ohlcvData = klines.map(k => ({
                open: k.open,
                high: k.high,
                low: k.low,
                close: k.close,
                volume: k.volume
            }));

            // Calculate volume context
            const volumes = klines.map(k => k.volume);
            const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const volumeTrend = recentVolume > avgVolume ? 'INCREASING' : 'DECREASING';

            // Current price context
            const currentPrice = klines[klines.length - 1].close;
            const priceRange = {
                high24h: Math.max(...klines.slice(-24).map(k => k.high)),
                low24h: Math.min(...klines.slice(-24).map(k => k.low)),
                current: currentPrice
            };

            // Call AI with enhanced data
            const response = await getPatternAnalysis(selectedSymbol, ohlcvData, {
                volumeTrend,
                avgVolume,
                priceRange
            });

            if (response.success && response.analysis) {
                setResult(response.analysis);
                setLastScan(new Date());
            }

        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
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
                {!result && !loading && (
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
