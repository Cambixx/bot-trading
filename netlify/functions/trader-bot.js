/**
 * Netlify Scheduled Function - TradingView Fusion Bot v13
 * Spot long-only trend/reclaim scanner built from the indicators in
 * tradinview-indicators: VIDYA, Squeeze, MACD, MLMA, SMC, SOTT and Two-Pole.
 */

import { schedule } from "@netlify/functions";
import {
  buildExecutionQuality,
  buildRelativeStrengthSnapshot,
  buildVolumeLiquidityConfirmation,
  calculateADX,
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateMLMA,
  calculateOrderBookMetrics as coreCalculateOrderBookMetrics,
  calculateRelativeStrength,
  calculateRSI,
  calculateSOTT,
  calculateSqueeze,
  calculateTwoPoleOscillator,
  calculateVIDYA,
  calculateVolatilityPercentile,
  calculateVolumeSMA,
  calculateVWAP,
  clamp,
  classifyLiquidityTier as coreClassifyLiquidityTier,
  countMetric,
  detectBTCContext,
  detectMarketRegime,
  detectSMC,
  escapeMarkdownV2,
  formatPrice,
  getAllTickers24h,
  getClosedCandles,
  getExecutionRejectCode as coreGetExecutionRejectCode,
  getInternalStore as coreGetInternalStore,
  getKlines,
  getOrderBookDepth,
  getRecentRangeLevels,
  getSector,
  isNonCryptoWrapper,
  isProtectedSector,
  normalizeBaseAsset,
  roundMetric,
  selectTopSymbols,
  sleep,
  toSummaryPairs
} from './tradingview-strategy-core.js';

export const ALGORITHM_VERSION = 'v13.0.0-TradingViewFusion';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
const QUOTE_ASSET = (process.env.QUOTE_ASSET || 'USDT').toUpperCase();
const MAX_SYMBOLS = process.env.MAX_SYMBOLS ? Number(process.env.MAX_SYMBOLS) : 48;
const MIN_QUOTE_VOL_24H = process.env.MIN_QUOTE_VOL_24H ? Number(process.env.MIN_QUOTE_VOL_24H) : 15000000;
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 76;
const MAX_SPREAD_BPS = process.env.MAX_SPREAD_BPS ? Number(process.env.MAX_SPREAD_BPS) : 8;
const MIN_DEPTH_QUOTE = process.env.MIN_DEPTH_QUOTE ? Number(process.env.MIN_DEPTH_QUOTE) : 90000;
const MIN_ATR_PCT = process.env.MIN_ATR_PCT ? Number(process.env.MIN_ATR_PCT) : 0.16;
const MAX_ATR_PCT = process.env.MAX_ATR_PCT ? Number(process.env.MAX_ATR_PCT) : 5.5;
const ALERT_COOLDOWN_MIN = process.env.ALERT_COOLDOWN_MIN ? Number(process.env.ALERT_COOLDOWN_MIN) : 240;
const AVOID_ASIA_SESSION = (process.env.AVOID_ASIA_SESSION || 'false').toLowerCase() === 'true';
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || '';

export const COOLDOWN_STORE_KEY = 'signal-cooldowns';
const COOLDOWN_EXPIRY_HOURS = 24;
const RUN_LOCK_KEY = 'trader-run-lock-v13';

export const HISTORY_STORE_KEY = 'signal-history-v2';
export const SHADOW_STORE_KEY = 'shadow-trades-v1';
export const SHADOW_ARCHIVE_STORE_KEY = 'shadow-archive-v1';
export const MEMORY_STORE_KEY = 'signal-memory-v1';
export const AUTOPSY_STORE_KEY = 'trade-autopsies-v1';
export const PERSISTENT_LOG_STORE_KEY = 'persistent-logs-v1';

const SHADOW_BENCHMARK_VERSION = `${ALGORITHM_VERSION}-shadow-v1`;
const SHADOW_BENCHMARK_TP_PCT = process.env.SHADOW_BENCHMARK_TP_PCT ? Number(process.env.SHADOW_BENCHMARK_TP_PCT) : 0.024;
const SHADOW_BENCHMARK_SL_PCT = process.env.SHADOW_BENCHMARK_SL_PCT ? Number(process.env.SHADOW_BENCHMARK_SL_PCT) : 0.012;

export const calculateOrderBookMetrics = coreCalculateOrderBookMetrics;

export function getInternalStore(context) {
  return coreGetInternalStore(context);
}

export function classifyLiquidityTier(quoteVol24h, depthQuoteTopN, spreadBps) {
  return coreClassifyLiquidityTier(quoteVol24h, depthQuoteTopN, spreadBps, MAX_SPREAD_BPS);
}

export function getExecutionRejectCode(obMetrics, liquidityTier) {
  return coreGetExecutionRejectCode(obMetrics, liquidityTier, {
    maxSpreadBps: MAX_SPREAD_BPS,
    minDepthQuote: MIN_DEPTH_QUOTE
  });
}

function getTradingSessionStatus(now = new Date()) {
  const utcHour = now.getUTCHours();
  if (AVOID_ASIA_SESSION && utcHour >= 0 && utcHour < 7) {
    return {
      allowed: false,
      utcHour,
      reason: `Asia session detected (${utcHour}:00 UTC) - trading restricted`
    };
  }
  return { allowed: true, utcHour, reason: null };
}

function formatPersistentLogEntry(message, date = new Date()) {
  const timestamp = date.toISOString().replace('T', ' ').split('.')[0];
  return `[${timestamp}] ${message}`;
}

export async function loadCooldowns(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(COOLDOWN_STORE_KEY, { type: 'json' });
    if (!data || typeof data !== 'object') return {};

    const now = Date.now();
    const expiryMs = COOLDOWN_EXPIRY_HOURS * 3600 * 1000;
    const fresh = {};
    for (const [symbol, timestamp] of Object.entries(data)) {
      const value = Number(timestamp);
      if (Number.isFinite(value) && now - value < expiryMs) fresh[symbol] = value;
    }
    return fresh;
  } catch (error) {
    console.error('[COOLDOWN] load error:', error.message);
    return {};
  }
}

export async function saveCooldowns(cooldowns, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(COOLDOWN_STORE_KEY, cooldowns || {});
  } catch (error) {
    console.error('[COOLDOWN] save error:', error.message);
  }
}

async function acquireRunLock(context) {
  try {
    const store = getInternalStore(context);
    const lock = await store.get(RUN_LOCK_KEY, { type: 'json' });
    const now = Date.now();
    if (lock && Number.isFinite(lock.timestamp) && now - lock.timestamp < 3 * 60000) {
      console.warn(`[LOCK] Trader analysis already running (${Math.round((now - lock.timestamp) / 1000)}s old)`);
      return false;
    }
    await store.setJSON(RUN_LOCK_KEY, { timestamp: now, id: `trader-${now}` });
    return true;
  } catch (error) {
    console.error('[LOCK] acquire error:', error.message);
    return true;
  }
}

