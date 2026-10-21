/**
 * Browser-side controller for the Open Design settings page and Models-page
 * card (ticket 08).
 *
 * It owns the staged draft → one batch `mutate` fenced by the Host revision →
 * a separately confirmed credential write, never the other order. Config
 * fields and the key live on different wires on purpose: the key can only ever
 * reach this plugin's own credential reference, while the settings document
 * receives ordinary fields. A conflict keeps every draft, including the key
 * draft, and writes no credential.
 *
 * React-free so tests drive the same state the page renders. The controller
 * reads Host facts through three injected seams: the namespace scope
 * (`remote.settings`), the credentials namespace, and the `opendesign/models`
 * report (catalog provenance + credential provenance).
 *
 * @module dsh-opendesign-provider/client/settings
 */

import { createSnapshotStore, type SnapshotStore } from './snapshot-store.ts'
import type { SettingsMutationResult, SettingsPathOp, SettingsScope, SettingsScopeSnapshot } from './settings-scope.ts'
import { DEFAULT_API_KEY_ENV } from '../identity.ts'
import {
  CONTEXT_WINDOW_MAX,
  CONTEXT_WINDOW_MIN,
  isValidContextWindow,
} from '../context-window.ts'
import { MAX_OUTPUT_TOKEN_LIMIT, OMIT_OUTPUT_TOKENS } from '../output-budget.ts'
import { MAX_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS } from '../timeout-limits.ts'
import type {
  ModelsReportCredential,
  ModelsReportEntry,
  OpenDesignModelsReport,
} from '../models-wire.ts'
import type { CredentialSource } from '../credentials.ts'

/** Host transport retry ceiling, mirrored from the Config schema. */
const MAX_TRANSPORT_RETRIES = 20

/** The editable text fields the page stages. */
export type SettingsField =
  | 'apiBase'
  | 'modelsCachePath'
  | 'requestTimeoutMs'
  | 'streamIdleTimeoutMs'
  | 'transportMaxRetries'
  | 'contextWindow'
  | 'maxOutputTokens'

/** Why a staged draft fails validation. */
export type InvalidReason = 'format' | 'tooSmall' | 'tooLarge'

/** One staged field's live draft, independent of what the Host currently holds. */
export interface FieldDraft {
  text: string
  invalid: boolean
  reason?: InvalidReason
  /** Whether the reader touched this field in the current draft generation. */
  changed: boolean
}

/** One per-model context-window override row. */
export interface ContextOverrideDraft {
  model: string
  text: string
  invalid: boolean
  reason?: InvalidReason
}

/** One catalog row as the visible-model list needs it. */
export interface SettingsModelRow {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  cost: ModelsReportEntry['cost']
  capability: ModelsReportEntry['capability']
  calibrated: boolean
  visible: boolean
}

/** Semantic notice keys; only the locale dictionary owns their text. */
export type SettingsNoticeKey =
  | 'saved'
  | 'conflict'
  | 'failed'
  | 'invalid'
  | 'noChanges'
  | 'credentialFailed'

/** The page's complete render state. */
export interface SettingsPageState {
  status: 'loading' | 'ready' | 'unavailable'
  writable: boolean
  apiKeyConfigured: boolean
  apiKeyKnown: boolean
  apiKeyWritable: boolean
  apiKeyReference: string
  credentialSource: CredentialSource | 'unknown'
  loginStatus: 'ok' | 'missing' | 'malformed' | 'unreadable' | 'unknown'
  hasControlKey: boolean
  /** True when the CLI login state is readable but cannot query quota. */
  controlKeyWarning: boolean
  catalogSource: 'live' | 'static' | 'unknown'
  catalogApiBase?: string
  catalogReason?: string
  catalogCached: boolean
  models: SettingsModelRow[]
  visibleModels: string[]
  contextOverrides: ContextOverrideDraft[]
  fields: Record<SettingsField, FieldDraft>
  /** Host-side language for text surfaces; the web page follows the browser. */
  language: string
  /** Stored `showSidebarQuota` — the fact the quota panel gates its render on. */
  showSidebarQuota: boolean
  /** The Display checkbox's staged value (may differ from the stored fact until saved). */
  showSidebarQuotaDraft: boolean
  keyDraft: string
  keyAction: 'none' | 'set' | 'clear'
  dirty: boolean
  saving: boolean
  notice?: { kind: 'info' | 'success' | 'error'; key: SettingsNoticeKey } | undefined
}

