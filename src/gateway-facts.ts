/**
 * 网关实时目录（ticket 03）—— 以 `GET {apiBase}/models` 为准，静态快照兜底。
 *
 * 目录是「网关事实」（GLOSSARY 第六节）：同一把 Key 能看到的模型由网关按 Key
 * 裁剪，所以列表数量可能多于或少于内置的 12 条；只有网关不可达、鉴权失败或
 * 响应形状不合法时，才整体回落到 {@link CATALOG_SNAPSHOT} 并标记来源为
 * `static`。字段映射按设计件 §5.1：
 *
 * - 上下文窗口 = `metadata.context_budget`，缺省 `context_limit`，再缺省 128000；
 * - 输出上限 = `metadata.output_budget`（缺省 32768）；kimi 仍按实测抬到 65536，
 *   否则 medium/high 档的思考预算会把输出额度吃掉；
 * - 档位 = `metadata.cost` / `metadata.capability`；
 * - 模态 = `architecture.input_modalities`，但选择器只按快照已知能力宣告，
 *   快照外的新模型按「无图片能力 + 全档思考域 + 未校准」保守处理。
 *
 * 缓存文件含 `apiBase` 与版本号：换网关后旧缓存不得复用。成功缓存 TTL 5 分钟；
 * 失败后 10 秒内不再重试，避免断网时每次打开选择器都卡在超时上。
 *
 * 本模块只被 Host 半侧引用（读取文件系统），浏览器 bundle 不得导入。
 *
 * @module dsh-opendesign-provider/gateway-facts
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { LlmError } from '@deepseek-ai/dsh-llm'

import {
  CATALOG_SNAPSHOT,
  DEFAULT_MAX_OUTPUT_TOKENS,
  REASONING_LEVEL_ORDER,
  compareCatalogEntries,
  describeCatalogModel,
  findCatalogModel,
  type CatalogInputModality,
  type CatalogModelSnapshot,
  type ModelCapabilityTier,
  type ModelCostTier,
  type ReasoningLevel,
} from './catalog-snapshot.ts'
import { thinkingVisibleInChat } from './quirks.ts'

/** 目录缓存文件的形状版本；字段或语义变更时递增，旧缓存自然失效。 */
export const CATALOG_CACHE_VERSION = 1

/** 成功目录缓存的有效期（5 分钟，设计件 §5.1）。 */
export const CATALOG_TTL_MS = 5 * 60_000

/** 失败后到下一次重试的等待窗口（10 秒，设计件 §5.1）。 */
export const CATALOG_RETRY_TTL_MS = 10_000

/** 取目录的默认超时；目录是选择器的前置步骤，不该等满一次对话的时限。 */
export const DEFAULT_CATALOG_TIMEOUT_MS = 10_000

/** 网关与缓存都没给出上下文预算时的保守窗口（设计件 §5.1）。 */
export const DEFAULT_CONTEXT_WINDOW = 128_000

/** kimi 的思考档需要比 `output_budget` 更大的上限（设计件 §5.1）。 */
const KIMI_MODEL_ID = 'kimi-k2.7-code'
const KIMI_MIN_OUTPUT_TOKENS = 65_536

/** 目录当前来源：网关实时公布，或内置静态快照。 */
export type GatewayCatalogSourceKind = 'live' | 'static'

/** 回落到静态快照的原因；作为数据交给设置页，不写进对话错误。 */
export type GatewayCatalogFailureReason =
  | 'auth'
  | 'unreachable'
  | 'protocol'
  | 'http'
  | 'missing-credential'

/** 网关公布的一条模型，已从线上 snake_case 归一。 */
export interface GatewayModelFacts {
  readonly id: string
  readonly enabled: boolean
  readonly default: boolean
  readonly contextLimit?: number | undefined
  readonly contextBudget?: number | undefined
  readonly outputBudget?: number | undefined
  readonly cost?: ModelCostTier | undefined
  readonly capability?: ModelCapabilityTier | undefined
  readonly inputModalities: readonly CatalogInputModality[]
}

