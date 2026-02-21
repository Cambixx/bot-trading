import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Thermometer, Zap, AlertTriangle, ShieldCheck, Wallet, TrendingUp, Target } from 'lucide-react';
import './ExecutiveDashboard.css';
import { useSettings } from '../context/SettingsContext';

const ExecutiveDashboard = ({ nexusData, oracleData, topOpportunity, topSignal, btcVol, capital = 3400, signalCount = 0 }) => {
    const { riskPerTrade } = useSettings();

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

    const formatCompact = (value) => {
        if (value == null || !Number.isFinite(value)) return '--';
        return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    };

    const formatPrice = (price) => {
        if (price == null || !Number.isFinite(price)) return '--';
        if (price < 0.0001) return price.toFixed(8);
        if (price < 0.01) return price.toFixed(6);
        if (price < 1) return price.toFixed(4);
        return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const topSignalEntry = topSignal?.levels?.entry ?? topSignal?.price ?? null;
    const topSignalSL = topSignal?.levels?.stopLoss ?? null;
    const positionValue = Number.isFinite(riskPerTrade) ? riskPerTrade : null;
    const topSignalQty = Number.isFinite(positionValue) && Number.isFinite(topSignalEntry) && topSignalEntry > 0
        ? (positionValue / topSignalEntry)
        : null;
    const topSignalRiskAtSL = Number.isFinite(topSignalQty) && Number.isFinite(topSignalEntry) && Number.isFinite(topSignalSL)
        ? Math.abs(topSignalEntry - topSignalSL) * topSignalQty
        : null;
    const topSignalSlPct = Number.isFinite(topSignalEntry) && Number.isFinite(topSignalSL)
        ? (Math.abs(topSignalEntry - topSignalSL) / topSignalEntry) * 100
        : null;

    const topBook = topSignal?.execution?.bookTop ?? null;
    const topBids = topBook?.bids ?? [];
    const topAsks = topBook?.asks ?? [];

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
                        <h2>EXECUTIVE COMMAND CENTER</h2>
                    </div>
                    <div className="live-indicator">
                        <div className="pulsar"></div>
                        DATA STREAM: ONLINE
                    </div>
                </div>

                {/* CAPITAL BAR - Portfolio Health at a Glance */}
                <div className="capital-bar">
                    <div className="capital-item primary">
                        <span className="cap-label">CAPITAL</span>
                        <span className="cap-value">€{capital.toLocaleString()}</span>
                    </div>
                    <div className="capital-item">
                        <span className="cap-label">RISK/TRADE</span>
                        <span className="cap-value">{Number.isFinite(riskPerTrade) ? `$${formatCompact(riskPerTrade)}` : '--'}</span>
                    </div>
                    <div className="capital-item">
                        <span className="cap-label">SIGNALS TODAY</span>
                        <span className="cap-value signal-count">{signalCount}</span>
                    </div>
                </div>

                <div className="exec-grid">
                    {/* 1. Global Regime */}
                    <div className={`exec-card ${risk.class}`}>
                        <div className="card-label">
                            MARKET REGIME
                        </div>
                        <div className="card-value">{btcVol?.volatility > 4 ? 'HIGH VOLATILITY' : regime}</div>
                        <div className="card-sub">{risk.label} ENVIRONMENT</div>
                    </div>

                    {/* 2. Tactical Directive */}
                    <div className="exec-card" style={{ borderTop: '4px solid var(--color-primary)' }}>
                        <div className="card-label">
                            TACTICAL DIRECTIVE
                        </div>
                        <div className="card-value">
                            {oracleData?.strategy || (risk.label === 'RISK OFF' ? 'DEFENSIVE' : 'AGGRESSIVE')}
                        </div>
                        <div className="card-sub">{nexusData?.sentiment?.summary || 'AWAITING ORDERS...'}</div>
                    </div>

                    {/* 3. Top Alpha */}
                    <div className="exec-card" style={{ borderTop: '4px solid var(--color-warning)', background: 'var(--color-bg-primary)' }}>
                        <div className="card-label" style={{ color: 'var(--color-warning)' }}>
                            [ALPHA OPPORTUNITY]
                        </div>
                        {topOpportunity ? (
                            <>
                                <div className="card-value" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {topOpportunity.symbol}
                                    <span style={{ fontSize: '0.8rem', padding: '2px 6px', border: `1px solid ${topOpportunity.type === 'LONG' ? 'var(--color-success)' : 'var(--color-danger)'}`, color: topOpportunity.type === 'LONG' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                        {topOpportunity.type}
                                    </span>
                                </div>
                                <div className="card-sub">
                                    CONFIDENCE: <b style={{ color: 'var(--color-text-primary)' }}>{topOpportunity.score}</b>
                                </div>
                            </>
                        ) : (
                            <div className="card-value" style={{ fontSize: '1rem', fontStyle: 'italic', opacity: 0.5 }}>
                                SCANNING_NETWORK...
                            </div>
                        )}
                    </div>

                    {topSignal && (
                        <div className="exec-card" style={{ borderTop: '4px solid var(--color-info)' }}>
                            <div className="card-label">
                                EXECUTION QUALITY
                            </div>
                            <div className="card-value">{topSignal.symbol}</div>
                            <div className="exec-metrics">
                                <div className="metrics-row">
                                    <div className="exec-metric"><span>OBI</span>{topSignal.execution?.obi != null ? topSignal.execution.obi : '--'}</div>
                                    <div className="exec-metric"><span>CVD20</span>{topSignal.indicators?.cvd20 != null ? formatCompact(topSignal.indicators.cvd20) : '--'}</div>
                                </div>
                                <div className="metrics-row">
                                    <div className="exec-metric"><span>SPREAD</span>{topSignal.execution?.spreadBps != null ? `${topSignal.execution.spreadBps}bps` : '--'}</div>
                                    <div className="exec-metric"><span>DEPTH</span>{topSignal.execution?.depthNotionalTopN != null ? `$${formatCompact(topSignal.execution.depthNotionalTopN)}` : '--'}</div>
                                </div>
                            </div>
                            {(topBids.length > 0 || topAsks.length > 0) && (
                                <div className="exec-orderbook">
                                    <div className="ob-side">
                                        <div className="ob-title">BIDS</div>
                                        <div className="ob-rows">
                                            {topBids.map(([p, q], idx) => (
                                                <div className="ob-row bid" key={`b-${idx}`}>
                                                    <span>{formatPrice(p)}</span>
                                                    <span>{formatCompact(q)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="ob-side">
                                        <div className="ob-title">ASKS</div>
                                        <div className="ob-rows">
                                            {topAsks.map(([p, q], idx) => (
                                                <div className="ob-row ask" key={`a-${idx}`}>
                                                    <span>{formatPrice(p)}</span>
                                                    <span>{formatCompact(q)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {topSignal && (
                        <div className="exec-card" style={{ borderTop: '4px solid var(--color-success)' }}>
                            <div className="card-label">
                                POSITION PLAN
                            </div>
                            <div className="card-value">
                                {topSignal.type === 'SELL' ? 'SHORT' : 'LONG'} {topSignal.symbol}
                            </div>
                            <div className="exec-metrics">
                                <div className="metrics-row">
                                    <div className="exec-metric"><span>ENTRY</span>${formatPrice(topSignalEntry)}</div>
                                    <div className="exec-metric"><span>SL</span>${formatPrice(topSignalSL)}</div>
                                </div>
                                <div className="metrics-row">
                                    <div className="exec-metric"><span>SL%</span>{topSignalSlPct != null ? `${topSignalSlPct.toFixed(2)}%` : '--'}</div>
                                    <div className="exec-metric"><span>RR</span>{topSignal.riskReward != null ? topSignal.riskReward : '--'}</div>
                                </div>
                                <div className="metrics-row">
                                    <div className="exec-metric"><span>QTY</span>{topSignalQty != null ? formatCompact(topSignalQty) : '--'}</div>
                                    <div className="exec-metric"><span>RISK@SL</span>{topSignalRiskAtSL != null ? `$${formatCompact(topSignalRiskAtSL)}` : '--'}</div>
                                </div>
                            </div>
                            <div className="card-sub" style={{ marginTop: '0.35rem' }}>
                                SCORE {topSignal.score} • {topSignal.confidence}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

export default ExecutiveDashboard;
