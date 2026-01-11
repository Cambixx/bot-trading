import React, { useState, useEffect } from 'react';
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
import { calculateMLMovingAverage } from './services/mlMovingAverage';
import { enrichSignalWithAI } from './services/aiAnalysis';
import { usePaperTrading } from './hooks/usePaperTrading';
import { useSignalHistory } from './hooks/useSignalHistory';

const REFRESH_INTERVAL = 20 * 60 * 1000; // 20 minutos
const STORAGE_KEY = 'trading_bot_symbols';

// Función para enviar señales a Telegram via Netlify Function
async function sendToTelegram(signals) {
  try {
    // URL de la Netlify Function (endpoint dedicado para notificaciones desde cliente)
    // URL relativa para que el proxy de Vite (en dev) o Netlify (en prod) maneje la ruta
    const functionUrl = '/.netlify/functions/send-telegram';

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-notify-secret': import.meta.env.VITE_NOTIFY_SECRET || ''
      },
      body: JSON.stringify({ signals })
    });

    const contentType = response.headers.get('content-type') || '';
    if (response.ok) {
      if (contentType.includes('application/json')) {
        const result = await response.json();
        console.log('📱 Telegram notificación enviada:', result);
        return { success: true, result };
      }
      const text = await response.text();
      console.warn('Telegram notification non-JSON response:', text);
      return { success: false, error: text };
    }

    const text = await response.text();
    console.warn('Telegram notification failed:', text);
    return { success: false, error: text };
  } catch (error) {
    console.error('Error enviando a Telegram:', error);
    return { success: false, error: error.message };
  }
}