/** 合并后的一条目录条目：选择器、模型卡与设置页共用。 */
export interface GatewayCatalogEntry {
  readonly id: string
  readonly name: string
  readonly contextWindow: number
  readonly maxTokens: number
  readonly cost: ModelCostTier
  readonly capability: ModelCapabilityTier
  readonly inputModalities: readonly CatalogInputModality[]
  readonly reasoningLevels: readonly ReasoningLevel[]
  readonly default: boolean
  /** 静态快照认识这个 id（显示名与思考域可信）；否则为 `false`（未校准）。 */
  readonly calibrated: boolean
}

/** 目录状态：来源、绑定地址、条目与回落原因，供设置页/模型卡读取。 */
export interface GatewayCatalogStatus {
  readonly source: GatewayCatalogSourceKind
  /** 本次目录绑定的网关地址（已去掉尾部斜杠）。 */
  readonly apiBase: string
  readonly models: readonly GatewayCatalogEntry[]
  /** 本次是否直接来自磁盘缓存（没有发起网络请求）。 */
  readonly cached: boolean
  /** 最近一次成功拉取的时间（epoch ms）；静态快照没有该字段。 */
  readonly fetchedAt?: number | undefined
  /** 回落到静态快照的原因；`source === 'live'` 时不存在。 */
  readonly reason?: GatewayCatalogFailureReason | undefined
}

/** 网关响应解析后的两个视图：原始 `data`（写缓存）与归一事实（合并）。 */
export interface ParsedGatewayCatalog {
  readonly data: readonly unknown[]
  readonly models: readonly GatewayModelFacts[]
}

/** 一次目录请求的全部输入。 */
export interface GatewayCatalogRequest {
  readonly apiBase: string
  readonly apiKey: string
  readonly fetchImpl?: typeof fetch | undefined
  readonly timeoutMs?: number | undefined
}

/** 目录来源需要的宿主接缝；测试注入 `fetchImpl` 与时钟。 */
export interface GatewayCatalogSourceDeps {
  readonly fetchImpl?: typeof fetch | undefined
  readonly now?: (() => number) | undefined
  readonly timeoutMs?: number | undefined
}

/** 目录绑定所需的连接事实；与适配器连接选项的结构兼容。 */
export interface GatewayCatalogConnection {
  readonly apiBase: string
  readonly modelsCachePath: string
}

/** 磁盘缓存文档；与网关响应同构，读回时复用同一个严格解析器。 */
interface CatalogCacheDocument {
  readonly version: number
  readonly apiBase: string
  readonly fetchedAt: number
  readonly data: readonly unknown[]
}

/** 一次成功加载留在内存里的目录。 */
interface LoadedCatalog {
  readonly apiBase: string
  readonly source: GatewayCatalogSourceKind
  readonly loadedAt: number
  readonly models: readonly GatewayCatalogEntry[]
  readonly cached: boolean
  readonly fetchedAt?: number | undefined
  readonly reason?: GatewayCatalogFailureReason | undefined
}

/**
 * 严格解析 `GET /models` 的响应体：`{object:'list', data:[…]}`。
 *
 * 形状不合法一律抛 `PROTOCOL_ERROR`，由目录来源捕获后回落静态快照——坏目录
 * 不能变成「0 个模型」的空选择器，也不能让选择器崩掉。
 */
export function parseGatewayCatalog(payload: unknown): ParsedGatewayCatalog {
  if (!isRecord(payload)) throw protocolError('响应体不是 JSON 对象')
  if (payload.object !== 'list') throw protocolError('缺少顶层 object:"list"')
  if (!Array.isArray(payload.data)) throw protocolError('缺少 data 数组')
  const models = payload.data.map((item, index) => parseGatewayModel(item, index))
  return { data: payload.data, models }
}

