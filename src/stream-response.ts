/**
 * 流式响应映射（ticket 04）—— 把 Chat Completions 的 SSE 字节流转成宿主认得
 * 的 {@link StreamChunk} 序列。
 *
 * 线上事实来自协议实测（`docs/grill/20261020-opendesign-protocol-probe.md` §3.3–§3.6）
 * 与设计件 §4.5：
 *
 * - 正文在 `choices[].delta.content`；思考在非标准字段 `delta.reasoning`
 *   （伴随 `delta.reasoning_details[]`），**不是** `reasoning_content`；
 * - 思考首帧可能是空串（deepseek 会先发 `reasoning:""`），空增量不产出任何块；
 * - `delta.tool_calls[]` 用 `index` 认领同一次调用，`id/name` 只在首片出现、
 *   `arguments` 逐片拼接；
 * - 尾帧是 `choices: []` 只带 `usage` 的帧，必须计入；
 * - `finish_reason` 可缺省（gpt-6-luna 贴近实测），缺省时按内容/工具/上限推断；
 * - `data: [DONE]` 是终止标记，其后的帧一律不看；`event:` 行不参与分派；
 * - 累计输出（思考 + 正文 + 工具参数，含上游报出的 usage）达到上限就停止读取，
 *   保留已产出的内容并以「因长度结束」收尾（ticket 05 的客户端硬截断）。
 *
 * 本模块只被 Host 半侧引用，不导入 cordis / schemastery。
 *
 * @module dsh-opendesign-provider/stream-response
 */

import { randomUUID } from 'node:crypto'

import {
  ToolCallId,
  type FinishReason,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { emptyResponseFailure, nonSseBodyFailure } from './error-taxonomy.ts'
import { estimateOutputTokens } from './output-tokens.ts'
import { isRecord, numberValue, readSsePayloads, type SseObservation, type SsePayload } from './sse-frames.ts'

/**
 * 把一次流式响应映射成块序列。
 *
 * 块按首次出现的顺序分配下标：思考 → 正文 → 逐个工具调用；结束时按同一顺序
 * 关闭。这样宿主装配器拿到的消息与「先想、再说、再调工具」的语义一致。
 */
export async function* streamedCompletionChunks(
  body: ReadableStream<Uint8Array>,
  cap: number,
  idleTimeoutMs = 0,
): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let reasoning: { readonly index: number; text: string } | undefined
  let text: { readonly index: number; text: string } | undefined
  const toolCalls = new Map<number, { readonly index: number; id: string; name: string; arguments: string }>()
  let finishSpelling: string | undefined
  let usage: TokenUsage | undefined
  // 硬截断的计数：已收到内容的估算值，以及上游在流内报出的真实用量，取较大者。
  let estimatedOutputTokens = 0
  let reportedOutputTokens = 0
  let truncated = false

  /** 关闭当前思考块：下一类内容开始时收尾，块的形态与一次性响应完全一致。 */
  function* closeReasoning(): Generator<StreamChunk> {
    if (reasoning === undefined) return
    yield { type: 'block-end', index: reasoning.index, block: { type: 'reasoning', text: reasoning.text } }
    reasoning = undefined
  }

  /** 关闭当前正文块。 */
  function* closeText(): Generator<StreamChunk> {
    if (text === undefined) return
    yield { type: 'block-end', index: text.index, block: { type: 'text', text: text.text } }
    text = undefined
  }

  // 观察到的 SSE 外形：有多少个 `data:` 帧、开头是什么。用来区分「上游交了空回复」
  // 与「网关根本没按 SSE 回话」（HTML 错误页）。
  const seen: SseObservation = { frames: 0, head: '' }
  for await (const payload of readSsePayloads(body, seen, idleTimeoutMs)) {
    const reported = usageOf(payload.usage)
    if (reported !== undefined) {
      usage = reported
      reportedOutputTokens = Math.max(reportedOutputTokens, reported.outputTokens)
    }
    const choice = firstChoice(payload)
    if (choice === undefined) {
      // 只有用量的尾帧（真实流）或空帧：用量本身也可能已经证明到顶。
      if (reportedOutputTokens >= cap) {
        truncated = true
        break
      }
      continue
    }
    if (typeof choice.finish_reason === 'string') finishSpelling = choice.finish_reason
    const delta = isRecord(choice.delta) ? choice.delta : {}

    const reasoningDelta = reasoningTextOf(delta)
    if (reasoningDelta !== '') {
      if (reasoning === undefined) {
        reasoning = { index: nextIndex++, text: '' }
        yield { type: 'block-start', index: reasoning.index, blockType: 'reasoning' }
      }
      reasoning.text += reasoningDelta
      estimatedOutputTokens += estimateOutputTokens(reasoningDelta)
      yield { type: 'reasoning-delta', index: reasoning.index, text: reasoningDelta }
    }

    const textDelta = textOf(delta.content)
    if (textDelta !== '') {
      if (text === undefined) {
        yield* closeReasoning()
        text = { index: nextIndex++, text: '' }
        yield { type: 'block-start', index: text.index, blockType: 'text' }
      }
      text.text += textDelta
      estimatedOutputTokens += estimateOutputTokens(textDelta)
      yield { type: 'text-delta', index: text.index, text: textDelta }
    }

    for (const fragment of toolCallFragments(delta.tool_calls)) {
      let call = toolCalls.get(fragment.index)
      if (call === undefined) {
        yield* closeReasoning()
        yield* closeText()
        call = {
          index: nextIndex++,
          id: fragment.id === '' ? randomUUID() : fragment.id,
          name: '',
          arguments: '',
        }
        toolCalls.set(fragment.index, call)
        yield { type: 'block-start', index: call.index, blockType: 'tool-call' }
      }
      if (fragment.name !== '') call.name = fragment.name
      call.arguments += fragment.argumentsDelta
      estimatedOutputTokens += estimateOutputTokens(fragment.argumentsDelta)
      yield {
        type: 'tool-call-delta',
        index: call.index,
        id: ToolCallId(call.id),
        ...(fragment.name === '' ? {} : { name: fragment.name }),
        argumentsDelta: fragment.argumentsDelta,
      }
    }

    // 越线就停止读取：剩下的帧（可能还有半截工具调用或错误页）不再看。
    // 已产出的内容保留，终态由 `truncated` 改写成「因长度结束」。
    if (Math.max(estimatedOutputTokens, reportedOutputTokens) >= cap) {
      truncated = true
      break
    }
  }

  // 一帧可展示内容都没有：空回复比报错更糟，但要分两种说法（ticket 06）——
  // 上游交了空回复（EMPTY_RESPONSE，可重试），还是网关回的根本不是 SSE（协议错误）。
  if (reasoning === undefined && text === undefined && toolCalls.size === 0) {
    if (seen.frames === 0 && seen.head.trimStart().startsWith('<')) throw nonSseBodyFailure(seen.head)
    throw emptyResponseFailure()
  }

  yield* closeReasoning()
  yield* closeText()
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

  if (usage !== undefined) yield { type: 'usage', usage }
  yield {
    type: 'finish',
    reason: truncated ? { kind: 'max-tokens' } : finishReasonOf(finishSpelling, toolCalls.size, usage, cap),
  }
}

