import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Search, Activity, History, Microscope, Target } from 'lucide-react';
import MarketOracle from './MarketOracle';
import NexusHub from './NexusHub';
import MLSignalSection from './MLSignalSection';
import TradeDoctor from './TradeDoctor';
import PatternHunter from './PatternHunter';
import BacktestDashboard from './BacktestDashboard';
import './ToolsHub.css';

const ToolsHub = ({ symbols, mlSignals, loading, setOracleData, setNexusData }) => {
    const [activeTab, setActiveTab] = useState('intelligence');

    const tabs = [
        { id: 'intelligence', label: 'Inteligencia', icon: Brain, description: 'AI Oracle & Nexus Hub' },
        { id: 'momentum', label: 'Momentum', icon: Activity, description: 'ML Signals (LuxAlgo)' },
        { id: 'diagnosis', label: 'Diagnóstico', icon: Microscope, description: 'Doctor & Pattern Hunter' },
        { id: 'backtest', label: 'Backtest', icon: History, description: 'Validación de Estrategias' }
    ];

    return (
        <div className="tools-hub glass-card">
            <div className="tools-hub-header">
                <div className="tabs-nav">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <tab.icon size={18} />
                            <div className="tab-btn-content">
                                <span className="tab-label">{tab.label}</span>
                                <span className="tab-desc">{tab.description}</span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            <div className="tools-hub-content">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="tab-panel"
                    >
                        {activeTab === 'intelligence' && (
                            <div className="intelligence-grid">
                                <MarketOracle onDataUpdate={setOracleData} />
                                <div style={{ marginTop: '1.5rem' }}>
                                    <NexusHub onDataUpdate={setNexusData} />
                                </div>
                            </div>
                        )}

                        {activeTab === 'momentum' && (
                            <MLSignalSection signals={mlSignals} loading={loading} />
                        )}

                        {activeTab === 'diagnosis' && (
                            <div className="diagnosis-container">
                                <div className="diagnostic-grid">
                                    <TradeDoctor defaultSymbol={symbols[0]} availableSymbols={symbols} />
                                    <div style={{ marginTop: '1.5rem' }}>
                                        <PatternHunter defaultSymbol={symbols[0]} availableSymbols={symbols} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'backtest' && (
                            <BacktestDashboard symbols={symbols} />
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
};

export default ToolsHub;