/** One credential reference's value-free facts. */
export interface CredentialInfoLike {
  configured: boolean
  writable: boolean
}

/** The credentials wire face this controller needs. */
export interface CredentialsApi {
  describe(refs: string[]): Promise<{ ok: boolean; value?: Record<string, CredentialInfoLike>; error?: { message?: string } }>
  set(ref: string, value: string): Promise<{ ok: boolean; error?: { message?: string } }>
  unset(ref: string): Promise<{ ok: boolean; error?: { message?: string } }>
}

/** The models report wire face. */
export interface ModelsApi {
  models(): Promise<{ ok: boolean; value?: OpenDesignModelsReport; error?: { message?: string } }>
}

/** The only scope slice this module uses (see `./settings-scope.ts`). */
export interface SettingsScopeLike extends SettingsScope<Record<string, unknown>> {
  mutate(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<SettingsMutationResult>
}

/** What one save confirmed, so the caller can refresh dependent surfaces. */
export interface SettingsSaveOutcome {
  config: 'none' | 'confirmed' | 'conflict' | 'failed'
  credential: 'none' | 'confirmed' | 'failed'
}

/** Initial empty drafts before the first scope read lands. */
const EMPTY_FIELD = (): FieldDraft => ({ text: '', invalid: false, changed: false })

/** Build the seven-field draft table with fresh objects. */
function emptyFields(): Record<SettingsField, FieldDraft> {
  return {
    apiBase: EMPTY_FIELD(),
    modelsCachePath: EMPTY_FIELD(),
    requestTimeoutMs: EMPTY_FIELD(),
    streamIdleTimeoutMs: EMPTY_FIELD(),
    transportMaxRetries: EMPTY_FIELD(),
    contextWindow: EMPTY_FIELD(),
    maxOutputTokens: EMPTY_FIELD(),
  }
}

/** Read a finite number, tolerating a trailing/leading blank but nothing else. */
function numberText(text: string): number | undefined {
  if (text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

/** Validate one whole-number field inside an inclusive range. */
function integerDraft(text: string, min: number, max: number): { invalid: boolean; reason?: InvalidReason; value?: number } {
  if (text.trim() === '') return { invalid: false }
  const value = Number(text)
  if (!Number.isSafeInteger(value)) return { invalid: true, reason: 'format' }
  if (value < min) return { invalid: true, reason: 'tooSmall' }
  if (value > max) return { invalid: true, reason: 'tooLarge' }
  return { invalid: false, value }
}

/** Validate one timeout draft written in seconds. */
function timeoutDraft(text: string): { invalid: boolean; reason?: InvalidReason; valueMs?: number } {
  const value = numberText(text)
  if (value === undefined) return { invalid: true, reason: 'format' }
  if (value < MIN_TIMEOUT_SECONDS) return { invalid: true, reason: 'tooSmall' }
  if (value > MAX_TIMEOUT_SECONDS) return { invalid: true, reason: 'tooLarge' }
  return { invalid: false, valueMs: Math.round(value * 1000) }
}

/** Draft text for a stored millisecond timeout. */
function secondsText(ms: unknown): string {
  return typeof ms === 'number' && Number.isFinite(ms) ? String(ms / 1000) : ''
}

/** Plain text of one stored field. */
function storedText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** The settings document's own api-key reference, or the plugin default. */
function referenceOf(value: Record<string, unknown> | undefined): string {
  const ref = value?.apiKeyEnv
  return typeof ref === 'string' && ref.trim() !== '' ? ref : DEFAULT_API_KEY_ENV
}

/** A pasted value's URL credentials never reach a copied diagnostic. */
function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return value
  }
}

/** Secret-shaped tokens are redacted even if a reader pasted one into a field. */
function redactSecrets(value: string): string {
  return value.replace(/\b(?:sk-[A-Za-z0-9_-]{4,}|vela_(?:ctrl|rt)_[A-Za-z0-9_-]{4,})\b/gu, '<redacted>')
}

/** The Models-page card's three render postures. */
export function cardMode(state: SettingsPageState): 'unavailable' | 'readonly' | 'ready' {
  if (state.status !== 'ready') return 'unavailable'
  return state.writable ? 'ready' : 'readonly'
}

/**
 * Which badge copy states where the resolved key comes from. A bare "已设置"
 * hid the difference between a pasted key, a credential reference and the CLI
 * login state; the settings page and the card share this decision so they
 * cannot disagree.
 */
export function apiKeyBadgeKey(
  state: SettingsPageState,
): 'apiKeySetLiteral' | 'apiKeySetReference' | 'apiKeySetCliLogin' | 'apiKeySet' | 'apiKeyUnset' | 'apiKeyUnknown' {
  if (!state.apiKeyKnown) return 'apiKeyUnknown'
  if (!state.apiKeyConfigured) return 'apiKeyUnset'
  if (state.credentialSource === 'literal') return 'apiKeySetLiteral'
  if (state.credentialSource === 'reference') return 'apiKeySetReference'
  if (state.credentialSource === 'cli-login') return 'apiKeySetCliLogin'
  return 'apiKeySet'
}

/** Context rows: every catalog model plus any override key the catalog omits. */
function contextRows(
  models: readonly ModelsReportEntry[],
  overrides: Readonly<Record<string, unknown>>,
): ContextOverrideDraft[] {
  const ids = new Set<string>(models.map((model) => model.id))
  for (const id of Object.keys(overrides)) ids.add(id)
  return [...ids].map((model) => {
    const raw = overrides[model]
    const text = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ''
    return { model, text, invalid: false }
  })
}

/** Empty defaults so every consumer sees the same shape before the first read. */
function initialPageState(): SettingsPageState {
  return {
    status: 'loading',
    writable: false,
    apiKeyConfigured: false,
    apiKeyKnown: false,
    apiKeyWritable: false,
    apiKeyReference: DEFAULT_API_KEY_ENV,
    credentialSource: 'unknown',
    loginStatus: 'unknown',
    hasControlKey: false,
    controlKeyWarning: false,
    catalogSource: 'unknown',
    catalogCached: false,
    models: [],
    visibleModels: [],
    contextOverrides: [],
    fields: emptyFields(),
    language: 'zh',
    showSidebarQuota: false,
    showSidebarQuotaDraft: false,
    keyDraft: '',
    keyAction: 'none',
    dirty: false,
    saving: false,
  }
}

/**
 * One settings-page controller. Constructing it starts the first credential
 * and catalog reads; `dispose()` stops the scope subscription.
 */
export class OpenDesignSettingsController {
  private readonly store: SnapshotStore<SettingsPageState>
  private readonly unsubscribeScope: () => void
  private readonly credentials: CredentialsApi | undefined
  private readonly models: ModelsApi | undefined
  private disposed = false
  private selected = new Set<string>()
  private modelsChanged = false
  private overridesChanged = false
  private languageChanged = false
  private sidebarQuotaChanged = false
  private overrides: Record<string, string> = {}
  private modelCatalog: readonly ModelsReportEntry[] = []
  private snapshot: SettingsScopeSnapshot<Record<string, unknown>>

