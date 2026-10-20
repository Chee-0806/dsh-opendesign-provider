/**
 * 上游错误的三态分类（ticket 06）。
 *
 * 网关的失败体有三种外层形状（协议实测 `docs/grill/20261020-opendesign-protocol-probe.md` §5）：
 * 结构化 JSON `{"error":{code,message,type}}`、Go 的纯文本 `404 page not found`、
 * nginx 的 HTML 错误页。分类只按 `content-type` 与体形状判断，绝不把 HTML 当 JSON 解析。
 *
 * 分类结论对外只有两件事：一个宿主认识的稳定错误码，和一段用户能照做的中文文案。
 * 可重试性由 {@link retryableFailureCodes} 声明，适配器把它交给引擎的重试策略
 * （`providerRetryPolicy`），确定性错误因此不会白烧额度。
 *
 * 本模块只被 Host 半侧引用，不导入 cordis / schemastery。
 *
 * @module dsh-opendesign-provider/error-taxonomy
 */

import { LlmError } from '@deepseek-ai/dsh-llm'

/** 一次失败的 HTTP 交换：状态、原始响应体、`content-type` 与 `Retry-After`。 */
export interface HttpFailureInput {
  /** HTTP status observed at the gateway. */
  status: number
  /** Raw response body, as received (may be JSON, plain text or HTML). */
  body?: string | undefined
  /** `content-type` header, used only to tell an HTML error page from a text one. */
  contentType?: string | null | undefined
  /** `retry-after` header verbatim (seconds or an HTTP date). */
  retryAfter?: string | null | undefined
}

/**
 * The failure codes this route reports.
 *
 * Deterministic request failures (`AUTH`, `QUOTA_EXHAUSTED`, `BAD_REQUEST`,
 * `PROTOCOL_ERROR`) repeat identically on every attempt, so they stay out of
 * {@link retryableFailureCodes}. `TRANSPORT` is the connection-level failure the
 * adapter's request wrapper reports (its own budget lives in `transport-retry.ts`).
 */
export type FailureCode =
  | 'AUTH'
  | 'QUOTA_EXHAUSTED'
  | 'BAD_REQUEST'
  | 'PROTOCOL_ERROR'
  | 'RATE_LIMIT'
  | 'TRANSIENT'
  | 'TRANSPORT'
  | 'EMPTY_RESPONSE'
  | 'TIMEOUT'

/** Codes the engine may retry; everything else fails once and surfaces. */
const RETRYABLE_CODES: readonly FailureCode[] = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'TIMEOUT', 'TRANSIENT', 'TRANSPORT']

/** The retryable set, as data, for the route's `providerRetryPolicy`. */
export function retryableFailureCodes(): readonly FailureCode[] {
  return RETRYABLE_CODES
}

/** One parsed error body, whichever of the three shapes it arrived in. */
interface UpstreamFailure {
  /** Outer shape; `empty` means the body carried nothing at all. */
  readonly shape: 'json' | 'text' | 'html' | 'empty'
  /** Gateway-level code (`invalid_api_key`, `upstream_error`, …). */
  readonly code: string | undefined
  /** The real reason, with the gateway's `[code=…]` wrapper and request_id removed. */
  readonly message: string | undefined
  /** Upstream request id, quoted from the body when present. */
  readonly requestId: string | undefined
  /** Compact excerpt of a non-JSON body (text or HTML), whitespace collapsed. */
  readonly excerpt: string | undefined
}

/**
 * Classify one non-2xx exchange.
 *
 * @param input - status, raw body and the headers that decide the wording.
 * @returns the `LlmError` to throw: stable `code`, actionable message, `status`.
 */
export function classifyHttpFailure(input: HttpFailureInput): LlmError {
  const failure = readFailure(input)
  switch (input.status) {
    case 401:
    case 403:
      return authFailure(input, failure)
    case 402:
      return quotaFailure(input, failure)
    case 404:
      // 404 有两种来源（实测）：入口层/路径不对回纯文本或 HTML，模型不存在回 JSON
      // `{"error":{"code":"model_not_found"}}`。前者改 apiBase，后者改模型 id。
      return failure.shape === 'json' ? badRequestFailure(input, failure) : protocolFailure(input, failure)
    case 429:
      return rateLimitFailure(input, failure)
    default:
      if (input.status >= 500) {
        // 网关会把上游的 400 包成 5xx（实测 502）：真因确定时不重试，否则按临时故障重试。
        return isDeterministicReason(failure) ? wrappedBadRequestFailure(input, failure) : transientFailure(input, failure)
      }
      if (input.status >= 400) return badRequestFailure(input, failure)
      return transientFailure(input, failure)
  }
}

