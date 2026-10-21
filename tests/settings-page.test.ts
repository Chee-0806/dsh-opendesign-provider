/**
 * Settings-page controller behavior (ticket 08), driven at its public seam: a
 * fake `remote.settings` scope, a fake credentials namespace and a fake
 * `opendesign/models` Remote. Nothing here imports the React tree.
 *
 * The controller owns exactly what the page promises: staged drafts, one batch
 * mutate fenced by the Host revision, a separately confirmed credential write
 * against this plugin's own reference, conflict retention, and a key status
 * that is only ever a boolean.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  OpenDesignSettingsController,
  cardMode,
  type CredentialsApi,
  type ModelsApi,
  type SettingsScopeLike,
} from '../src/client/settings.ts'
import type { SettingsPathOp, SettingsScopeSnapshot } from '../src/client/settings-scope.ts'
import type { OpenDesignModelsReport } from '../src/models-wire.ts'

/** A settings scope over one mutable document; mutate applies path ops. */
function fakeScope(initial: Record<string, unknown> = {}, revision = 7) {
  let snapshot: SettingsScopeSnapshot<Record<string, unknown>> = {
    status: 'ready',
    value: { ...initial },
    base: {},
    user: {},
    revision,
    writable: true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const mutations: Array<{ ops: readonly SettingsPathOp[]; revision: number | undefined }> = []
  let outcome: 'accepted' | 'conflict' | 'failed' | 'cancelled' = 'accepted'
  const scope: SettingsScopeLike = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async set() {},
    async unset() {},
    async mutate(ops, expectedRevision) {
      mutations.push({ ops, revision: expectedRevision })
      if (outcome !== 'accepted') return outcome
      const next = { ...snapshot.value }
      for (const op of ops) {
        const [field] = op.path
        if (field === undefined) continue
        if (op.op === 'set') next[field] = op.value
        else delete next[field]
      }
      snapshot = { ...snapshot, value: next, revision: (snapshot.revision ?? 0) + 1 }
      for (const listener of listeners) listener()
      return 'accepted'
    },
  }
  return {
    scope,
    mutations,
    setOutcome(next: typeof outcome) { outcome = next },
    setWritable(writable: boolean) {
      snapshot = { ...snapshot, writable }
      for (const listener of listeners) listener()
    },
  }
}

function fakeCredentials(options: {
  configured?: boolean
  writable?: boolean
  describeFails?: boolean
  setFails?: boolean
} = {}) {
  const state = { configured: options.configured ?? true, writable: options.writable ?? true }
  const calls = {
    describe: [] as string[][],
    set: [] as Array<{ ref: string; value: string }>,
    unset: [] as string[],
  }
  const api: CredentialsApi = {
    async describe(refs) {
      calls.describe.push([...refs])
      if (options.describeFails === true) return { ok: false, error: { message: 'denied' } }
      return {
        ok: true,
        value: Object.fromEntries(refs.map((ref) => [ref, { configured: state.configured, writable: state.writable }])),
      }
    },
    async set(ref, value) {
      calls.set.push({ ref, value })
      if (options.setFails === true) return { ok: false, error: { message: 'rejected' } }
      state.configured = true
      return { ok: true, value: undefined }
    },
    async unset(ref) {
      calls.unset.push(ref)
      state.configured = false
      return { ok: true, value: undefined }
    },
  }
  return { api, calls, state }
}

const REPORT: OpenDesignModelsReport = {
  catalog: {
    source: 'live',
    apiBase: 'https://runtime.example/v1',
    cached: false,
    fetchedAt: 1_760_000_000_000,
    models: [
      {
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
      },
      {
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
      },
    ],
  },
  credential: {
    source: 'cli-login',
    reference: 'OPEN_DESIGN_API_KEY',
    configured: true,
    apiBase: 'https://runtime.example/v1',
    apiBaseSource: 'cli-login',
    login: {
      status: 'ok',
      path: '/home/user/.amr/config.json',
      hasRuntimeKey: true,
      hasControlKey: false,
    },
  },
}

