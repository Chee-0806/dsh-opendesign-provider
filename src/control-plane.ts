/**
 * 控制面额度只读客户端（ticket 10）。
 *
 * 模型面没有任何用量端点（实测 404），额度与限流窗口只存在于控制面。这里只发
 * 三个 **GET**，绝不写：当前工作区（拿 `activeWorkspaceId`）、账单摘要（档位、
 * 余额、`creditsPerUsd`、订阅周期）、按模型的额度预检（`codingPlan.windows[]`
 * 与 `funding`）。鉴权是 `Authorization: Bearer <controlKey>`，密钥只从
 * `~/.amr/config.json` 的 CLI 登录态读，绝不来自插件配置，也绝不出现在任何
 * 返回值、日志或错误文案里。
 *
 * 对外只暴露冻结的 {@link QuotaSnapshot}（spec §额度）。窗口按
 * `durationSeconds` 分类：18000 = 5 小时、604800 = 7 天，其余 `other` 原样列出。
 * `creditsPerUsd` 只用于把 credits 折算成展示当量，因此留在 Host 侧的
 * {@link QuotaReading} 里，不进快照形状。
 *
 * 降级：没有控制密钥（未登录 CLI / 登录态文件缺失或损坏）时快照的
 * `controlPlaneAvailable` 为 `false` 并给出原因；查询失败保留上一次成功的值并
 * 标注 `stale`。任何一条路径都不抛错——额度是增强，推理不依赖它。
 *
 * @module dsh-opendesign-provider/control-plane
 */

import {
  defaultAmrConfigPath,
  readCliLoginState,
  type CliLoginReading,
} from './credentials.ts'

/** 控制面基址（登录态没有带 `apiUrl` 时的兜底）。 */
export const DEFAULT_CONTROL_PLANE_API_URL = 'https://amr-api.open-design.ai'

/** 单次控制面请求的超时（spec §额度）。 */
export const CONTROL_PLANE_TIMEOUT_MS = 8_000

/** 额度缓存有效期：命令与 Remote 共用同一份（spec §额度）。 */
export const QUOTA_CACHE_TTL_MS = 60_000

/** 实测的 5 小时窗口时长。 */
export const QUOTA_FIVE_HOUR_SECONDS = 18_000

/** 实测的 7 天窗口时长。 */
export const QUOTA_SEVEN_DAY_SECONDS = 604_800

/** 冻结的窗口分类；未知时长归 `other` 并原样列出。 */
export type QuotaWindowKind = 'five_hour' | 'seven_day' | 'other'

/** 一个限额窗口，单位是 credits（不是美元）。 */
export interface QuotaWindow {
  kind: QuotaWindowKind
  durationSeconds: number
  usedCredits: number
  limitCredits: number
  remainingCredits: number
  resetsAt?: string
  resetMode?: string
}

/**
 * 冻结的额度快照（spec §额度）。`controlPlaneAvailable: false` 表示控制面不可用
 * （无控制密钥、未登录或查询失败），此时 `windows` 为空；其余字段都是可选事实，
 * 缺席即「控制面没给」，不用零值冒充。
 */
export interface QuotaSnapshot {
  controlPlaneAvailable: boolean
  tier?: string
  subscriptionStatus?: string
  currentPeriodEnd?: string
  balanceUsd?: number
  funding?: 'wallet' | 'coding_plan'
  windows: QuotaWindow[]
  fetchedAt: string
  stale?: boolean
}

/** 快照不可用的原因，只用于 Host 侧文案（不进冻结契约）。 */
export type QuotaUnavailableReason = 'no-control-key' | 'login-unavailable' | 'unreachable'

/** 一次读取：冻结快照 + 只用于展示折算的 `creditsPerUsd` + 降级原因。 */
export interface QuotaReading {
  snapshot: QuotaSnapshot
  creditsPerUsd?: number
  reason?: QuotaUnavailableReason
}

/** 客户端接缝：测试注入 fetch、时钟与登录态文件路径。 */
export interface ControlPlaneDeps {
  /**
   * CLI 登录态路径（或一个读当前配置的取值器，设置页改路径后立即生效）；
   * 默认 `~/.amr/config.json`。
   */
  loginPath?: string | (() => string | undefined)
  /** 登录态读取接缝；默认走 `node:fs/promises`。 */
  readFile?: (path: string) => Promise<string>
  /** fetch 接缝；默认 Node 原生 `fetch`（可过 Cloudflare）。 */
  fetchImpl?: typeof fetch
  /** 时钟接缝，返回毫秒时间戳。 */
  now?: () => number
  /** 覆盖超时；默认 {@link CONTROL_PLANE_TIMEOUT_MS}。 */
  timeoutMs?: number
  /** 覆盖缓存 TTL；默认 {@link QUOTA_CACHE_TTL_MS}。 */
  cacheTtlMs?: number
}

