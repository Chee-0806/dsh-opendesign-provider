/**
 * The Host-side `opendesign/models` report (ticket 08): the settings page and
 * the Models-page card get the catalog's provenance plus the credential chain's
 * safe facts, never a key. Tests assert the report shape and its strict wire
 * parser; the HTTP-free catalog/credential inputs are plain fixtures.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Context, Service } from '@deepseek-ai/cordis'
import {
  MODELS_DESCRIPTOR,
  MODELS_ENDPOINT,
  parseModelsReport,
} from '../src/models-wire.ts'
import { buildModelsReport, OpenDesignModelsService } from '../src/models-remote.ts'
import type { CredentialChainResult } from '../src/credentials.ts'
import type { GatewayCatalogStatus } from '../src/gateway-facts.ts'

const CATALOG: GatewayCatalogStatus = {
  source: 'live',
  apiBase: 'https://runtime.example/v1',
  cached: false,
  fetchedAt: 1_760_000_000_000,
  models: [
    {
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      contextWindow: 328000,
      maxTokens: 128000,
      cost: 'low',
      capability: 'advanced',
      inputModalities: ['text', 'image'],
      reasoningLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      default: true,
      calibrated: true,
    },
    {
      id: 'brand-new-model',
      name: 'Brand New Model',
      contextWindow: 128000,
      maxTokens: 32768,
      cost: 'medium',
      capability: 'standard',
      inputModalities: ['text'],
      reasoningLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      default: false,
      calibrated: false,
    },
  ],
}

const CHAIN: CredentialChainResult = {
  source: 'cli-login',
  apiKey: 'sk-amr-secret-runtime',
  reference: 'OPEN_DESIGN_API_KEY',
  apiBase: 'https://runtime.example/v1',
  apiBaseSource: 'cli-login',
  login: {
    status: 'ok',
    path: '/home/user/.amr/config.json',
    hasRuntimeKey: true,
    hasControlKey: false,
    apiUrl: 'https://control.example/api/v1',
    user: 'xuqi',
  },
}

test('buildModelsReport 暴露目录来源、未校准标记与安全的凭据事实', () => {
  const report = buildModelsReport(CATALOG, CHAIN)
  assert.equal(report.catalog.source, 'live')
  assert.equal(report.catalog.fetchedAt, 1_760_000_000_000)
  assert.equal(report.catalog.models.length, 2)
  assert.equal(report.catalog.models[1]?.calibrated, false)
  assert.equal(report.credential.source, 'cli-login')
  assert.equal(report.credential.configured, true)
  assert.equal(report.credential.apiBaseSource, 'cli-login')
  assert.equal(report.credential.login.hasControlKey, false)
  // 密钥值绝不出现在报告里：JSON 序列化后也没有。
  assert.doesNotMatch(JSON.stringify(report), /sk-amr-secret-runtime/)
  assert.doesNotMatch(JSON.stringify(report), /vela_ctrl/)
})

test('静态回落时保留回落原因与绑定地址', () => {
  const report = buildModelsReport(
    { ...CATALOG, source: 'static', reason: 'unreachable', models: CATALOG.models.slice(0, 1) },
    CHAIN,
  )
  assert.equal(report.catalog.source, 'static')
  assert.equal(report.catalog.reason, 'unreachable')
  assert.equal(report.catalog.models.length, 1)
})

test('strict wire parser 接受报告并拒绝坏形状', () => {
  const report = buildModelsReport(CATALOG, CHAIN)
  assert.deepEqual(parseModelsReport(report), report)
  assert.throws(() => parseModelsReport({ catalog: {}, credential: {} }), /opendesign\/models/)
  assert.throws(() => parseModelsReport({ ...report, catalog: { ...report.catalog, models: 'nope' } }), /models/)
  assert.throws(() => parseModelsReport({ ...report, credential: { ...report.credential, source: 'borrowed' } }), /source/)
})

test('descriptor 声明在 opendesign 命名空间下并以 models 方法调用', () => {
  assert.equal(MODELS_ENDPOINT, 'opendesign/models')
  assert.equal(MODELS_DESCRIPTOR.namespace, 'opendesign')
  assert.equal(MODELS_DESCRIPTOR.method, 'models')
  assert.match(MODELS_DESCRIPTOR.id, /opendesign\/models$/)
})

test('Remote service 返回同一份报告（Host 侧唯一数据入口）', async () => {
  const ctx = new Context()
  let catalogCalls = 0
  let credentialCalls = 0
  const service = new (class extends OpenDesignModelsService {
    override async models() {
      return super.models()
    }
  })(ctx, {
    catalogStatus: async () => { catalogCalls += 1; return CATALOG },
    credentialStatus: async () => { credentialCalls += 1; return CHAIN },
  })
  assert.ok(service instanceof Service)
  const report = await service.models()
  assert.equal(catalogCalls, 1)
  assert.equal(credentialCalls, 1)
  assert.equal(report.catalog.source, 'live')
  assert.equal(report.credential.reference, 'OPEN_DESIGN_API_KEY')
})
