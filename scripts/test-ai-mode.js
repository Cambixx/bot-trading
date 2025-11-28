import { getAIAnalysis } from '../src/services/aiAnalysis.js';

// Mock global fetch
global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.contents[0].parts[0].text;

    console.log('\n--- Prompt Generated ---');
    console.log(prompt.substring(0, 200) + '...'); // Log start of prompt to check context

    return {
        ok: true,
        json: async () => ({
            candidates: [{
                content: {
                    parts: [{
                        text: JSON.stringify({
                            sentiment: 'NEUTRAL',
                            recommendation: 'HOLD',
                            insights: ['Mock response'],
                            riskAssessment: 'LOW'
                        })
                    }]
                }
            }]
        })
    };
};

// Mock environment
process.env.VITE_GEMINI_API_KEY = 'test-key';

console.log('🧪 Testing AI Mode Awareness...');

const mockMarketData = {
    symbol: 'BTCUSDC',
    price: 50000,
    indicators: {},
    patterns: [],
    reasons: [],
    warnings: []
};

async function test() {
    console.log('\nTesting CONSERVATIVE mode:');
    await getAIAnalysis(mockMarketData, 'CONSERVATIVE');

    console.log('\nTesting RISKY mode:');
    await getAIAnalysis(mockMarketData, 'RISKY');
}

test();
