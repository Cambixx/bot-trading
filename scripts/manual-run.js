
import dotenv from 'dotenv';
import { runAnalysis } from '../netlify/functions/scheduled-analysis.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const SITE_ID = 'be80fad2-39f0-4f8f-b67c-871b07ce7b97';

function getNetlifyToken() {
    const home = os.homedir();
    // macOS fallback path included
    const paths = [
        resolve(home, '.netlify/config.json'),
        resolve(home, 'Library/Preferences/netlify/config.json')
    ];

    for (const configPath of paths) {
        if (existsSync(configPath)) {
            try {
                const config = JSON.parse(readFileSync(configPath, 'utf8'));
                if (config.authId || (config.users && Object.keys(config.users).length > 0)) {
                    // Try to get first user's token or main authId
                    const token = config.authId || Object.values(config.users)[0]?.auth?.token;
                    if (token) return token;
                }
            } catch (e) {
                console.error(`Error reading ${configPath}:`, e.message);
            }
        }
    }
    return process.env.NETLIFY_AUTH_TOKEN;
}

async function start() {
    console.log("🚀 Starting Manual Analysis Test...");

    const token = getNetlifyToken();
    if (!token) {
        console.error("❌ Error: Netlify token not found. Run 'netlify login' or set NETLIFY_AUTH_TOKEN.");
        process.exit(1);
    }

    const context = {
        siteID: SITE_ID,
        token: token
    };

    try {
        const result = await runAnalysis(context);
        console.log("\n--- Analysis Result ---");
        console.log(JSON.stringify(result, null, 2));

        if (result.success) {
            console.log("\n✅ Manual test completed successfully.");
        } else {
            console.error("\n❌ Manual test failed:", result.error);
        }
    } catch (err) {
        console.error("\n💥 CRITICAL ERROR during test:", err.message);
        process.exit(1);
    }
}

start();
