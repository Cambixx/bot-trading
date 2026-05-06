import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { 
  getKlines, 
  intervalToMs, 
  formatPrice,
  detectBTCContext,
  MEXC_API,
  fetchWithTimeout
} from '../netlify/functions/tradingview-strategy-core.js';

// We will dynamically import the bots to avoid issues
let traderBot, knifeBot;

const CONFIG = {
  quoteAsset: 'USDT',
  initialBalance: 10000,
  defaultSlippage: 0.001, // 0.1%
};

class BacktestEngine {
  constructor(options) {
    this.symbol = options.symbol;
    this.botType = options.botType; // 'trader' or 'knife'
    this.days = options.days || 7;
    this.debug = options.debug || false;
    this.start = options.start;
    
    this.balance = CONFIG.initialBalance;
    this.position = null;
    this.trades = [];
    
    this.data = {
      '5m': [],
      '15m': [],
      '1h': [],
      '4h': []
    };
    
    this.btcData = {
      '15m': [],
      '1h': [],
      '4h': []
    };
    
    this.intervals = ['5m', '15m', '1h', '4h'];
    this.mainInterval = this.botType === 'trader' ? '15m' : '5m';
    this.start = options.start;
  }

  async loadData() {
    console.log(`\n[DATA] Loading historical data for ${this.symbol} and BTCUSDT (${this.days} days)...`);
    
    const limit = 1000; 
    const startTime = this.start ? new Date(this.start).getTime() : null;
    
    for (const interval of this.intervals) {
      console.log(`  - Fetching ${this.symbol} ${interval} klines...`);
      try {
        this.data[interval] = await this.getKlinesPaged(this.symbol, interval, this.days);
        if (interval !== '5m') {
          this.btcData[interval] = await this.getKlinesPaged('BTCUSDT', interval, this.days);
        }
      } catch (err) {
        console.error(`    Error loading ${interval}:`, err.message);
      }
    }
    
    console.log(`[DATA] Loaded data series for each interval.`);
  }

  async getKlinesPaged(symbol, interval, days) {
    const intervalMin = intervalToMs(interval) / 60000;
    const totalNeeded = Math.ceil((days * 24 * 60) / intervalMin);
    const limit = 500; 
    let allKlines = [];
    
    // Start from 'days' ago
    let currentStartTime = this.start 
      ? new Date(this.start).getTime() 
      : Date.now() - (days * 24 * 60 * 60 * 1000) - (200 * intervalMin * 60000);

    const now = Date.now();

    while (allKlines.length < totalNeeded + 200) {
      // IMPORTANT: Provide both startTime and endTime to ensure MEXC pages correctly
      const klines = await getKlines(symbol, interval, limit, currentStartTime, now);
      if (!klines || klines.length === 0) break;
      
      const lastTime = allKlines.length > 0 ? allKlines[allKlines.length - 1].time : -1;
      const newKlines = klines.filter(k => k.time > lastTime);
      
      if (newKlines.length === 0) break;
      
      allKlines = allKlines.concat(newKlines);
      currentStartTime = allKlines[allKlines.length - 1].time + 1;
      
      if (klines.length < limit) break; 
      if (allKlines.length > 15000) break; 
    }

    console.log(`    -> Loaded ${allKlines.length} candles for ${symbol} ${interval}`);
    return allKlines;
  }

  getSnapshot(data, currentTime, interval) {
    if (!data[interval]) return [];
    return data[interval].filter(c => c.time <= currentTime);
  }