function fakeModels(report: OpenDesignModelsReport = REPORT) {
  const calls = { models: 0 }
  const api: ModelsApi = {
    async models() {
      calls.models += 1
      return { ok: true, value: report }
    },
  }
  return { api, calls }
}

function make(options: {
  value?: Record<string, unknown>
  revision?: number
  report?: OpenDesignModelsReport
  credentials?: ReturnType<typeof fakeCredentials>
  describeFails?: boolean
} = {}) {
  const settings = fakeScope(options.value ?? {
    apiKeyEnv: 'OPEN_DESIGN_API_KEY',
    apiBase: 'https://saved.example/v1',
    requestTimeoutMs: 300000,
    transportMaxRetries: 5,
    visibleModels: [],
    contextWindow: 200000,
  }, options.revision ?? 7)
  const credentials = options.credentials ?? fakeCredentials()
  const models = fakeModels(options.report ?? REPORT)
  const controller = new OpenDesignSettingsController(settings.scope, credentials.api, models.api)
  return { controller, settings, credentials, models }
}

/** 等控制器构造后的 fire-and-forget 刷新落地。 */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

test('describe 后呈现保存值、密钥仅状态和目录来源', async () => {
  const { controller, credentials } = make()
  await flush()
  const state = controller.state()
  assert.equal(state.status, 'ready')
  assert.equal(state.writable, true)
  assert.equal(state.apiKeyConfigured, true)
  assert.equal(state.apiKeyKnown, true)
  assert.equal(state.apiKeyReference, 'OPEN_DESIGN_API_KEY')
  assert.equal(state.apiKeyWritable, true)
  assert.deepEqual(credentials.calls.describe, [['OPEN_DESIGN_API_KEY']])
  assert.equal(state.fields.apiBase.text, 'https://saved.example/v1')
  assert.equal(state.fields.requestTimeoutMs.text, '300')
  assert.equal(state.catalogSource, 'live')
  assert.equal(state.models.find((model) => model.id === 'brand-new')?.calibrated, false)
  assert.equal(state.models.every((model) => model.visible), true, '空 allowlist 表示全选')
  assert.equal(JSON.stringify(state), JSON.stringify(state).replace(/sk-amr-/u, ''), '状态里没有密钥值')
})

test('编辑后一次整批 mutate，带宿主 revision，且只写本命名空间字段', async () => {
  const { controller, settings } = make()
  await flush()
  controller.edit('apiBase', 'https://next.example/v1')
  controller.edit('requestTimeoutMs', '10.5')
  controller.edit('transportMaxRetries', '2')
  assert.equal(controller.state().dirty, true)
  const outcome = await controller.save()
  assert.deepEqual(outcome, { config: 'confirmed', credential: 'none' })
  assert.equal(settings.mutations.length, 1)
  const mutation = settings.mutations[0]!
  assert.equal(mutation.revision, 7)
  assert.deepEqual(mutation.ops, [
    { op: 'set', path: ['apiBase'], value: 'https://next.example/v1' },
    { op: 'set', path: ['requestTimeoutMs'], value: 10500 },
    { op: 'set', path: ['transportMaxRetries'], value: 2 },
  ])
  assert.equal(controller.state().dirty, false)
  assert.deepEqual(controller.state().notice, { kind: 'success', key: 'saved' })
})

test('冲突保留草稿、提示冲突，并且不写凭据', async () => {
  const { controller, settings, credentials } = make()
  await flush()
  settings.setOutcome('conflict')
  controller.edit('apiBase', 'https://draft.example/v1')
  controller.setKey('sk-amr-draft-key')
  const outcome = await controller.save()
  assert.deepEqual(outcome, { config: 'conflict', credential: 'none' })
  assert.equal(controller.state().fields.apiBase.text, 'https://draft.example/v1')
  assert.equal(controller.state().keyDraft, 'sk-amr-draft-key')
  assert.equal(controller.state().dirty, true)
  assert.deepEqual(controller.state().notice, { kind: 'error', key: 'conflict' })
  assert.equal(credentials.calls.set.length, 0)
})

