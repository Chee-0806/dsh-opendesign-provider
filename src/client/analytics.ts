/**
 * Analytics page controller (ticket 12): submitted filter → one Remote read.
 *
 * Two rules the page promises, and the reasons they live here:
 *
 * - The filter inputs are DRAFTS. Pressing "read" is the only thing that
 *   queries the Host, so typing a date never triggers a history scan, and the
 *   displayed report always echoes the filter that produced it.
 * - A missing `opendesign/analytics` Remote is `unavailable`, not "empty".
 *   Fabricating a zero-request report would claim the user never used a model.
 *
 * React-free so tests drive it over a fake Remote and a fixed clock.
 *
 * @module dsh-opendesign-provider/client/analytics
 */

import type { AnalyticsQuery, AnalyticsScope, OpenDesignAnalyticsReport } from '../analytics-wire.ts'
import { createSnapshotStore, type SnapshotStore } from './snapshot-store.ts'

/** Result envelope of one current Typert Remote call. */
type Envelope<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } | undefined }

/** The `opendesign/analytics` method this page calls. */
export interface AnalyticsApi {
  analytics(query: AnalyticsQuery): Promise<Envelope<OpenDesignAnalyticsReport>>
}

/** Page status: idle before the first read, unavailable without a Remote. */
export type AnalyticsPageStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'failed'

/** The local rejection/read-failure notice keys the view translates. */
export type AnalyticsNoticeKey = 'invalidRange' | 'readFailed'

/** Everything the page renders from. */
export interface AnalyticsPageState {
  status: AnalyticsPageStatus
  mode: AnalyticsScope['kind']
  /** Draft session count, 1–100. */
  recentSessions: number
  /** Draft local calendar day (`YYYY-MM-DD`). */
  rangeFrom: string
  rangeTo: string
  /** Last successful report; retained while a later read is in flight/fails. */
  report?: OpenDesignAnalyticsReport | undefined
  notice?: AnalyticsNoticeKey | undefined
}

/** Clock and time-zone seams, injectable so tests are machine-independent. */
export interface AnalyticsControllerOptions {
  now?: (() => number) | undefined
  /** `Date#getTimezoneOffset` minutes; defaults to the local zone at `now`. */
  localOffsetMinutes?: number | undefined
}

const DAY_MS = 24 * 60 * 60 * 1_000
const MAX_RANGE_DAYS = 366
const MIN_RECENT_SESSIONS = 1
const MAX_RECENT_SESSIONS = 100
const DEFAULT_RECENT_SESSIONS = 20
const DEFAULT_RANGE_DAYS = 7

/** `Date#getTimezoneOffset`-style shift of one instant into local wall time. */
function toLocalWall(epochMs: number, offsetMinutes: number): Date {
  return new Date(epochMs - offsetMinutes * 60_000)
}

/** Format one instant as a local calendar day (`YYYY-MM-DD`). */
function localDay(epochMs: number, offsetMinutes: number): string {
  const wall = toLocalWall(epochMs, offsetMinutes)
  const year = wall.getUTCFullYear()
  const month = String(wall.getUTCMonth() + 1).padStart(2, '0')
  const day = String(wall.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Parse one `YYYY-MM-DD` into a local-midnight epoch, or undefined. */
function dayStartEpoch(text: string, offsetMinutes: number): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = Date.UTC(year, month - 1, day)
  const roundTrip = new Date(utc)
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    return undefined
  }
  return utc + offsetMinutes * 60_000
}

/** Clamp a draft session count; a non-numeric draft keeps the previous value. */
function clampSessions(text: string, previous: number): number {
  if (text.trim() === '') return previous
  const parsed = Number(text)
  if (!Number.isInteger(parsed)) return previous
  return Math.min(MAX_RECENT_SESSIONS, Math.max(MIN_RECENT_SESSIONS, parsed))
}

/**
 * The analytics page controller. One submitted filter, one in-flight read.
 */
export class OpenDesignAnalyticsController {
  private readonly resolveApi: () => AnalyticsApi | undefined
  private readonly now: () => number
  private readonly offsetMinutes: number
  private readonly store: SnapshotStore<AnalyticsPageState>
  /** Monotonic read id; a slower earlier read must not overwrite a newer one. */
  private generation = 0

  constructor(resolveApi: () => AnalyticsApi | undefined, options: AnalyticsControllerOptions = {}) {
    this.resolveApi = resolveApi
    this.now = options.now ?? Date.now
    this.offsetMinutes = options.localOffsetMinutes ?? new Date(this.now()).getTimezoneOffset()
    const today = localDay(this.now(), this.offsetMinutes)
    const from = localDay(this.now() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS, this.offsetMinutes)
    this.store = createSnapshotStore<AnalyticsPageState>({
      status: 'idle',
      mode: 'recent',
      recentSessions: DEFAULT_RECENT_SESSIONS,
      rangeFrom: from,
      rangeTo: today,
    })
  }

  /** The current page state. */
  state(): AnalyticsPageState {
    return this.store.getSnapshot()
  }

  /** Reactive face the React page consumes. */
  getSnapshot(): AnalyticsPageState {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /** No timers or sockets to release; kept for the slot's disposer shape. */
  dispose(): void {}

  setMode(mode: AnalyticsScope['kind']): void {
    const state = this.state()
    if (mode === state.mode) return
    this.commit({ ...state, mode })
  }

  setRecentSessions(text: string): void {
    const state = this.state()
    this.commit({ ...state, recentSessions: clampSessions(text, state.recentSessions) })
  }

  setRangeFrom(text: string): void {
    this.commit({ ...this.state(), rangeFrom: text })
  }

  setRangeTo(text: string): void {
    this.commit({ ...this.state(), rangeTo: text })
  }

  /**
   * Submit the current draft as one history read.
   * @returns the state after the read settles.
   */
  async refresh(): Promise<AnalyticsPageState> {
    const api = this.resolveApi()
    if (api === undefined) {
      return this.commit({ ...this.state(), status: 'unavailable', notice: undefined })
    }
    const scope = this.submittedScope()
    if (scope === undefined) {
      return this.commit({ ...this.state(), status: 'failed', notice: 'invalidRange' })
    }
    const generation = ++this.generation
    const current = (): boolean => generation === this.generation
    this.commit({ ...this.state(), status: 'loading', notice: undefined })
    let answer: Envelope<OpenDesignAnalyticsReport>
    try {
      answer = await api.analytics({ scope })
    } catch {
      return current()
        ? this.commit({ ...this.state(), status: 'failed', notice: 'readFailed' })
        : this.state()
    }
    if (!current()) return this.state()
    if (!answer.ok) return this.commit({ ...this.state(), status: 'failed', notice: 'readFailed' })
    return this.commit({ ...this.state(), status: 'ready', report: answer.value, notice: undefined })
  }

  /** Turn the draft into the wire scope, or undefined when it is invalid. */
  private submittedScope(): AnalyticsScope | undefined {
    const state = this.state()
    if (state.mode === 'recent') {
      return { kind: 'recent', sessions: state.recentSessions }
    }
    const from = dayStartEpoch(state.rangeFrom, this.offsetMinutes)
    const to = dayStartEpoch(state.rangeTo, this.offsetMinutes)
    if (from === undefined || to === undefined) return undefined
    const end = to + DAY_MS
    if (end <= from || end - from > MAX_RANGE_DAYS * DAY_MS) return undefined
    return { kind: 'range', from, to: end }
  }

  private commit(next: AnalyticsPageState): AnalyticsPageState {
    this.store.set(next)
    return next
  }
}
