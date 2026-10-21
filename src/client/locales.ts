/**
 * Dictionary for the Open Design settings page and Models-page card.
 *
 * zh is the source of truth for the key set; en carries exactly the same keys,
 * so a missing or extra key fails typecheck at the registration site. Every
 * user-visible string on both surfaces comes from here — including the
 * semantic notice keys the controller emits — so the page never assembles copy
 * from Host-side English.
 *
 * @module dsh-opendesign-provider/client/locales
 */

import { SETTINGS_LOCALE_NS } from '../identity.ts'
import type { SettingsNoticeKey } from './settings.ts'

export { SETTINGS_LOCALE_NS }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.opendesign': SettingsOpenDesignKey
  }
}

/** Dictionary keys of this plugin's settings surfaces. */
export type SettingsOpenDesignKey =
  | 'nav'
  | 'title'
  | 'intro'
  | 'readOnly'
  | 'connection'
  | 'connectionDesc'
  | 'apiKey'
  | 'apiKeyHint'
  | 'apiKeySet'
  | 'apiKeySetLiteral'
  | 'apiKeySetReference'
  | 'apiKeySetCliLogin'
  | 'apiKeyUnset'
  | 'apiKeyUnknown'
  | 'apiKeyLocked'
  | 'apiKeyPlaceholder'
  | 'clearKey'
  | 'apiBase'
  | 'apiBaseHint'
  | 'loginStatus'
  | 'loginOk'
  | 'loginMissing'
  | 'loginMalformed'
  | 'loginUnreadable'
  | 'loginUnknown'
  | 'loginHint'
  | 'loginUse'
  | 'controlKeyWarn'
  | 'modelsSection'
  | 'modelsSectionDesc'
  | 'visibleModels'
  | 'visibleModelsHint'
  | 'uncalibrated'
  | 'contextWindow'
  | 'contextWindowHint'
  | 'contextOverrides'
  | 'contextOverridesHint'
  | 'maxOutputTokens'
  | 'maxOutputTokensHint'
  | 'displaySection'
  | 'displaySectionDesc'
  | 'language'
  | 'sidebarQuota'
  | 'sidebarQuotaHint'
  | 'advanced'
  | 'advancedDesc'
  | 'requestTimeout'
  | 'requestTimeoutHint'
  | 'streamIdleTimeout'
  | 'streamIdleTimeoutHint'
  | 'transportMaxRetries'
  | 'transportMaxRetriesHint'
  | 'modelsCachePath'
  | 'modelsCachePathHint'
  | 'diagnostics'
  | 'diagnosticsHint'
  | 'copyDiagnostics'
  | 'copied'
  | 'catalogSource'
  | 'catalogLive'
  | 'catalogStatic'
  | 'catalogUnknown'
  | 'catalogCached'
  | 'catalogReason'
  | 'save'
  | 'saving'
  | 'discard'
  | 'saved'
  | 'conflict'
  | 'failed'
  | 'invalid'
  | 'noChanges'
  | 'credentialFailed'
  | 'invalidFormat'
  | 'invalidTooSmall'
  | 'invalidTooLarge'
  | 'cardTitle'
  | 'cardKeyMissing'
  | 'cardPaste'
  | 'cardSave'
  | 'cardCatalog'
  | 'cardUncalibrated'

/** The notice keys map onto dictionary keys one-for-one. */
const NOTICES: Record<SettingsNoticeKey, SettingsNoticeKey> = {
  saved: 'saved',
  conflict: 'conflict',
  failed: 'failed',
  invalid: 'invalid',
  noChanges: 'noChanges',
  credentialFailed: 'credentialFailed',
}

/** Translate one controller notice key. */
export function noticeText(
  t: (key: SettingsOpenDesignKey) => string,
  key: SettingsNoticeKey,
): string {
  return t(NOTICES[key])
}

