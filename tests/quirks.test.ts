/**
 * 兼容规则（ticket 02）—— 档位域、off 的字面量、输出上限字段名。
 *
 * 期望值直接来自协议实测：`off → "none"`（省略字段仍会思考）、glm 只接受
 * low/high/max、kimi 没有 off 也没有 max。它们不是从被测模块反推的。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  OUTPUT_CAP_FIELD,
  WIRE_REASONING_OFF,
  coerceReasoningLevel,
  outputCapFloor,
  reasoningLevelsFor,
  supportsReasoningLevel,
  thinkingBudgetFor,
  wireReasoningEffort,
} from '../src/quirks.ts'
import { effectiveOutputCap } from '../src/output-budget.ts'

test('输出上限只发 max_completion_tokens，不发 max_tokens', () => {
  assert.equal(OUTPUT_CAP_FIELD, 'max_completion_tokens')
})

test('off 上线的字面量是 "none"，其余档位原样，未选档位不发字段', () => {
  assert.equal(WIRE_REASONING_OFF, 'none')
  assert.equal(wireReasoningEffort('off'), 'none')
  assert.equal(wireReasoningEffort('minimal'), 'minimal')
  assert.equal(wireReasoningEffort('high'), 'high')
  assert.equal(wireReasoningEffort('max'), 'max')
  assert.equal(wireReasoningEffort(undefined), undefined)
})

test('逐模型档位域：DeepSeek 只 4 档、glm 仅 low/high/max、kimi 无 off 无 max', () => {
  // DeepSeek 的 reasoning_effort 收 8 个 wire 值，但官方映射表只落成三档真实
  // 档位（外加关闭）；详见 catalog-snapshot.ts 的 DEEPSEEK_LEVELS。
  for (const model of ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro']) {
    assert.deepEqual(reasoningLevelsFor(model), ['off', 'low', 'high', 'max'])
  }
  assert.deepEqual(reasoningLevelsFor('claude-haiku-5.5').length, 7)
  assert.deepEqual(reasoningLevelsFor('gpt-6-luna').length, 7)
  assert.deepEqual(reasoningLevelsFor('glm-5.3-flash'), ['low', 'high', 'max'])
  assert.deepEqual(reasoningLevelsFor('glm-5.3-flashx'), ['low', 'high', 'max'])
  assert.deepEqual(reasoningLevelsFor('kimi-k2.7-code'), ['minimal', 'low', 'medium', 'high', 'xhigh'])
  // 快照外的模型先按全档处理，等实时目录校准（ticket 03）。
  assert.deepEqual(reasoningLevelsFor('some-new-model').length, 7)
})

test('supportsReasoningLevel 只认域内档位', () => {
  assert.equal(supportsReasoningLevel('glm-5.3-flash', 'high'), true)
  assert.equal(supportsReasoningLevel('glm-5.3-flash', 'medium'), false)
  assert.equal(supportsReasoningLevel('kimi-k2.7-code', 'off'), false)
  assert.equal(supportsReasoningLevel('kimi-k2.7-code', 'max'), false)
  // DeepSeek 的 minimal/medium/xhigh 只是 wire 别名，不是可选档位。
  assert.equal(supportsReasoningLevel('deepseek-v4.1-flash', 'low'), true)
  assert.equal(supportsReasoningLevel('deepseek-v4.1-flash', 'medium'), false)
  assert.equal(supportsReasoningLevel('deepseek-v4.1-flash', 'xhigh'), false)
})

test('非法档位收敛到最近合法档，glm 按设计的折叠规则', () => {
  assert.equal(coerceReasoningLevel('glm-5.3-flash', 'off'), 'low')
  assert.equal(coerceReasoningLevel('glm-5.3-flash', 'minimal'), 'low')
  assert.equal(coerceReasoningLevel('glm-5.3-flash', 'medium'), 'low')
  assert.equal(coerceReasoningLevel('glm-5.3-flash', 'xhigh'), 'max')
  assert.equal(coerceReasoningLevel('glm-5.3-flash', 'high'), 'high')
  // kimi 的域是连续的 minimal..xhigh，两侧夹到边界。
  assert.equal(coerceReasoningLevel('kimi-k2.7-code', 'off'), 'minimal')
  assert.equal(coerceReasoningLevel('kimi-k2.7-code', 'max'), 'xhigh')
  assert.equal(coerceReasoningLevel('kimi-k2.7-code', 'medium'), 'medium')
  // DeepSeek 按官方映射表折叠：medium → high（注意与 glm 的 medium → low 相反）。
  assert.equal(coerceReasoningLevel('deepseek-v4.1-flash', 'off'), 'off')
  assert.equal(coerceReasoningLevel('deepseek-v4.1-flash', 'low'), 'low')
  assert.equal(coerceReasoningLevel('deepseek-v4.1-flash', 'minimal'), 'low')
  assert.equal(coerceReasoningLevel('deepseek-v4.1-flash', 'medium'), 'high')
  assert.equal(coerceReasoningLevel('deepseek-v4.1-flash', 'xhigh'), 'high')
  assert.equal(coerceReasoningLevel('deepseek-v4.1-flash', 'max'), 'max')
  // 同样的折叠对另外三个 DeepSeek 模型成立。
  assert.equal(coerceReasoningLevel('deepseek-v4-flash', 'medium'), 'high')
  assert.equal(coerceReasoningLevel('deepseek-v4-pro', 'xhigh'), 'high')
  assert.equal(coerceReasoningLevel('deepseek-v4-flash-vision-exp', 'minimal'), 'low')
  // 全档模型原样通过。
  assert.equal(coerceReasoningLevel('claude-haiku-5.5', 'off'), 'off')
  assert.equal(coerceReasoningLevel('claude-haiku-5.5', 'xhigh'), 'xhigh')
})

test('DeepSeek 的 wire 值多于真实档位：8 个词只对应 off/low/high/max', () => {
  // 依据 DeepSeek 官方「思考模式」映射表与网关 400 文案：
  // 网关接受 none/minimal/low/medium/high/xhigh/ultra/max 八个词，但
  // minimal→low、medium→high、xhigh→high、ultra→max，真实档位只有四档。
  const deepseek = ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro']
  for (const model of deepseek) {
    assert.deepEqual(reasoningLevelsFor(model), ['off', 'low', 'high', 'max'], model)
    // 别名不是可选档位：调用方点不到，就不该被当成档位发出去。
    for (const alias of ['minimal', 'medium', 'xhigh'] as const) {
      assert.equal(supportsReasoningLevel(model, alias), false, `${model} ${alias}`)
      assert.notEqual(coerceReasoningLevel(model, alias), alias, `${model} ${alias}`)
    }
  }
  // 折叠方向以官方映射表为准，和 glm 的保守折叠相反。
  assert.equal(coerceReasoningLevel('deepseek-v4.1-flash', 'medium'), 'high')
  assert.equal(coerceReasoningLevel('glm-5.3-flash', 'medium'), 'low')
})

// ---------------------------------------------------------------------------
// kimi 的思考预算门限（ticket 05）
// ---------------------------------------------------------------------------

test('kimi 的 thinking 预算：minimal/low 8192、medium 32768，high/xhigh 实测无门限', () => {
  // 实测（2026-10-20，`max_completion_tokens:16` 逐档探测）：
  // low/minimal 报 `must be greater than thinking_budget [8192]`，
  // medium 报 `[32768]`；high 与 xhigh 在 16 甚至 1 时都 200，没有预算门限。
  assert.equal(thinkingBudgetFor('kimi-k2.7-code', 'minimal'), 8_192)
  assert.equal(thinkingBudgetFor('kimi-k2.7-code', 'low'), 8_192)
  assert.equal(thinkingBudgetFor('kimi-k2.7-code', 'medium'), 32_768)
  assert.equal(thinkingBudgetFor('kimi-k2.7-code', 'high'), undefined)
  assert.equal(thinkingBudgetFor('kimi-k2.7-code', 'xhigh'), undefined)
  // 其他模型没有这层门限，选什么档都不影响输出上限。
  assert.equal(thinkingBudgetFor('deepseek-v4.1-flash', 'medium'), undefined)
  assert.equal(thinkingBudgetFor('glm-5.3-flash', 'high'), undefined)
  assert.equal(thinkingBudgetFor('kimi-k2.7-code', undefined), undefined)
})

test('门限是「大于」：kimi 各档所需的最小 max_completion_tokens 是预算 + 1', () => {
  assert.equal(outputCapFloor('kimi-k2.7-code', 'low'), 8_193)
  assert.equal(outputCapFloor('kimi-k2.7-code', 'medium'), 32_769)
  assert.equal(outputCapFloor('kimi-k2.7-code', 'high'), undefined)
  assert.equal(outputCapFloor('kimi-k2.7-code', 'xhigh'), undefined)
  assert.equal(outputCapFloor('deepseek-v4.1-flash', 'medium'), undefined)
})

test('kimi 收敛矩阵：小上限被抬到门限之上，大上限不受影响，越界被 262144 压住', () => {
  const capFor = (level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh', hostBudget: number) =>
    effectiveOutputCap({
      hostBudget,
      modelBudget: 65_536,
      thinkingFloor: outputCapFloor('kimi-k2.7-code', level),
    })

  // 小上限：不抬就 400，抬到「预算 + 1」且只抬这一档需要的量。
  assert.equal(capFor('minimal', 16), 8_193)
  assert.equal(capFor('low', 16), 8_193)
  assert.equal(capFor('medium', 16), 32_769)
  // high/xhigh 实测无门限，小上限原样保留（kimi 自己会精确截断）。
  assert.equal(capFor('high', 16), 16)
  assert.equal(capFor('xhigh', 16), 16)
  // 恰好等于门限时还要 +1：上游是严格「大于」。
  assert.equal(capFor('low', 8_192), 8_193)
  assert.equal(capFor('medium', 32_768), 32_769)
  // 大上限已经高于门限，原样保留（仍受模型预算 65536 约束）。
  assert.equal(capFor('low', 40_000), 40_000)
  assert.equal(capFor('medium', 65_536), 65_536)
  // 越界上限先被模型预算与绝对上限压住。
  assert.equal(capFor('medium', 131_072), 65_536)
  assert.equal(capFor('medium', 300_000), 65_536)
  // 未设宿主预算：跟随模型预算。
  assert.equal(
    effectiveOutputCap({ modelBudget: 65_536, thinkingFloor: outputCapFloor('kimi-k2.7-code', 'low') }),
    65_536,
  )
})

