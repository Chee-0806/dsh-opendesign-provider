/**
 * Read-only history access for the analytics page (ticket 12).
 *
 * The Host already has a session-query service in a normal web profile, but
 * this plugin cannot make it a hard dependency: a headless or minimal profile
 * may not mount a query backend at all. So the service is reached through a
 * structural seam (`ctx.get('sessionQuery')`), and a missing one is a reported
 * state (`available: false`), never an exception.
 *
 * The scan is bounded on purpose: newest sessions first, at most 100 candidate
 * sessions and 200 000 own events, and only a session's own events count — the
 * host publishes the exact fork cut as `inheritedEventCount`, so a child does
 * not re-count its ancestor's requests. Every bound that bites is reported as
 * `truncated`, so a partial scan never masquerades as complete.
 *
 * @module dsh-opendesign-provider/analytics-history
 */

import { foldAnalytics, type HistoryEvent, type HistorySession } from './analytics-fold.ts'
import type { AnalyticsHistoryCoverage, AnalyticsScope } from './analytics-wire.ts'

/** The parts of one session header this module reads. */
export interface SessionHeaderLike {
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string | undefined
  readonly parentSession?: string | undefined
  readonly isSeeded?: boolean | undefined
}

/** One `listSessions()` record. */
export interface SessionSummaryLike {
  readonly header: SessionHeaderLike
}

/** One `readSession(id)` result, already replayed and validated by the host. */
export interface SessionReadLike {
  readonly session?: SessionHeaderLike | undefined
  readonly events: readonly HistoryEvent[]
  readonly inheritedEventCount?: number | undefined
}

/** The `sessionQuery` service surface this module uses (never the whole service). */
export interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<readonly SessionSummaryLike[]>
  readSession(id: string, signal?: AbortSignal): Promise<SessionReadLike>
}

/** Most candidate sessions one scan reads. */
export const MAX_CANDIDATE_SESSIONS = 100

/** Most own events one scan reads across all sessions. */
export const MAX_HISTORY_EVENTS = 200_000

/** What one history read produced. */
export interface AnalyticsHistoryRead {
  /** Sessions with at least one Open Design request (newest first). */
  readonly sessions: HistorySession[]
  readonly coverage: AnalyticsHistoryCoverage
}

/** A coverage block for a scan that never ran. */
function emptyCoverage(available: boolean, reason?: 'unsupported' | 'unreadable'): AnalyticsHistoryCoverage {
  return {
    available,
    ...(reason === undefined ? {} : { reason }),
    sessionsScanned: 0,
    sessionsSkipped: 0,
    eventsScanned: 0,
    inheritedEventsSkipped: 0,
    truncated: false,
  }
}

/**
 * Collect the sessions a scope needs.
 * @param query - the host's session-query service, or undefined when unmounted.
 * @param scope - recent-session count or half-open request-time range.
 * @param provider - the only provider whose requests count.
 * @returns contributing sessions plus the read-coverage facts.
 */
export async function collectAnalyticsSessions(
  query: SessionQueryLike | undefined,
  scope: AnalyticsScope,
  provider: string,
): Promise<AnalyticsHistoryRead> {
  if (query === undefined) return { sessions: [], coverage: emptyCoverage(false, 'unsupported') }

  let summaries: readonly SessionSummaryLike[]
  try {
    summaries = await query.listSessions()
  } catch {
    return { sessions: [], coverage: emptyCoverage(false, 'unreadable') }
  }

  const sessions: HistorySession[] = []
  let candidates = 0
  let skipped = 0
  let eventsScanned = 0
  let inheritedEventsSkipped = 0
  let truncated = false

  for (const summary of summaries) {
    const header = summary.header
    if (typeof header?.id !== 'string' || header.id === '') {
      skipped += 1
      continue
    }
    // A session created at or after the window's end cannot contain an event
    // inside it; skipping it costs nothing and keeps the scan proportional.
    if (scope.kind === 'range' && header.createdAt >= scope.to) continue
    if (candidates >= MAX_CANDIDATE_SESSIONS) {
      truncated = true
      break
    }
    candidates += 1

    let read: SessionReadLike
    try {
      read = await query.readSession(header.id)
    } catch {
      skipped += 1
      continue
    }
    const own: HistorySession = {
      id: header.id,
      createdAt: header.createdAt,
      events: Array.isArray(read.events) ? read.events : [],
      ...(read.inheritedEventCount === undefined ? {} : { inheritedEventCount: read.inheritedEventCount }),
    }
    eventsScanned += own.events.length
    inheritedEventsSkipped += own.inheritedEventCount ?? 0
    if (eventsScanned > MAX_HISTORY_EVENTS) truncated = true

    // The same fold that produces the report decides whether this session has
    // anything to contribute, so "recent sessions" cannot disagree with it.
    const contributes = foldAnalytics([own], { provider }).sessions > 0
    if (!contributes) continue
    sessions.push(own)
    if (scope.kind === 'recent' && sessions.length >= scope.sessions) break
  }

  return {
    sessions,
    coverage: {
      available: true,
      sessionsScanned: candidates,
      sessionsSkipped: skipped,
      eventsScanned,
      inheritedEventsSkipped,
      truncated,
    },
  }
}
