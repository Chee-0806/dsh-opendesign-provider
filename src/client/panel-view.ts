/**
 * 额度面板的 view model（ticket 11）：把冻结的 `QuotaSnapshot` 变成侧栏卡与
 * 中间栏仪表盘要显示的每一个数字和句子。React-free，所以测试直接断言「用户看到
 * 什么」——档位、两窗口的已用/上限/百分比、重置时间、余额、计费口径、过期标注
 * 与两种降级——不需要渲染组件。
 *
 * 三条口径在这里收口：
 * 1. **渲染门禁**：开关关闭、没有控制密钥、或控制面不可用时不渲染侧栏卡；前两者
 *    还会给出原因（额度是增强功能，隐藏不等于失败）。
 * 2. **窗口**：5 小时窗口只有 Go 档显示；7 天窗口与未知时长窗口原样列出。百分比
 *    按 `used / limit` 取整并夹到 0–100，上限缺失（limit ≤ 0）显示破折号，不能
 *    除以零，也不能把「未知」画成「用满」。
 * 3. **金额**：钱包余额是控制面给的真实美元数字；credits 只作额度计量，不折算
 *    单价、不出现「峰谷/套餐过滤」这类已删概念。
 *
 * @module dsh-opendesign-provider/client/panel-view
 */

import type { QuotaSnapshot, QuotaWindow, QuotaWindowKind } from '../control-plane.ts'
import type { PanelLocaleId, PanelTranslate } from './panel-locales.ts'

/** 一个额度窗口在界面上的全部读数。 */
export interface QuotaWindowView {
  kind: QuotaWindowKind
  /** `5 小时窗口` / `7 天窗口` / `{duration} 秒窗口`。 */
  label: string
  used: number
  limit: number
  /** 已用占比，0–100 的整数；上限缺失时为 0。 */
  percent: number
  /** 剩余占比，`100 - percent`；上限缺失时为 0。 */
  remainingPercent: number
  percentText: string
  remainingText: string
  amountText: string
  resetText: string
  /** 已用超过上限（或上限缺失但有用量）。 */
  overLimit: boolean
}

/** 侧栏卡与仪表盘共用的投影。 */
export interface QuotaPanelView {
  /** 只有在开关打开、控制密钥可用且控制面可用时才渲染。 */
  visible: boolean
  /** 不渲染时给设置页/诊断看的原因；开关关闭或缺数据时为空。 */
  reasonText: string | undefined
  tierText: string | undefined
  statusText: string | undefined
  periodText: string | undefined
  balanceText: string | undefined
  fundingText: string | undefined
  /** 计费口径说明，仪表盘常驻。 */
  explainerText: string
  windows: QuotaWindowView[]
  /** 没有窗口时的说明（钱包计费与「控制面没给」分开）。 */
  emptyText: string | undefined
  staleText: string | undefined
  fetchedText: string | undefined
  loadFailedText: string | undefined
  loading: boolean
}

/** view model 的输入：控制器的原始事实 + 取词函数。 */
export interface QuotaPanelViewInput {
  showSidebarQuota: boolean
  hasControlKey: boolean
  controlKeyKnown: boolean
  loading: boolean
  failed: boolean
  snapshot?: QuotaSnapshot | undefined
  t: PanelTranslate
  /** 界面语言：只用于日期的月份名与顺序，文案仍走 `t`。 */
  locale: PanelLocaleId
  /** 测试固定用；浏览器不传，按本地时区格式化。 */
  timeZone?: string | undefined
}

/** 已知档位按官方写法显示；未知档位原样显示，不猜。 */
const TIER_LABELS: Readonly<Record<string, string>> = {
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  max: 'Max',
}

/** 界面里的档位名：已知档位首字母大写，未知值原样。 */
function tierLabel(tier: string): string {
  const trimmed = tier.trim()
  return TIER_LABELS[trimmed.toLowerCase()] ?? trimmed
}

/** 本地化的日期时间（月日 + 时分）；坏时间戳返回 undefined。 */
export function formatPanelTime(
  iso: string,
  locale: PanelLocaleId,
  timeZone?: string,
): string | undefined {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return undefined
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone === undefined ? {} : { timeZone }),
  }
  // 月/日的顺序与月份名交给 Intl，避免手写中英两套格式。
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', options).format(date)
}

/** credits 只保留整数（面板与 `/opendesign` 命令同一口径）。 */
function credits(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}

/** 百分比取整并夹到 0–100；上限 ≤ 0 时无法计算，返回 undefined。 */
function percentOf(used: number, limit: number): number | undefined {
  if (!(limit > 0)) return undefined
  const ratio = (used / limit) * 100
  if (!Number.isFinite(ratio)) return undefined
  return Math.min(100, Math.max(0, Math.round(ratio)))
}

