/**
 * Anthropic Messages 传输（ticket 13）—— 可选第二条协议面。
 *
 * 线上事实来自协议实测（`docs/grill/20261020-opendesign-protocol-probe.md` §1）：
 *
 * - 端点是 `POST {apiBase}/messages`，**必须**带 `anthropic-version: 2023-06-01`
 *   头（缺头 400 `anthropic-version header is required`）；`Bearer` 与 `x-api-key`
 *   等价，这里沿用凭据链既有的 `Authorization: Bearer`；
 * - 请求体是 Anthropic 形态：`model`、`messages`（content block）、`system`、
 *   `tools[].input_schema`、`max_tokens`（必填）、`stream: true`；Chat Completions
 *   的 `max_completion_tokens` / `stream_options` / `reasoning_effort` 一个都不发；
 * - 流是真 Anthropic SSE：`message_start` / `content_block_start` /
 *   `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop`，
 *   另有 `ping` 与 `error`；
 * - 网关会先开一个空 `thinking` 块（`signature: ""`）再开正文块，客户端必须容忍；
 * - 跨模型可用：`gpt-6-luna`、`claude-haiku-5.5` 的思考只在这一面可见。
 *
 * 本模块只被 Host 半侧引用，不导入 cordis / schemastery。
 *
 * @module dsh-opendesign-provider/messages-transport
 */

import { randomUUID } from 'node:crypto'

import {
  LlmError,
  ToolCallId,
  type GenerateOptions,
  type FinishReason,
  type StreamChunk,
  type TokenUsage,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { emptyResponseFailure, nonSseBodyFailure } from './error-taxonomy.ts'
import { thinkingVisibleInChat } from './quirks.ts'
import { estimateOutputTokens } from './output-tokens.ts'
import {
  encodeImage,
  offloadedPlaceholder,
  unencodedImageText,
  unsupportedBlockFailure,
  unsupportedFileFailure,
} from './request-content.ts'
import type { ImagePlan } from './request-content.ts'
import { isRecord, numberValue, readSsePayloads, type SseObservation, type SsePayload } from './sse-frames.ts'
import { truncate } from './sse-frames.ts'

/** The Messages endpoint, relative to `apiBase`. */
export const MESSAGES_ENDPOINT = '/messages'

/** The protocol version header the gateway requires on every Messages call (probe §1 #1). */
export const ANTHROPIC_VERSION_HEADER = 'anthropic-version'

/** The only version the gateway accepts today (probe §1 #2). */
export const ANTHROPIC_VERSION = '2023-06-01'

/** Which wire protocol one call uses. */
export type TransportKind = 'chat' | 'messages'

/** The user-visible protocol setting (design §4.1, ticket 13). */
export type ProtocolSetting = TransportKind | 'auto'

/** Default: Chat Completions, with the two thinking-hidden models routed to Messages. */
export const DEFAULT_PROTOCOL: ProtocolSetting = 'auto'

/** Narrow an arbitrary config value to a protocol setting. */
export function isProtocolSetting(value: unknown): value is ProtocolSetting {
  return value === 'chat' || value === 'messages' || value === 'auto'
}

/**
 * 这一次调用走哪条传输。
 *
 * - 显式 `chat` / `messages` 是用户的决定，优先照办；
 * - `auto`（默认）只把「在 Chat 面看不见思考」的模型送去 Messages——它们的增量
 *   在 Chat 面根本不存在，换传输是多出来的能力，不是换掉既有行为；其余模型继续
 *   走 Chat，所以默认路径与 ticket 04–07 完全一致；
 * - 已经回落过的模型（`remembered`）直接走 Chat，避免每次都要先失败一次。
 */
export function selectTransport(
  model: string,
  protocol: ProtocolSetting,
  remembered: { has(model: string): boolean },
): TransportKind {
  if (protocol === 'chat') return 'chat'
  if (remembered.has(model)) return 'chat'
  if (protocol === 'messages') return 'messages'
  return thinkingVisibleInChat(model) ? 'chat' : 'messages'
}

/**
 * 一个流里最多容忍多少个无法识别的事件。
 *
 * 未知事件按设计忽略（网关会加新事件，插件不该因此失败），但一个只吐未知事件的
 * 流不能白白读到底：超过这个数就按协议错误收尾，既保住「忽略未知」也守住上限。
 */
export const MAX_UNKNOWN_EVENTS = 5_000

// ---------------------------------------------------------------------------
// 请求构造
// ---------------------------------------------------------------------------

/** One content block of an Anthropic message. */
type MessagesContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/** An Anthropic message, spelled only with fields the gateway understands. */
interface MessagesWireMessage {
  role: 'user' | 'assistant'
  content: MessagesContentBlock[]
}

/**
 * Build the Messages request body for one call.
 *
 * `max_tokens` is required by the protocol, so it carries the same effective
 * output cap the Chat face sends as `max_completion_tokens` (ticket 05): one
 * number, one meaning, whichever face the call takes.
 */
export async function buildMessagesRequestBody(
  options: GenerateOptions,
  cap: number,
  images: ImagePlan,
): Promise<Record<string, unknown>> {
  const system = systemTextOf(options)
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: cap,
    stream: true,
    messages: await toMessagesWire(options, images),
  }
  if (system !== '') body.system = system
  if (options.tools !== undefined && options.tools.length > 0) body.tools = options.tools.map(toMessagesTool)
  return body
}

