/**
 * Clear Netlify Blobs Maintenance Script
 * 
 * Deletes all keys in the Netlify Blob store "trading-signals" to allow
 * the bot to start from a fresh state (clearing history, logs, autopsies, etc).
 * 
 * Usage:
 *   npm run clear-blobs
 * 
 * Requires: Netlify CLI authenticated (run `netlify login` first)
 */

import { getStore } from '@netlify/blobs';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
dotenv.config({ path: resolve(ROOT, '.env') });

// ─── Configuration ───────────────────────────────────────────────────────────

const SITE_ID = 'be80fad2-39f0-4f8f-b67c-871b07ce7b97';
const STORE_NAME = 'trading-signals';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNetlifyToken() {
    if (process.env.NETLIFY_AUTH_TOKEN) {
        return { token: process.env.NETLIFY_AUTH_TOKEN, source: 'NETLIFY_AUTH_TOKEN' };
    }

    const home = process.env.HOME || process.env.USERPROFILE;
    const configPaths = [
        resolve(home, '.netlify', 'config.json'),
        resolve(home, 'Library', 'Preferences', 'netlify', 'config.json'),
    ];

    for (const configPath of configPaths) {
        if (!existsSync(configPath)) continue;
        try {
            const config = JSON.parse(readFileSync(configPath, 'utf-8'));
            if (config.authId) return { token: config.authId, source: configPath + ' (authId)' };
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function clearBlobs() {
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

    console.log('');
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║        🗑️  Netlify Blobs Cleanup Utility           ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log(`  Store: ${STORE_NAME}`);
    console.log(`  Site:  ${SITE_ID}`);
    console.log(`  Auth:  ${tokenSource || 'unknown source'}`);
    console.log('');

    console.log('  ⏳ Fetching keys...');
    let keys = [];
    try {
        const list = await store.list();
        keys = list.blobs.map(b => b.key);
    } catch (error) {
        console.error('❌ Error listing blobs:', error.message);
        process.exit(1);
    }

    if (keys.length === 0) {
        console.log('  ✨ Store is already empty. Nothing to delete.');
        console.log('');
        return;
    }

    console.log(`  🔍 Found ${keys.length} key(s) to delete.`);
    console.log('');

    let deleted = 0;
    let failed = 0;

    for (const key of keys) {
        process.stdout.write(`  ⏳ Deleting ${key.padEnd(25)} `);
        try {
            await store.delete(key);
            console.log('✅');
            deleted++;
        } catch (error) {
            console.log(`❌ (${error.message})`);
            failed++;
        }
    }

    console.log('');
    console.log(`  ────────────────────────────────────`);
    console.log(`  🧹 Cleanup complete!`);
    console.log(`  ✅ Deleted: ${deleted}  ❌ Failed: ${failed}`);
    console.log('');
}

clearBlobs().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
