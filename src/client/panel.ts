/**
 * 额度面板控制器（ticket 11）：React-free 的事实与刷新策略。
 *
 * 面板默认关闭（`Config.showSidebarQuota`，默认 false）。开关打开、且 CLI 登录态
 * 里确实有 controlKey 时，构造与开关变化各触发一次读取；此后按 5 分钟节流，
 * 打开仪表盘与手动刷新共用同一条路径。开关关闭时**既不渲染也不发起任何读取**，
 * 已在途的结果直接丢弃——额度是增强功能，隐藏状态不能留下后台轮询。
 *
 * 读取失败保留上一次成功的快照并标成 `stale`（面板显示「已过期」），绝不把旧
 * 数字冒充实时。数据来源是 `opendesign/usage` Remote，与 `/opendesign` 命令共用
 * Host 侧 60 秒缓存，因此两条展示面同一份读数。
 *
 * 中间栏的打开/关闭通过注入的 `selectPanel` 完成（`main` 是 keyed 插槽，`null`
 * 表示回到会话）；面板自己从不直接摸 `ctx.layout`。
 *
 * @module dsh-opendesign-provider/client/panel
 */

import type { QuotaSnapshot } from '../control-plane.ts'
import { PANEL_ID } from '../identity.ts'
import type { PanelLocaleId } from './panel-locales.ts'
import { createSnapshotStore, type SnapshotStore } from './snapshot-store.ts'

/** 面板读到的设置事实：开关的已存值（不是草稿）与登录态。 */
export interface QuotaPanelSettingsFacts {
  showSidebarQuota: boolean
  hasControlKey: boolean
  loginStatus: string
}

/** 设置事实的来源（设置页控制器共享同一份状态）。 */
export interface QuotaPanelSettingsSource {
  getSnapshot(): QuotaPanelSettingsFacts
  subscribe(listener: () => void): () => void
}

/** 一次 `opendesign/usage` 调用的返回信封。 */
export interface QuotaPanelLoadResult {
  ok: boolean
  value?: QuotaSnapshot | undefined
  error?: { message?: string } | undefined
}

/** 面板依赖，全部由插件入口注入；测试给假实现。 */
export interface QuotaPanelDeps {
  /** 读一次额度快照；Host 侧 60 秒缓存由 Remote 负责。 */
  load: () => Promise<QuotaPanelLoadResult>
  /** 设置事实（开关已存值与 controlKey 状态）。 */
  settings: QuotaPanelSettingsSource
  /** 时钟接缝，返回毫秒时间戳。 */
  now?: (() => number) | undefined
  /** 刷新节流间隔；默认 {@link QUOTA_PANEL_REFRESH_MS}。 */
  refreshIntervalMs?: number | undefined
  /** 选择中间栏面板；`null` 回到会话。 */
  selectPanel?: ((panelId: string | null) => void) | undefined
}

/** 面板的完整渲染事实。 */
export interface QuotaPanelState {
  /** 开关的**已存**值（不是设置页草稿）。 */
  showSidebarQuota: boolean
  hasControlKey: boolean
  /** CLI 登录态是否已被读到（未知不等于没有）。 */
  controlKeyKnown: boolean
  open: boolean
  loading: boolean
  failed: boolean
  snapshot?: QuotaSnapshot | undefined
  /** 最近一次成功读取的毫秒时间戳。 */
  lastSuccessAt?: number | undefined
}

/** 刷新节流：同一份读数 5 分钟内不重复查询（手动刷新可穿透）。 */
export const QUOTA_PANEL_REFRESH_MS = 5 * 60_000

/** 两个面板坐席注入的业务面（React 组件只依赖这些，不碰 Cordis）。 */
export interface QuotaPanelInjected {
  panelStore: Pick<SnapshotStore<QuotaPanelState>, 'getSnapshot' | 'subscribe'>
  panelState(): QuotaPanelState
  panelOpen(): void
  panelClose(): void
  panelRefresh(): void
  /** 当前界面语言：只用于日期格式（文案走注入的 `t`）。 */
  panelLocale(): PanelLocaleId
}

/** 设置事实到面板事实的投影。 */
function factsState(facts: QuotaPanelSettingsFacts): Pick<QuotaPanelState, 'showSidebarQuota' | 'hasControlKey' | 'controlKeyKnown'> {
  return {
    showSidebarQuota: facts.showSidebarQuota === true,
    hasControlKey: facts.hasControlKey === true,
    // 登录态还没读到时不能把「未知」当成「没有控制密钥」。
    controlKeyKnown: facts.loginStatus !== 'unknown',
  }
}

/**
 * 一个额度面板控制器。构造即开始跟随设置事实；`dispose()` 停止订阅，此后不再
 * 读取也不再发布。
 */