/** 一次 `read()` 的输入：预检要按模型问。 */
export interface QuotaRequest {
  /** 目录里的当前/默认模型；缺席时跳过预检，只报账单摘要。 */
  model?: string
  /** 跳过缓存强制刷新。 */
  force?: boolean
}

/** 窗口分类：只认实测的两个时长，其余一律 `other`。 */
export function classifyQuotaWindow(durationSeconds: number): QuotaWindowKind {
  if (durationSeconds === QUOTA_FIVE_HOUR_SECONDS) return 'five_hour'
  if (durationSeconds === QUOTA_SEVEN_DAY_SECONDS) return 'seven_day'
  return 'other'
}

/** 纯文本（可带前后空格）的数值字段：控制面把 credits 与美元都发成字符串。 */
function asNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text === '' ? undefined : text
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** 一页响应体，或读响应时的失败。 */
async function getJsonPage(
  fetchImpl: typeof fetch,
  url: string,
  controlKey: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${controlKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(Math.max(1, Math.trunc(timeoutMs))),
  })
  if (!response.ok) throw new Error(`control plane answered HTTP ${response.status}`)
  const parsed: unknown = JSON.parse(await response.text())
  const record = asRecord(parsed)
  if (record === undefined) throw new Error('control plane answered a non-object body')
  return record
}

/** 工作区响应：只要 active 工作区 id 与个人档位。 */
interface WorkspaceFacts {
  activeWorkspaceId?: string | undefined
  personalTier?: string | undefined
}

function readWorkspace(page: Record<string, unknown>): WorkspaceFacts {
  return {
    activeWorkspaceId: asText(page.activeWorkspaceId) ?? asText(page.workspaceId),
    personalTier: asText(page.personalMembershipTier),
  }
}

/** 账单摘要响应：档位、余额、creditsPerUsd、订阅状态与账期结束。 */
interface SummaryFacts {
  tier?: string | undefined
  balanceUsd?: number | undefined
  creditsPerUsd?: number | undefined
  subscriptionStatus?: string | undefined
  currentPeriodEnd?: string | undefined
}

function readSummary(page: Record<string, unknown>): SummaryFacts {
  return {
    tier: asText(page.membershipTier),
    balanceUsd: asNumber(page.balanceUsd),
    creditsPerUsd: asNumber(page.creditsPerUsd),
    subscriptionStatus: asText(page.subscriptionStatus),
    currentPeriodEnd: asText(page.subscriptionCurrentPeriodEnd),
  }
}

/** 预检响应：`codingPlan` 的资格、档位、窗口，以及 `funding` 口径。 */
interface PreflightFacts {
  eligible?: boolean | undefined
  tier?: string | undefined
  windows: QuotaWindow[]
  balanceUsd?: number | undefined
  funding?: 'wallet' | 'coding_plan' | undefined
}

function readPreflight(page: Record<string, unknown>): PreflightFacts {
  const plan = asRecord(page.codingPlan)
  const eligible = typeof plan?.eligible === 'boolean' ? plan.eligible : undefined
  const rawWindows = Array.isArray(plan?.windows) ? plan.windows as unknown[] : []
  const windows: QuotaWindow[] = []
  for (const raw of rawWindows) {
    const entry = asRecord(raw)
    const durationSeconds = asNumber(entry?.durationSeconds)
    if (entry === undefined || durationSeconds === undefined) continue
    const resetsAt = asText(entry.resetsAt)
    const resetMode = asText(entry.resetMode)
    windows.push({
      kind: classifyQuotaWindow(durationSeconds),
      durationSeconds,
      usedCredits: asNumber(entry.usedCredits) ?? 0,
      limitCredits: asNumber(entry.limitCredits) ?? 0,
      remainingCredits: asNumber(entry.remainingCredits) ?? 0,
      ...(resetsAt === undefined ? {} : { resetsAt }),
      ...(resetMode === undefined ? {} : { resetMode }),
    })
  }
  windows.sort((left, right) => left.durationSeconds - right.durationSeconds)
  const funding = page.funding === 'wallet' || page.funding === 'coding_plan' ? page.funding : undefined
  return {
    eligible,
    tier: asText(plan?.tier),
    windows,
    balanceUsd: asNumber(page.balanceUsd),
    // 预检明确说不合格时，钱只能来自钱包；合格但没给口径时保持未知，不猜。
    ...(funding !== undefined
      ? { funding }
      : eligible === false
        ? { funding: 'wallet' as const }
        : {}),
  }
}

/** 控制面基址去掉末尾斜杠；登录态没给时用默认域名。 */
function controlBase(apiUrl: string | undefined): string {
  const text = asText(apiUrl)?.replace(/\/+$/u, '') ?? ''
  return text === '' ? DEFAULT_CONTROL_PLANE_API_URL : text
}

