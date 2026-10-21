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

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

import type { SnapshotStore } from './snapshot-store.ts'
import {
  noticeText,
  type SettingsOpenDesignKey,
} from './locales.ts'
import { apiKeyBadgeKey, overrideChoices, type ContextOverrideDraft, type FieldDraft, type InvalidReason, type SettingsField, type SettingsModelRow, type SettingsPageState, type SettingsSaveOutcome } from './settings.ts'

/** The business face the slot registration injects into the page. */
export interface SettingsPageInjected {
  settingsStore: Pick<SnapshotStore<SettingsPageState>, 'getSnapshot' | 'subscribe'>
  state(): SettingsPageState
  cardMode(): 'unavailable' | 'readonly' | 'ready'
  edit(field: SettingsField, text: string): void
  resetField(field: SettingsField): void
  toggleModel(id: string): void
  showAllModels(): void
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

/** The left column every settings row shares: title, description and error. */
function RowText(props: {
  title: string
  desc?: string | undefined
  error?: string | undefined
}) {
  return (
    <span className="od-rowText">
      <span className="od-rowTitle">{props.title}</span>
      {props.desc === undefined ? null : <span className="od-rowDesc">{props.desc}</span>}
      {props.error === undefined ? null : <span className="od-rowError">{props.error}</span>}
    </span>
  )
}

/**
 * One labelled field: title and description on the left, control on the right.
 *
 * This is the settings page's default shape — a full-width input under a label
 * leaves the right half of the row empty at every breakpoint the host uses.
 */
function FieldRow(props: {
  t: Translate<SettingsOpenDesignKey>
  label: string
  hint: string
  draft: FieldDraft
  disabled: boolean
  placeholder?: string
  onChange(text: string): void
}) {
  const error = fieldError(props.t, props.draft)
  return (
    <label className="od-row od-fieldRow od-inputRow">
      <RowText title={props.label} desc={props.hint} error={error} />
      <span className="od-rowControl">
        <input
          className={error === undefined ? 'od-input od-fieldInput' : 'od-input od-fieldInput od-inputInvalid'}
          type="text"
          value={props.draft.text}
          placeholder={props.placeholder}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </span>
    </label>
  )
}

/**
 * The allowlist as a dropdown: a summary trigger plus a scrollable picker.
 *
 * Inlining one checkbox per catalog model pushed the rest of the page off the
 * fold at twelve models; the trigger states the current selection and the list
 * opens over the page instead of inside it. The picker groups the catalog by
 * capability and then by cost (the design's grouping rule) and keeps a "show
 * all" row at its top so clearing the allowlist is one action, not N toggles.
 */
export function ModelAllowlist(props: {
  t: Translate<SettingsOpenDesignKey>
  models: readonly SettingsModelRow[]
  selected: readonly string[]
  allVisible: boolean
  disabled: boolean
  onToggle(id: string): void
  onShowAll(): void
}) {
  const [open, setOpen] = useState(false)
  const [menuUp, setMenuUp] = useState(false)
  const anchor = useRef<HTMLSpanElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  // The settings dialog is a scroll container, so a menu that always opens
  // downward is clipped exactly when the allowlist sits near the bottom edge.
  // Measure the trigger and open toward the roomier side instead.
  useLayoutEffect(() => {
    if (!open) return
    const rect = trigger.current?.getBoundingClientRect()
    if (rect === undefined) return
    setMenuUp(window.innerHeight - rect.bottom < 320 && rect.top > window.innerHeight - rect.bottom)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && anchor.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const label = props.allVisible
    ? props.t('allModels')
    : props.t('selectedModels', { count: String(props.selected.length) })

  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }

  /** capability first, then cost — the order the design's grouping rule names. */
  const groups = new Map<string, SettingsModelRow[]>()
  for (const model of props.models) {
    const key = `${model.capability}/${model.cost}`
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [model])
    else bucket.push(model)
  }

  return (
    <span
      className="od-rowControl od-allowlist"
      ref={anchor}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          close()
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget
        if (open && next instanceof Node && anchor.current?.contains(next) !== true) setOpen(false)
      }}
    >
      <span className="od-allowlistAnchor">
        <button
          className="od-selector od-allowlistTrigger"
          type="button"
          ref={trigger}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={open ? ALLOWLIST_MENU_ID : undefined}
          disabled={props.disabled}
          onClick={() => setOpen(!open)}
        >
          <span className="od-selectorText">{label}</span>
          <span className="od-selectorCaret" aria-hidden="true" />
        </button>
        {open ? (
          <div
            className={menuUp ? 'od-allowlistMenu od-allowlistMenuUp' : 'od-allowlistMenu'}
            id={ALLOWLIST_MENU_ID}
            role="menu"
            aria-label={props.t('visibleModels')}
          >
            <button
              className="od-allowlistItem od-allowlistShowAll"
              type="button"
              role="menuitem"
              disabled={props.disabled || props.allVisible}
              onClick={() => {
                props.onShowAll()
                setOpen(false)
              }}
            >
              {props.t('showAllModels')}
            </button>
            {props.models.length === 0
              // Nothing to tick: explain what the list is for instead of
              // telling the reader to tick something that is not there.
              ? <p className="od-hint od-allowlistEmpty">{props.t('modelsSectionDesc')}</p>
              : [...groups].map(([key, models]) => (
                <fieldset className="od-allowlistGroup" key={key}>
                  <legend className="od-allowlistGroupLabel">{groupLabel(props.t, key)}</legend>
                  {models.map((model) => (
                    <label className="od-allowlistItem" key={model.id}>
                      <input
                        className="od-check"
                        type="checkbox"
                        role="menuitemcheckbox"
                        aria-checked={model.visible}
                        checked={model.visible}
                        disabled={props.disabled}
                        onChange={() => props.onToggle(model.id)}
                      />
                      <span className="od-allowlistName">{model.name}</span>
                      {model.calibrated ? null : <span className="od-badgeWarn">{props.t('uncalibrated')}</span>}
                    </label>
                  ))}
                </fieldset>
              ))}
          </div>
        ) : null}
      </span>
    </span>
  )
}

