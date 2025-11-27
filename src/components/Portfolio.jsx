import { TrendingUp, TrendingDown, XCircle, RefreshCw, History } from 'lucide-react';
import './Portfolio.css';

function Portfolio({ portfolio, currentPrices, onClosePosition, onReset }) {
    const { balance, positions, history } = portfolio;

    // Calculate totals
    let totalInvested = 0;
    let currentEquity = 0;
    let totalPnL = 0;

    positions.forEach(pos => {
        const currentPrice = currentPrices[pos.symbol]?.price || pos.entryPrice;
        const currentValue = pos.quantity * currentPrice;
        const pnl = currentValue - pos.amount;

        totalInvested += pos.amount;
        currentEquity += currentValue;
        totalPnL += pnl;
    });

    const totalValue = balance + currentEquity;
    const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

    return (
        <div className="portfolio-container fade-in">
            {/* Summary Card */}
            <div className="portfolio-summary glass-card">
                <div className="summary-header">
                    <h3>💼 Cartera Simulada</h3>
                    <button onClick={onReset} className="btn-icon" title="Reiniciar Cartera">
                        <RefreshCw size={16} />
                    </button>
                </div>

                <div className="summary-grid">
                    <div className="summary-item">
                        <span className="label">Balance Disponible</span>
                        <span className="value">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="summary-item">
                        <span className="label">Valor Total</span>
                        <span className="value">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="summary-item">
                        <span className="label">PnL No Realizado</span>
                        <span className={`value ${totalPnL >= 0 ? 'text-success' : 'text-danger'}`}>
                            {totalPnL >= 0 ? '+' : ''}{totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({totalPnLPercent.toFixed(2)}%)
                        </span>
                    </div>
                </div>
            </div>

            {/* Open Positions */}
            <div className="positions-section">
                <h4>Posiciones Abiertas ({positions.length})</h4>
                {positions.length === 0 ? (
                    <div className="empty-state">
                        <p>No tienes posiciones abiertas. Usa las señales para simular compras.</p>
                    </div>
                ) : (
                    <div className="positions-grid">
                        {positions.map(pos => {
                            const currentPrice = currentPrices[pos.symbol]?.price || pos.entryPrice;
                            const currentValue = pos.quantity * currentPrice;
                            const pnl = currentValue - pos.amount;
                            const pnlPercent = (pnl / pos.amount) * 100;

                            return (
                                <div key={pos.id} className="position-card glass-card">
                                    <div className="position-header">
                                        <span className="position-symbol">{pos.symbol}</span>
                                        <span className={`badge ${pnl >= 0 ? 'badge-success' : 'badge-danger'}`}>
                                            {pnlPercent.toFixed(2)}%
                                        </span>
                                    </div>
                                    <div className="position-details">
                                        <div className="detail-row">
                                            <span>Entrada:</span>
                                            <span>${pos.entryPrice.toLocaleString()}</span>
                                        </div>
                                        <div className="detail-row">
                                            <span>Actual:</span>
                                            <span>${currentPrice.toLocaleString()}</span>
                                        </div>
                                        <div className="detail-row">
                                            <span>Valor:</span>
                                            <span>${currentValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                        </div>
                                        <div className="detail-row">
                                            <span>PnL:</span>
                                            <span className={pnl >= 0 ? 'text-success' : 'text-danger'}>
                                                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => onClosePosition(pos.id, currentPrice)}
                                        className="btn-close-position"
                                    >
                                        Cerrar Posición
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* History (Collapsible or simple list) */}
            {history.length > 0 && (
                <div className="history-section mt-lg">
                    <h4><History size={16} style={{ display: 'inline', marginRight: '5px' }} /> Historial Reciente</h4>
                    <div className="history-list glass-card">
                        {history.slice(0, 5).map(trade => (
                            <div key={trade.id} className="history-item">
                                <span className="history-symbol">{trade.symbol}</span>
                                <span className={`history-pnl ${trade.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                    {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)} ({trade.pnlPercent.toFixed(2)}%)
                                </span>
                                <span className="history-date">
                                    {new Date(trade.closeTimestamp).toLocaleDateString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default Portfolio;
