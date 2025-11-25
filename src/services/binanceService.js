import axios from 'axios';

const BINANCE_API_BASE = 'https://api.binance.com/api/v3';

/**
 * Servicio para obtener datos de criptomonedas desde Binance API
 */
class BinanceService {
  /**
   * Obtener datos de velas (candlesticks) para un símbolo
   * @param {string} symbol - Par de trading (ej: BTCUSDT)
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
}

export default new BinanceService();
