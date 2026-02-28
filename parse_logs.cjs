const fs = require('fs');

const history = JSON.parse(fs.readFileSync('history.json', 'utf8'));
const logs = fs.readFileSync('logs.txt', 'utf8').split('\n');

// BLOQUE 1: Métricas
let wins = 0;
let losses = 0;
let staleExits = 0;
let opens = 0;
let sumRr = 0;
let signalCount = history.length;

history.forEach(t => {
    if (t.status === 'CLOSED') {
        if (t.outcome === 'WIN') wins++;
        if (t.outcome === 'LOSS') losses++;
        if (t.outcome === 'STALE_EXIT') staleExits++;
    } else if (t.status === 'OPEN') {
        opens++;
    }

    if (t.entryMetrics && t.entryMetrics.riskRewardRatio) {
        sumRr += t.entryMetrics.riskRewardRatio;
    }
});

let totalClosedForWr = wins + losses;
let wr = totalClosedForWr > 0 ? (wins / totalClosedForWr) * 100 : 0;
let avgRr = signalCount > 0 ? (sumRr / signalCount) : 0;

let cycles = 0;
logs.forEach(l => {
    if (l.includes('Iniciando ciclo') || l.includes('Iniciando análisis') || l.includes('Ciclo de análisis') || l.match(/Iniciando.*análisis/i)) {
        cycles++;
    }
});
// To be more precise, let's count a specific log line that appears per cycle.
// We'll search for typical cycle start/end logs if the above is 0.

let report = `
=== BLOQUE 1: Métricas de Rendimiento ===
Total Trades en history: ${signalCount}
WINs: ${wins}
LOSSes: ${losses}
STALE_EXITs: ${staleExits}
OPENs: ${opens}

Trades cerrados con outcome (WIN+LOSS): ${totalClosedForWr}
Win Rate Real: ${wr.toFixed(2)}%
% LOSSes: ${totalClosedForWr > 0 ? ((losses / totalClosedForWr) * 100).toFixed(2) : 0}%
% STALE_EXIT: ${signalCount > 0 ? ((staleExits / signalCount) * 100).toFixed(2) : 0}%

Ciclos detectados en logs: ${cycles} (Aprox)
Tasa de conversión: ${cycles > 0 ? ((signalCount / cycles) * 100).toFixed(2) : 'N/A'}%

R:R Real promedio de trades emitidos: ${avgRr.toFixed(2)}
`;

console.log(report);

if (totalClosedForWr < 5) {
    console.log("⚠️ ATENCIÓN: Hay menos de 5 trades cerrados (WIN/LOSS). Los datos NO son estadísticamente significativos.");
}

console.log("\n=== BLOQUE 2: Análisis de Patrones de Pérdida ===");
let lossTrades = history.filter(t => t.outcome === 'LOSS');

lossTrades.forEach(t => {
    console.log(`\n🔴 TRADE LOSS: ${t.symbol} (ID: ${t.id})`);
    console.log(`   - R:R: ${t.entryMetrics.riskRewardRatio}, BB%: ${t.entryMetrics.bbPercent}`);
    console.log(`   - Time: ${new Date(t.time).toISOString()}`);
    console.log(`   - Max Favorable: ${t.maxFavorable}, Price: ${t.price}, TP: ${t.tp}, SL: ${t.sl}`);

    // Find logs around this time
    let symbolLogs = logs.filter(l => l.includes(t.symbol) && l.includes('INFO'));
    if (symbolLogs.length > 0) {
        console.log(`   - Resumen de logs para ${t.symbol}:`);
        symbolLogs.slice(0, 5).forEach(l => console.log('     ' + l.trim()));
    } else {
        console.log(`   - No se encontraron logs específicos para ${t.symbol} alrededor de la entrada.`);
    }
});

let staleTrades = history.filter(t => t.outcome === 'STALE_EXIT');
console.log(`\n=== Análises de STALE_EXIT (${staleTrades.length}) ===`);
staleTrades.forEach(t => {
    console.log(`🟡 TRADE STALE_EXIT: ${t.symbol} (ID: ${t.id})`);
    console.log(`   - Max Favorable: ${t.maxFavorable}, Price: ${t.price}`);
});

