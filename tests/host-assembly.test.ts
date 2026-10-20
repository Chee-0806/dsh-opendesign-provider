/**
 * Host assembly seam: `apply()` may register only the configurable-provider
 * directory entry, the adapter for `open-design`, and the settings bridge.
 * The previous provider assembly (login, enrollment, account pool, web search,
 * usage Remote, TUI, commands) must not come back through an optional inject.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  apply,
  Config,
  DEFAULT_API_KEY_ENV,
  formatDiagnostics,
  inject,
  name,
  OpenDesignAdapter,
  PROVIDER,
  NS,
} from '../src/index.ts'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { LlmError, MessageId } from '@deepseek-ai/dsh-llm'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageRequestTarget, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'

interface ProviderEntry {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
}

/** The host services `apply()` is allowed to touch, recorded structurally. */
function makeContext(services: { attachments?: unknown; credentials?: unknown } = {}): {
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
    get(name: string) {
      if (name === 'attachments') return services.attachments
      if (name === 'credentials') return services.credentials
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

test('apply() 把宿主附件服务接到适配器：图片经编码目标变成 data URL 发出', async () => {
  const screenshot: ImageAttachmentRef = {
    attachmentId: AttachmentId('sha256:5a4b3c2d1e0f9a8b'),
    mediaType: 'image/png',
    bytes: 1_500_000,
    width: 2880,
    height: 1800,
  }
  const targets: ImageRequestTarget[] = []
  const attachments = {
    async readImageRequest(ref: ImageAttachmentRef, target: ImageRequestTarget): Promise<RequestImageAttachment> {
      targets.push(target)
      return {
        variantId: ImageVariantId('variant-host'),
        attachment: ref,
        data: Uint8Array.from([1, 2, 3]),
        mediaType: 'image/webp',
        bytes: 3,
        width: target.width,
        height: target.height,
        depth: 'uchar',
        space: 'srgb',
        hasAlpha: false,
      }
    },
  }
  const { ctx, adapters } = makeContext({ attachments })
  apply(ctx as never, Config({ apiKey: 'literal_test_key' }) as never)

  const recorded: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    recorded.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response([
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"一只猫"}}]}',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  try {
    for await (const _chunk of adapters[0]!.adapter.stream({
      provider: 'open-design',
      model: 'deepseek-v4.1-flash',
      messages: [{
        id: MessageId('msg-image'),
        role: 'user',
        content: [{ type: 'image', attachment: screenshot }],
        source: { kind: 'user' },
      }],
    })) {
      // drain the stream
    }
  } finally {
    globalThis.fetch = originalFetch
  }

  // 编码目标来自路由（长边 1568 / 1 MiB），媒体类型以编码后的请求版本为准。
  assert.deepEqual(targets, [{ width: 1568, height: 980, maxBytes: 1024 * 1024 }])
  assert.deepEqual((recorded[0]?.messages as Array<{ content: unknown }>)[0]?.content, [{
    type: 'image_url',
    image_url: { url: 'data:image/webp;base64,AQID' },
  }])
})

test('诊断只报凭据引用与存在性：密钥值不出现在快照或可复制文本里', async () => {
  const secret = 'sk-amr-SECRET-from-credentials-seam'
  const { ctx, adapters } = makeContext({ credentials: { resolve: async () => ({ value: secret }) } })
  apply(ctx as never, Config({}) as never)
  const adapter = adapters[0]!.adapter
  const snapshot = await adapter.diagnostics()
  assert.deepEqual(snapshot.credential, { ref: DEFAULT_API_KEY_ENV, present: true })
  assert.match(snapshot.cliLogin.path, /\.amr\/config\.json$/u)
  const text = formatDiagnostics(snapshot)
  assert.equal(text.includes(secret), false)
  assert.equal(JSON.stringify(snapshot).includes(secret), false)
})

test('没有凭据时诊断报「未配置」而不是抛错（缺 Key 也能复制诊断）', async () => {
  const { ctx, adapters } = makeContext({
    credentials: { resolve: async () => ({ value: '' }) },
  })
  apply(ctx as never, Config({}) as never)
  const snapshot = await adapters[0]!.adapter.diagnostics()
  assert.deepEqual(snapshot.credential, { ref: DEFAULT_API_KEY_ENV, present: false })
  assert.match(formatDiagnostics(snapshot), /未配置/u)
})
