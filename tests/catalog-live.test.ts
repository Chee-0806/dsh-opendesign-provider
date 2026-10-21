/**
 * 网关实时目录（ticket 03）—— 只从 HTTP 边界与适配器对外输出观察行为。
 *
 * 事实来源：`docs/opendesign/00-改造设计.md` §5 与
 * `docs/grill/20261020-opendesign-protocol-probe.md` §4 的真实 `/v1/models` 响应
 * （`tests/fixtures/models.json`，已脱敏，无密钥）。
 *
 * 覆盖：夹具解析与字段映射、目录来源、断网/401/坏形状回落、未知模型、
 * 缓存绑定与 TTL、失败重试窗口。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

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

const MODELS_FIXTURE = readFileSync(new URL('./fixtures/models.json', import.meta.url), 'utf8')

interface TempCache {
  readonly path: string
  readonly cleanup: () => void
}

/** 每个用例一个临时缓存路径，避免相互污染用户目录。 */
function tempCache(): TempCache {
  const dir = mkdtempSync(join(tmpdir(), 'od-catalog-'))
  return {
    path: join(dir, 'models-cache.json'),
    cleanup: () => { rmSync(dir, { recursive: true, force: true }) },
  }
}

function connection(cachePath: string, overrides: Partial<OpenDesignConnectionOptions> = {}): OpenDesignConnectionOptions {
  return {
    apiBase: 'https://models.example.test/v1',
    modelsCachePath: cachePath,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    ...overrides,
  }
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

/** A fetch stub that records every URL and answers through `respond`. */
function gatewayStub(respond: (url: string) => Response | Promise<Response>, calls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    return respond(url)
  }) as unknown as typeof fetch
}

interface AdapterHarness {
  readonly adapter: OpenDesignAdapter
  readonly calls: string[]
  setNow: (value: number) => void
  setResponder: (responder: (url: string) => Response | Promise<Response>) => void
}

/** An adapter whose fetch, clock and cache are all under the test's control. */
function makeAdapter(cachePath: string, options: Partial<OpenDesignConnectionOptions> = {}): AdapterHarness {
  const calls: string[] = []
  let now = 1_000_000
  let responder: (url: string) => Response | Promise<Response> = (url) => (
    url.endsWith('/models') ? jsonResponse(MODELS_FIXTURE) : jsonResponse('{}', 404)
  )
  const deps: OpenDesignAdapterDeps = {
    options: () => connection(cachePath, options),
    resolveApiKey: async () => 'user_test_key',
    fetchImpl: gatewayStub((url) => responder(url), calls),
    now: () => now,
  }
  return {
    adapter: new OpenDesignAdapter(deps),
    calls,
    setNow: (value) => { now = value },
    setResponder: (next) => { responder = next },
  }
}

// ---------------------------------------------------------------------------
// 解析与映射
// ---------------------------------------------------------------------------

