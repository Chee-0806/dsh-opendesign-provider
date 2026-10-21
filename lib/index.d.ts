import z from "@deepseek-ai/schemastery";
import { GenerateOptions, LlmAdapter, LlmError, LlmImageRequestPricing, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from "@deepseek-ai/dsh-llm";
import { CredentialRef } from "@deepseek-ai/dsh-credentials";
import { InvocationDescriptor, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { Context } from "@deepseek-ai/cordis";
import { ImageAttachmentRef, ImageRequestTarget, RequestImageAttachment } from "@deepseek-ai/dsh-attachment";
import { CommandDefinition } from "@deepseek-ai/dsh-commands";
//#region src/catalog-snapshot.d.ts
/**
 * The 12 Open Design models this bundle ships knowledge about.
 *
 * The gateway's `GET /v1/models` is the authority once it answers (ticket 03
 * reads it); this snapshot is the offline truth the adapter falls back to when
 * the gateway is unreachable, unauthorised or malformed, and it stays the
 * source of display names, reasoning domains and modalities for ids it knows.
 *
 * Two readings in the table are deliberate and must not be "corrected":
 *
 * - `contextWindow` is the gateway's `context_budget` (usable input budget),
 *   NOT the nominal `context_limit` — the difference is the room the gateway
 *   reserves for the reply.
 * - `kimi-k2.7-code` advertises `maxTokens = 65536` even though its
 *   `output_budget` is 32000, because its medium/high thinking levels require
 *   `max_completion_tokens` to exceed the level's thinking budget (32768).
 *
 * Data comes from `docs/opendesign/00-改造设计.md` §5.2 and
 * `docs/grill/20261020-opendesign-facts-local.md` §5.
 *
 * @module dsh-opendesign-provider/catalog-snapshot
 */
/** A reasoning level DeepSeek Harness can select, least to greatest. */
type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** The vendor's own cost word for a model (`metadata.cost`). */
type ModelCostTier = 'low' | 'medium' | 'high';
/** The vendor's own capability word for a model (`metadata.capability`). */
type ModelCapabilityTier = 'standard' | 'advanced';
/** An input modality the gateway publishes in `architecture.input_modalities`. */
type CatalogInputModality = 'text' | 'image' | 'file' | 'audio' | 'video';
//#endregion
//#region src/gateway-facts.d.ts
/** 目录当前来源：网关实时公布，或内置静态快照。 */
type GatewayCatalogSourceKind = 'live' | 'static';
/** 回落到静态快照的原因；作为数据交给设置页，不写进对话错误。 */
type GatewayCatalogFailureReason = 'auth' | 'unreachable' | 'protocol' | 'http' | 'missing-credential';
/** 合并后的一条目录条目：选择器、模型卡与设置页共用。 */
interface GatewayCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly cost: ModelCostTier;
  readonly capability: ModelCapabilityTier;
  readonly inputModalities: readonly CatalogInputModality[];
  readonly reasoningLevels: readonly ReasoningLevel[];
  readonly default: boolean;
  /** 静态快照认识这个 id（显示名与思考域可信）；否则为 `false`（未校准）。 */
  readonly calibrated: boolean;
}
/** 目录状态：来源、绑定地址、条目与回落原因，供设置页/模型卡读取。 */
interface GatewayCatalogStatus {
  readonly source: GatewayCatalogSourceKind;
  /** 本次目录绑定的网关地址（已去掉尾部斜杠）。 */
  readonly apiBase: string;
  readonly models: readonly GatewayCatalogEntry[];
  /** 本次是否直接来自磁盘缓存（没有发起网络请求）。 */
  readonly cached: boolean;
  /** 最近一次成功拉取的时间（epoch ms）；静态快照没有该字段。 */
  readonly fetchedAt?: number | undefined;
  /** 回落到静态快照的原因；`source === 'live'` 时不存在。 */
  readonly reason?: GatewayCatalogFailureReason | undefined;
}
//#endregion
//#region src/request-content.d.ts
/**
 * 宿主附件服务里本插件用到的那一片：把一张托管图片编码成请求版本。
 *
 * 故意只声明用到的能力，`ctx.attachments` 天然满足它。
 */
interface OpenDesignImageEncoder {
  /** Encode one normalized attachment to the request target (dimensions + byte budget). */
  readImageRequest(ref: ImageAttachmentRef, target: ImageRequestTarget, signal?: AbortSignal): Promise<RequestImageAttachment>;
}
//#endregion
//#region src/messages-transport.d.ts
/** Which wire protocol one call uses. */
type TransportKind = 'chat' | 'messages';
/** The user-visible protocol setting (design §4.1, ticket 13). */
type ProtocolSetting = TransportKind | 'auto';
//#endregion
//#region src/credentials.d.ts
/**
 * The credential chain and the Open Design CLI login state.
 *
 * Resolution is deliberately one ordered pass, and only the parts that need
 * I/O are asynchronous:
 *
 * 1. `config.apiKey` — a literal key written into the composition;
 * 2. the credential reference `config.apiKeyEnv` (default
 *    `OPEN_DESIGN_API_KEY`) through the harness credential seam;
 * 3. `~/.amr/config.json` → `profiles.prod.runtimeKey`, the desktop/CLI login
 *    state (`vela login` writes it). This layer is consulted ONLY when neither
 *    of the first two has a value.
 *
 * The gateway address follows the source: an explicit `config.apiBase` always
 * wins; a key taken from the CLI login state uses that state's server-issued
 * `linkUrl` (never a guessed domain); everything else falls back to the
 * published gateway. The live `linkUrl` is the model-plane HOST without the
 * `/v1` prefix (`vela login` writes `https://amr-link.open-design.ai`), so a
 * bare origin gets `/v1` appended — see {@link cliLoginApiBase}.
 *
 * This module READS that file and nothing else: it never writes it, never logs
 * a field value, and the diagnostic formatter emits only names, presence and
 * provenance. The control key never leaves this module — ticket 08 exposes its
 * availability as a boolean only; the quota feature that consumes the value
 * arrives in P1.
 *
 * @module dsh-opendesign-provider/credentials
 */
/** How one attempt to read the CLI login state ended. */
type CliLoginStatus = 'ok' | 'missing' | 'malformed' | 'unreadable';
//#endregion
//#region src/diagnostics.d.ts
/** The catalog's provenance as the diagnosis reports it. */
interface DiagnosticsCatalog {
  /** `live` when the gateway answered, `snapshot` when the static fallback is in use. */
  readonly source: 'live' | 'snapshot';
  /** Models the catalog holds. */
  readonly models: number;
  /** Models the picker would list after the allowlist and per-model toggles. */
  readonly visible: number;
  /** Why the live catalog was not used, when it was not. */
  readonly fallbackReason?: string | undefined;
}
/** Everything the snapshot is built from. Deliberately carries no secret value. */
interface DiagnosticsFacts {
  /** The effective model-plane base URL. */
  readonly gateway: string;
  /** Catalog provenance for this read. */
  readonly catalog: DiagnosticsCatalog;
  /** The credential reference in use and whether it currently resolves. */
  readonly credential: {
    readonly ref: string;
    readonly present: boolean;
  };
  /**
   * The CLI login state as the credential chain read it: path, reading status and
   * whether a runtime key was found. Values never travel.
   */
  readonly cliLogin: {
    readonly path: string;
    readonly status: CliLoginStatus;
    readonly hasRuntimeKey: boolean;
  };
  /** Global context-window override; absent means "follow the catalog". */
  readonly contextWindow: number | undefined;
  /** Per-model context-window overrides, keyed by model id. */
  readonly contextWindowOverrides: Readonly<Record<string, number>>;
  /** Global output-budget ceiling; absent means "follow the model". */
  readonly maxOutputTokens: number | undefined;
  /** Milliseconds allowed for the first byte. */
  readonly requestTimeoutMs: number;
  /** Milliseconds a stream may stall before it is treated as dead. */
  readonly streamIdleTimeoutMs: number;
  /** Transport failures one request absorbs before surfacing (absent: the default). */
  readonly transportMaxRetries?: number | undefined;
  /** Codes the route declares retryable (from the error taxonomy). */
  readonly retryableCodes: readonly string[];
}
/** The redacted, copyable snapshot. Every field is a primitive or a plain copy. */
interface DiagnosticsSnapshot {
  readonly version: 1;
  readonly gateway: string;
  readonly catalog: {
    readonly source: 'live' | 'snapshot';
    readonly models: number;
    readonly visible: number;
    readonly fallbackReason?: string;
  };
  readonly credential: {
    readonly ref: string;
    readonly present: boolean;
  };
  readonly cliLogin: {
    readonly path: string;
    readonly status: CliLoginStatus;
    readonly hasRuntimeKey: boolean;
  };
  readonly context: {
    readonly windowOverride: number | null;
    readonly overriddenModels: number;
  };
  readonly output: {
    readonly maxTokensOverride: number | null;
  };
  readonly timeouts: {
    readonly requestMs: number;
    readonly streamIdleMs: number;
  };
  readonly retry: {
    readonly transportMaxRetries: number;
    readonly retryableCodes: readonly string[];
  };
}
/**
 * Build the redacted snapshot.
 *
 * Field-by-field on purpose: an object typed as {@link DiagnosticsFacts} may still
 * carry extra properties at runtime (a caller passing a richer observation record),
 * and copying the whole object would leak them. Nothing here ever reads a value
 * that could be a key.
 */
declare function diagnosticsSnapshot(facts: DiagnosticsFacts): DiagnosticsSnapshot;
/**
 * Render the snapshot as the multi-line text the settings page copies.
 *
 * One line per setting, each labelled with what it means rather than the raw key
 * name, so a pasted block reads on its own in a support thread. The first line
 * states the redaction promise; the last one lists the retry budget and the codes
 * the engine may retry, which is what a stall or a retry storm is diagnosed on.
 */
declare function formatDiagnostics(snapshot: DiagnosticsSnapshot): string;
//#endregion
//#region src/adapter.d.ts
/** Default budget for the first byte of a response. */
declare const DEFAULT_REQUEST_TIMEOUT_MS = 300000;
/** Default budget for a stream that stalls after connecting. */
declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/** The request facts one call is assembled from. All values are already resolved. */
interface OpenDesignConnectionOptions {
  apiBase: string;
  modelsCachePath: string;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  visibleModels?: readonly string[] | undefined;
  modelVisibility?: Readonly<Record<string, boolean>> | undefined;
  contextWindow?: number | undefined;
  contextWindowOverrides?: Readonly<Record<string, number>> | undefined;
  maxOutputTokens?: number | undefined;
  /** Transport failures one request absorbs; absent reports the default in diagnostics. */
  transportMaxRetries?: number | undefined;
  /**
   * Which wire protocol conversations use (ticket 13): `'auto'` (default) keeps
   * Chat Completions and sends only the models whose thinking is invisible there
   * to Anthropic Messages; `'chat'` / `'messages'` force one face for every model.
   */
  protocol?: ProtocolSetting | undefined;
}
/** One observed automatic fallback, as handed to `onTransportFallback`. */
interface TransportFallbackEvent {
  readonly model: string;
  readonly from: TransportKind;
  readonly to: TransportKind;
  readonly reason: string;
}
/**
 * Credential observability for the diagnostics snapshot (ticket 06): the reference
 * name, whether it resolves, and whether the CLI login state is readable. Never a
 * key value — the type has no slot for one.
 */
interface OpenDesignCredentialState {
  readonly ref: string;
  readonly present: boolean;
  /** The CLI login state as the credential chain read it (path, status, key presence). */
  readonly login: {
    readonly path: string;
    readonly status: CliLoginStatus;
    readonly hasRuntimeKey: boolean;
  };
}
/** Everything the adapter needs from its owning plugin instance. */
interface OpenDesignAdapterDeps {
  /** Read the live connection facts for one call. */
  options: () => OpenDesignConnectionOptions;
  /** Resolve the bearer key for one call (literal → credential ref → CLI login). */
  resolveApiKey: (connection: OpenDesignConnectionOptions) => Promise<string>;
  /**
   * Resolve request facts that depend on WHERE the key came from: a key from
   * the CLI login state uses that state's server-issued `linkUrl`, while an
   * explicit key keeps the configured/default gateway. Optional so tests and
   * programmatic adapters can omit it; the plugin entry supplies it.
   */
  resolveConnection?: (connection: OpenDesignConnectionOptions) => Promise<OpenDesignConnectionOptions> | OpenDesignConnectionOptions;
  /**
   * Read the host attachment service, when one is mounted. Read per call: the
   * service may be composed after this plugin. Without it, an image can only be
   * described to the model in text — it cannot be encoded for the wire.
   */
  attachments?: (() => OpenDesignImageEncoder | undefined) | undefined;
  /**
   * Read credential/CLI observability for {@link OpenDesignAdapter.diagnostics}.
   * Omitted means "unknown": the snapshot then reports the default reference as
   * unconfigured. Read per call, exactly like {@link OpenDesignAdapterDeps.options}.
   */
  credentialState?: (() => Promise<OpenDesignCredentialState> | OpenDesignCredentialState) | undefined;
  /**
   * Observe one automatic transport fallback (`auto`/`messages` → `chat`,
   * ticket 13). The plugin entry turns it into a single log line; a test can
   * read {@link OpenDesignAdapter.transportFallbacks} instead.
   */
  onTransportFallback?: ((event: TransportFallbackEvent) => void) | undefined;
  /** Test seam for the HTTP call. */
  fetchImpl?: typeof fetch;
  /** Test seam for catalog TTLs; defaults to `Date.now`. */
  now?: () => number;
}
/** The Open Design adapter: catalog plus the Chat Completions transport. */
declare class OpenDesignAdapter extends LlmAdapter {
  private readonly deps;
  private readonly catalog;
  /** Models that asked for Messages and found the gateway not serving it (ticket 13). */
  private readonly fallbacks;
  constructor(deps: OpenDesignAdapterDeps);
  /**
   * The engine's retry decision for this route, declared from the classification
   * table: only `EMPTY_RESPONSE` / `RATE_LIMIT` / `TIMEOUT` / `TRANSIENT` /
   * `TRANSPORT` are worth another attempt. `AUTH`, `QUOTA_EXHAUSTED`,
   * `BAD_REQUEST` and `PROTOCOL_ERROR` fail identically every time, so declaring
   * them non-retryable is what keeps a deterministic 400 from burning quota.
   */
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy;
  /** Report the route under the product name, preserving the engine's id. */
  providerInfo(provider: string): LlmProviderInfo;
  /**
   * The models the picker may list: the gateway's live directory when it
   * answers (per-key, so possibly fewer or more than the 12 known models),
   * otherwise the static snapshot. Filtered by the allowlist and the
   * per-model toggles, in the design's display order.
   */
  listModels(provider: string): Promise<readonly LlmModelInfo[]>;
  /**
   * The catalog's provenance as data for the settings page and model cards
   * (ticket 08): which gateway it is bound to, whether it is live or the
   * static snapshot, why it fell back, and which entries are uncalibrated.
   */
  catalogStatus(): Promise<GatewayCatalogStatus>;
  /**
   * The redacted "current effective configuration" block (ticket 06).
   *
   * This is the data half of the settings page's copy button; the button itself
   * belongs to ticket 08. The catalog is read from memory, never the network: the
   * snapshot reports what conversations would use right now, and a diagnostic must
   * never become the outage (or stall the page). `./diagnostics.ts`'s
   * `formatDiagnostics` renders the copyable text.
   */
  diagnostics(): Promise<DiagnosticsSnapshot>;
  /**
   * Everything the harness needs for one exact model: the usable context
   * window (custom overrides included), the output budget it will request, the
   * levels this model accepts, and whether images fit.
   */
  resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo>;
  /**
   * The request-image projection this route asks the host for: long edge 1568
   * and a 1 MiB encoded budget (see `./image-request.ts`). It is the same target
   * `stream()` encodes to, so any preview computed elsewhere matches the bytes
   * that actually travel.
   */
  imageRequestTarget(_provider: string, _model: string, image: ImageAttachmentRef): ImageRequestTarget;
  /**
   * Vision-token pricing for the meter (see `./image-tokens.ts`).
   *
   * A model the catalog calls image-capable pays its family's published rule. An
   * offloaded occurrence, and every image on a route that takes text only,
   * travels as placeholder text instead of pixels: 0 visual tokens plus that
   * exact text, so the meter counts what the model actually reads. A model
   * neither catalog nor snapshot knows declares nothing here.
   */
  imageRequestPricing(_provider: string, model: string): LlmImageRequestPricing | undefined;
  /**
   * One streaming Chat Completions call, mapped onto the chunk protocol.
   *
   * The request sends only the fields the gateway actually honours: the model
   * id, the mapped messages, `stream: true` with `stream_options.include_usage`
   * so the usage tail frame arrives, `max_completion_tokens` and the model's own
   * `reasoning_effort`. It never sends `max_tokens` (no model honours it),
   * `store` (server-side default) or `temperature` (unverified).
   *
   * Deltas are yielded as they land, so the reply is visible while it is still
   * being generated (ticket 04).
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
  /**
   * The automatic transports that fell back to Chat, as data (ticket 13).
   *
   * One entry per model that ever asked for Messages and found the gateway not
   * serving it; the settings page's diagnostics and the plugin's log line both
   * read this instead of a mutable global.
   */
  transportFallbacks(): ReadonlyArray<{
    model: string;
    from: TransportKind;
    reason: string;
  }>;
  /**
   * One streaming Chat Completions call (ticket 04), the default transport.
   *
   * The request sends only the fields the gateway actually honours: the model
   * id, the mapped messages, `stream: true` with `stream_options.include_usage`
   * so the usage tail frame arrives, `max_completion_tokens` and the model's own
   * `reasoning_effort`. It never sends `max_tokens` (no model honours it),
   * `store` (server-side default) or `temperature` (unverified).
   */
  private streamChat;
  /**
   * One streaming Anthropic Messages call (ticket 13), the optional transport.
   *
   * The endpoint and body are Anthropic-shaped (see `./messages-transport.ts`):
   * `{apiBase}/messages`, a mandatory `anthropic-version` header, `max_tokens`
   * carrying the same effective output cap, and none of the Chat-only fields.
   * The bearer key comes from the same credential chain.
   */
  private streamMessages;
  /** Remember that Messages did not work for this model, and say so once. */
  private rememberFallback;
  /**
   * Load the catalog for listing/status. Never throws: a gateway failure is a
   * fallback to the static snapshot with the reason recorded for ticket 08.
   */
  private loadCatalog;
  /** The in-memory catalog for the conversation path; never touches the network. */
  private currentCatalog;
  /** The catalog's binding: one normalized gateway address plus one cache file. */
  private catalogTarget;
}
//#endregion
//#region src/identity.d.ts
/**
 * Every product-facing name this bundle owns, in one place.
 *
 * The provider route, settings namespace, credential reference, Remote
 * namespace, cache path and browser slot ids must agree across the Host half,
 * the browser half, `package.json` and `cordis.patch.yml`. Scattering them is
 * how the previous incarnation ended up with two competing identities, so
 * nothing else in `src/` (or `tests/`) spells these literals out.
 *
 * This module deliberately imports nothing: the browser bundle inlines it, and
 * a `node:os`/`node:path` import here would break that bundle. Host code joins
 * {@link MODELS_CACHE_RELATIVE_PATH} onto the user's home directory itself.
 *
 * @module dsh-opendesign-provider/identity
 */
/** The npm package name, as the loader resolves it from the profile. */
declare const PACKAGE_NAME = "@mars-sea/dsh-opendesign-provider";
/** The single LLM route this plugin owns. */
declare const PROVIDER = "open-design";
/** The name shown in the Models page, the settings page and errors. */
declare const PROVIDER_DISPLAY_NAME = "Open Design";
/** The settings namespace and plugin-row id (`llm-opendesign`). */
declare const NS = "llm-opendesign";
/** The plugin row id inserted by `cordis.patch.yml`. */
declare const PLUGIN_ID = "llm-opendesign";
/** The credential reference the Models page writes when no literal key is set. */
declare const DEFAULT_API_KEY_ENV = "OPEN_DESIGN_API_KEY";
/** The model plane's default base URL (the CLI login state can override it). */
declare const DEFAULT_API_BASE = "https://amr-link.open-design.ai/v1";
/** Model-catalog cache, relative to the user's home directory. */
declare const MODELS_CACHE_RELATIVE_PATH = ".opendesign/models-cache.json";
/** The wire namespace shared by every Remote this plugin serves. */
declare const REMOTE_NAMESPACE = "opendesign";
/**
 * The Cordis service key the Gateway resolves the models Remote from. Cordis
 * allows one service per key, so the quota Remote (ticket 10) provides its own
 * key — see `QUOTA_SERVICE` in `quota-wire.ts`.
 */
declare const REMOTE_SERVICE = "opendesignUsage";
/** The endpoint names under {@link REMOTE_NAMESPACE}. */
declare const REMOTE_ENDPOINTS: readonly ["report", "usage", "models", "analytics"];
/** The settings-page slot id (`settings.section`). */
declare const SETTINGS_SECTION_ID = "opendesign";
/** The analytics page's own `settings.section` id (ticket 12). */
declare const ANALYTICS_SECTION_ID = "opendesign-analytics";
/** Locale namespace the analytics page declares for its own copy. */
declare const ANALYTICS_LOCALE_NS = "analytics.opendesign";
/** The Models-page provider-card key (`settings.models.provider-card`). */
declare const MODEL_CARD_KEY = "llm-opendesign";
/** The quota panel's `main` / `sidebar.footer.action` id. */
declare const PANEL_ID = "opendesign-panel";
/** Opt-in raw request-timing trace environment variable. */
declare const REQUEST_TIMING_ENV = "DSH_OPENDESIGN_TIMING";
/** Opt-in raw stream-trace environment variable. */
declare const STREAM_TRACE_ENV = "DSH_OPENDESIGN_TRACE";
//#endregion
//#region src/control-plane.d.ts
/**
 * 控制面额度只读客户端（ticket 10）。
 *
 * 模型面没有任何用量端点（实测 404），额度与限流窗口只存在于控制面。这里只发
 * 三个 **GET**，绝不写：当前工作区（拿 `activeWorkspaceId`）、账单摘要（档位、
 * 余额、`creditsPerUsd`、订阅周期）、按模型的额度预检（`codingPlan.windows[]`
 * 与 `funding`）。鉴权是 `Authorization: Bearer <controlKey>`，密钥只从
 * `~/.amr/config.json` 的 CLI 登录态读，绝不来自插件配置，也绝不出现在任何
 * 返回值、日志或错误文案里。
 *
 * 对外只暴露冻结的 {@link QuotaSnapshot}（spec §额度）。窗口按
 * `durationSeconds` 分类：18000 = 5 小时、604800 = 7 天，其余 `other` 原样列出。
 * `creditsPerUsd` 只用于把 credits 折算成展示当量，因此留在 Host 侧的
 * {@link QuotaReading} 里，不进快照形状。
 *
 * 降级：没有控制密钥（未登录 CLI / 登录态文件缺失或损坏）时快照的
 * `controlPlaneAvailable` 为 `false` 并给出原因；查询失败保留上一次成功的值并
 * 标注 `stale`。任何一条路径都不抛错——额度是增强，推理不依赖它。
 *
 * @module dsh-opendesign-provider/control-plane
 */
/** 控制面基址（登录态没有带 `apiUrl` 时的兜底）。 */
declare const DEFAULT_CONTROL_PLANE_API_URL = "https://amr-api.open-design.ai";
/** 单次控制面请求的超时（spec §额度）。 */
declare const CONTROL_PLANE_TIMEOUT_MS = 8000;
/** 额度缓存有效期：命令与 Remote 共用同一份（spec §额度）。 */
declare const QUOTA_CACHE_TTL_MS = 60000;
/** 实测的 5 小时窗口时长。 */
declare const QUOTA_FIVE_HOUR_SECONDS = 18000;
/** 实测的 7 天窗口时长。 */
declare const QUOTA_SEVEN_DAY_SECONDS = 604800;
/** 冻结的窗口分类；未知时长归 `other` 并原样列出。 */
type QuotaWindowKind = 'five_hour' | 'seven_day' | 'other';
/** 一个限额窗口，单位是 credits（不是美元）。 */
interface QuotaWindow {
  kind: QuotaWindowKind;
  durationSeconds: number;
  usedCredits: number;
  limitCredits: number;
  remainingCredits: number;
  resetsAt?: string;
  resetMode?: string;
}
/**
 * 冻结的额度快照（spec §额度）。`controlPlaneAvailable: false` 表示控制面不可用
 * （无控制密钥、未登录或查询失败），此时 `windows` 为空；其余字段都是可选事实，
 * 缺席即「控制面没给」，不用零值冒充。
 */
interface QuotaSnapshot {
  controlPlaneAvailable: boolean;
  tier?: string;
  subscriptionStatus?: string;
  currentPeriodEnd?: string;
  balanceUsd?: number;
  funding?: 'wallet' | 'coding_plan';
  windows: QuotaWindow[];
  fetchedAt: string;
  stale?: boolean;
}
/** 快照不可用的原因，只用于 Host 侧文案（不进冻结契约）。 */
type QuotaUnavailableReason = 'no-control-key' | 'login-unavailable' | 'unreachable';
/** 一次读取：冻结快照 + 只用于展示折算的 `creditsPerUsd` + 降级原因。 */
interface QuotaReading {
  snapshot: QuotaSnapshot;
  creditsPerUsd?: number;
  reason?: QuotaUnavailableReason;
}
/** 客户端接缝：测试注入 fetch、时钟与登录态文件路径。 */
interface ControlPlaneDeps {
  /**
   * CLI 登录态路径（或一个读当前配置的取值器，设置页改路径后立即生效）；
   * 默认 `~/.amr/config.json`。
   */
  loginPath?: string | (() => string | undefined);
  /** 登录态读取接缝；默认走 `node:fs/promises`。 */
  readFile?: (path: string) => Promise<string>;
  /** fetch 接缝；默认 Node 原生 `fetch`（可过 Cloudflare）。 */
  fetchImpl?: typeof fetch;
  /** 时钟接缝，返回毫秒时间戳。 */
  now?: () => number;
  /** 覆盖超时；默认 {@link CONTROL_PLANE_TIMEOUT_MS}。 */
  timeoutMs?: number;
  /** 覆盖缓存 TTL；默认 {@link QUOTA_CACHE_TTL_MS}。 */
  cacheTtlMs?: number;
}
/** 一次 `read()` 的输入：预检要按模型问。 */
interface QuotaRequest {
  /** 目录里的当前/默认模型；缺席时跳过预检，只报账单摘要。 */
  model?: string;
  /** 跳过缓存强制刷新。 */
  force?: boolean;
}
/** 窗口分类：只认实测的两个时长，其余一律 `other`。 */
declare function classifyQuotaWindow(durationSeconds: number): QuotaWindowKind;
/**
 * 只读额度客户端：一次 `read()` 依次问三个接口，解析成冻结快照。
 *
 * Host 侧 60 秒缓存，命令与 Remote 共用同一实例，因此两条展示面永远同一份数据。
 */
declare class OpenDesignControlPlane {
  private readonly deps;
  private last?;
  private lastAttemptAt?;
  constructor(deps?: ControlPlaneDeps);
  /** 读一次额度：缓存命中直接返回，否则刷新；任何失败都降级而不抛错。 */
  read(request?: QuotaRequest): Promise<QuotaReading>;
  /** 当前登录态（不缓存：文件很小，且用户随时可能 `vela login`）。 */
  private login;
  /** 三个 GET 的串行真相：工作区 → 摘要 → 预检（预检需要工作区 id）。 */
  private query;
}
//#endregion
//#region src/quota-wire.d.ts
/** Canonical `<namespace>/<method>` endpoint of the quota snapshot. */
declare const QUOTA_ENDPOINT = "opendesign/usage";
/** Strictly parse one untrusted `opendesign/usage` result. */
declare function parseQuotaSnapshot(value: unknown): QuotaSnapshot;
/** The Host descriptor for `opendesign/usage`. */
declare const QUOTA_DESCRIPTOR: InvocationDescriptor;
//#endregion
//#region src/quota-remote.d.ts
/** Everything the service reads beyond its Cordis context. */
interface OpenDesignQuotaDeps {
  /** One quota reading (the Host's 60-second cache lives behind this thunk). */
  quota: () => Promise<QuotaReading>;
}
/** The Cordis service the Typert Gateway resolves by {@link QUOTA_SERVICE}. */
declare class OpenDesignQuotaService extends TypertRemoteService {
  private readonly deps;
  constructor(ctx: Context, deps: OpenDesignQuotaDeps);
  /** The frozen snapshot, `stale` flag and all — never a raw control-plane page. */
  usage(): Promise<QuotaSnapshot>;
}
/**
 * Provide the service and register its descriptor on an optional Typert
 * registry. A profile without the registry never reaches the callback.
 */
declare function applyQuotaRemote(ctx: Context, deps: OpenDesignQuotaDeps): void;
//#endregion
//#region src/command-locales.d.ts
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
type LocaleId = 'zh' | 'en';
//#endregion
//#region src/commands.d.ts
/** 命令需要的东西，全部由插件入口注入（测试直接给夹具）。 */
interface OpendesignCommandDeps {
  /** 读一次额度；Host 侧客户端内部做 60 秒缓存，参数是预检模型。 */
  quota: (model?: string) => Promise<QuotaReading>;
  /** 当前会话/默认模型（取目录默认模型）；缺席时跳过预检、只报账单摘要。 */
  model?: () => Promise<string | undefined>;
  /** 活动语言；Host 命令读不到 `ctx.locale`，所以从这里进来。 */
  getLocale?: () => LocaleId;
}
/** 把一次读取渲染成完整的纯文本看板。 */
declare function renderQuota(reading: QuotaReading, locale: LocaleId): string;
/** 唯一的 `/opendesign` 命令定义。 */
declare function commandDefinition(deps: OpendesignCommandDeps): CommandDefinition;
/** 在 `ctx.commands` 上注册命令（插件入口调用；`commands` 是可选服务）。 */
declare function applyCommands(ctx: Context, deps: OpendesignCommandDeps): void;
//#endregion
//#region src/error-taxonomy.d.ts
/** 一次失败的 HTTP 交换：状态、原始响应体、`content-type` 与 `Retry-After`。 */
interface HttpFailureInput {
  /** HTTP status observed at the gateway. */
  status: number;
  /** Raw response body, as received (may be JSON, plain text or HTML). */
  body?: string | undefined;
  /** `content-type` header, used only to tell an HTML error page from a text one. */
  contentType?: string | null | undefined;
  /** `retry-after` header verbatim (seconds or an HTTP date). */
  retryAfter?: string | null | undefined;
}
/**
 * The failure codes this route reports.
 *
 * Deterministic request failures (`AUTH`, `QUOTA_EXHAUSTED`, `BAD_REQUEST`,
 * `PROTOCOL_ERROR`) repeat identically on every attempt, so they stay out of
 * {@link retryableFailureCodes}. `TRANSPORT` is the connection-level failure the
 * adapter's request wrapper reports (its own budget lives in `transport-retry.ts`).
 */
type FailureCode = 'AUTH' | 'QUOTA_EXHAUSTED' | 'BAD_REQUEST' | 'PROTOCOL_ERROR' | 'RATE_LIMIT' | 'TRANSIENT' | 'TRANSPORT' | 'EMPTY_RESPONSE' | 'TIMEOUT';
/** The retryable set, as data, for the route's `providerRetryPolicy`. */
declare function retryableFailureCodes(): readonly FailureCode[];
//#endregion
//#region src/analytics-wire.d.ts
/** The cheapest-to-most-expensive catalog word; `unknown` = catalog has no entry. */
type AnalyticsCostTier = 'low' | 'medium' | 'high' | 'unknown';
/** The catalog capability word; `unknown` = catalog has no entry. */
type AnalyticsCapabilityTier = 'standard' | 'advanced' | 'unknown';
/** The most recent N sessions that contain at least one Open Design request. */
interface AnalyticsRecentScope {
  readonly kind: 'recent';
  /** 1–100, newest first by the session's last Open Design request. */
  readonly sessions: number;
}
/** Half-open `[from, to)` local-calendar window, at most 366 days. */
interface AnalyticsRangeScope {
  readonly kind: 'range';
  readonly from: number;
  readonly to: number;
}
/** The one filter the page submits; a scope, never free text. */
type AnalyticsScope = AnalyticsRecentScope | AnalyticsRangeScope;
/** One `opendesign/analytics` invocation. */
interface AnalyticsQuery {
  readonly scope: AnalyticsScope;
}
/** Token, timing, outcome and usage-coverage counters for one model. */
interface AnalyticsModelRow {
  readonly model: string;
  readonly name: string;
  readonly cost: AnalyticsCostTier;
  readonly capability: AnalyticsCapabilityTier;
  /** Whether the current model-visibility rule would list this id. */
  readonly visible: boolean;
  /** Whether the static snapshot knows this id. */
  readonly calibrated: boolean;
  readonly requests: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly interrupted: number;
  readonly retries: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly requestsWithUsage: number;
  readonly requestsWithoutUsage: number;
  readonly firstTokenSamples: number;
  readonly avgFirstTokenMs?: number | undefined;
  readonly durationSamples: number;
  readonly avgDurationMs?: number | undefined;
}
/** The same counters over every model in the report. */
interface AnalyticsTotals {
  readonly requests: number;
  readonly sessions: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly interrupted: number;
  readonly retries: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly requestsWithUsage: number;
  readonly requestsWithoutUsage: number;
  readonly firstTokenSamples: number;
  readonly avgFirstTokenMs?: number | undefined;
  readonly durationSamples: number;
  readonly avgDurationMs?: number | undefined;
}
/** How complete the history read was, so a partial scan never looks complete. */
interface AnalyticsHistoryCoverage {
  /** Whether the Host's optional session-query service answered at all. */
  readonly available: boolean;
  /** `unsupported` = no session-query service; `unreadable` = the read failed. */
  readonly reason?: 'unsupported' | 'unreadable' | undefined;
  readonly sessionsScanned: number;
  readonly sessionsSkipped: number;
  readonly eventsScanned: number;
  readonly inheritedEventsSkipped: number;
  readonly truncated: boolean;
}
/** The whole `opendesign/analytics` result. */
interface OpenDesignAnalyticsReport {
  readonly generatedAt: number;
  readonly scope: AnalyticsScope;
  readonly history: AnalyticsHistoryCoverage;
  readonly totals: AnalyticsTotals;
  readonly models: AnalyticsModelRow[];
}
/** Strictly parse one untrusted `opendesign/analytics` query. */
declare function parseAnalyticsQuery(value: unknown): AnalyticsQuery;
/** Strictly parse one untrusted `opendesign/analytics` result. */
declare function parseAnalyticsReport(value: unknown): OpenDesignAnalyticsReport;
//#endregion
//#region src/analytics-fold.d.ts
/**
 * Fold already-read session history into per-model request facts (ticket 12).
 *
 * The analytics page compares models on tokens, speed, failures and retries.
 * The Host already records every model attempt in the session log, so this
 * module is the only place that interprets it: one `assistant/message`, one
 * `assistant/attempt` and one `compaction/summary` each count as one request.
 * Nothing here knows a price, a provider price table or a dollar figure — the
 * cost dimension is the catalog's own `low/medium/high` word, joined later.
 *
 * Two rules protect the numbers:
 *
 * - A request whose adapter reported no `usage` still counts as a request, but
 *   contributes no tokens. Summing it as zero would make "no data" look like
 *   "zero tokens", so the row carries `requestsWithoutUsage` instead.
 * - Only a session's OWN events count: a forked child re-reads its inherited
 *   prefix, and `inheritedEventCount` is the exact cut the host publishes.
 *   Counting the prefix again would double every ancestor request.
 *
 * @module dsh-opendesign-provider/analytics-fold
 */
/** One raw session event, structurally typed so tests need no host package. */
interface HistoryEvent {
  readonly type: string;
  readonly time: number;
  readonly data?: unknown;
}
/** One logical session's own events, plus the host's exact inheritance cut. */
interface HistorySession {
  readonly id: string;
  readonly createdAt: number;
  readonly events: readonly HistoryEvent[];
  /** Leading events inherited from a parent session; never counted here. */
  readonly inheritedEventCount?: number;
}
/** Token, timing and outcome facts for one model. */
interface AnalyticsModelStats {
  readonly model: string;
  requests: number;
  succeeded: number;
  failed: number;
  interrupted: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestsWithUsage: number;
  requestsWithoutUsage: number;
  firstTokenSamples: number;
  firstTokenMsTotal: number;
  durationSamples: number;
  durationMsTotal: number;
}
/** The complete fold: model rows plus the read-coverage facts. */
interface AnalyticsFoldResult {
  readonly models: AnalyticsModelStats[];
  /** Sessions that contributed at least one request. */
  sessions: number;
  sessionsScanned: number;
  eventsScanned: number;
  inheritedEventsSkipped: number;
}
/** Which requests a fold counts. */
interface AnalyticsFoldOptions {
  /** The only provider whose requests count; defaults to `open-design`. */
  provider?: string;
  /** Half-open `[from, to)` request-time window; omitted means no time bound. */
  range?: {
    readonly from: number;
    readonly to: number;
  } | undefined;
}
/**
 * Fold every session into per-model facts.
 * @param sessions - already-read logs, in any order.
 * @param options - provider restriction and optional request-time window.
 * @returns deterministic rows (model id order) and read-coverage counters.
 */
declare function foldAnalytics(sessions: readonly HistorySession[], options?: AnalyticsFoldOptions): AnalyticsFoldResult;
//#endregion
//#region src/index.d.ts
declare const name = "llm-opendesign";
declare const inject: string[];
/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-opendesign` settings-section shape. Every field is optional: a
 * missing API key resolves through {@link Config.apiKeyEnv} at each request
 * (the web Models page writes it). The Open Design CLI login state
 * (`~/.amr/config.json`) joins the chain in ticket 08.
 */
interface Config {
  /** Credential reference (environment-variable name) resolved per request; defaults to `OPEN_DESIGN_API_KEY`. */
  apiKeyEnv?: string;
  /** Literal API key override (composition config only); takes precedence over `apiKeyEnv`. */
  apiKey?: string;
  /** Model-plane base URL; defaults to the Open Design gateway. */
  apiBase?: string;
  /** Model catalog cache path; defaults to `~/.opendesign/models-cache.json`. */
  modelsCachePath?: string;
  /**
   * Open Design CLI login state path; defaults to `~/.amr/config.json`. Overridable
   * for tests and unusual installs. This plugin only ever reads it.
   */
  amrConfigPath?: string;
  /** Milliseconds to wait for a response's first byte; defaults to 300s. */
  requestTimeoutMs?: number;
  /** Milliseconds a stream may stall before being treated as a dead connection; defaults to 300s. */
  streamIdleTimeoutMs?: number;
  /**
   * Transport failures one request absorbs before the failure is surfaced;
   * defaults to 5. Ordinary transient errors keep their separate three-retry
   * budget; this cap exists so a dead connection cannot stall a whole turn.
   */
  transportMaxRetries?: number;
  /**
   * Visible-model allowlist: catalog model ids shown in pickers. Empty or
   * unset means "show everything".
   */
  visibleModels?: string[];
  /**
   * Per-model visibility overrides from the terminal settings page's checkbox
   * list, keyed by catalog id (`true` = listed, `false` = hidden). An id here
   * decides that model on its own; an id absent here follows `visibleModels`.
   */
  modelVisibility?: Record<string, boolean>;
  /**
   * Custom context length (global value): the window declared to the host
   * instead of the catalog figure, covering context accounting, compaction
   * timing and the picker label. Applies to every catalog model without a
   * {@link contextWindowOverrides} entry; unset follows the catalog.
   */
  contextWindow?: number;
  /** Per-model custom context length, keyed by catalog model id; wins over the global value. */
  contextWindowOverrides?: Record<string, number>;
  /**
   * Per-turn output budget ceiling. Unset follows the model's own output
   * budget; a positive integer can only tighten it; `0` means "no host
   * budget" and never tightens anything (the cap field is always sent —
   * design §4.2 — so `0` must not become a literal zero-token budget).
   */
  maxOutputTokens?: number;
  /**
   * Language override for Host-side user-facing copy (`'zh'` or `'en'`,
   * default `'zh'`). The web settings page follows the browser preference on
   * its own; this knob is for commands and text surfaces.
   */
  lang?: string;
  /**
   * The opt-in sidebar quota card (default `false`). The panel only reads the
   * control plane and never touches inference; when the switch is off it renders
   * nothing and starts no refresh.
   */
  showSidebarQuota?: boolean;
}
/**
 * The Config schema: every field volatile except the composition-only `apiKey`
 * secret. Settings forms are projected from the schema's `meta.volatile`
 * nodes, so an unmarked field would be invisible to AND unwritable from the
 * settings page. The loader hands `apply()` a live reference per marked field,
 * so writes commit in place without remounting this fiber.
 */
declare const Config: z<Config>;
/** One resolution's complete request facts: connection plus credential reference. */
interface ResolvedOpenDesignOptions extends OpenDesignConnectionOptions {
  apiKeyEnv: CredentialRef;
}
/**
 * The one explicit resolve step from raw config to validated connection facts.
 * Programmatic construction may bypass Schemastery normalization, so every
 * default is re-judged here — for the composition entry at load and for every
 * settings-backed read.
 */
declare function resolveAdapterOptions(config: Config): ResolvedOpenDesignOptions;
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { ANALYTICS_LOCALE_NS, ANALYTICS_SECTION_ID, type AnalyticsCapabilityTier, type AnalyticsCostTier, type AnalyticsFoldResult, type AnalyticsHistoryCoverage, type AnalyticsModelRow, type AnalyticsModelStats, type AnalyticsQuery, type AnalyticsScope, type AnalyticsTotals, CONTROL_PLANE_TIMEOUT_MS, Config, DEFAULT_API_BASE, DEFAULT_API_KEY_ENV, DEFAULT_CONTROL_PLANE_API_URL, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, type DiagnosticsFacts, type DiagnosticsSnapshot, type FailureCode, type GatewayCatalogEntry, type GatewayCatalogFailureReason, type GatewayCatalogSourceKind, type GatewayCatalogStatus, type HttpFailureInput, MODELS_CACHE_RELATIVE_PATH, MODEL_CARD_KEY, NS, OpenDesignAdapter, type OpenDesignAdapterDeps, type OpenDesignAnalyticsReport, type OpenDesignConnectionOptions, OpenDesignControlPlane, type OpenDesignCredentialState, type OpenDesignQuotaDeps, OpenDesignQuotaService, type OpendesignCommandDeps, PACKAGE_NAME, PANEL_ID, PLUGIN_ID, PROVIDER, PROVIDER_DISPLAY_NAME, QUOTA_CACHE_TTL_MS, QUOTA_DESCRIPTOR, QUOTA_ENDPOINT, QUOTA_FIVE_HOUR_SECONDS, QUOTA_SEVEN_DAY_SECONDS, type QuotaReading, type QuotaSnapshot, type QuotaWindow, type QuotaWindowKind, REMOTE_ENDPOINTS, REMOTE_NAMESPACE, REMOTE_SERVICE, REQUEST_TIMING_ENV, ResolvedOpenDesignOptions, SETTINGS_SECTION_ID, STREAM_TRACE_ENV, apply, applyCommands, applyQuotaRemote, classifyQuotaWindow, commandDefinition, diagnosticsSnapshot, foldAnalytics, formatDiagnostics, inject, name, parseAnalyticsQuery, parseAnalyticsReport, parseQuotaSnapshot, renderQuota, resolveAdapterOptions, retryableFailureCodes };
//# sourceMappingURL=index.d.ts.map