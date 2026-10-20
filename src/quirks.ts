/**
 * 兼容规则（ticket 02）—— 本票需要的最小一组逐模型 quirks。
 *
 * 这里的规则都来自协议实测（`docs/grill/20261020-opendesign-protocol-probe.md`
 * §3.2 / §3.3 / §5）与设计件 §4.3–§4.4：
 *
 * - `off` 必须发字面量 `"none"`；省略字段上游仍会思考。
 * - 输出上限字段是 `max_completion_tokens`；`max_tokens` 全员不认。
 * - glm 只接受 low/high/max，kimi 没有 off/max —— 逐模型档位域来自目录快照，
 *   本模块只做「域内收敛」与「上线字面量映射」，不另存第二份档位表。
 * - gpt-6-luna 与 claude-haiku-5.5 在 Chat 面完全不吐 `reasoning`（实测），它们的
 *   思考只在 Responses / Messages 面可见；这不是 bug，界面上要标注「思考不可见」。
 * - 上游不认输出上限（glm 实测 16 → 74 tokens）时由客户端硬截断兜底
 *   （`stream-response.ts`，ticket 05）；kimi 的 low/medium 档另有思考预算门限。
 *
 * @module dsh-opendesign-provider/quirks
 */

import {
  REASONING_LEVEL_ORDER,
  findCatalogModel,
  type ReasoningLevel,
} from './catalog-snapshot.ts'

/** The only output-cap field the gateway honours (`max_tokens` is ignored by every model). */
export const OUTPUT_CAP_FIELD = 'max_completion_tokens'

/** The wire spelling of "do not think": a literal, not an omitted field. */
export const WIRE_REASONING_OFF = 'none'

/** Unknown model ids get the full domain until the live directory teaches us otherwise (ticket 03). */
const UNKNOWN_MODEL_LEVELS: readonly ReasoningLevel[] = REASONING_LEVEL_ORDER

/** Levels one model accepts, by exact id; unknown ids get the full set. */
export function reasoningLevelsFor(model: string): readonly ReasoningLevel[] {
  return findCatalogModel(model)?.reasoningLevels ?? UNKNOWN_MODEL_LEVELS
}

/** Whether a level is selectable for this model as-is. */
export function supportsReasoningLevel(model: string, level: string): level is ReasoningLevel {
  return (reasoningLevelsFor(model) as readonly string[]).includes(level)
}

/**
 * The `reasoning_effort` value to send, or `undefined` to send no field.
 *
 * `off` is the one level whose wire spelling differs: the gateway accepts the
 * literal `"none"` and rejects omission as "please think anyway".
 */
export function wireReasoningEffort(level: ReasoningLevel | undefined): string | undefined {
  if (level === undefined) return undefined
  return level === 'off' ? WIRE_REASONING_OFF : level
}

/**
 * glm's three-tier domain cannot express the harness's seven levels. Design
 * §4.4 fixes the fold: anything lighter than `high` collapses to `low`, and
 * `xhigh` folds up to `max`.
 */
const COARSE_LEVEL_FOLDS: Readonly<Record<ReasoningLevel, ReasoningLevel>> = {
  off: 'low',
  minimal: 'low',
  low: 'low',
  medium: 'low',
  high: 'high',
  xhigh: 'max',
  max: 'max',
}

/** Whether the model's domain is glm's coarse low/high/max set. */
function hasCoarseDomain(levels: readonly ReasoningLevel[]): boolean {
  return levels.length === 3 && levels[0] === 'low' && levels[1] === 'high' && levels[2] === 'max'
}

/**
 * The nearest level this model actually accepts.
 *
 * A legal level passes through untouched. For a contiguous domain (kimi's
 * `minimal..xhigh`) the requested level is clamped into range; for glm's coarse
 * domain the design's explicit fold is applied instead of a distance rule, so
 * `medium` cannot land on `high` and `xhigh` cannot stay on `high`.
 */
export function coerceReasoningLevel(model: string, level: ReasoningLevel): ReasoningLevel {
  const levels = reasoningLevelsFor(model)
  if (levels.includes(level)) return level
  if (hasCoarseDomain(levels)) return COARSE_LEVEL_FOLDS[level]
  const target = REASONING_LEVEL_ORDER.indexOf(level)
  let best = levels[0] ?? level
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of levels) {
    const distance = Math.abs(REASONING_LEVEL_ORDER.indexOf(candidate) - target)
    // A tie can only mean the domain skips a level; the lighter candidate is
    // the conservative reading (design §4.4 folds medium down to low).
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** 在 Chat Completions 面不吐 `reasoning` 的模型（协议实测 §3.3）。 */
const CHAT_THINKING_HIDDEN: readonly string[] = ['gpt-6-luna', 'claude-haiku-5.5']

/**
 * 该模型在 Chat 面是否会把思考发出来。
 *
 * 两个模型把思考藏在上游（gpt-6-luna 只在 `/v1/responses` 的 reasoning 项里给、
 * claude-haiku-5.5 在 Chat 流里从不发 `reasoning`）。界面据此标注「思考不可见」，
 * 用户才不用把「没有思考块」误读成「模型没思考」。
 */
export function thinkingVisibleInChat(model: string): boolean {
  return !CHAT_THINKING_HIDDEN.includes(model)
}

/** kimi 是唯一有思考预算门限的模型（设计件 §4.3）。 */
const KIMI_MODEL_ID = 'kimi-k2.7-code'

/**
 * kimi 各档的 `thinking_budget`（token），来自 2026-10-20 的逐档实测：
 *
 * - `minimal` 与 `low` → 8192；
 * - `medium` → 32768；
 * - `high` / `xhigh` → 无门限：`max_completion_tokens` 给 16 甚至 1 都返回 200，
 *   上游没有可收敛的预算。设计件写的「high 更高」是当时的假设，实测不支持，
 *   所以不编一个数字：给小上限就让它真截断。
 *
 * 报错原文：`max_completion_tokens [8192] must be greater than thinking_budget [8192]`。
 */
const KIMI_THINKING_BUDGETS: Readonly<Partial<Record<ReasoningLevel, number>>> = {
  minimal: 8_192,
  low: 8_192,
  medium: 32_768,
}

/**
 * 该模型在该思考档的 `thinking_budget`；`undefined` = 这一档没有预算门限。
 *
 * 只对 kimi 生效：其他模型的档位不影响输出上限。
 */
export function thinkingBudgetFor(model: string, level: ReasoningLevel | undefined): number | undefined {
  if (model !== KIMI_MODEL_ID || level === undefined) return undefined
  return KIMI_THINKING_BUDGETS[level]
}

/**
 * 该档可用的最小 `max_completion_tokens`：上游要求严格「大于」预算，
 * 所以是预算 + 1；没有门限的档返回 `undefined`。
 */
export function outputCapFloor(model: string, level: ReasoningLevel | undefined): number | undefined {
  const budget = thinkingBudgetFor(model, level)
  return budget === undefined ? undefined : budget + 1
}
