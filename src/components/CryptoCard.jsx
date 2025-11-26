import { TrendingUp, TrendingDown, Activity, Target, Shield, AlertTriangle, Clock } from 'lucide-react';
import './CryptoCard.css';

function CryptoCard({ crypto }) {
    const { symbol, price, priceChangePercent, volume24h, analysis } = crypto;
    const isPositive = priceChangePercent >= 0;

    // Formatear precio dinámicamente según el valor
    const formatPrice = (price) => {
        if (!price) return '0.00';
        if (price >= 1) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (price >= 0.01) return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
        if (price >= 0.0001) return price.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
        return price.toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 });
    };

    // Calculate Market Health Score (simplified version of signal generator)
    const calculateMarketHealth = () => {
        if (!analysis || !analysis.indicators) return { score: 0, confidence: 'LOW', label: 'Neutral' };

        const { indicators } = analysis;
        let score = 0;

        // RSI (0-100)
        // 30-70 is neutral. <30 oversold (bullish), >70 overbought (bearish)
        // For market health, we might want to show strength.
        // Let's stick to "Opportunity" score like SignalCard (Bullish bias)
        if (indicators.rsi < 30) score += 30; // Oversold -> Buy opportunity
        else if (indicators.rsi < 45) score += 15;
        else if (indicators.rsi > 70) score -= 10; // Overbought

        // MACD
        if (indicators.macd && indicators.macd.histogram > 0) score += 20;

        // Trend (EMA)
        if (indicators.ema20 && indicators.ema50 && indicators.ema20 > indicators.ema50) {
            score += 20;
            if (price < indicators.ema20) score += 10; // Dip in uptrend
        }

        // Bollinger
        if (indicators.bollingerBands && price <= indicators.bollingerBands.lower) score += 20;

        // Normalize to 0-100
        score = Math.max(0, Math.min(100, score));

        let confidence = 'LOW';
        let label = 'Neutral';
        if (score >= 70) { confidence = 'HIGH'; label = 'Alta Oportunidad'; }
        else if (score >= 40) { confidence = 'MEDIUM'; label = 'Oportunidad Media'; }
        else { confidence = 'LOW'; label = 'Baja Oportunidad'; }

        return { score, confidence, label };
    };

    const marketHealth = calculateMarketHealth();
    const indicators = analysis?.indicators || {};
    const levels = analysis?.levels || {};

    // Helper for confidence colors
    const confidenceColor = {
        HIGH: 'success',
        MEDIUM: 'warning',
        LOW: 'info' // Using info for low/neutral to be less alarming than danger
    };

    return (
        <div className={`crypto-card glass-card fade-in ${marketHealth.confidence.toLowerCase()}-signal`}>
            {/* Header */}
            <div className="crypto-header">
                <div className="crypto-symbol">
                    <Activity className="crypto-icon" />
                    <span className="crypto-name">{symbol.replace('USDC', '')}</span>
                </div>
                <div className={`crypto-change ${isPositive ? 'positive' : 'negative'}`}>
                    {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    <span>{Math.abs(priceChangePercent).toFixed(2)}%</span>
                </div>
            </div>

            {/* Price & Score */}
            <div className="crypto-main">
                <div className="crypto-price-container">
                    <span className="price-label">Precio Actual</span>
                    <span className="price-value">${formatPrice(price)}</span>
                </div>
                <div className="crypto-score">
                    <div className="score-circle" style={{ '--score': marketHealth.score }}>
                        <span className="score-value">{marketHealth.score}</span>
                    </div>
                    <span className="score-label">Score</span>
                </div>
            </div>

            {/* Indicators */}
            {analysis && (
                <div className="crypto-indicators-grid">
                    <div className="indicator-item">
                        <span className="indicator-label">RSI</span>
                        <span className="indicator-value">{indicators.rsi ? indicators.rsi.toFixed(1) : '-'}</span>
                    </div>
                    <div className="indicator-item">
                        <span className="indicator-label">MACD</span>
                        <span className="indicator-value">{indicators.macd?.histogram ? indicators.macd.histogram.toFixed(4) : '-'}</span>
                    </div>
                    <div className="indicator-item">
                        <span className="indicator-label">Vol 24h</span>
                        <span className="indicator-value">${(volume24h / 1000000).toFixed(1)}M</span>
                    </div>
                </div>
            )}

            {/* Levels */}
            {analysis && (
                <div className="crypto-levels">
                    <div className="level-item">
                        <Shield className="level-icon text-info" />
                        <div className="level-info">
                            <span className="level-label">Soporte</span>
                            <span className="level-value text-info">
                                ${levels.support ? formatPrice(levels.support) : '-'}
                            </span>
                        </div>
                    </div>
                    <div className="level-item">
                        <Target className="level-icon text-warning" />
                        <div className="level-info">
                            <span className="level-label">Resistencia</span>
                            <span className="level-value text-warning">
                                ${levels.resistance ? formatPrice(levels.resistance) : '-'}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Footer / Badge */}
            <div className="crypto-footer">
                <span className={`badge badge-${confidenceColor[marketHealth.confidence]}`}>
                    {marketHealth.label}
                </span>
            </div>
        </div>
    );
}

export default CryptoCard;
