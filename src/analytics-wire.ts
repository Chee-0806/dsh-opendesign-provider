/**
 * Wire contract for the `opendesign/analytics` Remote (ticket 12).
 *
 * The browser asks one question — "compare the Open Design models I actually
 * used for this recent-session count or date range" — and the Host answers
 * with aggregates only. No session id, title, working directory, event text or
 * key value crosses the wire, and there is deliberately no money field: the
 * cost dimension is the catalog's `low/medium/high` word and the capability
 * tier, per ADR-0002.
 *
 * Both halves share the strict parsers below; the Host registers the descriptor
 * and the browser mounts the matching contribution. Client-bundle safe: only
 * type imports cross into Host-only modules.
 *
 * @module dsh-opendesign-provider/analytics-wire
 */

import type { InvocationDescriptor, TypertRemoteContribution, TypertSchema } from '@deepseek-ai/dsh-typert-protocol'
import {
  makeBoundaryValidator,
  makeRemoteDescriptor,
  makeRemoteParameter,
  REMOTE_NAMESPACE,
  REMOTE_PACKAGE,
} from './wire-shared.ts'

/** Canonical `<namespace>/<method>` endpoint of the analytics report. */
export const ANALYTICS_ENDPOINT = `${REMOTE_NAMESPACE}/analytics`

/** The cheapest-to-most-expensive catalog word; `unknown` = catalog has no entry. */
export type AnalyticsCostTier = 'low' | 'medium' | 'high' | 'unknown'

/** The catalog capability word; `unknown` = catalog has no entry. */
export type AnalyticsCapabilityTier = 'standard' | 'advanced' | 'unknown'

/** The most recent N sessions that contain at least one Open Design request. */
export interface AnalyticsRecentScope {
  readonly kind: 'recent'
  /** 1–100, newest first by the session's last Open Design request. */
  readonly sessions: number
}

/** Half-open `[from, to)` local-calendar window, at most 366 days. */
export interface AnalyticsRangeScope {
  readonly kind: 'range'
  readonly from: number
  readonly to: number
}

/** The one filter the page submits; a scope, never free text. */
export type AnalyticsScope = AnalyticsRecentScope | AnalyticsRangeScope

/** One `opendesign/analytics` invocation. */
export interface AnalyticsQuery {
  readonly scope: AnalyticsScope
}

/** Token, timing, outcome and usage-coverage counters for one model. */
export interface AnalyticsModelRow {
  readonly model: string
  readonly name: string
  readonly cost: AnalyticsCostTier
  readonly capability: AnalyticsCapabilityTier
  /** Whether the current model-visibility rule would list this id. */
  readonly visible: boolean
  /** Whether the static snapshot knows this id. */
  readonly calibrated: boolean
  readonly requests: number
  readonly succeeded: number
  readonly failed: number
  readonly interrupted: number
  readonly retries: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly requestsWithUsage: number
  readonly requestsWithoutUsage: number
  readonly firstTokenSamples: number
  readonly avgFirstTokenMs?: number | undefined
  readonly durationSamples: number
  readonly avgDurationMs?: number | undefined
}

/** The same counters over every model in the report. */
export interface AnalyticsTotals {
  readonly requests: number
  readonly sessions: number
  readonly succeeded: number
  readonly failed: number
  readonly interrupted: number
  readonly retries: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly requestsWithUsage: number
  readonly requestsWithoutUsage: number
  readonly firstTokenSamples: number
  readonly avgFirstTokenMs?: number | undefined
  readonly durationSamples: number
  readonly avgDurationMs?: number | undefined
}

/** How complete the history read was, so a partial scan never looks complete. */
export interface AnalyticsHistoryCoverage {
  /** Whether the Host's optional session-query service answered at all. */
  readonly available: boolean
  /** `unsupported` = no session-query service; `unreadable` = the read failed. */
  readonly reason?: 'unsupported' | 'unreadable' | undefined
  readonly sessionsScanned: number
  readonly sessionsSkipped: number
  readonly eventsScanned: number
  readonly inheritedEventsSkipped: number
  readonly truncated: boolean
}

/** The whole `opendesign/analytics` result. */
export interface OpenDesignAnalyticsReport {
  readonly generatedAt: number
  readonly scope: AnalyticsScope
  readonly history: AnalyticsHistoryCoverage
  readonly totals: AnalyticsTotals
  readonly models: AnalyticsModelRow[]
}

