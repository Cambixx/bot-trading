import { getStore } from "@netlify/blobs";

export const MEXC_API = 'https://api.mexc.com/api/v3';

export const CORE_LEADERS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'LINK'];
export const STABLE_BASES = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI', 'EUR', 'GBP']);
export const TOKENIZED_METAL_BASES = new Set(['PAXG', 'XAUT', 'XAG', 'XAU']);

export const SECTOR_MAP = {
  BTC: 'BLUE_CHIP',
  ETH: 'BLUE_CHIP',
  BNB: 'BLUE_CHIP',
  XRP: 'BLUE_CHIP',
  SOL: 'L1',
  AVAX: 'L1',
  ADA: 'L1',
  DOT: 'L1',
  NEAR: 'L1',
  ATOM: 'L1',
  DOGE: 'MEME',
  SHIB: 'MEME',
  PEPE: 'MEME',
  FLOKI: 'MEME',
  LINK: 'DEFI',
  UNI: 'DEFI',
  AAVE: 'DEFI',
  COMP: 'DEFI',
  MKR: 'DEFI',
  ARB: 'L2',
  OP: 'L2',
  MATIC: 'L2',
  STRK: 'L2',
  RENDER: 'AI',
  FET: 'AI',
  AGIX: 'AI',
  WLD: 'AI'
};

const candleCache = new Map();
const CACHE_TTL_MS = 4 * 60 * 1000;

export function getInternalStore(context = {}, name = 'trading-signals') {
  const options = { name };
  const siteID = context?.site?.id || context?.siteID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = context?.token || process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_PURGE_API_TOKEN;
  if (siteID) options.siteID = siteID;
  if (token) options.token = token;
  return getStore(options);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundMetric(value, decimals = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

export function countMetric(bucket, key) {
  if (!bucket || !key) return;
  bucket[key] = (bucket[key] || 0) + 1;
}

export function escapeMarkdownV2(text = '') {
  if (typeof text !== 'string') text = String(text ?? '');
  return text.replace(/([_*\u005B\u005D()~`>#+=|{}.!-])/g, '\\$1');
}

export function formatPrice(price) {
  if (!Number.isFinite(price)) return 'n/a';
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(8);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Codex TradingView Strategy Bot' }
    });
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

export function intervalToMs(interval) {
  const match = String(interval || '').trim().match(/^(\d+)\s*([mhd])$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  return null;
}

export function getClosedCandles(candles, interval, now = Date.now()) {
  if (!Array.isArray(candles) || !candles.length) return [];
  const intervalMs = intervalToMs(interval);
  if (!intervalMs) return candles.slice();

  const last = candles[candles.length - 1];
  const closeTime = Number.isFinite(last?.closeTime)
    ? last.closeTime
    : (Number.isFinite(last?.time) ? last.time + intervalMs : null);

  if (!Number.isFinite(closeTime)) return candles.slice(0, -1);
  return now < closeTime - 2000 ? candles.slice(0, -1) : candles.slice();
}

export function normalizeBaseAsset(symbol = '', quoteAsset = 'USDT') {
  return symbol.endsWith(quoteAsset) ? symbol.slice(0, -quoteAsset.length) : symbol;
}

export function isNonCryptoWrapper(base) {
  if (!base) return true;
  if (STABLE_BASES.has(base)) return true;
  if (TOKENIZED_METAL_BASES.has(base)) return true;
  if (base.includes('(') || base.includes(')')) return true;
  if (base.startsWith('GOLD') || base.startsWith('SILVER')) return true;
  if (base.endsWith('UP') || base.endsWith('DOWN') || base.endsWith('BULL') || base.endsWith('BEAR')) return true;
  return false;
}

export function getSector(symbol, quoteAsset = 'USDT') {
  return SECTOR_MAP[normalizeBaseAsset(symbol, quoteAsset)] || 'OTHER';
}

export function isProtectedSector(sector) {
  return sector && sector !== 'UNKNOWN' && sector !== 'OTHER';
}

export function validateCandle(candle) {
  return (
    Number.isFinite(candle.open) && candle.open > 0 &&
    Number.isFinite(candle.high) && candle.high > 0 &&
    Number.isFinite(candle.low) && candle.low > 0 &&
    Number.isFinite(candle.close) && candle.close > 0 &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close &&
    Number.isFinite(candle.volume) && candle.volume >= 0
  );
}

export async function getKlines(symbol, interval = '15m', limit = 240) {
  const cacheKey = `${symbol}-${interval}-${limit}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

  const mexcInterval = interval === '1h' ? '60m' : interval;
  const response = await fetchWithTimeout(`${MEXC_API}/klines?symbol=${symbol}&interval=${mexcInterval}&limit=${limit}`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`MEXC klines ${symbol} ${interval}: ${response.status} ${body}`.trim());
  }

  const json = await response.json();
  if (!Array.isArray(json)) throw new Error(`MEXC klines invalid response for ${symbol}`);

  const intervalMs = intervalToMs(mexcInterval);
  const candles = json.map(row => {
    const openTime = Number(row[0]);
    const closeTimeRaw = row[6] === undefined || row[6] === null || row[6] === '' ? null : Number(row[6]);
    return {
      time: openTime,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      closeTime: Number.isFinite(closeTimeRaw) ? closeTimeRaw : (Number.isFinite(openTime) && intervalMs ? openTime + intervalMs : null),
      quoteVolume: row[7] === undefined || row[7] === null || row[7] === '' ? null : Number(row[7]),
      trades: row[8] === undefined || row[8] === null || row[8] === '' ? null : Number(row[8]),
      takerBuyBaseVolume: row[9] === undefined || row[9] === null || row[9] === '' ? null : Number(row[9]),
      takerBuyQuoteVolume: row[10] === undefined || row[10] === null || row[10] === '' ? null : Number(row[10])
    };
  }).filter(validateCandle);

  candleCache.set(cacheKey, { timestamp: Date.now(), data: candles });
  return candles;
}

export async function getOrderBookDepth(symbol, limit = 20) {
  const response = await fetchWithTimeout(`${MEXC_API}/depth?symbol=${symbol}&limit=${limit}`);
  if (!response.ok) return null;
  const json = await response.json().catch(() => null);
  if (!json || !Array.isArray(json.bids) || !Array.isArray(json.asks)) return null;
  return {
    bids: json.bids.map(([price, qty]) => [Number(price), Number(qty)]).filter(([price, qty]) => Number.isFinite(price) && Number.isFinite(qty)),
    asks: json.asks.map(([price, qty]) => [Number(price), Number(qty)]).filter(([price, qty]) => Number.isFinite(price) && Number.isFinite(qty))
  };
}

export async function getAllTickers24h() {
  const response = await fetchWithTimeout(`${MEXC_API}/ticker/24hr`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`MEXC ticker/24hr: ${response.status} ${body}`.trim());
  }
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error('MEXC ticker/24hr invalid response');
  return json;
}

export function calculateSMA(data, period) {
  if (!Array.isArray(data) || data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

export function calculateSMASeries(data, period) {
  if (!Array.isArray(data) || data.length < period) return null;
  const series = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) sum -= data[i - period];
    if (i >= period - 1) series[i] = sum / period;
  }
  return series;
}

export function calculateEMA(data, period) {
  const series = calculateEMASeries(data, period);
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i])) return series[i];
  }
  return null;
}

