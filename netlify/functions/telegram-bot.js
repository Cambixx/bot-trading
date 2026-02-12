import { getInternalStore } from './scheduled-analysis.js';

const HISTORY_STORE_KEY = 'signal-history-v2';
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

async function generateReportMessage(context) {
    try {
        // Verificar que las variables de entorno estén configuradas
        if (!TELEGRAM_BOT_TOKEN) {
            return "⚠️ Error: TELEGRAM_BOT_TOKEN no está configurado";
        }

        const store = getInternalStore(context);
        const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];

        const esc = (val) => {
            if (val === undefined || val === null) return '';
            let s = String(val);
            return s.replace(/([_\*\[\]\(\)~`>#+\-=|{}.!])/g, '\\$1');
        };

        if (history.length === 0) {
            let msg = `📊 *INFORME DE RENDIMIENTO*\n\n`;
            msg += `ℹ️ No hay operaciones en el historial todavía\n\n`;
            msg += `💡 Las operaciones se registran automáticamente cuando el scanner genera señales\.`;
            return msg;
        }

        const open = history.filter(h => h.status === 'OPEN');
        const closed = history.filter(h => h.status === 'CLOSED');
        const wins = closed.filter(h => h.outcome === 'WIN');
        const losses = closed.filter(h => h.outcome === 'LOSS');
        const breakEvens = closed.filter(h => h.outcome === 'BREAK_EVEN');
        const staleExits = closed.filter(h => h.outcome === 'STALE_EXIT');
        const totalTrades = wins.length + losses.length;
        const winRate = totalTrades > 0 ? (wins.length / totalTrades * 100).toFixed(1) : "0.0";

        let msg = `📊 *INFORME DE RENDIMIENTO*\n\n`;
        msg += `📈 *Win Rate:* ${esc(winRate)}%\n`;
        msg += `✅ *Ganadoras:* ${esc(wins.length)}\n`;
        msg += `❌ *Perdedoras:* ${esc(losses.length)}\n`;
        if (breakEvens.length > 0) {
            msg += `⚖️ *Break Even:* ${esc(breakEvens.length)}\n`;
        }
        if (staleExits.length > 0) {
            msg += `⏱️ *Stale Exit:* ${esc(staleExits.length)}\n`;
        }
        msg += `⏳ *Abiertas:* ${esc(open.length)}\n`;
        msg += `📊 *Total:* ${esc(history.length)} operaciones\n\n`;

        if (open.length > 0) {
            msg += `🔔 *OPERACIONES ABIERTAS:*\n`;
            open.forEach(op => {
                const entryPrice = op.price || op.entry || 'N/A';
                msg += `• ${esc(op.symbol)} \(Score: ${esc(op.score)}\)\n`;
            });
            msg += `\n`;
        }

        if (closed.length > 0) {
            msg += `📜 *ÚLTIMOS RESULTADOS:*\n`;
            closed.slice(-5).reverse().forEach(op => {
                let icon = '⚪';
                if (op.outcome === 'WIN') icon = '✅';
                else if (op.outcome === 'LOSS') icon = '❌';
                else if (op.outcome === 'BREAK_EVEN') icon = '⚖️';
                else if (op.outcome === 'STALE_EXIT') icon = '⏱️';
                msg += `${icon} ${esc(op.symbol)}: ${esc(op.outcome)}\n`;
            });
        }

        const timeStr = new Date().toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Madrid'
        });
        msg += `\n🤖 _Scanner v4\.0_ • ${esc(timeStr)}`;

        return msg;
    } catch (e) {
        console.error('Error generating report:', e);
        return `⚠️ Error al generar el informe: ${e.message}`;
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
        const authorizedChatId = String(TELEGRAM_CHAT_ID || '');
        
        if (text === 'informe' || text === '/informe' || text === 'status' || text === 'report') {
            if (chatId === authorizedChatId && authorizedChatId !== '') {
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
            } else {
                // Si no es el ADMIN, le avisamos de su ID para que pueda configurarlo
                await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: `⚠️ No autorizado\. Tu ID: ${chatId}\n\nPara autorizar, configura TELEGRAM_CHAT_ID=${chatId} en las variables de entorno de Netlify\.`,
                        parse_mode: 'MarkdownV2'
                    })
                });
            }
        } else if (text === 'id') {
            // Comando id siempre responde con el ID del chat
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `🆔 Tu ID de chat es: \`${chatId}\``,
                    parse_mode: 'MarkdownV2'
                })
            });
        }

        return { statusCode: 200, body: JSON.stringify({ success: true }) };
    } catch (error) {
        console.error('Bot Error:', error);
        return { statusCode: 200, body: 'Error but OK to Telegram' };
    }
};
