import { TrendingUp, Clock, Target, Shield, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import './SignalCard.css';

function SignalCard({ signal, onSimulateBuy }) {
    const confidenceColor = {
        HIGH: 'success',
        MEDIUM: 'warning',
        LOW: 'info'
    };

    const confidenceLabel = {
        HIGH: 'Alta Confianza',
        MEDIUM: 'Confianza Media',
        LOW: 'Baja Confianza'
    };

    const formatPrice = (price) => {
        if (!price) return '0.00';
        if (price < 0.0001) return price.toFixed(8);
        if (price < 0.01) return price.toFixed(6);
        if (price < 1) return price.toFixed(4);
        return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    return (
        <div className={`signal-card glass-card fade-in ${signal.confidence.toLowerCase()}-signal`}>
            {/* Header */}
            <div className="signal-header">
                <div className="signal-symbol">
                    <TrendingUp className="signal-icon" />
                    <span className="symbol-text">{signal.symbol}</span>
                </div>
                <span className={`badge badge-${confidenceColor[signal.confidence]}`}>
                    {confidenceLabel[signal.confidence]}
                </span>
            </div>

            {/* Price & Score */}
            <div className="signal-main">
                <div className="signal-price">
                    <span className="price-label">Precio de Entrada</span>
                    <span className="price-value">${formatPrice(signal.price)}</span>
                </div>
                <div className="signal-score">
                    <div className="score-circle" style={{ '--score': signal.score }}>
                        <span className="score-value">{signal.score}</span>
                    </div>
                    <span className="score-label">Score</span>
                </div>
            </div>

            {/* Indicators */}
            <div className="signal-indicators">
                <div className="indicator-item">
                    <span className="indicator-label">RSI</span>
                    <span className="indicator-value">{signal.indicators.rsi}</span>
                </div>
                <div className="indicator-item">
                    <span className="indicator-label">MACD</span>
                    <span className="indicator-value">{signal.indicators.macd}</span>
                </div>
                <div className="indicator-item">
                    <span className="indicator-label">BB Position</span>
                    <span className="indicator-value">{signal.indicators.bbPosition}</span>
                </div>
            </div>

            {/* Levels */}
            <div className="signal-levels">
                <div className="level-item">
                    <Target className="level-icon" />
                    <div className="level-info">
                        <span className="level-label">Take Profit 1</span>
                        <span className="level-value text-success">${formatPrice(signal.levels.takeProfit1)}</span>
                    </div>
                </div>
                <div className="level-item">
                    <Target className="level-icon" />
                    <div className="level-info">
                        <span className="level-label">Take Profit 2</span>
                        <span className="level-value text-success">${formatPrice(signal.levels.takeProfit2)}</span>
                    </div>
                </div>
                <div className="level-item">
                    <Shield className="level-icon text-danger" />
                    <div className="level-info">
                        <span className="level-label">Stop Loss</span>
                        <span className="level-value text-danger">${formatPrice(signal.levels.stopLoss)}</span>
                    </div>
                </div>
            </div>

            {/* Reasons */}
            <div className="signal-reasons">
                <h4 className="reasons-title">Razones de Compra</h4>
                <ul className="reasons-list">
                    {signal.reasons.slice(0, 3).map((reason, idx) => (
                        <li key={idx} className="reason-item">
                            {typeof reason === 'object' ? reason.text : reason}
                        </li>
                    ))}
                </ul>
            </div>

            {/* Warnings if any */}
            {signal.warnings && signal.warnings.length > 0 && (
                <div className="signal-warnings">
                    <AlertTriangle className="warning-icon" />
                    <span>{signal.warnings[0]}</span>
                </div>
            )}

            {/* AI Analysis if available */}
            {signal.aiAnalysis && (
                <div className="ai-analysis">
                    <div className="ai-badge">
                        <span>🤖 AI Analysis</span>
                    </div>
                    <div className="ai-content">
                        <div className="ai-sentiment">
                            <span>Sentimiento: </span>
                            <strong className={`text-${signal.aiAnalysis.sentiment === 'BULLISH' ? 'success' : 'warning'}`}>
                                {signal.aiAnalysis.sentiment}
                            </strong>
                        </div>
                        {signal.aiAnalysis.insights && signal.aiAnalysis.insights.length > 0 && (
                            <p className="ai-insight">{signal.aiAnalysis.insights[0]}</p>
                        )}
                    </div>
                </div>
            )}

            {/* Actions */}
            {onSimulateBuy && (
                <div className="signal-actions" style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>
                    <button
                        className="btn-simulate"
                        onClick={() => onSimulateBuy(signal)}
                        style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(38, 166, 154, 0.2)',
                            border: '1px solid rgba(38, 166, 154, 0.3)',
                            borderRadius: '8px',
                            color: '#26a69a',
                            cursor: 'pointer',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            transition: 'all 0.2s'
                        }}
                    >
                        💼 Simular Compra
                    </button>
                </div>
            )}



            {/* Footer */}
            <div className="signal-footer">
                <div className="footer-item">
                    <Clock className="footer-icon" />
                    <span className="footer-text">{format(new Date(signal.timestamp), 'HH:mm:ss')}</span>
                </div>
                <div className="footer-item">
                    <span className="footer-label">R:R</span>
                    <span className="footer-value">{signal.riskReward}</span>
                </div>
            </div>
        </div>
    );
}

export default SignalCard;
