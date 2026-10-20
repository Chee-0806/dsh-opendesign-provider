/**
 * The Open Design LLM adapter: one Chat Completions transport.
 *
 * Ticket 02 wired the walking skeleton end to end; ticket 03 made the picker
 * read the gateway's live `GET {apiBase}/models` (per-key, with the 12-model
 * static snapshot as the offline fallback) and exposes the catalog's
 * provenance through {@link OpenDesignAdapter.catalogStatus}; ticket 04 turned
 * the transport into a real stream — one `stream: true` call is read as SSE and
 * mapped, delta by delta, into the `StreamChunk` sequence (thinking, text,
 * tool calls, usage, finish), so the reply is visible while it is generated.
 * Ticket 07 carries images: a model the catalog declares image-capable gets the
 * host's request-encoded bytes as an OpenAI multi-part `image_url` data URL,
 * while file/audio/video attachments and images on a text-only model are refused
 * as `UNSUPPORTED_CONTENT` naming the capability. Ticket 05 bounds the answer:
 * `max_completion_tokens` is the smallest of the host budget, the model's own
 * budget and the gateway ceiling, raised to the selected thinking level's floor
 * when the model demands one (kimi), and the stream hard-truncates at that cap
 * with a `max-tokens` finish. Ticket 06 routes every failure through
 * `./error-taxonomy.ts` (three body shapes, deterministic vs retryable, empty
 * response, idle timeout), declares the route's retry policy from that table, and
 * exposes `diagnostics()` for the settings page's redacted config copy. The
 * transport seam here is deliberately the single Chat Completions call the design
 * settles on.
 *
 * Request facts come from the live connection thunk and the credential
 * resolver handed in by the plugin entry, so a settings write reaches the next
 * request without a restart. Nothing in this module imports cordis or
 * schemastery.
 *
 * @module dsh-opendesign-provider/adapter
 */

