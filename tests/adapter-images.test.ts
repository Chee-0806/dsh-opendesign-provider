/**
 * 图片输入（ticket 07）—— 只测适配器边界：请求体里的图片内容块、不支持内容
 * 的能力错误、对宿主附件编码服务提出的目标，以及视觉 token 计价。
 *
 * 图片内容只在 `stream()` 的 HTTP 请求体和目录能力判定上观察，不碰私有实现；
 * base64 由宿主附件服务给，测试桩按真实契约返回 `RequestImageAttachment`。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { LlmError, MessageId } from '@deepseek-ai/dsh-llm'
import type {
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenDesignAdapter,
  type OpenDesignAdapterDeps,
  type OpenDesignConnectionOptions,
  type OpenDesignImageEncoder,
} from '../src/adapter.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let messageSeq = 0
function messageId(): MessageId {
  return MessageId(`msg-${++messageSeq}`)
}

/** 一张 100x100 的小图：计价断言用它对齐 deepseek 的最小像素放大规则。 */
function smallRef(): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId('sha256:0a1b2c3d4e5f6071'),
    mediaType: 'image/png',
    bytes: 512,
    width: 100,
    height: 100,
  }
}

/** 一张 2880x1800 的归一化截图引用：请求目标应缩到长边 1568。 */
function screenshotRef(): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId('sha256:2f7c1d9a4e6b8c0d'),
    mediaType: 'image/png',
    bytes: 2_400_000,
    width: 2880,
    height: 1800,
    name: 'screen.png',
  }
}

/** 宿主附件服务返回的请求版本字节；内容不重要，只求原样进 data URL。 */
const REQUEST_IMAGE_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10])
const REQUEST_IMAGE_BASE64 = Buffer.from(REQUEST_IMAGE_BYTES).toString('base64')

interface RecordedEncoding {
  ref: ImageAttachmentRef
  target: ImageRequestTarget
}

/** 记录每次编码请求（目标尺寸/字节预算）的附件服务桩。 */
function stubEncoder(recorded: RecordedEncoding[] = []): OpenDesignImageEncoder {
  return {
    async readImageRequest(
      ref: ImageAttachmentRef,
      target: ImageRequestTarget,
    ): Promise<RequestImageAttachment> {
      recorded.push({ ref, target })
      return {
        variantId: ImageVariantId('variant-test'),
        attachment: ref,
        data: REQUEST_IMAGE_BYTES,
        mediaType: 'image/png',
        bytes: REQUEST_IMAGE_BYTES.byteLength,
        width: target.width,
        height: target.height,
        depth: 'uchar',
        space: 'srgb',
        hasAlpha: false,
      }
    },
  }
}

function connection(overrides: Partial<OpenDesignConnectionOptions> = {}): OpenDesignConnectionOptions {
  return {
    apiBase: 'https://models.example.test/v1',
    modelsCachePath: '/tmp/od-models-cache.json',
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    ...overrides,
  }
}

function makeAdapter(overrides: Partial<OpenDesignAdapterDeps> = {}): OpenDesignAdapter {
  return new OpenDesignAdapter({
    options: overrides.options ?? (() => connection()),
    resolveApiKey: overrides.resolveApiKey ?? (async () => 'user_test_key'),
    fetchImpl: overrides.fetchImpl ?? catalogFetch(),
    ...(overrides.attachments === undefined ? {} : { attachments: overrides.attachments }),
  })
}

const MODELS_FIXTURE = readFileSync(new URL('./fixtures/models.json', import.meta.url), 'utf8')

function catalogFetch(): typeof fetch {
  return (async () => new Response(MODELS_FIXTURE, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch
}

interface RecordedRequest {
  url: string
  init: RequestInit
}

const OK_REPLY = [
  'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"图里是一只猫。"}}]}',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  'data: [DONE]',
  '',
].join('\n\n')

/** 记录对话请求、统一回一段成功 SSE 的 fetch。目录请求不参与这里。 */
function recordingFetch(recorded: RecordedRequest[], status = 200, body = OK_REPLY): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    recorded.push({ url: String(url), init: init ?? {} })
    return new Response(body, {
      status,
      headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' },
    })
  }) as unknown as typeof fetch
}

function userTurn(model: string, content: Message['content']): GenerateOptions {
  return {
    provider: 'open-design',
    model,
    messages: [{ id: messageId(), role: 'user', content, source: { kind: 'user' } }],
  }
}

async function collect(options: GenerateOptions, adapter: OpenDesignAdapter): Promise<unknown[]> {
  const chunks: unknown[] = []
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  return chunks
}