  constructor(
    private readonly scope: SettingsScopeLike,
    credentials: CredentialsApi | undefined,
    models: ModelsApi | undefined,
  ) {
    this.credentials = credentials
    this.models = models
    this.snapshot = scope.getSnapshot()
    this.store = createSnapshotStore<SettingsPageState>({
      ...initialPageState(),
      status: this.snapshot.status,
      writable: this.snapshot.writable,
    })
    this.resetDrafts()
    this.unsubscribeScope = this.scope.subscribe(() => { this.deriveFromScope() })
    void this.refreshCredentials()
    void this.refreshModels()
  }

  /** The current render state. */
  state(): SettingsPageState {
    return this.store.getSnapshot()
  }

  /** Subscribe to render-state changes. */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /** Read the Host namespace again (mount after boot, external edits). */
  refresh(): void {
    this.snapshot = this.scope.getSnapshot()
    this.deriveFromScope()
    void this.refreshCredentials()
    void this.refreshModels()
  }

  /** Stage one text field. */
  edit(field: SettingsField, text: string): void {
    if (this.disposed) return
    const state = this.state()
    const draft = this.validateField(field, { ...state.fields[field], text, changed: true })
    this.publish({
      ...state,
      fields: { ...state.fields, [field]: draft },
      dirty: true,
      notice: undefined,
    })
  }

