/**
 * `/opendesign` 命令（ticket 10）：三态文本看板。
 *
 * 只断言「用户看到的文本」：档位、两窗口的已用/上限、重置时间、余额、计费口径
 * 与降级原因。不碰内部格式化函数；格式微调只要信息还在就不该改这些用例。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { commandDefinition, renderQuota } from '../src/commands.ts'
import type { QuotaReading, QuotaSnapshot } from '../src/control-plane.ts'

const FULL: QuotaSnapshot = {
  controlPlaneAvailable: true,
  tier: 'go',
  subscriptionStatus: 'active',
  currentPeriodEnd: '2026-11-20T03:18:08.000Z',
  balanceUsd: 1,
  funding: 'coding_plan',
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

const READING: QuotaReading = { snapshot: FULL, creditsPerUsd: 10000 }

test('有额度（zh）：档位、两个窗口、重置时间、余额与计费口径都在看板里', () => {
  const text = renderQuota(READING, 'zh')
  assert.match(text, /Open Design 额度/u)
  assert.match(text, /套餐：go/u)
  assert.match(text, /5 小时窗口/u)
  assert.match(text, /7 天窗口/u)
  assert.match(text, /340 \/ 50000/)
  assert.match(text, /14814 \/ 150000/)
  assert.match(text, /重置：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u)
  assert.match(text, /钱包余额：\$1\.00/u)
  assert.match(text, /先扣 Design Plan 额度/u)
  // credits → 美元当量只作展示（10000 credits = $1）。
  assert.match(text, /\$1\.48 \/ \$15\.00/)
})

test('有额度（en）：同一份数据换英文文案', () => {
  const text = renderQuota(READING, 'en')
  assert.match(text, /Open Design quota/)
  assert.match(text, /Plan: go/)
  assert.match(text, /5-hour window/)
  assert.match(text, /7-day window/)
  assert.match(text, /Wallet balance: \$1\.00/)
  assert.match(text, /Design Plan credits first/)
})

test('额度耗尽/钱包计费：没有窗口时说明按钱包扣，而不是画 0/0', () => {
  const reading: QuotaReading = {
    snapshot: { ...FULL, tier: 'plus', windows: [], funding: 'wallet' },
    creditsPerUsd: 10000,
  }
  const text = renderQuota(reading, 'zh')
  assert.match(text, /eligible=false|按钱包余额计费/u)
  assert.doesNotMatch(text, /0 \/ 0/)
  assert.match(renderQuota(reading, 'en'), /wallet balance/i)
})

test('无控制密钥：给出原因与下一步，不报错、不画空窗口', () => {
  const reading: QuotaReading = {
    snapshot: {
      controlPlaneAvailable: false,
      windows: [],
      fetchedAt: '2026-10-20T10:31:46.562Z',
    },
    reason: 'no-control-key',
  }
  const text = renderQuota(reading, 'zh')
  assert.match(text, /controlKey/u)
  assert.match(text, /https:\/\/open-design\.ai\/cloud\/dashboard/)
  assert.match(text, /vela login/)
  assert.doesNotMatch(text, /credits/)
})

test('数据过期：同一份快照标注 stale', () => {
  const reading: QuotaReading = {
    snapshot: { ...FULL, stale: true },
    creditsPerUsd: 10000,
  }
  assert.match(renderQuota(reading, 'zh'), /数据已过期/u)
  assert.match(renderQuota(reading, 'en'), /stale/i)
})

test('命令是 TUI 安全纯文本：无 ANSI 颜色、无 emoji 依赖，且数据源走注入的 quota', async () => {
  let asked: string | undefined
  const command = commandDefinition({
    quota: async (model) => {
      asked = model
      return READING
    },
    model: async () => 'deepseek-v4.1-flash',
    getLocale: () => 'zh',
  })
  assert.equal(command.name, 'opendesign')

  const result = await command.handler({ rawInput: '' } as never)
  assert.equal(result.kind, 'success')
  assert.equal(asked, 'deepseek-v4.1-flash')
  const text = (result as { text: string }).text

  assert.doesNotMatch(text, /\u001B\[/u, '不得带 ANSI 转义序列')
  // 只允许十格方块条这两个字符；其它 emoji/符号区不应出现。
  const stripped = text.replace(/[█░]/gu, '')
  assert.doesNotMatch(stripped, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
})

test('读取失败时命令返回 error 结果而不是抛错', async () => {
  const command = commandDefinition({
    quota: async () => { throw new Error('boom') },
    getLocale: () => 'zh',
  })
  const result = await command.handler({ rawInput: '' } as never)
  assert.equal(result.kind, 'error')
  assert.match((result as { text: string }).text, /boom/u)
})

test('取模型失败不影响额度看板：跳过预检继续展示档位与余额', async () => {
  const command = commandDefinition({
    quota: async () => READING,
    model: async () => { throw new Error('catalog down') },
    getLocale: () => 'zh',
  })
  const result = await command.handler({ rawInput: '' } as never)
  assert.equal(result.kind, 'success')
  assert.match((result as { text: string }).text, /套餐：go/u)
})
