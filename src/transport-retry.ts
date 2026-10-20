/**
 * A bounded retry budget for `TRANSPORT` failures (issue #39, second report).
 *
 * The route policy (`providerRetryPolicy` in `./adapter.ts`) declares which codes
 * are worth another attempt — `EMPTY_RESPONSE`, `RATE_LIMIT`, `TIMEOUT`,
 * `TRANSIENT`, `TRANSPORT` since ticket 06 — and the engine owns the backoff. A
 * connection that cannot be established still needs its own, configurable cap:
 * a blip the first few attempts absorb, an outage no in-request waiting fixes.
 * So transport failures get this budget, cleared at each new STEP (one step = one
 * model request). `agent/status` → `idle` is NOT the reset (one `running` phase
 * spans a turn's steps), and neither is `assistant/attempt` (appended for the
 * FAILED attempt itself, which would clear the budget on every failure).
 *
 * @module
 */

/** Failure code this budget covers. */
export const TRANSPORT_FAILURE_CODE = 'TRANSPORT'

/** Transport failures to absorb before the failure surfaces (default 5: ~15 s of blip cover on the route cadence). */
export const DEFAULT_TRANSPORT_MAX_RETRIES = 5

/** Ceiling for the setting above (plausibility bound, not a recommendation; mirrored in `Config`'s schema and pinned by tests). */
export const MAX_TRANSPORT_MAX_RETRIES = 50

/**
 * The effective transport-retry cap from raw config.
 *
 * Shared by the request-failure handler and the diagnostics snapshot so the
 * number the user reads is the number the handler uses: a missing or unusable
 * value falls back to {@link DEFAULT_TRANSPORT_MAX_RETRIES}, a large one clamps
 * to {@link MAX_TRANSPORT_MAX_RETRIES}.
 *
 * @param raw - the config value as written (may be anything a hand-edited document carries).
 * @returns the effective cap.
 */
export function readTransportMaxRetries(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return DEFAULT_TRANSPORT_MAX_RETRIES
  return Math.min(Math.trunc(raw), MAX_TRANSPORT_MAX_RETRIES)
}

/** Why {@link absorbTransportFailure} answered the way it did. */
export type TransportRetryDecision = 'retry' | 'exhausted' | 'ignored'

/** One agent's live transport-failure count, keyed weakly so a dropped agent cannot leak. */
const counts = new WeakMap<object, number>()

/**
 * Count one attempt's outcome against the transport budget.
 *
 * @param agent - the identity the budget is scoped to (the agent object).
 * @param failureCode - the failed attempt's `LlmFailure.code`.
 * @param maxRetries - transport retries to absorb before the failure surfaces.
 * @returns `'ignored'` for any non-transport code (the route policy decides
 *   those, unchanged), `'retry'` while the budget has room, `'exhausted'` once
 *   it does not.
 */
export function absorbTransportFailure(
  agent: object,
  failureCode: string,
  maxRetries: number,
): TransportRetryDecision {
  if (failureCode !== TRANSPORT_FAILURE_CODE) return 'ignored'
  const used = counts.get(agent) ?? 0
  if (used >= maxRetries) return 'exhausted'
  counts.set(agent, used + 1)
  return 'retry'
}

/** Clear one agent's transport budget (a new step starts, or the turn ended). */
export function resetTransportFailures(agent: object): void {
  counts.delete(agent)
}

/**
 * What one session event means for the transport budget.
 *
 * Pure and exported on purpose: the choice of event is the part of this design
 * that is easy to get plausibly wrong (see the module comment), so it is stated
 * once, where a test can pin it.
 *
 * @param type - the appended session event's type.
 * @returns `'reset'` for a new step, `'forget'` when the turn ended (the
 *   session → agent mapping is no longer needed), otherwise `'none'`.
 */
export function transportResetAction(type: string): 'reset' | 'forget' | 'none' {
  if (type === 'step/start') return 'reset'
  if (type === 'turn/end') return 'forget'
  return 'none'
}

/**
 * The diagnosis a capped turn ends with. Bilingual, because the harness renders
 * a failed turn's message verbatim and this plugin's other user-facing failures
 * are too; it names the retry budget and the checks that actually help instead
 * of the bare "fetch failed" chain the retry chrome would otherwise show.
 */
export function transportBudgetMessage(failureMessage: string, maxRetries: number): string {
  return `${failureMessage}`
    + '；Open Design API 连接在连续重试后仍失败——已停止重试以免整轮卡死。'
    + `插件已自动重试 ${maxRetries} 次。通常说明当前网络到 Open Design 网关的连接不通，`
    + '常见原因是代理未生效：DSH 只读取环境变量 HTTPS_PROXY/HTTP_PROXY（系统代理/PAC 不会被读取），'
    + '请确认启动 DSH 的终端里已导出代理，或先关闭代理直连后重试。网络恢复后直接重发即可'
    + ` — Open Design API transport still failed after ${maxRetries} automatic retries, which were`
    + ' stopped so the turn could not stall for minutes. This is a connectivity problem between this'
    + ' machine and the Open Design gateway, not a context-window or request-size rejection. Common cause:'
    + ' the proxy is not reaching the harness — DSH reads HTTPS_PROXY/HTTP_PROXY from the environment'
    + ' only (a Windows system proxy/PAC setting is not consulted), so export it in the launching'
    + ' shell, or turn the proxy off and retry. Resend when the network recovers; the budget is per'
    + ' request and has been reset'
}