const MAX_RECENT_SESSIONS = 100
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1_000

const queryValidator = makeBoundaryValidator('opendesign/analytics query:')
const resultValidator = makeBoundaryValidator('opendesign/analytics result:')

const COSTS: readonly string[] = ['low', 'medium', 'high', 'unknown']
const CAPABILITIES: readonly string[] = ['standard', 'advanced', 'unknown']
const HISTORY_REASONS: readonly string[] = ['unsupported', 'unreadable']

/** Read one required finite, non-negative integer. */
function counterField(source: Record<string, unknown>, key: string, field: string): number {
  const value = resultValidator.numberField(source, key, field)
  if (!Number.isInteger(value) || value < 0) resultValidator.reject(field)
  return value
}

/** Read one optional finite, non-negative number (absent stays absent). */
function optionalAverage(source: Record<string, unknown>, key: string, field: string): number | undefined {
  if (source[key] === undefined) return undefined
  const value = resultValidator.numberField(source, key, field)
  if (value < 0) resultValidator.reject(field)
  return value
}

/** Parse one scope; `recent` and `range` are the only legal kinds. */
function parseScope(value: unknown, prefix: string): AnalyticsScope {
  const source = queryValidator.record(value, `${prefix}scope`)
  const kind = queryValidator.stringField(source, 'kind', `${prefix}scope.kind`)
  if (kind === 'recent') {
    const sessions = queryValidator.numberField(source, 'sessions', `${prefix}recent.sessions`)
    if (!Number.isInteger(sessions) || sessions < 1 || sessions > MAX_RECENT_SESSIONS) {
      queryValidator.reject(`${prefix}recent.sessions`)
    }
    return { kind, sessions }
  }
  if (kind === 'range') {
    const from = queryValidator.numberField(source, 'from', `${prefix}range.from`)
    const to = queryValidator.numberField(source, 'to', `${prefix}range.to`)
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to - from > MAX_RANGE_MS) {
      queryValidator.reject(`${prefix}range`)
    }
    return { kind, from, to }
  }
  return queryValidator.reject(`${prefix}scope.kind`)
}

/** Strictly parse one untrusted `opendesign/analytics` query. */
export function parseAnalyticsQuery(value: unknown): AnalyticsQuery {
  const source = queryValidator.record(value, 'query')
  return { scope: parseScope(source.scope, '') }
}

/** Parse the report's scope echo with the stricter result validator. */
function parseReportScope(value: unknown): AnalyticsScope {
  const source = resultValidator.record(value, 'scope')
  const kind = resultValidator.stringField(source, 'kind', 'scope.kind')
  if (kind === 'recent') {
    return { kind, sessions: counterField(source, 'sessions', 'scope.sessions') }
  }
  if (kind === 'range') {
    const from = counterField(source, 'from', 'scope.from')
    const to = counterField(source, 'to', 'scope.to')
    if (to <= from) resultValidator.reject('scope.to')
    return { kind, from, to }
  }
  return resultValidator.reject('scope.kind')
}

/** Parse the shared counters block (totals and one model row). */
function parseCounters(source: Record<string, unknown>, field: string): Omit<AnalyticsTotals, 'sessions'> {
  const avgFirstTokenMs = optionalAverage(source, 'avgFirstTokenMs', `${field}avgFirstTokenMs`)
  const avgDurationMs = optionalAverage(source, 'avgDurationMs', `${field}avgDurationMs`)
  return {
    requests: counterField(source, 'requests', `${field}requests`),
    succeeded: counterField(source, 'succeeded', `${field}succeeded`),
    failed: counterField(source, 'failed', `${field}failed`),
    interrupted: counterField(source, 'interrupted', `${field}interrupted`),
    retries: counterField(source, 'retries', `${field}retries`),
    inputTokens: counterField(source, 'inputTokens', `${field}inputTokens`),
    outputTokens: counterField(source, 'outputTokens', `${field}outputTokens`),
    totalTokens: counterField(source, 'totalTokens', `${field}totalTokens`),
    requestsWithUsage: counterField(source, 'requestsWithUsage', `${field}requestsWithUsage`),
    requestsWithoutUsage: counterField(source, 'requestsWithoutUsage', `${field}requestsWithoutUsage`),
    firstTokenSamples: counterField(source, 'firstTokenSamples', `${field}firstTokenSamples`),
    ...(avgFirstTokenMs === undefined ? {} : { avgFirstTokenMs }),
    durationSamples: counterField(source, 'durationSamples', `${field}durationSamples`),
    ...(avgDurationMs === undefined ? {} : { avgDurationMs }),
  }
}

