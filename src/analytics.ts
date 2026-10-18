/** 在宿主内折叠原始历史；每次请求保留计价时间和上下文，禁止使用已合并的会话成本桶。 */
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { COST_TOKEN_KEYS, pricingKey, requestCost, zeroCostTokens, type CostTokens } from './cost-facts.ts'
import type { CommandCodeModelPrice, CommandCodePriceTable } from './usage-wire.ts'
import type { AnalyticsMetrics, AnalyticsQuery, AnalyticsReport, AnalyticsScenario } from './analytics-wire.ts'
import { isRecord } from './wire-guards.ts'

export interface AnalyticsEvent { seq: number; type: string; time: number; data: unknown }
export interface AnalyticsLog { inheritedEventCount: number; events: readonly AnalyticsEvent[] }
export interface RequestFact {
  session: string; model: string; at: number; retry: boolean; outcome: 'completed' | 'failed' | 'cancelled' | 'unknown'
  tokens?: CostTokens; latencyMs?: number; ttftMs?: number; decodeMs?: number
}
const record = (v: unknown): Record<string, unknown> | undefined => isRecord(v) ? v : undefined
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
function tokensOf(v: unknown): CostTokens | undefined {
  const u = record(v)
  if (!u || !number(u.inputTokens) || !number(u.outputTokens)) return undefined
  if (u.cacheReadTokens !== undefined && !number(u.cacheReadTokens) || u.cacheWriteTokens !== undefined && !number(u.cacheWriteTokens)) return undefined
  return { uncachedInputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens as number ?? 0, cacheWriteTokens: u.cacheWriteTokens as number ?? 0 }
}
/** 同一次尝试的用量覆盖前值；重试开始才新建请求，继承前缀只恢复模型选择。 */
export function foldRequests(session: string, log: AnalyticsLog): RequestFact[] {
  const facts: RequestFact[] = []
  let provider = '', model = '', current: RequestFact | undefined, own = false, started = false, listed = false, turn = -1, step = -1
  const begin = (event: AnalyticsEvent, data: Record<string, unknown>, retry: boolean) => {
    turn = Number(data.turn); step = Number(data.step); own = event.seq >= log.inheritedEventCount; started = true
    current = { session, model, at: event.time, retry, outcome: 'unknown' }
    listed = own && provider === 'commandcode'
    if (listed) facts.push(current)
  }
  for (const event of log.events) {
    const d = record(event.data)
    if (!d) continue
    if (event.type === 'request/header') {
      const config = record(record(d.header)?.config)
      provider = typeof config?.provider === 'string' ? config.provider : ''
      model = typeof config?.model === 'string' ? config.model : ''
      if (current && current.outcome === 'unknown') {
        current.model = model
        if (own && provider === 'commandcode' && !listed) { facts.push(current); listed = true }
        // 当前尝试始终是最后一条；避免每次请求扫描全部历史。
        if (provider !== 'commandcode' && listed) { facts.pop(); listed = false }
      }
      continue
    }
    // 压缩摘要是压缩器自己发的一次 `ctx.llm.stream()`：它不落在任何 turn/step 上，
    // 也不产生 `request/header`，用量只出现在这个事件里。只登记本路由的摘要，并且
    // 不碰 current / listed / provider 状态 —— 摘要在两次请求之间发生，不属于它们。
    // provider 与 model 由事件自带（后端上报），不从上一个 header 继承。
    if (event.type === 'compaction/summary') {
      if (event.seq >= log.inheritedEventCount && d.provider === 'commandcode') {
        const tokens = tokensOf(d.usage)
        facts.push({
          session, model: typeof d.model === 'string' ? d.model : '', at: event.time, retry: false, outcome: 'completed',
          ...tokens === undefined ? {} : { tokens },
        })
      }
      continue
    }
    if (event.type === 'step/start' || event.type === 'llm/retry-started') { begin(event, d, event.type === 'llm/retry-started'); continue }
    if (!current && ['assistant/message', 'assistant/attempt', 'assistant/chunk'].includes(event.type)) {
      begin(event, d, false); started = false
    }
    if (!current) continue
    if (event.type === 'turn/end' && d.turn === turn) {
      const reason = record(d.reason)?.kind
      if (current.outcome === 'unknown') {
        if (reason === 'error') current.outcome = 'failed'
        else if (reason === 'aborted') current.outcome = 'cancelled'
      }
      current = undefined
      continue
    }
    if (d.turn !== turn || d.step !== step) continue
    if (event.type === 'llm/retry') { current.outcome = 'failed'; continue }
    if (!['assistant/message', 'assistant/attempt', 'assistant/chunk'].includes(event.type)) continue
    const chunk = record(d.chunk)
    let tokens = tokensOf(d.usage)
    if (event.type === 'assistant/chunk' && chunk?.type === 'usage') tokens = tokensOf(chunk.usage)
    if (tokens === undefined && Array.isArray(d.stream)) {
      for (let i = d.stream.length - 1; i >= 0; i--) {
        const item = record(d.stream[i]), c = item?.type === 'chunk' ? record(item.chunk) : undefined
        if (c?.type === 'usage') { tokens = tokensOf(c.usage); if (tokens) break }
      }
    }
    if (tokens) current.tokens = tokens
    if (event.type === 'assistant/message') current.outcome = d.interrupted === true ? 'cancelled' : 'completed'
    // 只有保存了定时流的结算才测速度。旧消息的落盘时间不能冒充模型耗时。
    if (started && Array.isArray(d.stream) && event.time >= current.at) {
      current.latencyMs = event.time - current.at
      const first = assistantStreamFirstTokenTime(d.stream as AssistantStreamRecord[])
      if (first !== undefined && first >= current.at && first <= event.time) {
        current.ttftMs = first - current.at
        if (current.tokens) current.decodeMs = event.time - first
      }
    }
  }
  return facts
}