test('真实 /models 夹具解析出 12 条，字段映射为预算/模态/档位，来源为 live', async () => {
  const cache = tempCache()
  try {
    const { adapter } = makeAdapter(cache.path)
    const models = await adapter.listModels('open-design')

    assert.equal(models.length, 12)
    const byId = new Map(models.map((model) => [model.id, model]))
    // 网关只执行 context_limit；context_budget（328000）是不执行的建议预算。
    const deepseek = await adapter.resolveModel('open-design', 'deepseek-v4.1-flash')
    assert.equal(deepseek.context?.contextWindow, 1_048_000)
    assert.equal(deepseek.defaultMaxTokens, 128_000)
    // 已知 id 的模态与档位来自快照：glm 接受图片，deepseek-v4-flash 只接受文本。
    assert.deepEqual(byId.get('glm-5.3-flash')?.inputModalities, ['text', 'image'])
    assert.deepEqual(byId.get('deepseek-v4-flash')?.inputModalities, ['text'])
    assert.match(byId.get('deepseek-v4.1-flash')?.name ?? '', /DeepSeek V4\.1 Flash/)
    assert.match(byId.get('deepseek-v4.1-flash')?.description ?? '', /advanced/)
    assert.match(byId.get('deepseek-v4.1-flash')?.description ?? '', /low cost/)
    // kimi 的输出预算被抬到 65536，才能容纳 medium/high 档的思考预算。
    assert.equal((await adapter.resolveModel('open-design', 'kimi-k2.7-code')).defaultMaxTokens, 65_536)
    assert.deepEqual(
      (await adapter.resolveModel('open-design', 'glm-5.3-flash')).reasoning?.efforts.map((effort) => effort.id),
      ['low', 'high', 'max'].map((level) => ReasoningEffortId(level)),
    )

    const status = await adapter.catalogStatus()
    assert.equal(status.source, 'live')
    assert.equal(status.apiBase, 'https://models.example.test/v1')
    assert.equal(status.models.length, 12)
    assert.equal(status.models.every((entry) => entry.calibrated), true)
    assert.equal(typeof status.fetchedAt, 'number')
  } finally {
    cache.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 回落与来源
// ---------------------------------------------------------------------------

/** 从真实夹具复制一份可改的 `data`，用于构造「按 Key 裁剪」与坏形状。 */
function fixtureEntries(): unknown[] {
  return (JSON.parse(MODELS_FIXTURE) as { data: unknown[] }).data.map((item) => structuredClone(item))
}

function modelsBody(entries: readonly unknown[]): string {
  return JSON.stringify({ object: 'list', data: entries })
}

/** 只回答目录、对话一律 404 的响应器。 */
function catalogOnly(body: string): (url: string) => Response {
  return (url) => (url.endsWith('/models') ? jsonResponse(body) : jsonResponse('{}', 404))
}

test('断网时回落静态快照并标记 static，恢复后重新拉取', async () => {
  const cache = tempCache()
  try {
    const { adapter, setNow, setResponder } = makeAdapter(cache.path)
    let online = false
    setResponder((url) => {
      if (!online) throw new Error('connect ECONNREFUSED 127.0.0.1:443')
      return url.endsWith('/models') ? jsonResponse(MODELS_FIXTURE) : jsonResponse('{}', 404)
    })

    const offline = await adapter.listModels('open-design')
    assert.equal(offline.length, 12)
    const before = await adapter.catalogStatus()
    assert.equal(before.source, 'static')
    assert.equal(before.reason, 'unreachable')
    assert.equal(before.fetchedAt, undefined)

    // 失败后 10 秒内不重试；窗口过去后再拉一次。
    setNow(1_000_000 + 10_000)
    online = true
    const after = await adapter.catalogStatus()
    assert.equal(after.source, 'live')
    assert.equal(after.models.length, 12)
    assert.equal(after.reason, undefined)
  } finally {
    cache.cleanup()
  }
})

test('401 回落静态快照并给出 auth 原因', async () => {
  const cache = tempCache()
  try {
    const { adapter, setResponder } = makeAdapter(cache.path)
    setResponder(() => jsonResponse('{"error":{"code":"invalid_api_key"}}', 401))
    const models = await adapter.listModels('open-design')
    assert.equal(models.length, 12)
    const status = await adapter.catalogStatus()
    assert.equal(status.source, 'static')
    assert.equal(status.reason, 'auth')
    // 回落不阻塞：静态快照的显示名与上下文都在。
    assert.equal((await adapter.resolveModel('open-design', 'deepseek-v4.1-flash')).context?.contextWindow, 1_048_000)
  } finally {
    cache.cleanup()
  }
})

test('坏形状按协议错误回落静态快照，不崩也不变成空目录', async () => {
  const cache = tempCache()
  try {
    const badBodies = [
      JSON.stringify({ object: 'list', data: 'nope' }),
      JSON.stringify({ data: [] }),
      JSON.stringify({ object: 'list', data: [{ object: 'model' }] }),
      JSON.stringify({ object: 'list', data: [{ id: 'x', metadata: { cost: 'cheap' } }] }),
      '<html>not json</html>',
    ]
    for (const body of badBodies) {
      const { adapter, setResponder } = makeAdapter(cache.path)
      setResponder(catalogOnly(body))
      assert.equal((await adapter.listModels('open-design')).length, 12, body)
      const status = await adapter.catalogStatus()
      assert.equal(status.source, 'static', body)
      assert.equal(status.reason, 'protocol', body)
    }
  } finally {
    cache.cleanup()
  }
})

test('网关按 Key 裁剪时以网关为准：少于 12 条不补快照，enabled:false 不列出', async () => {
  const cache = tempCache()
  try {
    const all = fixtureEntries() as Array<Record<string, unknown>>
    const entries = all.filter((entry) => entry.id === 'deepseek-v4.1-flash' || entry.id === 'glm-5.3-flash')
    entries.push({ ...(all.find((entry) => entry.id === 'deepseek-v4-flash') as Record<string, unknown>), enabled: false })
    const { adapter, setResponder } = makeAdapter(cache.path)
    setResponder(catalogOnly(modelsBody(entries)))
    const models = await adapter.listModels('open-design')
    assert.deepEqual(models.map((model) => model.id), ['deepseek-v4.1-flash', 'glm-5.3-flash'])
  } finally {
    cache.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 快照外的新模型
// ---------------------------------------------------------------------------

/** 一次最小的成功流式应答（ticket 04 起对话走 SSE）。 */
const OK_REPLY = [
  'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"你好"}}]}',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  'data: [DONE]',
  '',
].join('\n\n')

test('快照外的新模型：可见、标题化、全档、无图片、标未校准，且能正常对话', async () => {
  const cache = tempCache()
  try {
    const entries = fixtureEntries()
    entries.push(
      {
        id: 'brand-new-model',
        object: 'model',
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        metadata: { cost: 'low', capability: 'advanced', context_limit: 64_000, context_budget: 9_000, output_budget: 16_000 },
        default: false,
        enabled: true,
      },
      { id: 'mystery_model', object: 'model' },
      {
        id: 'legacy-window',
        object: 'model',
        metadata: { context_limit: 90_000 },
      },
    )
    const { adapter, calls, setResponder } = makeAdapter(cache.path)
    setResponder((url) => {
      if (url.endsWith('/models')) return jsonResponse(modelsBody(entries))
      return jsonResponse(OK_REPLY)
    })

    const models = await adapter.listModels('open-design')
    const byId = new Map(models.map((model) => [model.id, model]))
    assert.equal(models.length, 15)
    assert.equal(byId.get('brand-new-model')?.name, 'Brand New Model')
    assert.match(byId.get('brand-new-model')?.description ?? '', /未校准/)
    // 未实测过的新模型不宣告图片能力，按全档思考域处理。
    assert.deepEqual(byId.get('brand-new-model')?.inputModalities, ['text'])
    assert.equal(byId.get('mystery_model')?.name, 'Mystery Model')

    const brandNew = await adapter.resolveModel('open-design', 'brand-new-model')
    assert.equal(brandNew.context?.contextWindow, 64_000)
    assert.equal(brandNew.defaultMaxTokens, 16_000)
    assert.equal(brandNew.reasoning?.efforts.length, 7)

    // context_limit 缺失时回落快照/默认值；context_budget 一律不参与窗口计算。
    assert.equal((await adapter.resolveModel('open-design', 'legacy-window')).context?.contextWindow, 90_000)
    // 回归：brand-new-model 同时给了 context_limit=64_000 与更小的 context_budget=9_000，
    // 窗口必须取前者。2026-10-21 实测网关只执行 context_limit（且它含输出），
    // 曾把 context_budget 当窗口，导致只剩真实额度的 22%~38%。
    assert.notEqual(brandNew.context?.contextWindow, 9_000)
    const mystery = await adapter.resolveModel('open-design', 'mystery_model')
    assert.equal(mystery.context?.contextWindow, 128_000)
    assert.equal(mystery.defaultMaxTokens, 32_768)

    // 新模型可对话：请求照常发出，输出上限取网关公布值。
    const chunks: unknown[] = []
    for await (const chunk of adapter.stream({
      provider: 'open-design',
      model: 'brand-new-model',
      messages: [{ id: 'msg-1' as never, role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }],
    })) chunks.push(chunk)
    const chat = calls.filter((url) => url.endsWith('/chat/completions'))
    assert.equal(chat.length, 1)
    assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  } finally {
    cache.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 缓存与 TTL
// ---------------------------------------------------------------------------

/** 5 分钟成功缓存与 10 秒失败重试窗口，按设计件 §5.1 独立抄写。 */
const SUCCESS_TTL_MS = 5 * 60_000
const FAILURE_RETRY_TTL_MS = 10_000

test('成功目录写入缓存：TTL 内的新适配器直接读文件，不再请求网关', async () => {
  const cache = tempCache()
  try {
    const first = makeAdapter(cache.path)
    await first.adapter.listModels('open-design')
    const document = JSON.parse(readFileSync(cache.path, 'utf8')) as Record<string, unknown>
    assert.equal(document.apiBase, 'https://models.example.test/v1')
    assert.equal(typeof document.version, 'number')
    assert.equal(Array.isArray(document.data), true)
    assert.equal((document.data as unknown[]).length, 12)

    const second = makeAdapter(cache.path)
    second.setResponder(() => { throw new Error('network should not be touched') })
    const models = await second.adapter.listModels('open-design')
    assert.equal(models.length, 12)
    const status = await second.adapter.catalogStatus()
    assert.equal(status.source, 'live')
    assert.equal(status.cached, true)
    assert.equal(status.fetchedAt, 1_000_000)
    assert.equal(second.calls.length, 0)
  } finally {
    cache.cleanup()
  }
})

test('缓存与 apiBase 绑定：换网关后不复用旧目录，直接走网络', async () => {
  const cache = tempCache()
  try {
    const first = makeAdapter(cache.path)
    first.setResponder(catalogOnly(modelsBody(fixtureEntries().slice(0, 2))))
    assert.equal((await first.adapter.listModels('open-design')).length, 2)

    const other = makeAdapter(cache.path, { apiBase: 'https://other.example.test/v1' })
    other.setResponder(() => { throw new Error('connect ECONNREFUSED') })
    assert.equal((await other.adapter.listModels('open-design')).length, 12)
    const status = await other.adapter.catalogStatus()
    assert.equal(status.apiBase, 'https://other.example.test/v1')
    assert.equal(status.source, 'static')
    assert.equal(status.reason, 'unreachable')
  } finally {
    cache.cleanup()
  }
})

test('缓存超过 5 分钟即过期，重新请求网关而不是继续用旧目录', async () => {
  const cache = tempCache()
  try {
    const first = makeAdapter(cache.path)
    first.setResponder(catalogOnly(modelsBody(fixtureEntries().slice(0, 2))))
    assert.equal((await first.adapter.listModels('open-design')).length, 2)

    // TTL 从网关回答的时刻起算：读了一次缓存不会把有效期往后顺延。
    const freshRead = makeAdapter(cache.path)
    freshRead.setNow(1_000_000 + SUCCESS_TTL_MS - 1_000)
    freshRead.setResponder(() => { throw new Error('network should not be touched') })
    assert.equal((await freshRead.adapter.listModels('open-design')).length, 2)
    assert.equal(freshRead.calls.length, 0)

    freshRead.setNow(1_000_000 + SUCCESS_TTL_MS)
    freshRead.setResponder(catalogOnly(MODELS_FIXTURE))
    assert.equal((await freshRead.adapter.listModels('open-design')).length, 12)
    assert.equal(freshRead.calls.length, 1)
  } finally {
    cache.cleanup()
  }
})

test('内存目录在 5 分钟内不重复请求，过期后才刷新', async () => {
  const cache = tempCache()
  try {
    const harness = makeAdapter(cache.path)
    assert.equal((await harness.adapter.listModels('open-design')).length, 12)
    assert.equal(harness.calls.length, 1)

    harness.setNow(1_000_000 + SUCCESS_TTL_MS - 1)
    harness.setResponder(catalogOnly(modelsBody(fixtureEntries().slice(0, 2))))
    assert.equal((await harness.adapter.listModels('open-design')).length, 12)
    assert.equal(harness.calls.length, 1)

    harness.setNow(1_000_000 + SUCCESS_TTL_MS)
    assert.equal((await harness.adapter.listModels('open-design')).length, 2)
    assert.equal(harness.calls.length, 2)
  } finally {
    cache.cleanup()
  }
})

test('失败后 10 秒重试窗口：窗口内不重试，窗口外重试', async () => {
  const cache = tempCache()
  try {
    const harness = makeAdapter(cache.path)
    harness.setResponder(() => { throw new Error('connect ETIMEDOUT') })
    assert.equal((await harness.adapter.catalogStatus()).source, 'static')
    assert.equal(harness.calls.length, 1)

    harness.setNow(1_000_000 + FAILURE_RETRY_TTL_MS - 1)
    assert.equal((await harness.adapter.catalogStatus()).source, 'static')
    assert.equal(harness.calls.length, 1)

    harness.setNow(1_000_000 + FAILURE_RETRY_TTL_MS)
    harness.setResponder(catalogOnly(MODELS_FIXTURE))
    assert.equal((await harness.adapter.catalogStatus()).source, 'live')
    assert.equal(harness.calls.length, 2)
  } finally {
    cache.cleanup()
  }
})

test('目录不存在会被创建；写缓存失败不影响本次目录使用', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'od-catalog-'))
  try {
    const nested = join(dir, 'a', 'b', 'models-cache.json')
    const nestedAdapter = makeAdapter(nested)
    assert.equal((await nestedAdapter.adapter.listModels('open-design')).length, 12)
    assert.equal(JSON.parse(readFileSync(nested, 'utf8')).apiBase, 'https://models.example.test/v1')

    // 把缓存路径放到一个普通文件下面：mkdir 必然失败，目录仍然可用。
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    const blocked = makeAdapter(join(blocker, 'models-cache.json'))
    assert.equal((await blocked.adapter.listModels('open-design')).length, 12)
    assert.equal((await blocked.adapter.catalogStatus()).source, 'live')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('目录请求走 {apiBase}/models 并带 Bearer 鉴权，不把 Key 写进缓存', async () => {
  const cache = tempCache()
  try {
    const requests: Array<{ url: string; authorization: string | undefined }> = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
      })
      return jsonResponse(MODELS_FIXTURE)
    }) as unknown as typeof fetch
    const adapter = new OpenDesignAdapter({
      options: () => connection(cache.path),
      resolveApiKey: async () => 'user_secret_key',
      fetchImpl,
    })
    await adapter.listModels('open-design')

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, 'https://models.example.test/v1/models')
    assert.equal(requests[0]?.authorization, 'Bearer user_secret_key')
    assert.equal(readFileSync(cache.path, 'utf8').includes('user_secret_key'), false)
  } finally {
    cache.cleanup()
  }
})

test('缺凭据时仍能列出静态快照，来源标记为缺凭据而不是崩', async () => {
  const cache = tempCache()
  try {
    const calls: string[] = []
    const adapter = new OpenDesignAdapter({
      options: () => connection(cache.path),
      resolveApiKey: async () => { throw new LlmError('没有可用的 Open Design API Key', 'MISSING_CREDENTIAL') },
      fetchImpl: gatewayStub(() => jsonResponse(MODELS_FIXTURE), calls),
    })
    assert.equal((await adapter.listModels('open-design')).length, 12)
    assert.equal(calls.length, 0)
    const status = await adapter.catalogStatus()
    assert.equal(status.source, 'static')
    assert.equal(status.reason, 'missing-credential')
  } finally {
    cache.cleanup()
  }
})
