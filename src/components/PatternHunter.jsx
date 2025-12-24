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
            // Fetch candles
            const klines = await binanceService.getKlines(selectedSymbol, '1h', 60);
            const closePrices = klines.map(k => k.close);

            // Call AI
            const response = await getPatternAnalysis(selectedSymbol, closePrices);

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

                        {result.detected && result.patterns.length > 0 ? (
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
                                    </motion.div>
                                ))}
                            </div>
                        ) : (
                            <div className="no-patterns">
                                <p>No clear geometric patterns detected in the last 60 candles.</p>
                            </div>
                        )}

                        {lastScan && (
                            <div className="scan-timestamp">
                                Last Scan: {lastScan.toLocaleTimeString()}
                            </div>
                        )}
                    </motion.div>
                )}
            </div>
        </motion.div>
    );
};

export default PatternHunter;
