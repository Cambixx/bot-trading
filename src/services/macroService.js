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

        if (!ALPHA_VANTAGE_KEY) {
            console.warn('Alpha Vantage API Key missing');
            return null;
        }

        try {
            // Fetch SPY (S&P 500 ETF) and UUP (Dollar Index ETF) in parallel
            const [spyRes, uupRes] = await Promise.all([
                this._fetchAlphaVantageQuote('SPY'),
                this._fetchAlphaVantageQuote('UUP')
            ]);

            const data = {
                sp500: {
                    price: spyRes?.price || 0,
                    changePercent: spyRes?.changePercent || 0,
                    trend: spyRes?.changePercent >= 0 ? 'BULLISH' : 'BEARISH'
                },
                dxy: {
                    price: uupRes?.price || 0,
                    changePercent: uupRes?.changePercent || 0,
                    trend: uupRes?.changePercent >= 0 ? 'BULLISH' : 'BEARISH'
                },
                lastUpdated: new Date().toISOString()
            };

            this._saveCache(CACHE_KEYS.MACRO, data);
            return data;
        } catch (error) {
            console.error('Macro Data Fetch Error:', error);
            return null;
        }
    }

    async _fetchAlphaVantageQuote(symbol) {
        try {
            const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`;
            const res = await axios.get(url);

            // Alpha Vantage Rate Limit Check
            if (res.data.Note || res.data.Information) {
                console.warn(`Alpha Vantage Limit Hit for ${symbol}:`, res.data);
                return null;
            }

            const quote = res.data['Global Quote'];
            if (!quote) return null;

            return {
                price: parseFloat(quote['05. price']),
                changePercent: parseFloat(quote['10. change percent'].replace('%', ''))
            };
        } catch (err) {
            console.error(`Error fetching ${symbol}:`, err);
            return null;
        }
    }

    /**
     * Get Crypto News Analysis
     */
    async getMarketNews() {
        const cached = this._getFromCache(CACHE_KEYS.NEWS, CACHE_TTL.NEWS);
        if (cached) return cached;

        if (!NEWS_API_KEY) return [];

        try {
            // Query for generic crypto market news
            const url = `https://newsapi.org/v2/everything?q=bitcoin+crypto+market&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`;
            const res = await axios.get(url);

            if (res.data.status === 'ok') {
                const articles = res.data.articles.map(a => ({
                    title: a.title,
                    source: a.source.name,
                    url: a.url,
                    publishedAt: a.publishedAt,
                    summary: a.description
                }));
                this._saveCache(CACHE_KEYS.NEWS, articles);
                return articles;
            }
            return [];
        } catch (error) {
            console.error('News API Fetch Error:', error);
            return [];
        }
    }
}

export default new MacroService();
