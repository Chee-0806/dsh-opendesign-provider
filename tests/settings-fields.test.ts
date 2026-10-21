/**
 * The settings page's two interactive fields: the model allowlist dropdown and
 * the per-model context override editor.
 *
 * Both keep state the controller deliberately does not own — which picker is
 * open, which empty rows the reader added in this session — so they are the one
 * place on the page where a click changes what renders without the controller
 * knowing. That is exactly where the last bug hid: clearing every allowlist
 * tick left the override editor with no models to offer and a dead `+` button,
 * because "no ticks" means "everything visible" but each row's `visible` flag
 * was still false. These tests mount the real components in a DOM and click
 * them, rather than asserting on the JSX source.
 */

import { register } from 'node:module'

register(new URL('./_css-module-loader.mjs', import.meta.url).href)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement, type ReactElement } from 'react'
import { Window } from 'happy-dom'

import { zh, type SettingsOpenDesignKey } from '../src/client/locales.ts'
import { createSnapshotStore } from '../src/client/snapshot-store.ts'
import { overrideChoices, type ContextOverrideDraft, type SettingsModelRow, type SettingsPageState, type SettingsSaveOutcome } from '../src/client/settings.ts'

// React DOM latches `canUseDOM` while its module is first evaluated, so the
// window has to be installed before the dynamic imports below run.
const win = new Window({ url: 'http://localhost/' })
for (const key of [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'Event',
  'MouseEvent',
  'PointerEvent',
  'KeyboardEvent',
  'DocumentFragment',
  'Text',
  'NodeFilter',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const) {
  const value = (win as unknown as Record<string, unknown>)[key]
  if (value === undefined) continue
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true, writable: true })

const { createRoot } = await import('react-dom/client')
const { ModelAllowlist, ContextOverrideEditor, OpenDesignSettingsPage, SettingsField } = await import('../src/client/section.tsx')

