/**
 * 普通临时故障的预算：空回复、网关临时故障（`TRANSIENT`）、超时，以及 429 限流
 * （ticket 06 起 429 也走这棵预算，最多 3 次）。确定性错误不计数也不重试；
 * 预算按智能体的一次模型请求重置。
 */
export const TRANSIENT_MAX_RETRIES = 3
export const THROTTLED_CODE = 'THROTTLED'
/**
 * 值得再试一次的失败码：空回复、网关临时故障、超时，以及 429 限流（有 Retry-After
 * 时引擎按上游时间等，没有则指数退避）。确定性错误（`AUTH` / `QUOTA_EXHAUSTED` /
 * `BAD_REQUEST` / `PROTOCOL_ERROR`）不在此列：重试只会重放同一个失败。
 */
const boundedCodes = new Set(['EMPTY_RESPONSE', 'TRANSIENT', 'TIMEOUT', THROTTLED_CODE, 'RATE_LIMIT'])
const counts = new WeakMap<object, number>()

export function absorbTransientFailure(agent: object, code: string): 'ignored' | 'retry' | 'exhausted' {
  if (!boundedCodes.has(code)) return 'ignored'
  const used = counts.get(agent) ?? 0
  if (used >= TRANSIENT_MAX_RETRIES) return 'exhausted'
  counts.set(agent, used + 1)
  return 'retry'
}

export function resetTransientFailures(agent: object): void {
  counts.delete(agent)
}

export function transientBudgetMessage(code: string, message: string): string {
  return `Open Design 请求在 ${TRANSIENT_MAX_RETRIES} 次自动重试后仍失败，已停止重试（${code}）。`
    + '请稍后重新发送；若反复出现，请检查服务状态或请求耗时诊断。'
    + ` 原因：${message}`
}
