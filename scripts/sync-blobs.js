/**
 * Sync Netlify Blobs → Local JSON Files
 * 
 * Downloads data from Netlify Blobs store "trading-signals" and writes
 * it to the corresponding local JSON files for auditing and analysis.
 * 
 * Usage:
 *   node scripts/sync-blobs.js           # Sync all stores
 *   node scripts/sync-blobs.js history    # Sync only history.json
 *   node scripts/sync-blobs.js shadow     # Sync only shadow_trades.json
 * 
 * Requires: Netlify CLI authenticated (run `netlify login` first)
 */

import { getStore } from '@netlify/blobs';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
dotenv.config({ path: resolve(ROOT, '.env') });

// ─── Configuration ───────────────────────────────────────────────────────────

const SITE_ID = 'be80fad2-39f0-4f8f-b67c-871b07ce7b97';
const STORE_NAME = 'trading-signals';

/** Mapping: blob key → local file name */
const BLOB_MAP = [
    { key: 'signal-history-v2', file: 'history.json', label: 'Signal History' },
    { key: 'persistent-logs-v1', file: 'persistent_logs.json', label: 'Persistent Logs' },
    { key: 'shadow-trades-v1', file: 'shadow_trades.json', label: 'Shadow Trades' },
    { key: 'shadow-trades-archive-v1', file: 'shadow_trades_archive.json', label: 'Shadow Archive' },
    { key: 'signal-memory-v1', file: 'signal_memory.json', label: 'Signal Memory' },
    { key: 'trade-autopsies-v1', file: 'autopsies.json', label: 'Trade Autopsies' },
    { key: 'knife-history-v1', file: 'knife_history.json', label: 'Knife History' },
    { key: 'knife-persistent-logs-v1', file: 'knife_persistent_logs.json', label: 'Knife Logs' },
    { key: 'knife-shadow-trades-v1', file: 'knife_shadow_trades.json', label: 'Knife Shadows' },
    { key: 'knife-shadow-archive-v1', file: 'knife_shadow_archive.json', label: 'Knife Archive' },
    { key: 'knife-signal-memory-v1', file: 'knife_signal_memory.json', label: 'Knife Memory' },
    { key: 'knife-trade-autopsies-v1', file: 'knife_autopsies.json', label: 'Knife Autopsies' },
];

