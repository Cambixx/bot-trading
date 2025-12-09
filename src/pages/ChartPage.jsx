import CryptoChart from '../components/CryptoChart';

function ChartPage({ symbols, selectedChartSymbol, setSelectedChartSymbol, signals }) {
    // Use first symbol as fallback if none selected
    const currentSymbol = selectedChartSymbol || symbols[0];

    // Find signal for current symbol if exists
    const currentSignal = signals?.find(s => s.symbol === currentSymbol) || null;

    if (symbols.length === 0) {
        return (
            <div className="chart-page fade-in">
                <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
                    <p className="text-muted">No hay símbolos monitoreados. Agrega símbolos en el Dashboard.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="chart-page fade-in">
            <section className="chart-section mb-xl">
                <div className="chart-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h2 style={{ margin: 0 }}>Gráfico en vivo</h2>
                    <select
                        value={currentSymbol}
                        onChange={(e) => setSelectedChartSymbol(e.target.value)}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '8px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            color: 'var(--text-primary)',
                            outline: 'none',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: '600'
                        }}
                    >
                        {symbols.map(s => (
                            <option key={s} value={s} style={{ background: '#1a1a2e' }}>
                                {s.replace('USDC', '')}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="glass-card" style={{ padding: '1rem' }}>
                    {currentSymbol && <CryptoChart symbol={currentSymbol} signal={currentSignal} />}
                </div>
            </section>
        </div>
    );
}

export default ChartPage;
