import CryptoChart from '../components/CryptoChart';

function ChartPage({ symbols, selectedChartSymbol, setSelectedChartSymbol }) {
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
                    {selectedChartSymbol && <CryptoChart symbol={selectedChartSymbol} />}
                </div>
            </section>
        </div>
    );
}

export default ChartPage;
