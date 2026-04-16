/**
 * Netlify Scheduled Function - Evidence-First Spot Intraday Analysis
 * Focused on liquid crypto spot pairs, long-only, with transparent module logic.
 */

import { schedule } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const ALGORITHM_VERSION = 'v10.2.0-QuantumEdge';
console.log(`--- DAY TRADE Analysis Module Loaded (${ALGORITHM_VERSION}) ---`);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 65;
const MAX_SPREAD_BPS = process.env.MAX_SPREAD_BPS ? Number(process.env.MAX_SPREAD_BPS) : 8;
const MIN_DEPTH_QUOTE = process.env.MIN_DEPTH_QUOTE ? Number(process.env.MIN_DEPTH_QUOTE) : 90000;
const MIN_ATR_PCT = process.env.MIN_ATR_PCT ? Number(process.env.MIN_ATR_PCT) : 0.12;
const MAX_ATR_PCT = process.env.MAX_ATR_PCT ? Number(process.env.MAX_ATR_PCT) : 6;
const QUOTE_ASSET = (process.env.QUOTE_ASSET || 'USDT').toUpperCase();
const MAX_SYMBOLS = process.env.MAX_SYMBOLS ? Number(process.env.MAX_SYMBOLS) : 60;
const MIN_QUOTE_VOL_24H = process.env.MIN_QUOTE_VOL_24H ? Number(process.env.MIN_QUOTE_VOL_24H) : 8000000;
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || '';
const ALERT_COOLDOWN_MIN = process.env.ALERT_COOLDOWN_MIN ? Number(process.env.ALERT_COOLDOWN_MIN) : 240;
const AVOID_ASIA_SESSION = (process.env.AVOID_ASIA_SESSION || 'false').toLowerCase() === 'true';

export const COOLDOWN_STORE_KEY = 'signal-cooldowns';
const COOLDOWN_EXPIRY_HOURS = 24;
const RUN_LOCK_KEY = 'global-run-lock';

export const HISTORY_STORE_KEY = 'signal-history-v2';
export const SHADOW_STORE_KEY = 'shadow-trades-v1';
export const SHADOW_ARCHIVE_STORE_KEY = 'shadow-trades-archive-v1';
export const MEMORY_STORE_KEY = 'signal-memory-v1';
export const AUTOPSY_STORE_KEY = 'trade-autopsies-v1';
export const PERSISTENT_LOG_STORE_KEY = 'persistent-logs-v1';

const SHADOW_BENCHMARK_VERSION = `${ALGORITHM_VERSION}-shadow-v1`;
const SHADOW_BENCHMARK_TP_PCT = process.env.SHADOW_BENCHMARK_TP_PCT ? Number(process.env.SHADOW_BENCHMARK_TP_PCT) : 0.015;
const SHADOW_BENCHMARK_SL_PCT = process.env.SHADOW_BENCHMARK_SL_PCT ? Number(process.env.SHADOW_BENCHMARK_SL_PCT) : 0.010;

const MEXC_API = 'https://api.mexc.com/api/v3';
const candleCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

const STABLE_BASES = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI', 'EUR', 'GBP']);
const TOKENIZED_METAL_BASES = new Set(['PAXG', 'XAUT', 'XAG', 'XAU']);
const CORE_LEADERS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'LINK'];

const SECTOR_MAP = {
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

const FALLBACK_SYMBOLS = CORE_LEADERS.map(base => `${base}${QUOTE_ASSET}`);

function getCachedCandles(key) {
  const cached = candleCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    candleCache.delete(key);
    return null;
  }
  return cached.data;
}

function setCachedCandles(key, data) {
  candleCache.set(key, { data, timestamp: Date.now() });
}

function normalizeBaseAsset(symbol = '') {
  return symbol.endsWith(QUOTE_ASSET) ? symbol.slice(0, -QUOTE_ASSET.length) : symbol;
}

function getSector(symbol) {
  return SECTOR_MAP[normalizeBaseAsset(symbol)] || 'OTHER';
}

function isProtectedSector(sector) {
  return sector && sector !== 'UNKNOWN' && sector !== 'OTHER';
}

function getTradingSessionStatus(now = new Date()) {
  const utcHour = now.getUTCHours();
  if (!AVOID_ASIA_SESSION) {
    return { allowed: true, utcHour, reason: null };
  }

  if (utcHour >= 0 && utcHour < 7) {
    return {
      allowed: false,
      utcHour,
      reason: `Asia session detected (${utcHour}:00 UTC) - trading restricted`
    };
  }

  return { allowed: true, utcHour, reason: null };
}

function isNonCryptoWrapper(base) {
  if (!base) return true;
  if (STABLE_BASES.has(base)) return true;
  if (TOKENIZED_METAL_BASES.has(base)) return true;
  if (base.includes('(') || base.includes(')')) return true;
  if (base.startsWith('GOLD') || base.startsWith('SILVER')) return true;
  if (base.endsWith('UP') || base.endsWith('DOWN') || base.endsWith('BULL') || base.endsWith('BEAR')) return true;
  return false;
}