/** 第一项 choice；`choices: []` 的 usage 尾帧与畸形帧都读不到。 */
function firstChoice(payload: SsePayload): Record<string, unknown> | undefined {
  if (!Array.isArray(payload.choices)) return undefined
  return isRecord(payload.choices[0]) ? payload.choices[0] : undefined
}

/**
 * 工具调用分片：`index` 认领调用，`id`/`name` 首片才有，`arguments` 逐片拼接。
 *
 * 缺 `index` 的网关按数组位置兜底，缺 `id` 由调用方补 UUID。
 */
function toolCallFragments(
  raw: unknown,
): Array<{ readonly index: number; readonly id: string; readonly name: string; readonly argumentsDelta: string }> {
  if (!Array.isArray(raw)) return []
  const fragments: Array<{ index: number; id: string; name: string; argumentsDelta: string }> = []
  raw.forEach((entry, position) => {
    if (!isRecord(entry)) return
    const fn = isRecord(entry.function) ? entry.function : {}
    const args = fn.arguments
    fragments.push({
      index: numberValue(entry.index) ?? position,
      id: typeof entry.id === 'string' ? entry.id : '',
      name: typeof fn.name === 'string' ? fn.name : '',
      argumentsDelta: typeof args === 'string'
        ? args
        : isRecord(args) || Array.isArray(args) ? JSON.stringify(args) : '',
    })
  })
  return fragments
}

/**
 * 终态原因，缺省时推断。
 *
 * `finish_reason` 可以整场都不出现（gpt-6-luna 的贴近实况），所以缺省不是失败：
 * 有工具调用就是工具调用，输出吃满了本次请求的上限就是长度截断，其余算正常结束。
 */
function finishReasonOf(
  spelling: string | undefined,
  toolCallCount: number,
  usage: TokenUsage | undefined,
  cap: number,
): FinishReason {
  if (spelling === 'length' || spelling === 'max_tokens') return { kind: 'max-tokens' }
  if (spelling === 'tool_calls' || spelling === 'function_call') return { kind: 'tool-calls' }
  if (spelling !== undefined) return { kind: 'stop' }
  if (toolCallCount > 0) return { kind: 'tool-calls' }
  if (usage !== undefined && usage.outputTokens >= cap) return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/** 不相交的 token 记账：缓存输入与思考 token 单列（与设计件 §4.5 一致）。 */
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

/** 正文增量：字符串或分片数组（部分网关会把 content 拆成 parts）。 */
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
 * 思考增量：非标准 `reasoning` 标量优先，`reasoning_details[]` 作为兜底。
 *
 * 两者同时出现时只取标量，否则同一段思考会被计两遍。
 */
function reasoningTextOf(delta: Record<string, unknown>): string {
  if (typeof delta.reasoning === 'string' && delta.reasoning !== '') return delta.reasoning
  if (!Array.isArray(delta.reasoning_details)) return ''
  const parts: string[] = []
  for (const detail of delta.reasoning_details) {
    if (isRecord(detail) && typeof detail.text === 'string') parts.push(detail.text)
  }
  return parts.join('')
}
