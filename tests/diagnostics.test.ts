/**
 * 脱敏诊断（ticket 06）—— 复制给支持人员的「当前生效配置」。
 *
 * 只测对外形状：快照含哪些字段、文本是否可读，以及**不含**密钥明文（引用名与
 * 存在性可以出现，`~/.amr` 里的密钥值绝不能出现）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import { OpenDesignAdapter, type OpenDesignAdapterDeps, type OpenDesignConnectionOptions } from '../src/adapter.ts'
import { DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/adapter.ts'
import { diagnosticsSnapshot, formatDiagnostics } from '../src/diagnostics.ts'

const MODELS_FIXTURE = readFileSync(new URL('./fixtures/models.json', import.meta.url), 'utf8')

function connection(overrides: Partial<OpenDesignConnectionOptions> = {}): OpenDesignConnectionOptions {
  return {
    apiBase: 'https://models.example.test/v1',
    modelsCachePath: '/tmp/od-diagnostics/models-cache.json',
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    ...overrides,
  }
}

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
    ...(overrides.credentialState === undefined ? {} : { credentialState: overrides.credentialState }),
  })
}

test('诊断快照报网关地址、目录来源与模型数、超时与重试、凭据引用与存在性、CLI 登录态可读性', async () => {
  const adapter = makeAdapter({
    options: () => connection({ requestTimeoutMs: 120_000, streamIdleTimeoutMs: 45_000, maxOutputTokens: 16_000 }),
    credentialState: () => ({
      ref: 'OPEN_DESIGN_API_KEY',
      present: true,
      login: { path: '/home/tester/.amr/config.json', status: 'unreadable', hasRuntimeKey: false },
    }),
  })
  // 先让目录真的拉一次（对话路径读的就是这份内存目录），再复制诊断。
  await adapter.listModels('open-design')
  const snapshot = await adapter.diagnostics()

  assert.equal(snapshot.gateway, 'https://models.example.test/v1')
  assert.equal(snapshot.catalog.source, 'live')
  assert.equal(snapshot.catalog.models, 12)
  assert.equal(snapshot.catalog.visible, 12)
  assert.deepEqual(snapshot.credential, { ref: 'OPEN_DESIGN_API_KEY', present: true })
  assert.deepEqual(snapshot.cliLogin, {
    path: '/home/tester/.amr/config.json',
    status: 'unreadable',
    hasRuntimeKey: false,
  })
  assert.equal(snapshot.timeouts.requestMs, 120_000)
  assert.equal(snapshot.timeouts.streamIdleMs, 45_000)
  assert.equal(snapshot.output.maxTokensOverride, 16_000)
  assert.equal(snapshot.retry.transportMaxRetries, 5, '未配置时报告生效的默认值')
  assert.deepEqual([...snapshot.retry.retryableCodes], ['EMPTY_RESPONSE', 'RATE_LIMIT', 'TIMEOUT', 'TRANSIENT', 'TRANSPORT'])
})

test('可复制文本逐条列出当前生效配置，并声明不含密钥', async () => {
  const adapter = makeAdapter({
    credentialState: () => ({
      ref: 'OPEN_DESIGN_API_KEY',
      present: false,
      login: { path: '/home/tester/.amr/config.json', status: 'ok', hasRuntimeKey: true },
    }),
  })
  await adapter.listModels('open-design')
  const text = formatDiagnostics(await adapter.diagnostics())
  assert.match(text, /Open Design 诊断/u)
  assert.match(text, /不含密钥|密钥只显示引用名/u)
  assert.match(text, /https:\/\/models\.example\.test\/v1/u)
  assert.match(text, /实时/u)
  assert.match(text, /OPEN_DESIGN_API_KEY/u)
  assert.match(text, /未配置/u)
  assert.match(text, /\.amr\/config\.json/u)
  assert.match(text, /可读，含 runtimeKey/u)
  assert.match(text, /请求超时/u)
})

test('即使观察值里夹带了密钥字段，快照与文本也不会带出密钥明文', () => {
  const secret = 'sk-amr-SECRET-do-not-leak'
  const snapshot = diagnosticsSnapshot({
    gateway: 'https://models.example.test/v1',
    catalog: { source: 'snapshot', models: 12, visible: 3, fallbackReason: 'HTTP 401' },
    credential: { ref: 'OPEN_DESIGN_API_KEY', present: true, value: secret },
    cliLogin: { path: '/home/tester/.amr/config.json', status: 'ok', hasRuntimeKey: true, runtimeKey: secret },
    contextWindow: undefined,
    contextWindowOverrides: {},
    maxOutputTokens: undefined,
    requestTimeoutMs: 300_000,
    streamIdleTimeoutMs: 300_000,
    transportMaxRetries: 5,
    retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'TIMEOUT', 'TRANSIENT', 'TRANSPORT'],
  } as never)
  for (const rendered of [JSON.stringify(snapshot), formatDiagnostics(snapshot)]) {
    assert.equal(rendered.includes(secret), false)
    assert.equal(rendered.includes('SECRET'), false)
  }
})

test('CLI 登录态按读取状态给出可照做的说法：缺文件要 vela login，坏 JSON 要重新登录', () => {
  const base = {
    gateway: 'https://models.example.test/v1',
    catalog: { source: 'snapshot' as const, models: 12, visible: 12 },
    credential: { ref: 'OPEN_DESIGN_API_KEY', present: false },
    contextWindow: undefined,
    contextWindowOverrides: {},
    maxOutputTokens: undefined,
    requestTimeoutMs: 300_000,
    streamIdleTimeoutMs: 300_000,
    retryableCodes: ['EMPTY_RESPONSE'],
  }
  const missing = formatDiagnostics(diagnosticsSnapshot({
    ...base,
    cliLogin: { path: '/home/tester/.amr/config.json', status: 'missing', hasRuntimeKey: false },
  }))
  assert.match(missing, /文件不存在/u)
  assert.match(missing, /vela login|CLI 登录态/u)

  const unknown = formatDiagnostics(diagnosticsSnapshot({
    ...base,
    cliLogin: { path: '', status: 'missing', hasRuntimeKey: false },
  }))
  assert.match(unknown, /未知/u)
  assert.doesNotMatch(unknown, /文件不存在/u)

  const malformed = formatDiagnostics(diagnosticsSnapshot({
    ...base,
    cliLogin: { path: '/home/tester/.amr/config.json', status: 'malformed', hasRuntimeKey: false },
  }))
  assert.match(malformed, /不是合法 JSON/u)
})
