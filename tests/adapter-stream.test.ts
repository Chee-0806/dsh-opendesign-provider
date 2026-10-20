/**
 * Open Design 适配器（ticket 04）—— 只测 HTTP 边界：请求体与 `stream()` 对外
 * 产出的事件序列。夹具来自协议实测（`docs/grill/20261020-opendesign-protocol-probe.md`
 * §3.3–§3.6）：`data:` 帧、`reasoning` 非标准字段、流内 usage 尾帧、缺
 * `finish_reason`、`[DONE]` 终止。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { LlmError, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenDesignAdapter,
  type OpenDesignAdapterDeps,
  type OpenDesignConnectionOptions,
} from '../src/adapter.ts'

// ---------------------------------------------------------------------------
// 桩与夹具
// ---------------------------------------------------------------------------

let messageSeq = 0

function userMessage(text: string): Message {
  return {
    id: `msg-${++messageSeq}` as MessageId,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

function connection(overrides: Partial<OpenDesignConnectionOptions> = {}): OpenDesignConnectionOptions {
  return {
    apiBase: 'https://models.example.test/v1',
    modelsCachePath: '/tmp/od-stream-models-cache.json',
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    ...overrides,
  }
}

interface RecordedRequest {
  url: string
  init: RequestInit
}

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** 真实 `/v1/models` 夹具：对话路径不访问网络，但测试桩仍要能应答目录请求。 */
const MODELS_FIXTURE = fixture('models.json')

function modelsResponse(): Response {
  return new Response(MODELS_FIXTURE, { status: 200, headers: { 'content-type': 'application/json' } })
}

/** 一个按 SSE 应答的 fetch 桩；每个 POST 依次消费 `bodies`，用完后重放最后一个。 */
function sseFetch(
  bodies: readonly string[] | (() => Response),
  recorded: RecordedRequest[] = [],
): typeof fetch {
  let cursor = 0
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/models')) return modelsResponse()
    recorded.push({ url: String(url), init: init ?? {} })
    if (typeof bodies === 'function') return bodies()
    const body = bodies[Math.min(cursor, bodies.length - 1)] ?? ''
    cursor += 1
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
}

