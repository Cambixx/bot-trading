/**
 * Strategy tournament: runs multiple variations of a bot and produces ONE
 * consolidated HTML + JSON so we can pick the best strategy without flooding
 * the backtests/ directory.
 *
 * Data is loaded once and reused across variations (huge speedup).
 *
 * Outputs (overwritten on each run):
 *   backtests/{bot}-tournament.html
 *   backtests/{bot}-tournament.json
 *
 * Usage:
 *   node scripts/strategy-tournament.js --bot=trader [--months=1] [--no-open]
 *   node scripts/strategy-tournament.js --bot=knife
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { Backtester } from './v13-backtest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { bot: 'trader' };
  for (const a of args) {
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      opts[k] = v === undefined ? true : v;
    }
  }
  return opts;
}

function buildStrategies(bot) {
  if (bot === 'trader') {
    return [
      { label: 'baseline-prod',     desc: 'Live modules, default risk (current production behaviour)',  knobs: {} },
      { label: 'tighter-sl',        desc: 'Live modules, SL distance × 0.75',                            knobs: { slMult: 0.75 } },
      { label: 'wider-tp',          desc: 'Live modules, TP distance × 1.3',                             knobs: { rrMult: 1.3 } },
      { label: 'aggressive-rr',     desc: 'Live modules, SL × 0.8 + TP × 1.25',                          knobs: { slMult: 0.8, rrMult: 1.25 } },
      { label: 'no-be',             desc: 'Live modules, disable breakeven move',                        knobs: { 'no-be': true } },
      { label: 'early-be',          desc: 'Live modules, move SL to BE at 30% of TP travel',             knobs: { beFraction: 0.3 } },
      { label: 'vidya-only',        desc: 'Only VIDYA_SQUEEZE_EXPANSION signals',                        knobs: { modules: 'VIDYA_SQUEEZE_EXPANSION' } },
      { label: 'smc-only',          desc: 'Only SMC_DISCOUNT_RECLAIM signals',                           knobs: { modules: 'SMC_DISCOUNT_RECLAIM' } },
      { label: 'twopole-only',      desc: 'Only TWO_POLE_PULLBACK_CONTINUATION signals',                 knobs: { modules: 'TWO_POLE_PULLBACK_CONTINUATION' } },
      { label: 'shadow-enabled',    desc: 'Live + shadowOnly modules enabled (all 6)',                   knobs: { shadow: true } }
    ];
  }
  if (bot === 'knife') {
    return [
      { label: 'baseline-allmods',  desc: 'All 3 reversal modules enabled, default risk',                knobs: { shadow: true } },
      { label: 'tighter-sl',        desc: 'All modules, SL × 0.75',                                      knobs: { shadow: true, slMult: 0.75 } },
      { label: 'wider-tp',          desc: 'All modules, TP × 1.3',                                       knobs: { shadow: true, rrMult: 1.3 } },
      { label: 'aggressive-rr',     desc: 'All modules, SL × 0.8 + TP × 1.25',                           knobs: { shadow: true, slMult: 0.8, rrMult: 1.25 } },
      { label: 'no-be',             desc: 'All modules, disable breakeven move',                         knobs: { shadow: true, 'no-be': true } },
      { label: 'twopole-only',      desc: 'Only TWO_POLE_CAPITULATION_RESET',                            knobs: { shadow: true, modules: 'TWO_POLE_CAPITULATION_RESET' } },
      { label: 'vidya-only',        desc: 'Only VIDYA_LIQUIDITY_SWEEP',                                  knobs: { shadow: true, modules: 'VIDYA_LIQUIDITY_SWEEP' } },
      { label: 'sott-only',         desc: 'Only SOTT_BAND_RECLAIM',                                      knobs: { shadow: true, modules: 'SOTT_BAND_RECLAIM' } }
    ];
  }
  throw new Error(`Unknown bot: ${bot}`);
}

function summaryRow(label, desc, r) {
  const s = r.summary, ho = r.holdoutSummary;
  return {
    label, desc,
    trades: s.totalTrades,
    winRate: s.winRate,
    roi: s.roi,
    profitFactor: s.profitFactor,
    maxDD: s.maxDrawdown,
    expectancy: s.expectancy,
    avgHold: s.avgDurationHours,
    finalBalance: s.finalBalance,
    holdoutTrades: ho.totalTrades,
    holdoutPF: ho.profitFactor,
    holdoutWR: ho.winRate,
    holdoutROI: ho.roi
  };
}

function scoreStrategy(row) {
  if (row.trades < 8) return -Infinity;
  const pfScore = row.profitFactor === Infinity ? 3 : Math.min(row.profitFactor, 3);
  const oosFactor = row.holdoutTrades > 0
    ? (row.holdoutPF === Infinity ? 1 : Math.min(row.holdoutPF, 2)) / 2
    : 0.6;
  const ddPenalty = Math.max(0, 1 - row.maxDD / 25);
  return pfScore * 0.5 + (row.roi / 10) * 0.3 + oosFactor * 0.15 + ddPenalty * 0.05;
}

function renderVariantSection(report, strat, rank, isWinner) {
  const s = report.summary, tr = report.trainSummary, ho = report.holdoutSummary;
  const KNOB_DEFAULTS = { allowShadowOnly: false, moduleFilter: null, rrMult: 1.0, slMult: 1.0, beFraction: 0.5, slippagePct: 0.001 };
  const knobs = Object.entries(report.meta.knobs)
    .filter(([k, v]) => {
      const def = KNOB_DEFAULTS[k];
      if (Array.isArray(v) && def === null) return v.length > 0;
      return v !== def;
    })
    .map(([k, v]) => `<span class="chip"><b>${k}</b>:&nbsp;${Array.isArray(v) ? v.join(',') : v}</span>`)
    .join('');
  const symRows = Object.entries(s.bySymbol).map(([k, v]) =>
    `<tr><td>${k}</td><td>${v.trades}</td><td>${v.trades ? ((v.wins / v.trades) * 100).toFixed(1) : 0}%</td><td class="${v.profit >= 0 ? 'win' : 'loss'}">${v.profit >= 0 ? '+' : ''}${v.profit.toFixed(2)}</td></tr>`
  ).join('');
  const modRows = Object.entries(s.byModule).map(([k, v]) =>
    `<tr><td>${k}</td><td>${v.trades}</td><td>${v.trades ? ((v.wins / v.trades) * 100).toFixed(1) : 0}%</td></tr>`
  ).join('');
  const reasonRows = Object.entries(s.byReason).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  const rejRows = Object.entries(report.diagnostics.rejections).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  const tradeRows = report.trades.slice(-30).map(t =>
    `<tr><td>${t.openTime.slice(0, 16).replace('T', ' ')}</td><td>${t.symbol}</td><td>${t.module || ''}</td><td>${t.reason}</td><td class="${t.pnlPct >= 0 ? 'win' : 'loss'}">${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%</td></tr>`
  ).join('');

  const verdict = report.trades.length === 0
    ? '<div class="verdict">⚠️ Sin trades</div>'
    : tr.totalTrades === 0 || ho.totalTrades === 0
      ? '<div class="verdict">⚠️ OOS sin trades</div>'
      : '';

  return `
<details ${isWinner ? 'open' : ''} class="variant ${isWinner ? 'winner' : ''}">
  <summary>
    <span class="rank">#${rank}</span>
    <b>${strat.label}</b>
    ${isWinner ? '<span class="trophy">🏆</span>' : ''}
    <span class="oneliner">${s.totalTrades} trades · ROI <span class="${s.roi >= 0 ? 'win' : 'loss'}">${s.roi >= 0 ? '+' : ''}${s.roi}%</span> · PF ${s.profitFactor} · WR ${s.winRate}% · DD -${s.maxDrawdown}%</span>
  </summary>
  <div class="variant-body">
    <div class="muted desc">${strat.desc}</div>
    <div class="knobs">${knobs || '<span class="muted">defaults</span>'}</div>

    <div class="grid">
      <div class="stat"><div class="v">${s.totalTrades}</div><div class="l">Trades</div></div>
      <div class="stat"><div class="v ${s.roi >= 0 ? 'win' : 'loss'}">${s.roi >= 0 ? '+' : ''}${s.roi}%</div><div class="l">ROI</div></div>
      <div class="stat"><div class="v">${s.winRate}%</div><div class="l">Win Rate</div></div>
      <div class="stat"><div class="v">${s.profitFactor}</div><div class="l">Profit Factor</div></div>
      <div class="stat"><div class="v loss">-${s.maxDrawdown}%</div><div class="l">Max DD</div></div>
      <div class="stat"><div class="v">${s.expectancy}</div><div class="l">Expectancy USD</div></div>
      <div class="stat"><div class="v">${s.avgDurationHours}h</div><div class="l">Avg Hold</div></div>
      <div class="stat"><div class="v">${s.finalBalance}</div><div class="l">Final Balance</div></div>
    </div>

    <h4>OOS (split ${report.meta.splitDate})</h4>
    <table class="small"><thead><tr><th>Métrica</th><th>Train</th><th>Holdout</th></tr></thead><tbody>
      <tr><td>Trades</td><td>${tr.totalTrades}</td><td>${ho.totalTrades}</td></tr>
      <tr><td>Win Rate</td><td>${tr.winRate}%</td><td>${ho.winRate}%</td></tr>
      <tr><td>Profit Factor</td><td>${tr.profitFactor}</td><td>${ho.profitFactor}</td></tr>
      <tr><td>ROI</td><td>${tr.roi}%</td><td>${ho.roi}%</td></tr>
      <tr><td>Max DD</td><td>-${tr.maxDrawdown}%</td><td>-${ho.maxDrawdown}%</td></tr>
    </tbody></table>
    ${verdict}

    <div class="row">
      <div class="col"><h4>Por símbolo</h4><table class="small"><thead><tr><th>Sím</th><th>T</th><th>WR</th><th>Profit</th></tr></thead><tbody>${symRows || '<tr><td class="muted" colspan="4">—</td></tr>'}</tbody></table></div>
      <div class="col"><h4>Por módulo</h4><table class="small"><thead><tr><th>Módulo</th><th>T</th><th>WR</th></tr></thead><tbody>${modRows || '<tr><td class="muted" colspan="3">—</td></tr>'}</tbody></table></div>
    </div>

    <div class="row">
      <div class="col"><h4>Motivos salida</h4><table class="small"><thead><tr><th>Motivo</th><th>#</th></tr></thead><tbody>${reasonRows || '<tr><td class="muted" colspan="2">—</td></tr>'}</tbody></table></div>
      <div class="col"><h4>Top rechazos</h4><table class="small"><thead><tr><th>Código</th><th>#</th></tr></thead><tbody>${rejRows || '<tr><td class="muted" colspan="2">—</td></tr>'}</tbody></table></div>
    </div>

    <h4>Últimos ${Math.min(30, report.trades.length)} trades</h4>
    <table class="small"><thead><tr><th>Apertura</th><th>Sím</th><th>Módulo</th><th>Cierre</th><th>PnL</th></tr></thead><tbody>${tradeRows || '<tr><td class="muted" colspan="5">—</td></tr>'}</tbody></table>
  </div>
</details>`;
}

function renderTournamentHTML(meta, rows, reports, strategies) {
  const ranked = rows
    .map((r, i) => ({ ...r, score: scoreStrategy(r), originalIdx: i }))
    .sort((a, b) => b.score - a.score);

  const headerCells = ['#', 'Strategy', 'Trades', 'WR', 'ROI', 'PF', 'Max DD', 'Expect', 'Hold', 'OOS PF', 'OOS WR', 'OOS Trd', 'Score']
    .map(h => `<th>${h}</th>`).join('');
  const tableRows = ranked.map((r, i) => {
    const klass = i === 0 ? 'class="winner-row"' : '';
    return `<tr ${klass}>
      <td>${i + 1}</td>
      <td title="${r.desc}"><a href="#variant-${r.originalIdx}"><b>${r.label}</b></a></td>
      <td>${r.trades}</td>
      <td>${r.winRate}%</td>
      <td class="${r.roi >= 0 ? 'win' : 'loss'}">${r.roi >= 0 ? '+' : ''}${r.roi}%</td>
      <td>${r.profitFactor}</td>
      <td class="loss">-${r.maxDD}%</td>
      <td>${r.expectancy}</td>
      <td>${r.avgHold}h</td>
      <td>${r.holdoutPF}</td>
      <td>${r.holdoutWR}%</td>
      <td>${r.holdoutTrades}</td>
      <td>${r.score === -Infinity ? '—' : r.score.toFixed(2)}</td>
    </tr>`;
  }).join('');

  // Per-variant sections in ranking order
  const variantSections = ranked.map((r, i) =>
    `<div id="variant-${r.originalIdx}">${renderVariantSection(reports[r.originalIdx], strategies[r.originalIdx], i + 1, i === 0)}</div>`
  ).join('');

  const winner = ranked[0];

  return `<!doctype html><html><head><meta charset="utf-8"><title>Tournament · ${meta.bot.toUpperCase()}</title>
<style>
  body{font-family:-apple-system,Inter,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px;line-height:1.5;max-width:1400px;margin:0 auto}
  h1{color:#38bdf8;margin:0 0 4px} h2{color:#94a3b8;margin:32px 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:0.08em}
  h4{color:#94a3b8;margin:18px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.08em}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}
  .stat{background:#0f172a;border-radius:8px;padding:10px;text-align:center}
  .stat .v{font-size:20px;font-weight:700;color:#38bdf8} .stat .l{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:13px} th,td{padding:7px 10px;border-bottom:1px solid #334155;text-align:left;vertical-align:top}
  table.small th,table.small td{padding:5px 8px;font-size:12px}
  th{background:#0f172a;color:#94a3b8;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:0.06em}
  .win{color:#4ade80} .loss{color:#f87171} .muted{color:#64748b}
  .winner-row{background:#1e3a2f}
  .winner-row td{border-bottom-color:#16a34a;font-weight:600}
  .links{font-size:12px} .links a{color:#38bdf8;text-decoration:none;margin:0 4px}
  a{color:#38bdf8;text-decoration:none} a:hover{text-decoration:underline}
  .verdict{font-size:13px;background:#0f172a;border-radius:6px;padding:10px;margin:8px 0}
  details.variant{background:#1e293b;border:1px solid #334155;border-radius:10px;margin-bottom:10px;padding:14px 18px}
  details.variant[open]{padding-bottom:20px}
  details.variant.winner{border-color:#16a34a;background:#1a2c24}
  details summary{cursor:pointer;font-size:14px;list-style:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  details summary::-webkit-details-marker{display:none}
  details summary::before{content:"▶";color:#64748b;font-size:10px;transition:transform 0.15s}
  details[open] summary::before{transform:rotate(90deg)}
  .rank{color:#64748b;font-family:Menlo,monospace;font-size:12px;min-width:30px}
  .trophy{color:#facc15}
  .oneliner{color:#94a3b8;font-size:12px;margin-left:auto}
  .variant-body{margin-top:12px;padding-top:14px;border-top:1px solid #334155}
  .desc{margin-bottom:8px;font-size:13px}
  .knobs{margin:8px 0}
  .chip{display:inline-block;background:#0f172a;border:1px solid #334155;border-radius:5px;padding:3px 7px;margin:2px 4px 2px 0;font-size:11px;font-family:Menlo,monospace}
  .row{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px} .row>.col{flex:1;min-width:240px}
  .toolbar{display:flex;gap:8px;margin:10px 0}
  .btn{background:#0f172a;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:12px;color:#e2e8f0;cursor:pointer;font-family:inherit}
  .btn:hover{background:#1e293b}
</style></head><body>
<h1>Strategy Tournament · ${meta.bot.toUpperCase()}</h1>
<div class="muted">${meta.botVersion} · ${meta.symbols.join(', ')} · ${meta.days} días · ${meta.runs} variantes · ${meta.generatedAt.slice(0, 16).replace('T', ' ')}</div>

<h2>Ganador</h2>
<div class="card">
  <h3 style="margin-top:0">🏆 ${winner.label}</h3>
  <div class="muted">${winner.desc}</div>
  <div class="verdict">
    <b>${winner.trades} trades</b> · ROI <span class="${winner.roi >= 0 ? 'win' : 'loss'}">${winner.roi >= 0 ? '+' : ''}${winner.roi}%</span> ·
    PF <b>${winner.profitFactor}</b> · WR ${winner.winRate}% · Max DD -${winner.maxDD}% · Expectancy ${winner.expectancy} USD/trade · Avg hold ${winner.avgHold}h
    <br><br>
    OOS holdout: ${winner.holdoutTrades} trades · PF ${winner.holdoutPF} · WR ${winner.holdoutWR}% · ROI ${winner.holdoutROI}%
  </div>
</div>

<h2>Ranking</h2>
<div class="card"><table><thead><tr>${headerCells}</tr></thead><tbody>${tableRows}</tbody></table></div>

<h2>Variantes</h2>
<div class="toolbar">
  <button class="btn" onclick="document.querySelectorAll('details.variant').forEach(d=>d.open=true)">Expandir todas</button>
  <button class="btn" onclick="document.querySelectorAll('details.variant').forEach(d=>d.open=false)">Colapsar todas</button>
</div>
${variantSections}

<p class="muted" style="margin-top:24px;font-size:11px">Score = 0.5·min(PF,3) + 0.03·ROI + 0.075·min(OOS_PF,2) + 0.05·(1 - MaxDD/25). Penaliza &lt;8 trades.</p>
</body></html>`;
}

async function main() {
  const opts = parseArgs();
  const bot = opts.bot === 'knife' ? 'knife' : 'trader';
  const strategies = buildStrategies(bot);

  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║  STRATEGY TOURNAMENT · ${bot.toUpperCase().padEnd(32)}║`);
  console.log(`║  ${strategies.length} variantes                                              ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);

  const loaderOpts = {
    bot,
    months: opts.months ? parseFloat(opts.months) : 1,
    'no-open': true,
    ...strategies[0].knobs
  };
  if (opts.top !== undefined) loaderOpts.top = parseInt(opts.top, 10);
  if (opts.symbols) loaderOpts.symbols = opts.symbols;

  const loader = new Backtester(loaderOpts);
  await loader.loadModule();
  await loader.loadSymbols();
  await loader.loadHistoricalData();
  console.log(`\n[SHARED] Data ready for ${loader.symbols.length} symbols. Running ${strategies.length} variations...\n`);

  const rows = [];
  const reports = [];
  for (let i = 0; i < strategies.length; i++) {
    const strat = strategies[i];
    console.log(`\n[${i + 1}/${strategies.length}] ${strat.label.padEnd(20)} · ${strat.desc}`);
    const t0 = Date.now();
    const bt = new Backtester({
      bot,
      symbols: loader.symbols,
      months: loader.months,
      'no-open': true,
      ...strat.knobs
    });
    bt.mod = loader.mod;
    bt.tfs = loader.tfs;
    bt.data = loader.data;
    bt.simStart = loader.simStart;
    bt.simEnd = loader.simEnd;

    const allTrades = [];
    const diagnostics = [];
    for (const sym of bt.symbols) {
      const res = await bt.runSymbol(sym);
      allTrades.push(...res.trades);
      diagnostics.push(res);
    }
    const report = bt.buildReport(allTrades, diagnostics);
    const s = report.summary;
    const dt = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`     → ${s.totalTrades} trades · ROI ${s.roi >= 0 ? '+' : ''}${s.roi}% · PF ${s.profitFactor} · WR ${s.winRate}% · DD -${s.maxDrawdown}% · ${dt}s`);
    rows.push(summaryRow(strat.label, strat.desc, report));
    reports.push(report);
  }

  const meta = {
    bot,
    botVersion: loader.mod.ALGORITHM_VERSION,
    symbols: loader.symbols,
    days: loader.days,
    runs: strategies.length,
    generatedAt: new Date().toISOString()
  };
  const reportDir = path.join(__dirname, '..', 'backtests');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  // Single consolidated output, overwritten each run.
  const tournamentJsonPath = path.join(reportDir, `${bot}-tournament.json`);
  const tournamentHtmlPath = path.join(reportDir, `${bot}-tournament.html`);
  fs.writeFileSync(tournamentJsonPath, JSON.stringify({ meta, rows, reports }, null, 2));
  fs.writeFileSync(tournamentHtmlPath, renderTournamentHTML(meta, rows, reports, strategies));
  console.log(`\n[EXPORT] ${tournamentJsonPath}`);
  console.log(`[EXPORT] ${tournamentHtmlPath}`);

  const ranked = rows.map(r => ({ ...r, score: scoreStrategy(r) })).sort((a, b) => b.score - a.score);
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║              RANKING ${bot.toUpperCase().padEnd(28)}║`);
  console.log(`╠════════════════════════════════════════════════════════╣`);
  console.log('║ #  Label              Trd  ROI%   PF    WR%   DD%  Hld║');
  console.log('╠════════════════════════════════════════════════════════╣');
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const trophy = i === 0 ? '🏆' : '  ';
    console.log(`║${trophy}${String(i + 1).padStart(2)} ${r.label.padEnd(18)} ${String(r.trades).padStart(3)} ${String(r.roi).padStart(6)}% ${String(r.profitFactor).padStart(5)} ${String(r.winRate).padStart(5)}% ${String(r.maxDD).padStart(4)}% ${String(r.holdoutTrades).padStart(3)}║`);
  }
  console.log('╚════════════════════════════════════════════════════════╝');

  if (process.platform === 'darwin' && !opts['no-open']) {
    exec(`open "${tournamentHtmlPath}"`);
  }
}

main().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