/** Chinese copy; the source of truth for the key set. */
export const zh: Record<SettingsOpenDesignKey, string> = {
  nav: 'Open Design',
  title: 'Open Design',
  intro: '通过 Open Design 的额度调用模型。密钥只保存为凭据引用，页面不会显示明文。',
  readOnly: '当前配置不可写。请确认宿主设置服务可用，或用 composition 配置后重启。',
  connection: '连接',
  connectionDesc: '填入 API Key，或直接复用桌面端 / CLI 的登录态。显式 Key 优先于登录态。',
  apiKey: 'API Key',
  apiKeyHint: '保存后只显示「已设置 / 未设置」；值写入凭据引用，不进入设置文档。',
  apiKeySet: '已设置',
  apiKeySetLiteral: '已设置（配置内明文）',
  apiKeySetReference: '已设置（凭据引用）',
  apiKeySetCliLogin: '已设置（CLI 登录态）',
  apiKeyUnset: '未设置',
  apiKeyUnknown: '状态未知',
  apiKeyLocked: '凭据服务当前不可写',
  apiKeyPlaceholder: '粘贴 Open Design API Key',
  clearKey: '清除 Key',
  apiBase: '网关地址',
  apiBaseHint: '留空使用默认网关；密钥来自 CLI 登录态时使用其下发的地址。',
  loginStatus: 'CLI 登录态',
  loginOk: '可读',
  loginMissing: '未找到 ~/.amr/config.json',
  loginMalformed: '文件格式不可用',
  loginUnreadable: '文件不可读',
  loginUnknown: '未知',
  loginHint: '在终端执行 `vela login` 后，本插件无需再配置 Key 即可复用登录态。',
  loginUse: '未显式配置 Key 时自动使用登录态，不会写入该文件。',
  controlKeyWarn: '有登录态但没有控制密钥：推理不受影响，额度功能（P1）暂不可用。',
  modelsSection: '模型与上下文',
  modelsSectionDesc: '白名单决定模型选择器里出现哪些模型，并可覆盖上下文窗口与单次输出上限。',
  visibleModels: '模型白名单',
  visibleModelsHint: '只影响模型选择器；一个都不勾选等于全部可见。',
  uncalibrated: '未校准',
  contextWindow: '上下文窗口',
  contextWindowHint: '全局覆盖值，留空则使用目录公布值。',
  contextOverrides: '按模型覆盖',
  contextOverridesHint: '只填需要覆盖的模型；留空表示跟随全局值。',
  maxOutputTokens: '输出上限',
  maxOutputTokensHint: '留空跟随默认；0 表示不发送输出上限字段。',
  displaySection: '显示',
  displaySectionDesc: '界面语言与额度卡显示。',
  language: '语言',
  sidebarQuota: '侧栏额度卡',
  sidebarQuotaHint: '默认关闭；开启后显示套餐档位与 7 天窗口进度（Go 档另有 5 小时窗口），点击进入额度面板。',
  advanced: '高级',
  advancedDesc: '网络超时、传输重试、目录缓存与诊断。',
  requestTimeout: '请求超时（秒）',
  requestTimeoutHint: '等待响应首字节的时间，默认 300 秒。',
  streamIdleTimeout: '流空闲超时（秒）',
  streamIdleTimeoutHint: '流建立后允许的最长静默时间，默认 300 秒。',
  transportMaxRetries: '传输重试次数',
  transportMaxRetriesHint: '一次请求最多吸收的传输失败次数，默认 5。',
  modelsCachePath: '目录缓存路径',
  modelsCachePathHint: '留空使用 ~/.opendesign/models-cache.json。',
  diagnostics: '诊断',
  diagnosticsHint: '复制当前有效配置与来源；密钥永远脱敏。',
  copyDiagnostics: '复制诊断',
  copied: '已复制',
  catalogSource: '目录来源',
  catalogLive: '网关实时',
  catalogStatic: '内置快照',
  catalogUnknown: '未知',
  catalogCached: '来自磁盘缓存',
  catalogReason: '回落原因',
  save: '保存',
  saving: '保存中…',
  discard: '放弃更改',
  saved: '已保存',
  conflict: '配置已被其他窗口修改，草稿已保留。',
  failed: '保存失败，请重试。',
  invalid: '有字段填写不合法，请检查后再保存。',
  noChanges: '没有需要保存的更改。',
  credentialFailed: '配置已确认，但密钥写入失败；草稿已保留。',
  invalidFormat: '格式不正确',
  invalidTooSmall: '小于允许的最小值',
  invalidTooLarge: '超过允许的最大值',
  cardTitle: '凭据与目录',
  cardKeyMissing: '未设置 API Key',
  cardPaste: '粘贴 Key 后保存',
  cardSave: '保存 Key',
  cardCatalog: '目录',
  cardUncalibrated: '未校准',
}

