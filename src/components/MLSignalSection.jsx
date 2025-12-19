import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpCircle, ArrowDownCircle, Activity, Info, TrendingUp, TrendingDown } from 'lucide-react';
import './MLSignalSection.css';

const MLSignalSection = ({ signals = [], loading = false }) => {
    const activeSignals = signals.filter(s => s.signal === 'UPPER_EXTREMITY' || s.signal === 'LOWER_EXTREMITY');

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
                        activeSignals.map((sig) => (
                            <motion.div
                                layout
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                whileHover={{ y: -5 }}
                                key={sig.symbol}
                                className={`ml-card-premium ${sig.signal === 'UPPER_EXTREMITY' ? 'bullish' : 'bearish'}`}
                            >
                                <div className="card-glow" />

                                <div className="ml-card-header-premium">
                                    <div className="symbol-vignette">
                                        <span className="symbol-name">{sig.symbol.replace('USDT', '').replace('USDC', '')}</span>
                                        <div className="model-badge">ALGO MOD</div>
                                    </div>
                                    <div className={`signal-label ${sig.signal === 'UPPER_EXTREMITY' ? 'buy' : 'sell'}`}>
                                        {sig.signal === 'UPPER_EXTREMITY' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                        {sig.signal === 'UPPER_EXTREMITY' ? 'LONG' : 'SHORT'}
                                    </div>
                                </div>

                                <div className="ml-card-body-premium">
                                    <div className="data-row">
                                        <span className="label">Predictive Value</span>
                                        <span className="value">{sig.value?.toFixed(4)}</span>
                                    </div>
                                    <div className="data-row">
                                        <span className="label">Band Range</span>
                                        <span className="value range">{sig.lower?.toFixed(2)} - {sig.upper?.toFixed(2)}</span>
                                    </div>

                                    <div className="price-box-ml">
                                        <span className="price-label">EXE PRICE</span>
                                        <span className="price-val">${sig.close?.toFixed(4)}</span>
                                    </div>
                                </div>

                                <div className="ml-card-footer-premium">
                                    <div className="visual-indicator">
                                        <div className="bar-bg">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: '100%' }}
                                                className="bar-fill"
                                            />
                                        </div>
                                    </div>
                                    <div className="icon-indicator">
                                        {sig.signal === 'UPPER_EXTREMITY' ? (
                                            <ArrowUpCircle size={24} className="text-success" />
                                        ) : (
                                            <ArrowDownCircle size={24} className="text-danger" />
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        ))
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default MLSignalSection;
