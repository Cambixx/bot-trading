/**
 * Netlify Scheduled Function - Advanced Day Trading Analysis
 * Optimized for SPOT DAY TRADING with multi-timeframe confluence
 * Uses MEXC Public API for OHLCV + Order Book metrics
 * 
 * Key Features:
 * - Multi-timeframe analysis (15m + 1h confluence)
 * - Stochastic RSI, ADX, SuperTrend for momentum
 * - Price action patterns detection
 * - Enhanced order flow scoring
 */

import { schedule } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const ALGORITHM_VERSION = 'v7.4.2-SelfLearn';
console.log(`--- DAY TRADE Analysis Module Loaded (${ALGORITHM_VERSION}) ---`);

// Environment Configuration - Optimized for Day Trading
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false';
const SIGNAL_SCORE_THRESHOLD = process.env.SIGNAL_SCORE_THRESHOLD ? Number(process.env.SIGNAL_SCORE_THRESHOLD) : 65;
const MAX_SPREAD_BPS = process.env.MAX_SPREAD_BPS ? Number(process.env.MAX_SPREAD_BPS) : 8;
const MIN_DEPTH_QUOTE = process.env.MIN_DEPTH_QUOTE ? Number(process.env.MIN_DEPTH_QUOTE) : 75000;
const MIN_ATR_PCT = process.env.MIN_ATR_PCT ? Number(process.env.MIN_ATR_PCT) : 0.08;
const MAX_ATR_PCT = process.env.MAX_ATR_PCT ? Number(process.env.MAX_ATR_PCT) : 8;
const QUOTE_ASSET = (process.env.QUOTE_ASSET || 'USDT').toUpperCase();
const MAX_SYMBOLS = process.env.MAX_SYMBOLS ? Number(process.env.MAX_SYMBOLS) : 70; // REDUCED: Better quality over quantity
const MIN_QUOTE_VOL_24H = process.env.MIN_QUOTE_VOL_24H ? Number(process.env.MIN_QUOTE_VOL_24H) : 3000000;
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || '';
const ALERT_COOLDOWN_MIN = process.env.ALERT_COOLDOWN_MIN ? Number(process.env.ALERT_COOLDOWN_MIN) : 240; // INCREASED: 4 hours to avoid overtrading
const USE_MULTI_TF = (process.env.USE_MULTI_TF || 'true').toLowerCase() === 'true';
const AVOID_ASIA_SESSION = (process.env.AVOID_ASIA_SESSION || 'true').toLowerCase() === 'true'; // NEW: Avoid low liquidity sessions

// Persistent cooldown storage using Netlify Blobs
export const COOLDOWN_STORE_KEY = 'signal-cooldowns';
const COOLDOWN_EXPIRY_HOURS = 24;

// ==================== SELF-LEARNING SYSTEM STORES ====================
export const SHADOW_STORE_KEY = 'shadow-trades-v1';
export const SHADOW_ARCHIVE_STORE_KEY = 'shadow-trades-archive-v1';
export const MEMORY_STORE_KEY = 'signal-memory-v1';
export const AUTOPSY_STORE_KEY = 'trade-autopsies-v1';
export const PERSISTENT_LOG_STORE_KEY = 'persistent-logs-v1';
const SHADOW_BENCHMARK_VERSION = 'v1.5-1.2-audited';
const SHADOW_BENCHMARK_TP_PCT = process.env.SHADOW_BENCHMARK_TP_PCT ? Number(process.env.SHADOW_BENCHMARK_TP_PCT) : 0.015;
const SHADOW_BENCHMARK_SL_PCT = process.env.SHADOW_BENCHMARK_SL_PCT ? Number(process.env.SHADOW_BENCHMARK_SL_PCT) : 0.012;

// const lastNotifiedAtByKey = new Map(); // Replaced by Blobs

const MEXC_API = 'https://api.mexc.com/api/v3';

// ==================== PERFORMANCE OPTIMIZATION: CACHING ====================
// Simple in-memory cache for candles (reduces API calls)
const candleCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

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

// Sector classification for correlation analysis
const SECTOR_MAP = {
  'BTC': 'BLUE_CHIP', 'ETH': 'BLUE_CHIP', 'BNB': 'BLUE_CHIP', 'XRP': 'BLUE_CHIP',
  'SOL': 'L1', 'AVAX': 'L1', 'ADA': 'L1', 'DOT': 'L1', 'NEAR': 'L1', 'ATOM': 'L1',
  'DOGE': 'MEME', 'SHIB': 'MEME', 'PEPE': 'MEME', 'FLOKI': 'MEME',
  'LINK': 'DEFI', 'UNI': 'DEFI', 'AAVE': 'DEFI', 'COMP': 'DEFI', 'MKR': 'DEFI',
  'MATIC': 'L2', 'ARB': 'L2', 'OP': 'L2', 'STRK': 'L2',
  'RENDER': 'AI', 'FET': 'AI', 'AGIX': 'AI', 'WLD': 'AI'
};

function getSector(symbol) {
  const base = symbol.replace(QUOTE_ASSET, '');
  return SECTOR_MAP[base] || 'OTHER';
}

function isProtectedSector(sector) {
  return sector && sector !== 'UNKNOWN' && sector !== 'OTHER';
}

// NEW: Session filter - avoid low liquidity periods
function isTradingAllowed() {
  if (!AVOID_ASIA_SESSION) return true;

  // Use UTC time for session checking
  const now = new Date();
  const utcHour = now.getUTCHours();

  // Asia session: 00:00 - 08:00 UTC (roughly)
  // London session: 08:00 - 16:00 UTC
  // NY session: 14:00 - 22:00 UTC
  // Best liquidity: 08:00 - 22:00 UTC (London + NY overlap)

  if (utcHour >= 0 && utcHour < 7) {
    console.log(`[SESSION] Asia session detected (${utcHour}:00 UTC) - trading restricted`);
    return false;
  }

  return true;
}

const FALLBACK_SYMBOLS = [
  `BTC${QUOTE_ASSET}`,
  `ETH${QUOTE_ASSET}`,
  `SOL${QUOTE_ASSET}`,
  `BNB${QUOTE_ASSET}`,
  `XRP${QUOTE_ASSET}`,
  `DOGE${QUOTE_ASSET}`
];

// ==================== HELPERS ====================

