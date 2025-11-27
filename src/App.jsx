import { useState, useEffect } from 'react';
import { Bell, BellOff, RefreshCw, Zap } from 'lucide-react';
import './App.css';
import SignalCard from './components/SignalCard';
import CryptoCard from './components/CryptoCard';
import CryptoSelector from './components/CryptoSelector';
import binanceService from './services/binanceService';
import { performTechnicalAnalysis } from './services/technicalAnalysis';
import { analyzeMultipleSymbols } from './services/signalGenerator';
import { enrichSignalWithAI } from './services/aiAnalysis';
import { usePaperTrading } from './hooks/usePaperTrading';
import { useSignalHistory } from './hooks/useSignalHistory';
import Portfolio from './components/Portfolio';
import WinRateStats from './components/WinRateStats';

const REFRESH_INTERVAL = 20 * 60 * 1000; // 20 minutos
const STORAGE_KEY = 'trading_bot_symbols';

function App() {
  const [symbols, setSymbols] = useState([]);
  const [cryptoData, setCryptoData] = useState({});
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);

  // Paper Trading Hook
  const { portfolio, openPosition, closePosition, resetPortfolio } = usePaperTrading();

  // Signal History Hook
  const { history, trackSignal, getStats } = useSignalHistory();

  // Cargar símbolos desde localStorage o top 10 por defecto
  useEffect(() => {
    const loadInitialSymbols = async () => {
      const savedSymbols = localStorage.getItem(STORAGE_KEY);

      if (savedSymbols) {
        // Usar símbolos guardados
        setSymbols(JSON.parse(savedSymbols));
      } else {
        // Cargar top 10 por volumen
        try {
          const topSymbols = await binanceService.getTopCryptosByVolume(10);
          setSymbols(topSymbols);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(topSymbols));
        } catch (error) {
          console.error('Error loading top cryptos:', error);
          // Fallback a símbolos populares
          const fallbackSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT'];
          setSymbols(fallbackSymbols);
        }
      }
    };

    loadInitialSymbols();
  }, []);

  // Guardar símbolos en localStorage cuando cambien
  const handleSymbolsChange = (newSymbols) => {
    setSymbols(newSymbols);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSymbols));
  };

  // Pedir permisos para notificaciones
  useEffect(() => {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
          setNotificationsEnabled(permission === 'granted');
        }).catch(() => { });
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        setNotificationsEnabled(true);
      }
    } catch (e) {
      // Some iOS environments may not expose Notification; ignore safely
      console.warn('Notification API not available:', e && e.message);
    }
  }, []);

  // Función para obtener datos y generar señales
  const fetchDataAndAnalyze = async () => {
    if (symbols.length === 0) {
      return; // No hacer nada si no hay símbolos cargados
    }

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

      // 3. Obtener datos de 4h para confirmación de tendencia
      const candleData4h = await binanceService.getMultipleSymbolsData(symbols, '4h', 50);

      // 4. Realizar análisis técnico y convertir para multi-timeframe
      const multiTimeframeAnalysis = {};
      for (const symbol of symbols) {
        if (candleData4h[symbol]?.data) {
          const analysis4h = performTechnicalAnalysis(candleData4h[symbol].data);
          multiTimeframeAnalysis[symbol] = { '4h': analysis4h };
        }
      }

      // 5. Generar señales (solo con análisis técnico)
      let generatedSignals = analyzeMultipleSymbols(candleData, multiTimeframeAnalysis);

      // 5.1 Enriquecer señales de alta calidad con IA
      // Filtramos señales con score > 60 para no saturar la API
      const highQualitySignals = generatedSignals.filter(s => s.score >= 60);

      if (highQualitySignals.length > 0) {
        // Procesar en paralelo
        const enrichedSignalsPromises = generatedSignals.map(async (signal) => {
          if (signal.score >= 60) {
            try {
              // Pasamos datos técnicos extra si es necesario
              return await enrichSignalWithAI(signal);
            } catch (err) {
              console.error(`Error enriching signal for ${signal.symbol}:`, err);
              return signal;
            }
          }
          return signal;
        });

        generatedSignals = await Promise.all(enrichedSignalsPromises);
      }

      // Send generated signals to serverless function for Telegram notifications
      // NOTE: we send all generated signals each analysis run so server can decide what to notify.
      (async () => {
        try {
          const notifySecret = import.meta.env.VITE_NOTIFY_SECRET || null;
          const headers = { 'Content-Type': 'application/json' };
          if (notifySecret) headers['x-notify-secret'] = notifySecret;

          await fetch('/.netlify/functions/scheduled-analysis', {
            method: 'POST',
            headers,
            body: JSON.stringify({ signals: generatedSignals })
          });
        } catch (e) {
          console.warn('Failed to notify server for Telegram:', e && e.message);
        }
      })();

      // 6. Actualizar estado
      const cryptoPrices = {};
      priceResults.forEach(({ symbol, data }) => {
        if (data) {
          // Agregar indicadores del análisis técnico
          const analysis = candleData[symbol]?.data ?
            performTechnicalAnalysis(candleData[symbol].data) : null;

          // Calculate opportunity score (same logic as CryptoCard)
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

        newSignals.forEach(signal => {
          showNotification(signal);
        });
      }

      // 6. Track signals for win rate calculation
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

  // Mostrar notificación del navegador
  const showNotification = (signal) => {
    try {
      if (notificationsEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(`🚀 Nueva Señal: ${signal.symbol}`, {
          body: `Precio: $${signal.price} | Score: ${signal.score} | Confianza: ${signal.confidence}`,
          icon: '/vite.svg',
          tag: signal.symbol
        });
      }
    } catch (e) {
      console.warn('Failed to show Notification:', e && e.message);
    }
  };

  // Toggle notificaciones
  const toggleNotifications = () => {
    try {
      if (!notificationsEnabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
          setNotificationsEnabled(permission === 'granted');
        }).catch(() => { });
      } else {
        setNotificationsEnabled(!notificationsEnabled);
      }
    } catch (e) {
      console.warn('Notification toggle failed:', e && e.message);
      setNotificationsEnabled(!notificationsEnabled);
    }
  };

  // Refresh manual
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchDataAndAnalyze();
    setIsRefreshing(false);
  };

  const handleSimulateBuy = (signal) => {
    const result = openPosition(signal, 1000); // Fixed $1000 amount for now
    if (result.success) {
      // Optional: Show toast notification
      console.log('Posición abierta:', signal.symbol);
      setShowPortfolio(true); // Switch to portfolio view or just notify
    } else {
      alert(result.error);
    }
  };

  // Cargar datos inicial (cuando symbols esté disponible)
  useEffect(() => {
    if (symbols.length > 0) {
      fetchDataAndAnalyze();
    }
  }, [symbols]);

  // Auto-refresh
  useEffect(() => {
    if (symbols.length === 0) return;

    const interval = setInterval(() => {
      fetchDataAndAnalyze();
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [symbols, signals, notificationsEnabled]);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <h1 className="app-title">
          <Zap style={{ display: 'inline', marginRight: '0.5rem' }} />
          Crypto Trading Signals Bot
        </h1>
        <p className="app-subtitle">
          Análisis técnico avanzado + Inteligencia Artificial para day trading spot
        </p>
      </header>

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-item">
          <div className={`status-dot ${loading ? 'loading' : error ? 'error' : ''}`} />
          <span>{loading ? 'Analizando...' : error ? 'Error' : 'Conectado'}</span>
        </div>

        {lastUpdate && (
          <div className="status-item">
            <span className="text-muted">Última actualización: {lastUpdate.toLocaleTimeString()}</span>
          </div>
        )}

        <div className="status-item gap-sm">
          <button
            onClick={toggleNotifications}
            className={`btn-${notificationsEnabled ? 'success' : 'primary'}`}
            title={notificationsEnabled ? 'Desactivar notificaciones' : 'Activar notificaciones'}
          >
            {notificationsEnabled ? <Bell size={16} /> : <BellOff size={16} />}
          </button>

          <button
            onClick={handleRefresh}
            className="btn-primary"
            disabled={isRefreshing}
            title="Actualizar datos"
          >
            <RefreshCw size={16} className={isRefreshing ? 'pulse' : ''} />
          </button>
        </div>

        <div className="status-item">
          <button
            onClick={() => setShowPortfolio(!showPortfolio)}
            className={`btn-${showPortfolio ? 'success' : 'secondary'}`}
            title="Ver Cartera Simulada"
          >
            💼 {showPortfolio ? 'Ocultar Cartera' : 'Ver Cartera'}
          </button>
        </div>
      </div>

      {/* Crypto Selector */}
      <CryptoSelector
        selectedSymbols={symbols}
        onSymbolsChange={handleSymbolsChange}
      />

      {/* Error Display */}
      {error && (
        <div className="error-container">
          <h3>Error al cargar datos</h3>
          <p>{error}</p>
          <button onClick={handleRefresh} className="btn-primary mt-md">
            Intentar de nuevo
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="loading-container">
          <div className="loading-spinner" />
          <p className="text-muted">Cargando datos del mercado...</p>
        </div>
      )}

      {/* Main Content */}
      {!loading && !error && (
        <>
          {/* Portfolio Section */}
          {showPortfolio && (
            <section className="portfolio-section mb-xl">
              <Portfolio
                portfolio={portfolio}
                currentPrices={cryptoData}
                onClosePosition={closePosition}
                onReset={resetPortfolio}
              />
            </section>
          )}



          {/* Crypto Prices Dashboard */}
          <section className="dashboard-section">
            <h2 className="mb-lg">Mercado</h2>
            <div className="dashboard-grid">
              {Object.values(cryptoData)
                .sort((a, b) => (b.opportunity || 0) - (a.opportunity || 0))
                .map(crypto => (
                  <CryptoCard key={crypto.symbol} crypto={crypto} />
                ))}
            </div>
          </section>

          {/* Trading Signals */}
          <section className="signals-section">
            <div className="signals-header">
              <h2 className="signals-title">
                Señales de Trading
                {signals.length > 0 && (
                  <span className="signal-count">{signals.length}</span>
                )}
              </h2>
            </div>

            {signals.length === 0 ? (
              <div className="no-signals glass-card">
                <div className="no-signals-icon">📊</div>
                <h3>No hay señales activas</h3>
                <p className="text-muted">
                  El sistema está monitoreando el mercado y generará señales cuando se detecten oportunidades de compra.
                </p>
              </div>
            ) : (
              <div className="signals-grid">
                {signals.map((signal, idx) => (
                  <SignalCard
                    key={`${signal.symbol}-${idx}`}
                    signal={signal}
                    onSimulateBuy={handleSimulateBuy}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Win Rate Stats */}
          <section className="winrate-section mb-xl">
            <WinRateStats
              stats={getStats()}
              recentSignals={history.filter(s => s.status === 'WIN' || s.status === 'LOSS')}
            />
          </section>

          {/* Footer Disclaimer */}
          <footer className="app-footer mt-xl">
            <div className="glass-card" style={{ padding: '1rem', textAlign: 'center' }}>
              <p className="text-muted" style={{ fontSize: '0.875rem', margin: 0 }}>
                ⚠️ <strong>Disclaimer:</strong> Las señales son solo para fines educativos y no constituyen asesoramiento financiero.
                Opere bajo su propio riesgo.
              </p>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

export default App;
