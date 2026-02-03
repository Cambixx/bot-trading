
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Activity,
    Target,
    BarChart2,
    TrendingUp,
    Shield,
    Zap,
    Grid,
    AlertTriangle,
    CheckCircle,
    XCircle,
    MinusCircle
} from 'lucide-react';

const AlgoAnalytics = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // In local dev this will hit the fallback to history.json if blobs fail
                const res = await fetch('/.netlify/functions/algo-analytics');
                const json = await res.json();
                if (json.success) {
                    setData(json);
                } else {
                    setError(json.error || 'Failed to load analytics');
                }
            } catch (err) {
                console.error('Failed to fetch algo analytics:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    if (loading) return <div className="glass-card p-4 text-center">Analizando el núcleo del algoritmo...</div>;
    if (error) return <div className="glass-card p-4 text-center text-red-400">Error: {error}</div>;
    if (!data) return null;

    const { stats, regimeStats, scoreStats, factorStats, categoryAvgWins, categoryAvgLosses, recentTrades } = data;

    // Helper for WinRate Color
    const getWrColor = (wr) => {
        if (wr >= 60) return '#4ade80'; // green
        if (wr >= 45) return '#facc15'; // yellow
        return '#f87171'; // red
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <Activity className="text-primary" size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Diagnóstico del Algoritmo</h2>
                        <span className="text-xs text-muted">Análisis de rendimiento en tiempo real</span>
                    </div>
                </div>
                <span className="text-xs font-mono text-muted bg-white/5 px-3 py-1 rounded-full border border-white/5">
                    Actualizado: {new Date(data.timestamp).toLocaleTimeString()}
                </span>
            </div>

            {/* 1. KEY METRICS CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass-card p-5 flex flex-col items-center justify-center text-center hover:bg-white/5 transition-colors">
                    <span className="text-muted text-[10px] uppercase tracking-widest font-semibold mb-2">Win Rate Global</span>
                    <span className="text-3xl font-black tracking-tight" style={{ color: getWrColor(stats.winRate) }}>
                        {stats.winRate}%
                    </span>
                    <div className="flex gap-2 mt-2 text-[10px] font-mono opacity-80">
                        <span className="text-green-400">{stats.wins}W</span>
                        <span className="text-white/20">|</span>
                        <span className="text-red-400">{stats.losses}L</span>
                        <span className="text-white/20">|</span>
                        <span className="text-yellow-400">{stats.breakEvens}BE</span>
                    </div>
                </div>

                <div className="glass-card p-5 flex flex-col items-center justify-center text-center hover:bg-white/5 transition-colors">
                    <span className="text-muted text-[10px] uppercase tracking-widest font-semibold mb-2">Trades Totales</span>
                    <span className="text-3xl font-black text-white">{stats.totalTrades}</span>
                    <span className="text-xs text-blue-400 mt-2 font-medium bg-blue-400/10 px-2 py-0.5 rounded">
                        {stats.openTrades} Abiertos
                    </span>
                </div>

                <div className="glass-card p-5 flex flex-col items-center justify-center text-center hover:bg-white/5 transition-colors">
                    <span className="text-muted text-[10px] uppercase tracking-widest font-semibold mb-2">Mejor Régimen</span>
                    {(() => {
                        const bestRegime = Object.entries(regimeStats)
                            .sort((a, b) => b[1].winRate - a[1].winRate)[0];
                        return (
                            <>
                                <span className="text-xl font-bold text-blue-400 truncate w-full px-2">
                                    {bestRegime && bestRegime[1].total > 0 ? bestRegime[0] : '—'}
                                </span>
                                <span className="text-xs font-mono mt-2" style={{ color: getWrColor(bestRegime?.[1].winRate || 0) }}>
                                    {bestRegime && bestRegime[1].total > 0 ? `${bestRegime[1].winRate}% WR` : 'No Data'}
                                </span>
                            </>
                        );
                    })()}
                </div>

                <div className="glass-card p-5 flex flex-col items-center justify-center text-center hover:bg-white/5 transition-colors">
                    <span className="text-muted text-[10px] uppercase tracking-widest font-semibold mb-2">Mejor Factor</span>
                    {(() => {
                        const bestFactor = Object.entries(factorStats)
                            .sort((a, b) => b[1].winRate - a[1].winRate)[0];
                        return (
                            <>
                                <span className="text-xl font-bold text-purple-400 truncate w-full px-2">
                                    {bestFactor && bestFactor[1].present > 0 ? bestFactor[0] : '—'}
                                </span>
                                <span className="text-xs font-mono mt-2" style={{ color: getWrColor(bestFactor?.[1].winRate || 0) }}>
                                    {bestFactor && bestFactor[1].present > 0 ? `${bestFactor[1].winRate}% WR` : 'No Data'}
                                </span>
                            </>
                        );
                    })()}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 2. REGIME PERFORMANCE */}
                <div className="glass-card p-6 flex flex-col h-full">
                    <h3 className="text-sm font-semibold mb-6 flex items-center gap-2 text-white/90">
                        <Grid size={18} className="text-blue-400" /> Rendimiento por Régimen
                    </h3>
                    <div className="flex-1 space-y-5">
                        {Object.entries(regimeStats).map(([regime, s]) => (
                            <div key={regime} className="group">
                                <div className="flex justify-between text-xs mb-2">
                                    <span className={`${s.total === 0 ? 'text-muted' : 'text-white font-medium tracking-wide'} flex items-center gap-2`}>
                                        {regime}
                                        {s.total > 0 && <span className="bg-white/10 text-[9px] px-1.5 py-0.5 rounded text-muted">{s.total} trades</span>}
                                    </span>
                                    <span className="font-mono font-bold" style={{ color: getWrColor(s.winRate) }}>
                                        {s.total > 0 ? `${s.winRate}%` : '—'}
                                    </span>
                                </div>
                                <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/5">
                                    <div
                                        className="h-full rounded-full transition-all duration-1000 ease-out"
                                        style={{
                                            width: `${s.total > 0 ? Math.max(5, s.winRate) : 0}%`,
                                            backgroundColor: getWrColor(s.winRate),
                                            opacity: s.total === 0 ? 0 : 1
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 3. SCORE DISTRIBUTION */}
                <div className="glass-card p-6 flex flex-col h-full">
                    <h3 className="text-sm font-semibold mb-6 flex items-center gap-2 text-white/90">
                        <Target size={18} className="text-purple-400" /> Calidad del Score
                    </h3>
                    <div className="flex-1 flex items-end justify-between gap-4 px-2">
                        {Object.entries(scoreStats).map(([range, s]) => {
                            const height = Math.max(10, s.winRate);
                            const isEmpty = s.total === 0;
                            return (
                                <div key={range} className="flex flex-col items-center gap-3 w-full group">
                                    <div className="relative w-full flex justify-center">
                                        <span className={`text-sm font-bold absolute -top-6 transition-all ${isEmpty ? 'opacity-0' : 'opacity-100'}`} style={{ color: getWrColor(s.winRate) }}>
                                            {s.winRate}%
                                        </span>
                                    </div>
                                    <div className="w-full bg-white/5 rounded-t-lg relative h-40 flex items-end justify-center border-b border-white/10 group-hover:bg-white/10 transition-colors">
                                        {!isEmpty && (
                                            <div
                                                className="w-3/4 rounded-t-md transition-all duration-1000 ease-out relative"
                                                style={{
                                                    height: `${height}%`,
                                                    backgroundColor: getWrColor(s.winRate)
                                                }}
                                            >
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-center">
                                        <div className="text-[10px] font-bold text-white mb-0.5">{range}</div>
                                        <div className="text-[9px] text-muted uppercase bg-white/5 px-2 py-0.5 rounded-full inline-block">
                                            {s.total} Trades
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 4. RECENT TRADES TABLE */}
            <div className="glass-card p-0 overflow-hidden border border-white/5">
                <div className="p-4 border-b border-white/10 bg-white/[0.02] flex justify-between items-center">
                    <h3 className="text-sm font-semibold flex items-center gap-2 text-white/90">
                        <Activity size={18} className="text-green-400" /> Historial Reciente
                    </h3>
                    <span className="text-[10px] text-muted bg-white/5 px-2 py-1 rounded border border-white/5">Últimos {recentTrades.length}</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left whitespace-nowrap">
                        <thead className="text-muted bg-[#0f1115] uppercase text-[10px] tracking-wider font-semibold">
                            <tr>
                                <th className="p-4 pl-6">Símbolo</th>
                                <th className="p-4">Régimen</th>
                                <th className="p-4 text-center">Score</th>
                                <th className="p-4 text-right pr-6">Resultado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {recentTrades.map((t) => (
                                <tr key={t.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="p-4 pl-6">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold text-white group-hover:text-primary transition-colors">{t.symbol}</span>
                                            <span className="text-[10px] text-muted font-mono mt-0.5">{new Date(t.time).toLocaleDateString()}</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className="bg-white/5 text-muted px-2 py-1 rounded text-[10px] border border-white/5">
                                            {t.regime}
                                        </span>
                                    </td>
                                    <td className="p-4 text-center">
                                        <span
                                            className="px-2 py-1 rounded text-xs font-bold"
                                            style={{
                                                color: t.score >= 90 ? '#4ade80' : '#facc15',
                                                backgroundColor: t.score >= 90 ? 'rgba(74, 222, 128, 0.1)' : 'rgba(250, 204, 21, 0.1)'
                                            }}
                                        >
                                            {t.score}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right pr-6">
                                        {t.status === 'OPEN' ? (
                                            <span className="inline-flex items-center gap-1.5 text-blue-400 bg-blue-400/10 px-2 py-1 rounded border border-blue-400/20">
                                                <Activity size={12} /> <span className="font-bold">OPEN</span>
                                            </span>
                                        ) : t.outcome === 'WIN' ? (
                                            <span className="inline-flex items-center gap-1.5 text-green-400 bg-green-400/10 px-2 py-1 rounded border border-green-400/20">
                                                <CheckCircle size={12} /> <span className="font-bold">WIN</span>
                                            </span>
                                        ) : t.outcome === 'BREAK_EVEN' ? (
                                            <span className="inline-flex items-center gap-1.5 text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded border border-yellow-500/20">
                                                <MinusCircle size={12} /> <span className="font-bold">BE</span>
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 text-red-500 bg-red-500/10 px-2 py-1 rounded border border-red-500/20">
                                                <XCircle size={12} /> <span className="font-bold">LOSS</span>
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AlgoAnalytics;
