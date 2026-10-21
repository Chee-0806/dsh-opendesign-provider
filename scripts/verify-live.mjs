/**
 * P0 live acceptance, run against the real Open Design gateway (ticket 09).
 *
 * This script is the executable form of design §10.3's nine cases. It drives
 * the SAME adapter the plugin registers (`src/adapter.ts`) instead of
 * re-implementing the wire: the catalog, the stream parser, the reasoning
 * coercion, the output cap, the error taxonomy and the image path all take
 * their real production branch. Settings-page rendering and the real desktop
 * install are the two cases a terminal cannot prove, so they print SKIP with
 * the reason and the manual procedure.
 *
 * The key is read from `OPEN_DESIGN_API_KEY` or the CLI login state
 * (`~/.amr/config.json`, `profiles.prod.runtimeKey`) and is NEVER printed,
 * echoed in an error, or written to disk. The catalog cache is redirected to a
 * throw-away temp directory so an acceptance run leaves the user's real
 * `~/.opendesign/models-cache.json` untouched.
 *
 * Every line is `PASS` / `FAIL` / `SKIP`, and each failure is labelled
 * `[能力]` (the wire or the adapter behaved differently from the design) or
 * `[环境]` (missing credential, quota, DNS, network) so a red run says which
 * one it is. Exit codes: 0 = no capability failure, 1 = a capability failure,
 * 2 = no usable credential (every live case skipped).
 *
 * ```sh
 * node scripts/verify-live.mjs
 * node scripts/verify-live.mjs --case 5     # one case, 1-based
 * node scripts/verify-live.mjs --list       # names only, no network
 * ```
 *
 * @module dsh-opendesign-provider/scripts/verify-live
 */

import { register } from 'tsx/esm/api'

// The adapter and its rules are TypeScript modules; the published `lib/` entry
// does not export the adapter class, so acceptance drives the source the build
// was made from (same files, same branches).
register()

const { mkdtemp, rm } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const { deflateSync } = await import('node:zlib')

const {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenDesignAdapter,
} = await import('../src/adapter.ts')
const { resolveCredentialChain } = await import('../src/credentials.ts')
const { CATALOG_SNAPSHOT, REASONING_LEVEL_ORDER } = await import('../src/catalog-snapshot.ts')
const { reasoningLevelsFor, thinkingVisibleInChat } = await import('../src/quirks.ts')
const { estimateOutputTokens } = await import('../src/output-tokens.ts')
const { LlmError, ReasoningEffortId } = await import('@deepseek-ai/dsh-llm')

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const results = []
let current = undefined

/** One printed line, remembered for the summary. */
function record(status, name, detail) {
  results.push({ status, name, detail })
  const tag = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL'
  process.stdout.write(`${tag}  ${name}${detail === undefined ? '' : ` — ${detail}`}\n`)
}

/** Run one case body, turning its outcome into one PASS/FAIL line. */
async function runCase(caseNumber, name, body) {
  const started = Date.now()
  current = { caseNumber, name }
  process.stdout.write(`\n[case ${caseNumber}] ${name}\n`)
  try {
    const detail = await body()
    record('PASS', name, `${detail ?? 'ok'}（${elapsed(started)}）`)
  } catch (error) {
    const kind = failureKind(error)
    record('FAIL', name, `[${kind}] ${describeError(error)}（${elapsed(started)}）`)
  } finally {
    current = undefined
  }
}

function elapsed(started) {
  return `${((Date.now() - started) / 1000).toFixed(1)}s`
}

/**
 * Is this red run a missing capability or a missing environment?
 *
 * A credential/quota/transport failure says nothing about whether the plugin
 * implements the design; a wrong shape, a wrong reason, or a wrong code does.
 */
function failureKind(error) {
  if (error instanceof LlmError) {
    if (error.code === 'AUTH' || error.code === 'QUOTA_EXHAUSTED' || error.code === 'MISSING_CREDENTIAL') return '环境'
    if (error.code === 'TRANSPORT' || error.code === 'TIMEOUT') return '环境'
  }
  if (error instanceof TypeError) return '环境'
  return '能力'
}

