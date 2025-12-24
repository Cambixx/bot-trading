import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env from root
const envPath = path.resolve(__dirname, '../.env');
let apiKey = '';

try {
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        let match = envContent.match(/VITE_GEMINI_API_KEY=(.+)/);
        if (!match) match = envContent.match(/GEMINI_API_KEY=(.+)/);

        if (match) apiKey = match[1].trim();
    }
} catch (e) {
    console.error("Error reading .env:", e.message);
}

if (!apiKey) {
    console.error("❌ No API Key found in .env file (looked for VITE_GEMINI_API_KEY or GEMINI_API_KEY)");
    process.exit(1);
}

console.log(`🔍 Checking models for API Key ending in ...${apiKey.slice(-5)}`);

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

try {
    const response = await fetch(url);
    const json = await response.json();

    if (json.error) {
        console.error("❌ API returned Error:");
        console.error(JSON.stringify(json.error, null, 2));
    } else if (json.models) {
        console.log("\n✅ AVAILABLE MODELS (generateContent):");
        const contentModels = json.models.filter(m =>
            m.supportedGenerationMethods &&
            m.supportedGenerationMethods.includes('generateContent')
        );

        contentModels.forEach(m => {
            console.log(`- ${m.name}`);
        });

        console.log(`\n(Total: ${contentModels.length} models available)`);
    } else {
        console.log("❓ Unexpected response:", json);
    }
} catch (error) {
    console.error("❌ Network Request Error:", error.message);
}