/**
 * 401/403：Key 被拒、不存在，或这把 Key 没有该模型的权限（入口层也可能回 403）。
 * 下一步都是检查凭据与工作区权限，重试同一个请求不会变好。
 */
function authFailure(input: HttpFailureInput, failure: UpstreamFailure): LlmError {
  const headline = input.status === 403
    ? 'Open Design 拒绝了这次访问（403）：通常是这把 Key 没有该模型的权限，或入口层拦截了请求。'
    + '请在 设置 → Open Design 检查 Key 与工作区权限'
    : 'Open Design 拒绝了这把 API Key（401）。请在 设置 → Open Design 重新填入 Key'
    + '，或到 https://open-design.ai/cloud/api-keys 检查/重建 Key'
  return new LlmError(
    `${headline}。`
    + upstreamDetail(failure)
    + bodyExcerpt(failure),
    'AUTH',
    { status: input.status },
  )
}

/** 402：Design Plan 额度或余额不足，下一步是看额度或改用 BYOK。 */
function quotaFailure(input: HttpFailureInput, failure: UpstreamFailure): LlmError {
  return new LlmError(
    'Design Plan 额度已用尽或余额不足（402）。请到 Open Design 控制台查看额度并充值，'
    + '或改用 BYOK（在控制台自备上游 Key 后重试）。'
    + upstreamDetail(failure),
    'QUOTA_EXHAUSTED',
    { status: input.status },
  )
}

/**
 * 400（以及 502 包住的确定性 400）：网关把上游的请求拒绝包成自己的错误码，
 * 真因在 `message` 的 `[code=…]` 前缀之后。这类错误重试只会得到同一个结果，
 * 所以文案要说明「不重试」并把可改的地方指出来。
 */
function badRequestFailure(input: HttpFailureInput, failure: UpstreamFailure): LlmError {
  const reason = failure.message ?? failure.code ?? '上游没有给出原因'
  return new LlmError(
    `Open Design 上游拒绝了这条请求（HTTP ${input.status}）：${truncate(reason, 400)}`
    + requestIdNote(failure)
    + ' 这属于确定性错误，重试同样会失败，本插件不会有任何重试；'
    + '请按上面的原因修改请求（模型、角色、消息内容或输出上限）后重发。',
    'BAD_REQUEST',
    { status: input.status },
  )
}

/**
 * 404：地址不存在。Go 的纯文本 404 与 nginx 的 HTML 404 都是入口层给出的，
 * 不是上游对请求的拒绝，所以不解析 JSON、也不劝用户改请求——要改的是 apiBase。
 */
function protocolFailure(input: HttpFailureInput, failure: UpstreamFailure): LlmError {
  const shape = failure.shape === 'html' ? '网关回了一个 HTML 错误页（不是 JSON，多半来自 nginx/入口层）' : '网关回的不是 JSON'
  return new LlmError(
    `Open Design 网关的这个地址不存在（404）：${shape}。`
    + '这通常说明 apiBase 配错了路径——插件会请求「{apiBase}/chat/completions」。'
    + '请在 设置 → Open Design 检查 apiBase（默认 https://amr-link.open-design.ai/v1）。'
    + bodyExcerpt(failure),
    'PROTOCOL_ERROR',
    { status: input.status },
  )
}

/** 非 JSON 体的原文摘录；JSON 体已经取过真因，不再重复引用整段。 */
function bodyExcerpt(failure: UpstreamFailure): string {
  return failure.excerpt === undefined ? '' : ` 上游返回：${failure.excerpt}`
}

/**
 * 502（网关把上游 400 包成 5xx）：真因是确定性的，重试只会重放同一个失败，
 * 所以归为 BAD_REQUEST，并把「网关包装过」这一点说清楚，免得用户去查网络。
 */
function wrappedBadRequestFailure(input: HttpFailureInput, failure: UpstreamFailure): LlmError {
  const reason = failure.message ?? '上游没有给出原因'
  return new LlmError(
    `Open Design 网关把上游的请求错误包成了 5xx（HTTP ${input.status}）：${truncate(reason, 400)}`
    + requestIdNote(failure)
    + ' 真因是这条请求本身不被接受，属于确定性错误，重试同样会失败，本插件不会有任何重试；'
    + '请按上面的原因修改请求（模型、角色、消息内容或输出上限）后重发。',
    'BAD_REQUEST',
    { status: input.status },
  )
}