import {
  attributionHeaders,
  offloadedImageText,
  resolveRetryPolicy,
  textOnlyImageText,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmImageRequestPricing,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type RequestMessage,
  type ResolvedRetryPolicy,
  type StreamChunk,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type {
  FileAttachmentRef,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'

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
import { DEFAULT_API_BASE, DEFAULT_API_KEY_ENV, PROVIDER_DISPLAY_NAME } from './identity.ts'
import { requestImageTarget } from './image-request.ts'
import { openDesignImageTokens } from './image-tokens.ts'
import { modelIsVisible } from './model-visibility.ts'
import { effectiveOutputCap } from './output-budget.ts'
import {
  OUTPUT_CAP_FIELD,
  coerceReasoningLevel,
  outputCapFloor,
  wireReasoningEffort,
} from './quirks.ts'
import type { CliLoginStatus } from './credentials.ts'
import { diagnosticsSnapshot, type DiagnosticsSnapshot } from './diagnostics.ts'
import { classifyHttpFailure, missingBodyFailure, retryableFailureCodes } from './error-taxonomy.ts'
import { streamedCompletionChunks } from './stream-response.ts'

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
  /** Transport failures one request absorbs; absent reports the default in diagnostics. */
  transportMaxRetries?: number | undefined
}

/**
 * Credential observability for the diagnostics snapshot (ticket 06): the reference
 * name, whether it resolves, and whether the CLI login state is readable. Never a
 * key value — the type has no slot for one.
 */
export interface OpenDesignCredentialState {
  readonly ref: string
  readonly present: boolean
  /** The CLI login state as the credential chain read it (path, status, key presence). */
  readonly login: {
    readonly path: string
    readonly status: CliLoginStatus
    readonly hasRuntimeKey: boolean
  }
}

/**
 * The slice of the host attachment service that image input needs: one
 * deterministic request version of a stored image, encoded to a route target.
 * Declared narrowly here so the adapter depends on the capability it uses, not
 * on attachment storage as a whole; `ctx.attachments` satisfies it as-is.
 */
export interface OpenDesignImageEncoder {
  /** Encode one normalized attachment to the request target (dimensions + byte budget). */
  readImageRequest(
    ref: ImageAttachmentRef,
    target: ImageRequestTarget,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment>
}

/** Everything the adapter needs from its owning plugin instance. */
export interface OpenDesignAdapterDeps {
  /** Read the live connection facts for one call. */
  options: () => OpenDesignConnectionOptions
  /** Resolve the bearer key for one call (literal → credential ref → CLI login). */
  resolveApiKey: (connection: OpenDesignConnectionOptions) => Promise<string>
  /**
   * Resolve request facts that depend on WHERE the key came from: a key from
   * the CLI login state uses that state's server-issued `linkUrl`, while an
   * explicit key keeps the configured/default gateway. Optional so tests and
   * programmatic adapters can omit it; the plugin entry supplies it.
   */
  resolveConnection?: (connection: OpenDesignConnectionOptions) => Promise<OpenDesignConnectionOptions> | OpenDesignConnectionOptions
  /**
   * Read the host attachment service, when one is mounted. Read per call: the
   * service may be composed after this plugin. Without it, an image can only be
   * described to the model in text — it cannot be encoded for the wire.
   */
  attachments?: (() => OpenDesignImageEncoder | undefined) | undefined
  /**
   * Read credential/CLI observability for {@link OpenDesignAdapter.diagnostics}.
   * Omitted means "unknown": the snapshot then reports the default reference as
   * unconfigured. Read per call, exactly like {@link OpenDesignAdapterDeps.options}.
   */
  credentialState?: (() => Promise<OpenDesignCredentialState> | OpenDesignCredentialState) | undefined
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

  /**
   * The engine's retry decision for this route, declared from the classification
   * table: only `EMPTY_RESPONSE` / `RATE_LIMIT` / `TIMEOUT` / `TRANSIENT` /
   * `TRANSPORT` are worth another attempt. `AUTH`, `QUOTA_EXHAUSTED`,
   * `BAD_REQUEST` and `PROTOCOL_ERROR` fail identically every time, so declaring
   * them non-retryable is what keeps a deterministic 400 from burning quota.
   */
  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return resolveRetryPolicy(
      { mode: 'normal', retryableCodes: [...retryableFailureCodes()] },
      `llm-opendesign: provider "${PROVIDER_DISPLAY_NAME}" retryPolicy`,
    )
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
   * The redacted "current effective configuration" block (ticket 06).
   *
   * This is the data half of the settings page's copy button; the button itself
   * belongs to ticket 08. The catalog is read from memory, never the network: the
   * snapshot reports what conversations would use right now, and a diagnostic must
   * never become the outage (or stall the page). `./diagnostics.ts`'s
   * `formatDiagnostics` renders the copyable text.
   */
  async diagnostics(): Promise<DiagnosticsSnapshot> {
    // The effective connection, not the raw options: when the key comes from the
    // CLI login state, the gateway follows that state's own linkUrl (ticket 08),
    // and the snapshot must show the address a request would really use.
    const base = this.deps.options()
    const connection = await this.deps.resolveConnection?.(base) ?? base
    const catalog = this.currentCatalog(connection)
    const credential = await this.deps.credentialState?.()
    const allowlist = connection.visibleModels ?? []
    return diagnosticsSnapshot({
      gateway: apiBaseOf(connection),
      catalog: {
        source: catalog.source === 'live' ? 'live' : 'snapshot',
        models: catalog.models.length,
        visible: catalog.models.filter((entry) => modelIsVisible(entry.id, allowlist, connection.modelVisibility)).length,
        ...(catalog.reason === undefined ? {} : { fallbackReason: catalog.reason }),
      },
      credential: { ref: credential?.ref ?? DEFAULT_API_KEY_ENV, present: credential?.present === true },
      cliLogin: credential?.login ?? { path: '', status: 'missing', hasRuntimeKey: false },
      contextWindow: connection.contextWindow,
      contextWindowOverrides: connection.contextWindowOverrides ?? {},
      maxOutputTokens: connection.maxOutputTokens,
      requestTimeoutMs: connection.requestTimeoutMs,
      streamIdleTimeoutMs: connection.streamIdleTimeoutMs,
      transportMaxRetries: connection.transportMaxRetries,
      retryableCodes: retryableFailureCodes(),
    })
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
   * The request-image projection this route asks the host for: long edge 1568
   * and a 1 MiB encoded budget (see `./image-request.ts`). It is the same target
   * `stream()` encodes to, so any preview computed elsewhere matches the bytes
   * that actually travel.
   */
  override imageRequestTarget(
    _provider: string,
    _model: string,
    image: ImageAttachmentRef,
  ): ImageRequestTarget {
    return requestImageTarget(image)
  }

  /**
   * Vision-token pricing for the meter (see `./image-tokens.ts`).
   *
   * A model the catalog calls image-capable pays its family's published rule. An
   * offloaded occurrence, and every image on a route that takes text only,
   * travels as placeholder text instead of pixels: 0 visual tokens plus that
   * exact text, so the meter counts what the model actually reads. A model
   * neither catalog nor snapshot knows declares nothing here.
   */
  override imageRequestPricing(_provider: string, model: string): LlmImageRequestPricing | undefined {
    const entry = lookupCatalogEntry(this.currentCatalog(this.deps.options()).models, model)
    if (entry === undefined) return undefined
    const vision = entry.inputModalities.includes('image')
    return {
      priceImages: (images) => images.map((image) => {
        if (image.offloaded === true) {
          return { visualTokens: 0, text: offloadedImageText(image.attachment) }
        }
        if (!vision) return { visualTokens: 0, text: textOnlyImageText(image.attachment) }
        return {
          visualTokens: openDesignImageTokens(model, image.attachment.width, image.attachment.height),
          text: '',
        }
      }),
    }
  }

  /**
   * One streaming Chat Completions call, mapped onto the chunk protocol.
   *
   * The request sends only the fields the gateway actually honours: the model
   * id, the mapped messages, `stream: true` with `stream_options.include_usage`
   * so the usage tail frame arrives, `max_completion_tokens` and the model's own
   * `reasoning_effort`. It never sends `max_tokens` (no model honours it),
   * `store` (server-side default) or `temperature` (unverified).
   *
   * Deltas are yielded as they land, so the reply is visible while it is still
   * being generated (ticket 04).
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const base = this.deps.options()
    const connection = await this.deps.resolveConnection?.(base) ?? base
    const apiKey = await this.deps.resolveApiKey(connection)
    // The catalog is read from memory only: a directory refresh must never
    // delay or fail a conversation turn.
    const entry = lookupCatalogEntry(this.currentCatalog(connection).models, options.model)
    const level = selectedReasoningLevel(options.model, options.reasoningEffort)
    const cap = outputCapFor(options, entry, connection, options.model, level)
    const callerSignal = options.signal
    const body = await buildRequestBody(options, cap, {
      model: options.model,
      // The raw catalog list, so a refusal can quote what the gateway declared.
      declaredModalities: entry?.inputModalities,
      encoder: this.deps.attachments?.(),
      signal: callerSignal,
    }, level)
    const fetchImpl = this.deps.fetchImpl ?? fetch
    const signal = requestSignal(callerSignal, connection.requestTimeoutMs)

    let response: Response
    try {
      response = await fetchImpl(`${apiBaseOf(connection)}/chat/completions`, {
        method: 'POST',
        headers: {
          ...attributionHeaders(),
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      throw requestFailure(error, callerSignal?.aborted === true)
    }

    if (!response.ok) {
      let raw: string
      try {
        raw = await response.text()
      } catch {
        raw = ''
      }
      throw classifyHttpFailure({
        status: response.status,
        body: raw,
        contentType: response.headers.get('content-type'),
        retryAfter: response.headers.get('retry-after'),
      })
    }
    if (response.body === null) throw missingBodyFailure()
    try {
      yield* streamedCompletionChunks(response.body, cap, connection.streamIdleTimeoutMs)
    } catch (error) {
      // A failed HTTP exchange and a socket cut mid-body are the same thing to
      // the caller: a transport failure, reported as LlmError rather than a raw
      // stream exception. Mapping errors travel through untouched.
      if (error instanceof LlmError) throw error
      throw requestFailure(error, callerSignal?.aborted === true)
    }
  }

  /**
   * Load the catalog for listing/status. Never throws: a gateway failure is a
   * fallback to the static snapshot with the reason recorded for ticket 08.
   */
  private async loadCatalog(connection: OpenDesignConnectionOptions): Promise<GatewayCatalogStatus> {
    const resolved = await this.deps.resolveConnection?.(connection) ?? connection
    return this.catalog.load(this.catalogTarget(resolved), () => this.deps.resolveApiKey(resolved))
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

/**
 * The `max_completion_tokens` this call sends: the host budget, the model's
 * output budget and the gateway's absolute ceiling, smallest wins, raised to
 * the selected thinking level's floor when the model demands one (kimi).
 *
 * The host's per-call budget outranks the connection setting; both use the
 * zero sentinel to mean "no host budget" (design §4.3).
 */
function outputCapFor(
  options: GenerateOptions,
  entry: GatewayCatalogEntry | undefined,
  connection: OpenDesignConnectionOptions,
  model: string,
  level: ReasoningLevel | undefined,
): number {
  return effectiveOutputCap({
    hostBudget: options.maxTokens ?? connection.maxOutputTokens,
    modelBudget: entry?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    thinkingFloor: outputCapFloor(model, level),
  })
}

/** The reasoning level to send: a known level, coerced into the model's own domain. */
function selectedReasoningLevel(model: string, requested: string | undefined): ReasoningLevel | undefined {
  if (requested === undefined) return undefined
  const known = REASONING_LEVEL_ORDER.find((level) => level === requested)
  // An id this adapter did not advertise is not a level to guess at.
  return known === undefined ? undefined : coerceReasoningLevel(model, known)
}

/**
 * Build the Chat Completions request body for one call.
 *
 * The cap and the reasoning level travel together (ticket 05): the level both
 * maps to `reasoning_effort` and decides the model's thinking-budget floor, so
 * one resolved level feeds both the body and {@link outputCapFor}.
 */
async function buildRequestBody(
  options: GenerateOptions,
  cap: number,
  images: ImagePlan,
  level: ReasoningLevel | undefined,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: await toWireMessages(options, images),
    stream: true,
    // Ask for the usage tail frame (`choices: []` with only `usage`): without it
    // the gateway reports no token accounting at all for a streamed reply.
    stream_options: { include_usage: true },
    [OUTPUT_CAP_FIELD]: cap,
  }
  if (options.tools !== undefined && options.tools.length > 0) body.tools = options.tools.map(toWireTool)
  const effort = wireReasoningEffort(level)
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

/** How one call may carry images: the catalog's capability plus the host encoder. */
interface ImagePlan {
  /** Exact model id, named in a capability refusal. */
  readonly model: string
  /** The gateway/snapshot's declared input modalities, undefined when unknown. */
  readonly declaredModalities: readonly string[] | undefined
  /** The host attachment service, when mounted. */
  readonly encoder: OpenDesignImageEncoder | undefined
  /** The caller's cancellation, forwarded to encoding. */
  readonly signal: AbortSignal | undefined
}

/** One request image in wire form: the encoded media type plus base64 bytes. */
interface EncodedImage {
  readonly mediaType: string
  readonly data: string
}

/** Whether the catalog declares image input for this exact model. */
function modelAcceptsImages(plan: ImagePlan): boolean {
  return plan.declaredModalities?.includes('image') === true
}

/**
 * Turn one durable image into wire bytes.
 *
 * The encoder is asked for the ROUTE target (long edge and byte budget from
 * `./image-request.ts`), not the normalized original, so a Retina screenshot
 * travels as the size the model would downscale to anyway. Encoding returns
 * `undefined` when no attachment service is mounted: the image cannot become
 * pixels, so the caller degrades it to its placeholder text instead of
 * pretending the model saw it.
 */
async function encodeImage(plan: ImagePlan, ref: ImageAttachmentRef): Promise<EncodedImage | undefined> {
  if (!modelAcceptsImages(plan)) throw imageCapabilityFailure(plan)
  if (plan.encoder === undefined) return undefined
  const request = await plan.encoder.readImageRequest(ref, requestImageTarget(ref), plan.signal)
  return { mediaType: request.mediaType, data: Buffer.from(request.data).toString('base64') }
}

/** One content part of an OpenAI multi-part message. */
type WireContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** An OpenAI chat message, spelled only with fields the gateway understands. */
interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | WireContentPart[]
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

/** Map the harness conversation onto the wire, skipping blocks the wire has no slot for. */
async function toWireMessages(options: GenerateOptions, images: ImagePlan): Promise<WireMessage[]> {
  const messages: WireMessage[] = []
  const system = options.system?.trim()
  if (system !== undefined && system !== '') messages.push({ role: 'system', content: system })
  for (const message of options.messages) {
    // Sequential on purpose: encoding is per image and the wire keeps block order.
    const wire = await toWireMessage(message, images)
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
 *
 * A message with an image becomes the OpenAI multi-part `content` array (text
 * and `image_url` parts in block order); a text-only message keeps the plain
 * string the gateway has always accepted.
 */
async function toWireMessage(message: RequestMessage, images: ImagePlan): Promise<WireMessage | undefined> {
  const parts: WireContentPart[] = []
  const toolCalls: NonNullable<WireMessage['tool_calls']> = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        if (block.text !== '') parts.push({ type: 'text', text: block.text })
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
      case 'image': {
        // An evicted image is a durable decision: the pixels never travel again,
        // the model keeps its placeholder text.
        if (block.offloaded === true) {
          parts.push({ type: 'text', text: offloadedImageText(block.attachment) })
          break
        }
        const image = await encodeImage(images, block.attachment)
        parts.push(image === undefined
          ? { type: 'text', text: unencodedImageText(block.attachment, images.model) }
          : { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } })
        break
      }
      case 'file':
        throw unsupportedFileFailure(block.attachment)
      default:
        throw unsupportedBlockFailure(String((block as { type: unknown }).type))
    }
  }
  const content = wireContent(parts)
  if (message.role === 'tool') {
    return { role: 'tool', content, tool_call_id: message.toolCallId }
  }
  if (message.role === 'assistant') {
    if (parts.length === 0 && toolCalls.length === 0) return undefined
    return toolCalls.length === 0
      ? { role: 'assistant', content }
      : { role: 'assistant', content, tool_calls: toolCalls }
  }
  if (parts.length === 0) return undefined
  return { role: message.role === 'user' ? 'user' : 'system', content }
}

/**
 * The wire `content` for one message: the plain string the gateway has always
 * accepted when every part is text, and the multi-part array only when an image
 * really travels (so nothing about text-only requests changes).
 */
function wireContent(parts: readonly WireContentPart[]): string | WireContentPart[] {
  if (parts.every((part) => part.type === 'text')) {
    return parts.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
  }
  return [...parts]
}

/** A refusal for one image on a model the catalog does not call image-capable. */
function imageCapabilityFailure(plan: ImagePlan): LlmError {
  const capability = plan.declaredModalities === undefined
    ? 'Open Design 目录也没有为这个模型声明输入模态'
    : `目录声明的输入模态是 ${plan.declaredModalities.join('/') || '空'}`
  return new LlmError(
    `llm-opendesign: 模型 "${plan.model}" 不支持图片输入（${capability}）。`
    + 'Open Design 本插件只支持文本与图片；请换用目录声明支持 image 的模型，或移除图片附件。',
    'UNSUPPORTED_CONTENT',
  )
}

/** Attachment kinds this route refuses by filename, and the word its message uses. */
const REJECTED_ATTACHMENT_KINDS: ReadonlyArray<{ kind: string; extensions: readonly string[] }> = [
  { kind: '音频', extensions: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'] },
  { kind: '视频', extensions: ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'] },
]

/**
 * A `file` block: the gateway may declare file/audio/video modality, but this
 * plugin carries no such content natively, so the refusal names what arrived
 * and what is actually supported instead of failing as a generic error.
 */
function unsupportedFileFailure(ref: FileAttachmentRef): LlmError {
  const lower = ref.name.toLowerCase()
  const kind = REJECTED_ATTACHMENT_KINDS.find(
    (candidate) => candidate.extensions.some((extension) => lower.endsWith(extension)),
  )?.kind
  const subject = kind === undefined ? `file 附件「${ref.name}」` : `${kind}附件「${ref.name}」（以 file 形态送来）`
  const remedy = kind === undefined
    ? '请把需要的文件内容转成文本再发。'
    : `请把${kind}转成文字描述或截图（图片）再发。`
  return new LlmError(
    `llm-opendesign: 不支持${subject}。Open Design 本插件只支持文本与图片；${remedy}`,
    'UNSUPPORTED_CONTENT',
  )
}

/** A content block this plugin has no wire slot for (e.g. a plugin-extended audio/video block). */
function unsupportedBlockFailure(type: string): LlmError {
  return new LlmError(
    `llm-opendesign: 不支持 content 块类型 "${type}"。Open Design 本插件只支持文本与图片。`,
    'UNSUPPORTED_CONTENT',
  )
}

/**
 * Model-facing placeholder for an image the host has no way to encode: the
 * model is told the pixels did not travel, rather than being handed a turn that
 * looks like it saw the picture.
 */
function unencodedImageText(ref: ImageAttachmentRef, model: string): string {
  const digest = String(ref.attachmentId).slice(7, 15)
  return `[Image sha256:${digest} was not sent: this host has no attachment encoding service, so ${model} `
    + 'received no pixels for it. Ask the user to send the image again once attachments are available.]'
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