/** 把一个响应体切成任意大小的读取片：真实网络不会按行边界交付。 */
function chunkedResponse(fragments: readonly string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const fragment of fragments) controller.enqueue(encoder.encode(fragment))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function makeAdapter(overrides: Partial<OpenDesignAdapterDeps> = {}): OpenDesignAdapter {
  return new OpenDesignAdapter({
    options: overrides.options ?? (() => connection()),
    resolveApiKey: overrides.resolveApiKey ?? (async () => 'user_test_key'),
    fetchImpl: overrides.fetchImpl ?? sseFetch([fixture('stream-text.sse')]),
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

/** 一个 block-end 事件（测试里读回装配好的块）。 */
function isBlockEnd(chunk: unknown): chunk is { type: 'block-end'; index: number; block: ContentBlock } {
  return typeof chunk === 'object' && chunk !== null && (chunk as { type?: unknown }).type === 'block-end'
}

async function collect(options: GenerateOptions, adapter: OpenDesignAdapter): Promise<unknown[]> {
  const chunks: unknown[] = []
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  return chunks
}

/** 每次对话请求（目录读取除外）的解析后请求体，按发出顺序。 */
function requestBodies(recorded: RecordedRequest[]): Array<Record<string, unknown>> {
  return recorded
    .filter((request) => request.init.method === 'POST')
    .map((request) => {
      assert.equal(typeof request.init.body, 'string')
      return JSON.parse(request.init.body as string) as Record<string, unknown>
    })
}

/** 单次对话请求的解析后请求体。 */
function requestBody(recorded: RecordedRequest[]): Record<string, unknown> {
  const bodies = requestBodies(recorded)
  assert.equal(bodies.length, 1)
  return bodies[0] ?? {}
}

// ---------------------------------------------------------------------------
// 流式骨架
// ---------------------------------------------------------------------------

test('请求真 SSE（stream + include_usage），正文增量逐帧产出，尾帧 usage 与正常结束', async () => {
  const recorded: RecordedRequest[] = []
  const adapter = makeAdapter({ fetchImpl: sseFetch([fixture('stream-text.sse')], recorded) })
  const chunks = await collect(oneTurn('gpt-6-luna'), adapter)

  const chat = recorded.find((request) => request.init.method === 'POST')
  assert.equal(chat?.url, 'https://models.example.test/v1/chat/completions')
  const headers = chat?.init.headers as Record<string, string>
  assert.equal(headers.accept, 'text/event-stream')
  const body = requestBody(recorded)
  assert.equal(body.stream, true)
  assert.deepEqual(body.stream_options, { include_usage: true })

  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'Hi' },
    { type: 'text-delta', index: 0, text: '!' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Hi!' } },
    {
      type: 'usage',
      usage: {
        inputTokens: 8,
        outputTokens: 4,
        totalTokens: 16,
        cacheReadTokens: 4,
        reasoningTokens: 0,
      },
    },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

test('思考与正文分开：非标准 reasoning 逐帧累积成一个思考块，排在正文之前，首帧空串不产块', async () => {
  const chunks = await collect(
    oneTurn('deepseek-v4.1-flash'),
    makeAdapter({ fetchImpl: sseFetch([fixture('stream-reasoning.sse')]) }),
  )
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: '用户用中文' },
    { type: 'reasoning-delta', index: 0, text: '打招呼。' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: '用户用中文打招呼。' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: '你好！' },
    { type: 'block-end', index: 1, block: { type: 'text', text: '你好！' } },
    {
      type: 'usage',
      usage: { inputTokens: 34, outputTokens: 18, totalTokens: 52, cacheReadTokens: 0, reasoningTokens: 16 },
    },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

test('只有 reasoning_details、没有 reasoning 标量时也能拿到思考（且不重复计一次）', async () => {
  const body = [
    'data: {"choices":[{"index":0,"delta":{"reasoning_details":[{"index":0,"type":"reasoning.text","text":"先看一眼"}]}}]}',
    'data: {"choices":[{"index":0,"delta":{"content":"好"}}]}',
    'data: [DONE]',
    '',
  ].join('\n\n')
  const chunks = await collect(
    oneTurn('deepseek-v4.1-flash'),
    makeAdapter({ fetchImpl: sseFetch([body]) }),
  )
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: '先看一眼' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: '先看一眼' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: '好' },
    { type: 'block-end', index: 1, block: { type: 'text', text: '好' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

test('工具调用按 index 累积成两次调用，缺 finish_reason 时判为工具调用（不判失败）', async () => {
  const chunks = await collect(
    oneTurn('gpt-6-luna'),
    makeAdapter({ fetchImpl: sseFetch([fixture('stream-tool-calls.sse')]) }),
  )
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId('call_abc'), name: 'get_time', argumentsDelta: '' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId('call_abc'), argumentsDelta: '{"city":' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId('call_abc'), argumentsDelta: '"Tokyo"}' },
    { type: 'block-start', index: 1, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 1, id: ToolCallId('call_def'), name: 'get_weather', argumentsDelta: '' },
    { type: 'tool-call-delta', index: 1, id: ToolCallId('call_def'), argumentsDelta: '{"city":"Osaka"}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('call_abc'), name: 'get_time', arguments: '{"city":"Tokyo"}' } },
    { type: 'block-end', index: 1, block: { type: 'tool-call', id: ToolCallId('call_def'), name: 'get_weather', arguments: '{"city":"Osaka"}' } },
    {
      type: 'usage',
      usage: { inputTokens: 56, outputTokens: 30, totalTokens: 86, cacheReadTokens: 0, reasoningTokens: 0 },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ])
})

test('[DONE] 是终止标记：其后的帧与解析失败的行都不再看', async () => {
  const body = [
    'data: {"choices":[{"index":0,"delta":{"content":"好"}}]}',
    'data: [DONE]',
    'data: {"choices":[{"index":0,"delta":{"content":"垃圾"}}]}',
    'data: 这不是 JSON',
    '',
  ].join('\n\n')
  const chunks = await collect(oneTurn('deepseek-v4.1-flash'), makeAdapter({ fetchImpl: sseFetch([body]) }))
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '好' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '好' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

test('SSE 帧跨读取边界（含 CRLF 换行）也能按行拼回', async () => {
  const frames = [
    'data: {"choices":[{"index":0,"delta":{"content":"跨"}}]}\r\n\r\n',
    'data: {"choices":[{"index":0,"delta":{"content":"边界"}}]}\r\n\r\n',
    'data: [DONE]\r\n',
  ].join('')
  // 每 7 个字符切一刀，必然切在 JSON 中间。
  const fragments = frames.match(/[\s\S]{1,7}/gu) ?? []
  const chunks = await collect(
    oneTurn('deepseek-v4.1-flash'),
    makeAdapter({ fetchImpl: sseFetch(() => chunkedResponse(fragments)) }),
  )
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '跨' },
    { type: 'text-delta', index: 0, text: '边界' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '跨边界' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

test('工具往返：首轮解析出调用，回填结果后次轮请求带上工具与结果，最终得到基于工具输出的回答', async () => {
  const recorded: RecordedRequest[] = []
  const answer = [
    'data: {"choices":[{"index":0,"delta":{"content":"东京现在 12:00。"}}]}',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
    '',
  ].join('\n\n')
  const adapter = makeAdapter({
    fetchImpl: sseFetch([fixture('stream-tool-calls.sse'), answer], recorded),
  })
  const tools = [{
    name: 'get_time',
    description: '报时',
    parameters: { type: 'object', properties: { city: { type: 'string' } } },
  }]

  // 首轮：模型只发起调用。
  const firstChunks = await collect(oneTurn('gpt-6-luna', { tools }), adapter)
  const call = firstChunks.find(isBlockEnd)
  assert.ok(call !== undefined)
  assert.equal(call.block.type, 'tool-call')
  assert.deepEqual(call.block, {
    type: 'tool-call',
    id: ToolCallId('call_abc'),
    name: 'get_time',
    arguments: '{"city":"Tokyo"}',
  })

  // 宿主执行工具，把调用与结果回填进下一轮历史。
  const secondTurn = oneTurn('gpt-6-luna', {
    tools,
    messages: [
      userMessage('东京现在几点？'),
      {
        id: `msg-${++messageSeq}` as MessageId,
        role: 'assistant',
        content: [call.block],
        source: { kind: 'model', provider: 'open-design', model: 'gpt-6-luna' },
      },
      {
        id: `msg-${++messageSeq}` as MessageId,
        role: 'tool',
        content: [{ type: 'text', text: '12:00' }],
        toolCallId: ToolCallId('call_abc'),
        source: { kind: 'tool', callId: ToolCallId('call_abc') },
      },
    ],
  })
  const secondChunks = await collect(secondTurn, adapter)

  const bodies = requestBodies(recorded)
  assert.equal(bodies.length, 2)
  assert.deepEqual(bodies[0]?.tools, [
    { type: 'function', function: { name: 'get_time', description: '报时', parameters: tools[0]?.parameters } },
  ])
  assert.deepEqual(bodies[1]?.messages, [
    { role: 'user', content: '东京现在几点？' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'get_time', arguments: '{"city":"Tokyo"}' } }],
    },
    { role: 'tool', tool_call_id: 'call_abc', content: '12:00' },
  ])
  assert.deepEqual(secondChunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '东京现在 12:00。' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '东京现在 12:00。' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

test('读取中途断流：按传输失败报 LlmError，而不是把原始异常抛给宿主', async () => {
  const cutting = (): Response => {
    const encoder = new TextEncoder()
    let sent = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"半"}}]}\n\n'))
          return
        }
        controller.error(new Error('socket closed'))
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  await assert.rejects(
    collect(oneTurn('deepseek-v4.1-flash'), makeAdapter({ fetchImpl: sseFetch(cutting) })),
    (error: unknown) => {
      assert.ok(error instanceof LlmError)
      assert.equal(error.code, 'TRANSPORT')
      assert.match(error.message, /socket closed/)
      return true
    },
  )
})

test('200 却没有内容：HTML 错误页是协议错误，只有 [DONE] 是空回复（ticket 06 细分）', async () => {
  const cases: Array<{ body: string; code: string }> = [
    { body: '<html>oops</html>\n', code: 'PROTOCOL_ERROR' },
    { body: 'data: [DONE]\n', code: 'EMPTY_RESPONSE' },
  ]
  for (const { body, code } of cases) {
    await assert.rejects(
      collect(oneTurn('deepseek-v4.1-flash'), makeAdapter({ fetchImpl: sseFetch([body]) })),
      (error: unknown) => {
        assert.ok(error instanceof LlmError)
        assert.equal(error.code, code)
        return true
      },
    )
  }
})

test('缺 finish_reason 时：输出吃满本次请求上限判为 length，否则判为正常结束', async () => {
  const capped = [
    'data: {"choices":[{"index":0,"delta":{"content":"部分"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":16,"total_tokens":21}}',
    'data: [DONE]',
    '',
  ].join('\n\n')
  const cappedChunks = await collect(
    oneTurn('kimi-k2.7-code', { maxTokens: 16 }),
    makeAdapter({ fetchImpl: sseFetch([capped]) }),
  )
  assert.deepEqual(cappedChunks.at(-1), { type: 'finish', reason: { kind: 'max-tokens' } })

  const plain = [
    'data: {"choices":[{"index":0,"delta":{"content":"Hi!"}}]}',
    'data: [DONE]',
    '',
  ].join('\n\n')
  const plainChunks = await collect(oneTurn('gpt-6-luna'), makeAdapter({ fetchImpl: sseFetch([plain]) }))
  assert.deepEqual(plainChunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
})

test('finish_reason=length 如实映射为因长度结束', async () => {
  const body = [
    'data: {"choices":[{"index":0,"delta":{"content":"部分"},"finish_reason":"length"}]}',
    'data: [DONE]',
    '',
  ].join('\n\n')
  const chunks = await collect(oneTurn('kimi-k2.7-code'), makeAdapter({ fetchImpl: sseFetch([body]) }))
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'max-tokens' } })
})

// ---------------------------------------------------------------------------
// 客户端硬截断（ticket 05）
// ---------------------------------------------------------------------------

/**
 * 累计输出达到有效上限就停止读取，并以「因长度结束」收尾。
 *
 * 计数按已收到的内容估算：中日韩字符与换行各算 1 token，ASCII 每 3 个字符算
 * 1 token。所以下面用 10 个汉字一帧，上限 16 时第二帧（累计 20）越线，第三帧
 * 起不再读取——第三帧故意写成非法 JSON，若仍被读取会抛 PROTOCOL_ERROR。
 */
test('上游不遵守上限（glm 实测超发）：客户端在累计越线后停止读取，保留已产出内容并如实标注长度结束', async () => {
  const overproducing = [
    'data: {"choices":[{"index":0,"delta":{"content":"一二三四五六七八九十"}}]}',
    'data: {"choices":[{"index":0,"delta":{"content":"甲乙丙丁戊己庚辛壬癸"}}]}',
    'data: 这不是 JSON',
    'data: {"choices":[{"index":0,"delta":{"content":"不该被读到"}}]}',
    'data: [DONE]',
    '',
  ].join('\n\n')

  const chunks = await collect(
    oneTurn('glm-5.3-flash', { maxTokens: 16 }),
    makeAdapter({ fetchImpl: sseFetch([overproducing]) }),
  )

  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '一二三四五六七八九十' },
    { type: 'text-delta', index: 0, text: '甲乙丙丁戊己庚辛壬癸' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸' } },
    // 没有「成功」的假象：宿主据此把回复标成被截断。
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ])
})

test('思考 token 也计入上限：思考吃满后停止，思考块与正文块都保留', async () => {
  const thinkingHeavy = [
    'data: {"choices":[{"index":0,"delta":{"reasoning":"想了一二三四五六七八九十"}}]}',
    'data: {"choices":[{"index":0,"delta":{"content":"答"}}]}',
    'data: 这不是 JSON',
    'data: [DONE]',
    '',
  ].join('\n\n')

  // 12 个汉字的思考 + 1 个汉字的正文 = 13，正好触到 13 的上限。
  const chunks = await collect(
    oneTurn('deepseek-v4.1-flash', { maxTokens: 13 }),
    makeAdapter({ fetchImpl: sseFetch([thinkingHeavy]) }),
  )

  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: '想了一二三四五六七八九十' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: '想了一二三四五六七八九十' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: '答' },
    { type: 'block-end', index: 1, block: { type: 'text', text: '答' } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ])
})

test('上游在流内报出的 completion_tokens 也计入计数：达到上限即停止，不依赖尾帧', async () => {
  const withUsage = [
    'data: {"choices":[{"index":0,"delta":{"content":"短"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":16,"total_tokens":21}}',
    'data: 这不是 JSON',
    'data: [DONE]',
    '',
  ].join('\n\n')

  const chunks = await collect(
    oneTurn('glm-5.3-flash', { maxTokens: 16 }),
    makeAdapter({ fetchImpl: sseFetch([withUsage]) }),
  )

  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'max-tokens' } })
  assert.ok(
    chunks.some((chunk) => (chunk as { type?: string }).type === 'usage'),
    '上游报出的用量要保留，不能被截断丢掉',
  )
})

