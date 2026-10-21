/**
 * Analytics page copy (ticket 12), in its own locale namespace so the settings
 * page dictionary stays focused.
 *
 * zh is the source of truth for the key set; en carries exactly the same keys.
 * No string here names a currency, an amount or an estimate — ADR-0002 keeps
 * the cost column at the catalog's `low/medium/high` word.
 *
 * @module dsh-opendesign-provider/client/analytics-locales
 */

import { ANALYTICS_LOCALE_NS } from '../identity.ts'

export { ANALYTICS_LOCALE_NS }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'analytics.opendesign': AnalyticsKey
  }
}

/** Every user-visible string on the analytics page. */
export type AnalyticsKey =
  | 'nav'
  | 'title'
  | 'intro'
  | 'filterRecent'
  | 'filterRange'
  | 'recentSessions'
  | 'from'
  | 'to'
  | 'read'
  | 'reading'
  | 'loading'
  | 'unavailable'
  | 'failed'
  | 'empty'
  | 'readFailed'
  | 'invalidRange'
  | 'columnModel'
  | 'columnRequests'
  | 'columnTokens'
  | 'columnFirstToken'
  | 'columnDuration'
  | 'columnFailureRate'
  | 'columnRetries'
  | 'columnCost'
  | 'columnCapability'
  | 'summaryRequests'
  | 'summarySessions'
  | 'summaryTokens'
  | 'summaryFirstToken'
  | 'summaryDuration'
  | 'summaryFailureRate'
  | 'summaryRetries'
  | 'summaryCoverage'
  | 'costLow'
  | 'costMedium'
  | 'costHigh'
  | 'costUnknown'
  | 'capabilityStandard'
  | 'capabilityAdvanced'
  | 'capabilityUnknown'
  | 'missing'
  | 'msUnit'
  | 'historyUnsupported'
  | 'historyUnreadable'
  | 'truncated'
  | 'partialUsage'
  | 'unknownModels'
  | 'costNote'

/** Chinese copy. */
export const zh: Record<AnalyticsKey, string> = {
  nav: '模型分析',
  title: '模型分析',
  intro: '按最近会话或日期范围读取本机历史，比较模型用量、速度、失败与重试；只读历史，不发起模型请求。',
  filterRecent: '最近会话',
  filterRange: '日期范围',
  recentSessions: '会话数（1–100）',
  from: '开始日期',
  to: '结束日期',
  read: '读取',
  reading: '读取中…',
  loading: '正在读取本机历史…',
  unavailable: '当前宿主没有挂载会话历史查询服务，无法读取历史；模型对话本身不受影响。',
  failed: '读取失败，请稍后重试。',
  empty: '这段历史里没有 Open Design 的模型请求。',
  readFailed: '读取失败，下面的结果可能已过期。',
  invalidRange: '日期范围无效：开始日必须不晚于结束日，且跨度不超过 366 天。',
  columnModel: '模型',
  columnRequests: '请求数',
  columnTokens: 'Tokens',
  columnFirstToken: '首字延迟',
  columnDuration: '总时长',
  columnFailureRate: '失败率',
  columnRetries: '重试数',
  columnCost: '成本档位',
  columnCapability: '能力档',
  summaryRequests: '请求',
  summarySessions: '会话',
  summaryTokens: 'Token 总量',
  summaryFirstToken: '平均首字延迟',
  summaryDuration: '平均总时长',
  summaryFailureRate: '失败率',
  summaryRetries: '重试',
  summaryCoverage: '用量覆盖率',
  costLow: '低',
  costMedium: '中',
  costHigh: '高',
  costUnknown: '未知',
  capabilityStandard: '标准',
  capabilityAdvanced: '高级',
  capabilityUnknown: '未知',
  missing: '缺失',
  msUnit: '毫秒',
  historyUnsupported: '宿主未提供历史查询服务，本次没有任何历史可读。',
  historyUnreadable: '历史查询服务读取失败，本次结果不完整。',
  truncated: '历史读取达到上限，结果不完整（最多 100 个会话、20 万个事件）。',
  partialUsage: '有请求未上报用量，缺失部分不计入 Token 合计。',
  unknownModels: '有模型不在当前目录中，成本档位与能力档标为未知。',
  costNote: '成本档位来自目录的 low/medium/high 词，只表示档位，不含任何金额。',
}

/** English copy, key-for-key with {@link zh}. */
export const en: Record<AnalyticsKey, string> = {
  nav: 'Model analytics',
  title: 'Model analytics',
  intro: 'Read local history for a recent-session count or a date range to compare model usage, speed, failures and retries. History is read-only; no model request is sent.',
  filterRecent: 'Recent sessions',
  filterRange: 'Date range',
  recentSessions: 'Sessions (1–100)',
  from: 'From',
  to: 'To',
  read: 'Read',
  reading: 'Reading…',
  loading: 'Reading local history…',
  unavailable: 'This Host mounts no session-history query service, so history cannot be read. Conversations themselves are unaffected.',
  failed: 'The read failed. Try again.',
  empty: 'This history contains no Open Design model requests.',
  readFailed: 'The read failed; the result below may be out of date.',
  invalidRange: 'Invalid date range: the start must not be after the end, and the span must not exceed 366 days.',
  columnModel: 'Model',
  columnRequests: 'Requests',
  columnTokens: 'Tokens',
  columnFirstToken: 'First token',
  columnDuration: 'Duration',
  columnFailureRate: 'Failure rate',
  columnRetries: 'Retries',
  columnCost: 'Cost tier',
  columnCapability: 'Capability',
  summaryRequests: 'Requests',
  summarySessions: 'Sessions',
  summaryTokens: 'Total tokens',
  summaryFirstToken: 'Avg first token',
  summaryDuration: 'Avg duration',
  summaryFailureRate: 'Failure rate',
  summaryRetries: 'Retries',
  summaryCoverage: 'Usage coverage',
  costLow: 'Low',
  costMedium: 'Medium',
  costHigh: 'High',
  costUnknown: 'Unknown',
  capabilityStandard: 'Standard',
  capabilityAdvanced: 'Advanced',
  capabilityUnknown: 'Unknown',
  missing: 'Missing',
  msUnit: 'ms',
  historyUnsupported: 'The Host offers no history query service, so this read has no history.',
  historyUnreadable: 'The history query service failed, so this result is incomplete.',
  truncated: 'The history read hit its limit and is incomplete (at most 100 sessions and 200,000 events).',
  partialUsage: 'Some requests reported no usage; the missing part is not counted as tokens.',
  unknownModels: 'Some models are not in the current catalog, so their cost tier and capability are unknown.',
  costNote: 'The cost tier is the catalog low/medium/high word. It is a tier only and carries no amount.',
}
