import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpCircle, ArrowDownCircle, Activity, Info, TrendingUp, TrendingDown, AlertCircle, RotateCcw } from 'lucide-react';
import './MLSignalSection.css';

// Helper to determine if signal is bearish (short) or bullish (long)
const isBearishSignal = (signal) => {
    return signal === 'UPPER_EXTREMITY' || signal === 'APPROACHING_UPPER' || signal === 'MEAN_REVERSION_DOWN';
};

// Helper to get signal mode label
const getSignalModeLabel = (signalMode, signal) => {
    if (signalMode === 'EXTREMITY') return signal.includes('UPPER') ? 'SHORT' : 'LONG';
    if (signalMode === 'APPROACHING') return signal.includes('UPPER') ? '⚠️ SHORT ALERT' : '⚠️ LONG ALERT';
    if (signalMode === 'MEAN_REVERSION') return signal.includes('DOWN') ? '↩️ SHORT REV' : '↩️ LONG REV';
    return 'SIGNAL';
};

// Helper to get signal mode icon
const getSignalIcon = (signalMode) => {
    if (signalMode === 'APPROACHING') return <AlertCircle size={12} />;
    if (signalMode === 'MEAN_REVERSION') return <RotateCcw size={12} />;
    return isBearishSignal ? <TrendingDown size={12} /> : <TrendingUp size={12} />;
};

