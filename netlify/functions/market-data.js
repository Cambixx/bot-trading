import axios from 'axios';

export async function handler(event, context) {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Make sure you send a GET request' };
    }

    const { type } = event.queryStringParameters;
    const ALPHA_VANTAGE_KEY = process.env.VITE_ALPHA_VANTAGE_API_KEY;
    const NEWS_API_KEY = process.env.VITE_NEWS_API_KEY;

    if (type === 'macro') {
        if (!ALPHA_VANTAGE_KEY) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Alpha Vantage API Key missing' }) };
        }

        try {
            // Fetch SPY (S&P 500 proxy) and UUP (DXY proxy)
            const [spyRes, uupRes] = await Promise.all([
                axios.get(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY&apikey=${ALPHA_VANTAGE_KEY}`),
                axios.get(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=UUP&apikey=${ALPHA_VANTAGE_KEY}`)
            ]);

            const parseQuote = (res) => {
                if (res.data.Note || res.data.Information) return null;
                const quote = res.data['Global Quote'];
                if (!quote) return null;
                return {
                    price: parseFloat(quote['05. price']),
                    changePercent: parseFloat(quote['10. change percent'].replace('%', ''))
                };
            };

            const spyData = parseQuote(spyRes);
            const uupData = parseQuote(uupRes);

            // Fallback mock data if rate limit hit (Alpha Vantage is strict)
            const fallback = {
                sp500: spyData ? {
                    price: spyData.price,
                    changePercent: spyData.changePercent,
                    trend: spyData.changePercent >= 0 ? 'BULLISH' : 'BEARISH'
                } : null,
                dxy: uupData ? {
                    price: uupData.price,
                    changePercent: uupData.changePercent,
                    trend: uupData.changePercent >= 0 ? 'BULLISH' : 'BEARISH'
                } : null,
                timestamp: new Date().toISOString()
            };

            // If completely failed due to rate limits while key exists, 
            // the service consumer handles null or we return partial.

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(fallback)
            };
        } catch (error) {
            console.error('Macro Fetch Error:', error);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error.message })
            };
        }

    } else if (type === 'news') {
        if (!NEWS_API_KEY) {
            return { statusCode: 500, body: JSON.stringify({ error: 'News API Key missing' }) };
        }

        try {
            const url = `https://newsapi.org/v2/everything?q=bitcoin+crypto+market&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`;
            const res = await axios.get(url);

            const articles = res.data.status === 'ok' ? res.data.articles.map(a => ({
                title: a.title,
                source: a.source.name,
                url: a.url,
                publishedAt: a.publishedAt,
                summary: a.description
            })) : [];

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(articles)
            };
        } catch (error) {
            console.error('News API Error:', error.response?.data || error.message);
            return {
                statusCode: 502,
                body: JSON.stringify({ error: 'Failed to fetch news', details: error.message })
            };
        }
    }

    return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid type parameter. Use ?type=macro or ?type=news' })
    };
};