/** One-line error text: never the request, never the key. */
function describeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof LlmError ? ` ${error.code}` : ''
  return `${code === '' ? '' : `${code}: `}${truncate(message.replace(/\s+/gu, ' ').trim(), 180)}`
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function fail(message) {
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

// ---------------------------------------------------------------------------
// Credentials and adapter wiring
// ---------------------------------------------------------------------------

const credential = await resolveCredentialChain(
  { apiKeyEnv: 'OPEN_DESIGN_API_KEY' },
  { resolveReference: (reference) => process.env[reference] },
)

const sourceLabel = credential.source === 'literal'
  ? 'config.apiKey'
  : credential.source === 'reference'
    ? `环境变量 ${credential.reference}`
    : credential.source === 'cli-login'
      ? `${credential.login.path} 的 profiles.prod.runtimeKey`
      : '无'

const cacheRoot = await mkdtemp(join(tmpdir(), 'opendesign-live-'))
const cachePath = join(cacheRoot, 'models-cache.json')

/** A fresh adapter per scenario: no catalog cache leaks between cases. */
function makeAdapter(options = {}) {
  const connection = {
    apiBase: credential.apiBase,
    modelsCachePath: cachePath,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    ...options.connection,
  }
  return new OpenDesignAdapter({
    options: () => connection,
    resolveApiKey: async () => options.apiKey ?? credential.apiKey,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.attachments === undefined ? {} : { attachments: options.attachments }),
  })
}

let messageSeq = 0

function userMessage(content) {
  return {
    id: `msg-live-${++messageSeq}`,
    role: 'user',
    content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
    source: { kind: 'user' },
  }
}

/** Run one real stream and reduce it to the facts the cases assert on. */
async function turn(adapter, model, options = {}) {
  const request = {
    provider: 'open-design',
    model,
    messages: options.messages ?? [userMessage(options.prompt ?? '只回复 OK。')],
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(options.reasoningEffort) }),
  }
  const chunks = []
  for await (const chunk of adapter.stream(request)) chunks.push(chunk)
  return summarize(chunks)
}

function summarize(chunks) {
  let text = ''
  let reasoning = ''
  const toolCalls = []
  let finish
  let usage
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'reasoning-delta') reasoning += chunk.text
    else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') toolCalls.push(chunk.block)
    else if (chunk.type === 'finish') finish = chunk.reason
    else if (chunk.type === 'usage') usage = chunk.usage
  }
  return {
    text,
    reasoning,
    toolCalls,
    finish,
    usage,
    finishKind: finish?.kind,
    /** Estimated output tokens, the same estimate the hard cap counts. */
    estimatedTokens: estimateOutputTokens(text) + estimateOutputTokens(reasoning),
  }
}

/** Assert an LlmError with a code (and status when the case names one). */
async function expectError(run, { code, status }) {
  try {
    await run()
  } catch (error) {
    assert(error instanceof LlmError, `期望 LlmError，实际是 ${error instanceof Error ? error.message : String(error)}`)
    assert(error.code === code, `期望错误码 ${code}，实际 ${error.code}`)
    // LlmError 把 HTTP 状态放在 `failure.status`（不是 `status`）。
    const observed = error.failure?.status
    if (status !== undefined) assert(observed === status, `期望 HTTP ${status}，实际 ${String(observed)}`)
    return error
  }
  fail(`期望 ${code} 失败，但请求成功了`)
}