/** The dictionary's own copy, with `{name}` placeholders filled in. */
const t = (key: SettingsOpenDesignKey, params?: Record<string, unknown>): string => {
  let text = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

const MODEL_ROWS: readonly SettingsModelRow[] = [
  { id: 'alpha', name: 'Alpha', contextWindow: 128_000, maxTokens: 8_192, cost: 'low', capability: 'standard', calibrated: true, visible: true },
  { id: 'beta', name: 'Beta', contextWindow: 200_000, maxTokens: 16_384, cost: 'medium', capability: 'advanced', calibrated: false, visible: true },
  { id: 'gamma', name: 'Gamma', contextWindow: 64_000, maxTokens: 4_096, cost: 'low', capability: 'standard', calibrated: true, visible: true },
]

interface Mounted {
  readonly host: HTMLElement
  query<T extends Element = Element>(selector: string): T | null
  queryAll<T extends Element = Element>(selector: string): T[]
  /** Existence as a boolean — never assert on the node itself. */
  has(selector: string): boolean
  text(): string
  render(next: ReactElement): Promise<void>
  click(target: string | Element): Promise<void>
  toggle(target: string | Element): Promise<void>
  fill(target: string | Element, value: string): Promise<void>
  choose(target: string | Element, value: string): Promise<void>
  pointerDown(target: string | Element): Promise<void>
  clickOutside(): Promise<void>
  unmount(): Promise<void>
}

/**
 * Every mounted tree, so a failing assertion cannot leave a live React root
 * behind. Without this the process never reaches an empty event loop and the
 * runner kills it — which replaces the assertion message with a bare SIGKILL.
 */
const mounted = new Set<Mounted>()

async function mount(initial: ReactElement): Promise<Mounted> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let live = true
  await act(async () => {
    root.render(initial)
  })
  const resolve = (target: string | Element): Element => {
    const found = typeof target === 'string' ? api.query(target) : target
    if (found === null) throw new Error(`nothing matches ${String(target)}`)
    return found
  }
  const api: Mounted = {
    host,
    query: <T extends Element = Element>(selector: string): T | null => host.querySelector<T>(selector),
    queryAll: <T extends Element = Element>(selector: string): T[] => [...host.querySelectorAll<T>(selector)],
    has: (selector: string): boolean => host.querySelector(selector) !== null,
    text: (): string => host.textContent ?? '',
    async render(next) {
      await act(async () => {
        root.render(next)
      })
    },
    async click(target) {
      const element = resolve(target)
      await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    },
    async toggle(target) {
      const element = resolve(target) as HTMLInputElement
      await act(async () => {
        element.click()
      })
    },
    // React overwrites `value` on the instance to track what it last wrote, so
    // a plain assignment is swallowed; the prototype setter is the real one.
    async fill(target, value) {
      const element = resolve(target) as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set
      if (setter === undefined) throw new Error('no native value setter')
      await act(async () => {
        setter.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      })
    },
    async choose(target, value) {
      const element = resolve(target) as HTMLSelectElement
      const setter = Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value')?.set
      if (setter === undefined) throw new Error('no native value setter')
      await act(async () => {
        setter.call(element, value)
        element.dispatchEvent(new Event('change', { bubbles: true }))
      })
    },
    async pointerDown(target) {
      const element = resolve(target)
      await act(async () => {
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      })
    },
    async clickOutside() {
      await act(async () => {
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      })
    },
    async unmount() {
      if (!live) return
      live = false
      mounted.delete(api)
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
  mounted.add(api)
  return api
}

test.afterEach(async () => {
  for (const view of [...mounted]) await view.unmount()
})

test.after(() => {
  // happy-dom keeps the window alive; nothing else in the suite needs it.
  win.close()
})

// ---------------------------------------------------------------------------
// ModelAllowlist
// ---------------------------------------------------------------------------

async function allowlist(options: {
  models?: readonly SettingsModelRow[]
  selected?: readonly string[]
  allVisible?: boolean
  disabled?: boolean
} = {}) {
  const toggled: string[] = []
  let showAll = 0
  const element = (): ReactElement => createElement(ModelAllowlist, {
    t,
    models: options.models ?? MODEL_ROWS,
    selected: options.selected ?? [],
    allVisible: options.allVisible ?? (options.selected ?? []).length === 0,
    disabled: options.disabled ?? false,
    onToggle: (id: string) => { toggled.push(id) },
    onShowAll: () => { showAll += 1 },
  })
  const view = await mount(element())
  return { view, toggled, showAllCount: () => showAll }
}

test('白名单下拉默认收起,触发器说明当前是全部模型', async () => {
  const { view } = await allowlist()
  assert.equal(view.has('.od-allowlistMenu'), false, '菜单不该默认展开')
  assert.equal(view.query('.od-allowlistTrigger')?.getAttribute('aria-expanded'), 'false')
  assert.match(view.text(), /全部可见/)
  await view.unmount()
})

test('白名单触发器显示已选数量', async () => {
  const { view } = await allowlist({ selected: ['alpha', 'beta'] })
  assert.match(view.text(), /已选 2 个模型/)
  assert.doesNotMatch(view.text(), /全部可见/)
  await view.unmount()
})

test('点击触发器展开目录,每个模型一行,再点收起', async () => {
  const { view } = await allowlist()
  await view.click('.od-allowlistTrigger')
  assert.equal(view.has('.od-allowlistMenu'), true)
  assert.equal(view.queryAll('.od-allowlistItem .od-check').length, 3)
  assert.equal(view.query('.od-allowlistTrigger')?.getAttribute('aria-expanded'), 'true')
  for (const name of ['Alpha', 'Beta', 'Gamma']) assert.match(view.text(), new RegExp(name))

  await view.click('.od-allowlistTrigger')
  assert.equal(view.has('.od-allowlistMenu'), false)
  await view.unmount()
})

test('勾选一项回调携带模型 id', async () => {
  const { view, toggled } = await allowlist()
  await view.click('.od-allowlistTrigger')
  const boxes = view.queryAll<HTMLInputElement>('.od-allowlistItem .od-check')
  const beta = boxes.find((box) => box.closest('.od-allowlistItem')?.textContent?.includes('Beta') === true)
  assert.ok(beta !== undefined, 'Beta 应该在菜单里')
  await view.toggle(beta)
  assert.deepEqual(toggled, ['beta'])
  await view.unmount()
})

test('「显示全部」在全部可见时禁用,有选中时可点,且点完收起', async () => {
  const all = await allowlist()
  await all.view.click('.od-allowlistTrigger')
  const disabledButton = all.view.query<HTMLButtonElement>('.od-allowlistShowAll')
  assert.equal(disabledButton?.disabled, true, '已经全部可见时按钮不该可点')
  await all.view.unmount()

  const picked = await allowlist({ selected: ['alpha'], allVisible: false })
  await picked.view.click('.od-allowlistTrigger')
  const button = picked.view.query<HTMLButtonElement>('.od-allowlistShowAll')
  assert.equal(button?.disabled, false)
  await picked.view.click(button!)
  assert.equal(picked.showAllCount(), 1)
  assert.equal(picked.view.has('.od-allowlistMenu'), false, '清空后应收起菜单')
  await picked.view.unmount()
})

test('菜单展开时点击外部关闭,点菜单内部不关闭', async () => {
  const { view } = await allowlist()
  await view.click('.od-allowlistTrigger')
  assert.equal(view.has('.od-allowlistMenu'), true)

  await view.clickOutside()
  assert.equal(view.has('.od-allowlistMenu'), false, '点页面别处应该收起')

  await view.click('.od-allowlistTrigger')
  const item = view.query('.od-allowlistItem')
  assert.equal(item !== null, true, '菜单项应该渲染出来')
  await view.pointerDown(item!)
  assert.equal(view.has('.od-allowlistMenu'), true, '点菜单内部不该自己关掉')
  await view.unmount()
})

test('白名单下拉在不可写时整体禁用', async () => {
  const { view } = await allowlist({ selected: ['alpha'], allVisible: false, disabled: true })
  assert.equal(view.query<HTMLButtonElement>('.od-allowlistTrigger')?.disabled, true)
  await view.click('.od-allowlistTrigger')
  assert.equal(view.has('.od-allowlistMenu'), false, '禁用时点不开')
  await view.unmount()
})

test('目录为空时不渲染空勾选列表,而是说明这段是做什么的', async () => {
  const { view } = await allowlist({ models: [] })
  await view.click('.od-allowlistTrigger')
  assert.equal(view.queryAll('.od-allowlistItem .od-check').length, 0)
  assert.match(view.text(), /白名单决定模型选择器里出现哪些模型/)
  await view.unmount()
})

test('未校准模型在菜单里带角标,并按能力与成本分组', async () => {
  const { view } = await allowlist()
  await view.click('.od-allowlistTrigger')
  assert.equal(view.queryAll('.od-badgeWarn').length, 1, '只有 Beta 未校准')
  const groups = view.queryAll('.od-allowlistGroupLabel').map((node) => node.textContent ?? '')
  assert.deepEqual(new Set(groups), new Set(['标准能力 · 低成本', '进阶能力 · 中成本']))
  assert.equal(view.queryAll('.od-allowlistItem .od-check:checked').length, 3, '全部可见时三个都勾上')
  await view.unmount()
})

// ---------------------------------------------------------------------------
// ContextOverrideEditor
// ---------------------------------------------------------------------------

/**
 * A parent that behaves like the controller: `onChange` rewrites its own rows
 * and the tree is re-rendered, which is the only way the editor's session-added
 * row state and the controller's rows can be observed agreeing.
 */
async function overrides(options: {
  rows?: readonly ContextOverrideDraft[]
  choices?: readonly SettingsModelRow[]
  disabled?: boolean
} = {}) {
  const changes: Array<{ model: string; text: string }> = []
  let rows: ContextOverrideDraft[] = (options.rows ?? OVERRIDE_ROWS).map((item) => ({ ...item }))
  const element = (): ReactElement => createElement(ContextOverrideEditor, {
    t,
    rows,
    choices: options.choices ?? MODEL_ROWS,
    disabled: options.disabled ?? false,
    onChange: (model: string, text: string) => {
      changes.push({ model, text })
      const found = rows.find((item) => item.model === model)
      rows = found === undefined
        ? [...rows, { model, text, invalid: false }]
        : rows.map((item) => (item.model === model ? { ...item, text } : item))
    },
  })
  const view = await mount(element())
  /** Re-project the tree the way a controller notification would. */
  const refresh = async (): Promise<void> => { await view.render(element()) }
  return { view, changes, refresh, rowsText: () => rows.map((item) => `${item.model}=${item.text}`) }
}

const OVERRIDE_ROWS: readonly ContextOverrideDraft[] = [
  { model: 'alpha', text: '64000', invalid: false },
  { model: 'beta', text: '', invalid: false },
  { model: 'gamma', text: '', invalid: false },
]

test('覆盖列表只渲染有值的行,空行不占位', async () => {
  const { view, refresh } = await overrides()
  assert.equal(view.queryAll('.od-overrideRow').length, 1)
  assert.match(view.text(), /Alpha/)
  assert.equal(view.queryAll('.od-overrideRow .od-overrideModel').length, 1)
  await refresh()
  await view.unmount()
})

test('点击加号补一行,用的是还没被占用的模型', async () => {
  const { view, refresh } = await overrides()
  await view.click('.od-overrideAdd')
  await refresh()
  assert.equal(view.queryAll('.od-overrideRow').length, 2)
  const models = view.queryAll<HTMLSelectElement>('.od-overrideModel').map((select) => select.value)
  assert.deepEqual(models, ['alpha', 'beta'], '新行落在第一个空位上')
  await view.unmount()
})

test('加满之后加号禁用,不会多出重复模型的行', async () => {
  const { view, refresh } = await overrides()
  await view.click('.od-overrideAdd')
  await refresh()
  await view.click('.od-overrideAdd')
  await refresh()
  assert.equal(view.queryAll('.od-overrideRow').length, 3)
  const add = view.query<HTMLButtonElement>('.od-overrideAdd')
  assert.equal(add?.disabled, true, '目录用完了就不该还能加')
  await view.click(add!)
  await refresh()
  assert.equal(view.queryAll('.od-overrideRow').length, 3)
  await view.unmount()
})

test('移除一行清空它的值并把它藏起来', async () => {
  const { view, changes, refresh } = await overrides()
  await view.click('.od-overrideRow .od-iconButton')
  await refresh()
  assert.deepEqual(changes, [{ model: 'alpha', text: '' }])
  assert.equal(view.queryAll('.od-overrideRow').length, 0, '清空后不该再占一行')
  await view.unmount()
})

test('换模型时把上下文长度迁移过去,旧行清空', async () => {
  const { view, changes, refresh } = await overrides()
  await view.choose('.od-overrideModel', 'gamma')
  await refresh()
  assert.deepEqual(changes, [
    { model: 'alpha', text: '' },
    { model: 'gamma', text: '64000' },
  ])
  assert.equal(view.queryAll('.od-overrideRow').length, 1)
  assert.equal(view.query<HTMLSelectElement>('.od-overrideModel')?.value, 'gamma')
  await view.unmount()
})

test('换掉一行之后旧模型不再占位', async () => {
  const { view, refresh, rowsText } = await overrides()
  await view.click('.od-overrideAdd')
  await refresh()
  // 两行都要有值,否则"旧行被清空"和"旧行还留着但本来就空"看不出区别
  await view.fill(view.queryAll('.od-overrideValue')[1]!, '32000')
  await refresh()
  assert.deepEqual(view.queryAll<HTMLSelectElement>('.od-overrideModel').map((s) => s.value), ['alpha', 'beta'])

  // 把第二行从 beta 换成 gamma:gamma 还没被占用,应当允许
  await view.choose(view.queryAll('.od-overrideModel')[1]!, 'gamma')
  await refresh()
  assert.deepEqual(
    view.queryAll<HTMLSelectElement>('.od-overrideModel').map((s) => s.value),
    ['alpha', 'gamma'],
    '旧模型那一行必须消失,而不是留下来变成第三行',
  )
  assert.deepEqual(rowsText(), ['alpha=64000', 'beta=', 'gamma=32000'], '值跟着搬到新模型上')
  await view.unmount()
})

test('已用模型不出现在别行的下拉里', async () => {
  const { view } = await overrides()
  const options = view.queryAll<HTMLOptionElement>('.od-overrideModel option').map((option) => option.value)
  assert.deepEqual(options, ['alpha', 'beta', 'gamma'], '第一行展示自己,其余两个可选')
  await view.unmount()
})

test('输入覆盖值回调携带模型与文本', async () => {
  const { view, changes } = await overrides()
  await view.fill('.od-overrideValue', '128000')
  assert.deepEqual(changes, [{ model: 'alpha', text: '128000' }])
  await view.unmount()
})

test('没有可覆盖的目录时给出说明而不是空表头', async () => {
  const { view } = await overrides({ choices: [] })
  assert.equal(view.has('.od-overrides'), false)
  assert.match(view.text(), /为单个模型单独设置上下文长度/)
  await view.unmount()
})

test('不可写时覆盖列表的所有控件都禁用', async () => {
  const { view } = await overrides({ disabled: true })
  assert.equal(view.query<HTMLButtonElement>('.od-overrideAdd')?.disabled, true)
  assert.equal(view.query<HTMLSelectElement>('.od-overrideModel')?.disabled, true)
  assert.equal(view.query<HTMLInputElement>('.od-overrideValue')?.disabled, true)
  assert.equal(view.query<HTMLButtonElement>('.od-overrideRow .od-iconButton')?.disabled, true)
  await view.unmount()
})

// ---------------------------------------------------------------------------
// The regression: an emptied allowlist must not empty the override choices
// ---------------------------------------------------------------------------

/**
 * Only `models` / `visibleModels` / `contextOverrides` are read; the rest is
 * inert filler. `contextOverrides` matches what the controller builds — one
 * empty row per catalog model — because the editor's `+` only *reveals* an
 * empty row, it never synthesises one.
 */
function stateWith(
  models: readonly SettingsModelRow[],
  visibleModels: readonly string[],
  overrides: Readonly<Record<string, string>> = {},
): SettingsPageState {
  const field = { text: '', invalid: false, changed: false }
  return {
    status: 'ready',
    writable: true,
    apiKeyConfigured: true,
    apiKeyKnown: true,
    apiKeyWritable: true,
    apiKeyReference: 'OPEN_DESIGN_API_KEY',
    credentialSource: 'literal',
    loginStatus: 'ok',
    hasControlKey: true,
    controlKeyWarning: false,
    catalogSource: 'live',
    catalogCached: false,
    models: [...models],
    visibleModels: [...visibleModels],
    allVisible: visibleModels.length === 0,
    contextOverrides: models.map((model) => ({ model: model.id, text: overrides[model.id] ?? '', invalid: false })),
    fields: {
      apiBase: { ...field },
      modelsCachePath: { ...field },
      requestTimeoutMs: { ...field },
      streamIdleTimeoutMs: { ...field },
      transportMaxRetries: { ...field },
      contextWindow: { ...field },
      maxOutputTokens: { ...field },
    },
    language: 'zh',
    showSidebarQuota: false,
    showSidebarQuotaDraft: false,
    keyDraft: '',
    keyAction: 'none',
    dirty: false,
    saving: false,
  }
}

test('白名单清空后,按模型覆盖仍提供整个目录而不是空列表', () => {
  // 一个都没勾选 = 全部可见,但每行 `visible` 仍是 false —— 只看行标记会把
  // 覆盖列表的选项清空,加号随之失效。
  const emptied = stateWith(MODEL_ROWS.map((model) => ({ ...model, visible: false })), [])
  assert.deepEqual(overrideChoices(emptied).map((model) => model.id), ['alpha', 'beta', 'gamma'])
})

test('白名单生效时,按模型覆盖只提供可见模型', () => {
  const picked = stateWith(MODEL_ROWS.map((model) => ({ ...model, visible: model.id === 'beta' })), ['beta'])
  assert.deepEqual(overrideChoices(picked).map((model) => model.id), ['beta'])
})

test('白名单清空后,页面上的按模型覆盖仍然能加行', async () => {
  // 端到端钉住那个 bug:走真实页面,不绕过 `overrideChoices`。白名单一个都
  // 没勾时每行 `visible` 仍是 false,加号必须是活的、下拉必须还有整个目录。
  const state = stateWith(MODEL_ROWS.map((model) => ({ ...model, visible: false })), [])
  const view = await mount(createElement(OpenDesignSettingsPage, {
    t,
    settingsStore: createSnapshotStore(state),
    state: () => state,
    cardMode: (): 'ready' => 'ready',
    edit: () => {},
    resetField: () => {},
    toggleModel: () => {},
    showAllModels: () => {},
    editContextWindow: () => {},
    editContextOverride: () => {},
    setLanguage: () => {},
    setShowSidebarQuota: () => {},
    setKey: () => {},
    clearKey: () => {},
    save: async (): Promise<SettingsSaveOutcome> => ({ config: 'none', credential: 'none' }),
    discard: () => {},
    diagnosticText: () => '',
    refresh: () => {},
  }))

  // 「按模型覆盖」默认折叠,先展开它
  assert.equal(view.queryAll('.od-overrideRow').length, 0, '没有覆盖值时列表是空的')
  await view.click('.od-disclosureField')
  assert.equal(view.has('.od-overrides'), true, '展开后应该看到覆盖表')

  const add = view.query<HTMLButtonElement>('.od-overrideAdd')
  assert.equal(add?.disabled, false, '目录里明明有模型,加号不该是灰的')

  // 加一行:它必须落到某个模型上,而下拉里必须有整份目录可选
  await view.click(add!)
  assert.equal(view.queryAll('.od-overrideRow').length, 1)
  assert.deepEqual(
    view.queryAll<HTMLOptionElement>('.od-overrideModel option').map((option) => option.value),
    ['alpha', 'beta', 'gamma'],
    '一个都没勾选等于全部可见,下拉就该是整份目录',
  )
  await view.unmount()
})

test('折叠不会丢掉本次新增但还没填值的覆盖行', async () => {
  function Harness() {
    return createElement(SettingsField, {
      label: '按模型覆盖',
      defaultOpen: true,
      children: createElement(ContextOverrideEditor, {
        t,
        rows: OVERRIDE_ROWS,
        choices: MODEL_ROWS,
        disabled: false,
        onChange: () => {},
      }),
    })
  }
  const view = await mount(createElement(Harness))
  const before = view.queryAll('.od-overrideRow').length
  await view.click('.od-overrideAdd')
  const added = view.queryAll('.od-overrideRow').length
  assert.equal(added, before + 1, '加号应该补一行')
  await view.click('.od-disclosureField')
  assert.equal(view.queryAll('.od-overrideRow').length, added, '收起时行仍挂载，只是隐藏')
  await view.click('.od-disclosureField')
  assert.equal(view.queryAll('.od-overrideRow').length, added, '展开后草稿行还在')
  await view.unmount()
})