// StatusBar component - memoized to prevent re-renders from parent state changes
const StatusBar = React.memo(({ loading, error, lastUpdate, tradingMode, isRefreshing, handleRefresh }) => (
  <div className="status-bar mb-lg">
    <div className="status-item">
      <div className={`status-dot ${loading ? 'loading' : error ? 'error' : ''}`} />
      <span>{loading ? 'Analizando...' : error ? 'Error' : 'Conectado'}</span>
    </div>

    {lastUpdate && (
      <div className="status-item">
        <span className="text-muted">Última actualización: {lastUpdate.toLocaleTimeString()}</span>
      </div>
    )}

    <div className="status-item">
      <div
        className="mode-selector"
        onClick={() => window.location.href = '/settings'}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '0.25rem 0.5rem', borderRadius: '8px', cursor: 'pointer' }}
        title="Ir a Ajustes"
      >
        <SettingsIcon size={14} className="text-muted" />
        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
          {tradingMode === 'CONSERVATIVE' && 'Conservador'}
          {tradingMode === 'BALANCED' && 'Equilibrado'}
          {tradingMode === 'RISKY' && 'Arriesgado'}
          {tradingMode === 'SCALPING' && 'Scalping'}
        </span>
      </div>
    </div>

    <div className="status-item gap-sm">
      <button
        onClick={handleRefresh}
        className="btn-primary"
        disabled={isRefreshing || loading}
        title={isRefreshing || loading ? 'Actualizando...' : 'Actualizar datos'}
        style={{
          opacity: isRefreshing || loading ? 0.6 : 1,
          minWidth: '40px',
          minHeight: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <RefreshCw size={16} className={isRefreshing || loading ? 'spin' : ''} />
      </button>
    </div>
  </div>
));

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
  const [mlSignals, setMlSignals] = useState([]);
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

        setSymbols(prev => {
          const merged = [...new Set([...prev, ...smartCoins])];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          return merged;
        });

      } catch (error) {
        console.error('Error loading smart coins:', error);
        // Fallback robusto
        setSymbols(prev => {
          const fallback = [...new Set([...prev, 'BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'XRPUSDC'])];
          return fallback;
        });
      }
    };

    loadInitialSymbols();
  }, []);

  // Set default chart symbol when symbols are loaded
  useEffect(() => {
    if (symbols.length > 0 && !selectedChartSymbol) {
      setSelectedChartSymbol(symbols[0]);
    }
  }, [symbols, selectedChartSymbol]);

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

      const orderBooks = await binanceService.getMultipleOrderBooks(symbols, 20);

      // 4.1 Generar señales ML (LuxAlgo)
      const calculatedMlSignals = [];
      for (const symbol of symbols) {
        if (candleData[symbol]?.data && candleData[symbol].data.length >= 30) {
          const closes = candleData[symbol].data.map(c => c.close);
          const mlResult = calculateMLMovingAverage(closes, { window: 30, forecast: 2 });
          if (mlResult) {
            calculatedMlSignals.push({
              symbol,
              ...mlResult,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
      setMlSignals(calculatedMlSignals);

      // 4.2 Notificar nuevas señales ML por Telegram
      if (calculatedMlSignals.length > 0 && mlSignals.length > 0) {
        const newMlSignals = calculatedMlSignals.filter(newSig =>
          !mlSignals.some(oldSig => oldSig.symbol === newSig.symbol && oldSig.signal === newSig.signal)
        );

        if (newMlSignals.length > 0) {
          const telegramPayload = newMlSignals.map(s => {
            const signalCode = typeof s.signal === 'string' ? s.signal : 'UNKNOWN';
            const directionLabel = signalCode === 'UPPER_EXTREMITY'
              ? 'SHORT 🔴'
              : signalCode === 'LOWER_EXTREMITY'
                ? 'LONG 🟢'
                : 'WATCH';
            const signalLabel = signalCode.replace(/_/g, ' ');

            return {
              symbol: s.symbol,
              price: s.price,
              score: 99, // High score to show Green icon
              reasons: [`🤖 ML Alert: ${directionLabel} (${signalLabel})`],
              levels: { entry: s.price }
            };
          });
          sendToTelegram(telegramPayload);
        }
      }

      // 5. Generar señales
      let generatedSignals = analyzeMultipleSymbols(candleData, multiTimeframeAnalysis, tradingMode, orderBooks);

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
          // Calcular Scores Bidireccionales (Long y Short)
          let longScore = 0;
          let shortScore = 0;

          if (analysis?.indicators) {
            const ind = analysis.indicators;

            // 1. RSI (Oscilador)
            if (ind.rsi < 30) longScore += 30;      // Sobreventa -> Long
            else if (ind.rsi < 45) longScore += 15;
            
            if (ind.rsi > 70) shortScore += 30;     // Sobrecompra -> Short
            else if (ind.rsi > 55) shortScore += 15;

            // 2. MACD (Momentum)
            if (ind.macd?.histogram > 0) longScore += 20;
            else shortScore += 20;

            // 3. Tendencia (EMAs)
            if (ind.ema20 && ind.ema50) {
              if (ind.ema20 > ind.ema50) {
                longScore += 20; // Tendencia Alcista
                if (data.price < ind.ema20) longScore += 10; // Pullback
              } else {
                shortScore += 20; // Tendencia Bajista
                if (data.price > ind.ema20) shortScore += 10; // Rebote a media
              }
            }

            // 4. Bandas de Bollinger (Reversión)
            if (ind.bollingerBands) {
              if (data.price <= ind.bollingerBands.lower) longScore += 20;
              if (data.price >= ind.bollingerBands.upper) shortScore += 20;
            }
          }

          const finalScore = Math.max(longScore, shortScore);
          const opportunityType = longScore >= shortScore ? 'LONG' : 'SHORT';
          const opportunityScore = Math.min(100, finalScore);

          cryptoPrices[symbol] = {
            symbol,
            price: data.price,
            priceChangePercent: data.priceChangePercent,
            volume24h: data.volume24h,
            high24h: data.high24h,
            low24h: data.low24h,
            analysis: analysis,
            opportunity: opportunityScore,
            opportunityType: opportunityType // 'LONG' | 'SHORT'
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

      // 9. Enviar señales de alta calidad a Telegram (score >= 60)
      const TELEGRAM_THRESHOLD = 60;
      const telegramCandidates = generatedSignals.filter(s => s.score >= TELEGRAM_THRESHOLD);
      if (telegramCandidates.length > 0 && signals.length > 0) {
        // Solo enviar señales NUEVAS que no estaban antes
        const newTelegramSignals = telegramCandidates.filter(
          newSig => !signals.some(oldSig => oldSig.symbol === newSig.symbol && oldSig.score >= TELEGRAM_THRESHOLD)
        );
        if (newTelegramSignals.length > 0) {
          sendToTelegram(newTelegramSignals);
        }
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

  const handleSimulateBuy = async (signal) => {
    try {
      const result = await openPosition(signal, riskPerTrade);
      if (result.success) {
        console.log('Posición abierta:', signal.symbol);
        alert(`✅ Posición abierta: ${signal.symbol} a $${signal.price.toFixed(2)}`);
      } else {
        alert(result.error || 'Error al abrir posición');
      }
    } catch (err) {
      console.error('Error en handleSimulateBuy:', err);
      alert(err.message || 'Error inesperado al simular compra');
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
  }, [symbols, signals, mlSignals, notificationsEnabled]);

  // Status Bar Component (to be passed to Layout or rendered here if Layout accepts it)
  // For now, we'll render it inside the Layout via a prop or context? 
  // Actually, Layout is a wrapper. We can put the StatusBar in the Layout or keep it here and pass it down?
  // Better approach: Render the Status Bar inside App, but positioned correctly?
  // No, that would be inside the content area. That's fine.

  const handleTestSignal = async () => {
    const testSignal = {
      symbol: 'TESTUSDC',
      price: 99999.99,
      score: 95,
      signal: 'UPPER_EXTREMITY',
      reasons: ['🤖 ML Alert: UPPER_EXTREMITY'],
      levels: { entry: 99999.99 }
    };

    const secret = import.meta.env.VITE_NOTIFY_SECRET;
    const hasSecret = secret && secret.length > 0;

    if (!hasSecret) {
      alert('⚠️ Error: VITE_NOTIFY_SECRET está vacío en .env. La notificación fallará.');
    }

    const { success, error, result } = await sendToTelegram([testSignal]);

    if (success) {
      alert(`✅ Éxito! Notificación enviada.\nRespuesta: ${JSON.stringify(result)}`);
    } else {
      alert(`❌ Error al enviar.\nDetalle: ${error}\nSecret Presente: ${hasSecret}`);
    }
  };

  // StatusBar props for the memoized component
  const statusBarProps = {
    loading,
    error,
    lastUpdate,
    tradingMode,
    isRefreshing,
    handleRefresh
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route path="/*" element={
          <PrivateRoute>
            <Layout>
              <StatusBar {...statusBarProps} />

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
                    mlSignals={mlSignals}
                    loading={loading}
                    handleSimulateBuy={handleSimulateBuy}
                    onTestSignal={handleTestSignal}
                  />
                } />

                <Route path="/chart" element={
                  <ChartPage
                    symbols={symbols}
                    selectedChartSymbol={selectedChartSymbol}
                    setSelectedChartSymbol={setSelectedChartSymbol}
                    signals={signals}
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
