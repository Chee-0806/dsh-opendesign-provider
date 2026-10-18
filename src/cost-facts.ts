/** Shared, JSON-only billing facts. No Host or browser runtime imports. */
import type { CommandCodeModelPrice, CommandCodeModelRates, CommandCodePriceTable } from './usage-wire.ts'

export interface CostTokens {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Requests with identical model/rates are folded into one group. */
export interface CostUsageGroup {
  provider: string
  model: string
  at: number | null
  contextTokens: number
  tokens: CostTokens
}

export interface SessionCostFacts {
  pricingKey: number
  groups: CostUsageGroup[]
  /**
   * Token buckets contributed by summarization calls, already folded into
   * `groups` but deliberately NOT part of the harness's own `tokenUsage`
   * projection.
   *
   * Compaction issues its own `ctx.llm.stream()` call, so its cost is real
   * spend, but it produces no `assistant/message` or `assistant/attempt` event
   * — the only two the harness meter folds (see `token-meter/src/usage-projection.ts`).
   * The summary therefore lands in this projection alone, and the composer
   * readout subtracts this field before asserting that both projections
   * describe the same durable cut. Without the split the equality check fails
   * and the whole readout disappears whenever a session compacts.
   *
   * Always present: `parseState` backfills it to zero for state written before
   * this field existed.
   */
  summaryTokens: CostTokens
}

export const zeroCostTokens = (): CostTokens => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
export const COST_TOKEN_KEYS = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const

export function peakHour(at: number, windows: ReadonlyArray<readonly [number, number]>): boolean {
  const time = new Date(at)
  return time.getUTCDay() !== 0 && time.getUTCDay() !== 6
    && windows.some(([start, end]) => time.getUTCHours() >= start && time.getUTCHours() < end)
}

/**
 * All prompt billing buckets determine a request's band, never cumulative
 * session input.
 *
 * A tiered model returns the matching band and does NOT then apply `peak`: the
 * page publishes those two dimensions independently and no row carries both
 * today, so the combination becoming real is visible before it reaches a user.
 * This ordering is a latent choice, not a verified upstream rule.
 */
export function requestRates(
  price: CommandCodeModelPrice,
  at: number | null,
  contextTokens: number,
  table: CommandCodePriceTable,
  peakHours?: Map<number, boolean>,
): CommandCodeModelRates {
  // ORDER IS LOAD-BEARING: the generator refuses non-ascending bounds or a
  // bounded last band and the wire parser rejects the same shapes, so a
  // conforming table cannot present bands out of order.
  const tier = price.contextTiers?.find(tier => tier.maxContext === undefined || contextTokens <= tier.maxContext)
  if (tier !== undefined) return tier
  if (price.peak === undefined || at === null) return price
  // `peakHour` constructs a Date and reads three of its fields. The analytics
  // scenario matrix asks this question once per (fact, catalog model), and the
  // answer depends only on `at` and the table's windows — so a caller that is
  // pricing many candidates against one table can pass a memo to collapse the
  // repeated work. The memo is the caller's, so it can never outlive its table.
  let peak = peakHours?.get(at)
  if (peak === undefined) {
    peak = peakHour(at, table.peakHours)
    peakHours?.set(at, peak)
  }
  return peak ? price.peak : price
}

/**
 * Price one request's token buckets against an already-resolved price row.
 *
 * Split out of the report's per-model lookup so a caller that prices the same
 * candidate model against every fact — the analytics scenario matrix — resolves
 * the price row once per model instead of once per (fact, model) pair. The
 * arithmetic lives here alone so the two callers cannot drift.
 */
export function requestCost(
  tokens: CostTokens,
  price: CommandCodeModelPrice,
  at: number | null,
  table: CommandCodePriceTable,
  peakHours?: Map<number, boolean>,
): number | undefined {
  if (price.free === true) return 0
  const context = tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens
  const r = requestRates(price, at, context, table, peakHours)
  if (tokens.cacheWriteTokens > 0 && r.cacheWriteCost === undefined) return undefined
  return (tokens.uncachedInputTokens * r.inputCost + tokens.outputTokens * r.outputCost + tokens.cacheReadTokens * r.cacheReadCost + tokens.cacheWriteTokens * (r.cacheWriteCost ?? 0)) / 1e6
}

/** Cache version and wire guard: changing bands/rates must refold historical groups. */
export function pricingKey(table: CommandCodePriceTable): number {
  const rates = (r: CommandCodeModelRates) => [r.inputCost, r.outputCost, r.cacheReadCost, r.cacheWriteCost ?? null]
  const canonical = JSON.stringify(['commandCodeCost-v1', table.peakHours, table.models.map(p => [p.id, p.slug, p.free === true, rates(p), p.peak ? rates(p.peak) : null, p.contextTiers?.map(t => [t.maxContext ?? null, rates(t)]) ?? null])])
  let hash = 2166136261
  for (const c of canonical) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0
  return hash
}

/** Only safe to merge requests whose billing classification is identical. */
export function costGroupKey(group: CostUsageGroup, table: CommandCodePriceTable): string {
  // The table is mutable, so an identity-keyed index can keep stale model
  // mappings after its rows are changed in place. The projection already
  // indexes its usage groups once per settlement; scan the small price table
  // here so every call observes the current rows.
  const price = table.models.find(p => p.id === group.model || p.slug === group.model)
  return JSON.stringify([group.provider, group.model, price === undefined ? null : requestRates(price, group.at, group.contextTokens, table), group.at === null])
}