  /** Restore one field to the Host's saved value. */
  resetField(field: SettingsField): void {
    if (this.disposed) return
    const state = this.state()
    this.publish({
      ...state,
      fields: { ...state.fields, [field]: this.storedDraft(field) },
      dirty: this.computeDirty(),
      notice: undefined,
    })
  }

  /** Flip one model's visibility. */
  toggleModel(id: string): void {
    if (this.disposed) return
    const state = this.state()
    const next = new Set(this.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    this.selected = next
    this.modelsChanged = true
    this.publish(this.withModels(state))
  }

  /** Stage the global context-window value. */
  editContextWindow(text: string): void {
    this.edit('contextWindow', text)
  }

  /** Stage one per-model context-window override; an empty value removes it. */
  editContextOverride(model: string, text: string): void {
    if (this.disposed) return
    this.overrides = { ...this.overrides, [model]: text }
    this.overridesChanged = true
    const state = this.state()
    this.publish(this.withModels(state))
  }

  /** Stage the host-side language (`zh` / `en`). */
  setLanguage(language: string): void {
    if (this.disposed) return
    if (language !== 'zh' && language !== 'en') return
    this.languageChanged = true
    this.publish({ ...this.state(), language, dirty: true, notice: undefined })
  }

  /** Stage the Display section's sidebar-quota switch (one batch with every other field). */
  setShowSidebarQuota(value: boolean): void {
    if (this.disposed) return
    this.sidebarQuotaChanged = true
    this.publish({ ...this.state(), showSidebarQuotaDraft: value, dirty: true, notice: undefined })
  }

  /** Stage the key field (write-only; the value is never rendered back). */
  setKey(value: string): void {
    if (this.disposed) return
    this.publish({ ...this.state(), keyDraft: value, keyAction: 'set', dirty: true, notice: undefined })
  }

  /** Stage a clear of this plugin's credential reference. */
  clearKey(): void {
    if (this.disposed) return
    this.publish({ ...this.state(), keyDraft: '', keyAction: 'clear', dirty: true, notice: undefined })
  }

  /** Drop every draft, including the key draft. */
  discard(): void {
    if (this.disposed) return
    this.resetDrafts()
    this.publish({ ...this.state(), notice: { kind: 'info', key: 'noChanges' } })
  }

  /**
   * Validate, then commit one batch to the namespace and (only after it is
   * accepted) the key to this plugin's credential reference. A conflict keeps
   * the drafts; a failed credential keeps the key draft.
   */
  async save(): Promise<SettingsSaveOutcome> {
    const state = this.state()
    if (this.disposed || state.saving) return { config: 'none', credential: 'none' }
    if (state.status !== 'ready' || !state.writable) {
      this.publish({ ...state, notice: { kind: 'error', key: 'failed' } })
      return { config: 'none', credential: 'none' }
    }
    const validated = this.validateAll(state)
    if (!validated.valid) {
      this.publish({ ...validated.state, notice: { kind: 'error', key: 'invalid' } })
      return { config: 'none', credential: 'none' }
    }
    const ops = this.buildOps(validated.state)
    const keyAction = state.keyAction
    const keyDraft = state.keyDraft
    const hasCredential = keyAction === 'clear' || (keyAction === 'set' && keyDraft.trim() !== '')
    if (ops.length === 0 && !hasCredential) {
      this.publish({ ...validated.state, notice: { kind: 'info', key: 'noChanges' } })
      return { config: 'none', credential: 'none' }
    }

    this.publish({ ...validated.state, saving: true })
    let config: SettingsSaveOutcome['config'] = 'none'
    let next = this.state()
    if (ops.length > 0) {
      const result = await this.scope.mutate(ops, this.snapshot.revision)
      if (result === 'conflict') {
        this.publish({ ...this.state(), saving: false, notice: { kind: 'error', key: 'conflict' } })
        return { config: 'conflict', credential: 'none' }
      }
      if (result !== 'accepted') {
        this.publish({ ...this.state(), saving: false, notice: { kind: 'error', key: 'failed' } })
        return { config: 'failed', credential: 'none' }
      }
      config = 'confirmed'
      this.snapshot = this.scope.getSnapshot()
      this.resetDrafts()
      if (hasCredential) {
        // The config batch is confirmed, but the key is a second wire: keep
        // the draft alive until that write itself is confirmed.
        this.publish({ ...this.state(), keyDraft, keyAction, dirty: true })
      }
      next = this.state()
    }

    let credential: SettingsSaveOutcome['credential'] = 'none'
    if (hasCredential) {
      const reference = referenceOf(this.snapshot.value)
      const api = this.credentials
      if (api === undefined) {
        this.publish({ ...next, saving: false, notice: { kind: 'error', key: 'credentialFailed' } })
        return { config, credential: 'failed' }
      }
      const answered = keyAction === 'clear'
        ? await api.unset(reference)
        : await api.set(reference, keyDraft.trim())
      if (!answered.ok) {
        this.publish({ ...this.state(), saving: false, notice: { kind: 'error', key: 'credentialFailed' } })
        return { config, credential: 'failed' }
      }
      credential = 'confirmed'
      next = { ...this.state(), keyDraft: '', keyAction: 'none', apiKeyConfigured: keyAction === 'set', apiKeyKnown: true }
      this.resetDrafts()
    }

    this.publish({
      ...this.derivedDrafts(),
      ...next,
      saving: false,
      dirty: false,
      notice: { kind: 'success', key: 'saved' },
    })
    return { config, credential }
  }

  /** The copyable, redacted diagnostic; drafts and keys stay out. */
  diagnosticText(): string {
    const state = this.state()
    const base = redactUrl(redactSecrets(state.fields.apiBase.text || state.catalogApiBase || ''))
    return [
      'Open Design 诊断',
      `- 凭据引用：${state.apiKeyReference}`,
      `- API Key：${state.apiKeyConfigured ? '已设置' : state.apiKeyKnown ? '未设置' : '未知'}`,
      `- 凭据来源：${state.credentialSource}`,
      `- 网关地址：${base || '(默认)'}`,
      `- CLI 登录态：${state.loginStatus}`,
      `- controlKey：${state.hasControlKey ? '可用' : '不可用'}`,
      `- 模型目录：${state.catalogSource}${state.catalogReason === undefined ? '' : `（回落：${state.catalogReason}）`}`,
      `- 可见模型：${state.visibleModels.length === 0 ? '全部' : state.visibleModels.join(', ')}`,
    ].join('\n')
  }

  /** Read credential presence for the document's reference. */
  async refreshCredentials(): Promise<void> {
    if (this.disposed) return
    const reference = referenceOf(this.snapshot.value)
    const api = this.credentials
    if (api === undefined) {
      this.publish({ ...this.state(), apiKeyKnown: false, apiKeyWritable: false })
      return
    }
    try {
      const response = await api.describe([reference])
      if (this.disposed) return
      // The document may have landed while this read was in flight; re-read
      // against the reference that is current NOW instead of publishing the
      // stale one.
      const currentReference = referenceOf(this.snapshot.value)
      if (currentReference !== reference) {
        await this.refreshCredentials()
        return
      }
      const info = response.ok ? response.value?.[reference] : undefined
      if (!response.ok || info === undefined) {
        this.publish({ ...this.state(), apiKeyKnown: false })
        return
      }
      this.publish({
        ...this.state(),
        apiKeyReference: reference,
        apiKeyKnown: true,
        apiKeyWritable: info.writable,
        apiKeyConfigured: this.state().apiKeyConfigured || info.configured,
      })
    } catch {
      if (!this.disposed) this.publish({ ...this.state(), apiKeyKnown: false })
    }
  }

  /** Read catalog provenance and the Host's credential-source facts. */
  async refreshModels(): Promise<void> {
    if (this.disposed) return
    const api = this.models
    if (api === undefined) {
      this.publish({ ...this.state(), catalogSource: 'unknown' })
      return
    }
    try {
      const response = await api.models()
      if (this.disposed) return
      if (!response.ok || response.value === undefined) {
        this.publish({ ...this.state(), catalogSource: 'unknown' })
        return
      }
      this.applyReport(response.value)
    } catch {
      if (!this.disposed) this.publish({ ...this.state(), catalogSource: 'unknown' })
    }
  }

  /** Stop the scope subscription; no further publishes happen. */
  dispose(): void {
    this.disposed = true
    this.unsubscribeScope()
  }

  private applyReport(report: OpenDesignModelsReport): void {
    const state = this.state()
    const credential: ModelsReportCredential = report.credential
    const catalog = report.catalog
    const next: SettingsPageState = {
      ...state,
      catalogSource: catalog.source,
      catalogCached: catalog.cached,
      ...(catalog.apiBase === '' ? {} : { catalogApiBase: catalog.apiBase }),
      ...(catalog.reason === undefined ? {} : { catalogReason: catalog.reason }),
      credentialSource: credential.source,
      loginStatus: credential.login.status,
      hasControlKey: credential.login.hasControlKey,
      controlKeyWarning: credential.login.status === 'ok' && !credential.login.hasControlKey,
      apiKeyConfigured: credential.configured,
      apiKeyKnown: state.apiKeyKnown || credential.configured,
    }
    this.modelCatalog = catalog.models
    this.publish({ ...this.withModels(next) })
  }

  /** Rebuild the model rows, visible selection and override rows from the report. */
  private withModels(
    state: SettingsPageState,
    models: readonly ModelsReportEntry[] = this.modelCatalog,
  ): SettingsPageState {
    const rows = models
    const allowlist = Array.isArray(this.snapshot.value?.visibleModels)
      ? (this.snapshot.value.visibleModels as string[]).filter((id) => typeof id === 'string')
      : []
    if (!this.modelsChanged && this.selected.size === 0) {
      this.selected = new Set(allowlist.length === 0 ? rows.map((row) => row.id) : allowlist)
    }
    const visible = new Set(this.selected)
    const rowsById = new Map(rows.map((row) => [row.id, row]))
    const visibleModels = [...visible].filter((id) => rows.length === 0 || rowsById.has(id))
    const overrideRows = this.contextRowsFor(rows)
    return {
      ...state,
      models: rows.map((row) => ({
        id: row.id,
        name: row.name,
        contextWindow: row.contextWindow,
        maxTokens: row.maxTokens,
        cost: row.cost,
        capability: row.capability,
        calibrated: row.calibrated,
        visible: visible.has(row.id),
      })),
      visibleModels,
      contextOverrides: overrideRows,
    }
  }

  private contextRowsFor(models: readonly ModelsReportEntry[]): ContextOverrideDraft[] {
    const stored = this.snapshot.value?.contextWindowOverrides
    const overrides: Record<string, unknown> = {
      ...(stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : {}),
    }
    const rows = contextRows(models, overrides)
    for (const row of rows) {
      if (Object.hasOwn(this.overrides, row.model)) row.text = this.overrides[row.model]!
    }
    for (const [model, text] of Object.entries(this.overrides)) {
      if (!rows.some((row) => row.model === model)) rows.push({ model, text, invalid: false })
    }
    return rows.map((row) => {
      const checked = this.validateContextOverride(row.text)
      return { ...row, invalid: checked.invalid, ...(checked.reason === undefined ? {} : { reason: checked.reason }) }
    })
  }

  /** The initial draft table from the scope document. */
  private resetDrafts(): void {
    const value = this.snapshot.value ?? {}
    this.overrides = Object.fromEntries(
      Object.entries(value.contextWindowOverrides !== null && typeof value.contextWindowOverrides === 'object' && !Array.isArray(value.contextWindowOverrides)
        ? value.contextWindowOverrides as Record<string, unknown>
        : {})
        .filter(([, override]) => typeof override === 'number' && Number.isFinite(override))
        .map(([id, override]) => [id, String(override)]),
    )
    this.selected = new Set(
      Array.isArray(value.visibleModels)
        ? (value.visibleModels as string[]).filter((id) => typeof id === 'string')
        : [],
    )
    this.modelsChanged = false
    this.overridesChanged = false
    this.languageChanged = false
    this.sidebarQuotaChanged = false
    this.publish({
      ...this.derivedDrafts(),
      keyDraft: '',
      keyAction: 'none',
      dirty: false,
    })
  }

  /** The field table and model rows rebuilt from the Host document. */
  private derivedDrafts(): SettingsPageState {
    const value = this.snapshot.value ?? {}
    const fields = emptyFields()
    fields.apiBase.text = storedText(value.apiBase)
    fields.modelsCachePath.text = storedText(value.modelsCachePath)
    fields.requestTimeoutMs.text = secondsText(value.requestTimeoutMs)
    fields.streamIdleTimeoutMs.text = secondsText(value.streamIdleTimeoutMs)
    fields.transportMaxRetries.text = storedText(value.transportMaxRetries)
    fields.contextWindow.text = storedText(value.contextWindow)
    fields.maxOutputTokens.text = storedText(value.maxOutputTokens)
    const page = this.state()
    const withRows = this.withModels({
      ...page,
      status: this.snapshot.status === 'ready' ? 'ready' : this.snapshot.status === 'unavailable' ? 'unavailable' : 'loading',
      writable: this.snapshot.writable,
      language: typeof value.lang === 'string' ? value.lang : 'zh',
      showSidebarQuota: value.showSidebarQuota === true,
      showSidebarQuotaDraft: this.sidebarQuotaChanged
        ? page.showSidebarQuotaDraft
        : value.showSidebarQuota === true,
      apiKeyReference: referenceOf(value),
      fields: Object.fromEntries(
        Object.entries(fields).map(([field, draft]) => [field, this.validateField(field as SettingsField, draft)]),
      ) as Record<SettingsField, FieldDraft>,
    })
    return withRows
  }

  private deriveFromScope(): void {
    if (this.disposed) return
    this.snapshot = this.scope.getSnapshot()
    const ready = this.snapshot.status === 'ready'
    const state = this.state()
    const next: SettingsPageState = {
      ...state,
      status: this.snapshot.status,
      writable: this.snapshot.writable,
      apiKeyReference: referenceOf(this.snapshot.value),
    }
    if (!ready) {
      this.publish({ ...next, status: 'unavailable' })
      return
    }
    if (this.savingOrDirty()) {
      this.publish({ ...next, status: 'ready' })
      return
    }
    this.resetDrafts()
  }

  private savingOrDirty(): boolean {
    const state = this.state()
    return state.saving || state.dirty
  }

  private computeDirty(): boolean {
    return this.state().dirty
  }

  private storedDraft(field: SettingsField): FieldDraft {
    const value = this.snapshot.value ?? {}
    const base = this.validateField(field, { ...EMPTY_FIELD(), text: this.storedTextFor(field, value) })
    return { ...base, changed: false }
  }

  private storedTextFor(field: SettingsField, value: Record<string, unknown>): string {
    switch (field) {
      case 'requestTimeoutMs': return secondsText(value.requestTimeoutMs)
      case 'streamIdleTimeoutMs': return secondsText(value.streamIdleTimeoutMs)
      default: return storedText(value[field])
    }
  }

  private validateField(field: SettingsField, draft: FieldDraft): FieldDraft {
    switch (field) {
      case 'apiBase': {
        if (draft.text.trim() === '') return { ...draft, invalid: false }
        try {
          const url = new URL(draft.text)
          if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') {
            return { ...draft, invalid: true, reason: 'format' }
          }
          return { ...draft, invalid: false }
        } catch {
          return { ...draft, invalid: true, reason: 'format' }
        }
      }
      case 'modelsCachePath':
        return { ...draft, invalid: false }
      case 'requestTimeoutMs':
      case 'streamIdleTimeoutMs': {
        // Blank means "inherit the composition value", not an invalid draft.
        if (draft.text.trim() === '') return { ...draft, invalid: false }
        const checked = timeoutDraft(draft.text)
        return { ...draft, invalid: checked.invalid, ...(checked.reason === undefined ? {} : { reason: checked.reason }) }
      }
      case 'transportMaxRetries': {
        const checked = integerDraft(draft.text, 0, MAX_TRANSPORT_RETRIES)
        return { ...draft, invalid: checked.invalid, ...(checked.reason === undefined ? {} : { reason: checked.reason }) }
      }
      case 'contextWindow': {
        if (draft.text.trim() === '') return { ...draft, invalid: false }
        const checked = integerDraft(draft.text, CONTEXT_WINDOW_MIN, CONTEXT_WINDOW_MAX)
        return { ...draft, invalid: checked.invalid, ...(checked.reason === undefined ? {} : { reason: checked.reason }) }
      }
      case 'maxOutputTokens': {
        if (draft.text.trim() === '') return { ...draft, invalid: false }
        const checked = integerDraft(draft.text, OMIT_OUTPUT_TOKENS, MAX_OUTPUT_TOKEN_LIMIT)
        return { ...draft, invalid: checked.invalid, ...(checked.reason === undefined ? {} : { reason: checked.reason }) }
      }
    }
  }

