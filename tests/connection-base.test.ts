/**
 * Credential-aware connection resolution at the transport seam (ticket 08).
 *
 * The adapter's wire logic is unchanged; the plugin entry supplies an optional
 * `resolveConnection` so a key taken from the CLI login state uses that state's
 * server-issued `linkUrl`. These tests drive the public `stream()` and
 * `catalogStatus()` faces and assert only the URL that leaves the process.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MessageId, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { OpenDesignAdapter, type OpenDesignConnectionOptions } from '../src/adapter.ts'

const DEFAULT_BASE = 'https://default.example/v1'
const LOGIN_BASE = 'https://runtime.example/v1'

const OPTIONS: OpenDesignConnectionOptions = {
  apiBase: DEFAULT_BASE,
  modelsCachePath: join(tmpdir(), `opendesign-cache-${randomUUID()}.json`),
  requestTimeoutMs: 5_000,
  streamIdleTimeoutMs: 5_000,
}

function turn(): GenerateOptions {
  return {
    provider: 'open-design',
    model: 'deepseek-v4.1-flash',
    messages: [{
      id: MessageId('msg-1'),
      role: 'user',
      content: [{ type: 'text', text: '你好' }],
      source: { kind: 'user' },
    }],
  }
}

function recordingFetch(seen: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    seen.push(String(input))
    return new Response(JSON.stringify({
      id: 'x',
      object: 'chat.completion',
      model: 'deepseek-v4.1-flash',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

async function collect(adapter: OpenDesignAdapter): Promise<void> {
  for await (const _chunk of adapter.stream(turn())) {
    // Drain the stream; only the wire boundary is asserted.
  }
}

test('CLI 登录态的 key 让对话请求改用 linkUrl', async () => {
  const seen: string[] = []
  const adapter = new OpenDesignAdapter({
    options: () => OPTIONS,
    resolveApiKey: async () => 'sk-amr-runtime',
    resolveConnection: async (connection) => ({ ...connection, apiBase: LOGIN_BASE }),
    fetchImpl: recordingFetch(seen),
  })
  await collect(adapter)
  assert.deepEqual(seen, [`${LOGIN_BASE}/chat/completions`])
})

test('显式配置下不提供 resolveConnection 时仍走默认地址', async () => {
  const seen: string[] = []
  const adapter = new OpenDesignAdapter({
    options: () => OPTIONS,
    resolveApiKey: async () => 'sk-amr-explicit',
    fetchImpl: recordingFetch(seen),
  })
  await collect(adapter)
  assert.deepEqual(seen, [`${DEFAULT_BASE}/chat/completions`])
})

test('目录请求也使用凭据来源决定的地址', async () => {
  const seen: string[] = []
  const adapter = new OpenDesignAdapter({
    options: () => OPTIONS,
    resolveApiKey: async () => 'sk-amr-runtime',
    resolveConnection: async (connection) => ({ ...connection, apiBase: LOGIN_BASE }),
    fetchImpl: (async (input: string | URL | Request) => {
      seen.push(String(input))
      return new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'deepseek-v4.1-flash', enabled: true, default: true }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch,
  })
  const status = await adapter.catalogStatus()
  assert.equal(status.source, 'live')
  assert.equal(status.apiBase, LOGIN_BASE)
  assert.deepEqual(seen, [`${LOGIN_BASE}/models`])
})
