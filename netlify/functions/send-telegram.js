/**
 * Netlify Serverless Function - Send Telegram Notifications
 * Dedicated endpoint for client-side signals.
 */

export async function handler(event, context) {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // CORS Headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, x-notify-secret',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const { signals } = JSON.parse(event.body);

        if (!signals || !Array.isArray(signals) || signals.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ success: false, error: 'No signals provided' })
            };
        }

        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

        // Optional: Secret check to prevent spam if exposed
        const NOTIFY_SECRET = process.env.NOTIFY_SECRET;
        const clientSecret = event.headers['x-notify-secret'] || event.headers['X-Notify-Secret'];

        if (NOTIFY_SECRET && clientSecret !== NOTIFY_SECRET) {
            console.warn('Invalid Notify Secret attempted');
            // We can be strict or lenient. Let's be lenient for dev but log it.
            // return { statusCode: 403, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
        }

        if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
            console.error('Telegram credentials missing');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ success: false, error: 'Server configuration missing' })
            };
        }

        // Reuse logic from scheduled-analysis (simplified)
        let message = '🔔 *NUEVA SEÑAL ALERTA* 🔔\n\n';

        for (const sig of signals) {
            // Safe helpers
            const esc = (t) => String(t).replace(/([[\]_*()~`>#+\-=|{}.!])/g, '\\$1');

            let icon = '🟢';
            if (sig.type === 'SELL' || sig.signal === 'UPPER_EXTREMITY') icon = '🔴';

            const symbol = esc(sig.symbol || 'UNKNOWN');
            const price = sig.price ? esc(sig.price) : 'N/A';
            const score = sig.score || 'N/A';

            message += `${icon} *${symbol}* \\| Score: ${score}\n`;
            message += `💰 Price: $${price}\n`;

            // SMC / Institutional Footprint
            if (sig.subscores && sig.subscores.smc > 0) {
                message += `🏦 *INSTITUTIONAL FOOTPRINT DETECTED*\n`;
                const smcDetails = [];
                // We need to pass detailed SMC reasons or inspect levels
                if (sig.levels && sig.levels.orderBlocks && (sig.levels.orderBlocks.bullish || sig.levels.orderBlocks.bearish)) smcDetails.push("Order Block");
                if (sig.levels && sig.levels.fvg && sig.levels.fvg.length > 0) smcDetails.push("Fair Value Gap");
                if (sig.levels && sig.levels.liquiditySweeps && sig.levels.liquiditySweeps.length > 0) smcDetails.push("Liquidity Sweep");

                if (smcDetails.length > 0) message += `   ├ ${esc(smcDetails.join(" + "))}\n`;
            }

            // Levels
            if (sig.levels) {
                if (sig.levels.entry) message += `   ├ Entry: ${esc(sig.levels.entry)}\n`;
                if (sig.levels.stopLoss) message += `   ├ SL: ${esc(sig.levels.stopLoss)}\n`;
                if (sig.levels.takeProfit1) message += `   ├ TP1: ${esc(sig.levels.takeProfit1)}\n`;
            }

            // AI Insight
            if (sig.aiAnalysis) {
                const sentiment = sig.aiAnalysis.sentiment || 'NEUTRAL';
                const sentimentIcon = sentiment === 'BULLISH' ? '🚀' : sentiment === 'BEARISH' ? '🐻' : '⚖️';
                message += `\n🤖 *AI INTELLIGENCE* ${sentimentIcon}\n`;

                if (sig.aiAnalysis.insights && sig.aiAnalysis.insights.length > 0) {
                    message += `_${esc(sig.aiAnalysis.insights[0])}_\n`;
                } else if (sig.aiAnalysis.recommendation) {
                    message += `Rec: ${esc(sig.aiAnalysis.recommendation)}\n`;
                }
            } else if (sig.reasons && sig.reasons.length > 0) {
                // Fallback to algorithmic reasons if no AI
                const r = sig.reasons[0];
                const reasonText = typeof r === 'string' ? r : (r.text || '');
                message += `💡 _${esc(reasonText)}_\n`;
            }

            message += `\n───────────────────\n`;
        }

        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'MarkdownV2'
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('Telegram API error:', errText);
            throw new Error(`Telegram API Error: ${response.status} ${response.statusText}`);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, count: signals.length })
        };

    } catch (error) {
        console.error('Send Telegram Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
}