/** 5xx / 传输层：上游或网关的临时故障，交给引擎重试。 */
function transientFailure(input: HttpFailureInput, failure: UpstreamFailure): LlmError {
  return new LlmError(
    `Open Design 网关暂时不可用（HTTP ${input.status}），这通常是上游或网关的临时故障，不是请求本身的问题。`
    + '插件会自动重试；若反复出现，请稍后再试或查看服务状态。'
    + upstreamDetail(failure)
    + bodyExcerpt(failure),
    'TRANSIENT',
    { status: input.status },
  )
}

/**
 * 429：限流。上游给了 `Retry-After` 就按它的时间等，没给就交给引擎的指数退避；
 * 两种都可重试（本插件的临时故障预算最多 3 次，见 `transient-retry.ts`）。
 */
function rateLimitFailure(input: HttpFailureInput, failure: UpstreamFailure): LlmError {
  const retryAfterMs = retryAfterMsOf(input.retryAfter)
  const wait = retryAfterMs === undefined
    ? '上游没有给出 Retry-After，插件会按指数退避自动重试。'
    : `上游要求 ${formatSeconds(retryAfterMs)} 后再试，插件会按这个时间等待后自动重试。`
  return new LlmError(
    `Open Design 限流了这次请求（429）。${wait} 连续限流时请稍后再发，或降低并发。`
    + upstreamDetail(failure)
    + bodyExcerpt(failure),
    'RATE_LIMIT',
    {
      status: input.status,
      ...(retryAfterMs === undefined ? {} : { providerRetryAfterMs: retryAfterMs }),
    },
  )
}

/** `Retry-After` 的秒数形式转成毫秒；缺失或不可解析就是「上游没给」。 */
function retryAfterMsOf(raw: string | null | undefined): number | undefined {
  const seconds = Number((raw ?? '').trim())
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.round(seconds * 1000)
}

function formatSeconds(ms: number): string {
  return `${ms % 1000 === 0 ? ms / 1000 : (ms / 1000).toFixed(1)} 秒`
}

/** 上游原因里明显属于临时故障的措辞：先判它们，避免被下面的否定式误判成确定性。 */
const TRANSIENT_REASON = /timeout|timed out|connection|reset|unavailable|overload|try again|temporar|rate limit|too many requests|internal error/iu

/** 上游原因里属于「请求本身不被接受」的措辞（设计 §4.6 的确定性清单）。 */
const DETERMINISTIC_REASON = /incorrect role information|empty input messages|previous response|max_completion_tokens|max tokens|context length|context window|not supported|unsupported|invalid (?:model|role|request|parameter|value|image|content|argument)|must be (?:a|at least|less|greater|no more)/iu

/**
 * 一条上游错误是不是确定性的。
 *
 * 只有拿到具体原因才能判定：包成 5xx 且读不出原因的，按临时故障重试；
 * 说得出「角色不对 / 消息为空 / 输出上限越界」这类原因的，重试没有意义。
 */
function isDeterministicReason(failure: UpstreamFailure): boolean {
  if (failure.message === undefined) return false
  if (TRANSIENT_REASON.test(failure.message)) return false
  return DETERMINISTIC_REASON.test(failure.message)
}

/**
 * 200 但没有可展示的内容：`[DONE]` 之后什么都没有，或只有用量尾帧。
 *
 * 与协议错误分开：这次请求在上游是「成功」的，只是交回了空回复，重试可能
 * 就好了（`EMPTY_RESPONSE` 在引擎的可重试集合里）；协议错误说的是网关根本
 * 没按协议回话。
 */
export function emptyResponseFailure(): LlmError {
  return new LlmError(
    'Open Design 的上游返回了空响应（HTTP 200，但流里既没有正文、思考、工具调用，也没有内容可以展示）。'
    + '这次请求本身没有失败，属于上游异常，插件会自动重试；若反复出现，请换个模型或稍后再试。',
    'EMPTY_RESPONSE',
    { status: 200 },
  )
}

/**
 * 流空闲超时：连上了、也开始出内容了，然后上游（或代理）停止写入。
 *
 * 与请求超时分开：请求超时管「第一个字节」；这里管「半路挂住」——不中止的话，
 * 一轮对话会一直等一个永远不来的下一个 token。
 */