/** 拉取并解析一次实时目录；网络、HTTP 与解析失败都抛 {@link LlmError}。 */
export async function fetchGatewayCatalog(request: GatewayCatalogRequest): Promise<ParsedGatewayCatalog> {
  const fetchImpl = request.fetchImpl ?? fetch
  const url = `${normalizeApiBase(request.apiBase)}/models`
  let response: Response
  let raw: string
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${request.apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(Math.max(1, Math.trunc(request.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS))),
    })
    raw = await response.text()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new LlmError(`Open Design 目录暂时不可达：${reason}`, 'TRANSPORT', { cause: error })
  }
  if (!response.ok) throw catalogHttpFailure(response.status)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw protocolError('响应体不是合法 JSON')
  }
  return parseGatewayCatalog(parsed)
}

/**
 * 把网关条目合并成选择器条目：网关决定「有哪些模型」，快照补「这个模型是什么」。
 *
 * 已知 id 用快照的显示名、思考档与模态；快照外的新模型标题化显示名、给全档
 * 思考域、不给图片能力，并标记「未校准」。网关的 `enabled:false` 条目不进
 * 选择器（按 Key 裁剪的一部分）。
 */
export function mergeGatewayCatalog(facts: readonly GatewayModelFacts[]): readonly GatewayCatalogEntry[] {
  const merged: GatewayCatalogEntry[] = []
  for (const fact of facts) {
    if (!fact.enabled) continue
    const known = findCatalogModel(fact.id)
    merged.push({
      id: fact.id,
      name: known?.name ?? titleizeModelId(fact.id),
      contextWindow: fact.contextBudget ?? fact.contextLimit
        ?? known?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: mergedMaxTokens(fact, known),
      cost: fact.cost ?? known?.cost ?? 'medium',
      capability: fact.capability ?? known?.capability ?? 'standard',
      // 快照外的模型不宣告图片能力：没有实测过它是否真的接受图片。
      inputModalities: known?.inputModalities ?? ['text'],
      reasoningLevels: known?.reasoningLevels ?? REASONING_LEVEL_ORDER,
      default: fact.default,
      calibrated: known !== undefined,
    })
  }
  return merged.sort(compareCatalogEntries)
}

/** 内置 12 模型快照，按选择器顺序；网关不可达时的全量回退。 */
export function staticGatewayCatalog(): readonly GatewayCatalogEntry[] {
  return [...CATALOG_SNAPSHOT].map(snapshotEntry).sort(compareCatalogEntries)
}

/** 按 id 取静态快照条目；会话历史里的旧模型仍能解析出自己的能力。 */
export function staticGatewayCatalogEntry(id: string): GatewayCatalogEntry | undefined {
  const snapshot = findCatalogModel(id)
  return snapshot === undefined ? undefined : snapshotEntry(snapshot)
}

/**
 * 选择器副标题：档位、成本与可用窗口；未校准与思考不可见的模型明确标注。
 *
 * 「思考不可见」是逐模型兼容事实（`quirks.ts`），不是 UI 新字段：标注跟着描述
 * 一起走，模型卡与选择器都能看到同一句话。
 */
export function describeGatewayCatalogEntry(entry: GatewayCatalogEntry): string {
  const base = describeCatalogModel(entry)
  const described = entry.calibrated ? base : `${base} · 未校准`
  return thinkingVisibleInChat(entry.id) ? described : `${described} · 思考不可见`
}

/**
 * 目录来源：持有一次进程内的目录状态，缓存与 TTL 都绑定 `apiBase`。
 *
 * 加载永远不抛错：目录是选择器的可选增强，网关故障只该降级为静态快照。
 */
export class GatewayCatalogSource {
  private readonly fetchImpl: typeof fetch | undefined
  private readonly now: () => number
  private readonly timeoutMs: number | undefined
  private loaded: LoadedCatalog | undefined
  private inFlight: { readonly apiBase: string; readonly promise: Promise<GatewayCatalogStatus> } | undefined

