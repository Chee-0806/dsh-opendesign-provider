/**
 * Client-boot integration for the Open Design browser half (ticket 08).
 *
 * A real `apply()` runs on a Cordis root assembled like the web client: the
 * settings/credentials/`opendesign` Remote namespaces are real nested Services,
 * the slot registry declares only the two seats this plugin owns, and the
 * locale runtime is a stub. The tests assert which surfaces register, what the
 * injected face reports under each degraded posture, and the save → credential
 * target path over the fake wires.
 */

import { register } from 'node:module'

// The React tree imports primitives that pull CSS modules; serve empty modules
// before the dynamic import below (static imports hoist above `register`).
register(new URL('./_css-module-loader.mjs', import.meta.url).href)

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Context, Service } from '@deepseek-ai/cordis'
import type { OpenDesignModelsReport } from '../src/models-wire.ts'

const { apply, inject } = await import('../src/client/index.ts')

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
      inputModalities: ['text', 'image'],
      reasoningLevels: ['off', 'high'],
      default: true,
      calibrated: true,
    }, {
      id: 'brand-new',
      name: 'Brand New',
      contextWindow: 128000,
      maxTokens: 32768,
      cost: 'medium',
      capability: 'standard',
      inputModalities: ['text'],
      reasoningLevels: ['off'],
      default: false,
      calibrated: false,
    }],
  },
  credential: {
    source: 'cli-login',
    reference: 'OPEN_DESIGN_API_KEY',
    configured: true,
    apiBase: 'https://runtime.example/v1',
    apiBaseSource: 'cli-login',
    login: { status: 'ok', path: '/home/user/.amr/config.json', hasRuntimeKey: true, hasControlKey: false },
  },
}

interface BootOptions {
  mountCredentials?: boolean
  mountSettings?: boolean
  mountModels?: boolean
  declaredSlots?: Set<string>
  writable?: boolean
  credentialConfigured?: boolean
}

