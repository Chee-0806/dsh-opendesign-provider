/**
 * Browser half of the dsh-opendesign-provider bundle.
 *
 * Registers three surfaces: the Open Design settings page (`settings.section`,
 * id `opendesign`), the Models-page provider card
 * (`settings.models.provider-card`, key `llm-opendesign`) and the analytics
 * page (`settings.section`, id `opendesign-analytics`, ticket 12). The first
 * two share one controller over `remote.settings` (this plugin's own
 * namespace) and one `opendesign/models` Remote; the analytics page reads only
 * the aggregate `opendesign/analytics` Remote. No surface receives a key
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
  ANALYTICS_LOCALE_NS,
  ANALYTICS_SECTION_ID,
  MODEL_CARD_KEY,
  NS,
  SETTINGS_LOCALE_NS,
  SETTINGS_SECTION_ID,
} from '../identity.ts'
import { MODELS_REMOTE_CONTRIBUTION, type OpenDesignModelsReport } from '../models-wire.ts'
import {
  ANALYTICS_REMOTE_CONTRIBUTION,
  type AnalyticsQuery,
  type OpenDesignAnalyticsReport,
} from '../analytics-wire.ts'
import type { SettingsRemoteNamespace, SettingsScopeContext } from './settings-scope.ts'
import { createSettingsScope } from './settings-scope.ts'
import { cardMode, OpenDesignSettingsController, type CredentialsApi, type ModelsApi, type SettingsPageState } from './settings.ts'
import { OpenDesignSettingsPage, type SettingsPageInjected } from './section.tsx'
import { OpenDesignProviderCard, type OpenDesignProviderCardProps } from './card.tsx'
import { PAGE_CSS, PAGE_CSS_ID } from './page-styles.ts'
import { en, zh } from './locales.ts'
import { en as analyticsEn, zh as analyticsZh } from './analytics-locales.ts'
import { OpenDesignAnalyticsController } from './analytics.ts'
import { OpenDesignAnalyticsPage, type AnalyticsPageInjected } from './analytics-section.tsx'
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
  analytics?: (query: AnalyticsQuery) => Promise<Envelope<OpenDesignAnalyticsReport>>
}

/** The mount face the Remote service exposes (the Gateway's client side). */
interface RemoteMountFace {
  $mount(contribution: { package: string; descriptors: readonly unknown[] }): Promise<() => Promise<void>>
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
    () => ctx.locale.register(ANALYTICS_LOCALE_NS, { zh: analyticsZh, en: analyticsEn }),
    'dsh-opendesign-provider: analytics copy',
  )

  // The namespace object must be captured from an inject-scoped context, never
  // read off `ctx.remote` (a nested service read without inject throws).
  let settingsNamespace: SettingsRemoteNamespace | undefined
  let credentialsNamespace: CredentialsApi | undefined
  let modelsNamespace: ModelsRemoteNamespace | undefined
  let analyticsNamespace: ModelsRemoteNamespace | undefined

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

  const controller = new OpenDesignSettingsController(scope, credentials, models)
  ctx.effect(() => () => controller.dispose(), 'dsh-opendesign-provider: settings controller')

  // The analytics Remote is resolved lazily: before it mounts (or in a profile
  // without a Typert registry) the page reports `unavailable` instead of
  // claiming the history is empty. No read happens until the user asks.
  const analytics = new OpenDesignAnalyticsController(() => {
    const namespace = analyticsNamespace
    if (namespace?.analytics === undefined) return undefined
    return { analytics: (query) => namespace.analytics!(query) }
  })
  ctx.effect(() => () => analytics.dispose(), 'dsh-opendesign-provider: analytics controller')

  // The card and the page read the same controller; this adapter is the
  // observable face both React entries consume.
  const settingsStore: Pick<SnapshotStore<SettingsPageState>, 'getSnapshot' | 'subscribe'> = {
    getSnapshot: () => controller.state(),
    subscribe: (listener) => controller.subscribe(listener),
  }

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
    void remote.$mount({
      package: MODELS_REMOTE_CONTRIBUTION.package,
      descriptors: [...MODELS_REMOTE_CONTRIBUTION.descriptors, ...ANALYTICS_REMOTE_CONTRIBUTION.descriptors],
    }).then((dispose) => {
      if (cancelled) {
        void dispose()
        return
      }
      unmount = dispose
      ctx.inject(['remote.opendesign'], (modelsCtx) => {
        const namespace = (modelsCtx.remote as unknown as { opendesign: ModelsRemoteNamespace }).opendesign
        modelsNamespace = namespace
        analyticsNamespace = namespace
        void controller.refreshModels()
        modelsCtx.effect(() => () => {
          modelsNamespace = undefined
          analyticsNamespace = undefined
        }, 'dsh-opendesign-provider: models namespace')
      })
    }).catch((error: unknown) => {
      console.error('[dsh-opendesign-provider] could not mount opendesign/models:', error)
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
    editContextWindow: (text) => controller.editContextWindow(text),
    editContextOverride: (model, text) => controller.editContextOverride(model, text),
    setLanguage: (language) => controller.setLanguage(language),
    setKey: (value) => controller.setKey(value),
    clearKey: () => controller.clearKey(),
    save: () => controller.save(),
    discard: () => controller.discard(),
    diagnosticText: () => controller.diagnosticText(),
    refresh: () => controller.refresh(),
  })

  const analyticsFace = (): AnalyticsPageInjected => ({
    store: { getSnapshot: () => analytics.state(), subscribe: (listener) => analytics.subscribe(listener) },
    setMode: (mode) => analytics.setMode(mode),
    setRecentSessions: (text) => analytics.setRecentSessions(text),
    setRangeFrom: (text) => analytics.setRangeFrom(text),
    setRangeTo: (text) => analytics.setRangeTo(text),
    refresh: () => analytics.refresh(),
  })

  // Both pages share the one `settings.section` seat the engine declares, so
  // they register inside the same inject callback: asking the slot kit for the
  // same seat twice would depend on behaviour its contract does not promise.
  ctx.slots.inject('settings.section', () => [
    ctx.slots.register({
      name: 'settings.section',
      id: SETTINGS_SECTION_ID,
      order: 12,
      label: () => ctx.locale.bind(SETTINGS_LOCALE_NS)('nav'),
      locale: SETTINGS_LOCALE_NS,
      inject: pageFace,
    }, OpenDesignSettingsPage),
    ctx.slots.register({
      name: 'settings.section',
      id: ANALYTICS_SECTION_ID,
      order: 13,
      label: () => ctx.locale.bind(ANALYTICS_LOCALE_NS)('nav'),
      locale: ANALYTICS_LOCALE_NS,
      inject: analyticsFace,
    }, OpenDesignAnalyticsPage),
  ])

  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: MODEL_CARD_KEY,
    locale: SETTINGS_LOCALE_NS,
    inject: (): Omit<OpenDesignProviderCardProps, 't'> & Partial<{ t: never }> => pageFace(),
  }, OpenDesignProviderCard))
}

export const inject: readonly string[] = ['slots', 'locale', 'remote']
