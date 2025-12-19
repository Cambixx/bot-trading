import { motion } from 'framer-motion';
import { LayoutDashboard, TrendingUp, Zap } from 'lucide-react';
import CryptoSelector from '../components/CryptoSelector';
import CryptoCard from '../components/CryptoCard';
import SignalCard from '../components/SignalCard';
import MLSignalSection from '../components/MLSignalSection';
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
    return (
        <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="dashboard-page"
        >
            {/* Crypto Selector */}
            <motion.div variants={itemVariants}>
                <CryptoSelector
                    selectedSymbols={symbols}
                    onSymbolsChange={handleSymbolsChange}
                />
            </motion.div>

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
        </motion.div>
    );
}

export default Dashboard;
