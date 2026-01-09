import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import { RefreshCw, TrendingUp, TrendingDown, Activity, Target, Shield } from 'lucide-react';
import binanceService from '../services/binanceService';
import { calculateTrendPrediction } from '../services/predictionService';
import {
    calculateEMA,
    calculateRSI,
    calculateMACD,
    calculateBollingerBands,
    findSupportResistance,
    isHammer,
    isBullishEngulfing,
    detectOrderBlocks,
    findFairValueGaps
} from '../services/technicalAnalysis';
import './CryptoChart.css';

const TIMEFRAMES = [
    { value: '15m', label: '15m' },
    { value: '1h', label: '1H' },
    { value: '4h', label: '4H' },
    { value: '1d', label: '1D' },
];

function CryptoChart({ symbol, signal }) {
    const chartContainerRef = useRef();
    const rsiContainerRef = useRef();
    const macdContainerRef = useRef();
    const chartsRef = useRef({ main: null, rsi: null, macd: null });
    const seriesRef = useRef({});

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [prediction, setPrediction] = useState(null);
    const [timeframe, setTimeframe] = useState('1h');
    const [levels, setLevels] = useState({ support: null, resistance: null });
    const [currentPrice, setCurrentPrice] = useState(null);
    const [indicators, setIndicators] = useState({ rsi: null, macd: null });
    const [patterns, setPatterns] = useState([]);

    // Overlay toggles
    const [showOverlays, setShowOverlays] = useState({
        ema: true, bb: false, sr: true, signal: true, smc: true // New SMC toggle
    });

    // Panel visibility (CSS-based, not chart recreation)
    const [showRSI, setShowRSI] = useState(true);
    const [showMACD, setShowMACD] = useState(false);

    const formatPrice = useCallback((price) => {
        if (!price) return '-';
        if (price >= 1) return price.toFixed(2);
        if (price >= 0.01) return price.toFixed(4);
        if (price >= 0.0001) return price.toFixed(6);
        return price.toFixed(8);
    }, []);

    // Initialize charts ONCE
    useEffect(() => {
        if (!chartContainerRef.current || !rsiContainerRef.current || !macdContainerRef.current) return;

        const priceFormatter = (price) => {
            if (price >= 1) return price.toFixed(2);
            if (price >= 0.01) return price.toFixed(4);
            if (price >= 0.0001) return price.toFixed(6);
            return price.toFixed(8);
        };

        // ============ MAIN CHART ============
        const mainChart = createChart(chartContainerRef.current, {
            layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#d1d5db' },
            grid: { vertLines: { color: 'rgba(255, 255, 255, 0.03)' }, horzLines: { color: 'rgba(255, 255, 255, 0.03)' } },
            width: chartContainerRef.current.clientWidth,
            height: 320,
            timeScale: { timeVisible: true, secondsVisible: false },
            rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.1)' },
            localization: { priceFormatter },
            crosshair: {
                mode: 0,
                vertLine: { color: 'rgba(255, 255, 255, 0.3)', labelBackgroundColor: '#26a69a' },
                horzLine: { color: 'rgba(255, 255, 255, 0.3)', labelBackgroundColor: '#26a69a' },
            },
        });

        // Create all series
        const series = {
            candles: mainChart.addSeries(CandlestickSeries, {
                upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
            }),
            volume: mainChart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' }),
            bbUpper: mainChart.addSeries(LineSeries, { color: 'rgba(156, 163, 175, 0.4)', lineWidth: 1 }),
            bbMiddle: mainChart.addSeries(LineSeries, { color: 'rgba(156, 163, 175, 0.2)', lineWidth: 1, lineStyle: 2 }),
            bbLower: mainChart.addSeries(LineSeries, { color: 'rgba(156, 163, 175, 0.4)', lineWidth: 1 }),
            ema20: mainChart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1 }),
            ema50: mainChart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1 }),
            support: mainChart.addSeries(LineSeries, { color: '#22c55e', lineWidth: 2, lineStyle: 2 }),
            resistance: mainChart.addSeries(LineSeries, { color: '#ef4444', lineWidth: 2, lineStyle: 2 }),
            entry: mainChart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, lineStyle: 3 }),
            sl: mainChart.addSeries(LineSeries, { color: '#ef4444', lineWidth: 1, lineStyle: 3 }),
            tp: mainChart.addSeries(LineSeries, { color: '#22c55e', lineWidth: 1, lineStyle: 3 }),
        };
        mainChart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

        // ============ RSI CHART ============
        const rsiChart = createChart(rsiContainerRef.current, {
            layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#d1d5db' },
            grid: { vertLines: { color: 'rgba(255, 255, 255, 0.03)' }, horzLines: { color: 'rgba(255, 255, 255, 0.03)' } },
            width: rsiContainerRef.current.clientWidth,
            height: 80,
            timeScale: { visible: false },
            rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.1)' },
        });
        series.rsi = rsiChart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 1 });
        series.rsi30 = rsiChart.addSeries(LineSeries, { color: 'rgba(34, 197, 94, 0.4)', lineWidth: 1, lineStyle: 2 });
        series.rsi70 = rsiChart.addSeries(LineSeries, { color: 'rgba(239, 68, 68, 0.4)', lineWidth: 1, lineStyle: 2 });

        // ============ MACD CHART ============
        const macdChart = createChart(macdContainerRef.current, {
            layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#d1d5db' },
            grid: { vertLines: { color: 'rgba(255, 255, 255, 0.03)' }, horzLines: { color: 'rgba(255, 255, 255, 0.03)' } },
            width: macdContainerRef.current.clientWidth,
            height: 80,
            timeScale: { visible: false },
            rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.1)' },
            localization: { priceFormatter: (p) => p.toFixed(8) },
        });
        series.macdHist = macdChart.addSeries(HistogramSeries, {});
        series.macdLine = macdChart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1 });
        series.macdSignal = macdChart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1 });

        chartsRef.current = { main: mainChart, rsi: rsiChart, macd: macdChart };
        seriesRef.current = series;

        // Resize handler
        const handleResize = () => {
            if (chartContainerRef.current) mainChart.applyOptions({ width: chartContainerRef.current.clientWidth });
            if (rsiContainerRef.current) rsiChart.applyOptions({ width: rsiContainerRef.current.clientWidth });
            if (macdContainerRef.current) macdChart.applyOptions({ width: macdContainerRef.current.clientWidth });
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            mainChart.remove();
            rsiChart.remove();
            macdChart.remove();
        };
    }, []); // Only run once on mount

    // Update visibility when toggles change
    useEffect(() => {
        const s = seriesRef.current;
        if (!s.ema20) return;

        s.ema20.applyOptions({ visible: showOverlays.ema });
        s.ema50.applyOptions({ visible: showOverlays.ema });
        s.bbUpper.applyOptions({ visible: showOverlays.bb });
        s.bbMiddle.applyOptions({ visible: showOverlays.bb });
        s.bbLower.applyOptions({ visible: showOverlays.bb });
        s.support.applyOptions({ visible: showOverlays.sr });
        s.resistance.applyOptions({ visible: showOverlays.sr });
        s.entry.applyOptions({ visible: showOverlays.signal && !!signal });
        s.sl.applyOptions({ visible: showOverlays.signal && !!signal });
        s.tp.applyOptions({ visible: showOverlays.signal && !!signal });
    }, [showOverlays, signal]);

    // Fetch data when symbol/timeframe changes
    useEffect(() => {
        const charts = chartsRef.current;
        const s = seriesRef.current;
        if (!charts.main || !s.candles) return;

        let cancelled = false;

        const fetchData = async () => {
            try {
                setLoading(true);
                setError(null);

                const klines = await binanceService.getKlines(symbol, timeframe, 200);
                if (cancelled || !klines || klines.length === 0) return;

                const data = klines.map(k => ({
                    time: k.openTime / 1000,
                    open: k.open, high: k.high, low: k.low, close: k.close,
                }));

                s.candles.setData(data);
                setCurrentPrice(data[data.length - 1].close);

                // Volume
                s.volume.setData(klines.map(k => ({
                    time: k.openTime / 1000,
                    value: k.volume,
                    color: k.close >= k.open ? 'rgba(38, 166, 154, 0.4)' : 'rgba(239, 83, 80, 0.4)',
                })));

                const closes = klines.map(k => k.close);

                // Bollinger Bands
                const bb = calculateBollingerBands(closes, 20, 2);
                if (bb && bb.upper) {
                    const bbData = bb.upper.slice(19).map((_, i) => ({ time: data[i + 19].time }));
                    s.bbUpper.setData(bbData.map((d, i) => ({ ...d, value: bb.upper[i + 19] })));
                    s.bbMiddle.setData(bbData.map((d, i) => ({ ...d, value: bb.middle[i + 19] })));
                    s.bbLower.setData(bbData.map((d, i) => ({ ...d, value: bb.lower[i + 19] })));
                }

                // EMAs
                const ema20 = calculateEMA(closes, 20);
                const ema50 = calculateEMA(closes, 50);
                s.ema20.setData(ema20.slice(19).map((val, i) => ({ time: data[i + 19].time, value: val })));
                s.ema50.setData(ema50.slice(49).map((val, i) => ({ time: data[i + 49].time, value: val })));

                // S/R
                const srLevels = findSupportResistance(klines);
                setLevels(srLevels);
                if (srLevels.support) s.support.setData([{ time: data[0].time, value: srLevels.support }, { time: data[data.length - 1].time, value: srLevels.support }]);
                if (srLevels.resistance) s.resistance.setData([{ time: data[0].time, value: srLevels.resistance }, { time: data[data.length - 1].time, value: srLevels.resistance }]);

                // Signal SL/TP
                if (signal && signal.levels) {
                    const { entry, stopLoss, takeProfit1 } = signal.levels;
                    if (entry) s.entry.setData([{ time: data[0].time, value: entry }, { time: data[data.length - 1].time, value: entry }]);
                    if (stopLoss) s.sl.setData([{ time: data[0].time, value: stopLoss }, { time: data[data.length - 1].time, value: stopLoss }]);
                    if (takeProfit1) s.tp.setData([{ time: data[0].time, value: takeProfit1 }, { time: data[data.length - 1].time, value: takeProfit1 }]);
                }

                // RSI
                const rsi = calculateRSI(closes, 14);
                setIndicators(prev => ({ ...prev, rsi: rsi[rsi.length - 1] }));
                s.rsi.setData(rsi.slice(14).map((val, i) => ({ time: data[i + 14].time, value: val })));
                s.rsi30.setData([{ time: data[14].time, value: 30 }, { time: data[data.length - 1].time, value: 30 }]);
                s.rsi70.setData([{ time: data[14].time, value: 70 }, { time: data[data.length - 1].time, value: 70 }]);

                // MACD
                const macd = calculateMACD(closes);
                setIndicators(prev => ({ ...prev, macd: macd.histogram[macd.histogram.length - 1] }));
                const startIdx = 26;
                s.macdHist.setData(macd.histogram.slice(startIdx).map((val, i) => ({
                    time: data[i + startIdx].time, value: val,
                    color: val >= 0 ? 'rgba(38, 166, 154, 0.7)' : 'rgba(239, 83, 80, 0.7)',
                })));
                s.macdLine.setData(macd.macd.slice(startIdx).map((val, i) => ({ time: data[i + startIdx].time, value: val })));
                s.macdSignal.setData(macd.signal.slice(startIdx).map((val, i) => ({ time: data[i + startIdx].time, value: val })));

                // Patterns
                const detectedPatterns = [];
                const lastCandle = klines[klines.length - 1];
                const prevCandle = klines[klines.length - 2];
                if (isHammer(lastCandle)) detectedPatterns.push({ type: 'Hammer', bullish: true });
                if (isBullishEngulfing(prevCandle, lastCandle)) detectedPatterns.push({ type: 'Bullish Engulfing', bullish: true });
                setPatterns(detectedPatterns);

                // Prediction
                if (timeframe === '1h' && klines.length >= 50) {
                    setPrediction(calculateTrendPrediction(klines));
                } else {
                    setPrediction(null);
                }

                // SMC Analysis (Order Blocks & FVG)
                if (showOverlays.smc) {
                    const obs = detectOrderBlocks(klines);
                    // const fvgs = findFairValueGaps(klines); // Future implementation

                    // Draw Bullish OBs
                    if (obs.bullish) {
                        obs.bullish.forEach(ob => {
                            const l1 = s.candles.createPriceLine({
                                price: ob.top,
                                color: 'rgba(34, 197, 94, 0.6)',
                                lineWidth: 1,
                                lineStyle: 0,
                                axisLabelVisible: false,
                                title: 'Bull OB'
                            });
                            const l2 = s.candles.createPriceLine({
                                price: ob.bottom,
                                color: 'rgba(34, 197, 94, 0.3)',
                                lineWidth: 1,
                                lineStyle: 2,
                                axisLabelVisible: false
                            });
                            smcLinesRef.current.push(l1, l2);
                        });
                    }

                    // Draw Bearish OBs
                    if (obs.bearish) {
                        obs.bearish.forEach(ob => {
                            const l1 = s.candles.createPriceLine({
                                price: ob.bottom,
                                color: 'rgba(239, 68, 68, 0.6)',
                                lineWidth: 1,
                                lineStyle: 0,
                                axisLabelVisible: false,
                                title: 'Bear OB'
                            });
                            const l2 = s.candles.createPriceLine({
                                price: ob.top,
                                color: 'rgba(239, 68, 68, 0.3)',
                                lineWidth: 1,
                                lineStyle: 2,
                                axisLabelVisible: false
                            });
                            smcLinesRef.current.push(l1, l2);
                        });
                    }
                }

                charts.main.timeScale().fitContent();
                setLoading(false);
            } catch (err) {
                if (!cancelled) {
                    console.error('Error loading chart:', err);
                    setError('Error al cargar gráfico');
                    setLoading(false);
                }
            }
        };

        fetchData();

        return () => { cancelled = true; };
    }, [symbol, timeframe, signal, showOverlays]); // Added showOverlays to trigger redraw

    // Ref for SMC lines to support cleanup
    const smcLinesRef = useRef([]);

    // Cleanup effect (runs before next effect or unmount)
    useEffect(() => {
        return () => {
            const s = seriesRef.current;
            if (s && s.candles && smcLinesRef.current.length > 0) {
                smcLinesRef.current.forEach(line => {
                    try { s.candles.removePriceLine(line); } catch (e) { }
                });
            }
        };
    }, []);


    const toggleOverlay = (key) => setShowOverlays(prev => ({ ...prev, [key]: !prev[key] }));

    return (
        <div className="crypto-chart-container fade-in">
            {/* Header */}
            <div className="chart-header">
                <div className="chart-title-section">
                    <span className="chart-title">{(symbol || '').replace('USDC', '')}</span>
                    {currentPrice && <span className="chart-price">${formatPrice(currentPrice)}</span>}
                </div>
                <div className="chart-controls">
                    {TIMEFRAMES.map(tf => (
                        <button key={tf.value} className={`tf-btn ${timeframe === tf.value ? 'active' : ''}`}
                            onClick={() => setTimeframe(tf.value)}>{tf.label}</button>
                    ))}
                </div>
            </div>

            {/* Overlay Toggles */}
            <div className="overlay-toggles">
                <button className={`toggle-btn ${showOverlays.ema ? 'active' : ''}`} onClick={() => toggleOverlay('ema')}>EMA</button>
                <button className={`toggle-btn ${showOverlays.bb ? 'active' : ''}`} onClick={() => toggleOverlay('bb')}>BB</button>
                <button className={`toggle-btn ${showOverlays.sr ? 'active' : ''}`} onClick={() => toggleOverlay('sr')}>S/R</button>
                <button className={`toggle-btn ${showOverlays.smc ? 'active' : ''}`} onClick={() => toggleOverlay('smc')}>SMC</button>
                {signal && <button className={`toggle-btn ${showOverlays.signal ? 'active' : ''}`} onClick={() => toggleOverlay('signal')}>Signal</button>}
                <span className="toggle-separator">|</span>
                <button className={`toggle-btn ${showRSI ? 'active' : ''}`} onClick={() => setShowRSI(!showRSI)}>RSI</button>
                <button className={`toggle-btn ${showMACD ? 'active' : ''}`} onClick={() => setShowMACD(!showMACD)}>MACD</button>
            </div>

            {/* Quick Info */}
            {!loading && !error && (
                <div className="chart-quick-info">
                    {levels.support && <span className="qi-item support"><Shield size={12} /> ${formatPrice(levels.support)}</span>}
                    {levels.resistance && <span className="qi-item resistance"><Target size={12} /> ${formatPrice(levels.resistance)}</span>}
                    {indicators.rsi && (
                        <span className={`qi-item ${indicators.rsi < 30 ? 'oversold' : indicators.rsi > 70 ? 'overbought' : ''}`}>
                            RSI: {indicators.rsi.toFixed(0)}
                        </span>
                    )}
                    {prediction && (
                        <span className={`qi-item ${prediction.predictedTrend === 'UP' ? 'bullish' : prediction.predictedTrend === 'DOWN' ? 'bearish' : ''}`}>
                            {prediction.predictedTrend === 'UP' ? <TrendingUp size={12} /> : prediction.predictedTrend === 'DOWN' ? <TrendingDown size={12} /> : null}
                            {prediction.bullishProbability}%
                        </span>
                    )}
                    {patterns.map((p, i) => (
                        <span key={i} className={`qi-item pattern ${p.bullish ? 'bullish' : 'bearish'}`}>{p.type}</span>
                    ))}
                </div>
            )}

            {/* Signal Info */}
            {signal && signal.levels && showOverlays.signal && (
                <div className="signal-bar">
                    <span className={signal.type === 'BUY' ? 'buy' : 'sell'}>
                        {signal.type === 'BUY' ? '🟢' : '🔴'} {signal.type} (Score: {signal.score})
                    </span>
                    <span className="entry">Entry: ${formatPrice(signal.levels.entry)}</span>
                    <span className="sl">SL: ${formatPrice(signal.levels.stopLoss)}</span>
                    <span className="tp">TP: ${formatPrice(signal.levels.takeProfit1)}</span>
                </div>
            )}

            {/* Main Chart */}
            <div className="chart-wrapper" ref={chartContainerRef}>
                {loading && <div className="chart-loading"><RefreshCw className="spinner" size={24} /></div>}
                {error && <div className="chart-error"><p>{error}</p></div>}
            </div>

            {/* RSI Panel - always rendered, visibility controlled by CSS */}
            <div className={`indicator-panel ${!showRSI ? 'hidden' : ''}`}>
                <span className="panel-label">RSI (14)</span>
                <div className="indicator-chart" ref={rsiContainerRef}></div>
            </div>

            {/* MACD Panel */}
            <div className={`indicator-panel ${!showMACD ? 'hidden' : ''}`}>
                <span className="panel-label">MACD</span>
                <div className="indicator-chart" ref={macdContainerRef}></div>
            </div>
        </div>
    );
}

export default CryptoChart;
