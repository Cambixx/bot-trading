import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getKlines(symbol, interval, limit = 1000, startTime = null, endTime = null) {
  const mexcInterval = interval === '1h' ? '60m' : interval;
  let url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${mexcInterval}&limit=${limit}`;
  if (startTime) url += `&startTime=${startTime}`;
  if (endTime) url += `&endTime=${endTime}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  } catch (err) {
    console.error(`[ERROR] Fetching ${symbol} ${interval}:`, err.message);
    return [];
  }
}

class Backtester {
  constructor(options = {}) {
    this.symbol = (options.symbol || 'SOLUSDT').toUpperCase();
    this.months = options.months || 1;
    this.days = this.months * 30;
    this.intervals = ['15m', '1h', '4h'];
    this.relax = options.relax || false;
    this.data = {};
    this.btcData = {};
  }

  async loadData() {
    console.log(`[DATA] Loading ${this.days} days for ${this.symbol}...`);
    const durationMs = this.days * 24 * 60 * 60 * 1000;
    const endTime = Date.now();
    // Load extra 5 days of history for indicators (EMA50, etc)
    const startTime = endTime - durationMs - (5 * 24 * 60 * 60 * 1000);

    for (const interval of this.intervals) {
      this.data[interval] = await this.fetchPaged(this.symbol, interval, startTime, endTime);
      this.btcData[interval] = await this.fetchPaged('BTCUSDT', interval, startTime, endTime);
      console.log(`  - ${interval}: ${this.data[interval].length} candles loaded.`);
    }
  }

  async fetchPaged(symbol, interval, start, end) {
    const all = [];
    let cursor = start;
    while (cursor < end) {
      const klines = await getKlines(symbol, interval, 1000, cursor, end);
      if (!klines || klines.length === 0) break;
      all.push(...klines);
      const lastTime = klines[klines.length - 1].time;
      if (lastTime <= cursor) break;
      cursor = lastTime + 1;
      if (all.length > 50000) break;
    }
    return all;
  }

  async run() {
    await this.loadData();
    const botModule = await import('../netlify/functions/trader-bot.js');
    const { generateSignal } = botModule;

    const main = this.data['15m'];
    const trades = [];
    let active = null;
    let stats = { wins: 0, losses: 0, be: 0, pnl: 0 };
    const analysisState = { 
      rejectCounts: {}, 
      stageCounts: {},
      relaxedMode: this.relax 
    };

    // Find the real start time of the simulation (after history)
    const simulationStartTime = Date.now() - (this.days * 24 * 60 * 60 * 1000);
    const startIndex = main.findIndex(c => c.time >= simulationStartTime);
    const effectiveStart = startIndex === -1 ? 200 : Math.max(200, startIndex);

    console.log(`\n[RUN] Simulating from candle index ${effectiveStart} (${main.length - effectiveStart} total candles)...`);

    for (let i = effectiveStart; i < main.length; i++) {
      const candle = main[i];
      const t = candle.time;

      if (active) {
        // High/Low check for exit
        if (candle.high >= active.tp) {
          stats.wins++; stats.pnl += active.tpPct;
          trades.push({ ...active, exitPrice: active.tp, exitTime: t, result: 'WIN', pnl: active.tpPct });
          active = null;
        } else if (candle.low <= active.sl) {
          const exitPnl = ((active.sl - active.entry) / active.entry) * 100;
          if (active.be) stats.be++; else stats.losses++;
          stats.pnl += exitPnl;
          trades.push({ ...active, exitPrice: active.sl, exitTime: t, result: active.be ? 'BE' : 'LOSS', pnl: exitPnl });
          active = null;
        } else {
          // Break-even check during trade
          const currentPnl = ((candle.close - active.entry) / active.entry) * 100;
          if (!active.be && currentPnl >= active.tpPct * 0.5) {
            active.sl = active.entry * 1.001;
            active.be = true;
          }
        }
        continue;
      }

      const signal = await generateSignal(
        this.symbol, 
        main.slice(0, i + 1),
        this.data['1h'].filter(c => c.time <= t),
        this.data['4h'].filter(c => c.time <= t),
        { bids: [[candle.close, 1000000]], asks: [[candle.close, 1000000]], depthQuoteTopN: 500000, spreadBps: 2 }, // mock OB
        { priceChangePercent: 0, quoteVolume: 100000000 }, // mock 100M volume
        { 
          status: 'GREEN', 
          regime: 'TRENDING',
          bias: 'BULLISH',
          closes1h: this.btcData['1h'].filter(c => c.time <= t).map(c => c.close), 
          closes4h: this.btcData['4h'].filter(c => c.time <= t).map(c => c.close),
          priceChange24h: 0
        },
        analysisState
      );

      if (signal) {
        active = {
          entry: candle.close, 
          tp: signal.takeProfit, 
          sl: signal.stopLoss,
          tpPct: ((signal.takeProfit - candle.close) / candle.close) * 100,
          module: signal.module, 
          entryTime: t, 
          be: false
        };
        console.log(`[TRADE] ${new Date(t).toISOString().slice(0,16)} | OPEN at ${candle.close.toFixed(2)} | ${signal.module}`);
      }
    }

    if (active) {
      const pnl = ((main[main.length - 1].close - active.entry) / active.entry) * 100;
      trades.push({ ...active, exitPrice: main[main.length - 1].close, exitTime: main[main.length - 1].time, result: 'OPEN', pnl });
      stats.pnl += pnl;
    }

    this.report(stats, trades, analysisState);
  }

