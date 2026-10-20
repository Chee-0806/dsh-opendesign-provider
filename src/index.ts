/**
 * dsh-opendesign-provider — DeepSeek Harness LLM provider plugin for Open
 * Design (unofficial).
 *
 * Registers the `open-design` provider route on `ctx.llm` and declares it in
 * the configurable-provider directory, so the web Models page shows an
 * "Open Design" card and the model picker can list its catalog. Connection
 * facts are resolved per request from the live profile Config (volatile
 * fields, unwrapped per read) and the credential seam, so a changed key or
 * endpoint reaches the next request without a restart.
 *
 * ```yaml
 * - id: llm-opendesign
 *   name: "@mars-sea/dsh-opendesign-provider"
 *   config:
 *     apiKeyEnv: OPEN_DESIGN_API_KEY
 * ```
 *
 * Ticket 02 added Chat Completions, tickets 03–07 made the catalog live and
 * added streaming, thinking, tools, the output cap, the error taxonomy and
 * images. Ticket 08 completes the credential chain (config key → credential
 * reference → the Open Design CLI login state) and serves the settings page's
 * catalog/credential facts through `opendesign/models`; the quota Remote and
 * `/opendesign` command return in P1.
 *
 * @module dsh-opendesign-provider
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { RequestErrorAction } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'

import {
  DEFAULT_API_BASE,
  DEFAULT_API_KEY_ENV,
  MODELS_CACHE_RELATIVE_PATH,
  NS,
  PROVIDER,
  PROVIDER_DISPLAY_NAME,
} from './identity.ts'
import {
  defaultAmrConfigPath,
  missingCredentialMessage,
  resolveCredentialChain,
  type CredentialChainResult,
} from './credentials.ts'
import { applyModelsRemote } from './models-remote.ts'
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenDesignAdapter,
  type OpenDesignConnectionOptions,
  type OpenDesignCredentialState,
  type OpenDesignImageEncoder,
} from './adapter.ts'
import {
  MAX_TRANSPORT_MAX_RETRIES,
  TRANSPORT_FAILURE_CODE,
  absorbTransportFailure,
  readTransportMaxRetries,
  resetTransportFailures,
  transportBudgetMessage,
  transportResetAction,
} from './transport-retry.ts'
import { absorbTransientFailure, resetTransientFailures, transientBudgetMessage } from './transient-retry.ts'
import { markVolatileFields, unwrapVolatileConfig } from './config-volatile.ts'
import {
  CONTEXT_WINDOW_MAX,
  CONTEXT_WINDOW_MIN,
  isValidContextWindow,
  readContextWindowOverrides,
} from './context-window.ts'
import {
  MAX_OUTPUT_TOKEN_LIMIT,
  OMIT_OUTPUT_TOKENS,
  isValidMaxOutputTokens,
} from './output-budget.ts'

export {
  DEFAULT_API_BASE,
  DEFAULT_API_KEY_ENV,
  MODELS_CACHE_RELATIVE_PATH,
  MODEL_CARD_KEY,
  NS,
  PACKAGE_NAME,
  PANEL_ID,
  PLUGIN_ID,
  PROVIDER,
  PROVIDER_DISPLAY_NAME,
  REMOTE_ENDPOINTS,
  REMOTE_NAMESPACE,
  REMOTE_SERVICE,
  REQUEST_TIMING_ENV,
  SETTINGS_SECTION_ID,
  STREAM_TRACE_ENV,
} from './identity.ts'
export {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenDesignAdapter,
} from './adapter.ts'
export type { OpenDesignAdapterDeps, OpenDesignConnectionOptions, OpenDesignCredentialState } from './adapter.ts'
export { diagnosticsSnapshot, formatDiagnostics } from './diagnostics.ts'
export type { DiagnosticsFacts, DiagnosticsSnapshot } from './diagnostics.ts'
export { retryableFailureCodes } from './error-taxonomy.ts'
export type { FailureCode, HttpFailureInput } from './error-taxonomy.ts'
export type {
  GatewayCatalogEntry,
  GatewayCatalogFailureReason,
  GatewayCatalogSourceKind,
  GatewayCatalogStatus,
} from './gateway-facts.ts'

export const name = 'llm-opendesign'
export const inject = ['llm']

/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-opendesign` settings-section shape. Every field is optional: a
 * missing API key resolves through {@link Config.apiKeyEnv} at each request
 * (the web Models page writes it). The Open Design CLI login state
 * (`~/.amr/config.json`) joins the chain in ticket 08.
 */