async function boot(options: BootOptions = {}) {
  const {
    mountCredentials = true,
    mountSettings = true,
    mountModels = true,
    declaredSlots = new Set([
      'settings.section',
      'settings.models.provider-card',
      'main',
      'sidebar.footer.action',
    ]),
    writable = true,
    credentialConfigured = true,
  } = options

  const ctx = new Context()
  const registered: Array<{ name: string; id?: string; key?: string; locale?: string; inject?: () => unknown }> = []
  const localeNamespaces: string[] = []
  const remoteListeners = new Map<string, Set<() => void>>()
  const credentialCalls = {
    describe: [] as string[][],
    set: [] as Array<{ ref: string; value: string }>,
    unset: [] as string[],
  }
  const settingsCalls = {
    describe: 0,
    mutate: [] as Array<{ ns: string; ops: readonly { op: string; path: readonly string[]; value?: unknown }[]; revision: number | undefined }>,
  }
  const modelCalls = { models: 0 }
  const settingsRow = {
    ns: 'llm-opendesign',
    value: {
      apiKeyEnv: 'TEAM_OPEN_DESIGN_KEY',
      apiBase: 'https://saved.example/v1',
      requestTimeoutMs: 300000,
      transportMaxRetries: 5,
      visibleModels: [],
    } as Record<string, unknown>,
    user: {} as Record<string, unknown>,
    revision: 3,
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
      const methods = new Map<string, string[]>()
      for (const descriptor of contribution.descriptors) {
        methods.set(descriptor.namespace, [...(methods.get(descriptor.namespace) ?? []), descriptor.method])
      }
      for (const [namespace, names] of methods) {
        if (namespace === 'opendesign') {
          if (!mountModels) continue
          await mountNamespace('opendesign', {
            models: async () => { modelCalls.models += 1; return { ok: true, value: REPORT } },
          })
          continue
        }
        const implementation: Record<string, unknown> = {}
        for (const method of names) {
          if (namespace === 'credentials') {
            if (method === 'describe') {
              implementation.describe = async (refs: string[]) => {
                credentialCalls.describe.push([...refs])
                return { ok: true, value: Object.fromEntries(refs.map((ref) => [ref, { configured: credentialConfigured, writable: true }])) }
              }
            }
            if (method === 'set') {
              implementation.set = async (ref: string, value: string) => {
                credentialCalls.set.push({ ref, value })
                return { ok: true, value: undefined }
              }
            }
            if (method === 'unset') {
              implementation.unset = async (ref: string) => {
                credentialCalls.unset.push(ref)
                return { ok: true, value: undefined }
              }
            }
          }
          if (namespace === 'settings' && method === 'describe') {
            implementation.describe = async () => {
              settingsCalls.describe += 1
              return { ok: true, value: { writable, namespaces: [rowView()] } }
            }
          }
          if (namespace === 'settings' && method === 'mutate') {
            implementation.mutate = async (ns: string, ops: Array<{ op: string; path: readonly string[]; value?: unknown }>, revision?: number) => {
              settingsCalls.mutate.push({ ns, ops, revision })
              for (const op of ops) {
                const [field] = op.path
                if (field === undefined) continue
                if (op.op === 'set') {
                  settingsRow.value[field] = op.value
                  settingsRow.user[field] = op.value
                } else {
                  delete settingsRow.value[field]
                  delete settingsRow.user[field]
                }
              }
              settingsRow.revision += 1
              return { ok: true, value: rowView() }
            }
          }
        }
        await mountNamespace(namespace, implementation)
      }
      return async () => {}
    }

    $on(event: string, listener: () => void) {
      const set = remoteListeners.get(event) ?? new Set<() => void>()
      set.add(listener)
      remoteListeners.set(event, set)
      return () => set.delete(listener)
    }
  }

  const remote = new FakeRemote(ctx)
  await remote.$mount({
    package: 'boot',
    descriptors: [
      ...(mountCredentials ? ['describe', 'set', 'unset'].map((method) => ({ namespace: 'credentials', method })) : []),
      ...(mountSettings ? ['describe', 'mutate'].map((method) => ({ namespace: 'settings', method })) : []),
    ],
  })

  ctx.provide('layout', { selectPanel() {} })
  ctx.provide('locale', {
    register(ns: string) { localeNamespaces.push(ns); return () => {} },
    bind: (ns: string) => (key: string) => `${ns}:${key}`,
    getLocale: () => ({ active: 'en' }),
  })
  ctx.provide('slots', {
    inject(name: string, fn: () => void) {
      if (declaredSlots.has(name)) fn()
    },
    register(options: { name: string; id?: string; key?: string; locale?: string; inject?: () => unknown }, _component: unknown) {
      registered.push(options)
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
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))

  return { ctx, registered, localeNamespaces, credentialCalls, settingsCalls, modelCalls }
}

type Face = {
  state(): import('../src/client/settings.ts').SettingsPageState
  cardMode(): string
  edit(field: string, text: string): void
  setKey(value: string): void
  clearKey(): void
  toggleModel(id: string): void
  save(): Promise<unknown>
  discard(): void
  diagnosticText(): string
  refresh(): void
}

const pageFace = (registered: Awaited<ReturnType<typeof boot>>['registered']): Face => {
  const page = registered.find((entry) => entry.id === 'opendesign')
  assert.ok(page?.inject, 'settings.section must carry an inject face')
  return page.inject() as Face
}

test('apply 只注册自己的四个插槽，并各声明 locale 命名空间', async () => {
  const { registered, localeNamespaces } = await boot()
  assert.deepEqual(registered.map((entry) => entry.name).sort(), [
    'main',
    'settings.models.provider-card',
    'settings.section',
    'sidebar.footer.action',
  ])
  const section = registered.find((entry) => entry.id === 'opendesign')!
  assert.equal(section.name, 'settings.section')
  assert.equal(section.locale, 'settings.opendesign')
  const card = registered.find((entry) => entry.name === 'settings.models.provider-card')!
  assert.equal(card.key, 'llm-opendesign')
  assert.equal(card.locale, 'settings.opendesign')
  const panel = registered.find((entry) => entry.name === 'main')!
  assert.equal(panel.key, 'opendesign-panel')
  assert.equal(panel.locale, 'panel.opendesign')
  const footer = registered.find((entry) => entry.name === 'sidebar.footer.action')!
  assert.equal(footer.id, 'opendesign-panel')
  assert.equal(footer.locale, 'panel.opendesign')
  assert.deepEqual(localeNamespaces.slice().sort(), ['panel.opendesign', 'settings.opendesign'])
})