function escapeMarkdownV2(text = '') {
  if (typeof text !== 'string') text = String(text);
  // Escape ALL reserved MarkdownV2 characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // Note: We need to escape parentheses \(\) in the regex pattern
  return text.replace(/([_*\u005B\u005D()~`>#+=|{}.!-])/g, '\\$1');
}

async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

  if (candles.length === 1) {
    const only = candles[0];
    const closeTime = Number.isFinite(only?.closeTime)
      ? only.closeTime
      : (Number.isFinite(intervalMs) && Number.isFinite(only?.time) ? (only.time + intervalMs) : null);
    if (!Number.isFinite(closeTime)) return [];
    const toleranceMs = 2000;
    return now < (closeTime - toleranceMs) ? [] : candles;
  }

  const last = candles[candles.length - 1];
  const lastCloseTime = Number.isFinite(last?.closeTime)
    ? last.closeTime
    : (Number.isFinite(intervalMs) && Number.isFinite(last?.time) ? (last.time + intervalMs) : null);

  if (!Number.isFinite(lastCloseTime)) return candles.slice(0, -1);

  const toleranceMs = 2000;
  if (now < (lastCloseTime - toleranceMs)) return candles.slice(0, -1);

  return candles;
}

export function getInternalStore(context) {
  const options = { name: 'trading-signals' };

  // Try to get Site ID from context or environment
  const siteID = context?.site?.id || context?.siteID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  // Try to get Token from context or environment
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

    // Cleanup expired
    const now = Date.now();
    const fresh = {};
    const expiryMs = COOLDOWN_EXPIRY_HOURS * 3600 * 1000;
    for (const [k, ts] of Object.entries(data)) {
      // Logic for backward compatibility with old keys
      if (Number(ts) && (now - Number(ts) < expiryMs)) fresh[k] = ts;
    }
    return fresh;
  } catch (e) {
    console.error('Error loading cooldowns:', e.message);
    return {};
  }
}

// ==================== EXECUTION LOCKING ====================
const RUN_LOCK_KEY = 'global-run-lock';

async function acquireRunLock(context) {
  try {
    const store = getInternalStore(context);
    const lock = await store.get(RUN_LOCK_KEY, { type: 'json' });
    const now = Date.now();

    // If lock is less than 3 minutes old, it's considered active
    if (lock && (now - lock.timestamp < 3 * 60000)) {
      console.warn(`[LOCK] Analysis already in progress (started ${((now - lock.timestamp) / 1000).toFixed(0)}s ago). Aborting.`);
      return false;
    }

    await store.setJSON(RUN_LOCK_KEY, { timestamp: now, id: `run-${now}` });
    return true;
  } catch (error) {
    console.error('[LOCK] Error acquiring lock:', error.message);
    return true; // Proceed anyway on error as fail-safe
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

export async function saveCooldowns(cooldowns, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(COOLDOWN_STORE_KEY, cooldowns);
  } catch (e) {
    console.error('Error saving cooldowns:', e.message);
  }
}

// ==================== SIGNAL HISTORY & BACKTESTING ====================

export const HISTORY_STORE_KEY = 'signal-history-v2';

async function recordSignalHistory(signal, context) {
  try {
    const store = getInternalStore(context);
    const history = await store.get(HISTORY_STORE_KEY, { type: 'json' }) || [];

    // === ENHANCED: Record more metrics for post-analysis ===
    const record = {
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
      hasMSS: !!signal.hasMSS,
      hasSweep: !!signal.hasSweep,
      btcRisk: signal.btcContext?.status || 'UNKNOWN',
      sector: signal.sector || getSector(signal.symbol),
      scoreBeforeMomentum: signal.scoreBeforeMomentum ?? signal.score,
      momentumAdjustment: signal.momentumAdjustment || 0,
      requiredScore: signal.requiredScore || null,
      requiredStrongCategories: signal.requiredStrongCategories || null,

      // Enhanced metrics for analysis
      entryMetrics: signal.entryMetrics || null,
      categoryScores: signal.categoryScores || null,
      volumeRatio: signal.volumeRatio || null,
      strongCategories: signal.strongCategories || null,
      reasons: signal.reasons || []
    };

    history.push(record);
    await store.setJSON(HISTORY_STORE_KEY, history.slice(-200)); // Last 200 signals
  } catch (error) {
    console.error('Error recording history:', error.message);
  }
}

async function updateSignalHistory(tickers, context, pLog = console.log) {
  if (!tickers || !tickers.length) return { open: 0, wins: 0, losses: 0 };

  try {
    const store = getInternalStore(context);
    let history = await store.get(HISTORY_STORE_KEY, { type: 'json' });
    if (!history || !history.length) return { open: 0, wins: 0, losses: 0 };

    const prices = new Map(tickers.map(t => [t.symbol, Number(t.lastPrice)]));
    let updated = false;

    for (const item of history) {
      if (item.status === 'OPEN') {
        const currentPrice = prices.get(item.symbol);
        if (!currentPrice) continue;

        // Initialize maxFavorable if not present
        const entryPrice = item.price || item.entry; // [FIX] Backward compatibility
        if (item.maxFavorable === undefined) item.maxFavorable = entryPrice;

        if (item.type === 'BUY') {
          // Update Max Favorable Excursion
          if (currentPrice > item.maxFavorable) item.maxFavorable = currentPrice;

          // AUDIT v5.2: Break-even logic removed per user request

          if (currentPrice >= item.tp) { item.status = 'CLOSED'; item.outcome = 'WIN'; updated = true; recordTradeAutopsy(item, context); }
          else if (currentPrice <= item.sl) {
            item.status = 'CLOSED';
            item.outcome = 'LOSS';
            updated = true;
            recordTradeAutopsy(item, context);
          }

        } else {
          // SELL LOGIC
          if (currentPrice < item.maxFavorable) item.maxFavorable = currentPrice;

          // AUDIT v5.2: Break-even logic removed per user request

          if (currentPrice <= item.tp) { item.status = 'CLOSED'; item.outcome = 'WIN'; updated = true; recordTradeAutopsy(item, context); }
          else if (currentPrice >= item.sl) {
            item.status = 'CLOSED';
            item.outcome = 'LOSS';
            updated = true;
            recordTradeAutopsy(item, context);
          }
        }

        // AUDIT v3.0: Early exit if no favorable movement after 12 hours
        // Historical data: 50% of LOSS trades never moved in favorable direction
        const hoursOpen = (Date.now() - item.time) / 3600000;
        const favorableMove = item.type === 'BUY'
          ? (item.maxFavorable - entryPrice) / entryPrice
          : (entryPrice - item.maxFavorable) / entryPrice;

        if (item.status === 'OPEN' && hoursOpen > 12 && favorableMove < 0.003) {
          item.status = 'CLOSED';
          item.outcome = 'STALE_EXIT';
          updated = true;
          recordTradeAutopsy(item, context);
          pLog(`[STALE_EXIT] ${item.symbol}: ${hoursOpen.toFixed(1)}h open, favorable move only ${(favorableMove * 100).toFixed(2)}%`);
        }
        // Auto-expire after 48 hours
        else if (item.status === 'OPEN' && Date.now() - item.time > 48 * 3600 * 1000) {
          item.status = 'EXPIRED';
          updated = true;
        }
      }
    }

    if (updated) await store.setJSON(HISTORY_STORE_KEY, history);

    const closed = history.filter(h => h.status === 'CLOSED');
    // Win Rate Calculation considering BE as neutral (excludes from denominator or counts as 0.5?)
    // Standard approach: BE doesn't count as Loss, but not a Win either. 
    // Win Rate = Wins / (Wins + Losses). BE excluded.
    const wins = closed.filter(h => h.outcome === 'WIN').length;
    const losses = closed.filter(h => h.outcome === 'LOSS' || h.outcome === 'STALE_EXIT').length;
    const bes = closed.filter(h => h.outcome === 'BREAK_EVEN').length;
    const staleExits = closed.filter(h => h.outcome === 'STALE_EXIT').length;

    const totalDecisive = wins + losses;
    const winRate = totalDecisive > 0 ? (wins / totalDecisive * 100).toFixed(1) : 0;
    const openSignals = history.filter(h => h.status === 'OPEN');

    return {
      stats: {
        open: openSignals.length,
        wins,
        losses,
        bes,
        staleExits,
        winRate
      },
      openSymbols: openSignals.map(s => s.symbol)
    };
  } catch (error) {
    console.error('Error updating history:', error.message);
    return { stats: { open: 0, wins: 0, losses: 0, winRate: 0 }, openSymbols: [] };
  }
}

// ==================== SHADOW TRADING SYSTEM ====================
// Records "near-miss" candidates that were rejected, then tracks what happened

export async function loadShadowTrades(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(SHADOW_STORE_KEY, { type: 'json' });
    if (!data) return [];
    // Cleanup old entries (> 48h)
    const now = Date.now();
    return data.filter(s => now - s.timestamp < 48 * 3600 * 1000);
  } catch (e) {
    console.error('[SHADOW] Error loading:', e.message);
    return [];
  }
}

export async function loadShadowTradeArchive(context) {
  try {
    const store = getInternalStore(context);
    return await store.get(SHADOW_ARCHIVE_STORE_KEY, { type: 'json' }) || [];
  } catch (e) {
    console.error('[SHADOW_ARCHIVE] Error loading:', e.message);
    return [];
  }
}

async function saveShadowTrades(shadows, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(SHADOW_STORE_KEY, shadows.slice(-100)); // Keep last 100 pending near-misses
  } catch (e) {
    console.error('[SHADOW] Error saving:', e.message);
  }
}

async function saveShadowTradeArchive(shadows, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(SHADOW_ARCHIVE_STORE_KEY, shadows);
  } catch (e) {
    console.error('[SHADOW_ARCHIVE] Error saving:', e.message);
  }
}

async function archiveResolvedShadowTrades(shadows, context, pLog = console.log) {
  const settled = shadows.filter(s => s.outcome !== 'PENDING');
  if (!settled.length) return shadows;

  const resolvedToArchive = settled.filter(s => !s.archivedAt);
  if (resolvedToArchive.length) {
    const archive = await loadShadowTradeArchive(context);
    const archiveIds = new Set(archive.map(s => s.id));
    const archivedAt = Date.now();
    const newArchiveEntries = [];

    for (const shadow of resolvedToArchive) {
      shadow.archivedAt = shadow.archivedAt || archivedAt;
      if (!archiveIds.has(shadow.id)) {
        archiveIds.add(shadow.id);
        newArchiveEntries.push({ ...shadow });
      }
    }

    if (newArchiveEntries.length > 0) {
      await saveShadowTradeArchive([...archive, ...newArchiveEntries], context);
      pLog(`[SHADOW_ARCHIVE] Archived ${newArchiveEntries.length} resolved near-misses`);
    }
  }

  const activePendingOnly = shadows.filter(s => s.outcome === 'PENDING');
  const prunedCount = shadows.length - activePendingOnly.length;
  if (prunedCount > 0) {
    pLog(`[SHADOW] Pruned ${prunedCount} resolved near-misses from active window`);
  }

  return activePendingOnly;
}

function recordShadowNearMiss(symbol, score, price, regime, rejectReason, btcContext, entryMetrics, categoryScores, meta = {}) {
  // Returns a shadow trade object (saved in batch at end of cycle)
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
    rejectReason,
    btcRisk: btcContext?.status || 'UNKNOWN',
    sector: meta.sector || getSector(symbol),
    blockedBySector: meta.blockedBySector || null,
    blockedBySymbol: meta.blockedBySymbol || null,
    timestamp: now,
    entryMetrics: entryMetrics || null,
    categoryScores: categoryScores || null,
    shadowBenchmark: {
      version: meta.shadowBenchmarkVersion || SHADOW_BENCHMARK_VERSION,
      tpPct: benchmarkTpPct,
      slPct: benchmarkSlPct
    },
    // These get filled in later by updateShadowTrades
    priceAfter4h: null,
    priceAfter12h: null,
    wouldHaveTP: null,
    wouldHaveSL: null,
    outcome: 'PENDING', // PENDING → WOULD_WIN / WOULD_LOSE / EXPIRED
    resolvedAt: null,
    archivedAt: null
  };
}

async function updateShadowTrades(tickers, context, pLog = console.log) {
  try {
    let shadows = await loadShadowTrades(context);
    if (!shadows.length) return { total: 0, wouldWin: 0, wouldLose: 0 };

    const alreadyResolved = shadows.filter(s => s.outcome !== 'PENDING' && s.outcome !== 'EXPIRED');
    if (shadows.some(s => s.outcome !== 'PENDING')) {
      const activePendingOnly = await archiveResolvedShadowTrades(shadows, context, pLog);
      if (activePendingOnly.length !== shadows.length) {
        shadows = activePendingOnly;
        await saveShadowTrades(shadows, context);
      } else {
        shadows = activePendingOnly;
      }
    }

    const pendingShadows = shadows.filter(s => s.outcome === 'PENDING');
    if (!pendingShadows.length) {
      const wouldWin = alreadyResolved.filter(s => s.outcome === 'WOULD_WIN').length;
      const wouldLose = alreadyResolved.filter(s => s.outcome === 'WOULD_LOSE').length;
      return { total: alreadyResolved.length, wouldWin, wouldLose };
    }

    // Group pending by symbol to minimize API calls
    const symbols = [...new Set(pendingShadows.map(s => s.symbol))];
    const tickerMap = new Map(tickers.map(t => [t.symbol, t]));
    let updated = false;

    for (const symbol of symbols) {
      try {
        const symbolShadows = pendingShadows.filter(s => s.symbol === symbol);
        // Get 15m candles (last 200 cover 50 hours, enough for 48h limit)
        const candles = await getKlines(symbol, '15m', 200).catch(() => null);
        if (!candles) continue;

        for (const shadow of symbolShadows) {
          const entryTime = shadow.timestamp;
          const entryPrice = shadow.price;

          // Use audited multipliers to be consistent with generation
          const tpMultiplier = 3.0;
          const slMultiplier = 1.8;
          const atrPctAtEntry = shadow.atrPercent || 0.5; // Fallback

          const tpLevel = entryPrice * (1 + (shadow.shadowBenchmark?.tpPct || (atrPctAtEntry / 100 * tpMultiplier)));
          const slLevel = entryPrice * (1 - (shadow.shadowBenchmark?.slPct || (atrPctAtEntry / 100 * slMultiplier)));

          // Analyze future candles
          const futureCandles = candles.filter(c => c.time > entryTime);

          for (const candle of futureCandles) {
            const hitTP = candle.high >= tpLevel;
            const hitSL = candle.low <= slLevel;

            if (hitTP && hitSL) {
              // Both hit in same candle? Be conservative: mark as LOSS or check open/close
              shadow.outcome = (candle.close > candle.open) ? 'WOULD_WIN' : 'WOULD_LOSE';
              shadow.wouldHaveTP = shadow.outcome === 'WOULD_WIN';
              shadow.wouldHaveSL = shadow.outcome === 'WOULD_LOSE';
              shadow.resolvedAt = Date.now();
              updated = true;
              break;
            } else if (hitTP) {
              shadow.outcome = 'WOULD_WIN';
              shadow.wouldHaveTP = true;
              shadow.wouldHaveSL = false;
              shadow.resolvedAt = Date.now();
              updated = true;
              break;
            } else if (hitSL) {
              shadow.outcome = 'WOULD_LOSE';
              shadow.wouldHaveTP = false;
              shadow.wouldHaveSL = true;
              shadow.resolvedAt = Date.now();
              updated = true;
              break;
            }
          }

          // If still pending after 48h, mark as EXPIRED
          if (shadow.outcome === 'PENDING' && (Date.now() - shadow.timestamp > 48 * 3600 * 1000)) {
            shadow.outcome = 'EXPIRED';
            shadow.resolvedAt = Date.now();
            updated = true;
          }
        }
      } catch (err) {
        console.error(`[SHADOW] Error resolving ${symbol}:`, err.message);
      }
    }

    if (updated) {
      const resolvedBeforeCleanup = shadows.filter(s => s.outcome !== 'PENDING' && s.outcome !== 'EXPIRED');
      shadows = await archiveResolvedShadowTrades(shadows, context, pLog);
      await saveShadowTrades(shadows, context);

      const wouldWin = resolvedBeforeCleanup.filter(s => s.outcome === 'WOULD_WIN').length;
      const wouldLose = resolvedBeforeCleanup.filter(s => s.outcome === 'WOULD_LOSE').length;
      return { total: resolvedBeforeCleanup.length, wouldWin, wouldLose };
    }

    const resolved = shadows.filter(s => s.outcome !== 'PENDING' && s.outcome !== 'EXPIRED');
    const wouldWin = resolved.filter(s => s.outcome === 'WOULD_WIN').length;
    const wouldLose = resolved.filter(s => s.outcome === 'WOULD_LOSE').length;

    return { total: resolved.length, wouldWin, wouldLose };
  } catch (e) {
    console.error('[SHADOW] Error updating:', e.message);
    return { total: 0, wouldWin: 0, wouldLose: 0 };
  }
}

// ==================== SIGNAL MEMORY (CROSS-CYCLE MOMENTUM) ====================
// Tracks scores per symbol across cycles to detect momentum vs. spikes

async function loadSignalMemory(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(MEMORY_STORE_KEY, { type: 'json' });
    if (!data) return {};

    // Cleanup entries older than 2 hours
    const now = Date.now();
    const fresh = {};
    for (const [symbol, entries] of Object.entries(data)) {
      const validEntries = entries.filter(e => now - e.timestamp < 2 * 3600 * 1000);
      if (validEntries.length > 0) fresh[symbol] = validEntries;
    }
    return fresh;
  } catch (e) {
    console.error('[MEMORY] Error loading:', e.message);
    return {};
  }
}

async function saveSignalMemory(memory, context) {
  try {
    const store = getInternalStore(context);
    await store.setJSON(MEMORY_STORE_KEY, memory);
  } catch (e) {
    console.error('[MEMORY] Error saving:', e.message);
  }
}

function recordSymbolScore(memory, symbol, score, regime) {
  if (!memory[symbol]) memory[symbol] = [];

  memory[symbol].push({
    score,
    regime,
    timestamp: Date.now()
  });

  // Keep only last 8 entries per symbol
  if (memory[symbol].length > 8) {
    memory[symbol] = memory[symbol].slice(-8);
  }
}

function calculateMomentumAdjustment(memory, symbol, pLog = console.log) {
  const entries = memory[symbol];
  if (!entries || entries.length < 3) return { adjustment: 0, reason: null };

  // Get last 4 scores
  const recent = entries.slice(-4).map(e => e.score);

  // Check for consistent upward momentum
  let risingCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) risingCount++;
  }

  // Consistent rising (3 out of 3 comparisons for 4 entries, or 2 out of 2 for 3 entries)
  const isRising = risingCount >= recent.length - 1;

  // Check for suspicious spike (score jumped 25+ points in one cycle)
  const lastTwo = recent.slice(-2);
  const isSpike = lastTwo.length === 2 && (lastTwo[1] - lastTwo[0]) >= 25;

  if (isRising && recent.length >= 3) {
    const totalGain = recent[recent.length - 1] - recent[0];
    if (totalGain >= 10) {
      pLog(`[MEMORY] 📈 ${symbol}: Momentum rising (${recent.join('→')}) +3 bonus`);
      return { adjustment: 3, reason: `📈 Momentum (${recent.join('→')})` };
    }
  }

  if (isSpike) {
    pLog(`[MEMORY] ⚠️ ${symbol}: Score spike detected (${lastTwo[0]}→${lastTwo[1]}) -5 penalty`);
    return { adjustment: -5, reason: `⚠️ Spike (${lastTwo[0]}→${lastTwo[1]})` };
  }

  return { adjustment: 0, reason: null };
}

// ==================== POST-TRADE AUTOPSY ====================
// Records diagnostic data when trades close for performance analysis

async function recordTradeAutopsy(item, context) {
  try {
    const store = getInternalStore(context);
    const autopsies = await store.get(AUTOPSY_STORE_KEY, { type: 'json' }) || [];

    const entryPrice = item.price || item.entry;
    const hoursOpen = (Date.now() - item.time) / 3600000;
    const favorableMove = item.type === 'BUY'
      ? ((item.maxFavorable || entryPrice) - entryPrice) / entryPrice
      : (entryPrice - (item.maxFavorable || entryPrice)) / entryPrice;

    const autopsy = {
      id: item.id,
      symbol: item.symbol,
      outcome: item.outcome,
      regime: item.regime || 'UNKNOWN',
      btcRisk: item.btcRisk || 'UNKNOWN',
      score: item.score || 0,
      sector: item.sector || getSector(item.symbol),
      scoreBeforeMomentum: item.scoreBeforeMomentum ?? item.score ?? 0,
      momentumAdjustment: item.momentumAdjustment || 0,
      requiredScore: item.requiredScore || null,
      requiredStrongCategories: item.requiredStrongCategories || null,
      hoursOpen: Number(hoursOpen.toFixed(1)),
      favorableMovePct: Number((favorableMove * 100).toFixed(2)),
      hasMSS: !!item.hasMSS,
      hasSweep: !!item.hasSweep,
      entryMetrics: item.entryMetrics || null,
      categoryScores: item.categoryScores || null,
      volumeRatio: item.volumeRatio || null,
      closedAt: Date.now()
    };

    autopsies.push(autopsy);
    await store.setJSON(AUTOPSY_STORE_KEY, autopsies.slice(-200)); // Keep last 200

    const icon = item.outcome === 'WIN' ? '✅' : item.outcome === 'LOSS' ? '❌' : '⏸️';
    console.log(`[AUTOPSY] ${icon} ${item.symbol}: ${item.outcome} | Score=${item.score} | Regime=${item.regime} | Hours=${hoursOpen.toFixed(1)} | MaxFav=${(favorableMove * 100).toFixed(2)}%`);
  } catch (e) {
    console.error('[AUTOPSY] Error recording:', e.message);
  }
}

// ==================== PERSISTENT LOGGING SYSTEM ====================
// Stores critical run events in Netlify Blobs to overcome short log retention
// Essential for remote audits when Netlify logs are already rotated

export async function loadPersistentLogs(context) {
  try {
    const store = getInternalStore(context);
    const data = await store.get(PERSISTENT_LOG_STORE_KEY, { type: 'json' });
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('[PLOG] Error loading:', e.message);
    return [];
  }
}

async function savePersistentLogs(logs, context) {
  try {
    const store = getInternalStore(context);
    // Keep last 4,000 lines (approx 2 weeks of history if logging 200 lines per run @ 15m)
    // Actually, each run logs about 10-20 lines, so 4000 lines is a lot of history.
    await store.setJSON(PERSISTENT_LOG_STORE_KEY, logs.slice(-4000));
  } catch (e) {
    console.error('[PLOG] Error saving:', e.message);
  }
}

// ==================== MARKET DATA ====================

async function getKlines(symbol, interval = '15m', limit = 200) {
  const cacheKey = `${symbol}-${interval}-${limit}`;
  const cached = getCachedCandles(cacheKey);
  if (cached) {
    console.log(`[CACHE] Hit for ${cacheKey}`);
    return cached;
  }

  const url = `${MEXC_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'No body');
    throw new Error(`MEXC HTTP error: ${response.status} - ${errorBody}`);
  }

  const json = await response.json();
  if (!Array.isArray(json)) {
    throw new Error(`MEXC: Invalid klines response for ${symbol}`);
  }

  const intervalMs = intervalToMs(interval);

  const candles = json.map(candle => {
    const openTime = Number(candle[0]);
    const closeTimeRaw = candle[6] ? Number(candle[6]) : null;
    const closeTime = Number.isFinite(closeTimeRaw) && Number.isFinite(openTime) && Number.isFinite(intervalMs)
      ? (closeTimeRaw >= openTime && closeTimeRaw <= (openTime + intervalMs * 2) ? closeTimeRaw : null)
      : (Number.isFinite(closeTimeRaw) ? closeTimeRaw : null);

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
  }).filter(c => validateCandle(c));

  // Cache the result
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
  const stableBases = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI', 'EUR', 'GBP']);

  const btcTicker = tickers.find(t => t.symbol === `BTC${quoteAsset}`);
  const btcChange = btcTicker ? Number(btcTicker.priceChangePercent || 0) : 0;

  const candidates = tickers
    .filter(t => typeof t.symbol === 'string' && t.symbol.endsWith(quoteAsset))
    .filter(t => {
      const base = t.symbol.slice(0, -quoteAsset.length);
      if (!base || stableBases.has(base)) return false;
      if (base.endsWith('UP') || base.endsWith('DOWN') || base.endsWith('BULL') || base.endsWith('BEAR')) return false;

      const quoteVol = Number(t.quoteVolume);
      return Number.isFinite(quoteVol) && quoteVol >= minQuoteVolume;
    })
    .map(t => {
      const high = Number(t.highPrice || 0);
      const low = Number(t.lowPrice || 0);
      const volume = Number(t.quoteVolume || 0);

      const volatility = low > 0 ? ((high - low) / low) * 100 : 0;
      const priceChange = Number(t.priceChangePercent || 0);

      // Relative Strength 24h factor
      const rs24h = priceChange - btcChange;

      // opportunityScore (v7.0): Prioritize Volume > RS24h > Volatility
      const opportunityScore = (Math.log10(volume) * 0.4) + (rs24h * 0.4) + (volatility * 0.2);

      return { symbol: t.symbol, opportunityScore, volatility, priceChange, rs24h };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, limit);

  console.log(`Smart Selection v7.0: Top ${candidates.length} coins selected (Avg RS24h: ${(candidates.reduce((a, b) => a + b.rs24h, 0) / candidates.length).toFixed(2)}%)`);
  return candidates.map(t => t.symbol);
}

// ==================== TECHNICAL INDICATORS ====================

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

  const firstRSI = avgLoss === 0 ? 100 : (100 - (100 / (1 + (avgGain / avgLoss))));
  series[period] = firstRSI;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    const rsi = avgLoss === 0 ? 100 : (100 - (100 / (1 + (avgGain / avgLoss))));
    series[i] = rsi;
  }

  return series;
}

function calculateRSI(closes, period = 14) {
  const series = calculateRSISeries(closes, period);
  if (!series) return null;

  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (Number.isFinite(v)) return v;
  }

  return null;
}

function calculateEMA(data, period) {
  if (data.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateEMASeries(data, period) {
  if (!Array.isArray(data) || data.length === 0) return null;
  if (data.length < period) return null;

  const multiplier = 2 / (period + 1);
  const result = new Array(data.length).fill(null);

  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
    result[i] = ema;
  }

  return result;
}

// NEW: Calculate EMA slope for trend strength
function calculateEMASlope(closes, period = 50) {
  const emaSeries = calculateEMASeries(closes, period);
  if (!emaSeries || emaSeries.length < period + 10) return null;

  const validEmas = emaSeries.filter(v => v !== null);
  if (validEmas.length < 10) return null;

  const recent = validEmas.slice(-10);
  const slope = (recent[recent.length - 1] - recent[0]) / recent[0];
  return slope;
}

function calculateMACD(closes) {
  const ema12Series = calculateEMASeries(closes, 12);
  const ema26Series = calculateEMASeries(closes, 26);
  if (!ema12Series || !ema26Series) return null;

  const macdSeries = closes.map((_, idx) => {
    const e12 = ema12Series[idx];
    const e26 = ema26Series[idx];
    if (e12 === null || e26 === null) return null;
    return e12 - e26;
  });

  const macdValues = macdSeries.filter(v => v !== null);
  if (macdValues.length < 9) return null;

  const signalSeriesCompact = calculateEMASeries(macdValues, 9);
  if (!signalSeriesCompact) return null;
  const signal = signalSeriesCompact[signalSeriesCompact.length - 1];
  const macd = macdValues[macdValues.length - 1];
  if (!Number.isFinite(macd) || !Number.isFinite(signal)) return null;

  const histogram = macd - signal;

  return {
    macd,
    signal,
    histogram,
    bullish: histogram > 0
  };
}

function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
  const sd = Math.sqrt(variance);

  return {
    upper: mean + (stdDev * sd),
    middle: mean,
    lower: mean - (stdDev * sd)
  };
}

function calculateATR(candles, period = 14) {
  const series = calculateATRSeries(candles, period);
  if (!series) return null;

  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (Number.isFinite(v)) return v;
  }

  return null;
}