async function releaseRunLock(context) {
  try {
    const store = getInternalStore(context);
    await store.delete(RUN_LOCK_KEY);
  } catch (error) {
    console.error('[LOCK] release error:', error.message);
  }
}

export function classifyBuyStopOutcome(item, entryPrice, exitPrice) {
  if (
    item?.type === 'BUY' &&
    item.trailingStopActive === true &&
    Number.isFinite(item.sl) &&
    Number.isFinite(entryPrice) &&
    item.sl >= entryPrice
  ) {
    if (Number.isFinite(exitPrice) && exitPrice >= entryPrice) {
      return { outcome: 'BREAK_EVEN', exitReason: 'TRAIL_BE_STOP' };
    }
    return { outcome: 'LOSS', exitReason: 'TRAIL_STOP_GAP_LOSS' };
  }
  return { outcome: 'LOSS', exitReason: 'STOP_LOSS' };
}

export function closeTradeWithTelemetry(item, outcome, exitReason, exitPrice, closedAt = Date.now()) {
  item.status = 'CLOSED';
  item.outcome = outcome;
  item.exitReason = exitReason || null;
  item.exitPrice = Number.isFinite(exitPrice) ? exitPrice : null;
  item.closedAt = closedAt;
  return item;
}

async function recordTradeAutopsy(item, context) {
  try {
    const store = getInternalStore(context);
    const autopsies = await store.get(AUTOPSY_STORE_KEY, { type: 'json' }) || [];
    const entryPrice = item.price || item.entry;
    const exitTimestamp = Number.isFinite(item.closedAt) ? item.closedAt : Date.now();
    const maxFav = Number.isFinite(item.maxFavorable) ? item.maxFavorable : entryPrice;
    const maxAdv = Number.isFinite(item.maxAdverse) ? item.maxAdverse : entryPrice;
    const favorableMove = (maxFav - entryPrice) / entryPrice;
    const adverseMove = (entryPrice - maxAdv) / entryPrice;

    autopsies.push({
      id: item.id,
      symbol: item.symbol,
      outcome: item.outcome,
      regime: item.regime || 'UNKNOWN',
      btcRisk: item.btcRisk || 'UNKNOWN',
      score: item.score || 0,
      sector: item.sector || getSector(item.symbol, QUOTE_ASSET),
      module: item.module || null,
      entryArchetype: item.entryArchetype || null,
      liquidityTier: item.liquidityTier || null,
      requiredScore: item.requiredScore || null,
      expectedHoldingHours: item.expectedHoldingHours || null,
      riskModel: item.riskModel || null,
      hoursOpen: roundMetric((exitTimestamp - item.time) / 3600000, 1),
      favorableMovePct: roundMetric(favorableMove * 100, 2),
      adverseMovePct: roundMetric(adverseMove * 100, 2),
      mfePct: roundMetric(favorableMove * 100, 2),
      maePct: roundMetric(adverseMove * 100, 2),
      entryMetrics: item.entryMetrics || null,
      qualityBreakdown: item.qualityBreakdown || null,
      relativeStrengthSnapshot: item.relativeStrengthSnapshot || null,
      volumeLiquidityConfirmation: item.volumeLiquidityConfirmation || null,
      reasons: item.reasons || [],
      trailingStopActive: item.trailingStopActive === true,
      exitPrice: Number.isFinite(item.exitPrice) ? item.exitPrice : null,
      exitReason: item.exitReason || null,
      closedAt: exitTimestamp,
      version: item.version || ALGORITHM_VERSION
    });

    await store.setJSON(AUTOPSY_STORE_KEY, autopsies.slice(-300));
  } catch (error) {
    console.error('[AUTOPSY] record error:', error.message);
  }
}

async function recordSignalHistory(signal, context) {
  try {
    const store = getInternalStore(context);
    const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];

    history.push({
      id: `TRADER-${Date.now()}-${signal.symbol}`,
      symbol: signal.symbol,
      price: signal.price,
      tp: signal.tp,
      sl: signal.sl,
      initialSl: signal.sl,
      type: 'BUY',
      time: Date.now(),
      status: 'OPEN',
      score: signal.score,
      regime: signal.regime,
      btcRisk: signal.btcContext?.status || 'UNKNOWN',
      sector: signal.sector || getSector(signal.symbol, QUOTE_ASSET),
      module: signal.module,
      entryArchetype: signal.entryArchetype,
      liquidityTier: signal.liquidityTier,
      requiredScore: signal.requiredScore,
      expectedHoldingHours: signal.expectedHoldingHours,
      riskModel: signal.riskModel,
      entryMetrics: signal.entryMetrics,
      qualityBreakdown: signal.qualityBreakdown,
      relativeStrengthSnapshot: signal.relativeStrengthSnapshot,
      volumeLiquidityConfirmation: signal.volumeLiquidityConfirmation,
      reasons: signal.reasons || [],
      maxFavorable: signal.price,
      maxAdverse: signal.price,
      trailingStopActive: false,
      exitPrice: null,
      exitReason: null,
      closedAt: null,
      version: ALGORITHM_VERSION
    });

    await store.setJSON(HISTORY_STORE_KEY, history.slice(-250));
  } catch (error) {
    console.error('[HISTORY] record error:', error.message);
  }
}

async function updateSignalHistory(tickers, context, pLog = console.log) {
  try {
    const store = getInternalStore(context);
    const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];
    if (!history.length) {
      return { stats: { open: 0, wins: 0, losses: 0, bes: 0, staleExits: 0, winRate: 0 }, openSymbols: [] };
    }

    const prices = new Map((tickers || []).map(ticker => [ticker.symbol, Number(ticker.lastPrice)]));
    let updated = false;

    for (const item of history) {
      if (item.status !== 'OPEN') continue;
      const currentPrice = prices.get(item.symbol);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

      const entryPrice = item.price || item.entry;
      if (!Number.isFinite(item.maxFavorable)) item.maxFavorable = entryPrice;
      if (!Number.isFinite(item.maxAdverse)) item.maxAdverse = entryPrice;
      if (currentPrice > item.maxFavorable) item.maxFavorable = currentPrice;
      if (currentPrice < item.maxAdverse) item.maxAdverse = currentPrice;

      const halfwayToTarget = entryPrice + ((item.tp - entryPrice) * 0.5);
      if (!item.trailingStopActive && currentPrice >= halfwayToTarget) {
        item.trailingStopActive = true;
        item.sl = Math.max(Number(item.sl || 0), entryPrice * 1.001);
        updated = true;
        pLog(`[TRAIL] ${item.symbol}: stop moved to ${formatPrice(item.sl)}`);
      }

      if (currentPrice >= item.tp) {
        closeTradeWithTelemetry(item, 'WIN', 'TAKE_PROFIT', currentPrice);
        updated = true;
        await recordTradeAutopsy(item, context);
      } else if (currentPrice <= item.sl) {
        const classification = classifyBuyStopOutcome(item, entryPrice, currentPrice);
        closeTradeWithTelemetry(item, classification.outcome, classification.exitReason, currentPrice);
        updated = true;
        await recordTradeAutopsy(item, context);
      }

      const staleExitHours = Number.isFinite(item.expectedHoldingHours) ? item.expectedHoldingHours : 12;
      const hoursOpen = (Date.now() - item.time) / 3600000;
      const favorableMove = ((item.maxFavorable || entryPrice) - entryPrice) / entryPrice;
      if (item.status === 'OPEN' && hoursOpen > staleExitHours && favorableMove < 0.004) {
        closeTradeWithTelemetry(item, 'STALE_EXIT', 'TIME_STOP_STALE_EXIT', currentPrice);
        updated = true;
        await recordTradeAutopsy(item, context);
        pLog(`[STALE_EXIT] ${item.symbol}: ${hoursOpen.toFixed(1)}h open, MFE ${(favorableMove * 100).toFixed(2)}%`);
      } else if (item.status === 'OPEN' && Date.now() - item.time > 72 * 3600 * 1000) {
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
    const openSignals = history.filter(item => item.status === 'OPEN');

    return {
      stats: {
        open: openSignals.length,
        wins,
        losses,
        bes,
        staleExits,
        winRate: totalDecisive > 0 ? (wins / totalDecisive * 100).toFixed(1) : 0
      },
      openSymbols: openSignals.map(item => item.symbol)
    };
  } catch (error) {
    console.error('[HISTORY] update error:', error.message);
    return { stats: { open: 0, wins: 0, losses: 0, bes: 0, staleExits: 0, winRate: 0 }, openSymbols: [] };
  }
}

export async function loadShadowTrades(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(SHADOW_STORE_KEY, { type: 'json' });
    const now = Date.now();
    return Array.isArray(data) ? data.filter(item => now - item.timestamp < 72 * 3600 * 1000) : [];
  } catch (error) {
    console.error('[SHADOW] load error:', error.message);
    return [];
  }
}

