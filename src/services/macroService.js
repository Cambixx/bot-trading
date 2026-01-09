import axios from 'axios';

const ALPHA_VANTAGE_KEY = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY;
const NEWS_API_KEY = import.meta.env.VITE_NEWS_API_KEY;

// Cache Keys
const CACHE_KEYS = {
    MACRO: 'macro_data_v1',
    NEWS: 'crypto_news_v1'
};

const CACHE_TTL = {
    MACRO: 60 * 60 * 1000, // 1 hour (Alpha Vantage is strict)
    NEWS: 30 * 60 * 1000   // 30 minutes
};

class MacroService {
    constructor() {
        this.cache = new Map();
        // Load from localStorage on init
        this._loadCache();
    }

    _loadCache() {
        try {
            const macro = localStorage.getItem(CACHE_KEYS.MACRO);
            if (macro) this.cache.set(CACHE_KEYS.MACRO, JSON.parse(macro));

            const news = localStorage.getItem(CACHE_KEYS.NEWS);
            if (news) this.cache.set(CACHE_KEYS.NEWS, JSON.parse(news));
        } catch (e) {
            console.error('Error loading macro cache', e);
        }
    }

    _saveCache(key, data) {
        const entry = { timestamp: Date.now(), data };
        this.cache.set(key, entry);
        localStorage.setItem(key, JSON.stringify(entry));
    }

    _getFromCache(key, ttl) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp < ttl) return entry.data;
        return null;
    }

    /**
     * Get Macro Indicators (SPY = S&P500 Proxy, UUP = DXY Proxy)
     * We use proxies because Index data often requires premium or has weird symbol mapping.
     */
    async getMacroIndicators() {
        const cached = this._getFromCache(CACHE_KEYS.MACRO, CACHE_TTL.MACRO);
        if (cached) {
            console.log('📦 Using cached Macro Data');
            return cached;
        }

        try {
            // Call internal proxy
            const res = await axios.get('/.netlify/functions/market-data?type=macro');

            // Validate response 
            const data = res.data;
            if (!data.sp500 && !data.dxy) return null; // Both failed

            // Add lastUpdated if missing
            if (!data.lastUpdated) data.lastUpdated = new Date().toISOString();

            this._saveCache(CACHE_KEYS.MACRO, data);
            return data;
        } catch (error) {
            console.error('Macro Data Service Error:', error);
            return null;
        }
    }

    // _fetchAlphaVantageQuote is no longer needed

    /**
     * Get Crypto News Analysis
     */
    async getMarketNews() {
        const cached = this._getFromCache(CACHE_KEYS.NEWS, CACHE_TTL.NEWS);
        if (cached) return cached;

        try {
            // Call internal proxy
            const res = await axios.get('/.netlify/functions/market-data?type=news');

            const articles = Array.isArray(res.data) ? res.data : [];
            if (articles.length > 0) {
                this._saveCache(CACHE_KEYS.NEWS, articles);
            }
            return articles;
        } catch (error) {
            console.error('News Service Error:', error);
            return [];
        }
    }
}

export default new MacroService();