/** One tool declaration in the Anthropic `{name, description, input_schema}` shape. */
function toMessagesTool(tool: ToolSchema): Record<string, unknown> {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters }
}

/**
 * The `system` field: the caller's one-shot system text plus every system-role
 * message (a loop-built request carries the prompt as message 0).
 *
 * Anthropic reads ONE leading system prompt, so the blocks are joined in order;
 * `developer` folds into `system` exactly as it does on the Chat face (glm
 * rejects that role, and uniformity is the conservative route-wide choice).
 */
function systemTextOf(options: GenerateOptions): string {
  const parts: string[] = []
  const oneShot = options.system?.trim()
  if (oneShot !== undefined && oneShot !== '') parts.push(oneShot)
  for (const message of options.messages) {
    if (message.role !== 'system' && message.role !== 'developer') continue
    const text = textOfBlocks(message.content).trim()
    if (text !== '') parts.push(text)
  }
  return parts.join('\n\n')
}

/** Every text block of one message, joined — the string form Anthropic accepts. */
function textOfBlocks(content: GenerateOptions['messages'][number]['content']): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Map the harness conversation onto the Messages wire, skipping blocks it has no slot for. */
async function toMessagesWire(options: GenerateOptions, images: ImagePlan): Promise<MessagesWireMessage[]> {
  const messages: MessagesWireMessage[] = []
  for (const message of options.messages) {
    if (message.role === 'system' || message.role === 'developer') continue
    const wire = await toMessagesMessage(message, images)
    if (wire !== undefined) messages.push(wire)
  }
  return messages
}

/**
 * One message in Messages form.
 *
 * Reasoning blocks are history-only and never echoed back; tool addition/removal
 * blocks are projection metadata whose declarations travel in `tools`.
 */
async function toMessagesMessage(
  message: GenerateOptions['messages'][number],
  images: ImagePlan,
): Promise<MessagesWireMessage | undefined> {
  const parts: MessagesContentBlock[] = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        if (block.text !== '') parts.push({ type: 'text', text: block.text })
        break
      case 'reasoning':
      case 'tool-addition':
      case 'tool-removal':
        break
      case 'image': {
        if (block.offloaded === true) {
          parts.push({ type: 'text', text: offloadedPlaceholder(block.attachment) })
          break
        }
        const image = await encodeImage(images, block.attachment)
        parts.push(image === undefined
          ? { type: 'text', text: unencodedImageText(block.attachment, images.model) }
          : {
              type: 'image',
              source: { type: 'base64', media_type: image.mediaType, data: image.data },
            })
        break
      }
      case 'file':
        throw unsupportedFileFailure(block.attachment)
      default:
        throw unsupportedBlockFailure(String((block as { type: unknown }).type))
    }
  }
  if (parts.length === 0) return undefined
  return { role: message.role === 'assistant' ? 'assistant' : 'user', content: parts }
}

// ---------------------------------------------------------------------------
// 流解析
// ---------------------------------------------------------------------------

