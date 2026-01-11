import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Clock, Target, Shield, Sparkles, ArrowRight, Zap } from 'lucide-react';
import { format } from 'date-fns';
import './SignalCard.css';
import { useSettings } from '../context/SettingsContext';

function SignalCard({ signal, onSimulateBuy }) {
    const isSell = signal.type === 'SELL';
    const { riskPerTrade } = useSettings();

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

    const formatCompact = (value) => {
        if (value == null || !Number.isFinite(value)) return '-';
        return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    };

    const entry = signal?.levels?.entry ?? signal.price;
    const stopLoss = signal?.levels?.stopLoss;
    const positionValue = Number.isFinite(riskPerTrade) ? riskPerTrade : null;
    const quantity = Number.isFinite(positionValue) && Number.isFinite(entry) && entry > 0 ? (positionValue / entry) : null;
    const riskAtSL = Number.isFinite(quantity) && Number.isFinite(entry) && Number.isFinite(stopLoss)
        ? Math.abs(entry - stopLoss) * quantity
        : null;

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
                        <span className="symbol-name">{signal.symbol.replace('USDC', '').replace('USDT', '')}</span>
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
                        {signal.levels.takeProfit2 != null && (
                            <div className="tp-val">
                                <span className="val-label">TP2</span>
                                <span className="val-num">${formatPrice(signal.levels.takeProfit2)}</span>
                            </div>
                        )}
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
                    <div className="ind-pill">OBI: {signal.execution?.obi != null ? signal.execution.obi : '-'}</div>
                    <div className="ind-pill">Spread: {signal.execution?.spreadBps != null ? `${signal.execution.spreadBps}bps` : '-'}</div>
                    <div className="ind-pill">Depth: {signal.execution?.depthNotionalTopN != null ? `$${formatCompact(signal.execution.depthNotionalTopN)}` : '-'}</div>
                    <div className="ind-pill">CVD20: {signal.indicators.cvd20 != null ? formatCompact(signal.indicators.cvd20) : '-'}</div>
                    <div className="ind-pill">Pos: {quantity != null ? formatCompact(quantity) : '-'} </div>
                    <div className="ind-pill">Risk@SL: {riskAtSL != null ? `$${formatCompact(riskAtSL)}` : '-'}</div>
                </div>

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
