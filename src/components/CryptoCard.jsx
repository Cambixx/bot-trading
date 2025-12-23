import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity, Sparkles } from 'lucide-react';
import './CryptoCard.css';

function CryptoCard({ crypto }) {
    const { symbol, price, priceChangePercent, opportunity, opportunityType } = crypto;
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
        if (score >= 70) {
            if (opportunityType === 'SHORT') {
                return { level: 'HIGH', label: 'Alta Oportunidad (Short)', color: 'danger', icon: <TrendingDown size={14} /> };
            }
            return { level: 'HIGH', label: 'Alta Oportunidad (Long)', color: 'success', icon: <Sparkles size={14} /> };
        }
        if (score >= 50) {
            if (opportunityType === 'SHORT') {
                return { level: 'MEDIUM', label: 'Oportunidad Media (Short)', color: 'warning', icon: null };
            }
            return { level: 'MEDIUM', label: 'Oportunidad Media (Long)', color: 'warning', icon: null };
        }
        return { level: 'LOW', label: 'Baja Oportunidad', color: 'info', icon: null };
    };

    const opportunityInfo = getOpportunityLevel();

    return (
        <motion.div
            whileHover={{ y: -5, transition: { duration: 0.2 } }}
            className={`crypto-card glass-card ${opportunityInfo.level.toLowerCase()}-signal`}
        >
            <div className="crypto-card-glow" />

            <div className="crypto-header">
                <div className="crypto-symbol-info">
                    <div className="symbol-icon-wrapper">
                        <Activity className="crypto-icon" size={16} />
                    </div>
                    <div>
                        <span className="crypto-name">{symbol.replace('USDC', '').replace('USDT', '')}</span>
                        <div className={`crypto-change ${isPositive ? 'positive' : 'negative'}`}>
                            {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            <span>{isPositive ? '+' : ''}{priceChangePercent?.toFixed(2)}%</span>
                        </div>
                    </div>
                </div>

                <div className="opportunity-badge-mini">
                    {opportunityInfo.icon}
                    <span>{opportunityInfo.level}</span>
                </div>
            </div>

            <div className="crypto-main">
                <div className="price-display">
                    <span className="price-label">PRECIO ACTUAL</span>
                    <span className="price-value">${formatPrice(price)}</span>
                </div>

                <div className="score-viz">
                    <svg className="score-ring" viewBox="0 0 36 36">
                        <path className="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                        <motion.path
                            initial={{ strokeDasharray: "0, 100" }}
                            animate={{ strokeDasharray: `${score}, 100` }}
                            transition={{ duration: 1, delay: 0.5 }}
                            className={`ring-fill ${opportunityInfo.color}`}
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                    </svg>
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