  async run() {
    await this.loadData();
    
    const mainCandles = this.data[this.mainInterval];
    if (mainCandles.length < 150) {
      console.error("[ERROR] Not enough data to run simulation.");
      return;
    }

    console.log(`\n[RUN] Starting backtest for ${this.botType} bot...`);
    
    try {
      if (this.botType === 'trader') {
        traderBot = await import('../netlify/functions/trader-bot.js');
      } else {
        knifeBot = await import('../netlify/functions/knife-catcher.js');
      }
    } catch (err) {
      console.error("[ERROR] Failed to import bot logic:", err.message);
      return;
    }

    const botMod = this.botType === 'trader' ? traderBot : knifeBot;

    const globalState = { rejectCounts: {} };
    if (mainCandles.length > 0) {
      console.log(`[RUN] First candle time: ${new Date(mainCandles[0].time).toUTCString()}`);
    }

    // Simulation Loop - Start at 250 to ensure MTF history
    for (let i = 250; i < mainCandles.length; i++) {
      const currentCandle = mainCandles[i];
      const currentTime = currentCandle.time;
      
      if (this.position) {
        this.updatePosition(currentCandle);
        continue;
      }

      const snapshot = {};
      for (const interval of this.intervals) {
        snapshot[interval] = this.getSnapshot(this.data, currentTime, interval);
      }
      
      const btcSnapshot = {};
      for (const interval of ['15m', '1h', '4h']) {
        btcSnapshot[interval] = this.getSnapshot(this.btcData, currentTime, interval);
      }



      const btcContext = btcSnapshot['15m'].length > 20 
        ? detectBTCContext(btcSnapshot['15m'], btcSnapshot['1h'], btcSnapshot['4h'])
        : { regime: 'NEUTRAL', bias: 'NEUTRAL', volatility: 'NORMAL' };

      // FORCED FOR EXPERIMENT: Ignore BTC risk
      btcContext.status = 'GREEN';
      btcContext.regime = 'TRENDING';

      let signal = null;
      const state = { stageCounts: {}, rejectCounts: {}, moduleCandidates: {}, debug: i < 260 };
      try {
        const mockTicker = { 
          lastPrice: currentCandle.close, 
          priceChangePercent: 0,
          quoteVolume: 100000000 
        };
        const mockOB = { 
          bids: [[currentCandle.close * 0.999, 100000]], 
          asks: [[currentCandle.close * 1.001, 100000]],
          depthQuoteTopN: 500000,
          spreadBps: 2
        };

        if (this.botType === 'trader') {
          signal = await botMod.generateSignal(
            this.symbol, 
            snapshot['15m'], 
            snapshot['1h'], 
            snapshot['4h'],
            mockOB,
            mockTicker,
            btcContext,
            state
          );
        } else {
          signal = await botMod.generateSignal(
            this.symbol,
            snapshot['5m'],
            snapshot['15m'],
            snapshot['1h'],
            snapshot['4h'],
            mockOB,
            mockTicker,
            btcContext,
            state
          );
        }
        
        // Aggregate rejections
        for (const [code, count] of Object.entries(state.rejectCounts)) {
          globalState.rejectCounts[code] = (globalState.rejectCounts[code] || 0) + count;
        }

        if (this.debug) {
           if (signal) {
             console.log(`[DEBUG] ${new Date(currentTime).toISOString().substring(11, 16)} | Signal! Score: ${signal.score?.toFixed(1)}`);
           }
        }
      } catch (err) {
         if (this.debug) console.error(`Error at ${new Date(currentTime).toISOString()}:`, err.message);
      }

      if (signal && signal.side === 'BUY') {
        this.openPosition(signal, currentCandle);
      }
    }

    this.printReport();
    this.printRejectionSummary(globalState);
    await this.saveResults(globalState);
  }

  async saveResults(state) {
    const results = {
      timestamp: new Date().toISOString(),
      symbol: this.symbol,
      botType: this.botType,
      config: CONFIG,
      metrics: {
        totalTrades: this.trades.length,
        winRate: this.trades.length > 0 ? (this.trades.filter(t => t.pnlPct > 0).length / this.trades.length * 100) : 0,
        netPnlPct: this.trades.reduce((sum, t) => sum + t.pnlPct, 0),
        avgTradePct: this.trades.length > 0 ? (this.trades.reduce((sum, t) => sum + t.pnlPct, 0) / this.trades.length) : 0,
      },
      rejections: state.rejectCounts,
      trades: this.trades
    };

    const fileName = `${this.botType}-${this.symbol}-${new Date().getTime()}`;
    const jsonPath = path.join('backtests', `${fileName}.json`);
    const htmlPath = path.join('backtests', `${fileName}.html`);

    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    fs.writeFileSync(htmlPath, this.generateHtml(results));

    console.log(`\n[EXPORT] Results saved to:`);
    console.log(`  - JSON: ${jsonPath}`);
    console.log(`  - HTML: ${htmlPath}`);
  }