  private validateContextOverride(text: string): { invalid: boolean; reason?: InvalidReason } {
    if (text.trim() === '') return { invalid: false }
    const checked = integerDraft(text, CONTEXT_WINDOW_MIN, CONTEXT_WINDOW_MAX)
    return { invalid: checked.invalid, ...(checked.reason === undefined ? {} : { reason: checked.reason }) }
  }

  private validateAll(state: SettingsPageState): { valid: boolean; state: SettingsPageState } {
    const fields = { ...state.fields }
    let valid = !state.saving
    for (const field of Object.keys(fields) as SettingsField[]) {
      const checked = this.validateField(field, fields[field]!)
      fields[field] = checked
      if (checked.invalid) valid = false
    }
    const contextOverrides = state.contextOverrides.map((row) => {
      const checked = this.validateContextOverride(row.text)
      if (checked.invalid) valid = false
      return { ...row, invalid: checked.invalid, ...(checked.reason === undefined ? {} : { reason: checked.reason }) }
    })
    return { valid, state: { ...state, fields, contextOverrides } }
  }

  /** Only changed fields become ops; empty means "inherit the layer below". */
  private buildOps(state: SettingsPageState): SettingsPathOp[] {
    const ops: SettingsPathOp[] = []
    for (const field of Object.keys(state.fields) as SettingsField[]) {
      const draft = state.fields[field]
      if (!draft.changed) continue
      const value = this.opValue(field, draft.text)
      ops.push(value === undefined ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value })
    }
    if (this.modelsChanged) {
      ops.push({ op: 'set', path: ['visibleModels'], value: [...state.visibleModels] })
    }
    if (this.languageChanged) {
      ops.push({ op: 'set', path: ['lang'], value: state.language })
    }
    if (this.sidebarQuotaChanged) {
      ops.push({ op: 'set', path: ['showSidebarQuota'], value: state.showSidebarQuotaDraft })
    }
    if (this.overridesChanged) {
      const overrides: Record<string, number> = {}
      for (const row of state.contextOverrides) {
        if (row.text.trim() === '') continue
        const value = Number(row.text)
        if (isValidContextWindow(value)) overrides[row.model] = value
      }
      ops.push(Object.keys(overrides).length === 0
        ? { op: 'unset', path: ['contextWindowOverrides'] }
        : { op: 'set', path: ['contextWindowOverrides'], value: overrides })
    }
    return ops
  }

  private opValue(field: SettingsField, text: string): string | number | undefined {
    switch (field) {
      case 'apiBase':
      case 'modelsCachePath':
        return text.trim() === '' ? undefined : text.trim()
      case 'requestTimeoutMs':
      case 'streamIdleTimeoutMs': {
        const checked = timeoutDraft(text)
        return checked.valueMs
      }
      case 'transportMaxRetries':
      case 'contextWindow':
      case 'maxOutputTokens': {
        if (text.trim() === '') return undefined
        const value = Number(text)
        return Number.isFinite(value) ? value : undefined
      }
    }
  }

  private publish(state: SettingsPageState): void {
    if (this.disposed) return
    this.store.set({
      ...state,
      dirty: state.dirty || this.stateDirty(state),
    })
  }

  /** Any staged change counts as dirty, not just text fields. */
  private stateDirty(state: SettingsPageState): boolean {
    if (state.keyAction !== 'none') return true
    if (state.keyDraft !== '') return true
    if (this.modelsChanged || this.overridesChanged || this.languageChanged || this.sidebarQuotaChanged) return true
    return Object.values(state.fields).some((draft) => draft.changed)
  }
}