  constructor(deps: GatewayCatalogSourceDeps = {}) {
    this.fetchImpl = deps.fetchImpl
    this.now = deps.now ?? Date.now
    this.timeoutMs = deps.timeoutMs
  }

  /**
   * 取当前目录：内存命中 → 磁盘缓存命中 → 请求网关；任何失败都回落到静态
   * 快照并记录原因。`apiKey` 是惰性解析的，未配置 Key 时也能列出静态模型。
   */
  async load(connection: GatewayCatalogConnection, apiKey: () => Promise<string>): Promise<GatewayCatalogStatus> {
    const apiBase = normalizeApiBase(connection.apiBase)
    const now = this.now()
    if (this.loaded !== undefined && this.loaded.apiBase === apiBase && this.isFresh(this.loaded, now)) {
      return statusOf(this.loaded)
    }

    const cached = await readCatalogCache(connection.modelsCachePath, apiBase, now)
    if (cached !== undefined) {
      // `loadedAt` is the fetch time, not the read time: the 5-minute TTL is
      // measured from when the gateway answered, so a cache read cannot extend
      // how long a directory stays trusted.
      this.loaded = {
        apiBase,
        source: 'live',
        loadedAt: cached.fetchedAt,
        models: cached.models,
        cached: true,
        fetchedAt: cached.fetchedAt,
      }
      return statusOf(this.loaded)
    }

    if (this.inFlight !== undefined && this.inFlight.apiBase === apiBase) return this.inFlight.promise
    const promise = this.refresh(apiBase, connection.modelsCachePath, apiKey)
      .finally(() => {
        if (this.inFlight?.promise === promise) this.inFlight = undefined
      })
    this.inFlight = { apiBase, promise }
    return promise
  }

  /** 同步读当前目录；从不发起网络请求（对话路径不等待目录刷新）。 */
  current(connection: GatewayCatalogConnection): GatewayCatalogStatus {
    const apiBase = normalizeApiBase(connection.apiBase)
    if (this.loaded !== undefined && this.loaded.apiBase === apiBase) return statusOf(this.loaded)
    return { apiBase, source: 'static', models: staticGatewayCatalog(), cached: false }
  }

  private async refresh(
    apiBase: string,
    modelsCachePath: string,
    apiKey: () => Promise<string>,
  ): Promise<GatewayCatalogStatus> {
    try {
      const key = await apiKey()
      const parsed = await fetchGatewayCatalog({
        apiBase,
        apiKey: key,
        ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }),
        ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      })
      const fetchedAt = this.now()
      await writeCatalogCache(modelsCachePath, { version: CATALOG_CACHE_VERSION, apiBase, fetchedAt, data: parsed.data })
      this.loaded = {
        apiBase,
        source: 'live',
        loadedAt: fetchedAt,
        models: mergeGatewayCatalog(parsed.models),
        cached: false,
        fetchedAt,
      }
    } catch (error) {
      this.loaded = {
        apiBase,
        source: 'static',
        loadedAt: this.now(),
        models: staticGatewayCatalog(),
        cached: false,
        reason: failureReasonOf(error),
      }
    }
    return statusOf(this.loaded)
  }

  private isFresh(loaded: LoadedCatalog, now: number): boolean {
    const ttl = loaded.source === 'live' ? CATALOG_TTL_MS : CATALOG_RETRY_TTL_MS
    return now - loaded.loadedAt < ttl
  }
}

/** 目录请求共用的地址归一：去掉尾部斜杠，端点拼接才唯一。 */
export function normalizeApiBase(apiBase: string): string {
  return (apiBase || '').replace(/\/+$/u, '')
}

/** 一次解析失败：稳定报 `PROTOCOL_ERROR`，附上具体缺了哪一块。 */
function protocolError(detail: string): LlmError {
  return new LlmError(
    `Open Design 返回的模型目录形状不合法（${detail}），已改用内置静态快照。`,
    'PROTOCOL_ERROR',
  )
}