  generateHtml(data) {
    const tradesHtml = data.trades.map(t => `
      <tr class="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
        <td class="py-4 px-4 text-gray-400 text-sm">${new Date(t.entryTime).toISOString().replace('T', ' ').substring(0, 16)}</td>
        <td class="py-4 px-4 font-medium text-blue-400">${t.exitReason}</td>
        <td class="py-4 px-4 text-gray-300">$${t.entryPrice.toFixed(4)}</td>
        <td class="py-4 px-4 text-gray-300">$${t.exitPrice.toFixed(4)}</td>
        <td class="py-4 px-4 font-bold ${t.pnlPct > 0 ? 'text-green-400' : 'text-red-400'}">
          ${t.pnlPct > 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%
        </td>
      </tr>
    `).join('');

    const rejectionsHtml = Object.entries(data.rejections).sort((a,b) => b[1] - a[1]).map(([code, count]) => `
      <div class="flex justify-between items-center py-2 border-b border-gray-800">
        <span class="text-gray-400 text-sm">${code}</span>
        <span class="bg-gray-800 px-3 py-1 rounded-full text-xs font-mono text-gray-300">${count}</span>
      </div>
    `).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Backtest Report - ${data.symbol}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; background-color: #0f172a; color: #f1f5f9; }
        .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.05); }
        .metric-card { transition: transform 0.2s; }
        .metric-card:hover { transform: translateY(-4px); }
    </style>
</head>
<body class="p-8">
    <div class="max-w-6xl mx-auto">
        <!-- Header -->
        <div class="flex justify-between items-center mb-12">
            <div>
                <h1 class="text-4xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                    Backtest Analysis
                </h1>
                <p class="text-gray-400 mt-2">${data.botType.toUpperCase()} Bot • ${data.symbol} • ${new Date(data.timestamp).toLocaleString()}</p>
            </div>
            <div class="text-right">
                <span class="bg-blue-500/10 text-blue-400 px-4 py-2 rounded-full border border-blue-500/20 text-sm font-semibold">
                    ${data.config.quoteAsset} Base
                </span>
            </div>
        </div>

        <!-- Metrics Grid -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
            <div class="glass p-6 rounded-2xl metric-card">
                <p class="text-gray-400 text-xs uppercase tracking-wider font-semibold">Net PnL</p>
                <h2 class="text-3xl font-bold mt-2 ${data.metrics.netPnlPct > 0 ? 'text-green-400' : 'text-red-400'}">
                    ${data.metrics.netPnlPct > 0 ? '+' : ''}${data.metrics.netPnlPct.toFixed(2)}%
                </h2>
            </div>
            <div class="glass p-6 rounded-2xl metric-card">
                <p class="text-gray-400 text-xs uppercase tracking-wider font-semibold">Win Rate</p>
                <h2 class="text-3xl font-bold mt-2 text-blue-400">${data.metrics.winRate.toFixed(1)}%</h2>
            </div>
            <div class="glass p-6 rounded-2xl metric-card">
                <p class="text-gray-400 text-xs uppercase tracking-wider font-semibold">Total Trades</p>
                <h2 class="text-3xl font-bold mt-2 text-white">${data.metrics.totalTrades}</h2>
            </div>
            <div class="glass p-6 rounded-2xl metric-card">
                <p class="text-gray-400 text-xs uppercase tracking-wider font-semibold">Avg / Trade</p>
                <h2 class="text-3xl font-bold mt-2 text-gray-300">${data.metrics.avgTradePct.toFixed(2)}%</h2>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <!-- Trade List -->
            <div class="lg:col-span-2">
                <h3 class="text-xl font-bold mb-6 flex items-center">
                    <span class="w-2 h-8 bg-blue-500 rounded-full mr-4"></span>
                    Recent Executions
                </h3>
                <div class="glass rounded-2xl overflow-hidden">
                    <table class="w-full text-left">
                        <thead class="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider">
                            <tr>
                                <th class="py-4 px-4 font-semibold">Date</th>
                                <th class="py-4 px-4 font-semibold">Reason</th>
                                <th class="py-4 px-4 font-semibold">Entry</th>
                                <th class="py-4 px-4 font-semibold">Exit</th>
                                <th class="py-4 px-4 font-semibold">PnL</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tradesHtml || '<tr><td colspan="5" class="py-8 text-center text-gray-500">No trades executed in this window</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Rejection Summary -->
            <div>
                <h3 class="text-xl font-bold mb-6 flex items-center">
                    <span class="w-2 h-8 bg-indigo-500 rounded-full mr-4"></span>
                    Rejection Profile
                </h3>
                <div class="glass p-6 rounded-2xl">
                    <p class="text-gray-400 text-sm mb-6">Why signals were ignored by the engine:</p>
                    <div class="space-y-2">
                        ${rejectionsHtml || '<p class="text-gray-500">No data</p>'}
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="mt-16 text-center text-gray-600 text-xs border-t border-gray-800 pt-8">
            Backtest engine v1.2 • High Fidelity Simulation • Generated by Antigravity AI
        </div>
    </div>
