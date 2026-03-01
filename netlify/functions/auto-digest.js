/**
 * AUTO-DIGEST: Daily Self-Learning Performance Report
 * Runs daily at 09:00 UTC — sends a Telegram digest with:
 * - Rolling win rate by regime
 * - Missed opportunities from shadow trading
 * - Most costly filter (which filter blocked the most would-have-won trades)
 * - Adaptive threshold suggestions
 * 
 * v6.0-SelfLearn
 */

import { schedule } from "@netlify/functions";
import {
    getInternalStore,
    HISTORY_STORE_KEY,
    SHADOW_STORE_KEY,
    AUTOPSY_STORE_KEY
} from './scheduled-analysis.js';

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

function escapeMarkdownV2(text) {
    if (!text && text !== 0) return '';
    return String(text).replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
const esc = (v) => escapeMarkdownV2(v !== undefined && v !== null ? v : '');

async function sendTelegramMessage(text) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log('[DIGEST] Telegram credentials missing');
        return false;
    }

    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text,
                parse_mode: 'MarkdownV2'
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DIGEST] Telegram Error:', errorText);
            // Fallback: send without markdown
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: text.replace(/[\\_*[\]()~`>#+\-=|{}.!]/g, ''),
                })
            });
            return false;
        }
        return true;
    } catch (e) {
        console.error('[DIGEST] Error:', e.message);
        return false;
    }
}

async function generateDigest(context) {
    const store = getInternalStore(context);

    // Load all data stores
    const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];
    const shadows = await store.get(SHADOW_STORE_KEY, { type: 'json' }) || [];
    const autopsies = await store.get(AUTOPSY_STORE_KEY, { type: 'json' }) || [];

    // ==================== SECTION 1: Overall Performance ====================
    const closed = history.filter(h => h.status === 'CLOSED');
    const wins = closed.filter(h => h.outcome === 'WIN');
    const losses = closed.filter(h => h.outcome === 'LOSS' || h.outcome === 'STALE_EXIT');
    const opens = history.filter(h => h.status === 'OPEN');
    const totalDecisive = wins.length + losses.length;
    const overallWR = totalDecisive > 0 ? (wins.length / totalDecisive * 100).toFixed(1) : '0.0';

    let msg = `🧠 *DAILY SELF\\-LEARNING DIGEST*\n\n`;
    msg += `📊 *Performance General:*\n`;
    msg += `  ✅ Wins: ${esc(wins.length)} \\| ❌ Losses: ${esc(losses.length)} \\| ⏳ Open: ${esc(opens.length)}\n`;
    msg += `  📈 *Win Rate: ${esc(overallWR)}%*\n\n`;

    // ==================== SECTION 2: Win Rate by Regime ====================
    const regimes = {};
    for (const trade of closed) {
        const r = trade.regime || 'UNKNOWN';
        if (!regimes[r]) regimes[r] = { wins: 0, losses: 0 };
        if (trade.outcome === 'WIN') regimes[r].wins++;
        else regimes[r].losses++;
    }

    if (Object.keys(regimes).length > 0) {
        msg += `📋 *Win Rate por Régimen:*\n`;
        for (const [regime, data] of Object.entries(regimes)) {
            const total = data.wins + data.losses;
            const wr = total > 0 ? (data.wins / total * 100).toFixed(0) : '0';
            const icon = Number(wr) >= 55 ? '🟢' : Number(wr) >= 40 ? '🟡' : '🔴';
            msg += `  ${icon} ${esc(regime)}: ${esc(wr)}% \\(${esc(data.wins)}W/${esc(data.losses)}L\\)\n`;
        }
        msg += `\n`;
    }

    // ==================== SECTION 3: Shadow Trading Stats ====================
    const resolvedShadows = shadows.filter(s => s.outcome !== 'PENDING' && s.outcome !== 'EXPIRED');
    const wouldWin = resolvedShadows.filter(s => s.outcome === 'WOULD_WIN');
    const wouldLose = resolvedShadows.filter(s => s.outcome === 'WOULD_LOSE');
    const wouldFlat = resolvedShadows.filter(s => s.outcome === 'WOULD_FLAT');

    if (resolvedShadows.length > 0) {
        const shadowWR = ((wouldWin.length / resolvedShadows.length) * 100).toFixed(0);
        msg += `👻 *Shadow Trading \\(Paper\\):*\n`;
        msg += `  📊 ${esc(resolvedShadows.length)} near\\-misses tracked\n`;
        msg += `  ✅ Would Win: ${esc(wouldWin.length)} \\| ❌ Would Lose: ${esc(wouldLose.length)} \\| ➡️ Flat: ${esc(wouldFlat.length)}\n`;
        msg += `  📈 Shadow WR: *${esc(shadowWR)}%*\n\n`;

        // Top missed opportunities
        if (wouldWin.length > 0) {
            const topMissed = wouldWin
                .sort((a, b) => Number(b.maxFavorableMove) - Number(a.maxFavorableMove))
                .slice(0, 3);

            msg += `❌ *Top Oportunidades Perdidas:*\n`;
            for (const miss of topMissed) {
                msg += `  • ${esc(miss.symbol)}: \\+${esc(miss.maxFavorableMove)}% \\(score=${esc(miss.score)}, filtro=${esc(miss.rejectReason)}\\)\n`;
            }
            msg += `\n`;
        }
    } else {
        msg += `👻 *Shadow Trading:* Sin datos todavía \\(esperando resolución\\)\n\n`;
    }

    // ==================== SECTION 4: Most Costly Filter ====================
    if (wouldWin.length > 0) {
        const filterCost = {};
        for (const miss of wouldWin) {
            const filter = miss.rejectReason?.split(' ')[0] || 'UNKNOWN';
            filterCost[filter] = (filterCost[filter] || 0) + 1;
        }

        const sorted = Object.entries(filterCost).sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
            msg += `🔍 *Filtro Más Costoso:*\n`;
            for (const [filter, count] of sorted.slice(0, 3)) {
                msg += `  ⚠️ ${esc(filter)}: ${esc(count)} oportunidades bloqueadas\n`;
            }
            msg += `\n`;
        }
    }

    // ==================== SECTION 5: Autopsy Insights ====================
    if (autopsies.length > 0) {
        // Average hours open by outcome
        const winAutopsies = autopsies.filter(a => a.outcome === 'WIN');
        const lossAutopsies = autopsies.filter(a => a.outcome === 'LOSS');

        msg += `🔬 *Autopsia de Trades:*\n`;

        if (winAutopsies.length > 0) {
            const avgHoursWin = (winAutopsies.reduce((s, a) => s + a.hoursOpen, 0) / winAutopsies.length).toFixed(1);
            const avgScoreWin = (winAutopsies.reduce((s, a) => s + a.score, 0) / winAutopsies.length).toFixed(0);
            msg += `  ✅ Wins: avg ${esc(avgHoursWin)}h, avg score ${esc(avgScoreWin)}\n`;
        }
        if (lossAutopsies.length > 0) {
            const avgHoursLoss = (lossAutopsies.reduce((s, a) => s + a.hoursOpen, 0) / lossAutopsies.length).toFixed(1);
            const avgScoreLoss = (lossAutopsies.reduce((s, a) => s + a.score, 0) / lossAutopsies.length).toFixed(0);
            const avgMaxFavLoss = (lossAutopsies.reduce((s, a) => s + a.favorableMovePct, 0) / lossAutopsies.length).toFixed(2);
            msg += `  ❌ Losses: avg ${esc(avgHoursLoss)}h, avg score ${esc(avgScoreLoss)}, maxFav ${esc(avgMaxFavLoss)}%\n`;
        }
        msg += `\n`;
    }

    // ==================== SECTION 6: Threshold Suggestions ====================
    msg += `🎯 *Sugerencias Adaptativas:*\n`;
    let hasSuggestions = false;

    for (const [regime, data] of Object.entries(regimes)) {
        const total = data.wins + data.losses;
        const wr = total > 0 ? (data.wins / total * 100) : 0;

        if (total >= 10 && wr > 60) {
            msg += `  📉 ${esc(regime)}: WR ${esc(wr.toFixed(0))}% en ${esc(total)} trades → Considerar bajar threshold \\-3 pts\n`;
            hasSuggestions = true;
        } else if (total >= 8 && wr < 35) {
            msg += `  📈 ${esc(regime)}: WR ${esc(wr.toFixed(0))}% en ${esc(total)} trades → Considerar subir threshold \\+5 pts\n`;
            hasSuggestions = true;
        }
    }

    if (!hasSuggestions) {
        msg += `  ℹ️ Sin cambios sugeridos \\(se necesitan más datos\\)\n`;
    }

    const timeStr = new Date().toLocaleTimeString('es-ES', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
    });
    msg += `\n🤖 _Self\\-Learning Digest_ • ${esc(timeStr)}`;

    return msg;
}

const digestHandler = async (event, context) => {
    console.log('[DIGEST] Auto-Digest started');

    try {
        const message = await generateDigest(context);
        const sent = await sendTelegramMessage(message);

        console.log(`[DIGEST] Message ${sent ? 'sent' : 'failed'}`);
        return {
            statusCode: 200,
            body: JSON.stringify({ success: sent })
        };
    } catch (error) {
        console.error('[DIGEST] Critical error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};

// Export the digest generator for use in telegram-bot.js
export { generateDigest };

// Run daily at 09:00 UTC (10:00 Madrid in winter, 11:00 in summer)
export const handler = schedule("0 9 * * *", digestHandler);