/**
 * 把一次 Messages 流式响应映射成 {@link StreamChunk} 序列。
 *
 * 块下标按首次出现的顺序分配（思考 → 正文 → 工具调用），`content_block_stop`
 * 关闭对应块；流提前结束也不丢已经产出的内容。`cap` 是同一个客户端硬截断上限：
 * 累计估算（或上游报出的 output tokens）越线即停止读取，以「因长度结束」收尾。
 */
export async function* streamedMessagesChunks(
  body: ReadableStream<Uint8Array>,
  cap: number,
  idleTimeoutMs = 0,
): AsyncGenerator<StreamChunk> {
  const blocks = new Map<number, OpenBlock>()
  const toolCalls = new Map<number, { readonly index: number; id: string; name: string; arguments: string }>()
  let nextIndex = 0
  let started = 0
  let finishSpelling: string | undefined
  let inputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  let unknownEvents = 0
  let estimatedOutputTokens = 0
  let truncated = false
  const seen: SseObservation = { frames: 0, head: '' }

  /** 关闭一个已开启的块；重复关闭是空操作。 */
  function* closeBlock(wireIndex: number): Generator<StreamChunk> {
    const open = blocks.get(wireIndex)
    if (open === undefined) return
    blocks.delete(wireIndex)
    yield {
      type: 'block-end',
      index: open.index,
      block: open.kind === 'text'
        ? { type: 'text', text: open.text }
        : { type: 'reasoning', text: open.text },
    }
  }

  for await (const payload of readSsePayloads(body, seen, idleTimeoutMs)) {
    const type = typeof payload.type === 'string' ? payload.type : ''
    switch (type) {
      case 'message_start': {
        const usage = isRecord(payload.message) ? payload.message.usage : undefined
        if (isRecord(usage)) {
          inputTokens = numberValue(usage.input_tokens) ?? inputTokens
          cacheReadTokens = numberValue(usage.cache_read_input_tokens) ?? cacheReadTokens
          cacheWriteTokens = numberValue(usage.cache_creation_input_tokens) ?? cacheWriteTokens
          outputTokens = numberValue(usage.output_tokens) ?? outputTokens
        }
        break
      }
      case 'content_block_start': {
        const wireIndex = numberValue(payload.index)
        const block = payload.content_block
        if (wireIndex === undefined || !isRecord(block)) break
        // 真实流把空文本/空思考当块首帧（probe §1.3）：空增量不产块，等第一段
        // 非空增量再开块，宿主才不会收到一个零长度的块。
        if (block.type === 'tool_use') {
          // 工具调用块在块首就带 id 与 name（正文只能从增量里认），所以这里也
          // 先补 block-start 与一个空的 arguments 增量，与 Chat 面的首片同形。
          yield* closeOpenBlocks(blocks)
          const call = {
            index: nextIndex,
            id: typeof block.id === 'string' && block.id !== '' ? block.id : randomUUID(),
            name: typeof block.name === 'string' ? block.name : '',
            arguments: '',
          }
          toolCalls.set(wireIndex, call)
          nextIndex += 1
          started += 1
          yield { type: 'block-start', index: call.index, blockType: 'tool-call' }
          // 非流式的 `input` 是完整对象：当作第一段 arguments，别丢内容。
          const initial = isRecord(block.input) && Object.keys(block.input).length > 0
            ? JSON.stringify(block.input)
            : ''
          call.arguments += initial
          if (initial !== '') estimatedOutputTokens += estimateOutputTokens(initial)
          yield {
            type: 'tool-call-delta',
            index: call.index,
            id: ToolCallId(call.id),
            name: call.name,
            argumentsDelta: initial,
          }
          break
        }
        if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
          const created = yield* appendBlockDelta(blocks, wireIndex, nextIndex, 'text', block.text)
          if (created) {
            nextIndex += 1
            started += 1
          }
        }
        break
      }
      case 'content_block_delta': {
        const wireIndex = numberValue(payload.index)
        const delta = payload.delta
        if (wireIndex === undefined || !isRecord(delta)) break
        if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text !== '') {
          const created = yield* appendBlockDelta(blocks, wireIndex, nextIndex, 'text', delta.text)
          if (created) {
            nextIndex += 1
            started += 1
          }
          estimatedOutputTokens += estimateOutputTokens(delta.text)
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string' && delta.partial_json !== '') {
          const call = toolCalls.get(wireIndex)
          if (call === undefined) break
          call.arguments += delta.partial_json
          estimatedOutputTokens += estimateOutputTokens(delta.partial_json)
          yield {
            type: 'tool-call-delta',
            index: call.index,
            id: ToolCallId(call.id),
            argumentsDelta: delta.partial_json,
          }
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking !== '') {
          const created = yield* appendBlockDelta(blocks, wireIndex, nextIndex, 'reasoning', delta.thinking)
          if (created) {
            nextIndex += 1
            started += 1
          }
          estimatedOutputTokens += estimateOutputTokens(delta.thinking)
        }
        break
      }
      case 'content_block_stop': {
        const wireIndex = numberValue(payload.index)
        if (wireIndex === undefined) break
        yield* closeBlock(wireIndex)
        // 工具调用块不占 OpenBlock（它在块首就装配好了），关闭时单独收尾。
        const call = toolCalls.get(wireIndex)
        if (call !== undefined) {
          toolCalls.delete(wireIndex)
          yield {
            type: 'block-end',
            index: call.index,
            block: {
              type: 'tool-call',
              id: ToolCallId(call.id),
              name: call.name,
              arguments: call.arguments === '' ? '{}' : call.arguments,
            },
          }
        }
        break
      }
      case 'message_delta': {
        if (isRecord(payload.delta) && typeof payload.delta.stop_reason === 'string') {
          finishSpelling = payload.delta.stop_reason
        }
        const usage = payload.usage
        if (isRecord(usage)) outputTokens = numberValue(usage.output_tokens) ?? outputTokens
        break
      }
      case 'message_stop':
        break
      case 'ping':
        break
      case 'error': {
        throw messagesErrorEvent(payload)
      }
      default: {
        unknownEvents += 1
        if (unknownEvents > MAX_UNKNOWN_EVENTS) {
          throw new LlmError(
            `llm-opendesign: Open Design 的 Messages 流里有超过 ${MAX_UNKNOWN_EVENTS} 个无法识别的事件`
            + `（最后一个是 "${truncate(type, 60)}"），已停止读取以免空转。`,
            'PROTOCOL_ERROR',
          )
        }
      }
    }
    if (Math.max(estimatedOutputTokens, outputTokens) >= cap) {
      truncated = true
      break
    }
  }

  if (started === 0 && toolCalls.size === 0) {
    if (seen.frames === 0 && seen.head.trimStart().startsWith('<')) throw nonSseBodyFailure(seen.head)
    throw emptyResponseFailure()
  }

  for (const wireIndex of [...blocks.keys()]) yield* closeBlock(wireIndex)
  for (const call of toolCalls.values()) {
    yield {
      type: 'block-end',
      index: call.index,
      block: {
        type: 'tool-call',
        id: ToolCallId(call.id),
        name: call.name,
        arguments: call.arguments === '' ? '{}' : call.arguments,
      },
    }
  }

  const usage = usageOf({ inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens })
  if (usage !== undefined) yield { type: 'usage', usage }
  yield {
    type: 'finish',
    reason: truncated
      ? { kind: 'max-tokens' }
      : finishReasonOf(finishSpelling, toolCalls.size, outputTokens, cap),
  }
}