export function calculateEMASeries(data, period) {
  if (!Array.isArray(data) || data.length < period) return null;
  const series = new Array(data.length).fill(null);
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  series[period - 1] = ema;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
    series[i] = ema;
  }
  return series;
}

export function calculateNullableEMASeries(data, period) {
  if (!Array.isArray(data) || data.length < period) return null;
  const series = new Array(data.length).fill(null);
  const multiplier = 2 / (period + 1);
  const seed = [];
  let ema = null;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (!Number.isFinite(value)) continue;

    if (ema === null) {
      seed.push(value);
      if (seed.length === period) {
        ema = seed.reduce((sum, item) => sum + item, 0) / period;
        series[i] = ema;
      }
      continue;
    }

    ema = (value - ema) * multiplier + ema;
    series[i] = ema;
  }

  return series;
}

export function calculateStdev(data, period) {
  if (!Array.isArray(data) || data.length < period) return null;
  const slice = data.slice(-period);
  const mean = slice.reduce((sum, value) => sum + value, 0) / period;
  const variance = slice.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / period;
  return Math.sqrt(variance);
}

export function calculateATRSeries(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const series = new Array(candles.length).fill(null);
  let trSum = 0;

  for (let i = 1; i <= period; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    trSum += Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );
  }

  let atr = trSum / period;
  series[period] = atr;

  for (let i = period + 1; i < candles.length; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );
    atr = ((atr * (period - 1)) + tr) / period;
    series[i] = atr;
  }

  return series;
}

export function calculateATR(candles, period = 14) {
  const series = calculateATRSeries(candles, period);
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i])) return series[i];
  }
  return null;
}

export function calculateRSISeries(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  const series = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain += change > 0 ? change : 0;
    avgLoss += change < 0 ? -change : 0;
  }

  avgGain /= period;
  avgLoss /= period;
  series[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    series[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }

  return series;
}

export function calculateRSI(closes, period = 14) {
  const series = calculateRSISeries(closes, period);
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i])) return series[i];
  }
  return null;
}