function calculateVolumeSMA(candles, period = 20) {
  if (candles.length < period) return null;
  const volumes = candles.slice(-period).map(c => c.volume);
  return volumes.reduce((a, b) => a + b, 0) / period;
}

function calculateVWAP(candles, lookback = 50) {
  if (!candles || candles.length < Math.min(lookback, 5)) return null;

  const slice = candles.slice(-lookback);
  let pv = 0;
  let v = 0;
  for (const c of slice) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    v += c.volume;
  }
  if (v === 0) return null;
  return pv / v;
}

function calculateStochasticRSI(closes, rsiPeriod = 14, stochasticPeriod = 14, smoothK = 3, smoothD = 3) {
  if (closes.length < rsiPeriod + stochasticPeriod) return null;

  const rsiSeries = calculateRSISeries(closes, rsiPeriod);
  if (!rsiSeries) return null;

  const rsiWindow = [];
  for (let i = rsiSeries.length - 1; i >= 0 && rsiWindow.length < stochasticPeriod; i--) {
    const v = rsiSeries[i];
    if (Number.isFinite(v)) rsiWindow.unshift(v);
  }

  if (rsiWindow.length < stochasticPeriod) return null;

  const lowest = Math.min(...rsiWindow);
  const highest = Math.max(...rsiWindow);
  const currentRSI = rsiWindow[rsiWindow.length - 1];

  if (highest === lowest) return null;

  const rawK = ((currentRSI - lowest) / (highest - lowest)) * 100;

  return {
    k: rawK,
    d: rawK,
    oversold: rawK < 20,
    overbought: rawK > 80
  };
}

function calculateADX(candles, period = 14) {
  if (!candles || candles.length < (period * 2 + 1)) return null;

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
  let plusDM14 = plusDMSum;
  let minusDM14 = minusDMSum;

  const dxSeries = new Array(candles.length).fill(null);

  for (let i = period; i < candles.length; i++) {
    if (i > period) {
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

      atr = atr - (atr / period) + tr;
      plusDM14 = plusDM14 - (plusDM14 / period) + plusDM;
      minusDM14 = minusDM14 - (minusDM14 / period) + minusDM;
    }

    if (!Number.isFinite(atr) || atr <= 0) continue;

    const plusDI = (plusDM14 / atr) * 100;
    const minusDI = (minusDM14 / atr) * 100;
    const denom = plusDI + minusDI;
    if (!Number.isFinite(denom) || denom === 0) continue;

    const dx = (Math.abs(plusDI - minusDI) / denom) * 100;
    if (!Number.isFinite(dx)) continue;
    dxSeries[i] = dx;
  }

  let adx = null;
  const firstADXIndex = period * 2;
  let dxSum = 0;
  for (let i = period; i < firstADXIndex; i++) {
    const dx = dxSeries[i];
    if (!Number.isFinite(dx)) return null;
    dxSum += dx;
  }
  adx = dxSum / period;

  for (let i = firstADXIndex; i < candles.length; i++) {
    const dx = dxSeries[i];
    if (!Number.isFinite(dx) || adx === null) continue;
    adx = ((adx * (period - 1)) + dx) / period;
  }

  if (adx === null || !Number.isFinite(adx)) return null;

  if (!Number.isFinite(atr) || atr <= 0) return null;
  const plusDI = (plusDM14 / atr) * 100;
  const minusDI = (minusDM14 / atr) * 100;
  if (!Number.isFinite(plusDI) || !Number.isFinite(minusDI)) return null;

  return {
    adx,
    plusDI,
    minusDI,
    trending: adx > 20,
    bullishTrend: plusDI > minusDI,
    bearishTrend: minusDI > plusDI
  };
}

function calculateMysticPulse(candles, period = 14) {
  if (!candles || candles.length < (period * 2 + 50)) return null;

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
  let plusDM14 = plusDMSum;
  let minusDM14 = minusDMSum;

  const validPosData = [];
  const validNegData = [];

  let positive_count = 0;
  let negative_count = 0;

  for (let i = period + 1; i < candles.length; i++) {
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

    atr = atr - (atr / period) + tr;
    plusDM14 = plusDM14 - (plusDM14 / period) + plusDM;
    minusDM14 = minusDM14 - (minusDM14 / period) + minusDM;

    if (!Number.isFinite(atr) || atr <= 0) {
      if (i >= period * 2) {
        validPosData.push(positive_count);
        validNegData.push(negative_count);
      }
      continue;
    }

    const plus = (plusDM14 / atr) * 100;
    const minus = (minusDM14 / atr) * 100;

    if (plus > minus) {
      positive_count += (plus - minus);
      negative_count = 0;
    } else if (minus > plus) {
      negative_count += (minus - plus);
      positive_count = 0;
    } else {
      positive_count = 0;
      negative_count = 0;
    }

    if (i >= period * 2) {
      validPosData.push(positive_count);
      validNegData.push(negative_count);
    }
  }

  const emaPosArr = calculateEMASeries(validPosData, period);
  const emaNegArr = calculateEMASeries(validNegData, period);

  if (!emaPosArr || !emaNegArr || emaPosArr.length < 2) return null;

  const lastIndex = emaPosArr.length - 1;
  const emaPos = emaPosArr[lastIndex];
  const emaNeg = emaNegArr[lastIndex];
  const prevEmaPos = emaPosArr[lastIndex - 1];
  const prevEmaNeg = emaNegArr[lastIndex - 1];

  return {
    emaPos,
    emaNeg,
    prevEmaPos,
    prevEmaNeg,
    bullishCross: prevEmaPos <= prevEmaNeg && emaPos > emaNeg,
    bearishCross: prevEmaNeg <= prevEmaPos && emaNeg > emaPos,
    bullish: emaPos > emaNeg,
    bearish: emaNeg > emaPos,
    momentumSpread: emaPos - emaNeg
  };
}

function calculateCMF(candles, period = 20) {
  if (!candles || candles.length < period) return null;

  const series = [];
  let adSum = 0;

  // Calculate Money Flow Multiplier and Volume for each candle
  const moneyFlowVol = candles.map(c => {
    const range = c.high - c.low;
    if (range === 0) return 0;

    // MFM = ((Close - Low) - (High - Close)) / (High - Low)
    const mfm = ((c.close - c.low) - (c.high - c.close)) / range;
    return mfm * c.volume;
  });

  // Calculate CMF for the latest candle
  if (moneyFlowVol.length < period) return null;

  let volSum = 0;
  let mfSum = 0;

  // Simple sum for the lookback period
  for (let i = moneyFlowVol.length - period; i < moneyFlowVol.length; i++) {
    mfSum += moneyFlowVol[i];
    volSum += candles[i].volume;
  }

  if (volSum === 0) return 0;
  return mfSum / volSum;
}

function calculateATRSeries(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;

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
  if (!Number.isFinite(atr) || atr === 0) return null;
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

function calculateSuperTrend(candles, period = 10, multiplier = 3) {
  if (!candles || candles.length < period + 1) return null;

  const atrSeries = calculateATRSeries(candles, period);
  if (!atrSeries) return null;

  let finalUpper = null;
  let finalLower = null;
  let superTrend = null;
  let direction = 1;
  let prevDirection = null;
  let flipped = false;

  for (let i = 0; i < candles.length; i++) {
    const atr = atrSeries[i];
    if (atr === null) continue;

    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUpper = hl2 + (multiplier * atr);
    const basicLower = hl2 - (multiplier * atr);

    if (finalUpper === null || finalLower === null || superTrend === null) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      const close = candles[i].close;
      superTrend = close <= finalUpper ? finalUpper : finalLower;
      direction = superTrend === finalLower ? 1 : -1;
      prevDirection = direction;
      flipped = false;
      continue;
    }

    const prevClose = candles[i - 1].close;
    finalUpper = (basicUpper < finalUpper || prevClose > finalUpper) ? basicUpper : finalUpper;
    finalLower = (basicLower > finalLower || prevClose < finalLower) ? basicLower : finalLower;

    const close = candles[i].close;
    if (superTrend === finalUpper) {
      superTrend = close <= finalUpper ? finalUpper : finalLower;
    } else {
      superTrend = close >= finalLower ? finalLower : finalUpper;
    }

    direction = superTrend === finalLower ? 1 : -1;
    flipped = prevDirection !== null && direction !== prevDirection;
    prevDirection = direction;
  }

  if (superTrend === null || finalUpper === null || finalLower === null) return null;

  return {
    superTrend,
    direction,
    bullish: direction === 1,
    bearish: direction === -1,
    flipped,
    upperBand: finalUpper,
    lowerBand: finalLower
  };
}

function calculateSimpleVolumeProfile(candles, lookback = 200) {
  if (!candles || candles.length < 50) return null;
  const data = candles.slice(-lookback);

  let min = Infinity, max = -Infinity;
  data.forEach(c => {
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  });

  if (min === max) return null;

  const bins = 24;
  const binSize = (max - min) / bins;
  const volumeProfile = new Array(bins).fill(0);

  data.forEach(c => {
    // Distribute volume across bins intersected by candle
    const startBin = Math.floor((c.low - min) / binSize);
    const endBin = Math.floor((c.high - min) / binSize);
    // Simple approach: add full volume to midpoint bin (faster)
    const mid = (c.low + c.high) / 2;
    const binIndex = Math.floor((mid - min) / binSize);
    if (binIndex >= 0 && binIndex < bins) {
      volumeProfile[binIndex] += Number(c.volume);
    }
  });

  let maxVol = 0;
  let pocIndex = 0;
  volumeProfile.forEach((vol, i) => {
    if (vol > maxVol) {
      maxVol = vol;
      pocIndex = i;
    }
  });

  const pocPrice = min + (pocIndex + 0.5) * binSize;
  return { poc: pocPrice, min, max };
}

// ==================== SWING STRUCTURE BANDS (ChartPrime) ====================
// Optimized Helper with State
function calculateSwingStructureBands(candles, lenSwing = 100) {
  if (!candles || candles.length < lenSwing + 50) return null; // Need warmup

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const atrSeries = calculateATRSeries(candles, 200);
  if (!atrSeries || !atrSeries[candles.length - 1]) return null;

  // Pine State Variables
  let lh = 1;
  let ll = 1;
  let dir = 0;

  // History for previous values
  const maHiHistory = new Array(candles.length).fill(0);
  const maLoHistory = new Array(candles.length).fill(0);
  const ubSeries = new Array(candles.length).fill(NaN); // Upper Band Middle
  const lbSeries = new Array(candles.length).fill(NaN); // Lower Band Middle
  const ucSeries = new Array(candles.length).fill(0); // Upper Count
  const lcSeries = new Array(candles.length).fill(0); // Lower Count

  // Helper for Highest/Lowest/SMA over window
  const getHighest = (arr, len, idx) => {
    let max = -Infinity;
    const start = Math.max(0, idx - len + 1);
    for (let k = start; k <= idx; k++) if (arr[k] > max) max = arr[k];
    return max;
  };
  const getLowest = (arr, len, idx) => {
    let min = Infinity;
    const start = Math.max(0, idx - len + 1);
    for (let k = start; k <= idx; k++) if (arr[k] < min) min = arr[k];
    return min;
  };
  const getSma = (arr, len, idx) => {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, idx - len + 1);
    for (let k = start; k <= idx; k++) { sum += arr[k]; count++; }
    return count ? sum / count : 0;
  };

  // Main Loop
  for (let i = 0; i < candles.length; i++) {
    if (i < lenSwing) continue;

    const hiMax = getHighest(highs, lenSwing, i);
    const loMin = getLowest(lows, lenSwing, i);
    const currentHigh = highs[i];
    const currentLow = lows[i];
    const prevHigh = highs[i - 1];
    const prevLow = lows[i - 1];

    // Swing Detection
    const isHiSw = (prevHigh === hiMax) && (currentHigh < hiMax);
    const isLoSw = (prevLow === loMin) && (currentLow > loMin);

    if (currentHigh === hiMax) dir = 1;
    if (currentLow === loMin) dir = -1;

    if (isLoSw) ll = 1;
    if (isHiSw) lh = 1;

    // Increment (Post-reset logic from Pine: reset then increment? or increment existing?
    // Script: `if isLoSw ... ll := 1` then `ll += 1`
    // So effective LL at swing start is 2? Yes.
    ll++;
    lh++;

    // Calculate MAs
    const maHi = getSma(highs, lh, i);
    const maLo = getSma(lows, ll, i);

    maHiHistory[i] = maHi;
    maLoHistory[i] = maLo;

    if (i === 0) continue; // No prev metric

    const atr = atrSeries[i];
    const prevMaHi = maHiHistory[i - 1];
    const prevMaLo = maLoHistory[i - 1];

    // Deviation Logic
    const dHi = Math.abs(maHi - prevMaHi) > atr;
    const dLo = Math.abs(maLo - prevMaLo) > atr;

    // Counters
    const prevUc = ucSeries[i - 1] || 0;
    const prevLc = lcSeries[i - 1] || 0;

    ucSeries[i] = !dHi ? prevUc + 1 : 0;
    lcSeries[i] = !dLo ? prevLc + 1 : 0;

    // Bands (Middle)
    // script: ub = dHi ? na : maHi
    const ub = dHi ? NaN : maHi;
    const lb = dLo ? NaN : maLo;

    ubSeries[i] = ub;
    lbSeries[i] = lb;
  }

  // Return the latest Signal state
  const lastIdx = candles.length - 1;
  const prevIdx = lastIdx - 1;

  // Buy Logic: Crossover(low, lb) and lc > 15
  // Sell Logic: Crossunder(high, ub) and uc > 20

  // We check specifically the crossover event on the LAST candle
  const low = lows[lastIdx];
  const prevLow = lows[prevIdx];
  const lb = lbSeries[lastIdx];
  const prevLb = lbSeries[prevIdx];
  const lc = lcSeries[lastIdx];

  const high = highs[lastIdx];
  const prevHigh = highs[prevIdx];
  const ub = ubSeries[lastIdx];
  const prevUb = ubSeries[prevIdx];
  const uc = ucSeries[lastIdx];

  // Crossover Low/LB: (prevLow < prevLb) && (low > lb) ? 
  // Wait, Pine `ta.crossover(source, target)`: source crosses OVER target.
  // `ta.crossover(low, lb)` -> Low was below LB, now is above LB.
  const buySignal = (!Number.isNaN(lb) && !Number.isNaN(prevLb) && prevLow < prevLb && low > lb && lc > 15);

  // Sell Logic: `ta.crossunder(high, ub)` -> High was above UB, now is below UB.
  const sellSignal = (!Number.isNaN(ub) && !Number.isNaN(prevUb) && prevHigh > prevUb && high < ub && uc > 20);

  return {
    buy: buySignal,
    sell: sellSignal,
    lb: lbSeries[lastIdx],
    ub: ubSeries[lastIdx],
    lc,
    uc
  };
}

function calculateOrderBookMetrics(orderBook) {
  if (!orderBook || !orderBook.bids?.length || !orderBook.asks?.length) return null;

  const [bestBidPrice] = orderBook.bids[0];
  const [bestAskPrice] = orderBook.asks[0];
  if (!Number.isFinite(bestBidPrice) || !Number.isFinite(bestAskPrice) || bestAskPrice <= 0 || bestBidPrice <= 0) return null;

  const mid = (bestAskPrice + bestBidPrice) / 2;
  const spreadBps = ((bestAskPrice - bestBidPrice) / mid) * 10000;

  const topBids = orderBook.bids.slice(0, 10);
  const topAsks = orderBook.asks.slice(0, 10);

  const bidNotional = topBids.reduce((sum, [p, q]) => sum + (p * q), 0);
  const askNotional = topAsks.reduce((sum, [p, q]) => sum + (p * q), 0);
  const totalNotional = bidNotional + askNotional;
  const obi = totalNotional > 0 ? (bidNotional - askNotional) / totalNotional : 0;

  const bidVolume = orderBook.bids.reduce((sum, [p, q]) => sum + q, 0);
  const askVolume = orderBook.asks.reduce((sum, [p, q]) => sum + q, 0);
  const volumeImbalance = bidVolume + askVolume > 0 ? (bidVolume - askVolume) / (bidVolume + askVolume) : 0;

  return { spreadBps, depthQuoteTopN: totalNotional, obi, volumeImbalance };
}

// ==================== MARKET REGIME DETECTION ====================

function calculateVolatilityPercentile(candles, atrPeriod = 14) {
  const atrs = calculateATRSeries(candles, atrPeriod);
  if (!atrs || atrs.length < 50) return 50; // Neutral if not enough data

  const currentATR = atrs[atrs.length - 1];
  const last50ATRs = atrs.slice(-50).filter(v => v !== null);

  const sorted = [...last50ATRs].sort((a, b) => a - b);
  const rank = sorted.findIndex(v => v >= currentATR);

  if (sorted.length === 0) return 50;
  return (rank / sorted.length) * 100;
}

