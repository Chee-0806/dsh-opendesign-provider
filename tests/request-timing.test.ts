import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RequestTiming, type RequestTimingSummary } from '../src/request-timing.ts'
import { absorbTransientFailure, resetTransientFailures } from '../src/transient-retry.ts'

test('阶段耗时、首内容和失败尝试可分别观测', async () => {
  let now = 0
  let summary: RequestTimingSummary | undefined
  const timing = new RequestTiming('model', (value) => { summary = value }, () => now)
  const credentials = timing.phase('credentials')
  now = 12
  credentials()
  const first = timing.attempt('openai', 123)
  now = 42
  first(429)
  const second = timing.attempt('cli', 150)
  now = 62
  second(200)
  now = 70
  timing.first('firstByteMs')
  now = 80
  timing.first('firstContentMs')
  now = 90
  timing.first('firstContentMs')
  await timing.close('finished')
  assert.equal(summary?.phasesMs.credentials, 12)
  assert.equal(summary?.phasesMs.headers, 50)
  assert.equal(summary?.firstByteMs, 70)
  assert.equal(summary?.firstContentMs, 80)
  assert.equal(summary?.totalMs, 90)
  assert.deepEqual(summary?.attempts.map((attempt) => attempt.status), [429, 200])
})

test('耗时接收器失败不改变请求结果', async () => {
  const timing = new RequestTiming('model', () => { throw new Error('unwritable') })
  await assert.doesNotReject(timing.close('error', 'SERVER'))
})

test('临时故障与 429 限流共享三次预算，确定性错误和传输错误不消耗它', () => {
  const agent = {}
  assert.equal(absorbTransientFailure(agent, 'TRANSIENT'), 'retry')
  assert.equal(absorbTransientFailure(agent, 'RATE_LIMIT'), 'retry')
  assert.equal(absorbTransientFailure(agent, 'TRANSPORT'), 'ignored')
  assert.equal(absorbTransientFailure(agent, 'EMPTY_RESPONSE'), 'retry')
  assert.equal(absorbTransientFailure(agent, 'TIMEOUT'), 'exhausted')
  // 确定性错误（鉴权/额度/坏请求/协议）重试只会重放同一个失败，既不重试也不占预算槽。
  for (const code of ['AUTH', 'QUOTA_EXHAUSTED', 'BAD_REQUEST', 'PROTOCOL_ERROR']) {
    assert.equal(absorbTransientFailure(agent, code), 'ignored')
  }
  // 429 单独一棵预算：最多 3 次，第 4 次上报。
  const limited = {}
  for (let i = 0; i < 3; i++) assert.equal(absorbTransientFailure(limited, 'RATE_LIMIT'), 'retry')
  assert.equal(absorbTransientFailure(limited, 'RATE_LIMIT'), 'exhausted')
  // THROTTLED 是同义的限流码，共享同一棵预算。
  assert.equal(absorbTransientFailure({}, 'THROTTLED'), 'retry')
  assert.equal(absorbTransientFailure({}, 'TIMEOUT'), 'retry')
  resetTransientFailures(agent)
  assert.equal(absorbTransientFailure(agent, 'TIMEOUT'), 'retry')
})

test('真实插件注册的预算处理器尊重提供商、取消以及每个步骤的重置', async () => {
  const { apply } = await import('../src/index.ts')
  const listeners = new Map<string, (...args: any[]) => any>()
  const context = {
    llm: { registerConfigurableProviders: () => undefined, registerAdapter: () => undefined },
    inject: () => undefined,
    on: (name: string, listener: (...args: any[]) => any) => { listeners.set(name, listener) },
    effect: () => undefined,
    logger: { warn: () => undefined },
  } as unknown as Parameters<typeof apply>[0]
  apply(context, {} as Parameters<typeof apply>[1])
  const handler = listeners.get('agent/request-error')!
  const session = {}, agent = { session }
  let delegated = 0
  const next = async () => { delegated++; return { kind: 'retry' } }
  const payload = { agent, provider: 'open-design', failure: { code: 'TRANSIENT', message: 'test' }, signal: new AbortController().signal }
  const aborted = new AbortController(); aborted.abort()
  for (let i = 0; i < 5; i++) {
    await handler({ ...payload, provider: 'other' }, next)
    await handler({ ...payload, signal: aborted.signal }, next)
  }
  // 确定性错误即使预算用尽也不再重试（也不消耗预算），所以放在预算之前。
  for (const code of ['AUTH', 'QUOTA_EXHAUSTED', 'BAD_REQUEST', 'PROTOCOL_ERROR']) {
    for (let i = 0; i < 5; i++) await handler({ ...payload, failure: { code, message: 'deterministic' } }, next)
  }
  for (let i = 0; i < 3; i++) await handler(payload, next)
  assert.equal(delegated, 13 + 20)
  await assert.rejects(handler(payload, next), /3 次自动重试/)
  listeners.get('session/event')!(session, { type: 'assistant/attempt' })
  await assert.rejects(handler(payload, next), /3 次自动重试/)
  listeners.get('session/event')!(session, { type: 'step/start' })
  // 重置后 429 限流走同一条预算，最多 3 次。
  for (let i = 0; i < 3; i++) await handler({ ...payload, failure: { code: 'RATE_LIMIT', message: 'window' } }, next)
  await assert.rejects(handler({ ...payload, failure: { code: 'RATE_LIMIT', message: 'window' } }, next), /3 次自动重试/)
})
