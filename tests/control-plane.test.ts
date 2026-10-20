/**
 * 控制面额度只读客户端（ticket 10）：以 stub `fetch` 驱动，断言「对控制面发出的
 * 请求」与「对外产出的 `QuotaSnapshot`」，不碰内部函数。
 *
 * 夹具是 2026-10-20 本机真实响应的脱敏固化（id 换成 `*_fixture_*`，形状与字符串
 * 数值类型原样保留：credits/balanceUsd 在真实响应里都是字符串）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CONTROL_PLANE_TIMEOUT_MS,
  OpenDesignControlPlane,
  QUOTA_CACHE_TTL_MS,
  QUOTA_FIVE_HOUR_SECONDS,
  QUOTA_SEVEN_DAY_SECONDS,
  classifyQuotaWindow,
  type QuotaWindowKind,
} from '../src/control-plane.ts'

const HERE = new URL('.', import.meta.url)
const fixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}`, HERE), 'utf8'))

const CONTROL_KEY = 'vela_ctrl_fixture_control_key'
const API_URL = 'https://control.example'

interface Recorded {
  url: string
  method: string
  authorization: string | undefined
  body: string | undefined
}

/** A login state whose `apiUrl` is the control plane; the runtime key is irrelevant here. */
async function loginState(overrides: Record<string, unknown> = {}): Promise<{ path: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'od-control-'))
  const path = join(dir, 'config.json')
  await writeFile(path, JSON.stringify({
    profiles: {
      prod: {
        apiKey: 'sk-amr-fixture-runtime',
        runtimeKey: 'sk-amr-fixture-runtime',
        controlKey: CONTROL_KEY,
        apiUrl: API_URL,
        linkUrl: 'https://runtime.example',
        ...overrides,
      },
    },
  }), 'utf8')
  return { path, dir }
}

/** Stub fetch that answers each endpoint from the fixtures and records what it saw. */
function controlFetch(
  bodies: { workspace?: unknown; summary?: unknown; preflight?: unknown } = {},
  respond?: (url: string) => Response | undefined,
): { fetchImpl: typeof fetch; seen: Recorded[] } {
  const seen: Recorded[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    seen.push({
      url,
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('authorization') ?? undefined,
      body: init?.body === undefined || init.body === null ? undefined : String(init.body),
    })
    const stub = respond?.(url)
    if (stub !== undefined) return stub
    const body = url.endsWith('/workspaces/current')
      ? bodies.workspace ?? FIXTURES.workspace
      : url.includes('/billing/summary')
        ? bodies.summary ?? FIXTURES.summary
        : url.includes('/billing/preflight')
          ? bodies.preflight ?? FIXTURES.preflight
          : { error: 'unexpected' }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetchImpl, seen }
}

const FIXTURES = {
  workspace: await fixture('control-workspace.json'),
  summary: await fixture('control-billing-summary.json'),
  preflight: await fixture('control-preflight.json'),
}

function client(deps: {
  loginPath: string
  fetchImpl?: typeof fetch
  now?: () => number
  timeoutMs?: number
}): OpenDesignControlPlane {
  return new OpenDesignControlPlane({
    loginPath: deps.loginPath,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  })
}

test('只读三个控制面接口：当前工作区 → 账单摘要 → 按模型预检，全部 GET 且带 Bearer 控制密钥', async () => {
  const { path } = await loginState()
  const { fetchImpl, seen } = controlFetch()
  const reading = await client({ loginPath: path, fetchImpl }).read({ model: 'deepseek-v4.1-flash' })

  assert.deepEqual(seen.map((entry) => entry.method), ['GET', 'GET', 'GET'])
  assert.deepEqual(seen.map((entry) => entry.url), [
    `${API_URL}/api/v1/workspaces/current`,
    `${API_URL}/api/v1/billing/summary`,
    `${API_URL}/api/v1/workspaces/ws_fixture_personal/billing/preflight?model=deepseek-v4.1-flash`,
  ])
  for (const entry of seen) {
    assert.equal(entry.authorization, `Bearer ${CONTROL_KEY}`)
    assert.equal(entry.body, undefined, '只读客户端绝不带请求体')
  }
  assert.equal(reading.snapshot.controlPlaneAvailable, true)
  assert.equal(reading.creditsPerUsd, 10000)
})

