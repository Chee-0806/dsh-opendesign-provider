/**
 * Open Design 目录快照（ticket 02）—— 12 个模型的静态事实。
 *
 * 事实来源是 `docs/opendesign/00-改造设计.md` §5.2 与
 * `docs/grill/20261020-opendesign-facts-local.md` §5 的表。测试把整张表照抄一遍，
 * 而不是从被测模块反推：这样表被改错时测试会先失败，而不是跟着一起变。
 *
 * 上下文窗口取 `context_budget`（可用输入预算），不是名义 `context_limit`；
 * 输出上限取 `output_budget`，kimi 按实测抬到 65536。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CATALOG_SNAPSHOT,
  DEFAULT_MODEL_ID,
  findCatalogModel,
  orderedCatalog,
} from '../src/catalog-snapshot.ts'

/** 设计件 §5.2 的整张表，逐行独立抄写。 */
const EXPECTED = [
  {
    id: 'claude-haiku-5.5',
    name: 'Claude Haiku 5.5',
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    cost: 'low',
    capability: 'standard',
    inputModalities: ['text', 'image', 'file'],
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'standard',
    inputModalities: ['text'],
    levels: ['off', 'low', 'high', 'max'],
  },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision Exp',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'standard',
    inputModalities: ['text', 'image'],
    levels: ['off', 'low', 'high', 'max'],
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    contextWindow: 1_048_000,
    maxTokens: 128_000,
    cost: 'high',
    capability: 'advanced',
    inputModalities: ['text'],
    levels: ['off', 'low', 'high', 'max'],
  },
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 1_048_000,
    maxTokens: 128_000,
    cost: 'low',
    capability: 'advanced',
    inputModalities: ['text', 'image'],
    levels: ['off', 'low', 'high', 'max'],
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'low',
    capability: 'advanced',
    inputModalities: ['text', 'image', 'video'],
    levels: ['low', 'high', 'max'],
  },
  {
    id: 'glm-5.3-flashx',
    name: 'GLM-5.3 Flash-X',
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'advanced',
    inputModalities: ['text', 'image', 'file', 'video'],
    levels: ['low', 'high', 'max'],
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    cost: 'low',
    capability: 'standard',
    inputModalities: ['text', 'image', 'file'],
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'hy4-preview',
    name: 'Hunyuan H4 Preview',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'advanced',
    inputModalities: ['text'],
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    contextWindow: 262_000,
    maxTokens: 65_536,
    cost: 'medium',
    capability: 'advanced',
    inputModalities: ['text', 'image'],
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'mimo-v2.6-flash',
    name: 'MiMo V2.6 Flash',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'low',
    capability: 'standard',
    inputModalities: ['text', 'image', 'audio', 'video'],
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'mimo-v2.6-pro',
    name: 'MiMo V2.6 Pro',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'advanced',
    inputModalities: ['text', 'image', 'audio', 'video'],
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
] as const

test('目录快照与设计件的 12 模型表逐列一致', () => {
  assert.equal(CATALOG_SNAPSHOT.length, 12)
  assert.deepEqual(
    CATALOG_SNAPSHOT.map((entry) => ({
      id: entry.id,
      name: entry.name,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
      cost: entry.cost,
      capability: entry.capability,
      inputModalities: [...entry.inputModalities],
      levels: [...entry.reasoningLevels],
    })),
    EXPECTED.map((row) => ({
      id: row.id,
      name: row.name,
      contextWindow: row.contextWindow,
      maxTokens: row.maxTokens,
      cost: row.cost,
      capability: row.capability,
      inputModalities: [...row.inputModalities],
      levels: [...row.levels],
    })),
  )
})

test('默认模型是 deepseek-v4.1-flash，快照标记只此一个', () => {
  assert.equal(DEFAULT_MODEL_ID, 'deepseek-v4.1-flash')
  assert.deepEqual(
    CATALOG_SNAPSHOT.filter((entry) => entry.default).map((entry) => entry.id),
    ['deepseek-v4.1-flash'],
  )
  assert.equal(findCatalogModel(DEFAULT_MODEL_ID)?.name, 'DeepSeek V4.1 Flash')
})

test('选择器顺序：默认模型置顶，其余 capability 高的在前、成本低的在前、再按 id', () => {
  assert.deepEqual(
    orderedCatalog().map((entry) => entry.id),
    [
      'deepseek-v4.1-flash',
      'glm-5.3-flash',
      'glm-5.3-flashx',
      'hy4-preview',
      'kimi-k2.7-code',
      'mimo-v2.6-pro',
      'deepseek-v4-pro',
      'claude-haiku-5.5',
      'gpt-6-luna',
      'mimo-v2.6-flash',
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
    ],
  )
})

test('未知模型 id 查不到，不抛错', () => {
  assert.equal(findCatalogModel('not-a-model'), undefined)
  assert.equal(findCatalogModel(''), undefined)
})