/** 一个窗口的投影。 */
function windowView(
  window: QuotaWindow,
  t: PanelTranslate,
  locale: PanelLocaleId,
  timeZone: string | undefined,
): QuotaWindowView {
  const used = credits(window.usedCredits)
  const limit = credits(window.limitCredits)
  const percent = percentOf(used, limit)
  const shownPercent = percent ?? 0
  const remainingPercent = percent === undefined ? 0 : 100 - percent
  const when = window.resetsAt === undefined ? undefined : formatPanelTime(window.resetsAt, locale, timeZone)
  const label = window.kind === 'five_hour'
    ? t('windowFiveHour')
    : window.kind === 'seven_day'
      ? t('windowSevenDay')
      : t('windowOther', { duration: String(window.durationSeconds) })
  return {
    kind: window.kind,
    label,
    used,
    limit,
    percent: shownPercent,
    remainingPercent,
    percentText: percent === undefined
      ? t('unknownPercent')
      : percent === 0 && used > 0
        ? '<1%'
        : `${percent}%`,
    remainingText: percent === undefined ? t('unknownPercent') : t('remainingLine', { percent: remainingPercent }),
    amountText: t('amountLine', { used: String(used), limit: String(limit) }),
    resetText: when === undefined ? t('resetUnknown') : t('resetLine', { when }),
    overLimit: limit > 0 ? used > limit : used > 0,
  }
}

/**
 * 投影一次面板状态。纯函数：同一输入永远同一输出，渲染时机与副作用都归控制器。
 */
export function buildQuotaPanelView(input: QuotaPanelViewInput): QuotaPanelView {
  const { t, snapshot } = input
  const allowed = !(input.controlKeyKnown && !input.hasControlKey)
  const available = snapshot?.controlPlaneAvailable === true
  const visible = input.showSidebarQuota && allowed && available
  // 关闭开关不是「不可用」，不提示原因；开关开着却渲染不了才说明为什么。
  const reasonText = input.showSidebarQuota && !visible && !input.loading
    ? t('unavailable')
    : undefined

  if (!available || snapshot === undefined) {
    return {
      visible,
      reasonText,
      tierText: undefined,
      statusText: undefined,
      periodText: undefined,
      balanceText: undefined,
      fundingText: undefined,
      explainerText: t('explainer'),
      windows: [],
      emptyText: undefined,
      staleText: undefined,
      fetchedText: undefined,
      loadFailedText: input.failed ? t('loadFailed') : undefined,
      loading: input.loading,
    }
  }

  const tier = snapshot.tier === undefined ? undefined : tierLabel(snapshot.tier)
  const isGo = snapshot.tier?.trim().toLowerCase() === 'go'
  const windows = snapshot.windows
    // 5 小时窗口是 Go 档独有的计量档；非 Go 档即使控制面回了也不展示。
    .filter((window) => window.kind !== 'five_hour' || isGo)
    .map((window) => windowView(window, t, input.locale, input.timeZone))

  const period = snapshot.currentPeriodEnd === undefined
    ? undefined
    : formatPanelTime(snapshot.currentPeriodEnd, input.locale, input.timeZone)
  const fetched = formatPanelTime(snapshot.fetchedAt, input.locale, input.timeZone)
  const emptyText = windows.length > 0
    ? undefined
    : snapshot.funding === 'wallet'
      ? t('walletOnly')
      : t('noWindows')

  return {
    visible,
    reasonText,
    tierText: tier === undefined ? t('tierUnknown') : t('tierLine', { tier }),
    statusText: snapshot.subscriptionStatus === undefined
      ? undefined
      : t('statusLine', { status: snapshot.subscriptionStatus }),
    periodText: period === undefined ? undefined : t('periodLine', { when: period }),
    balanceText: snapshot.balanceUsd === undefined
      ? undefined
      : t('balanceLine', { amount: `$${snapshot.balanceUsd.toFixed(2)}` }),
    fundingText: snapshot.funding === 'coding_plan'
      ? t('fundingPlan')
      : snapshot.funding === 'wallet'
        ? t('fundingWallet')
        : undefined,
    explainerText: t('explainer'),
    windows,
    emptyText,
    staleText: snapshot.stale === true ? t('stale') : undefined,
    fetchedText: fetched === undefined ? undefined : t('fetchedAt', { when: fetched }),
    loadFailedText: input.failed ? t('loadFailed') : undefined,
    loading: input.loading,
  }
}
