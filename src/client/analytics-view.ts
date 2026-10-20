/**
 * Analytics page view model (ticket 12).
 *
 * Every string the page renders is produced here, from the page state and a
 * translate function. Keeping it React-free makes the two promises testable:
 * missing samples render as the missing word (never `0`), and the whole
 * projection contains no currency, no `≈` and no price/amount field.
 *
 * The cost column is the catalog's `low/medium/high` tier word and the
 * capability column its `standard/advanced` word — ADR-0002.
 *
 * @module dsh-opendesign-provider/client/analytics-view
 */

import type { AnalyticsModelRow, OpenDesignAnalyticsReport } from '../analytics-wire.ts'
import type { AnalyticsKey } from './analytics-locales.ts'
import type { AnalyticsPageState } from './analytics.ts'

/** Translate one analytics key (the slot kit's bound `t`). */
export type AnalyticsTranslate = (key: AnalyticsKey) => string

/** The comparison columns, in display order. */
export type AnalyticsColumnKey =
  | 'model'
  | 'requests'
  | 'tokens'
  | 'firstToken'
  | 'duration'
  | 'failureRate'
  | 'retries'
  | 'cost'
  | 'capability'

/** One comparison column header. */
export interface AnalyticsColumn {
  key: AnalyticsColumnKey
  label: string
}

/** One model row: its display name plus every cell as final text. */
export interface AnalyticsViewRow {
  model: string
  name: string
  cells: Record<AnalyticsColumnKey, string>
}

/** One summary number. */
export interface AnalyticsSummaryItem {
  key: string
  label: string
  value: string
}

/** The view's overall state. */
export type AnalyticsViewStatus = 'idle' | 'loading' | 'unavailable' | 'failed' | 'empty' | 'ready'

/** Everything the page renders. */
export interface AnalyticsView {
  status: AnalyticsViewStatus
  title: string
  intro: string
  /** Notices in priority order; always translated, never assembled copy. */
  notices: string[]
  summary: AnalyticsSummaryItem[]
  columns: AnalyticsColumn[]
  rows: AnalyticsViewRow[]
  footnote: string
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US')

/** Group digits without ever looking like a currency. */
function withGrouping(value: number): string {
  return NUMBER_FORMAT.format(value)
}

/** Percent from a part/whole pair; `undefined` when there is no whole. */
function percent(part: number, whole: number): string | undefined {
  return whole === 0 ? undefined : `${Math.round((part / whole) * 100)}%`
}

/** Milliseconds plus the translated unit. */
function milliseconds(value: number | undefined, t: AnalyticsTranslate): string {
  return value === undefined ? t('missing') : `${withGrouping(value)} ${t('msUnit')}`
}

/** Cost tier → its label key. */
function costKey(row: AnalyticsModelRow): AnalyticsKey {
  switch (row.cost) {
    case 'low': return 'costLow'
    case 'medium': return 'costMedium'
    case 'high': return 'costHigh'
    default: return 'costUnknown'
  }
}

/** Capability tier → its label key. */
function capabilityKey(row: AnalyticsModelRow): AnalyticsKey {
  switch (row.capability) {
    case 'standard': return 'capabilityStandard'
    case 'advanced': return 'capabilityAdvanced'
    default: return 'capabilityUnknown'
  }
}

/** The fixed comparison headers. */
function columns(t: AnalyticsTranslate): AnalyticsColumn[] {
  return [
    { key: 'model', label: t('columnModel') },
    { key: 'requests', label: t('columnRequests') },
    { key: 'tokens', label: t('columnTokens') },
    { key: 'firstToken', label: t('columnFirstToken') },
    { key: 'duration', label: t('columnDuration') },
    { key: 'failureRate', label: t('columnFailureRate') },
    { key: 'retries', label: t('columnRetries') },
    { key: 'cost', label: t('columnCost') },
    { key: 'capability', label: t('columnCapability') },
  ]
}

/** Project one model row. */
function viewRow(row: AnalyticsModelRow, t: AnalyticsTranslate): AnalyticsViewRow {
  const tokens = row.requestsWithUsage === 0 ? t('missing') : withGrouping(row.totalTokens)
  return {
    model: row.model,
    name: row.name,
    cells: {
      model: row.name,
      requests: withGrouping(row.requests),
      tokens,
      firstToken: milliseconds(row.avgFirstTokenMs, t),
      duration: milliseconds(row.avgDurationMs, t),
      failureRate: percent(row.failed, row.requests) ?? t('missing'),
      retries: withGrouping(row.retries),
      cost: t(costKey(row)),
      capability: t(capabilityKey(row)),
    },
  }
}

/** The summary block above the table. */
function summary(report: OpenDesignAnalyticsReport, t: AnalyticsTranslate): AnalyticsSummaryItem[] {
  const totals = report.totals
  const coverage = totals.requests === 0
    ? t('missing')
    : `${withGrouping(totals.requestsWithUsage)}/${withGrouping(totals.requests)}`
  return [
    { key: 'requests', label: t('summaryRequests'), value: withGrouping(totals.requests) },
    { key: 'sessions', label: t('summarySessions'), value: withGrouping(totals.sessions) },
    {
      key: 'tokens',
      label: t('summaryTokens'),
      value: totals.requestsWithUsage === 0 ? t('missing') : withGrouping(totals.totalTokens),
    },
    { key: 'firstToken', label: t('summaryFirstToken'), value: milliseconds(totals.avgFirstTokenMs, t) },
    { key: 'duration', label: t('summaryDuration'), value: milliseconds(totals.avgDurationMs, t) },
    { key: 'failureRate', label: t('summaryFailureRate'), value: percent(totals.failed, totals.requests) ?? t('missing') },
    { key: 'retries', label: t('summaryRetries'), value: withGrouping(totals.retries) },
    { key: 'coverage', label: t('summaryCoverage'), value: coverage },
  ]
}

/** Which top-level status the view lands on. */
function viewStatus(state: AnalyticsPageState): AnalyticsViewStatus {
  if (state.status === 'loading' || state.status === 'unavailable' || state.status === 'failed') return state.status
  if (state.report === undefined) return state.status === 'ready' ? 'empty' : 'idle'
  return state.report.totals.requests === 0 ? 'empty' : 'ready'
}

/**
 * Build every rendered string from the page state.
 * @param input - page state and bound translate function.
 * @returns the complete view model.
 */
export function buildAnalyticsView(input: { state: AnalyticsPageState; t: AnalyticsTranslate }): AnalyticsView {
  const { state, t } = input
  const report = state.report
  const status = viewStatus(state)
  const notices: string[] = []
  if (state.status === 'loading') notices.push(t('loading'))
  if (state.status === 'unavailable') notices.push(t('unavailable'))
  if (state.status === 'failed') notices.push(state.notice === 'invalidRange' ? t('invalidRange') : t('readFailed'))
  if (report !== undefined) {
    if (!report.history.available) {
      notices.push(report.history.reason === 'unreadable' ? t('historyUnreadable') : t('historyUnsupported'))
    }
    if (report.history.truncated) notices.push(t('truncated'))
    if (report.totals.requestsWithoutUsage > 0) notices.push(t('partialUsage'))
    if (report.models.some((row) => row.cost === 'unknown')) notices.push(t('unknownModels'))
    if (report.totals.requests === 0) notices.push(t('empty'))
  }
  return {
    status,
    title: t('title'),
    intro: t('intro'),
    notices,
    summary: report === undefined ? [] : summary(report, t),
    columns: columns(t),
    rows: report === undefined ? [] : report.models.map((row) => viewRow(row, t)),
    footnote: t('costNote'),
  }
}
