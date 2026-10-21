/**
 * 额度面板的中英文案（ticket 11）。
 *
 * 面板与设置页共用一套界面语言，但有自己的文案命名空间（`panel.opendesign`）：
 * 面板的术语是套餐档位、额度窗口、重置时间与计费口径，和设置页的配置字段不是
 * 同一套词。zh 是键集的真源，en 必须一一对应，漏翻会在注册处被 typecheck 拒绝。
 *
 * `panelTranslate` 供 React-free 的 view model 与测试直接取词；React 组件用宿主
 * 注入的 `t`（同一个命名空间），两者模板一致。
 *
 * 术语按 `GLOSSARY.md` 第七节：额度、额度窗口、预检、钱包余额、Design Plan 额度。
 * 不出现美元单价、峰谷、套餐过滤或 Command Code 的任何概念。
 *
 * @module dsh-opendesign-provider/client/panel-locales
 */

import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { PANEL_LOCALE_NS } from '../identity.ts'

/** 面板文案命名空间（与设置页的 `settings.opendesign` 分开）。 */
export { PANEL_LOCALE_NS }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'panel.opendesign': PanelCopyKey
  }
}

/** 面板文案的键集。 */
export type PanelCopyKey =
  | 'title'
  | 'subtitle'
  | 'tierLine'
  | 'tierUnknown'
  | 'statusLine'
  | 'periodLine'
  | 'balanceLine'
  | 'windowFiveHour'
  | 'windowSevenDay'
  | 'windowOther'
  | 'amountLine'
  | 'remainingLine'
  | 'resetLine'
  | 'resetUnknown'
  | 'fundingPlan'
  | 'fundingWallet'
  | 'explainer'
  | 'walletOnly'
  | 'noWindows'
  | 'emptyUnknown'
  | 'stale'
  | 'fetchedAt'
  | 'loadFailed'
  | 'loading'
  | 'unavailable'
  | 'refresh'
  | 'refreshing'
  | 'open'
  | 'close'
  | 'unknownPercent'

/** view model 与测试用的取词函数签名。 */
export type PanelTranslate = Translate<PanelCopyKey>

/** 中文文案（键集真源）。 */
export const ZH: Record<PanelCopyKey, string> = {
  title: '额度面板',
  subtitle: '套餐、额度窗口与钱包余额',
  tierLine: '套餐 {tier}',
  tierUnknown: '未知档位',
  statusLine: '订阅 {status}',
  periodLine: '本期至 {when}',
  balanceLine: '钱包余额 {amount}',
  windowFiveHour: '5 小时窗口',
  windowSevenDay: '7 天窗口',
  windowOther: '{duration} 秒窗口',
  amountLine: '{used} / {limit} credits',
  remainingLine: '剩余 {percent}%',
  resetLine: '重置 {when}',
  resetUnknown: '重置时间未知',
  fundingPlan: '当前从 Design Plan 额度扣减。',
  fundingWallet: '当前按钱包余额扣费，不扣 Design Plan 额度。',
  explainer: '计费顺序：先扣 Design Plan 额度，再扣套餐额度（仅 Plus/Pro/Max），未覆盖时扣钱包余额。',
  walletOnly: 'Design Plan 未覆盖当前模型（eligible=false），按钱包余额计费。',
  noWindows: '控制面没有返回限额窗口。',
  emptyUnknown: '暂无额度窗口数据。',
  stale: '已过期',
  fetchedAt: '数据时间 {when}',
  loadFailed: '读取额度失败，显示的是上次成功的数据。',
  loading: '正在读取额度…',
  unavailable: '额度不可用：需要 CLI 登录态里的 controlKey（执行 `vela login` 后重试）。',
  refresh: '刷新',
  refreshing: '刷新中…',
  open: '打开额度面板',
  close: '关闭面板',
  unknownPercent: '—',
}

/** 英文文案（键集与中文完全一致）。 */
export const EN: Record<PanelCopyKey, string> = {
  title: 'Quota panel',
  subtitle: 'Plan, quota windows and wallet balance',
  tierLine: 'Plan {tier}',
  tierUnknown: 'Unknown plan',
  statusLine: 'Subscription {status}',
  periodLine: 'Period ends {when}',
  balanceLine: 'Wallet balance {amount}',
  windowFiveHour: '5-hour window',
  windowSevenDay: '7-day window',
  windowOther: '{duration}s window',
  amountLine: '{used} / {limit} credits',
  remainingLine: '{percent}% left',
  resetLine: 'Resets {when}',
  resetUnknown: 'Reset time unknown',
  fundingPlan: 'Currently charged to Design Plan credits.',
  fundingWallet: 'Currently charged to the wallet balance; Design Plan credits are not used.',
  explainer: 'Billing order: Design Plan credits first, then plan credits (Plus/Pro/Max only), then the wallet balance when neither covers the model.',
  walletOnly: 'The Design Plan does not cover this model (eligible=false); the wallet balance is charged.',
  noWindows: 'The control plane returned no limit windows.',
  emptyUnknown: 'No quota window data yet.',
  stale: 'Stale',
  fetchedAt: 'Fetched {when}',
  loadFailed: 'Reading quota failed; showing the last successful reading.',
  loading: 'Reading quota…',
  unavailable: 'Quota is unavailable: the CLI login state needs a controlKey (run `vela login` and retry).',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  open: 'Open the quota panel',
  close: 'Close panel',
  unknownPercent: '—',
}

/** 面板支持的语言（宿主 `lang` 与浏览器偏好收敛后的两种）。 */
export type PanelLocaleId = 'zh' | 'en'

/** 取一种语言的字典。 */
export function panelDictionary(locale: PanelLocaleId): Record<PanelCopyKey, string> {
  return locale === 'en' ? EN : ZH
}

/**
 * 构造一个与宿主 `t` 同签名的取词函数：`{name}` 占位符按传入值填充，缺席时
 * 原样保留占位符（不吞掉可见文本，也不抛错）。
 */
export function panelTranslate(locale: PanelLocaleId): PanelTranslate {
  const dictionary = panelDictionary(locale)
  return (key, params) => {
    const template = dictionary[key] ?? EN[key] ?? String(key)
    return template.replace(/\{(\w+)\}/gu, (match, name: string) => {
      const value = params?.[name]
      return value === undefined ? match : String(value)
    })
  }
}