export function idleTimeoutFailure(idleTimeoutMs: number): LlmError {
  const seconds = idleTimeoutMs % 1000 === 0 ? String(idleTimeoutMs / 1000) : (idleTimeoutMs / 1000).toFixed(1)
  return new LlmError(
    `Open Design 的流在 ${seconds} 秒内没有收到任何新数据（流空闲超时），已中止这次读取以免整轮卡住。`
    + '常见原因是代理或中间层在长回复时截断了连接；请重试，必要时调大「流空闲超时」设置。',
    'TIMEOUT',
  )
}

/** 200 却不是 SSE：网关把 HTML 错误页或别的什么当成功回了。 */
export function nonSseBodyFailure(head: string): LlmError {
  const excerpt = head.replace(/\s+/gu, ' ').trim()
  return new LlmError(
    'Open Design 网关对这个地址返回的不是 SSE 流（多半是 HTML 错误页或入口层的拦截页），'
    + '所以无法解析出回复。请检查 apiBase 是否指向网关的 /v1 路径，以及代理是否改写了响应。'
    + (excerpt === '' ? '' : ` 收到的开头：${truncate(excerpt, 120)}`),
    'PROTOCOL_ERROR',
    { status: 200 },
  )
}

/** 200 但没有响应体：连字节流都没有。 */
export function missingBodyFailure(): LlmError {
  return new LlmError(
    'Open Design 返回了空的流式响应体，无法读取回复内容。请重试；若反复出现，请检查代理是否截断了流式响应。',
    'PROTOCOL_ERROR',
    { status: 200 },
  )
}

/** 上游 request_id 单列一句，报障时可以直接引用。 */
function requestIdNote(failure: UpstreamFailure): string {
  return failure.requestId === undefined ? '' : `（request_id: ${failure.requestId}）`
}

/** 上游自己的话，从三态形状里取出来；取不到就返回空串。 */
function upstreamDetail(failure: UpstreamFailure): string {
  if (failure.shape === 'empty') return ''
  if (failure.message !== undefined) {
    return ` 上游原因：${truncate(failure.message, 400)}${requestIdNote(failure)}`
  }
  if (failure.code !== undefined) return ` 上游原因：${truncate(failure.code, 200)}`
  return ''
}

/** `[code=xxx]` 前缀：网关的包装，不是原因本身。 */
const CODE_PREFIX = /^\s*\[code=[^\]]*\]\s*/u

/** 上游 request_id：实测出现在 400 的 message 里，形如 `(request_id: <uuid>)`。 */
const REQUEST_ID = /\(request_id:\s*([A-Za-z0-9._-]+)\)/u

/**
 * 读出错误体的形状与真因。
 *
 * 只对 `application/json`（或看起来像 JSON 的对象体）解析；纯文本按原话引用，
 * HTML 只承认它是 HTML，不做任何标签解析——把 nginx 页面当 JSON 解析会让
 * 插件在网关异常时崩溃，而这正是用户最需要看到设置页的时候。
 */
function readFailure(input: HttpFailureInput): UpstreamFailure {
  const raw = (input.body ?? '').trim()
  const contentType = (input.contentType ?? '').toLowerCase()
  if (raw === '') {
    return { shape: 'empty', code: undefined, message: undefined, requestId: undefined, excerpt: undefined }
  }
  if (contentType.includes('html') || raw.startsWith('<')) {
    return { shape: 'html', code: undefined, message: undefined, requestId: undefined, excerpt: excerptOf(raw) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { shape: 'text', code: undefined, message: undefined, requestId: undefined, excerpt: excerptOf(raw) }
  }
  const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined
  if (envelope === undefined) {
    return { shape: 'json', code: undefined, message: undefined, requestId: undefined, excerpt: undefined }
  }
  const rawMessage = typeof envelope.message === 'string' ? envelope.message : ''
  const requestId = REQUEST_ID.exec(rawMessage)?.[1]
  const message = stripRequestId(rawMessage.replace(CODE_PREFIX, '')).trim()
  return {
    shape: 'json',
    code: typeof envelope.code === 'string' ? envelope.code : undefined,
    message: message === '' ? undefined : message,
    requestId,
    excerpt: undefined,
  }
}

/** 去掉 message 里的 request_id 括注：它会被单列成一句，避免同一串出现两次。 */
function stripRequestId(message: string): string {
  return message.replace(REQUEST_ID, '').replace(/\s{2,}/gu, ' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/** 非 JSON 体的摘录：折叠空白（HTML 每行一个标签），截断到 200 字。 */
function excerptOf(raw: string): string {
  return truncate(raw.replace(/\s+/gu, ' ').trim(), 200)
}
