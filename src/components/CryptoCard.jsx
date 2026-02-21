import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity, Sparkles } from 'lucide-react';
import './CryptoCard.css';

function CryptoCard({ crypto }) {
    const { symbol, price, priceChangePercent, opportunity } = crypto;
    const isPositive = priceChangePercent >= 0;

    // Formatear precio dinámicamente según el valor
    const formatPrice = (price) => {
        if (!price) return '0.00';
        if (price >= 1) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (price >= 0.01) return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
        if (price >= 0.0001) return price.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
        return price.toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 });
    };

    const score = opportunity || 0;

    const getOpportunityLevel = () => {
        if (score >= 70) return { level: 'HIGH', label: 'Alta Oportunidad', color: 'success', icon: <Sparkles size={14} /> };
        if (score >= 50) return { level: 'MEDIUM', label: 'Oportunidad Media', color: 'warning', icon: null };
        return { level: 'LOW', label: 'Baja Oportunidad', color: 'info', icon: null };
    };

    const opportunityInfo = getOpportunityLevel();

    return (
        <motion.div
            className={`crypto-card ${opportunityInfo.level.toLowerCase()}-signal`}
        >

            <div className="crypto-header">
                <div className="crypto-symbol-info">
                    <div className="symbol-icon-wrapper">
                        <Activity className="crypto-icon" size={16} />
                    </div>
                    <div>
                        <span className="crypto-name">{symbol.replace('USDC', '').replace('USDT', '')}</span>
                        <div className={`crypto-change ${isPositive ? 'positive' : 'negative'}`}>
                            <span>{isPositive ? '+' : ''}{priceChangePercent?.toFixed(2)}%</span>
                        </div>
                    </div>
                </div>

                <div className="opportunity-badge-mini">
                    <span>{opportunityInfo.level}</span>
                </div>
            </div>

            <div className="crypto-main">
                <div className="price-display">
                    <span className="price-label">PRECIO ACTUAL</span>
                    <span className="price-value">${formatPrice(price)}</span>
                </div>

                <div className="score-viz">
                    <div className="score-text">
                        <span className="score-num">{score}</span>
                        <span className="score-label">SCORE</span>
                    </div>
                </div>
            </div>

            <div className="crypto-footer">
                <div className={`opportunity-status ${opportunityInfo.color}`}>
                    <div className="status-dot-mini" />
                    <span>{opportunityInfo.label}</span>
                </div>
            </div>
        </motion.div>
    );
}

export default CryptoCard;