// Short aliases for CLI filtering
const ALIASES = {
    history: 'signal-history-v2',
    logs: 'persistent-logs-v1',
    shadow: 'shadow-trades-v1',
    archive: 'shadow-trades-archive-v1',
    memory: 'signal-memory-v1',
    autopsy: 'trade-autopsies-v1',
    autopsies: 'trade-autopsies-v1',
    knifehistory: 'knife-history-v1',
    knifelogs: 'knife-persistent-logs-v1',
    knifeshadow: 'knife-shadow-trades-v1',
    knifearchive: 'knife-shadow-archive-v1',
    knifememory: 'knife-signal-memory-v1',
    knifeautopsy: 'knife-trade-autopsies-v1',
    knifeautopsies: 'knife-trade-autopsies-v1',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNetlifyToken() {
    // 1. Environment variable
    if (process.env.NETLIFY_AUTH_TOKEN) {
        return { token: process.env.NETLIFY_AUTH_TOKEN, source: 'NETLIFY_AUTH_TOKEN' };
    }

    // 2. Netlify CLI config files (set by `netlify login`)
    const home = process.env.HOME || process.env.USERPROFILE;
    const configPaths = [
        resolve(home, '.netlify', 'config.json'),                           // Linux / older
        resolve(home, 'Library', 'Preferences', 'netlify', 'config.json'), // macOS
    ];

    for (const configPath of configPaths) {
        if (!existsSync(configPath)) continue;
        try {
            const config = JSON.parse(readFileSync(configPath, 'utf-8'));

            if (config.authId) {
                return { token: config.authId, source: configPath + ' (authId)' };
            }

            if (config.users) {
                const userId = config.userId || Object.keys(config.users)[0];
                if (userId && config.users[userId]?.auth?.token) {
                    return { token: config.users[userId].auth.token, source: configPath + ' (users.*.auth.token)' };
                }
            }
        } catch { /* ignore */ }
    }

    return { token: null, source: null };
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatCount(data) {
    if (Array.isArray(data)) return `${data.length} items`;
    if (typeof data === 'object' && data !== null) return `${Object.keys(data).length} keys`;
    return 'unknown structure';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function describeError(error) {
    const parts = [];
    if (error?.message) parts.push(error.message);
    if (error?.cause?.message && error.cause.message !== error.message) parts.push(`cause: ${error.cause.message}`);
    if (error?.cause?.code) parts.push(`code: ${error.cause.code}`);
    if (error?.name && error.name !== 'Error') parts.push(`name: ${error.name}`);
    return parts.length ? parts.join(' | ') : 'Unknown error';
}

function isRetryableFetchError(error) {
    const text = `${error?.message || ''} ${error?.cause?.message || ''}`.toLowerCase();
    return text.includes('fetch failed')
        || text.includes('timed out')
        || text.includes('timeout')
        || text.includes('socket')
        || text.includes('econnreset')
        || text.includes('enotfound')
        || text.includes('eai_again')
        || text.includes('network');
}

async function getBlobWithRetry(store, key, maxAttempts = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const data = await store.get(key, { type: 'json' });
            return { data, attempts: attempt };
        } catch (error) {
            lastError = error;
            if (!isRetryableFetchError(error) || attempt === maxAttempts) {
                break;
            }

            const delayMs = 400 * attempt;
            console.log(`↻ retry ${attempt}/${maxAttempts - 1} in ${delayMs}ms (${describeError(error)})`);
            await sleep(delayMs);
        }
    }

    throw lastError;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function syncBlobs(filter) {
    const { token, source: tokenSource } = getNetlifyToken();
    if (!token) {
        console.error('❌ No Netlify auth token found.');
        console.error('   Run `netlify login` or set NETLIFY_AUTH_TOKEN env variable.');
        process.exit(1);
    }

    const store = getStore({
        name: STORE_NAME,
        siteID: SITE_ID,
        token,
    });

    // Determine which blobs to sync
    let targets = BLOB_MAP;
    if (filter) {
        const resolvedKey = ALIASES[filter.toLowerCase()] || filter;
        targets = BLOB_MAP.filter(b => b.key === resolvedKey);
        if (targets.length === 0) {
            console.error(`❌ Unknown target: "${filter}"`);
            console.error(`   Available: ${Object.keys(ALIASES).join(', ')}`);
            process.exit(1);
        }
    }

    console.log('');
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║        📡 Netlify Blobs → Local JSON Sync        ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log(`  Store: ${STORE_NAME}`);
    console.log(`  Site:  ${SITE_ID}`);
    console.log(`  Targets: ${targets.length} blob(s)`);
    console.log(`  Auth:  ${tokenSource || 'unknown source'}`);
    console.log('');

    let success = 0;
    let failed = 0;

    for (const { key, file, label } of targets) {
        const filePath = resolve(ROOT, file);
        process.stdout.write(`  ⏳ ${label.padEnd(20)} `);

        try {
            const { data, attempts } = await getBlobWithRetry(store, key);

            if (data === null || data === undefined) {
                console.log(`⚠️  Empty (blob not found${attempts > 1 ? ` after ${attempts} attempts` : ''})`);
                // Write empty structure
                writeFileSync(filePath, '[]', 'utf-8');
                success++;
                continue;
            }

            const json = JSON.stringify(data, null, 2);
            writeFileSync(filePath, json, 'utf-8');

            const size = formatBytes(Buffer.byteLength(json, 'utf-8'));
            const count = formatCount(data);
            const retryText = attempts > 1 ? ` after ${attempts} attempts` : '';
            console.log(`✅ ${count} (${size}) → ${file}${retryText}`);
            success++;
        } catch (error) {
            console.log(`❌ Error: ${describeError(error)}`);
            failed++;
        }
    }

    console.log('');
    console.log(`  ────────────────────────────────────`);
    console.log(`  ✅ Synced: ${success}  ❌ Failed: ${failed}`);
    console.log(`  📁 Files written to: ${ROOT}`);
    console.log('');
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const filter = process.argv[2] || null;
syncBlobs(filter).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