export async function loadShadowTradeArchive(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(SHADOW_ARCHIVE_STORE_KEY, { type: 'json' });
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[SHADOW] archive load error:', error.message);
    return [];
  }
}

async function saveShadowTrades(shadows, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(SHADOW_STORE_KEY, shadows.slice(-150));
  } catch (error) {
    console.error('[SHADOW] save error:', error.message);
  }
}

async function saveShadowTradeArchive(shadows, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(SHADOW_ARCHIVE_STORE_KEY, shadows.slice(-600));
  } catch (error) {
    console.error('[SHADOW] archive save error:', error.message);
  }
}

async function archiveResolvedShadowTrades(shadows, context, pLog = console.log) {
  const resolved = shadows.filter(item => item.outcome !== 'PENDING');
  if (!resolved.length) return shadows;

  const archive = await loadShadowTradeArchive(context);
  const ids = new Set(archive.map(item => item.id));
  const archivedAt = Date.now();
  const additions = [];

  for (const shadow of resolved) {
    if (!shadow.archivedAt) shadow.archivedAt = archivedAt;
    if (!ids.has(shadow.id)) {
      ids.add(shadow.id);
      additions.push({ ...shadow });
    }
  }

  if (additions.length) {
    await saveShadowTradeArchive([...archive, ...additions], context);
    pLog(`[SHADOW] Archived ${additions.length} resolved near-misses`);
  }

  return shadows.filter(item => item.outcome === 'PENDING');
}

function recordShadowNearMiss(signal, rejectReasonCode, meta = {}) {
  const now = Date.now();
  const tpPct = meta.shadowBenchmarkTpPct ?? (signal.tp && signal.price ? (signal.tp - signal.price) / signal.price : SHADOW_BENCHMARK_TP_PCT);
  const slPct = meta.shadowBenchmarkSlPct ?? (signal.sl && signal.price ? (signal.price - signal.sl) / signal.price : SHADOW_BENCHMARK_SL_PCT);

  return {
    id: `shadow-${now}-${signal.symbol}`,
    symbol: signal.symbol,
    score: signal.score,
    requiredScore: signal.requiredScore ?? meta.requiredScore ?? null,
    scoreGap: Number.isFinite(signal.requiredScore) ? roundMetric(signal.requiredScore - signal.score, 2) : null,
    price: signal.price,
    regime: signal.regime,
    rejectReasonCode,
    rejectReason: rejectReasonCode,
    btcRisk: signal.btcContext?.status || meta.btcRisk || 'UNKNOWN',
    sector: signal.sector || getSector(signal.symbol, QUOTE_ASSET),
    module: signal.module || null,
    entryArchetype: signal.entryArchetype || null,
    liquidityTier: signal.liquidityTier || null,
    expectedHoldingHours: signal.expectedHoldingHours || null,
    riskModel: signal.riskModel || null,
    relativeStrengthSnapshot: signal.relativeStrengthSnapshot || null,
    volumeLiquidityConfirmation: signal.volumeLiquidityConfirmation || null,
    timestamp: now,
    entryMetrics: signal.entryMetrics || null,
    qualityBreakdown: signal.qualityBreakdown || null,
    shadowBenchmark: {
      version: meta.shadowBenchmarkVersion || `${SHADOW_BENCHMARK_VERSION}-${signal.module || 'UNKNOWN'}`,
      tpPct,
      slPct
    },
    maxFavorableMovePct: null,
    maxAdverseMovePct: null,
    outcome: 'PENDING',
    resolvedAt: null,
    archivedAt: null
  };
}

async function updateShadowTrades(context, pLog = console.log) {
  try {
    let shadows = await loadShadowTrades(context);
    if (!shadows.length) return { total: 0, wouldWin: 0, wouldLose: 0 };

    if (shadows.some(item => item.outcome !== 'PENDING')) {
      shadows = await archiveResolvedShadowTrades(shadows, context, pLog);
      await saveShadowTrades(shadows, context);
    }

    const pending = shadows.filter(item => item.outcome === 'PENDING');
    if (!pending.length) return { total: 0, wouldWin: 0, wouldLose: 0 };

    let updated = false;
    for (const symbol of [...new Set(pending.map(item => item.symbol))]) {
      const candles = await getKlines(symbol, '15m', 240).catch(() => null);
      if (!candles) continue;

      for (const shadow of pending.filter(item => item.symbol === symbol)) {
        const entryPrice = shadow.price;
        const tpLevel = entryPrice * (1 + (shadow.shadowBenchmark?.tpPct || SHADOW_BENCHMARK_TP_PCT));
        const slLevel = entryPrice * (1 - (shadow.shadowBenchmark?.slPct || SHADOW_BENCHMARK_SL_PCT));
        const futureCandles = candles.filter(candle => candle.time > shadow.timestamp);
        let maxHigh = entryPrice;
        let minLow = entryPrice;

        for (const candle of futureCandles) {
          if (candle.high > maxHigh) maxHigh = candle.high;
          if (candle.low < minLow) minLow = candle.low;
          shadow.maxFavorableMovePct = roundMetric(((maxHigh - entryPrice) / entryPrice) * 100, 2);
          shadow.maxAdverseMovePct = roundMetric(((entryPrice - minLow) / entryPrice) * 100, 2);

          const hitTP = candle.high >= tpLevel;
          const hitSL = candle.low <= slLevel;
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

        if (shadow.outcome === 'PENDING' && Date.now() - shadow.timestamp > 72 * 3600 * 1000) {
          shadow.outcome = 'EXPIRED';
          shadow.resolvedAt = Date.now();
          updated = true;
        }
      }
    }

    if (updated) {
      const decisive = shadows.filter(item => item.outcome === 'WOULD_WIN' || item.outcome === 'WOULD_LOSE');
      const stats = {
        total: decisive.length,
        wouldWin: decisive.filter(item => item.outcome === 'WOULD_WIN').length,
        wouldLose: decisive.filter(item => item.outcome === 'WOULD_LOSE').length
      };
      shadows = await archiveResolvedShadowTrades(shadows, context, pLog);
      await saveShadowTrades(shadows, context);
      return stats;
    }

    return { total: 0, wouldWin: 0, wouldLose: 0 };
  } catch (error) {
    console.error('[SHADOW] update error:', error.message);
    return { total: 0, wouldWin: 0, wouldLose: 0 };
  }
}

export async function loadPersistentLogs(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(PERSISTENT_LOG_STORE_KEY, { type: 'json' });
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[PLOG] load error:', error.message);
    return [];
  }
}

