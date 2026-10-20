/**
 * `/opendesign` 命令的中英文案（ticket 10）。
 *
 * Host 侧命令读不到客户端 `ctx.locale`，所以活动语言通过 `deps.getLocale()`
 * 传入，所有字符串集中在 {@link COMMAND_COPY}；缺失的键回落到 `en` 副本，绝不
 * 让一条额度看板因为漏翻一个标签而抛错。文案是纯文本（无颜色、无 emoji），
 * 任何 TUI 都能原样显示。
 *
 * @module dsh-opendesign-provider/command-locales
 */

/** 命令与额度看板支持的语言。 */
export type LocaleId = 'zh' | 'en'

type CopyKey =
  | 'description'
  | 'title'
  | 'planLine'
  | 'windowFiveHour'
  | 'windowSevenDay'
  | 'windowOther'
  | 'windowDetail'
  | 'windowBar'
  | 'usdEquivalent'
  | 'modeSuffix'
  | 'windowReset'
  | 'walletBalance'
  | 'fundingPlan'
  | 'fundingWallet'
  | 'walletOnly'
  | 'noWindows'
  | 'fetchedAt'
  | 'staleMark'
  | 'unavailableNoKey'
  | 'unavailableNoLogin'
  | 'unavailableUnreachable'
  | 'unavailableHint'
  | 'errorText'
  | 'credits'
  | 'resetUnknown'

const ZH: Record<CopyKey, string> = {
  description: 'Open Design 额度与套餐',
  title: 'Open Design 额度',
  planLine: '套餐：{tier} · 订阅 {status} · 本期至 {period}',
  windowFiveHour: '5 小时窗口',
  windowSevenDay: '7 天窗口',
  windowOther: '{duration} 秒窗口',
  windowDetail: '{used} / {limit} credits{usd}',
  windowBar: '{label}  {bar}  {percent}%',
  usdEquivalent: '（{usedUsd} / {limitUsd}）',
  modeSuffix: '（{mode}）',
  windowReset: '重置：{when}{mode}',
  walletBalance: '钱包余额：{balance}',
  fundingPlan: '计费口径：先扣 Design Plan 额度，用尽后扣钱包余额。',
  fundingWallet: '计费口径：当前按钱包余额计费，不扣 Design Plan 额度。',
  walletOnly: 'Design Plan 未覆盖当前模型（eligible=false），按钱包余额计费。',
  noWindows: '控制面没有返回任何限额窗口。',
  fetchedAt: '数据时间：{when}',
  staleMark: '（数据已过期，展示的是上次成功查询的结果）',
  unavailableNoKey: '暂时读不到额度：CLI 登录态里没有 controlKey。',
  unavailableNoLogin: '暂时读不到额度：没有读到 Open Design CLI 登录态。',
  unavailableUnreachable: '暂时读不到额度：控制面暂时不可达。',
  unavailableHint: '可在控制台查看额度（https://open-design.ai/cloud/dashboard），或在终端执行 `vela login` 后重试。',
  errorText: '读取 Open Design 额度失败：{message}',
  credits: 'credits',
  resetUnknown: '未知',
}

const EN: Record<CopyKey, string> = {
  description: 'Open Design quota and plan',
  title: 'Open Design quota',
  planLine: 'Plan: {tier} · subscription {status} · period ends {period}',
  windowFiveHour: '5-hour window',
  windowSevenDay: '7-day window',
  windowOther: '{duration}s window',
  windowDetail: '{used} / {limit} credits{usd}',
  windowBar: '{label}  {bar}  {percent}%',
  usdEquivalent: ' ({usedUsd} / {limitUsd})',
  modeSuffix: ' ({mode})',
  windowReset: 'Resets: {when}{mode}',
  walletBalance: 'Wallet balance: {balance}',
  fundingPlan: 'Billing: Design Plan credits first, then the wallet balance.',
  fundingWallet: 'Billing: charged to the wallet balance; Design Plan credits are not used.',
  walletOnly: 'The Design Plan does not cover this model (eligible=false); the wallet balance is charged.',
  noWindows: 'The control plane returned no limit windows.',
  fetchedAt: 'Fetched: {when}',
  staleMark: ' (stale: showing the last successful reading)',
  unavailableNoKey: 'Quota is unavailable: the CLI login state has no controlKey.',
  unavailableNoLogin: 'Quota is unavailable: no Open Design CLI login state was found.',
  unavailableUnreachable: 'Quota is unavailable: the control plane is unreachable right now.',
  unavailableHint: 'Check your quota at https://open-design.ai/cloud/dashboard, or run `vela login` and try again.',
  errorText: 'Reading Open Design quota failed: {message}',
  credits: 'credits',
  resetUnknown: 'unknown',
}

const COPY: Record<LocaleId, Record<CopyKey, string>> = { zh: ZH, en: EN }

/** 取一条文案并填充占位符；缺失的键回落到英文副本。 */
export function commandCopy(locale: LocaleId, key: CopyKey, values: Record<string, string> = {}): string {
  const template = COPY[locale]?.[key] ?? EN[key]
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => values[name] ?? match)
}
