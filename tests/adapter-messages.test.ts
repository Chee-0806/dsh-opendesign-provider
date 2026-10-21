/**
 * Open Design 适配器（ticket 13）—— 可选 Anthropic Messages 传输。
 *
 * 只测 HTTP 边界与对外事件序列：请求发到哪个地址、带什么头、请求体是什么形状，
 * 以及 `stream()` 产出什么块。Messages 面的夹具按协议实测
 * （`docs/grill/20261020-opendesign-protocol-probe.md` §1.3–§1.4）的真 Anthropic
 * SSE 写：`message_start` / `content_block_start`（thinking 空块 + text + tool_use）
 * / `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop`。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type {
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { LlmError, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenDesignAdapter,
  type OpenDesignAdapterDeps,
  type OpenDesignConnectionOptions,
  type OpenDesignImageEncoder,
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

function userMessageWith(content: Message['content']): Message {
  return {
    id: `msg-${++messageSeq}` as MessageId,
    role: 'user',
    content,
    source: { kind: 'user' },
  }
}

function assistantToolCall(id: string, name: string, args: string): Message {
  return {
    id: `msg-${++messageSeq}` as MessageId,
    role: 'assistant',
    content: [{ type: 'tool-call', id: id as never, name, arguments: args }],
    source: { kind: 'model', provider: 'open-design', model: 'gpt-6-luna' },
  }
}

function toolResult(callId: string, text: string): Message {
  return {
    id: `msg-${++messageSeq}` as MessageId,
    role: 'tool',
    toolCallId: callId as never,
    content: [{ type: 'text', text }],
    source: { kind: 'tool', callId: callId as never },
  }
}

function connection(overrides: Partial<OpenDesignConnectionOptions> = {}): OpenDesignConnectionOptions {
  return {
    apiBase: 'https://models.example.test/v1',
    modelsCachePath: '/tmp/od-messages-models-cache.json',
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

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

interface Routes {
  /** `/messages` 的应答；缺省表示「这条路径不该被请求」。 */
  messages?: (() => Response) | undefined
  /** `/chat/completions` 的应答；缺省表示「这条路径不该被请求」。 */
  chat?: (() => Response) | undefined
}

/** 按路径分派的 fetch 桩：记录每个对话请求，未声明的路径直接炸掉。 */
function routedFetch(routes: Routes, recorded: RecordedRequest[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url)
    if (address.endsWith('/models')) return modelsResponse()
    recorded.push({ url: address, init: init ?? {} })
    if (address.endsWith('/messages')) {
      assert.ok(routes.messages !== undefined, `不该请求 ${address}`)
      return routes.messages()
    }
    if (address.endsWith('/chat/completions')) {
      assert.ok(routes.chat !== undefined, `不该请求 ${address}`)
      return routes.chat()
    }
    assert.fail(`未知的请求地址：${address}`)
  }) as unknown as typeof fetch
}