async function savePersistentLogs(logs, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(PERSISTENT_LOG_STORE_KEY, logs.slice(-4000));
  } catch (error) {
    console.error('[PLOG] save error:', error.message);
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
      const valid = Array.isArray(entries) ? entries.filter(item => now - item.timestamp < 4 * 3600 * 1000) : [];
      if (valid.length) fresh[symbol] = valid;
    }
    return fresh;
  } catch (error) {
    console.error('[MEMORY] load error:', error.message);
    return {};
  }
}

async function saveSignalMemory(memory, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(MEMORY_STORE_KEY, memory);
  } catch (error) {
    console.error('[MEMORY] save error:', error.message);
  }
}

function recordSymbolScore(memory, symbol, score, module) {
  if (!memory[symbol]) memory[symbol] = [];
  memory[symbol].push({ score, module, timestamp: Date.now() });
  memory[symbol] = memory[symbol].slice(-10);
}

function calculateMultiCandleDelta(candles, lookback = 3) {
  const slice = candles.slice(-lookback);
  if (!slice.length) return 0;
  const takerValues = slice
    .map(candle => {
      if (!Number.isFinite(candle.takerBuyBaseVolume) || !Number.isFinite(candle.volume) || candle.volume <= 0) return null;
      return (2 * (candle.takerBuyBaseVolume / candle.volume)) - 1;
    })
    .filter(Number.isFinite);

  if (takerValues.length === slice.length) {
    return takerValues.reduce((sum, value) => sum + value, 0) / takerValues.length;
  }

  return slice.reduce((sum, candle) => {
    const range = Math.max(candle.high - candle.low, candle.close * 0.0001);
    return sum + clamp((candle.close - candle.open) / range, -1, 1);
  }, 0) / slice.length;
}

function buildRiskModel(ctx, candidate) {
  const price = ctx.currentPrice;
  const atr = ctx.atr15m;
  let slAtr = candidate.slAtr ?? 1.35;
  let tpR = candidate.tpR ?? 2.25;
  let timeStopHours = candidate.timeStopHours ?? 14;

  if (candidate.module === 'SMC_DISCOUNT_RECLAIM') {
    slAtr = 1.2;
    tpR = 2.4;
    timeStopHours = 16;
  } else if (candidate.module === 'TWO_POLE_PULLBACK_CONTINUATION') {
    slAtr = 1.15;
    tpR = 2.05;
    timeStopHours = 10;
  }

  let sl = price - atr * slAtr;
  const structureStop = Number.isFinite(ctx.smc15?.lastLow) && ctx.smc15.lastLow < price
    ? ctx.smc15.lastLow * 0.997
    : null;
  const vidyaStop = Number.isFinite(ctx.vidya15?.lower) && ctx.vidya15.lower < price
    ? ctx.vidya15.lower * 0.998
    : null;
  for (const stop of [structureStop, vidyaStop]) {
    if (Number.isFinite(stop)) sl = Math.max(sl, stop);
  }

  const minRiskPct = candidate.module === 'TWO_POLE_PULLBACK_CONTINUATION' ? 0.0055 : 0.007;
  const maxRiskPct = 0.045;
  let riskPct = (price - sl) / price;
  if (!Number.isFinite(riskPct) || riskPct <= 0) riskPct = minRiskPct;
  if (riskPct < minRiskPct) sl = price * (1 - minRiskPct);
  if (riskPct > maxRiskPct) sl = price * (1 - maxRiskPct);

  const risk = price - sl;
  const tp = price + risk * tpR;
  return {
    sl,
    tp,
    tpPct: (tp - price) / price,
    slPct: (price - sl) / price,
    realRR: risk > 0 ? (tp - price) / risk : 0,
    slAtr,
    tpR,
    timeStopHours
  };
}

function calculateRecommendedSize(score, atrPct, regime, module, liquidityTier, rsStrength) {
  let size = 0.7;
  if (score >= 82) size += 0.35;
  if (score >= 88) size += 0.35;
  if (liquidityTier === 'ELITE') size += 0.65;
  else if (liquidityTier === 'HIGH') size += 0.35;
  else if (liquidityTier === 'MEDIUM') size += 0.1;

  if (module === 'SMC_DISCOUNT_RECLAIM') size += 0.15;
  if (Number.isFinite(rsStrength) && rsStrength > 0.012) size += 0.2;
  if (atrPct > 3) size *= 0.65;
  else if (atrPct > 2) size *= 0.8;
  if (regime === 'VOLATILE_TRANSITION' || regime === 'RANGING') size *= 0.85;
  return clamp(size, 0.4, 3.0).toFixed(1);
}

function getRequiredScore(candidate, ctx) {
  let required = candidate.baseRequiredScore ?? SIGNAL_SCORE_THRESHOLD;
  if (ctx.liquidityTier === 'MEDIUM') required += 2;
  if (ctx.btcContext?.status === 'AMBER') required += 3;
  if (ctx.regime === 'RANGING' && candidate.module === 'VIDYA_SQUEEZE_EXPANSION') required += 4;
  if (ctx.regime === 'VOLATILE_TRANSITION') required += 3;
  if (ctx.atrPercent15m > 3.2) required += 2;
  return required;
}

