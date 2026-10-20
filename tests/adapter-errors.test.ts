/**
 * 适配器的错误边界（ticket 06）—— 只测 `stream()` 对外抛出的错误码、文案与
 *「有没有发生重试」。HTTP 形状来自协议实测
 *（`docs/grill/20261020-opendesign-protocol-probe.md` §5）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { LlmError, MessageId } from '@deepseek-ai/dsh-llm'

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenDesignAdapter,
  type OpenDesignAdapterDeps,
  type OpenDesignConnectionOptions,
} from '../src/adapter.ts'
import { retryableFailureCodes } from '../src/error-taxonomy.ts'

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
    modelsCachePath: '/tmp/od-error-models-cache.json',
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    ...overrides,
  }
}

function oneTurn(model = 'deepseek-v4.1-flash', overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'open-design', model, messages: [userMessage('你好')], ...overrides }
}

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

const MODELS_FIXTURE = fixture('models.json')

/** 一次对话请求的应答桩；`chatCalls` 计数用来证明适配器自己没有重试。 */
interface ErrorFetch {
  readonly fetchImpl: typeof fetch
  readonly chatCalls: () => number
}

function failingFetch(
  status: number,
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): ErrorFetch {
  let calls = 0
  const fetchImpl = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/models')) {
      return new Response(MODELS_FIXTURE, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    calls += 1
    return new Response(body, { status, headers })
  }) as unknown as typeof fetch
  return { fetchImpl, chatCalls: () => calls }
}

function makeAdapter(overrides: Partial<OpenDesignAdapterDeps> = {}): OpenDesignAdapter {
  return new OpenDesignAdapter({
    options: overrides.options ?? (() => connection()),
    resolveApiKey: overrides.resolveApiKey ?? (async () => 'user_test_key'),
    fetchImpl: overrides.fetchImpl ?? failingFetch(200, '').fetchImpl,
  })
}

async function streamError(adapter: OpenDesignAdapter, options: GenerateOptions): Promise<LlmError> {
  try {
    // 半路失败之前可能已经产出过块（例如空闲超时前的那一帧思考），这里只关心终态。
    for await (const chunk of adapter.stream(options)) void chunk
  } catch (error) {
    assert.ok(error instanceof LlmError, `expected LlmError, got ${String(error)}`)
    return error
  }
  throw new Error('expected the stream to fail')
}

// ---------------------------------------------------------------------------
// 401：Key 被拒，且只发一次请求
// ---------------------------------------------------------------------------

test('401 从适配器抛出 AUTH，且只发生一次对话请求（适配器自己不重试）', async () => {
  const stub = failingFetch(401, fixture('error-invalid-key.json'))
  const error = await streamError(makeAdapter({ fetchImpl: stub.fetchImpl }), oneTurn())
  assert.equal(error.code, 'AUTH')
  assert.equal(stub.chatCalls(), 1)
  assert.match(error.message, /api-keys/u)
})

test('400 的确定性真因经适配器归类为 BAD_REQUEST，且只发一次请求', async () => {
  const body = JSON.stringify({
    error: {
      message: '[code=upstream_error] Empty input messages (request_id: 874c0840-1111-2222-3333-444455556666)',
      type: 'invalid_request_error',
      code: 'upstream_error',
    },
  })
  const stub = failingFetch(400, body)
  const error = await streamError(makeAdapter({ fetchImpl: stub.fetchImpl }), oneTurn())
  assert.equal(error.code, 'BAD_REQUEST')
  assert.equal(stub.chatCalls(), 1)
  assert.match(error.message, /Empty input messages/u)
})

test('404 纯文本经适配器归类为 PROTOCOL_ERROR（不按 JSON 解析）', async () => {
  const stub = failingFetch(404, '404 page not found\n', { 'content-type': 'text/plain; charset=utf-8' })
  const error = await streamError(makeAdapter({ fetchImpl: stub.fetchImpl }), oneTurn())
  assert.equal(error.code, 'PROTOCOL_ERROR')
  assert.match(error.message, /apiBase/u)
  assert.match(error.message, /page not found/u)
})

test('502 包住上游确定性 400 时：真因优先，归为 BAD_REQUEST 而不是服务端故障', async () => {
  const body = JSON.stringify({
    error: { message: '[code=upstream_error] Incorrect role information', type: 'upstream_error', code: 'upstream_error' },
  })
  const stub = failingFetch(502, body)
  const error = await streamError(makeAdapter({ fetchImpl: stub.fetchImpl }), oneTurn('glm-5.3-flash'))
  assert.equal(error.code, 'BAD_REQUEST')
  assert.match(error.message, /Incorrect role information/u)
})

test('402 经适配器归为 QUOTA_EXHAUSTED', async () => {
  const body = JSON.stringify({ error: { code: 'quota_exhausted', message: 'insufficient credits', type: 'quota' } })
  const stub = failingFetch(402, body)
  const error = await streamError(makeAdapter({ fetchImpl: stub.fetchImpl }), oneTurn())
  assert.equal(error.code, 'QUOTA_EXHAUSTED')
  assert.match(error.message, /BYOK/u)
})

