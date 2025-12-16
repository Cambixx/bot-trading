import React from 'react';
import { ArrowUpCircle, ArrowDownCircle, Activity, AlertCircle } from 'lucide-react';
import './MLSignalSection.css';

/**
 * ML Signal Section Component
 * Displays signals from the Machine Learning Moving Average indicator
 * Props:
 *  - signals: Array of signal objects { symbol, type, value, upper, lower, timestamp }
 *  - loading: boolean
 */
const MLSignalSection = ({ signals = [], loading = false }) => {

    if (loading) {
        return (
            <div className="ml-signal-section glass-card">
                <div className="ml-header">
                    <h3><Activity className="icon-pulse" size={20} /> ML Momentum Signals</h3>
                </div>
                <div className="ml-loading">
                    <div className="skeleton-signal"></div>
                    <div className="skeleton-signal"></div>
                    <div className="skeleton-signal"></div>
                </div>
            </div>
        );
    }

    // Filter only active signals (UPPER or LOWER extremity)
    // You might want to show "Neutral" status for watched coins too, strictly optional.
    // For now, let's show all passing signals.
    const activeSignals = signals.filter(s => s.signal === 'UPPER_EXTREMITY' || s.signal === 'LOWER_EXTREMITY');

    return (
        <div className="ml-signal-section glass-card fade-in">
            <div className="ml-header">
                <h3><Activity className="icon-pulse" size={20} /> ML Momentum Signals (LuxAlgo Logic)</h3>
                <span className="badge-count">{activeSignals.length} Active</span>
            </div>

            <div className="ml-grid">
                {activeSignals.length === 0 ? (
                    <div className="no-ml-signals">
                        <AlertCircle size={24} className="text-muted" />
                        <p>No extreme momentum signals detected currently.</p>
                        <small className="text-muted">Analyzing market using GPR & RBF Kernel...</small>
                    </div>
                ) : (
                    activeSignals.map((sig) => (
                        <div key={sig.symbol} className={`ml-card ${sig.signal === 'UPPER_EXTREMITY' ? 'bearish' : 'bullish'}`}>
                            <div className="ml-card-header">
                                <span className="symbol-name">{sig.symbol}</span>
                                <span className="signal-badge">
                                    {sig.signal === 'UPPER_EXTREMITY' ? 'SELL / UPPER' : 'BUY / LOWER'}
                                </span>
                            </div>

                            <div className="ml-values">
                                <div className="ml-row">
                                    <span>Price:</span>
                                    <strong>{sig.close?.toFixed(2)}</strong>
                                </div>
                                <div className="ml-row">
                                    <span>Model Range:</span>
                                    <small>{sig.lower?.toFixed(2)} - {sig.upper?.toFixed(2)}</small>
                                </div>
                                <div className="ml-row">
                                    <span>GPR Value:</span>
                                    <span>{sig.value?.toFixed(2)}</span>
                                </div>
                            </div>

                            <div className="ml-icon-wrapper">
                                {sig.signal === 'UPPER_EXTREMITY' ? (
                                    <ArrowDownCircle size={32} />
                                ) : (
                                    <ArrowUpCircle size={32} />
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default MLSignalSection;
