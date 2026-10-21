/**
 * The 12 Open Design models this bundle ships knowledge about.
 *
 * The gateway's `GET /v1/models` is the authority once it answers (ticket 03
 * reads it); this snapshot is the offline truth the adapter falls back to when
 * the gateway is unreachable, unauthorised or malformed, and it stays the
 * source of display names, reasoning domains and modalities for ids it knows.
 *
 * One reading in the table is deliberate and must not be "corrected":
 *
 * - `kimi-k2.7-code` advertises `maxTokens = 65536` even though its
 *   `output_budget` is 32000, because its medium/high thinking levels require
 *   `max_completion_tokens` to exceed the level's thinking budget (32768).
 *
 * `contextWindow` is the gateway's `metadata.context_limit`, the only limit the
 * gateway actually enforces; it counts input + output, which is exactly what
 * the host's `LlmModelContext.contextWindow` means. The sibling field
 * `context_budget` is a product-side advisory budget (22%~38% of the limit)
 * that the gateway never enforces; see `./gateway-facts.ts` for the probes.
 *
 * Data comes from `docs/opendesign/00-改造设计.md` §5.2 and
 * `docs/grill/20261020-opendesign-facts-local.md` §5.
 *
 * @module dsh-opendesign-provider/catalog-snapshot
 */

/** A reasoning level DeepSeek Harness can select, least to greatest. */
export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Canonical level order: the rank used by the picker and by coercions. */
export const REASONING_LEVEL_ORDER: readonly ReasoningLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/** The vendor's own cost word for a model (`metadata.cost`). */
export type ModelCostTier = 'low' | 'medium' | 'high'

/** The vendor's own capability word for a model (`metadata.capability`). */
export type ModelCapabilityTier = 'standard' | 'advanced'

/** An input modality the gateway publishes in `architecture.input_modalities`. */
export type CatalogInputModality = 'text' | 'image' | 'file' | 'audio' | 'video'

/** Everything one model declares while the gateway is not consulted. */
export interface CatalogModelSnapshot {
  /** Model id sent as `model` and selected in the picker. */
  readonly id: string
  /** Official display name; never a provider-suffixed variant. */
  readonly name: string
  /** Usable input budget (`context_budget`), not the nominal context limit. */
  readonly contextWindow: number
  /** Output budget; kimi is raised to 65536 so its thinking levels fit. */
  readonly maxTokens: number
  /** Vendor cost word, shown as a tier rather than a price. */
  readonly cost: ModelCostTier
  /** Vendor capability word. */
  readonly capability: ModelCapabilityTier
  /** Input modalities the gateway declares. */
  readonly inputModalities: readonly CatalogInputModality[]
  /** Levels this model actually accepts; nothing outside this list is legal. */
  readonly reasoningLevels: readonly ReasoningLevel[]
  /** Gateway default model (`default: true`). */
  readonly default?: true
}

/** The model the gateway marks default, kept at the top of the picker. */
export const DEFAULT_MODEL_ID = 'deepseek-v4.1-flash'

/**
 * Output budget assumed for a model whose `metadata.output_budget` is absent
 * (design §5.1); the live directory's value wins whenever it publishes one.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_768

const ALL_LEVELS: readonly ReasoningLevel[] = REASONING_LEVEL_ORDER

/**
 * DeepSeek's four REAL levels.
 *
 * 这是本轮唯一一处「网关能收 ≠ 档位存在」的判定，依据是 DeepSeek 官方
 * [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/) 的映射表：
 * `minimal/low → low`、`medium/high/xhigh → high`、`max → max`。也就是说
 * `reasoning_effort` 收 8 个词，真正生效的只有 low / high / max 三档（外加关闭）。
 *
 * 实测佐证（2026-10-21，硬 prompt × 6 次，`usage.completion_tokens_details.reasoning_tokens` 中位数）：
 * `deepseek-v4-flash` low 240 < high 286；`deepseek-v4-pro` low 275 < high 361。
 * 与 Command Code 官方 CLI 快照对 `deepseek/deepseek-v4.1-flash` 的
 * `["off","low","high","max"]` 一致。
 */
const DEEPSEEK_LEVELS: readonly ReasoningLevel[] = ['off', 'low', 'high', 'max']

/** glm's gateway accepts only these three; minimal/medium/xhigh are folded. */
const GLM_LEVELS: readonly ReasoningLevel[] = ['low', 'high', 'max']

/** kimi has neither `off` nor `max`. */
const KIMI_LEVELS: readonly ReasoningLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

