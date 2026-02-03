import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, Zap } from 'lucide-react';
import CryptoSelector from '../components/CryptoSelector';
import CryptoCard from '../components/CryptoCard';
import SignalCard from '../components/SignalCard';
import ExecutiveDashboard from '../components/ExecutiveDashboard';
import ToolsHub from '../components/ToolsHub';
import SkeletonLoader, { SkeletonSignalCard } from '../components/SkeletonLoader';

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1
        }
    }
};

const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
        y: 0,
        opacity: 1,
        transition: {
            type: "spring",
            damping: 25,
            stiffness: 200
        }
    }
};

function Dashboard({
    symbols,
    handleSymbolsChange,
    cryptoData,
    signals,
    mlSignals,
    loading,
    handleSimulateBuy
}) {
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showAllSignals, setShowAllSignals] = useState(false);

    // Lifted State for Executive Dashboard
    const [nexusData, setNexusData] = useState(null);
    const [oracleData, setOracleData] = useState(null);

    const sortedSignals = useMemo(() => {
        if (!signals || signals.length === 0) return [];
        return [...signals].sort((a, b) => b.score - a.score);
    }, [signals]);

    const topSignal = sortedSignals.length > 0 ? sortedSignals[0] : null;
    const visibleSignals = showAllSignals ? sortedSignals : sortedSignals.slice(0, 3);

    // Calculate Top Opportunity dynamically
    const topOpportunity = (() => {
        // Priority 1: Active Signals (High confidence)
        if (sortedSignals && sortedSignals.length > 0) {
            const bestSignal = sortedSignals[0];
            return {
                symbol: bestSignal.symbol,
                type: bestSignal.type || 'BUY',
                score: bestSignal.score,
                reason: 'Signal Algorithm'
            };
        }

        // Priority 2: Crypto Data with highest opportunity score
        if (cryptoData) {
            const allCoins = Object.values(cryptoData);
            if (allCoins.length > 0) {
                const bestCoin = allCoins.sort((a, b) => (b.opportunity || 0) - (a.opportunity || 0))[0];
                if (bestCoin && bestCoin.opportunity > 60) {
                    return {
                        symbol: bestCoin.symbol,
                        type: bestCoin.opportunityType || 'LONG',
                        score: bestCoin.opportunity,
                        reason: 'Technical Analysis'
                    };
                }
            }
        }
        return null; // No good opportunity found
    })();

    return (
        <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="dashboard-page"
        >
            {/* 0. Executive Command Center */}
            <motion.div variants={itemVariants}>
                <ExecutiveDashboard
                    nexusData={nexusData}
                    oracleData={oracleData}
                    topOpportunity={topOpportunity}
                    topSignal={topSignal}
                    btcVol={cryptoData['BTCUSDC'] || cryptoData['BTCUSDT']}
                    signalCount={signals?.length || 0}
                />
            </motion.div>

            {/* 1. Crypto Selector & Market (Top Priority) */}
            <motion.div variants={itemVariants}>
                <CryptoSelector
                    selectedSymbols={symbols}
                    onSymbolsChange={handleSymbolsChange}
                />
            </motion.div>

            {/* Trading Signals */}
            <motion.section variants={itemVariants} className="signals-section">
                <div className="signals-header">
                    <div className="section-header">
                        <Zap size={20} className="text-primary" />
                        <h2 className="signals-title">
                            Señales de Trading
                            {!loading && signals.length > 0 && (
                                <span className="signal-count">{signals.length}</span>
                            )}
                        </h2>
                    </div>
                    {!loading && sortedSignals.length > 3 && (
                        <button
                            className="btn-secondary"
                            onClick={() => setShowAllSignals(v => !v)}
                            style={{ padding: '0.55rem 0.8rem' }}
                        >
                            {showAllSignals ? 'Ver menos' : 'Ver todas'}
                        </button>
                    )}
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
                        {visibleSignals.map((signal, idx) => (
                            <SignalCard
                                key={`${signal.symbol}-${idx}`}
                                signal={signal}
                                onSimulateBuy={handleSimulateBuy}
                            />
                        ))}
                    </div>
                )}
            </motion.section>

            <motion.div variants={itemVariants}>
                <div className="glass-card" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1rem' }}>Herramientas avanzadas</h3>
                        <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            Macro, Nexus, Doctor, Hunter, Backtest y ML
                        </div>
                    </div>
                    <button
                        className="btn-primary"
                        onClick={() => setShowAdvanced(v => !v)}
                        style={{ padding: '0.6rem 0.9rem' }}
                    >
                        {showAdvanced ? 'Ocultar' : 'Mostrar'}
                    </button>
                </div>
            </motion.div>

            <AnimatePresence>
                {showAdvanced && (
                    <motion.div
                        key="advanced-section"
                        initial="hidden"
                        animate="visible"
                        exit="hidden"
                        variants={containerVariants}
                        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
                    >
                        <ToolsHub
                            symbols={symbols}
                            mlSignals={mlSignals}
                            loading={loading}
                            setOracleData={setOracleData}
                            setNexusData={setNexusData}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Crypto Prices Dashboard */}
            <motion.section variants={itemVariants} className="dashboard-section">
                <div className="section-header">
                    <TrendingUp size={20} className="text-primary" />
                    <h2>Mercado</h2>
                </div>
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
            </motion.section>
        </motion.div >
    );
}

export default Dashboard;
