import { useState } from 'react';
import { Play, RotateCcw, TrendingUp, TrendingDown, Activity, AlertCircle } from 'lucide-react';
import { runBacktest } from '../services/backtestService';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import './BacktestDashboard.css';

function BacktestDashboard({ symbols }) {
    const [config, setConfig] = useState({
        symbol: symbols[0] || 'BTCUSDC',
        interval: '1h',
        initialCapital: 10000,
        mode: 'BALANCED'
    });
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleRunBacktest = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await runBacktest(config.symbol, config.interval, {
                initialCapital: Number(config.initialCapital),
                mode: config.mode
            });
            setResults(data);
        } catch (err) {
            console.error(err);
            setError(err.message || 'Error running backtest');
        } finally {
            setLoading(false);
        }
    };

    const formatMoney = (val) => `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return (
        <div className="backtest-dashboard fade-in">
            <div className="backtest-header">
                <h2>🧪 Backtesting Engine</h2>
                <p className="text-muted">Simula tu estrategia con datos históricos</p>
            </div>

            {/* Methodology Info */}
            <div className="glass-card mb-lg" style={{ padding: 'var(--spacing-md)', fontSize: '0.9rem', borderLeft: '4px solid var(--color-info)' }}>
                <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center', marginBottom: 'var(--spacing-xs)' }}>
                    <AlertCircle size={16} className="text-info" />
                    <span className="font-bold text-info">¿Cómo funciona esta simulación?</span>
                </div>
                <p className="text-muted" style={{ lineHeight: '1.6', margin: 0 }}>
                    Este motor <strong>reproduce el mercado vela a vela</strong> utilizando datos históricos. En cada paso:
                    <br />
                    1. Re-calcula todos los indicadores técnicos y de ML sobre los datos disponibles hasta ese momento.
                    <br />
                    2. Ejecuta el mismo algoritmo de <strong>{config.mode}</strong> que usas en vivo.
                    <br />
                    3. Abre una operación si la estrategia genera una señal con <strong>Score ≥ 60</strong>.
                </p>
            </div>

            {/* Configuration Panel */}
            <div className="glass-card config-panel mb-lg">
                <div className="form-group">
                    <label>Símbolo</label>
                    <div className="select-wrapper">
                        <select
                            value={config.symbol}
                            onChange={(e) => setConfig({ ...config, symbol: e.target.value })}
                        >
                            {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                </div>
                <div className="form-group">
                    <label>Timeframe</label>
                    <div className="select-wrapper">
                        <select
                            value={config.interval}
                            onChange={(e) => setConfig({ ...config, interval: e.target.value })}
                        >
                            <option value="15m">15 Minutos</option>
                            <option value="1h">1 Hora</option>
                            <option value="4h">4 Horas</option>
                            <option value="1d">1 Día</option>
                        </select>
                    </div>
                </div>
                <div className="form-group">
                    <label>Capital Inicial ($)</label>
                    <input
                        type="number"
                        value={config.initialCapital}
                        onChange={(e) => setConfig({ ...config, initialCapital: e.target.value })}
                    />
                </div>
                <div className="form-group">
                    <label>Modo Estrategia</label>
                    <div className="select-wrapper">
                        <select
                            value={config.mode}
                            onChange={(e) => setConfig({ ...config, mode: e.target.value })}
                        >
                            <option value="CONSERVATIVE">🛡️ Conservador</option>
                            <option value="BALANCED">⚖️ Equilibrado</option>
                            <option value="RISKY">🚀 Arriesgado</option>
                            <option value="SCALPING">⚡ Scalping</option>
                        </select>
                    </div>
                </div>
                <button
                    className="btn-primary"
                    onClick={handleRunBacktest}
                    disabled={loading}
                    style={{ height: '42px', marginTop: 'auto' }}
                >
                    {loading ? <Activity className="spin" size={18} /> : <Play size={18} />}
                    {loading ? 'Simulando...' : 'Ejecutar Backtest'}
                </button>
            </div>

            {
                error && (
                    <div className="error-banner mb-lg">
                        <AlertCircle size={20} />
                        <span>{error}</span>
                    </div>
                )
            }

            {/* Results */}
            {
                results && (
                    <div className="results-container fade-in">
                        {/* Stats Grid */}
                        <div className="stats-grid mb-xl">
                            <div className="stat-card glass-card">
                                <span className="stat-label">Net Profit</span>
                                <span className={`stat-value ${results.stats.netProfit >= 0 ? 'text-success' : 'text-danger'}`}>
                                    {results.stats.netProfit >= 0 ? '+' : ''}{formatMoney(results.stats.netProfit)}
                                    <small>({results.stats.netProfitPercent}%)</small>
                                </span>
                            </div>
                            <div className="stat-card glass-card">
                                <span className="stat-label">Win Rate</span>
                                <span className="stat-value">{results.stats.winRate}%</span>
                            </div>
                            <div className="stat-card glass-card">
                                <span className="stat-label">Total Trades</span>
                                <span className="stat-value">{results.stats.totalTrades}</span>
                            </div>
                            <div className="stat-card glass-card" style={{ borderLeft: '3px solid #ffd700' }}>
                                <span className="stat-label">SMC Win Rate</span>
                                <span className="stat-value text-info">
                                    {results.stats.smcWinRate}%
                                    <small>({results.stats.smcTradesCount} trades)</small>
                                </span>
                            </div>
                            <div className="stat-card glass-card">
                                <span className="stat-label">Max Drawdown</span>
                                <span className="stat-value text-danger">-{results.stats.maxDrawdown}%</span>
                            </div>
                        </div>

                        {/* Equity Curve */}
                        <div className="chart-container glass-card mb-xl" style={{ height: '300px', padding: '1rem' }}>
                            <h3>Curva de Equidad</h3>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={results.equityCurve}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                    <XAxis
                                        dataKey="time"
                                        tickFormatter={(time) => format(new Date(time), 'dd/MM')}
                                        stroke="rgba(255,255,255,0.5)"
                                    />
                                    <YAxis
                                        domain={['auto', 'auto']}
                                        stroke="rgba(255,255,255,0.5)"
                                        tickFormatter={(val) => `$${val}`}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1e222d', border: 'none' }}
                                        labelFormatter={(label) => format(new Date(label), 'dd MMM HH:mm')}
                                        formatter={(value) => [formatMoney(value), 'Equidad']}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="value"
                                        stroke="#26a69a"
                                        strokeWidth={2}
                                        dot={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Trade List */}
                        <div className="trades-list glass-card">
                            <h3>Historial de Operaciones</h3>
                            <div className="table-responsive">
                                <table className="trades-table">
                                    <thead>
                                        <tr>
                                            <th>Tipo</th>
                                            <th>Entrada</th>
                                            <th>Salida</th>
                                            <th>PnL</th>
                                            <th>Razón</th>
                                            <th>Fecha</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.trades.map(trade => (
                                            <tr key={trade.id}>
                                                <td>
                                                    <span className={`badge badge-${trade.type === 'BUY' ? 'success' : 'danger'}`}>
                                                        {trade.type}
                                                    </span>
                                                </td>
                                                <td>${trade.entryPrice.toFixed(2)}</td>
                                                <td>${trade.exitPrice.toFixed(2)}</td>
                                                <td className={trade.pnl >= 0 ? 'text-success' : 'text-danger'}>
                                                    {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                                                </td>
                                                <td>{trade.reason}</td>
                                                <td>{format(new Date(trade.entryTime), 'dd/MM HH:mm')}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}

export default BacktestDashboard;
