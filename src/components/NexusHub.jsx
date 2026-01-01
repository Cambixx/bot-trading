import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Wind, Waves, Newspaper, AlertTriangle, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { fetchNexusIntelligence } from '../services/nexusService';
import binanceService from '../services/binanceService';
import './NexusHub.css';

const NexusHub = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [lastSync, setLastSync] = useState(null);

    // Load persisted data on mount
    useEffect(() => {
        const savedData = localStorage.getItem('nexus_intelligence_data');
        const savedTime = localStorage.getItem('nexus_intelligence_time');

        if (savedData) {
            try {
                setData(JSON.parse(savedData));
                if (savedTime) setLastSync(new Date(savedTime));
            } catch (e) {
                console.error("Error parsing saved nexus data", e);
            }
        }
    }, []);

    const loadIntelligence = async () => {
        setLoading(true);
        try {
            // First get context from market breadth
            const breadth = await binanceService.getMarketBreadth();

            // Then call our direct AI agent
            const result = await fetchNexusIntelligence(breadth);

            if (result && result.success !== false) {
                setData(result);
                const now = new Date();
                setLastSync(now);

                // Persist to local storage
                localStorage.setItem('nexus_intelligence_data', JSON.stringify(result));
                localStorage.setItem('nexus_intelligence_time', now.toISOString());
            }
        } catch (error) {
            console.error("Nexus load error", error);
        } finally {
            setLoading(false);
        }
    };

    if (!data && !loading) {
        return (
            <div className="nexus-hub-container glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
                <div className="nexus-title" style={{ justifyContent: 'center', marginBottom: '1rem' }}>
                    <div className="nexus-orb"></div>
                    <Cpu size={24} className="nexus-icon" />
                    <h3>NEXUS INTELLIGENCE</h3>
                </div>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                    Real-time market analysis for Day Trading. <br /> No hallucinations. Pure data.
                </p>
                <button
                    onClick={loadIntelligence}
                    className="nexus-refresh"
                    style={{
                        margin: '0 auto',
                        width: 'auto',
                        padding: '12px 24px',
                        fontSize: '1rem',
                        background: 'rgba(0, 180, 255, 0.1)',
                        border: '1px solid var(--color-info)',
                        borderRadius: '8px',
                        cursor: 'pointer'
                    }}
                >
                    <RefreshCw size={18} style={{ marginRight: '8px' }} />
                    INITIALIZE SCAN
                </button>
            </div>
        );
    }

    return (
        <motion.div
            className="nexus-hub-container glass-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
        >
            <div className="nexus-header">
                <div className="nexus-title">
                    <div className="nexus-orb"></div>
                    <Cpu size={18} className="nexus-icon" />
                    <h3>NEXUS INTELLIGENCE</h3>
                </div>
                <div className="nexus-status">
                    <span className="sync-time">
                        {lastSync ? `LAST SYNC: ${lastSync.toLocaleTimeString()}` : 'CONNECTING...'}
                    </span>
                    <button
                        className={`nexus-refresh ${loading ? 'loading' : ''}`}
                        onClick={loadIntelligence}
                        disabled={loading}
                        title="Run Analysis"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            <div className="nexus-content">
                {/* Global Sentiment Gauge */}
                <div className="nexus-section sentiment-section">
                    <div className="nexus-label">
                        <Wind size={14} /> MARKET MOOD
                    </div>
                    <div className="sentiment-display">
                        <div className="sentiment-score-box">
                            <span className="score-val">{data?.sentiment?.score || '--'}</span>
                            <span className="score-label">{data?.sentiment?.label || 'NEUTRAL'}</span>
                        </div>
                        <div className="sentiment-summary">
                            <Newspaper size={14} className="news-icon" />
                            <p>{data?.sentiment?.summary || 'Scanning global market frequencies for actionable sentiment...'}</p>
                        </div>
                    </div>
                </div>

                {/* Grid for Stats and Hotlist */}
                <div className="nexus-grid">
                    {/* Market Stats */}
                    <div className="nexus-panel macro-panel">
                        <div className="nexus-label">MARKET STATS</div>
                        <div className="macro-items">
                            <div className="macro-item">
                                <span className="m-name">VOLATILITY</span>
                                <div className={`m-val ${data?.marketStats?.volatility === 'HIGH' ? 'bullish' : 'bearish'}`}>
                                    {data?.marketStats?.volatility || 'MEDIUM'}
                                    <Waves size={12} />
                                </div>
                            </div>
                            <div className="macro-item">
                                <span className="m-name">TREND</span>
                                <div className={`m-val ${data?.marketStats?.trend === 'UP' ? 'bullish' : 'bearish'}`}>
                                    {data?.marketStats?.trend || 'RANGE'}
                                    {data?.marketStats?.trend === 'UP' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                </div>
                            </div>
                            <div className="macro-item">
                                <span className="m-name">BTC DOMINANCE</span>
                                <div className="m-val">
                                    {data?.marketStats?.btcDominance || '0%'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Focus List (Hotlist) */}
                    <div className="nexus-panel whale-panel">
                        <div className="nexus-label">
                            <AlertTriangle size={14} /> FOCUS LIST
                        </div>
                        <div className="whale-feed">
                            <AnimatePresence mode="popLayout">
                                {data?.hotlist?.map((item, index) => (
                                    <motion.div
                                        key={index}
                                        className={`whale-alert inflow`} // Reuse inflow style for positive vibe
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                    >
                                        <div className="alert-vol" style={{ fontSize: '0.9rem' }}>{item.symbol}</div>
                                        <div className="alert-meta" style={{ alignItems: 'flex-start' }}>
                                            <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>{item.action}</span>
                                            <span className="alert-time">{item.reason}</span>
                                        </div>
                                    </motion.div>
                                ))}
                                {(!data?.hotlist || data.hotlist.length === 0) && (
                                    <div className="whale-empty">Scanning for volatility setups...</div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>
            </div>

            {loading && (
                <div className="nexus-loading-line">
                    <motion.div
                        className="loading-shimmer"
                        animate={{ x: ['-100%', '100%'] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                    />
                </div>
            )}
        </motion.div>
    );
};

export default NexusHub;