test('额度快照按冻结形状解析：档位、余额、funding、两个窗口与重置时间', async () => {
  const { path } = await loginState()
  const { fetchImpl } = controlFetch()
  const reading = await client({ loginPath: path, fetchImpl, now: () => 1_800_000_000_000 })
    .read({ model: 'deepseek-v4.1-flash' })

  assert.deepEqual(reading.snapshot, {
    controlPlaneAvailable: true,
    tier: 'go',
    subscriptionStatus: 'active',
    currentPeriodEnd: '2026-11-20T03:18:08.000Z',
    balanceUsd: 1,
    funding: 'wallet',
    windows: [
      {
        kind: 'five_hour',
        durationSeconds: 18000,
        usedCredits: 340,
        limitCredits: 50000,
        remainingCredits: 49660,
        resetsAt: '2026-10-20T13:18:08.000Z',
        resetMode: 'anchored_recurring',
      },
      {
        kind: 'seven_day',
        durationSeconds: 604800,
        usedCredits: 14814,
        limitCredits: 150000,
        remainingCredits: 135186,
        resetsAt: '2026-10-27T03:18:08.000Z',
        resetMode: 'anchored_recurring',
      },
    ],
    fetchedAt: new Date(1_800_000_000_000).toISOString(),
  })
})

test('窗口按 durationSeconds 分类：18000=5 小时、604800=7 天、未知时长原样列出', () => {
  const cases: Array<[number, QuotaWindowKind]> = [
    [QUOTA_FIVE_HOUR_SECONDS, 'five_hour'],
    [QUOTA_SEVEN_DAY_SECONDS, 'seven_day'],
    [3600, 'other'],
  ]
  for (const [seconds, kind] of cases) assert.equal(classifyQuotaWindow(seconds), kind)
  assert.equal(QUOTA_FIVE_HOUR_SECONDS, 18000)
  assert.equal(QUOTA_SEVEN_DAY_SECONDS, 604800)
})

/** 可变时钟 + 计数 fetch：缓存用例需要精确控制「60 秒」这条线。 */
function clocked(start = 1_800_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start
  return { now: () => current, advance: (ms: number) => { current += ms } }
}

test('Host 侧 60 秒缓存：窗口内不重发请求，过期后刷新，force 可强制刷新', async () => {
  const { path } = await loginState()
  const { fetchImpl, seen } = controlFetch()
  const clock = clocked()
  const control = client({ loginPath: path, fetchImpl, now: clock.now })

  const first = await control.read({ model: 'deepseek-v4.1-flash' })
  assert.equal(seen.length, 3)
  const second = await control.read({ model: 'deepseek-v4.1-flash' })
  assert.equal(seen.length, 3, '60 秒内不得重复查询控制面')
  assert.deepEqual(second.snapshot, first.snapshot)

  clock.advance(QUOTA_CACHE_TTL_MS)
  await control.read({ model: 'deepseek-v4.1-flash' })
  assert.equal(seen.length, 6, '过期后必须重新查询')

  await control.read({ model: 'deepseek-v4.1-flash', force: true })
  assert.equal(seen.length, 9)
})

test('查询失败保留上次快照并标注 stale，绝不把额度清空成 0', async () => {
  const { path } = await loginState()
  const clock = clocked()
  let failing = false
  const fetchImpl = (async (input: string | URL | Request) => {
    if (failing) return new Response('{"error":"boom"}', { status: 500 })
    return controlFetch().fetchImpl(input)
  }) as typeof fetch

  const control = client({ loginPath: path, fetchImpl, now: clock.now })
  const fresh = await control.read({ model: 'deepseek-v4.1-flash' })
  assert.equal(fresh.snapshot.windows.length, 2)

  failing = true
  clock.advance(QUOTA_CACHE_TTL_MS)
  const stale = await control.read({ model: 'deepseek-v4.1-flash' })
  assert.equal(stale.snapshot.stale, true)
  assert.equal(stale.snapshot.controlPlaneAvailable, true)
  assert.deepEqual(stale.snapshot.windows, fresh.snapshot.windows)
  assert.equal(stale.snapshot.balanceUsd, 1)
  assert.equal(stale.snapshot.fetchedAt, fresh.snapshot.fetchedAt, '过期数据保留原来的抓取时间')
})

