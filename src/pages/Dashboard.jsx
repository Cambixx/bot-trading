import CryptoSelector from '../components/CryptoSelector';
import CryptoChart from '../components/CryptoChart';
import CryptoCard from '../components/CryptoCard';
import SignalCard from '../components/SignalCard';
import SkeletonLoader, { SkeletonSignalCard } from '../components/SkeletonLoader';

function Dashboard({
    symbols,
    selectedChartSymbol,
    setSelectedChartSymbol,
    handleSymbolsChange,
    cryptoData,
    signals,
    loading,
    handleSimulateBuy
}) {
    return (
        <div className="dashboard-page fade-in">
            {/* Crypto Selector */}
            <CryptoSelector
                selectedSymbols={symbols}
                onSymbolsChange={handleSymbolsChange}
            />

            {/* Top Chart Section */}
            {selectedChartSymbol && (
                <section className="chart-section mb-xl">
                    <div className="chart-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 style={{ margin: 0 }}>Gráfico en vivo</h2>
                        <select
                            value={selectedChartSymbol}
                            onChange={(e) => setSelectedChartSymbol(e.target.value)}
                            style={{
                                padding: '0.5rem',
                                borderRadius: '8px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                color: 'var(--text-primary)',
                                outline: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            {symbols.map(s => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>
                    <div className="glass-card" style={{ padding: '1rem' }}>
                        <CryptoChart symbol={selectedChartSymbol} />
                    </div>
                </section>
            )}

            {/* Crypto Prices Dashboard */}
            <section className="dashboard-section">
                <h2 className="mb-lg">Mercado</h2>
                <div className="dashboard-grid">
                    {loading ? (
                        <SkeletonLoader type="crypto" count={symbols.length || 4} />
                    ) : (
                        Object.values(cryptoData)
                            .sort((a, b) => (b.opportunity || 0) - (a.opportunity || 0))
                            .map(crypto => (
                                <CryptoCard key={crypto.symbol} crypto={crypto} />
                            ))
                    )}
                </div>
            </section>

            {/* Trading Signals */}
            <section className="signals-section">
                <div className="signals-header">
                    <h2 className="signals-title">
                        Señales de Trading
                        {!loading && signals.length > 0 && (
                            <span className="signal-count">{signals.length}</span>
                        )}
                    </h2>
                </div>

                {loading ? (
                    <div className="signals-grid">
                        {[1, 2, 3].map(i => (
                            <div key={i}>
                                <SkeletonSignalCard />
                            </div>
                        ))}
                    </div>
                ) : signals.length === 0 ? (
                    <div className="no-signals glass-card">
                        <div className="no-signals-icon">📊</div>
                        <h3>No hay señales activas</h3>
                        <p className="text-muted">
                            El sistema está monitoreando el mercado y generará señales cuando se detecten oportunidades de compra.
                        </p>
                    </div>
                ) : (
                    <div className="signals-grid">
                        {signals.map((signal, idx) => (
                            <SignalCard
                                key={`${signal.symbol}-${idx}`}
                                signal={signal}
                                onSimulateBuy={handleSimulateBuy}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

export default Dashboard;