/** The menu id the trigger's aria-controls points at. */
const ALLOWLIST_MENU_ID = 'opendesign-allowlist-menu'

/** One group heading, e.g. "进阶能力 · 低成本". */
function groupLabel(t: Translate<SettingsOpenDesignKey>, key: string): string {
  const [capability, cost] = key.split('/') as [SettingsModelRow['capability'], SettingsModelRow['cost']]
  const capabilityText = capability === 'advanced' ? t('capabilityAdvanced') : t('capabilityStandard')
  const costText = cost === 'high' ? t('costHigh') : cost === 'medium' ? t('costMedium') : t('costLow')
  return `${capabilityText} · ${costText}`
}

/**
 * Per-model context-window overrides as an editable list.
 *
 * Only rows that carry a value — plus rows added in this session — are shown,
 * which is what makes "add a model" mean anything: the stored document only
 * keeps non-empty entries, so a removed row simply stops being written.
 */
export function ContextOverrideEditor(props: {
  t: Translate<SettingsOpenDesignKey>
  rows: readonly ContextOverrideDraft[]
  choices: readonly SettingsModelRow[]
  disabled: boolean
  onChange(model: string, text: string): void
}) {
  const [added, setAdded] = useState<readonly string[]>([])
  const filled = props.rows.filter((row) => row.text.trim() !== '')
  const visible = [
    ...filled,
    ...props.rows.filter((row) => added.includes(row.model) && !filled.includes(row)),
  ]
  const used = new Set(visible.map((row) => row.model))
  const spare = props.choices.find((model) => !used.has(model.id))

  const addRow = (): void => {
    if (spare === undefined) return
    setAdded([...added, spare.id])
  }
  const removeRow = (model: string): void => {
    props.onChange(model, '')
    setAdded(added.filter((id) => id !== model))
  }
  const swapModel = (previous: string, next: string): void => {
    const value = props.rows.find((row) => row.model === previous)?.text ?? ''
    props.onChange(previous, '')
    props.onChange(next, value)
    setAdded((current) => {
      const without = current.filter((id) => id !== previous)
      return value.trim() === '' ? [...without, next] : without
    })
  }

  const options = props.choices.map((model) => ({ id: model.id, name: model.name }))
  if (options.length === 0) {
    return <p className="od-hint">{props.t('contextOverridesHint')}</p>
  }

  return (
    <div className="od-overrides">
      <div className="od-overrideHead">
        <span className="od-overrideHeadModel">{props.t('columnModel')}</span>
        <span className="od-overrideHeadValue">{props.t('columnContext')}</span>
        {/* Same 28px cell as the row's remove button, so the two headers line
            up with the two inputs instead of drifting right. */}
        <button
          className="od-linkButton od-overrideAdd"
          type="button"
          disabled={props.disabled || spare === undefined}
          aria-label={props.t('addModel')}
          title={props.t('addModel')}
          onClick={addRow}
        >
          + {props.t('addModel')}
        </button>
      </div>
      {visible.map((row) => {
        const error = fieldError(props.t, row)
        const name = props.choices.find((model) => model.id === row.model)?.name ?? row.model
        return (
          <div className="od-overrideRow" key={row.model}>
            <select
              className="od-input od-overrideModel"
              value={row.model}
              disabled={props.disabled}
              aria-label={props.t('columnModel')}
              onChange={(event) => swapModel(row.model, event.target.value)}
            >
              <option value={row.model}>{name}</option>
              {options
                .filter((option) => option.id !== row.model && !used.has(option.id))
                .map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <input
              className={error === undefined ? 'od-input od-overrideValue' : 'od-input od-overrideValue od-inputInvalid'}
              type="text"
              inputMode="numeric"
              value={row.text}
              disabled={props.disabled}
              aria-label={`${row.model} ${props.t('columnContext')}`}
              onChange={(event) => props.onChange(row.model, event.target.value)}
            />
            <button
              className="od-iconButton"
              type="button"
              disabled={props.disabled}
              aria-label={props.t('removeModel')}
              title={props.t('removeModel')}
              onClick={() => removeRow(row.model)}
            >
              ×
            </button>
            {error === undefined ? null : <p className="od-rowError od-overrideError">{error}</p>}
          </div>
        )
      })}
      <p className="od-hint">{props.t('contextOverridesHint')}</p>
    </div>
  )
}

/**
 * One collapsible header row.
 *
 * The button carries `aria-expanded`, so the row is a disclosure control for
 * assistive tech; the chevron is decoration only. `summary` is the one line a
 * folded block must still show, so folding never hides the fact that something
 * inside is set.
 */
export function DisclosureHeader(props: {
  label: string
  badge?: ReactNode
  summary?: string | undefined
  open: boolean
  onToggle(): void
  scale: 'group' | 'field'
}) {
  return (
    <button
      className={`od-disclosure od-disclosureRow ${props.scale === 'group' ? 'od-disclosureGroup' : 'od-disclosureField'}`}
      type="button"
      aria-expanded={props.open}
      onClick={props.onToggle}
    >
      <span className="od-disclosureLabel">{props.label}</span>
      {props.badge}
      {props.summary === undefined ? null : <span className="od-disclosureSummary">{props.summary}</span>}
      <span className={props.open ? 'od-chevron od-chevronUp' : 'od-chevron'} aria-hidden="true" />
    </button>
  )
}

/**
 * One collapsible settings group.
 *
 * The heading keeps its `h3` and wraps the disclosure button, so the page's
 * outline survives folding. Drafts live in the controller, so folding can
 * never drop an edit.
 */
export function SettingsGroup(props: {
  title: string
  badge?: ReactNode
  desc?: string
  defaultOpen?: boolean
  first?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  return (
    <div className={props.first === true ? 'od-group' : 'od-group od-groupDivided'}>
      <div className="od-groupHead">
        <h3 className="od-groupTitle od-groupTitleToggle">
          <DisclosureHeader
            label={props.title}
            badge={props.badge}
            open={open}
            onToggle={() => setOpen(!open)}
            scale="group"
          />
        </h3>
      </div>
      <div hidden={!open}>
        {props.desc === undefined ? null : <p className="od-groupDesc">{props.desc}</p>}
        {props.children}
      </div>
    </div>
  )
}

/**
 * One collapsible field inside a group — for lists long enough to bury their
 * neighbours (the model allowlist, the per-model overrides).
 */
export function SettingsField(props: {
  label: string
  summary?: string | undefined
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true)
  return (
    <div className="od-field">
      <DisclosureHeader
        label={props.label}
        summary={props.summary}
        open={open}
        onToggle={() => setOpen(!open)}
        scale="field"
      />
      <div hidden={!open}>{props.children}</div>
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
  // The folded override block still reports how many models carry one.
  const overrideCount = state.contextOverrides.filter((row) => row.text.trim() !== '').length

  return (
    <section className={state.dirty ? 'od-section od-sectionWithBar' : 'od-section'} aria-label={t('title')}>
      <h2 className="od-title">{t('title')}</h2>
      <p className="od-intro">{t('intro')}</p>
      {state.writable ? null : <p className="od-readOnly">{t('readOnly')}</p>}

      <SettingsGroup title={t('connection')} desc={t('connectionDesc')} defaultOpen first>
        <div className="od-rows">
          <div className="od-row od-fieldRow od-inputRow">
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
          <div className="od-row od-fieldRow">
            <RowText title={t('loginStatus')} desc={`${t('loginHint')} ${t('loginUse')}`} />
            <div className="od-rowControl">
              <span className={state.loginStatus === 'ok' ? 'od-badge' : 'od-badgeMuted'}>{loginLabel}</span>
            </div>
          </div>
          {state.controlKeyWarning ? <p className="od-rowError">{t('controlKeyWarn')}</p> : null}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('modelsSection')}
        badge={<span className="od-badgeMuted">{catalogLabel}</span>}
        defaultOpen
      >
        <div className="od-rows">
          <div className="od-row od-fieldRow">
            <RowText title={t('visibleModels')} desc={t('visibleModelsHint')} />
            <ModelAllowlist
              t={t}
              models={state.models}
              selected={state.visibleModels}
              allVisible={state.allVisible}
              disabled={disabled}
              onToggle={(id) => props.toggleModel(id)}
              onShowAll={() => props.showAllModels()}
            />
          </div>
          <FieldRow
            t={t}
            label={t('contextWindow')}
            hint={t('contextWindowHint')}
            draft={state.fields.contextWindow}
            disabled={disabled}
            onChange={(text) => props.editContextWindow(text)}
          />
          <SettingsField
            label={t('contextOverrides')}
            summary={state.contextOverrides.length === 0 ? undefined : `${overrideCount}/${state.contextOverrides.length}`}
            defaultOpen={false}
          >
            <ContextOverrideEditor
              t={t}
              rows={state.contextOverrides}
              choices={overrideChoices(state)}
              disabled={disabled}
              onChange={(model, text) => props.editContextOverride(model, text)}
            />
          </SettingsField>
          <FieldRow
            t={t}
            label={t('maxOutputTokens')}
            hint={t('maxOutputTokensHint')}
            draft={state.fields.maxOutputTokens}
            disabled={disabled}
            onChange={(text) => props.edit('maxOutputTokens', text)}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('displaySection')} desc={t('displaySectionDesc')} defaultOpen>
        <div className="od-rows">
          <label className="od-row od-fieldRow">
            <RowText title={t('language')} />
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
          <label className="od-row od-fieldRow">
            <RowText title={t('sidebarQuota')} desc={t('sidebarQuotaHint')} />
            <span className="od-rowControl">
              <input
                className="od-switch"
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
      </SettingsGroup>

      <SettingsGroup title={t('advanced')} desc={t('advancedDesc')}>
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
          <div className="od-row od-fieldRow">
            <RowText title={t('diagnostics')} desc={t('diagnosticsHint')} />
            <div className="od-rowControl">
              <button className="od-linkButton" type="button" onClick={copyDiagnostics}>
                {t('copyDiagnostics')}
              </button>
            </div>
          </div>
        </div>
      </SettingsGroup>

      {state.dirty ? (
        <div className="od-saveBarDock">
          <div className="od-saveBar od-saveBarShown">
            <p className="od-saveBarText">{state.notice === undefined ? t('unsaved') : noticeText(t, state.notice.key)}</p>
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