function detectMarketRegime(candles, adx, closes) {
  const atrPercentile = calculateVolatilityPercentile(candles);
  const trendStrength = adx ? adx.adx : 0;
  const isBearish = adx ? adx.bearishTrend : false;
  const isBullish = adx ? adx.bullishTrend : false;

  // NEW: Use EMA slope for additional trend confirmation
  const emaSlope = closes ? calculateEMASlope(closes, 50) : null;
  const hasValidTrend = emaSlope !== null && Math.abs(emaSlope) > 0.0005; // 0.05% slope threshold

  // IMPROVED: Higher ADX threshold (25 instead of 20) for more reliable trend detection
  // IMPROVED: Require both ADX and EMA slope alignment

  // Strict Downtrend detection
  if (trendStrength > 25 && isBearish && hasValidTrend) {
    return 'DOWNTREND';
  } else if (trendStrength > 25 && isBullish && hasValidTrend && atrPercentile < 70) {
    return 'TRENDING';
  } else if (trendStrength < 20 && atrPercentile < 40 && (!hasValidTrend || Math.abs(emaSlope) < 0.001)) {
    return 'RANGING';
  } else if (atrPercentile > 85) {
    return 'HIGH_VOLATILITY';
  } else {
    return 'TRANSITION';
  }
}

// ==================== SMART MONEY CONCEPTS ====================

function detectSmartMoneyConcepts(candles, lookback = 50) {
  const fvgs = [];
  const orderBlocks = [];

  if (candles.length < 5) return { fvgs: [], orderBlocks: [] };

  const start = Math.max(2, candles.length - lookback);

  for (let i = start; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c1 = candles[i - 1];
    const c2 = candles[i];

    // --- FVG Detection ---
    // Bullish FVG: Gap between c0.high and c2.low
    if (c2.low > c0.high) {
      fvgs.push({
        type: 'BULLISH',
        top: c2.low,
        bottom: c0.high,
        price: (c2.low + c0.high) / 2,
        time: c1.time
      });
    }
    // Bearish FVG: Gap between c0.low and c2.high
    else if (c2.high < c0.low) {
      fvgs.push({
        type: 'BEARISH',
        top: c0.low,
        bottom: c2.high,
        price: (c0.low + c2.high) / 2,
        time: c1.time
      });
    }

    // --- Order Block Detection ---
    const bodySize = Math.abs(c2.close - c2.open);
    const prevBody = Math.abs(c1.close - c1.open);

    // Bullish OB: Bearish candle followed by strong bullish move
    if (c1.close < c1.open && c2.close > c2.open && bodySize > prevBody * 1.5 && c2.close > c1.high) {
      orderBlocks.push({
        type: 'BULLISH',
        top: c1.high,
        bottom: c1.low,
        price: (c1.high + c1.low) / 2,
        time: c1.time
      });
    }
    // Bearish OB: Bullish candle followed by strong bearish move
    else if (c1.close > c1.open && c2.close < c2.open && bodySize > prevBody * 1.5 && c2.close < c1.low) {
      orderBlocks.push({
        type: 'BEARISH',
        top: c1.high,
        bottom: c1.low,
        price: (c1.high + c1.low) / 2,
        time: c1.time
      });
    }
  }

  return { fvgs, orderBlocks };
}

function calculateRelativeStrength(symbolCloses, btcCloses, lookback = 16) {
  if (!symbolCloses || !btcCloses || symbolCloses.length < lookback || btcCloses.length < lookback) return 0;

  const symbolChange = (symbolCloses[symbolCloses.length - 1] - symbolCloses[symbolCloses.length - lookback]) / symbolCloses[symbolCloses.length - lookback];
  const btcChange = (btcCloses[btcCloses.length - 1] - btcCloses[btcCloses.length - lookback]) / btcCloses[btcCloses.length - lookback];

  return symbolChange - btcChange;
}

// ==================== PRICE ACTION PATTERNS ====================

function detectMarketStructureShift(candles, lookback = 50) {
  if (candles.length < lookback) return null;

  const relevantCandles = candles.slice(-lookback);
  // Find Swing Points (Highs and Lows)
  const swings = [];

  for (let i = 1; i < relevantCandles.length - 1; i++) {
    const current = relevantCandles[i];
    const prev = relevantCandles[i - 1];
    const next = relevantCandles[i + 1];

    // Swing High (v4.9 Sensitivity: 3-bar fractal)
    if (current.high > prev.high && current.high > next.high) {
      swings.push({ type: 'HIGH', price: current.high, time: current.time, index: i });
    }

    // Swing Low (v4.9 Sensitivity: 3-bar fractal)
    if (current.low < prev.low && current.low < next.low) {
      swings.push({ type: 'LOW', price: current.low, time: current.time, index: i });
    }
  }

  if (swings.length < 2) return null;

  const lastCandle = relevantCandles[relevantCandles.length - 1];

  // Check for Bullish MSS (Break of last Swing High)
  // v4.9: Increased window to 5 candles for better detection of recent shifts
  const lastSwingHigh = swings.filter(s => s.type === 'HIGH').pop();

  if (lastSwingHigh) {
    const brokenIndex = relevantCandles.findIndex((c, idx) => idx > lastSwingHigh.index && c.close > lastSwingHigh.price);

    if (brokenIndex !== -1 && brokenIndex >= relevantCandles.length - 5) {
      const breakCandle = relevantCandles[brokenIndex];
      const bodySize = Math.abs(breakCandle.close - breakCandle.open);
      const totalSize = breakCandle.high - breakCandle.low;

      // v4.9: Relaxed break validation (40% body vs 50%)
      if (bodySize > totalSize * 0.4) {
        return {
          type: 'BULLISH_MSS',
          price: lastSwingHigh.price,
          breakTime: breakCandle.time
        };
      }
    }
  }

  // Check for Bearish MSS (Break of last Swing Low)
  const lastSwingLow = swings.filter(s => s.type === 'LOW').pop();

  if (lastSwingLow) {
    const brokenIndex = relevantCandles.findIndex((c, idx) => idx > lastSwingLow.index && c.close < lastSwingLow.price);

    if (brokenIndex !== -1 && brokenIndex >= relevantCandles.length - 5) {
      const breakCandle = relevantCandles[brokenIndex];
      return {
        type: 'BEARISH_MSS',
        price: lastSwingLow.price,
        breakTime: breakCandle.time
      };
    }
  }

  return null;
}

function detectLiquiditySweep(candles, lookback = 50) {
  if (candles.length < lookback) return null;
  // Exclude last few candles to find established lows
  const analysisCandles = candles.slice(-lookback, -3);
  const recentCandles = candles.slice(-3);

  // Find significant lowest low in established window
  let minLow = Infinity;

  for (let i = 0; i < analysisCandles.length; i++) {
    if (analysisCandles[i].low < minLow) {
      minLow = analysisCandles[i].low;
    }
  }

  if (minLow === Infinity) return null;

  // Check if any recent candle swept the low
  for (const candle of recentCandles) {
    // Bullish Sweep: Price went below establish low but closed ABOVE it
    if (candle.low < minLow && candle.close > minLow) {
      return {
        type: 'BULLISH_SWEEP',
        level: minLow,
        time: candle.time
      };
    }
  }

  // Find significant highest high for bearish sweep
  let maxHigh = -Infinity;
  for (let i = 0; i < analysisCandles.length; i++) {
    if (analysisCandles[i].high > maxHigh) {
      maxHigh = analysisCandles[i].high;
    }
  }

  for (const candle of recentCandles) {
    // Bearish Sweep: Price went above established high but closed BELOW it
    if (candle.high > maxHigh && candle.close < maxHigh) {
      return {
        type: 'BEARISH_SWEEP',
        level: maxHigh,
        time: candle.time
      };
    }
  }

  return null;
}


function detectPriceActionPatterns(candles) {
  if (candles.length < 3) return [];

  const patterns = [];
  const recent = candles.slice(-3);

  const c0 = recent[0], c1 = recent[1], c2 = recent[2];
  const body0 = Math.abs(c0.close - c0.open);
  const body1 = Math.abs(c1.close - c1.open);
  const body2 = Math.abs(c2.close - c2.open);

  const upperWick0 = c0.high - Math.max(c0.open, c0.close);
  const lowerWick0 = Math.min(c0.open, c0.close) - c0.low;
  const upperWick1 = c1.high - Math.max(c1.open, c1.close);
  const lowerWick1 = Math.min(c1.open, c1.close) - c1.low;
  const upperWick2 = c2.high - Math.max(c2.open, c2.close);
  const lowerWick2 = Math.min(c2.open, c2.close) - c2.low;

  // Bullish Engulfing
  if (c0.close > c0.open && c1.close < c1.open) {
    if (c0.close > c1.open && c0.open < c1.close) {
      patterns.push({ type: 'BULLISH', name: 'Bullish Engulfing', strength: 35 });
    }
  }

  // Bearish Engulfing
  if (c0.close < c0.open && c1.close > c1.open) {
    if (c0.open > c1.close && c0.close < c1.open) {
      patterns.push({ type: 'BEARISH', name: 'Bearish Engulfing', strength: 35 });
    }
  }

  // Hammer (bullish reversal)
  if (body1 > 0 && lowerWick1 > body1 * 2 && upperWick1 < body1 * 0.5) {
    patterns.push({ type: 'BULLISH', name: 'Hammer', strength: 25 });
  }

  // Shooting Star (bearish reversal)
  if (body1 > 0 && upperWick1 > body1 * 2 && lowerWick1 < body1 * 0.5) {
    patterns.push({ type: 'BEARISH', name: 'Shooting Star', strength: 25 });
  }

  // Morning Star (3-candle bullish reversal)
  if (recent.length >= 3) {
    if (c0.close < c0.open && c1.close < c1.open && c2.close > c2.open) {
      const totalBody = body0 + body1 + body2;
      if (body1 < body0 * 0.3 && body1 < body2 * 0.3 && c1.close < c0.close && c1.close < c2.close) {
        patterns.push({ type: 'BULLISH', name: 'Morning Star', strength: 40 });
      }
    }

    // Evening Star (3-candle bearish reversal)
    if (c0.close > c0.open && c1.close > c1.open && c2.close < c2.open) {
      if (body1 < body0 * 0.3 && body1 < body2 * 0.3 && c1.close > c0.close && c1.close > c2.close) {
        patterns.push({ type: 'BEARISH', name: 'Evening Star', strength: 40 });
      }
    }
  }

  // Doji
  if (body1 < (upperWick1 + lowerWick1) * 0.1) {
    patterns.push({ type: 'NEUTRAL', name: 'Doji', strength: 10 });
  }

  return patterns;
}

function detectDivergences(candles, closes) {
  if (candles.length < 50) return [];

  const lookback = 30;
  const recentCloses = closes.slice(-lookback);

  const rsiValues = [];
  const rsiStartIndex = closes.length - lookback - 15;
  if (rsiStartIndex < 0) return [];

  for (let i = rsiStartIndex; i < closes.length; i++) {
    const subset = closes.slice(0, i + 1);
    const val = calculateRSI(subset, 14);
    if (val !== null) rsiValues.push({ index: i, value: val });
  }

  if (rsiValues.length < lookback) return [];

  const alignedRSI = rsiValues.slice(-lookback);
  const alignedPrice = recentCloses.map((price, idx) => ({
    index: closes.length - lookback + idx,
    value: price
  }));

  const findPivots = (data, isHigh) => {
    const pivots = [];
    for (let i = 2; i < data.length - 2; i++) {
      const curr = data[i].value;
      if (isHigh) {
        if (curr > data[i - 1].value && curr > data[i - 2].value &&
          curr > data[i + 1].value && curr > data[i + 2].value) {
          pivots.push(data[i]);
        }
      } else {
        if (curr < data[i - 1].value && curr < data[i - 2].value &&
          curr < data[i + 1].value && curr < data[i + 2].value) {
          pivots.push(data[i]);
        }
      }
    }
    return pivots;
  };

  const priceHighs = findPivots(alignedPrice, true);
  const priceLows = findPivots(alignedPrice, false);
  const rsiHighs = findPivots(alignedRSI, true);
  const rsiLows = findPivots(alignedRSI, false);

  const divergences = [];

  const checkDiv = (p1, p2, r1, r2, type, name) => {
    const timeDiff = Math.abs(p2.index - p1.index);
    if (timeDiff < 5 || timeDiff > 40) return;

    const match1 = Math.abs(p1.index - r1.index) <= 2;
    const match2 = Math.abs(p2.index - r2.index) <= 2;

    if (match1 && match2) {
      divergences.push({ type, name, strength: Math.abs(r1.value - r2.value) });
    }
  };

  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const p2 = priceLows[priceLows.length - 1];
    const p1 = priceLows[priceLows.length - 2];
    const r2 = rsiLows[rsiLows.length - 1];
    const r1 = rsiLows[rsiLows.length - 2];

    if (p2.value < p1.value && r2.value > r1.value) {
      checkDiv(p1, p2, r1, r2, 'BULLISH', 'Regular Bullish Div');
    }
  }

  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const p2 = priceHighs[priceHighs.length - 1];
    const p1 = priceHighs[priceHighs.length - 2];
    const r2 = rsiHighs[rsiHighs.length - 1];
    const r1 = rsiHighs[rsiHighs.length - 2];

    if (p2.value > p1.value && r2.value < r1.value) {
      checkDiv(p1, p2, r1, r2, 'BEARISH', 'Regular Bearish Div');
    }
  }

  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const p2 = priceLows[priceLows.length - 1];
    const p1 = priceLows[priceLows.length - 2];
    const r2 = rsiLows[rsiLows.length - 1];
    const r1 = rsiLows[rsiLows.length - 2];

    if (p2.value > p1.value && r2.value < r1.value) {
      checkDiv(p1, p2, r1, r2, 'BULLISH', 'Hidden Bullish Div');
    }
  }

  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const p2 = priceHighs[priceHighs.length - 1];
    const p1 = priceHighs[priceHighs.length - 2];
    const r2 = rsiHighs[rsiHighs.length - 1];
    const r1 = rsiHighs[rsiHighs.length - 2];

    if (p2.value < p1.value && r2.value > r1.value) {
      checkDiv(p1, p2, r1, r2, 'BEARISH', 'Hidden Bearish Div');
    }
  }

  return divergences;
}

// ==================== MULTI-TIMEFRAME ANALYSIS ====================

async function analyzeMultiTimeframe(symbol, candles15m, ticker24h) {
  const candles1h = await getKlines(symbol, '60m', 500);

  const analysis15m = analyzeTimeframe(symbol, candles15m, '15m');
  const analysis1h = analyzeTimeframe(symbol, candles1h, '60m');

  return {
    tf15m: analysis15m,
    tf1h: analysis1h,
    confluence: calculateConfluence(analysis15m, analysis1h)
  };
}

function analyzeTimeframe(symbol, candles, interval) {
  if (!candles || candles.length < 200) return null;

  const closedCandles = getClosedCandles(candles, interval);
  if (closedCandles.length < 200) return null;
  const closes = closedCandles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  return {
    closes,
    currentPrice,
    rsi: calculateRSI(closes, 14),
    stochRSI: calculateStochasticRSI(closes),
    macd: calculateMACD(closes),
    bb: calculateBollingerBands(closes, 20, 2),
    ema9: calculateEMA(closes, 9),
    ema21: calculateEMA(closes, 21),
    ema50: calculateEMA(closes, 50),
    superTrend: calculateSuperTrend(closedCandles, 10, 3),
    adx: calculateADX(closedCandles, 14),
    atr: calculateATR(closedCandles, 14),
    vwap: calculateVWAP(closedCandles, 50),
    cmf: calculateCMF(closedCandles, 20)
  };
}

function calculateConfluence(analysis15m, analysis1h) {
  if (!analysis15m || !analysis1h) return null;

  let score = 0;
  const factors = [];

  const isUptrend15m = analysis15m.ema9 > analysis15m.ema21;
  const isUptrend1h = analysis1h.ema9 > analysis1h.ema21;

  if (isUptrend15m && isUptrend1h) {
    score += 20;
    factors.push('UPTREND');
  } else if (!isUptrend15m && !isUptrend1h) {
    score -= 20;
    factors.push('DOWNTREND');
  }

  const rsiAligned = (analysis15m.rsi > 50 && analysis1h.rsi > 50) || (analysis15m.rsi < 50 && analysis1h.rsi < 50);
  if (rsiAligned) {
    score += 10;
    factors.push('RSI_ALIGNED');
  }

  const macdAligned = analysis15m.macd.bullish === analysis1h.macd.bullish;
  if (macdAligned) {
    score += 10;
    factors.push('MACD_ALIGNED');
  }

  const stochAligned = (analysis15m.stochRSI && analysis1h.stochRSI) &&
    ((analysis15m.stochRSI.k < 20 && analysis1h.stochRSI.k < 20) ||
      (analysis15m.stochRSI.k > 80 && analysis1h.stochRSI.k > 80));
  if (stochAligned) {
    score += 15;
    factors.push('STOCH_ALIGNED');
  }

  const superTrendAligned = analysis15m.superTrend && analysis1h.superTrend &&
    analysis15m.superTrend.bullish === analysis1h.superTrend.bullish;
  if (superTrendAligned) {
    score += 15;
    factors.push('ST_ALIGNED');
  }

  return {
    score,
    factors,
    strong: score >= 50,
    moderate: score >= 30
  };
}

// ==================== SIGNAL GENERATION ====================

/**
 * expert Validation Layer - v4.5
 * Validates signal using order flow (OBI/Delta) alignment.
 */
