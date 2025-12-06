import CryptoSelector from '../components/CryptoSelector';
import CryptoCard from '../components/CryptoCard';
import SignalCard from '../components/SignalCard';
import SkeletonLoader, { SkeletonSignalCard } from '../components/SkeletonLoader';

function Dashboard({
    symbols,
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

            {/* Top Chart Section Removed - Moved to /chart */}

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