test('配置确认后才写凭据，写入目标引用来自本命名空间而非默认值', async () => {
  const { controller, settings, credentials } = make({
    value: { apiKeyEnv: 'TEAM_OPEN_DESIGN_KEY', apiBase: 'https://saved.example/v1' },
  })
  await flush()
  controller.setKey('sk-amr-new-key')
  const outcome = await controller.save()
  assert.deepEqual(outcome, { config: 'none', credential: 'confirmed' })
  assert.deepEqual(credentials.calls.set, [{ ref: 'TEAM_OPEN_DESIGN_KEY', value: 'sk-amr-new-key' }])
  // 密钥不写进设置文档：没有配置草稿时不发 mutate，也不会有 apiKey path。
  assert.equal(settings.mutations.length, 0)
  assert.equal(controller.state().keyDraft, '')
  assert.equal(controller.state().apiKeyConfigured, true)
})

test('清除 Key 走同一引用，页面从不显示明文', async () => {
  const { controller, credentials } = make()
  await flush()
  controller.clearKey()
  const outcome = await controller.save()
  assert.deepEqual(outcome, { config: 'none', credential: 'confirmed' })
  assert.deepEqual(credentials.calls.unset, ['OPEN_DESIGN_API_KEY'])
  assert.equal(controller.state().apiKeyConfigured, false)
  assert.equal(controller.state().apiKeyKnown, true)
})

test('凭据写入失败保留草稿并提示凭据失败', async () => {
  const { controller } = make({ credentials: fakeCredentials({ setFails: true }) })
  await flush()
  controller.setKey('sk-amr-draft-key')
  const outcome = await controller.save()
  assert.deepEqual(outcome, { config: 'none', credential: 'failed' })
  assert.equal(controller.state().keyDraft, 'sk-amr-draft-key')
  assert.deepEqual(controller.state().notice, { kind: 'error', key: 'credentialFailed' })
})

test('配置已确认但凭据失败时，配置草稿已落地而 Key 草稿仍保留', async () => {
  const { controller, settings } = make({ credentials: fakeCredentials({ setFails: true }) })
  await flush()
  controller.edit('apiBase', 'https://next.example/v1')
  controller.setKey('sk-amr-draft-key')
  const outcome = await controller.save()
  assert.deepEqual(outcome, { config: 'confirmed', credential: 'failed' })
  assert.equal(settings.mutations.length, 1)
  assert.equal(controller.state().keyDraft, 'sk-amr-draft-key')
  assert.equal(controller.state().fields.apiBase.text, 'https://next.example/v1')
  assert.equal(controller.state().notice?.key, 'credentialFailed')
})

test('CLI 登录态可读但没有 controlKey 时如实提示额度不可用', async () => {
  const { controller } = make({ credentials: fakeCredentials({ configured: false }) })
  await flush()
  const state = controller.state()
  assert.equal(state.apiKeyConfigured, true, '模型面仍由登录态 runtimeKey 兜底')
  assert.equal(state.credentialSource, 'cli-login')
  assert.equal(state.loginStatus, 'ok')
  assert.equal(state.hasControlKey, false)
  assert.equal(state.controlKeyWarning, true)
})

test('可见模型多选写 visibleModels，上下文覆盖写整表', async () => {
  const { controller, settings } = make()
  await flush()
  controller.toggleModel('brand-new')
  controller.editContextWindow('100000')
  controller.editContextOverride('deepseek-v4.1-flash', '64000')
  controller.editContextOverride('brand-new', '')
  const outcome = await controller.save()
  assert.deepEqual(outcome, { config: 'confirmed', credential: 'none' })
  assert.deepEqual(settings.mutations[0]!.ops, [
    { op: 'set', path: ['contextWindow'], value: 100000 },
    { op: 'set', path: ['visibleModels'], value: ['deepseek-v4.1-flash'] },
    { op: 'set', path: ['contextWindowOverrides'], value: { 'deepseek-v4.1-flash': 64000 } },
  ])
})

