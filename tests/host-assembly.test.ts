/**
 * Host assembly seam: `apply()` may register only the configurable-provider
 * directory entry, the adapter for `open-design`, and the settings bridge.
 * The previous provider assembly (login, enrollment, account pool, web search,
 * usage Remote, TUI, commands) must not come back through an optional inject.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply, Config, inject, name, OpenDesignAdapter, PROVIDER, NS } from '../src/index.ts'

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