/** 非 2xx 的目录请求：仍按 401/5xx/其余分类，供来源标记原因。 */
function catalogHttpFailure(status: number): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError(
      `Open Design 拒绝了这把 API Key（${status}），模型目录改用内置静态快照。`,
      'AUTH',
      { status },
    )
  }
  if (status >= 500) {
    return new LlmError(`Open Design 网关暂时不可用（HTTP ${status}），模型目录改用内置静态快照。`, 'SERVER', { status })
  }
  return new LlmError(`Open Design 拒绝了目录请求（HTTP ${status}），模型目录改用内置静态快照。`, 'INVALID_REQUEST', { status })
}

/** 把失败原因收敛成设置页可读的一档，不把上游正文带进 UI。 */
function failureReasonOf(error: unknown): GatewayCatalogFailureReason {
  if (!(error instanceof LlmError)) return 'unreachable'
  switch (error.code) {
    case 'AUTH':
      return 'auth'
    case 'PROTOCOL_ERROR':
      return 'protocol'
    case 'MISSING_CREDENTIAL':
      return 'missing-credential'
    case 'SERVER':
    case 'INVALID_REQUEST':
    case 'RATE_LIMIT':
    case 'QUOTA_EXHAUSTED':
      return 'http'
    default:
      return 'unreachable'
  }
}

/** 一条网关模型：缺省 `enabled:true`、`default:false`；多余字段忽略。 */
function parseGatewayModel(item: unknown, index: number): GatewayModelFacts {
  if (!isRecord(item)) throw protocolError(`data[${index}] 不是对象`)
  const id = item.id
  if (typeof id !== 'string' || id === '') throw protocolError(`data[${index}].id 不是非空字符串`)
  const enabled = readBoolean(item.enabled, true, `data[${index}].enabled`)
  const isDefault = readBoolean(item.default, false, `data[${index}].default`)
  const metadata = optionalRecord(item.metadata, `data[${index}].metadata`)
  const architecture = optionalRecord(item.architecture, `data[${index}].architecture`)
  return {
    id,
    enabled,
    default: isDefault,
    contextLimit: optionalTokenCount(metadata?.context_limit, `data[${index}].metadata.context_limit`),
    contextBudget: optionalTokenCount(metadata?.context_budget, `data[${index}].metadata.context_budget`),
    outputBudget: optionalTokenCount(metadata?.output_budget, `data[${index}].metadata.output_budget`),
    cost: optionalCost(metadata?.cost, `data[${index}].metadata.cost`),
    capability: optionalCapability(metadata?.capability, `data[${index}].metadata.capability`),
    inputModalities: readInputModalities(architecture?.input_modalities, `data[${index}].architecture.input_modalities`),
  }
}

/**
 * 快照外 id 的显示名：按 `-` / `_` / `/` 切词并首字母大写
 * （`brand-new-model` → `Brand New Model`）。取自网关的 id 只做展示，不改写。
 */
function titleizeModelId(id: string): string {
  return id
    .split(/[-_/]+/u)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || id
}

/** 输出上限：网关值优先，kimi 额外保证 65536。 */
function mergedMaxTokens(fact: GatewayModelFacts, known: CatalogModelSnapshot | undefined): number {
  if (fact.id === KIMI_MODEL_ID) {
    return Math.max(fact.outputBudget ?? DEFAULT_MAX_OUTPUT_TOKENS, known?.maxTokens ?? KIMI_MIN_OUTPUT_TOKENS)
  }
  return fact.outputBudget ?? known?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
}

