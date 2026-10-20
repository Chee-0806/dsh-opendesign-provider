/**
 * The 12 Open Design models this bundle ships knowledge about.
 *
 * The gateway's `GET /v1/models` is the authority once it answers (ticket 03
 * makes the picker read it); this snapshot is the offline truth the adapter
 * falls back to, and the source of display names, budgets and reasoning
 * domains in the meantime. Ticket 02 ships it as the live catalog directly, so
 * "choose a model and get a reply" works before the directory client exists.
 *
 * Two readings in the table are deliberate and must not be "corrected":
 *
 * - `contextWindow` is the gateway's `context_budget` (usable input budget),
 *   NOT the nominal `context_limit` — the difference is the room the gateway
 *   reserves for the reply.
 * - `kimi-k2.7-code` advertises `maxTokens = 65536` even though its
 *   `output_budget` is 32000, because its medium/high thinking levels require
 *   `max_completion_tokens` to exceed the level's thinking budget (32768).
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
 * Output budget assumed for a model the snapshot does not know, matching the
 * gateway's own default when `metadata.output_budget` is absent (design §5.1).
 * Ticket 03 replaces it with whatever the live directory reports.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_768

const ALL_LEVELS: readonly ReasoningLevel[] = REASONING_LEVEL_ORDER

/** glm's gateway accepts only these three; minimal/medium/xhigh are folded. */
const GLM_LEVELS: readonly ReasoningLevel[] = ['low', 'high', 'max']

/** kimi has neither `off` nor `max`. */
const KIMI_LEVELS: readonly ReasoningLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

/** The 12-model snapshot, in the gateway's own id order. */
export const CATALOG_SNAPSHOT: readonly CatalogModelSnapshot[] = [
  {
    id: 'claude-haiku-5.5',
    name: 'Claude Haiku 5.5',
    contextWindow: 228_000,
    maxTokens: 128_000,
    cost: 'low',
    capability: 'standard',
    inputModalities: ['text', 'image', 'file'],
    reasoningLevels: ALL_LEVELS,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 232_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'standard',
    inputModalities: ['text'],
    reasoningLevels: ALL_LEVELS,
  },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision Exp',
    contextWindow: 232_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'standard',
    inputModalities: ['text', 'image'],
    reasoningLevels: ALL_LEVELS,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    contextWindow: 328_000,
    maxTokens: 128_000,
    cost: 'high',
    capability: 'advanced',
    inputModalities: ['text'],
    reasoningLevels: ALL_LEVELS,
  },
  {
    id: DEFAULT_MODEL_ID,
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 328_000,
    maxTokens: 128_000,
    cost: 'low',
    capability: 'advanced',
    inputModalities: ['text', 'image'],
    reasoningLevels: ALL_LEVELS,
    default: true,
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    contextWindow: 232_000,
    maxTokens: 32_000,
    cost: 'low',
    capability: 'advanced',
    inputModalities: ['text', 'image', 'video'],
    reasoningLevels: GLM_LEVELS,
  },
  {
    id: 'glm-5.3-flashx',
    name: 'GLM-5.3 Flash-X',
    contextWindow: 232_000,
    maxTokens: 32_000,
    cost: 'medium',
    capability: 'advanced',
    inputModalities: ['text', 'image', 'file', 'video'],
    reasoningLevels: GLM_LEVELS,
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    contextWindow: 400_000,
    maxTokens: 128_000,
    cost: 'low',
    capability: 'standard',
    inputModalities: ['text', 'image', 'file'],
    reasoningLevels: ALL_LEVELS,
  },
  {
    id: 'hy4-preview',
    name: 'Hunyuan H4 Preview',
    contextWindow: 232_000,
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
    contextWindow: 232_000,
    maxTokens: 32_000,
    cost: 'low',
    capability: 'standard',
    inputModalities: ['text', 'image', 'audio', 'video'],
    reasoningLevels: ALL_LEVELS,
  },
  {
    id: 'mimo-v2.6-pro',
    name: 'MiMo V2.6 Pro',
    contextWindow: 232_000,
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

/**
 * The picker's order (design §5.4): the default model first, then `advanced`
 * ahead of `standard`, cheaper ahead of dearer, and the id as the tie-break so
 * two loads never disagree.
 */
export function orderedCatalog(): readonly CatalogModelSnapshot[] {
  const costRank: Readonly<Record<ModelCostTier, number>> = { low: 0, medium: 1, high: 2 }
  return [...CATALOG_SNAPSHOT].sort((left, right) => {
    if (left.default === true || right.default === true) {
      return left.default === true ? -1 : 1
    }
    if (left.capability !== right.capability) return left.capability === 'advanced' ? -1 : 1
    const leftCost = costRank[left.cost]
    const rightCost = costRank[right.cost]
    if (leftCost !== rightCost) return leftCost - rightCost
    return left.id.localeCompare(right.id)
  })
}

/**
 * The modalities the harness vocabulary can declare for this model: it knows
 * `text` and `image` only, so `file`/`audio`/`video` are not advertised even
 * when the vendor lists them — the adapter refuses those attachments anyway.
 */
export function hostInputModalities(entry: CatalogModelSnapshot): readonly ('text' | 'image')[] {
  return entry.inputModalities.includes('image') ? ['text', 'image'] : ['text']
}

/** One-line picker subtitle: capability and cost tiers, then the usable window. */
export function describeCatalogModel(entry: CatalogModelSnapshot): string {
  return `${entry.capability} · ${entry.cost} cost · ${Math.round(entry.contextWindow / 1000)}K context`
}
