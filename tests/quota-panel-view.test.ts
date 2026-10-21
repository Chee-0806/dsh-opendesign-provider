/**
 * 额度面板 view model（ticket 11）。
 *
 * 只断言「用户看到的数字与文案」：档位、两窗口的已用/上限/百分比、重置时间、
 * 余额、计费口径、过期标注与两种降级；不碰 React，也不碰内部格式化函数。
 * 时间统一按 UTC 断言，避免测试机时区影响。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { QuotaSnapshot } from '../src/control-plane.ts'
import { buildQuotaPanelView, type QuotaPanelViewInput } from '../src/client/panel-view.ts'
import { panelTranslate } from '../src/client/panel-locales.ts'

const GO: QuotaSnapshot = {
  controlPlaneAvailable: true,
  tier: 'go',
  subscriptionStatus: 'active',
  currentPeriodEnd: '2026-11-20T03:18:08.000Z',
  balanceUsd: 1,
  funding: 'coding_plan',
  windows: [
    {
      kind: 'five_hour',
      durationSeconds: 18000,
      usedCredits: 340,
      limitCredits: 50000,
      remainingCredits: 49660,
      resetsAt: '2026-10-20T13:18:08.000Z',
      resetMode: 'anchored_recurring',
    },
    {
      kind: 'seven_day',
      durationSeconds: 604800,
      usedCredits: 14814,
      limitCredits: 150000,
      remainingCredits: 135186,
      resetsAt: '2026-10-27T03:18:08.000Z',
      resetMode: 'anchored_recurring',
    },
  ],
  fetchedAt: '2026-10-20T10:31:46.562Z',
}

/** 一份按界面语言渲染的输入；默认「开关已开、控制密钥可用」。 */
function input(overrides: Partial<QuotaPanelViewInput> = {}): QuotaPanelViewInput {
  return {
    showSidebarQuota: true,
    hasControlKey: true,
    controlKeyKnown: true,
    loading: false,
    failed: false,
    snapshot: GO,
    t: panelTranslate('zh'),
    locale: 'zh',
    timeZone: 'UTC',
    ...overrides,
  }
}

test('Go 档（zh）：档位、5 小时与 7 天窗口、百分比、重置时间、余额与计费口径', () => {
  const view = buildQuotaPanelView(input())
  assert.equal(view.visible, true)
  assert.equal(view.tierText, '套餐 Go')
  assert.equal(view.statusText, '订阅 active')
  assert.equal(view.periodText, '本期至 11月20日 03:18')
  assert.equal(view.balanceText, '钱包余额 $1.00')
  assert.match(view.fundingText ?? '', /Design Plan 额度/u)
  assert.match(view.explainerText, /先扣 Design Plan 额度，再扣套餐额度/u)
  assert.equal(view.staleText, undefined)
  assert.deepEqual(view.windows.map((window) => window.label), ['5 小时窗口', '7 天窗口'])

  const [fiveHour, sevenDay] = view.windows
  assert.equal(fiveHour?.amountText, '340 / 50000 credits')
  assert.equal(fiveHour?.percent, 1)
  assert.equal(fiveHour?.percentText, '1%')
  assert.equal(fiveHour?.remainingPercent, 99)
  assert.equal(fiveHour?.remainingText, '剩余 99%')
  assert.equal(fiveHour?.resetText, '重置 10月20日 13:18')
  assert.equal(sevenDay?.percent, 10)
  assert.equal(sevenDay?.remainingText, '剩余 90%')
  assert.equal(sevenDay?.resetText, '重置 10月27日 03:18')
})

test('同一份数据换英文文案（含本地化重置时间）', () => {
  const view = buildQuotaPanelView(input({ t: panelTranslate('en'), locale: 'en' }))
  assert.equal(view.tierText, 'Plan Go')
  assert.equal(view.balanceText, 'Wallet balance $1.00')
  assert.match(view.fundingText ?? '', /Design Plan credits/u)
  assert.deepEqual(view.windows.map((window) => window.label), ['5-hour window', '7-day window'])
  assert.equal(view.windows[0]?.remainingText, '99% left')
  assert.equal(view.windows[0]?.resetText, 'Resets Oct 20, 13:18')
})