export interface Config {
  /** Credential reference (environment-variable name) resolved per request; defaults to `OPEN_DESIGN_API_KEY`. */
  apiKeyEnv?: string
  /** Literal API key override (composition config only); takes precedence over `apiKeyEnv`. */
  apiKey?: string
  /** Model-plane base URL; defaults to the Open Design gateway. */
  apiBase?: string
  /** Model catalog cache path; defaults to `~/.opendesign/models-cache.json`. */
  modelsCachePath?: string
  /**
   * Open Design CLI login state path; defaults to `~/.amr/config.json`. Overridable
   * for tests and unusual installs. This plugin only ever reads it.
   */
  amrConfigPath?: string
  /** Milliseconds to wait for a response's first byte; defaults to 300s. */
  requestTimeoutMs?: number
  /** Milliseconds a stream may stall before being treated as a dead connection; defaults to 300s. */
  streamIdleTimeoutMs?: number
  /**
   * Transport failures one request absorbs before the failure is surfaced;
   * defaults to 5. Ordinary transient errors keep their separate three-retry
   * budget; this cap exists so a dead connection cannot stall a whole turn.
   */
  transportMaxRetries?: number
  /**
   * Visible-model allowlist: catalog model ids shown in pickers. Empty or
   * unset means "show everything".
   */
  visibleModels?: string[]
  /**
   * Per-model visibility overrides from the terminal settings page's checkbox
   * list, keyed by catalog id (`true` = listed, `false` = hidden). An id here
   * decides that model on its own; an id absent here follows `visibleModels`.
   */
  modelVisibility?: Record<string, boolean>
  /**
   * Custom context length (global value): the window declared to the host
   * instead of the catalog figure, covering context accounting, compaction
   * timing and the picker label. Applies to every catalog model without a
   * {@link contextWindowOverrides} entry; unset follows the catalog.
   */
  contextWindow?: number
  /** Per-model custom context length, keyed by catalog model id; wins over the global value. */
  contextWindowOverrides?: Record<string, number>
  /**
   * Per-turn output budget ceiling. Unset follows the model's own output
   * budget; a positive integer can only tighten it; `0` means "no host
   * budget" and never tightens anything (the cap field is always sent —
   * design §4.2 — so `0` must not become a literal zero-token budget).
   */
  maxOutputTokens?: number
  /**
   * Language override for Host-side user-facing copy (`'zh'` or `'en'`,
   * default `'zh'`). The web settings page follows the browser preference on
   * its own; this knob is for commands and text surfaces.
   */
  lang?: string
}

/**
 * The Config schema: every field volatile except the composition-only `apiKey`
 * secret. Settings forms are projected from the schema's `meta.volatile`
 * nodes, so an unmarked field would be invisible to AND unwritable from the
 * settings page. The loader hands `apply()` a live reference per marked field,
 * so writes commit in place without remounting this fiber.
 */
export const Config: z<Config> = z.object(markVolatileFields({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // `role('secret')` is load-bearing: a literal key is the one credential path
  // this plugin cannot keep out of a profile Config document (the page writes
  // through the credentials seam instead), so the harness must strip it from
  // every descriptor read. DELIBERATELY not volatile: no settings surface
  // writes it, so it stays composition-only.
  apiKey: z.string().role('secret'),
  apiBase: z.string(),
  modelsCachePath: z.string(),
  amrConfigPath: z.string(),
  requestTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS),
  streamIdleTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS),
  transportMaxRetries: z.number().min(0).max(MAX_TRANSPORT_MAX_RETRIES),
  visibleModels: z.array(z.string()),
  modelVisibility: z.dict(z.boolean()),
  // 自定义上下文长度：全局值与按模型覆盖共用同一边界，越界在 schema 层就被拒绝。
  contextWindow: z.number().min(CONTEXT_WINDOW_MIN).max(CONTEXT_WINDOW_MAX).step(1),
  contextWindowOverrides: z.dict(z.number().min(CONTEXT_WINDOW_MIN).max(CONTEXT_WINDOW_MAX).step(1)),
  // 输出预算：0 表示「没有宿主预算」（不是 0 token 的预算），正数只会收紧模型预算，
  // 两者都不得超过网关的绝对上限 262144。
  maxOutputTokens: z.number().min(OMIT_OUTPUT_TOKENS).max(MAX_OUTPUT_TOKEN_LIMIT).step(1),
  lang: z.string().pattern(/^(zh|en)$/).default('zh' as const),
}, ['apiKey']))

