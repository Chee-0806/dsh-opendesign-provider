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
  reasoningLevelsFor,
  supportsReasoningLevel,
  wireReasoningEffort,
} from '../src/quirks.ts'

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

test('逐模型档位域：9 个全档、glm 仅 low/high/max、kimi 无 off 无 max', () => {
  assert.deepEqual(
    reasoningLevelsFor('deepseek-v4.1-flash'),
    ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  )
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
  // 全档模型原样通过。
  assert.equal(coerceReasoningLevel('deepseek-v4.1-flash', 'off'), 'off')
  assert.equal(coerceReasoningLevel('deepseek-v4.1-flash', 'xhigh'), 'xhigh')
})