function makeAdapter(
  routes: Routes,
  overrides: Partial<OpenDesignAdapterDeps> = {},
  recorded: RecordedRequest[] = [],
): OpenDesignAdapter {
  return new OpenDesignAdapter({
    options: overrides.options ?? (() => connection()),
    resolveApiKey: overrides.resolveApiKey ?? (async () => 'user_test_key'),
    fetchImpl: overrides.fetchImpl ?? routedFetch(routes, recorded),
    ...(overrides.attachments === undefined ? {} : { attachments: overrides.attachments }),
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

/** 一次请求的解析后请求体。 */
function requestBodyOf(request: RecordedRequest): Record<string, unknown> {
  assert.equal(typeof request.init.body, 'string')
  return JSON.parse(request.init.body as string) as Record<string, unknown>
}

function headersOf(request: RecordedRequest): Record<string, string> {
  return (request.init.headers ?? {}) as Record<string, string>
}

// ---------------------------------------------------------------------------
// 消息面：请求形态与正文
// ---------------------------------------------------------------------------

test('消息面一轮文本回复：请求发到 /messages 并带协议版本头，请求体是 Anthropic 形态，正文增量逐帧产出', async () => {
  const recorded: RecordedRequest[] = []
  const adapter = makeAdapter({
    messages: () => sseResponse(fixture('messages-text.sse')),
  }, {
    options: () => connection({ protocol: 'messages' }),
  }, recorded)

  const chunks = await collect(oneTurn('claude-haiku-5.5', {
    maxTokens: 256,
    system: '你是助手。',
    tools: [{
      name: 'get_time',
      description: '报时',
      parameters: { type: 'object', properties: { city: { type: 'string' } } },
    }],
  }), adapter)

  assert.equal(recorded.length, 1)
  const request = recorded[0]!
  assert.equal(request.url, 'https://models.example.test/v1/messages')
  const headers = headersOf(request)
  assert.equal(headers['anthropic-version'], '2023-06-01')
  assert.equal(headers.authorization, 'Bearer user_test_key')
  assert.equal(headers.accept, 'text/event-stream')
  assert.equal(headers['content-type'], 'application/json')

  // 请求体整份对照：既钉住 Anthropic 形态，也证明没有混进 Chat Completions 的字段。
  assert.deepEqual(requestBodyOf(request), {
    model: 'claude-haiku-5.5',
    max_tokens: 256,
    stream: true,
    system: '你是助手。',
    messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
    tools: [{
      name: 'get_time',
      description: '报时',
      input_schema: { type: 'object', properties: { city: { type: 'string' } } },
    }],
  })

  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'Hi' },
    { type: 'text-delta', index: 0, text: '!' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Hi!' } },
    {
      type: 'usage',
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

// ---------------------------------------------------------------------------
// 思考
// ---------------------------------------------------------------------------

test('思考块先于正文：thinking_delta 累积成一个思考块，signature_delta 与空思考块都不产块', async () => {
  const adapter = makeAdapter({
    messages: () => sseResponse(fixture('messages-thinking.sse')),
  }, {
    options: () => connection({ protocol: 'messages' }),
  })
  const chunks = await collect(oneTurn('gpt-6-luna'), adapter)

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
      usage: {
        inputTokens: 21,
        outputTokens: 18,
        totalTokens: 39,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

test('没有 event: 行（只有 data:）的 Anthropic 流也能按载荷的 type 分派', async () => {
  const body = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}',
    'data: {"type":"content_block_stop","index":0}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n\n')
  const chunks = await collect(
    oneTurn('gpt-6-luna'),
    makeAdapter({ messages: () => sseResponse(body) }, { options: () => connection({ protocol: 'messages' }) }),
  )
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '好' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '好' } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

// ---------------------------------------------------------------------------
// 工具调用
// ---------------------------------------------------------------------------

test('工具调用按 tool_use 块累积：id/name 在块首，partial_json 拼成 arguments，tool_use 结束原因判为工具调用', async () => {
  const adapter = makeAdapter({
    messages: () => sseResponse(fixture('messages-tool-use.sse')),
  }, {
    options: () => connection({ protocol: 'messages' }),
  })
  const chunks = await collect(oneTurn('gpt-6-luna', {
    tools: [{ name: 'get_time', description: '报时', parameters: { type: 'object', properties: {} } }],
  }), adapter)

  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId('toolu_abc'), name: 'get_time', argumentsDelta: '' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId('toolu_abc'), argumentsDelta: '{"city":' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId('toolu_abc'), argumentsDelta: '"Tokyo"}' },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: ToolCallId('toolu_abc'), name: 'get_time', arguments: '{"city":"Tokyo"}' },
    },
    {
      type: 'usage',
      usage: {
        inputTokens: 56,
        outputTokens: 30,
        totalTokens: 86,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ])
})

test('用量带缓存读/写三段，结束原因为 max_tokens 时判长度；message_delta 的 output_tokens 计入总量', async () => {
  const body = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":40,"cache_creation_input_tokens":7,"cache_read_input_tokens":300,"output_tokens":0}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"被截断的回答"}}',
    'data: {"type":"content_block_stop","index":0}',
    'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":64}}',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n\n')
  const chunks = await collect(
    oneTurn('claude-haiku-5.5'),
    makeAdapter({ messages: () => sseResponse(body) }, { options: () => connection({ protocol: 'messages' }) }),
  )
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '被截断的回答' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '被截断的回答' } },
    {
      type: 'usage',
      usage: {
        inputTokens: 40,
        outputTokens: 64,
        totalTokens: 411,
        cacheReadTokens: 300,
        cacheWriteTokens: 7,
      },
    },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ])
})

test('输出上限在 Messages 面同样硬截断：累计估算越线即停止读取，保留已收到内容并以长度收尾', async () => {
  const body = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":0,"output_tokens":0}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"一二"}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"三四"}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"五六"}}',
    'data: {"type":"content_block_stop","index":0}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":40}}',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n\n')
  const chunks = await collect(
    oneTurn('gpt-6-luna', { maxTokens: 4 }),
    makeAdapter({ messages: () => sseResponse(body) }, { options: () => connection({ protocol: 'messages' }) }),
  )
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '一二' },
    { type: 'text-delta', index: 0, text: '三四' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '一二三四' } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ])
})

