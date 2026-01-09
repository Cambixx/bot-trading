import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Thermometer, Zap, AlertTriangle, ShieldCheck } from 'lucide-react';
import './ExecutiveDashboard.css';

const ExecutiveDashboard = ({ nexusData, oracleData, topOpportunity, btcVol }) => {
    // Determine overall risk status
    const getRiskStatus = () => {
        // PRIORITY: Real-time Volatility Override
        if (btcVol?.volatility > 4) { // Volatility threshold (approx)
            return { label: 'VOLATILITY SPIKE', class: 'risk-critical', icon: <AlertTriangle size={16} /> };
        }

        if (!oracleData && !nexusData) return 'NEUTRAL';

        let score = 0;
        if (oracleData?.marketState?.includes('RISK_ON')) score += 1;
        if (oracleData?.marketState?.includes('RISK_OFF')) score -= 1;

        // Nexus Macro Trend
        if (nexusData?.macro?.sp500?.trend === 'BULLISH') score += 1;
        if (nexusData?.macro?.dxy?.trend === 'BULLISH') score -= 1; // Strong Dollar = Bad for Crypto usually

        if (score > 0) return { label: 'RISK ON', class: 'risk-on', icon: <Zap size={16} /> };
        if (score < 0) return { label: 'RISK OFF', class: 'risk-off', icon: <ShieldCheck size={16} /> };
        return { label: 'NEUTRAL', class: '', icon: <Activity size={16} /> };
    };

    const risk = getRiskStatus();

    // Data Helpers
    const sentimentScore = nexusData?.sentiment?.score || '--';
    const regime = oracleData?.marketState || 'ANALYZING...';

    // Macro Data
    const sp500 = nexusData?.macro?.sp500;
    const dxy = nexusData?.macro?.dxy;
    const btcPrice = btcVol?.price || 0;
    const btcChange = btcVol?.priceChangePercent || 0;

    const hasData = nexusData || oracleData || topOpportunity || (btcPrice > 0);

    if (!hasData) {
        return (
            <motion.div
                className="exec-dashboard"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div className="empty-state">
                    Initializing Command Center...
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            className="exec-dashboard"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
        >
            {/* LIVE TICKER TAPE */}
            <div className="macro-ticker-container">
                <div className="macro-ticker-track">
                    {/* BTC */}
                    <div className="ticker-item">
                        <span style={{ color: '#f7931a', fontWeight: 'bold' }}>BTC</span>
                        <span className="ticker-val">${btcPrice.toLocaleString()}</span>
                        <span className={`ticker-change ${btcChange >= 0 ? 'up' : 'down'}`}>
                            {btcChange >= 0 ? '+' : ''}{btcChange}%
                        </span>
                    </div>

                    {/* SPX */}
                    <div className="ticker-item">
                        <span>S&P 500</span>
                        <span className="ticker-val">${sp500?.price || '--'}</span>
                        <span className={`ticker-change ${sp500?.changePercent >= 0 ? 'up' : 'down'}`}>
                            {sp500?.changePercent}%
                        </span>
                    </div>

                    {/* DXY */}
                    <div className="ticker-item">
                        <span>DXY</span>
                        <span className="ticker-val">${dxy?.price || '--'}</span>
                        <span className={`ticker-change ${dxy?.changePercent >= 0 ? 'up' : 'down'}`}>
                            {dxy?.changePercent}%
                        </span>
                    </div>

                    {/* REPEAT for smooth infinite scroll */}
                    <div className="ticker-item">
                        <span style={{ color: '#f7931a', fontWeight: 'bold' }}>BTC</span>
                        <span className="ticker-val">${btcPrice.toLocaleString()}</span>
                        <span className={`ticker-change ${btcChange >= 0 ? 'up' : 'down'}`}>
                            {btcChange >= 0 ? '+' : ''}{btcChange}%
                        </span>
                    </div>
                </div>
            </div>

            <div className="exec-content">
                <div className="exec-header">
                    <div className="exec-title">
                        <Activity size={20} style={{ color: 'var(--color-info)' }} />
                        <h2>Executive Command Center</h2>
                    </div>
                    <div className="live-indicator">
                        <div className="pulsar"></div>
                        DATA STREAM: ACTIVE
                    </div>
                </div>

                <div className="exec-grid">
                    {/* 1. Global Regime */}
                    <div className={`exec-card ${risk.class}`}>
                        <div className="card-label">
                            Market Regime
                            {risk.icon}
                        </div>
                        <div className="card-value">{btcVol?.volatility > 4 ? 'HIGH VOLATILITY' : regime}</div>
                        <div className="card-sub">{risk.label} Environment</div>
                    </div>

                    {/* 2. Tactical Directive */}
                    <div className="exec-card" style={{ borderLeft: '3px solid var(--color-primary)' }}>
                        <div className="card-label">
                            Tactical Directive
                            <Zap size={14} />
                        </div>
                        <div className="card-value">
                            {oracleData?.strategy || (risk.label === 'RISK OFF' ? 'DEFENSIVE' : 'AGGRESSIVE')}
                        </div>
                        <div className="card-sub">{nexusData?.sentiment?.summary || 'Awaiting orders...'}</div>
                    </div>

                    {/* 3. Top Alpha */}
                    <div className="exec-card" style={{ borderLeft: '3px solid #ffd700', background: 'rgba(255, 215, 0, 0.05)' }}>
                        <div className="card-label" style={{ color: '#ffd700' }}>
                            ★ Alpha Opportunity
                        </div>
                        {topOpportunity ? (
                            <>
                                <div className="card-value" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {topOpportunity.symbol}
                                    <span style={{ fontSize: '0.8rem', padding: '2px 6px', borderRadius: '4px', background: topOpportunity.type === 'LONG' ? 'rgba(0,255,157,0.2)' : 'rgba(255,77,77,0.2)', color: topOpportunity.type === 'LONG' ? '#00ff9d' : '#ff4d4d' }}>
                                        {topOpportunity.type}
                                    </span>
                                </div>
                                <div className="card-sub">
                                    Conf: <b style={{ color: 'white' }}>{topOpportunity.score}</b>
                                </div>
                            </>
                        ) : (
                            <div className="card-value" style={{ fontSize: '1rem', fontStyle: 'italic', opacity: 0.5 }}>
                                Scanning...
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default ExecutiveDashboard;
