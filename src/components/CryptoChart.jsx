import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries } from 'lightweight-charts';
import { X, RefreshCw } from 'lucide-react';
import binanceService from '../services/binanceService';
import './CryptoChart.css';

function CryptoChart({ symbol, onClose }) {
    const chartContainerRef = useRef();
    const chartRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

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

        // Fetch Data
        const fetchData = async () => {
            try {
                setLoading(true);
                // Fetch 1h candles, 200 limit for good history
                const klines = await binanceService.getKlines(symbol, '1h', 200);

                const data = klines.map(k => ({
                    time: k.openTime / 1000, // lightweight-charts expects seconds
                    open: k.open,
                    high: k.high,
                    low: k.low,
                    close: k.close,
                }));

                candlestickSeries.setData(data);
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
                <button onClick={onClose} className="btn-close-chart" title="Cerrar Gráfico">
                    <X size={16} />
                </button>
            </div>

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