function escapeMarkdownV2(text = '') {
  if (typeof text !== 'string') text = String(text);
  return text.replace(/([_*\u005B\u005D()~`>#+=|{}.!-])/g, '\\$1');
}

async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Codex Trading Research Bot)'
      }
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function intervalToMs(interval) {
  if (typeof interval !== 'string' || interval.length < 2) return null;
  const match = interval.trim().match(/^(\d+)\s*([mhd])$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return null;

  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  return null;
}

function getClosedCandles(candles, interval, now = Date.now()) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const intervalMs = intervalToMs(interval);
  if (!intervalMs) return candles.slice();

  const toleranceMs = 2000;
  const last = candles[candles.length - 1];
  const closeTime = Number.isFinite(last?.closeTime) ? last.closeTime : (Number.isFinite(last?.time) ? last.time + intervalMs : null);

  if (!Number.isFinite(closeTime)) return candles.slice(0, -1);
  return now < (closeTime - toleranceMs) ? candles.slice(0, -1) : candles.slice();
}

export function getInternalStore(context) {
  const options = { name: 'trading-signals' };
  const siteID = context?.site?.id || context?.siteID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = context?.token || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID) options.siteID = siteID;
  if (token) options.token = token;
  return getStore(options);
}

export async function loadCooldowns(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(COOLDOWN_STORE_KEY, { type: 'json' });
    if (!data) return {};

    const now = Date.now();
    const expiryMs = COOLDOWN_EXPIRY_HOURS * 3600 * 1000;
    const fresh = {};
    for (const [symbol, ts] of Object.entries(data)) {
      if (Number.isFinite(Number(ts)) && now - Number(ts) < expiryMs) {
        fresh[symbol] = Number(ts);
      }
    }
    return fresh;
  } catch (error) {
    console.error('Error loading cooldowns:', error.message);
    return {};
  }
}

export async function saveCooldowns(cooldowns, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(COOLDOWN_STORE_KEY, cooldowns);
  } catch (error) {
    console.error('Error saving cooldowns:', error.message);
  }
}

async function acquireRunLock(context) {
  try {
    const store = getInternalStore(context);
    const lock = await store.get(RUN_LOCK_KEY, { type: 'json' });
    const now = Date.now();

    if (lock && now - lock.timestamp < 3 * 60000) {
      console.warn(`[LOCK] Analysis already in progress (${Math.round((now - lock.timestamp) / 1000)}s old).`);
      return false;
    }

    await store.setJSON(RUN_LOCK_KEY, { timestamp: now, id: `run-${now}` });
    return true;
  } catch (error) {
    console.error('[LOCK] Error acquiring lock:', error.message);
    return true;
  }
}

async function releaseRunLock(context) {
  try {
    const store = getInternalStore(context);
    await store.delete(RUN_LOCK_KEY);
  } catch (error) {
    console.error('[LOCK] Error releasing lock:', error.message);
  }
}

function roundMetric(value, decimals = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function countMetric(bucket, key) {
  if (!bucket || !key) return;
  bucket[key] = (bucket[key] || 0) + 1;
}

function formatPersistentLogEntry(message, date = new Date()) {
  const timestamp = date.toISOString().replace('T', ' ').split('.')[0];
  return `[${timestamp}] ${message}`;
}

function toSummaryPairs(bucket, limit = 8) {
  return Object.entries(bucket || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => `${key}=${value}`);
}

function buildRelativeStrengthSnapshot(rs1h, rs4h, rs24h) {
  return {
    rs1h: roundMetric(rs1h, 4),
    rs4h: roundMetric(rs4h, 4),
    rs24h: roundMetric(rs24h, 2)
  };
}

function buildVolumeLiquidityConfirmation(volumeRatio, deltaRatio, obMetrics, liquidityTier, minVolumeRatio) {
  return {
    minVolumeRatio: roundMetric(minVolumeRatio, 2),
    volumeRatio: roundMetric(volumeRatio),
    volumePass: Number.isFinite(volumeRatio) ? volumeRatio >= minVolumeRatio : false,
    deltaRatio: deltaRatio === null ? null : roundMetric(deltaRatio, 3),
    deltaPass: deltaRatio === null ? null : deltaRatio >= 0,
    obi: obMetrics ? roundMetric(obMetrics.obi, 3) : null,
    obiPass: obMetrics ? obMetrics.obi >= -0.05 : false,
    spreadBps: obMetrics ? roundMetric(obMetrics.spreadBps, 1) : null,
    depthQuoteTopN: obMetrics ? Math.round(obMetrics.depthQuoteTopN) : null,
    liquidityTier
  };
}

function buildRiskModel(regime, module, atrPercent, liquidityTier) {
  let tpMultiplier = 3.0;
  let slMultiplier = 1.5;
  let timeStopHours = 10;

  if (module === 'VWAP_PULLBACK') {
    tpMultiplier = 3.0;
    slMultiplier = 1.4;
    timeStopHours = 12;
  } else if (module === 'VCP_BREAKOUT') {
    tpMultiplier = 2.5; 
    slMultiplier = 1.2;
    timeStopHours = 6; 
  }

  if (liquidityTier === 'MEDIUM') {
    tpMultiplier *= 0.95;
    slMultiplier *= 0.95;
  }

  const tpPct = (atrPercent / 100) * tpMultiplier;
  const slPct = (atrPercent / 100) * slMultiplier;

  return {
    tpMultiplier: roundMetric(tpMultiplier, 2),
    slMultiplier: roundMetric(slMultiplier, 2),
    tpPct,
    slPct,
    realRR: slMultiplier > 0 ? tpMultiplier / slMultiplier : 0,
    timeStopHours
  };
}

async function recordSignalHistory(signal, context) {
  try {
    const store = getInternalStore(context);
    const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];

    history.push({
      id: `${Date.now()}-${signal.symbol}`,
      symbol: signal.symbol,
      price: signal.price,
      tp: signal.tp,
      sl: signal.sl,
      type: signal.type,
      time: Date.now(),
      status: 'OPEN',
      score: signal.score,
      regime: signal.regime,
      btcRisk: signal.btcContext?.status || 'UNKNOWN',
      sector: signal.sector || getSector(signal.symbol),
      module: signal.module || null,
      entryArchetype: signal.entryArchetype || null,
      liquidityTier: signal.liquidityTier || null,
      promotedFromLow: signal.promotedFromLow || false,
      scoreBeforeMomentum: signal.scoreBeforeMomentum ?? signal.score,
      momentumAdjustment: signal.momentumAdjustment || 0,
      requiredScore: signal.requiredScore || null,
      requiredStrongCategories: signal.requiredStrongCategories ?? null,
      expectedHoldingHours: signal.expectedHoldingHours || null,
      riskModel: signal.riskModel || null,
      entryMetrics: signal.entryMetrics || null,
      qualityBreakdown: signal.qualityBreakdown || null,
      relativeStrengthSnapshot: signal.relativeStrengthSnapshot || null,
      volumeLiquidityConfirmation: signal.volumeLiquidityConfirmation || null,
      rejectReasonCode: signal.rejectReasonCode || null,
      volumeRatio: signal.volumeRatio || null,
      reasons: signal.reasons || [],
      maxFavorable: signal.price,
      maxAdverse: signal.price
    });

    await store.setJSON(HISTORY_STORE_KEY, history.slice(-200));
  } catch (error) {
    console.error('Error recording history:', error.message);
  }
}

async function recordTradeAutopsy(item, context) {
  try {
    const store = getInternalStore(context);
    const autopsies = await store.get(AUTOPSY_STORE_KEY, { type: 'json' }) || [];

    const entryPrice = item.price || item.entry;
    const hoursOpen = (Date.now() - item.time) / 3600000;
    const maxFav = Number.isFinite(item.maxFavorable) ? item.maxFavorable : entryPrice;
    const maxAdv = Number.isFinite(item.maxAdverse) ? item.maxAdverse : entryPrice;
    const favorableMove = item.type === 'BUY'
      ? (maxFav - entryPrice) / entryPrice
      : (entryPrice - maxFav) / entryPrice;
    const adverseMove = item.type === 'BUY'
      ? (entryPrice - maxAdv) / entryPrice
      : (maxAdv - entryPrice) / entryPrice;

    autopsies.push({
      id: item.id,
      symbol: item.symbol,
      outcome: item.outcome,
      regime: item.regime || 'UNKNOWN',
      btcRisk: item.btcRisk || 'UNKNOWN',
      score: item.score || 0,
      sector: item.sector || getSector(item.symbol),
      module: item.module || null,
      entryArchetype: item.entryArchetype || null,
      liquidityTier: item.liquidityTier || null,
      scoreBeforeMomentum: item.scoreBeforeMomentum ?? item.score ?? 0,
      momentumAdjustment: item.momentumAdjustment || 0,
      requiredScore: item.requiredScore || null,
      requiredStrongCategories: item.requiredStrongCategories ?? null,
      expectedHoldingHours: item.expectedHoldingHours || null,
      riskModel: item.riskModel || null,
      hoursOpen: roundMetric(hoursOpen, 1),
      favorableMovePct: roundMetric(favorableMove * 100, 2),
      adverseMovePct: roundMetric(adverseMove * 100, 2),
      mfePct: roundMetric(favorableMove * 100, 2),
      maePct: roundMetric(adverseMove * 100, 2),
      entryMetrics: item.entryMetrics || null,
      qualityBreakdown: item.qualityBreakdown || null,
      relativeStrengthSnapshot: item.relativeStrengthSnapshot || null,
      volumeLiquidityConfirmation: item.volumeLiquidityConfirmation || null,
      rejectReasonCode: item.rejectReasonCode || null,
      volumeRatio: item.volumeRatio || null,
      closedAt: Date.now()
    });

    await store.setJSON(AUTOPSY_STORE_KEY, autopsies.slice(-200));
    console.log(`[AUTOPSY] ${item.symbol}: ${item.outcome} | Score=${item.score} | Regime=${item.regime}`);
  } catch (error) {
    console.error('[AUTOPSY] Error recording:', error.message);
  }
}

async function updateSignalHistory(tickers, context, pLog = console.log) {
  if (!Array.isArray(tickers) || tickers.length === 0) return { stats: { open: 0, wins: 0, losses: 0, bes: 0, staleExits: 0, winRate: 0 }, openSymbols: [] };

  try {
    const store = getInternalStore(context);
    const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];
    if (!history.length) return { stats: { open: 0, wins: 0, losses: 0, bes: 0, staleExits: 0, winRate: 0 }, openSymbols: [] };

    const prices = new Map(tickers.map(t => [t.symbol, Number(t.lastPrice)]));
    let updated = false;

    for (const item of history) {
      if (item.status !== 'OPEN') continue;

      const currentPrice = prices.get(item.symbol);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

      const entryPrice = item.price || item.entry;
      if (!Number.isFinite(item.maxFavorable)) item.maxFavorable = entryPrice;
      if (!Number.isFinite(item.maxAdverse)) item.maxAdverse = entryPrice;

      if (item.type === 'BUY') {
        if (currentPrice > item.maxFavorable) item.maxFavorable = currentPrice;
        if (currentPrice < item.maxAdverse) item.maxAdverse = currentPrice;

        if (currentPrice >= item.tp) {
          item.status = 'CLOSED';
          item.outcome = 'WIN';
          updated = true;
          await recordTradeAutopsy(item, context);
        } else if (currentPrice <= item.sl) {
          item.status = 'CLOSED';
          item.outcome = 'LOSS';
          updated = true;
          await recordTradeAutopsy(item, context);
        }
      } else {
        if (currentPrice < item.maxFavorable) item.maxFavorable = currentPrice;
        if (currentPrice > item.maxAdverse) item.maxAdverse = currentPrice;

        if (currentPrice <= item.tp) {
          item.status = 'CLOSED';
          item.outcome = 'WIN';
          updated = true;
          await recordTradeAutopsy(item, context);
        } else if (currentPrice >= item.sl) {
          item.status = 'CLOSED';
          item.outcome = 'LOSS';
          updated = true;
          await recordTradeAutopsy(item, context);
        }
      }

      const staleExitHours = Number.isFinite(item.expectedHoldingHours) ? item.expectedHoldingHours : 12;
      const hoursOpen = (Date.now() - item.time) / 3600000;
      const favorableMove = item.type === 'BUY'
        ? ((item.maxFavorable || entryPrice) - entryPrice) / entryPrice
        : (entryPrice - (item.maxFavorable || entryPrice)) / entryPrice;

      if (item.status === 'OPEN' && hoursOpen > staleExitHours && favorableMove < 0.003) {
        item.status = 'CLOSED';
        item.outcome = 'STALE_EXIT';
        updated = true;
        await recordTradeAutopsy(item, context);
        pLog(`[STALE_EXIT] ${item.symbol}: ${hoursOpen.toFixed(1)}h open, favorable move ${(favorableMove * 100).toFixed(2)}%`);
      } else if (item.status === 'OPEN' && Date.now() - item.time > 48 * 3600 * 1000) {
        item.status = 'EXPIRED';
        updated = true;
      }
    }

    if (updated) await store.setJSON(HISTORY_STORE_KEY, history);

    const closed = history.filter(item => item.status === 'CLOSED');
    const wins = closed.filter(item => item.outcome === 'WIN').length;
    const losses = closed.filter(item => item.outcome === 'LOSS' || item.outcome === 'STALE_EXIT').length;
    const bes = closed.filter(item => item.outcome === 'BREAK_EVEN').length;
    const staleExits = closed.filter(item => item.outcome === 'STALE_EXIT').length;
    const totalDecisive = wins + losses;
    const winRate = totalDecisive > 0 ? (wins / totalDecisive * 100).toFixed(1) : 0;
    const openSignals = history.filter(item => item.status === 'OPEN');

    return {
      stats: {
        open: openSignals.length,
        wins,
        losses,
        bes,
        staleExits,
        winRate
      },
      openSymbols: openSignals.map(item => item.symbol)
    };
  } catch (error) {
    console.error('Error updating history:', error.message);
    return { stats: { open: 0, wins: 0, losses: 0, bes: 0, staleExits: 0, winRate: 0 }, openSymbols: [] };
  }
}

export async function loadShadowTrades(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(SHADOW_STORE_KEY, { type: 'json' });
    if (!Array.isArray(data)) return [];

    const now = Date.now();
    return data.filter(item => now - item.timestamp < 48 * 3600 * 1000);
  } catch (error) {
    console.error('[SHADOW] Error loading:', error.message);
    return [];
  }
}

export async function loadShadowTradeArchive(context) {
  try {
    const store = getInternalStore(context);
    return await store.get(SHADOW_ARCHIVE_STORE_KEY, { type: 'json' }) || [];
  } catch (error) {
    console.error('[SHADOW_ARCHIVE] Error loading:', error.message);
    return [];
  }
}

async function saveShadowTrades(shadows, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(SHADOW_STORE_KEY, shadows.slice(-100));
  } catch (error) {
    console.error('[SHADOW] Error saving:', error.message);
  }
}

async function saveShadowTradeArchive(shadows, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(SHADOW_ARCHIVE_STORE_KEY, shadows);
  } catch (error) {
    console.error('[SHADOW_ARCHIVE] Error saving:', error.message);
  }
}

async function archiveResolvedShadowTrades(shadows, context, pLog = console.log) {
  const settled = shadows.filter(item => item.outcome !== 'PENDING');
  if (!settled.length) return shadows;

  const archive = await loadShadowTradeArchive(context);
  const archiveIds = new Set(archive.map(item => item.id));
  const archivedAt = Date.now();
  const newEntries = [];

  for (const shadow of settled) {
    if (!shadow.archivedAt) shadow.archivedAt = archivedAt;
    if (!archiveIds.has(shadow.id)) {
      archiveIds.add(shadow.id);
      newEntries.push({ ...shadow });
    }
  }

  if (newEntries.length) {
    await saveShadowTradeArchive([...archive, ...newEntries], context);
    pLog(`[SHADOW_ARCHIVE] Archived ${newEntries.length} resolved near-misses`);
  }

  return shadows.filter(item => item.outcome === 'PENDING');
}

function recordShadowNearMiss(symbol, score, price, regime, rejectReasonCode, btcContext, entryMetrics, qualityBreakdown, meta = {}) {
  const now = Date.now();
  const benchmarkTpPct = meta.shadowBenchmarkTpPct ?? SHADOW_BENCHMARK_TP_PCT;
  const benchmarkSlPct = meta.shadowBenchmarkSlPct ?? SHADOW_BENCHMARK_SL_PCT;

  return {
    id: `shadow-${now}-${symbol}`,
    symbol,
    score,
    scoreBeforeMomentum: meta.scoreBeforeMomentum ?? score,
    momentumAdjustment: meta.momentumAdjustment || 0,
    requiredScore: meta.requiredScore ?? null,
    requiredStrongCategories: meta.requiredStrongCategories ?? null,
    scoreGap: meta.requiredScore !== undefined && meta.requiredScore !== null
      ? Number((meta.requiredScore - score).toFixed(2))
      : null,
    price,
    regime,
    atrPercent: entryMetrics?.atrPercent || null,
    rejectReasonCode,
    rejectReason: rejectReasonCode,
    btcRisk: btcContext?.status || 'UNKNOWN',
    sector: meta.sector || getSector(symbol),
    module: meta.module || null,
    entryArchetype: meta.entryArchetype || null,
    liquidityTier: meta.liquidityTier || null,
    blockedBySector: meta.blockedBySector || null,
    blockedBySymbol: meta.blockedBySymbol || null,
    expectedHoldingHours: meta.expectedHoldingHours || null,
    riskModel: meta.riskModel || null,
    relativeStrengthSnapshot: meta.relativeStrengthSnapshot || null,
    volumeLiquidityConfirmation: meta.volumeLiquidityConfirmation || null,
    timestamp: now,
    entryMetrics: entryMetrics || null,
    qualityBreakdown: qualityBreakdown || null,
    shadowBenchmark: {
      version: meta.shadowBenchmarkVersion || SHADOW_BENCHMARK_VERSION,
      tpPct: benchmarkTpPct,
      slPct: benchmarkSlPct
    },
    maxFavorableMovePct: null,
    maxAdverseMovePct: null,
    outcome: 'PENDING',
    resolvedAt: null,
    archivedAt: null
  };
}

async function updateShadowTrades(tickers, context, pLog = console.log) {
  try {
    let shadows = await loadShadowTrades(context);
    if (!shadows.length) return { total: 0, wouldWin: 0, wouldLose: 0 };

    if (shadows.some(item => item.outcome !== 'PENDING')) {
      shadows = await archiveResolvedShadowTrades(shadows, context, pLog);
      await saveShadowTrades(shadows, context);
    }

    const pendingShadows = shadows.filter(item => item.outcome === 'PENDING');
    if (!pendingShadows.length) return { total: 0, wouldWin: 0, wouldLose: 0 };

    const symbols = [...new Set(pendingShadows.map(item => item.symbol))];
    let updated = false;

    for (const symbol of symbols) {
      try {
        const symbolShadows = pendingShadows.filter(item => item.symbol === symbol);
        const candles = await getKlines(symbol, '15m', 200).catch(() => null);
        if (!candles) continue;

        for (const shadow of symbolShadows) {
          const entryTime = shadow.timestamp;
          const entryPrice = shadow.price;
          const tpLevel = entryPrice * (1 + (shadow.shadowBenchmark?.tpPct || SHADOW_BENCHMARK_TP_PCT));
          const slLevel = entryPrice * (1 - (shadow.shadowBenchmark?.slPct || SHADOW_BENCHMARK_SL_PCT));
          const futureCandles = candles.filter(candle => candle.time > entryTime);

          let maxHigh = entryPrice;
          let minLow = entryPrice;

          for (const candle of futureCandles) {
            if (candle.high > maxHigh) maxHigh = candle.high;
            if (candle.low < minLow) minLow = candle.low;

            const hitTP = candle.high >= tpLevel;
            const hitSL = candle.low <= slLevel;

            shadow.maxFavorableMovePct = roundMetric(((maxHigh - entryPrice) / entryPrice) * 100, 2);
            shadow.maxAdverseMovePct = roundMetric(((entryPrice - minLow) / entryPrice) * 100, 2);

            if (hitTP && hitSL) {
              shadow.outcome = candle.close >= candle.open ? 'WOULD_WIN' : 'WOULD_LOSE';
              shadow.resolvedAt = Date.now();
              updated = true;
              break;
            }
            if (hitTP) {
              shadow.outcome = 'WOULD_WIN';
              shadow.resolvedAt = Date.now();
              updated = true;
              break;
            }
            if (hitSL) {
              shadow.outcome = 'WOULD_LOSE';
              shadow.resolvedAt = Date.now();
              updated = true;
              break;
            }
          }

          if (shadow.outcome === 'PENDING' && Date.now() - shadow.timestamp > 48 * 3600 * 1000) {
            shadow.outcome = 'EXPIRED';
            shadow.resolvedAt = Date.now();
            updated = true;
          }
        }
      } catch (error) {
        console.error(`[SHADOW] Error resolving ${symbol}:`, error.message);
      }
    }

    if (updated) {
      const resolvedBeforeCleanup = shadows.filter(item => item.outcome !== 'PENDING' && item.outcome !== 'EXPIRED');
      const wouldWin = resolvedBeforeCleanup.filter(item => item.outcome === 'WOULD_WIN').length;
      const wouldLose = resolvedBeforeCleanup.filter(item => item.outcome === 'WOULD_LOSE').length;
      shadows = await archiveResolvedShadowTrades(shadows, context, pLog);
      await saveShadowTrades(shadows, context);
      return { total: resolvedBeforeCleanup.length, wouldWin, wouldLose };
    }

    const resolved = shadows.filter(item => item.outcome !== 'PENDING' && item.outcome !== 'EXPIRED');
    return {
      total: resolved.length,
      wouldWin: resolved.filter(item => item.outcome === 'WOULD_WIN').length,
      wouldLose: resolved.filter(item => item.outcome === 'WOULD_LOSE').length
    };
  } catch (error) {
    console.error('[SHADOW] Error updating:', error.message);
    return { total: 0, wouldWin: 0, wouldLose: 0 };
  }
}

async function loadSignalMemory(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(MEMORY_STORE_KEY, { type: 'json' });
    if (!data || typeof data !== 'object') return {};

    const now = Date.now();
    const fresh = {};
    for (const [symbol, entries] of Object.entries(data)) {
      const validEntries = Array.isArray(entries) ? entries.filter(item => now - item.timestamp < 2 * 3600 * 1000) : [];
      if (validEntries.length) fresh[symbol] = validEntries;
    }
    return fresh;
  } catch (error) {
    console.error('[MEMORY] Error loading:', error.message);
    return {};
  }
}

async function saveSignalMemory(memory, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(MEMORY_STORE_KEY, memory);
  } catch (error) {
    console.error('[MEMORY] Error saving:', error.message);
  }
}

function recordSymbolScore(memory, symbol, score, regime) {
  if (!memory[symbol]) memory[symbol] = [];
  memory[symbol].push({ score, regime, timestamp: Date.now() });
  if (memory[symbol].length > 8) memory[symbol] = memory[symbol].slice(-8);
}

export async function loadPersistentLogs(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(PERSISTENT_LOG_STORE_KEY, { type: 'json' });
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[PLOG] Error loading:', error.message);
    return [];
  }
}

async function savePersistentLogs(logs, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(PERSISTENT_LOG_STORE_KEY, logs.slice(-4000));
  } catch (error) {
    console.error('[PLOG] Error saving:', error.message);
  }
}

async function appendPersistentLogEntries(messages, context, date = new Date()) {
  try {
    const existingLogs = await loadPersistentLogs(context);
    const nextLogs = messages.map(message => formatPersistentLogEntry(message, date));
    await savePersistentLogs([...existingLogs, ...nextLogs], context);
  } catch (error) {
    console.error('[PLOG] Error appending:', error.message);
  }
}

async function getKlines(symbol, interval = '15m', limit = 200) {
  const cacheKey = `${symbol}-${interval}-${limit}`;
  const cached = getCachedCandles(cacheKey);
  if (cached) return cached;

  const url = `${MEXC_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'No body');
    throw new Error(`MEXC HTTP error: ${response.status} - ${errorBody}`);
  }

  const json = await response.json();
  if (!Array.isArray(json)) throw new Error(`MEXC: Invalid klines response for ${symbol}`);

  const intervalMs = intervalToMs(interval);
  const candles = json.map(candle => {
    const openTime = Number(candle[0]);
    const closeTimeRaw = candle[6] ? Number(candle[6]) : null;
    const closeTime = Number.isFinite(closeTimeRaw) && Number.isFinite(intervalMs)
      ? closeTimeRaw
      : (Number.isFinite(openTime) && Number.isFinite(intervalMs) ? openTime + intervalMs : null);

    return {
      time: openTime,
      open: Number(candle[1]),
      high: Number(candle[2]),
      low: Number(candle[3]),
      close: Number(candle[4]),
      volume: Number(candle[5]),
      closeTime,
      quoteVolume: Number(candle[7]),
      trades: candle[8] ? Number(candle[8]) : 0,
      takerBuyBaseVolume: candle[9] ? Number(candle[9]) : null,
      takerBuyQuoteVolume: candle[10] ? Number(candle[10]) : null
    };
  }).filter(validateCandle);

  setCachedCandles(cacheKey, candles);
  return candles;
}

function validateCandle(candle) {
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

async function getOrderBookDepth(symbol, limit = 20) {
  const url = `${MEXC_API}/depth?symbol=${symbol}&limit=${limit}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) return null;

  const json = await response.json();
  if (!json || !Array.isArray(json.bids) || !Array.isArray(json.asks)) return null;

  return {
    bids: json.bids.map(([p, q]) => [Number(p), Number(q)]),
    asks: json.asks.map(([p, q]) => [Number(p), Number(q)])
  };
}

async function getAllTickers24h() {
  const url = `${MEXC_API}/ticker/24hr`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'No body');
    throw new Error(`MEXC HTTP error: ${response.status} - ${errorBody}`);
  }
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error('MEXC: Invalid ticker/24hr response');
  return json;
}

function getTopSymbolsByOpportunity(tickers, quoteAsset, limit, minQuoteVolume) {
  const btcTicker = tickers.find(ticker => ticker.symbol === `BTC${quoteAsset}`);
  const btcChange = btcTicker ? Number(btcTicker.priceChangePercent || 0) : 0;

  const scored = tickers
    .filter(ticker => typeof ticker.symbol === 'string' && ticker.symbol.endsWith(quoteAsset))
    .map(ticker => {
      const base = normalizeBaseAsset(ticker.symbol);
      const quoteVolume = Number(ticker.quoteVolume || 0);
      if (!base || !Number.isFinite(quoteVolume)) return null;
      if (quoteVolume < minQuoteVolume) return null;
      if (isNonCryptoWrapper(base)) return null;

      const high = Number(ticker.highPrice || 0);
      const low = Number(ticker.lowPrice || 0);
      const priceChange = Number(ticker.priceChangePercent || 0);
      const volatility = low > 0 ? ((high - low) / low) * 100 : 0;
      const rs24h = priceChange - btcChange;
      const liquidityScore = Math.log10(Math.max(quoteVolume, 1));
      const opportunityScore = (liquidityScore * 0.5) + (clamp(rs24h, -15, 15) * 0.3) + (clamp(volatility, 0, 25) * 0.2);

      return {
        symbol: ticker.symbol,
        base,
        quoteVolume,
        opportunityScore,
        rs24h
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.opportunityScore !== a.opportunityScore) return b.opportunityScore - a.opportunityScore;
      return b.quoteVolume - a.quoteVolume;
    });

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

  console.log(`Universe selection ${ALGORITHM_VERSION}: ${merged.length} eligible symbols before cap`);
  return merged.slice(0, limit);
}

function calculateRSISeries(closes, period = 14) {
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
  series[period] = avgLoss === 0 ? 100 : (100 - (100 / (1 + (avgGain / avgLoss))));

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    series[i] = avgLoss === 0 ? 100 : (100 - (100 / (1 + (avgGain / avgLoss))));
  }

  return series;
}

function calculateRSI(closes, period = 14) {
  const series = calculateRSISeries(closes, period);
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i])) return series[i];
  }
  return null;
}

function calculateEMA(data, period) {
  if (!Array.isArray(data) || data.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateEMASeries(data, period) {
  if (!Array.isArray(data) || data.length < period) return null;
  const multiplier = 2 / (period + 1);
  const series = new Array(data.length).fill(null);
  let ema = data.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  series[period - 1] = ema;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
    series[i] = ema;
  }

  return series;
}

function calculateSlope(closes, period = 21, lookback = 6) {
  const emaSeries = calculateEMASeries(closes, period);
  if (!emaSeries) return 0;
  const valid = emaSeries.filter(value => Number.isFinite(value));
  if (valid.length < lookback) return 0;

  const recent = valid.slice(-lookback);
  const start = recent[0];
  const end = recent[recent.length - 1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === 0) return 0;
  return (end - start) / start;
}

function calculateATRSeries(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;

  const atrSeries = new Array(candles.length).fill(null);
  let trSum = 0;

  for (let i = 1; i <= period; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );
    trSum += tr;
  }

  let atr = trSum / period;
  atrSeries[period] = atr;

  for (let i = period + 1; i < candles.length; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );
    atr = ((atr * (period - 1)) + tr) / period;
    atrSeries[i] = atr;
  }

  return atrSeries;
}

function calculateATR(candles, period = 14) {
  const series = calculateATRSeries(candles, period);
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i])) return series[i];
  }
  return null;
}

function calculateVolumeSMA(candles, period = 20) {
  if (!Array.isArray(candles) || candles.length < period) return null;
  const volumes = candles.slice(-period).map(candle => candle.volume);
  return volumes.reduce((sum, value) => sum + value, 0) / period;
}

function calculateVWAP(candles, lookback = 50) {
  if (!Array.isArray(candles) || candles.length < Math.min(lookback, 5)) return null;
  const slice = candles.slice(-lookback);
  let pv = 0;
  let volume = 0;

  for (const candle of slice) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    pv += typicalPrice * candle.volume;
    volume += candle.volume;
  }

  return volume > 0 ? pv / volume : null;
}

function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((sum, value) => sum + value, 0) / period;
  const variance = slice.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / period;
  const sd = Math.sqrt(variance);

  return {
    upper: mean + stdDev * sd,
    middle: mean,
    lower: mean - stdDev * sd
  };
}

function calculateADX(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < (period * 2 + 1)) return null;

  let trSum = 0;
  let plusDMSum = 0;
  let minusDMSum = 0;

  for (let i = 1; i <= period; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const upMove = current.high - prev.high;
    const downMove = prev.low - current.low;
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );

    trSum += tr;
    plusDMSum += plusDM;
    minusDMSum += minusDM;
  }

  let atr = trSum;
  let plusDM = plusDMSum;
  let minusDM = minusDMSum;
  const dxSeries = new Array(candles.length).fill(null);

  for (let i = period; i < candles.length; i++) {
    if (i > period) {
      const current = candles[i];
      const prev = candles[i - 1];
      const upMove = current.high - prev.high;
      const downMove = prev.low - current.low;
      const plusDMValue = upMove > downMove && upMove > 0 ? upMove : 0;
      const minusDMValue = downMove > upMove && downMove > 0 ? downMove : 0;
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prev.close),
        Math.abs(current.low - prev.close)
      );

      atr = atr - (atr / period) + tr;
      plusDM = plusDM - (plusDM / period) + plusDMValue;
      minusDM = minusDM - (minusDM / period) + minusDMValue;
    }

    if (!Number.isFinite(atr) || atr <= 0) continue;
    const plusDI = (plusDM / atr) * 100;
    const minusDI = (minusDM / atr) * 100;
    const denom = plusDI + minusDI;
    if (!Number.isFinite(denom) || denom === 0) continue;
    dxSeries[i] = (Math.abs(plusDI - minusDI) / denom) * 100;
  }

  const firstADXIndex = period * 2;
  let adx = 0;
  for (let i = period; i < firstADXIndex; i++) {
    if (!Number.isFinite(dxSeries[i])) return null;
    adx += dxSeries[i];
  }
  adx /= period;

  for (let i = firstADXIndex; i < candles.length; i++) {
    if (!Number.isFinite(dxSeries[i])) continue;
    adx = ((adx * (period - 1)) + dxSeries[i]) / period;
  }

  if (!Number.isFinite(adx) || atr <= 0) return null;
  const plusDI = (plusDM / atr) * 100;
  const minusDI = (minusDM / atr) * 100;
  if (!Number.isFinite(plusDI) || !Number.isFinite(minusDI)) return null;

  return {
    adx,
    plusDI,
    minusDI,
    bullishTrend: plusDI > minusDI,
    bearishTrend: minusDI > plusDI
  };
}

function calculateVolatilityPercentile(candles, atrPeriod = 14) {
  const atrSeries = calculateATRSeries(candles, atrPeriod);
  if (!atrSeries || atrSeries.length < 50) return 50;

  const currentATR = atrSeries[atrSeries.length - 1];
  const sample = atrSeries.slice(-50).filter(value => Number.isFinite(value));
  if (!sample.length || !Number.isFinite(currentATR)) return 50;

  const sorted = [...sample].sort((a, b) => a - b);
  const rank = sorted.findIndex(value => value >= currentATR);
  if (rank === -1) return 100;
  return (rank / sorted.length) * 100;
}

function calculateRelativeStrength(symbolCloses, benchmarkCloses, lookback = 12) {
  if (!Array.isArray(symbolCloses) || !Array.isArray(benchmarkCloses)) return 0;
  if (symbolCloses.length < lookback || benchmarkCloses.length < lookback) return 0;

  const symbolStart = symbolCloses[symbolCloses.length - lookback];
  const symbolEnd = symbolCloses[symbolCloses.length - 1];
  const benchmarkStart = benchmarkCloses[benchmarkCloses.length - lookback];
  const benchmarkEnd = benchmarkCloses[benchmarkCloses.length - 1];
  if ([symbolStart, symbolEnd, benchmarkStart, benchmarkEnd].some(value => !Number.isFinite(value) || value <= 0)) return 0;

  const symbolReturn = (symbolEnd - symbolStart) / symbolStart;
  const benchmarkReturn = (benchmarkEnd - benchmarkStart) / benchmarkStart;
  return symbolReturn - benchmarkReturn;
}

function getRecentRangeLevels(candles, lookback = 20) {
  if (!Array.isArray(candles) || candles.length < lookback + 1) return null;
  const slice = candles.slice(-(lookback + 1), -1);
  const highs = slice.map(candle => candle.high);
  const lows = slice.map(candle => candle.low);
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= 0 || low <= 0) return null;

  return {
    high,
    low,
    widthPct: ((high - low) / low) * 100
  };
}

export function calculateOrderBookMetrics(orderBook) {
  if (!orderBook || !Array.isArray(orderBook.bids) || !Array.isArray(orderBook.asks) || !orderBook.bids.length || !orderBook.asks.length) return null;

  const [bestBidPrice] = orderBook.bids[0];
  const [bestAskPrice] = orderBook.asks[0];
  if (!Number.isFinite(bestBidPrice) || !Number.isFinite(bestAskPrice) || bestBidPrice <= 0 || bestAskPrice <= 0) return null;

  const mid = (bestAskPrice + bestBidPrice) / 2;
  const spreadBps = ((bestAskPrice - bestBidPrice) / mid) * 10000;
  // Use the full fetched snapshot so majors are not misclassified by a truncated top-of-book view.
  const topBids = orderBook.bids.slice(0, 20);
  const topAsks = orderBook.asks.slice(0, 20);
  const bidNotional = topBids.reduce((sum, [price, quantity]) => sum + (price * quantity), 0);
  const askNotional = topAsks.reduce((sum, [price, quantity]) => sum + (price * quantity), 0);
  const totalNotional = bidNotional + askNotional;
  const obi = totalNotional > 0 ? (bidNotional - askNotional) / totalNotional : 0;

  return {
    spreadBps,
    depthQuoteTopN: totalNotional,
    obi
  };
}

export function classifyLiquidityTier(quoteVol24h, depthQuoteTopN, spreadBps) {
  if (quoteVol24h >= 50000000 && depthQuoteTopN >= 250000 && spreadBps <= 3) return 'ELITE';
  if (quoteVol24h >= 20000000 && depthQuoteTopN >= 150000 && spreadBps <= 5) return 'HIGH';
  if (quoteVol24h >= 8000000 && depthQuoteTopN >= 90000 && spreadBps <= MAX_SPREAD_BPS) return 'MEDIUM';
  return 'LOW';
}

export function getExecutionRejectCode(obMetrics, liquidityTier) {
  if (!obMetrics) return 'ORDERBOOK_UNAVAILABLE';
  if (obMetrics.spreadBps > MAX_SPREAD_BPS) return 'EXEC_SPREAD';
  if (obMetrics.depthQuoteTopN < MIN_DEPTH_QUOTE) return 'EXEC_DEPTH';
  if (liquidityTier === 'LOW') return 'LIQUIDITY_TIER_LOW';
  return null;
}

function buildExecutionQuality(liquidityTier, spreadBps, depthQuoteTopN) {
  let base = 60;
  if (liquidityTier === 'ELITE') base = 95;
  else if (liquidityTier === 'HIGH') base = 82;
  else if (liquidityTier === 'MEDIUM') base = 68;

  if (spreadBps <= 2) base += 3;
  else if (spreadBps >= 7) base -= 5;

  if (depthQuoteTopN >= 250000) base += 3;
  else if (depthQuoteTopN <= 100000) base -= 3;

  return clamp(base, 0, 100);
}

function detectBTCContext(candles4h, candles1h, ticker24h) {
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

  if (!Number.isFinite(price4h) || !Number.isFinite(ema21_4h) || !Number.isFinite(ema50_4h) || !Number.isFinite(rsi4h) || !Number.isFinite(rsi1h)) {
    return {
      status: 'GREEN',
      reason: 'BTC context fallback',
      closes4h,
      closes1h,
      priceChange24h
    };
  }

  if (price4h < ema50_4h || ema21_4h < ema50_4h || rsi4h < 44) {
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

  if ((Number.isFinite(price1h) && Number.isFinite(ema21_1h) && price1h > ema21_1h * 1.018) || rsi1h > 68) {
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

function detectMarketRegime({ bull4h, atrPercentile, btcRisk }) {
  if (btcRisk === 'RED') return 'RISK_OFF';
  if (bull4h && atrPercentile >= 70) return 'HIGH_VOL_BREAKOUT';
  if (bull4h) return 'TRENDING';
  return 'TRANSITION';
}

function calculateBBWidthHistory(closes, period = 20, stdDev = 2) {
  if (!Array.isArray(closes) || closes.length < period * 2) return null;
  const widths = [];
  for(let i = closes.length - 100; i <= closes.length - 1; i++) {
     if(i < period) continue;
     const slice = closes.slice(i - period + 1, i + 1);
     const mean = slice.reduce((sum, value) => sum + value, 0) / period;
     const variance = slice.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / period;
     const sd = Math.sqrt(variance);
     widths.push((2 * stdDev * sd) / mean);
  }
  return widths;
}

function evaluateVWAPPullbackModule(ctx) {
  const { symbol, currentPrice, ema50_4h, ema21_4h, vwap15m, volumeRatio, obMetrics, liquidityTier, rs4h, rs1h, atrPercent15m, bull4h, btcRisk, regime, rsi15m } = ctx;
  
  if (!bull4h) return { rejectCode: 'VWAP_TREND_ALIGN' };
  if (!Number.isFinite(vwap15m) || currentPrice < vwap15m * 0.997) return { rejectCode: 'VWAP_BELOW' };
  // v10.1.0: Widen VWAP ceiling to 2% in confirmed TRENDING regime
  const vwapCeiling = regime === 'TRENDING' ? 1.020 : 1.015;
  if (currentPrice > vwap15m * vwapCeiling) return { rejectCode: 'VWAP_TOO_FAR' };
  if (rs4h < 0.005) return { rejectCode: 'VWAP_NO_RS' }; 
  if (volumeRatio < 1.1) return { rejectCode: 'VWAP_LOW_VOL' };
  if (!obMetrics || obMetrics.obi < -0.05) return { rejectCode: 'VWAP_NEG_OBI' };
  
  // v10.2.0: Prevent falling knifes with 0% MFE by requiring short-term bounce/support
  if (rsi15m < 45) return { rejectCode: 'VWAP_FALLING_KNIFE' };
  if (rs1h < 0) return { rejectCode: 'VWAP_WEAK_MOMENTUM' };

  const trendQuality = clamp(50 + (rs4h * 1500) + (rs1h * 1000), 50, 100);
  const participationQuality = clamp(40 + (volumeRatio * 20), 40, 100);
  const executionQuality = buildExecutionQuality(liquidityTier, obMetrics.spreadBps, obMetrics.depthQuoteTopN);
  
  const score = Math.round(trendQuality * 0.4 + participationQuality * 0.4 + executionQuality * 0.2);
  
  const reasons = ['Institutional VWAP Pullback'];
  if (rs4h > 0.02) reasons.push(`Extreme Relative Strength vs BTC (+${(rs4h*100).toFixed(1)}%)`);
  if (volumeRatio > 1.4) reasons.push(`Strong Volume Confirmation (${volumeRatio.toFixed(1)}x)`);

  return {
    candidate: {
      module: 'VWAP_PULLBACK',
      entryArchetype: 'Institutional VWAP Reclaim',
      score,
      baseRequiredScore: Math.max(SIGNAL_SCORE_THRESHOLD, 68),
      qualityBreakdown: {
        trend: roundMetric(trendQuality, 1),
        expansion: 0,
        participation: roundMetric(participationQuality, 1),
        execution: roundMetric(executionQuality, 1)
      },
      reasons,
      minVolumeRatio: 1.1
    }
  };
}

function evaluateVCPBreakoutModule(ctx) {
  const { closes15m, bbPercent, currentPrice, volumeRatio, obMetrics, liquidityTier, rs1h, rs4h, btcRisk, bb15m, regime } = ctx;
  
  const bbWidths = calculateBBWidthHistory(closes15m, 20, 2);
  const currentWidth = bbWidths ? bbWidths[bbWidths.length - 1] : 1;
  const rank = bbWidths ? bbWidths.filter(w => w <= currentWidth).length / bbWidths.length : 1;
  
  if (rank > 0.15) return { rejectCode: 'VCP_NOT_TIGHT' }; 
  if (bbPercent < 0.90) return { rejectCode: 'VCP_NO_BREAKOUT' }; 
  if (volumeRatio < 2.3) return { rejectCode: 'VCP_LOW_VOL' }; 
  if (!obMetrics || obMetrics.obi < 0.05) return { rejectCode: 'VCP_NO_BID_SUPPORT' };
  if (btcRisk === 'RED' || btcRisk === 'AMBER') return { rejectCode: 'VCP_BTC_RESISTANCE' };
  // v10.2.0: Structural fakeout protection - ensure asset is outperforming BTC on 1H
  if (rs1h < 0) return { rejectCode: 'VCP_WEAK_MOMENTUM' };
  
  const trendQuality = clamp(50 + (rs1h * 1500), 50, 100);
  const expansionQuality = clamp(100 - (rank * 100), 50, 100); 
  const participationQuality = clamp(50 + ((volumeRatio - 2.0) * 15), 50, 100);
  const executionQuality = buildExecutionQuality(liquidityTier, obMetrics.spreadBps, obMetrics.depthQuoteTopN);
  
  const score = Math.round(trendQuality * 0.2 + expansionQuality * 0.3 + participationQuality * 0.3 + executionQuality * 0.2);
  
  const reasons = ['Volatility Contraction (VCP) Breakout'];
  reasons.push(`BB Width in bottom ${(rank*100).toFixed(1)}%`);
  reasons.push(`Explosive Volume (${volumeRatio.toFixed(1)}x)`);

  return {
    candidate: {
      module: 'VCP_BREAKOUT',
      entryArchetype: 'Volatility Contraction Breakout',
      score,
      baseRequiredScore: Math.max(SIGNAL_SCORE_THRESHOLD, 68),
      qualityBreakdown: {
        trend: roundMetric(trendQuality, 1),
        expansion: roundMetric(expansionQuality, 1),
        participation: roundMetric(participationQuality, 1),
        execution: roundMetric(executionQuality, 1)
      },
      reasons,
      minVolumeRatio: 2.3
    }
  };
}

function calculateRecommendedSize(score, atrPct, regime, module, liquidityTier, relativeStrength, promotedFromLow = false) {
  let size = 0.8;
  if (module === 'VCP_BREAKOUT') size += 0.2;
  if (score >= 78) size += 0.4;
  if (score >= 84) size += 0.4;
  if (liquidityTier === 'ELITE') size += 0.7;
  else if (liquidityTier === 'HIGH') size += 0.4;
  else size += 0.1;

  if (relativeStrength > 0.015) size += 0.3;
  else if (relativeStrength > 0.008) size += 0.15;

  if (atrPct > 2.5) size *= 0.65;
  else if (atrPct > 1.5) size *= 0.8;

  if (regime === 'HIGH_VOL_BREAKOUT' || regime === 'TRANSITION') size *= 0.8;
  // v10.1.0: Half sizing for depth-floor promoted LOW-tier trades
  if (promotedFromLow) size *= 0.5;
  return clamp(size, 0.5, 3.5).toFixed(1);
}

function getRequiredScore(candidate, regime, liquidityTier, btcRisk) {
  let required = candidate.baseRequiredScore;
  if (liquidityTier === 'MEDIUM') required += 3;
  if (btcRisk === 'AMBER') required += candidate.module === 'VCP_BREAKOUT' ? 4 : 2;
  if (regime === 'TRANSITION') required += 4;
  return required;
}

function pickPreferredReject(regime, pullbackResult, breakoutResult) {
  return pullbackResult?.rejectCode || breakoutResult?.rejectCode || 'NO_MODULE_MATCH';
}

function buildCandidateShadow(symbol, candidate, ctx, requiredScore, rejectReasonCode, btcContext, shadowCollector) {
  if (!shadowCollector) return;
  if (!candidate || candidate.score < Math.max(requiredScore - 8, 60)) return;

  shadowCollector.push(recordShadowNearMiss(
    symbol,
    candidate.score,
    ctx.currentPrice,
    ctx.regime,
    rejectReasonCode,
    btcContext,
    {
      distToEma9: roundMetric(ctx.distToEma9),
      distToEma21: roundMetric(ctx.distToEma21),
      distToEma50: roundMetric(ctx.distToEma50),
      atrPercent: roundMetric(ctx.atrPercent15m),
      bbPercent: roundMetric(ctx.bbPercent),
      breakoutDistancePct: roundMetric(ctx.breakoutDistancePct, 2),
      pullbackFromHigh20Pct: roundMetric(ctx.pullbackFromHigh20Pct, 2),
      riskRewardRatio: roundMetric(candidate.riskModel.realRR),
      timeStopHours: candidate.riskModel.timeStopHours
    },
    candidate.qualityBreakdown,
    {
      scoreBeforeMomentum: candidate.score,
      requiredScore,
      requiredStrongCategories: null,
      sector: getSector(symbol),
      module: candidate.module,
      entryArchetype: candidate.entryArchetype,
      liquidityTier: ctx.liquidityTier,
      expectedHoldingHours: candidate.riskModel.timeStopHours,
      riskModel: {
        tpMultiplier: candidate.riskModel.tpMultiplier,
        slMultiplier: candidate.riskModel.slMultiplier,
        realRR: roundMetric(candidate.riskModel.realRR),
        timeStopHours: candidate.riskModel.timeStopHours
      },
      relativeStrengthSnapshot: buildRelativeStrengthSnapshot(ctx.rs1h, ctx.rs4h, ctx.rs24h),
      volumeLiquidityConfirmation: buildVolumeLiquidityConfirmation(
        ctx.volumeRatio,
        ctx.deltaRatio,
        ctx.obMetrics,
        ctx.liquidityTier,
        candidate.minVolumeRatio
      ),
      shadowBenchmarkTpPct: candidate.riskModel.tpPct,
      shadowBenchmarkSlPct: candidate.riskModel.slPct,
      shadowBenchmarkVersion: `${ALGORITHM_VERSION}-${candidate.module}`
    }
  ));
}

function createSignalFromCandidate(symbol, candidate, ctx, btcContext, requiredScore, promotedFromLow = false) {
  const relativeStrengthSnapshot = buildRelativeStrengthSnapshot(ctx.rs1h, ctx.rs4h, ctx.rs24h);
  const volumeLiquidityConfirmation = buildVolumeLiquidityConfirmation(
    ctx.volumeRatio,
    ctx.deltaRatio,
    ctx.obMetrics,
    ctx.liquidityTier,
    candidate.minVolumeRatio
  );

  return {
    symbol,
    price: ctx.currentPrice,
    score: Math.round(clamp(candidate.score, 0, 100)),
    regime: ctx.regime,
    type: 'BUY',
    rsi: ctx.rsi15m.toFixed(1),
    rsi1h: ctx.rsi1h.toFixed(1),
    bbPosition: Math.round(ctx.bbPercent * 100),
    volumeRatio: roundMetric(ctx.volumeRatio),
    volumeConfirmed: volumeLiquidityConfirmation.volumePass,
    spreadBps: roundMetric(ctx.obMetrics.spreadBps, 1),
    depthQuoteTopN: Math.round(ctx.obMetrics.depthQuoteTopN),
    obi: roundMetric(ctx.obMetrics.obi, 3),
    deltaRatio: ctx.deltaRatio === null ? null : roundMetric(ctx.deltaRatio, 3),
    atrPercent: roundMetric(ctx.atrPercent15m),
    vwap: ctx.vwap15m,
    vwapDistance: ctx.vwap15m ? roundMetric(((ctx.currentPrice - ctx.vwap15m) / ctx.vwap15m) * 100) : null,
    tp: ctx.currentPrice * (1 + candidate.riskModel.tpPct),
    sl: ctx.currentPrice * (1 - candidate.riskModel.slPct),
    entryMetrics: {
      distToEma9: roundMetric(ctx.distToEma9),
      distToEma21: roundMetric(ctx.distToEma21),
      distToEma50: roundMetric(ctx.distToEma50),
      atrPercent: roundMetric(ctx.atrPercent15m),
      bbPercent: roundMetric(ctx.bbPercent),
      breakoutDistancePct: roundMetric(ctx.breakoutDistancePct, 2),
      pullbackFromHigh20Pct: roundMetric(ctx.pullbackFromHigh20Pct, 2),
      riskRewardRatio: roundMetric(candidate.riskModel.realRR),
      timeStopHours: candidate.riskModel.timeStopHours
    },
    qualityBreakdown: candidate.qualityBreakdown,
    scoreBeforeMomentum: candidate.score,
    momentumAdjustment: 0,
    requiredScore,
    requiredStrongCategories: null,
    reasons: candidate.reasons,
    mode: candidate.score >= requiredScore + 8 ? 'PRIORITY' : 'STANDARD',
    recommendedSize: calculateRecommendedSize(
      candidate.score,
      ctx.atrPercent15m,
      ctx.regime,
      candidate.module,
      ctx.liquidityTier,
      Math.max(ctx.rs1h, ctx.rs4h),
      promotedFromLow
    ),
    btcContext,
    module: candidate.module,
    entryArchetype: candidate.entryArchetype,
    liquidityTier: ctx.liquidityTier,
    promotedFromLow,
    expectedHoldingHours: candidate.riskModel.timeStopHours,
    riskModel: {
      tpMultiplier: candidate.riskModel.tpMultiplier,
      slMultiplier: candidate.riskModel.slMultiplier,
      realRR: roundMetric(candidate.riskModel.realRR),
      timeStopHours: candidate.riskModel.timeStopHours
    },
    relativeStrengthSnapshot,
    volumeLiquidityConfirmation,
    rejectReasonCode: null
  };
}

function generateSignal(symbol, candles15m, candles1h, candles4h, orderBook, ticker24h, btcContext, analysisState = null, shadowCollector = null) {
  const baseAsset = normalizeBaseAsset(symbol);
  if (isNonCryptoWrapper(baseAsset)) {
    countMetric(analysisState?.rejectCounts, 'UNIVERSE_NON_CRYPTO');
    return null;
  }

  if (!Array.isArray(candles15m) || candles15m.length < 201) {
    countMetric(analysisState?.rejectCounts, 'DATA_15M_SHORT');
    return null;
  }

  const closedCandles15m = getClosedCandles(candles15m, '15m');
  const closedCandles1h = getClosedCandles(candles1h, '60m');
  const closedCandles4h = getClosedCandles(candles4h, '4h');
  if (closedCandles15m.length < 200 || closedCandles1h.length < 120 || closedCandles4h.length < 60) {
    countMetric(analysisState?.rejectCounts, 'DATA_MTF_SHORT');
    return null;
  }

  const obMetrics = calculateOrderBookMetrics(orderBook);
  if (!obMetrics) {
    countMetric(analysisState?.rejectCounts, 'ORDERBOOK_UNAVAILABLE');
    return null;
  }
  countMetric(analysisState?.stageCounts, 'ORDERBOOK_OK');

  const quoteVol24h = Number(ticker24h?.quoteVolume || 0);
  if (!Number.isFinite(quoteVol24h) || quoteVol24h < MIN_QUOTE_VOL_24H) {
    countMetric(analysisState?.rejectCounts, 'LIQUIDITY_FLOOR');
    return null;
  }
  countMetric(analysisState?.stageCounts, 'LIQUIDITY_BASE_OK');

  const liquidityTier = classifyLiquidityTier(quoteVol24h, obMetrics.depthQuoteTopN, obMetrics.spreadBps);

  const closes15m = closedCandles15m.map(candle => candle.close);
  const closes1h = closedCandles1h.map(candle => candle.close);
  const closes4h = closedCandles4h.map(candle => candle.close);

  const currentPrice = closes15m[closes15m.length - 1];
  const currentPrice1h = closes1h[closes1h.length - 1];
  const currentPrice4h = closes4h[closes4h.length - 1];
  const rsi15m = calculateRSI(closes15m, 14);
  const rsi1h = calculateRSI(closes1h, 14);
  const bb15m = calculateBollingerBands(closes15m, 20, 2);
  const ema9_15m = calculateEMA(closes15m, 9);
  const ema21_15m = calculateEMA(closes15m, 21);
  const ema50_15m = calculateEMA(closes15m, 50);
  const ema21_1h = calculateEMA(closes1h, 21);
  const ema50_1h = calculateEMA(closes1h, 50);
  const ema21_4h = calculateEMA(closes4h, 21);
  const ema50_4h = calculateEMA(closes4h, 50);
  const adx15m = calculateADX(closedCandles15m, 14);
  const atr15m = calculateATR(closedCandles15m, 14);
  const atrPercent15m = atr15m && currentPrice > 0 ? (atr15m / currentPrice) * 100 : null;
  const atrPercentile = calculateVolatilityPercentile(closedCandles15m, 14);
  const vwap15m = calculateVWAP(closedCandles15m, 50);
  const volumeSMA15m = calculateVolumeSMA(closedCandles15m, 20);
  const currentVolume15m = closedCandles15m[closedCandles15m.length - 1].volume;
  const volumeRatio = volumeSMA15m ? currentVolume15m / volumeSMA15m : 1;
  const range20 = getRecentRangeLevels(closedCandles15m, 20);

  if (!bb15m || !Number.isFinite(atrPercent15m) || !Number.isFinite(rsi15m) || !Number.isFinite(rsi1h)) {
    countMetric(analysisState?.rejectCounts, 'INDICATOR_GAP');
    return null;
  }
  if (atrPercent15m < MIN_ATR_PCT || atrPercent15m > MAX_ATR_PCT) {
    countMetric(analysisState?.rejectCounts, 'ATR_FILTER');
    return null;
  }

  const lastCandle = closedCandles15m[closedCandles15m.length - 1];
  const takerBuyBase = Number.isFinite(lastCandle.takerBuyBaseVolume) ? lastCandle.takerBuyBaseVolume : null;
  const totalBaseVol = Number(lastCandle.volume);
  const buyRatio = takerBuyBase !== null && totalBaseVol > 0 ? takerBuyBase / totalBaseVol : null;
  const deltaRatio = buyRatio === null ? null : (2 * buyRatio - 1);

  const bull4h = Number.isFinite(ema21_4h) && Number.isFinite(ema50_4h) && currentPrice4h > ema21_4h && ema21_4h > ema50_4h;
  const bull1h = Number.isFinite(ema21_1h) && Number.isFinite(ema50_1h) && currentPrice1h > ema21_1h && ema21_1h > ema50_1h;
  const rs4h = btcContext?.closes4h ? calculateRelativeStrength(closes4h, btcContext.closes4h, 12) : 0;
  const rs1h = btcContext?.closes1h ? calculateRelativeStrength(closes1h, btcContext.closes1h, 6) : 0;
  const rs24h = Number(ticker24h?.priceChangePercent || 0) - Number(btcContext?.priceChange24h || 0);

  const bbPercent = bb15m.upper !== bb15m.lower ? (currentPrice - bb15m.lower) / (bb15m.upper - bb15m.lower) : 0.5;
  const distToEma9 = ema9_15m ? ((currentPrice - ema9_15m) / ema9_15m) * 100 : 0;
  const distToEma21 = ema21_15m ? ((currentPrice - ema21_15m) / ema21_15m) * 100 : 0;
  const distToEma50 = ema50_15m ? ((currentPrice - ema50_15m) / ema50_15m) * 100 : 0;
  const pullbackFromHigh20Pct = range20 ? ((range20.high - currentPrice) / range20.high) * 100 : null;
  const breakoutDistancePct = range20 ? ((currentPrice - range20.high) / range20.high) * 100 : null;
  const candleRange = lastCandle.high - lastCandle.low;
  const candleStrength = candleRange > 0 ? (lastCandle.close - lastCandle.low) / candleRange : 0.5;
  const emaSlope1h = calculateSlope(closes1h, 21, 6);

  const regime = detectMarketRegime({
    bull4h,
    atrPercentile,
    btcRisk: btcContext?.status || 'UNKNOWN'
  });

  if (regime === 'RISK_OFF') {
    countMetric(analysisState?.rejectCounts, 'REGIME_RISK_OFF');
    return null;
  }
  countMetric(analysisState?.stageCounts, 'REGIME_OK');

  const sessionStatus = getTradingSessionStatus();
  const ctx = {
    symbol,
    utcHour: sessionStatus.utcHour,
    closes15m,
    currentPrice,
    ema9_15m,
    ema21_15m,
    ema50_15m,
    ema21_4h,
    ema50_4h,
    vwap15m,
    distToEma9,
    distToEma21,
    distToEma50,
    bbPercent,
    volumeRatio,
    deltaRatio,
    obMetrics,
    liquidityTier,
    bull4h,
    bull1h,
    regime,
    rsi15m,
    rsi1h,
    rs1h,
    rs4h,
    rs24h,
    atrPercent15m,
    atrPercentile,
    range20,
    pullbackFromHigh20Pct,
    breakoutDistancePct,
    candleStrength,
    emaSlope1h
  };

  const pullbackResult = evaluateVWAPPullbackModule(ctx);
  const breakoutResult = evaluateVCPBreakoutModule(ctx);
  const moduleCandidates = [];

  if (pullbackResult.candidate) {
    pullbackResult.candidate.riskModel = buildRiskModel(regime, 'VWAP_PULLBACK', atrPercent15m, liquidityTier);
    moduleCandidates.push(pullbackResult.candidate);
    countMetric(analysisState?.moduleCandidates, 'VWAP_PULLBACK');
  }
  if (breakoutResult.candidate) {
    breakoutResult.candidate.riskModel = buildRiskModel(regime, 'VCP_BREAKOUT', atrPercent15m, liquidityTier);
    moduleCandidates.push(breakoutResult.candidate);
    countMetric(analysisState?.moduleCandidates, 'VCP_BREAKOUT');
  }

  if (!moduleCandidates.length) {
    countMetric(analysisState?.rejectCounts, pickPreferredReject(regime, pullbackResult, breakoutResult));
    return null;
  }
  countMetric(analysisState?.stageCounts, 'MODULE_OK');

  const sortedCandidates = moduleCandidates.sort((a, b) => b.score - a.score);
  const bestCandidate = sortedCandidates[0];
  const liveAllowed = new Set(['VWAP_PULLBACK', 'VCP_BREAKOUT']);

  const requiredScore = getRequiredScore(bestCandidate, regime, liquidityTier, btcContext?.status || 'UNKNOWN');

  // v10.1.0: Allow MEDIUM-tier VWAP_PULLBACK to proceed to live evaluation
  if (liquidityTier === 'MEDIUM' && bestCandidate.module !== 'VWAP_PULLBACK') {
    countMetric(analysisState?.rejectCounts, 'LIQUIDITY_TIER_MEDIUM');
    buildCandidateShadow(symbol, bestCandidate, ctx, requiredScore, 'LIQUIDITY_TIER_MEDIUM', btcContext, shadowCollector);
    return null;
  }

  if (btcContext?.status === 'RED') {
    countMetric(analysisState?.rejectCounts, 'BTC_RED_BLOCK');
    buildCandidateShadow(symbol, bestCandidate, ctx, requiredScore, 'BTC_RED_BLOCK', btcContext, shadowCollector);
    return null;
  }

  if (!liveAllowed.has(bestCandidate.module)) {
    countMetric(analysisState?.rejectCounts, 'REGIME_SHADOW_ONLY');
    buildCandidateShadow(symbol, bestCandidate, ctx, requiredScore, 'REGIME_SHADOW_ONLY', btcContext, shadowCollector);
    return null;
  }

  const executionRejectCode = getExecutionRejectCode(obMetrics, liquidityTier);
  // v10.1.0: Depth-floor promotion — allow VWAP_PULLBACK LOW-tier candidates
  // with depthQuoteTopN >= $200k to trade live at reduced sizing
  const isDepthFloorPromotion = (
    executionRejectCode === 'LIQUIDITY_TIER_LOW' &&
    bestCandidate.module === 'VWAP_PULLBACK' &&
    obMetrics.depthQuoteTopN >= 200000
  );
  if (executionRejectCode && !isDepthFloorPromotion) {
    countMetric(analysisState?.rejectCounts, executionRejectCode);
    buildCandidateShadow(symbol, bestCandidate, ctx, requiredScore, executionRejectCode, btcContext, shadowCollector);
    return null;
  }
  if (isDepthFloorPromotion) {
    countMetric(analysisState?.stageCounts, 'PROMOTED_LOW');
  }
  countMetric(analysisState?.stageCounts, 'EXECUTION_OK');

  if (bestCandidate.score < requiredScore) {
    countMetric(analysisState?.rejectCounts, 'SCORE_BELOW_FLOOR');
    buildCandidateShadow(symbol, bestCandidate, ctx, requiredScore, 'SCORE_BELOW_FLOOR', btcContext, shadowCollector);
    return null;
  }
  countMetric(analysisState?.stageCounts, 'SCORE_OK');

  if (bestCandidate.riskModel.realRR < 1.5) {
    countMetric(analysisState?.rejectCounts, 'RISK_MODEL_RR');
    return null;
  }

  countMetric(analysisState?.stageCounts, 'LIVE_SIGNAL');
  return createSignalFromCandidate(symbol, bestCandidate, ctx, btcContext, requiredScore, isDepthFloorPromotion);
}

async function sendTelegramNotification(signals, stats = null) {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram disabled or missing credentials');
    return { success: false, reason: 'disabled' };
  }

  const hasHistory = stats && (stats.open > 0 || stats.wins > 0 || stats.losses > 0);
  if (!signals.length && !hasHistory) return { success: true, sent: 0 };

  const esc = value => escapeMarkdownV2(value !== undefined && value !== null ? value : '');
  let message = '🔔 *DAY TRADE ALERT* 🔔\n';

  if (stats) {
    message += `📊 _Win Rate: ${esc(stats.winRate)}% \\| Open: ${esc(stats.open)} \\| W/L: ${esc(stats.wins)}/${esc(stats.losses)}_\n`;
  }

  message += `_${esc(`${ALGORITHM_VERSION} • Spot long-only intraday`)}_\n\n`;

  for (const signal of [...signals].sort((a, b) => b.score - a.score).slice(0, 5)) {
    const moduleLabel = signal.module === 'BREAKOUT_CONTINUATION' ? '🚀 BREAKOUT' : '📉 PULLBACK';
    const priceStr = signal.price < 1 ? signal.price.toFixed(6) : signal.price.toFixed(2);
    const tpStr = signal.tp < 1 ? signal.tp.toFixed(6) : signal.tp.toFixed(2);
    const slStr = signal.sl < 1 ? signal.sl.toFixed(6) : signal.sl.toFixed(2);

    message += `🟢 *${esc(signal.symbol)}* \\| ${esc(moduleLabel)} \\| ${esc(signal.mode)}\n`;
    message += `💰 *$${esc(priceStr)}* \\| 🎯 TP ${esc(tpStr)} \\| 🛡️ SL ${esc(slStr)}\n`;
    message += `📈 Regime: ${esc(signal.regime)} \\| 🎯 Score: *${esc(signal.score)}*/100\n`;
    message += `🏦 Liquidity: ${esc(signal.liquidityTier)} \\| 📚 Spread: ${esc(signal.spreadBps)} bps\n`;
    message += `📊 Vol: ${esc(signal.volumeRatio)}x \\| RS 1h/4h: ${esc(signal.relativeStrengthSnapshot?.rs1h)}/${esc(signal.relativeStrengthSnapshot?.rs4h)}\n`;
    message += `🌀 ATR: ${esc(signal.atrPercent)}% \\| Size: ${esc(signal.recommendedSize)}% \\| Time stop: ${esc(signal.expectedHoldingHours)}h\n`;
    if (Array.isArray(signal.reasons) && signal.reasons.length) {
      message += `💡 _${esc(signal.reasons.join(' • '))}_\n`;
    }
    message += `───────────────────\n`;
  }

  const timeStr = new Date().toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });
  message += `🤖 _Day Trade Scanner_ • ${esc(timeStr)}`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'MarkdownV2'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telegram API Error:', errorText);
      return { success: false, error: errorText };
    }

    console.log(`Telegram notification sent for ${signals.length} signals`);
    return { success: true, sent: signals.length };
  } catch (error) {
    console.error('Telegram Exception:', error.message);
    return { success: false, error: error.message };
  }
}

export async function runAnalysis(context) {
  const sessionStatus = getTradingSessionStatus();
  if (!sessionStatus.allowed) {
    const sessionMessages = [
      `--- DAY TRADE Analysis Skipped ${ALGORITHM_VERSION} ---`,
      `[SESSION] ${sessionStatus.reason}`,
      '[SESSION] Trading paused - Low liquidity session'
    ];
    sessionMessages.forEach(message => console.log(message));
    await appendPersistentLogEntries(sessionMessages, context);
    return { success: true, signals: 0, reason: 'Asia session - trading restricted', session: 'ASIA_BLOCKED' };
  }

  const canProceed = await acquireRunLock(context);
  if (!canProceed) return { success: false, error: 'Locked' };

  const runId = `RUN-${Math.floor(Math.random() * 1000000)}`;
  const cycleLogs = [];
  const pLog = message => {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const logEntry = `[${timestamp}] ${message}`;
    console.log(message);
    cycleLogs.push(logEntry);
  };

  try {
    pLog(`--- DAY TRADE Analysis Started ${ALGORITHM_VERSION} ---`);
    pLog(`Execution ID: ${runId}`);

    const cooldowns = await loadCooldowns(context);
    pLog(`Loaded ${Object.keys(cooldowns).length} cooldown entries`);

    const signals = [];
    const shadowCandidates = [];
    let analyzed = 0;
    let errors = 0;
    const selectedSectors = new Set();
    const selectedSectorLeaders = new Map();

    const analysisState = {
      rejectCounts: {},
      moduleCandidates: {},
      stageCounts: {}
    };

    const signalMemory = await loadSignalMemory(context);
    pLog(`[MEMORY] Loaded memory for ${Object.keys(signalMemory).length} symbols`);

    let btcContext = { status: 'GREEN', reason: 'BTC context fallback', closes4h: [], closes1h: [], priceChange24h: 0 };
    const tickers24h = await getAllTickers24h();
    const tickersBySymbol = new Map(tickers24h.map(ticker => [ticker.symbol, ticker]));

    try {
      const btcSymbol = `BTC${QUOTE_ASSET}`;
      const [btcCandles4h, btcCandles1h] = await Promise.all([
        getKlines(btcSymbol, '4h', 100),
        getKlines(btcSymbol, '60m', 100)
      ]);
      btcContext = detectBTCContext(btcCandles4h, btcCandles1h, tickersBySymbol.get(btcSymbol));
      if (btcContext.status === 'RED') pLog(`[BTC-SEM] 🔴 RED: ${btcContext.reason}`);
      else if (btcContext.status === 'AMBER') pLog(`[BTC-SEM] 🟡 AMBER: ${btcContext.reason}`);
      else pLog(`[BTC-SEM] 🟢 GREEN: ${btcContext.reason}`);
    } catch (error) {
      pLog(`[BTC-SEM] Fallback context: ${error.message}`);
    }

    const topSymbols = tickers24h.length
      ? getTopSymbolsByOpportunity(tickers24h, QUOTE_ASSET, MAX_SYMBOLS, MIN_QUOTE_VOL_24H)
      : FALLBACK_SYMBOLS;
    pLog(`[UNIVERSE] Selected ${topSymbols.length} symbols after opportunity ranking`);

    const histData = await updateSignalHistory(tickers24h, context, pLog);
    const stats = histData?.stats || { open: 0, wins: 0, losses: 0, bes: 0, staleExits: 0, winRate: 0 };
    const openSymbols = histData?.openSymbols || [];
    pLog(`[${runId}] Performance Stats: ${JSON.stringify(stats)}`);

    const shadowStats = await updateShadowTrades(tickers24h, context, pLog);
    if (shadowStats.total > 0) {
      pLog(`[SHADOW] Stats: ${shadowStats.wouldWin} would-win / ${shadowStats.wouldLose} would-lose of ${shadowStats.total} resolved`);
    }

    for (const symbol of topSymbols) {
      if (openSymbols.includes(symbol)) {
        countMetric(analysisState.rejectCounts, 'OPEN_POSITION_BLOCK');
        continue;
      }

      if (cooldowns[symbol] && (Date.now() - cooldowns[symbol] < ALERT_COOLDOWN_MIN * 60000)) {
        countMetric(analysisState.rejectCounts, 'COOLDOWN_BLOCK');
        continue;
      }

      try {
        const [candles15m, orderBook, candles1h, candles4h] = await Promise.all([
          getKlines(symbol, '15m', 500),
          getOrderBookDepth(symbol, 20),
          getKlines(symbol, '60m', 200),
          getKlines(symbol, '4h', 100)
        ]);

        analyzed++;
        const signal = generateSignal(
          symbol,
          candles15m,
          candles1h,
          candles4h,
          orderBook,
          tickersBySymbol.get(symbol) || null,
          btcContext,
          analysisState,
          shadowCandidates
        );

        let signalAccepted = false;
        if (signal) {
          const sector = getSector(symbol);
          signal.sector = sector;
          const protectedSector = isProtectedSector(sector);

          if (protectedSector && selectedSectors.has(sector)) {
            const blockedBySymbol = selectedSectorLeaders.get(sector) || 'UNKNOWN';
            countMetric(analysisState.rejectCounts, 'SECTOR_CORRELATION');
            shadowCandidates.push(recordShadowNearMiss(
              symbol,
              signal.score,
              signal.price,
              signal.regime,
              'SECTOR_CORRELATION',
              signal.btcContext,
              signal.entryMetrics,
              signal.qualityBreakdown,
              {
                scoreBeforeMomentum: signal.scoreBeforeMomentum,
                requiredScore: signal.requiredScore,
                sector,
                module: signal.module,
                entryArchetype: signal.entryArchetype,
                liquidityTier: signal.liquidityTier,
                expectedHoldingHours: signal.expectedHoldingHours,
                riskModel: signal.riskModel,
                relativeStrengthSnapshot: signal.relativeStrengthSnapshot,
                volumeLiquidityConfirmation: signal.volumeLiquidityConfirmation,
                shadowBenchmarkTpPct: signal.riskModel ? (signal.tp - signal.price) / signal.price : undefined,
                shadowBenchmarkSlPct: signal.riskModel ? (signal.price - signal.sl) / signal.price : undefined,
                shadowBenchmarkVersion: signal.module ? `${ALGORITHM_VERSION}-${signal.module}` : ALGORITHM_VERSION,
                blockedBySector: sector,
                blockedBySymbol
              }
            ));
          } else {
            cooldowns[symbol] = Date.now();
            await saveCooldowns(cooldowns, context);

            if (protectedSector) {
              selectedSectors.add(sector);
              selectedSectorLeaders.set(sector, symbol);
            }

            await recordSignalHistory(signal, context);
            signals.push(signal);
            signalAccepted = true;
            pLog(`[${runId}] 🎯 SIGNAL GENERATED: ${symbol} | Score: ${signal.score} | Module: ${signal.module}`);
            recordSymbolScore(signalMemory, symbol, signal.score, signal.regime);
          }
        }

        const lastShadow = shadowCandidates.length ? shadowCandidates[shadowCandidates.length - 1] : null;
        if (!signalAccepted && lastShadow && lastShadow.symbol === symbol) {
          recordSymbolScore(signalMemory, symbol, lastShadow.score, lastShadow.regime);
        }

        await sleep(10);
      } catch (error) {
        pLog(`Error analyzing ${symbol}: ${error.message}`);
        errors++;
        await sleep(10);
      }
    }

    pLog(`Analysis complete: ${analyzed} coins, ${signals.length} signals, ${errors} errors`);

    const moduleSummary = toSummaryPairs(analysisState.moduleCandidates);
    const stageSummary = toSummaryPairs(analysisState.stageCounts);
    const rejectSummary = toSummaryPairs(analysisState.rejectCounts);
    if (stageSummary.length) pLog(`[THROUGHPUT] Stages: ${stageSummary.join(' | ')}`);
    if (moduleSummary.length) pLog(`[THROUGHPUT] Module candidates: ${moduleSummary.join(' | ')}`);
    if (rejectSummary.length) pLog(`[THROUGHPUT] Rejects: ${rejectSummary.join(' | ')}`);

    await saveSignalMemory(signalMemory, context);

    if (shadowCandidates.length > 0) {
      const existingShadows = await loadShadowTrades(context);
      await saveShadowTrades([...existingShadows, ...shadowCandidates], context);
      pLog(`[SHADOW] Recorded ${shadowCandidates.length} near-misses this cycle`);
    }

    const existingLogs = await loadPersistentLogs(context);
    await savePersistentLogs([...existingLogs, ...cycleLogs], context);

    let telegramResult = { success: true, sent: 0 };
    if (signals.length > 0) {
      telegramResult = await sendTelegramNotification(signals, stats);
    }

    await releaseRunLock(context);

    return {
      success: true,
      id: runId,
      analyzed,
      signals: signals.length,
      errors,
      shadowsRecorded: shadowCandidates.length,
      shadowStats,
      moduleCandidates: analysisState.moduleCandidates,
      topRejects: Object.fromEntries(toSummaryPairs(analysisState.rejectCounts, 10).map(pair => {
        const [key, value] = pair.split('=');
        return [key, Number(value)];
      })),
      persistentLogsRecorded: cycleLogs.length,
      telegram: telegramResult,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    pLog(`CRITICAL ERROR in runAnalysis: ${error.message}`);
    await releaseRunLock(context);
    return { success: false, error: error.message };
  }
}

const scheduledHandler = async (event, context) => {
  const method = event && (event.httpMethod || event.method) ? String(event.httpMethod || event.method).toUpperCase() : '';

  if (method) {
    const headers = event.headers || {};
    const nfEvent = (headers['x-nf-event'] || headers['X-NF-Event'] || headers['x-nf-Event'] || '').toString().toLowerCase();

    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, x-notify-secret',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Content-Type': 'application/json'
        },
        body: ''
      };
    }

    if (method !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Method not allowed' })
      };
    }

    let payload = null;
    if (event.body) {
      try {
        payload = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Invalid JSON body' })
        };
      }
    }

    const hasNextRun = payload && typeof payload.next_run === 'string';
    const isSchedule = nfEvent === 'schedule' || hasNextRun;

    if (isSchedule) {
      const result = await runAnalysis(context);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    if (!NOTIFY_SECRET) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'NOTIFY_SECRET not configured' })
      };
    }

    const clientSecret = headers['x-notify-secret'] || headers['X-Notify-Secret'] || headers['x-notify-Secret'] || '';
    if (clientSecret !== NOTIFY_SECRET) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Unauthorized' })
      };
    }

    const incomingSignals = payload && Array.isArray(payload.signals) ? payload.signals : null;
    if (!incomingSignals || !incomingSignals.length) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'No signals provided' })
      };
    }

    const telegram = await sendTelegramNotification(incomingSignals);
    return {
      statusCode: telegram.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: telegram.success, telegram })
    };
  }

  const result = await runAnalysis(context);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  };
};

export const handler = schedule("0,15,30,45 * * * *", scheduledHandler);