// ---------------------------------------------------------------------------
// 选路
// ---------------------------------------------------------------------------

/** 两个面都能应答的桩：返回第一个请求的地址（顺带记录全部请求）。 */
async function firstCallURL(
  protocol: OpenDesignConnectionOptions['protocol'],
  model: string,
): Promise<string> {
  const recorded: RecordedRequest[] = []
  const adapter = makeAdapter({
    messages: () => sseResponse(fixture('messages-text.sse')),
    chat: () => sseResponse(fixture('stream-text.sse')),
  }, {
    options: () => connection(protocol === undefined ? {} : { protocol }),
  }, recorded)
  await collect(oneTurn(model), adapter)
  assert.equal(recorded.length, 1, `期望一次请求，实际 ${recorded.length} 次`)
  return recorded[0]!.url
}

test('默认 auto：两个在 Chat 面看不见思考的模型走 Messages，其余继续走 Chat', async () => {
  const base = 'https://models.example.test/v1'
  assert.equal(await firstCallURL(undefined, 'gpt-6-luna'), `${base}/messages`)
  assert.equal(await firstCallURL('auto', 'claude-haiku-5.5'), `${base}/messages`)
  assert.equal(await firstCallURL('auto', 'deepseek-v4.1-flash'), `${base}/chat/completions`)
  assert.equal(await firstCallURL('auto', 'glm-5.3-flash'), `${base}/chat/completions`)
})

test('显式 chat / messages 覆盖选路：chat 让全部模型走 Chat，messages 让全部走 Messages', async () => {
  const base = 'https://models.example.test/v1'
  assert.equal(await firstCallURL('chat', 'gpt-6-luna'), `${base}/chat/completions`)
  assert.equal(await firstCallURL('messages', 'deepseek-v4.1-flash'), `${base}/messages`)
})

// ---------------------------------------------------------------------------
// 回落
// ---------------------------------------------------------------------------

test('Messages 不可用（404 HTML）时自动回落 Chat：对话照常完成，同一模型此后直接走 Chat', async () => {
  const recorded: RecordedRequest[] = []
  let messagesCalls = 0
  const adapter = makeAdapter({
    messages: () => {
      messagesCalls += 1
      return new Response('<html><title>404 Not Found</title></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })
    },
    chat: () => sseResponse(fixture('stream-text.sse')),
  }, {
    options: () => connection({ protocol: 'auto' }),
  }, recorded)

  const chunks = await collect(oneTurn('gpt-6-luna'), adapter)
  const text = chunks
    .filter((chunk): chunk is { type: 'text-delta'; text: string } =>
      typeof chunk === 'object' && chunk !== null && (chunk as { type?: unknown }).type === 'text-delta')
    .map((chunk) => chunk.text)
    .join('')
  assert.equal(text, 'Hi!')
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })

  // 先试 Messages，失败后同一轮改走 Chat：对话没有因为切换失败而中断。
  assert.equal(messagesCalls, 1)
  assert.deepEqual(recorded.map((request) => request.url), [
    'https://models.example.test/v1/messages',
    'https://models.example.test/v1/chat/completions',
  ])

  const fallbacks = adapter.transportFallbacks()
  assert.equal(fallbacks.length, 1)
  assert.equal(fallbacks[0]?.model, 'gpt-6-luna')
  assert.equal(fallbacks[0]?.from, 'messages')
  assert.match(fallbacks[0]?.reason ?? '', /404/u)

  // 记住偏好：第二轮不再先撞一次 Messages。
  const second = await collect(oneTurn('gpt-6-luna'), adapter)
  assert.deepEqual(second.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  assert.equal(messagesCalls, 1)
  assert.deepEqual(recorded.slice(2).map((request) => request.url), [
    'https://models.example.test/v1/chat/completions',
  ])
})

test('鉴权失败不触发回落：Messages 面的 401 直接作为 AUTH 上抛，不再白打一次 Chat', async () => {
  const recorded: RecordedRequest[] = []
  const adapter = makeAdapter({
    messages: () => new Response(
      JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid key' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ),
    chat: () => sseResponse(fixture('stream-text.sse')),
  }, {
    options: () => connection({ protocol: 'auto' }),
  }, recorded)

  await assert.rejects(
    () => collect(oneTurn('gpt-6-luna'), adapter),
    (error: unknown) => error instanceof LlmError && error.code === 'AUTH',
  )
  assert.deepEqual(recorded.map((request) => request.url), ['https://models.example.test/v1/messages'])
  assert.deepEqual(adapter.transportFallbacks(), [])
})

// ---------------------------------------------------------------------------
// 图片与工具历史
// ---------------------------------------------------------------------------

/** 附件服务桩：把固定字节交给请求体，图片内容不重要，只求原样成 base64。 */
const REQUEST_IMAGE_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10])
const REQUEST_IMAGE_BASE64 = Buffer.from(REQUEST_IMAGE_BYTES).toString('base64')

