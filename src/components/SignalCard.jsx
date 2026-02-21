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
            className={`signal-card-premium ${isSell ? 'sell' : 'buy'}`}
        >
            <div className="signal-header-premium">
                <div className="symbol-meta">
                    <span className="text-slate-400">MARKET_INSTRUMENT</span>
                    <div className="symbol-badge-box">
                        <span className="symbol-name">{signal.symbol.replace('USDC', '').replace('USDT', '')}</span>
                    </div>
                </div>

                <div className="confidence-box">
                    <div className="lbl">CONFIDENCE</div>
                    <div className="val">{signal.score}%</div>
                </div>
            </div>

            <div className={isSell ? "signal-sell-box" : "signal-buy-box"}>
                <span>SIGNAL: {isSell ? 'SHORT' : 'LONG'}</span>
                {isSell ? <TrendingDown size={24} strokeWidth={3} color="#000" /> : <TrendingUp size={24} strokeWidth={3} color="#000" />}
            </div>

            <div className="brutalist-section-title">ACTION_PLAN</div>

            <div className="levels-grid-premium">
                <div className="level-box">
                    <span className="level-header">ENTRY_ZONE</span>
                    <span className="level-value-main">${formatPrice(signal.price)}</span>
                </div>

                <div className="level-box">
                    <span className="level-header danger">STOP_LOSS</span>
                    <span className="level-value-main danger">${formatPrice(signal.levels.stopLoss)}</span>
                </div>

                <div className="level-box">
                    <span className="level-header">TARGET_P1</span>
                    <span className="level-value-main success">${formatPrice(signal.levels.takeProfit1)}</span>
                </div>

                {signal.levels.takeProfit2 != null ? (
                    <div className="level-box">
                        <span className="level-header">TARGET_P2</span>
                        <span className="level-value-main success">${formatPrice(signal.levels.takeProfit2)}</span>
                    </div>
                ) : (
                    <div className="level-box">
                        <span className="level-header">TARGET_P2</span>
                        <span className="level-value-main text-slate-500">-</span>
                    </div>
                )}
            </div>

            <div className="brutalist-section-title">EXECUTION_SPECS</div>
            <div className="metrics-grid-brutalist">
                <div className="metric-box">
                    <p className="metric-box-label">R/R_RATIO</p>
                    <p className="metric-box-val">{signal.riskReward || '1:2'}</p>
                </div>
                <div className="metric-box">
                    <p className="metric-box-label">ALLOCATION</p>
                    <p className="metric-box-val">${positionValue || 10}</p>
                </div>
                <div className="metric-box">
                    <p className="metric-box-label">LEVERAGE</p>
                    <p className="metric-box-val">10X</p>
                </div>
            </div>

            <div className="signal-content-premium">
                <div className="brutalist-section-title" style={{ marginTop: 0, padding: 0 }}>CONFLUENCE</div>
                <div className="confluence-list">
                    <div className="cf-item">
                        <div className="cf-check"><div className="cf-check-inner"></div></div>
                        <span className="cf-text">RSI: {signal.indicators.rsi}</span>
                    </div>
                    {signal.indicators.adx && (
                        <div className="cf-item">
                            <div className="cf-check"><div className="cf-check-inner"></div></div>
                            <span className="cf-text">ADX: {signal.indicators.adx}</span>
                        </div>
                    )}
                    {signal.indicators.cvd20 != null && (
                        <div className="cf-item">
                            <div className="cf-check"><div className="cf-check-inner"></div></div>
                            <span className="cf-text">CVD20: {formatCompact(signal.indicators.cvd20)}</span>
                        </div>
                    )}
                    {signal.execution?.obi != null && (
                        <div className="cf-item">
                            <div className="cf-check"><div className="cf-check-inner"></div></div>
                            <span className="cf-text">OBI: {signal.execution.obi}</span>
                        </div>
                    )}
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
                {onSimulateBuy && (
                    <button
                        className={`btn-execute-premium ${isSell ? 'sell' : 'buy'}`}
                        onClick={() => onSimulateBuy(signal)}
                    >
                        <Zap size={20} strokeWidth={3} />
                        EXECUTE_TRADE
                    </button>
                )}
            </div>
        </motion.div>
    );
}

export default SignalCard;