test('非 Go 档不显示 5 小时窗口，但未知时长窗口原样列出', () => {
  const snapshot: QuotaSnapshot = {
    ...GO,
    tier: 'plus',
    windows: [
      ...GO.windows,
      { kind: 'other', durationSeconds: 3600, usedCredits: 0, limitCredits: 1000, remainingCredits: 1000 },
    ],
  }
  const view = buildQuotaPanelView(input({ snapshot }))
  assert.deepEqual(view.windows.map((window) => window.label), ['7 天窗口', '3600 秒窗口'])
  assert.equal(view.windows[1]?.amountText, '0 / 1000 credits')
})

test('零值窗口不除以零：上限未知时百分比显示破折号', () => {
  const snapshot: QuotaSnapshot = {
    ...GO,
    windows: [{ kind: 'seven_day', durationSeconds: 604800, usedCredits: 0, limitCredits: 0, remainingCredits: 0 }],
  }
  const view = buildQuotaPanelView(input({ snapshot }))
  const [window] = view.windows
  assert.equal(window?.amountText, '0 / 0 credits')
  assert.equal(window?.percent, 0)
  assert.equal(window?.percentText, '—')
  assert.equal(window?.remainingText, '—')
  assert.equal(window?.resetText, '重置时间未知')
})

test('已用越界时进度封顶 100%，剩余归零并标注超限', () => {
  const snapshot: QuotaSnapshot = {
    ...GO,
    windows: [{ kind: 'seven_day', durationSeconds: 604800, usedCredits: 120, limitCredits: 100, remainingCredits: 0 }],
  }
  const [window] = buildQuotaPanelView(input({ snapshot })).windows
  assert.equal(window?.percent, 100)
  assert.equal(window?.percentText, '100%')
  assert.equal(window?.remainingPercent, 0)
  assert.equal(window?.overLimit, true)
})

test('数据过期标注「已过期」，仍保留旧值', () => {
  const view = buildQuotaPanelView(input({ snapshot: { ...GO, stale: true } }))
  assert.equal(view.visible, true)
  assert.equal(view.staleText, '已过期')
  assert.equal(view.tierText, '套餐 Go')
  assert.equal(panelTranslate('en')('stale'), 'Stale')
})

test('eligible=false：显示钱包计费口径，不画 0/0 窗口', () => {
  const snapshot: QuotaSnapshot = {
    ...GO,
    tier: 'plus',
    windows: [],
    funding: 'wallet',
  }
  const view = buildQuotaPanelView(input({ snapshot }))
  assert.equal(view.visible, true)
  assert.match(view.fundingText ?? '', /钱包余额/u)
  assert.match(view.emptyText ?? '', /eligible=false/u)
  assert.equal(view.windows.length, 0)
})

test('无控制密钥：不渲染并给出原因', () => {
  const view = buildQuotaPanelView(input({
    hasControlKey: false,
    snapshot: { controlPlaneAvailable: false, windows: [], fetchedAt: '2026-10-20T10:31:46.562Z' },
  }))
  assert.equal(view.visible, false)
  assert.match(view.reasonText ?? '', /controlKey/u)
})

test('开关关闭或加载中：一律不渲染，且关闭时不提示原因', () => {
  assert.equal(buildQuotaPanelView(input({ showSidebarQuota: false })).visible, false)
  assert.equal(buildQuotaPanelView(input({ showSidebarQuota: false })).reasonText, undefined)
  const loading = buildQuotaPanelView(input({ snapshot: undefined, loading: true }))
  assert.equal(loading.visible, false)
  assert.equal(loading.loading, true)
})

test('读取失败时保留上次快照并给出失败说明', () => {
  const view = buildQuotaPanelView(input({ failed: true, snapshot: { ...GO, stale: true } }))
  assert.equal(view.visible, true)
  assert.match(view.loadFailedText ?? '', /上次成功/u)
  assert.equal(view.staleText, '已过期')
})
