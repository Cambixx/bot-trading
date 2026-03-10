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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

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
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNetlifyToken() {
    // 1. Environment variable
    if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;

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
            if (config.users) {
                const userId = config.userId || Object.keys(config.users)[0];
                if (userId && config.users[userId]?.auth?.token) {
                    return config.users[userId].auth.token;
                }
            }
        } catch { /* ignore */ }
    }

    return null;
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function syncBlobs(filter) {
    const token = getNetlifyToken();
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
    console.log('');

    let success = 0;
    let failed = 0;

    for (const { key, file, label } of targets) {
        const filePath = resolve(ROOT, file);
        process.stdout.write(`  ⏳ ${label.padEnd(20)} `);

        try {
            const data = await store.get(key, { type: 'json' });

            if (data === null || data === undefined) {
                console.log('⚠️  Empty (blob not found)');
                // Write empty structure
                writeFileSync(filePath, '[]', 'utf-8');
                success++;
                continue;
            }

            const json = JSON.stringify(data, null, 2);
            writeFileSync(filePath, json, 'utf-8');

            const size = formatBytes(Buffer.byteLength(json, 'utf-8'));
            const count = formatCount(data);
            console.log(`✅ ${count} (${size}) → ${file}`);
            success++;
        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
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
