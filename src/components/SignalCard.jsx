import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Clock, Target, Shield, AlertTriangle, Sparkles, ArrowRight, Zap, Calculator, Copy, Layers, Activity, Check, Euro } from 'lucide-react';
import { format } from 'date-fns';
import { calculatePosition } from '../services/riskCalculator';
import './SignalCard.css';

const RiskCalculator = ({ entry, stopLoss, isSell }) => {
    const [capital, setCapital] = useState(3400); // Default €3,400
    const [riskPct, setRiskPct] = useState(1.5);  // Default 1.5%

    const calculation = useMemo(() =>
        calculatePosition({
            capital,
            riskPercent: riskPct / 100,
            entryPrice: entry,
            stopLossPrice: stopLoss,
            maxLeverage: 1, // Spot only
            eurToUsd: 1.08
        }), [capital, riskPct, entry, stopLoss]
    );

    const riskAmountEUR = capital * (riskPct / 100);

    return (
        <div className="risk-calc-box sniper-mode">
            <div className="calc-header">
                <div className="calc-label">
                    <Calculator size={14} />
                    <span>POSITION SIZING</span>
                    {calculation.isCapped && (
                        <span className="capped-badge" title="Position capped at capital limit">CAPPED</span>
                    )}
                </div>
                <div className="quick-risk-btns">
                    {[1, 1.5, 2].map(pct => (
                        <button
                            key={pct}
                            onClick={() => setRiskPct(pct)}
                            className={`q-btn ${riskPct === pct ? 'active' : ''}`}
                        >
                            {pct}%
                        </button>
                    ))}
                </div>
            </div>

            <div className="calc-input-row">
                <div className="risk-input-group">
                    <Euro size={14} className="cur-icon" />
                    <input
                        type="number"
                        value={capital}
                        onChange={(e) => setCapital(Number(e.target.value))}
                        className="risk-input capital-input"
                        step="100"
                    />
                </div>
                <div className="calc-results-sniper">
                    <div className="res-item primary">
                        <span className="lbl">SIZE</span>
                        <span className="val">{calculation.positionSize < 0.01 ? calculation.positionSize.toFixed(6) : calculation.positionSize.toFixed(4)}</span>
                    </div>
                    <div className="res-item">
                        <span className="lbl">VALUE</span>
                        <span className="val">€{calculation.positionValueEUR.toLocaleString()}</span>
                    </div>
                    <div className="res-item risk-highlight">
                        <span className="lbl">RISK</span>
                        <span className="val">€{riskAmountEUR.toFixed(0)}</span>
                    </div>
                </div>
            </div>

            <div className="sl-info-bar">
                <span>SL Distance: {calculation.slPercent}%</span>
                <span className={`direction-tag ${calculation.direction.toLowerCase()}`}>
                    {calculation.direction}
                </span>
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
            { id: 'trend', label: 'TREND', score: subscores.trend || 0, icon: <TrendingUp size={10} /> },
            { id: 'momentum', label: 'MOM', score: subscores.momentum || 0, icon: <Zap size={10} /> },
            { id: 'volume', label: 'VOL', score: subscores.volume || 0, icon: <Activity size={10} /> },
            { id: 'smc', label: 'SMC', score: (subscores.smc || 0) * 100, icon: <Target size={10} /> }
        ];

        return (
            <div className="confluence-tracker-modern">
                {factors.map(f => (
                    <div key={f.id} className="confluence-item-modern" title={`${f.label}: ${f.score}%`}>
                        <div className="conf-icon-box">{f.icon}</div>
                        <div className="conf-data">
                            <div className="conf-bar-modern">
                                <motion.div
                                    className="conf-bar-fill-modern"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min(100, f.score)}%` }}
                                    transition={{ duration: 1, delay: 0.8 }}
                                />
                            </div>
                            <span className="conf-label-modern">{f.label}</span>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const copyToClipboard = (text, type) => {
        navigator.clipboard.writeText(text);
        // We could add a local state for toast/feedback here if needed
        console.log(`Copied ${type}: ${text}`);
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
                <div className="price-stack" onClick={() => copyToClipboard(signal.price, 'Price')} title="Click to copy price">
                    <span className="stack-label">{isSell ? 'SELL AT' : 'BUY AT'}</span>
                    <div className="stack-value-wrapper">
                        <span className="stack-value">${formatPrice(signal.price)}</span>
                        <Copy size={12} className="copy-hint" />
                    </div>
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
                        <div className="tp-val" onClick={() => copyToClipboard(signal.levels.takeProfit1, 'TP1')}>
                            <span className="val-label">TP1</span>
                            <div className="val-num-wrapper">
                                <span className="val-num">${formatPrice(signal.levels.takeProfit1)}</span>
                                <Copy size={10} className="copy-hint-mini" />
                            </div>
                        </div>
                        <div className="tp-val" onClick={() => copyToClipboard(signal.levels.takeProfit2, 'TP2')}>
                            <span className="val-label">TP2</span>
                            <div className="val-num-wrapper">
                                <span className="val-num">${formatPrice(signal.levels.takeProfit2)}</span>
                                <Copy size={10} className="copy-hint-mini" />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="level-box sl" onClick={() => copyToClipboard(signal.levels.stopLoss, 'SL')}>
                    <div className="level-header">
                        <Shield size={14} />
                        <span>STOP LOSS</span>
                    </div>
                    <div className="sl-val-wrapper">
                        <span className="sl-val">${formatPrice(signal.levels.stopLoss)}</span>
                        <Copy size={10} className="copy-hint-mini" />
                    </div>
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
