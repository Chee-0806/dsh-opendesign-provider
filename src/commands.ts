/**
 * `/opendesign` 斜杠命令（ticket 10）：终端里的额度看板。
 *
 *   /opendesign            看套餐、5 小时/7 天窗口、重置时间、钱包余额与计费口径
 *
 * 数据来自 Host 侧只读的 {@link OpenDesignControlPlane}，与 `opendesign/usage`
 * Remote 共用同一份 60 秒缓存，因此命令与 P1 面板永远是同一组数字。命令是
 * Host 侧代码，读不到客户端 `ctx.locale`，活动语言通过 `deps.getLocale()` 进来，
 * 所有文案来自 `./command-locales.ts`（缺键回落英文）。
 *
 * 输出是纯文本：无颜色、无 emoji、不依赖特定终端宽度——区块字符条在等宽字体里
 * 是固定十个单元。三种状态都有明确文案：有额度、额度耗尽（无窗口 / 钱包计费）、
 * 无控制密钥（说明原因并给下一步）。
 *
 * @module dsh-opendesign-provider/commands
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only import that loads the module augmentation (`ctx.commands`).
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'

import type { QuotaReading, QuotaSnapshot, QuotaWindow } from './control-plane.ts'
import { commandCopy, type LocaleId } from './command-locales.ts'
import { readableErrorText } from './readable-error.ts'

/** 命令需要的东西，全部由插件入口注入（测试直接给夹具）。 */
export interface OpendesignCommandDeps {
  /** 读一次额度；Host 侧客户端内部做 60 秒缓存，参数是预检模型。 */
  quota: (model?: string) => Promise<QuotaReading>
  /** 当前会话/默认模型（取目录默认模型）；缺席时跳过预检、只报账单摘要。 */
  model?: () => Promise<string | undefined>
  /** 活动语言；Host 命令读不到 `ctx.locale`，所以从这里进来。 */
  getLocale?: () => LocaleId
}

/** 把 `Config.lang` 这类自由字符串收敛成支持的语言。 */
export function resolveCommandLocale(value: string | undefined): LocaleId {
  return value === 'en' ? 'en' : 'zh'
}

