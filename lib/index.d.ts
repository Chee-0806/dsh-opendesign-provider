import z from "@deepseek-ai/schemastery";
import { GenerateOptions, LlmAdapter, LlmError, LlmImageRequestPricing, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from "@deepseek-ai/dsh-llm";
import { CredentialRef } from "@deepseek-ai/dsh-credentials";
import { Context } from "@deepseek-ai/cordis";
import { ImageAttachmentRef, ImageRequestTarget, RequestImageAttachment } from "@deepseek-ai/dsh-attachment";
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
/**
 * The slice of the host attachment service that image input needs: one
 * deterministic request version of a stored image, encoded to a route target.
 * Declared narrowly here so the adapter depends on the capability it uses, not
 * on attachment storage as a whole; `ctx.attachments` satisfies it as-is.
 */
interface OpenDesignImageEncoder {
  /** Encode one normalized attachment to the request target (dimensions + byte budget). */
  readImageRequest(ref: ImageAttachmentRef, target: ImageRequestTarget, signal?: AbortSignal): Promise<RequestImageAttachment>;
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
  /** Test seam for the HTTP call. */
  fetchImpl?: typeof fetch;
  /** Test seam for catalog TTLs; defaults to `Date.now`. */
  now?: () => number;
}
/** The Open Design adapter: catalog plus the Chat Completions transport. */
declare class OpenDesignAdapter extends LlmAdapter {
  private readonly deps;
  private readonly catalog;
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
/** The Cordis service key the Gateway resolves those Remotes from. */
declare const REMOTE_SERVICE = "opendesignUsage";
/** The endpoint names under {@link REMOTE_NAMESPACE}. */
declare const REMOTE_ENDPOINTS: readonly ["report", "usage", "models", "analytics"];
/** The settings-page slot id (`settings.section`). */
declare const SETTINGS_SECTION_ID = "opendesign";
/** The Models-page provider-card key (`settings.models.provider-card`). */
declare const MODEL_CARD_KEY = "llm-opendesign";
/** The quota panel's `main` / `sidebar.footer.action` id. */
declare const PANEL_ID = "opendesign-panel";
/** Opt-in raw request-timing trace environment variable. */
declare const REQUEST_TIMING_ENV = "DSH_OPENDESIGN_TIMING";
/** Opt-in raw stream-trace environment variable. */
declare const STREAM_TRACE_ENV = "DSH_OPENDESIGN_TRACE";
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
export { Config, DEFAULT_API_BASE, DEFAULT_API_KEY_ENV, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, type DiagnosticsFacts, type DiagnosticsSnapshot, type FailureCode, type GatewayCatalogEntry, type GatewayCatalogFailureReason, type GatewayCatalogSourceKind, type GatewayCatalogStatus, type HttpFailureInput, MODELS_CACHE_RELATIVE_PATH, MODEL_CARD_KEY, NS, OpenDesignAdapter, type OpenDesignAdapterDeps, type OpenDesignConnectionOptions, type OpenDesignCredentialState, PACKAGE_NAME, PANEL_ID, PLUGIN_ID, PROVIDER, PROVIDER_DISPLAY_NAME, REMOTE_ENDPOINTS, REMOTE_NAMESPACE, REMOTE_SERVICE, REQUEST_TIMING_ENV, ResolvedOpenDesignOptions, SETTINGS_SECTION_ID, STREAM_TRACE_ENV, apply, diagnosticsSnapshot, formatDiagnostics, inject, name, resolveAdapterOptions, retryableFailureCodes };
//# sourceMappingURL=index.d.ts.map