/**
 * Browser half of the dsh-opendesign-provider bundle.
 *
 * Registers two surfaces: the Open Design settings page (`settings.section`,
 * id `opendesign`) and the Models-page provider card
 * (`settings.models.provider-card`, key `llm-opendesign`). Both share one
 * controller over `remote.settings` (this plugin's own namespace) and the
 * `opendesign/models` + `opendesign/usage` Remotes. No surface receives a key
 * value and none can render a monetary amount.
 *
 * The `opendesign` namespace contribution is mounted once here. A profile
 * whose Host predates it leaves the card and page in their unknown-catalog
 * state, and one with no settings namespace leaves them read-only — the bundle
 * never gates registration on a service a profile may not mount.
 *
 * @module dsh-opendesign-provider/client
 */

import type { Context } from '@deepseek-ai/cordis'

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

import {
  MODEL_CARD_KEY,
  NS,
  PANEL_ID,
  SETTINGS_LOCALE_NS,
  SETTINGS_SECTION_ID,
} from '../identity.ts'
import { MODELS_REMOTE_CONTRIBUTION, type OpenDesignModelsReport } from '../models-wire.ts'
import { QUOTA_REMOTE_CONTRIBUTION } from '../quota-wire.ts'
import type { QuotaSnapshot } from '../control-plane.ts'
import type { SettingsRemoteNamespace, SettingsScopeContext } from './settings-scope.ts'
import { createSettingsScope } from './settings-scope.ts'
import { cardMode, OpenDesignSettingsController, type CredentialsApi, type ModelsApi, type SettingsPageState } from './settings.ts'
import { OpenDesignSettingsPage, type SettingsPageInjected } from './section.tsx'
import { OpenDesignProviderCard, type OpenDesignProviderCardProps } from './card.tsx'
import { PAGE_CSS, PAGE_CSS_ID } from './page-styles.ts'
import { PANEL_CSS, PANEL_CSS_ID } from './panel-styles.ts'
import { en, zh } from './locales.ts'
import { EN as PANEL_EN, PANEL_LOCALE_NS, ZH as PANEL_ZH } from './panel-locales.ts'
import {
  OpenDesignQuotaPanelController,
  type QuotaPanelInjected,
  type QuotaPanelLoadResult,
  type QuotaPanelState,
} from './panel.ts'
import { OpenDesignQuotaCard, OpenDesignQuotaDashboard } from './panel-ui.tsx'
import type { QuotaCardProps, QuotaDashboardProps } from './panel-slots.ts'
import type { SnapshotStore } from './snapshot-store.ts'

/** Install one stylesheet by id and return a disposer for its owning effect. */
function injectCss(id: string, css: string): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = '@mars-sea/dsh-opendesign-provider'
  tag.dataset.pluginCss = id
  tag.textContent = css
  document.head.appendChild(tag)
  return () => tag.remove()
}

/** One Remote answer envelope. */
type Envelope<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } | undefined }

/** The `remote.opendesign` namespace slice this bundle calls. */
interface ModelsRemoteNamespace {
  models?: () => Promise<Envelope<OpenDesignModelsReport>>
  usage?: () => Promise<Envelope<QuotaSnapshot>>
}

/** The mount face the Remote service exposes (the Gateway's client side). */
interface RemoteMountFace {
  $mount(contribution: { package: string; descriptors: readonly unknown[] }): Promise<() => Promise<void>>
}

/**
 * The one client-face contribution: every Host descriptor lives under the same
 * package, so they mount together — the Gateway merges the `opendesign`
 * namespace once, and no half can land without the others.
 */
const CLIENT_REMOTE_CONTRIBUTION = {
  package: MODELS_REMOTE_CONTRIBUTION.package,
  descriptors: [
    ...MODELS_REMOTE_CONTRIBUTION.descriptors,
    ...QUOTA_REMOTE_CONTRIBUTION.descriptors,
  ],
}

