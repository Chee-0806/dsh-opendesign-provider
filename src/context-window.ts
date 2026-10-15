/** 自定义上下文长度（issue #86）：按模型覆盖优先于全局值，全局值优先于目录公布值。
 * 本模块保持纯函数（无 node 依赖），浏览器设置页与 Host 侧共用同一套边界与判定。 */

/** 自定义上下文长度接受的下界（token）；0 或负数不是窗口。 */
export const CONTEXT_WINDOW_MIN = 1
/** 自定义上下文长度接受的上界（token）；覆盖任何已知模型窗口仍留有余量。 */
export const CONTEXT_WINDOW_MAX = 10_000_000

/** 源头可携带自定义上下文长度的配置面（Config 与连接选项结构相同）。 */
export interface ContextWindowOptions {
  /** 全局自定义值：覆盖目录公布值，对没有按模型覆盖的模型生效。 */
  contextWindow?: number | undefined
  /** 按模型覆盖，键为目录模型 id；优先于 {@link contextWindow}。 */
  contextWindowOverrides?: Readonly<Record<string, number>> | undefined
}

/**
 * 判定一个值能否作为自定义上下文长度：边界内的安全整数，符合宿主模型元数据约束。
 *
 * 程序化构造的连接可能绕过 schemastery 归一化，所以 `resolveAdapterOptions`
 * 也要重新判定——越界或非数值直接丢弃，回落到目录公布值，而不是让请求带着
 * 一个网关会拒绝的窗口上线。
 */
export function isValidContextWindow(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= CONTEXT_WINDOW_MIN && value <= CONTEXT_WINDOW_MAX
}

/**
 * 只接收合法条目的按模型覆盖表；空表、非对象与非法数值一律视为未设置。
 * 配置校验会拒绝非整数或越界值；本函数额外保护绕过配置校验的程序化调用，
 * 丢弃坏条目，不把非法窗口交给宿主。返回新对象；未设置时为 `undefined`。
 */
export function readContextWindowOverrides(raw: unknown): Readonly<Record<string, number>> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, number] => entry[0] !== '' && isValidContextWindow(entry[1]),
  )
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/**
 * 一次模型解析的有效上下文长度：按模型覆盖 → 全局值 → 目录公布值。
 *
 * 适配器只在有目录条目时调用（未知模型保持既有的「无上下文宣告」形状），
 * 所以 `catalog` 是已知的正数；按模型覆盖与全局值在 `resolveAdapterOptions`
 * 已清洗，这里对程序化构造的连接再判一次，坏值静默回落到目录值。
 */
export function effectiveContextWindow(
  catalog: number,
  model: string,
  options: ContextWindowOptions,
): number {
  const perModel = options.contextWindowOverrides?.[model]
  if (isValidContextWindow(perModel)) return perModel
  if (isValidContextWindow(options.contextWindow)) return options.contextWindow
  return catalog
}