const MLSignalSection = ({ signals = [], loading = false }) => {
    // Filter signals: include all valid signal types
    const activeSignals = signals.filter(s =>
        s.signal === 'UPPER_EXTREMITY' ||
        s.signal === 'LOWER_EXTREMITY' ||
        s.signal === 'APPROACHING_UPPER' ||
        s.signal === 'APPROACHING_LOWER' ||
        s.signal === 'MEAN_REVERSION_UP' ||
        s.signal === 'MEAN_REVERSION_DOWN'
    );

    // Separate by priority for display
    const extremitySignals = activeSignals.filter(s => s.signalMode === 'EXTREMITY');
    const approachingSignals = activeSignals.filter(s => s.signalMode === 'APPROACHING');
    const reversionSignals = activeSignals.filter(s => s.signalMode === 'MEAN_REVERSION');

    return (
        <div className="ml-signal-section glass-card">
            <div className="ml-header">
                <div className="header-left">
                    <div className="ml-icon-box">
                        <Activity className="icon-pulse" size={18} />
                    </div>
                    <div className="header-text">
                        <h3>ML Momentum Signals</h3>
                        <div className="model-info">
                            <Info size={12} />
                            <span>GPR & RBF Kernel Logic</span>
                        </div>
                    </div>
                </div>
                <div className="header-right">
                    <span className="active-badge">
                        <span className="pulse-dot"></span>
                        {activeSignals.length} Active
                    </span>
                    {approachingSignals.length > 0 && (
                        <span className="active-badge warning" style={{ marginLeft: '8px', background: 'rgba(251, 191, 36, 0.2)', borderColor: '#fbbf24' }}>
                            ⚠️ {approachingSignals.length} Alert
                        </span>
                    )}
                </div>
            </div>

            <div className="ml-grid">
                <AnimatePresence mode="popLayout">
                    {loading ? (
                        <div className="ml-loading-grid">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="skeleton-signal-premium"></div>
                            ))}
                        </div>
                    ) : activeSignals.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="no-ml-signals"
                        >
                            <div className="no-signals-content">
                                <div className="radar-animation">
                                    <div className="circle c1"></div>
                                    <div className="circle c2"></div>
                                    <div className="circle c3"></div>
                                    <Activity size={24} className="radar-icon" />
                                </div>
                                <p>Escaneando anomalías estadísticas...</p>
                                <span className="text-muted">No se detectan extremos de momento en este momento.</span>
                            </div>
                        </motion.div>
                    ) : (
                        activeSignals.map((sig) => {
                            const bearish = isBearishSignal(sig.signal);
                            const modeLabel = getSignalModeLabel(sig.signalMode, sig.signal);

                            return (
                                <motion.div
                                    layout
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.9, opacity: 0 }}
                                    whileHover={{ y: -5 }}
                                    key={sig.symbol}
                                    className={`ml-card-premium ${bearish ? 'bearish' : 'bullish'} ${sig.signalMode === 'APPROACHING' ? 'approaching' : ''}`}
                                >
                                    <div className="card-glow" />

                                    <div className="ml-card-header-premium">
                                        <div className="symbol-vignette">
                                            <span className="symbol-name">{(sig.symbol || '').replace('USDT', '').replace('USDC', '')}</span>
                                            <div className={`quality-badge ${(sig.signalQuality || 'WEAK').toLowerCase()}`}>
                                                {sig.signalQuality || 'SIGNAL'}
                                            </div>
                                        </div>
                                        <div className={`signal-label ${bearish ? 'sell' : 'buy'} ${sig.signalMode?.toLowerCase()}`}>
                                            {sig.signalMode === 'APPROACHING' && <AlertCircle size={12} />}
                                            {sig.signalMode === 'MEAN_REVERSION' && <RotateCcw size={12} />}
                                            {sig.signalMode === 'EXTREMITY' && (bearish ? <TrendingDown size={12} /> : <TrendingUp size={12} />)}
                                            {modeLabel}
                                        </div>
                                    </div>

                                    <div className="ml-card-body-premium">
                                        {/* Score Bar */}
                                        <div className="score-bar-container">
                                            <div className="score-label">
                                                <span>Score</span>
                                                <span className="score-value">{sig.score || 0}/100</span>
                                            </div>
                                            <div className="score-bar">
                                                <motion.div
                                                    className="score-fill"
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${sig.score || 0}%` }}
                                                    transition={{ duration: 0.8, ease: "easeOut" }}
                                                />
                                            </div>
                                        </div>

                                        {/* Signal Mode Badge */}
                                        {sig.signalMode && (
                                            <div className={`mode-badge ${sig.signalMode.toLowerCase()}`}>
                                                {sig.signalMode === 'EXTREMITY' && '🎯 CONFIRMED'}
                                                {sig.signalMode === 'APPROACHING' && '⚠️ EARLY WARNING'}
                                                {sig.signalMode === 'MEAN_REVERSION' && '↩️ REVERSION'}
                                            </div>
                                        )}

                                        {/* Confirmation Badges */}
                                        <div className="confirmation-badges">
                                            {sig.rsiConfirmed && (
                                                <span className="badge confirmed">✓ RSI {sig.rsi}</span>
                                            )}
                                            {sig.trendAligned && (
                                                <span className="badge aligned">✓ Trend</span>
                                            )}
                                            {sig.confidence > 70 && (
                                                <span className="badge high-conf">🎯 {sig.confidence}%</span>
                                            )}
                                        </div>

                                        <div className="data-row">
                                            <span className="label">RSI</span>
                                            <span className={`value ${sig.rsi > 70 ? 'overbought' : sig.rsi < 30 ? 'oversold' : ''}`}>
                                                {sig.rsi}
                                            </span>
                                        </div>
                                        <div className="data-row">
                                            <span className="label">Band Position</span>
                                            <span className="value">
                                                {sig.bandPosition}%
                                            </span>
                                        </div>
                                        <div className="data-row">
                                            <span className="label">Velocity</span>
                                            <span className="value">{sig.velocity}%</span>
                                        </div>

                                        <div className="price-box-ml">
                                            <span className="price-label">EXE PRICE</span>
                                            <span className="price-val">${sig.close?.toFixed(4) || sig.price?.toFixed(4)}</span>
                                        </div>
                                    </div>

                                    <div className="ml-card-footer-premium">
                                        <div className="visual-indicator">
                                            <div className="bar-bg">
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${sig.signalStrength || 50}%` }}
                                                    className="bar-fill"
                                                />
                                            </div>
                                        </div>
                                        <div className="icon-indicator">
                                            {bearish ? (
                                                <ArrowDownCircle size={24} className="text-danger" />
                                            ) : (
                                                <ArrowUpCircle size={24} className="text-success" />
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default MLSignalSection;