test('上限够大时不误伤正常结束：全部内容与用量都在，终态是 stop', async () => {
  const chunks = await collect(
    oneTurn('deepseek-v4.1-flash'),
    makeAdapter({ fetchImpl: sseFetch([fixture('stream-text.sse')]) }),
  )
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  assert.equal(chunks.filter((chunk) => (chunk as { type?: string }).type === 'text-delta').length, 2)
})

test('同样的超发流在宽松上限下不截断：整段读完，终态仍是 stop', async () => {
  const overproducing = [
    'data: {"choices":[{"index":0,"delta":{"content":"一二三四五六七八九十"}}]}',
    'data: {"choices":[{"index":0,"delta":{"content":"甲乙丙丁戊己庚辛壬癸"}}]}',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
    '',
  ].join('\n\n')

  const chunks = await collect(
    oneTurn('glm-5.3-flash', { maxTokens: 200 }),
    makeAdapter({ fetchImpl: sseFetch([overproducing]) }),
  )
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  assert.deepEqual(
    (chunks.find((chunk) => (chunk as { type?: string }).type === 'block-end') as { block?: unknown }).block,
    { type: 'text', text: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸' },
  )
})

test('上游遵守上限（kimi 精确 16）：内容保留，终态是因长度结束而不是成功', async () => {
  const capped = [
    'data: {"choices":[{"index":0,"delta":{"content":"一二三四五六七八九十一二三四五六"}}]}',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":16,"total_tokens":21}}',
    'data: [DONE]',
    '',
  ].join('\n\n')

  const chunks = await collect(
    oneTurn('kimi-k2.7-code', { maxTokens: 16 }),
    makeAdapter({ fetchImpl: sseFetch([capped]) }),
  )
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'max-tokens' } })
  assert.deepEqual(
    (chunks.find((chunk) => (chunk as { type?: string }).type === 'block-end') as { block?: unknown }).block,
    { type: 'text', text: '一二三四五六七八九十一二三四五六' },
  )
})