function evaluateVidyaSqueeze(ctx) {
  const { vidya15, squeeze15, macd15, mlma1h, sott1h, volumeRatio, deltaRatio, executionQuality } = ctx;
  if (!vidya15?.trendUp) return { rejectCode: 'VIDYA_TREND_DOWN' };
  if (!squeeze15?.bullish || !squeeze15.rising) return { rejectCode: 'SQUEEZE_NOT_EXPANDING' };
  if (!macd15?.aboveSignal || macd15.histDelta < -Math.abs(macd15.hist) * 0.2) return { rejectCode: 'MACD_NOT_CONFIRMED' };

  const trendQuality = 66
    + (vidya15.trendCrossUp ? 10 : 0)
    + (mlma1h?.bullish ? 7 : 0)
    + (sott1h?.strongBull ? 7 : 0);
  const expansionQuality = 64
    + (squeeze15.fired ? 12 : 0)
    + (squeeze15.sqzOff ? 5 : 0)
    + (macd15.crossUp ? 7 : 0)
    + clamp(macd15.histDelta * 1000, 0, 8);
  const participationQuality = 58
    + clamp((volumeRatio - 1) * 18, -8, 16)
    + clamp((deltaRatio || 0) * 12, -5, 8)
    + (vidya15.volumeDeltaPct > 20 ? 5 : 0);

  const score = Math.round(
    trendQuality * 0.3 +
    expansionQuality * 0.33 +
    participationQuality * 0.22 +
    executionQuality * 0.15
  );

  return {
    candidate: {
      module: 'VIDYA_SQUEEZE_EXPANSION',
      entryArchetype: 'Volumatic VIDYA trend expansion',
      score: clamp(score, 0, 100),
      baseRequiredScore: SIGNAL_SCORE_THRESHOLD,
      minVolumeRatio: 0.95,
      tpR: 2.3,
      slAtr: 1.35,
      timeStopHours: 14,
      qualityBreakdown: {
        trend: roundMetric(trendQuality, 1),
        expansion: roundMetric(expansionQuality, 1),
        participation: roundMetric(participationQuality, 1),
        execution: roundMetric(executionQuality, 1)
      },
      reasons: [
        'VIDYA trend up',
        squeeze15.fired ? 'Squeeze fired bullish' : 'Squeeze momentum rising',
        macd15.crossUp ? 'MACD bullish cross' : 'MACD above signal'
      ]
    }
  };
}

function evaluateSMCReclaim(ctx) {
  const { smc1h, smc15, currentPrice, ema21_15m, vwap15m, macd15, twoPole15, volumeRatio, executionQuality } = ctx;
  const structureOk = smc1h?.recentBullishBOS || smc15?.recentBullishBOS || smc15?.bullishBOS;
  if (!structureOk) return { rejectCode: 'SMC_NO_BULLISH_STRUCTURE' };

  const reclaimedValue = (
    Number.isFinite(ema21_15m) && ctx.last15m.low <= ema21_15m * 1.004 && currentPrice > ema21_15m
  ) || (
    Number.isFinite(vwap15m) && ctx.last15m.low <= vwap15m * 1.004 && currentPrice > vwap15m
  ) || smc15?.nearBullishOrderBlock;

  if (!reclaimedValue) return { rejectCode: 'SMC_NO_VALUE_RECLAIM' };
  if (!(macd15?.histDelta > 0 || twoPole15?.bullish || twoPole15?.buy)) return { rejectCode: 'SMC_NO_MOMENTUM_RECLAIM' };

  const trendQuality = 66 + (smc1h?.recentBullishBOS ? 8 : 0) + (smc15?.bullishBOS ? 8 : 0) + (smc15?.bullishFVG ? 4 : 0);
  const expansionQuality = 60 + (twoPole15?.buy ? 10 : 0) + (macd15?.histDelta > 0 ? 6 : 0);
  const participationQuality = 58 + clamp((volumeRatio - 0.9) * 18, -6, 14);
  const score = Math.round(trendQuality * 0.34 + expansionQuality * 0.28 + participationQuality * 0.2 + executionQuality * 0.18);

  return {
    candidate: {
      module: 'SMC_DISCOUNT_RECLAIM',
      entryArchetype: 'SMC value reclaim',
      score: clamp(score, 0, 100),
      baseRequiredScore: SIGNAL_SCORE_THRESHOLD + 1,
      minVolumeRatio: 0.85,
      tpR: 2.4,
      slAtr: 1.2,
      timeStopHours: 16,
      qualityBreakdown: {
        trend: roundMetric(trendQuality, 1),
        expansion: roundMetric(expansionQuality, 1),
        participation: roundMetric(participationQuality, 1),
        execution: roundMetric(executionQuality, 1)
      },
      reasons: [
        'Bullish SMC structure',
        smc15?.nearBullishOrderBlock ? 'Order-block reclaim' : 'EMA/VWAP reclaim',
        twoPole15?.buy ? 'Two-Pole buy reset' : 'Momentum improving'
      ]
    }
  };
}

function evaluateTwoPoleContinuation(ctx) {
  const { twoPole15, sott1h, mlma1h, currentPrice, ema21_15m, ema50_15m, rsi15m, volumeRatio, executionQuality } = ctx;
  if (!(ctx.bull1h || mlma1h?.bullish || sott1h?.strongBull)) return { rejectCode: 'TWOPOLE_HTF_NOT_BULLISH' };
  if (!(twoPole15?.buy || (twoPole15?.bullish && twoPole15.value < 0.15 && twoPole15.slope > 0))) return { rejectCode: 'TWOPOLE_NO_RESET' };
  if (!Number.isFinite(ema50_15m) || currentPrice <= ema50_15m) return { rejectCode: 'TWOPOLE_BELOW_EMA50' };
  if (!Number.isFinite(rsi15m) || rsi15m < 42 || rsi15m > 68) return { rejectCode: 'TWOPOLE_RSI_OUT_OF_RANGE' };

  const touchedValue = Number.isFinite(ema21_15m) ? ctx.last15m.low <= ema21_15m * 1.006 : false;
  const trendQuality = 64 + (sott1h?.strongBull ? 8 : 0) + (mlma1h?.bullish ? 6 : 0);
  const expansionQuality = 62 + (twoPole15.buy ? 12 : 0) + clamp((0.2 - Math.abs(twoPole15.value)) * 20, 0, 6);
  const participationQuality = 56 + clamp((volumeRatio - 0.8) * 15, -6, 12) + (touchedValue ? 5 : 0);
  const score = Math.round(trendQuality * 0.32 + expansionQuality * 0.31 + participationQuality * 0.19 + executionQuality * 0.18);

  return {
    candidate: {
      module: 'TWO_POLE_PULLBACK_CONTINUATION',
      entryArchetype: 'Two-Pole pullback continuation',
      score: clamp(score, 0, 100),
      baseRequiredScore: SIGNAL_SCORE_THRESHOLD - 1,
      minVolumeRatio: 0.75,
      tpR: 2.05,
      slAtr: 1.15,
      timeStopHours: 10,
      qualityBreakdown: {
        trend: roundMetric(trendQuality, 1),
        expansion: roundMetric(expansionQuality, 1),
        participation: roundMetric(participationQuality, 1),
        execution: roundMetric(executionQuality, 1)
      },
      reasons: [
        'Two-Pole oscillator reset',
        sott1h?.strongBull ? 'SOTT higher timeframe bullish' : 'Higher timeframe trend supportive',
        touchedValue ? 'Pullback touched value area' : 'Momentum reset above EMA50'
      ]
    }
  };
}

