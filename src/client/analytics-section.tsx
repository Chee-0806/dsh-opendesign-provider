/**
 * The Open Design analytics page (`settings.section`, id `opendesign-analytics`).
 *
 * A thin projection of {@link OpenDesignAnalyticsController} and
 * {@link buildAnalyticsView}: the filter is a draft until "read" is pressed,
 * and every rendered string comes from the locale namespace, so the page never
 * assembles copy and never formats a monetary value.
 *
 * @module dsh-opendesign-provider/client/analytics-section
 */

import { useSyncExternalStore } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

import type { AnalyticsScope } from '../analytics-wire.ts'
import type { AnalyticsPageState } from './analytics.ts'
import type { AnalyticsKey } from './analytics-locales.ts'
import { buildAnalyticsView } from './analytics-view.ts'
import type { SnapshotStore } from './snapshot-store.ts'

/** The business face the slot registration injects into the page. */
export interface AnalyticsPageInjected {
  store: Pick<SnapshotStore<AnalyticsPageState>, 'getSnapshot' | 'subscribe'>
  setMode(mode: AnalyticsScope['kind']): void
  setRecentSessions(text: string): void
  setRangeFrom(text: string): void
  setRangeTo(text: string): void
  refresh(): Promise<AnalyticsPageState>
}

/** Props composed by the slot registration. */
export interface OpenDesignAnalyticsPageProps extends AnalyticsPageInjected {
  t: Translate<AnalyticsKey>
}

/** The analytics page. */
export function OpenDesignAnalyticsPage(props: OpenDesignAnalyticsPageProps) {
  const { t } = props
  const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot, props.store.getSnapshot)
  const view = buildAnalyticsView({ state, t })
  const busy = state.status === 'loading'

  return (
    <section className="cc-section" aria-label={view.title}>
      <h2 className="cc-title">{view.title}</h2>
      <p className="cc-intro">{view.intro}</p>

      <div className="cc-group">
        <div className="cc-groupHead"><h3 className="cc-groupTitle">{t('filterRecent')}</h3></div>
        <div className="cc-analyticsFilters">
          <div className="cc-analyticsModes" role="group" aria-label={t('title')}>
            <button
              className={state.mode === 'recent' ? 'cc-modeButton cc-modeButtonActive' : 'cc-modeButton'}
              type="button"
              aria-pressed={state.mode === 'recent'}
              onClick={() => props.setMode('recent')}
            >
              {t('filterRecent')}
            </button>
            <button
              className={state.mode === 'range' ? 'cc-modeButton cc-modeButtonActive' : 'cc-modeButton'}
              type="button"
              aria-pressed={state.mode === 'range'}
              onClick={() => props.setMode('range')}
            >
              {t('filterRange')}
            </button>
          </div>
          {state.mode === 'recent' ? (
            <label className="cc-analyticsField">
              <span className="cc-label">{t('recentSessions')}</span>
              <input
                className="cc-input cc-analyticsNumber"
                type="number"
                min={1}
                max={100}
                value={String(state.recentSessions)}
                disabled={busy}
                onChange={(event) => props.setRecentSessions(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="cc-analyticsField">
                <span className="cc-label">{t('from')}</span>
                <input
                  className="cc-input"
                  type="date"
                  value={state.rangeFrom}
                  disabled={busy}
                  onChange={(event) => props.setRangeFrom(event.target.value)}
                />
              </label>
              <label className="cc-analyticsField">
                <span className="cc-label">{t('to')}</span>
                <input
                  className="cc-input"
                  type="date"
                  value={state.rangeTo}
                  disabled={busy}
                  onChange={(event) => props.setRangeTo(event.target.value)}
                />
              </label>
            </>
          )}
          <button className="cc-linkButton" type="button" disabled={busy} onClick={() => void props.refresh()}>
            {busy ? t('reading') : t('read')}
          </button>
        </div>
      </div>

      {view.notices.length === 0 ? null : (
        <div className="cc-analyticsNotices">
          {view.notices.map((notice) => <p className="cc-hint" key={notice}>{notice}</p>)}
        </div>
      )}

      {view.summary.length === 0 ? null : (
        <div className="cc-analyticsSummary">
          {view.summary.map((item) => (
            <div className="cc-analyticsStat" key={item.key}>
              <span className="cc-analyticsStatLabel">{item.label}</span>
              <span className="cc-analyticsStatValue">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {view.rows.length === 0 ? null : (
        <div className="cc-group cc-groupDivided">
          <div className="cc-analyticsTableWrap">
            <table className="cc-analyticsTable">
              <thead>
                <tr>
                  {view.columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.model}>
                    {view.columns.map((column) => (
                      <td key={column.key} data-column={column.key} title={row.name}>{row.cells[column.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cc-hint">{view.footnote}</p>
        </div>
      )}

      {view.rows.length === 0 ? <p className="cc-hint">{view.footnote}</p> : null}
    </section>
  )
}
