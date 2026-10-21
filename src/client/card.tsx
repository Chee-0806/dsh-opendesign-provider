/**
 * The Open Design panel inside the Models page
 * (`settings.models.provider-card`, key `llm-opensign` — the directory row's
 * settings namespace `llm-opendesign`).
 *
 * The card is deliberately compact: key status, one paste field, the catalog's
 * provenance and the uncalibrated mark. Both the status and the catalog facts
 * come from the shared settings controller, so this surface never invents a
 * second answer for what the settings page already knows.
 *
 * @module dsh-opendesign-provider/client/card
 */

import { useState, useSyncExternalStore } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

import { cardMode, type SettingsPageState } from './settings.ts'
import { noticeText, type SettingsOpenDesignKey } from './locales.ts'
import type { SettingsPageInjected } from './section.tsx'

/**
 * The Models-page extension slots, merged with the exact declarations
 * ui-settings-models ships (`kind`/`scope`/`owner` must stay structurally
 * identical, or a dsh carrying its own declaration fails duplicate merge).
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One provider card's adapter extension area, keyed by the row's settingsNs. */
    'settings.models.provider-card': { kind: 'keyed'; scope: 'root'; owner: ProviderCardExtrasOwnerProps }
  }
}

/** The provider directory row the Models page dispatches. */
export interface ProviderDirectoryRow {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly active: boolean
  readonly declared?: boolean
}

/** Owner share of one provider-card extension occurrence (upstream's shape). */
export interface ProviderCardExtrasOwnerProps {
  readonly provider: ProviderDirectoryRow
  readonly configured: boolean
  readonly keyConfigured: boolean
}

/** Props composed by the card's slot registration. */
export interface OpenDesignProviderCardProps extends SettingsPageInjected, Partial<ProviderCardExtrasOwnerProps> {
  t: Translate<SettingsOpenDesignKey>
}

/** One compact status pill. */
function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={ok ? 'od-badge' : 'od-badgeMuted'}>{children}</span>
}

/** The Models-page provider card. */
export function OpenDesignProviderCard(props: OpenDesignProviderCardProps) {
  const { t } = props
  const state: SettingsPageState = useSyncExternalStore(
    props.settingsStore.subscribe,
    props.settingsStore.getSnapshot,
    props.settingsStore.getSnapshot,
  )
  const [paste, setPaste] = useState('')
  const mode = cardMode(state)
  const disabled = mode !== 'ready' || state.saving
  const keySet = state.apiKeyConfigured
  const catalogLabel = state.catalogSource === 'live'
    ? t('catalogLive')
    : state.catalogSource === 'static'
      ? t('catalogStatic')
      : t('catalogUnknown')
  const uncalibrated = state.models.filter((model) => !model.calibrated).length
  const save = (): void => {
    if (paste.trim() === '') return
    props.setKey(paste.trim())
    props.save()
    setPaste('')
  }

  if (mode === 'unavailable') {
    return <div className="od-providerCard"><p className="od-hint">{t('apiKeyUnknown')}</p></div>
  }

  return (
    <div className="od-providerCard">
      <div className="od-row">
        <div className="od-rowText">
          <span className="od-rowTitleLine">
            <span className="od-rowTitle">{t('cardTitle')}</span>
            <Badge ok={keySet}>{keySet ? t('apiKeySet') : state.apiKeyKnown ? t('apiKeyUnset') : t('apiKeyUnknown')}</Badge>
          </span>
          <span className="od-rowDesc">{t('apiKeyHint')}</span>
        </div>
        <div className="od-rowControl">
          {keySet ? (
            <button className="od-linkButton" type="button" disabled={disabled} onClick={() => { props.clearKey(); props.save() }}>
              {t('clearKey')}
            </button>
          ) : (
            <>
              <input
                className="od-input od-rowInput"
                type="password"
                autoComplete="off"
                value={paste}
                placeholder={t('apiKeyPlaceholder')}
                disabled={disabled || !state.apiKeyWritable}
                onChange={(event) => setPaste(event.target.value)}
              />
              <button className="od-linkButton" type="button" disabled={disabled || paste.trim() === ''} onClick={save}>
                {t('cardSave')}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="od-row">
        <div className="od-rowText">
          <span className="od-rowTitleLine">
            <span className="od-rowTitle">{t('cardCatalog')}</span>
            <span className="od-badgeMuted">{catalogLabel}</span>
            {state.catalogCached ? <span className="od-badgeMuted">{t('catalogCached')}</span> : null}
          </span>
          <span className="od-rowDesc">
            {state.catalogApiBase ?? ''}
            {state.catalogReason === undefined ? '' : ` · ${t('catalogReason')}: ${state.catalogReason}`}
          </span>
        </div>
        {uncalibrated > 0 ? (
          <div className="od-rowControl">
            <span className="od-badgeWarn">{t('cardUncalibrated')} {uncalibrated}</span>
          </div>
        ) : null}
      </div>
      {state.controlKeyWarning ? <p className="od-hint">{t('controlKeyWarn')}</p> : null}
      {state.notice === undefined ? null : (
        <p className={state.notice.kind === 'error' ? 'od-rowError' : 'od-hint'}>{noticeText(t, state.notice.key)}</p>
      )}
    </div>
  )
}