function buildContext(symbol, candles15mRaw, candles1hRaw, candles4hRaw, orderBook, ticker24h, btcContext) {
  const baseAsset = normalizeBaseAsset(symbol, QUOTE_ASSET);
  if (isNonCryptoWrapper(baseAsset)) return { rejectCode: 'UNIVERSE_NON_CRYPTO' };

  const candles15m = getClosedCandles(candles15mRaw, '15m');
  const candles1h = getClosedCandles(candles1hRaw, '60m');
  const candles4h = getClosedCandles(candles4hRaw, '4h');
  if (candles15m.length < 220 || candles1h.length < 120 || candles4h.length < 70) return { rejectCode: 'DATA_MTF_SHORT' };

  const obMetrics = calculateOrderBookMetrics(orderBook);
  if (!obMetrics) return { rejectCode: 'ORDERBOOK_UNAVAILABLE' };

  const quoteVol24h = Number(ticker24h?.quoteVolume || 0);
  if (!Number.isFinite(quoteVol24h) || quoteVol24h < MIN_QUOTE_VOL_24H) return { rejectCode: 'LIQUIDITY_FLOOR' };
  const liquidityTier = classifyLiquidityTier(quoteVol24h, obMetrics.depthQuoteTopN, obMetrics.spreadBps);
  const executionQuality = buildExecutionQuality(liquidityTier, obMetrics.spreadBps, obMetrics.depthQuoteTopN);

  const closes15m = candles15m.map(candle => candle.close);
  const closes1h = candles1h.map(candle => candle.close);
  const closes4h = candles4h.map(candle => candle.close);
  const currentPrice = closes15m[closes15m.length - 1];
  const last15m = candles15m[candles15m.length - 1];
  const atr15m = calculateATR(candles15m, 14);
  const atrPercent15m = atr15m && currentPrice > 0 ? (atr15m / currentPrice) * 100 : null;
  const rsi15m = calculateRSI(closes15m, 14);
  const rsi1h = calculateRSI(closes1h, 14);
  const volumeSMA = calculateVolumeSMA(candles15m, 20);
  const volumeRatio = volumeSMA ? last15m.volume / volumeSMA : 1;
  const deltaRatio = calculateMultiCandleDelta(candles15m, 3);
  const ema21_15m = calculateEMA(closes15m, 21);
  const ema50_15m = calculateEMA(closes15m, 50);
  const ema21_1h = calculateEMA(closes1h, 21);
  const ema50_1h = calculateEMA(closes1h, 50);
  const ema21_4h = calculateEMA(closes4h, 21);
  const ema50_4h = calculateEMA(closes4h, 50);
  const adx15m = calculateADX(candles15m, 14);
  const vwap15m = calculateVWAP(candles15m, 96);
  const bb15m = calculateBollingerBands(closes15m, 20, 2);
  const range20 = getRecentRangeLevels(candles15m, 20);
  const squeeze15 = calculateSqueeze(candles15m, 20, 2, 1.5);
  const macd15 = calculateMACD(closes15m, 12, 26, 9);
  const vidya15 = calculateVIDYA(candles15m, 10, 20, 2);
  const twoPole15 = calculateTwoPoleOscillator(closes15m, 15);
  const mlma1h = calculateMLMA(candles1h, 80, 1.8);
  const sott1h = calculateSOTT(candles1h, 20, 20);
  const smc15 = detectSMC(candles15m, 4);
  const smc1h = detectSMC(candles1h, 4);

  if (![atrPercent15m, rsi15m, rsi1h, currentPrice].every(Number.isFinite) || !macd15 || !vidya15 || !twoPole15) {
    return { rejectCode: 'INDICATOR_GAP' };
  }
  if (atrPercent15m < MIN_ATR_PCT || atrPercent15m > MAX_ATR_PCT) return { rejectCode: 'ATR_FILTER' };

  const bull4h = Number.isFinite(ema21_4h) && Number.isFinite(ema50_4h) && closes4h[closes4h.length - 1] > ema21_4h && ema21_4h > ema50_4h;
  const bull1h = Number.isFinite(ema21_1h) && Number.isFinite(ema50_1h) && closes1h[closes1h.length - 1] > ema21_1h && ema21_1h > ema50_1h;
  const atrPercentile = calculateVolatilityPercentile(candles15m, 14, 80);
  const regime = detectMarketRegime({
    bull4h,
    adx15m: adx15m?.adx,
    atrPercentile,
    btcRisk: btcContext?.status || 'UNKNOWN'
  });
  const rs1h = btcContext?.closes1h ? calculateRelativeStrength(closes1h, btcContext.closes1h, 6) : 0;
  const rs4h = btcContext?.closes4h ? calculateRelativeStrength(closes4h, btcContext.closes4h, 12) : 0;
  const rs24h = Number(ticker24h?.priceChangePercent || 0) - Number(btcContext?.priceChange24h || 0);

  return {
    symbol,
    baseAsset,
    candles15m,
    candles1h,
    candles4h,
    closes15m,
    closes1h,
    closes4h,
    currentPrice,
    last15m,
    atr15m,
    atrPercent15m,
    rsi15m,
    rsi1h,
    volumeRatio,
    deltaRatio,
    ema21_15m,
    ema50_15m,
    ema21_1h,
    ema50_1h,
    ema21_4h,
    ema50_4h,
    bull4h,
    bull1h,
    adx15m,
    atrPercentile,
    vwap15m,
    bb15m,
    range20,
    squeeze15,
    macd15,
    vidya15,
    twoPole15,
    mlma1h,
    sott1h,
    smc15,
    smc1h,
    obMetrics,
    liquidityTier,
    executionQuality,
    quoteVol24h,
    regime,
    rs1h,
    rs4h,
    rs24h,
    btcContext
  };
}

function createSignalFromCandidate(symbol, candidate, ctx, requiredScore) {
  const risk = buildRiskModel(ctx, candidate);
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
    requiredScore,
    regime: ctx.regime,
    type: 'BUY',
    tp: risk.tp,
    sl: risk.sl,
    rsi: roundMetric(ctx.rsi15m, 1),
    rsi1h: roundMetric(ctx.rsi1h, 1),
    atrPercent: roundMetric(ctx.atrPercent15m, 2),
    volumeRatio: roundMetric(ctx.volumeRatio),
    spreadBps: roundMetric(ctx.obMetrics.spreadBps, 1),
    depthQuoteTopN: Math.round(ctx.obMetrics.depthQuoteTopN),
    obi: roundMetric(ctx.obMetrics.obi, 3),
    deltaRatio: roundMetric(ctx.deltaRatio, 3),
    vwap: ctx.vwap15m,
    vwapDistance: ctx.vwap15m ? roundMetric(((ctx.currentPrice - ctx.vwap15m) / ctx.vwap15m) * 100) : null,
    module: candidate.module,
    entryArchetype: candidate.entryArchetype,
    liquidityTier: ctx.liquidityTier,
    sector: getSector(symbol, QUOTE_ASSET),
    expectedHoldingHours: risk.timeStopHours,
    riskModel: {
      slAtr: roundMetric(risk.slAtr, 2),
      tpR: roundMetric(risk.tpR, 2),
      realRR: roundMetric(risk.realRR, 2),
      timeStopHours: risk.timeStopHours
    },
    entryMetrics: {
      atrPercent: roundMetric(ctx.atrPercent15m, 2),
      adx15m: roundMetric(ctx.adx15m?.adx, 1),
      vidyaDistancePct: roundMetric(ctx.vidya15?.distancePct, 2),
      squeezeMomentum: roundMetric(ctx.squeeze15?.momentum, 6),
      macdHist: roundMetric(ctx.macd15?.hist, 8),
      twoPole: roundMetric(ctx.twoPole15?.value, 3),
      smcRangePct: roundMetric(ctx.smc15?.rangePct, 2),
      riskRewardRatio: roundMetric(risk.realRR, 2)
    },
    qualityBreakdown: candidate.qualityBreakdown,
    relativeStrengthSnapshot,
    volumeLiquidityConfirmation,
    reasons: candidate.reasons,
    recommendedSize: calculateRecommendedSize(
      candidate.score,
      ctx.atrPercent15m,
      ctx.regime,
      candidate.module,
      ctx.liquidityTier,
      Math.max(ctx.rs1h, ctx.rs4h)
    ),
    btcContext: ctx.btcContext,
    rejectReasonCode: null,
    version: ALGORITHM_VERSION
  };
}

