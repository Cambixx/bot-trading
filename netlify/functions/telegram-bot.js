import { getStore } from '@netlify/blobs';

const HISTORY_STORE_KEY = 'signal-history-v2';
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NETLIFY_AUTH_TOKEN, SITE_ID } = process.env;

// Localized store helper
function getInternalStore(context) {
    const options = { name: 'trading-signals' };
    const siteID = context?.site?.id || context?.siteID || SITE_ID;
    const token = context?.token || NETLIFY_AUTH_TOKEN;
    if (siteID) options.siteID = siteID;
    if (token) options.token = token;
    return getStore(options);
}

async function generateReportMessage(context) {
    try {
        const store = getInternalStore(context);
        const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];

        if (history.length === 0) return "No hay historial de señales disponible todavía.";

        const open = history.filter(h => h.status === 'OPEN');
        const closed = history.filter(h => h.status === 'CLOSED' || h.outcome);
        const wins = closed.filter(h => h.outcome === 'WIN');
        const losses = closed.filter(h => h.outcome === 'LOSS');
        const bes = closed.filter(h => h.outcome === 'BREAK_EVEN');

        const totalDecisive = wins.length + losses.length;
        const winRate = totalDecisive > 0 ? (wins.length / totalDecisive * 100).toFixed(1) : "0.0";

        const esc = (val) => {
            if (val === undefined || val === null) return '';
            let s = String(val);
            return s.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
        };

        let msg = `📊 *ESTADÍSTICAS DEL ALGORITMO (v2.4)*\n\n`;
        msg += `📈 *Win Rate:* ${esc(winRate)}%\n`;
        msg += `✅ *Ganadoras:* ${esc(wins.length)}\n`;
        msg += `❌ *Perdedoras:* ${esc(losses.length)}\n`;
        msg += `🤝 *Break-Even:* ${esc(bes.length)}\n`;
        msg += `⏳ *Abiertas:* ${esc(open.length)}\n\n`;

        if (open.length > 0) {
            msg += `🔔 *MONEDAS EN SEGUIMIENTO:*\n`;
            open.slice(0, 5).forEach(op => {
                const entry = op.price || op.entry || 0;
                msg += `• ${esc(op.symbol)} \\($${esc(entry)}\\)\n`;
            });
            if (open.length > 5) msg += `_...y ${open.length - 5} más_\n`;
            msg += `\n`;
        }

        if (closed.length > 0) {
            msg += `📜 *ÚLTIMOS RESULTADOS:*\n`;
            closed.slice(-10).reverse().forEach(op => {
                let icon = '⚪';
                if (op.outcome === 'WIN') icon = '✅';
                if (op.outcome === 'LOSS') icon = '❌';
                if (op.outcome === 'BREAK_EVEN') icon = '🤝';
                msg += `${icon} ${esc(op.symbol)}: ${esc(op.outcome || 'N/A')}\n`;
            });
        }

        const timeStr = new Date().toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Madrid'
        });
        msg += `\n🤖 _Scanner Auto-Report_ • ${esc(timeStr)}`;

        return msg;
    } catch (e) {
        console.error('[BOT] Error in generateReportMessage:', e);
        return "⚠️ Error al generar informe: " + e.message;
    }
}

async function sendTelegram(chatId, text, parseMode = 'MarkdownV2') {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = { chat_id: chatId, text };
    if (parseMode) body.parse_mode = parseMode;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`[BOT] Telegram API Error for chat ${chatId}:`, errText);
        throw new Error(errText);
    }
    return await response.json();
}

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 200, body: 'Use POST' }; // Return 200 for Netlify ping
    }

    try {
        const body = event.body ? JSON.parse(event.body) : null;
        if (!body || !body.message) {
            console.log('[BOT] Empty update or not a message');
            return { statusCode: 200, body: 'No message' };
        }

        const message = body.message;
        const chatId = String(message.chat.id);
        const text = (message.text || '').toLowerCase().trim();
        const isAdmin = (chatId === String(TELEGRAM_CHAT_ID).trim());

        console.log(`[BOT] Update from @${message.from?.username || 'user'} (${chatId}). Admin? ${isAdmin}. Text: "${text}"`);

        // BASIC COMMANDS FOR EVERYONE (To ensure bot is live)
        if (text === '/start' || text === 'hola' || text === 'ping') {
            await sendTelegram(chatId, `🚀 Bot de Trading v2.4 activo.\nTu ID: \`${chatId}\`\nAdmin ID: \`${TELEGRAM_CHAT_ID}\``, null);
            return { statusCode: 200, body: 'OK' };
        }

        if (isAdmin) {
            if (text === 'informe' || text === '/informe' || text === 'status' || text === 'stats') {
                const report = await generateReportMessage(context);
                await sendTelegram(chatId, report);
            } else {
                await sendTelegram(chatId, `✅ Bot Online. Comando desconocido para admin: ${text}`, null);
            }
        } else {
            // Non-admin attempting admin commands
            if (text.includes('informe') || text === 'id') {
                await sendTelegram(chatId, `⚠️ No autorizado. Tu ID \`${chatId}\` debe ser configurado en Netlify como \`TELEGRAM_CHAT_ID\`.`, 'Markdown');
            }
        }

        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (error) {
        console.error('[BOT] Global Handler Error:', error);
        return { statusCode: 200, body: 'Error handled' };
    }
};
