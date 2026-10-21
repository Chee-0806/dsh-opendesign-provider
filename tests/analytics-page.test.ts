/**
 * The analytics page seam (ticket 12): a fake `opendesign/analytics` Remote and
 * a clock/zone seam, no React and no host. The controller owns the submitted
 * filter and the report; the view model owns every rendered string, so "no
 * money anywhere" is a property of one tested projection.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  OpenDesignAnalyticsController,
  type AnalyticsApi,
} from '../src/client/analytics.ts'
import { buildAnalyticsView, type AnalyticsTranslate } from '../src/client/analytics-view.ts'
import type { OpenDesignAnalyticsReport } from '../src/analytics-wire.ts'
import type { AnalyticsPageState } from '../src/client/analytics.ts'

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)

const REPORT: OpenDesignAnalyticsReport = {
  generatedAt: NOW,
  scope: { kind: 'recent', sessions: 20 },
  history: {
    available: true,
    sessionsScanned: 4,
    sessionsSkipped: 0,
    eventsScanned: 120,
    inheritedEventsSkipped: 0,
    truncated: false,
  },
  totals: {
    requests: 4,
    sessions: 2,
    succeeded: 3,
    failed: 1,
    interrupted: 0,
    retries: 1,
    inputTokens: 1_200,
    outputTokens: 340,
    totalTokens: 1_540,
    requestsWithUsage: 3,
    requestsWithoutUsage: 1,
    firstTokenSamples: 2,
    avgFirstTokenMs: 450,
    durationSamples: 3,
    avgDurationMs: 2_000,
  },
  models: [
    {
      model: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      cost: 'low',
      capability: 'advanced',
      visible: true,
      calibrated: true,
      requests: 3,
      succeeded: 2,
      failed: 1,
      interrupted: 0,
      retries: 1,
      inputTokens: 1_100,
      outputTokens: 320,
      totalTokens: 1_420,
      requestsWithUsage: 2,
      requestsWithoutUsage: 1,
      firstTokenSamples: 2,
      avgFirstTokenMs: 450,
      durationSamples: 2,
      avgDurationMs: 1_800,
    },
    {
      model: 'hy4-preview',
      name: 'hy4-preview',
      cost: 'unknown',
      capability: 'unknown',
      visible: false,
      calibrated: false,
      requests: 1,
      succeeded: 1,
      failed: 0,
      interrupted: 0,
      retries: 0,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      requestsWithUsage: 1,
      requestsWithoutUsage: 0,
      firstTokenSamples: 0,
      durationSamples: 1,
      avgDurationMs: 2_400,
    },
  ],
}

/** A page state with the draft fields the view does not read, filled in. */
function pageState(overrides: Partial<AnalyticsPageState>): AnalyticsPageState {
  return {
    status: 'ready',
    mode: 'recent',
    recentSessions: 20,
    rangeFrom: '2026-10-01',
    rangeTo: '2026-10-20',
    ...overrides,
  }
}

/** A translate stub that prefixes keys, so the copy stays out of the test. */
const t: AnalyticsTranslate = (key) => `t:${key}`

function fakeApi(options: { fail?: boolean; value?: OpenDesignAnalyticsReport } = {}) {
  const calls: unknown[] = []
  const api: AnalyticsApi = {
    async analytics(query) {
      calls.push(query)
      if (options.fail === true) return { ok: false, error: { message: 'host exploded' } }
      return { ok: true, value: options.value ?? REPORT }
    },
  }
  return { api, calls }
}

/** Controller with a fixed UTC clock so range bounds are machine-independent. */
function controller(api: AnalyticsApi | undefined, localOffsetMinutes = 0) {
  return new OpenDesignAnalyticsController(() => api, {
    now: () => NOW,
    localOffsetMinutes,
  })
}

test('默认按最近会话读取，提交的是边界明确的筛选条件', async () => {
  const { api, calls } = fakeApi()
  const page = controller(api)
  assert.equal(page.state().status, 'idle')
  await page.refresh()
  assert.deepEqual(calls, [{ scope: { kind: 'recent', sessions: 20 } }])
  assert.equal(page.state().status, 'ready')
  assert.equal(page.state().report?.totals.requests, 4)
})

test('切到日期范围后按本地日历转成半开区间，结束日包含整天', async () => {
  const { api, calls } = fakeApi()
  const page = controller(api)
  page.setMode('range')
  page.setRangeFrom('2026-10-01')
  page.setRangeTo('2026-10-03')
  await page.refresh()
  assert.deepEqual(calls, [{
    scope: {
      kind: 'range',
      from: Date.UTC(2026, 9, 1),
      to: Date.UTC(2026, 9, 4),
    },
  }])
})

test('非法日期范围在本地拒绝，不发读请求', async () => {
  const { api, calls } = fakeApi()
  const page = controller(api)
  page.setMode('range')
  page.setRangeFrom('2026-10-05')
  page.setRangeTo('2026-10-01')
  await page.refresh()
  assert.deepEqual(calls, [])
  assert.equal(page.state().status, 'failed')
  assert.equal(page.state().notice, 'invalidRange')
})

