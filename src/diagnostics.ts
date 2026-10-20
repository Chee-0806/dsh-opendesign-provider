/**
 * 脱敏诊断（ticket 06）：一份可以复制给支持人员的「当前生效配置」。
 *
 * 设计件 §7.1 把「复制当前有效配置，密钥脱敏」归在设置页的高级分区；本模块只
 * 交付数据与文本，按钮由设置页（ticket 08）接线。
 *
 * 脱敏不是「事后擦掉」，而是结构性的：构造快照的入口 {@link DiagnosticsFacts}
 * 里根本没有密钥值的槽位——凭据只有引用名与存在性，CLI 登录态只有路径与可读性。
 * 每个字段都逐项拷贝，夹带的额外属性（哪怕观察值里误塞了 `value`/`runtimeKey`）
 * 不会进入快照或文本。这是本模块唯一的硬约束，测试钉在「输出里不出现密钥」上。
 *
 * @module dsh-opendesign-provider/diagnostics
 */

import { access } from 'node:fs/promises'

import { DEFAULT_TRANSPORT_MAX_RETRIES } from './transport-retry.ts'

/** The catalog's provenance as the diagnosis reports it. */
export interface DiagnosticsCatalog {
  /** `live` when the gateway answered, `snapshot` when the static fallback is in use. */
  readonly source: 'live' | 'snapshot'
  /** Models the catalog holds. */
  readonly models: number
  /** Models the picker would list after the allowlist and per-model toggles. */
  readonly visible: number
  /** Why the live catalog was not used, when it was not. */
  readonly fallbackReason?: string | undefined
}

/** Everything the snapshot is built from. Deliberately carries no secret value. */
export interface DiagnosticsFacts {
  /** The effective model-plane base URL. */
  readonly gateway: string
  /** Catalog provenance for this read. */
  readonly catalog: DiagnosticsCatalog
  /** The credential reference in use and whether it currently resolves. */
  readonly credential: { readonly ref: string; readonly present: boolean }
  /** The CLI login-state file and whether it is readable (its contents never travel). */
  readonly cliLogin: { readonly path: string; readonly readable: boolean }
  /** Global context-window override; absent means "follow the catalog". */
  readonly contextWindow: number | undefined
  /** Per-model context-window overrides, keyed by model id. */
  readonly contextWindowOverrides: Readonly<Record<string, number>>
  /** Global output-budget ceiling; absent means "follow the model". */
  readonly maxOutputTokens: number | undefined
  /** Milliseconds allowed for the first byte. */
  readonly requestTimeoutMs: number
  /** Milliseconds a stream may stall before it is treated as dead. */
  readonly streamIdleTimeoutMs: number
  /** Transport failures one request absorbs before surfacing (absent: the default). */
  readonly transportMaxRetries?: number | undefined
  /** Codes the route declares retryable (from the error taxonomy). */
  readonly retryableCodes: readonly string[]
}

/** The redacted, copyable snapshot. Every field is a primitive or a plain copy. */
export interface DiagnosticsSnapshot {
  readonly version: 1
  readonly gateway: string
  readonly catalog: {
    readonly source: 'live' | 'snapshot'
    readonly models: number
    readonly visible: number
    readonly fallbackReason?: string
  }
  readonly credential: { readonly ref: string; readonly present: boolean }
  readonly cliLogin: { readonly path: string; readonly readable: boolean }
  readonly context: { readonly windowOverride: number | null; readonly overriddenModels: number }
  readonly output: { readonly maxTokensOverride: number | null }
  readonly timeouts: { readonly requestMs: number; readonly streamIdleMs: number }
  readonly retry: { readonly transportMaxRetries: number; readonly retryableCodes: readonly string[] }
}

/**
 * Build the redacted snapshot.
 *
 * Field-by-field on purpose: an object typed as {@link DiagnosticsFacts} may still
 * carry extra properties at runtime (a caller passing a richer observation record),
 * and copying the whole object would leak them. Nothing here ever reads a value
 * that could be a key.
 */