export function calculateADX(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period * 2 + 1) return null;
  let trSum = 0;
  let plusDMSum = 0;
  let minusDMSum = 0;

  for (let i = 1; i <= period; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const upMove = current.high - prev.high;
    const downMove = prev.low - current.low;
    plusDMSum += upMove > downMove && upMove > 0 ? upMove : 0;
    minusDMSum += downMove > upMove && downMove > 0 ? downMove : 0;
    trSum += Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );
  }

  let tr = trSum;
  let plusDM = plusDMSum;
  let minusDM = minusDMSum;
  const dx = new Array(candles.length).fill(null);

  for (let i = period; i < candles.length; i++) {
    if (i > period) {
      const current = candles[i];
      const prev = candles[i - 1];
      const upMove = current.high - prev.high;
      const downMove = prev.low - current.low;
      const currentTR = Math.max(
        current.high - current.low,
        Math.abs(current.high - prev.close),
        Math.abs(current.low - prev.close)
      );
      tr = tr - (tr / period) + currentTR;
      plusDM = plusDM - (plusDM / period) + (upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM = minusDM - (minusDM / period) + (downMove > upMove && downMove > 0 ? downMove : 0);
    }

    if (tr <= 0) continue;
    const plusDI = (plusDM / tr) * 100;
    const minusDI = (minusDM / tr) * 100;
    const denom = plusDI + minusDI;
    if (denom > 0) dx[i] = (Math.abs(plusDI - minusDI) / denom) * 100;
  }

  let adx = 0;
  for (let i = period; i < period * 2; i++) {
    if (!Number.isFinite(dx[i])) return null;
    adx += dx[i];
  }
  adx /= period;

  for (let i = period * 2; i < candles.length; i++) {
    if (Number.isFinite(dx[i])) adx = ((adx * (period - 1)) + dx[i]) / period;
  }

  if (tr <= 0) return null;
  const plusDI = (plusDM / tr) * 100;
  const minusDI = (minusDM / tr) * 100;
  return {
    adx,
    plusDI,
    minusDI,
    bullishTrend: plusDI > minusDI,
    bearishTrend: minusDI > plusDI
  };
}

export function calculateVolumeSMA(candles, period = 20) {
  if (!Array.isArray(candles) || candles.length < period) return null;
  return candles.slice(-period).reduce((sum, candle) => sum + candle.volume, 0) / period;
}

export function calculateVWAP(candles, lookback = 96) {
  if (!Array.isArray(candles) || candles.length < Math.min(lookback, 5)) return null;
  const slice = candles.slice(-lookback);
  let pv = 0;
  let volume = 0;
  for (const candle of slice) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    pv += typical * candle.volume;
    volume += candle.volume;
  }
  return volume > 0 ? pv / volume : null;
}

export function calculateBollingerBands(closes, period = 20, mult = 2) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const basis = calculateSMA(closes, period);
  const stdev = calculateStdev(closes, period);
  if (!Number.isFinite(basis) || !Number.isFinite(stdev)) return null;
  return {
    upper: basis + stdev * mult,
    middle: basis,
    lower: basis - stdev * mult,
    widthPct: basis > 0 ? ((stdev * mult * 2) / basis) * 100 : null
  };
}

function linearRegressionEndpoint(values) {
  const n = values.length;
  if (n < 2 || values.some(value => !Number.isFinite(value))) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return intercept + slope * (n - 1);
}

export function calculateSqueeze(candles, length = 20, multBB = 2.0, multKC = 1.5) {
  if (!Array.isArray(candles) || candles.length < length + 2) {
    return { sqzOn: false, sqzOff: false, momentum: 0, prevMomentum: 0, rising: false, bullish: false, fired: false };
  }

  const atIndex = endIndex => {
    const slice = candles.slice(endIndex - length + 1, endIndex + 1);
    const closes = slice.map(candle => candle.close);
    const highs = slice.map(candle => candle.high);
    const lows = slice.map(candle => candle.low);
    const basis = closes.reduce((sum, value) => sum + value, 0) / length;
    const variance = closes.reduce((sum, value) => sum + ((value - basis) ** 2), 0) / length;
    const stdev = Math.sqrt(variance);
    const upperBB = basis + multBB * stdev;
    const lowerBB = basis - multBB * stdev;
    const ranges = slice.map((candle, index) => {
      if (index === 0) return candle.high - candle.low;
      const prevClose = slice[index - 1].close;
      return Math.max(candle.high - candle.low, Math.abs(candle.high - prevClose), Math.abs(candle.low - prevClose));
    });
    const rangeMA = ranges.reduce((sum, value) => sum + value, 0) / length;
    const upperKC = basis + rangeMA * multKC;
    const lowerKC = basis - rangeMA * multKC;
    const highest = Math.max(...highs);
    const lowest = Math.min(...lows);
    const mid = ((highest + lowest) / 2 + basis) / 2;
    const regressionInput = closes.map(close => close - mid);
    const momentum = linearRegressionEndpoint(regressionInput) ?? closes[closes.length - 1] - mid;

    return {
      sqzOn: lowerBB > lowerKC && upperBB < upperKC,
      sqzOff: lowerBB < lowerKC && upperBB > upperKC,
      momentum,
      widthPct: basis > 0 ? ((upperBB - lowerBB) / basis) * 100 : null
    };
  };

  const current = atIndex(candles.length - 1);
  const previous = atIndex(candles.length - 2);
  return {
    ...current,
    prevMomentum: previous.momentum,
    rising: current.momentum > previous.momentum,
    bullish: current.momentum > 0,
    fired: previous.sqzOn && current.sqzOff
  };
}

