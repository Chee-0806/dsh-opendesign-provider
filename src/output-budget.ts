/**
 * 输出上限的有效值（ticket 05）—— 宿主预算、模型输出预算与绝对上限的取小规则。
 *
 * 设计件 §4.3 把请求上限钉成 `min(DSH 预算, output_budget, 262144)`，并且只
 * 用 `max_completion_tokens` 发送。协议实测（`docs/grill/20261020-opendesign-protocol-probe.md`
 * §3.1）给出的两个边界决定了这里的常量：
 *
 * - `262144` 是网关接受的最大上限（`Range of max_tokens should be [1, 262144]`），
 *   超过它的请求会被直接拒绝；
 * - `max_tokens` 对所有被测模型都不生效，所以本 bundle 从不发它；`0`
 *   也不再表示「省略上限字段」，而是「没有宿主预算」。
 *
 * 模块保持纯函数（无 node 依赖），设置页与 Host 侧可以共用同一套边界。
 *
 * @module dsh-opendesign-provider/output-budget
 */

/**
 * 网关接受的绝对上限（含）：再大一个就会被上游以
 * `Range of max_tokens should be [1, 262144]` 拒绝。
 */
export const MAX_OUTPUT_TOKEN_LIMIT = 262_144

/**
 * `maxOutputTokens` 的 0 值：不是「0 token 的预算」，而是「没有宿主预算」。
 *
 * 旧骨架把它当「不发送上限字段」的哨兵，但 Open Design 的设计件 §4.2 把这个
 * 字段定为请求的固定成员——kimi 在没有该字段时行为不可控，硬截断也需要一个
 * 上限。所以 0 在这里只表示不收紧模型自己的预算。
 */
export const OMIT_OUTPUT_TOKENS = 0

/**
 * 一个值能否作为用户输出预算：0 哨兵，或绝对上限内的整数。
 *
 * 程序化构造的连接可以绕过 schemastery 归一化，所以 resolve 步骤会再判一次，
 * 把越界值回落到「未设置」，而不是让请求带着一个必被拒的预算上线。
 */
export function isValidMaxOutputTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= OMIT_OUTPUT_TOKENS && value <= MAX_OUTPUT_TOKEN_LIMIT
}

/** 一次请求算上限所需的三件事；都已是目录与配置解析后的值。 */
export interface OutputCapFacts {
  /** 宿主给的单次预算；`undefined` = 未设置，{@link OMIT_OUTPUT_TOKENS} = 不收紧。 */
  readonly hostBudget?: number | undefined
  /** 模型自己的输出预算（目录 `output_budget`，kimi 已抬到 65536）。 */
  readonly modelBudget: number
  /**
   * 模型当前思考档要求的最小值（思考预算 + 1）。kimi 的 low/medium 档若低到
   * 这个值以下会被上游以 400 拒绝，所以它是下限而不是又一个预算。
   */
  readonly thinkingFloor?: number | undefined
}

/**
 * 本次请求实际发送的 `max_completion_tokens`。
 *
 * 先按 `min(模型预算, 绝对上限)` 定出模型的硬边界，再用宿主预算收紧；最后
 * 应用思考档下限。下限可以高于宿主预算与模型预算——那是模型接受该档的硬
 * 门槛，压低它只会换来 400——但仍然不得越过绝对上限。
 */
export function effectiveOutputCap(facts: OutputCapFacts): number {
  const model = bounded(facts.modelBudget, 1)
  const host = facts.hostBudget
  const capped = isHostBudget(host) ? Math.min(model, bounded(host, model)) : model
  if (facts.thinkingFloor === undefined) return capped
  return Math.min(MAX_OUTPUT_TOKEN_LIMIT, Math.max(capped, bounded(facts.thinkingFloor, capped)))
}

/** 把任意来源的数值夹进 `[1, 262144]`；非法值回落到 `fallback`。 */
function bounded(value: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_OUTPUT_TOKEN_LIMIT, Math.max(1, Math.trunc(value)))
}

/**
 * 宿主预算是否真的能收紧上限：0 是哨兵，负数/小数/NaN 是绕过校验的脏值，
 * 两者都按「未设置」处理，而不是把上限压成 1。
 */
function isHostBudget(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}
