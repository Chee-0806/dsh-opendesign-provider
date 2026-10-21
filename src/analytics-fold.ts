/**
 * Fold already-read session history into per-model request facts (ticket 12).
 *
 * The analytics page compares models on tokens, speed, failures and retries.
 * The Host already records every model attempt in the session log, so this
 * module is the only place that interprets it: one `assistant/message`, one
 * `assistant/attempt` and one `compaction/summary` each count as one request.
 * Nothing here knows a price, a provider price table or a dollar figure — the
 * cost dimension is the catalog's own `low/medium/high` word, joined later.
 *
 * Two rules protect the numbers:
 *
 * - A request whose adapter reported no `usage` still counts as a request, but
 *   contributes no tokens. Summing it as zero would make "no data" look like
 *   "zero tokens", so the row carries `requestsWithoutUsage` instead.
 * - Only a session's OWN events count: a forked child re-reads its inherited
 *   prefix, and `inheritedEventCount` is the exact cut the host publishes.
 *   Counting the prefix again would double every ancestor request.
 *
 * @module dsh-opendesign-provider/analytics-fold
 */

import { assistantStreamFirstTokenTime, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm'

/** One raw session event, structurally typed so tests need no host package. */
export interface HistoryEvent {
  readonly type: string
  readonly time: number
  readonly data?: unknown
}

/** One logical session's own events, plus the host's exact inheritance cut. */
export interface HistorySession {
  readonly id: string
  readonly createdAt: number
  readonly events: readonly HistoryEvent[]
  /** Leading events inherited from a parent session; never counted here. */
  readonly inheritedEventCount?: number
}

/** Token, timing and outcome facts for one model. */
export interface AnalyticsModelStats {
  readonly model: string
  requests: number
  succeeded: number
  failed: number
  interrupted: number
  retries: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requestsWithUsage: number
  requestsWithoutUsage: number
  firstTokenSamples: number
  firstTokenMsTotal: number
  durationSamples: number
  durationMsTotal: number
}

/** The complete fold: model rows plus the read-coverage facts. */
export interface AnalyticsFoldResult {
  readonly models: AnalyticsModelStats[]
  /** Sessions that contributed at least one request. */
  sessions: number
  sessionsScanned: number
  eventsScanned: number
  inheritedEventsSkipped: number
}

/** One mutable row; frozen into {@link AnalyticsModelStats} on return. */
type MutableStats = { -readonly [K in keyof AnalyticsModelStats]: AnalyticsModelStats[K] }

/** What the fold carries forward while walking one session log. */
interface SessionCursor {
  provider?: string | undefined
  model?: string | undefined
  stepStart?: number | undefined
  lastAttemptTime?: number | undefined
  attemptsInStep: number
}

/** Narrow one `data` payload without trusting its shape. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read one nested record field, or undefined. */
function field(source: Record<string, unknown> | undefined, key: string): unknown {
  return source?.[key]
}

/** Read one finite non-negative number, or undefined. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** The request header's route facts (provider and model). */
function headerRoute(data: Record<string, unknown>): { provider?: string; model?: string } {
  const header = asRecord(data.header)
  const config = asRecord(field(header, 'config'))
  const provider = field(config, 'provider')
  const model = field(config, 'model')
  return {
    ...(typeof provider === 'string' ? { provider } : {}),
    ...(typeof model === 'string' ? { model } : {}),
  }
}

/** The `assistant/message` source route, which outranks the standing header. */
function messageRoute(data: Record<string, unknown>): { provider?: string; model?: string } {
  const message = asRecord(data.message)
  const source = asRecord(field(message, 'source'))
  const provider = field(source, 'provider')
  const model = field(source, 'model')
  return {
    ...(typeof provider === 'string' ? { provider } : {}),
    ...(typeof model === 'string' ? { model } : {}),
  }
}

/** One adapter-reported token count, or undefined when the field is absent. */
function usageTokens(data: Record<string, unknown>): { input: number; output: number; total: number } | undefined {
  const usage = asRecord(field(data, 'usage'))
  if (usage === undefined) return undefined
  const input = count(usage.inputTokens)
  const output = count(usage.outputTokens)
  if (input === undefined || output === undefined) return undefined
  return { input, output, total: count(usage.totalTokens) ?? input + output }
}

/** The compact timed stream of one settled attempt. */
function streamOf(data: Record<string, unknown>): readonly AssistantStreamRecord[] {
  const stream = field(data, 'stream')
  return Array.isArray(stream) ? stream as readonly AssistantStreamRecord[] : []
}

/** Take (or create) the row for `model`. */
function rowFor(rows: Map<string, MutableStats>, model: string): MutableStats {
  const existing = rows.get(model)
  if (existing !== undefined) return existing
  const created: MutableStats = {
    model,
    requests: 0,
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
    firstTokenMsTotal: 0,
    durationSamples: 0,
    durationMsTotal: 0,
  }
  rows.set(model, created)
  return created
}

/**
 * Fold one logical session's own events.
 * @param target - session to interpret.
 * @param rows - accumulator keyed by model id.
 * @param provider - the only provider whose requests count.
 * @returns how many requests this session contributed.
 */
function foldSession(
  target: HistorySession,
  rows: Map<string, MutableStats>,
  provider: string,
  range: { readonly from: number; readonly to: number } | undefined,
): number {
  const inRange = (time: number): boolean => range === undefined || (time >= range.from && time < range.to)
  const inherited = target.inheritedEventCount ?? 0
  const events = target.events.slice(inherited)
  const cursor: SessionCursor = { attemptsInStep: 0 }
  let requests = 0
  for (const event of events) {
    const data = asRecord(event.data)
    if (event.type === 'request/header') {
      const route = headerRoute(data ?? {})
      if (route.provider !== undefined) cursor.provider = route.provider
      if (route.model !== undefined) cursor.model = route.model
      continue
    }
    if (event.type === 'request/context') {
      const route = headerRoute({ header: { config: data } })
      if (route.provider !== undefined) cursor.provider = route.provider
      if (route.model !== undefined) cursor.model = route.model
      continue
    }
    if (event.type === 'step/start') {
      cursor.stepStart = event.time
      cursor.lastAttemptTime = undefined
      cursor.attemptsInStep = 0
      continue
    }
    if (event.type === 'compaction/summary') {
      // A compaction is its own model call: it belongs to no turn/step and has
      // no `request/header`, so its provider, model and usage travel on the
      // event itself. It is neither a retry nor a step attempt.
      if (data === undefined) continue
      const compactProvider = field(data, 'provider')
      const compactModel = field(data, 'model')
      if (compactProvider !== provider || typeof compactModel !== 'string') continue
      if (!inRange(event.time)) continue
      const row = rowFor(rows, compactModel)
      row.requests += 1
      requests += 1
      row.succeeded += 1
      const usage = usageTokens(data)
      if (usage === undefined) {
        row.requestsWithoutUsage += 1
      } else {
        row.requestsWithUsage += 1
        row.inputTokens += usage.input
        row.outputTokens += usage.output
        row.totalTokens += usage.total
      }
      continue
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
    if (data === undefined) continue

    const route = event.type === 'assistant/message' ? messageRoute(data) : {}
    const requestProvider = route.provider ?? cursor.provider
    const model = route.model ?? cursor.model
    cursor.attemptsInStep += 1
    const start = cursor.lastAttemptTime ?? cursor.stepStart
    cursor.lastAttemptTime = event.time
    if (requestProvider !== provider || model === undefined) continue
    if (!inRange(event.time)) continue

    const row = rowFor(rows, model)
    row.requests += 1
    requests += 1
    if (cursor.attemptsInStep > 1) row.retries += 1

    if (event.type === 'assistant/attempt') {
      row.failed += 1
    } else if (data.interrupted === true) {
      row.interrupted += 1
    } else {
      row.succeeded += 1
    }

    const usage = usageTokens(data)
    if (usage === undefined) {
      row.requestsWithoutUsage += 1
    } else {
      row.requestsWithUsage += 1
      row.inputTokens += usage.input
      row.outputTokens += usage.output
      row.totalTokens += usage.total
    }

    if (start !== undefined && event.time >= start) {
      row.durationSamples += 1
      row.durationMsTotal += event.time - start
      const firstToken = assistantStreamFirstTokenTime(streamOf(data))
      if (firstToken !== undefined && firstToken >= start) {
        row.firstTokenSamples += 1
        row.firstTokenMsTotal += firstToken - start
      }
    }
  }
  return requests
}

/** Which requests a fold counts. */
export interface AnalyticsFoldOptions {
  /** The only provider whose requests count; defaults to `open-design`. */
  provider?: string
  /** Half-open `[from, to)` request-time window; omitted means no time bound. */
  range?: { readonly from: number; readonly to: number } | undefined
}

/**
 * Fold every session into per-model facts.
 * @param sessions - already-read logs, in any order.
 * @param options - provider restriction and optional request-time window.
 * @returns deterministic rows (model id order) and read-coverage counters.
 */
export function foldAnalytics(
  sessions: readonly HistorySession[],
  options: AnalyticsFoldOptions = {},
): AnalyticsFoldResult {
  const provider = options.provider ?? 'open-design'
  const rows = new Map<string, MutableStats>()
  let contributing = 0
  let eventsScanned = 0
  let inheritedEventsSkipped = 0
  for (const target of sessions) {
    const requests = foldSession(target, rows, provider, options.range)
    if (requests > 0) contributing += 1
    eventsScanned += target.events.length
    inheritedEventsSkipped += target.inheritedEventCount ?? 0
  }
  return {
    models: [...rows.values()].sort((a, b) => a.model.localeCompare(b.model)),
    sessions: contributing,
    sessionsScanned: sessions.length,
    eventsScanned,
    inheritedEventsSkipped,
  }
}