/** Client plugin body. */
export function apply(ctx: Context): void {
  const removeCss = injectCss(PAGE_CSS_ID, PAGE_CSS)
  ctx.effect(() => removeCss, 'dsh-opendesign-provider: page styles')
  ctx.effect(
    () => ctx.locale.register(SETTINGS_LOCALE_NS, { zh, en }),
    'dsh-opendesign-provider: page copy',
  )
  ctx.effect(
    () => ctx.locale.register(PANEL_LOCALE_NS, { zh: PANEL_ZH, en: PANEL_EN }),
    'dsh-opendesign-provider: panel copy',
  )
  const removePanelCss = injectCss(PANEL_CSS_ID, PANEL_CSS)
  ctx.effect(() => removePanelCss, 'dsh-opendesign-provider: panel styles')

  // The namespace object must be captured from an inject-scoped context, never
  // read off `ctx.remote` (a nested service read without inject throws).
  let settingsNamespace: SettingsRemoteNamespace | undefined
  let credentialsNamespace: CredentialsApi | undefined
  let modelsNamespace: ModelsRemoteNamespace | undefined

  const scope = createSettingsScope<Record<string, unknown>>(
    ctx as unknown as SettingsScopeContext,
    NS,
    () => settingsNamespace,
  )
  ctx.effect(() => () => { void scope.dispose() }, 'dsh-opendesign-provider: settings scope')

  // Structural proxies keep the controller constructed even when a namespace
  // mounts later (or never): the surfaces degrade instead of disappearing.
  const credentials: CredentialsApi = {
    async describe(refs) {
      return credentialsNamespace?.describe(refs) ?? { ok: false, error: { message: 'credentials remote is not mounted' } }
    },
    async set(ref, value) {
      return credentialsNamespace?.set(ref, value) ?? { ok: false, error: { message: 'credentials remote is not mounted' } }
    },
    async unset(ref) {
      return credentialsNamespace?.unset(ref) ?? { ok: false, error: { message: 'credentials remote is not mounted' } }
    },
  }
  const models: ModelsApi = {
    async models() {
      const answer = await modelsNamespace?.models?.()
      if (answer !== undefined) return answer.ok ? { ok: true, value: answer.value } : { ok: false }
      return { ok: false, error: { message: 'opendesign/models remote is not mounted' } }
    },
  }
  const loadQuota = async (): Promise<QuotaPanelLoadResult> => {
    const usage = modelsNamespace?.usage
    if (usage === undefined) return { ok: false, error: { message: 'opendesign/usage remote is not mounted' } }
    return usage()
  }

  const controller = new OpenDesignSettingsController(scope, credentials, models)
  ctx.effect(() => () => controller.dispose(), 'dsh-opendesign-provider: settings controller')

  // The card and the page read the same controller; this adapter is the
  // observable face both React entries consume.
  const settingsStore: Pick<SnapshotStore<SettingsPageState>, 'getSnapshot' | 'subscribe'> = {
    getSnapshot: () => controller.state(),
    subscribe: (listener) => controller.subscribe(listener),
  }

  // One panel controller for both seats. `layout` is read reflectively at call
  // time: a profile whose client has no layout service keeps the card hidden
  // (the registration is gated on it below), and a layout that predates the
  // `selectPanel(null)` form falls back to the reserved conversation key.
  // The layout's selectPanel is a METHOD: calling a detached reference loses
  // `this` and throws inside its slot-registry check. Keep the call on the
  // service object and treat a missing/older `selectPanel` as "no navigation".
  const selectPanel = (panelId: string | null): void => {
    const layout = ctx.get('layout') as
      | { selectPanel?: (id: string | null) => void }
      | undefined
    if (typeof layout?.selectPanel !== 'function') return
    try {
      layout.selectPanel(panelId)
    } catch {
      if (panelId !== null) return
      try { layout.selectPanel('conversation') } catch { /* layout unavailable: no navigation */ }
    }
  }
  const panel = new OpenDesignQuotaPanelController({
    load: loadQuota,
    settings: settingsStore,
    selectPanel,
  })
  ctx.effect(() => () => panel.dispose(), 'dsh-opendesign-provider: quota panel controller')
  const panelStore: Pick<SnapshotStore<QuotaPanelState>, 'getSnapshot' | 'subscribe'> = {
    getSnapshot: () => panel.state(),
    subscribe: (listener) => panel.subscribe(listener),
  }
  const panelFace = (): QuotaPanelInjected => ({
    panelStore,
    panelState: () => panel.state(),
    panelOpen: () => panel.openPanel(),
    panelClose: () => panel.closePanel(),
    panelRefresh: () => { void panel.refresh(true) },
    panelLocale: () => (ctx.locale.getLocale().active === 'en' ? 'en' : 'zh'),
  })

  ctx.inject(['remote.settings'], (settingsCtx) => {
    settingsNamespace = (settingsCtx.remote as unknown as { settings: SettingsRemoteNamespace }).settings
    scope.refresh()
    settingsCtx.effect(() => () => { settingsNamespace = undefined }, 'dsh-opendesign-provider: settings namespace')
  })
  ctx.inject(['remote.credentials'], (credentialsCtx) => {
    credentialsNamespace = (credentialsCtx.remote as unknown as { credentials: CredentialsApi }).credentials
    void controller.refreshCredentials()
    credentialsCtx.effect(() => () => { credentialsNamespace = undefined }, 'dsh-opendesign-provider: credentials namespace')
  })

  const remote = ctx.remote as unknown as RemoteMountFace
  ctx.effect(() => {
    let cancelled = false
    let unmount: (() => Promise<void>) | undefined
    void remote.$mount(CLIENT_REMOTE_CONTRIBUTION).then((dispose) => {
      if (cancelled) {
        void dispose()
        return
      }
      unmount = dispose
      ctx.inject(['remote.opendesign'], (modelsCtx) => {
        const namespace = (modelsCtx.remote as unknown as { opendesign: ModelsRemoteNamespace }).opendesign
        modelsNamespace = namespace
        void controller.refreshModels()
        // The panel may have asked before the namespace landed (its first read
        // failed with "not mounted"); one forced read heals that, and it is a
        // no-op while the switch is off.
        void panel.refresh(true)
        modelsCtx.effect(() => () => {
          modelsNamespace = undefined
        }, 'dsh-opendesign-provider: models namespace')
      })
    }).catch((error: unknown) => {
      console.error('[dsh-opendesign-provider] could not mount opendesign remotes:', error)
    })
    return () => {
      cancelled = true
      void unmount?.()
    }
  }, 'dsh-opendesign-provider: models remote')

  const pageFace = (): SettingsPageInjected => ({
    settingsStore,
    state: () => controller.state(),
    cardMode: () => cardMode(controller.state()),
    edit: (field, text) => controller.edit(field, text),
    resetField: (field) => controller.resetField(field),
    toggleModel: (id) => controller.toggleModel(id),
    showAllModels: () => controller.showAllModels(),
    editContextWindow: (text) => controller.editContextWindow(text),
    editContextOverride: (model, text) => controller.editContextOverride(model, text),
    setLanguage: (language) => controller.setLanguage(language),
    setShowSidebarQuota: (value) => controller.setShowSidebarQuota(value),
    setKey: (value) => controller.setKey(value),
    clearKey: () => controller.clearKey(),
    save: () => controller.save(),
    discard: () => controller.discard(),
    diagnosticText: () => controller.diagnosticText(),
    refresh: () => controller.refresh(),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SETTINGS_SECTION_ID,
    order: 12,
    label: () => ctx.locale.bind(SETTINGS_LOCALE_NS)('nav'),
    locale: SETTINGS_LOCALE_NS,
    inject: pageFace,
  }, OpenDesignSettingsPage))

  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: MODEL_CARD_KEY,
    locale: SETTINGS_LOCALE_NS,
    inject: (): Omit<OpenDesignProviderCardProps, 't'> & Partial<{ t: never }> => pageFace(),
  }, OpenDesignProviderCard))

  // The dashboard cell always registers: a profile whose layout never declares
  // `main` simply renders no cell, and the card below is the only trigger.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: PANEL_LOCALE_NS,
    inject: (): Omit<QuotaDashboardProps, 't'> & Partial<{ t: never }> => panelFace(),
  }, OpenDesignQuotaDashboard))

  // The sidebar card is gated on the `layout` SERVICE, not on the slot: on a
  // profile without a layout the card can never open anything, so it must not
  // render at all. The registration stays a normal slot effect so a landed
  // settings save shows/hides the card live (the gate is the controller's
  // stored `showSidebarQuota`, never this registration).
  ctx.inject(['layout'], () => {
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: PANEL_ID,
      order: 1,
      locale: PANEL_LOCALE_NS,
      inject: (): Omit<QuotaCardProps, 't'> & Partial<{ t: never }> => panelFace(),
    }, OpenDesignQuotaCard))
  })
}

export const inject: readonly string[] = ['slots', 'locale', 'remote']