/**
 * 只读额度客户端：一次 `read()` 依次问三个接口，解析成冻结快照。
 *
 * Host 侧 60 秒缓存，命令与 Remote 共用同一实例，因此两条展示面永远同一份数据。
 */
export class OpenDesignControlPlane {
  private readonly deps: ControlPlaneDeps
  private last?: QuotaReading
  private lastAttemptAt?: number

  constructor(deps: ControlPlaneDeps = {}) {
    this.deps = deps
  }

  /** 读一次额度：缓存命中直接返回，否则刷新；任何失败都降级而不抛错。 */
  async read(request: QuotaRequest = {}): Promise<QuotaReading> {
    const now = this.deps.now ?? Date.now
    const at = now()
    const ttl = this.deps.cacheTtlMs ?? QUOTA_CACHE_TTL_MS
    if (request.force !== true && this.last !== undefined && this.lastAttemptAt !== undefined
      && at - this.lastAttemptAt < ttl) {
      return this.last
    }

    const login = await this.login()
    const controlKey = login.state?.controlKey
    if (controlKey === undefined) {
      const reading: QuotaReading = {
        snapshot: {
          controlPlaneAvailable: false,
          windows: [],
          fetchedAt: new Date(at).toISOString(),
        },
        reason: login.state === undefined ? 'login-unavailable' : 'no-control-key',
      }
      // 无密钥不是「失败」，不受缓存 TTL 约束：用户补上登录态后立刻可见。
      this.last = reading
      return reading
    }

    try {
      const reading = await this.query(controlKey, controlBase(login.state?.apiUrl), request, at)
      this.last = reading
      this.lastAttemptAt = at
      return reading
    } catch {
      this.lastAttemptAt = at
      if (this.last !== undefined && this.last.snapshot.controlPlaneAvailable) {
        const stale: QuotaReading = {
          ...this.last,
          snapshot: { ...this.last.snapshot, stale: true },
        }
        this.last = stale
        return stale
      }
      const reading: QuotaReading = {
        snapshot: {
          controlPlaneAvailable: false,
          windows: [],
          fetchedAt: new Date(at).toISOString(),
        },
        reason: 'unreachable',
      }
      this.last = reading
      return reading
    }
  }

  /** 当前登录态（不缓存：文件很小，且用户随时可能 `vela login`）。 */
  private login(): Promise<CliLoginReading> {
    const configured = typeof this.deps.loginPath === 'function'
      ? this.deps.loginPath()
      : this.deps.loginPath
    const path = asText(configured) ?? defaultAmrConfigPath()
    return this.deps.readFile === undefined
      ? readCliLoginState(path)
      : readCliLoginState(path, this.deps.readFile)
  }

  /** 三个 GET 的串行真相：工作区 → 摘要 → 预检（预检需要工作区 id）。 */
  private async query(
    controlKey: string,
    base: string,
    request: QuotaRequest,
    at: number,
  ): Promise<QuotaReading> {
    const fetchImpl = this.deps.fetchImpl ?? fetch
    const timeoutMs = this.deps.timeoutMs ?? CONTROL_PLANE_TIMEOUT_MS

    const workspace = readWorkspace(
      await getJsonPage(fetchImpl, `${base}/api/v1/workspaces/current`, controlKey, timeoutMs),
    )
    const summary = readSummary(
      await getJsonPage(fetchImpl, `${base}/api/v1/billing/summary`, controlKey, timeoutMs),
    )
    const model = asText(request.model)
    const preflight = workspace.activeWorkspaceId === undefined || model === undefined
      ? undefined
      : readPreflight(await getJsonPage(
        fetchImpl,
        `${base}/api/v1/workspaces/${workspace.activeWorkspaceId}/billing/preflight?model=${encodeURIComponent(model)}`,
        controlKey,
        timeoutMs,
      ))

    const snapshot: QuotaSnapshot = {
      controlPlaneAvailable: true,
      windows: preflight?.windows ?? [],
      fetchedAt: new Date(at).toISOString(),
    }
    const tier = preflight?.tier ?? summary.tier ?? workspace.personalTier
    if (tier !== undefined) snapshot.tier = tier
    if (summary.subscriptionStatus !== undefined) snapshot.subscriptionStatus = summary.subscriptionStatus
    if (summary.currentPeriodEnd !== undefined) snapshot.currentPeriodEnd = summary.currentPeriodEnd
    const balance = summary.balanceUsd ?? preflight?.balanceUsd
    if (balance !== undefined) snapshot.balanceUsd = balance
    if (preflight?.funding !== undefined) snapshot.funding = preflight.funding
    return {
      snapshot,
      ...(summary.creditsPerUsd === undefined ? {} : { creditsPerUsd: summary.creditsPerUsd }),
    }
  }
}