function validateSignalExpert(symbol, type, volRatio, delta, obMetrics) {
  if (delta === null) return { passed: true, confidence: 0.7 }; // No delta, proceed with caution

  const isBuy = type === 'BUY';
  const deltaAligned = isBuy ? delta > 0.05 : delta < -0.05;

  if (!deltaAligned) {
    return { passed: false, reason: `Delta flow anti-aliñado (${delta.toFixed(2)})` };
  }

  // OBI Alignment if available
  if (obMetrics && Math.abs(obMetrics.obi) > 0.1) {
    const obiAligned = isBuy ? obMetrics.obi > 0 : obMetrics.obi < 0;
    if (!obiAligned) {
      return { passed: false, reason: `Desequilibrio de Libro (OBI) en contra (${obMetrics.obi.toFixed(2)})` };
    }
  }

  const confidence = Math.min(0.95, 0.7 + (volRatio > 1.5 ? 0.15 : 0) + (Math.abs(delta) > 0.3 ? 0.1 : 0));
  return { passed: true, confidence };
}

/**
 * 🚀 ESTRATEGIA MILLONARIA: Dynamic Position Sizing Pro
 * Size más agresivo para señales de alta calidad con gestión de riesgo inteligente
 */
function calculateRecommendedSize(score, atrPct, regime, hasMSS = false, hasSweep = false, volumeRatio = 1.0, relativeStrength = 0) {
  let size = 1.5; // Base augmented to 1.5%

  // 📈 Quality bonus (more aggressive)
  if (score >= 82) size += 0.8; // Lowered threshold for bonus
  if (score >= 88) size += 1.2;
  if (score >= 95) size += 2.0;

  // 🏆 Performance & Alpha bonus
  if (relativeStrength > 0.02) size += 1.0; // Extra size for tokens outperforming BTC by 2%+
  if (hasMSS) size += 0.8;
  if (hasSweep) size += 1.0;
  if (volumeRatio > 2.0) size += 0.5;

  // 📉 Volatility adjustment
  if (atrPct > 3.0) size *= 0.5;
  else if (atrPct > 1.5) size *= 0.8;
  else size *= 1.1;

  // 🎯 Regime adjustment
  if (regime === 'HIGH_VOLATILITY') size *= 0.6;
  else if (regime === 'TRENDING') size *= 1.5;
  else if (regime === 'DOWNTREND') size *= 0.8;

  const minSize = 0.5;
  const maxSize = score >= 90 ? 7.0 : 5.0; // Increased max to 7% for god-tier signals

  return Math.max(minSize, Math.min(size, maxSize)).toFixed(1);
}

