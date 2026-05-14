import { spawn } from 'child_process';

const symbols = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'PEPEUSDT', 'DOGEUSDT', 'SHIBUSDT', 'BONKUSDT', 
  'WIFUSDT', 'PENDLEUSDT', 'ORDIUSDT', 'NEARUSDT', 'LINKUSDT', 'ADAUSDT', 'XRPUSDT', 'DOTUSDT',
  'MATICUSDT', 'TRXUSDT', 'UNIUSDT', 'LTCUSDT', 'ETCUSDT', 'BCHUSDT', 'FILUSDT', 'ARBUSDT',
  'OPUSDT', 'TIAUSDT', 'SUIUSDT', 'SEIUSDT', 'INJUSDT', 'FETUSDT', 'AGIXUSDT', 'RNDRUSDT',
  'JUPUSDT', 'STRKUSDT', 'APTUSDT', 'STXUSDT', 'GRTUSDT', 'AAVEUSDT', 'MKRUSDT', 'LDOUSDT',
  'ENSUSDT', 'THETAUSDT', 'FLOKIUSDT', 'JASMYUSDT', 'GALAUSDT', 'FTMUSDT', 'EGLDUSDT', 
  'VETUSDT', 'CHZUSDT', 'SANDUSDT'
];
const botType = process.argv[2] === 'knife' ? 'knife' : 'trader';
const days = process.argv[3] || 7;

async function runBacktest(symbol) {
  return new Promise((resolve) => {
    console.log(`\n[BATCH] Starting backtest for ${symbol}...`);
    const child = spawn('node', ['scripts/v13-backtest.js', symbol, `--bot=${botType}`, `--days=${days}`, '--no-open']);
    
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      console.error(`[${symbol} ERROR]`, data.toString());
    });

    child.on('close', (code) => {
      console.log(`[BATCH] Finished backtest for ${symbol} with code ${code}`);
      const reportMatch = output.match(/BACKTEST REPORT:[\s\S]+/);
      if (reportMatch) {
        console.log(reportMatch[0]);
      } else {
        console.log(`[${symbol}] No report found in output.`);
      }
      resolve();
    });
  });
}

async function runAll() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`RUNNING BATCH BACKTEST: ${botType.toUpperCase()} on ${symbols.length} symbols`);
  console.log(`${'='.repeat(60)}`);
  
  const concurrency = 5;
  const chunks = [];
  for (let i = 0; i < symbols.length; i += concurrency) {
    chunks.push(symbols.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(s => runBacktest(s)));
  }
}

runAll().catch(console.error);