/** The 12-model snapshot, in the gateway's own id order. */
export const CATALOG_SNAPSHOT: readonly CatalogModelSnapshot[] = [
  {
    id: 'claude-haiku-5.5',
    name: 'Claude Haiku 5.5',
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    cost: 'low',
    capability: 'standard',
    inputModalities: ['text', 'image', 'file'],
    reasoningLevels: ALL_LEVELS,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'standard',
    inputModalities: ['text'],
    reasoningLevels: DEEPSEEK_LEVELS,
  },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision Exp',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'standard',
    inputModalities: ['text', 'image'],
    reasoningLevels: DEEPSEEK_LEVELS,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    contextWindow: 1_048_000,
    maxTokens: 128_000,
    cost: 'high',
    capability: 'advanced',
    inputModalities: ['text'],
    reasoningLevels: DEEPSEEK_LEVELS,
  },
  {
    id: DEFAULT_MODEL_ID,
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 1_048_000,
    maxTokens: 128_000,
    cost: 'low',
    capability: 'advanced',
    inputModalities: ['text', 'image'],
    reasoningLevels: DEEPSEEK_LEVELS,
    default: true,
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'low',
    capability: 'advanced',
    inputModalities: ['text', 'image', 'video'],
    reasoningLevels: GLM_LEVELS,
  },
  {
    id: 'glm-5.3-flashx',
    name: 'GLM-5.3 Flash-X',
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'advanced',
    inputModalities: ['text', 'image', 'file', 'video'],
    reasoningLevels: GLM_LEVELS,
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    cost: 'low',
    capability: 'standard',
    inputModalities: ['text', 'image', 'file'],
    reasoningLevels: ALL_LEVELS,
  },
  {
    id: 'hy4-preview',
    name: 'Hunyuan H4 Preview',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'advanced',
    inputModalities: ['text'],
    reasoningLevels: ALL_LEVELS,
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    contextWindow: 262_000,
    maxTokens: 65_536,
    cost: 'medium',
    capability: 'advanced',
    inputModalities: ['text', 'image'],
    reasoningLevels: KIMI_LEVELS,
  },
  {
    id: 'mimo-v2.6-flash',
    name: 'MiMo V2.6 Flash',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'low',
    capability: 'standard',
    inputModalities: ['text', 'image', 'audio', 'video'],
    reasoningLevels: ALL_LEVELS,
  },
  {
    id: 'mimo-v2.6-pro',
    name: 'MiMo V2.6 Pro',
    contextWindow: 1_048_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'advanced',
    inputModalities: ['text', 'image', 'audio', 'video'],
    reasoningLevels: ALL_LEVELS,
  },
]

/** Look one snapshot entry up by exact model id; unknown ids answer `undefined`. */
export function findCatalogModel(id: string): CatalogModelSnapshot | undefined {
  return CATALOG_SNAPSHOT.find((entry) => entry.id === id)
}

/** The fields every catalog row — snapshot or gateway-merged — orders and labels by. */
export interface CatalogTierFacts {
  /** Model id, the final tie-break. */
  readonly id: string
  /** Vendor cost word, shown as a tier rather than a price. */
  readonly cost: ModelCostTier
  /** Vendor capability word. */
  readonly capability: ModelCapabilityTier
  /** Usable input budget in tokens. */
  readonly contextWindow: number
  /** Whether the gateway marks this model default; absent reads as `false`. */
  readonly default?: boolean | undefined
}

/**
 * The picker's order (design §5.4): the default model first, then `advanced`
 * ahead of `standard`, cheaper ahead of dearer, and the id as the tie-break so
 * two loads never disagree.
 *
 * Exported because the live catalog merges gateway rows into the same shape;
 * both listings must sort through this one comparator or the picker would
 * reorder itself when the gateway becomes reachable.
 */
export function compareCatalogEntries(left: CatalogTierFacts, right: CatalogTierFacts): number {
  const costRank: Readonly<Record<ModelCostTier, number>> = { low: 0, medium: 1, high: 2 }
  if (left.default === true || right.default === true) {
    return left.default === true ? -1 : 1
  }
  if (left.capability !== right.capability) return left.capability === 'advanced' ? -1 : 1
  const leftCost = costRank[left.cost]
  const rightCost = costRank[right.cost]
  if (leftCost !== rightCost) return leftCost - rightCost
  return left.id.localeCompare(right.id)
}

/** The snapshot in picker order; see {@link compareCatalogEntries}. */
export function orderedCatalog(): readonly CatalogModelSnapshot[] {
  return [...CATALOG_SNAPSHOT].sort(compareCatalogEntries)
}

/**
 * The modalities the harness vocabulary can declare for this model: it knows
 * `text` and `image` only, so `file`/`audio`/`video` are not advertised even
 * when the vendor lists them — the adapter refuses those attachments anyway.
 */
export function hostInputModalities(entry: {
  readonly inputModalities: readonly string[]
}): readonly ('text' | 'image')[] {
  return entry.inputModalities.includes('image') ? ['text', 'image'] : ['text']
}

/** One-line picker subtitle: capability and cost tiers, then the usable window. */
export function describeCatalogModel(entry: CatalogTierFacts): string {
  return `${entry.capability} · ${entry.cost} cost · ${Math.round(entry.contextWindow / 1000)}K context`
}