function generateSignal(symbol, candles15m, candles1h, candles4h, orderBook, ticker24h, btcContext = null, momentumAdj = null, shadowCollector = null) {
  if (!candles15m || candles15m.length < 201) return null;

  const closedCandles15m = getClosedCandles(candles15m, '15m');
  if (closedCandles15m.length < 200) return null;

  const closes15m = closedCandles15m.map(c => c.close);
  const currentPrice = closes15m[closes15m.length - 1];
  const prevPrice = closes15m[closes15m.length - 2];

  const btcRisk = btcContext?.status || 'UNKNOWN';

  const obMetrics = calculateOrderBookMetrics(orderBook);
  if (!obMetrics) return null;

  if (obMetrics.spreadBps > MAX_SPREAD_BPS) return null;
  if (obMetrics.depthQuoteTopN < MIN_DEPTH_QUOTE) return null;

  const closedCandles1h = getClosedCandles(candles1h, '60m');
  if (closedCandles1h.length < 50) return null;
  const closes1h = closedCandles1h.map(c => c.close);
  const currentPrice1h = closes1h[closes1h.length - 1];

  // === NEW: RELATIVE STRENGTH (RS) INDEX v7.0 ===
  const rs4h = btcContext?.closes4h ? calculateRelativeStrength(closes1h, btcContext.closes4h, 16) : 0;
  const rs1h = btcContext?.closes1h ? calculateRelativeStrength(closes15m, btcContext.closes1h, 4) : 0;
  const alphaSignal = rs4h > 0.015 || rs1h > 0.01; // Outperforming BTC by 1.5% in 4h or 1% in 1h

  const rsi15m = calculateRSI(closes15m, 14);
  const stoch15m = calculateStochasticRSI(closes15m);
  const macd15m = calculateMACD(closes15m);
  const bb15m = calculateBollingerBands(closes15m, 20, 2);
  const ema9_15m = calculateEMA(closes15m, 9);
  const ema21_15m = calculateEMA(closes15m, 21);
  const ema50_15m = calculateEMA(closes15m, 50);
  const superTrend15m = calculateSuperTrend(closedCandles15m, 10, 3);
  const adx15m = calculateADX(closedCandles15m, 14);
  const mystic15m = calculateMysticPulse(closedCandles15m, 14);
  const atr15m = calculateATR(closedCandles15m, 14);
  const atrPercent15m = atr15m ? (atr15m / currentPrice) * 100 : null;
  if (!atrPercent15m || atrPercent15m < MIN_ATR_PCT || atrPercent15m > MAX_ATR_PCT) return null;

  const cmf15m = calculateCMF(closedCandles15m, 20);
  const swingBands = calculateSwingStructureBands(closedCandles15m, 100);

  const rsi1h = calculateRSI(closes1h, 14);
  const macd1h = calculateMACD(closes1h);
  const superTrend1h = calculateSuperTrend(closedCandles1h, 10, 3);

  let superTrend4h = null;
  let trend4h = 'NEUTRAL';
  if (candles4h && candles4h.length > 20) {
    const closedCandles4h = getClosedCandles(candles4h, '4h');
    const closes4h = closedCandles4h.map(c => c.close);
    superTrend4h = calculateSuperTrend(closedCandles4h, 10, 3);
    const ema50_4h = calculateEMA(closes4h, 50);

    if (superTrend4h && ema50_4h) {
      const lastClose = closes4h[closes4h.length - 1];
      if (superTrend4h.bullish && lastClose > ema50_4h) trend4h = 'BULLISH';
      else if (superTrend4h.bearish && lastClose < ema50_4h) trend4h = 'BEARISH';
    }
  }

  const vwap15m = calculateVWAP(closedCandles15m, 50);
  const volumeSMA15m = calculateVolumeSMA(closedCandles15m, 20);
  const currentVolume15m = closedCandles15m[closedCandles15m.length - 1].volume;

  const divergences = detectDivergences(closedCandles15m, closes15m);
  const patterns = detectPriceActionPatterns(closedCandles15m);

  const lastCandle = closedCandles15m[closedCandles15m.length - 1];
  const takerBuyBase = Number.isFinite(lastCandle.takerBuyBaseVolume) ? lastCandle.takerBuyBaseVolume : null;
  const totalBaseVol = Number(lastCandle.volume);
  const buyRatio = takerBuyBase !== null && totalBaseVol > 0 ? takerBuyBase / totalBaseVol : null;
  const deltaRatio = buyRatio === null ? null : (2 * buyRatio - 1);

  // Relaxed indicator validation - allow some indicators to fail
  if (!rsi15m && !macd15m && !bb15m) return null; // At least one major indicator must work

  // === SIMPLIFIED CATEGORY-BASED SCORING FRAMEWORK v4.0 ===
  // Fixed weights for transparency and easier debugging
  let signalType = null;
  const reasons = [];
  const volumeRatio = volumeSMA15m ? currentVolume15m / volumeSMA15m : 1;

  const categoryScores = {
    momentum: 0,
    trend: 0,
    structure: 0,
    volume: 0,
    patterns: 0
  };

  // v5.0 NEW: Signs of the Times (SOTT)
  const sott = calculateSOTT(closedCandles15m, 20);
  const sottValue = sott.value;
  const sottSignal = sott.signal;

  // === CATEGORY 1: MOMENTUM (0-100) ===
  let momentumScore = 0;

  // MYSTIC PULSE V2 (0-40)
  if (mystic15m) {
    if (mystic15m.bullishCross || (mystic15m.bullish && mystic15m.momentumSpread > 5)) {
       momentumScore += 40;
       reasons.push(mystic15m.bullishCross ? '🔥 Mystic Pulse Cross' : '🌊 Mystic Pulse Fuerte');
       if (!signalType) signalType = 'BUY';
    } else if (mystic15m.bearishCross || (mystic15m.bearish && mystic15m.momentumSpread < -5)) {
       if (trend4h !== 'BULLISH') {
         momentumScore += 40;
         reasons.push(mystic15m.bearishCross ? '❄️ Mystic Pulse Cross' : '📉 Mystic Pulse Fuerte');
         if (!signalType) signalType = 'SELL_ALERT';
       }
    }
  }

  // RSI (0-35)
  if (rsi15m < 30) {
    momentumScore += 35;
    reasons.push(`⚡ RSI Sobrevendido (${rsi15m.toFixed(1)})`);
    signalType = 'BUY';
  } else if (rsi15m > 70) {
    // v4.6 FIX: Bull Run Blindness
    if (trend4h === 'BULLISH') {
      if (rsi15m > 85) {
        momentumScore += 35;
        reasons.push(`⚠️ RSI Extremo (>85)`);
        signalType = 'SELL_ALERT';
      } else {
        momentumScore += 25; // Treat as strong momentum
        reasons.push(`🚀 Momentum Fuerte (RSI > 70)`);
        // Do NOT force SELL_ALERT in uptrend
      }
    } else {
      momentumScore += 35;
      reasons.push(`⚠️ RSI Sobrecomprado (${rsi15m.toFixed(1)})`);
      signalType = 'SELL_ALERT';
    }
  } else if (rsi15m < 40 && rsi1h < 45) {
    momentumScore += 20;
    reasons.push(`📊 RSI zona de compra (${rsi15m.toFixed(1)})`);
    if (!signalType) signalType = 'BUY';
  } else if (rsi15m > 60 && rsi1h > 55) {
    // v4.6 FIX: Don't force sell based on zone if bullish
    if (trend4h !== 'BULLISH') {
      momentumScore += 20;
      reasons.push(`📊 RSI zona de venta (${rsi15m.toFixed(1)})`);
      if (!signalType) signalType = 'SELL_ALERT';
    }
  }

  // Stochastic RSI (0-35)
  if (stoch15m) {
    if (stoch15m.oversold && stoch15m.k > stoch15m.d) {
      momentumScore += 35;
      reasons.push('🎯 StochRSI Cross Up');
      if (!signalType) signalType = 'BUY';
    } else if (stoch15m.overbought && stoch15m.k < stoch15m.d) {
      // v4.6 FIX: Ignore stoch sell in strong uptrend unless confirmed by structure
      if (trend4h !== 'BULLISH') {
        momentumScore += 35;
        reasons.push('🎯 StochRSI Cross Down');
        if (!signalType) signalType = 'SELL_ALERT';
      }
    }
  }

  // MACD (0-30)
  if (macd15m?.bullish) {
    momentumScore += 30;
    reasons.push('📈 MACD Alcista');
    if (!signalType) signalType = 'BUY';
  } else if (!macd15m?.bullish) {
    // v4.6 FIX: Ignore MACD Sell in strong uptrend (it's just a pullback)
    if (trend4h !== 'BULLISH') {
      reasons.push('📉 MACD Bajista');
      if (!signalType) signalType = 'SELL_ALERT';
    }
  }

  categoryScores.momentum = Math.min(100, momentumScore);

  // === CATEGORY 2: TREND (0-100) ===
  let trendScore = 0;

  // SuperTrend 15m (0-40)
  if (superTrend15m?.bullish) {
    trendScore += 40;
    reasons.push('🟢 SuperTrend Alcista');
    if (!signalType || signalType === 'BUY') signalType = 'BUY';
  } else if (superTrend15m?.bearish) {
    trendScore += 40;
    reasons.push('🔴 SuperTrend Bajista');
    // v4.6 FIX: SuperTrend Bearish in 4H Bullish = Pullback Opportunity, NOT Sell
    if (trend4h !== 'BULLISH') {
      if (!signalType || signalType === 'SELL_ALERT') signalType = 'SELL_ALERT';
    }
  }

  if (superTrend15m?.flipped) {
    reasons.push(superTrend15m.bullish ? '🔄 FLIP ALCISTA' : '🔄 FLIP BAJISTA');
  }

  // Multi-TF Confluence (0-40)
  if (USE_MULTI_TF) {
    const stAligned1h = superTrend15m?.bullish === superTrend1h?.bullish;
    const stAligned4h = superTrend4h ? superTrend15m?.bullish === superTrend4h.bullish : false;

    if (stAligned1h && stAligned4h) {
      trendScore += 40;
      reasons.push('✅ Confluencia Total (3-TF)');
      // v4.6 FIX: If total confluence, FORCE BUY signal if undef
      if (!signalType && trend4h === 'BULLISH') signalType = 'BUY';
    } else if (stAligned1h) {
      trendScore += 20;
      reasons.push('✅ Confluencia 1H');
    }
    // Added for Sniper 2.0 check
    if (stAligned1h && stAligned4h) {
      reasons.push('🌐 MTF_ALIGNED_TOTAL');
    }
  }

  // ADX Strength (0-20)
  if (adx15m?.trending) {
    trendScore += 20;
    const trendDir = adx15m.bullishTrend ? 'Alcista' : 'Bajista';
    reasons.push(`💨 ADX ${trendDir}`);
  }

  // v5.0 NEW: SOTT Trend Confirmation (0-20)
  // If SOTT is positive and aligned with signal, add bonus
  if (sottSignal > 0 && (signalType === 'BUY' || !signalType)) {
    trendScore += 20;
    reasons.push(`🌊 SOTT Bullish (${sottValue.toFixed(2)})`);
  } else if (sottSignal < 0 && (signalType === 'SELL_ALERT' || !signalType)) {
    trendScore += 20;
    reasons.push(`🌊 SOTT Bearish (${sottValue.toFixed(2)})`);
  }

  // v5.0 NEW: SOTT Divergence Warning (Deep Pullback Filter)
  if (trend4h === 'BULLISH' && sottSignal < -0.2) {
    if (signalType === 'BUY') {
      reasons.unshift('⚠️ SOTT Weakness (< -0.2)');
      // We don't block hard, but we flag it. Score needs to be high to overcome.
    }
  }


  categoryScores.trend = Math.min(100, trendScore);

  // === CATEGORY 3: STRUCTURE (0-100) ===
  let structureScore = 0;

  // Smart Money Concepts (0-60)
  const smc = detectSmartMoneyConcepts(closedCandles15m, 100);
  const nearbyBullishFVG = smc.fvgs.find(f => f.type === 'BULLISH' && currentPrice <= f.top * 1.002 && currentPrice >= f.bottom * 0.998);
  const nearbyBullishOB = smc.orderBlocks.find(ob => ob.type === 'BULLISH' && currentPrice <= ob.top * 1.005 && currentPrice >= ob.bottom * 0.995);
  const nearbyBearishFVG = smc.fvgs.find(f => f.type === 'BEARISH' && currentPrice >= f.bottom * 0.998 && currentPrice <= f.top * 1.002);
  const nearbyBearishOB = smc.orderBlocks.find(ob => ob.type === 'BEARISH' && currentPrice >= ob.bottom * 0.995 && currentPrice <= ob.top * 1.005);

  if (nearbyBullishOB && (signalType === 'BUY' || !signalType)) {
    structureScore += 60;
    reasons.unshift('🏦 Order Block Alcista');
    if (!signalType) signalType = 'BUY';
  } else if (nearbyBullishFVG && (signalType === 'BUY' || !signalType)) {
    structureScore += 40;
    reasons.unshift('🏦 FVG Alcista');
    if (!signalType) signalType = 'BUY';
  }

  if (nearbyBearishOB && (signalType === 'SELL_ALERT' || !signalType)) {
    structureScore += 60;
    reasons.unshift('🏦 Order Block Bajista');
    // v4.6 FIX: Hitting bearish OB in uptrend is expected resistance, not auto-sell
    if (trend4h !== 'BULLISH') {
      if (!signalType) signalType = 'SELL_ALERT';
    }
  } else if (nearbyBearishFVG && (signalType === 'SELL_ALERT' || !signalType)) {
    structureScore += 40;
    reasons.unshift('🏦 FVG Bajista');
    // v4.6 FIX: Hitting bearish FVG in uptrend is expected resistance, not auto-sell
    if (trend4h !== 'BULLISH') {
      if (!signalType) signalType = 'SELL_ALERT';
    }
  }

  // Bollinger Bands (0-15) - Only used for scoring/context, no longer a signal trigger
  const bbPercent = bb15m ? (currentPrice - bb15m.lower) / (bb15m.upper - bb15m.lower) : 0.5;
  if (bbPercent < 0.1) {
    structureScore += 15;
    reasons.push('🏀 BB Inferior');
  } else if (bbPercent > 0.9) {
    if (trend4h !== 'BULLISH') {
      structureScore += 15;
      reasons.push('🎈 BB Superior');
    } else {
      reasons.push('🚀 BB Breakout Potential');
    }
  }

  // Swing Structure Bands (0-15)
  if (swingBands?.buy && (signalType === 'BUY' || !signalType)) {
    structureScore += 15;
    reasons.unshift('🎯 Swing Structure Buy');
    if (!signalType) signalType = 'BUY';
  }

  categoryScores.structure = Math.min(100, structureScore);

  // === CATEGORY 4: VOLUME & ORDER FLOW (0-100) ===
  let volumeScore = 0;

  // Volume Confirmation (0-50) - IMPROVED: Higher threshold
  if (volumeRatio > 1.5) {
    volumeScore += 50;
    reasons.push(`📊 Vol x${volumeRatio.toFixed(1)}`);
  } else if (volumeRatio > 1.2) {
    volumeScore += 25;
  }

  // Order Flow Delta (0-30) - IMPROVED: Stronger directional requirement
  const direction = signalType === 'BUY' ? 1 : signalType === 'SELL_ALERT' ? -1 : 0;
  if (direction !== 0 && deltaRatio !== null) {
    const aligned = direction === 1 ? deltaRatio > 0.1 : deltaRatio < -0.1; // IMPROVED: 0.1 threshold
    if (aligned) {
      volumeScore += 30;
      reasons.push('📊 Order Flow Aligned');
    }
  }

  // OBI (0-20)
  if (direction !== 0 && obMetrics) {
    const obiAligned = direction === 1 ? obMetrics.obi > 0.05 : obMetrics.obi < -0.05;
    if (obiAligned) {
      volumeScore += 20;
      reasons.push('📚 OBI Favorable');
    }
  }

  categoryScores.volume = Math.min(100, volumeScore);

  // === CATEGORY 5: PATTERNS & DIVERGENCES (0-100) ===
  let patternsScore = 0;

  // Candlestick Patterns (0-50)
  if (patterns.length > 0) {
    const bestPattern = patterns.sort((a, b) => b.strength - a.strength)[0];
    if (signalType === 'BUY' && bestPattern.type === 'BULLISH') {
      patternsScore += 50;
      reasons.unshift(`🕯️ ${bestPattern.name}`);
    } else if (signalType === 'SELL_ALERT' && bestPattern.type === 'BEARISH') {
      patternsScore += 50;
      reasons.unshift(`🕯️ ${bestPattern.name}`);
    }
  }

  // Divergences (0-50)
  if (divergences.length > 0) {
    const bestDiv = divergences.sort((a, b) => b.strength - a.strength)[0];
    if ((bestDiv.type === 'BULLISH' && signalType === 'BUY') ||
      (bestDiv.type === 'BEARISH' && signalType === 'SELL_ALERT')) {
      patternsScore += 50;
      reasons.unshift(`🔥 ${bestDiv.name}`);
    }
  }

  categoryScores.patterns = Math.min(100, patternsScore);

  // === CALCULATE FINAL SCORE ===
  const quoteVol24h = ticker24h ? Number(ticker24h.quoteVolume) : null;
  if (!quoteVol24h || !Number.isFinite(quoteVol24h) || quoteVol24h < MIN_QUOTE_VOL_24H) return null;

  // --- SNIPER MODE FILTERS (MAX SECURITY) ---
  const mtfAlignedTotal = reasons.includes('🌐 MTF_ALIGNED_TOTAL');
  const sniperTrendOk = (signalType === 'BUY' && trend4h === 'BULLISH') || (signalType === 'SELL_ALERT' && trend4h === 'BEARISH');
  const sniperRsiOk = (signalType === 'BUY' && rsi1h <= 63); // Toughened to 63 from 65

  // --- AGGRESSIVE MODE FILTERS (FLEXIBILITY) ---
  // Allow trend if it's compatible with signal or if no signal yet (to allow MSS/Sweep detection)
  const isTrendPotentialBuy = trend4h === 'BULLISH' || trend4h === 'NEUTRAL';
  const isTrendPotentialSell = trend4h === 'BEARISH' || trend4h === 'NEUTRAL';

  const aggressiveTrendOk = signalType === 'BUY' ? isTrendPotentialBuy :
    signalType === 'SELL_ALERT' ? isTrendPotentialSell :
      trend4h !== 'DOWNTREND'; // Allow reaching MSS/Sweep if not a heavy downtrend

  if (!aggressiveTrendOk) {
    console.log(`[REJECT] ${symbol}: Aggressive Trend check failed (4H: ${trend4h}, Signal: ${signalType})`);
    return null;
  }

  const aggressiveRsiOk = rsi1h <= 78;

  if (signalType === 'BUY' && !aggressiveRsiOk) {
    console.log(`[REJECT] ${symbol}: 1H RSI (${rsi1h.toFixed(1)}) too high even for Aggressive`);
    return null;
  }

  // --- EXPERT VALIDATION LAYER (OBI/DELTA) ---
  const expertVal = validateSignalExpert(symbol, signalType, volumeRatio, deltaRatio, obMetrics);
  if (!expertVal.passed) {
    console.log(`[REJECT] ${symbol}: Expert Validation failed: ${expertVal.reason}`);
    return null;
  }
  reasons.push(`🛡️ Validado v4.5 (Conf: ${(expertVal.confidence * 100).toFixed(0)}%)`);

  // Determine Mode based on Trend and RSI
  // Sniper 2.0 requirements: MTF Total alignment + Volume 1.5x + Score 88+
  const isSniperQuality = mtfAlignedTotal && sniperRsiOk && volumeRatio >= 1.5;
  reasons.push(isSniperQuality ? '💎 MODO SNIPER' : '⚡ MODO AGRESIVO');

  // Detect Market Regime - IMPROVED: Pass closes for EMA slope
  const regime = detectMarketRegime(closedCandles15m, adx15m, closes15m);
  reasons.push(`🌐 Regime: ${regime}`);

  // === MSS DETECTION (HOISTED) ===
  const mss = detectMarketStructureShift(closedCandles15m);

  // SIMPLIFIED v4.0: Small fixed bonus for MSS
  if (mss && mss.type === 'BULLISH_MSS' && (signalType === 'BUY' || !signalType)) {
    // score += 10; // MOVED: Score added later to avoid premature boost
    reasons.unshift('🔄 MSS (+10)');
    if (!signalType) signalType = 'BUY';
  } else if (mss && mss.type === 'BEARISH_MSS' && (signalType === 'SELL_ALERT' || !signalType)) {
    if (!signalType) signalType = 'SELL_ALERT';
  }

  // === LIQUIDITY SWEEP DETECTION (HOISTED) ===
  const sweep = detectLiquiditySweep(closedCandles15m);
  let sweepConfirmed = false;

  if (sweep && sweep.type === 'BULLISH_SWEEP' && (signalType === 'BUY' || !signalType)) {
    sweepConfirmed = (mss || volumeRatio > 1.5);
    reasons.unshift(sweepConfirmed ? '🧹 Sweep ✓' : '🧹 Sweep (⚠️)');
    if (!signalType) signalType = 'BUY';
  } else if (sweep && sweep.type === 'BEARISH_SWEEP' && (signalType === 'SELL_ALERT' || !signalType)) {
    sweepConfirmed = (mss || volumeRatio > 1.5);
    reasons.unshift(sweepConfirmed ? '🧹 Sweep ✓' : '🧹 Sweep (⚠️)');
    if (!signalType) signalType = 'SELL_ALERT';
  }

  // v5.1 SOTT Unlock: Reduce requirements if conviction is extreme
  let requirementsReduction = 0;
  if (sottValue > 0.8 && sottSignal > 0.3) requirementsReduction = 10;
  else if (sottSignal > 0.2) requirementsReduction = 5;

  // === REGIME FILTERS v7.4 (Spot Long-Only Regime Scalper) ===
  let MIN_QUALITY_SCORE = 68; // Lowered baseline 
  let shadowOnlyRegimeReason = null;
  const hasBullishStructure = !!mss || !!sweep;

  // Capitulation Bounce Condition: BTC panic sell + oversold intraday + structure confirmed
  const isCapitulationBounce =
    btcContext?.status === 'GREEN' &&
    btcContext?.rsi4h < 35 &&
    rsi15m < 45 &&
    hasBullishStructure;

  if (regime === 'DOWNTREND') {
    shadowOnlyRegimeReason = 'REGIME_SHADOW_ONLY (DOWNTREND live disabled)';
    if (isCapitulationBounce) {
      reasons.push('🧪 DOWNTREND (Capitulation Shadow)');
      MIN_QUALITY_SCORE = 55; // Shadow monitor for extreme capitulation candidates
    }
    else if (btcContext?.status === 'GREEN' && trend4h === 'BULLISH') {
      reasons.push('🟢 DOWNTREND (Pullback Support BTC-GREEN)');
      MIN_QUALITY_SCORE = 60; // Rewarding green BTC pullbacks
    }
    else if (trend4h === 'BULLISH') {
      reasons.push('📉 DOWNTREND (Pullback Opportunity)');
      MIN_QUALITY_SCORE = alphaSignal ? 66 : 72; // Relaxed to allow dips
    }
    else if (rsi1h < 25 && volumeRatio > 1.8) {
      reasons.push('🎯 DOWNTREND (Extreme Oversold Bounce)');
      MIN_QUALITY_SCORE = 75;
    }
    else if (btcContext?.status === 'GREEN' && rsi15m < 45 && alphaSignal) {
      reasons.push('🚀 DOWNTREND (Alpha Bounce)');
      MIN_QUALITY_SCORE = 65; // Relaxed
    }
    else {
      console.log(`[REJECT] ${symbol}: DOWNTREND regime - filters too tight`);
      return null;
    }
  } else if (regime === 'TRANSITION') {
    shadowOnlyRegimeReason = 'REGIME_SHADOW_ONLY (TRANSITION live disabled)';
    if (isCapitulationBounce) {
      reasons.push('🧪 TRANSITION (Capitulation Shadow)');
      MIN_QUALITY_SCORE = 55;
    } else {
      // Keep legacy thresholding for shadow observation while live stays disabled
      MIN_QUALITY_SCORE = alphaSignal ? 60 : 65; 
    }
  } else if (regime === 'TRENDING') {
    MIN_QUALITY_SCORE = alphaSignal ? 60 : 65;
  } else if (regime === 'HIGH_VOLATILITY') {
    MIN_QUALITY_SCORE = 70;
  } else if (regime === 'RANGING') {
    MIN_QUALITY_SCORE = 60;
  }

  // === SIMPLIFIED FIXED WEIGHTS v4.0 ===
  // No dynamic weight changes - easier to debug and optimize
  const weights = {
    momentum: 0.25,
    trend: 0.30,
    structure: 0.25,
    volume: 0.15,
    patterns: 0.05
  };

  let score = Math.round(
    categoryScores.momentum * weights.momentum +
    categoryScores.trend * weights.trend +
    categoryScores.structure * weights.structure +
    categoryScores.volume * weights.volume +
    categoryScores.patterns * weights.patterns
  );

  // v5.1 SOTT Quality Bonus (applied to final score)
  if (sottValue > 0.5) score += 5;
  if (sottSignal > 0.2) score += 5;

  // v7.0 ALPHA BONUS: Reward decoupled assets
  if (rs4h > 0.02) { score += 8; reasons.push('🚀 Alpha Fuerte vs BTC'); }
  else if (rs4h > 0.01) { score += 4; reasons.push('📈 Outperforming BTC'); }

  // Count strong categories (>60%) - simplified confluence check
  const strongCategories = Object.values(categoryScores).filter(s => s >= 60).length;

  // Minimal confluence bonus (removed aggressive multipliers)
  if (strongCategories >= 4) {
    score += 5; // Small fixed bonus instead of percentage
    reasons.push('🎯 CONFLUENCIA EXCEPCIONAL');
  } else if (strongCategories >= 3) {
    score += 3;
    reasons.push('🎯 Alta Confluencia');
  }

  const scoreBeforeMomentum = score;

  // === SELF-LEARNING: Momentum Adjustment from Signal Memory ===
  // Audit v7.3.0: Disabled because statistically it adds 0 value
  if (momentumAdj) momentumAdj.adjustment = 0;

  // Ensure score is non-negative before clamping
  score = Math.max(0, score);

  // === ENHANCED OVEREXTENSION AND PULLBACK FILTERS ===
  const ema21 = ema21_15m;
  const ema50 = ema50_15m;
  const distToEma21 = ema21 ? (currentPrice - ema21) / ema21 * 100 : 0;
  const distToEma50 = ema50 ? (currentPrice - ema50) / ema50 * 100 : 0;
  const distToEma9 = ema9_15m ? (currentPrice - ema9_15m) / ema9_15m * 100 : 0;
  const shadowEntryMetrics = {
    distToEma9: Number(distToEma9.toFixed(2)),
    distToEma21: Number(distToEma21.toFixed(2)),
    atrPercent: Number(atrPercent15m.toFixed(2)),
    bbPercent: Number(bbPercent.toFixed(2))
  };
  const shadowMetaBase = {
    scoreBeforeMomentum,
    momentumAdjustment: momentumAdj?.adjustment || 0,
    sector: getSector(symbol)
  };

  if (signalType === 'BUY') {
    // 1. RSI/BB Overextension (Mystic Pulse update: strict BB limits to prevent overextended entries)
    let strictBbLimit = 0.85;
    if (regime === 'TRANSITION') strictBbLimit = 0.82;
    if (regime === 'TRENDING') strictBbLimit = 0.55; // Audit v7.4.2: Tightened to avoid buying tops

    if (bbPercent > strictBbLimit) {
      console.log(`[REJECT] ${symbol}: Strict BB Overextension Block (BB: ${bbPercent.toFixed(2)}) - Limit: ${strictBbLimit}`);
      return null;
    }

    if (rsi15m > 72) {
      console.log(`[REJECT] ${symbol}: Overextended RSI(${rsi15m.toFixed(1)})`);
      return null;
    }

    if (regime === 'TRENDING' && rsi15m > 68) {
      console.log(`[REJECT] ${symbol}: Overextended RSI in TRENDING (${rsi15m.toFixed(1)} > 68)`);
      return null;
    }

    // Retain isBreakout logic for subsequent filters
    const isBreakout = (trend4h === 'BULLISH' || sottSignal > 0.4) && rsi15m < 85;

    // 2. Distance to EMA21 - Standard filter
    if (distToEma21 > 1.8) {
      console.log(`[REJECT] ${symbol}: Dist to EMA21 too high (${distToEma21.toFixed(2)}%)`);
      return null;
    }

    // 3. Distance to EMA9 - Chase filter
    if (distToEma9 > 2.0 && !isBreakout) {
      // Allow chasing a bit more in breakouts
      console.log(`[REJECT] ${symbol}: Chase Filter - Dist to EMA9 too high (${distToEma9.toFixed(2)}%)`);
      return null;
    }

    // === NEW: TRENDING REGIME PULLBACK FILTER ===
    // In TRENDING regime, only buy strict pullbacks (near EMA21 or EMA50)
    // Audit v7.4.2: Removed isBreakout exception, tightened distances
    if (regime === 'TRENDING') {
      const nearEMA21 = Math.abs(distToEma21) < 0.5;  // Within 0.5% of EMA21
      const nearEMA50 = Math.abs(distToEma50) < 1.0;  // Within 1.0% of EMA50
      const priceAboveEMA21 = distToEma21 > 0;        // Price above EMA21 (uptrend)
      const priceAboveEMA50 = distToEma50 > 0;        // Price above EMA50 (uptrend)

      // Must be in uptrend
      if (!priceAboveEMA21 || !priceAboveEMA50) {
        console.log(`[REJECT] ${symbol}: TRENDING but not in uptrend (EMA21: ${distToEma21.toFixed(2)}%, EMA50: ${distToEma50.toFixed(2)}%)`);
        return null;
      }

      // Must be at strict pullback (near EMA21 or EMA50)
      if (!nearEMA21 && !nearEMA50) {
        console.log(`[REJECT] ${symbol}: TRENDING but no strict pullback to EMA21/50 (dist21: ${distToEma21.toFixed(2)}%, dist50: ${distToEma50.toFixed(2)}%)`);
        return null;
      }

      if (nearEMA21) reasons.push('📉 Strict Pullback EMA21');
      if (nearEMA50 && !nearEMA21) reasons.push('📉 Strict Pullback EMA50');
    }

    // === NEW: RANGING REGIME STRUCTURE FILTER ===
    // In RANGING, require MSS or Sweep for entry
    if (regime === 'RANGING') {
      // Will check mss and sweep after they're calculated
      // This is a placeholder - actual check comes later
    }
  }

  if (signalType === 'SELL_ALERT') return null;

  // === BTC CONTEXT FILTER v7.0 (NOW SUPPORTS DECOUPLING) ===
  if (btcContext) {
    if (btcContext.status === 'RED') {
      const btcRedThreshold = alphaSignal ? 78 : 88; // Lower threshold if token is de-correlated (Alpha)
      if (score < btcRedThreshold) {
        console.log(`[REJECT] ${symbol}: BTC RED requires score ${btcRedThreshold}, got ${score}`);
        if (shadowCollector && score >= 50) shadowCollector.push(recordShadowNearMiss(
          symbol,
          score,
          currentPrice,
          regime,
          `BTC_RED (score ${score} < ${btcRedThreshold})`,
          btcContext,
          shadowEntryMetrics,
          categoryScores,
          { ...shadowMetaBase, requiredScore: btcRedThreshold }
        ));
        return null;
      }
      reasons.push(alphaSignal ? '🔥 Alpha decoupling in BTC RED' : '⚠️ Mercado Macro Bajista (BTC Rojo)');
    } else if (btcContext.status === 'AMBER') {
      const btcAmberThreshold = alphaSignal ? 68 : 75; // Baseline 75 (was 78)
      if (score < btcAmberThreshold) {
        console.log(`[REJECT] ${symbol}: BTC AMBER requires score ${btcAmberThreshold}, got ${score}`);
        if (shadowCollector && score >= 50) shadowCollector.push(recordShadowNearMiss(
          symbol,
          score,
          currentPrice,
          regime,
          `BTC_AMBER (score ${score} < ${btcAmberThreshold})`,
          btcContext,
          shadowEntryMetrics,
          categoryScores,
          { ...shadowMetaBase, requiredScore: btcAmberThreshold }
        ));
        return null;
      }
      reasons.push('⚠️ Precaución Macro (BTC Ambar)');
    }
  }

  // [MOVED UP] MSS & Sweep detection moved before Regime checks

  // Volume checks per mode
  const sniperVolOk = volumeRatio >= 1.2;
  const aggressiveVolOk = volumeRatio >= 0.8;
  // v4.8 FIX: "Sunday Mode" / Low Volatility Handling
  // Instead of hard reject < 0.8, we apply a penalty. 
  // But we keep a hard floor at 0.3 to avoid "dead" coins.

  if (volumeRatio < 0.3) { // Absolute floor
    console.log(`[REJECT] ${symbol}: Volume DEAD (${volumeRatio.toFixed(2)})`);
    return null;
  }

  if (!aggressiveVolOk) {
    // Low Volume Penalty: Requires higher quality in other areas to pass
    score -= 10;
    reasons.push(`⚠️ Low Vol Penalty (-10)`);
    // === AUDIT v7.4.2: Hard reject if penalty is steep AND volume is truly dead ===
    // LTC LOSS (score 71→61, volRatio 0.69×) entered with dead volume and flash-stopped in 12min.
    // If the penalty dropped the score AND volumeRatio is below 0.8, this is not a tradeable setup.
    if (volumeRatio < 0.8) {
      console.log(`[REJECT] ${symbol}: Low Vol hard reject (volRatio ${volumeRatio.toFixed(2)} < 0.8 with -10 penalty)`);
      if (shadowCollector && score >= 50) shadowCollector.push(recordShadowNearMiss(
        symbol,
        score,
        currentPrice,
        regime,
        `LOW_VOL_HARD (volRatio ${volumeRatio.toFixed(2)})`,
        btcContext,
        { distToEma9: 0, distToEma21: 0, atrPercent: 0, bbPercent: 0 },
        categoryScores,
        { scoreBeforeMomentum: score + 10, momentumAdjustment: 0, sector: getSector(symbol) }
      ));
      return null;
    }
  }

  // Directional volume check: volume must flow in signal direction
  // BUY: net buying pressure (delta > 0). SELL: net selling pressure (delta < 0)
  if (signalType === 'BUY' && deltaRatio !== null && deltaRatio < 0) {
    console.log(`[REJECT] ${symbol}: BUY requires positive delta, got ${deltaRatio.toFixed(3)}`);
    return null;
  }
  if (signalType === 'SELL_ALERT' && deltaRatio !== null && deltaRatio > 0) {
    console.log(`[REJECT] ${symbol}: SELL requires negative delta, got ${deltaRatio.toFixed(3)}`);
    return null;
  }


  // Final Score Clamping
  score = Math.min(100, Math.max(0, score));

  // --- FINAL MODE DETERMINATION ---
  // A signal remains "SNIPER" only if IT PASSED ALL sniper filters
  const isSniperTrendRsi = reasons.includes('💎 MODO SNIPER');
  const isSniperVol = volumeRatio >= 1.5; // Upgraded from 1.2
  const isSniperScore = score >= 88;

  const finalMode = (isSniperTrendRsi && isSniperVol && isSniperScore) ? 'SNIPER' : 'AGGRESSIVE';

  // Update internal tag
  reasons.forEach((r, i) => {
    if (r === '💎 MODO SNIPER' || r === '⚡ MODO AGRESIVO') reasons.splice(i, 1);
  });
  reasons.unshift(finalMode === 'SNIPER' ? '💎 SEGURIDAD SNIPER' : '⚡ MODO AGRESIVO');

  // HIGH_VOLATILITY: Ultra strict
  if (regime === 'HIGH_VOLATILITY') {
    const passesVolatilityFilter =
      score >= 90 &&
      (mss || sweep) &&                       // Must have structure
      volumeRatio > 1.5 &&                    // Strong volume required
      btcRisk !== 'RED';

    if (!passesVolatilityFilter) {
      console.log(`[REJECT] ${symbol} (HighVol): score=${score}, structure=${!!(mss || sweep)}, btcRisk=${btcRisk}, volRatio=${volumeRatio.toFixed(2)}`);
      return null;
    }
    reasons.push('✅ HIGH_VOL_FILTER_PASSED');
  }

  // TRENDING: Require pullback confirmation
  if (regime === 'TRENDING') {
    const hasStructure = mss || sweep;
    const hasPullback = Math.abs(distToEma21) < 0.5 || Math.abs(distToEma50) < 1.0;

    if (!hasStructure && !hasPullback) {
      console.log(`[REJECT] ${symbol} (TRENDING): No structure or strict pullback (dist21: ${distToEma21.toFixed(2)}%)`);
      return null;
    }

    if (hasStructure) reasons.push('✅ TREND_STRUCTURE');
    if (hasPullback) reasons.push('✅ TREND_PULLBACK');
  }

  // RANGING: Require structure + buy cheap principle
  if (regime === 'RANGING') {
    // Don't buy in the upper part of the range
    // === AUDIT v7.4.2: Tightened from 0.75 → 0.65 ===
    // TAO LOSS (BB%=0.70) and LTC LOSS (BB%=0.71) entered overextended. All 6 WINs had BB% ≤ 0.37.
    if (signalType === 'BUY' && bbPercent > 0.65) {
      console.log(`[REJECT] ${symbol} (RANGING): BB% too high (${bbPercent.toFixed(2)})`);
      return null;
    }

    // Require structure (Unless exceptionally high score)
    if (!mss && !sweep && score < 85) {
      console.log(`[REJECT] ${symbol} (RANGING): Sin MSS ni Sweep y score ${score} < 85`);
      return null;
    }
  }

  // === FIX v5.2a: TRANSITION BB Overextension Hard Filter ===
  // Auditoría Feb-24: TRXUSDT entró con bbPercent=1.01 en régimen TRANSITION porque
  // el path MSS/Sweep bypaseaba el filtro general de overextension (línea 2234).
  // Mantenemos este gate explícito (con umbral más ajustado) como fail-safe final.
  if (regime === 'TRANSITION' && signalType === 'BUY' && bbPercent > 0.82) {
    console.log(`[REJECT] ${symbol} (TRANSITION): BB% overextended (${bbPercent.toFixed(2)} > 0.82) - entrada en zona de resistencia`);
    return null;
  }

  // === AUDIT v7.1.0-FIX: TRANSITION Volume Inertia Hard Filter ===
  // Auditoría Mar-12: El régimen TRANSITION tiene un WR del 25% (muy bajo).
  // La mayoría de los fallos ocurren por entrar sin suficiente inercia real (fake breakouts).
  // Endurecer el gate de volumen de 1.5 a 2.0 específicamente para TRANSITION.
  if (regime === 'TRANSITION' && volumeRatio < 2.0) {
    console.log(`[REJECT] ${symbol} (TRANSITION): Volume ratio ${volumeRatio.toFixed(2)} < 2.0 - inercia insuficiente para transición`);
    return null;
  }

  // Final score check
  if (score < MIN_QUALITY_SCORE) {
    console.log(`[REJECT] ${symbol}: Score ${score} < ${MIN_QUALITY_SCORE} | SOTT: ${sottValue.toFixed(2)} (${sottSignal.toFixed(2)})`);
    if (shadowCollector && score >= 50) shadowCollector.push(recordShadowNearMiss(
      symbol,
      score,
      currentPrice,
      regime,
      `SCORE (${score} < ${MIN_QUALITY_SCORE})`,
      btcContext,
      shadowEntryMetrics,
      categoryScores,
      { ...shadowMetaBase, requiredScore: MIN_QUALITY_SCORE }
    ));
    return null;
  }

  // Require visual confirmation for borderline scores
  const hasVisualConfirmation = divergences.length > 0 || patterns.length > 0 || mss || sweep;
  if (score < 80 && !hasVisualConfirmation) {
    console.log(`[REJECT] ${symbol}: Score ${score} < 80 and no confirmation`);
    return null;
  }

  // Minimum strong categories
  const requiredStrong = (regime === 'TRENDING' || regime === 'HIGH_VOLATILITY') ? 3 : 2;
  if (strongCategories < requiredStrong) {
    console.log(`[REJECT] ${symbol}: Strong Categories ${strongCategories} < ${requiredStrong}`);
    if (shadowCollector && score >= 50) shadowCollector.push(recordShadowNearMiss(
      symbol,
      score,
      currentPrice,
      regime,
      `STRONG_CAT (${strongCategories} < ${requiredStrong})`,
      btcContext,
      shadowEntryMetrics,
      categoryScores,
      { ...shadowMetaBase, requiredScore: MIN_QUALITY_SCORE, requiredStrongCategories: requiredStrong }
    ));
    return null;
  }

  // === FIX v5.2a: R:R Real Gate ===
  // Auditoría Feb-24: El riskRewardRatio en entryMetrics era un ratio TEÓRICO fijo (e.g. 2.5/1.8)
  // no relacionado con el ATR real del mercado. El trade TRXUSDT tuvo un R:R real de 1.39.
  // Calculamos aquí el R:R real con los multiplicadores de ATR que se usan para TP y SL:
  const tpMultiplier = regime === 'TRENDING' ? 4.5 : regime === 'HIGH_VOLATILITY' ? 2.5 : regime === 'TRANSITION' ? 3.2 : regime === 'DOWNTREND' ? 3.8 : 3.0;
  const slMultiplier = regime === 'TRENDING' ? 2.2 : regime === 'HIGH_VOLATILITY' ? 1.0 : regime === 'TRANSITION' ? 1.6 : regime === 'DOWNTREND' ? 1.8 : 1.8;
  const realRR = slMultiplier > 0 ? tpMultiplier / slMultiplier : 0;
  if (realRR < 1.5) {
    console.log(`[REJECT] ${symbol}: R:R real insuficiente (${realRR.toFixed(2)} < 1.50) para régimen ${regime}`);
    return null;
  }

  // === AUDIT v7.4.2: DOWNTREND subset DISABLED — returned to full shadow-only ===
  // v7.4.1 reopened this subset but live results were 1W / 4L (20% WR) with 0% favorable move
  // on all 4 LOSS trades. The shadow edge (51.9% WR) doesn't translate to live because the
  // shadow benchmark (R:R 1.25:1) is much more lenient than the live R:R (2.11:1).
  // Keeping as shadow-only until a tighter benchmark validates real edge.
  // const allowLiveDowntrendSubset = false; // QUARANTINED

  if (shadowOnlyRegimeReason) {
    console.log(`[REJECT] ${symbol}: ${regime} configured as SHADOW_ONLY for live spot entries`);
    if (shadowCollector && score >= 50) shadowCollector.push(recordShadowNearMiss(
      symbol,
      score,
      currentPrice,
      regime,
      shadowOnlyRegimeReason,
      btcContext,
      shadowEntryMetrics,
      categoryScores,
      {
        ...shadowMetaBase,
        requiredScore: MIN_QUALITY_SCORE,
        requiredStrongCategories: requiredStrong
      }
    ));
    return null;
  }

  // === FINAL OUTPUT ===
  if (score >= MIN_QUALITY_SCORE && reasons.length > 0 && signalType) {
    return {
      symbol,
      price: currentPrice,
      price1h: currentPrice1h,
      score,
      regime,
      categoryScores,
      strongCategories,
      type: signalType,
      rsi: rsi15m.toFixed(1),
      rsi1h: rsi1h.toFixed(1),
      stochRSI: stoch15m ? stoch15m.k.toFixed(1) : null,
      macdBullish: macd15m.bullish,
      macdBullish1h: macd1h.bullish,

      hasSMC: !!(nearbyBullishOB || nearbyBullishFVG || nearbyBearishOB || nearbyBearishFVG),
      smcSignal: nearbyBullishOB ? 'OB_BULL' : nearbyBearishOB ? 'OB_BEAR' : nearbyBullishFVG ? 'FVG_BULL' : nearbyBearishFVG ? 'FVG_BEAR' : null,
      hasMSS: !!mss,
      hasSweep: !!sweep,
      superTrend: superTrend15m.bullish ? 'BULL' : 'BEAR',
      superTrendFlipped: superTrend15m.flipped,
      bbPosition: Math.round(bbPercent * 100),
      bbUpper: bb15m.upper,
      bbLower: bb15m.lower,
      hasDivergence: divergences.length > 0,
      hasPattern: patterns.length > 0,
      volumeRatio: Number(volumeRatio.toFixed(2)),
      volumeConfirmed: volumeRatio > 1.2,
      spreadBps: Number(obMetrics.spreadBps.toFixed(1)),
      depthQuoteTopN: Math.round(obMetrics.depthQuoteTopN),
      obi: Number(obMetrics.obi.toFixed(3)),
      deltaRatio: deltaRatio === null ? null : Number(deltaRatio.toFixed(3)),
      atrPercent: Number(atrPercent15m.toFixed(2)),
      vwap: vwap15m,
      vwapDistance: vwap15m ? Number((((currentPrice - vwap15m) / vwap15m) * 100).toFixed(2)) : null,
      // === ENHANCED SL/TP BASED ON REGIME ANALYSIS ===
      // RANGING (75% WR): Standard targets work well
      // TRANSITION (33% WR): Tighter targets - take profit quicker
      // TRENDING (27% WR): Wider targets to capture trend, but strict entry
      // HIGH_VOLATILITY (23% WR): Very tight targets - quick in/out
      tp: signalType === 'BUY'
        ? currentPrice * (1 + (atrPercent15m / 100) * (
          // 🚀 OPTIMIZACIÓN MILLONARIA: Take Profit Agresivo
          regime === 'TRENDING' ? 4.5 :       // Aumentado de 4.0 (mejor R:R)
            regime === 'HIGH_VOLATILITY' ? 2.5 : // Aumentado de 2.0
              regime === 'TRANSITION' ? 3.2 :    // Aumentado de 2.5
                regime === 'DOWNTREND' ? 3.8 :  // TP más ambicioso en rebotes
                  3.0  // RANGING — Aumentado de 2.0
        ))
        : currentPrice * (1 - (atrPercent15m / 100) * (
          regime === 'TRENDING' ? 4.5 :
            regime === 'HIGH_VOLATILITY' ? 2.5 :
              regime === 'TRANSITION' ? 3.2 :
                regime === 'DOWNTREND' ? 3.8 :
                  3.0  // RANGING
        )),
      sl: signalType === 'BUY'
        ? currentPrice * (1 - (atrPercent15m / 100) * (
          // 🚀 OPTIMIZACIÓN MILLONARIA: Stop Loss Inteligente
          regime === 'TRENDING' ? 2.2 :       // Reducido de 2.5 (mejor R:R)
            regime === 'HIGH_VOLATILITY' ? 1.0 : // Reducido de 1.2
              regime === 'TRANSITION' ? 1.6 :    // Reducido de 1.8
                regime === 'DOWNTREND' ? 1.8 :  // SL más ajustado en bajistas
                  1.8  // RANGING — Reducido de 2.0
        ))
        : currentPrice * (1 + (atrPercent15m / 100) * (
          regime === 'TRENDING' ? 2.2 :
            regime === 'HIGH_VOLATILITY' ? 1.0 :
              regime === 'TRANSITION' ? 1.6 :
                regime === 'DOWNTREND' ? 1.8 :
                  1.8  // RANGING
        )),
      // Enhanced metrics for post-analysis
      entryMetrics: {
        distToEma9: Number(distToEma9.toFixed(2)),
        distToEma21: Number(distToEma21.toFixed(2)),
        distToEma50: Number(distToEma50.toFixed(2)),
        atrPercent: Number(atrPercent15m.toFixed(2)),
        bbPercent: Number((bbPercent || 0).toFixed(2)),
        riskRewardRatio: Number(realRR.toFixed(2)) // FIX v5.2a: R:R real calculado a partir de multiplicadores ATR reales
      },
      scoreBeforeMomentum,
      momentumAdjustment: momentumAdj?.adjustment || 0,
      requiredScore: MIN_QUALITY_SCORE,
      requiredStrongCategories: requiredStrong,
      reasons,
      mode: finalMode,
      recommendedSize: calculateRecommendedSize(score, atrPercent15m, regime, !!mss, !!sweep, volumeRatio, rs4h),
      btcContext // Include context in result
    };
  }

  return null;
}

