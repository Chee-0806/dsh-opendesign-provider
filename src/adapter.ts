/**
 * The Open Design LLM adapter: one Chat Completions transport.
 *
 * Ticket 02 wires the walking skeleton end to end; ticket 03 makes the picker
 * read the gateway's live `GET {apiBase}/models` (per-key, with the 12-model
 * static snapshot as the offline fallback) and exposes the catalog's
 * provenance through {@link OpenDesignAdapter.catalogStatus}. One non-streaming
 * `POST {apiBase}/chat/completions` round trip becomes a `StreamChunk` sequence
 * (text, usage, finish). Streaming,
 * thinking deltas, tool round trips, the output-cap hard truncation and the
 * full error taxonomy arrive with tickets 04–06; the transport seam here is
 * deliberately the single Chat Completions call the design settles on.
 *
 * Request facts come from the live connection thunk and the credential
 * resolver handed in by the plugin entry, so a settings write reaches the next
 * request without a restart. Nothing in this module imports cordis or
 * schemastery.
 *
 * @module dsh-opendesign-provider/adapter
 */

import { randomUUID } from 'node:crypto'

import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  ToolCallId,
  type FinishReason,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type RequestMessage,
  type StreamChunk,
  type TokenUsage,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'

import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  REASONING_LEVEL_ORDER,
  hostInputModalities,
  type ReasoningLevel,
} from './catalog-snapshot.ts'
import { effectiveContextWindow } from './context-window.ts'
import {
  GatewayCatalogSource,
  describeGatewayCatalogEntry,
  staticGatewayCatalogEntry,
  type GatewayCatalogEntry,
  type GatewayCatalogStatus,
} from './gateway-facts.ts'
import { DEFAULT_API_BASE, PROVIDER_DISPLAY_NAME } from './identity.ts'
import { modelIsVisible } from './model-visibility.ts'
import { applyMaxOutputTokens } from './output-budget.ts'
import { OUTPUT_CAP_FIELD, coerceReasoningLevel, wireReasoningEffort } from './quirks.ts'

/** Default budget for the first byte of a response. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000

/** Default budget for a stream that stalls after connecting. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/** Display names for the reasoning levels, least to greatest. */
const EFFORT_NAMES: Readonly<Record<ReasoningLevel, string>> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

/** The request facts one call is assembled from. All values are already resolved. */
export interface OpenDesignConnectionOptions {
  apiBase: string
  modelsCachePath: string
  requestTimeoutMs: number
  streamIdleTimeoutMs: number
  visibleModels?: readonly string[] | undefined
  modelVisibility?: Readonly<Record<string, boolean>> | undefined
  contextWindow?: number | undefined
  contextWindowOverrides?: Readonly<Record<string, number>> | undefined
  maxOutputTokens?: number | undefined
}

/** Everything the adapter needs from its owning plugin instance. */
export interface OpenDesignAdapterDeps {
  /** Read the live connection facts for one call. */
  options: () => OpenDesignConnectionOptions
  /** Resolve the bearer key for one call (literal → credential ref). */
  resolveApiKey: (connection: OpenDesignConnectionOptions) => Promise<string>
  /** Test seam for the HTTP call. */
  fetchImpl?: typeof fetch
  /** Test seam for catalog TTLs; defaults to `Date.now`. */
  now?: () => number
}

/** The Open Design adapter: catalog plus the Chat Completions transport. */
export class OpenDesignAdapter extends LlmAdapter {
  private readonly catalog: GatewayCatalogSource

  constructor(private readonly deps: OpenDesignAdapterDeps) {
    super()
    this.catalog = new GatewayCatalogSource({
      ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
    })
  }

