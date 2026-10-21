/**
 * 额度面板控制器（ticket 11）：开关门禁、首次拉取、5 分钟节流、手动刷新、
 * 失败保留旧值与打开/关闭的中间栏选择。
 *
 * 全程用假 loader 与假设置事实，不联网、不碰 React。断言的是外部行为：
 * loader 被调用几次、state 里留下什么、layout 收到哪个面板键。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { QuotaSnapshot } from '../src/control-plane.ts'
import {
  OpenDesignQuotaPanelController,
  QUOTA_PANEL_REFRESH_MS,
  type QuotaPanelSettingsFacts,
} from '../src/client/panel.ts'
import { buildQuotaPanelView } from '../src/client/panel-view.ts'
import { panelTranslate } from '../src/client/panel-locales.ts'

const SNAPSHOT: QuotaSnapshot = {
  controlPlaneAvailable: true,
  tier: 'go',
  funding: 'coding_plan',
  balanceUsd: 2.5,
  windows: [{
    kind: 'seven_day',
    durationSeconds: 604800,
    usedCredits: 100,
    limitCredits: 1000,
    remainingCredits: 900,
    resetsAt: '2026-10-27T03:18:08.000Z',
  }],
  fetchedAt: '2026-10-20T10:31:46.562Z',
}

function fakeSettings(initial: Partial<QuotaPanelSettingsFacts> = {}) {
  let facts: QuotaPanelSettingsFacts = {
    showSidebarQuota: false,
    hasControlKey: true,
    loginStatus: 'ok',
    ...initial,
  }
  const listeners = new Set<() => void>()
  return {
    source: {
      getSnapshot: () => facts,
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    set(next: Partial<QuotaPanelSettingsFacts>) {
      facts = { ...facts, ...next }
      for (const listener of listeners) listener()
    },
  }
}

function fakeLoader() {
  const calls: number[] = []
  let behaviour: 'ok' | 'fail' | 'stale' = 'ok'
  const load = async () => {
    calls.push(calls.length + 1)
    if (behaviour === 'fail') throw new Error('control plane unreachable')
    return { ok: true as const, value: behaviour === 'stale' ? { ...SNAPSHOT, stale: true } : SNAPSHOT }
  }
  return {
    load,
    calls,
    setBehaviour(next: typeof behaviour) { behaviour = next },
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

function make(options: {
  facts?: Partial<QuotaPanelSettingsFacts>
  loader?: ReturnType<typeof fakeLoader>
  now?: () => number
  layout?: string[]
} = {}) {
  const settings = fakeSettings(options.facts)
  const loader = options.loader ?? fakeLoader()
  const layout = options.layout ?? []
  let now = 1_000_000
  const clock = options.now ?? (() => now)
  const controller = new OpenDesignQuotaPanelController({
    load: loader.load,
    settings: settings.source,
    now: clock,
    selectPanel: (key) => { layout.push(key ?? 'null') },
  })
  return {
    controller,
    settings,
    loader,
    layout,
    advance(ms: number) { now += ms },
    view(t = panelTranslate('zh'), locale: 'zh' | 'en' = 'zh') {
      return buildQuotaPanelView({
        ...controller.state(),
        t,
        locale,
        timeZone: 'UTC',
      })
    },
  }
}

test('开关默认关闭：不渲染、也不调用 loader', async () => {
  const { loader, view } = make()
  await flush()
  assert.equal(loader.calls.length, 0)
  assert.equal(view().visible, false)
})

test('开启开关后拉一次并渲染档位与 7 天窗口', async () => {
  const { controller, loader, settings, view } = make()
  await flush()
  settings.set({ showSidebarQuota: true })
  await flush()
  assert.equal(loader.calls.length, 1)
  const state = controller.state()
  assert.equal(state.snapshot?.tier, 'go')
  assert.equal(view().visible, true)
  assert.equal(view().windows[0]?.label, '7 天窗口')
})

test('有登录态但没有 controlKey：不渲染也不发起读取', async () => {
  const { loader, settings, view } = make({
    facts: { showSidebarQuota: true, hasControlKey: false, loginStatus: 'ok' },
  })
  await flush()
  settings.set({})
  await flush()
  assert.equal(loader.calls.length, 0)
  const rendered = view()
  assert.equal(rendered.visible, false)
  assert.match(rendered.reasonText ?? '', /controlKey/u)
})

test('5 分钟节流：窗口内重复触发不重复读取，手动刷新可穿透', async () => {
  const disabled = make()
  await flush()
  await disabled.controller.refresh()
  await flush()
  assert.equal(disabled.loader.calls.length, 0, '关闭时任何刷新都被忽略')

  const enabled = make({ facts: { showSidebarQuota: true } })
  await flush()
  assert.equal(enabled.loader.calls.length, 1)
  enabled.controller.refresh()
  await flush()
  assert.equal(enabled.loader.calls.length, 1, '节流窗口内不重复读取')
  enabled.advance(60_000)
  enabled.controller.refresh()
  await flush()
  assert.equal(enabled.loader.calls.length, 1)
  enabled.advance(QUOTA_PANEL_REFRESH_MS)
  enabled.controller.refresh()
  await flush()
  assert.equal(enabled.loader.calls.length, 2)
  enabled.controller.refresh(true)
  await flush()
  assert.equal(enabled.loader.calls.length, 3, '手动刷新穿透节流')
  assert.equal(enabled.view().visible, true)
})

test('读取失败保留旧值并把面板标成已过期', async () => {
  const { controller, loader, view } = make({ facts: { showSidebarQuota: true } })
  await flush()
  assert.equal(view().staleText, undefined)
  loader.setBehaviour('fail')
  await controller.refresh(true)
  await flush()
  const state = controller.state()
  assert.equal(state.failed, true)
  assert.equal(state.snapshot?.tier, 'go')
  assert.equal(view().staleText, '已过期')
  assert.equal(view().tierText, '套餐 Go')
  assert.match(view().loadFailedText ?? '', /上次成功/u)
})

test('打开选择主面板、关闭回到会话；打开时按节流刷新', async () => {
  const { controller, loader, layout, advance } = make({ facts: { showSidebarQuota: true } })
  await flush()
  assert.equal(loader.calls.length, 1)
  advance(QUOTA_PANEL_REFRESH_MS + 1)
  controller.openPanel()
  await flush()
  assert.equal(controller.state().open, true)
  assert.deepEqual(layout, ['opendesign-panel'])
  assert.equal(loader.calls.length, 2)
  controller.closePanel()
  assert.equal(controller.state().open, false)
  assert.deepEqual(layout, ['opendesign-panel', 'null'])
})

test('关掉开关即隐藏并停止一切读取，open 状态一并复位', async () => {
  const { controller, loader, settings, layout, view, advance } = make()
  await flush()
  settings.set({ showSidebarQuota: true })
  await flush()
  controller.openPanel()
  await flush()
  assert.equal(controller.state().open, true)

  settings.set({ showSidebarQuota: false })
  assert.equal(controller.state().open, false)
  assert.equal(view().visible, false)
  advance(QUOTA_PANEL_REFRESH_MS * 2)
  controller.refresh(true)
  await flush()
  assert.equal(loader.calls.length, 1, '关闭后手动刷新也不读取')
  assert.deepEqual(layout, ['opendesign-panel', 'null'])
})

test('dispose 后不再读取也不再发布', async () => {
  const { controller, loader } = make({ facts: { showSidebarQuota: true } })
  await flush()
  controller.dispose()
  await controller.refresh(true)
  await flush()
  assert.equal(loader.calls.length, 1)
})
