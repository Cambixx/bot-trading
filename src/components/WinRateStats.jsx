import { Trophy, TrendingUp, Clock, CheckCircle, XCircle } from 'lucide-react';
import './WinRateStats.css';

function WinRateStats({ stats, recentSignals }) {
    const { total, wins, losses, winRate, pending, recentTotal, recentWinRate } = stats;

    return (
        <div className="win-rate-container glass-card fade-in">
            <div className="stats-header">
                <h3><Trophy size={20} style={{ display: 'inline', marginRight: '8px' }} />Historial de Aciertos</h3>
            </div>

            {/* Main Stats */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon success">
                        <TrendingUp size={24} />
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Tasa Global</span>
                        <span className={`stat-value ${winRate >= 50 ? 'text-success' : 'text-warning'}`}>
                            {winRate.toFixed(1)}%
                        </span>
                        <span className="stat-sub">{wins}W / {losses}L de {total}</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon info">
                        <Clock size={24} />
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Últimas 24h</span>
                        <span className={`stat-value ${recentWinRate >= 50 ? 'text-success' : 'text-warning'}`}>
                            {recentTotal > 0 ? `${recentWinRate.toFixed(1)}%` : 'N/A'}
                        </span>
                        <span className="stat-sub">{recentTotal} verificadas</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon pending">
                        <Clock size={24} />
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Pendientes</span>
                        <span className="stat-value text-muted">{pending}</span>
                        <span className="stat-sub">En seguimiento</span>
                    </div>
                </div>
            </div>

            {/* Recent Verified Signals */}
            {recentSignals && recentSignals.length > 0 && (
                <div className="recent-signals">
                    <h4>Señales Verificadas Recientes</h4>
                    <div className="signals-list">
                        {recentSignals.slice(0, 5).map(signal => (
                            <div key={signal.id} className="signal-item">
                                <div className="signal-symbol-status">
                                    {signal.status === 'WIN' ? (
                                        <CheckCircle size={18} className="text-success" />
                                    ) : (
                                        <XCircle size={18} className="text-danger" />
                                    )}
                                    <span className="signal-symbol">{signal.symbol}</span>
                                </div>
                                <div className="signal-result">
                                    <span className={signal.status === 'WIN' ? 'text-success' : 'text-danger'}>
                                        {signal.status === 'WIN' ? '✓ TP1' : '✗ SL'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {total === 0 && (
                <div className="empty-state">
                    <p>Aún no hay señales verificadas. Las señales se verifican automáticamente después de 24 horas.</p>
                </div>
            )}
        </div>
    );
}

export default WinRateStats;
