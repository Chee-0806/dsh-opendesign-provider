/**
 * 额度面板的客户端装配（ticket 11）：真 `apply()` 在像 Web 客户端的 Cordis 根上
 * 注册 `main` 与 `sidebar.footer.action` 两个坐席，面板事实来自设置作用域与
 * `opendesign/usage` Remote，打开/关闭通过 `layout.selectPanel` 切换中间栏。
 *
 * 只断言装配结果与注入面行为，不渲染 React。
 */

import { register } from 'node:module'

register(new URL('./_css-module-loader.mjs', import.meta.url).href)

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Context, Service } from '@deepseek-ai/cordis'
import type { OpenDesignModelsReport } from '../src/models-wire.ts'
import type { QuotaSnapshot } from '../src/control-plane.ts'

const { apply, inject } = await import('../src/client/index.ts')
const { PANEL_ID } = await import('../src/identity.ts')
const { PANEL_LOCALE_NS } = await import('../src/client/panel-locales.ts')

const REPORT: OpenDesignModelsReport = {
  catalog: {
    source: 'live',
    apiBase: 'https://runtime.example/v1',
    cached: false,
    models: [{
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      contextWindow: 328000,
      maxTokens: 128000,
      cost: 'low',
      capability: 'advanced',
      inputModalities: ['text'],
      reasoningLevels: ['off', 'high'],
      default: true,
      calibrated: true,
    }],
  },
  credential: {
    source: 'cli-login',
    reference: 'OPEN_DESIGN_API_KEY',
    configured: true,
    apiBase: 'https://runtime.example/v1',
    apiBaseSource: 'cli-login',
    login: { status: 'ok', path: '/home/user/.amr/config.json', hasRuntimeKey: true, hasControlKey: true },
  },
}

const QUOTA: QuotaSnapshot = {
  controlPlaneAvailable: true,
  tier: 'go',
  funding: 'coding_plan',
  balanceUsd: 3,
  windows: [{
    kind: 'seven_day',
    durationSeconds: 604800,
    usedCredits: 500,
    limitCredits: 5000,
    remainingCredits: 4500,
  }],
  fetchedAt: '2026-10-20T10:31:46.562Z',
}

interface BootOptions {
  showSidebarQuota?: boolean
  quotaCalls?: { count: number }
}

async function boot(options: BootOptions = {}) {
  const quotaCalls = options.quotaCalls ?? { count: 0 }
  const ctx = new Context()
  const registered: Array<{ name: string; id?: string; key?: string; locale?: string; inject?: () => unknown }> = []
  const localeNamespaces: string[] = []
  const layoutCalls: Array<string | null> = []
  const settingsRow = {
    ns: 'llm-opendesign',
    value: { apiKeyEnv: 'OPEN_DESIGN_API_KEY', showSidebarQuota: options.showSidebarQuota ?? true } as Record<string, unknown>,
    user: {} as Record<string, unknown>,
    revision: 2,
  }
  const rowView = () => ({ ...settingsRow, value: { ...settingsRow.value }, user: { ...settingsRow.user } })

  const mountNamespace = async (namespace: string, implementation: Record<string, unknown>): Promise<void> => {
    await ctx.plugin({
      name: `remote.${namespace}`,
      apply(c: Context) {
        new (class extends Service {
          constructor(owner: Context) {
            super(owner, `remote.${namespace}`)
            Object.assign(this, implementation)
          }
        })(c)
      },
    })
  }

  class FakeRemote extends Service {
    constructor(owner: Context) {
      super(owner, 'remote')
    }

    async $mount(contribution: { package: string; descriptors: Array<{ namespace: string; method: string }> }) {
      const namespaces = new Map<string, string[]>()
      for (const descriptor of contribution.descriptors) {
        namespaces.set(descriptor.namespace, [...(namespaces.get(descriptor.namespace) ?? []), descriptor.method])
      }
      for (const [namespace, methods] of namespaces) {
        if (namespace === 'opendesign') {
          await mountNamespace('opendesign', {
            models: async () => ({ ok: true, value: REPORT }),
            usage: async () => {
              quotaCalls.count += 1
              return { ok: true, value: QUOTA }
            },
          })
          continue
        }
        const implementation: Record<string, unknown> = {}
        if (namespace === 'settings') {
          implementation.describe = async () => ({ ok: true, value: { writable: true, namespaces: [rowView()] } })
          implementation.mutate = async () => ({ ok: true, value: rowView() })
        }
        if (namespace === 'credentials') {
          implementation.describe = async () => ({ ok: true, value: {} })
          implementation.set = async () => ({ ok: true, value: undefined })
          implementation.unset = async () => ({ ok: true, value: undefined })
        }
        assert.equal(methods.length > 0, true)
        await mountNamespace(namespace, implementation)
      }
      return async () => {}
    }

    $on() {
      return () => {}
    }
  }

  const remote = new FakeRemote(ctx)
  await remote.$mount({
    package: 'boot',
    descriptors: [
      ...['describe', 'mutate'].map((method) => ({ namespace: 'settings', method })),
      ...['describe', 'set', 'unset'].map((method) => ({ namespace: 'credentials', method })),
    ],
  })

  ctx.provide('layout', {
    selectPanel(panelId: string | null) { layoutCalls.push(panelId) },
  })
  ctx.provide('locale', {
    register(ns: string) { localeNamespaces.push(ns); return () => {} },
    bind: (ns: string) => (key: string) => `${ns}:${key}`,
    getLocale: () => ({ active: 'zh' }),
  })
  ctx.provide('slots', {
    inject(name: string, fn: () => void) {
      if (name === 'settings.section' || name === 'settings.models.provider-card'
        || name === 'main' || name === 'sidebar.footer.action') fn()
    },
    register(registerOptions: { name: string; id?: string; key?: string; locale?: string; inject?: () => unknown }) {
      registered.push(registerOptions)
      return () => {}
    },
  })

  await ctx.plugin({
    name: 'plugin',
    inject,
    apply(c: Context) {
      return apply(c)
    },
  })
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))

  return { ctx, registered, localeNamespaces, layoutCalls, quotaCalls }
}

