import axios from 'axios';

const BINANCE_API_BASE = 'https://api.binance.com/api/v3';

/**
 * Servicio para obtener datos de criptomonedas desde Binance API
 */
class BinanceService {
  /**
   * Obtener datos de velas (candlesticks) para un símbolo
   * @param {string} symbol - Par de trading (ej: BTCUSDC)
   * @param {string} interval - Timeframe (1m, 5m, 15m, 1h, 4h, 1d)
   * @param {number} limit - Número de velas a obtener (default: 100, max: 1000)
   * @returns {Promise<Array>} Array de datos de velas
   */
  async getKlines(symbol, interval = '1h', limit = 100) {
    try {
      const response = await axios.get(`${BINANCE_API_BASE}/klines`, {
        params: {
          symbol: symbol.toUpperCase(),
          interval,
          limit
        }
      });

      // Transformar datos de Binance a formato más legible
      return response.data.map(candle => ({
        openTime: candle[0],
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5]),
        closeTime: candle[6],
        quoteVolume: parseFloat(candle[7]),
        trades: candle[8],
        takerBuyBaseVolume: parseFloat(candle[9]),
        takerBuyQuoteVolume: parseFloat(candle[10])
      }));
    } catch (error) {
      console.error(`Error fetching klines for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Obtener precio actual de un símbolo
   * @param {string} symbol - Par de trading
   * @returns {Promise<Object>} Información del precio actual
   */
  async getCurrentPrice(symbol) {
    try {
      const response = await axios.get(`${BINANCE_API_BASE}/ticker/24hr`, {
        params: { symbol: symbol.toUpperCase() }
      });

      return {
        symbol: response.data.symbol,
        price: parseFloat(response.data.lastPrice),
        priceChange: parseFloat(response.data.priceChange),
        priceChangePercent: parseFloat(response.data.priceChangePercent),
        high24h: parseFloat(response.data.highPrice),
        low24h: parseFloat(response.data.lowPrice),
        volume24h: parseFloat(response.data.volume),
        quoteVolume24h: parseFloat(response.data.quoteVolume)
      };
    } catch (error) {
      console.error(`Error fetching price for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Obtener datos de múltiples símbolos a la vez
   * @param {Array<string>} symbols - Array de símbolos
   * @param {string} interval - Timeframe
   * @param {number} limit - Número de velas
   * @returns {Promise<Object>} Objeto con datos por símbolo
   */
  async getMultipleSymbolsData(symbols, interval = '1h', limit = 100) {
    try {
      const promises = symbols.map(symbol =>
        this.getKlines(symbol, interval, limit)
          .then(data => ({ symbol, data, error: null }))
          .catch(error => ({ symbol, data: null, error: error.message }))
      );

      const results = await Promise.all(promises);

      // Convertir array a objeto para fácil acceso
      return results.reduce((acc, { symbol, data, error }) => {
        acc[symbol] = { data, error };
        return acc;
      }, {});
    } catch (error) {
      console.error('Error fetching multiple symbols:', error.message);
      throw error;
    }
  }

  /**
   * Obtener datos multi-timeframe para un símbolo
   * @param {string} symbol - Par de trading
   * @param {Array<string>} intervals - Array de timeframes
   * @param {number} limit - Número de velas
   * @returns {Promise<Object>} Datos organizados por timeframe
   */
  async getMultiTimeframeData(symbol, intervals = ['1h', '4h'], limit = 100) {
    try {
      const promises = intervals.map(interval =>
        this.getKlines(symbol, interval, limit)
          .then(data => ({ interval, data, error: null }))
          .catch(error => ({ interval, data: null, error: error.message }))
      );

      const results = await Promise.all(promises);

      return results.reduce((acc, { interval, data, error }) => {
        acc[interval] = { data, error };
        return acc;
      }, {});
    } catch (error) {
      console.error(`Error fetching multi-timeframe data for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Obtener información de exchange (para verificar que símbolos están disponibles)
   * @returns {Promise<Array>} Lista de símbolos disponibles
   */
  async getExchangeInfo() {
    try {
      const response = await axios.get(`${BINANCE_API_BASE}/exchangeInfo`);
      return response.data.symbols
        .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDC')
        .map(s => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset
        }));
    } catch (error) {
      console.error('Error fetching exchange info:', error.message);
      throw error;
    }
  }

  /**
   * Obtener profundidad del libro de órdenes (Order Book)
   * @param {string} symbol - Par de trading
   * @param {number} limit - Profundidad (5, 10, 20, 50, 100, 500, 1000)
   * @returns {Promise<Object>} Objeto con bids y asks
   */
  async getOrderBookDepth(symbol, limit = 20) {
    try {
      const response = await axios.get(`${BINANCE_API_BASE}/depth`, {
        params: { symbol: symbol.toUpperCase(), limit }
      });
      return {
        bids: response.data.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]), // [Price, Qty]
        asks: response.data.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])])
      };
    } catch (error) {
      console.error(`Error fetching depth for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Obtener las top N criptomonedas por volumen en USDC
   * @param {number} limit - Número de criptos a obtener (default: 10)
   * @returns {Promise<Array<string>>} Array de símbolos ordenados por volumen
   */
  async getTopCryptosByVolume(limit = 10) {
    try {
      // Obtener todos los tickers de 24h
      const response = await axios.get(`${BINANCE_API_BASE}/ticker/24hr`);

      // Filtrar solo pares USDC y ordenar por volumen
      const usdcPairs = response.data
        .filter(ticker =>
          ticker.symbol.endsWith('USDC') &&
          ticker.symbol !== 'USDC' &&
          parseFloat(ticker.quoteVolume) > 0
        )
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, limit)
        .map(ticker => ticker.symbol);

      return usdcPairs;
    } catch (error) {
      console.error('Error fetching top cryptos:', error.message);
      // Fallback a criptos populares si falla
      return ['BTCUSDC', 'ETHUSDC', 'BNBUSDC', 'SOLUSDC', 'ADAUSDC', 'XRPUSDC', 'DOGEUSDC', 'DOTUSDC', 'MATICUSDC', 'LINKUSDC'].slice(0, limit);
    }
  }

  /**
   * Obtener monedas con mejores oportunidades (Alta volatilidad + Volumen)
   * Detecta tanto oportunidades LONG (subidas) como SHORT (bajadas)
   * @param {number} limit - Número de monedas a obtener (default: 20)
   * @returns {Promise<Array<string>>} Array de símbolos seleccionados
   */
  async getSmartOpportunityCoins(limit = 20) {
    try {
      console.log('🔄 Iniciando escaneo inteligente de mercado...');
      // Obtener todos los tickers de 24h
      const response = await axios.get(`${BINANCE_API_BASE}/ticker/24hr`);

      // Filtrar y rankear por "Oportunidad" (Volatilidad + Volumen)
      const opportunityCoins = response.data
        .filter(ticker => {
          const symbol = ticker.symbol;
          const volume = parseFloat(ticker.quoteVolume);
          const lastPrice = parseFloat(ticker.lastPrice);
          const high = parseFloat(ticker.highPrice);
          const low = parseFloat(ticker.lowPrice);

          // 1. Pares USDC válidos
          if (!symbol.endsWith('USDC') || symbol === 'USDC') return false;

          // 2. Volumen mínimo relevante ($5M para capturar más movimientos)
          if (volume < 5000000) return false;

          // 3. Volatilidad mínima (High-Low range > 2%)
          // Necesitamos movimiento para hacer trading
          const volatility = ((high - low) / lastPrice) * 100;
          if (volatility < 2) return false;

          return true;
        })
        .map(ticker => {
          const priceChangePercent = parseFloat(ticker.priceChangePercent);
          const volatility = ((parseFloat(ticker.highPrice) - parseFloat(ticker.lowPrice)) / parseFloat(ticker.lastPrice)) * 100;
          const volumeScore = Math.log10(parseFloat(ticker.quoteVolume) / 1000000); // Log score para suavizar diferencias masivas de volumen

          // Score de Oportunidad:
          // 40% Magnitud del cambio (sea positivo o negativo) -> Buscamos movimiento fuerte
          // 40% Volatilidad intradía -> Buscamos rango para operar
          // 20% Volumen -> Buscamos liquidez
          const score =
            (Math.abs(priceChangePercent) * 0.4) +
            (volatility * 0.4) +
            (volumeScore * 2); // Factor 2 para que el volumen tenga peso relevante en la escala

          return {
            symbol: ticker.symbol,
            score,
            priceChange: priceChangePercent,
            volatility
          };
        })
        .sort((a, b) => b.score - a.score) // Ordenar por mayor score
        .slice(0, limit)
        .map(coin => coin.symbol);

      console.log(`✅ Escaneo completado. Encontradas ${opportunityCoins.length} oportunidades.`);
      return opportunityCoins;
    } catch (error) {
      console.error('Error fetching opportunity coins:', error.message);
      // Fallback a una lista diversa de alta capitalización y volatilidad
      return ['BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'XRPUSDC', 'DOGEUSDC', 'AVAXUSDC', 'LINKUSDC', 'MATICUSDC', 'APEUSDC', 'RUNEUSDC'];
    }
  }

  /**
   * Obtener estadísticas globales del mercado (Market Breadth)
   * @returns {Promise<Object>} Datos globales del mercado
   */
  async getMarketBreadth() {
    try {
      const response = await axios.get(`${BINANCE_API_BASE}/ticker/24hr`);
      const allTickers = response.data.filter(t => t.symbol.endsWith('USDC'));

      if (allTickers.length === 0) return null;

      // 1. Calcular Volumen Total USDC en Binance
      const totalVolume = allTickers.reduce((sum, t) => sum + parseFloat(t.quoteVolume), 0);

      // 2. Calcular Dominancia de BTC (basada en volumen en Binance como proxy)
      const btcTicker = allTickers.find(t => t.symbol === 'BTCUSDC');
      const btcVol = btcTicker ? parseFloat(btcTicker.quoteVolume) : 0;
      const btcDominance = ((btcVol / totalVolume) * 100).toFixed(1);

      // 3. Promedio de cambio del mercado (Top 20 por volumen)
      const top20 = allTickers
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 20);

      const avgChange = top20.reduce((sum, t) => sum + parseFloat(t.priceChangePercent), 0) / top20.length;

      // 4. Ganadores y Perdedores Extremos
      const sortedByChange = [...allTickers].sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
      const topGainers = sortedByChange.slice(0, 5).map(t => ({ symbol: t.symbol, change: t.priceChangePercent }));
      const topLosers = sortedByChange.slice(-5).reverse().map(t => ({ symbol: t.symbol, change: t.priceChangePercent }));

      return {
        btcDominance,
        totalVolumeUSD: (totalVolume / 1000000).toFixed(1) + 'M',
        marketAvgChange: avgChange.toFixed(2) + '%',
        topGainers,
        topLosers,
        topCoins: top20.map(t => ({
          symbol: t.symbol,
          change: t.priceChangePercent + '%',
          vol: (parseFloat(t.quoteVolume) / 1000000).toFixed(1) + 'M'
        }))
      };
    } catch (error) {
      console.error('Error fetching market breadth:', error.message);
      return null;
    }
  }

  /**
   * Obtener lista de todos los pares USDC disponibles
   * @returns {Promise<Array>} Array de objetos con symbol y baseAsset
   */
  async getAvailableUSDCPairs() {
    try {
      const allSymbols = await this.getExchangeInfo();
      return allSymbols
        .filter(s => s.quoteAsset === 'USDC')
        .sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));
    } catch (error) {
      console.error('Error fetching USDC pairs:', error.message);
      return [];
    }
  }
  /**
   * Suscribirse a actualizaciones de precio en tiempo real via WebSocket
   * @param {Array<string>} symbols - Lista de símbolos a suscribir
   * @param {Function} onMessage - Callback para manejar los mensajes
   */
  subscribeToTickers(symbols, onMessage) {
    if (this.ws) {
      this.ws.close();
    }

    // Usar Combined Streams para múltiples símbolos
    // Formato: <symbol>@ticker
    const streams = symbols.map(s => `${s.toLowerCase()}@ticker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    // Evitar reconexión si la URL es la misma y el socket está abierto o conectando
    if (this.ws && this.ws.url === url && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('WebSocket ya conectado a estos streams. ' + streams.split('/').length + ' pares.');
      return;
    }

    if (this.ws) {
      this.ws.close();
    }

    console.log('Conectando a WebSocket:', url);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('WebSocket Conectado');
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      // message.data contiene el payload del ticker
      if (message.data) {
        const ticker = {
          symbol: message.data.s,
          price: parseFloat(message.data.c),
          priceChange: parseFloat(message.data.p),
          priceChangePercent: parseFloat(message.data.P),
          high24h: parseFloat(message.data.h),
          low24h: parseFloat(message.data.l),
          volume24h: parseFloat(message.data.v),
          quoteVolume24h: parseFloat(message.data.q)
        };
        onMessage(ticker);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket Desconectado');
    };
  }

  /**
   * Obtener Funding Rates (Tasas de Financiación) del mercado de Futuros
   * @returns {Promise<Array>} Array de objetos con symbol y fundingRate
   */
  async getFundingRates() {
    try {
      // Nota: fapi.binance.com puede tener restricciones CORS en navegador.
      // Si falla, retornaremos un set vacío o simulado para evitar romper la app.
      const response = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex');

      // Filtrar top pares y devolver
      return response.data
        .filter(t => t.symbol.endsWith('USDT')) // Futures usa USDT mayormente
        .sort((a, b) => parseFloat(b.markPrice) - parseFloat(a.markPrice)) // Sort irrelevante, solo queremos datos
        .slice(0, 20)
        .map(t => ({
          symbol: t.symbol,
          fundingRate: parseFloat(t.lastFundingRate),
          markPrice: parseFloat(t.markPrice)
        }));
    } catch (error) {
      console.warn('Error fetching Funding Rates (CORS likely):', error.message);
      return []; // Fail gracefully
    }
  }

  /**
   * Obtener Fear & Greed Index (Sentimiento Global)
   * @returns {Promise<Object>} Datos del índice
   */
  async getFearAndGreedIndex() {
    try {
      const response = await axios.get('https://api.alternative.me/fng/');
      const data = response.data.data[0];
      return {
        value: parseInt(data.value),
        classification: data.value_classification,
        timestamp: data.timestamp
      };
    } catch (error) {
      console.warn('Error fetching Fear & Greed Index:', error.message);
      return null;
    }
  }

  /**
   * Obtener rendimiento por Sectores (Definición manual simplificada)
   * @returns {Promise<Array>} Array de sectores con su performance promedio
   */
  async getSectorPerformance() {
    try {
      const response = await axios.get(`${BINANCE_API_BASE}/ticker/24hr`);
      const tickers = response.data;

      // Definiciones básicas de sectores (Top coins)
      const sectors = {
        'L1/Infrastructure': ['BTC', 'ETH', 'SOL', 'ADA', 'AVAX', 'DOT', 'MATIC', 'ATOM'],
        'DeFi': ['UNI', 'AAVE', 'MKR', 'CRV', 'LDO', 'RUNE', 'SNX'],
        'AI & Big Data': ['FET', 'RNDR', 'GRT', 'OCEAN', 'AGIX', 'NEAR'],
        'Meme': ['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK'],
        'Gaming/Metaverse': ['SAND', 'MANA', 'AXS', 'GALA', 'IMX']
      };

      const sectorStats = [];

      for (const [sectorName, coins] of Object.entries(sectors)) {
        let totalChange = 0;
        let count = 0;
        let vol = 0;

        coins.forEach(coin => {
          const symbol = `${coin}USDT`; // Usar USDT para mayor liquidez/data
          const ticker = tickers.find(t => t.symbol === symbol || t.symbol === `${coin}USDC`);

          if (ticker) {
            totalChange += parseFloat(ticker.priceChangePercent);
            vol += parseFloat(ticker.quoteVolume);
            count++;
          }
        });

        if (count > 0) {
          sectorStats.push({
            name: sectorName,
            change: (totalChange / count).toFixed(2),
            volume: (vol / 1000000).toFixed(0) + 'M',
            trend: (totalChange / count) > 0 ? 'UP' : 'DOWN'
          });
        }
      }

      return sectorStats.sort((a, b) => parseFloat(b.change) - parseFloat(a.change));

    } catch (error) {
      console.error("Error calculating sector performance", error);
      return [];
    }
  }

  /**
   * Cerrar conexión WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export default new BinanceService();
