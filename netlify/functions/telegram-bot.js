import {
    getInternalStore,
    runAnalysis,
    loadCooldowns,
    saveCooldowns,
    COOLDOWN_STORE_KEY,
    HISTORY_STORE_KEY
} from './scheduled-analysis.js';

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

async function generateReportMessage(context) {
    try {
        if (!TELEGRAM_BOT_TOKEN) return "⚠️ Error: TELEGRAM_BOT_TOKEN no está configurado";

        const store = getInternalStore(context);
        const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];

        const esc = (val) => {
            if (val === undefined || val === null) return '';
            let s = String(val);
            return s.replace(/([_\*\[\]\(\)~`>#+\-=|{}.!])/g, '\\$1');
        };

        if (history.length === 0) {
            return `📊 *INFORME DE RENDIMIENTO*\n\nℹ️ No hay operaciones en el historial todavía\.`;
        }

        const open = history.filter(h => h.status === 'OPEN');
        const closed = history.filter(h => h.status === 'CLOSED');
        const wins = closed.filter(h => h.outcome === 'WIN');
        const losses = closed.filter(h => h.outcome === 'LOSS');
        const totalTrades = wins.length + losses.length;
        const winRate = totalTrades > 0 ? (wins.length / totalTrades * 100).toFixed(1) : "0.0";

        let msg = `📊 *INFORME DE RENDIMIENTO*\n\n`;
        msg += `📈 *Win Rate:* ${esc(winRate)}%\n`;
        msg += `✅ *Ganadoras:* ${esc(wins.length)}\n`;
        msg += `❌ *Perdedoras:* ${esc(losses.length)}\n`;
        msg += `⏳ *Abiertas:* ${esc(open.length)}\n`;
        msg += `📊 *Total:* ${esc(history.length)} operaciones\n\n`;

        if (open.length > 0) {
            msg += `🔔 *OPERACIONES ABIERTAS:*\n`;
            open.forEach(op => msg += `• ${esc(op.symbol)} \(Score: ${esc(op.score)}\)\n`);
            msg += `\n`;
        }

        if (closed.length > 0) {
            msg += `📜 *ÚLTIMOS RESULTADOS:*\n`;
            closed.slice(-5).reverse().forEach(op => {
                let icon = op.outcome === 'WIN' ? '✅' : op.outcome === 'LOSS' ? '❌' : '⚖️';
                msg += `${icon} ${esc(op.symbol)}: ${esc(op.outcome)}\n`;
            });
        }
        return msg;
    } catch (e) {
        return `⚠️ Error: ${esc(e.message)}`;
    }
}

async function sendTelegramMessage(chatId, text) {
    return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'MarkdownV2'
        })
    });
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Not Allowed' };

    try {
        const payload = JSON.parse(event.body);
        if (!payload.message || !payload.message.chat) return { statusCode: 200, body: 'OK' };

        const chatId = String(payload.message.chat.id);
        const authorizedChatId = String(TELEGRAM_CHAT_ID || '');
        const text = (payload.message.text || '').toLowerCase().trim();
        const isAdmin = chatId === authorizedChatId && authorizedChatId !== '';
        const context = { siteID: process.env.SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN };

        const esc = (val) => String(val).replace(/([_\*\[\]\(\)~`>#+\-=|{}.!])/g, '\\$1');

        if (text === 'id') {
            await sendTelegramMessage(chatId, `🆔 Tu ID de chat es: \`${chatId}\``);
            return { statusCode: 200, body: 'OK' };
        }

        if (!isAdmin) {
            await sendTelegramMessage(chatId, `⚠️ No autorizado\. Tu ID: ${chatId}\n\nConfigura TELEGRAM_CHAT_ID=${chatId} en Netlify\.`);
            return { statusCode: 200, body: 'OK' };
        }

        // --- COMANDOS ADMIN ---
        if (text === '/start' || text === 'help' || text === '/help') {
            let help = `🚀 *Comandos Sniper Bot v4\.1*\n\n`;
            help += `📊 /informe \- Ver resumen de rendimiento\n`;
            help += `🔍 /scan \- Forzar análisis del scanner ahora\n`;
            help += `🧊 /cooldowns \- Ver monedas bloqueadas\n`;
            help += `🔥 /reset\_cooldowns \- Limpiar todos los bloqueos\n`;
            help += `⚙️ /settings \- Ver configuración actual\n`;
            help += `🧹 /limpiar \- Borrar historial de señales`;
            await sendTelegramMessage(chatId, help);

        } else if (text === '/informe' || text === 'informe') {
            const report = await generateReportMessage(context);
            await sendTelegramMessage(chatId, report);

        } else if (text === '/scan' || text === 'scan') {
            await sendTelegramMessage(chatId, `🔍 *Iniciando análisis manual\.\.\.*`);
            const result = await runAnalysis(context);
            let resMsg = `✅ *Análisis Completo*\n\n`;
            resMsg += `• Señales: ${result.signals || 0}\n`;
            resMsg += `• Errores: ${result.errors || 0}\n`;
            if (result.reason) resMsg += `• Info: ${esc(result.reason)}`;
            await sendTelegramMessage(chatId, resMsg);

        } else if (text === '/cooldowns' || text === 'cooldowns') {
            const cds = await loadCooldowns(context);
            const now = Date.now();
            let cdMsg = `🧊 *Monedas en Cooldown:*\n\n`;
            const active = Object.entries(cds).filter(([_, time]) => now - time < (Number(process.env.ALERT_COOLDOWN_MIN) || 240) * 60 * 1000);

            if (active.length === 0) {
                cdMsg += `✅ No hay monedas bloqueadas actualmente\.`;
            } else {
                active.forEach(([symbol, time]) => {
                    const minsLeft = Math.round(((Number(process.env.ALERT_COOLDOWN_MIN) || 240) * 60 * 1000 - (now - time)) / 60000);
                    cdMsg += `• *${esc(symbol)}*: reste ${minsLeft} min\n`;
                });
            }
            await sendTelegramMessage(chatId, cdMsg);

        } else if (text === '/reset_cooldowns') {
            await saveCooldowns({}, context);
            await sendTelegramMessage(chatId, `🔥 *Cooldowns reseteados correctamente*`);

        } else if (text === '/limpiar') {
            const store = getInternalStore(context);
            await store.setJSON(HISTORY_STORE_KEY, []);
            await sendTelegramMessage(chatId, `🧹 *Historial de señales borrado*`);

        } else if (text === '/settings' || text === 'settings') {
            let conf = `⚙️ *Configuración Activa:*\n\n`;
            conf += `• MAX\_SYMBOLS: ${process.env.MAX_SYMBOLS || 50}\n`;
            conf += `• COOLDOWN: ${process.env.ALERT_COOLDOWN_MIN || 240} min\n`;
            conf += `• AVOID\_ASIA: ${process.env.AVOID_ASIA_SESSION || 'true'}\n`;
            conf += `• MIN\_VOL\_24H: ${process.env.MIN_QUOTE_VOL_24H || '3M'}\n`;
            conf += `• BTC\_SEMAPHORE: ACTIVO`;
            await sendTelegramMessage(chatId, conf);

        } else {
            await sendTelegramMessage(chatId, `❓ Comando no reconocido\. Escribe /help para ver la lista\.`);
        }

        return { statusCode: 200, body: JSON.stringify({ success: true }) };
    } catch (error) {
        console.error('Bot Error:', error);
        return { statusCode: 200, body: 'OK' };
    }
};
