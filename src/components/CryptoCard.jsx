import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import './CryptoCard.css';

function CryptoCard({ crypto }) {
    const { symbol, price, priceChangePercent, volume24h, indicators } = crypto;
    const isPositive = priceChangePercent >= 0;

    return (
        <div className="crypto-card glass-card">
            <div className="crypto-header">
                <div className="crypto-symbol">
                    <Activity className="crypto-icon" />
                    <span className="crypto-name">{symbol.replace('USDT', '')}</span>
                </div>
                <div className={`crypto-change ${isPositive ? 'positive' : 'negative'}`}>
                    {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    <span>{Math.abs(priceChangePercent).toFixed(2)}%</span>
                </div>
            </div>

            <div className="crypto-price">
                ${price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
        </div>
    );
}

export default CryptoCard;