  report(stats, trades, analysisState) {
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? ((stats.wins + stats.be) / totalTrades * 100).toFixed(2) : 0;
    
    console.log(`\n============================================================`);
    console.log(`BACKTEST REPORT: ${this.symbol}`);
    console.log(`============================================================`);
    console.log(`Total Trades:  ${totalTrades}`);
    console.log(`Win Rate:      ${winRate}% (Wins + BE)`);
    console.log(`Net PnL %:     ${stats.pnl.toFixed(2)}%`);
    console.log(`Avg Trade %:   ${(stats.pnl / (totalTrades || 1)).toFixed(2)}%`);
    console.log(`============================================================`);

    if (totalTrades === 0) {
      console.log(`\nREJECTION SUMMARY (Top 5 reasons):`);
      const sortedRejections = Object.entries(analysisState.rejectCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      sortedRejections.forEach(([reason, count]) => {
        console.log(`  - ${reason}: ${count}`);
      });
    }

    const reportData = {
      symbol: this.symbol,
      config: { months: this.months, relax: this.relax },
      stats: { ...stats, totalTrades, winRate },
      rejections: analysisState.rejectCounts,
      stages: analysisState.stageCounts,
      trades: trades
    };

    const reportDir = path.join(__dirname, '../backtests');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir);

    const jsonPath = path.join(reportDir, 'backtest-report.json');
    const htmlPath = path.join(reportDir, 'backtest-report.html');

    fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));

    const html = `
    <html>
    <head>
      <title>Backtest Report - ${this.symbol}</title>
      <style>
        body { font-family: 'Inter', -apple-system, sans-serif; background: #0f172a; color: #f1f5f9; padding: 40px; line-height: 1.6; }
        .card { background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; }
        h1 { color: #38bdf8; margin-top: 0; }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
        .stat-item { text-align: center; padding: 16px; background: #0f172a; border-radius: 8px; }
        .stat-value { font-size: 24px; font-weight: bold; color: #38bdf8; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { text-align: left; background: #334155; padding: 12px; border-bottom: 2px solid #475569; }
        td { padding: 12px; border-bottom: 1px solid #334155; }
        .win { color: #4ade80; }
        .loss { color: #f87171; }
        .be { color: #94a3b8; }
      </style>
    </head>
    <body>
      <h1>Backtest: ${this.symbol} (${this.months} Months)</h1>
      <div class="card">
        <div class="stat-grid">
          <div class="stat-item"><div class="stat-label">Total Trades</div><div class="stat-value">${totalTrades}</div></div>
          <div class="stat-item"><div class="stat-label">Win Rate</div><div class="stat-value">${winRate}%</div></div>
          <div class="stat-item"><div class="stat-label">Net PnL</div><div class="stat-value">${stats.pnl.toFixed(2)}%</div></div>
          <div class="stat-item"><div class="stat-label">Avg Trade</div><div class="stat-value">${(stats.pnl / (totalTrades || 1)).toFixed(2)}%</div></div>
        </div>
      </div>
      <div class="card">
        <h2>Trade History</h2>
        <table>
          <thead>
            <tr><th>Date</th><th>Module</th><th>Result</th><th>PnL %</th></tr>
          </thead>
          <tbody>
            ${trades.map(t => `
              <tr>
                <td>${new Date(t.entryTime).toLocaleString()}</td>
                <td>${t.module}</td>
                <td class="${t.result.toLowerCase()}">${t.result}</td>
                <td class="${t.pnl >= 0 ? 'win' : 'loss'}">${t.pnl.toFixed(2)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </body>
    </html>`;

    fs.writeFileSync(htmlPath, html);
    console.log(`\n[EXPORT] Reports saved to: \n  - JSON: ${jsonPath}\n  - HTML: ${htmlPath}`);
  }
}

const args = process.argv.slice(2);
const options = {};
args.forEach(a => { 
  if (a.includes('=')) { 
    const [k, v] = a.split('='); 
    options[k.replace('--','')] = v === 'true' ? true : v === 'false' ? false : v; 
  } else if (a.startsWith('--')) {
    options[a.replace('--','')] = true;
  }
});

const tester = new Backtester(options);
tester.run().catch(console.error);