export function calculateMACD(closes, fast = 12, slow = 26, signalLength = 9) {
  const fastSeries = calculateEMASeries(closes, fast);
  const slowSeries = calculateEMASeries(closes, slow);
  if (!fastSeries || !slowSeries) return null;

  const macdSeries = closes.map((_, index) => (
    Number.isFinite(fastSeries[index]) && Number.isFinite(slowSeries[index])
      ? fastSeries[index] - slowSeries[index]
      : null
  ));
  const signalSeries = calculateNullableEMASeries(macdSeries, signalLength);
  if (!signalSeries) return null;

  const lastIndex = macdSeries.length - 1;
  const prevIndex = macdSeries.length - 2;
  const macd = macdSeries[lastIndex];
  const signal = signalSeries[lastIndex];
  const prevMacd = macdSeries[prevIndex];
  const prevSignal = signalSeries[prevIndex];
  if (![macd, signal, prevMacd, prevSignal].every(Number.isFinite)) return null;

  const hist = macd - signal;
  const prevHist = prevMacd - prevSignal;
  return {
    macd,
    signal,
    hist,
    prevHist,
    histDelta: hist - prevHist,
    crossUp: prevMacd <= prevSignal && macd > signal,
    crossDown: prevMacd >= prevSignal && macd < signal,
    aboveSignal: macd >= signal
  };
}

export function calculateMLMA(candles, window = 80, mult = 1.8) {
  if (!Array.isArray(candles) || candles.length < window + 5) return null;
  const closes = candles.map(candle => candle.close);

  const estimateAt = endIndex => {
    const start = endIndex - window + 1;
    if (start < 0) return null;
    const slice = closes.slice(start, endIndex + 1);
    const lengthScale = window / 2.5;
    let weighted = 0;
    let weightSum = 0;
    for (let i = 0; i < slice.length; i++) {
      const distance = slice.length - 1 - i;
      const weight = Math.exp(-(distance ** 2) / (2 * (lengthScale ** 2)));
      weighted += slice[i] * weight;
      weightSum += weight;
    }
    if (weightSum <= 0) return null;
    const out = weighted / weightSum;
    const mae = slice.reduce((sum, value) => sum + Math.abs(value - out), 0) / slice.length * mult;
    return { out, mae, upper: out + mae, lower: out - mae };
  };

  const current = estimateAt(closes.length - 1);
  const previous = estimateAt(closes.length - 2);
  if (!current || !previous) return null;

  const close = closes[closes.length - 1];
  return {
    ...current,
    prevOut: previous.out,
    slopePct: previous.out > 0 ? ((current.out - previous.out) / previous.out) * 100 : 0,
    bullish: close > current.out && current.out >= previous.out,
    bearish: close < current.out && current.out <= previous.out,
    upperBreak: close > current.upper && current.out > previous.out,
    lowerBreak: close < current.lower && current.out < previous.out
  };
}

