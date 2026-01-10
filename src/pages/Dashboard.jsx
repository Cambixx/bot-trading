import { useState, useEffect } from 'react'; // Ensure React hooks are imported
import { motion } from 'framer-motion';
import { LayoutDashboard, TrendingUp, Zap } from 'lucide-react';
import CryptoSelector from '../components/CryptoSelector';
import CryptoCard from '../components/CryptoCard';
import SignalCard from '../components/SignalCard';
import MLSignalSection from '../components/MLSignalSection';
import MarketOracle from '../components/MarketOracle'; // Import Oracle
import NexusHub from '../components/NexusHub'; // Import Nexus
import TradeDoctor from '../components/TradeDoctor'; // Import Doctor
import PatternHunter from '../components/PatternHunter'; // Import Hunter
import ExecutiveDashboard from '../components/ExecutiveDashboard'; // Import Executive Dashboard
import BacktestDashboard from '../components/BacktestDashboard'; // Import Backtest Dashboard
import SkeletonLoader, { SkeletonSignalCard } from '../components/SkeletonLoader';

// Services
import binanceService from '../services/binanceService';

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
    // Lifted State for Executive Dashboard
    const [nexusData, setNexusData] = useState(null);
    const [oracleData, setOracleData] = useState(null);

    // Calculate Top Opportunity dynamically
    const topOpportunity = (() => {
        // Priority 1: Active Signals (High confidence)
        if (signals && signals.length > 0) {
            const bestSignal = [...signals].sort((a, b) => b.score - a.score)[0];
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

            {/* 2. Market Oracle (Macro Analysis) */}
            <motion.div variants={itemVariants}>
                <MarketOracle onDataUpdate={setOracleData} />
            </motion.div>

            {/* NEW: Nexus Intelligence Hub (Global Pulsar) */}
            <motion.div variants={itemVariants}>
                <NexusHub onDataUpdate={setNexusData} />
            </motion.div>

            {/* 3. AI Tools Section: Doctor + Hunter */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                <motion.div variants={itemVariants}>
                    <TradeDoctor defaultSymbol={symbols[0]} availableSymbols={symbols} />
                </motion.div>

                <motion.div variants={itemVariants}>
                    <PatternHunter defaultSymbol={symbols[0]} availableSymbols={symbols} />
                </motion.div>
            </div>

            {/* 4. Validation: Backtest Engine */}
            <motion.div variants={itemVariants}>
                <BacktestDashboard symbols={symbols} />
            </motion.div>

            {/* 5. Crypto Prices Dashboard */}
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

            <motion.div variants={itemVariants}>
                <MLSignalSection signals={mlSignals} loading={loading} />
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
            </motion.section>
        </motion.div >
    );
}

export default Dashboard;