interface PanelFace {
  panelState(): {
    showSidebarQuota: boolean
    open: boolean
    snapshot?: QuotaSnapshot
  }
  panelOpen(): void
  panelClose(): void
  panelRefresh(): void
}

const panelFace = (registered: Array<{ name: string; inject?: () => unknown }>): PanelFace => {
  const main = registered.find((entry) => entry.name === 'main')
  assert.ok(main?.inject, 'main 必须带注入面')
  return main.inject() as PanelFace
}

test('注册 main 与 sidebar.footer.action 两个坐席，键与文案命名空间来自身份常量', async () => {
  const { registered, localeNamespaces, ctx } = await boot()
  const main = registered.find((entry) => entry.name === 'main')
  assert.deepEqual({ key: main?.key, locale: main?.locale }, { key: PANEL_ID, locale: PANEL_LOCALE_NS })
  const footer = registered.find((entry) => entry.name === 'sidebar.footer.action')
  assert.deepEqual({ id: footer?.id, locale: footer?.locale }, { id: PANEL_ID, locale: PANEL_LOCALE_NS })
  assert.deepEqual(localeNamespaces.slice().sort(), ['analytics.opendesign', 'panel.opendesign', 'settings.opendesign'])
  assert.ok(ctx.get('layout'))
})

test('开关打开时按 usage Remote 渲染，打开面板切换中间栏、关闭回到会话', async () => {
  const { registered, layoutCalls, quotaCalls } = await boot({ showSidebarQuota: true })
  const face = panelFace(registered)
  assert.equal(face.panelState().showSidebarQuota, true)
  assert.equal(face.panelState().snapshot?.tier, 'go')
  assert.equal(quotaCalls.count, 1)
  face.panelOpen()
  assert.equal(face.panelState().open, true)
  assert.deepEqual(layoutCalls, [PANEL_ID])
  face.panelClose()
  assert.equal(face.panelState().open, false)
  assert.deepEqual(layoutCalls, [PANEL_ID, null])
})

test('开关关闭时不读取 usage Remote', async () => {
  const { registered, quotaCalls } = await boot({ showSidebarQuota: false })
  const face = panelFace(registered)
  assert.equal(face.panelState().showSidebarQuota, false)
  assert.equal(face.panelState().snapshot, undefined)
  assert.equal(quotaCalls.count, 0)
})