test('额度卡开关读已存值、草稿与已存值分开，保存走同一整批 mutate', async () => {
  const { controller, settings } = make({
    value: { apiKeyEnv: 'OPEN_DESIGN_API_KEY', apiBase: 'https://saved.example/v1', showSidebarQuota: true },
  })
  await flush()
  assert.equal(controller.state().showSidebarQuota, true)
  assert.equal(controller.state().showSidebarQuotaDraft, true)

  controller.setShowSidebarQuota(false)
  assert.equal(controller.state().showSidebarQuota, true, '已存值仍是额度面板的门禁事实')
  assert.equal(controller.state().showSidebarQuotaDraft, false)
  assert.equal(controller.state().dirty, true)

  controller.discard()
  assert.equal(controller.state().showSidebarQuotaDraft, true, '放弃更改恢复开关')

  controller.setShowSidebarQuota(false)
  const outcome = await controller.save()
  assert.deepEqual(outcome, { config: 'confirmed', credential: 'none' })
  assert.deepEqual(settings.mutations[0]!.ops, [
    { op: 'set', path: ['showSidebarQuota'], value: false },
  ])
  assert.equal(controller.state().showSidebarQuota, false)
  assert.equal(controller.state().showSidebarQuotaDraft, false)
  assert.equal(controller.state().dirty, false)
})

test('非法输入阻止保存并保留草稿', async () => {
  const { controller, settings } = make()
  await flush()
  controller.edit('requestTimeoutMs', '0')
  controller.edit('contextWindow', 'not-a-number')
  const outcome = await controller.save()
  assert.deepEqual(outcome, { config: 'none', credential: 'none' })
  assert.equal(settings.mutations.length, 0)
  assert.equal(controller.state().fields.requestTimeoutMs.invalid, true)
  assert.equal(controller.state().fields.contextWindow.invalid, true)
  assert.deepEqual(controller.state().notice, { kind: 'error', key: 'invalid' })
})

test('诊断文本只含状态与来源，不含草稿或任何密钥形态', async () => {
  const { controller } = make()
  await flush()
  controller.setKey('sk-amr-draft-secret')
  controller.edit('apiBase', 'https://user:pass@example/v1')
  const text = controller.diagnosticText()
  assert.doesNotMatch(text, /sk-amr-draft-secret/)
  assert.doesNotMatch(text, /user:pass/)
  assert.match(text, /OPEN_DESIGN_API_KEY/)
  assert.match(text, /cli-login|CLI/)
  assert.match(text, /controlKey/)
})

test('模型卡渲染条件：未就绪、只读、可用三态', () => {
  const base = make().controller.state()
  assert.equal(cardMode({ ...base, status: 'loading' }), 'unavailable')
  assert.equal(cardMode({ ...base, status: 'ready', writable: false }), 'readonly')
  assert.equal(cardMode({ ...base, status: 'ready', writable: true }), 'ready')
})

test('凭据描述失败时状态未知，不冒充未配置', async () => {
  const unconfigured: OpenDesignModelsReport = {
    ...REPORT,
    credential: {
      ...REPORT.credential,
      configured: false,
      source: 'none',
      login: { ...REPORT.credential.login, status: 'missing', hasRuntimeKey: false },
    },
  }
  const { controller } = make({ credentials: fakeCredentials({ describeFails: true }), report: unconfigured })
  await flush()
  const state = controller.state()
  assert.equal(state.apiKeyKnown, false)
  assert.equal(state.apiKeyWritable, false)
})