  /** Report the route under the product name, preserving the engine's id. */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: PROVIDER_DISPLAY_NAME }
  }

  /**
   * The models the picker may list: the gateway's live directory when it
   * answers (per-key, so possibly fewer or more than the 12 known models),
   * otherwise the static snapshot. Filtered by the allowlist and the
   * per-model toggles, in the design's display order.
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const connection = this.deps.options()
    const catalog = await this.loadCatalog(connection)
    const allowlist = connection.visibleModels ?? []
    return catalog.models
      .filter((entry) => modelIsVisible(entry.id, allowlist, connection.modelVisibility))
      .map((entry) => ({
        provider,
        id: entry.id,
        name: entry.name,
        description: describeGatewayCatalogEntry(entry),
        inputModalities: hostInputModalities(entry),
      }))
  }

  /**
   * The catalog's provenance as data for the settings page and model cards
   * (ticket 08): which gateway it is bound to, whether it is live or the
   * static snapshot, why it fell back, and which entries are uncalibrated.
   */
  async catalogStatus(): Promise<GatewayCatalogStatus> {
    return this.loadCatalog(this.deps.options())
  }

  /**
   * Everything the harness needs for one exact model: the usable context
   * window (custom overrides included), the output budget it will request, the
   * levels this model accepts, and whether images fit.
   */
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const connection = this.deps.options()
    const entry = lookupCatalogEntry(this.currentCatalog(connection).models, model)
    if (entry === undefined) {
      // A model neither the gateway nor the snapshot knows: announce no
      // capacities rather than inventing them.
      return { provider, id: model, name: model, reasoning: { efforts: effortInfos(REASONING_LEVEL_ORDER) } }
    }
    return {
      provider,
      id: model,
      name: entry.name,
      description: describeGatewayCatalogEntry(entry),
      inputModalities: hostInputModalities(entry),
      context: {
        contextWindow: effectiveContextWindow(entry.contextWindow, model, connection),
      },
      defaultMaxTokens: entry.maxTokens,
      reasoning: { efforts: effortInfos(entry.reasoningLevels) },
    }
  }

  /**
   * One non-streaming Chat Completions call, mapped onto the chunk protocol.
   *
   * The request sends only the fields the gateway actually honours: the model
   * id, the mapped messages, `stream: false`, `max_completion_tokens` and the
   * model's own `reasoning_effort`. It never sends `max_tokens` (no model
   * honours it), `store` (server-side default) or `temperature` (unverified).
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const connection = this.deps.options()
    const apiKey = await this.deps.resolveApiKey(connection)
    // The catalog is read from memory only: a directory refresh must never
    // delay or fail a conversation turn.
    const entry = lookupCatalogEntry(this.currentCatalog(connection).models, options.model)
    const cap = outputCapFor(options, entry, connection)
    const body = buildRequestBody(options, cap)
    const fetchImpl = this.deps.fetchImpl ?? fetch
    const callerSignal = options.signal
    const signal = requestSignal(callerSignal, connection.requestTimeoutMs)

    let response: Response
    let raw: string
    try {
      response = await fetchImpl(`${apiBaseOf(connection)}/chat/completions`, {
        method: 'POST',
        headers: {
          ...attributionHeaders(),
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      })
      raw = await response.text()
    } catch (error) {
      throw requestFailure(error, callerSignal?.aborted === true)
    }

    if (!response.ok) throw httpFailure(response.status, raw)
    yield* completionChunks(parseJson(raw), cap)
  }

  /**
   * Load the catalog for listing/status. Never throws: a gateway failure is a
   * fallback to the static snapshot with the reason recorded for ticket 08.
   */
  private loadCatalog(connection: OpenDesignConnectionOptions): Promise<GatewayCatalogStatus> {
    return this.catalog.load(this.catalogTarget(connection), () => this.deps.resolveApiKey(connection))
  }

  /** The in-memory catalog for the conversation path; never touches the network. */
  private currentCatalog(connection: OpenDesignConnectionOptions): GatewayCatalogStatus {
    return this.catalog.current(this.catalogTarget(connection))
  }

  /** The catalog's binding: one normalized gateway address plus one cache file. */
  private catalogTarget(connection: OpenDesignConnectionOptions): { apiBase: string; modelsCachePath: string } {
    return { apiBase: apiBaseOf(connection), modelsCachePath: connection.modelsCachePath }
  }
}

/**
 * The merged entry for one model: the current catalog first, then the static
 * snapshot, so a model the key no longer lists (e.g. restored history) still
 * resolves its known capacities.
 */
function lookupCatalogEntry(
  entries: readonly GatewayCatalogEntry[],
  model: string,
): GatewayCatalogEntry | undefined {
  return entries.find((entry) => entry.id === model) ?? staticGatewayCatalogEntry(model)
}

