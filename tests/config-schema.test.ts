/**
 * Config-schema credential contract (node:test, zero deps). Run with `npm test`.
 *
 * The settings page writes the API key through the credentials seam, but a
 * composition config (`cordis.patch.yml`) or a hand-edited `settings.yaml` may
 * set a literal `apiKey` — a settings value, so the schema must mark it
 * `role('secret')`, which the harness strips from every descriptor it serves
 * (`settings.describe()` runs with `redactSecrets: true`).
 *
 * A schema without the role parses and resolves exactly the same way, so this
 * pins the DECLARATION, not the parse result.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { redactSecrets } from '@deepseek-ai/dsh-settings'
import type z from '@deepseek-ai/schemastery'

import { Config, DEFAULT_API_KEY_ENV, resolveAdapterOptions } from '../src/index.ts'
import { unwrapVolatileConfig } from '../src/config-volatile.ts'

test('literal API keys are declared secret and stripped from a settings descriptor', () => {
  const value = { apiKeyEnv: DEFAULT_API_KEY_ENV, apiKey: 'sk-literal-SECRET-123' }
  // `redactSecrets` declares its schema parameter as `z<never>` because it only
  // walks the declared `role('secret')` positions; the plugin's own schema is
  // `z<Config>`, so the call states that widening explicitly at this boundary
  // rather than loosening the assertion the test exists to make.
  const redacted = redactSecrets(Config as z<never>, value) as {
    value: Record<string, unknown>
    secrets: Array<{ path: readonly (string | number)[] }>
  }

  // The literal never reaches the caller…
  assert.equal(redacted.value.apiKey, undefined)
  // …while the rest of the profile survives.
  assert.equal(redacted.value.apiKeyEnv, DEFAULT_API_KEY_ENV)
  // Reported per path, so the page can show "set" without the value.
  assert.deepEqual(
    redacted.secrets.map((secret) => secret.path.map(String)),
    [['apiKey']],
  )
})

test('a literal API key still configures the route from a composition config', () => {
  // Redaction is descriptor-facing only: the resolved runtime config keeps the
  // literal, which is how the composition path serves requests. The parse turns
  // every MARKED field into a live reference, so the route resolves through the
  // same unwrap `apply()` performs per read.
  const parsed = Config({ apiKey: 'sk-literal-123' })
  const config = unwrapVolatileConfig(parsed)
  assert.equal(config.apiKey, 'sk-literal-123')
  const options = resolveAdapterOptions(config)
  assert.equal(options.apiKeyEnv, DEFAULT_API_KEY_ENV)
  assert.equal(options.apiBase, 'https://amr-link.open-design.ai/v1')
  // A write lands on the next read without re-parsing.
  assert.equal(unwrapVolatileConfig(parsed).apiKeyEnv, DEFAULT_API_KEY_ENV)
})

test('上下文配置只接受边界内整数，程序化调用另行清洗非法值', () => {
  for (const value of [1, 32_768, 10_000_000]) {
    const config = unwrapVolatileConfig(Config({ contextWindow: value, contextWindowOverrides: { model: value } }))
    assert.equal(config.contextWindow, value)
    assert.deepEqual(config.contextWindowOverrides, { model: value })
  }
  for (const value of [0, 10_000_001, 32_768.5]) {
    assert.throws(() => Config({ contextWindow: value }))
    assert.throws(() => Config({ contextWindowOverrides: { model: value } }))
  }
  const resolved = resolveAdapterOptions({ contextWindow: 32_768.5, contextWindowOverrides: { invalid: 64_000.5, valid: 32_768 } })
  assert.equal(resolved.contextWindow, undefined)
  assert.deepEqual(resolved.contextWindowOverrides, { valid: 32_768 })
})

test('输出预算接受 0（无宿主预算）到 262144 绝对上限，越界与非整数被拒绝', () => {
  // 0 是「没有宿主预算」的哨兵，不是 0 token 的预算，所以必须能通过 schema；
  // 262144 是网关接受的绝对上限（ticket 05）。
  for (const value of [0, 1, 64_000, 131_072, 262_144]) {
    assert.equal(unwrapVolatileConfig(Config({ maxOutputTokens: value })).maxOutputTokens, value)
  }
  for (const value of [-1, 262_145, 64_000.5]) {
    assert.throws(() => Config({ maxOutputTokens: value }))
  }
})

test('程序化构造越过配置校验时，非法输出预算回落到「未设置」', () => {
  // A connection built by hand never passes through Schemastery, so the resolve
  // step re-judges: a budget the gateway would refuse becomes "unset" (the
  // derived default), not a request that fails upstream.
  for (const value of [-1, 262_145, 64_000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(resolveAdapterOptions({ maxOutputTokens: value }).maxOutputTokens, undefined)
  }
  assert.equal(resolveAdapterOptions({ maxOutputTokens: 0 }).maxOutputTokens, 0)
  assert.equal(resolveAdapterOptions({ maxOutputTokens: 64_000 }).maxOutputTokens, 64_000)
  assert.equal(resolveAdapterOptions({}).maxOutputTokens, undefined)
})
