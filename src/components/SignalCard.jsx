import { useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Clock, Target, Shield, AlertTriangle, Sparkles, ArrowRight, Zap, Calculator } from 'lucide-react';
import { format } from 'date-fns';
import './SignalCard.css';

const RiskCalculator = ({ entry, stopLoss, isSell }) => {
    const [riskAmount, setRiskAmount] = useState(50); // Default risk $50

    const riskPerShare = Math.abs(entry - stopLoss);
    const shares = riskAmount / riskPerShare;
    const positionValue = shares * entry;
    // Leverage needed assuming 100% margin usage for simplicity, or just display raw size
    // Let's just show Size and Value.

    // Leverage hint: If Position Value > Risk * 10, suggests leverage might be needed for small accounts

    return (
        <div className="risk-calc-box">
            <div className="calc-header">
                <div className="calc-label"><Calculator size={12} /> RISK SIZING</div>
                <div className="risk-input-group">
                    <span>Risk $</span>
                    <input
                        type="number"
                        value={riskAmount}
                        onChange={(e) => setRiskAmount(Number(e.target.value))}
                        className="risk-input"
                    />
                </div>
            </div>
            <div className="calc-results">
                <div className="calc-item">
                    <span className="lbl">SIZE</span>
                    <span className="val">{shares < 1 ? shares.toFixed(4) : shares.toFixed(2)}</span>
                </div>
                <div className="calc-item">
                    <span className="lbl">VALUE</span>
                    <span className="val">${positionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
            </div>
        </div>
    );
};

function SignalCard({ signal, onSimulateBuy }) {
    const isSell = signal.type === 'SELL';

    const confidenceColor = {
        HIGH: 'success',
        MEDIUM: 'warning',
        LOW: 'info'
    };

    const confidenceLabel = {
        HIGH: 'Alta Confianza',
        MEDIUM: 'Media',
        LOW: 'Baja'
    };

    const formatPrice = (price) => {
        if (!price) return '0.00';
        if (price < 0.0001) return price.toFixed(8);
        if (price < 0.01) return price.toFixed(6);
        if (price < 1) return price.toFixed(4);
        return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const ConfluenceTracker = ({ subscores }) => {
        if (!subscores) return null;

        const factors = [
            { id: 'trend', label: 'TREND', score: subscores.trend || 0 },
            { id: 'momentum', label: 'MOM', score: subscores.momentum || 0 },
            { id: 'volume', label: 'VOL', score: subscores.volume || 0 },
            { id: 'levels', label: 'STRUC', score: (subscores.levels || 0) + (subscores.patterns || 0) }
        ];

        return (
            <div className="confluence-tracker">
                {factors.map(f => (
                    <div key={f.id} className="confluence-item" title={`${f.label}: ${f.score}%`}>
                        <div className="conf-bar-bg">
                            <motion.div
                                className="conf-bar-fill"
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, f.score)}%` }}
                                transition={{ duration: 1, delay: 0.8 }}
                            />
                        </div>
                        <span className="conf-label">{f.label}</span>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <motion.div
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
            className={`signal-card-premium ${isSell ? 'sell' : 'buy'}`}
        >
            <div className="card-accent-bar" />

            <div className="signal-header-premium">
                <div className="symbol-meta">
                    <div className="symbol-badge-box">
                        <Zap size={14} className="zap-icon" />
                        <span className="symbol-name">{(signal.symbol || '').replace('USDC', '').replace('USDT', '')}</span>
                    </div>
                    <div className={`trade-type-badge ${isSell ? 'sell' : 'buy'}`}>
                        {isSell ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                        <span>{isSell ? 'SHORT' : 'LONG'}</span>
                    </div>
                </div>

                <div className={`confidence-badge-premium ${confidenceColor[signal.confidence]}`}>
                    <Sparkles size={12} />
                    <span>{confidenceLabel[signal.confidence]}</span>
                </div>
            </div>

            <div className="signal-main-premium">
                <div className="price-stack">
                    <span className="stack-label">{isSell ? 'SELL AT' : 'BUY AT'}</span>
                    <span className="stack-value">${formatPrice(signal.price)}</span>
                </div>

                <div className="score-viz-small">
                    <div className="score-ring-mini" style={{ '--score': signal.score }}>
                        <span className="score-val">{signal.score}</span>
                    </div>
                </div>
            </div>

            <ConfluenceTracker subscores={signal.subscores} />

            <div className="levels-grid-premium">
                <div className="level-box tp">
                    <div className="level-header">
                        <Target size={14} />
                        <span>TAKE PROFIT</span>
                    </div>
                    <div className="level-values">
                        <div className="tp-val">
                            <span className="val-label">TP1</span>
                            <span className="val-num">${formatPrice(signal.levels.takeProfit1)}</span>
                        </div>
                        <div className="tp-val">
                            <span className="val-label">TP2</span>
                            <span className="val-num">${formatPrice(signal.levels.takeProfit2)}</span>
                        </div>
                    </div>
                </div>

                <div className="level-box sl">
                    <div className="level-header">
                        <Shield size={14} />
                        <span>STOP LOSS</span>
                    </div>
                    <span className="sl-val">${formatPrice(signal.levels.stopLoss)}</span>
                </div>
            </div>

            <div className="signal-content-premium">
                {/* Indicators Row */}
                <div className="indicators-row-premium">
                    <div className="ind-pill">RSI: {signal.indicators.rsi}</div>
                    <div className="ind-pill">ADX: {signal.indicators.adx || '-'}</div>
                    <div className="ind-pill">RR: {signal.riskReward}</div>
                    {(signal.indicators.rvol > 1.5 || (signal.subscores && signal.subscores.volume > 70)) && (
                        <div className={`ind-pill ${signal.indicators.rvol > 3 ? 'high-vol-alert' : ''}`} style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}>
                            RVOL: {signal.indicators.rvol || 'High'}
                        </div>
                    )}
                </div>

                {/* Risk Calculator (Professional Edge) */}
                <RiskCalculator
                    entry={signal.price}
                    stopLoss={signal.levels.stopLoss}
                    isSell={isSell}
                />

                {/* AI Insights if available */}
                {signal.aiAnalysis && (
                    <div className="ai-insight-box">
                        <div className="ai-insight-header">
                            <div className="ai-tag">AI INSIGHT</div>
                            <div className={`ai-sentiment-dot ${signal.aiAnalysis.sentiment.toLowerCase()}`} />
                        </div>
                        <p className="ai-text">{signal.aiAnalysis.insights?.[0] || "Confirming momentum trajectory..."}</p>
                    </div>
                )}
            </div>

            <div className="signal-footer-premium">
                <div className="time-stamp">
                    <Clock size={12} />
                    <span>{format(new Date(signal.timestamp), 'HH:mm')}</span>
                </div>

                {onSimulateBuy && (
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className={`btn-execute-premium ${isSell ? 'sell' : 'buy'}`}
                        onClick={() => onSimulateBuy(signal)}
                    >
                        <span>SIMULATE</span>
                        <ArrowRight size={14} />
                    </motion.button>
                )}
            </div>
        </motion.div>
    );
}

export default SignalCard;
