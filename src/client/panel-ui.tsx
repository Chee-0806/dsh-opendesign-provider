/**
 * The two quota-panel surfaces (ticket 11): the opt-in sidebar card
 * (`sidebar.footer.action`) and the dashboard it opens in the layout's keyed
 * `main` cell.
 *
 * Both are projections of one React-free view model (`panel-view.ts`), so the
 * card and the dashboard cannot disagree about tier, windows or the stale mark.
 * The card is a `<button>`: the sidebar shell renders footer actions inside its
 * own action column without chrome, so the entry itself must be the control.
 * Collapsed to the rail (`wide === false`) the entry becomes one icon button.
 *
 * @module dsh-opendesign-provider/client/panel-ui
 */

import { useSyncExternalStore } from 'react'

import { buildQuotaPanelView, type QuotaWindowView } from './panel-view.ts'
import type { QuotaCardProps, QuotaDashboardProps } from './panel-slots.ts'

/** The quota ring mark used by the card and the collapsed rail. */
function RingGlyph({ size }: { size: number }) {
  return (
    <svg
      className="odp-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 4.5A7.5 7.5 0 0 1 19.5 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** One window's progress block, shared by the card and the dashboard. */
function WindowRow(props: { window: QuotaWindowView }) {
  const fill = props.window.overLimit ? 'odp-barFill odp-barFillWarn' : 'odp-barFill'
  return (
    <div className="odp-window">
      <div className="odp-windowHead">
        <span className="odp-windowLabel">{props.window.label}</span>
        <span className="odp-spacer" />
        <span className="odp-windowValue">{props.window.amountText}</span>
        <span className="odp-windowPct">{props.window.percentText}</span>
      </div>
      <div className="odp-bar">
        <div className={fill} style={{ width: `${props.window.percent}%` }} />
      </div>
      <p className="odp-windowReset">{props.window.resetText} · {props.window.remainingText}</p>
    </div>
  )
}

/** The opt-in sidebar card; renders nothing while the switch is off or quota is unavailable. */
export function OpenDesignQuotaCard(props: QuotaCardProps) {
  const state = useSyncExternalStore(
    props.panelStore.subscribe,
    props.panelStore.getSnapshot,
    props.panelStore.getSnapshot,
  )
  const t = props.t
  const view = buildQuotaPanelView({ ...state, t, locale: props.panelLocale() })
  if (!view.visible) return null

  if (props.wide === false) {
    return (
      <button
        className="odp-railButton"
        type="button"
        title={t('open')}
        aria-label={t('open')}
        onClick={() => props.panelOpen()}
      >
        <RingGlyph size={18} />
      </button>
    )
  }

  return (
    <button
      className="odp-foot"
      type="button"
      title={t('open')}
      aria-label={t('open')}
      onClick={() => props.panelOpen()}
    >
      <span className="odp-footTop">
        <span className="odp-footName">{view.tierText}</span>
        {view.staleText === undefined ? null : <span className="odp-badgeWarn">{view.staleText}</span>}
      </span>
      {view.windows.map((window) => (
        <span className="odp-footRow" key={window.kind}>
          <span className="odp-footHead">
            <span className="odp-footLabel">{window.label}</span>
            <span className="odp-footAmount">{window.amountText}</span>
          </span>
          <span className="odp-footBar">
            <span
              className={window.overLimit ? 'odp-footFill odp-footFillWarn' : 'odp-footFill'}
              style={{ width: `${window.percent}%` }}
            />
          </span>
        </span>
      ))}
      {view.windows.length > 0 ? null : (
        <span className="odp-footLabel">{view.fundingText ?? view.emptyText}</span>
      )}
    </button>
  )
}

/** The dashboard cell; empty unless the card opened it. */
export function OpenDesignQuotaDashboard(props: QuotaDashboardProps) {
  const state = useSyncExternalStore(
    props.panelStore.subscribe,
    props.panelStore.getSnapshot,
    props.panelStore.getSnapshot,
  )
  const t = props.t
  const view = buildQuotaPanelView({ ...state, t, locale: props.panelLocale() })
  if (!state.open || !view.visible) return null

  return (
    <section className="odp-main" aria-label={t('title')}>
      <div className="odp-mainInner">
        <header className="odp-header">
          <div className="odp-headerText">
            <h2 className="odp-title">{t('title')}</h2>
            <p className="odp-subtitle">{t('subtitle')}</p>
          </div>
          <span className="odp-spacer" />
          {view.staleText === undefined ? null : <span className="odp-badgeWarn">{view.staleText}</span>}
          <span className="odp-dashboardActions">
            <button
              className="odp-action"
              type="button"
              disabled={state.loading}
              onClick={() => props.panelRefresh()}
            >
              {state.loading ? t('refreshing') : t('refresh')}
            </button>
            <button
              className="odp-action"
              type="button"
              aria-label={t('close')}
              title={t('close')}
              onClick={() => props.panelClose()}
            >
              ×
            </button>
          </span>
        </header>

        <div className="odp-card">
          <div className="odp-block">
            <h3 className="odp-blockTitle">{t('title')}</h3>
            <div className="odp-planRow">
              <span className="odp-planName">{view.tierText}</span>
              {view.statusText === undefined ? null : <span className="odp-badgeMuted">{view.statusText}</span>}
              {view.balanceText === undefined ? null : <span className="odp-badge">{view.balanceText}</span>}
            </div>
            {view.periodText === undefined ? null : <p className="odp-hint">{view.periodText}</p>}
            {view.fetchedText === undefined ? null : <p className="odp-hint">{view.fetchedText}</p>}
          </div>

          <div className="odp-windows">
            {view.windows.map((window) => <WindowRow key={window.kind} window={window} />)}
          </div>
          {view.emptyText === undefined ? null : <p className="odp-hint">{view.emptyText}</p>}

          <div className="odp-block">
            <p className="odp-hint">{view.explainerText}</p>
            {view.fundingText === undefined ? null : <p className="odp-hint">{view.fundingText}</p>}
          </div>

          {view.loadFailedText === undefined
            ? null
            : <p className="odp-error">{view.loadFailedText}</p>}
        </div>
      </div>
    </section>
  )
}