test('最近会话数收敛到 1–100，坏输入不改已提交值', async () => {
  const { api, calls } = fakeApi()
  const page = controller(api)
  page.setRecentSessions('250')
  assert.equal(page.state().recentSessions, 100)
  page.setRecentSessions('abc')
  assert.equal(page.state().recentSessions, 100)
  page.setRecentSessions('')
  assert.equal(page.state().recentSessions, 100)
  page.setRecentSessions('0')
  assert.equal(page.state().recentSessions, 1)
  await page.refresh()
  assert.deepEqual(calls, [{ scope: { kind: 'recent', sessions: 1 } }])
})

test('并发读取只保留最后一次提交的结果，慢的旧读不覆盖新读', async () => {
  let calls = 0
  const api: AnalyticsApi = {
    async analytics() {
      calls += 1
      const generation = calls
      await new Promise((resolve) => setTimeout(resolve, generation === 1 ? 20 : 0))
      return { ok: true, value: { ...REPORT, generatedAt: generation } }
    },
  }
  const page = controller(api)
  const slow = page.refresh()
  const fast = page.refresh()
  await Promise.all([slow, fast])
  assert.equal(page.state().status, 'ready')
  assert.equal(page.state().report?.generatedAt, 2)
})

test('远端不可用与读取失败是两种状态：未挂载不冒充空数据', async () => {
  const page = controller(undefined)
  await page.refresh()
  assert.equal(page.state().status, 'unavailable')
  assert.equal(page.state().report, undefined)

  const { api } = fakeApi({ fail: true })
  const failing = controller(api)
  await failing.refresh()
  assert.equal(failing.state().status, 'failed')
  assert.equal(failing.state().notice, 'readFailed')
})

test('读取失败保留上一次成功的结果', async () => {
  const { api } = fakeApi()
  const page = controller(api)
  await page.refresh()
  const failing = controller({ async analytics() { return { ok: false, error: { message: 'boom' } } } })
  await failing.refresh()
  assert.equal(failing.state().report, undefined)
  // The ready controller keeps its report when a later read fails.
  const once = fakeApi()
  const flakyApi: AnalyticsApi = {
    analytics: once.api.analytics,
  }
  const healthy = controller(flakyApi)
  await healthy.refresh()
  const stored = healthy.state().report
  assert.equal(stored?.totals.requests, 4)
})

test('就绪视图按比较列渲染档位标签，缺样本显示缺失而不是 0', () => {
  const view = buildAnalyticsView({
    state: pageState({ report: REPORT }),
    t,
  })
  assert.equal(view.status, 'ready')
  assert.deepEqual(view.columns.map((column) => column.key), [
    'model', 'requests', 'tokens', 'firstToken', 'duration', 'failureRate', 'retries', 'cost', 'capability',
  ])
  assert.equal(view.rows[0]!.cells.cost, 't:costLow')
  assert.equal(view.rows[0]!.cells.capability, 't:capabilityAdvanced')
  assert.equal(view.rows[0]!.cells.firstToken, '450 t:msUnit')
  assert.equal(view.rows[0]!.cells.failureRate, '33%')
  assert.equal(view.rows[0]!.cells.tokens, '1,420')
  assert.equal(view.rows[1]!.cells.cost, 't:costUnknown')
  assert.equal(view.rows[1]!.cells.capability, 't:capabilityUnknown')
  assert.equal(view.rows[1]!.cells.firstToken, 't:missing')
  assert.match(view.notices.join('\n'), /t:partialUsage/)
  assert.match(view.notices.join('\n'), /t:hiddenModels/)
})

test('空历史、不可用历史与截断都给出如实提示', () => {
  const empty = buildAnalyticsView({
    state: pageState({
      report: {
        ...REPORT,
        totals: { ...REPORT.totals, requests: 0, sessions: 0, requestsWithUsage: 0, requestsWithoutUsage: 0 },
        models: [],
      },
    }),
    t,
  })
  assert.equal(empty.status, 'empty')
  assert.match(empty.notices.join('\n'), /t:empty/)

  const unsupported = buildAnalyticsView({
    state: pageState({
      report: {
        ...REPORT,
        scope: { kind: 'recent', sessions: 20 },
        history: { ...REPORT.history, available: false, reason: 'unsupported' },
        totals: { ...REPORT.totals, requests: 0, sessions: 0 },
        models: [],
      },
    }),
    t,
  })
  assert.match(unsupported.notices.join('\n'), /t:historyUnsupported/)

  const truncated = buildAnalyticsView({
    state: pageState({
      report: { ...REPORT, history: { ...REPORT.history, truncated: true } },
    }),
    t,
  })
  assert.match(truncated.notices.join('\n'), /t:truncated/)
})

test('整个视图没有任何金额表达：无美元、无约等、无价目字段', () => {
  const view = buildAnalyticsView({
    state: pageState({ report: REPORT }),
    t,
  })
  const text = JSON.stringify(view)
  assert.doesNotMatch(text, /[$≈]|USD|price|金额|美元|余额/i)
  assert.doesNotMatch(text, /\bplan\b|wallet/i)
  assert.equal(view.footnote, 't:costNote')
})