export function calculateVIDYA(candles, length = 10, momentumLength = 20, bandDistance = 2) {
  if (!Array.isArray(candles) || candles.length < Math.max(80, momentumLength + 20)) return null;
  const closes = candles.map(candle => candle.close);
  const vidyaRaw = new Array(candles.length).fill(null);
  const alpha = 2 / (length + 1);
  let previous = closes[0];

  for (let i = 1; i < closes.length; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = Math.max(1, i - momentumLength + 1); j <= i; j++) {
      const change = closes[j] - closes[j - 1];
      if (change >= 0) pos += change;
      else neg += -change;
    }
    const denom = pos + neg;
    const absCMO = denom > 0 ? Math.abs(100 * (pos - neg) / denom) : 0;
    previous = alpha * absCMO / 100 * closes[i] + (1 - alpha * absCMO / 100) * previous;
    vidyaRaw[i] = previous;
  }

  const vidya = calculateNullableEMASeries(vidyaRaw, 15);
  const atr = calculateATRSeries(candles, Math.min(50, Math.max(14, Math.floor(candles.length / 5))));
  if (!vidya || !atr) return null;

  const trend = new Array(candles.length).fill(false);
  const upper = new Array(candles.length).fill(null);
  const lower = new Array(candles.length).fill(null);
  let isTrendUp = false;

  for (let i = 1; i < candles.length; i++) {
    if (!Number.isFinite(vidya[i]) || !Number.isFinite(atr[i])) {
      trend[i] = isTrendUp;
      continue;
    }
    upper[i] = vidya[i] + atr[i] * bandDistance;
    lower[i] = vidya[i] - atr[i] * bandDistance;
    if (Number.isFinite(upper[i - 1]) && candles[i - 1].close <= upper[i - 1] && candles[i].close > upper[i]) {
      isTrendUp = true;
    } else if (Number.isFinite(lower[i - 1]) && candles[i - 1].close >= lower[i - 1] && candles[i].close < lower[i]) {
      isTrendUp = false;
    }
    trend[i] = isTrendUp;
  }

  const last = candles.length - 1;
  let segmentStart = Math.max(0, last - 30);
  for (let i = last; i > 0; i--) {
    if (trend[i] !== trend[i - 1]) {
      segmentStart = i;
      break;
    }
  }

  let upVolume = 0;
  let downVolume = 0;
  for (let i = segmentStart; i <= last; i++) {
    if (candles[i].close >= candles[i].open) upVolume += candles[i].volume;
    else downVolume += candles[i].volume;
  }
  const avgVolume = (upVolume + downVolume) / 2;
  const volumeDeltaPct = avgVolume > 0 ? ((upVolume - downVolume) / avgVolume) * 100 : 0;

  return {
    value: vidya[last],
    upper: upper[last],
    lower: lower[last],
    trendUp: trend[last],
    trendCrossUp: !trend[last - 1] && trend[last],
    trendCrossDown: trend[last - 1] && !trend[last],
    smoothedValue: trend[last] ? lower[last] : upper[last],
    upVolume,
    downVolume,
    volumeDeltaPct,
    distancePct: Number.isFinite(vidya[last]) && vidya[last] > 0 ? ((closes[last] - vidya[last]) / vidya[last]) * 100 : null
  };
}

export function calculateTwoPoleOscillator(closes, length = 15) {
  if (!Array.isArray(closes) || closes.length < 80) return null;
  const sma25 = calculateSMASeries(closes, 25);
  const deviation = closes.map((close, index) => Number.isFinite(sma25?.[index]) ? close - sma25[index] : null);
  const deviationSMA = calculateNullableEMASeries(deviation, 25);
  const normalized = new Array(closes.length).fill(null);

  for (let i = 0; i < closes.length; i++) {
    if (!Number.isFinite(deviation[i]) || !Number.isFinite(deviationSMA?.[i])) continue;
    const sample = deviation.slice(Math.max(0, i - 24), i + 1).filter(Number.isFinite);
    if (sample.length < 25) continue;
    const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
    const sd = Math.sqrt(sample.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / sample.length);
    normalized[i] = sd > 0 ? ((deviation[i] - deviationSMA[i]) / sd) : 0;
  }

  const alpha = 2 / (length + 1);
  const smooth1 = new Array(closes.length).fill(null);
  const smooth2 = new Array(closes.length).fill(null);
  for (let i = 0; i < normalized.length; i++) {
    const value = normalized[i];
    if (!Number.isFinite(value)) continue;
    smooth1[i] = Number.isFinite(smooth1[i - 1]) ? (1 - alpha) * smooth1[i - 1] + alpha * value : value;
    smooth2[i] = Number.isFinite(smooth2[i - 1]) ? (1 - alpha) * smooth2[i - 1] + alpha * smooth1[i] : smooth1[i];
  }

  const last = closes.length - 1;
  const current = smooth2[last];
  const lag = smooth2[last - 4];
  const previous = smooth2[last - 1];
  const previousLag = smooth2[last - 5];
  if (![current, lag, previous, previousLag].every(Number.isFinite)) return null;

  return {
    value: current,
    lag,
    slope: current - previous,
    buy: previous <= previousLag && current > lag && current < 0,
    sell: previous >= previousLag && current < lag && current > 0,
    bullish: current > lag,
    bearish: current < lag,
    deeplyOversold: current < -0.55,
    overbought: current > 0.55
  };
}

export function calculateSOTT(candles, signalLength = 20, maLength = 20) {
  if (!Array.isArray(candles) || candles.length < 90) return null;
  const typical = candles.map(candle => (candle.high + candle.low + candle.close) / 3);
  const fast = calculateEMASeries(typical, 5);
  const slow = calculateEMASeries(typical, 34);
  const atr = calculateATRSeries(candles, 34);
  if (!fast || !slow || !atr) return null;

  const instant = typical.map((_, index) => {
    if (!Number.isFinite(fast[index]) || !Number.isFinite(slow[index]) || !Number.isFinite(atr[index]) || atr[index] <= 0) return null;
    return clamp((fast[index] - slow[index]) / (atr[index] * 2), -1, 1);
  });
  const signal = calculateNullableEMASeries(instant, signalLength);
  const ma = calculateNullableEMASeries(signal, maLength);
  if (!signal || !ma) return null;

  const last = candles.length - 1;
  const currentSignal = signal[last];
  const currentMA = ma[last];
  const prevSignal = signal[last - 1];
  const prevMA = ma[last - 1];
  if (![currentSignal, currentMA, prevSignal, prevMA].every(Number.isFinite)) return null;

  return {
    instant: instant[last],
    signal: currentSignal,
    ma: currentMA,
    signalIsBull: currentSignal > 0,
    maIsBull: currentMA > 0,
    channelIsBull: currentSignal > currentMA,
    strongBull: currentSignal > currentMA && currentSignal > 0,
    strongBear: currentSignal < currentMA && currentSignal < 0,
    bullCross: prevSignal <= prevMA && currentSignal > currentMA,
    bearCross: prevSignal >= prevMA && currentSignal < currentMA
  };
}