export function generateSignal(symbol, candles15m, candles1h, candles4h, orderBook, ticker24h, btcContext, analysisState = null, shadowCollector = null) {
  const ctx = buildContext(symbol, candles15m, candles1h, candles4h, orderBook, ticker24h, btcContext);
  if (ctx.rejectCode) {
    countMetric(analysisState?.rejectCounts, ctx.rejectCode);
    return null;
  }

  if (ctx.regime === 'RISK_OFF' || btcContext?.status === 'RED') {
    countMetric(analysisState?.rejectCounts, 'BTC_RED_BLOCK');
    return null;
  }
  countMetric(analysisState?.stageCounts, 'CONTEXT_OK');

  const moduleResults = [
    evaluateVidyaSqueeze(ctx),
    evaluateSMCReclaim(ctx),
    evaluateTwoPoleContinuation(ctx)
  ];

  const candidates = moduleResults
    .map(result => result.candidate)
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    const reject = moduleResults.find(result => result.rejectCode)?.rejectCode || 'NO_MODULE_MATCH';
    countMetric(analysisState?.rejectCounts, reject);
    return null;
  }
  countMetric(analysisState?.stageCounts, 'MODULE_OK');
  for (const candidate of candidates) countMetric(analysisState?.moduleCandidates, candidate.module);

  const best = candidates[0];
  const requiredScore = getRequiredScore(best, ctx);
  const signal = createSignalFromCandidate(symbol, best, ctx, requiredScore);

  const executionReject = getExecutionRejectCode(ctx.obMetrics, ctx.liquidityTier);
  if (executionReject) {
    countMetric(analysisState?.rejectCounts, executionReject);
    if (shadowCollector && signal.score >= requiredScore - 8) shadowCollector.push(recordShadowNearMiss(signal, executionReject));
    return null;
  }
  countMetric(analysisState?.stageCounts, 'EXECUTION_OK');

  if (ctx.volumeRatio < best.minVolumeRatio) {
    countMetric(analysisState?.rejectCounts, 'VOLUME_BELOW_MODULE_FLOOR');
    if (shadowCollector && signal.score >= requiredScore - 8) shadowCollector.push(recordShadowNearMiss(signal, 'VOLUME_BELOW_MODULE_FLOOR'));
    return null;
  }

  if (signal.score < requiredScore) {
    countMetric(analysisState?.rejectCounts, 'SCORE_BELOW_FLOOR');
    if (shadowCollector && signal.score >= requiredScore - 8) shadowCollector.push(recordShadowNearMiss(signal, 'SCORE_BELOW_FLOOR'));
    return null;
  }
  countMetric(analysisState?.stageCounts, 'SCORE_OK');

  if (!signal.riskModel || signal.riskModel.realRR < 1.8) {
    countMetric(analysisState?.rejectCounts, 'RISK_MODEL_RR');
    return null;
  }

  return signal;
}

async function sendTelegramNotification(signals, stats = null) {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[TELEGRAM] disabled or missing credentials');
    return { success: false, reason: 'disabled' };
  }
  if (!signals.length) return { success: true, sent: 0 };

  const esc = value => escapeMarkdownV2(value !== undefined && value !== null ? value : '');
  let message = `🦅 *TRADINGVIEW FUSION BOT* 🦅\n`;
  if (stats) {
    message += `📊 _WR: ${esc(stats.winRate)}% \\| Open: ${esc(stats.open)} \\| W/L: ${esc(stats.wins)}/${esc(stats.losses)}_\n`;
  }
  message += `_${esc(`${ALGORITHM_VERSION} • spot long-only`)}_\n\n`;

  for (const signal of [...signals].sort((a, b) => b.score - a.score).slice(0, 5)) {
    const btcIcon = signal.btcContext?.status === 'GREEN' ? '🟢' : '🟡';
    message += `*${esc(signal.symbol)}* \\| ${esc(signal.module)}\n`;
    message += `${btcIcon} BTC \\| Regime: ${esc(signal.regime)} \\| Score: *${esc(signal.score)}/${esc(signal.requiredScore)}*\n`;
    message += `Entry: ${esc(formatPrice(signal.price))} \\| TP: ${esc(formatPrice(signal.tp))} \\| SL: ${esc(formatPrice(signal.sl))}\n`;
    message += `Liq: ${esc(signal.liquidityTier)} \\| Spread: ${esc(signal.spreadBps)} bps \\| Vol: ${esc(signal.volumeRatio)}x\n`;
    message += `RS 1h/4h: ${esc(signal.relativeStrengthSnapshot?.rs1h)}/${esc(signal.relativeStrengthSnapshot?.rs4h)} \\| Size: ${esc(signal.recommendedSize)}% \\| Stop: ${esc(signal.expectedHoldingHours)}h\n`;
    if (signal.reasons?.length) message += `_ ${esc(signal.reasons.join(' • '))} _\n`;
    message += `──────────────\n`;
  }

  const timeStr = new Date().toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });
  message += `🤖 _Scanner_ • ${esc(timeStr)}`;

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'MarkdownV2'
      })
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[TELEGRAM] API error:', errorText);
      return { success: false, error: errorText };
    }
    return { success: true, sent: signals.length };
  } catch (error) {
    console.error('[TELEGRAM] send error:', error.message);
    return { success: false, error: error.message };
  }
}

