/**
 * `opendesign/usage` Remote（ticket 10）：冻结额度快照的严格边界解析、descriptor
 * 形状，以及「命令与 Remote 共用同一份 60 秒缓存」这条装配事实。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context, Service } from '@deepseek-ai/cordis'
import {
  QUOTA_DESCRIPTOR,
  QUOTA_ENDPOINT,
  parseQuotaSnapshot,
} from '../src/quota-wire.ts'
import { OpenDesignModelsService } from '../src/models-remote.ts'
import { OpenDesignControlPlane } from '../src/control-plane.ts'
import type { QuotaReading, QuotaSnapshot } from '../src/control-plane.ts'
import { commandDefinition } from '../src/commands.ts'

const SNAPSHOT: QuotaSnapshot = {
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
  fetchedAt: '2026-10-20T10:31:46.562Z',
}

test('descriptor 声明在 opendesign 命名空间下，以 usage 方法调用', () => {
  assert.equal(QUOTA_ENDPOINT, 'opendesign/usage')
  assert.equal(QUOTA_DESCRIPTOR.namespace, 'opendesign')
  assert.equal(QUOTA_DESCRIPTOR.method, 'usage')
  assert.match(QUOTA_DESCRIPTOR.id, /opendesign\/usage$/)
})

test('strict 边界解析接受冻结快照并拒绝坏形状', () => {
  assert.deepEqual(parseQuotaSnapshot(SNAPSHOT), SNAPSHOT)

  const noAvailability = { ...SNAPSHOT } as Record<string, unknown>
  delete noAvailability.controlPlaneAvailable
  assert.throws(() => parseQuotaSnapshot(noAvailability), /controlPlaneAvailable/)

  assert.throws(
    () => parseQuotaSnapshot({ ...SNAPSHOT, windows: [{ ...SNAPSHOT.windows[0], kind: 'monthly' }] }),
    /windows\[0\]\.kind/,
  )
  assert.throws(() => parseQuotaSnapshot({ ...SNAPSHOT, windows: 'nope' }), /windows/)
  assert.throws(() => parseQuotaSnapshot({ ...SNAPSHOT, funding: 'credits' }), /funding/)
})

test('Remote 服务返回冻结快照（Host 侧唯一数据入口）', async () => {
  const ctx = new Context()
  const reading: QuotaReading = { snapshot: SNAPSHOT, creditsPerUsd: 10000 }
  const service = new OpenDesignModelsService(ctx, {
    catalogStatus: async () => ({ source: 'live', apiBase: 'https://x', cached: false, models: [] }) as never,
    credentialStatus: async () => ({}) as never,
    quota: async () => reading.snapshot,
  })
  assert.ok(service instanceof Service)
  assert.ok(service.usage !== undefined)
  assert.deepEqual(await service.usage!(), SNAPSHOT)
})

test('命令与 Remote 共用同一份缓存：连续三次展示只查一轮控制面', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'od-quota-shared-'))
  const loginPath = join(dir, 'config.json')
  await writeFile(loginPath, JSON.stringify({
    profiles: {
      prod: {
        controlKey: 'vela_ctrl_fixture_shared',
        apiUrl: 'https://control.example',
      },
    },
  }), 'utf8')

  let calls = 0
  const fetchImpl = (async (input: string | URL | Request) => {
    calls += 1
    const url = String(input)
    const body = url.endsWith('/workspaces/current')
      ? { activeWorkspaceId: 'ws_shared', personalMembershipTier: 'go' }
      : url.includes('/billing/summary')
        ? { membershipTier: 'go', balanceUsd: '1.0000', creditsPerUsd: 10000, subscriptionStatus: 'active' }
        : {
            codingPlan: {
              eligible: true,
              tier: 'go',
              windows: [{
                durationSeconds: 18000,
                usedCredits: '340',
                limitCredits: '50000',
                remainingCredits: '49660',
                resetsAt: '2026-10-20T13:18:08.000Z',
              }],
            },
            funding: 'wallet',
          }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch

  const control = new OpenDesignControlPlane({ loginPath, fetchImpl, now: () => 1_800_000_000_000 })
  const quota = (): Promise<QuotaReading> => control.read({ model: 'deepseek-v4.1-flash' })
  const service = new OpenDesignModelsService(new Context(), {
    catalogStatus: async () => ({ source: 'live', apiBase: 'https://x', cached: false, models: [] }) as never,
    credentialStatus: async () => ({}) as never,
    quota: async () => (await quota()).snapshot,
  })
  const command = commandDefinition({
    quota,
    model: async () => 'deepseek-v4.1-flash',
    getLocale: () => 'zh',
  })

  const fromRemote = await service.usage!()
  assert.equal(fromRemote.windows.length, 1)
  await command.handler({ rawInput: '' } as never)
  await command.handler({ rawInput: '' } as never)

  assert.equal(calls, 3, '三个接口各一次，命令与 Remote 不再重复查询')
})
