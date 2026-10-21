/**
 * The Open Design settings page (`settings.section`, id `opendesign`).
 *
 * Four groups in the order the design fixes: Connection, Models & context,
 * Display, Advanced. The page is a projection of the shared controller — the
 * same one the Models-page card uses — so the two surfaces cannot disagree
 * about key presence or catalog provenance. Copy comes only from the
 * `settings.opendesign` locale namespace.
 *
 * @module dsh-opendesign-provider/client/section
 */

import { useSyncExternalStore } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

import type { SnapshotStore } from './snapshot-store.ts'
import {
  noticeText,
  type SettingsOpenDesignKey,
} from './locales.ts'
import { apiKeyBadgeKey, type ContextOverrideDraft, type FieldDraft, type InvalidReason, type SettingsField, type SettingsModelRow, type SettingsPageState, type SettingsSaveOutcome } from './settings.ts'

/** The business face the slot registration injects into the page. */
export interface SettingsPageInjected {
  settingsStore: Pick<SnapshotStore<SettingsPageState>, 'getSnapshot' | 'subscribe'>
  state(): SettingsPageState
  cardMode(): 'unavailable' | 'readonly' | 'ready'
  edit(field: SettingsField, text: string): void
  resetField(field: SettingsField): void
  toggleModel(id: string): void
  editContextWindow(text: string): void
  editContextOverride(model: string, text: string): void
  setLanguage(language: string): void
  setShowSidebarQuota(value: boolean): void
  setKey(value: string): void
  clearKey(): void
  save(): Promise<SettingsSaveOutcome>
  discard(): void
  diagnosticText(): string
  refresh(): void
}

/** Props composed by the slot registration. */
export interface OpenDesignSettingsPageProps extends SettingsPageInjected {
  t: Translate<SettingsOpenDesignKey>
}

interface Invalidatable {
  invalid: boolean
  reason?: InvalidReason | undefined
}

/** Translate one validation reason, or undefined when the draft is valid. */
function fieldError(t: Translate<SettingsOpenDesignKey>, draft: Invalidatable): string | undefined {
  if (!draft.invalid) return undefined
  if (draft.reason === 'tooSmall') return t('invalidTooSmall')
  if (draft.reason === 'tooLarge') return t('invalidTooLarge')
  return t('invalidFormat')
}

/** One labelled text row with an optional hint and validation message. */
function FieldRow(props: {
  t: Translate<SettingsOpenDesignKey>
  label: string
  hint: string
  draft: FieldDraft
  disabled: boolean
  type?: 'text' | 'password' | 'number'
  placeholder?: string
  onChange(text: string): void
  onReset?(): void
}) {
  const error = fieldError(props.t, props.draft)
  return (
    <label className="od-field">
      <span className="od-fieldHead">
        <span className="od-label">{props.label}</span>
      </span>
      <input
        className={error === undefined ? 'od-input' : 'od-input od-inputInvalid'}
        type={props.type ?? 'text'}
        value={props.draft.text}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <p className="od-hint">{props.hint}</p>
      {error === undefined ? null : <p className="od-rowError">{error}</p>}
    </label>
  )
}

/** One catalog model checkbox with its uncalibrated mark. */
function ModelRow(props: {
  t: Translate<SettingsOpenDesignKey>
  model: SettingsModelRow
  disabled: boolean
  onToggle(): void
}) {
  return (
    <label className="od-checkRow">
      <input
        className="od-check"
        type="checkbox"
        checked={props.model.visible}
        disabled={props.disabled}
        onChange={props.onToggle}
      />
      <span className="od-checkName">{props.model.name}</span>
      {props.model.calibrated ? null : <span className="od-badgeWarn">{props.t('uncalibrated')}</span>}
    </label>
  )
}

/** One per-model context-window override row. */
function ContextRow(props: {
  t: Translate<SettingsOpenDesignKey>
  row: ContextOverrideDraft
  modelName: string
  disabled: boolean
  onChange(text: string): void
}) {
  const error = fieldError(props.t, props.row)
  return (
    <div className="od-contextItem">
      <span className="od-label">{props.modelName}</span>
      <input
        className={error === undefined ? 'od-input od-contextValue' : 'od-input od-contextValue od-inputInvalid'}
        type="text"
        inputMode="numeric"
        value={props.row.text}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {error === undefined ? null : <p className="od-rowError od-contextError">{error}</p>}
    </div>
  )
}