test('引擎没声明插槽时不注册（不硬造坐席）', async () => {
  const { registered } = await boot({ declaredSlots: new Set() })
  assert.deepEqual(registered, [])
})

test('设置页投影 describe 值、CLI 登录态与目录来源，密钥仅为状态', async () => {
  const { registered, credentialCalls, settingsCalls, modelCalls } = await boot()
  const face = pageFace(registered)
  const state = face.state()
  assert.equal(state.status, 'ready')
  assert.equal(state.writable, true)
  assert.equal(state.apiKeyConfigured, true)
  assert.equal(state.apiKeyReference, 'TEAM_OPEN_DESIGN_KEY')
  assert.equal(state.catalogSource, 'live')
  assert.equal(state.models.find((model) => model.id === 'brand-new')?.calibrated, false)
  assert.equal(state.loginStatus, 'ok')
  assert.equal(state.hasControlKey, false)
  assert.equal(state.controlKeyWarning, true)
  assert.deepEqual(credentialCalls.describe.at(-1), ['TEAM_OPEN_DESIGN_KEY'])
  assert.equal(settingsCalls.describe >= 1, true)
  assert.equal(modelCalls.models, 1)
  assert.doesNotMatch(JSON.stringify(state), /sk-amr-/u)
})

test('保存走整批 mutate + revision，密钥只写本命名空间声明的引用', async () => {
  const { registered, credentialCalls, settingsCalls } = await boot()
  const face = pageFace(registered)
  face.edit('apiBase', 'https://next.example/v1')
  face.setKey('sk-amr-copied-key')
  const outcome = await face.save()
  assert.deepEqual(outcome, { config: 'confirmed', credential: 'confirmed' })
  assert.equal(settingsCalls.mutate.length, 1)
  assert.equal(settingsCalls.mutate[0]!.ns, 'llm-opendesign')
  assert.equal(settingsCalls.mutate[0]!.revision, 3)
  assert.deepEqual(settingsCalls.mutate[0]!.ops, [
    { op: 'set', path: ['apiBase'], value: 'https://next.example/v1' },
  ])
  assert.deepEqual(credentialCalls.set, [{ ref: 'TEAM_OPEN_DESIGN_KEY', value: 'sk-amr-copied-key' }])
  assert.equal(face.state().apiKeyConfigured, true)
  assert.equal(face.state().keyDraft, '')
})

test('清除 Key 也走同一引用，诊断可复制且脱敏', async () => {
  const { registered, credentialCalls } = await boot()
  const face = pageFace(registered)
  face.clearKey()
  await face.save()
  assert.deepEqual(credentialCalls.unset, ['TEAM_OPEN_DESIGN_KEY'])
  face.setKey('sk-amr-draft-secret')
  face.edit('apiBase', 'https://user:pass@example/v1')
  const text = face.diagnosticText()
  assert.doesNotMatch(text, /sk-amr-draft-secret/)
  assert.doesNotMatch(text, /user:pass/)
  assert.match(text, /TEAM_OPEN_DESIGN_KEY/)
})

test('没有 settings 命名空间时页面仍注册，但处于不可用只读状态', async () => {
  const { registered } = await boot({ mountSettings: false })
  const face = pageFace(registered)
  assert.equal(face.state().status, 'loading')
  assert.equal(face.cardMode(), 'unavailable')
})

test('没有 credentials 命名空间时密钥状态未知，不能冒充未设置', async () => {
  const { registered } = await boot({ mountCredentials: false, mountModels: false })
  const face = pageFace(registered)
  assert.equal(face.state().apiKeyKnown, false)
  assert.equal(face.state().apiKeyWritable, false)
  assert.equal(face.state().apiKeyConfigured, false)
  assert.equal(face.state().catalogSource, 'unknown')
})