/** The base URL without a trailing slash, so the endpoint join is unambiguous. */
function apiBaseOf(connection: OpenDesignConnectionOptions): string {
  return (connection.apiBase || DEFAULT_API_BASE).replace(/\/+$/u, '')
}

/** The bearer key plus a timeout, composed with the caller's own cancellation. */
function requestSignal(callerSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, Math.trunc(timeoutMs)))
  return callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout])
}

/** The largest output budget this call may ask for: user/host budget, else the model's own. */
function outputCapFor(
  options: GenerateOptions,
  entry: GatewayCatalogEntry | undefined,
  connection: OpenDesignConnectionOptions,
): number {
  const derived = entry?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  return applyMaxOutputTokens(derived, options.maxTokens ?? connection.maxOutputTokens)
}

/** The reasoning level to send: a known level, coerced into the model's own domain. */
function selectedReasoningLevel(model: string, requested: string | undefined): ReasoningLevel | undefined {
  if (requested === undefined) return undefined
  const known = REASONING_LEVEL_ORDER.find((level) => level === requested)
  // An id this adapter did not advertise is not a level to guess at.
  return known === undefined ? undefined : coerceReasoningLevel(model, known)
}

/** Build the Chat Completions request body for one call. */
function buildRequestBody(options: GenerateOptions, cap: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: toWireMessages(options),
    // The transport is non-streaming in ticket 02; the flag stays explicit so a
    // later streaming ticket flips one value rather than adding a field.
    stream: false,
    [OUTPUT_CAP_FIELD]: cap,
  }
  if (options.tools !== undefined && options.tools.length > 0) body.tools = options.tools.map(toWireTool)
  const effort = wireReasoningEffort(selectedReasoningLevel(options.model, options.reasoningEffort))
  if (effort !== undefined) body.reasoning_effort = effort
  return body
}

/** One tool declaration in the OpenAI `{type:'function', function}` shape. */
function toWireTool(tool: ToolSchema): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

/** An OpenAI chat message, spelled only with fields the gateway understands. */
interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

/** Map the harness conversation onto the wire, skipping blocks the wire has no slot for. */
function toWireMessages(options: GenerateOptions): WireMessage[] {
  const messages: WireMessage[] = []
  const system = options.system?.trim()
  if (system !== undefined && system !== '') messages.push({ role: 'system', content: system })
  for (const message of options.messages) {
    const wire = toWireMessage(message)
    if (wire !== undefined) messages.push(wire)
  }
  return messages
}

/**
 * One message in wire form.
 *
 * `developer` downgrades to `system` route-wide: the gateway rejects that role
 * for glm (400 `Incorrect role information`), and the conservative choice is
 * uniform rather than per-model. Reasoning blocks are history-only and never
 * echoed back; tool addition/removal blocks are projection metadata whose
 * declarations travel in `tools`.
 */
function toWireMessage(message: RequestMessage): WireMessage | undefined {
  const text: string[] = []
  const toolCalls: NonNullable<WireMessage['tool_calls']> = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        if (block.text !== '') text.push(block.text)
        break
      case 'tool-call':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: block.arguments },
        })
        break
      case 'reasoning':
      case 'tool-addition':
      case 'tool-removal':
        break
      case 'image':
      case 'file':
        // Images arrive with ticket 07; files never travel natively.
        throw new LlmError(
          'llm-opendesign: 当前版本只支持文本对话，图片/文件输入尚未接通（ticket 07 负责图片）。',
          'UNSUPPORTED_CONTENT',
        )
      default:
        break
    }
  }
  const content = text.join('\n')
  if (message.role === 'tool') {
    return { role: 'tool', content, tool_call_id: message.toolCallId }
  }
  if (message.role === 'assistant') {
    if (content === '' && toolCalls.length === 0) return undefined
    return toolCalls.length === 0
      ? { role: 'assistant', content }
      : { role: 'assistant', content, tool_calls: toolCalls }
  }
  if (content === '') return undefined
  return { role: message.role === 'user' ? 'user' : 'system', content }
}

