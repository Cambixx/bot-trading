import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Wind, Waves, Newspaper, AlertTriangle, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { fetchNexusIntelligence } from '../services/nexusService';
import binanceService from '../services/binanceService';
import './NexusHub.css';

const NexusHub = ({ onDataUpdate }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [lastSync, setLastSync] = useState(null);

    // Load persisted data on mount
    useEffect(() => {
        const savedData = localStorage.getItem('nexus_intelligence_data');
        const savedTime = localStorage.getItem('nexus_intelligence_time');

        if (savedData) {
            try {
                const parsed = JSON.parse(savedData);
                setData(parsed);
                if (savedTime) setLastSync(new Date(savedTime));
                if (onDataUpdate) onDataUpdate(parsed);
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

                if (onDataUpdate) onDataUpdate(result);
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
                    {/* Market Stats (Real Macro Data) */}
                    <div className="nexus-panel macro-panel">
                        <div className="nexus-label">MACRO DATA (LIVE)</div>
                        <div className="macro-items">
                            <div className="macro-item">
                                <span className="m-name">S&P 500</span>
                                <div className={`m-val ${data?.macro?.sp500?.trend === 'BULLISH' ? 'bullish' : 'bearish'}`}>
                                    ${data?.macro?.sp500?.value || '--'}
                                    {data?.macro?.sp500?.trend === 'BULLISH' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                </div>
                            </div>
                            <div className="macro-item">
                                <span className="m-name">DXY (DOLLAR)</span>
                                <div className={`m-val ${data?.macro?.dxy?.trend === 'UP' || data?.macro?.dxy?.trend === 'BULLISH' ? 'bullish' : 'bearish'}`}>
                                    ${data?.macro?.dxy?.value || '--'}
                                    {data?.macro?.dxy?.trend === 'BULLISH' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                </div>
                            </div>
                            <div className="macro-item">
                                <span className="m-name">BTC DOMINANCE</span>
                                <div className="m-val">
                                    {data?.marketStats?.btcDominance || data?.marketBreadth?.btcDominance || '0%'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Whale Radar (Flow Analysis) */}
                    <div className="nexus-panel whale-panel">
                        <div className="nexus-label">
                            <AlertTriangle size={14} /> CAPITAL FLOW
                        </div>
                        <div className="whale-feed">
                            <AnimatePresence mode="popLayout">
                                {data?.whaleAlerts?.map((item, index) => (
                                    <motion.div
                                        key={index}
                                        className="whale-alert inflow"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                    >
                                        <div className="alert-vol" style={{ fontSize: '0.85rem' }}>{item.type.replace('_', ' ')}</div>
                                        <div className="alert-meta">
                                            <span className="alert-time">{item.summary}</span>
                                        </div>
                                    </motion.div>
                                ))}
                                {(!data?.whaleAlerts || data.whaleAlerts.length === 0) && (
                                    <div className="whale-empty">Scanning for capital flow...</div>
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