export async function runAnalysis(context) {
  const sessionStatus = getTradingSessionStatus();
  if (!sessionStatus.allowed) {
    const messages = [
      `--- Trader Analysis Skipped ${ALGORITHM_VERSION} ---`,
      `[SESSION] ${sessionStatus.reason}`,
      '[SESSION] Trading paused - low liquidity session'
    ];
    messages.forEach(message => console.log(message));
    const existingLogs = await loadPersistentLogs(context);
    await savePersistentLogs([...existingLogs, ...messages.map(message => formatPersistentLogEntry(message))], context);
    return { success: true, signals: 0, reason: sessionStatus.reason, session: 'ASIA_BLOCKED' };
  }

  const canProceed = await acquireRunLock(context);
  if (!canProceed) return { success: false, error: 'Locked' };

  const runId = `TRADER-${Math.floor(Math.random() * 1000000)}`;
  const cycleLogs = [];
  const pLog = message => {
    const entry = formatPersistentLogEntry(message);
    console.log(message);
    cycleLogs.push(entry);
  };

  try {
    pLog(`--- Trader Analysis Started ${ALGORITHM_VERSION} ---`);
    pLog(`Execution ID: ${runId}`);

    const tickers24h = await getAllTickers24h();
    const tickersBySymbol = new Map(tickers24h.map(ticker => [ticker.symbol, ticker]));
    const historyData = await updateSignalHistory(tickers24h, context, pLog);
    const stats = historyData.stats;
    const openSymbols = new Set(historyData.openSymbols);
    const shadowStats = await updateShadowTrades(context, pLog);
    if (shadowStats.total > 0) pLog(`[SHADOW] ${shadowStats.wouldWin}W/${shadowStats.wouldLose}L resolved`);

    let btcContext = { status: 'GREEN', reason: 'BTC fallback', closes4h: [], closes1h: [], priceChange24h: 0 };
    try {
      const btcSymbol = `BTC${QUOTE_ASSET}`;
      const [btc4h, btc1h] = await Promise.all([
        getKlines(btcSymbol, '4h', 120),
        getKlines(btcSymbol, '60m', 160)
      ]);
      btcContext = detectBTCContext(btc4h, btc1h, tickersBySymbol.get(btcSymbol));
      pLog(`[BTC] ${btcContext.status}: ${btcContext.reason}`);
    } catch (error) {
      pLog(`[BTC] fallback: ${error.message}`);
    }

    const cooldowns = await loadCooldowns(context);
    const signalMemory = await loadSignalMemory(context);
    const symbols = selectTopSymbols(tickers24h, QUOTE_ASSET, MAX_SYMBOLS, MIN_QUOTE_VOL_24H, 'momentum');
    const analysisState = { rejectCounts: {}, moduleCandidates: {}, stageCounts: {} };
    const shadowCandidates = [];
    const signals = [];
    const selectedSectors = new Set();
    const selectedSectorLeaders = new Map();
    let analyzed = 0;
    let errors = 0;

    pLog(`[UNIVERSE] Selected ${symbols.length} symbols`);

    for (const symbol of symbols) {
      if (openSymbols.has(symbol)) {
        countMetric(analysisState.rejectCounts, 'OPEN_POSITION_BLOCK');
        continue;
      }
      if (cooldowns[symbol] && Date.now() - cooldowns[symbol] < ALERT_COOLDOWN_MIN * 60000) {
        countMetric(analysisState.rejectCounts, 'COOLDOWN_BLOCK');
        continue;
      }

      try {
        const [candles15m, candles1h, candles4h, orderBook] = await Promise.all([
          getKlines(symbol, '15m', 320),
          getKlines(symbol, '60m', 180),
          getKlines(symbol, '4h', 120),
          getOrderBookDepth(symbol, 20)
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

        if (!signal) {
          await sleep(8);
          continue;
        }

        const protectedSector = isProtectedSector(signal.sector);
        if (protectedSector && selectedSectors.has(signal.sector)) {
          countMetric(analysisState.rejectCounts, 'SECTOR_CORRELATION');
          shadowCandidates.push(recordShadowNearMiss(signal, 'SECTOR_CORRELATION', {
            blockedBySymbol: selectedSectorLeaders.get(signal.sector)
          }));
          await sleep(8);
          continue;
        }

        cooldowns[symbol] = Date.now();
        await saveCooldowns(cooldowns, context);
        await recordSignalHistory(signal, context);
        recordSymbolScore(signalMemory, symbol, signal.score, signal.module);
        signals.push(signal);
        countMetric(analysisState.stageCounts, 'LIVE_SIGNAL');

        if (protectedSector) {
          selectedSectors.add(signal.sector);
          selectedSectorLeaders.set(signal.sector, symbol);
        }

        pLog(`[${runId}] SIGNAL: ${symbol} | ${signal.module} | score ${signal.score}/${signal.requiredScore}`);
        await sleep(8);
      } catch (error) {
        errors++;
        pLog(`[ERROR] ${symbol}: ${error.message}`);
        await sleep(8);
      }
    }

    if (shadowCandidates.length) {
      const existingShadows = await loadShadowTrades(context);
      await saveShadowTrades([...existingShadows, ...shadowCandidates], context);
      pLog(`[SHADOW] Recorded ${shadowCandidates.length} near-misses`);
    }

    await saveSignalMemory(signalMemory, context);

    const stageSummary = toSummaryPairs(analysisState.stageCounts);
    const moduleSummary = toSummaryPairs(analysisState.moduleCandidates);
    const rejectSummary = toSummaryPairs(analysisState.rejectCounts);
    if (stageSummary.length) pLog(`[THROUGHPUT] Stages: ${stageSummary.join(' | ')}`);
    if (moduleSummary.length) pLog(`[THROUGHPUT] Modules: ${moduleSummary.join(' | ')}`);
    if (rejectSummary.length) pLog(`[THROUGHPUT] Rejects: ${rejectSummary.join(' | ')}`);

    const existingLogs = await loadPersistentLogs(context);
    await savePersistentLogs([...existingLogs, ...cycleLogs], context);

    const telegram = signals.length ? await sendTelegramNotification(signals, stats) : { success: true, sent: 0 };

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
      telegram,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    pLog(`[CRITICAL] ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    await releaseRunLock(context);
  }
}

const scheduledHandler = async (event = {}, context = {}) => {
  const method = event && (event.httpMethod || event.method)
    ? String(event.httpMethod || event.method).toUpperCase()
    : '';

  if (!method) {
    const result = await runAnalysis(context);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  }

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
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  let payload = null;
  if (event.body) {
    try {
      payload = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Invalid JSON body' }) };
    }
  }

  const headers = event.headers || {};
  const nfEvent = String(headers['x-nf-event'] || headers['X-NF-Event'] || '').toLowerCase();
  const isSchedule = nfEvent === 'schedule' || typeof payload?.next_run === 'string';
  if (isSchedule) {
    const result = await runAnalysis(context);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  }

  if (NOTIFY_SECRET) {
    const clientSecret = headers['x-notify-secret'] || headers['X-Notify-Secret'] || '';
    if (clientSecret !== NOTIFY_SECRET) {
      return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
    }
  }

  const incomingSignals = Array.isArray(payload?.signals) ? payload.signals : [];
  if (!incomingSignals.length) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'No signals provided' }) };
  }

  const telegram = await sendTelegramNotification(incomingSignals);
  return {
    statusCode: telegram.success ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: telegram.success, telegram })
  };
};

export const handler = schedule("0,15,30,45 * * * *", scheduledHandler);
