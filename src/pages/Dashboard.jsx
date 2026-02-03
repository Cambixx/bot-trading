import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp } from 'lucide-react';
import CryptoSelector from '../components/CryptoSelector';
import CryptoCard from '../components/CryptoCard';
import AlgoAnalytics from '../components/AlgoAnalytics';
import SkeletonLoader from '../components/SkeletonLoader';

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
            {/* 1. Algorithm Analytics (Principal) */}
            <motion.div variants={itemVariants} className="mb-6">
                <AlgoAnalytics />
            </motion.div>

            {/* 2. Crypto Selector */}
            <motion.div variants={itemVariants}>
                <CryptoSelector
                    selectedSymbols={symbols}
                    onSymbolsChange={handleSymbolsChange}
                />
            </motion.div>

            {/* 3. Crypto Prices Dashboard (Mercado) */}
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