export function findSwingPivots(candles, left = 3, right = 3) {
  const highs = [];
  const lows = [];
  if (!Array.isArray(candles) || candles.length < left + right + 1) return { highs, lows };

  for (let i = left; i < candles.length - right; i++) {
    let pivotHigh = true;
    let pivotLow = true;
    for (let j = 1; j <= left; j++) {
      if (candles[i - j].high >= candles[i].high) pivotHigh = false;
      if (candles[i - j].low <= candles[i].low) pivotLow = false;
    }
    for (let j = 1; j <= right; j++) {
      if (candles[i + j].high > candles[i].high) pivotHigh = false;
      if (candles[i + j].low < candles[i].low) pivotLow = false;
    }
    if (pivotHigh) highs.push({ price: candles[i].high, index: i, time: candles[i].time });
    if (pivotLow) lows.push({ price: candles[i].low, index: i, time: candles[i].time });
  }

  return { highs, lows };
}

export function detectSMC(candles, pivotLength = 4) {
  const pivots = findSwingPivots(candles, pivotLength, pivotLength);
  const last = candles[candles.length - 1];
  if (!last || !pivots.highs.length || !pivots.lows.length) {
    return { bullishBOS: false, bearishBOS: false, inDiscountZone: false, nearBullishOrderBlock: false };
  }

  const lastHigh = pivots.highs[pivots.highs.length - 1];
  const lastLow = pivots.lows[pivots.lows.length - 1];
  const previous = candles[candles.length - 2];
  const bullishBOS = previous && previous.close <= lastHigh.price && last.close > lastHigh.price;
  const bearishBOS = previous && previous.close >= lastLow.price && last.close < lastLow.price;
  const recentBullishBOS = candles.slice(-8).some(candle => candle.close > lastHigh.price);
  const recentBearishBOS = candles.slice(-8).some(candle => candle.close < lastLow.price);
  const equilibrium = (lastHigh.price + lastLow.price) / 2;
  const range = lastHigh.price - lastLow.price;
  const inDiscountZone = range > 0 && last.close <= equilibrium;
  const inPremiumZone = range > 0 && last.close >= equilibrium;

  let orderBlock = null;
  const searchStart = Math.max(0, Math.min(lastHigh.index, candles.length - 18));
  for (let i = candles.length - 2; i >= searchStart; i--) {
    if (candles[i].close < candles[i].open) {
      orderBlock = { low: candles[i].low, high: candles[i].open, index: i, time: candles[i].time };
      break;
    }
  }

  const nearBullishOrderBlock = !!orderBlock && last.low <= orderBlock.high * 1.003 && last.close >= orderBlock.low;
  const bullishFVG = candles.length >= 3 && candles[candles.length - 3].high < last.low;
  const bearishFVG = candles.length >= 3 && candles[candles.length - 3].low > last.high;

  return {
    bullishBOS,
    bearishBOS,
    recentBullishBOS,
    recentBearishBOS,
    lastHigh: lastHigh.price,
    lastLow: lastLow.price,
    equilibrium,
    inDiscountZone,
    inPremiumZone,
    orderBlock,
    nearBullishOrderBlock,
    bullishFVG,
    bearishFVG,
    rangePct: lastLow.price > 0 ? (range / lastLow.price) * 100 : null
  };
}

export function calculateRelativeStrength(symbolCloses, benchmarkCloses, lookback = 12) {
  if (!Array.isArray(symbolCloses) || !Array.isArray(benchmarkCloses)) return 0;
  if (symbolCloses.length < lookback || benchmarkCloses.length < lookback) return 0;
  const symbolStart = symbolCloses[symbolCloses.length - lookback];
  const symbolEnd = symbolCloses[symbolCloses.length - 1];
  const benchmarkStart = benchmarkCloses[benchmarkCloses.length - lookback];
  const benchmarkEnd = benchmarkCloses[benchmarkCloses.length - 1];
  if ([symbolStart, symbolEnd, benchmarkStart, benchmarkEnd].some(value => !Number.isFinite(value) || value <= 0)) return 0;
  return ((symbolEnd - symbolStart) / symbolStart) - ((benchmarkEnd - benchmarkStart) / benchmarkStart);
}

