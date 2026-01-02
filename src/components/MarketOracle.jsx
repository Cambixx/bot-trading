import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, TrendingUp, TrendingDown, Activity, AlertTriangle, CloudRain, Sun, Zap, RefreshCw } from 'lucide-react';
import './MarketOracle.css';

import { getMarketOracleAnalysis } from '../services/aiAnalysis';
import binanceService from '../services/binanceService';

const MarketOracle = ({ onDataUpdate }) => {
    const [analysis, setAnalysis] = useState(null);
    const [loading, setLoading] = useState(false);
    const [lastSync, setLastSync] = useState(null);

    // Initial load from local storage
    useEffect(() => {
        const cached = localStorage.getItem('oracle_cache_v3');
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                setAnalysis(parsed);
                const ts = localStorage.getItem('oracle_ts_v3');
                if (ts) setLastSync(new Date(parseInt(ts)));
                if (onDataUpdate) onDataUpdate(parsed);
            } catch (e) { console.error(e); }
        }
    }, [onDataUpdate]);

    const handleRefresh = async () => {
        setLoading(true);
        try {
            // 1. Get Market Breadth
            const marketBreadth = await binanceService.getMarketBreadth();
            if (!marketBreadth) throw new Error('Market data unavailable');

            // 2. AI Analysis
            const aiResult = await getMarketOracleAnalysis(marketBreadth);

            if (aiResult.success && aiResult.analysis) {
                const enriched = {
                    ...aiResult.analysis,
                    stats: {
                        btcDominance: marketBreadth.btcDominance,
                        totalVolume: marketBreadth.totalVolumeUSD
                    }
                };
                setAnalysis(enriched);
                setLastSync(new Date());
                localStorage.setItem('oracle_cache_v3', JSON.stringify(enriched));
                localStorage.setItem('oracle_ts_v3', Date.now().toString());

                if (onDataUpdate) onDataUpdate(enriched);
            }
        } catch (error) {
            console.error('Oracle Error:', error);
        } finally {
            setLoading(false);
        }
    };

    const getStateConfig = (state) => {
        switch (state) {
            case 'RISK_ON': return { icon: <RocketIcon />, color: '#00ff9d', bg: 'rgba(0, 255, 157, 0.1)', label: 'RISK ON' };
            case 'RISK_OFF': return { icon: <ShieldIcon />, color: '#ff4d4d', bg: 'rgba(255, 77, 77, 0.1)', label: 'RISK OFF' };
            case 'BTC_LED': return { icon: <TrendingUp size={20} />, color: '#f7931a', bg: 'rgba(247, 147, 26, 0.1)', label: 'BTC LED' };
            case 'ALT_SEASON': return { icon: <Zap size={20} />, color: '#bd00ff', bg: 'rgba(189, 0, 255, 0.1)', label: 'ALT SEASON' };
            default: return { icon: <CloudRain size={20} />, color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.1)', label: 'CHOPPY' };
        }
    };

    if (!analysis && !loading) {
        return (
            <div className="market-oracle glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem', justifyContent: 'center' }}>
                <div style={{ marginBottom: '1rem', color: 'var(--color-primary)' }}>
                    <Brain size={32} />
                </div>
                <h3 style={{ margin: '0 0 1rem 0' }}>THE MARKET ORACLE</h3>
                <p style={{ textAlign: 'center', opacity: 0.7, maxWidth: '300px', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                    analyze global market regime, sentiment, and capital flow using statistical data.
                </p>
                <button
                    onClick={handleRefresh}
                    className="oracle-refresh-btn"
                    style={{ width: 'auto', padding: '10px 24px', borderRadius: '8px', background: 'rgba(255,255,255,0.1)' }}
                >
                    INITIALIZE ORACLE
                </button>
            </div>
        );
    }

    if (loading && !analysis) {
        return (
            <div className="market-oracle glass-card loading-state">
                <div className="oracle-header shimmer-line" style={{ width: '40%' }}></div>
                <div className="oracle-body">
                    <div className="shimmer-box" style={{ height: '60px' }}></div>
                </div>
            </div>
        );
    }

    const { marketState, headline, summary, strategy, sentimentScore } = analysis;
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
                        onClick={handleRefresh}
                        disabled={loading}
                        title="Refresh Analysis"
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
                        <span className="strategy-label">STRATEGY</span>
                        <span className="strategy-value">{strategy}</span>
                    </div>
                </div>

                {/* Middle: Narrative */}
                <div className="oracle-narrative-col">
                    <h2 className="oracle-headline">"{headline}"</h2>

                    {analysis.keyDriver && (
                        <div className="key-driver-box" style={{ marginBottom: '1rem', padding: '0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', borderLeft: '3px solid var(--color-accent)' }}>
                            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', opacity: 0.7, display: 'block' }}>Key Driver</span>
                            <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>{analysis.keyDriver}</span>
                        </div>
                    )}

                    <p className="oracle-summary">{summary}</p>

                    {analysis.coinsToWatch && analysis.coinsToWatch.length > 0 && (
                        <div className="watch-pills">
                            <span className="watch-label">WATCH:</span>
                            {analysis.coinsToWatch.map((coin, i) => (
                                <span key={i} className="watch-pill">{coin}</span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right: Detailed Stats */}
                <div className="oracle-stats-col">
                    {analysis.stats && (
                        <div className="stats-grid">
                            <div className="stat-item">
                                <span className="stat-label">BTC DOM</span>
                                <span className="stat-val">{analysis.stats.btcDominance}%</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">VOL 24H</span>
                                <span className="stat-val">{analysis.stats.totalVolume}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">TF</span>
                                <span className="stat-val">{analysis.suggestedTimeframe || '1H'}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">VOLATILITY</span>
                                <span className={`stat-val ${analysis.volatility?.toLowerCase()}`}>{analysis.volatility || 'N/A'}</span>
                            </div>
                        </div>
                    )}
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
