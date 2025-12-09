import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
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

    // Usar el score de oportunidad calculado por signalGenerator (viene de App.jsx)
    // Este es el mismo algoritmo que se usa para las señales
    const score = opportunity || 0;

    // Determinar nivel de oportunidad
    const getOpportunityLevel = () => {
        if (score >= 70) return { level: 'HIGH', label: 'Alta Oportunidad', color: 'success' };
        if (score >= 50) return { level: 'MEDIUM', label: 'Oportunidad Media', color: 'warning' };
        return { level: 'LOW', label: 'Baja Oportunidad', color: 'info' };
    };

    const opportunityInfo = getOpportunityLevel();

    return (
        <div className={`crypto-card glass-card fade-in ${opportunityInfo.level.toLowerCase()}-signal`}>
            {/* Header */}
            <div className="crypto-header">
                <div className="crypto-symbol">
                    <Activity className="crypto-icon" />
                    <span className="crypto-name">{symbol.replace('USDC', '')}</span>
                </div>
                <div className={`crypto-change ${isPositive ? 'positive' : 'negative'}`}>
                    {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    <span>{isPositive ? '+' : ''}{priceChangePercent?.toFixed(2)}%</span>
                </div>
            </div>

            {/* Price & Score - Simplified */}
            <div className="crypto-main">
                <div className="crypto-price-container">
                    <span className="price-value">${formatPrice(price)}</span>
                </div>
                <div className="crypto-score">
                    <div
                        className="score-circle"
                        style={{
                            '--score': score,
                            borderColor: score >= 70 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--info)'
                        }}
                    >
                        <span className="score-value">{score}</span>
                    </div>
                </div>
            </div>

            {/* Footer / Badge */}
            <div className="crypto-footer">
                <span className={`badge badge-${opportunityInfo.color}`}>
                    {opportunityInfo.label}
                </span>
            </div>
        </div>
    );
}

export default CryptoCard;
