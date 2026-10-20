/**
 * Open Design 适配器（ticket 02）—— 只测 HTTP 边界与目录输出，不碰私有实现。
 *
 * 覆盖：选择器里的 12 个模型与过滤、模型解析（上下文/输出上限/档位/视觉）、
 * 流式请求体与消息映射、错误分类、缺凭据文案。响应事件序列本身在
 * `tests/adapter-stream.test.ts` 里覆盖。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import type { GenerateOptions, Message, RequestMessage } from '@deepseek-ai/dsh-llm'
import { LlmError, MessageId, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenDesignAdapter,
  type OpenDesignAdapterDeps,
  type OpenDesignConnectionOptions,
} from '../src/adapter.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let messageSeq = 0
function messageId(): MessageId {
  return MessageId(`msg-${++messageSeq}`)
}

function userMessage(text: string): Message {
  return { id: messageId(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function connection(overrides: Partial<OpenDesignConnectionOptions> = {}): OpenDesignConnectionOptions {
  return {
    apiBase: 'https://models.example.test/v1',
    modelsCachePath: '/tmp/od-models-cache.json',
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    ...overrides,
  }
}

interface RecordedRequest {
  url: string
  init: RequestInit
}

/** 真实 `/v1/models` 响应夹具（脱敏，ticket 03）：目录请求不再访问网络。 */
const MODELS_FIXTURE = readFileSync(new URL('./fixtures/models.json', import.meta.url), 'utf8')

/** A fetch stub that records the request and answers with a canned body (SSE on success). */
function recordingFetch(
  status: number,
  body: string,
  recorded: RecordedRequest[],
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    recorded.push({ url: String(url), init: init ?? {} })
    if (String(url).endsWith('/models')) {
      return new Response(MODELS_FIXTURE, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(body, {
      status,
      headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' },
    })
  }) as unknown as typeof fetch
}

