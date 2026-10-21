/**
 * Host-side analytics folding (ticket 12), driven at its public seam: a list of
 * already-read session logs (structural events, no Cordis, no filesystem).
 *
 * The fold promises one thing: every Open Design model request recorded in the
 * filtered history is counted exactly once with its tokens, settlement timing,
 * failure/interruption and retry, and nothing is invented for a request whose
 * usage or timing was never recorded. Money is not a concept here at all.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { foldAnalytics, type HistoryEvent, type HistorySession } from '../src/analytics-fold.ts'

const START = 1_760_000_000_000

/** One request header naming the route the following requests use. */
function header(provider: string, model: string, time = START): HistoryEvent {
  return {
    type: 'request/header',
    time,
    data: { header: { config: { provider, model } }, reason: 'initial' },
  }
}

/** One step boundary. */
function stepStart(time: number, turn = 1, step = 1): HistoryEvent {
  return { type: 'step/start', time, data: { turn, step } }
}

/** One settled assistant message; `usage` omitted means the adapter reported none. */
function assistant(
  time: number,
  options: {
    provider?: string
    model?: string
    input?: number
    output?: number
    stream?: HistoryEvent['data']
    interrupted?: true
    turn?: number
    step?: number
  } = {},
): HistoryEvent {
  const provider = options.provider ?? 'open-design'
  const model = options.model ?? 'deepseek-v4.1-flash'
  return {
    type: 'assistant/message',
    time,
    data: {
      turn: options.turn ?? 1,
      step: options.step ?? 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider, model },
      },
      ...(options.input === undefined && options.output === undefined
        ? {}
        : { usage: { inputTokens: options.input ?? 0, outputTokens: options.output ?? 0 } }),
      stream: options.stream ?? [],
      ...(options.interrupted === undefined ? {} : { interrupted: true }),
    },
  }
}

/** One stream carrying a first token at `firstTokenTime`. */
function streamWithFirstToken(firstTokenTime: number): unknown[] {
  return [{
    type: 'chunk',
    time: firstTokenTime,
    chunk: { type: 'text-delta', index: 0, text: 'hi' },
  }]
}

function session(events: HistoryEvent[], options: { inheritedEventCount?: number } = {}): HistorySession {
  return {
    id: 'session-1',
    createdAt: START,
    events,
    ...(options.inheritedEventCount === undefined ? {} : { inheritedEventCount: options.inheritedEventCount }),
  }
}

test('一次成功请求折叠出模型、token 与首字/总时长样本', () => {
  const result = foldAnalytics([
    session([
      header('open-design', 'deepseek-v4.1-flash'),
      stepStart(START),
      assistant(START + 2_000, {
        input: 120,
        output: 30,
        stream: streamWithFirstToken(START + 300),
      }),
    ]),
  ])

  assert.equal(result.models.length, 1)
  const row = result.models[0]!
  assert.equal(row.model, 'deepseek-v4.1-flash')
  assert.equal(row.requests, 1)
  assert.equal(row.succeeded, 1)
  assert.equal(row.failed, 0)
  assert.equal(row.retries, 0)
  assert.equal(row.inputTokens, 120)
  assert.equal(row.outputTokens, 30)
  assert.equal(row.totalTokens, 150)
  assert.equal(row.requestsWithUsage, 1)
  assert.equal(row.requestsWithoutUsage, 0)
  assert.equal(row.firstTokenSamples, 1)
  assert.equal(row.firstTokenMsTotal, 300)
  assert.equal(row.durationSamples, 1)
  assert.equal(row.durationMsTotal, 2_000)
})

test('缺用量只记请求与缺口，不把 token 补成 0', () => {
  const result = foldAnalytics([
    session([
      header('open-design', 'deepseek-v4.1-flash'),
      stepStart(START),
      assistant(START + 1_000),
    ]),
  ])
  const row = result.models[0]!
  assert.equal(row.requests, 1)
  assert.equal(row.requestsWithUsage, 0)
  assert.equal(row.requestsWithoutUsage, 1)
  assert.equal(row.inputTokens, 0)
  assert.equal(row.outputTokens, 0)
  assert.equal(row.totalTokens, 0)
})

test('失败尝试记失败、中断记中断，重试是同一 step 内的第二次尝试', () => {
  const attempt: HistoryEvent = {
    type: 'assistant/attempt',
    time: START + 1_000,
    data: { turn: 1, step: 1, stream: [] },
  }
  const result = foldAnalytics([
    session([
      header('open-design', 'deepseek-v4.1-flash'),
      stepStart(START),
      attempt,
      assistant(START + 4_000, { input: 10, output: 5, stream: streamWithFirstToken(START + 3_000) }),
      assistant(START + 6_000, { interrupted: true }),
    ]),
  ])
  const row = result.models[0]!
  assert.equal(row.requests, 3)
  assert.equal(row.failed, 1)
  assert.equal(row.succeeded, 1)
  assert.equal(row.interrupted, 1)
  // Every attempt after the step's first is one retry: three attempts → two.
  assert.equal(row.retries, 2)
  // The retry starts where the failed attempt settled, so its first token is
  // measured from there and its total duration spans 4000 → 6000 only once.
  assert.equal(row.firstTokenSamples, 1)
  assert.equal(row.firstTokenMsTotal, 2_000)
  assert.equal(row.durationSamples, 3)
})

test('压缩摘要自带的模型与用量单独记一条请求，且不算重试', () => {
  const result = foldAnalytics([
    session([
      header('open-design', 'deepseek-v4.1-flash'),
      stepStart(START),
      assistant(START + 1_000, { input: 10, output: 5 }),
      {
        type: 'compaction/summary',
        time: START + 2_000,
        data: {
          compactionId: 'c-1',
          summary: [{ type: 'text', text: '摘要' }],
          provider: 'open-design',
          model: 'deepseek-v4-pro',
          usage: { inputTokens: 4_000, outputTokens: 700 },
        },
      },
    ]),
  ])
  const pro = result.models.find((row) => row.model === 'deepseek-v4-pro')
  assert.ok(pro, '压缩摘要的模型必须出现在聚合里')
  assert.equal(pro.requests, 1)
  assert.equal(pro.succeeded, 1)
  assert.equal(pro.retries, 0)
  assert.equal(pro.totalTokens, 4_700)
  assert.equal(pro.durationSamples, 0)
})

test('只计本提供商自有事件：继承前缀不重复计数，其他提供商不计', () => {
  const inherited: HistoryEvent[] = [
    header('open-design', 'deepseek-v4.1-flash'),
    stepStart(START),
    assistant(START + 1_000, { input: 1_000, output: 500 }),
  ]
  const result = foldAnalytics([
    session([
      ...inherited,
      // The fork's own cut: anything before it belongs to the parent.
      header('open-design', 'deepseek-v4.1-flash', START + 5_000),
      stepStart(START + 5_000, 1, 1),
      assistant(START + 7_000, { input: 20, output: 7 }),
      header('other-provider', 'gpt-6-luna', START + 8_000),
      stepStart(START + 8_000, 1, 2),
      assistant(START + 9_000, { provider: 'other-provider', model: 'gpt-6-luna', input: 99, output: 99 }),
    ], { inheritedEventCount: inherited.length }),
  ])
  assert.equal(result.models.length, 1)
  const row = result.models[0]!
  assert.equal(row.model, 'deepseek-v4.1-flash')
  assert.equal(row.requests, 1)
  assert.equal(row.inputTokens, 20)
  assert.equal(row.outputTokens, 7)
  assert.equal(result.sessions, 1)
  assert.equal(result.inheritedEventsSkipped, inherited.length)
})