// ==================== TELEGRAM ====================

async function sendTelegramNotification(signals, stats = null) {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram disabled or missing credentials');
    return { success: false, reason: 'disabled' };
  }

  const hasHistory = stats && (stats.open > 0 || stats.wins > 0 || stats.losses > 0);
  if (signals.length === 0 && !hasHistory) {
    return { success: true, sent: 0 };
  }

  // Helper to ensure values are safe for MarkdownV2
  const esc = (val) => escapeMarkdownV2(val !== undefined && val !== null ? val : '');

  let message = '🔔 *DAY TRADE ALERT* 🔔\n';

  if (stats) {
    message += `📊 _Win Rate: ${esc(stats.winRate)}% \\| Open: ${esc(stats.open)} \\| W/L: ${esc(stats.wins)}/${esc(stats.losses)}_\n`;
  }

  message += `_${esc('15m • Multi-TF • Institutional Quality')}_\n\n`;

  const sortedSignals = [...signals].sort((a, b) => b.score - a.score);

  for (const sig of sortedSignals.slice(0, 5)) {
    let icon = '📊';
    let typeEmoji = '';
    if (sig.type === 'BUY') { icon = '🟢'; typeEmoji = '🛒 COMPRA'; }
    else if (sig.type === 'SELL_ALERT') { icon = '🔴'; typeEmoji = '📤 VENTA'; }
    else { typeEmoji = '👁️ VIGILAR'; }

    // Symbol and Mode
    const modeLabel = sig.mode === 'SNIPER' ? '💎 SNIPER' : '⚡ AGRESIVO';
    message += `${icon} *${esc(sig.symbol)}* \\| ${esc(typeEmoji)} \\| ${esc(modeLabel)}\n`;

    // Price & Levels
    if (Number.isFinite(sig.price)) {
      const priceStr = sig.price < 1 ? sig.price.toFixed(6) : sig.price.toFixed(2);
      const tpStr = sig.tp < 1 ? sig.tp.toFixed(6) : sig.tp.toFixed(2);
      const slStr = sig.sl < 1 ? sig.sl.toFixed(6) : sig.sl.toFixed(2);

      const ch = sig.vwapDistance;
      if (ch !== undefined && ch !== null) {
        const changeIcon = ch >= 0 ? '📈' : '📉';
        const changeSign = ch >= 0 ? '+' : '';
        message += `💰 *$${esc(priceStr)}* ${changeIcon} ${esc(changeSign + ch)}% \\(VWAP\\)\n`;
      } else {
        message += `💰 *$${esc(priceStr)}*\n`;
      }
      message += `🎯 *TP: ${esc(tpStr)}* \\| 🛡️ *SL: ${esc(slStr)}*\n`;
    }

    // Indicators
    message += `📊 RSI: ${esc(sig.rsi)} \\(15m\\) / ${esc(sig.rsi1h)} \\(1h\\)`;
    if (sig.stochRSI) message += ` \\| Stoch: ${esc(sig.stochRSI)}`;
    message += `\n`;

    message += `📍 BB: ${esc(sig.bbPosition)}%`;
    if (sig.superTrend) message += ` \\| ST: ${esc(sig.superTrend)}`;
    if (sig.superTrendFlipped) message += ` 🔄`;
    if (sig.macdBullish !== undefined) message += ` \\| MACD: ${sig.macdBullish ? '🟢' : '🔴'}`;
    message += `\n`;

    // Regime & Score
    const regimeIcon = sig.regime === 'TRENDING' ? '📈' : (sig.regime === 'RANGING' ? '↔️' : '⚠️');
    message += `${regimeIcon} Regime: ${esc(sig.regime)} \\| 🎯 Score: *${esc(sig.score)}*/100\n`;
    message += `💰 *Size Sugerido: ${esc(sig.recommendedSize)}%*\n`;

    if (sig.btcContext && sig.btcContext.status !== 'GREEN') {
      const btcIcon = sig.btcContext.status === 'RED' ? '🔴' : '🟡';
      message += `${btcIcon} BTC Risk: ${esc(sig.btcContext.status)}\n`;
    }

    // SMC & Confluence
    let badges = [];
    if (sig.hasSMC) badges.push(`🏦 ${sig.smcSignal}`);
    if (sig.hasMSS) badges.push('🔄MSS');
    if (sig.hasSweep) badges.push('🧹SWP');
    if (sig.hasDivergence) badges.push('🔥DIV');
    if (sig.hasPattern) badges.push('🕯️PAT');
    if (badges.length > 0) {
      const escapedBadges = badges.map(b => esc(b));
      message += `✨ ${escapedBadges.join(' ')}\n`;
    }

    // Volume
    if (sig.volumeConfirmed) message += `📊 Vol: ${esc(sig.volumeRatio)}x\n`;

    // Order Flow
    if (sig.spreadBps !== undefined || sig.obi !== undefined) {
      const spreadText = sig.spreadBps !== undefined ? String(sig.spreadBps) : 'N/A';
      const obiText = sig.obi !== undefined ? String(sig.obi) : 'N/A';
      message += `📚 Spread: ${esc(spreadText)} bps \\| OBI: ${esc(obiText)}\n`;
    }

    // ATR & Delta
    if (sig.atrPercent !== undefined) {
      message += `🌀 ATR: ${esc(sig.atrPercent)}%`;
      if (sig.deltaRatio !== undefined && sig.deltaRatio !== null) message += ` \\| Δ: ${esc(sig.deltaRatio)}`;
      message += `\n`;
    }

    // Reasons
    const reasonsArr = Array.isArray(sig.reasons) ? sig.reasons : [];
    if (reasonsArr.length > 0) {
      message += `💡 _${esc(reasonsArr[0])}_\n`;
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

// ==================== MAIN ANALYSIS FUNCTION ====================

export async function runAnalysis(context) {
  // 0. Check trading session
  if (!isTradingAllowed()) {
    console.log('[SESSION] Trading paused - Low liquidity session');
    return { success: true, signals: 0, reason: 'Asia session - trading restricted' };
  }

  // 1. Acquire Global Lock
  const canProceed = await acquireRunLock(context);
  if (!canProceed) return { success: false, error: 'Locked' };

  const runId = `RUN-${Math.floor(Math.random() * 1000000)}`;
  const cycleLogs = [];

  // Helper to log both to console and persistent store for audit
  const pLog = (msg) => {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const logEntry = `[${timestamp}] ${msg}`;
    console.log(msg);
    cycleLogs.push(logEntry);
  };

  try {
    pLog(`--- DAY TRADE Analysis Started ${ALGORITHM_VERSION} ---`);
    pLog(`Execution ID: ${runId}`);

    // Load persistent cooldowns
    const cooldowns = await loadCooldowns(context);
    pLog(`Loaded ${Object.keys(cooldowns).length} cooldown entries`);

    const signals = [];
    const shadowCandidates = []; // NEW: Collect near-misses this cycle
    let analyzed = 0;
    let errors = 0;
    const selectedSectors = new Set(); // Track protected sectors to avoid correlation
    const selectedSectorLeaders = new Map();

    // === SELF-LEARNING: Load Signal Memory ===
    const signalMemory = await loadSignalMemory(context);
    pLog(`[MEMORY] Loaded memory for ${Object.keys(signalMemory).length} symbols`);

    // === BTC GLOBAL CONTEXT ANALYSIS ===
    let btcContext = { status: 'GREEN', reason: 'BTC Analysis Passed (Default)' };
    try {
      const btcSymbol = `BTC${QUOTE_ASSET}`;
      const [btcCandles4h, btcCandles1h] = await Promise.all([  // FIXED: typo
        getKlines(btcSymbol, '4h', 100),
        getKlines(btcSymbol, '60m', 100)
      ]);

      if (btcCandles4h && btcCandles4h.length > 50) {  // FIXED: typo
        const closed4h = getClosedCandles(btcCandles4h, '4h');
        const closes4h = closed4h.map(c => c.close);
        const closes1h = getClosedCandles(btcCandles1h, '60m').map(c => c.close);

        const btcSt4h = calculateSuperTrend(closed4h, 10, 3);
        const btcRsi4h = calculateRSI(closes4h, 14);
        const btcRsi1h = calculateRSI(closes1h, 14);

        if (btcSt4h.bearish || btcRsi4h > 75) {
          btcContext = {
            status: 'RED',
            reason: 'BTC 4H Bearish or Overextended',
            rsi4h: btcRsi4h,
            closes4h: closes4h,
            closes1h: closes1h
          };
          pLog(`[BTC-SEM] 🔴 RED: ST=${btcSt4h.bearish ? 'Bear' : 'Bull'}, RSI4H=${btcRsi4h.toFixed(1)}`);
        } else if (btcSt4h.bullish && btcRsi1h > 65) {
          btcContext = {
            status: 'AMBER',
            reason: 'BTC 1H Overbought',
            rsi4h: btcRsi4h,
            closes4h: closes4h,
            closes1h: closes1h
          };
          pLog(`[BTC-SEM] 🟡 AMBER: RSI1H=${btcRsi1h.toFixed(1)}`);
        } else {
          btcContext = {
            status: 'GREEN',
            reason: 'BTC Healthy',
            rsi4h: btcRsi4h,
            closes4h: closes4h,
            closes1h: closes1h
          };
          pLog(`[BTC-SEM] 🟢 GREEN: Trend Healthy`);
        }
      }
    } catch (btcErr) {
      console.warn('Failed to analyze BTC context:', btcErr.message);
    }

    const tickers24h = await getAllTickers24h();
    const tickersBySymbol = new Map(tickers24h.map(t => [t.symbol, t]));

    const topSymbols = tickers24h.length > 0
      ? getTopSymbolsByOpportunity(tickers24h, QUOTE_ASSET, MAX_SYMBOLS, MIN_QUOTE_VOL_24H)
      : FALLBACK_SYMBOLS;

    // Update Backtesting History & Stats BEFORE scanning
    const histData = await updateSignalHistory(tickers24h, context, pLog);
    const stats = histData?.stats || { open: 0, wins: 0, losses: 0, winRate: 0 };
    const openSymbols = histData?.openSymbols || [];

    if (stats) pLog(`[${runId}] Performance Stats: ${JSON.stringify(stats)}`);

    // === SELF-LEARNING: Update Shadow Trades ===
    const shadowStats = await updateShadowTrades(tickers24h, context, pLog);
    if (shadowStats.total > 0) {
      pLog(`[SHADOW] Stats: ${shadowStats.wouldWin} would-win / ${shadowStats.wouldLose} would-lose of ${shadowStats.total} resolved`);
    }

    for (const symbol of topSymbols) {
      if (openSymbols.includes(symbol)) {
        pLog(`[${runId}] Skipping ${symbol} - Already have an OPEN position`);
        continue;
      }

      if (cooldowns[symbol] && (Date.now() - cooldowns[symbol] < ALERT_COOLDOWN_MIN * 60000)) {
        continue;
      }
      try {
        const [candles15m, orderBook, candles1hRaw, candles4hRaw] = await Promise.all([
          getKlines(symbol, '15m', 500),
          getOrderBookDepth(symbol, 20),
          USE_MULTI_TF ? getKlines(symbol, '60m', 200) : Promise.resolve([]),
          USE_MULTI_TF ? getKlines(symbol, '4h', 100) : Promise.resolve([])
        ]);

        const ticker24h = tickersBySymbol.get(symbol) || null;
        let candles1h = candles1hRaw;
        let candles4h = candles4hRaw;

        if (!USE_MULTI_TF) {
          candles1h = (candles15m && candles15m.length > 0) ? candles15m.slice(-200) : [];
        }

        analyzed++;

        // === SELF-LEARNING: Calculate momentum adjustment ===
        const momentumAdj = calculateMomentumAdjustment(signalMemory, symbol, pLog);

        const signal = generateSignal(symbol, candles15m, candles1h, candles4h, orderBook, ticker24h, btcContext, momentumAdj, shadowCandidates);
        let signalAccepted = false;
        if (signal) {
          const sector = getSector(symbol);
          signal.sector = sector;
          const protectedSector = isProtectedSector(sector);

          if (protectedSector && selectedSectors.has(sector)) {
            const blockedBySymbol = selectedSectorLeaders.get(sector) || 'UNKNOWN';
            shadowCandidates.push(recordShadowNearMiss(
              symbol,
              signal.score,
              signal.price,
              signal.regime,
              `SECTOR_CORRELATION (${sector} blocked by ${blockedBySymbol})`,
              signal.btcContext,
              signal.entryMetrics,
              signal.categoryScores,
              {
                scoreBeforeMomentum: signal.scoreBeforeMomentum,
                momentumAdjustment: signal.momentumAdjustment,
                requiredScore: signal.requiredScore,
                requiredStrongCategories: signal.requiredStrongCategories,
                sector,
                blockedBySector: sector,
                blockedBySymbol
              }
            ));
            pLog(`[${runId}] Skipping ${symbol} - Sector ${sector} already selected by ${blockedBySymbol}`);
          } else {
            // IMMEDIATE COOLDOWN PROTECTION
            cooldowns[symbol] = Date.now();
            await saveCooldowns(cooldowns, context);

            // Only protect sectors with a meaningful taxonomy; leave OTHER unbounded.
            if (protectedSector) {
              selectedSectors.add(sector);
              selectedSectorLeaders.set(sector, symbol);
            }

            await recordSignalHistory(signal, context);
            signals.push(signal);
            signalAccepted = true;
            pLog(`[${runId}] 🎯 SIGNAL GENERATED: ${symbol} | Score: ${signal.score} | Sector: ${sector}`);

            // Record score in memory (passed)
            recordSymbolScore(signalMemory, symbol, signal.score, signal.regime);
          }
        }
        // Record near-miss scores in memory too (for momentum tracking)
        const lastShadow = shadowCandidates.length > 0 ? shadowCandidates[shadowCandidates.length - 1] : null;
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

    // === SELF-LEARNING: Save Signal Memory ===
    await saveSignalMemory(signalMemory, context);

    // === SELF-LEARNING: Save Shadow Near-Misses ===
    if (shadowCandidates.length > 0) {
      const existingShadows = await loadShadowTrades(context);
      const allShadows = [...existingShadows, ...shadowCandidates];
      await saveShadowTrades(allShadows, context);
      pLog(`[SHADOW] Recorded ${shadowCandidates.length} near-misses this cycle`);
    }

    // === AUDIT: Save Persistent Logs ===
    const existingLogs = await loadPersistentLogs(context);
    await savePersistentLogs([...existingLogs, ...cycleLogs], context);

    let telegramResult = { success: true, sent: 0 };
    if (signals.length > 0) {
      telegramResult = await sendTelegramNotification(signals, stats);
    }

    // Release lock on success
    await releaseRunLock(context);

    return {
      success: true,
      id: runId,
      analyzed,
      signals: signals.length,
      errors,
      shadowsRecorded: shadowCandidates.length,
      shadowStats,
      persistentLogsRecorded: cycleLogs.length,
      telegram: telegramResult,
      timestamp: new Date().toISOString()
    };
  } catch (globalErr) {
    pLog(`CRITICAL ERROR in runAnalysis: ${globalErr.message}`);
    await releaseRunLock(context);
    return { success: false, error: globalErr.message };
  }
}

// ==================== SCHEDULED HANDLER (Netlify) ====================

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
    if (!incomingSignals || incomingSignals.length === 0) {
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

/**
 * Calculates 'Signs of the Times' (SOTT) Indicator
 * Based on LucF's methodology: Weighted sum of bullish/bearish bar properties.
 * returns { value: number, signal: number }
 * Range: -1.0 to +1.0
 */
function calculateSOTT(candles, signalLength = 20) {
  if (!candles || candles.length < signalLength + 2) return { value: 0, signal: 0 };

  const sottValues = [];

  // Start from index 1 (need previous candle)
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];

    const c = Number(curr.close);
    const o = Number(curr.open);
    const h = Number(curr.high);
    const l = Number(curr.low);
    const v = Number(curr.volume);

    const pc = Number(prev.close);
    const po = Number(prev.open);
    const ph = Number(prev.high);
    const pl = Number(prev.low);
    const pv = Number(prev.volume);

    let bull = 0;
    let bear = 0;
    let maxWeight = 0;

    const isUp = c > o;
    const bodyCurrent = Math.abs(c - o);
    const wicksCurrent = (h - l) - bodyCurrent;

    // 1. Close > Open (Weight 1)
    maxWeight += 1;
    if (isUp) bull++; else bear++;

    // 2. Rising Close (Weight 1)
    maxWeight += 1;
    if (c > pc) bull++; else if (c < pc) bear++;

    // 3. Rising High (Weight 1)
    maxWeight += 1;
    if (h > ph) bull++; else if (h < ph) bear++;

    // 4. Rising Low (Weight 1)
    maxWeight += 1;
    if (l > pl) bull++; else if (l < pl) bear++;

    // 5. Volume Increase (Weight 2)
    maxWeight += 2;
    if (v > pv) {
      if (isUp) bull += 2; else bear += 2;
    }

    // 6. Strong Body (Body > Wicks) (Weight 1)
    maxWeight += 1;
    if (bodyCurrent > wicksCurrent) {
      if (isUp) bull++; else bear++;
    }

    // 7. Gap (Weight 2)
    maxWeight += 2;
    if (l > ph) bull += 2; // Gap Up
    else if (h < pl) bear += 2; // Gap Down

    // Calculate normalized value for this bar (-1 to 1)
    // Formula: (Bull - Bear) / MaxWeight
    // If MaxWeight is 0 (unlikely), default to 0
    const val = maxWeight > 0 ? (bull - bear) / maxWeight : 0;
    sottValues.push(val);
  }

  // Current Value (last one)
  const currentSOTT = sottValues[sottValues.length - 1];

  // Calculate Signal (SMA of SOTT)
  let sum = 0;
  let count = 0;
  // Use available data up to signalLength
  const startIdx = Math.max(0, sottValues.length - signalLength);
  for (let i = startIdx; i < sottValues.length; i++) {
    sum += sottValues[i];
    count++;
  }
  const signal = count > 0 ? sum / count : 0;

  return { value: currentSOTT, signal };
}


export const handler = schedule("*/15 * * * *", scheduledHandler);

export { detectSmartMoneyConcepts };