/** 只回答实时目录的 fetch；对话请求走调用方自己的桩。 */
function catalogFetch(): typeof fetch {
  return (async () => new Response(MODELS_FIXTURE, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch
}

function makeAdapter(overrides: Partial<OpenDesignAdapterDeps> = {}): OpenDesignAdapter {
  return new OpenDesignAdapter({
    options: overrides.options ?? (() => connection()),
    resolveApiKey: overrides.resolveApiKey ?? (async () => 'user_test_key'),
    fetchImpl: overrides.fetchImpl ?? catalogFetch(),
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
  })
}

function oneTurn(model: string, overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'open-design',
    model,
    messages: [userMessage('你好')],
    ...overrides,
  }
}

async function collect(options: GenerateOptions, adapter: OpenDesignAdapter): Promise<unknown[]> {
  const chunks: unknown[] = []
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  return chunks
}

/** The parsed request body of the single recorded chat call (catalog reads aside). */
function requestBody(recorded: RecordedRequest[]): Record<string, unknown> {
  const chat = recorded.filter((request) => request.init.method === 'POST')
  assert.equal(chat.length, 1)
  const body = chat[0]?.init.body
  assert.equal(typeof body, 'string')
  return JSON.parse(body as string) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 目录与模型解析
// ---------------------------------------------------------------------------

test('选择器拿到 12 个模型：官方显示名、模态、成本/能力档都在，顺序默认模型置顶', async () => {
  const adapter = makeAdapter()
  const models = await adapter.listModels('open-design')
  assert.equal(models.length, 12)
  assert.deepEqual(models.map((model) => model.id), [
    'deepseek-v4.1-flash',
    'glm-5.3-flash',
    'glm-5.3-flashx',
    'hy4-preview',
    'kimi-k2.7-code',
    'mimo-v2.6-pro',
    'deepseek-v4-pro',
    'claude-haiku-5.5',
    'gpt-6-luna',
    'mimo-v2.6-flash',
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp',
  ])
  for (const model of models) assert.equal(model.provider, 'open-design')
  const byId = new Map(models.map((model) => [model.id, model]))
  assert.equal(byId.get('deepseek-v4.1-flash')?.name, 'DeepSeek V4.1 Flash')
  assert.equal(byId.get('kimi-k2.7-code')?.name, 'Kimi K2.7 Code')
  assert.deepEqual(byId.get('deepseek-v4.1-flash')?.inputModalities, ['text', 'image'])
  assert.deepEqual(byId.get('deepseek-v4-flash')?.inputModalities, ['text'])
  // 成本/能力档作为副标题可见，且不掺美元金额。
  assert.match(byId.get('deepseek-v4.1-flash')?.description ?? '', /advanced/)
  assert.match(byId.get('deepseek-v4.1-flash')?.description ?? '', /low cost/)
})

test('visibleModels 白名单与 modelVisibility 布尔覆盖共同决定可见模型', async () => {
  const allowlisted = makeAdapter({ options: () => connection({ visibleModels: ['glm-5.3-flash', 'kimi-k2.7-code'] }) })
  assert.deepEqual(
    (await allowlisted.listModels('open-design')).map((model) => model.id),
    ['glm-5.3-flash', 'kimi-k2.7-code'],
  )

  const hidden = makeAdapter({ options: () => connection({ modelVisibility: { 'deepseek-v4.1-flash': false } }) })
  const visibleIds = (await hidden.listModels('open-design')).map((model) => model.id)
  assert.equal(visibleIds.length, 11)
  assert.equal(visibleIds.includes('deepseek-v4.1-flash'), false)

  // 显式开关优先于白名单：白名单里的模型也能被单独关掉。
  const mixed = makeAdapter({
    options: () => connection({ visibleModels: ['glm-5.3-flash', 'kimi-k2.7-code'], modelVisibility: { 'glm-5.3-flash': false } }),
  })
  assert.deepEqual(
    (await mixed.listModels('open-design')).map((model) => model.id),
    ['kimi-k2.7-code'],
  )
})

test('resolveModel 给出上下文窗口、输出上限、档位集合与视觉能力', async () => {
  const adapter = makeAdapter()
  const resolved = await adapter.resolveModel('open-design', 'deepseek-v4.1-flash')
  assert.equal(resolved.provider, 'open-design')
  assert.equal(resolved.id, 'deepseek-v4.1-flash')
  assert.equal(resolved.context?.contextWindow, 328_000)
  assert.equal(resolved.defaultMaxTokens, 128_000)
  assert.deepEqual(resolved.inputModalities, ['text', 'image'])
  assert.deepEqual(
    resolved.reasoning?.efforts.map((effort) => effort.id),
    ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => ReasoningEffortId(level)),
  )

  const kimi = await adapter.resolveModel('open-design', 'kimi-k2.7-code')
  assert.equal(kimi.context?.contextWindow, 262_000)
  // kimi 的可用输出被抬到 65536，才能容纳 medium/high 档的思考预算。
  assert.equal(kimi.defaultMaxTokens, 65_536)
  assert.deepEqual(
    kimi.reasoning?.efforts.map((effort) => effort.id),
    ['minimal', 'low', 'medium', 'high', 'xhigh'].map((level) => ReasoningEffortId(level)),
  )

  const glm = await adapter.resolveModel('open-design', 'glm-5.3-flash')
  assert.deepEqual(
    glm.reasoning?.efforts.map((effort) => effort.id),
    ['low', 'high', 'max'].map((level) => ReasoningEffortId(level)),
  )
})

test('思考不可见的模型（gpt-6-luna、claude-haiku-5.5）在目录与模型卡上标注，不让人以为没思考', async () => {
  const models = await makeAdapter().listModels('open-design')
  const byId = new Map(models.map((model) => [model.id, model]))
  assert.match(byId.get('gpt-6-luna')?.description ?? '', /思考不可见/)
  assert.match(byId.get('claude-haiku-5.5')?.description ?? '', /思考不可见/)
  // 会吐 reasoning 的模型不加标注。
  assert.doesNotMatch(byId.get('deepseek-v4.1-flash')?.description ?? '', /思考不可见/)

  const resolved = await makeAdapter().resolveModel('open-design', 'gpt-6-luna')
  assert.match(resolved.description ?? '', /思考不可见/)
})

test('自定义上下文长度（全局与逐模型）覆盖目录值', async () => {
  const adapter = makeAdapter({ options: () => connection({ contextWindow: 100_000 }) })
  assert.equal((await adapter.resolveModel('open-design', 'deepseek-v4.1-flash')).context?.contextWindow, 100_000)

  const perModel = makeAdapter({
    options: () => connection({ contextWindow: 100_000, contextWindowOverrides: { 'glm-5.3-flash': 64_000 } }),
  })
  assert.equal((await perModel.resolveModel('open-design', 'glm-5.3-flash')).context?.contextWindow, 64_000)
  assert.equal((await perModel.resolveModel('open-design', 'deepseek-v4.1-flash')).context?.contextWindow, 100_000)
})

test('快照外的模型不崩：无上下文宣告、按全档处理', async () => {
  const adapter = makeAdapter()
  const resolved = await adapter.resolveModel('open-design', 'brand-new-model')
  assert.equal(resolved.id, 'brand-new-model')
  assert.equal(resolved.name, 'brand-new-model')
  assert.equal(resolved.context, undefined)
  assert.equal(resolved.defaultMaxTokens, undefined)
  assert.equal(resolved.reasoning?.efforts.length, 7)
})

// ---------------------------------------------------------------------------
// 请求体
// ---------------------------------------------------------------------------

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** 一次最小的成功流式应答：只求让请求走完，事件序列由 adapter-stream 测试覆盖。 */
const OK_REPLY = [
  'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"你好！有什么可以帮你？"}}]}',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  'data: [DONE]',
  '',
].join('\n\n')

test('流式请求：URL、鉴权头与请求体字段（模型/消息/流开关与用量/上限/思考档）', async () => {
  const recorded: RecordedRequest[] = []
  const adapter = makeAdapter({ fetchImpl: recordingFetch(200, OK_REPLY, recorded) })
  await collect(oneTurn('deepseek-v4.1-flash', { reasoningEffort: ReasoningEffortId('medium') }), adapter)

  const chat = recorded.find((request) => request.init.method === 'POST')
  assert.equal(chat?.url, 'https://models.example.test/v1/chat/completions')
  const headers = chat?.init.headers as Record<string, string>
  assert.equal(headers.authorization, 'Bearer user_test_key')
  assert.equal(headers['content-type'], 'application/json')
  assert.equal(headers.accept, 'text/event-stream')
  assert.match(headers['user-agent'] ?? '', /dsh|deepseek/i)

  const body = requestBody(recorded)
  assert.equal(body.model, 'deepseek-v4.1-flash')
  assert.equal(body.stream, true)
  assert.deepEqual(body.stream_options, { include_usage: true })
  assert.deepEqual(body.messages, [{ role: 'user', content: '你好' }])
  assert.equal(body.max_completion_tokens, 128_000)
  assert.equal(body.reasoning_effort, 'medium')
  // 上游不认的字段一个都不发。
  assert.equal('max_tokens' in body, false)
  assert.equal('store' in body, false)
  assert.equal('temperature' in body, false)
})

test('off 档发字面量 "none"，未选档位不发 reasoning_effort', async () => {
  const first: RecordedRequest[] = []
  await collect(
    oneTurn('deepseek-v4.1-flash', { reasoningEffort: ReasoningEffortId('off') }),
    makeAdapter({ fetchImpl: recordingFetch(200, OK_REPLY, first) }),
  )
  assert.equal(requestBody(first).reasoning_effort, 'none')

  const second: RecordedRequest[] = []
  await collect(oneTurn('deepseek-v4.1-flash'), makeAdapter({ fetchImpl: recordingFetch(200, OK_REPLY, second) }))
  assert.equal('reasoning_effort' in requestBody(second), false)
})

test('模型不支持的档位在请求前收敛（glm 只发 low/high/max）', async () => {
  const recorded: RecordedRequest[] = []
  await collect(
    oneTurn('glm-5.3-flash', { reasoningEffort: ReasoningEffortId('medium') }),
    makeAdapter({ fetchImpl: recordingFetch(200, OK_REPLY, recorded) }),
  )
  assert.equal(requestBody(recorded).reasoning_effort, 'low')
})

test('宿主给了工具就按 OpenAI function 形态透传；system 与工具结果按角色映射', async () => {
  const recorded: RecordedRequest[] = []
  const adapter = makeAdapter({ fetchImpl: recordingFetch(200, OK_REPLY, recorded) })
  const messages: RequestMessage[] = [
    { ...userMessage('帮我看看时间'), role: 'user' },
    {
      id: messageId(),
      role: 'assistant',
      content: [{ type: 'tool-call', id: ToolCallId('call_1'), name: 'get_time', arguments: '{"city":"Tokyo"}' }],
      source: { kind: 'model', provider: 'open-design', model: 'deepseek-v4.1-flash' },
    },
    {
      id: messageId(),
      role: 'tool',
      content: [{ type: 'text', text: '12:00' }],
      toolCallId: ToolCallId('call_1'),
      source: { kind: 'tool', callId: ToolCallId('call_1') },
    },
  ]
  await collect(
    oneTurn('deepseek-v4.1-flash', {
      system: '你是助理',
      messages,
      tools: [{ name: 'get_time', description: '报时', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
    }),
    adapter,
  )

  const body = requestBody(recorded)
  assert.deepEqual(body.tools, [
    {
      type: 'function',
      function: {
        name: 'get_time',
        description: '报时',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    },
  ])
  assert.deepEqual(body.messages, [
    { role: 'system', content: '你是助理' },
    { role: 'user', content: '帮我看看时间' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{"city":"Tokyo"}' } }],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '12:00' },
  ])
})

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

async function streamError(adapter: OpenDesignAdapter, options: GenerateOptions): Promise<LlmError> {
  try {
    await collect(options, adapter)
  } catch (error) {
    assert.ok(error instanceof LlmError, `expected LlmError, got ${String(error)}`)
    return error
  }
  throw new Error('expected the stream to fail')
}

test('401 归为 AUTH（不可重试），文案指向 Key 的创建/检查', async () => {
  const error = await streamError(
    makeAdapter({ fetchImpl: recordingFetch(401, fixture('error-invalid-key.json'), []) }),
    oneTurn('deepseek-v4.1-flash'),
  )
  assert.equal(error.code, 'AUTH')
  assert.equal(error.failure.status, 401)
  assert.match(error.message, /api-keys/)
  assert.match(error.message, /Key/)
  // 不可重试：AUTH 不在 DSH 的重试码表里。
  assert.equal(['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'].includes(error.code), false)
})

test('402 额度耗尽有明确文案，不可重试', async () => {
  const body = JSON.stringify({ error: { code: 'quota_exhausted', message: 'insufficient credits', type: 'quota' } })
  const error = await streamError(makeAdapter({ fetchImpl: recordingFetch(402, body, []) }), oneTurn('deepseek-v4.1-flash'))
  assert.equal(error.code, 'QUOTA_EXHAUSTED')
  assert.equal(error.failure.status, 402)
  assert.match(error.message, /额度/)
  assert.match(error.message, /BYOK|控制台/)
})

test('400 保留上游真因且不判为可重试', async () => {
  const body = JSON.stringify({
    error: {
      message: '[code=upstream_error] Incorrect role information',
      type: 'upstream_error',
      code: 'upstream_error',
    },
  })
  const error = await streamError(makeAdapter({ fetchImpl: recordingFetch(400, body, []) }), oneTurn('glm-5.3-flash'))
  assert.equal(error.code, 'INVALID_REQUEST')
  assert.match(error.message, /Incorrect role information/)
})

test('5xx 归为 SERVER（可重试）', async () => {
  const error = await streamError(
    makeAdapter({ fetchImpl: recordingFetch(500, '<html>oops</html>', []) }),
    oneTurn('deepseek-v4.1-flash'),
  )
  assert.equal(error.code, 'SERVER')
  assert.equal(error.failure.status, 500)
})

test('developer 角色统一降级为 system（glm 会拒该角色），历史里的思考块不回传', async () => {
  const recorded: RecordedRequest[] = []
  const messages: RequestMessage[] = [
    {
      id: messageId(),
      role: 'developer',
      content: [{ type: 'text', text: '工具声明已更新' }],
      source: { kind: 'user' },
    },
    {
      id: messageId(),
      role: 'assistant',
      content: [
        { type: 'reasoning', text: '内部推理' },
        { type: 'text', text: '好的' },
      ],
      source: { kind: 'model', provider: 'open-design', model: 'deepseek-v4.1-flash' },
    },
  ]
  await collect(
    oneTurn('glm-5.3-flash', { messages }),
    makeAdapter({ fetchImpl: recordingFetch(200, OK_REPLY, recorded) }),
  )
  assert.deepEqual(requestBody(recorded).messages, [
    { role: 'system', content: '工具声明已更新' },
    { role: 'assistant', content: '好的' },
  ])
})