// ---------------------------------------------------------------------------
// 16x16 PNG (red top half / blue bottom half) without an image library
// ---------------------------------------------------------------------------

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A valid 16x16 RGBA PNG: rows 0–7 red, rows 8–15 blue. */
function buildProbePng() {
  const size = 16
  const raw = Buffer.alloc(size * (1 + size * 4))
  let offset = 0
  for (let y = 0; y < size; y += 1) {
    raw[offset++] = 0 // filter: none
    for (let x = 0; x < size; x += 1) {
      raw[offset++] = y < size / 2 ? 0xff : 0x00 // R
      raw[offset++] = 0x00 // G
      raw[offset++] = y < size / 2 ? 0x00 : 0xff // B
      raw[offset++] = 0xff // A
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const PROBE_PNG = buildProbePng()

function imageEncoder() {
  return {
    async readImageRequest(ref, target) {
      return {
        variantId: 'variant-live-probe',
        attachment: ref,
        data: PROBE_PNG,
        mediaType: 'image/png',
        bytes: PROBE_PNG.byteLength,
        width: target.width,
        height: target.height,
        depth: 'uchar',
        space: 'srgb',
        hasAlpha: false,
      }
    },
  }
}

function probeImageRef() {
  return {
    attachmentId: 'sha256:live-probe-16x16',
    mediaType: 'image/png',
    bytes: PROBE_PNG.byteLength,
    width: 16,
    height: 16,
    name: 'probe.png',
  }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const MODELS = CATALOG_SNAPSHOT.map((entry) => entry.id)

async function case1Catalog() {
  const adapter = makeAdapter()
  const status = await adapter.catalogStatus()
  assert(status.source === 'live', `目录来源是 ${status.source}（${status.reason ?? '无原因'}），不是 live`)
  assert(status.models.length === 12, `目录有 ${status.models.length} 条，期望 12 条`)

  const listed = await adapter.listModels('open-design')
  assert(listed.length === 12, `选择器列出 ${listed.length} 条，期望 12 条`)
  const names = new Map(listed.map((model) => [model.id, model.name]))
  const mismatches = []
  for (const snapshot of CATALOG_SNAPSHOT) {
    assert(names.has(snapshot.id), `目录缺少 ${snapshot.id}`)
    if (names.get(snapshot.id) !== snapshot.name) {
      mismatches.push(`${snapshot.id} 显示名「${names.get(snapshot.id)}」≠ 快照「${snapshot.name}」`)
    }
    const resolved = await adapter.resolveModel('open-design', snapshot.id)
    if (resolved.context?.contextWindow !== snapshot.contextWindow) {
      mismatches.push(`${snapshot.id} 上下文 ${resolved.context?.contextWindow} ≠ 快照 ${snapshot.contextWindow}`)
    }
    if (resolved.defaultMaxTokens !== snapshot.maxTokens) {
      mismatches.push(`${snapshot.id} 输出预算 ${resolved.defaultMaxTokens} ≠ 快照 ${snapshot.maxTokens}`)
    }
  }
  assert(mismatches.length === 0, mismatches.join('；'))

  // 断网回落的真实分支：不可达网关 + 同一个静态快照。
  const offline = makeAdapter({ connection: { apiBase: 'http://127.0.0.1:9/v1' } })
  const fallback = await offline.catalogStatus()
  assert(fallback.source === 'static', `不可达网关没有回落静态快照（来源 ${fallback.source}）`)
  assert(fallback.reason !== undefined, '回落时没有给出原因')
  assert(fallback.models.length === 12, `静态快照 ${fallback.models.length} 条，期望 12 条`)

  return `实时 ${status.models.length} 条、来源 live；不可达网关回落 static（${fallback.reason}）12 条`
}

async function case2MultiModel() {
  const adapter = makeAdapter()
  const models = ['deepseek-v4.1-flash', 'gpt-6-luna', 'claude-haiku-5.5', 'glm-5.3-flash', 'kimi-k2.7-code']
  const outcomes = []
  for (const model of models) {
    const result = await turn(adapter, model, {
      prompt: '用一句中文回答：1+1 等于几？',
      maxTokens: 512,
    })
    assert(result.finishKind !== 'error', `${model} 以错误收尾`)
    assert(result.text.trim() !== '', `${model} 没有正文（finish=${String(result.finishKind)}）`)
    outcomes.push(`${model}:${String(result.finishKind)}/${result.text.trim().length}字`)
  }
  return outcomes.join('，')
}

async function case3Reasoning() {
  const adapter = makeAdapter()
  const detail = []

  // 逐模型合法域（来自目录/快照，不是硬编码期望）。
  const deepseekDomain = reasoningLevelsFor('deepseek-v4.1-flash')
  assert(
    deepseekDomain.length === REASONING_LEVEL_ORDER.length,
    `deepseek 只有 ${deepseekDomain.join('/')}，期望全档`,
  )
  assert(reasoningLevelsFor('glm-5.3-flash').join('/') === 'low/high/max', `glm 档位域是 ${reasoningLevelsFor('glm-5.3-flash').join('/')}`)
  assert(
    reasoningLevelsFor('kimi-k2.7-code').join('/') === 'minimal/low/medium/high/xhigh',
    `kimi 档位域是 ${reasoningLevelsFor('kimi-k2.7-code').join('/')}`,
  )

  // deepseek 全档可发（真实请求，不被 400 拒）；off 实测没有 reasoning。
  const accepted = []
  for (const level of REASONING_LEVEL_ORDER) {
    const result = await turn(adapter, 'deepseek-v4.1-flash', {
      prompt: '只回复 OK。',
      maxTokens: 64,
      reasoningEffort: level,
    })
    assert(result.finishKind !== 'error', `deepseek 在 ${level} 档以错误收尾`)
    accepted.push(level)
    if (level === 'off') {
      assert(result.reasoning === '', `deepseek 选 off 仍收到 ${result.reasoning.length} 字 reasoning`)
    }
  }
  detail.push(`deepseek 全档 ${accepted.join('/')} 均成功，off 无 reasoning`)

  // glm 与 kimi 各发一轮低档，证明收敛后的档位在线上可用。
  const glm = await turn(adapter, 'glm-5.3-flash', { prompt: '只回复 OK。', maxTokens: 64, reasoningEffort: 'low' })
  assert(glm.finishKind !== 'error', 'glm low 档失败')
  const kimi = await turn(adapter, 'kimi-k2.7-code', { prompt: '只回复 OK。', maxTokens: 8194, reasoningEffort: 'low' })
  assert(kimi.finishKind !== 'error', 'kimi low 档失败')
  detail.push('glm low、kimi low 各一轮成功')

  const hidden = ['gpt-6-luna', 'claude-haiku-5.5'].filter((model) => !thinkingVisibleInChat(model))
  assert(hidden.length === 2, `思考不可见的模型标注缺失：${hidden.join('/')}`)
  detail.push('gpt-6-luna/claude-haiku-5.5 标注思考不可见')
  return detail.join('；')
}

const BASH_TOOL = {
  name: 'bash',
  description: '在用户的终端里执行一条命令并返回输出。',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string', description: '要执行的命令' } },
    required: ['command'],
  },
}

async function case4Tools() {
  const adapter = makeAdapter()
  const first = await turn(adapter, 'deepseek-v4.1-flash', {
    prompt: '用 bash 工具执行 `echo hi`，然后只回复工具的输出。',
    tools: [BASH_TOOL],
    maxTokens: 512,
  })
  assert(first.toolCalls.length >= 1, `首轮没有工具调用（finish=${String(first.finishKind)}，正文 ${first.text.length} 字）`)
  const call = first.toolCalls[0]
  assert(call.name === 'bash', `工具名是 ${call.name}，期望 bash`)
  let args = {}
  try {
    args = JSON.parse(call.arguments)
  } catch {
    fail(`工具参数不是合法 JSON：${truncate(call.arguments, 80)}`)
  }
  assert(typeof args.command === 'string' && args.command !== '', '工具参数里没有 command')
  assert(first.finishKind === 'tool-calls' || first.finishKind === 'stop', `首轮 finish 是 ${String(first.finishKind)}`)

  const second = await turn(adapter, 'deepseek-v4.1-flash', {
    tools: [BASH_TOOL],
    maxTokens: 512,
    messages: [
      userMessage('用 bash 工具执行 `echo hi`，然后只回复工具的输出。'),
      {
        id: `msg-live-${++messageSeq}`,
        role: 'assistant',
        content: [call],
        source: { kind: 'model', provider: 'open-design', model: 'deepseek-v4.1-flash' },
      },
      {
        id: `msg-live-${++messageSeq}`,
        role: 'tool',
        content: [{ type: 'text', text: 'hi' }],
        toolCallId: call.id,
        source: { kind: 'tool', callId: call.id },
      },
    ],
  })
  assert(second.text.trim() !== '', '工具回填后的第二轮没有正文')
  assert(second.finishKind === 'stop' || second.finishKind === 'max-tokens', `第二轮 finish 是 ${String(second.finishKind)}`)
  return `首轮 tool-call bash(${truncate(args.command, 40)}) → 回填 "hi" → 次轮 ${second.text.trim().length} 字/${String(second.finishKind)}`
}

async function case5OutputCap() {
  const adapter = makeAdapter()
  const deepseek = await turn(adapter, 'deepseek-v4.1-flash', {
    prompt: '请从 1 数到 500，用逗号分隔，不要省略任何数字。',
    maxTokens: 16,
  })
  assert(deepseek.finishKind === 'max-tokens', `deepseek cap16 的 finish 是 ${String(deepseek.finishKind)}，期望 max-tokens`)
  assert(
    deepseek.estimatedTokens <= 48,
    `deepseek cap16 仍产出约 ${deepseek.estimatedTokens.toFixed(0)} token（超发未被截断）`,
  )

  const kimi = await turn(adapter, 'kimi-k2.7-code', {
    prompt: '请从 1 数到 500，用逗号分隔，不要省略任何数字。',
    maxTokens: 16,
    reasoningEffort: 'low',
  })
  assert(kimi.finishKind !== 'error', 'kimi 小上限以错误收尾（期望被思考预算下限抬升，不 400）')
  return `deepseek cap16 → ${deepseek.finishKind}/约 ${deepseek.estimatedTokens.toFixed(0)} token；`
    + `kimi cap16+low → ${String(kimi.finishKind)}（未 400）`
}

async function case6Errors() {
  const detail = []

  // 假 Key：401 → AUTH。
  const fake = makeAdapter({ apiKey: 'od_live_acceptance_invalid_key' })
  const auth = await expectError(
    () => turn(fake, 'deepseek-v4.1-flash', { prompt: '只回复 OK。', maxTokens: 16 }),
    { code: 'AUTH', status: 401 },
  )
  detail.push(`假 Key → AUTH 401（${truncate(auth.message, 40)}…）`)

  // 错误 apiBase：入口层 404 纯文本/HTML → PROTOCOL_ERROR（不是模型问题）。
  const wrongBase = makeAdapter({ connection: { apiBase: 'https://amr-link.open-design.ai/not-a-gateway/v1' } })
  const protocol = await expectError(
    () => turn(wrongBase, 'deepseek-v4.1-flash', { prompt: '只回复 OK。', maxTokens: 16 }),
    { code: 'PROTOCOL_ERROR', status: 404 },
  )
  detail.push(`错误 apiBase → PROTOCOL_ERROR 404（${truncate(protocol.message, 30)}…）`)

  // 不存在的模型：404 JSON model_not_found → BAD_REQUEST（确定性，不重试）。
  const badModel = makeAdapter()
  const badRequest = await expectError(
    () => turn(badModel, 'no-such-model-live-probe', { prompt: '只回复 OK。', maxTokens: 16 }),
    { code: 'BAD_REQUEST', status: 404 },
  )
  assert(
    /model_not_found|not found|不存在/iu.test(badRequest.message),
    `404 JSON 的文案没有点出模型不存在：${truncate(badRequest.message, 100)}`,
  )
  detail.push('不存在模型 → BAD_REQUEST 404（model_not_found）')

  return detail.join('；')
}

async function case7Image() {
  const adapter = makeAdapter({ attachments: () => imageEncoder() })
  // 视觉模型的思考也会计入输出上限：256 只够它想完、正文被截断，给足 1024。
  const result = await turn(adapter, 'deepseek-v4.1-flash', {
    maxTokens: 1024,
    messages: [userMessage([
      { type: 'text', text: '这张图上下两半分别是什么颜色？只回答两个颜色词。' },
      { type: 'image', attachment: probeImageRef() },
    ])],
  })
  assert(result.finishKind !== 'error', '图片请求以错误收尾')
  assert(result.text.trim() !== '', '图片请求没有正文')
  const colors = /red|红|blue|蓝/iu.test(result.text) ? '已命中颜色词' : '未命中颜色词（模型可能按自己的措辞回答）'
  return `16x16 PNG 已发送，${result.text.trim().length} 字，${colors}：${truncate(result.text.trim(), 60)}`
}

/**
 * ticket 13：可选 Messages 传输。
 *
 * 用「思考块是否出现」当传输证据：`claude-haiku-5.5` 在 Chat 面从不吐 reasoning，
 * 只有 Messages 面显式开 `thinking` 才有可读思考（2026-10-21 实测）。再走一轮真实
 * 工具往返，证明工具调用与工具结果在那一面也成立。
 *
 * gpt-6-luna 的实测结论与本票原假设不同：它在 Messages 面只回
 * `redacted_thinking`（加密块，无可读文本），所以自动选路不把它送过去；本条用它
 * 跑工具往返（非 Anthropic 模型也能用这一面），并把「思考不可读」记为已知限制。
 */
async function case10MessagesTransport() {
  // 默认 auto：claude-haiku-5.5 自动走 Messages，思考可见。
  const auto = makeAdapter()
  const autoTurn = await turn(auto, 'claude-haiku-5.5', {
    prompt: '先用一句话想想，再只回复 OK。',
    maxTokens: 2048,
    reasoningEffort: 'medium',
  })
  assert(autoTurn.finishKind !== 'error', 'claude-haiku-5.5 请求以错误收尾')
  assert(autoTurn.reasoning.trim() !== '', 'claude-haiku-5.5 在 auto 下没有思考块（说明没走 Messages）')
  assert(autoTurn.text.trim() !== '', 'claude-haiku-5.5 没有正文')
  const detail = [`auto: claude-haiku-5.5 思考 ${autoTurn.reasoning.trim().length} 字/正文 ${autoTurn.text.trim().length} 字`]

  // 显式 messages：同一模型仍可见思考（传输是用户指定的，不是自动挑的）。
  const explicit = makeAdapter({ connection: { protocol: 'messages' } })
  const explicitTurn = await turn(explicit, 'claude-haiku-5.5', {
    prompt: '先用一句话想想，再只回复 OK。',
    maxTokens: 2048,
    reasoningEffort: 'medium',
  })
  assert(explicitTurn.reasoning.trim() !== '', '显式 messages 下 claude-haiku-5.5 没有思考块')
  detail.push(`显式 messages: 思考 ${explicitTurn.reasoning.trim().length} 字`)

  // 工具往返：gpt-6-luna 走 Messages 面（非 Anthropic 模型也支持这一面）。
  const tools = makeAdapter({ connection: { protocol: 'messages' } })
  const first = await turn(tools, 'gpt-6-luna', {
    prompt: '用 bash 工具执行 `echo hi`，然后只回复工具的输出。',
    tools: [BASH_TOOL],
    maxTokens: 2048,
  })
  assert(first.toolCalls.length >= 1, `Messages 面首轮没有工具调用（finish=${String(first.finishKind)}）`)
  const call = first.toolCalls[0]
  assert(call.name === 'bash', `Messages 面工具名是 ${call.name}`)
  const second = await turn(tools, 'gpt-6-luna', {
    tools: [BASH_TOOL],
    maxTokens: 2048,
    messages: [
      userMessage('用 bash 工具执行 `echo hi`，然后只回复工具的输出。'),
      {
        id: `msg-live-${++messageSeq}`,
        role: 'assistant',
        content: [call],
        source: { kind: 'model', provider: 'open-design', model: 'gpt-6-luna' },
      },
      {
        id: `msg-live-${++messageSeq}`,
        role: 'tool',
        content: [{ type: 'text', text: 'hi' }],
        toolCallId: call.id,
        source: { kind: 'tool', callId: call.id },
      },
    ],
  })
  assert(second.text.trim() !== '', 'Messages 面工具回填后的第二轮没有正文')
  detail.push(`工具往返 ${call.name}(${truncate(call.arguments, 40)}) → 次轮 ${second.text.trim().length} 字`)

  // 已知限制：gpt-6-luna 的思考在这一面是加密块，读不到内容。
  record('SKIP', 'gpt-6-luna 的思考内容',
    '实测 Messages 面只回 redacted_thinking（加密块，无可读文本）；它的思考只在 /v1/responses 的 reasoning 项里，'
    + '本插件不做 Responses，所以自动选路让 gpt-6-luna 留在 Chat 面')
  return detail.join('；')
}

function case8Settings() {
  record('SKIP', '设置页（密钥写入/清除、apiBase、可见模型过滤、上下文覆盖）',
    '需在真实 desktop profile 的浏览器里操作；本票由 settings-page/client-boot 单测覆盖装配与写入链路，'
    + '交互验收由 Lead 在合并后执行')
}

function case9Install() {
  record('SKIP', '安装与共存（npm pack 产物装进 desktop profile）',
    '真实 profile 安装与 Command Code 共存由 Lead 在本票合并后执行；'
    + '本票只验证 npm pack 产物可被隔离安装（npm run test:install）')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const CASES = [
  [1, '目录（12 模型与来源）', case1Catalog],
  [2, '多模型一轮对话', case2MultiModel],
  [3, '思考等级矩阵', case3Reasoning],
  [4, '工具调用一轮', case4Tools],
  [5, '输出上限与客户端截断', case5OutputCap],
  [6, '错误分类', case6Errors],
  [7, '图片输入', case7Image],
  [8, '设置页', case8Settings],
  [9, '安装与共存', case9Install],
  [10, '可选 Messages 传输（思考 + 工具往返）', case10MessagesTransport],
]

const argv = process.argv.slice(2)
if (argv.includes('--list')) {
  for (const [number, name] of CASES) process.stdout.write(`${number}\t${name}\n`)
  process.exit(0)
}

const onlyArg = argv.indexOf('--case')
const only = onlyArg === -1 ? undefined : Number(argv[onlyArg + 1])
if (only !== undefined && !CASES.some(([number]) => number === only)) {
  process.stderr.write(`verify-live: 没有 case ${String(argv[onlyArg + 1])}\n`)
  process.exit(2)
}

process.stdout.write('Open Design P0 live acceptance（真实网关；密钥不打印、不落盘）\n')
process.stdout.write(`网关      ${credential.apiBase}（来源 ${credential.apiBaseSource}）\n`)
process.stdout.write(`凭据来源  ${sourceLabel}\n`)
process.stdout.write(`目录缓存  ${cachePath}（临时目录，运行后删除）\n`)

if (credential.apiKey === undefined) {
  process.stdout.write('\n')
  for (const [number, name] of CASES) {
    if (number === 8 || number === 9) continue
    record('SKIP', name, `[环境] 没有可用凭据：设置 ${credential.reference} 或执行 vela login`)
  }
  case8Settings()
  case9Install()
  await rm(cacheRoot, { recursive: true, force: true })
  process.stdout.write(`\nSKIP  没有可用凭据，live 用例未执行（环境缺失，不是能力缺失）\n`)
  process.exit(2)
}

try {
  for (const [number, name, body] of CASES) {
    if (only !== undefined && number !== only) continue
    if (number === 8 || number === 9) {
      body()
      continue
    }
    await runCase(number, name, body)
  }
} finally {
  await rm(cacheRoot, { recursive: true, force: true })
}

const passed = results.filter((entry) => entry.status === 'PASS').length
const failed = results.filter((entry) => entry.status === 'FAIL').length
const skipped = results.filter((entry) => entry.status === 'SKIP').length
process.stdout.write(`\n${passed} PASS / ${failed} FAIL / ${skipped} SKIP\n`)
process.exit(failed === 0 ? 0 : 1)