/** English copy with the exact same key set. */
export const en: Record<SettingsOpenDesignKey, string> = {
  nav: 'Open Design',
  title: 'Open Design',
  intro: 'Use Open Design credits for model calls. The key is stored only as a credential reference; this page never shows it.',
  readOnly: 'This configuration is read-only. Check that the Host settings service is available, or configure it in the composition and restart.',
  connection: 'Connection',
  connectionDesc: 'Paste an API key, or reuse the desktop / CLI login state. An explicit key wins over the login state.',
  apiKey: 'API key',
  apiKeyHint: 'After saving, only "set / not set" is shown; the value goes to a credential reference, never the settings document.',
  apiKeySet: 'Set',
  apiKeySetLiteral: 'Set (literal in config)',
  apiKeySetReference: 'Set (credential reference)',
  apiKeySetCliLogin: 'Set (CLI login)',
  apiKeyUnset: 'Not set',
  apiKeyUnknown: 'Unknown',
  apiKeyLocked: 'The credential service is not writable',
  apiKeyPlaceholder: 'Paste an Open Design API key',
  clearKey: 'Clear key',
  apiBase: 'Gateway URL',
  apiBaseHint: 'Leave blank for the default gateway; a CLI-login key uses its server-issued URL.',
  loginStatus: 'CLI login state',
  loginOk: 'Readable',
  loginMissing: '~/.amr/config.json not found',
  loginMalformed: 'Unreadable format',
  loginUnreadable: 'File cannot be read',
  loginUnknown: 'Unknown',
  loginHint: 'Run `vela login` in a terminal and this plugin reuses the login state without any key configuration.',
  loginUse: 'Used automatically when no explicit key is configured; this file is never written.',
  controlKeyWarn: 'A login state exists but has no control key: inference is unaffected, quota features (P1) are unavailable.',
  modelsSection: 'Models & context',
  modelsSectionDesc: 'The allowlist decides which models the picker lists; context windows and the per-turn output cap are overridden below.',
  visibleModels: 'Model allowlist',
  visibleModelsHint: 'Affects the model picker only; checking none means every model is visible.',
  uncalibrated: 'Uncalibrated',
  contextWindow: 'Context window',
  contextWindowHint: 'Global override; leave blank to follow the catalog figure.',
  contextOverrides: 'Per-model overrides',
  contextOverridesHint: 'Fill only the models you need; blank follows the global value.',
  maxOutputTokens: 'Output cap',
  maxOutputTokensHint: 'Leave blank for the default; 0 omits the output-cap field.',
  displaySection: 'Display',
  displaySectionDesc: 'Interface language and the quota card.',
  language: 'Language',
  sidebarQuota: 'Sidebar quota card',
  sidebarQuotaHint: 'Off by default. When on, shows the plan tier and the 7-day window (Go also shows the 5-hour window); click through for the quota panel.',
  advanced: 'Advanced',
  advancedDesc: 'Network timeouts, transport retries, catalog cache and diagnostics.',
  requestTimeout: 'Request timeout (seconds)',
  requestTimeoutHint: 'Time to the response first byte; 300 seconds by default.',
  streamIdleTimeout: 'Stream idle timeout (seconds)',
  streamIdleTimeoutHint: 'Longest allowed silence after the stream opens; 300 seconds by default.',
  transportMaxRetries: 'Transport retries',
  transportMaxRetriesHint: 'Transport failures one request absorbs; 5 by default.',
  modelsCachePath: 'Catalog cache path',
  modelsCachePathHint: 'Leave blank for ~/.opendesign/models-cache.json.',
  diagnostics: 'Diagnostics',
  diagnosticsHint: 'Copy the effective configuration and provenance; keys are always redacted.',
  copyDiagnostics: 'Copy diagnostics',
  copied: 'Copied',
  catalogSource: 'Catalog source',
  catalogLive: 'Live gateway',
  catalogStatic: 'Built-in snapshot',
  catalogUnknown: 'Unknown',
  catalogCached: 'Read from disk cache',
  catalogReason: 'Fallback reason',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard changes',
  saved: 'Saved',
  conflict: 'The configuration changed in another window; your draft was kept.',
  failed: 'Save failed. Try again.',
  invalid: 'Some fields are invalid; fix them before saving.',
  noChanges: 'Nothing to save.',
  credentialFailed: 'The configuration was confirmed, but the key could not be written; the draft was kept.',
  invalidFormat: 'Invalid format',
  invalidTooSmall: 'Below the minimum',
  invalidTooLarge: 'Above the maximum',
  cardTitle: '凭据与目录',
  cardKeyMissing: 'No API key set',
  cardPaste: 'Paste a key, then save',
  cardSave: 'Save key',
  cardCatalog: 'Catalog',
  cardUncalibrated: 'Uncalibrated',
}
