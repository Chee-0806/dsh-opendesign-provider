/** Shared, dependency-free formatting for Host commands and browser surfaces. */

/** 毫秒 → 人类可读的秒数；整秒不带小数，其余保留一位。诊断与错误文案共用这一份。 */
export function formatSeconds(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} 秒` : `${(ms / 1000).toFixed(1)} 秒`
}

/**
 * 紧凑数字：K/M/B 三级，一切档位决策的唯一实现。
 *
 * 档位必须**回头判断**：先除以档位再四舍五入会算出 `999_999 → "1000.0K"`、
 * `999_999_999 → "1000.0M"` 这类既超长、又落在并不存在的档位上的结果，
 * 因此每个档位算完后若已经够到下一档，就改用下一档重算一次。
 *
 * @param value - 非负计数或词元数。
 * @param keepZeroDecimal - 整数值是否保留一位小数。词元显示沿用 `3.0B` 的旧样式；
 *   计数显示去掉多余的 `.0`，见 {@link formatCompactCount}。
 * @returns 紧凑文本；不足 1000 时原样返回该整数。
 */
function compact(value: number, keepZeroDecimal: boolean): string {
  const rounded = (scaled: number): number => Math.round(scaled * 10) / 10
  const text = (scaled: number): string => {
    const fixed = rounded(scaled)
    return keepZeroDecimal ? fixed.toFixed(1) : String(fixed)
  }
  if (value >= 1e9) return `${text(value / 1e9)}B`
  if (value >= 1e6) return rounded(value / 1e6) >= 1000 ? `${text(value / 1e9)}B` : `${text(value / 1e6)}M`
  if (value >= 1e3) return rounded(value / 1e3) >= 1000 ? `${text(value / 1e6)}M` : `${text(value / 1e3)}K`
  return String(value)
}

/**
 * 紧凑计数：请求数、成功/失败数这类会被窄卡片截断的整数。
 * `1234` → `1.2K`、`12000` → `12K`、`1500000` → `1.5M`，整数不带多余的 `.0`。
 */
export function formatCompactCount(value: number): string {
  return compact(value, false)
}

/** 紧凑词元数：与 {@link formatCompactCount} 共用档位，但整数值保留一位小数（`3.0B`）。 */
export function formatTokensCompact(value: number): string {
  return compact(value, true)
}

/**
 * 精确值悬停提示：只在紧凑显示确实丢了信息时才返回文本。
 * 未换算时悬停弹出的文字与卡片上写的一模一样，没有意义，因此返回 `undefined` 让调用方
 * 整个省略 `title`，而不是挂一个内容重复的提示。
 *
 * @param parts - 标签与精确数值，按卡片上的显示顺序。
 * @returns 形如 `请求数 1234567 · 成功 1234567 · 失败 123` 的提示，或 `undefined`。
 */
export function compactCountTitle(parts: readonly (readonly [string, number])[]): string | undefined {
  return parts.some(([, value]) => formatCompactCount(value) !== String(value))
    ? parts.map(([label, value]) => `${label} ${value}`).join(' · ')
    : undefined
}

/** The input is already in percent units; callers add the percent sign. */
export function formatSuccessRate(value: number): string {
  return String(Number(value.toFixed(2)))
}

/** One window's fill ratio in [0, 1]; zero when uncapped. */
export function windowRatio(used: number, cap: number): number {
  if (cap <= 0) return 0
  return Math.max(0, Math.min(1, used / cap))
}

/** Local date-time, with the empty state chosen by the caller. */
export function formatResetAt(ms: number): string {
  return ms <= 0 ? '' : new Date(ms).toLocaleString()
}

/** 只有官方汇总与订阅共同确认同一起点，才展示完整账期；旧宿主和部分响应保持未知。 */
export function formatUsageBillingPeriod(usageStart: number | undefined, planStart: number | undefined, planEnd: number | undefined): string {
  if (usageStart === undefined || planStart !== usageStart || planEnd === undefined || usageStart <= 0 || planEnd <= usageStart) return ''
  const start = new Date(usageStart)
  const end = new Date(planEnd)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return ''
  return `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`
}
