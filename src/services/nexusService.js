/**
 * Nexus Intelligence Service
 * Uses OpenRouter AI to synthesize market intelligence directly.
 */
import { getNexusIntelligence } from './aiAnalysis';

export const fetchNexusIntelligence = async (marketBreadth) => {
    try {
        console.log('🌌 Activating Nexus Intelligence Agent...');
        const result = await getNexusIntelligence(marketBreadth);

        if (result.success && result.analysis) {
            return result.analysis;
        }

        throw new Error(result.error || 'AI Analysis failed');
    } catch (error) {
        console.error('❌ Nexus Agent Error:', error);
        return {
            success: false,
            error: error.message,
            sentiment: { score: 50, label: 'NEUTRAL', summary: 'Establishing connection with intelligence nodes...' }
        };
    }
};
