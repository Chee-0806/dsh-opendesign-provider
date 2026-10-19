import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { buildAnalytics, foldRequests, type AnalyticsEvent, type RequestFact } from '../src/analytics.ts'
import { createAnalyticsReader, readAnalyticsHistory, ANALYTICS_SESSION_LIMIT, ANALYTICS_EVENT_LIMIT } from '../src/analytics-history.ts'
import { parseAnalyticsQuery, parseAnalyticsReport } from '../src/analytics-wire.ts'
import { modelPriceTable } from '../src/model-prices.ts'
import { AnalyticsController } from '../src/client/analytics.ts'
import { dateRange, knownCostShare } from '../src/client/analytics-view.tsx'
import { compareScenario } from '../src/client/analytics-comparison.ts'
import type { AnalyticsReport } from '../src/analytics-wire.ts'
import type { CommandCodePriceTable } from '../src/usage-wire.ts'
const off = Date.parse('2026-10-05T00:00:00Z'), peak = off + 2 * 3600000
const table: CommandCodePriceTable = { peakHours: [[1, 4]], models: [
  { id: 'm', slug: 'm', inputCost: 1, outputCost: 2, cacheReadCost: .1, cacheWriteCost: 3, peak: { inputCost: 2, outputCost: 4, cacheReadCost: .2, cacheWriteCost: 6 } },
  { id: 'tier', slug: 'tier', inputCost: 1, outputCost: 1, cacheReadCost: 1, contextTiers: [{ maxContext: 100, inputCost: 1, outputCost: 1, cacheReadCost: 1 }, { inputCost: 10, outputCost: 10, cacheReadCost: 10 }] },
  { id: 'no-write', slug: 'no-write', inputCost: 1, outputCost: 1, cacheReadCost: 1 },
  { id: 'free', slug: 'free', inputCost: 0, outputCost: 0, cacheReadCost: 0, free: true },
] }
const catalog = [{ id: 'm', name: 'M', contextWindow: 10000000, images: true, efforts: ['high'] }]
const recent = { mode: 'recent' as const, limit: 20 }
function log(model = 'm') {
  const events: AnalyticsEvent[] = []
  const send = (type: string, data: unknown, time = off) => events.push({ seq: events.length, type, data, time })
  const start = (turn = 1, at = off, provider = 'commandcode') => {
    send('step/start', { turn, step: 1 }, at)
    send('request/header', { header: { config: { provider, model } } }, at)
  }
  const message = (inputTokens: number, turn = 1, extra = {}, at = off + 1500) => send('assistant/message', { turn, step: 1, usage: { inputTokens, outputTokens: 10 }, ...extra }, at)
  const facts = () => foldRequests('s', { events, inheritedEventCount: 0 })
  return { events, send, start, message, facts }
}
const fact = (at = off): RequestFact => ({ session: 's', model: 'm', at, retry: false, outcome: 'completed', tokens: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 10 } })
test('每次请求保留价格时段，时间过滤不使用合并成本桶', () => {
  const facts = [fact(), fact(peak)], all = buildAnalytics(facts, recent, table, catalog)
  assert.ok(Math.abs(all.totals.cost - .000519) < 1e-12)
  const range = buildAnalytics(facts, { mode: 'range', from: peak, to: peak + 1000 }, table, catalog)
  assert.equal(range.totals.requests, 1)
  assert.ok(Math.abs(range.totals.cost - .000346) < 1e-12)
})
test('压缩摘要按事件自带的 provider 与 model 单独登记，且不打断前后请求', () => {
  const h = log(); h.start(); h.message(100)
  h.send('compaction/summary', { provider: 'commandcode', model: 'm', usage: { inputTokens: 40, outputTokens: 8 } }, off + 5000)
  h.start(2, off + 10000); h.message(200, 2, {}, off + 11000)
  const facts = h.facts()
  assert.equal(facts.length, 3, '两次请求加一次摘要')
  const summary = facts[1]!
  assert.equal(summary.model, 'm')
  assert.equal(summary.outcome, 'completed')
  assert.equal(summary.retry, false)
  assert.deepEqual(summary.tokens, { uncachedInputTokens: 40, outputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(facts[2]!.tokens!.uncachedInputTokens, 200, '摘要之后的请求仍按自己的 step 折叠')
  const totals = buildAnalytics(facts, recent, table, catalog).totals
  assert.equal(totals.requests, 3)
  assert.equal(totals.tokens.outputTokens, 10 + 8 + 10)
})
test('别的 provider 写的摘要不进本路由的历史分析', () => {
  const h = log(); h.start(); h.message(100)
  h.send('compaction/summary', { provider: 'deepseek', model: 'm', usage: { inputTokens: 40, outputTokens: 8 } }, off + 5000)
  assert.equal(h.facts().length, 1)
})
test('摘要没有上报用量时仍登记请求，但不编造 token', () => {
  const h = log(); h.start(); h.message(100)
  h.send('compaction/summary', { provider: 'commandcode', model: 'm' }, off + 5000)
  const facts = h.facts()
  assert.equal(facts.length, 2)
  assert.equal(facts[1]!.tokens, undefined)
})
test('分支继承前缀恢复模型选择但不重复计费', () => {
  const h = log(); h.start(); h.message(100)
  const cut = h.events.length
  h.send('step/start', { turn: 2, step: 1 }, peak); h.message(200, 2)
  const own = foldRequests('child', { events: h.events, inheritedEventCount: cut })
  assert.equal(own.length, 1); assert.equal(own[0]!.model, 'm'); assert.equal(own[0]!.tokens!.uncachedInputTokens, 200)
  assert.equal(buildAnalytics([...h.facts().slice(0, 1), ...own], recent, table, catalog).totals.tokens.uncachedInputTokens, 300)
})
test('重试尝试分别计费，用量结算覆盖前值，取消等待不增加已执行重试', () => {
  const h = log(); h.start()
  h.send('assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: off + 200, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 2 } } }] }, off + 300)
  h.send('llm/retry', { turn: 1, step: 1 })
  h.send('llm/retry-started', { turn: 1, step: 1 }, off + 1000)
  h.send('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 200, outputTokens: 5 } } })
  h.message(250)
  const m = buildAnalytics(h.facts(), recent, table, catalog).totals
  assert.equal(m.requests, 2); assert.equal(m.retries, 1); assert.equal(m.failed, 1); assert.equal(m.completed, 1); assert.equal(m.tokens.uncachedInputTokens, 350)
  const wait = log(); wait.start(); wait.send('llm/retry', { turn: 1, step: 1 }); wait.send('turn/end', { turn: 1, reason: { kind: 'aborted' } })
  assert.equal(buildAnalytics(wait.facts(), recent, table, []).totals.retries, 0)
})
test('工具错误不算模型失败，取消与未结算请求分列', () => {
  const h = log(); h.start(); h.message(10); h.send('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'TOOL' } } })
  h.start(2); h.message(20, 2, { interrupted: true }); h.send('turn/end', { turn: 2, reason: { kind: 'aborted' } })
  h.start(3)
  const m = buildAnalytics(h.facts(), recent, table, []).totals
  assert.equal(m.completed, 1); assert.equal(m.failed, 0); assert.equal(m.cancelled, 1); assert.equal(m.unknown, 1)
})
test('只有有定时流的结算进入速度样本，首词元和解码用正确分母', () => {
  const h = log(); h.start(); h.message(10, 1, { stream: [{ type: 'text-chunks', time0: off + 500, index: 0, dt: [0, 100], texts: ['a', 'b'] }] })
  h.start(2); h.message(20, 2)
  const m = buildAnalytics(h.facts(), recent, table, []).totals
  assert.equal(m.latencySamples, 1); assert.equal(m.latencyMs, 1500); assert.equal(m.ttftMs, 500); assert.equal(m.decodeMs, 1000); assert.equal(m.decodeTokens, 10)
})
test('没有输出的定时尝试仍记录响应耗时，不制造首词元或输出速度', () => {
  const h = log(); h.start()
  h.send('assistant/attempt', { turn: 1, step: 1, stream: [] }, off + 500)
  h.send('turn/end', { turn: 1, reason: { kind: 'error' } })
  const m = buildAnalytics(h.facts(), recent, table, []).totals
  assert.equal(m.latencySamples, 1); assert.equal(m.latencyMs, 500)
  assert.equal(m.ttftSamples, 0); assert.equal(m.decodeSamples, 0); assert.equal(m.usageSamples, 0)
})
test('缺用量、缺价格和缺缓存写价格保持未知，免费模型的缓存写不会变成未知', () => {
  const h = log(); h.start(); h.send('assistant/message', { turn: 1, step: 1, message: { text: 'private-sentinel' } })
  const unpriced = buildAnalytics([...h.facts(), { ...fact(), model: 'absent' }, { ...fact(), model: 'no-write' }, { ...fact(), model: 'free' }], recent, table, catalog)
  assert.equal(unpriced.totals.usageSamples, 3); assert.equal(unpriced.totals.pricedRequests, 1); assert.equal(unpriced.totals.cost, 0)
  assert.ok(!JSON.stringify(unpriced).includes('private-sentinel'))
})
test('阶梯按每次上下文选档，试算上下文同时包含输出', () => {
  const a = fact(); a.tokens = { uncachedInputTokens: 70, cacheReadTokens: 30, cacheWriteTokens: 0, outputTokens: 20 }
  const b = { ...a, tokens: { ...a.tokens, uncachedInputTokens: 71 } }
  const r = buildAnalytics([a, b], recent, table, [{ ...catalog[0]!, id: 'tier', contextWindow: 120 }])
  assert.equal(r.scenarios[0]!.pricedRequests, 1); assert.equal(r.scenarios[0]!.excludedRequests, 1); assert.equal(r.scenarios[0]!.cost, .00012)
  const both = buildAnalytics([a, b], recent, table, [{ ...catalog[0]!, id: 'tier', contextWindow: null }])
  assert.ok(Math.abs(both.scenarios[0]!.cost - .00133) < 1e-12)
})
test('30 天折算仅用于完整用量和至少一天的时间窗口', () => {
  const range = { mode: 'range' as const, from: off, to: off + 2 * 86400000 }
  const r = buildAnalytics([fact()], range, table, [], range.to)
  assert.ok(Math.abs(r.monthlyEstimate! - r.totals.cost * 15) < 1e-12)
  assert.equal(buildAnalytics([fact()], recent, table, []).monthlyEstimate, null)
  assert.equal(buildAnalytics([{ ...fact(), model: 'unknown' }], range, table, [], range.to).monthlyEstimate, null)
})
test('各模型以同一观察范围折算 30 天，并与完整历史工作量比较差额', () => {
  const range = { mode: 'range' as const, from: off, to: off + 2 * 86400000 }
  // 原工作量含峰谷、缓存写入与不同实际模型；目标仍按每次请求时段重算。
  const r = buildAnalytics([fact(), fact(peak), { ...fact(), model: 'free' }], range, table, [catalog[0]!, { ...catalog[0]!, id: 'free' }], range.to)
  const m = r.scenarios[0]!, result = compareScenario(r, m)
  assert.ok(Math.abs(result.monthly.value! - m.cost * 15) < 1e-12)
  assert.ok(Math.abs(result.difference.value! - (m.cost - r.totals.cost)) < 1e-12)
  assert.ok(Math.abs(result.differencePercent! - (m.cost / r.totals.cost - 1) * 100) < 1e-10)
  assert.deepEqual(compareScenario(r, r.scenarios[1]!), { monthly: { value: 0 }, difference: { value: -r.totals.cost }, differencePercent: -100 })
})
test('相同模型的价格试算与历史基准相同，最近会话可比较差额但不折算月份', () => {
  const r = buildAnalytics([fact(), fact(peak)], recent, table, catalog)
  assert.deepEqual(compareScenario(r, r.scenarios[0]!), { monthly: { value: null, reason: 'recent' }, difference: { value: 0 }, differencePercent: 0 })
})
test('基准为零仍比较金额，不产生无穷比例或把免费试算当成未知', () => {
  const range = { mode: 'range' as const, from: off, to: off + 86400000 }
  const r = buildAnalytics([{ ...fact(), model: 'free' }], range, table, [catalog[0]!, { ...catalog[0]!, id: 'free' }], range.to)
  assert.equal(compareScenario(r, r.scenarios[0]!).difference.value, r.scenarios[0]!.cost)
  assert.equal(compareScenario(r, r.scenarios[0]!).differencePercent, null)
  assert.deepEqual(compareScenario(r, r.scenarios[1]!), { monthly: { value: 0 }, difference: { value: 0 }, differencePercent: null })
})
test('未读全历史不折算或比较，缺少候选价格与超上下文分别说明原因', () => {
  const range = { mode: 'range' as const, from: off, to: off + 86400000 }
  const r = buildAnalytics([fact()], range, table, catalog, range.to), m = r.scenarios[0]!
  for (const flag of [{ truncated: true }, { unreadableSessions: 1 }, { skippedSessions: 1 }]) {
    assert.deepEqual(compareScenario({ ...r, ...flag }, m), { monthly: { value: null, reason: 'partial' }, difference: { value: null, reason: 'partial' }, differencePercent: null })
  }
  for (const [scenario, reason] of [
    [{ ...m, pricedRequests: 0, unknownRequests: 1 }, 'coverage'],
    [{ ...m, pricedRequests: 0, excludedRequests: 1 }, 'excluded'],
  ] as const) {
    const result = compareScenario(r, scenario)
    assert.equal(result.monthly.reason, reason); assert.equal(result.difference.reason, reason)
    assert.equal(result.monthly.value, null); assert.equal(result.difference.value, null)
  }
})
test('部分覆盖即使数量相同也不比较；基准缺价不阻断独立可计价的候选月度试算', () => {
  const range = { mode: 'range' as const, from: off, to: off + 86400000 }
  const r = buildAnalytics([fact(), { ...fact(), model: 'unknown' }], range, table, catalog, range.to)
  const result = compareScenario(r, r.scenarios[0]!)
  assert.ok(Math.abs(result.monthly.value! - r.scenarios[0]!.cost * 30) < 1e-12)
  assert.deepEqual(result.difference, { value: null, reason: 'baseline' })
  // 历史和候选都只计价一条，但不能证明是哪条；禁止只按计价数量相等直接相减。
  const partial = compareScenario(r, { ...r.scenarios[0]!, pricedRequests: 1, unknownRequests: 1 })
  assert.deepEqual(partial.difference, { value: null, reason: 'coverage' })
})
test('月度观察窗固定到报告生成时刻，不计未来空白天数或随客户端时间漂移', () => {
  const range = { mode: 'range' as const, from: off, to: off + 10 * 86400000 }
  const r = buildAnalytics([fact()], range, table, catalog, off + 2 * 86400000)
  assert.ok(Math.abs(compareScenario(r, r.scenarios[0]!).monthly.value! - r.scenarios[0]!.cost * 15) < 1e-12)
  assert.deepEqual(compareScenario({ ...r, generatedAt: off + 86400000 - 1 }, r.scenarios[0]!).monthly, { value: null, reason: 'short-range' })
  const empty = buildAnalytics([], range, table, catalog, range.to)
  assert.deepEqual(compareScenario(empty, empty.scenarios[0]!).monthly, { value: null, reason: 'empty' })
})
test('严格查询拒绝越界，响应拒绝畸形覆盖率并剥离正文', () => {
  for (const q of [{ mode: 'recent', limit: 0 }, { mode: 'recent', limit: 101 }, { mode: 'recent', limit: 1.5 }, { mode: 'range', from: off, to: off }, { mode: 'range', from: off, to: off + 367 * 86400000 }]) assert.throws(() => parseAnalyticsQuery(q))
  const r = buildAnalytics([fact()], recent, table, catalog)
  assert.deepEqual(parseAnalyticsReport({ ...r, content: 'private-sentinel' }), r)
  assert.throws(() => parseAnalyticsReport({ ...r, totals: { ...r.totals, pricedRequests: 2 } }))
  assert.throws(() => parseAnalyticsReport({ ...r, totals: { ...r.totals, cost: NaN } }))
})
test('历史包含关闭会话，最近会话按请求时间挑选，目录失败不阻断统计', async () => {
  const id = modelPriceTable().models[0]!.id, a = log(id), b = log(id)
  a.start(1, peak); a.message(200); b.start(1, off); b.message(100)
  const history = { async listSessions() { return [{ header: { id: 'b' } }, { header: { id: 'closed' } }, { header: { id: 'bad' } }] }, async readSession(id: string) { if (id === 'bad') throw new Error('private-path'); return { inheritedEventCount: 0, events: id === 'closed' ? a.events : b.events } } }
  const r = await readAnalyticsHistory(history, { mode: 'recent', limit: 1 }, async () => { throw new Error('no-key') })
  assert.equal(r.totals.sessions, 1); assert.equal(r.totals.tokens.uncachedInputTokens, 200); assert.equal(r.scannedSessions, 3); assert.equal(r.unreadableSessions, 1); assert.equal(r.catalogUnavailable, true)
  assert.ok(!JSON.stringify(r).includes('private-path')); assert.ok(!JSON.stringify(r).includes('closed'))
})
test('日期包括截止日且无效日历日期不被自动滚入下月', () => {
  const range = dateRange('2026-10-01', '2026-10-01')
  assert.equal(range.mode, 'range')
  if (range.mode === 'range') {
    assert.equal(new Date(range.from).getDate(), 1)
    assert.equal(new Date(range.to).getDate(), 2)
    assert.equal(new Date(range.to).getHours(), 0)
  }
  assert.throws(() => dateRange('2026-02-30', '2026-03-01'))
  assert.throws(() => dateRange('2026-10-02', '2026-10-01'))
})
test('已知成本占比只使用计价小计，已知零成本与无占比保持区别', () => {
  assert.equal(knownCostShare({ cost: .25, pricedRequests: 2 }, 1), 25)
  assert.equal(knownCostShare({ cost: 0, pricedRequests: 1 }, 1), 0)
  assert.equal(knownCostShare({ cost: 0, pricedRequests: 1 }, 0), null)
  assert.equal(knownCostShare({ cost: 0, pricedRequests: 0 }, 1), null)
})
test('读取上限、继承边界缺失、取消与不可用宿主均可区分', async () => {
  let reads = 0
  const h = { async listSessions() { return Array.from({ length: ANALYTICS_SESSION_LIMIT + 1 }, (_, i) => ({ header: { id: String(i) } })) }, async readSession() { reads++; return { inheritedEventCount: -1, events: [] } } }
  const r = await readAnalyticsHistory(h, recent, async () => [])
  assert.equal(reads, ANALYTICS_SESSION_LIMIT); assert.equal(r.skippedSessions, ANALYTICS_SESSION_LIMIT); assert.equal(r.truncated, true)
  const large = { async listSessions() { return [{ header: { id: 'large' } }] }, async readSession() { return { inheritedEventCount: 0, events: new Array(ANALYTICS_EVENT_LIMIT + 1) as AnalyticsEvent[] } } }
  assert.equal((await readAnalyticsHistory(large, recent, async () => [])).truncated, true)
  assert.equal((await readAnalyticsHistory(undefined, recent, async () => [])).status, 'unavailable')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(readAnalyticsHistory(h, recent, async () => [], controller.signal), /取消/)
})
test('可选历史绑定使用真实 Cordis 生命周期，替换或卸载后不保留旧服务', async () => {
  const ctx = new Context(), adapter = { async listModels() { return [] }, async resolveModel() { throw new Error('unused') } }
  const read = createAnalyticsReader(ctx, adapter)
  assert.equal((await read(recent)).status, 'unavailable')
  class History extends Service {
    constructor(c: Context) { super(c, 'sessionQuery') }
    async listSessions() { return [] }
    async readSession() { return { inheritedEventCount: 0, events: [] } }
  }
  const fiber = ctx.plugin({ apply(c: Context) { new History(c) } })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal((await read(recent)).status, 'ready')
  await fiber.dispose(); await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal((await read(recent)).status, 'unavailable')
})
test('浏览器丢弃旧查询和卸载后结果，缺失接口明确降级', async () => {
  const waiting: Array<(r: { ok: true; value: AnalyticsReport }) => void> = []
  const calls: unknown[] = []
  const c = new AnalyticsController({ analytics: query => { calls.push(query); return new Promise(resolve => waiting.push(resolve)) } })
  c.refresh({ mode: 'recent', limit: 1 }); c.refresh({ mode: 'recent', limit: 2 })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [{ mode: 'recent', limit: 1 }, { mode: 'recent', limit: 2 }])
  waiting[1]!({ ok: true, value: buildAnalytics([], { mode: 'recent', limit: 2 }, table, []) })
  await new Promise(resolve => setImmediate(resolve)); waiting[0]!({ ok: true, value: buildAnalytics([], { mode: 'recent', limit: 1 }, table, []) })
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(c.state().report!.query, { mode: 'recent', limit: 2 })
  c.refresh(); await new Promise(resolve => setImmediate(resolve)); c.dispose(); waiting[2]!({ ok: true, value: buildAnalytics([], recent, table, []) })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(c.state().status, 'loading')
  const old = new AnalyticsController({}); old.refresh(); assert.match(old.state().error!, /更新插件/)
})