/** 静态快照的一条，补齐成与网关条目相同的形状。 */
function snapshotEntry(snapshot: CatalogModelSnapshot): GatewayCatalogEntry {
  return {
    id: snapshot.id,
    name: snapshot.name,
    contextWindow: snapshot.contextWindow,
    maxTokens: snapshot.maxTokens,
    cost: snapshot.cost,
    capability: snapshot.capability,
    inputModalities: snapshot.inputModalities,
    reasoningLevels: snapshot.reasoningLevels,
    default: snapshot.default === true,
    calibrated: true,
  }
}

/** 内存目录转对外状态；不泄漏内部持有。 */
function statusOf(loaded: LoadedCatalog): GatewayCatalogStatus {
  return {
    apiBase: loaded.apiBase,
    source: loaded.source,
    models: loaded.models,
    cached: loaded.cached,
    ...(loaded.fetchedAt === undefined ? {} : { fetchedAt: loaded.fetchedAt }),
    ...(loaded.reason === undefined ? {} : { reason: loaded.reason }),
  }
}

/** 读缓存：版本、网关地址、TTL 与形状全部通过才算命中。 */
async function readCatalogCache(
  path: string,
  apiBase: string,
  now: number,
): Promise<{ readonly fetchedAt: number; readonly models: readonly GatewayCatalogEntry[] } | undefined> {
  try {
    const raw = await readFile(path, 'utf8')
    const document: unknown = JSON.parse(raw)
    if (!isRecord(document)) return undefined
    if (document.version !== CATALOG_CACHE_VERSION) return undefined
    if (document.apiBase !== apiBase) return undefined
    const fetchedAt = document.fetchedAt
    if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return undefined
    if (now - fetchedAt >= CATALOG_TTL_MS) return undefined
    const parsed = parseGatewayCatalog({ object: 'list', data: document.data })
    return { fetchedAt, models: mergeGatewayCatalog(parsed.models) }
  } catch {
    // 缓存缺失、不可读或损坏都只是未命中；真正的目录仍可走网络。
    return undefined
  }
}

/** 写缓存：目录不存在就建；写失败只丢缓存，不影响本次目录使用。 */
async function writeCatalogCache(path: string, document: CatalogCacheDocument): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(document), 'utf8')
  } catch {
    // best-effort：写不进缓存不是本次请求的失败。
  }
}

/** 可选布尔字段；存在但不是布尔即协议错误。 */
function readBoolean(value: unknown, fallback: boolean, path: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw protocolError(`${path} 不是布尔值`)
  return value
}

/** 可选对象字段；存在但不是对象即协议错误。 */
function optionalRecord(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw protocolError(`${path} 不是对象`)
  return value
}

/** 可选 token 预算：正安全整数；存在但越界即协议错误。 */
function optionalTokenCount(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw protocolError(`${path} 不是正整数 token 数`)
  }
  return value
}

/** 可选成本档；存在但不在 low/medium/high 即协议错误。 */
function optionalCost(value: unknown, path: string): ModelCostTier | undefined {
  if (value === undefined) return undefined
  if (value === 'low' || value === 'medium' || value === 'high') return value
  throw protocolError(`${path} 不是 low/medium/high`)
}

/** 可选能力档；存在但不在 standard/advanced 即协议错误。 */
function optionalCapability(value: unknown, path: string): ModelCapabilityTier | undefined {
  if (value === undefined) return undefined
  if (value === 'standard' || value === 'advanced') return value
  throw protocolError(`${path} 不是 standard/advanced`)
}

/** 模态数组：只留宿主认识的五个词；未知的新模态忽略而不是判坏。 */
function readInputModalities(value: unknown, path: string): readonly CatalogInputModality[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw protocolError(`${path} 不是数组`)
  const known: readonly CatalogInputModality[] = ['text', 'image', 'file', 'audio', 'video']
  const modalities: CatalogInputModality[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') throw protocolError(`${path} 含非字符串元素`)
    const match = known.find((modality) => modality === entry)
    if (match !== undefined && !modalities.includes(match)) modalities.push(match)
  }
  return modalities
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
