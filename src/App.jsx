import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import './App.css';

// Context
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { AuthProvider, useAuth } from './context/AuthContext';

// Components
import Layout from './components/Layout';

// Pages
import Dashboard from './pages/Dashboard';
import ChartPage from './pages/ChartPage';
import PortfolioPage from './pages/PortfolioPage';
import BacktestPage from './pages/BacktestPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';

// Services & Hooks
import binanceService from './services/binanceService';
import { performTechnicalAnalysis } from './services/technicalAnalysis';
import { analyzeMultipleSymbols } from './services/signalGenerator';
import { enrichSignalWithAI } from './services/aiAnalysis';
import { usePaperTrading } from './hooks/usePaperTrading';
import { useSignalHistory } from './hooks/useSignalHistory';

const REFRESH_INTERVAL = 20 * 60 * 1000; // 20 minutos
const STORAGE_KEY = 'trading_bot_symbols';

// Componente para proteger rutas
const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="status-dot loading"></div>
        <span style={{ color: 'var(--text-muted)' }}>Cargando sesión...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

function AppContent() {
  const { tradingMode, notificationsEnabled, riskPerTrade, watchlist } = useSettings();

  const [symbols, setSymbols] = useState([]);
  const [selectedChartSymbol, setSelectedChartSymbol] = useState(null);
  const [cryptoData, setCryptoData] = useState({});
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Paper Trading Hook
  const { portfolio, openPosition, closePosition, resetPortfolio } = usePaperTrading();

  // Signal History Hook
  const { history, trackSignal, getStats } = useSignalHistory();

  // Cargar símbolos: Smart Scan + Favoritos
  useEffect(() => {
    const loadInitialSymbols = async () => {
      try {
        // Lanzar Smart Scan al inicio
        const smartCoins = await binanceService.getSmartOpportunityCoins(12);

        // Combinar con Watchlist (Favoritos)
        // Usamos Set para evitar duplicados
        const mergedSymbols = [...new Set([...watchlist, ...smartCoins])];

        setSymbols(mergedSymbols);
        if (mergedSymbols.length > 0) {
          setSelectedChartSymbol(mergedSymbols[0]);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedSymbols));
      } catch (error) {
        console.error('Error loading smart coins:', error);
        // Fallback robusto
        const fallbackSymbols = [...new Set([...watchlist, 'BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'XRPUSDC'])];
        setSymbols(fallbackSymbols);
        if (fallbackSymbols.length > 0) {
          setSelectedChartSymbol(fallbackSymbols[0]);
        }
      }
    };

    loadInitialSymbols();
  }, []);

  // Sincronizar favoritos (Watchlist) con la lista activa
  useEffect(() => {
    if (watchlist.length > 0) {
      setSymbols(prev => {
        const newSymbols = [...new Set([...prev, ...watchlist])];
        if (newSymbols.length !== prev.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newSymbols));
          return newSymbols;
        }
        return prev;
      });
    }
  }, [watchlist]);

  // Guardar símbolos en localStorage cuando cambien
  const handleSymbolsChange = (newSymbols) => {
    setSymbols(newSymbols);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSymbols));
  };

  // Función para obtener datos y generar señales
  const fetchDataAndAnalyze = async () => {
    if (symbols.length === 0) return;

    try {
      setError(null);

      // 1. Obtener datos de precios actuales
      const pricePromises = symbols.map(symbol =>
        binanceService.getCurrentPrice(symbol)
          .then(data => ({ symbol, data, error: null }))
          .catch(err => ({ symbol, data: null, error: err.message }))
      );
      const priceResults = await Promise.all(pricePromises);

      // 2. Obtener datos de velas para análisis (1h)
      const candleData = await binanceService.getMultipleSymbolsData(symbols, '1h', 100);

      // 3. Obtener datos multi-timeframe
      const candleData4h = await binanceService.getMultipleSymbolsData(symbols, '4h', 50);
      const candleData1d = await binanceService.getMultipleSymbolsData(symbols, '1d', 50);
      const candleData15m = await binanceService.getMultipleSymbolsData(symbols, '15m', 50);

      // 4. Realizar análisis técnico
      const multiTimeframeAnalysis = {};
      for (const symbol of symbols) {
        multiTimeframeAnalysis[symbol] = {};
        if (candleData4h[symbol]?.data) multiTimeframeAnalysis[symbol]['4h'] = performTechnicalAnalysis(candleData4h[symbol].data);
        if (candleData1d[symbol]?.data) multiTimeframeAnalysis[symbol]['1d'] = performTechnicalAnalysis(candleData1d[symbol].data);
        if (candleData15m[symbol]?.data) multiTimeframeAnalysis[symbol]['15m'] = performTechnicalAnalysis(candleData15m[symbol].data);
      }

      // 5. Generar señales
      let generatedSignals = analyzeMultipleSymbols(candleData, multiTimeframeAnalysis, tradingMode);

      // 5.1 Enriquecer señales con IA
      const highQualitySignals = generatedSignals
        .filter(s => s.score >= 60)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (highQualitySignals.length > 0) {
        console.log(`Enriqueciendo ${highQualitySignals.length} señales con IA...`);
        for (const signal of highQualitySignals) {
          try {
            const enrichedSignal = await enrichSignalWithAI(signal, {
              rsi: signal.indicators.rsi,
              macd: signal.indicators.macd
            }, tradingMode);
            const index = generatedSignals.findIndex(s => s.symbol === signal.symbol);
            if (index !== -1) generatedSignals[index] = enrichedSignal;
            if (highQualitySignals.indexOf(signal) < highQualitySignals.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          } catch (err) {
            console.error(`Error enriching signal for ${signal.symbol}: `, err);
          }
        }
      }

      // 6. Actualizar estado
      const cryptoPrices = {};
      priceResults.forEach(({ symbol, data }) => {
        if (data) {
          const analysis = candleData[symbol]?.data ? performTechnicalAnalysis(candleData[symbol].data) : null;
          let opportunityScore = 0;
          if (analysis?.indicators) {
            const ind = analysis.indicators;
            if (ind.rsi < 30) opportunityScore += 30;
            else if (ind.rsi < 45) opportunityScore += 15;
            else if (ind.rsi > 70) opportunityScore -= 10;
            if (ind.macd?.histogram > 0) opportunityScore += 20;
            if (ind.ema20 && ind.ema50 && ind.ema20 > ind.ema50) {
              opportunityScore += 20;
              if (data.price < ind.ema20) opportunityScore += 10;
            }
            if (ind.bollingerBands && data.price <= ind.bollingerBands.lower) opportunityScore += 20;
            opportunityScore = Math.max(0, Math.min(100, opportunityScore));
          }

          cryptoPrices[symbol] = {
            symbol,
            price: data.price,
            priceChangePercent: data.priceChangePercent,
            volume24h: data.volume24h,
            high24h: data.high24h,
            low24h: data.low24h,
            analysis: analysis,
            opportunity: opportunityScore
          };
        }
      });

      setCryptoData(cryptoPrices);

      // 8. Notificar nuevas señales
      if (generatedSignals.length > 0 && signals.length > 0 && notificationsEnabled) {
        const newSignals = generatedSignals.filter(
          newSig => !signals.some(oldSig => oldSig.symbol === newSig.symbol)
        );
        newSignals.forEach(signal => showNotification(signal));
      }

      // Track signals
      generatedSignals.forEach(signal => trackSignal(signal));

      setSignals(generatedSignals);
      setLastUpdate(new Date());
      setLoading(false);

    } catch (err) {
      console.error('Error fetching data:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const showNotification = (signal) => {
    try {
      if (notificationsEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(`🚀 Nueva Señal: ${signal.symbol} `, {
          body: `Precio: $${signal.price} | Score: ${signal.score} | Confianza: ${signal.confidence} `,
          icon: '/vite.svg',
          tag: signal.symbol
        });
      }
    } catch (e) {
      console.warn('Failed to show Notification:', e && e.message);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchDataAndAnalyze();
    setIsRefreshing(false);
  };

  const handleSimulateBuy = (signal) => {
    const result = openPosition(signal, riskPerTrade);
    if (result.success) {
      console.log('Posición abierta:', signal.symbol);
      // Optional: Navigate to portfolio or show toast
    } else {
      alert(result.error);
    }
  };

  // Effects
  useEffect(() => {
    if (symbols.length > 0) fetchDataAndAnalyze();
  }, [symbols, tradingMode]);

  useEffect(() => {
    if (symbols.length === 0) return;
    const handleWebSocketMessage = (ticker) => {
      setCryptoData(prevData => {
        const currentCrypto = prevData[ticker.symbol];
        if (!currentCrypto) return prevData;
        return {
          ...prevData,
          [ticker.symbol]: {
            ...currentCrypto,
            price: ticker.price,
            priceChangePercent: ticker.priceChangePercent,
            volume24h: ticker.volume24h,
            high24h: ticker.high24h,
            low24h: ticker.low24h,
          }
        };
      });
    };
    binanceService.subscribeToTickers(symbols, handleWebSocketMessage);
    return () => binanceService.disconnect();
  }, [symbols]);

  useEffect(() => {
    if (symbols.length === 0) return;
    const interval = setInterval(() => {
      fetchDataAndAnalyze();
    }, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [symbols, signals, notificationsEnabled]);

  // Status Bar Component (to be passed to Layout or rendered here if Layout accepts it)
  // For now, we'll render it inside the Layout via a prop or context? 
  // Actually, Layout is a wrapper. We can put the StatusBar in the Layout or keep it here and pass it down?
  // Better approach: Render the Status Bar inside App, but positioned correctly?
  // No, that would be inside the content area. That's fine.

  const StatusBar = () => (
    <div className="status-bar mb-lg">
      <div className="status-item">
        <div className={`status - dot ${loading ? 'loading' : error ? 'error' : ''} `} />
        <span>{loading ? 'Analizando...' : error ? 'Error' : 'Conectado'}</span>
      </div>

      {lastUpdate && (
        <div className="status-item">
          <span className="text-muted">Última actualización: {lastUpdate.toLocaleTimeString()}</span>
        </div>
      )}

      <div className="status-item">
        <div className="mode-selector" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '0.25rem', borderRadius: '8px' }}>
          <SettingsIcon size={14} className="text-muted" />
          <span className="text-muted" style={{ fontSize: '0.85rem' }}>
            {tradingMode === 'CONSERVATIVE' && 'Conservador'}
            {tradingMode === 'BALANCED' && 'Equilibrado'}
            {tradingMode === 'RISKY' && 'Arriesgado'}
          </span>
        </div>
      </div>

      <div className="status-item gap-sm">
        <button
          onClick={handleRefresh}
          className="btn-primary"
          disabled={isRefreshing || loading}
          title={isRefreshing || loading ? 'Actualizando...' : 'Actualizar datos'}
          style={{ opacity: isRefreshing || loading ? 0.6 : 1 }}
        >
          <RefreshCw size={16} className={isRefreshing || loading ? 'spin' : ''} />
        </button>
      </div>
    </div>
  );

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route path="/*" element={
          <PrivateRoute>
            <Layout>
              <StatusBar />

              {error && (
                <div className="error-container mb-lg">
                  <h3>Error al cargar datos</h3>
                  <p>{error}</p>
                  <button onClick={handleRefresh} className="btn-primary mt-md">
                    Intentar de nuevo
                  </button>
                </div>
              )}

              <Routes>
                <Route path="/" element={
                  <Dashboard
                    symbols={symbols}
                    handleSymbolsChange={handleSymbolsChange}
                    cryptoData={cryptoData}
                    signals={signals}
                    loading={loading}
                    handleSimulateBuy={handleSimulateBuy}
                  />
                } />

                <Route path="/chart" element={
                  <ChartPage
                    symbols={symbols}
                    selectedChartSymbol={selectedChartSymbol}
                    setSelectedChartSymbol={setSelectedChartSymbol}
                  />
                } />

                <Route path="/portfolio" element={
                  <PortfolioPage
                    portfolio={portfolio}
                    cryptoData={cryptoData}
                    closePosition={closePosition}
                    resetPortfolio={resetPortfolio}
                    stats={getStats()}
                    history={history}
                  />
                } />

                <Route path="/backtest" element={
                  <BacktestPage symbols={symbols} />
                } />

                <Route path="/settings" element={
                  <SettingsPage />
                } />
              </Routes>
            </Layout>
          </PrivateRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <AppContent />
      </SettingsProvider>
    </AuthProvider>
  );
}

export default App;
