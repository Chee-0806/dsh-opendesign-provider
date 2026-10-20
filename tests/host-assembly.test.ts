/**
 * Host assembly seam: `apply()` may register only the configurable-provider
 * directory entry, the adapter for `open-design`, and the settings bridge.
 * The previous provider assembly (login, enrollment, account pool, web search,
 * usage Remote, TUI, commands) must not come back through an optional inject.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply, Config, DEFAULT_API_KEY_ENV, inject, name, OpenDesignAdapter, PROVIDER, NS } from '../src/index.ts'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { LlmError, MessageId } from '@deepseek-ai/dsh-llm'

interface ProviderEntry {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
}

/** The host services `apply()` is allowed to touch, recorded structurally. */
function makeContext(): {
  ctx: Record<string, unknown>
  providers: ProviderEntry[]
  adapters: Array<{ providers: string[]; adapter: OpenDesignAdapter }>
  injected: string[][]
  configured: Array<{ auto?: boolean }>
} {
  const providers: ProviderEntry[] = []
  const adapters: Array<{ providers: string[]; adapter: OpenDesignAdapter }> = []
  const injected: string[][] = []
  const configured: Array<{ auto?: boolean }> = []
  const effect = (fn?: () => unknown): (() => void) => {
    // Cordis runs the effect body to obtain its disposer, so the fake must too.
    if (typeof fn === 'function') fn()
    return () => {}
  }
  const ctx = {
    llm: {
      registerConfigurableProviders(entries: ProviderEntry[]) {
        providers.push(...entries)
        return () => {}
      },
      registerAdapter(services: string[], adapter: OpenDesignAdapter) {
        adapters.push({ providers: services, adapter })
        return () => {}
      },
    },
    get() {
      return undefined
    },
    on() {
      return () => {}
    },
    effect,
    inject(services: string[], callback: (scope: unknown) => void) {
      injected.push([...services])
      if (services.includes('settings')) {
        callback({
          settings: {
            configure(presentation: { auto?: boolean }) {
              configured.push(presentation)
              return () => {}
            },
          },
          effect,
        })
      }
    },
    fiber: {},
    logger: { warn() {}, info() {} },
  }
  return { ctx, providers, adapters, injected, configured }
}

test('the plugin entry names llm-opendesign and requires only llm', () => {
  assert.equal(name, 'llm-opendesign')
  assert.deepEqual(inject, ['llm'])
})

test('apply registers the Open Design provider, adapter and settings bridge only', () => {
  const { ctx, providers, adapters, injected, configured } = makeContext()
  apply(ctx as never, Config({}) as never)

  assert.deepEqual(providers, [{
    provider: 'open-design',
    displayName: 'Open Design',
    settingsNs: 'llm-opendesign',
    settingsPath: [],
  }])
  assert.equal(providers[0]!.provider, PROVIDER)
  assert.equal(providers[0]!.settingsNs, NS)

  assert.equal(adapters.length, 1)
  assert.deepEqual(adapters[0]!.providers, ['open-design'])
  assert.ok(adapters[0]!.adapter instanceof OpenDesignAdapter)
  assert.deepEqual(adapters[0]!.adapter.providerInfo('open-design'), {
    id: 'open-design',
    name: 'Open Design',
  })
  assert.deepEqual(adapters[0]!.adapter.providerInfo('another-route'), {
    id: 'another-route',
    name: 'Open Design',
  })

  assert.deepEqual(injected, [['settings']], 'no login, web, commands or TUI inject remains')
  assert.deepEqual(configured, [{ auto: false }], 'the plugin ships its own page, so no auto form')
})

test('没有 Key 时，适配器抛 MISSING_CREDENTIAL 并给出两步可照做的文案', async () => {
  const { ctx, adapters } = makeContext()
  // The launch environment is empty on purpose: this pins the unconfigured
  // path rather than whatever the developer's shell happens to export.
  const noEnvironment = {
    ...ctx,
    get(name: string) {
      if (name !== 'launchEnvironment') return undefined
      return createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }])
    },
  }
  apply(noEnvironment as never, Config({}) as never)
  const adapter = adapters[0]!.adapter

  await assert.rejects(
    (async () => {
      for await (const _chunk of adapter.stream({
        provider: 'open-design',
        model: 'deepseek-v4.1-flash',
        messages: [{
          id: MessageId('msg-1'),
          role: 'user',
          content: [{ type: 'text', text: '你好' }],
          source: { kind: 'user' },
        }],
      })) {
        // The very first step must fail; nothing may be yielded.
      }
    })(),
    (error: unknown) => {
      assert.ok(error instanceof LlmError)
      assert.equal(error.code, 'MISSING_CREDENTIAL')
      // 可照做：设置页填 Key，或在终端复用 CLI 登录态；引用名要点出来。
      assert.match(error.message, /设置/)
      assert.match(error.message, /Open Design/)
      assert.match(error.message, /vela login/)
      assert.match(error.message, new RegExp(DEFAULT_API_KEY_ENV))
      // 不把密钥内容写进文案。
      assert.doesNotMatch(error.message, /sk-amr-/)
      return true
    },
  )
})
