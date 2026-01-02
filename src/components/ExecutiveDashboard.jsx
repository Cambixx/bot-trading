import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Thermometer, Zap, AlertTriangle, ShieldCheck } from 'lucide-react';
import './ExecutiveDashboard.css';

const ExecutiveDashboard = ({ nexusData, oracleData }) => {
    // Determine overall risk status
    const getRiskStatus = () => {
        if (!oracleData && !nexusData) return 'NEUTRAL';

        let score = 0;
        if (oracleData?.marketState?.includes('RISK_ON')) score += 1;
        if (oracleData?.marketState?.includes('RISK_OFF')) score -= 1;
        if (nexusData?.marketStats?.volatility === 'HIGH') score -= 1;

        if (score > 0) return { label: 'RISK ON', class: 'risk-on', icon: <Zap size={16} /> };
        if (score < 0) return { label: 'RISK OFF', class: 'risk-off', icon: <ShieldCheck size={16} /> };
        return { label: 'NEUTRAL', class: '', icon: <Activity size={16} /> };
    };

    const risk = getRiskStatus();

    // Formatting Helpers
    const sentimentScore = nexusData?.sentiment?.score || '--';
    const sentimentLabel = nexusData?.sentiment?.label || 'Waiting...';

    // Oracle Insights
    const regime = oracleData?.marketState || 'ANALYZING...';
    const driver = oracleData?.keyDriver || 'Scanning news...';

    // Strategy Tip
    const strategy = oracleData?.strategy || 'WAIT';

    const hasData = nexusData || oracleData;

    if (!hasData) {
        return (
            <motion.div
                className="exec-dashboard"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div className="empty-state">
                    Initializing Command Center... Waiting for AI Analysis.
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
            <div className="exec-header">
                <div className="exec-title">
                    <Activity size={20} style={{ color: 'var(--color-info)' }} />
                    <h2>Executive Command Center</h2>
                </div>
                <div className="live-indicator">
                    <div className="pulsar"></div>
                    LIVE
                </div>
            </div>

            <div className="exec-grid">
                {/* 1. Global Regime */}
                <div className={`exec-card ${risk.class}`}>
                    <div className="card-label">
                        Market Regime
                        {risk.icon}
                    </div>
                    <div className="card-value">{regime}</div>
                    <div className="card-sub">{risk.label} Environment</div>
                </div>

                {/* 2. Key Driver */}
                <div className="exec-card">
                    <div className="card-label">
                        Primary Catalyst
                        <AlertTriangle size={14} />
                    </div>
                    <div className="card-value" style={{ fontSize: '1rem', lineHeight: '1.4' }}>
                        {driver}
                    </div>
                </div>

                {/* 3. Sentiment Thermometer */}
                <div className="exec-card">
                    <div className="card-label">
                        Sentiment Score
                        <Thermometer size={14} />
                    </div>
                    <div className={`card-value sentiment-val ${parseInt(sentimentScore) > 50 ? 'positive' : 'negative'}`}>
                        {sentimentScore}
                        <span style={{ fontSize: '0.8rem', marginLeft: '5px', opacity: 0.7 }}>/ 100</span>
                    </div>
                    <div className="card-sub">{sentimentLabel}</div>
                </div>

                {/* 4. Action Strategy */}
                <div className="exec-card" style={{ borderLeft: '3px solid var(--color-primary)' }}>
                    <div className="card-label">
                        Recommended Strategy
                        <Zap size={14} />
                    </div>
                    <div className="card-value">{strategy}</div>
                    <div className="card-sub">Based on current volatility</div>
                </div>
            </div>
        </motion.div>
    );
};

export default ExecutiveDashboard;
