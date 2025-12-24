import React, { useState } from 'react';
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

    // Update local state if default changes (optional, but good for sync)
    // useEffect(() => { if(defaultSymbol) setSelectedSymbol(defaultSymbol); }, [defaultSymbol]);

    const handleDiagnose = async () => {
        if (!selectedSymbol) return;

        setLoading(true);
        setError(null);
        setReport(null);

        try {
            // 1. Fetch Fresh Data (Last 100 candles for indicators)
            const klines = await binanceService.getKlines(selectedSymbol, '1h', 100);
            const price = parseFloat(klines[klines.length - 1].close);
            const closePrices = klines.map(k => k.close);

            // 2. Calculate Basic Indicators locally to send to AI
            const rsiArray = calculateRSI(closePrices);
            const rsiVal = rsiArray[rsiArray.length - 1];

            const macdObj = calculateMACD(closePrices);
            const macdVal = macdObj.macd[macdObj.macd.length - 1];

            const bbObj = calculateBollingerBands(closePrices);
            const upper = bbObj.upper[bbObj.upper.length - 1];
            const lower = bbObj.lower[bbObj.lower.length - 1];

            let bbPos = "Middle";
            if (price > upper) bbPos = "Above Upper Band";
            if (price < lower) bbPos = "Below Lower Band";

            const technicals = {
                indicators: {
                    rsi: rsiVal ? rsiVal.toFixed(2) : 'N/A',
                    macd: macdVal ? macdVal.toFixed(4) : 'N/A',
                    bbPosition: bbPos
                }
            };

            // 3. Call The Doctor
            const result = await getTradeDoctorAnalysis(selectedSymbol, price, technicals);

            if (result.success && result.analysis) {
                setReport(result.analysis);
            } else {
                setError("The Doctor is currently unavailable.");
            }

        } catch (err) {
            console.error(err);
            setError("Failed to fetch patient data.");
        } finally {
            setLoading(false);
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
                                    {report.symptoms.map((sym, i) => (
                                        <li key={i}>{sym}</li>
                                    ))}
                                </ul>
                            </div>

                            <div className="prescription-box">
                                <div className="box-title"><FileText size={14} /> PRESCRIPTION</div>
                                <p>{report.prescription}</p>
                            </div>

                            <div className="prognosis-box">
                                <div className="box-title"><Thermometer size={14} /> PROGNOSIS (4H)</div>
                                <p>{report.prognosis}</p>
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
