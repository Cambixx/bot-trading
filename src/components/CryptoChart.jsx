import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { X, RefreshCw, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import binanceService from '../services/binanceService';
import { calculateTrendPrediction } from '../services/predictionService';
import { calculateSupertrend } from '../services/technicalAnalysis';
import './CryptoChart.css';

function CryptoChart({ symbol, onClose }) {
    const chartContainerRef = useRef();
    const chartRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [prediction, setPrediction] = useState(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // Create Chart
        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#d1d5db',
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
            },
            width: chartContainerRef.current.clientWidth,
            height: 300,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });

        chartRef.current = chart;

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
        });

        // Supertrend Series (Bullish - Green)
        const stBullishSeries = chart.addSeries(LineSeries, {
            color: '#22c55e',
            lineWidth: 2,
        });

        // Supertrend Series (Bearish - Red)
        const stBearishSeries = chart.addSeries(LineSeries, {
            color: '#ef4444',
            lineWidth: 2,
        });

        // Fetch Data
        const fetchData = async () => {
            try {
                setLoading(true);
                // Fetch 1h candles, 500 limit for better prediction history
                const klines = await binanceService.getKlines(symbol, '1h', 500);

                const data = klines.map(k => ({
                    time: k.openTime / 1000, // lightweight-charts expects seconds
                    open: k.open,
                    high: k.high,
                    low: k.low,
                    close: k.close,
                }));

                candlestickSeries.setData(data);

                // Calculate Supertrend
                const supertrendData = calculateSupertrend(klines);

                // Split into bullish and bearish segments for coloring
                // Only add data points for the active trend (skip nulls)
                const bullishData = [];
                const bearishData = [];

                supertrendData.forEach(st => {
                    if (st) {
                        if (st.trend === 1) {
                            bullishData.push({ time: st.time, value: st.value });
                        } else {
                            bearishData.push({ time: st.time, value: st.value });
                        }
                    }
                });

                stBullishSeries.setData(bullishData);
                stBearishSeries.setData(bearishData);

                // Calculate Prediction
                const pred = calculateTrendPrediction(klines);
                setPrediction(pred);

                chart.timeScale().fitContent();
                setLoading(false);
            } catch (err) {
                console.error('Error loading chart data:', err);
                setError('Error al cargar datos del gráfico');
                setLoading(false);
            }
        };

        fetchData();

        // Resize Observer
        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [symbol]);

    return (
        <div className="crypto-chart-container fade-in">
            <div className="chart-header">
                <span className="chart-title">{symbol} - 1H</span>
                {onClose && (
                    <button onClick={onClose} className="btn-close-chart" title="Cerrar Gráfico">
                        <X size={16} />
                    </button>
                )}
            </div>

            {/* Prediction Panel - Now outside chart-wrapper for mobile */}
            {!loading && !error && prediction && (
                <div className="prediction-panel fade-in">
                    <div className="prediction-header">
                        <Activity size={14} />
                        <span>Predicción de Tendencia (500 velas)</span>
                    </div>
                    <div className="prediction-content">
                        <div className={`prediction-badge ${prediction.predictedTrend === 'UP' ? 'bullish' : prediction.predictedTrend === 'DOWN' ? 'bearish' : 'neutral'}`}>
                            {prediction.predictedTrend === 'UP' ? <TrendingUp size={16} /> : prediction.predictedTrend === 'DOWN' ? <TrendingDown size={16} /> : <Activity size={16} />}
                            <span>{prediction.predictedTrend === 'UP' ? 'ALCISTA' : prediction.predictedTrend === 'DOWN' ? 'BAJISTA' : 'NEUTRAL'}</span>
                        </div>
                        <div className="prediction-stats">
                            <div className="stat-item bullish">
                                <span className="label">Alcista</span>
                                <span className="value">{prediction.bullishProbability}%</span>
                            </div>
                            <div className="stat-item bearish">
                                <span className="label">Bajista</span>
                                <span className="value">{prediction.bearishProbability}%</span>
                            </div>
                        </div>
                        <div className="prediction-bar">
                            <div className="bar-fill bullish" style={{ width: `${prediction.bullishProbability}%` }}></div>
                            <div className="bar-fill bearish" style={{ width: `${prediction.bearishProbability}%` }}></div>
                        </div>
                    </div>
                </div>
            )}

            <div className="chart-wrapper" ref={chartContainerRef}>
                {loading && (
                    <div className="chart-loading">
                        <RefreshCw className="spinner" size={24} />
                    </div>
                )}
                {error && (
                    <div className="chart-error">
                        <p>{error}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default CryptoChart;