/** One block currently open on the wire index it was announced at. */
interface OpenBlock {
  readonly index: number
  readonly kind: 'text' | 'reasoning'
  text: string
}

/** 关闭所有还开着的文本/思考块（新块开始前收尾，保住块的先后顺序）。 */
function* closeOpenBlocks(blocks: Map<number, OpenBlock>): Generator<StreamChunk> {
  for (const wireIndex of [...blocks.keys()]) {
    const open = blocks.get(wireIndex)!
    blocks.delete(wireIndex)
    yield {
      type: 'block-end',
      index: open.index,
      block: open.kind === 'text'
        ? { type: 'text', text: open.text }
        : { type: 'reasoning', text: open.text },
    }
  }
}

/** 取得（必要时开启）某个 wire 下标上的块：块按首次出现分配宿主下标。 */
function openBlock(
  blocks: Map<number, OpenBlock>,
  wireIndex: number,
  nextIndex: number,
  kind: OpenBlock['kind'],
): { block: OpenBlock; created: boolean } {
  const existing = blocks.get(wireIndex)
  if (existing !== undefined) return { block: existing, created: false }
  const block: OpenBlock = { index: nextIndex, kind, text: '' }
  blocks.set(wireIndex, block)
  return { block, created: true }
}

/**
 * 让一个块的增量逐帧产出；首次出现时补 block-start。
 *
 * 返回值说明这一次是否新开了块：新开要占用下一个宿主下标。
 */
