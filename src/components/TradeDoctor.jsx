import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Stethoscope, HeartPulse, FileText, AlertCircle, Thermometer } from 'lucide-react';
import { getTradeDoctorAnalysis } from '../services/aiAnalysis';
import binanceService from '../services/binanceService';
import { calculateRSI, calculateMACD, calculateBollingerBands } from '../services/technicalAnalysis';
import './TradeDoctor.css';

const TradeDoctor = ({ defaultSymbol, availableSymbols }) => {
    const [selectedSymbol, setSelectedSymbol] = useState(defaultSymbol || (availableSymbols && availableSymbols[0]) || 'BTCUSDC');
    const [loading, setLoading] = useState(false);
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);

    // Load persisted report on mount
    useEffect(() => {
        const savedReport = localStorage.getItem(`doctor_report_${selectedSymbol}`);
        if (savedReport) {
            try {
                setReport(JSON.parse(savedReport));
            } catch (e) {
                console.error("Error parsing saved report", e);
            }
        }
    }, [selectedSymbol]);

    // Update local state if default changes (optional)
    // useEffect(() => { if(defaultSymbol) setSelectedSymbol(defaultSymbol); }, [defaultSymbol]);

    const [cooldown, setCooldown] = useState(false);

    const handleDiagnose = async () => {
        if (!selectedSymbol || cooldown) return;

        setLoading(true);
        setError(null);
        setReport(null);
        setCooldown(true);

        try {
            // 1. Fetch Multi-Timeframe Data (15m, 1H, 4H)
            const [klines15m, klines1h, klines4h, depth] = await Promise.all([
                binanceService.getKlines(selectedSymbol, '15m', 100).catch(e => { throw new Error("Binance Service unavailable (15m)"); }),
                binanceService.getKlines(selectedSymbol, '1h', 100).catch(e => { throw new Error("Binance Service unavailable (1h)"); }),
                binanceService.getKlines(selectedSymbol, '4h', 50).catch(e => { throw new Error("Binance Service unavailable (4h)"); }),
                binanceService.getOrderBookDepth(selectedSymbol, 20).catch(e => null)
            ]);

            if (!klines15m || !klines1h || !klines4h) throw new Error("Could not fetch market data.");

            const price = parseFloat(klines15m[klines15m.length - 1].close);

            // 2. Calculate Indicators for each timeframe
            const closes15m = klines15m.map(k => k.close);
            const closes1h = klines1h.map(k => k.close);
            const closes4h = klines4h.map(k => k.close);

            // RSI
            const rsi15m = calculateRSI(closes15m);
            const rsi1h = calculateRSI(closes1h);

            // MACD
            const macd15m = calculateMACD(closes15m);
            const macd1h = calculateMACD(closes1h);

            // Bollinger Bands
            const bb1h = calculateBollingerBands(closes1h);
            const bb4h = calculateBollingerBands(closes4h);

            // ADX (from technicalAnalysis if available, else skip)
            let adx1h = null;
            try {
                const { calculateADX } = await import('../services/technicalAnalysis');
                const adxResult = calculateADX(klines1h, 14);
                adx1h = adxResult.adx[adxResult.adx.length - 1];
            } catch (e) {
                console.log('ADX not available');
            }

            // ATR for volatility context
            let atr1h = null;
            try {
                const { calculateATR } = await import('../services/technicalAnalysis');
                const atrResult = calculateATR(klines1h, 14);
                atr1h = atrResult[atrResult.length - 1];
            } catch (e) {
                console.log('ATR not available');
            }

            // Volume Analysis
            const volumes1h = klines1h.map(k => k.volume);
            const avgVolume = volumes1h.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const currentVolume = volumes1h[volumes1h.length - 1];
            const volumeRatio = (currentVolume / avgVolume).toFixed(2);

            // BB Position
            const upper1h = bb1h.upper[bb1h.upper.length - 1];
            const lower1h = bb1h.lower[bb1h.lower.length - 1];
            let bbPos = "Middle";
            if (price > upper1h) bbPos = "Above Upper Band (Overbought Zone)";
            else if (price < lower1h) bbPos = "Below Lower Band (Oversold Zone)";
            else if (price > (upper1h + lower1h) / 2) bbPos = "Upper Half";
            else bbPos = "Lower Half";

            // EMA Trend Context
            const ema21_1h = closes1h.slice(-21).reduce((a, b) => a + b, 0) / 21;
            const ema50_1h = closes1h.slice(-50).reduce((a, b) => a + b, 0) / 50;
            const trend1h = price > ema21_1h ? (price > ema50_1h ? 'BULLISH' : 'WEAK BULLISH') : (price < ema50_1h ? 'BEARISH' : 'WEAK BEARISH');

            // Order Book Imbalance Calculation
            let obImbalance = "Neutral";
            let bidVol = 0;
            let askVol = 0;
            if (depth) {
                bidVol = depth.bids.reduce((acc, item) => acc + item[1], 0);
                askVol = depth.asks.reduce((acc, item) => acc + item[1], 0);
                const ratio = bidVol / (askVol || 1);

                if (ratio > 1.5) obImbalance = `Bulish Order Flow (${ratio.toFixed(1)}x Bids)`;
                else if (ratio < 0.6) obImbalance = `Bearish Order Flow (${(1 / ratio).toFixed(1)}x Asks)`;
                else obImbalance = "Balanced Order Book";
            }

            // 3. Build comprehensive technicals object
            const technicals = {
                indicators: {
                    rsi15m: rsi15m[rsi15m.length - 1]?.toFixed(1) || 'N/A',
                    rsi1h: rsi1h[rsi1h.length - 1]?.toFixed(1) || 'N/A',
                    macd15m: macd15m.histogram[macd15m.histogram.length - 1]?.toFixed(4) || 'N/A',
                    macd1h: macd1h.histogram[macd1h.histogram.length - 1]?.toFixed(4) || 'N/A',
                    bbPosition: bbPos,
                    adx1h: adx1h?.toFixed(1) || 'N/A',
                    trend1h: trend1h,
                    atr1h: atr1h?.toFixed(4) || 'N/A',
                    atrPercent: atr1h ? ((atr1h / price) * 100).toFixed(2) + '%' : 'N/A',
                    volumeRatio: volumeRatio + 'x avg',
                    volumeStatus: currentVolume > avgVolume * 1.5 ? 'HIGH' : currentVolume < avgVolume * 0.5 ? 'LOW' : 'NORMAL',
                    orderBook: obImbalance
                },
                orderFlow: { bidVol, askVol } // Save for UI rendering
            };

            // 4. Call The Doctor with enhanced data
            const result = await getTradeDoctorAnalysis(selectedSymbol, price, technicals);

            if (result.success && result.analysis) {
                // Merge Order Flow data into the report for rendering
                const finalReport = { ...result.analysis, orderFlow: technicals.orderFlow };
                setReport(finalReport);
                localStorage.setItem(`doctor_report_${selectedSymbol}`, JSON.stringify(finalReport));
                if (result.isFallback) {
                    setError("Notice: Using localized diagnostic tools. High congestion.");
                }
            } else {
                setError("The Doctor is currently on a break (Rate Limit). Try again in a minute.");
            }

        } catch (err) {
            console.error("Doctor Error:", err);
            setError("Diagnostic failed: " + (err.message.includes("Rate Limit") ? "Too many requests. Please wait." : err.message));
        } finally {
            setLoading(false);
            // 5s cooling period for the button
            setTimeout(() => setCooldown(false), 5000);
        }
    };

    return (
        <motion.div
            className="trade-doctor-container glass-card"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
        >
            <div className="doctor-header">
                <div className="doctor-identity">
                    <div className="icon-box-medical">
                        <Stethoscope size={24} color="#ff4d4d" />
                    </div>
                    <div>
                        <h3>THE TRADE DOCTOR</h3>
                        <p className="subtitle">AI Diagnostic Clinic</p>
                    </div>
                </div>

                <div className="patient-selector">
                    <span className="patient-label">PATIENT:</span>
                    <select
                        className="doctor-select"
                        value={selectedSymbol}
                        onChange={(e) => {
                            setSelectedSymbol(e.target.value);
                            setReport(null); // Clear previous report on change
                        }}
                    >
                        {availableSymbols && availableSymbols.map(sym => (
                            <option key={sym} value={sym}>{sym}</option>
                        ))}
                        {!availableSymbols && <option value="BTCUSDC">BTCUSDC</option>}
                    </select>
                </div>
            </div>

            <div className="doctor-body">
                {!report && !loading && (
                    <div className="doctor-empty-state">
                        <Activity size={48} className="pulse-icon opacity-20" />
                        <p>Select a coin above and ask for a diagnosis.</p>
                        <button
                            className="diagnose-btn"
                            disabled={!selectedSymbol}
                            onClick={handleDiagnose}
                        >
                            {selectedSymbol ? `DIAGNOSE ${selectedSymbol} ` : "SELECT A COIN"}
                        </button>
                    </div>
                )}

                {loading && (
                    <div className="doctor-loading">
                        <motion.div
                            animate={{ scale: [1, 1.2, 1] }}
                            transition={{ repeat: Infinity, duration: 0.8 }}
                        >
                            <HeartPulse size={48} color="#ff4d4d" />
                        </motion.div>
                        <p>Analyzing Vitals...</p>
                    </div>
                )}

                {report && (
                    <motion.div
                        className="medical-report"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        <div className="report-header">
                            <div className="health-score-bloq">
                                <span className="label">HEALTH SCORE</span>
                                <div className="score-ring" style={{ borderColor: report.healthScore > 70 ? '#00ff9d' : report.healthScore < 40 ? '#ff4d4d' : '#fbbf24' }}>
                                    {report.healthScore}
                                </div>
                            </div>
                            <div className="diagnosis-main">
                                <span className="label">DIAGNOSIS</span>
                                <h4>{report.diagnosis}</h4>
                            </div>
                        </div>

                        <div className="report-grid">
                            <div className="symptoms-box">
                                <div className="box-title"><AlertCircle size={14} /> SYMPTOMS</div>
                                <ul>
                                    {report.symptoms && report.symptoms.map ? report.symptoms.map((sym, i) => (
                                        <li key={i}>{sym}</li>
                                    )) : <li>No symptoms detailed.</li>}
                                </ul>
                            </div>

                            <div className="prescription-box">
                                <div className="box-title"><FileText size={14} /> PRESCRIPTION</div>
                                <p>{report.prescription || "No prescription available."}</p>
                            </div>

                            {report.levels && (
                                <div className="levels-box">
                                    <div className="box-title">🎯 TRADE LEVELS</div>
                                    <div className="levels-grid">
                                        <div className="level-item entry">
                                            <span className="level-label">Entry</span>
                                            <span className="level-value">{report.levels.entry}</span>
                                        </div>
                                        <div className="level-item stop">
                                            <span className="level-label">Stop Loss</span>
                                            <span className="level-value">{report.levels.stopLoss}</span>
                                        </div>
                                        <div className="level-item target">
                                            <span className="level-label">Take Profit</span>
                                            <span className="level-value">{report.levels.takeProfit}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Order Book Vital (Professional Edge) */}
                            {report.orderFlow && (
                                <div className="levels-box" style={{ borderColor: 'rgba(0, 180, 255, 0.3)' }}>
                                    <div className="box-title" style={{ color: 'var(--color-info)' }}>⚡ ORDER BOOK DEPTH</div>
                                    <div style={{ display: 'flex', alignItems: 'center', marginTop: '10px', fontSize: '0.8rem', gap: '10px' }}>
                                        <div style={{ flex: 1, textAlign: 'right', color: '#00ff9d' }}>
                                            BIDS: {report.orderFlow.bidVol?.toFixed(0)}
                                        </div>

                                        {/* Bar Visual */}
                                        <div style={{ width: '80px', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                                            <div style={{
                                                flex: report.orderFlow.bidVol / (report.orderFlow.bidVol + report.orderFlow.askVol),
                                                background: '#00ff9d'
                                            }} />
                                            <div style={{
                                                flex: report.orderFlow.askVol / (report.orderFlow.bidVol + report.orderFlow.askVol),
                                                background: '#ff4d4d'
                                            }} />
                                        </div>

                                        <div style={{ flex: 1, textAlign: 'left', color: '#ff4d4d' }}>
                                            ASKS: {report.orderFlow.askVol?.toFixed(0)}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'center', fontSize: '0.7rem', marginTop: '5px', opacity: 0.75 }}>
                                        {report.orderFlow.bidVol > report.orderFlow.askVol
                                            ? `Buying Pressure Dominates (${(report.orderFlow.bidVol / report.orderFlow.askVol).toFixed(1)}x)`
                                            : `Selling Pressure Dominates (${(report.orderFlow.askVol / report.orderFlow.bidVol).toFixed(1)}x)`}
                                    </div>
                                </div>
                            )}

                            <div className="prognosis-box">
                                <div className="box-title"><Thermometer size={14} /> PROGNOSIS (1-4H)</div>
                                <p>{report.prognosis || "No prognosis available."}</p>
                                {report.tradability && (
                                    <div className={`tradability-badge ${report.tradability.toLowerCase()}`}>
                                        Tradability: {report.tradability}
                                    </div>
                                )}
                            </div>
                        </div>

                        <button className="new-consult-btn" onClick={() => setReport(null)}>
                            New Consultation
                        </button>
                    </motion.div>
                )}
            </div>
        </motion.div>
    );
};

export default TradeDoctor;