/** Parse a 200 body, or report the gateway's odd shape as a protocol error. */
function parseJson(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed)) return parsed
  } catch {
    // fall through to the diagnosis below
  }
  throw new LlmError(
    `llm-opendesign: Open Design 返回了无法解析的响应体（预期 JSON）：${truncate(raw)}`,
    'PROTOCOL_ERROR',
  )
}

/** Map one non-streaming completion onto blocks, usage and a finish reason. */
function* completionChunks(payload: Record<string, unknown>, cap: number): Generator<StreamChunk> {
  const choices = payload.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new LlmError(
      'llm-opendesign: Open Design 返回了空的 choices，无法得到回复内容。',
      'PROTOCOL_ERROR',
    )
  }
  const choice = isRecord(choices[0]) ? choices[0] : {}
  const message = isRecord(choice.message) ? choice.message : {}
  const usage = usageOf(payload.usage)
  const reasoning = reasoningText(message)
  const text = textOf(message.content)
  const toolCalls = toolCallsOf(message.tool_calls)

  let index = 0
  if (reasoning !== '') {
    const reasoningIndex = index++
    yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: reasoningIndex, text: reasoning }
    yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
  }
  if (text !== '') {
    const textIndex = index++
    yield { type: 'block-start', index: textIndex, blockType: 'text' }
    yield { type: 'text-delta', index: textIndex, text }
    yield { type: 'block-end', index: textIndex, block: { type: 'text', text } }
  }
  for (const call of toolCalls) {
    const callIndex = index++
    const id = ToolCallId(call.id)
    yield { type: 'block-start', index: callIndex, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: callIndex, id, name: call.name, argumentsDelta: call.arguments }
    yield {
      type: 'block-end',
      index: callIndex,
      block: { type: 'tool-call', id, name: call.name, arguments: call.arguments },
    }
  }
  if (usage !== undefined) yield { type: 'usage', usage }
  yield { type: 'finish', reason: finishReasonOf(choice.finish_reason, toolCalls.length, usage, cap) }
}

/**
 * The terminal reason, inferred when the gateway omits the field.
 *
 * gpt-6-luna's non-streaming replies have no `finish_reason` at all — with
 * text or with tool calls — so its absence is normal, not a failure: tool calls
 * win, then an output that reached the requested cap, then a plain stop.
 */
function finishReasonOf(
  raw: unknown,
  toolCallCount: number,
  usage: TokenUsage | undefined,
  cap: number,
): FinishReason {
  const spelling = typeof raw === 'string' ? raw : undefined
  if (spelling === 'length' || spelling === 'max_tokens') return { kind: 'max-tokens' }
  if (spelling === 'tool_calls' || spelling === 'function_call') return { kind: 'tool-calls' }
  if (spelling !== undefined) return { kind: 'stop' }
  if (toolCallCount > 0) return { kind: 'tool-calls' }
  if (usage !== undefined && usage.outputTokens >= cap) return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/** Disjoint token accounting: cached input and reasoning tokens are reported separately. */
function usageOf(raw: unknown): TokenUsage | undefined {
  if (!isRecord(raw)) return undefined
  const prompt = numberValue(raw.prompt_tokens) ?? 0
  const completion = numberValue(raw.completion_tokens) ?? 0
  const cacheRead = isRecord(raw.prompt_tokens_details)
    ? numberValue(raw.prompt_tokens_details.cached_tokens) ?? 0
    : 0
  const reasoning = isRecord(raw.completion_tokens_details)
    ? numberValue(raw.completion_tokens_details.reasoning_tokens)
    : undefined
  const usage: TokenUsage = {
    inputTokens: Math.max(0, prompt - cacheRead),
    outputTokens: completion,
    cacheReadTokens: cacheRead,
  }
  const total = numberValue(raw.total_tokens)
  if (total !== undefined) usage.totalTokens = total
  if (reasoning !== undefined) usage.reasoningTokens = reasoning
  return usage
}

/** Join the text of one response's content (string or part array). */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (isRecord(part) && typeof part.text === 'string') parts.push(part.text)
  }
  return parts.join('')
}

