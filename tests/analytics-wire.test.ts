/**
 * The `opendesign/analytics` wire contract (ticket 12).
 *
 * The browser half receives aggregates only: filter echo, read-coverage facts
 * and per-model counters. The strict parsers are the boundary on both halves,
 * and the shape has no slot for a price, a dollar amount or an estimate.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ANALYTICS_DESCRIPTOR,
  ANALYTICS_ENDPOINT,
  parseAnalyticsQuery,
  parseAnalyticsReport,
  type OpenDesignAnalyticsReport,
} from '../src/analytics-wire.ts'

const REPORT: OpenDesignAnalyticsReport = {
  generatedAt: 1_760_000_000_000,
  scope: { kind: 'recent', sessions: 20 },
  history: {
    available: true,
    sessionsScanned: 3,
    sessionsSkipped: 1,
    eventsScanned: 42,
    inheritedEventsSkipped: 0,
    truncated: false,
  },
  totals: {
    requests: 2,
    sessions: 2,
    succeeded: 1,
    failed: 1,
    interrupted: 0,
    retries: 1,
    inputTokens: 130,
    outputTokens: 35,
    totalTokens: 165,
    requestsWithUsage: 1,
    requestsWithoutUsage: 1,
    firstTokenSamples: 1,
    avgFirstTokenMs: 300,
    durationSamples: 2,
    avgDurationMs: 1_500,
  },
  models: [{
    model: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    cost: 'low',
    capability: 'advanced',
    visible: true,
    calibrated: true,
    requests: 2,
    succeeded: 1,
    failed: 1,
    interrupted: 0,
    retries: 1,
    inputTokens: 130,
    outputTokens: 35,
    totalTokens: 165,
    requestsWithUsage: 1,
    requestsWithoutUsage: 1,
    firstTokenSamples: 1,
    avgFirstTokenMs: 300,
    durationSamples: 2,
    avgDurationMs: 1_500,
  }],
}

test('analytics 端点与描述符挂在共享命名空间，并声明一个 query 参数', () => {
  assert.equal(ANALYTICS_ENDPOINT, 'opendesign/analytics')
  assert.equal(ANALYTICS_DESCRIPTOR.namespace, 'opendesign')
  assert.equal(ANALYTICS_DESCRIPTOR.method, 'analytics')
  assert.equal(ANALYTICS_DESCRIPTOR.parameters.length, 1)
  const parameter = ANALYTICS_DESCRIPTOR.parameters[0]!
  assert.equal(parameter.name, 'query')
  assert.equal(parameter.wire, 'query')
  assert.equal(parameter.source, 'json')
})

test('严格解析筛选条件：最近会话数与日期范围二选一', () => {
  assert.deepEqual(parseAnalyticsQuery({ scope: { kind: 'recent', sessions: 20 } }), {
    scope: { kind: 'recent', sessions: 20 },
  })
  assert.deepEqual(parseAnalyticsQuery({ scope: { kind: 'range', from: 100, to: 200 } }), {
    scope: { kind: 'range', from: 100, to: 200 },
  })
  assert.throws(() => parseAnalyticsQuery({}), /invalid scope/)
  assert.throws(() => parseAnalyticsQuery({ scope: { kind: 'week' } }), /invalid scope.kind/)
  assert.throws(() => parseAnalyticsQuery({ scope: { kind: 'recent', sessions: 0 } }), /recent.sessions/)
  assert.throws(() => parseAnalyticsQuery({ scope: { kind: 'recent', sessions: 101 } }), /recent.sessions/)
  assert.throws(() => parseAnalyticsQuery({ scope: { kind: 'range', from: 200, to: 200 } }), /range/)
})

test('严格解析报告：聚合与筛选原样通过，坏字段拒绝', () => {
  assert.deepEqual(parseAnalyticsReport(REPORT), REPORT)
  const badCost = { ...REPORT, models: [{ ...REPORT.models[0]!, cost: 'free' }] }
  assert.throws(() => parseAnalyticsReport(badCost), /models\[0\]\.cost/)
  const badTotals = { ...REPORT, totals: { ...REPORT.totals, requests: -1 } }
  assert.throws(() => parseAnalyticsReport(badTotals), /totals\.requests/)
  const badHistory = { ...REPORT, history: { ...REPORT.history, available: 'yes' } }
  assert.throws(() => parseAnalyticsReport(badHistory), /history\.available/)
})

test('报告没有任何金额字段，成本维度只是档位词', () => {
  const parsed = parseAnalyticsReport(REPORT)
  const keys = (value: object): string[] => Object.keys(value)
  assert.deepEqual(keys(parsed.totals).filter((key) => /usd|price|money|spend|amount|dollar/i.test(key)), [])
  for (const row of parsed.models) {
    assert.deepEqual(keys(row).filter((key) => /usd|price|money|spend|amount|dollar/i.test(key)), [])
    assert.ok(['low', 'medium', 'high', 'unknown'].includes(row.cost))
  }
  assert.doesNotMatch(JSON.stringify(parsed), /[$≈]|usd|price/i)
})
