// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  calculateOrderBookMetrics,
  classifyBuyStopOutcome,
  classifyLiquidityTier,
  getExecutionRejectCode
} from '../netlify/functions/trader-bot.js';
import { closeTradeWithTelemetry as closeKnifeTradeWithTelemetry } from '../netlify/functions/knife-catcher.js';

function buildOrderBook(levels = 20, price = 100, quantity = 50) {
  return {
    bids: Array.from({ length: levels }, (_, index) => [price - (index * 0.1), quantity]),
    asks: Array.from({ length: levels }, (_, index) => [price + 0.1 + (index * 0.1), quantity])
  };
}

describe('scheduled-analysis execution gates', () => {
  it('uses the full fetched order book snapshot for depth', () => {
    const metrics = calculateOrderBookMetrics(buildOrderBook());

    expect(metrics).not.toBeNull();
    expect(metrics.depthQuoteTopN).toBeGreaterThan(150000);
    expect(metrics.spreadBps).toBeGreaterThan(0);
  });

  it('classifies medium liquidity at the documented live floor', () => {
    expect(classifyLiquidityTier(8_000_000, 90_000, 8)).toBe('MEDIUM');
    expect(classifyLiquidityTier(7_999_999, 90_000, 8)).toBe('LOW');
  });

  it('prioritizes spread, depth, then liquidity-tier rejects', () => {
    expect(getExecutionRejectCode({ spreadBps: 8.5, depthQuoteTopN: 500_000 }, 'HIGH')).toBe('EXEC_SPREAD');
    expect(getExecutionRejectCode({ spreadBps: 2, depthQuoteTopN: 89_999 }, 'HIGH')).toBe('EXEC_DEPTH');
    expect(getExecutionRejectCode({ spreadBps: 2, depthQuoteTopN: 200_000 }, 'LOW')).toBe('LIQUIDITY_TIER_LOW');
    expect(getExecutionRejectCode({ spreadBps: 2, depthQuoteTopN: 200_000 }, 'HIGH')).toBeNull();
  });

  it('records a break-even exit when a moved stop is hit above entry', () => {
    const item = {
      type: 'BUY',
      trailingStopActive: true,
      sl: 100.1
    };

    expect(classifyBuyStopOutcome(item, 100, 100.02)).toEqual({
      outcome: 'BREAK_EVEN',
      exitReason: 'TRAIL_BE_STOP'
    });
  });

  it('keeps gap-through trailing-stop exits classified as losses', () => {
    const item = {
      type: 'BUY',
      trailingStopActive: true,
      sl: 100.1
    };

    expect(classifyBuyStopOutcome(item, 100, 99.8)).toEqual({
      outcome: 'LOSS',
      exitReason: 'TRAIL_STOP_GAP_LOSS'
    });
  });

  it('adds explicit exit telemetry to knife-catcher closures', () => {
    const item = { status: 'OPEN', outcome: null };

    closeKnifeTradeWithTelemetry(item, 'STALE_EXIT', 'TIME_STOP_STALE_EXIT', 101.25, 1234567890);

    expect(item).toMatchObject({
      status: 'CLOSED',
      outcome: 'STALE_EXIT',
      exitReason: 'TIME_STOP_STALE_EXIT',
      exitPrice: 101.25,
      closedAt: 1234567890
    });
  });
});