/** 本地时间 `YYYY-MM-DD HH:mm`；坏时间戳返回 undefined，由调用方决定空态。 */
function formatDateTime(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return undefined
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 十格方块条；上限未知（<=0）时整条留空，不假装已用满。 */
function bar(used: number, limit: number): string {
  if (!(limit > 0)) return '░'.repeat(10)
  const ratio = Math.max(0, Math.min(1, used / limit))
  // 用过一点点就要看得见：四舍五入到 0 格会让「1%」和「0%」长得一样。
  const filled = ratio > 0 ? Math.max(1, Math.round(ratio * 10)) : 0
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

/** credits 整除显示；小数只出现在美元当量里。 */
function formatCredits(value: number): string {
  return String(Math.round(value))
}

/** credits → 美元当量；没有 `creditsPerUsd` 时整段省略，不猜汇率。 */
function usdEquivalent(credits: number, creditsPerUsd: number | undefined): string | undefined {
  if (creditsPerUsd === undefined || !(creditsPerUsd > 0)) return undefined
  return `$${(credits / creditsPerUsd).toFixed(2)}`
}

function windowLabel(window: QuotaWindow, locale: LocaleId): string {
  if (window.kind === 'five_hour') return commandCopy(locale, 'windowFiveHour')
  if (window.kind === 'seven_day') return commandCopy(locale, 'windowSevenDay')
  return commandCopy(locale, 'windowOther', { duration: String(window.durationSeconds) })
}

/** 一个窗口两行：方块条 + 百分比，明细 + 重置时间（含 resetMode）。 */
function renderWindow(window: QuotaWindow, creditsPerUsd: number | undefined, locale: LocaleId): string[] {
  const label = windowLabel(window, locale)
  const percent = window.limitCredits > 0
    ? Math.round((window.usedCredits / window.limitCredits) * 100)
    : 0
  const usedUsd = usdEquivalent(window.usedCredits, creditsPerUsd)
  const limitUsd = usdEquivalent(window.limitCredits, creditsPerUsd)
  // 没有 creditsPerUsd 时整段美元当量省略；有则只作「额度当量」展示。
  const usd = usedUsd === undefined || limitUsd === undefined
    ? ''
    : commandCopy(locale, 'usdEquivalent', { usedUsd, limitUsd })
  const resetText = formatDateTime(window.resetsAt) ?? commandCopy(locale, 'resetUnknown')
  const mode = window.resetMode === undefined ? '' : commandCopy(locale, 'modeSuffix', { mode: window.resetMode })
  return [
    commandCopy(locale, 'windowBar', {
      label,
      bar: bar(window.usedCredits, window.limitCredits),
      percent: String(percent),
    }),
    `  ${commandCopy(locale, 'windowDetail', {
      used: formatCredits(window.usedCredits),
      limit: formatCredits(window.limitCredits),
      usd,
    })} · ${commandCopy(locale, 'windowReset', { when: resetText, mode })}`,
  ]
}

/** 把一次读取渲染成完整的纯文本看板。 */
export function renderQuota(reading: QuotaReading, locale: LocaleId): string {
  const snapshot: QuotaSnapshot = reading.snapshot
  const lines: string[] = [commandCopy(locale, 'title'), '']

  if (!snapshot.controlPlaneAvailable) {
    const key = reading.reason === 'login-unavailable'
      ? 'unavailableNoLogin'
      : reading.reason === 'unreachable'
        ? 'unavailableUnreachable'
        : 'unavailableNoKey'
    lines.push(commandCopy(locale, key), '', commandCopy(locale, 'unavailableHint'))
    return lines.join('\n').trimEnd()
  }

  const planParts: string[] = []
  if (snapshot.tier !== undefined) planParts.push(snapshot.tier)
  if (snapshot.subscriptionStatus !== undefined) planParts.push(snapshot.subscriptionStatus)
  const period = formatDateTime(snapshot.currentPeriodEnd)
  if (planParts.length > 0) {
    lines.push(commandCopy(locale, 'planLine', {
      tier: snapshot.tier ?? '—',
      status: snapshot.subscriptionStatus ?? '—',
      period: period ?? '—',
    }))
  }

  if (snapshot.windows.length === 0) {
    // 无窗口有两种含义：控制面明确说钱包计费，或它什么都没给。两者都不该被
    // 渲染成「额度 0/0」——那会让人以为额度用完了。
    lines.push(snapshot.funding === 'wallet'
      ? commandCopy(locale, 'walletOnly')
      : commandCopy(locale, 'noWindows'))
  } else {
    for (const window of snapshot.windows) {
      lines.push('', ...renderWindow(window, reading.creditsPerUsd, locale))
    }
  }

  if (snapshot.balanceUsd !== undefined) {
    lines.push('', commandCopy(locale, 'walletBalance', { balance: `$${snapshot.balanceUsd.toFixed(2)}` }))
  }
  if (snapshot.funding === 'coding_plan') {
    lines.push(commandCopy(locale, 'fundingPlan'))
  } else if (snapshot.funding === 'wallet') {
    lines.push(commandCopy(locale, 'fundingWallet'))
  }

  const fetched = formatDateTime(snapshot.fetchedAt)
  if (fetched !== undefined) {
    const stale = snapshot.stale === true ? commandCopy(locale, 'staleMark') : ''
    lines.push('', commandCopy(locale, 'fetchedAt', { when: fetched }) + stale)
  }

  return lines.join('\n').trimEnd()
}

/** 唯一的 `/opendesign` 命令定义。 */
export function commandDefinition(deps: OpendesignCommandDeps): CommandDefinition {
  return {
    name: 'opendesign',
    description: 'Open Design quota and plan',
    handler: async () => {
      const locale: LocaleId = deps.getLocale?.() ?? 'zh'
      // 取模型只是为了预检；目录不可用不该让额度看板变成错误，跳过预检即可
      // （快照仍带档位、余额与 funding）。
      let model: string | undefined
      try {
        model = await deps.model?.()
      } catch {
        model = undefined
      }
      try {
        const reading = await deps.quota(model)
        return { kind: 'success', text: renderQuota(reading, locale) }
      } catch (error: unknown) {
        return {
          kind: 'error',
          text: commandCopy(locale, 'errorText', { message: readableErrorText(error) }),
        }
      }
    },
  }
}

/** 在 `ctx.commands` 上注册命令（插件入口调用；`commands` 是可选服务）。 */
export function applyCommands(ctx: Context, deps: OpendesignCommandDeps): void {
  ctx.commands.register(commandDefinition(deps))
}
