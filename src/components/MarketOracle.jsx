import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, TrendingUp, TrendingDown, Activity, AlertTriangle, CloudRain, Sun, Zap, RefreshCw } from 'lucide-react';
import './MarketOracle.css';

const MarketOracle = ({ analysis, loading, onRefresh }) => {
    // Definir configuración visual según el estado del mercado
    const getStateConfig = (state) => {
        switch (state) {
            case 'RISK_ON':
                return {
                    icon: <RocketIcon />,
                    color: '#00ff9d',
                    bg: 'rgba(0, 255, 157, 0.1)',
                    label: 'RISK ON'
                };
            case 'RISK_OFF':
                return {
                    icon: <ShieldIcon />,
                    color: '#ff4d4d',
                    bg: 'rgba(255, 77, 77, 0.1)',
                    label: 'RISK OFF'
                };
            case 'ALT_SEASON':
                return {
                    icon: <Zap size={20} />,
                    color: '#bd00ff',
                    bg: 'rgba(189, 0, 255, 0.1)',
                    label: 'ALT SEASON'
                };
            case 'CHOPPY':
            default:
                return {
                    icon: <CloudRain size={20} />,
                    color: '#fbbf24',
                    bg: 'rgba(251, 191, 36, 0.1)',
                    label: 'CHOPPY'
                };
        }
    };

    // Placeholder mientras carga
    if (loading) {
        return (
            <div className="market-oracle glass-card loading-state">
                <div className="oracle-header shimmer-line" style={{ width: '40%' }}></div>
                <div className="oracle-body">
                    <div className="shimmer-box" style={{ height: '60px' }}></div>
                </div>
            </div>
        );
    }

    const safeAnalysis = analysis || {
        marketState: 'CHOPPY',
        headline: 'Oracle Offline',
        summary: 'Waiting for market data connection...',
        strategy: 'WAIT',
        sentimentScore: 50
    };

    const { marketState, headline, summary, strategy, sentimentScore } = safeAnalysis;
    const config = getStateConfig(marketState || 'CHOPPY');

    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="market-oracle glass-card"
        >
            {/* Header: Identity */}
            <div className="oracle-top-bar">
                <div className="oracle-identity">
                    <div className="brain-icon-box">
                        <Brain size={18} className="text-gradient" />
                    </div>
                    <span className="oracle-name">THE MARKET ORACLE</span>
                    <button
                        className={`oracle-refresh-btn ${loading ? 'loading' : ''}`}
                        onClick={onRefresh}
                        disabled={loading}
                        title="Actualizar análisis (consume créditos)"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>

                <div className="sentiment-meter">
                    <span className="sentiment-label">Sentiment:</span>
                    <div className="meter-track">
                        <motion.div
                            className="meter-fill"
                            initial={{ width: 0 }}
                            animate={{ width: `${sentimentScore}%` }}
                            style={{
                                backgroundColor: sentimentScore > 60 ? '#00ff9d' : sentimentScore < 40 ? '#ff4d4d' : '#fbbf24'
                            }}
                        />
                    </div>
                    <span className="sentiment-value">{sentimentScore}/100</span>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="oracle-content">

                {/* Left: State & Strategy */}
                <div className="oracle-status-col">
                    <div className="status-badge" style={{ borderColor: config.color, background: config.bg }}>
                        <span style={{ color: config.color }}>{config.icon}</span>
                        <span className="status-text" style={{ color: config.color }}>{config.label}</span>
                    </div>

                    <div className="strategy-box">
                        <span className="strategy-label">TODAY'S STRATEGY</span>
                        <span className="strategy-value">{strategy}</span>
                    </div>
                </div>

                {/* Right: Narrative */}
                <div className="oracle-narrative-col">
                    <h2 className="oracle-headline">"{headline}"</h2>
                    <p className="oracle-summary">{summary}</p>
                </div>

            </div>
        </motion.div>
    );
};

// Simple Icons
const RocketIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
    </svg>
);

const ShieldIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
    </svg>
);

export default MarketOracle;