/**
 * The thinking text, when the gateway sends it.
 *
 * The field is the non-standard `reasoning` (with `reasoning_details` alongside
 * it), not `reasoning_content`; the scalar is authoritative and the array is
 * the fallback for a gateway that only fills the structured half.
 */
function reasoningText(message: Record<string, unknown>): string {
  if (typeof message.reasoning === 'string') return message.reasoning
  if (!Array.isArray(message.reasoning_details)) return ''
  const parts: string[] = []
  for (const detail of message.reasoning_details) {
    if (isRecord(detail) && typeof detail.text === 'string') parts.push(detail.text)
  }
  return parts.join('')
}

/** Buffered tool calls, normalized so assembly always sees an id and JSON text. */
function toolCallsOf(raw: unknown): Array<{ id: string; name: string; arguments: string }> {
  if (!Array.isArray(raw)) return []
  const calls: Array<{ id: string; name: string; arguments: string }> = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const fn = isRecord(entry.function) ? entry.function : {}
    const name = typeof fn.name === 'string' ? fn.name : ''
    const args = fn.arguments
    const argsText = typeof args === 'string'
      ? args
      : isRecord(args) || Array.isArray(args) ? JSON.stringify(args) : '{}'
    calls.push({
      id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : randomUUID(),
      name,
      arguments: argsText,
    })
  }
  return calls
}

/** One failed HTTP exchange, classified by status with an actionable diagnosis. */
function httpFailure(status: number, raw: string): LlmError {
  const detail = upstreamDetail(raw)
  if (status === 401) {
    return new LlmError(
      'Open Design 拒绝了这把 API Key（401）。请在 设置 → Open Design 重新填入 Key，'
      + '或到 https://open-design.ai/cloud/api-keys 检查/重建 Key。'
      + detail,
      'AUTH',
      { status },
    )
  }
  if (status === 402) {
    return new LlmError(
      'Design Plan 额度已用尽或余额不足（402）。请到 Open Design 控制台查看额度，或改用 BYOK。'
      + detail,
      'QUOTA_EXHAUSTED',
      { status },
    )
  }
  if (status === 429) {
    return new LlmError(`Open Design 限流了这次请求（429），稍后重试。${detail}`, 'RATE_LIMIT', { status })
  }
  if (status >= 500) {
    return new LlmError(`Open Design 网关暂时不可用（HTTP ${status}）。${detail}`, 'SERVER', { status })
  }
  return new LlmError(`Open Design 拒绝了这次请求（HTTP ${status}）。${detail}`, 'INVALID_REQUEST', { status })
}

/**
 * The upstream's own words, peeled out of the three error-body shapes the
 * gateway uses: `{error:{code,message,type}}` JSON, Go's plain-text 404, and
 * nginx's HTML page. Only JSON is parsed; the other two are quoted as text.
 */
function upstreamDetail(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const message = typeof parsed.error.message === 'string' ? parsed.error.message : ''
      const code = typeof parsed.error.code === 'string' ? parsed.error.code : ''
      const reason = message !== '' ? message : code
      return reason === '' ? '' : ` 上游原因：${truncate(reason, 400)}`
    }
  } catch {
    // not JSON — fall through to quoting the body
  }
  return ` 上游返回：${truncate(trimmed, 200)}`
}

/** A thrown fetch (connect failure, timeout, caller cancellation) as an `LlmError`. */
function requestFailure(error: unknown, callerAborted: boolean): LlmError {
  if (callerAborted) {
    return new LlmError('Open Design 请求已取消。', 'ABORTED', { cause: error })
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new LlmError(
      'Open Design 请求超时：网关在配置的时限内没有返回响应。请稍后重试或调大请求超时设置。',
      'TIMEOUT',
      { cause: error },
    )
  }
  const reason = error instanceof Error ? error.message : String(error)
  return new LlmError(`无法连接 Open Design（传输层失败）：${reason}`, 'TRANSPORT', { cause: error })
}

/** The effort list the picker shows, in the model's own order. */
function effortInfos(levels: readonly ReasoningLevel[]): Array<{ id: ReturnType<typeof ReasoningEffortId>; name: string }> {
  return levels.map((level) => ({ id: ReasoningEffortId(level), name: EFFORT_NAMES[level] }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function truncate(text: string, max = 300): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
