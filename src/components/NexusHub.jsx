import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Wind, Waves, Newspaper, AlertTriangle, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { fetchNexusIntelligence } from '../services/nexusService';
import binanceService from '../services/binanceService';
import './NexusHub.css';

const NexusHub = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [lastSync, setLastSync] = useState(null);

    const loadIntelligence = async () => {
        setLoading(true);
        try {
            // First get context from market breadth
            const breadth = await binanceService.getMarketBreadth();

            // Then call our direct AI agent
            const result = await fetchNexusIntelligence(breadth);

            if (result && result.success !== false) {
                setData(result);
                setLastSync(new Date());
            }
        } catch (error) {
            console.error("Nexus load error", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadIntelligence();
        // Refresh every 10 minutes
        const interval = setInterval(loadIntelligence, 600000);
        return () => clearInterval(interval);
    }, []);

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
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            <div className="nexus-content">
                {/* Global Sentiment Gauge */}
                <div className="nexus-section sentiment-section">
                    <div className="nexus-label">
                        <Wind size={14} /> GLOBAL SENTIMENT
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

                {/* Grid for Macro and Whales */}
                <div className="nexus-grid">
                    {/* Macro Trends */}
                    <div className="nexus-panel macro-panel">
                        <div className="nexus-label">MACRO CORRELATION</div>
                        <div className="macro-items">
                            <div className="macro-item">
                                <span className="m-name">DXY (DOCAR)</span>
                                <div className={`m-val ${data?.macro?.dxy?.trend === 'Down' ? 'bullish' : 'bearish'}`}>
                                    {data?.macro?.dxy?.value || '00.0'}
                                    {data?.macro?.dxy?.trend === 'Down' ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                                </div>
                            </div>
                            <div className="macro-item">
                                <span className="m-name">S&P 500</span>
                                <div className={`m-val ${data?.macro?.sp500?.trend === 'Up' ? 'bullish' : 'bearish'}`}>
                                    {data?.macro?.sp500?.value || '0000'}
                                    {data?.macro?.sp500?.trend === 'Up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Whale Radar */}
                    <div className="nexus-panel whale-panel">
                        <div className="nexus-label">
                            <Waves size={14} /> WHALE RADAR
                        </div>
                        <div className="whale-feed">
                            <AnimatePresence mode="popLayout">
                                {data?.whaleAlerts?.map((alert) => (
                                    <motion.div
                                        key={alert.id}
                                        className={`whale-alert ${alert.type.toLowerCase()}`}
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                    >
                                        <div className="alert-vol">{alert.amount}</div>
                                        <div className="alert-meta">
                                            <span>{alert.type}</span>
                                            <span className="alert-time">{alert.time}</span>
                                        </div>
                                    </motion.div>
                                ))}
                                {!data?.whaleAlerts && (
                                    <div className="whale-empty">Listening for deep water movements...</div>
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