export class OpenDesignQuotaPanelController {
  private readonly store: SnapshotStore<QuotaPanelState>
  private readonly deps: QuotaPanelDeps
  private readonly now: () => number
  private readonly refreshIntervalMs: number
  private readonly unsubscribe: () => void
  private lastAttemptAt: number | undefined
  private inFlight: Promise<void> | undefined
  private disposed = false

  constructor(deps: QuotaPanelDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.refreshIntervalMs = deps.refreshIntervalMs ?? QUOTA_PANEL_REFRESH_MS
    const initial = factsState(deps.settings.getSnapshot())
    this.store = createSnapshotStore<QuotaPanelState>({
      ...initial,
      open: false,
      loading: false,
      failed: false,
    })
    this.unsubscribe = deps.settings.subscribe(() => { this.syncSettings() })
    if (this.enabled()) void this.refresh()
  }

  /** 当前渲染事实。 */
  state(): QuotaPanelState {
    return this.store.getSnapshot()
  }

  /** 订阅渲染事实变化。 */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /** 打开中间栏仪表盘：选中本面板并按节流刷新一次。 */
  openPanel(): void {
    if (this.disposed || !this.enabled()) return
    this.publish({ ...this.state(), open: true })
    this.deps.selectPanel?.(PANEL_ID)
    void this.refresh()
  }

  /** 关闭仪表盘并回到会话。 */
  closePanel(): void {
    if (this.disposed) return
    if (!this.state().open) return
    this.publish({ ...this.state(), open: false })
    this.deps.selectPanel?.(null)
  }

  /**
   * 读一次额度。默认受 5 分钟节流约束；`force` 是用户点「刷新」的路径。
   * 关闭状态、已销毁或已有一次读取在途时直接返回。
   */
  async refresh(force = false): Promise<void> {
    if (this.disposed || !this.enabled()) return
    if (this.inFlight !== undefined) return
    const at = this.now()
    if (!force && this.lastAttemptAt !== undefined && at - this.lastAttemptAt < this.refreshIntervalMs) return
    this.lastAttemptAt = at
    const run = this.load()
    this.inFlight = run
    try {
      await run
    } finally {
      if (this.inFlight === run) this.inFlight = undefined
    }
  }

  /** 停止设置订阅；在途读取的结果不再发布。 */
  dispose(): void {
    this.disposed = true
    this.unsubscribe()
  }

  /** 一次实际读取与结果折叠。 */
  private async load(): Promise<void> {
    this.publish({ ...this.state(), loading: true })
    let next: QuotaPanelState
    try {
      const result = await this.deps.load()
      if (this.disposed || !this.enabled()) return
      if (result.ok && result.value !== undefined) {
        next = {
          ...this.state(),
          loading: false,
          failed: false,
          snapshot: result.value,
          lastSuccessAt: this.now(),
        }
      } else {
        next = this.failedState()
      }
    } catch {
      if (this.disposed || !this.enabled()) return
      next = this.failedState()
    }
    this.publish(next)
  }

  /** 失败时的状态：保留旧读数并标成过期，绝不把失败当零额度。 */
  private failedState(): QuotaPanelState {
    const state = this.state()
    return {
      ...state,
      loading: false,
      failed: true,
      ...(state.snapshot === undefined
        ? {}
        : { snapshot: { ...state.snapshot, stale: true } }),
    }
  }

  /** 设置事实变化：开关打开就拉一次，关闭就收起面板并停止读取。 */
  private syncSettings(): void {
    if (this.disposed) return
    const wasEnabled = this.enabled()
    const state = this.state()
    const facts = factsState(this.deps.settings.getSnapshot())
    // 只在本面板关心的事实变化时发布：设置页每敲一个字段都会广播，面板没必要跟着重渲染。
    if (facts.showSidebarQuota !== state.showSidebarQuota
      || facts.hasControlKey !== state.hasControlKey
      || facts.controlKeyKnown !== state.controlKeyKnown) {
      this.publish({ ...state, ...facts })
    }
    const enabled = this.enabled()
    if (enabled && !wasEnabled) {
      void this.refresh()
      return
    }
    if (!enabled && wasEnabled) {
      // 开关被关掉：面板与中间栏一起收起，此后不再有任何读取。
      if (state.open) this.deps.selectPanel?.(null)
      this.publish({ ...this.state(), open: false })
    }
  }

  /** 开关打开且控制密钥可用（登录态未知时先按可用处理，读一次才能给原因）。 */
  private enabled(): boolean {
    const state = this.state()
    return state.showSidebarQuota && !(state.controlKeyKnown && !state.hasControlKey)
  }

  private publish(state: QuotaPanelState): void {
    if (this.disposed) return
    this.store.set(state)
  }
}
