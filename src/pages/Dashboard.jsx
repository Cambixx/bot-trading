import CryptoSelector from '../components/CryptoSelector';
import CryptoCard from '../components/CryptoCard';
import SignalCard from '../components/SignalCard';
import MLSignalSection from '../components/MLSignalSection';
import SkeletonLoader, { SkeletonSignalCard } from '../components/SkeletonLoader';

function Dashboard({
    symbols,
    handleSymbolsChange,
    cryptoData,
    signals,
    mlSignals,
    loading,
    handleSimulateBuy,
    // Temporary prop for testing, if we can pass it from App.jsx or expose handles
    onTestSignal
}) {
    // Temporary test handler if not passed (though sendToTelegram is in App.jsx)
    // Actually, sendToTelegram is internal to App.jsx. 
    // We cannot easily call it from here without passing it down.
    // Let's modify App.jsx to pass a test function, OR purely for user request, 
    // we can add a small useEffect in App.jsx that listens to a window event?
    // Or simpler: Just tell the user I've added a test button in the UI?
    // Wait, I can't modify App.jsx AND Dashboard.jsx to pass a new prop easily without restarting dev server or risk.
    // Better: Add a "Simulate ML Signal" button in Dashboard that calls a passed prop `handleTestSignal`.
    // I need to update App.jsx first to pass this prop.

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

            <MLSignalSection signals={mlSignals} loading={loading} />

            {/* Temporary Test Button */}
            {onTestSignal && (
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <button
                        onClick={onTestSignal}
                        style={{
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            color: '#fff',
                            padding: '0.5rem 1rem',
                            borderRadius: '8px',
                            cursor: 'pointer'
                        }}
                    >
                        🔔 Test Telegram Alert
                    </button>
                </div>
            )}

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