function imageRef(): ImageAttachmentRef {
  return {
    attachmentId: 'sha256:0a1b2c3d4e5f6071',
    mediaType: 'image/png',
    bytes: 512,
    width: 100,
    height: 100,
  } as ImageAttachmentRef
}

/** 附件服务桩：固定字节直接当作请求版本，图片内容不重要，只求原样成 base64。 */
function stubEncoder(): OpenDesignImageEncoder {
  return {
    async readImageRequest(ref: ImageAttachmentRef, target: ImageRequestTarget): Promise<RequestImageAttachment> {
      return {
        variantId: 'variant-test' as RequestImageAttachment['variantId'],
        attachment: ref,
        data: REQUEST_IMAGE_BYTES,
        mediaType: 'image/png',
        bytes: REQUEST_IMAGE_BYTES.byteLength,
        width: target.width,
        height: target.height,
        depth: 'uchar',
        space: 'srgb',
        hasAlpha: false,
      }
    },
  }
}

test('Messages 面图片转 base64 source；不支持图片的模型与 file 附件照旧拒绝', async () => {
  const recorded: RecordedRequest[] = []
  const adapter = makeAdapter({
    messages: () => sseResponse(fixture('messages-text.sse')),
  }, {
    options: () => connection({ protocol: 'messages' }),
    attachments: stubEncoder,
  }, recorded)

  await collect(oneTurn('gpt-6-luna', {
    messages: [userMessageWith([
      { type: 'text', text: '这张图是什么？' },
      { type: 'image', attachment: imageRef() },
    ])],
  }), adapter)

  const body = requestBodyOf(recorded[0]!)
  assert.deepEqual(body.messages, [{
    role: 'user',
    content: [
      { type: 'text', text: '这张图是什么？' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: REQUEST_IMAGE_BASE64 } },
    ],
  }])

  // 纯文本模型收到图片：能力拒绝，与 Chat 面同一套错误。
  const textOnly = makeAdapter({ messages: () => sseResponse(fixture('messages-text.sse')) }, {
    options: () => connection({ protocol: 'messages' }),
    attachments: stubEncoder,
  })
  await assert.rejects(
    () => collect(oneTurn('deepseek-v4-flash', {
      messages: [userMessageWith([{ type: 'image', attachment: imageRef() }])],
    }), textOnly),
    (error: unknown) => error instanceof LlmError && error.code === 'UNSUPPORTED_CONTENT',
  )

  // file 附件：Messages 面同样没有槽位。
  const withFile = makeAdapter({ messages: () => sseResponse(fixture('messages-text.sse')) }, {
    options: () => connection({ protocol: 'messages' }),
  })
  await assert.rejects(
    () => collect(oneTurn('gpt-6-luna', {
      messages: [userMessageWith([{
        type: 'file',
        attachment: { attachmentId: 'sha256:ffeeddccbbaa9988' as never, bytes: 10, name: 'a.pdf' },
      }])],
    }), withFile),
    (error: unknown) => error instanceof LlmError && error.code === 'UNSUPPORTED_CONTENT',
  )
})

test('Messages 面工具往返：历史里的 tool-call 变 tool_use 块，tool 结果变 user 的 tool_result 块', async () => {
  const recorded: RecordedRequest[] = []
  const adapter = makeAdapter({ messages: () => sseResponse(fixture('messages-text.sse')) }, {
    options: () => connection({ protocol: 'messages' }),
  }, recorded)

  await collect(oneTurn('gpt-6-luna', {
    tools: [{ name: 'get_time', description: '报时', parameters: { type: 'object', properties: {} } }],
    messages: [
      userMessage('东京现在几点？'),
      assistantToolCall('toolu_abc', 'get_time', '{"city":"Tokyo"}'),
      toolResult('toolu_abc', '12:00'),
    ],
  }), adapter)

  assert.deepEqual(requestBodyOf(recorded[0]!).messages, [
    { role: 'user', content: [{ type: 'text', text: '东京现在几点？' }] },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_abc', name: 'get_time', input: { city: 'Tokyo' } }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: '12:00' }],
    },
  ])
})