</body>
</html>
    `;
  }

  openPosition(signal, candle) {
    const entryPrice = candle.close * (1 + CONFIG.defaultSlippage);
    this.position = {
      symbol: this.symbol,
      entryPrice,
      entryTime: candle.time,
      stopLoss: signal.stopLoss || (entryPrice * 0.98),
      takeProfit: signal.takeProfit1 || (entryPrice * 1.05),
      tp2: signal.takeProfit2,
      confidence: signal.confidence,
      reason: signal.reason,
      maxSeen: entryPrice,
      trailActive: false
    };
    
    console.log(`[TRADE] ${new Date(candle.time).toISOString().replace('T', ' ').substring(0, 16)} | OPEN  at ${formatPrice(entryPrice)} | Reason: ${signal.reason.substring(0, 60)}...`);
  }

  updatePosition(candle) {
    const p = this.position;
    
    if (candle.high > p.maxSeen) {
      p.maxSeen = candle.high;
      const profitPct = (p.maxSeen - p.entryPrice) / p.entryPrice;
      
      // Dynamic Trailing Stop (1.5% from peak after 2.5% profit)
      if (profitPct > 0.025) {
        p.trailActive = true;
        const newSL = p.maxSeen * 0.985;
        if (newSL > p.stopLoss) {
          p.stopLoss = newSL;
        }
      }
    }

    if (candle.low <= p.stopLoss) {
      this.closePosition(p.stopLoss, candle.time, 'STOP_LOSS');
    } else if (candle.high >= p.takeProfit) {
      // For backtest simplicity, we close 100% at TP1. 
      // In live, it might be partial.
      this.closePosition(p.takeProfit, candle.time, 'TAKE_PROFIT');
    }
  }

  closePosition(exitPrice, exitTime, reason) {
    const p = this.position;
    const pnlPct = (exitPrice - p.entryPrice) / p.entryPrice;
    
    const trade = {
      ...p,
      exitPrice,
      exitTime,
      exitReason: reason,
      pnlPct: pnlPct * 100
    };
    
    this.trades.push(trade);
    this.position = null;
    
    const emoji = pnlPct > 0 ? '✅' : '❌';
    console.log(`[TRADE] ${new Date(exitTime).toISOString().replace('T', ' ').substring(0, 16)} | CLOSE at ${formatPrice(exitPrice)} | Result: ${emoji} ${trade.pnlPct.toFixed(2)}% | Reason: ${reason}`);
  }

  printReport() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`BACKTEST REPORT: ${this.botType.toUpperCase()} on ${this.symbol}`);
    console.log(`${'='.repeat(60)}`);
    
    if (this.trades.length === 0) {
      console.log("No trades executed.");
      return;
    }

    const wins = this.trades.filter(t => t.pnlPct > 0);
    const totalPnl = this.trades.reduce((sum, t) => sum + t.pnlPct, 0);
    
    console.log(`Total Trades:  ${this.trades.length}`);
    console.log(`Win Rate:      ${(wins.length / this.trades.length * 100).toFixed(2)}%`);
    console.log(`Net PnL %:     ${totalPnl.toFixed(2)}%`);
    console.log(`Avg Trade:     ${(totalPnl / this.trades.length).toFixed(2)}%`);
    console.log(`Best Trade:    ${Math.max(...this.trades.map(t => t.pnlPct)).toFixed(2)}%`);
    console.log(`Worst Trade:   ${Math.min(...this.trades.map(t => t.pnlPct)).toFixed(2)}%`);
    console.log(`${'='.repeat(60)}\n`);
  }

  printRejectionSummary(state) {
    console.log(`\nREJECTION SUMMARY:`);
    console.log(`${'='.repeat(30)}`);
    const sorted = Object.entries(state.rejectCounts || {}).sort((a, b) => b[1] - a[1]);
    for (const [code, count] of sorted) {
      console.log(`${code.padEnd(25)}: ${count}`);
    }
    console.log(`${'='.repeat(30)}\n`);
  }
}

const args = process.argv.slice(2);
const options = {
  symbol: args.find(a => !a.startsWith('--')) || 'BTCUSDT',
  botType: args.includes('--bot=knife') ? 'knife' : 'trader',
  days: parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1]) || 5,
  debug: args.includes('--debug'),
  start: args.find(a => a.startsWith('--start='))?.split('=')[1]
};

const engine = new BacktestEngine(options);
engine.run().catch(console.error);