// ---------------------------------------------------------------------------
// 空流：200 但没有任何可展示内容（ticket 06 从 PROTOCOL_ERROR 里分出来）
// ---------------------------------------------------------------------------

/** 一个只回 SSE 正文的桩，用来喂「200 但没有内容」这几种形状。 */
function sseResponseFetch(body: string): typeof fetch {
  return (async (url: string | URL | Request) => {
    if (String(url).endsWith('/models')) {
      return new Response(MODELS_FIXTURE, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
}

test('200 只有 [DONE]：归为 EMPTY_RESPONSE（可重试），文案说明上游返回空', async () => {
  const error = await streamError(
    makeAdapter({ fetchImpl: sseResponseFetch('data: [DONE]\n\n') }),
    oneTurn(),
  )
  assert.equal(error.code, 'EMPTY_RESPONSE')
  assert.match(error.message, /空响应/u)
  assert.match(error.message, /重试/u)
})

test('200 只有 usage 尾帧没有内容：同样归为 EMPTY_RESPONSE，而不是给出空回复', async () => {
  const body = [
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":0,"total_tokens":5}}',
    'data: [DONE]',
    '',
  ].join('\n\n')
  const error = await streamError(makeAdapter({ fetchImpl: sseResponseFetch(body) }), oneTurn())
  assert.equal(error.code, 'EMPTY_RESPONSE')
})

test('200 返回 HTML 错误页：归为 PROTOCOL_ERROR 并点明不是 SSE 流', async () => {
  const error = await streamError(
    makeAdapter({ fetchImpl: sseResponseFetch('<html><body>oops</body></html>\n') }),
    oneTurn(),
  )
  assert.equal(error.code, 'PROTOCOL_ERROR')
  assert.match(error.message, /不是 SSE|HTML/u)
})

// ---------------------------------------------------------------------------
// 流空闲超时（ticket 01 留了配置，ticket 04 未接线）
// ---------------------------------------------------------------------------

test('流读取空闲超时：以 TIMEOUT 中止并取消读取（接上 streamIdleTimeoutMs）', async () => {
  let cancelled = false
  const stalled = (): Response => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 先给一帧思考，然后就再也不会有数据（代理挂住/上游停止写入）。
        controller.enqueue(encoder.encode('data: {"choices":[{"index":0,"delta":{"reasoning":"想"}}]}\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const fetchImpl = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/models')) {
      return new Response(MODELS_FIXTURE, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return stalled()
  }) as unknown as typeof fetch

  const started = Date.now()
  const error = await streamError(
    makeAdapter({ fetchImpl, options: () => connection({ streamIdleTimeoutMs: 25 }) }),
    oneTurn(),
  )
  assert.equal(error.code, 'TIMEOUT')
  assert.match(error.message, /空闲/u)
  assert.ok(Date.now() - started < 5000, '空闲超时不能等到请求超时（300 秒）')
  assert.equal(cancelled, true, '超时后必须取消读取，不能把连接挂在后台')
})

// ---------------------------------------------------------------------------
// 可重试性：分类表与路由声明的重试策略必须一致
// ---------------------------------------------------------------------------

test('路由的可重试码＝分类表的可重试集合，确定性错误永远不在其中', () => {
  const policy = makeAdapter().providerRetryPolicy('open-design')
  assert.ok(policy !== undefined, '路由要显式声明重试策略，而不是依赖引擎默认')
  assert.equal(policy.mode, 'normal')
  if (policy.mode !== 'normal') return
  assert.deepEqual([...policy.retryableCodes].sort(), [...retryableFailureCodes()].sort())
  for (const code of ['AUTH', 'QUOTA_EXHAUSTED', 'BAD_REQUEST', 'PROTOCOL_ERROR']) {
    assert.equal(policy.retryableCodes.includes(code), false, `${code} 重试只会得到同一个失败`)
  }
})

test('引擎的默认重试集合本身也不含确定性错误码（契约核对，避免上游改默认值）', async () => {
  const { resolveRetryPolicy } = await import('@deepseek-ai/dsh-llm')
  const defaults = resolveRetryPolicy(undefined, 'test')
  assert.equal(defaults.mode, 'normal')
  if (defaults.mode !== 'normal') return
  for (const code of ['AUTH', 'QUOTA_EXHAUSTED', 'BAD_REQUEST', 'PROTOCOL_ERROR']) {
    assert.equal(defaults.retryableCodes.includes(code), false)
  }
  // 引擎默认集合里的这几项与本插件的分类重叠；`TRANSIENT` 是本插件自己的码，
  // 靠 `providerRetryPolicy` 声明让引擎照办（见上一个测试）。
  for (const code of ['EMPTY_RESPONSE', 'RATE_LIMIT', 'TIMEOUT']) {
    assert.equal(defaults.retryableCodes.includes(code), true, `${code} 必须能被引擎重试`)
  }
})

test('200 但没有响应体：协议错误说明读不到内容，而不是静默给出空回复', async () => {
  const fetchImpl = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/models')) {
      return new Response(MODELS_FIXTURE, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
  const error = await streamError(makeAdapter({ fetchImpl }), oneTurn())
  assert.equal(error.code, 'PROTOCOL_ERROR')
  assert.match(error.message, /空的流式响应体|没有响应体/u)
})