export function getRecentRangeLevels(candles, lookback = 20) {
  if (!Array.isArray(candles) || candles.length < lookback + 1) return null;
  const slice = candles.slice(-(lookback + 1), -1);
  const high = Math.max(...slice.map(candle => candle.high));
  const low = Math.min(...slice.map(candle => candle.low));
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= 0 || low <= 0) return null;
  return {
    high,
    low,
    widthPct: ((high - low) / low) * 100
  };
}

export function calculateOrderBookMetrics(orderBook) {
  if (!orderBook || !Array.isArray(orderBook.bids) || !Array.isArray(orderBook.asks) || !orderBook.bids.length || !orderBook.asks.length) return null;
  const [bestBid] = orderBook.bids[0];
  const [bestAsk] = orderBook.asks[0];
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0) return null;

  const mid = (bestBid + bestAsk) / 2;
  const spreadBps = ((bestAsk - bestBid) / mid) * 10000;
  const bids = orderBook.bids.slice(0, 20);
  const asks = orderBook.asks.slice(0, 20);
  const bidNotional = bids.reduce((sum, [price, qty]) => sum + price * qty, 0);
  const askNotional = asks.reduce((sum, [price, qty]) => sum + price * qty, 0);
  const total = bidNotional + askNotional;

  return {
    spreadBps,
    depthQuoteTopN: total,
    obi: total > 0 ? (bidNotional - askNotional) / total : 0
  };
}

export function classifyLiquidityTier(quoteVol24h, depthQuoteTopN, spreadBps, maxSpreadBps = 8) {
  if (quoteVol24h >= 50000000 && depthQuoteTopN >= 250000 && spreadBps <= 3) return 'ELITE';
  if (quoteVol24h >= 20000000 && depthQuoteTopN >= 150000 && spreadBps <= 5) return 'HIGH';
  if (quoteVol24h >= 8000000 && depthQuoteTopN >= 90000 && spreadBps <= maxSpreadBps) return 'MEDIUM';
  return 'LOW';
}

export function getExecutionRejectCode(obMetrics, liquidityTier, options = {}) {
  const maxSpreadBps = options.maxSpreadBps ?? 8;
  const minDepthQuote = options.minDepthQuote ?? 90000;
  if (!obMetrics) return 'ORDERBOOK_UNAVAILABLE';
  if (obMetrics.spreadBps > maxSpreadBps) return 'EXEC_SPREAD';
  if (obMetrics.depthQuoteTopN < minDepthQuote) return 'EXEC_DEPTH';
  if (liquidityTier === 'LOW') return 'LIQUIDITY_TIER_LOW';
  return null;
}

export function buildExecutionQuality(liquidityTier, spreadBps, depthQuoteTopN) {
  let score = 60;
  if (liquidityTier === 'ELITE') score = 95;
  else if (liquidityTier === 'HIGH') score = 84;
  else if (liquidityTier === 'MEDIUM') score = 70;
  else score = 50;

  if (spreadBps <= 2) score += 3;
  else if (spreadBps >= 7) score -= 6;

  if (depthQuoteTopN >= 250000) score += 3;
  else if (depthQuoteTopN < 100000) score -= 5;

  return clamp(score, 0, 100);
}

export function detectBTCContext(candles4h, candles1h, ticker24h) {
  const closed4h = getClosedCandles(candles4h, '4h');
  const closed1h = getClosedCandles(candles1h, '60m');
  const closes4h = closed4h.map(candle => candle.close);
  const closes1h = closed1h.map(candle => candle.close);
  const ema21_4h = calculateEMA(closes4h, 21);
  const ema50_4h = calculateEMA(closes4h, 50);
  const ema21_1h = calculateEMA(closes1h, 21);
  const rsi4h = calculateRSI(closes4h, 14);
  const rsi1h = calculateRSI(closes1h, 14);
  const price4h = closes4h[closes4h.length - 1];
  const price1h = closes1h[closes1h.length - 1];
  const priceChange24h = Number(ticker24h?.priceChangePercent || 0);

  if (![price4h, ema21_4h, ema50_4h, rsi4h, rsi1h].every(Number.isFinite)) {
    return { status: 'GREEN', reason: 'BTC context fallback', closes4h, closes1h, priceChange24h };
  }

  if (price4h < ema50_4h || ema21_4h < ema50_4h || rsi4h < 43) {
    return {
      status: 'RED',
      reason: 'BTC 4H risk-off',
      closes4h,
      closes1h,
      priceChange24h,
      rsi4h: roundMetric(rsi4h, 1),
      rsi1h: roundMetric(rsi1h, 1)
    };
  }

  if ((Number.isFinite(price1h) && Number.isFinite(ema21_1h) && price1h > ema21_1h * 1.018) || rsi1h > 69) {
    return {
      status: 'AMBER',
      reason: 'BTC short-term stretched',
      closes4h,
      closes1h,
      priceChange24h,
      rsi4h: roundMetric(rsi4h, 1),
      rsi1h: roundMetric(rsi1h, 1)
    };
  }

  return {
    status: 'GREEN',
    reason: 'BTC trend supportive',
    closes4h,
    closes1h,
    priceChange24h,
    rsi4h: roundMetric(rsi4h, 1),
    rsi1h: roundMetric(rsi1h, 1)
  };
}