export const emptyMetrics = (): AnalyticsMetrics => ({ sessions: 0, requests: 0, completed: 0, failed: 0, cancelled: 0, unknown: 0, retries: 0, usageSamples: 0, pricedRequests: 0, cost: 0, tokens: zeroCostTokens(), latencySamples: 0, latencyMs: 0, ttftSamples: 0, ttftMs: 0, decodeSamples: 0, decodeMs: 0, decodeTokens: 0 })
function priceRequest(f: RequestFact, id: string, table: CommandCodePriceTable, prices: ReadonlyMap<string, CommandCodeModelPrice>, peakHours?: Map<number, boolean>): number | undefined {
  if (!f.tokens) return undefined
  const price = prices.get(id)
  if (!price) return undefined
  return requestCost(f.tokens, price, f.at, table, peakHours)
}
function aggregate(facts: RequestFact[], table: CommandCodePriceTable, prices: ReadonlyMap<string, CommandCodeModelPrice>, peakHours?: Map<number, boolean>): AnalyticsMetrics {
  const m = emptyMetrics(); m.sessions = new Set(facts.map(f => f.session)).size
  for (const f of facts) {
    m.requests++; m[f.outcome]++; if (f.retry) m.retries++
    if (f.tokens) { m.usageSamples++; for (const k of COST_TOKEN_KEYS) m.tokens[k] += f.tokens[k] }
    const cost = priceRequest(f, f.model, table, prices, peakHours)
    if (cost !== undefined) { m.pricedRequests++; m.cost += cost }
    if (f.latencyMs !== undefined) { m.latencySamples++; m.latencyMs += f.latencyMs }
    if (f.ttftMs !== undefined) { m.ttftSamples++; m.ttftMs += f.ttftMs }
    if (f.decodeMs !== undefined && f.decodeMs > 0 && f.tokens) { m.decodeSamples++; m.decodeMs += f.decodeMs; m.decodeTokens += f.tokens.outputTokens }
  }
  return m
}
export interface ScenarioModel { id: string; name: string; contextWindow: number | null; images: boolean; efforts: string[] }
export function buildAnalytics(facts: RequestFact[], query: AnalyticsQuery, table: CommandCodePriceTable, catalog: ScenarioModel[], now = Date.now()): AnalyticsReport {
  const selected = query.mode === 'range' ? facts.filter(f => f.at >= query.from && f.at < query.to) : facts
  const prices = new Map<string, CommandCodeModelPrice>()
  for (const p of table.models) for (const id of [p.id, p.slug]) if (!prices.has(id)) prices.set(id, p)
  // One memo shared by every pricing question this report asks: the peak-hour
  // answer is a pure function of `at` and this one table.
  const peakHours = new Map<number, boolean>()
  const totals = aggregate(selected, table, prices, peakHours)
  // Bucketing the selection once keeps the per-model totals linear. The previous
  // shape re-filtered the whole selection for every distinct model, which is
  // O(models x facts) — the dominant cost of a long session's report.
  const byModel = new Map<string, RequestFact[]>()
  for (const f of selected) {
    const bucket = byModel.get(f.model)
    if (bucket === undefined) byModel.set(f.model, [f])
    else bucket.push(f)
  }
  const models = [...byModel].map(([id, bucket]) => ({ id, ...aggregate(bucket, table, prices, peakHours) })).sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id))
  const scenarios: AnalyticsScenario[] = catalog.map(model => {
    let cost = 0, pricedRequests = 0, excludedRequests = 0, unknownRequests = 0
    // The candidate's price row is the same for every fact below.
    const price = prices.get(model.id)
    for (const f of selected) {
      if (!f.tokens) { unknownRequests++; continue }
      const context = f.tokens.uncachedInputTokens + f.tokens.cacheReadTokens + f.tokens.cacheWriteTokens
      // 输入和输出同时占据上下文；不适配的请求不得混进可比较的成本。
      if (model.contextWindow !== null && context + f.tokens.outputTokens > model.contextWindow) { excludedRequests++; continue }
      const priced = price === undefined ? undefined : requestCost(f.tokens, price, f.at, table, peakHours)
      if (priced === undefined) unknownRequests++
      else { cost += priced; pricedRequests++ }
    }
    return { ...model, cost, pricedRequests, excludedRequests, unknownRequests }
  })
  const elapsed = query.mode === 'range' ? Math.min(query.to, now) - query.from : 0
  const monthlyEstimate = elapsed >= 86400000 && totals.requests > 0 && totals.pricedRequests === totals.requests
    ? totals.cost * (30 * 86400000 / elapsed) : null
  return { generatedAt: now, pricingKey: pricingKey(table), query, status: 'ready', scannedSessions: 0, matchedSessions: totals.sessions, unreadableSessions: 0, skippedSessions: 0, truncated: false, catalogUnavailable: false, totals, models, scenarios, monthlyEstimate }
}