export function diagnosticsSnapshot(facts: DiagnosticsFacts): DiagnosticsSnapshot {
  return {
    version: 1,
    gateway: facts.gateway,
    catalog: {
      source: facts.catalog.source,
      models: facts.catalog.models,
      visible: facts.catalog.visible,
      ...(facts.catalog.fallbackReason === undefined ? {} : { fallbackReason: facts.catalog.fallbackReason }),
    },
    credential: { ref: facts.credential.ref, present: facts.credential.present === true },
    cliLogin: { path: facts.cliLogin.path, readable: facts.cliLogin.readable === true },
    context: {
      windowOverride: facts.contextWindow ?? null,
      overriddenModels: Object.keys(facts.contextWindowOverrides ?? {}).length,
    },
    output: { maxTokensOverride: facts.maxOutputTokens ?? null },
    timeouts: { requestMs: facts.requestTimeoutMs, streamIdleMs: facts.streamIdleTimeoutMs },
    retry: {
      transportMaxRetries: facts.transportMaxRetries ?? DEFAULT_TRANSPORT_MAX_RETRIES,
      retryableCodes: [...facts.retryableCodes],
    },
  }
}

/**
 * Render the snapshot as the multi-line text the settings page copies.
 *
 * One line per setting, each labelled with what it means rather than the raw key
 * name, so a pasted block reads on its own in a support thread. The first line
 * states the redaction promise; the last one lists the seconds/budget defaults
 * that are easy to get wrong when diagnosing a stall.
 */
export function formatDiagnostics(snapshot: DiagnosticsSnapshot): string {
  const catalog = snapshot.catalog.source === 'live'
    ? `实时目录（${snapshot.catalog.models} 个模型，可见 ${snapshot.catalog.visible} 个）`
    : `静态快照（${snapshot.catalog.models} 个模型，可见 ${snapshot.catalog.visible} 个${snapshot.catalog.fallbackReason === undefined ? '' : `；实时目录失败原因：${snapshot.catalog.fallbackReason}`}）`
  const credential = snapshot.credential.present ? '已配置' : '未配置'
  const window = snapshot.context.windowOverride === null
    ? `跟随目录（逐模型覆盖 ${snapshot.context.overriddenModels} 个）`
    : `${snapshot.context.windowOverride}（逐模型覆盖 ${snapshot.context.overriddenModels} 个）`
  const output = snapshot.output.maxTokensOverride === null ? '跟随模型' : String(snapshot.output.maxTokensOverride)
  return [
    'Open Design 诊断（当前生效配置；密钥只显示引用名与是否存在，不含密钥明文）',
    `网关地址：${snapshot.gateway}`,
    `目录来源：${catalog}`,
    `上下文窗口：${window}`,
    `输出上限：${output}`,
    `凭据引用：${snapshot.credential.ref}（${credential}）`,
    `CLI 登录态：${snapshot.cliLogin.path}（${snapshot.cliLogin.readable ? '可读' : '不可读'}）`,
    `请求超时：${formatDuration(snapshot.timeouts.requestMs)}；流空闲超时：${formatDuration(snapshot.timeouts.streamIdleMs)}`,
    `传输重试上限：${snapshot.retry.transportMaxRetries} 次；可重试错误码：${snapshot.retry.retryableCodes.join('、')}`,
  ].join('\n')
}

/** Milliseconds as seconds, collapsing whole seconds (`300 秒`). */
function formatDuration(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} 秒` : `${(ms / 1000).toFixed(1)} 秒`
}

/**
 * Whether the CLI login state at `path` is readable right now.
 *
 * Only the answer travels: the file's contents (which hold the desktop login's
 * runtime key) are never opened. A missing or unreadable file is a diagnosis
 * fact, not an error — the key may come from the configured reference instead.
 *
 * @param path - absolute path to `~/.amr/config.json` (or the configured override).
 * @returns true when the file exists and this process may read it.
 */
export async function cliLoginReadable(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