/** One resolution's complete request facts: connection plus credential reference. */
export interface ResolvedOpenDesignOptions extends OpenDesignConnectionOptions {
  apiKeyEnv: CredentialRef
}

/**
 * The one explicit resolve step from raw config to validated connection facts.
 * Programmatic construction may bypass Schemastery normalization, so every
 * default is re-judged here — for the composition entry at load and for every
 * settings-backed read.
 */
export function resolveAdapterOptions(config: Config): ResolvedOpenDesignOptions {
  return {
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    apiBase: config.apiBase ?? DEFAULT_API_BASE,
    modelsCachePath: config.modelsCachePath ?? join(homedir(), MODELS_CACHE_RELATIVE_PATH),
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    visibleModels: Array.isArray(config.visibleModels)
      ? config.visibleModels.filter((id) => typeof id === 'string' && id !== '')
      : undefined,
    // Only real booleans survive: a hand-edited document can carry anything,
    // and a malformed flag must fall back to the array rather than hide a model.
    modelVisibility: readModelVisibility(config.modelVisibility),
    // 程序化构造可能绕过 schemastery，这里重新判定一次，越界或非数值回落。
    contextWindow: isValidContextWindow(config.contextWindow) ? config.contextWindow : undefined,
    contextWindowOverrides: readContextWindowOverrides(config.contextWindowOverrides),
    maxOutputTokens: isValidMaxOutputTokens(config.maxOutputTokens) ? config.maxOutputTokens : undefined,
    transportMaxRetries: readTransportMaxRetries(config.transportMaxRetries),
  }
}

/**
 * Per-model visibility overrides, cleaned for the adapter: a non-object or a
 * non-boolean entry is dropped rather than reaching the picker filter, and an
 * all-empty map reads as no map.
 */
function readModelVisibility(raw: unknown): Readonly<Record<string, boolean>> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, boolean] => entry[0] !== '' && typeof entry[1] === 'boolean',
  )
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

