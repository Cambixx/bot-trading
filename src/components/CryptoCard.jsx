import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import './CryptoCard.css';

function CryptoCard({ crypto }) {
    const { symbol, price, priceChangePercent, volume24h, indicators } = crypto;
    const isPositive = priceChangePercent >= 0;

    // Formatear precio dinámicamente según el valor
    const formatPrice = (price) => {
        if (!price) return '0.00';

        if (price >= 1) {
            // Precios normales: 2 decimales
            return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else if (price >= 0.01) {
            // Precios pequeños: 4 decimales
            return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
        } else if (price >= 0.0001) {
            // Precios muy pequeños: 6 decimales
            return price.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
        } else {
            // Precios extremadamente pequeños: 8 decimales
            return price.toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 });
        }
    };

    // Calcular oportunidad de trading basado en indicadores
    const calculateOpportunity = () => {
        if (!indicators || !indicators.rsi) return 'neutral';

        let score = 0;

        // RSI en zona de sobreventa = buena oportunidad
        if (indicators.rsi < 30) {
            score += 3; // Muy buena oportunidad
        } else if (indicators.rsi < 40) {
            score += 2; // Buena oportunidad
        } else if (indicators.rsi > 70) {
            score -= 2; // Sobrecompra - evitar
        } else if (indicators.rsi > 60) {
            score -= 1;
        }

        // Precio vs EMAs (si están disponibles)
        if (indicators.ema20 && indicators.ema50) {
            // Precio por debajo de EMAs = oportunidad de compra
            if (price < indicators.ema20 && price < indicators.ema50) {
                score += 2;
            } else if (indicators.ema20 > indicators.ema50) {
                // Tendencia alcista
                score += 1;
            }
        }

        // MACD positivo
        if (indicators.macd && indicators.macd.histogram > 0) {
            score += 1;
        }

        // Clasificar oportunidad
        if (score >= 4) return 'high'; // Oportunidad alta
        if (score >= 2) return 'medium'; // Oportunidad media
        if (score <= -2) return 'low'; // Evitar
        return 'neutral';
    };

    const opportunity = calculateOpportunity();

    return (
        <div className={`crypto-card glass-card opportunity-${opportunity}`}>
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

            <div className="crypto-price">
                ${formatPrice(price)}
            </div>

            <div className="crypto-volume">
                <span className="volume-label">Volumen 24h:</span>
                <span className="volume-value">
                    ${(volume24h / 1000000).toFixed(2)}M
                </span>
            </div>

            {indicators && (
                <div className="crypto-indicators">
                    {indicators.rsi !== null && indicators.rsi !== undefined && (
                        <div className="mini-indicator">
                            <span className="mini-label">RSI</span>
                            <div className="rsi-bar">
                                <div
                                    className={`rsi-fill ${indicators.rsi > 70 ? 'overbought' :
                                            indicators.rsi < 30 ? 'oversold' : 'neutral'
                                        }`}
                                    style={{ width: `${Math.min(indicators.rsi, 100)}%` }}
                                />
                            </div>
                            <span className="mini-value">{indicators.rsi.toFixed(0)}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Indicador de oportunidad */}
            {opportunity !== 'neutral' && (
                <div className={`opportunity-badge opportunity-badge-${opportunity}`}>
                    {opportunity === 'high' && '🔥 Alta Oportunidad'}
                    {opportunity === 'medium' && '✨ Oportunidad'}
                    {opportunity === 'low' && '⚠️ Evitar'}
                </div>
            )}
        </div>
    );
}

export default CryptoCard;
