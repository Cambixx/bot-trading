
import { getStore } from "@netlify/blobs";
import fs from 'fs/promises';
import path from 'path';

const HISTORY_STORE_KEY = 'signal-history-v2';

// Reuse store access pattern from scheduled-analysis.js
function getInternalStore(context) {
    const options = { name: 'trading-signals' };
    const siteID = context?.site?.id || process.env.NETLIFY_SITE_ID;
    const token = context?.token || process.env.NETLIFY_AUTH_TOKEN;
    if (siteID) options.siteID = siteID;
    if (token) options.token = token;
    return getStore(options);
}

export const handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        let history = [];

        // Try getting from Blobs first (Production)
        try {
            const store = getInternalStore(context);
            const blobData = await store.get(HISTORY_STORE_KEY, { type: 'json' });
            if (blobData && Array.isArray(blobData)) {
                history = blobData;
            }
        } catch (blobError) {
            console.warn('Blobs access failed, fallback to local:', blobError.message);

            // Fallback to local history.json (Development)
            try {
                const historyPath = path.resolve('./history.json');
                const fileData = await fs.readFile(historyPath, 'utf8');
                history = JSON.parse(fileData);
            } catch (fileError) {
                console.warn('Local history.json read failed:', fileError.message);
            }
        }

        // --- Aggregation Logic ---
        const stats = {
            totalTrades: history.length,
            openTrades: history.filter(t => t.status === 'OPEN').length,
            closedTrades: history.filter(t => t.status === 'CLOSED').length,
            wins: 0,
            losses: 0,
            breakEvens: 0,
            winRate: 0
        };

        const regimeStats = {};
        const scoreStats = {
            '70-79': { total: 0, wins: 0, losses: 0, winRate: 0 },
            '80-89': { total: 0, wins: 0, losses: 0, winRate: 0 },
            '90-100': { total: 0, wins: 0, losses: 0, winRate: 0 }
        };
        const factorStats = {
            'MSS': { present: 0, winsWithFactor: 0, winRate: 0 },
            'Sweep': { present: 0, winsWithFactor: 0, winRate: 0 },
            'Pattern': { present: 0, winsWithFactor: 0, winRate: 0 },
            'Divergence': { present: 0, winsWithFactor: 0, winRate: 0 }
        };
        const categoryAvgWins = { momentum: 0, trend: 0, structure: 0, volume: 0, patterns: 0, count: 0 };
        const categoryAvgLosses = { momentum: 0, trend: 0, structure: 0, volume: 0, patterns: 0, count: 0 };

        // Process CLOSED trades only for stats
        const closedTrades = history.filter(t => t.status === 'CLOSED');

        closedTrades.forEach(trade => {
            // Overall Outcome
            if (trade.outcome === 'WIN') stats.wins++;
            else if (trade.outcome === 'LOSS') stats.losses++;
            else if (trade.outcome === 'BREAK_EVEN') stats.breakEvens++;

            const isWin = trade.outcome === 'WIN';
            const isLoss = trade.outcome === 'LOSS'; // Strict loss for categorization

            // Regime Stats
            const regime = trade.regime || 'UNKNOWN';
            if (!regimeStats[regime]) {
                regimeStats[regime] = { total: 0, wins: 0, losses: 0, breakEvens: 0, winRate: 0 };
            }
            regimeStats[regime].total++;
            if (trade.outcome === 'WIN') regimeStats[regime].wins++;
            else if (trade.outcome === 'LOSS') regimeStats[regime].losses++;
            else if (trade.outcome === 'BREAK_EVEN') regimeStats[regime].breakEvens++;

            // Score Stats
            const score = trade.score || 0;
            let scoreRange = '70-79';
            if (score >= 90) scoreRange = '90-100';
            else if (score >= 80) scoreRange = '80-89';

            if (scoreStats[scoreRange]) {
                scoreStats[scoreRange].total++;
                if (isWin) scoreStats[scoreRange].wins++;
                else if (isLoss) scoreStats[scoreRange].losses++;
            }

            // Factor Stats
            if (trade.hasMSS) {
                factorStats['MSS'].present++;
                if (isWin) factorStats['MSS'].winsWithFactor++;
            }
            if (trade.hasSweep) {
                factorStats['Sweep'].present++;
                if (isWin) factorStats['Sweep'].winsWithFactor++;
            }
            if (trade.hasPattern || (trade.reasons && trade.reasons.some(r => r.includes('🕯️')))) {
                factorStats['Pattern'].present++;
                if (isWin) factorStats['Pattern'].winsWithFactor++;
            }
            if (trade.hasDivergence || (trade.reasons && trade.reasons.some(r => r.includes('🔥')))) {
                factorStats['Divergence'].present++;
                if (isWin) factorStats['Divergence'].winsWithFactor++;
            }

            // Category Averages
            if (trade.categoryScores) {
                const cat = trade.categoryScores;
                const target = isWin ? categoryAvgWins : (isLoss ? categoryAvgLosses : null);

                if (target) {
                    target.momentum += cat.momentum || 0;
                    target.trend += cat.trend || 0;
                    target.structure += cat.structure || 0;
                    target.volume += cat.volume || 0;
                    target.patterns += cat.patterns || 0;
                    target.count++;
                }
            }
        });

        // Compute Win Rates & Averages
        const calcWR = (wins, losses) => {
            const total = wins + losses;
            return total > 0 ? Number(((wins / total) * 100).toFixed(1)) : 0;
        };

        stats.winRate = calcWR(stats.wins, stats.losses);

        Object.values(regimeStats).forEach(s => {
            s.winRate = calcWR(s.wins, s.losses);
        });

        Object.values(scoreStats).forEach(s => {
            s.winRate = calcWR(s.wins, s.losses);
        });

        Object.values(factorStats).forEach(s => {
            // For factors, win rate is wins / times factor was present (approximation)
            // But usually win rate is Wins / (Wins + Losses) where factor was present
            // Here 'present' includes all outcomes. Let's stick to standard WR definition if possible, 
            // but we only tracked 'winsWithFactor'. Ideally we would track lossesWithFactor too.
            // Simplified: (Wins / Total Present) * 100
            s.winRate = s.present > 0 ? Number(((s.winsWithFactor / s.present) * 100).toFixed(1)) : 0;
        });

        const avgCats = (target) => {
            if (target.count > 0) {
                target.momentum = Number((target.momentum / target.count).toFixed(1));
                target.trend = Number((target.trend / target.count).toFixed(1));
                target.structure = Number((target.structure / target.count).toFixed(1));
                target.volume = Number((target.volume / target.count).toFixed(1));
                target.patterns = Number((target.patterns / target.count).toFixed(1));
            }
        };
        avgCats(categoryAvgWins);
        avgCats(categoryAvgLosses);


        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                timestamp: new Date().toISOString(),
                stats,
                regimeStats,
                scoreStats,
                factorStats,
                categoryAvgWins,
                categoryAvgLosses,
                recentTrades: history.slice(-15).reverse() // Last 15 trades reversed (newest first)
            })
        };

    } catch (error) {
        console.error('Algo Analytics Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