test('没有控制密钥：controlPlaneAvailable=false、给出原因，且一个请求都不发', async () => {
  const { path } = await loginState({ controlKey: undefined })
  const { fetchImpl, seen } = controlFetch()
  const reading = await client({ loginPath: path, fetchImpl }).read({ model: 'deepseek-v4.1-flash' })

  assert.equal(seen.length, 0)
  assert.equal(reading.snapshot.controlPlaneAvailable, false)
  assert.deepEqual(reading.snapshot.windows, [])
  assert.equal(reading.reason, 'no-control-key')
  assert.ok(Number.isFinite(Date.parse(reading.snapshot.fetchedAt)))
})

test('登录态文件不存在：降级为不可用并说明是登录态问题', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'od-control-none-'))
  const { fetchImpl, seen } = controlFetch()
  const reading = await client({ loginPath: join(dir, 'config.json'), fetchImpl }).read()

  assert.equal(seen.length, 0)
  assert.equal(reading.snapshot.controlPlaneAvailable, false)
  assert.equal(reading.reason, 'login-unavailable')
})

test('未知时长窗口原样列出（kind=other），不丢弃也不错分到 5 小时/7 天', async () => {
  const { path } = await loginState()
  const preflight = {
    ...FIXTURES.preflight as Record<string, unknown>,
    codingPlan: {
      ...(FIXTURES.preflight as { codingPlan: Record<string, unknown> }).codingPlan,
      windows: [{
        durationSeconds: 3600,
        resetMode: 'activity_triggered',
        usedCredits: '5',
        limitCredits: '100',
        remainingCredits: '95',
        resetsAt: '2026-10-20T12:00:00.000Z',
      }],
    },
  }
  const reading = await client({ loginPath: path, fetchImpl: controlFetch({ preflight }).fetchImpl })
    .read({ model: 'deepseek-v4.1-flash' })

  assert.equal(reading.snapshot.windows.length, 1)
  assert.deepEqual(reading.snapshot.windows[0], {
    kind: 'other',
    durationSeconds: 3600,
    usedCredits: 5,
    limitCredits: 100,
    remainingCredits: 95,
    resetsAt: '2026-10-20T12:00:00.000Z',
    resetMode: 'activity_triggered',
  })
})

test('预检说 codingPlan.eligible=false 时按钱包口径显示', async () => {
  const { path } = await loginState()
  const preflight = {
    ...FIXTURES.preflight as Record<string, unknown>,
    funding: undefined,
    codingPlan: {
      ...(FIXTURES.preflight as { codingPlan: Record<string, unknown> }).codingPlan,
      eligible: false,
      tier: undefined,
      windows: [],
    },
  }
  const reading = await client({ loginPath: path, fetchImpl: controlFetch({ preflight }).fetchImpl })
    .read({ model: 'deepseek-v4.1-flash' })

  assert.equal(reading.snapshot.funding, 'wallet')
  assert.equal(reading.snapshot.controlPlaneAvailable, true)
  assert.equal(reading.snapshot.tier, 'go', '档位回落到账单摘要')
  assert.deepEqual(reading.snapshot.windows, [])
})

test('超时接缝：请求挂住时按 8 秒预算中止并降级，不把命令卡死', async () => {
  assert.equal(CONTROL_PLANE_TIMEOUT_MS, 8_000)
  const { path } = await loginState()
  let aborted = false
  const hangingFetch = ((_input: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      aborted = true
      reject(new Error('aborted'))
    })
  })) as typeof fetch

  const reading = await client({ loginPath: path, fetchImpl: hangingFetch, timeoutMs: 5 })
    .read({ model: 'deepseek-v4.1-flash' })

  assert.equal(aborted, true)
  assert.equal(reading.snapshot.controlPlaneAvailable, false)
  assert.equal(reading.reason, 'unreachable')
})
