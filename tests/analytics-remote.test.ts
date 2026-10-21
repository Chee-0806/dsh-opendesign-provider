/**
 * The Host half of `opendesign/analytics` (ticket 12), over an optional
 * `sessionQuery` service and the adapter's catalog status.
 *
 * Reading history is a read-only, bounded scan: the newest sessions first, at
 * most 100 candidate sessions and 200 000 events, and only the session's own
 * events (the host publishes the exact fork cut). A profile without a
 * session-query service reports `available: false` and an empty report rather
 * than failing, and a catalog that cannot be read leaves tiers `unknown`
 * instead of blanking the usage facts.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Context } from '@deepseek-ai/cordis'

import type { GatewayCatalogStatus } from '../src/gateway-facts.ts'
import {
  collectAnalyticsSessions,
  type SessionQueryLike,
} from '../src/analytics-history.ts'
import { analyticsReport, buildAnalyticsReport } from '../src/analytics-remote.ts'
import { ANALYTICS_DESCRIPTOR } from '../src/analytics-wire.ts'
import { applyModelsRemote } from '../src/models-remote.ts'
import { MODELS_DESCRIPTOR } from '../src/models-wire.ts'
import { foldAnalytics, type HistoryEvent, type HistorySession } from '../src/analytics-fold.ts'
import type { AnalyticsScope } from '../src/analytics-wire.ts'

const START = 1_760_000_000_000

function assistant(time: number, input: number, output: number, model = 'deepseek-v4.1-flash', provider = 'open-design'): HistoryEvent {
  return {
    type: 'assistant/message',
    time,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [], source: { kind: 'model', provider, model } },
      usage: { inputTokens: input, outputTokens: output },
      stream: [{ type: 'chunk', time: time - 500, chunk: { type: 'text-delta', index: 0, text: 'hi' } }],
    },
  }
}

function events(model = 'deepseek-v4.1-flash', input = 100, output = 20): HistoryEvent[] {
  return [
    { type: 'request/header', time: START, data: { header: { config: { provider: 'open-design', model } } } },
    { type: 'step/start', time: START, data: { turn: 1, step: 1 } },
    assistant(START + 1_000, input, output, model),
  ]
}

function fakeSessionQuery(sessions: Array<{ id: string; createdAt: number; events: HistoryEvent[]; inheritedEventCount?: number; broken?: boolean }>): SessionQueryLike & { reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    async listSessions() {
      return [...sessions]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((entry) => ({ header: { id: entry.id, createdAt: entry.createdAt, cwd: '/repo', isSeeded: false } }))
    },
    async readSession(id: string) {
      reads.push(id)
      const entry = sessions.find((candidate) => candidate.id === id)
      if (entry === undefined) throw new Error(`not found: ${id}`)
      if (entry.broken === true) throw new Error('corrupt session')
      return {
        session: { id: entry.id, createdAt: entry.createdAt, isSeeded: false, cwd: '/repo' },
        ...(entry.inheritedEventCount === undefined ? {} : { inheritedEventCount: entry.inheritedEventCount }),
        events: entry.events,
      }
    },
  }
}

const CATALOG: GatewayCatalogStatus = {
  source: 'live',
  apiBase: 'https://runtime.example/v1',
  cached: false,
  models: [
    {
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      contextWindow: 328_000,
      maxTokens: 128_000,
      cost: 'low',
      capability: 'advanced',
      inputModalities: ['text', 'image'],
      reasoningLevels: ['off', 'high'],
      default: true,
      calibrated: true,
    },
  ],
}

function deps(options: {
  query?: SessionQueryLike | undefined
  catalog?: GatewayCatalogStatus | undefined
  catalogFails?: boolean
  hidden?: readonly string[]
} = {}) {
  return {
    sessionQuery: () => options.query,
    catalogStatus: async () => {
      if (options.catalogFails === true) throw new Error('catalog unavailable')
      return options.catalog ?? CATALOG
    },
    isVisible: (id: string) => !(options.hidden ?? []).includes(id),
  }
}

const RECENT: AnalyticsScope = { kind: 'recent', sessions: 20 }

test('有历史时报告带模型聚合、目录档位与可见性，未知模型档位为 unknown', async () => {
  const query = fakeSessionQuery([
    { id: 'old', createdAt: START, events: events('deepseek-v4.1-flash', 100, 20) },
    { id: 'new', createdAt: START + 60_000, events: events('hy4-preview', 40, 10) },
  ])
  const report = await analyticsReport(deps({ query }), { scope: RECENT })

  assert.equal(report.history.available, true)
  assert.equal(report.history.sessionsScanned, 2)
  assert.equal(report.history.truncated, false)
  assert.equal(report.totals.requests, 2)
  assert.equal(report.totals.sessions, 2)
  assert.equal(report.totals.inputTokens, 140)
  assert.equal(report.totals.outputTokens, 30)
  assert.deepEqual(report.models.map((row) => row.model), ['deepseek-v4.1-flash', 'hy4-preview'])
  const known = report.models[0]!
  assert.equal(known.name, 'DeepSeek V4.1 Flash')
  assert.equal(known.cost, 'low')
  assert.equal(known.capability, 'advanced')
  assert.equal(known.calibrated, true)
  assert.equal(known.visible, true)
  assert.equal(known.avgFirstTokenMs, 500)
  const unknown = report.models[1]!
  assert.equal(unknown.cost, 'unknown')
  assert.equal(unknown.capability, 'unknown')
  assert.equal(unknown.calibrated, false)
  assert.equal(unknown.name, 'hy4-preview')
})

test('没有 sessionQuery 时如实报不可用，不抛错也不伪造条目', async () => {
  const report = await analyticsReport(deps(), { scope: RECENT })
  assert.equal(report.history.available, false)
  assert.equal(report.history.reason, 'unsupported')
  assert.deepEqual(report.models, [])
  assert.equal(report.totals.requests, 0)
  assert.equal(report.totals.sessions, 0)
})

test('单个会话读失败只记跳过，其余历史仍然统计', async () => {
  const query = fakeSessionQuery([
    { id: 'good', createdAt: START, events: events() },
    { id: 'bad', createdAt: START + 1_000, events: [], broken: true },
  ])
  const history = await collectAnalyticsSessions(query, RECENT, 'open-design')
  assert.equal(history.coverage.available, true)
  assert.equal(history.coverage.sessionsSkipped, 1)
  assert.equal(history.sessions.length, 1)

  const report = await analyticsReport(deps({ query }), { scope: RECENT })
  assert.equal(report.history.sessionsSkipped, 1)
  assert.equal(report.totals.requests, 1)
})

test('最近会话只取指定数量且只保留有 Open Design 请求的会话', async () => {
  const query = fakeSessionQuery([
    { id: 's1', createdAt: START, events: events() },
    { id: 's2', createdAt: START + 1_000, events: events() },
    { id: 's3', createdAt: START + 2_000, events: events() },
    { id: 'other', createdAt: START + 3_000, events: [
      { type: 'request/header', time: START, data: { header: { config: { provider: 'opencode-go', model: 'x' } } } },
      { type: 'step/start', time: START, data: { turn: 1, step: 1 } },
      assistant(START + 500, 1, 1, 'x', 'opencode-go'),
    ] },
  ])
  const history = await collectAnalyticsSessions(query, { kind: 'recent', sessions: 2 }, 'open-design')
  assert.deepEqual(history.sessions.map((session) => session.id), ['s3', 's2'])
  assert.deepEqual(query.reads, ['other', 's3', 's2'])
})

test('目录读取失败不阻断统计，档位退回 unknown', async () => {
  const query = fakeSessionQuery([{ id: 's1', createdAt: START, events: events() }])
  const report = await analyticsReport(deps({ query, catalogFails: true }), { scope: RECENT })
  assert.equal(report.totals.requests, 1)
  assert.equal(report.models[0]!.cost, 'unknown')
  assert.equal(report.models[0]!.capability, 'unknown')
})

test('日期范围按请求时间半开区间过滤，并回显范围', async () => {
  const query = fakeSessionQuery([
    {
      id: 's1',
      createdAt: START,
      events: [
        { type: 'request/header', time: START, data: { header: { config: { provider: 'open-design', model: 'deepseek-v4.1-flash' } } } },
        { type: 'step/start', time: START, data: { turn: 1, step: 1 } },
        assistant(START + 1_000, 10, 5),
        { type: 'step/start', time: START + 86_400_000, data: { turn: 2, step: 1 } },
        assistant(START + 86_400_000 + 1_000, 20, 6),
      ],
    },
  ])
  const scope: AnalyticsScope = { kind: 'range', from: START, to: START + 86_400_000 }
  const report = await analyticsReport(deps({ query }), { scope })
  assert.deepEqual(report.scope, scope)
  assert.equal(report.totals.requests, 1)
  assert.equal(report.totals.inputTokens, 10)
})

test('buildAnalyticsReport 无目录时保留未知模型行，平均值为整数毫秒', () => {
  const fold = foldAnalytics([{ id: 's1', createdAt: START, events: events() } satisfies HistorySession])
  const report = buildAnalyticsReport({
    scope: RECENT,
    fold,
    coverage: { available: true, sessionsScanned: 1, sessionsSkipped: 0, eventsScanned: 3, inheritedEventsSkipped: 0, truncated: false },
    catalog: undefined,
    isVisible: () => true,
    now: () => START,
  })
  assert.equal(report.generatedAt, START)
  assert.equal(report.models[0]!.cost, 'unknown')
  assert.equal(report.models[0]!.avgFirstTokenMs, 500)
  assert.equal(report.models[0]!.avgDurationMs, 1_000)
})

test('装配在同一个 opendesignUsage 服务上挂出 models 与 analytics 两个方法', async () => {
  const ctx = new Context()
  const contributions: Array<{ package: string; invocations: unknown[] }> = []
  ctx.provide('typert', {
    register(contribution: { package: string; invocations: unknown[] }) {
      contributions.push(contribution)
      return () => {}
    },
  })
  applyModelsRemote(ctx, {
    catalogStatus: async () => CATALOG,
    credentialStatus: async () => ({
      source: 'none',
      reference: 'OPEN_DESIGN_API_KEY',
      apiBase: 'https://runtime.example/v1',
      apiBaseSource: 'default',
      login: { status: 'missing', path: '/nonexistent/.amr/config.json', hasRuntimeKey: false, hasControlKey: false },
    }),
    analytics: deps(),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(contributions.length, 1)
  assert.deepEqual(contributions[0]!.invocations, [MODELS_DESCRIPTOR, ANALYTICS_DESCRIPTOR])
  const service = ctx.get('opendesignUsage') as {
    models?: () => Promise<unknown>
    analytics?: (query: { scope: AnalyticsScope }) => Promise<{ history: { available: boolean } }>
  }
  assert.equal(typeof service.models, 'function')
  assert.equal(typeof service.analytics, 'function')
  const report = await service.analytics!({ scope: RECENT })
  assert.equal(report.history.available, false)
})

test('没有 analytics 依赖时只注册 models 描述符，models 方法保持不变', async () => {
  const ctx = new Context()
  const contributions: Array<{ invocations: unknown[] }> = []
  ctx.provide('typert', {
    register(contribution: { invocations: unknown[] }) {
      contributions.push(contribution)
      return () => {}
    },
  })
  applyModelsRemote(ctx, {
    catalogStatus: async () => CATALOG,
    credentialStatus: async () => ({
      source: 'none',
      reference: 'OPEN_DESIGN_API_KEY',
      apiBase: 'https://runtime.example/v1',
      apiBaseSource: 'default',
      login: { status: 'missing', path: '/nonexistent/.amr/config.json', hasRuntimeKey: false, hasControlKey: false },
    }),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(contributions[0]!.invocations, [MODELS_DESCRIPTOR])
  const service = ctx.get('opendesignUsage') as { analytics?: unknown }
  assert.equal(service.analytics, undefined)
})
