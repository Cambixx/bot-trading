import { getInternalStore } from './scheduled-analysis.js';

const HISTORY_STORE_KEY = 'signal-history-v2';
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

async function generateReportMessage(context) {
    try {
        const store = getInternalStore(context);
        const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];

        if (history.length === 0) return "No hay historial de operaciones disponible.";

        const open = history.filter(h => h.status === 'OPEN');
        const closed = history.filter(h => h.status === 'CLOSED');
        const wins = closed.filter(h => h.outcome === 'WIN');
        const losses = closed.filter(h => h.outcome === 'LOSS');
        const winRate = closed.length > 0 ? (wins.length / closed.length * 100).toFixed(1) : "0.0";

        const esc = (val) => {
            if (val === undefined || val === null) return '';
            let s = String(val);
            return s.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
        };

        let msg = `📊 *INFORME DE RENDIMIENTO*\n\n`;
        msg += `📈 *Win Rate:* ${esc(winRate)}%\n`;
        msg += `✅ *Ganadoras:* ${esc(wins.length)}\n`;
        msg += `❌ *Perdedoras:* ${esc(losses.length)}\n`;
        msg += `⏳ *Abiertas:* ${esc(open.length)}\n\n`;

        if (open.length > 0) {
            msg += `🔔 *OPERACIONES ABIERTAS:*\n`;
            open.forEach(op => {
                msg += `• ${esc(op.symbol)} \\($${esc(op.entry)}\\)\n`;
            });
            msg += `\n`;
        }

        if (closed.length > 0) {
            msg += `📜 *ÚLTIMOS RESULTADOS:*\n`;
            closed.slice(-10).reverse().forEach(op => {
                const icon = op.outcome === 'WIN' ? '✅' : '❌';
                msg += `${icon} ${esc(op.symbol)}: ${esc(op.outcome)}\n`;
            });
        }

        const timeStr = new Date().toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Madrid'
        });
        msg += `\n🤖 _Scanner Report_ • ${esc(timeStr)}`;

        return msg;
    } catch (e) {
        return "Error al generar el informe: " + e.message;
    }
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);
        if (!payload.message || !payload.message.chat) return { statusCode: 200, body: 'OK' };

        const chatId = String(payload.message.chat.id);
        const text = (payload.message.text || '').toLowerCase().trim();

        // Verificamos si es un informe solicitado por el ADMIN
        if (chatId === String(TELEGRAM_CHAT_ID)) {
            if (text === 'informe' || text === '/informe' || text === 'status') {
                const message = await generateReportMessage({ siteID: process.env.SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN });

                await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: message,
                        parse_mode: 'MarkdownV2'
                    })
                });
            }
        } else {
            // Si no es el ADMIN, le avisamos de su ID para que pueda configurarlo
            if (text === 'informe' || text === 'id') {
                await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: `⚠️ No autorizado personales\\. Tu ID: \\(${chatId}\\)\\.`,
                        parse_mode: 'MarkdownV2'
                    })
                });
            }
        }

        return { statusCode: 200, body: JSON.stringify({ success: true }) };
    } catch (error) {
        console.error('Bot Error:', error);
        return { statusCode: 200, body: 'Error but OK to Telegram' };
    }
};
