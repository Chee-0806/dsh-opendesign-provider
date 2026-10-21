/**
 * Host half of `opendesign/analytics` (ticket 12).
 *
 * One request reads a bounded slice of the host's own history, folds it into
 * per-model counters and joins the catalog's `cost`/`capability` words. No
 * price table, no currency, no estimate: ADR-0002 removed money from this
 * product, and the wire type has no field that could carry it.
 *
 * This module owns the report function only. The method is mounted on the one
 * `opendesignUsage` Service instance (`OpenDesignModelsService`), because
 * Cordis registers one Service per key and two `ctx.inject(['typert'])` scopes
 * cannot see each other's services. `applyModelsRemote` therefore takes these
 * deps optionally and adds the `analytics` method and descriptor together.
 *
 * @module dsh-opendesign-provider/analytics-remote
 */

import { foldAnalytics, type AnalyticsFoldOptions, type AnalyticsFoldResult } from './analytics-fold.ts'
import {
  collectAnalyticsSessions,
  type SessionQueryLike,
} from './analytics-history.ts'
import {
  type AnalyticsHistoryCoverage,
  type AnalyticsModelRow,
  type AnalyticsScope,
  type AnalyticsTotals,
  type AnalyticsQuery,
  type OpenDesignAnalyticsReport,
} from './analytics-wire.ts'
import type { GatewayCatalogEntry, GatewayCatalogStatus } from './gateway-facts.ts'
import { PROVIDER } from './identity.ts'

/** Everything the analytics service reads beyond its Cordis context. */
export interface OpenDesignAnalyticsDeps {
  /** The optional host session-query service; undefined when unmounted. */
  sessionQuery: () => SessionQueryLike | undefined
  /** The adapter's catalog provenance; a throw is reported as "no catalog". */
  catalogStatus: () => Promise<GatewayCatalogStatus>
  /** The current model-visibility rule, so hidden models are marked as such. */
  isVisible: (id: string) => boolean
  /** Clock seam for tests. */
  now?: (() => number) | undefined
}

/** The inputs of one report, already read and folded. */
export interface BuildAnalyticsReportInput {
  readonly scope: AnalyticsScope
  readonly fold: AnalyticsFoldResult
  readonly coverage: AnalyticsHistoryCoverage
  readonly catalog: GatewayCatalogStatus | undefined
  readonly isVisible: (id: string) => boolean
  readonly now: () => number
}

/** Average one counter, rounded to whole milliseconds; absent with no samples. */
function average(total: number, samples: number): number | undefined {
  return samples === 0 ? undefined : Math.round(total / samples)
}

/** Sum two counter sets. */
function addCounters(into: AnalyticsTotals, row: AnalyticsModelRow): AnalyticsTotals {
  return {
    ...into,
    requests: into.requests + row.requests,
    succeeded: into.succeeded + row.succeeded,
    failed: into.failed + row.failed,
    interrupted: into.interrupted + row.interrupted,
    retries: into.retries + row.retries,
    inputTokens: into.inputTokens + row.inputTokens,
    outputTokens: into.outputTokens + row.outputTokens,
    totalTokens: into.totalTokens + row.totalTokens,
    requestsWithUsage: into.requestsWithUsage + row.requestsWithUsage,
    requestsWithoutUsage: into.requestsWithoutUsage + row.requestsWithoutUsage,
    firstTokenSamples: into.firstTokenSamples + row.firstTokenSamples,
    durationSamples: into.durationSamples + row.durationSamples,
  }
}

/** Join one folded row with its catalog entry and visibility fact. */
function modelRow(
  stats: ReturnType<typeof foldAnalytics>['models'][number],
  entry: GatewayCatalogEntry | undefined,
  visible: boolean,
): AnalyticsModelRow {
  const avgFirstTokenMs = average(stats.firstTokenMsTotal, stats.firstTokenSamples)
  const avgDurationMs = average(stats.durationMsTotal, stats.durationSamples)
  return {
    model: stats.model,
    name: entry?.name ?? stats.model,
    cost: entry?.cost ?? 'unknown',
    capability: entry?.capability ?? 'unknown',
    visible,
    calibrated: entry !== undefined,
    requests: stats.requests,
    succeeded: stats.succeeded,
    failed: stats.failed,
    interrupted: stats.interrupted,
    retries: stats.retries,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    totalTokens: stats.totalTokens,
    requestsWithUsage: stats.requestsWithUsage,
    requestsWithoutUsage: stats.requestsWithoutUsage,
    firstTokenSamples: stats.firstTokenSamples,
    ...(avgFirstTokenMs === undefined ? {} : { avgFirstTokenMs }),
    durationSamples: stats.durationSamples,
    ...(avgDurationMs === undefined ? {} : { avgDurationMs }),
  }
}

/** Project one folded read onto the wire report. */
export function buildAnalyticsReport(input: BuildAnalyticsReportInput): OpenDesignAnalyticsReport {
  const byId = new Map((input.catalog?.models ?? []).map((entry) => [entry.id, entry]))
  const rows = input.fold.models
    .map((stats) => modelRow(stats, byId.get(stats.model), input.isVisible(stats.model)))
    .sort((a, b) => {
      if (a.visible !== b.visible) return a.visible ? -1 : 1
      if (a.requests !== b.requests) return b.requests - a.requests
      return a.model.localeCompare(b.model)
    })

  let totals: AnalyticsTotals = {
    requests: 0,
    sessions: input.fold.sessions,
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    retries: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requestsWithUsage: 0,
    requestsWithoutUsage: 0,
    firstTokenSamples: 0,
    durationSamples: 0,
  }
  for (const row of rows) totals = addCounters(totals, row)
  const avgFirstTokenMs = average(input.fold.models.reduce((sum, row) => sum + row.firstTokenMsTotal, 0), totals.firstTokenSamples)
  const avgDurationMs = average(input.fold.models.reduce((sum, row) => sum + row.durationMsTotal, 0), totals.durationSamples)

  return {
    generatedAt: input.now(),
    scope: input.scope,
    history: input.coverage,
    totals: {
      ...totals,
      ...(avgFirstTokenMs === undefined ? {} : { avgFirstTokenMs }),
      ...(avgDurationMs === undefined ? {} : { avgDurationMs }),
    },
    models: rows,
  }
}

/** Read, fold and project one query; never throws for missing history/catalog. */
export async function analyticsReport(
  deps: OpenDesignAnalyticsDeps,
  query: AnalyticsQuery,
): Promise<OpenDesignAnalyticsReport> {
  const scope = query.scope
  const history = await collectAnalyticsSessions(deps.sessionQuery(), scope, PROVIDER)
  const foldOptions: AnalyticsFoldOptions = {
    provider: PROVIDER,
    ...(scope.kind === 'range' ? { range: { from: scope.from, to: scope.to } } : {}),
  }
  const fold = foldAnalytics(history.sessions, foldOptions)
  let catalog: GatewayCatalogStatus | undefined
  try {
    catalog = await deps.catalogStatus()
  } catch {
    catalog = undefined
  }
  return buildAnalyticsReport({
    scope,
    fold,
    coverage: history.coverage,
    catalog,
    isVisible: deps.isVisible,
    now: deps.now ?? Date.now,
  })
}