/** Parse one model row, rejecting an unknown tier word. */
function parseModelRow(value: unknown, index: number): AnalyticsModelRow {
  const field = `models[${index}].`
  const source = resultValidator.record(value, `models[${index}]`)
  const cost = resultValidator.stringField(source, 'cost', `${field}cost`)
  if (!COSTS.includes(cost)) resultValidator.reject(`${field}cost`)
  const capability = resultValidator.stringField(source, 'capability', `${field}capability`)
  if (!CAPABILITIES.includes(capability)) resultValidator.reject(`${field}capability`)
  return {
    model: resultValidator.stringField(source, 'model', `${field}model`),
    name: resultValidator.stringField(source, 'name', `${field}name`),
    cost: cost as AnalyticsCostTier,
    capability: capability as AnalyticsCapabilityTier,
    visible: resultValidator.booleanField(source, 'visible', `${field}visible`),
    calibrated: resultValidator.booleanField(source, 'calibrated', `${field}calibrated`),
    ...parseCounters(source, field),
  }
}

/** Parse the history coverage block. */
function parseHistory(value: unknown): AnalyticsHistoryCoverage {
  const source = resultValidator.record(value, 'history')
  const available = resultValidator.booleanField(source, 'available', 'history.available')
  const reason = source.reason === undefined
    ? undefined
    : resultValidator.stringField(source, 'reason', 'history.reason')
  if (reason !== undefined && !HISTORY_REASONS.includes(reason)) resultValidator.reject('history.reason')
  return {
    available,
    ...(reason === undefined ? {} : { reason: reason as 'unsupported' | 'unreadable' }),
    sessionsScanned: counterField(source, 'sessionsScanned', 'history.sessionsScanned'),
    sessionsSkipped: counterField(source, 'sessionsSkipped', 'history.sessionsSkipped'),
    eventsScanned: counterField(source, 'eventsScanned', 'history.eventsScanned'),
    inheritedEventsSkipped: counterField(source, 'inheritedEventsSkipped', 'history.inheritedEventsSkipped'),
    truncated: resultValidator.booleanField(source, 'truncated', 'history.truncated'),
  }
}

/** Strictly parse one untrusted `opendesign/analytics` result. */
export function parseAnalyticsReport(value: unknown): OpenDesignAnalyticsReport {
  const source = resultValidator.record(value, 'result')
  if (!Array.isArray(source.models)) resultValidator.reject('models')
  const totalsSource = resultValidator.record(source.totals, 'totals')
  return {
    generatedAt: counterField(source, 'generatedAt', 'generatedAt'),
    scope: parseReportScope(source.scope),
    history: parseHistory(source.history),
    totals: {
      ...parseCounters(totalsSource, 'totals.'),
      sessions: counterField(totalsSource, 'sessions', 'totals.sessions'),
    },
    models: (source.models as unknown[]).map((row, index) => parseModelRow(row, index)),
  }
}

/** The strict query codec the Typert registry validates with. */
export const analyticsQuerySchema: TypertSchema<AnalyticsQuery> = { parse: parseAnalyticsQuery }

/** The strict result codec. */
export const analyticsReportSchema: TypertSchema<OpenDesignAnalyticsReport> = { parse: parseAnalyticsReport }

/** The Host and Client descriptor for `opendesign/analytics`. */
export const ANALYTICS_DESCRIPTOR: InvocationDescriptor = makeRemoteDescriptor<OpenDesignAnalyticsReport>(
  ANALYTICS_ENDPOINT,
  'analytics',
  `${REMOTE_PACKAGE}#OpenDesignAnalyticsReport`,
  analyticsReportSchema,
  [makeRemoteParameter('query', `${REMOTE_PACKAGE}#AnalyticsQuery`, analyticsQuerySchema)],
)

/** The Client-face contribution it mounts. */
export const ANALYTICS_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: REMOTE_PACKAGE,
  descriptors: [ANALYTICS_DESCRIPTOR],
}