function* appendBlockDelta(
  blocks: Map<number, OpenBlock>,
  wireIndex: number,
  nextIndex: number,
  kind: OpenBlock['kind'],
  text: string,
): Generator<StreamChunk, boolean> {
  const open = openBlock(blocks, wireIndex, nextIndex, kind)
  open.block.text += text
  if (open.created) yield { type: 'block-start', index: open.block.index, blockType: kind }
  yield kind === 'reasoning'
    ? { type: 'reasoning-delta', index: open.block.index, text }
    : { type: 'text-delta', index: open.block.index, text }
  return open.created
}

/**
 * 终态原因，缺省时推断。
 *
 * `stop_reason` 在 `message_delta` 里，网关若没给就不算失败：有工具调用就是工具
 * 调用，输出吃满上限就是长度截断，其余算正常结束（与 Chat 面同一套推断）。
 */
function finishReasonOf(
  spelling: string | undefined,
  toolCallCount: number,
  outputTokens: number,
  cap: number,
): FinishReason {
  if (spelling === 'max_tokens') return { kind: 'max-tokens' }
  if (spelling === 'tool_use') return { kind: 'tool-calls' }
  if (spelling !== undefined) return { kind: 'stop' }
  if (toolCallCount > 0) return { kind: 'tool-calls' }
  if (outputTokens >= cap) return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/**
 * Anthropic 的用量映射成宿主的不相交记账。
 *
 * `input_tokens` 本来就是「未命中缓存」的那一段，缓存读/写单列
 * （`cache_read_input_tokens` / `cache_creation_input_tokens`），所以三者可以直接
 * 相加得到总输入；总量字段 Anthropic 不给，这里按上游的聚合计数派生。
 */
function usageOf(counts: {
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
}): TokenUsage | undefined {
  const total = counts.inputTokens + counts.cacheReadTokens + counts.cacheWriteTokens + counts.outputTokens
  if (total === 0) return undefined
  return {
    inputTokens: counts.inputTokens,
    outputTokens: counts.outputTokens,
    totalTokens: total,
    cacheReadTokens: counts.cacheReadTokens,
    cacheWriteTokens: counts.cacheWriteTokens,
  }
}

/** 流内 `error` 事件按类型给出宿主错误码；未识别的类型按临时故障处理。 */
function messagesErrorEvent(payload: SsePayload): LlmError {
  const error = isRecord(payload.error) ? payload.error : {}
  const type = typeof error.type === 'string' ? error.type : 'unknown_error'
  const message = typeof error.message === 'string' ? error.message : ''
  const detail = message === '' ? '' : `：${truncate(message, 400)}`
  if (type === 'invalid_request_error') {
    return new LlmError(
      `Open Design 的 Messages 面拒绝了这条请求（${type}）${detail}。这属于确定性错误，重试同样会失败。`,
      'BAD_REQUEST',
    )
  }
  if (type === 'authentication_error' || type === 'permission_error') {
    return new LlmError(
      `Open Design 拒绝了这把 API Key（${type}）${detail}。请在 设置 → Open Design 检查 Key。`,
      'AUTH',
    )
  }
  if (type === 'rate_limit_error') {
    return new LlmError(
      `Open Design 限流了这次请求（${type}）${detail}。插件会自动重试；连续限流时请稍后再发。`,
      'RATE_LIMIT',
    )
  }
  return new LlmError(
    `Open Design 的 Messages 流返回了错误事件（${type}）${detail}。这通常是上游临时故障，插件会自动重试。`,
    'TRANSIENT',
  )
}
