import dotenv from 'dotenv';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env vars
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

console.log('Testing Telegram Credentials...');
console.log('Token exists:', !!token);
console.log('Chat ID exists:', !!chatId);

if (!token || !chatId) {
    console.error('Missing credentials in .env');
    process.exit(1);
}

const message = JSON.stringify({
    chat_id: chatId,
    text: '*Test Notification from Trading Bot* 🤖\n\nIf you see this, credentials are correct!',
    parse_mode: 'MarkdownV2'
});

const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': message.length
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        console.log('Response:', data);
        if (res.statusCode === 200) {
            console.log('✅ SUCCESS: Notification sent!');
        } else {
            console.error('❌ FAILED: Check error message above.');
        }
    });
});

req.on('error', (e) => {
    console.error('Request Error:', e);
});

req.write(message);
req.end();
