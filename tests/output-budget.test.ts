/**
 * 输出上限的有效值（ticket 05）—— 宿主预算、模型预算、绝对上限三者取小，
 * 以及 kimi 思考档要求的下限。Node:test，零依赖，`npm test` 跑。
 *
 * 期望值来自设计件 §4.3 与协议实测 §3.1：绝对上限 262144（`max_tokens` 的
 * 合法范围是 `[1, 262144]`），而 `max_tokens` 全员不认、`max_completion_tokens`
 * 是唯一被接受的字段。这里不测请求体（那是适配器测试的事），只钉住数字规则。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_OUTPUT_TOKEN_LIMIT,
  OMIT_OUTPUT_TOKENS,
  effectiveOutputCap,
  isValidMaxOutputTokens,
} from '../src/output-budget.ts'

test('绝对上限是 262144：设置项接受它，越界与非整数拒绝', () => {
  assert.equal(MAX_OUTPUT_TOKEN_LIMIT, 262_144)
  assert.equal(isValidMaxOutputTokens(OMIT_OUTPUT_TOKENS), true)
  assert.equal(isValidMaxOutputTokens(1), true)
  assert.equal(isValidMaxOutputTokens(131_072), true)
  assert.equal(isValidMaxOutputTokens(MAX_OUTPUT_TOKEN_LIMIT), true)
  // 再大一个就是上游会拒绝的请求，所以判非法而不是「很大」。
  assert.equal(isValidMaxOutputTokens(MAX_OUTPUT_TOKEN_LIMIT + 1), false)
  assert.equal(isValidMaxOutputTokens(-1), false)
  assert.equal(isValidMaxOutputTokens(64_000.5), false)
  assert.equal(isValidMaxOutputTokens(NaN), false)
  assert.equal(isValidMaxOutputTokens(Infinity), false)
  assert.equal(isValidMaxOutputTokens('64000'), false)
  assert.equal(isValidMaxOutputTokens(undefined), false)
  assert.equal(isValidMaxOutputTokens(null), false)
})

test('有效上限 = min(宿主预算, 模型输出预算, 262144)，未设宿主预算时跟随模型', () => {
  // 宿主预算最小：用户要 16，模型允许 128000。
  assert.equal(effectiveOutputCap({ hostBudget: 16, modelBudget: 128_000 }), 16)
  // 没设宿主预算：模型自己的输出预算说了算，不是绝对上限。
  assert.equal(effectiveOutputCap({ modelBudget: 128_000 }), 128_000)
  assert.equal(effectiveOutputCap({ modelBudget: 32_000 }), 32_000)
  // 宿主预算更大也不能抬过模型预算。
  assert.equal(effectiveOutputCap({ hostBudget: 200_000, modelBudget: 65_536 }), 65_536)
  // 模型预算越过绝对上限时被 262144 压住。
  assert.equal(effectiveOutputCap({ modelBudget: 500_000 }), MAX_OUTPUT_TOKEN_LIMIT)
  assert.equal(
    effectiveOutputCap({ hostBudget: 300_000, modelBudget: 500_000 }),
    MAX_OUTPUT_TOKEN_LIMIT,
  )
})

test('0 是「没有宿主预算」的哨兵，不是 0 token 的预算', () => {
  // 设计件 §4.2 把这一个字段定为固定发送；所以 0 只表示不收紧，不能把上限
  // 压成 0（那会发给上游一个必被拒的值）。
  assert.equal(OMIT_OUTPUT_TOKENS, 0)
  assert.equal(effectiveOutputCap({ hostBudget: OMIT_OUTPUT_TOKENS, modelBudget: 128_000 }), 128_000)
  // 模型预算同样不能把结果压到 0 以下。
  assert.equal(effectiveOutputCap({ hostBudget: 0, modelBudget: 0 }), 1)
  // 宿主传来非法数值（程序化构造绕过校验）按未设置处理。
  assert.equal(effectiveOutputCap({ hostBudget: -5, modelBudget: 32_000 }), 32_000)
  assert.equal(effectiveOutputCap({ hostBudget: 12.5, modelBudget: 32_000 }), 32_000)
  assert.equal(effectiveOutputCap({ hostBudget: Number.NaN, modelBudget: 32_000 }), 32_000)
})

test('思考档下限只在模型要求时抬高上限，且不越过绝对上限', () => {
  // kimi 的 low 档要求 max_completion_tokens > 8192；16 的宿主预算无法上线，
  // 抬到 8193 才能让这一档可用。
  assert.equal(effectiveOutputCap({ hostBudget: 16, modelBudget: 65_536, thinkingFloor: 8_193 }), 8_193)
  // 宿主预算本来就够大时下限不改变结果。
  assert.equal(
    effectiveOutputCap({ hostBudget: 40_000, modelBudget: 65_536, thinkingFloor: 8_193 }),
    40_000,
  )
  // 下限同样不得把上限抬过模型预算？—— 不：kimi 的档位门槛优先，否则该档直接 400；
  // 但仍受绝对上限约束。
  assert.equal(effectiveOutputCap({ hostBudget: 16, modelBudget: 8_192, thinkingFloor: 8_193 }), 8_193)
  assert.equal(effectiveOutputCap({ thinkingFloor: 300_000, modelBudget: 65_536 }), MAX_OUTPUT_TOKEN_LIMIT)
  // 没有下限时模型预算原样保留。
  assert.equal(effectiveOutputCap({ thinkingFloor: undefined, modelBudget: 65_536 }), 65_536)
})