export function apply(ctx: Context, config: Config): void {
  // The raw composition config as handed to `apply`. Everything downstream
  // reads through `current()`, which unwraps volatile references on every call
  // — the loader commits a settings write IN PLACE on the reference, so a
  // cached plain snapshot would go stale on the very next write.
  const current = (): Config => unwrapVolatileConfig(config)
  const options = (): ResolvedOpenDesignOptions => resolveAdapterOptions(current())

  // The credential seam's reference layer (literal config and the CLI login
  // state are resolved by `resolveCredentialChain`). The credentials service
  // owns its own layer order; a profile without it falls back to the launch
  // environment, which is the only ambient source a headless run has.
  const resolveReference = async (reference: string): Promise<string | undefined> => {
    const ref = credentialRef(reference)
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      return hit?.value !== undefined && hit.value.length > 0 ? hit.value : undefined
    }
    const ambient = launchEnvironmentOf(ctx).get(ref)
    return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
  }

  const resolveChain = (): Promise<CredentialChainResult> => resolveCredentialChain(current(), {
    resolveReference,
  })

  const resolveApiKey = async (): Promise<string> => {
    const chain = await resolveChain()
    if (chain.apiKey === undefined) {
      throw new LlmError(missingCredentialMessage(chain.reference), 'MISSING_CREDENTIAL')
    }
    const origin = chain.source === 'literal'
      ? 'config.apiKey'
      : chain.source === 'reference'
        ? chain.reference
        : `${chain.login.path}（profiles.prod.runtimeKey）`
    return assertUsableApiKey(chain.apiKey, 'llm-opendesign', origin)
  }

  // The CLI-login key is only valid against the URL the CLI was handed; an
  // explicit apiBase always wins. Resolving the connection separately keeps
  // that decision out of the transport's wire body.
  const resolveConnection = async (connection: OpenDesignConnectionOptions): Promise<OpenDesignConnectionOptions> => {
    const chain = await resolveChain()
    return { ...connection, apiBase: chain.apiBase }
  }

  // The attachment service is an optional peer of this route: it encodes each
  // request image to the route target (ticket 07). Read through a thunk because
  // it may be composed after this plugin; a profile without it degrades an image
  // to placeholder text instead of failing the turn.
  const attachments = (): OpenDesignImageEncoder | undefined => ctx.get('attachments')

  // Diagnostics observability (ticket 06): the credential chain's safe projection
  // — reference name, whether it resolves, and the login state's path/status —
  // never a key value. A chain failure reports "unconfigured" rather than throwing.
  const credentialState = async (): Promise<OpenDesignCredentialState> => {
    try {
      const chain = await resolveChain()
      return {
        ref: chain.reference,
        present: chain.apiKey !== undefined,
        login: {
          path: chain.login.path,
          status: chain.login.status,
          hasRuntimeKey: chain.login.hasRuntimeKey,
        },
      }
    } catch {
      return {
        ref: credentialRef(current().apiKeyEnv ?? DEFAULT_API_KEY_ENV),
        present: false,
        login: { path: defaultAmrConfigPath(), status: 'unreadable', hasRuntimeKey: false },
      }
    }
  }

  const adapter = new OpenDesignAdapter({ options, resolveApiKey, resolveConnection, attachments, credentialState })

  // The Models page card. An empty `settingsPath` means the whole
  // `llm-opendesign` section configures this provider.
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: PROVIDER_DISPLAY_NAME, settingsNs: NS, settingsPath: [] },
  ])
  ctx.llm.registerAdapter([PROVIDER], adapter)

  // Browser surfaces read two Host-only facts: the catalog's provenance and
  // the credential chain's safe projection. A profile without a Typert
  // registry (headless) simply never mounts this Remote.
  applyModelsRemote(ctx, {
    catalogStatus: () => adapter.catalogStatus(),
    credentialStatus: resolveChain,
  })

  // Bounded retry for TRANSPORT failures. A connection that cannot be
  // established needs its own budget, or the shared cadence turns a 10-second
  // connect timeout into a multi-minute stall; the first few transport
  // failures are absorbed here and the rest surface with a diagnosis.
  // `dsh-llm-retry` still owns the wait between allowed attempts.
  const transportMaxRetries = (): number => readTransportMaxRetries(current().transportMaxRetries)
  // The session → agent map exists for the reset below: `session/event` carries
  // the session, and the agent is the natural budget key. Weak on BOTH sides so
  // a long-lived Host cannot be held open by sessions whose turn never ended.
  const sessionAgents = new WeakMap<object, object>()
  ctx.on('agent/request-error', async ({ agent, provider, failure, signal }, next) => {
    // Checked BEFORE the budget: a cancelled turn is the user's own stop, so it
    // must neither be answered with a retry nor consume a later live failure's slot.
    if (signal.aborted || provider !== PROVIDER) return next()
    const session: unknown = Reflect.get(agent, 'session')
    if (typeof session === 'object' && session !== null) sessionAgents.set(session, agent)
    const transient = absorbTransientFailure(agent, failure.code)
    if (transient === 'exhausted') throw new Error(transientBudgetMessage(failure.code, failure.message))
    // 只约束次数；仍由官方重试器决定退避和 Retry-After，避免即时重发。
    if (transient === 'retry') return next()
    const decision = absorbTransportFailure(agent, failure.code, transportMaxRetries())
    if (decision === 'ignored') return next()
    if (decision === 'retry') return { kind: 'retry' } satisfies RequestErrorAction
    const message = transportBudgetMessage(failure.message, transportMaxRetries())
    ctx.logger.warn(`llm-opendesign: transport retry budget exhausted for ${PROVIDER} (${TRANSPORT_FAILURE_CODE})`)
    throw new Error(message)
  })
  // Reset the budget at each new STEP — one step is exactly one model request.
  ctx.on('session/event', (session, event) => {
    const action = transportResetAction(event.type)
    if (action === 'forget') {
      sessionAgents.delete(session)
      return
    }
    if (action !== 'reset') return
    const agent = sessionAgents.get(session)
    if (agent !== undefined) {
      resetTransportFailures(agent)
      resetTransientFailures(agent)
    }
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') {
      resetTransportFailures(agent)
      resetTransientFailures(agent)
    }
  })

  // Settings is an optional service. `configure({ auto: false })` declares that
  // this plugin ships its own page, so SettingsForms publishes no auto-generated
  // form for this entry. A profile without a settings service simply keeps
  // using the composition config `apply()` was handed. The section id and the
  // profile entry id are the SAME string (`llm-opendesign`) — never rename one
  // without the other, or a mismatch strands settings in `settings.yaml.imported`.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => {
      const dispose = settingsCtx.settings.configure({ auto: false }, ctx.fiber)
      return () => {
        dispose()
      }
    }, 'dsh-opendesign-provider: settings auto-form policy')
  })
}