function requestBody(recorded: RecordedRequest[]): Record<string, unknown> {
  const chat = recorded.filter((request) => request.init.method === 'POST')
  assert.equal(chat.length, 1)
  const body = chat[0]?.init.body
  assert.equal(typeof body, 'string')
  return JSON.parse(body as string) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 视觉模型的请求体
// ---------------------------------------------------------------------------

test('目录声明 image 的模型：图片按 OpenAI 多段 content 的 data URL 发出，编码目标沿长边/字节预算', async () => {
  const recorded: RecordedRequest[] = []
  const encodings: RecordedEncoding[] = []
  const adapter = makeAdapter({
    fetchImpl: recordingFetch(recorded),
    attachments: () => stubEncoder(encodings),
  })

  await collect(
    userTurn('deepseek-v4.1-flash', [
      { type: 'text', text: '这张图里是什么？' },
      { type: 'image', attachment: screenshotRef() },
    ]),
    adapter,
  )

  const body = requestBody(recorded)
  assert.deepEqual(body.messages, [{
    role: 'user',
    content: [
      { type: 'text', text: '这张图里是什么？' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${REQUEST_IMAGE_BASE64}` } },
    ],
  }])
  // 2880x1800 按长边 1568 等比缩放；编码字节预算 1 MiB。
  assert.deepEqual(encodings.map((entry) => entry.target), [
    { width: 1568, height: 980, maxBytes: 1024 * 1024 },
  ])
  assert.equal(encodings[0]?.ref.attachmentId, screenshotRef().attachmentId)
})

// ---------------------------------------------------------------------------
// 能力拒绝：模型不吃图、附件不是图
// ---------------------------------------------------------------------------

/** 断言一次调用以 UNSUPPORTED_CONTENT 拒绝，返回错误文案。 */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof LlmError, `expected LlmError, got ${String(error)}`)
    assert.equal(error.code, 'UNSUPPORTED_CONTENT')
    return error.message
  }
  assert.fail('expected the request to be refused')
}

test('目录只声明 text 的模型收到图片：拒绝并点名模型与它声明的能力，不编码也不发请求', async () => {
  const recorded: RecordedRequest[] = []
  const encodings: RecordedEncoding[] = []
  const adapter = makeAdapter({
    fetchImpl: recordingFetch(recorded),
    attachments: () => stubEncoder(encodings),
  })

  const message = await refusal(collect(
    userTurn('deepseek-v4-flash', [
      { type: 'text', text: '看看这张图' },
      { type: 'image', attachment: screenshotRef() },
    ]),
    adapter,
  ))

  assert.match(message, /deepseek-v4-flash/u)
  assert.match(message, /不支持图片输入/u)
  assert.match(message, /只支持文本与图片/u)
  assert.equal(encodings.length, 0, '被拒绝的请求不该让宿主白编码一次')
  assert.equal(recorded.length, 0, '能力拒绝发生在发出 HTTP 之前')
})

test('目录与快照都不认识的模型收到图片：按未声明图片能力拒绝', async () => {
  const adapter = makeAdapter({
    fetchImpl: recordingFetch([]),
    attachments: () => stubEncoder(),
  })

  const message = await refusal(collect(
    userTurn('brand-new-model', [{ type: 'image', attachment: screenshotRef() }]),
    adapter,
  ))

  assert.match(message, /brand-new-model/u)
  assert.match(message, /没有为这个模型声明输入模态/u)
  assert.match(message, /只支持文本与图片/u)
})

test('file 附件：明确说不支持 file、只支持文本与图片', async () => {
  const adapter = makeAdapter({ fetchImpl: recordingFetch([]) })
  const file = {
    attachmentId: AttachmentId('sha256:file-attach'),
    name: '年度报告.pdf',
    bytes: 1024,
  }

  const message = await refusal(collect(
    userTurn('deepseek-v4.1-flash', [{ type: 'file', attachment: file }]),
    adapter,
  ))

  assert.match(message, /不支持file 附件「年度报告\.pdf」/u)
  assert.match(message, /只支持文本与图片/u)
})

test('音频/视频附件（以 file 形态送来）：文案点名模态并仍然只允许文本与图片', async () => {
  for (const [name, kind] of [['会议录音.mp3', '音频'], ['演示.mp4', '视频']] as const) {
    const adapter = makeAdapter({ fetchImpl: recordingFetch([]) })
    const message = await refusal(collect(
      userTurn('deepseek-v4.1-flash', [{
        type: 'file',
        attachment: { attachmentId: AttachmentId('sha256:av-attach'), name, bytes: 2048 },
      }]),
      adapter,
    ))
    assert.match(message, new RegExp(`不支持${kind}附件「${name}」`, 'u'), `${name} 应被点名为${kind}`)
    assert.match(message, /只支持文本与图片/u)
  }
})

test('插件扩展出来的 audio 块：按不支持的内容类型拒绝，而不是静默丢掉', async () => {
  const adapter = makeAdapter({ fetchImpl: recordingFetch([]) })
  // 合并扩展的块类型不在核心 ContentBlockMap 里，引擎之外的插件仍可能送来。
  const audioBlock = { type: 'audio', data: 'AAAA' } as unknown as Message['content'][number]

  const message = await refusal(collect(userTurn('deepseek-v4.1-flash', [audioBlock]), adapter))

  assert.match(message, /不支持 content 块类型 "audio"/u)
  assert.match(message, /只支持文本与图片/u)
})

// ---------------------------------------------------------------------------
// 降级、离线图片与计价
// ---------------------------------------------------------------------------

test('宿主没有附件服务：图片降级成占位文本，不发 data URL，也不让整轮失败', async () => {
  const recorded: RecordedRequest[] = []
  const adapter = makeAdapter({ fetchImpl: recordingFetch(recorded) })

  const chunks = await collect(
    userTurn('deepseek-v4.1-flash', [
      { type: 'text', text: '这张图里是什么？' },
      { type: 'image', attachment: screenshotRef() },
    ]),
    adapter,
  )

  assert.ok(chunks.length > 0, '降级后这一轮仍应正常完成')
  const [message] = requestBody(recorded).messages as Array<{ content: unknown }>
  assert.equal(typeof message?.content, 'string')
  assert.match(String(message?.content), /was not sent/u)
  assert.match(String(message?.content), /no attachment encoding service/u)
  assert.doesNotMatch(String(message?.content), /data:image/u)
})

test('已离线（offloaded）的图片只发占位文本，绝不再把像素带上去', async () => {
  const recorded: RecordedRequest[] = []
  const encodings: RecordedEncoding[] = []
  const adapter = makeAdapter({
    fetchImpl: recordingFetch(recorded),
    attachments: () => stubEncoder(encodings),
  })

  await collect(
    userTurn('deepseek-v4.1-flash', [{
      type: 'image',
      attachment: screenshotRef(),
      offloaded: true,
    }]),
    adapter,
  )

  assert.equal(encodings.length, 0, '离线图片不该再麻烦附件服务')
  assert.match(JSON.stringify(requestBody(recorded).messages), /image omitted to fit request image limits/u)
  assert.equal(JSON.stringify(requestBody(recorded).messages).includes('image_url'), false)
})

test('imageRequestTarget() 公开编码目标：长边 1568 / 编码 1 MiB，与请求里实际用的一致', async () => {
  const adapter = makeAdapter({ fetchImpl: recordingFetch([]) })

  assert.deepEqual(adapter.imageRequestTarget('open-design', 'deepseek-v4.1-flash', screenshotRef()), {
    width: 1568,
    height: 980,
    maxBytes: 1024 * 1024,
  })
})

test('imageRequestPricing()：视觉模型按家族规则计价，非视觉只计占位文本，未知模型不声明', () => {
  const adapter = makeAdapter({ fetchImpl: recordingFetch([]) })
  const image = { type: 'image' as const, attachment: smallRef() }

  const vision = adapter.imageRequestPricing('open-design', 'deepseek-v4.1-flash')
  assert.ok(vision !== undefined, 'deepseek 目录声明 image，必须声明计价')
  // 裸目录 id 认不出厂商（image-tokens 只按前缀分家族），走保守的 generic 规则：
  // 三条已发布规则里的最大值，100x100 下是 Gemini 小图的 258。
  assert.deepEqual(vision.priceImages([image]), [{ visualTokens: 258, text: '' }])

  const offloaded = { type: 'image' as const, attachment: smallRef(), offloaded: true as const }
  const evicted = vision.priceImages([offloaded])
  assert.equal(evicted[0]?.visualTokens, 0)
  assert.match(evicted[0]?.text ?? '', /image omitted to fit request image limits/u)

  const textOnly = adapter.imageRequestPricing('open-design', 'deepseek-v4-flash')
  assert.ok(textOnly !== undefined, '非视觉路由也要说清图片按占位文本计')
  const omitted = textOnly.priceImages([image])
  assert.equal(omitted[0]?.visualTokens, 0)
  assert.match(omitted[0]?.text ?? '', /image omitted because this model accepts text only/u)

  assert.equal(adapter.imageRequestPricing('open-design', 'brand-new-model'), undefined)
})
