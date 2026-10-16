/** 只从同一份报告派生比较结果；不读取历史、不改价格，也不随浏览器当前时间重新折算。 */
import type { AnalyticsReport, AnalyticsScenario } from '../analytics-wire.ts'

export type EstimateUnavailable = 'unavailable' | 'empty' | 'partial' | 'excluded' | 'coverage' | 'baseline' | 'recent' | 'short-range'
type Estimate = { value: number; reason?: never } | { value: null; reason: EstimateUnavailable }
export interface ScenarioComparison {
  monthly: Estimate
  difference: Estimate
  /** 正数表示比历史基准贵；基准为零时仍可比较金额，但不能计算比例。 */
  differencePercent: number | null
}

function coverageReason(report: AnalyticsReport, scenario: AnalyticsScenario): EstimateUnavailable | undefined {
  if (report.status !== 'ready') return 'unavailable'
  if (report.truncated || report.unreadableSessions > 0 || report.skippedSessions > 0) return 'partial'
  if (report.totals.requests === 0) return 'empty'
  if (scenario.excludedRequests > 0) return 'excluded'
  // 请求全部覆盖才保证比较的是同一批工作量；相同的部分覆盖数量不能证明样本相同。
  if (scenario.unknownRequests > 0 || scenario.pricedRequests !== report.totals.requests) return 'coverage'
  return undefined
}

export function compareScenario(report: AnalyticsReport, scenario: AnalyticsScenario): ScenarioComparison {
  const reason = coverageReason(report, scenario)
  let monthly: Estimate
  if (reason) monthly = { value: null, reason }
  else if (report.query.mode !== 'range') monthly = { value: null, reason: 'recent' }
  else {
    // 未来的截止日不稀释用量；使用宿主生成报告的时间，与历史总览的观察窗口一致。
    const elapsed = Math.min(report.query.to, report.generatedAt) - report.query.from
    monthly = elapsed >= 86400000
      ? { value: scenario.cost * (30 * 86400000 / elapsed) }
      : { value: null, reason: 'short-range' }
  }
  const comparisonReason = reason ?? (report.totals.pricedRequests !== report.totals.requests ? 'baseline' : undefined)
  const difference: Estimate = comparisonReason
    ? { value: null, reason: comparisonReason }
    : { value: scenario.cost - report.totals.cost }
  return {
    monthly, difference,
    differencePercent: difference.value !== null && report.totals.cost > 0
      ? difference.value / report.totals.cost * 100 : null,
  }
}