/** The settings page. */
export function OpenDesignSettingsPage(props: OpenDesignSettingsPageProps) {
  const { t } = props
  const state = useSyncExternalStore(
    props.settingsStore.subscribe,
    props.settingsStore.getSnapshot,
    props.settingsStore.getSnapshot,
  )
  const disabled = !state.writable || state.saving
  const catalogLabel = state.catalogSource === 'live'
    ? t('catalogLive')
    : state.catalogSource === 'static'
      ? t('catalogStatic')
      : t('catalogUnknown')
  const loginLabel = state.loginStatus === 'ok'
    ? t('loginOk')
    : state.loginStatus === 'missing'
      ? t('loginMissing')
      : state.loginStatus === 'malformed'
        ? t('loginMalformed')
        : state.loginStatus === 'unreadable'
          ? t('loginUnreadable')
          : t('loginUnknown')
  const copyDiagnostics = (): void => {
    const text = props.diagnosticText()
    void navigator.clipboard?.writeText(text)
  }

  return (
    <section className="od-section" aria-label={t('title')}>
      <h2 className="od-title">{t('title')}</h2>
      <p className="od-intro">{t('intro')}</p>
      {state.writable ? null : <p className="od-readOnly">{t('readOnly')}</p>}

      <div className="od-group">
        <div className="od-groupHead"><h3 className="od-groupTitle">{t('connection')}</h3></div>
        <p className="od-groupDesc">{t('connectionDesc')}</p>
        <div className="od-rows">
          <div className="od-row">
            <div className="od-rowText">
              <span className="od-rowTitleLine">
                <span className="od-rowTitle">{t('apiKey')}</span>
                <span className={state.apiKeyConfigured ? 'od-badge' : 'od-badgeMuted'}>
                  {t(apiKeyBadgeKey(state))}
                </span>
              </span>
              <span className="od-rowDesc">{t('apiKeyHint')}</span>
            </div>
            <div className="od-rowControl">
              <input
                className="od-input od-rowInputWide"
                type="password"
                autoComplete="off"
                value={state.keyDraft}
                placeholder={t('apiKeyPlaceholder')}
                disabled={disabled || !state.apiKeyWritable}
                onChange={(event) => props.setKey(event.target.value)}
              />
              <button className="od-linkButton" type="button" disabled={disabled} onClick={() => props.clearKey()}>
                {t('clearKey')}
              </button>
            </div>
          </div>
          <FieldRow
            t={t}
            label={t('apiBase')}
            hint={t('apiBaseHint')}
            draft={state.fields.apiBase}
            disabled={disabled}
            placeholder="https://amr-link.open-design.ai/v1"
            onChange={(text) => props.edit('apiBase', text)}
          />
          <div className="od-row">
            <div className="od-rowText">
              <span className="od-rowTitle">{t('loginStatus')}</span>
              <span className="od-rowDesc">{t('loginHint')}</span>
              <span className="od-rowDesc">{t('loginUse')}</span>
            </div>
            <div className="od-rowControl">
              <span className={state.loginStatus === 'ok' ? 'od-badge' : 'od-badgeMuted'}>{loginLabel}</span>
            </div>
          </div>
          {state.controlKeyWarning ? <p className="od-rowError">{t('controlKeyWarn')}</p> : null}
        </div>
      </div>

      <div className="od-group od-groupDivided">
        <div className="od-groupHead">
          <h3 className="od-groupTitle">{t('modelsSection')}</h3>
          <span className="od-badgeMuted">{catalogLabel}</span>
        </div>
        <p className="od-groupDesc">{t('modelsSectionDesc')}</p>
        <div className="od-rows">
          <div className="od-field">
            <span className="od-fieldHead"><span className="od-label">{t('visibleModels')}</span></span>
            {state.models.length === 0
              ? <p className="od-hint">{t('modelsSectionDesc')}</p>
              : state.models.map((model) => (
                <ModelRow
                  key={model.id}
                  t={t}
                  model={model}
                  disabled={disabled}
                  onToggle={() => props.toggleModel(model.id)}
                />
              ))}
            <p className="od-hint">{t('visibleModelsHint')}</p>
          </div>
          <FieldRow
            t={t}
            label={t('contextWindow')}
            hint={t('contextWindowHint')}
            draft={state.fields.contextWindow}
            disabled={disabled}
            onChange={(text) => props.editContextWindow(text)}
          />
          <div className="od-field">
            <span className="od-fieldHead"><span className="od-label">{t('contextOverrides')}</span></span>
            {state.contextOverrides.map((row) => (
              <ContextRow
                key={row.model}
                t={t}
                row={row}
                modelName={state.models.find((model) => model.id === row.model)?.name ?? row.model}
                disabled={disabled}
                onChange={(text) => props.editContextOverride(row.model, text)}
              />
            ))}
            <p className="od-hint">{t('contextOverridesHint')}</p>
          </div>
          <FieldRow
            t={t}
            label={t('maxOutputTokens')}
            hint={t('maxOutputTokensHint')}
            draft={state.fields.maxOutputTokens}
            disabled={disabled}
            onChange={(text) => props.edit('maxOutputTokens', text)}
          />
        </div>
      </div>

      <div className="od-group od-groupDivided">
        <div className="od-groupHead"><h3 className="od-groupTitle">{t('displaySection')}</h3></div>
        <p className="od-groupDesc">{t('displaySectionDesc')}</p>
        <div className="od-rows">
          <label className="od-row">
            <span className="od-rowText"><span className="od-rowTitle">{t('language')}</span></span>
            <span className="od-rowControl">
              <select
                className="od-input"
                value={state.language}
                disabled={disabled}
                onChange={(event) => props.setLanguage(event.target.value)}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </span>
          </label>
          <label className="od-row">
            <span className="od-rowText">
              <span className="od-rowTitle">{t('sidebarQuota')}</span>
              <span className="od-rowDesc">{t('sidebarQuotaHint')}</span>
            </span>
            <span className="od-rowControl">
              <input
                className="od-check"
                type="checkbox"
                checked={state.showSidebarQuotaDraft}
                disabled={disabled}
                onChange={(event) => props.setShowSidebarQuota(event.target.checked)}
              />
            </span>
          </label>
          {state.showSidebarQuotaDraft && state.controlKeyWarning
            ? <p className="od-rowError">{t('controlKeyWarn')}</p>
            : null}
        </div>
      </div>

      <div className="od-group od-groupDivided">
        <div className="od-groupHead"><h3 className="od-groupTitle">{t('advanced')}</h3></div>
        <p className="od-groupDesc">{t('advancedDesc')}</p>
        <div className="od-rows">
          <FieldRow
            t={t}
            label={t('requestTimeout')}
            hint={t('requestTimeoutHint')}
            draft={state.fields.requestTimeoutMs}
            disabled={disabled}
            onChange={(text) => props.edit('requestTimeoutMs', text)}
          />
          <FieldRow
            t={t}
            label={t('streamIdleTimeout')}
            hint={t('streamIdleTimeoutHint')}
            draft={state.fields.streamIdleTimeoutMs}
            disabled={disabled}
            onChange={(text) => props.edit('streamIdleTimeoutMs', text)}
          />
          <FieldRow
            t={t}
            label={t('transportMaxRetries')}
            hint={t('transportMaxRetriesHint')}
            draft={state.fields.transportMaxRetries}
            disabled={disabled}
            onChange={(text) => props.edit('transportMaxRetries', text)}
          />
          <FieldRow
            t={t}
            label={t('modelsCachePath')}
            hint={t('modelsCachePathHint')}
            draft={state.fields.modelsCachePath}
            disabled={disabled}
            onChange={(text) => props.edit('modelsCachePath', text)}
          />
          <div className="od-row">
            <div className="od-rowText">
              <span className="od-rowTitle">{t('diagnostics')}</span>
              <span className="od-rowDesc">{t('diagnosticsHint')}</span>
            </div>
            <div className="od-rowControl">
              <button className="od-linkButton" type="button" onClick={copyDiagnostics}>
                {t('copyDiagnostics')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {state.dirty ? (
        <div className="od-saveBarDock">
          <div className="od-saveBar od-saveBarShown">
            <p className="od-saveBarText">{state.notice === undefined ? t('intro') : noticeText(t, state.notice.key)}</p>
            <div className="od-saveBarActions">
              <button className="od-saveBarButton od-saveBarGhost" type="button" disabled={state.saving} onClick={() => props.discard()}>
                {t('discard')}
              </button>
              <button className="od-saveBarButton od-saveBarPrimary" type="button" disabled={disabled} onClick={() => props.save()}>
                {state.saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
