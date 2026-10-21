/**
 * SSE 分帧（ticket 04 的读取器，ticket 13 起两条传输共用）。
 *
 * 两条传输的行形态不同：Chat Completions 是 data-only 帧（实测），Anthropic
 * Messages 则带 `event:` 行。分帧只按行切，不把 `event:` 当协议——事件类型由
 * 各传输从载荷的 `type` 字段读，这样 `event:` 行缺失的流也能解析。
 *
 * 读取器只负责「一行 → 一个载荷对象」，不理解任何业务字段；空闲计时按「等下一片
 * 数据」的时间起表，读到数据就重来。
 *
 * 本模块只被 Host 半侧引用，不导入 cordis / schemastery。
 *
 * @module dsh-opendesign-provider/sse-frames
 */

import { LlmError } from '@deepseek-ai/dsh-llm'

import { idleTimeoutFailure } from './error-taxonomy.ts'

/** 一帧 `data:` 载荷：解析后的对象。 */
export type SsePayload = Record<string, unknown>

/**
 * 观察到的流外形：有多少个 `data:` 帧、开头是什么。
 *
 * 用来区分「上游交了空回复」与「网关根本没按 SSE 回话」（HTML 错误页）。
 */
export interface SseObservation {
  frames: number
  head: string
}

/**
 * 逐行读 SSE，产出每个 `data:` 帧解析后的对象，遇 `[DONE]` 停止。
 *
 * 只按行分帧，不依赖空行边界，也不看 `event:` / `id:` / 注释行；一个 `data:`
 * 行必须是一整段 JSON，行被网络切断时由缓冲区拼回。
 */
export async function* readSsePayloads(
  body: ReadableStream<Uint8Array>,
  seen: SseObservation,
  idleTimeoutMs: number,
): AsyncGenerator<SsePayload> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const idleMs = Math.max(0, Math.trunc(idleTimeoutMs))
  let buffer = ''
  // 空闲计时只覆盖「等下一片数据」的时间：读到数据就重新起表，读完后拆表。
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let idleExpired = false
  const armIdleTimer = (): void => {
    if (idleMs === 0) return
    idleTimer = setTimeout(() => {
      idleExpired = true
      // 取消读取会让挂起的 read 以 done 结束，循环随即看到 idleExpired 并抛出。
      void reader.cancel().catch(() => {})
    }, idleMs)
  }
  const disarmIdleTimer = (): void => {
    if (idleTimer === undefined) return
    clearTimeout(idleTimer)
    idleTimer = undefined
  }
  try {
    for (;;) {
      armIdleTimer()
      const chunk = await reader.read()
      disarmIdleTimer()
      if (idleExpired) throw idleTimeoutFailure(idleMs)
      if (chunk.done) break
      const text = decoder.decode(chunk.value, { stream: true })
      buffer += text
      if (seen.head.length < 200) seen.head += text.slice(0, 200 - seen.head.length)
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const frame = frameOf(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (frame.startsWith('data:')) seen.frames += 1
        const payload = parseFrame(frame)
        if (payload === 'done') return
        if (payload !== undefined) yield payload
      }
    }
    const tail = parseFrame(frameOf(buffer))
    if (tail !== undefined && tail !== 'done') yield tail
  } finally {
    disarmIdleTimer()
    await reader.cancel().catch(() => {
      // 取消只是提前放手；读错误已由上面的循环抛出。
    })
  }
}

/** 去掉行尾 `\r`；SSE 的换行既可能是 `\n` 也可能是 `\r\n`。 */
function frameOf(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/** 解析一行 SSE：`data:` 载荷 → 对象（或终止标记），其余行（`event:`、注释、空行）忽略。 */
function parseFrame(line: string): SsePayload | 'done' | undefined {
  if (!line.startsWith('data:')) return undefined
  const payload = line.slice('data:'.length).replace(/^ /u, '').trim()
  if (payload === '') return undefined
  if (payload === '[DONE]') return 'done'
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    throw new LlmError(
      `llm-opendesign: Open Design 的流式响应里有一帧不是合法 JSON：${truncate(payload)}`,
      'PROTOCOL_ERROR',
    )
  }
  if (!isRecord(parsed)) {
    throw new LlmError(
      `llm-opendesign: Open Design 的流式响应里有一帧不是 JSON 对象：${truncate(payload)}`,
      'PROTOCOL_ERROR',
    )
  }
  return parsed
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function truncate(text: string, max = 300): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