export function detectMarketRegime({ bull4h, adx15m, atrPercentile, btcRisk }) {
  if (btcRisk === 'RED') return 'RISK_OFF';
  if (bull4h && Number.isFinite(adx15m) && adx15m >= 24 && atrPercentile >= 65) return 'HIGH_VOL_BREAKOUT';
  if (bull4h && Number.isFinite(adx15m) && adx15m >= 18) return 'TRENDING';
  if (atrPercentile >= 75) return 'VOLATILE_TRANSITION';
  return 'RANGING';
}

export function calculateVolatilityPercentile(candles, period = 14, sampleSize = 80) {
  const atrSeries = calculateATRSeries(candles, period);
  if (!atrSeries) return 50;
  const current = atrSeries[atrSeries.length - 1];
  const sample = atrSeries.slice(-sampleSize).filter(Number.isFinite);
  if (!Number.isFinite(current) || !sample.length) return 50;
  const below = sample.filter(value => value <= current).length;
  return (below / sample.length) * 100;
}

export function selectTopSymbols(tickers, quoteAsset, limit, minQuoteVolume, mode = 'momentum') {
  const btcTicker = tickers.find(ticker => ticker.symbol === `BTC${quoteAsset}`);
  const btcChange = Number(btcTicker?.priceChangePercent || 0);
  const scored = tickers
    .filter(ticker => typeof ticker.symbol === 'string' && ticker.symbol.endsWith(quoteAsset))
    .map(ticker => {
      const base = normalizeBaseAsset(ticker.symbol, quoteAsset);
      const quoteVolume = Number(ticker.quoteVolume || 0);
      if (!base || isNonCryptoWrapper(base)) return null;
      if (ticker.symbol === `USDC${quoteAsset}`) return null;
      if (!Number.isFinite(quoteVolume) || quoteVolume < minQuoteVolume) return null;

      const high = Number(ticker.highPrice || 0);
      const low = Number(ticker.lowPrice || 0);
      const change = Number(ticker.priceChangePercent || 0);
      const volatility = low > 0 ? ((high - low) / low) * 100 : 0;
      const rs24h = change - btcChange;
      const liquidity = Math.log10(Math.max(quoteVolume, 1));
      const score = mode === 'reversion'
        ? liquidity * 0.45 + clamp(-change, 0, 16) * 0.35 + clamp(volatility, 0, 30) * 0.2
        : liquidity * 0.45 + clamp(rs24h, -12, 18) * 0.35 + clamp(volatility, 0, 24) * 0.2;

      return { symbol: ticker.symbol, base, quoteVolume, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.quoteVolume - a.quoteVolume);

  const guaranteed = CORE_LEADERS
    .map(base => `${base}${quoteAsset}`)
    .filter(symbol => scored.some(item => item.symbol === symbol));

  const merged = [];
  const seen = new Set();
  for (const symbol of [...guaranteed, ...scored.map(item => item.symbol)]) {
    if (!seen.has(symbol)) {
      seen.add(symbol);
      merged.push(symbol);
    }
  }

  return merged.slice(0, limit);
}

export function toSummaryPairs(bucket, limit = 8) {
  return Object.entries(bucket || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => `${key}=${value}`);
}

export function buildRelativeStrengthSnapshot(rs1h, rs4h, rs24h) {
  return {
    rs1h: roundMetric(rs1h, 4),
    rs4h: roundMetric(rs4h, 4),
    rs24h: roundMetric(rs24h, 2)
  };
}

export function buildVolumeLiquidityConfirmation(volumeRatio, deltaRatio, obMetrics, liquidityTier, minVolumeRatio = 1) {
  return {
    minVolumeRatio: roundMetric(minVolumeRatio, 2),
    volumeRatio: roundMetric(volumeRatio),
    volumePass: Number.isFinite(volumeRatio) ? volumeRatio >= minVolumeRatio : false,
    deltaRatio: deltaRatio === null || deltaRatio === undefined ? null : roundMetric(deltaRatio, 3),
    deltaPass: deltaRatio === null || deltaRatio === undefined ? null : deltaRatio >= -0.05,
    obi: obMetrics ? roundMetric(obMetrics.obi, 3) : null,
    obiPass: obMetrics ? obMetrics.obi >= -0.08 : false,
    spreadBps: obMetrics ? roundMetric(obMetrics.spreadBps, 1) : null,
    depthQuoteTopN: obMetrics ? Math.round(obMetrics.depthQuoteTopN) : null,
    liquidityTier
  };
}
