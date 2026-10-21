import { homedir } from "node:os";
import { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { LlmAdapter, LlmError, ReasoningEffortId, ToolCallId, assertUsableApiKey, assistantStreamFirstTokenTime, attributionHeaders, offloadedImageText, resolveRetryPolicy, textOnlyImageText } from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { randomUUID } from "node:crypto";
//#region src/identity.ts
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
const PACKAGE_NAME = "@mars-sea/dsh-opendesign-provider";
/** The single LLM route this plugin owns. */
const PROVIDER = "open-design";
/** The name shown in the Models page, the settings page and errors. */
const PROVIDER_DISPLAY_NAME = "Open Design";
/** The settings namespace and plugin-row id (`llm-opendesign`). */
const NS = "llm-opendesign";
/** The plugin row id inserted by `cordis.patch.yml`. */
const PLUGIN_ID = "llm-opendesign";
/** The credential reference the Models page writes when no literal key is set. */
const DEFAULT_API_KEY_ENV = "OPEN_DESIGN_API_KEY";
/** The model plane's default base URL (the CLI login state can override it). */
const DEFAULT_API_BASE = "https://amr-link.open-design.ai/v1";
/** Model-catalog cache, relative to the user's home directory. */
const MODELS_CACHE_RELATIVE_PATH = ".opendesign/models-cache.json";
/** Open Design CLI login state, relative to the user's home directory. */
const AMR_CONFIG_RELATIVE_PATH = ".amr/config.json";
/** The wire namespace shared by every Remote this plugin serves. */
const REMOTE_NAMESPACE = "opendesign";
/**
* The Cordis service key the Gateway resolves the models Remote from. Cordis
* allows one service per key, so the quota Remote (ticket 10) provides its own
* key: every `opendesign` endpoint is a method on that one service.
*/
const REMOTE_SERVICE = "opendesignUsage";
/** The endpoint names under {@link REMOTE_NAMESPACE}. */
const REMOTE_ENDPOINTS = [
	"usage",
	"models",
	"analytics"
];
/** The settings-page slot id (`settings.section`). */
const SETTINGS_SECTION_ID = "opendesign";
/** The analytics page's own `settings.section` id (ticket 12). */
const ANALYTICS_SECTION_ID = "opendesign-analytics";
/** Locale namespace the analytics page declares for its own copy. */
const ANALYTICS_LOCALE_NS = "analytics.opendesign";
/** The Models-page provider-card key (`settings.models.provider-card`). */
const MODEL_CARD_KEY = "llm-opendesign";
/** The quota panel's `main` / `sidebar.footer.action` id. */
const PANEL_ID = "opendesign-panel";
/** Opt-in raw request-timing trace environment variable. */
const REQUEST_TIMING_ENV = "DSH_OPENDESIGN_TIMING";
/** Opt-in raw stream-trace environment variable. */
const STREAM_TRACE_ENV = "DSH_OPENDESIGN_TRACE";
//#endregion
//#region src/credentials.ts
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
/** The login state's default path (`~/.amr/config.json`). */
function defaultAmrConfigPath(homeDir = homedir()) {
	return join(homeDir, AMR_CONFIG_RELATIVE_PATH);
}
/** The production reader, pinned to UTF-8 so the seam returns a string. */
const readUtf8 = (path) => readFile(path, "utf8");
/** Read one non-empty string field, trimming surrounding whitespace. */
function textField(source, key) {
	const value = source[key];
	if (typeof value !== "string") return void 0;
	const text = value.trim();
	return text === "" ? void 0 : text;
}
/**
* Read `profiles.prod` out of the CLI login state. Never throws: a missing
* file, an unreadable file, invalid JSON and a missing `profiles.prod` are
* reported as statuses so callers can explain the degraded path.
*/
async function readCliLoginState(path = defaultAmrConfigPath(), readFile = readUtf8) {
	let raw;
	try {
		raw = await readFile(path);
	} catch (error) {
		return {
			status: (typeof error === "object" && error !== null && "code" in error ? error.code : void 0) === "ENOENT" ? "missing" : "unreadable",
			path
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			status: "malformed",
			path
		};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {
		status: "malformed",
		path
	};
	const profiles = parsed.profiles;
	if (typeof profiles !== "object" || profiles === null || Array.isArray(profiles)) return {
		status: "malformed",
		path
	};
	const prod = profiles.prod;
	if (typeof prod !== "object" || prod === null || Array.isArray(prod)) return {
		status: "malformed",
		path
	};
	const record = prod;
	return {
		status: "ok",
		path,
		state: {
			runtimeKey: textField(record, "runtimeKey"),
			controlKey: textField(record, "controlKey"),
			linkUrl: textField(record, "linkUrl"),
			apiUrl: textField(record, "apiUrl"),
			user: textField(record, "user")
		}
	};
}
/** Project a reading onto the facts that are safe to show or serialize. */
function cliLoginFacts(reading) {
	return {
		status: reading.status,
		path: reading.path,
		hasRuntimeKey: reading.state?.runtimeKey !== void 0,
		hasControlKey: reading.state?.controlKey !== void 0,
		...reading.state?.apiUrl === void 0 ? {} : { apiUrl: reading.state.apiUrl },
		...reading.state?.user === void 0 ? {} : { user: reading.state.user }
	};
}
/** One non-empty trimmed string, or undefined. */
function clean(value) {
	if (typeof value !== "string") return void 0;
	const text = value.trim();
	return text === "" ? void 0 : text;
}
/**
* Resolve one request's credential facts.
*
* The reference layer is asked exactly once and only when no literal key is
* configured; a rejection from that layer is treated as a miss so the CLI
* login state can still serve the request. Nothing here throws for a missing
* credential — the caller decides how to surface "no key".
*/
async function resolveCredentialChain(config, deps = {}) {
	const reference = clean(config.apiKeyEnv) ?? "OPEN_DESIGN_API_KEY";
	const login = await readCliLoginState(clean(config.amrConfigPath) ?? defaultAmrConfigPath(deps.homeDir), deps.readFile ?? readUtf8);
	const literal = clean(config.apiKey);
	let source = "none";
	let apiKey;
	if (literal !== void 0) {
		source = "literal";
		apiKey = literal;
	} else {
		let referenced;
		if (deps.resolveReference !== void 0) try {
			referenced = clean(await deps.resolveReference(reference));
		} catch {
			referenced = void 0;
		}
		if (referenced !== void 0) {
			source = "reference";
			apiKey = referenced;
		} else if (login.state?.runtimeKey !== void 0) {
			source = "cli-login";
			apiKey = login.state.runtimeKey;
		}
	}
	const explicitBase = clean(config.apiBase);
	const loginBase = login.state?.linkUrl;
	const apiBaseSource = explicitBase !== void 0 ? "config" : source === "cli-login" && loginBase !== void 0 ? "cli-login" : "default";
	const apiBase = apiBaseSource === "config" ? explicitBase : apiBaseSource === "cli-login" ? cliLoginApiBase(loginBase) : DEFAULT_API_BASE;
	return {
		source,
		...apiKey === void 0 ? {} : { apiKey },
		reference,
		apiBase,
		apiBaseSource,
		login: cliLoginFacts(login)
	};
}
/**
* The model-plane base for a CLI login state's `linkUrl`.
*
* Measured shape (2026-10-20): `vela login` writes the model-plane HOST
* (`https://amr-link.open-design.ai`) while every model-plane route lives
* under `/v1` (`GET /v1/models`, `POST /v1/chat/completions`) — the host alone
* answers nginx's HTML 404. So a bare origin (or bare origin + `/`) gets `/v1`
* appended; a `linkUrl` that already carries a path is respected verbatim,
* because the server may hand out a versioned or self-hosted prefix.
*/
function cliLoginApiBase(linkUrl) {
	const trimmed = linkUrl.trim().replace(/\/+$/u, "");
	if (trimmed === "") return DEFAULT_API_BASE;
	try {
		const url = new URL(trimmed);
		return url.pathname === "" || url.pathname === "/" ? `${trimmed}/v1` : trimmed;
	} catch {
		return trimmed;
	}
}
/** The two ways forward when neither the config nor the CLI login state has a key. */
function missingCredentialMessage(reference = DEFAULT_API_KEY_ENV) {
	return `还没有可用的 Open Design API Key（provider 路由 "open-design"，凭据引用 ${reference}）。请在 设置 → Open Design 填入 API Key（或在启动环境导出该变量、在 composition 里设置 config.apiKey）；也可以在终端执行 \`vela login\` 复用桌面端登录态。Key 在 https://open-design.ai/cloud/api-keys 创建。`;
}
//#endregion
//#region src/wire-shared.ts
/** The npm package identity every contribution and descriptor claims. */
const REMOTE_PACKAGE = PACKAGE_NAME;
/**
* Build the validator helpers one endpoint uses. `prefix` names the endpoint
* in the rejection message (e.g. `opendesign/report result:`), so each wire
* file keeps its own diagnostic phrasing while sharing the helper bodies.
*
* The helpers return the reject call directly in the failure branch: since
* `reject` is typed `never`, the ternary's union collapses to the success type
* without relying on TypeScript's control-flow analysis of a never-returning
* call (which only recognizes function declarations, not the destructured
* arrow `reject` callers receive from this factory). Callers that need the
* narrowing in an `if` must therefore assign inside the positive branch.
*/
function makeBoundaryValidator(prefix) {
	const reject = (field) => {
		throw new TypeError(`${prefix} invalid ${field}`);
	};
	const record = (value, field) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : reject(field);
	const stringField = (source, key, field) => typeof source[key] === "string" ? source[key] : reject(field);
	const numberField = (source, key, field) => typeof source[key] === "number" && Number.isFinite(source[key]) ? source[key] : reject(field);
	const booleanField = (source, key, field) => typeof source[key] === "boolean" ? source[key] : reject(field);
	return {
		reject,
		record,
		stringField,
		numberField,
		booleanField
	};
}
/** Use the same strict-codec shape for invocation parameters and results. */
function makeStrictCodec(typeSymbol, schema) {
	return {
		mode: "strict",
		typeSymbol,
		create: () => schema
	};
}
/** Build one JSON business parameter carried in the wire `args` object. */
function makeRemoteParameter(name, typeSymbol, schema) {
	return {
		name,
		wire: name,
		source: "json",
		codec: makeStrictCodec(typeSymbol, schema)
	};
}
/**
* Build one strict invocation descriptor. Every Open Design Remote shares the
* `opendesign` namespace and a strict result — only the endpoint, method,
* Cordis service key, result type symbol, parameters and schema differ.
*
* `parameters` defaults to none (a parameterless method sends an empty `args`
* object); `service` defaults to {@link REMOTE_SERVICE}. The quota Remote
* provides its own key (Cordis allows exactly one service per key) and the
* Gateway resolves the receiving service by this field.
*/
function makeRemoteDescriptor(endpoint, method, typeSymbol, schema, parameters = [], service = REMOTE_SERVICE) {
	return {
		id: `${REMOTE_PACKAGE}#${endpoint}`,
		service,
		namespace: REMOTE_NAMESPACE,
		method,
		invocation: { kind: "direct" },
		parameters,
		result: makeStrictCodec(typeSymbol, schema)
	};
}
//#endregion
//#region src/quota-wire.ts
/** Canonical `<namespace>/<method>` endpoint of the quota snapshot. */
const QUOTA_ENDPOINT = `${REMOTE_NAMESPACE}/usage`;
const { reject: reject$1, record: record$1, stringField: stringField$1, numberField: numberField$1, booleanField: booleanField$1 } = makeBoundaryValidator("opendesign/usage result:");
const WINDOW_KINDS = [
	"five_hour",
	"seven_day",
	"other"
];
const FUNDINGS = ["wallet", "coding_plan"];
function optionalString$1(source, key, field) {
	if (source[key] === void 0) return void 0;
	return stringField$1(source, key, field);
}
function parseWindow(value, field) {
	const source = record$1(value, field);
	const kind = stringField$1(source, "kind", `${field}.kind`);
	if (!WINDOW_KINDS.includes(kind)) reject$1(`${field}.kind`);
	const resetsAt = optionalString$1(source, "resetsAt", `${field}.resetsAt`);
	const resetMode = optionalString$1(source, "resetMode", `${field}.resetMode`);
	return {
		kind,
		durationSeconds: numberField$1(source, "durationSeconds", `${field}.durationSeconds`),
		usedCredits: numberField$1(source, "usedCredits", `${field}.usedCredits`),
		limitCredits: numberField$1(source, "limitCredits", `${field}.limitCredits`),
		remainingCredits: numberField$1(source, "remainingCredits", `${field}.remainingCredits`),
		...resetsAt === void 0 ? {} : { resetsAt },
		...resetMode === void 0 ? {} : { resetMode }
	};
}
/** Strictly parse one untrusted `opendesign/usage` result. */
function parseQuotaSnapshot(value) {
	const source = record$1(value, "result");
	if (!Array.isArray(source.windows)) reject$1("windows");
	const funding = optionalString$1(source, "funding", "funding");
	if (funding !== void 0 && !FUNDINGS.includes(funding)) reject$1("funding");
	const tier = optionalString$1(source, "tier", "tier");
	const subscriptionStatus = optionalString$1(source, "subscriptionStatus", "subscriptionStatus");
	const currentPeriodEnd = optionalString$1(source, "currentPeriodEnd", "currentPeriodEnd");
	const balanceUsd = source.balanceUsd === void 0 ? void 0 : numberField$1(source, "balanceUsd", "balanceUsd");
	return {
		controlPlaneAvailable: booleanField$1(source, "controlPlaneAvailable", "controlPlaneAvailable"),
		...tier === void 0 ? {} : { tier },
		...subscriptionStatus === void 0 ? {} : { subscriptionStatus },
		...currentPeriodEnd === void 0 ? {} : { currentPeriodEnd },
		...balanceUsd === void 0 ? {} : { balanceUsd },
		...funding === void 0 ? {} : { funding },
		windows: source.windows.map((entry, index) => parseWindow(entry, `windows[${index}]`)),
		fetchedAt: stringField$1(source, "fetchedAt", "fetchedAt"),
		...source.stale === void 0 ? {} : { stale: booleanField$1(source, "stale", "stale") }
	};
}
/** The Host descriptor for `opendesign/usage`. */
const QUOTA_DESCRIPTOR = makeRemoteDescriptor(QUOTA_ENDPOINT, "usage", `${REMOTE_PACKAGE}#QuotaSnapshot`, { parse: parseQuotaSnapshot });
//#endregion
//#region src/analytics-fold.ts
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
/** Narrow one `data` payload without trusting its shape. */
function asRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** Read one nested record field, or undefined. */
function field(source, key) {
	return source?.[key];
}
/** Read one finite non-negative number, or undefined. */
function count(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
/** The request header's route facts (provider and model). */
function headerRoute(data) {
	const config = asRecord$1(field(asRecord$1(data.header), "config"));
	const provider = field(config, "provider");
	const model = field(config, "model");
	return {
		...typeof provider === "string" ? { provider } : {},
		...typeof model === "string" ? { model } : {}
	};
}
/** The `assistant/message` source route, which outranks the standing header. */
function messageRoute(data) {
	const source = asRecord$1(field(asRecord$1(data.message), "source"));
	const provider = field(source, "provider");
	const model = field(source, "model");
	return {
		...typeof provider === "string" ? { provider } : {},
		...typeof model === "string" ? { model } : {}
	};
}
/** One adapter-reported token count, or undefined when the field is absent. */
function usageTokens(data) {
	const usage = asRecord$1(field(data, "usage"));
	if (usage === void 0) return void 0;
	const input = count(usage.inputTokens);
	const output = count(usage.outputTokens);
	if (input === void 0 || output === void 0) return void 0;
	return {
		input,
		output,
		total: count(usage.totalTokens) ?? input + output
	};
}
/** The compact timed stream of one settled attempt. */
function streamOf(data) {
	const stream = field(data, "stream");
	return Array.isArray(stream) ? stream : [];
}
/** Take (or create) the row for `model`. */
function rowFor(rows, model) {
	const existing = rows.get(model);
	if (existing !== void 0) return existing;
	const created = {
		model,
		requests: 0,
		succeeded: 0,
		failed: 0,
		interrupted: 0,
		retries: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		requestsWithUsage: 0,
		requestsWithoutUsage: 0,
		firstTokenSamples: 0,
		firstTokenMsTotal: 0,
		durationSamples: 0,
		durationMsTotal: 0
	};
	rows.set(model, created);
	return created;
}
/**
* Fold one logical session's own events.
* @param target - session to interpret.
* @param rows - accumulator keyed by model id.
* @param provider - the only provider whose requests count.
* @returns how many requests this session contributed.
*/
function foldSession(target, rows, provider, range) {
	const inRange = (time) => range === void 0 || time >= range.from && time < range.to;
	const inherited = target.inheritedEventCount ?? 0;
	const events = target.events.slice(inherited);
	const cursor = { attemptsInStep: 0 };
	let requests = 0;
	for (const event of events) {
		const data = asRecord$1(event.data);
		if (event.type === "request/header") {
			const route = headerRoute(data ?? {});
			if (route.provider !== void 0) cursor.provider = route.provider;
			if (route.model !== void 0) cursor.model = route.model;
			continue;
		}
		if (event.type === "request/context") {
			const route = headerRoute({ header: { config: data } });
			if (route.provider !== void 0) cursor.provider = route.provider;
			if (route.model !== void 0) cursor.model = route.model;
			continue;
		}
		if (event.type === "step/start") {
			cursor.stepStart = event.time;
			cursor.lastAttemptTime = void 0;
			cursor.attemptsInStep = 0;
			continue;
		}
		if (event.type === "compaction/summary") {
			if (data === void 0) continue;
			const compactProvider = field(data, "provider");
			const compactModel = field(data, "model");
			if (compactProvider !== provider || typeof compactModel !== "string") continue;
			if (!inRange(event.time)) continue;
			const row = rowFor(rows, compactModel);
			row.requests += 1;
			requests += 1;
			row.succeeded += 1;
			const usage = usageTokens(data);
			if (usage === void 0) row.requestsWithoutUsage += 1;
			else {
				row.requestsWithUsage += 1;
				row.inputTokens += usage.input;
				row.outputTokens += usage.output;
				row.totalTokens += usage.total;
			}
			continue;
		}
		if (event.type !== "assistant/message" && event.type !== "assistant/attempt") continue;
		if (data === void 0) continue;
		const route = event.type === "assistant/message" ? messageRoute(data) : {};
		const requestProvider = route.provider ?? cursor.provider;
		const model = route.model ?? cursor.model;
		cursor.attemptsInStep += 1;
		const start = cursor.lastAttemptTime ?? cursor.stepStart;
		cursor.lastAttemptTime = event.time;
		if (requestProvider !== provider || model === void 0) continue;
		if (!inRange(event.time)) continue;
		const row = rowFor(rows, model);
		row.requests += 1;
		requests += 1;
		if (cursor.attemptsInStep > 1) row.retries += 1;
		if (event.type === "assistant/attempt") row.failed += 1;
		else if (data.interrupted === true) row.interrupted += 1;
		else row.succeeded += 1;
		const usage = usageTokens(data);
		if (usage === void 0) row.requestsWithoutUsage += 1;
		else {
			row.requestsWithUsage += 1;
			row.inputTokens += usage.input;
			row.outputTokens += usage.output;
			row.totalTokens += usage.total;
		}
		if (start !== void 0 && event.time >= start) {
			row.durationSamples += 1;
			row.durationMsTotal += event.time - start;
			const firstToken = assistantStreamFirstTokenTime(streamOf(data));
			if (firstToken !== void 0 && firstToken >= start) {
				row.firstTokenSamples += 1;
				row.firstTokenMsTotal += firstToken - start;
			}
		}
	}
	return requests;
}
/**
* Fold every session into per-model facts.
* @param sessions - already-read logs, in any order.
* @param options - provider restriction and optional request-time window.
* @returns deterministic rows (model id order) and read-coverage counters.
*/
function foldAnalytics(sessions, options = {}) {
	const provider = options.provider ?? "open-design";
	const rows = /* @__PURE__ */ new Map();
	let contributing = 0;
	let eventsScanned = 0;
	let inheritedEventsSkipped = 0;
	for (const target of sessions) {
		if (foldSession(target, rows, provider, options.range) > 0) contributing += 1;
		eventsScanned += target.events.length;
		inheritedEventsSkipped += target.inheritedEventCount ?? 0;
	}
	return {
		models: [...rows.values()].sort((a, b) => a.model.localeCompare(b.model)),
		sessions: contributing,
		sessionsScanned: sessions.length,
		eventsScanned,
		inheritedEventsSkipped
	};
}
/** A coverage block for a scan that never ran. */
function emptyCoverage(available, reason) {
	return {
		available,
		...reason === void 0 ? {} : { reason },
		sessionsScanned: 0,
		sessionsSkipped: 0,
		eventsScanned: 0,
		inheritedEventsSkipped: 0,
		truncated: false
	};
}
/**
* Collect the sessions a scope needs.
* @param query - the host's session-query service, or undefined when unmounted.
* @param scope - recent-session count or half-open request-time range.
* @param provider - the only provider whose requests count.
* @returns contributing sessions plus the read-coverage facts.
*/
async function collectAnalyticsSessions(query, scope, provider) {
	if (query === void 0) return {
		sessions: [],
		coverage: emptyCoverage(false, "unsupported")
	};
	let summaries;
	try {
		summaries = await query.listSessions();
	} catch {
		return {
			sessions: [],
			coverage: emptyCoverage(false, "unreadable")
		};
	}
	const sessions = [];
	let candidates = 0;
	let skipped = 0;
	let eventsScanned = 0;
	let inheritedEventsSkipped = 0;
	let truncated = false;
	for (const summary of summaries) {
		const header = summary.header;
		if (typeof header?.id !== "string" || header.id === "") {
			skipped += 1;
			continue;
		}
		if (scope.kind === "range" && header.createdAt >= scope.to) continue;
		if (candidates >= 100) {
			truncated = true;
			break;
		}
		candidates += 1;
		let read;
		try {
			read = await query.readSession(header.id);
		} catch {
			skipped += 1;
			continue;
		}
		const own = {
			id: header.id,
			createdAt: header.createdAt,
			events: Array.isArray(read.events) ? read.events : [],
			...read.inheritedEventCount === void 0 ? {} : { inheritedEventCount: read.inheritedEventCount }
		};
		eventsScanned += own.events.length;
		inheritedEventsSkipped += own.inheritedEventCount ?? 0;
		if (eventsScanned > 2e5) truncated = true;
		if (!(foldAnalytics([own], { provider }).sessions > 0)) continue;
		sessions.push(own);
		if (scope.kind === "recent" && sessions.length >= scope.sessions) break;
	}
	return {
		sessions,
		coverage: {
			available: true,
			sessionsScanned: candidates,
			sessionsSkipped: skipped,
			eventsScanned,
			inheritedEventsSkipped,
			truncated
		}
	};
}
//#endregion
//#region src/analytics-wire.ts
/** Canonical `<namespace>/<method>` endpoint of the analytics report. */
const ANALYTICS_ENDPOINT = `${REMOTE_NAMESPACE}/analytics`;
const MAX_RECENT_SESSIONS = 100;
const MAX_RANGE_MS = 316224e5;
const queryValidator = makeBoundaryValidator("opendesign/analytics query:");
const resultValidator = makeBoundaryValidator("opendesign/analytics result:");
const COSTS$1 = [
	"low",
	"medium",
	"high",
	"unknown"
];
const CAPABILITIES$1 = [
	"standard",
	"advanced",
	"unknown"
];
const HISTORY_REASONS = ["unsupported", "unreadable"];
/** Read one required finite, non-negative integer. */
function counterField(source, key, field) {
	const value = resultValidator.numberField(source, key, field);
	if (!Number.isInteger(value) || value < 0) resultValidator.reject(field);
	return value;
}
/** Read one optional finite, non-negative number (absent stays absent). */
function optionalAverage(source, key, field) {
	if (source[key] === void 0) return void 0;
	const value = resultValidator.numberField(source, key, field);
	if (value < 0) resultValidator.reject(field);
	return value;
}
/** Parse one scope; `recent` and `range` are the only legal kinds. */
function parseScope(value, prefix) {
	const source = queryValidator.record(value, `${prefix}scope`);
	const kind = queryValidator.stringField(source, "kind", `${prefix}scope.kind`);
	if (kind === "recent") {
		const sessions = queryValidator.numberField(source, "sessions", `${prefix}recent.sessions`);
		if (!Number.isInteger(sessions) || sessions < 1 || sessions > MAX_RECENT_SESSIONS) queryValidator.reject(`${prefix}recent.sessions`);
		return {
			kind,
			sessions
		};
	}
	if (kind === "range") {
		const from = queryValidator.numberField(source, "from", `${prefix}range.from`);
		const to = queryValidator.numberField(source, "to", `${prefix}range.to`);
		if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to - from > MAX_RANGE_MS) queryValidator.reject(`${prefix}range`);
		return {
			kind,
			from,
			to
		};
	}
	return queryValidator.reject(`${prefix}scope.kind`);
}
/** Strictly parse one untrusted `opendesign/analytics` query. */
function parseAnalyticsQuery(value) {
	return { scope: parseScope(queryValidator.record(value, "query").scope, "") };
}
/** Parse the report's scope echo with the stricter result validator. */
function parseReportScope(value) {
	const source = resultValidator.record(value, "scope");
	const kind = resultValidator.stringField(source, "kind", "scope.kind");
	if (kind === "recent") return {
		kind,
		sessions: counterField(source, "sessions", "scope.sessions")
	};
	if (kind === "range") {
		const from = counterField(source, "from", "scope.from");
		const to = counterField(source, "to", "scope.to");
		if (to <= from) resultValidator.reject("scope.to");
		return {
			kind,
			from,
			to
		};
	}
	return resultValidator.reject("scope.kind");
}
/** Parse the shared counters block (totals and one model row). */
function parseCounters(source, field) {
	const avgFirstTokenMs = optionalAverage(source, "avgFirstTokenMs", `${field}avgFirstTokenMs`);
	const avgDurationMs = optionalAverage(source, "avgDurationMs", `${field}avgDurationMs`);
	return {
		requests: counterField(source, "requests", `${field}requests`),
		succeeded: counterField(source, "succeeded", `${field}succeeded`),
		failed: counterField(source, "failed", `${field}failed`),
		interrupted: counterField(source, "interrupted", `${field}interrupted`),
		retries: counterField(source, "retries", `${field}retries`),
		inputTokens: counterField(source, "inputTokens", `${field}inputTokens`),
		outputTokens: counterField(source, "outputTokens", `${field}outputTokens`),
		totalTokens: counterField(source, "totalTokens", `${field}totalTokens`),
		requestsWithUsage: counterField(source, "requestsWithUsage", `${field}requestsWithUsage`),
		requestsWithoutUsage: counterField(source, "requestsWithoutUsage", `${field}requestsWithoutUsage`),
		firstTokenSamples: counterField(source, "firstTokenSamples", `${field}firstTokenSamples`),
		...avgFirstTokenMs === void 0 ? {} : { avgFirstTokenMs },
		durationSamples: counterField(source, "durationSamples", `${field}durationSamples`),
		...avgDurationMs === void 0 ? {} : { avgDurationMs }
	};
}
/** Parse one model row, rejecting an unknown tier word. */
function parseModelRow(value, index) {
	const field = `models[${index}].`;
	const source = resultValidator.record(value, `models[${index}]`);
	const cost = resultValidator.stringField(source, "cost", `${field}cost`);
	if (!COSTS$1.includes(cost)) resultValidator.reject(`${field}cost`);
	const capability = resultValidator.stringField(source, "capability", `${field}capability`);
	if (!CAPABILITIES$1.includes(capability)) resultValidator.reject(`${field}capability`);
	return {
		model: resultValidator.stringField(source, "model", `${field}model`),
		name: resultValidator.stringField(source, "name", `${field}name`),
		cost,
		capability,
		visible: resultValidator.booleanField(source, "visible", `${field}visible`),
		calibrated: resultValidator.booleanField(source, "calibrated", `${field}calibrated`),
		...parseCounters(source, field)
	};
}
/** Parse the history coverage block. */
function parseHistory(value) {
	const source = resultValidator.record(value, "history");
	const available = resultValidator.booleanField(source, "available", "history.available");
	const reason = source.reason === void 0 ? void 0 : resultValidator.stringField(source, "reason", "history.reason");
	if (reason !== void 0 && !HISTORY_REASONS.includes(reason)) resultValidator.reject("history.reason");
	return {
		available,
		...reason === void 0 ? {} : { reason },
		sessionsScanned: counterField(source, "sessionsScanned", "history.sessionsScanned"),
		sessionsSkipped: counterField(source, "sessionsSkipped", "history.sessionsSkipped"),
		eventsScanned: counterField(source, "eventsScanned", "history.eventsScanned"),
		inheritedEventsSkipped: counterField(source, "inheritedEventsSkipped", "history.inheritedEventsSkipped"),
		truncated: resultValidator.booleanField(source, "truncated", "history.truncated")
	};
}
/** Strictly parse one untrusted `opendesign/analytics` result. */
function parseAnalyticsReport(value) {
	const source = resultValidator.record(value, "result");
	if (!Array.isArray(source.models)) resultValidator.reject("models");
	const totalsSource = resultValidator.record(source.totals, "totals");
	return {
		generatedAt: counterField(source, "generatedAt", "generatedAt"),
		scope: parseReportScope(source.scope),
		history: parseHistory(source.history),
		totals: {
			...parseCounters(totalsSource, "totals."),
			sessions: counterField(totalsSource, "sessions", "totals.sessions")
		},
		models: source.models.map((row, index) => parseModelRow(row, index))
	};
}
/** The Host and Client descriptor for `opendesign/analytics`. */
const ANALYTICS_DESCRIPTOR = makeRemoteDescriptor(ANALYTICS_ENDPOINT, "analytics", `${REMOTE_PACKAGE}#OpenDesignAnalyticsReport`, { parse: parseAnalyticsReport }, [makeRemoteParameter("query", `${REMOTE_PACKAGE}#AnalyticsQuery`, { parse: parseAnalyticsQuery })]);
//#endregion
//#region src/analytics-remote.ts
/**
* Host half of `opendesign/analytics` (ticket 12).
*
* One request reads a bounded slice of the host's own history, folds it into
* per-model counters and joins the catalog's `cost`/`capability` words. No
* price table, no currency, no estimate: ADR-0002 removed money from this
* product, and the wire type has no field that could carry it.
*
* This module owns the report function only. The method is mounted on the one
* `opendesignUsage` Service instance (`OpenDesignModelsService`), because
* Cordis registers one Service per key and two `ctx.inject(['typert'])` scopes
* cannot see each other's services. `applyModelsRemote` therefore takes these
* deps optionally and adds the `analytics` method and descriptor together.
*
* @module dsh-opendesign-provider/analytics-remote
*/
/** Average one counter, rounded to whole milliseconds; absent with no samples. */
function average(total, samples) {
	return samples === 0 ? void 0 : Math.round(total / samples);
}
/** Sum two counter sets. */
function addCounters(into, row) {
	return {
		...into,
		requests: into.requests + row.requests,
		succeeded: into.succeeded + row.succeeded,
		failed: into.failed + row.failed,
		interrupted: into.interrupted + row.interrupted,
		retries: into.retries + row.retries,
		inputTokens: into.inputTokens + row.inputTokens,
		outputTokens: into.outputTokens + row.outputTokens,
		totalTokens: into.totalTokens + row.totalTokens,
		requestsWithUsage: into.requestsWithUsage + row.requestsWithUsage,
		requestsWithoutUsage: into.requestsWithoutUsage + row.requestsWithoutUsage,
		firstTokenSamples: into.firstTokenSamples + row.firstTokenSamples,
		durationSamples: into.durationSamples + row.durationSamples
	};
}
/** Join one folded row with its catalog entry and visibility fact. */
function modelRow(stats, entry, visible) {
	const avgFirstTokenMs = average(stats.firstTokenMsTotal, stats.firstTokenSamples);
	const avgDurationMs = average(stats.durationMsTotal, stats.durationSamples);
	return {
		model: stats.model,
		name: entry?.name ?? stats.model,
		cost: entry?.cost ?? "unknown",
		capability: entry?.capability ?? "unknown",
		visible,
		calibrated: entry !== void 0,
		requests: stats.requests,
		succeeded: stats.succeeded,
		failed: stats.failed,
		interrupted: stats.interrupted,
		retries: stats.retries,
		inputTokens: stats.inputTokens,
		outputTokens: stats.outputTokens,
		totalTokens: stats.totalTokens,
		requestsWithUsage: stats.requestsWithUsage,
		requestsWithoutUsage: stats.requestsWithoutUsage,
		firstTokenSamples: stats.firstTokenSamples,
		...avgFirstTokenMs === void 0 ? {} : { avgFirstTokenMs },
		durationSamples: stats.durationSamples,
		...avgDurationMs === void 0 ? {} : { avgDurationMs }
	};
}
/** Project one folded read onto the wire report. */
function buildAnalyticsReport(input) {
	const byId = new Map((input.catalog?.models ?? []).map((entry) => [entry.id, entry]));
	const rows = input.fold.models.map((stats) => modelRow(stats, byId.get(stats.model), input.isVisible(stats.model))).sort((a, b) => {
		if (a.visible !== b.visible) return a.visible ? -1 : 1;
		if (a.requests !== b.requests) return b.requests - a.requests;
		return a.model.localeCompare(b.model);
	});
	let totals = {
		requests: 0,
		sessions: input.fold.sessions,
		succeeded: 0,
		failed: 0,
		interrupted: 0,
		retries: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		requestsWithUsage: 0,
		requestsWithoutUsage: 0,
		firstTokenSamples: 0,
		durationSamples: 0
	};
	for (const row of rows) totals = addCounters(totals, row);
	const avgFirstTokenMs = average(input.fold.models.reduce((sum, row) => sum + row.firstTokenMsTotal, 0), totals.firstTokenSamples);
	const avgDurationMs = average(input.fold.models.reduce((sum, row) => sum + row.durationMsTotal, 0), totals.durationSamples);
	return {
		generatedAt: input.now(),
		scope: input.scope,
		history: input.coverage,
		totals: {
			...totals,
			...avgFirstTokenMs === void 0 ? {} : { avgFirstTokenMs },
			...avgDurationMs === void 0 ? {} : { avgDurationMs }
		},
		models: rows
	};
}
/** Read, fold and project one query; never throws for missing history/catalog. */
async function analyticsReport(deps, query) {
	const scope = query.scope;
	const history = await collectAnalyticsSessions(deps.sessionQuery(), scope, PROVIDER);
	const foldOptions = {
		provider: PROVIDER,
		...scope.kind === "range" ? { range: {
			from: scope.from,
			to: scope.to
		} } : {}
	};
	const fold = foldAnalytics(history.sessions, foldOptions);
	let catalog;
	try {
		catalog = await deps.catalogStatus();
	} catch {
		catalog = void 0;
	}
	return buildAnalyticsReport({
		scope,
		fold,
		coverage: history.coverage,
		catalog,
		isVisible: deps.isVisible,
		now: deps.now ?? Date.now
	});
}
//#endregion
//#region src/models-wire.ts
/** Canonical `<namespace>/<method>` endpoint of the models report. */
const MODELS_ENDPOINT = `${REMOTE_NAMESPACE}/models`;
const { reject, record, stringField, numberField, booleanField } = makeBoundaryValidator("opendesign/models result:");
const CREDENTIAL_SOURCES = [
	"literal",
	"reference",
	"cli-login",
	"none"
];
const API_BASE_SOURCES = [
	"config",
	"cli-login",
	"default"
];
const LOGIN_STATUSES = [
	"ok",
	"missing",
	"malformed",
	"unreadable"
];
const COSTS = [
	"low",
	"medium",
	"high"
];
const CAPABILITIES = ["standard", "advanced"];
/** Read one optional string and reject a present non-string. */
function optionalString(source, key, field) {
	if (source[key] === void 0) return void 0;
	return stringField(source, key, field);
}
/** Read one optional finite number and reject a present non-number. */
function optionalNumber(source, key, field) {
	if (source[key] === void 0) return void 0;
	return numberField(source, key, field);
}
function stringList(value, field) {
	if (!Array.isArray(value)) reject(field);
	const items = [];
	for (const item of value) {
		if (typeof item !== "string") reject(field);
		items.push(item);
	}
	return items;
}
function parseEntry(value, field) {
	const source = record(value, field);
	const cost = stringField(source, "cost", `${field}.cost`);
	if (!COSTS.includes(cost)) reject(`${field}.cost`);
	const capability = stringField(source, "capability", `${field}.capability`);
	if (!CAPABILITIES.includes(capability)) reject(`${field}.capability`);
	return {
		id: stringField(source, "id", `${field}.id`),
		name: stringField(source, "name", `${field}.name`),
		contextWindow: numberField(source, "contextWindow", `${field}.contextWindow`),
		maxTokens: numberField(source, "maxTokens", `${field}.maxTokens`),
		cost,
		capability,
		inputModalities: stringList(source.inputModalities, `${field}.inputModalities`),
		reasoningLevels: stringList(source.reasoningLevels, `${field}.reasoningLevels`),
		default: booleanField(source, "default", `${field}.default`),
		calibrated: booleanField(source, "calibrated", `${field}.calibrated`)
	};
}
function parseCatalog(value) {
	const source = record(value, "catalog");
	const kind = stringField(source, "source", "catalog.source");
	if (kind !== "live" && kind !== "static") reject("catalog.source");
	if (!Array.isArray(source.models)) reject("catalog.models");
	const fetchedAt = optionalNumber(source, "fetchedAt", "catalog.fetchedAt");
	const reason = optionalString(source, "reason", "catalog.reason");
	return {
		source: kind,
		apiBase: stringField(source, "apiBase", "catalog.apiBase"),
		cached: booleanField(source, "cached", "catalog.cached"),
		...fetchedAt === void 0 ? {} : { fetchedAt },
		...reason === void 0 ? {} : { reason },
		models: source.models.map((entry, index) => parseEntry(entry, `catalog.models[${index}]`))
	};
}
function parseCredential(value) {
	const source = record(value, "credential");
	const kind = stringField(source, "source", "credential.source");
	if (!CREDENTIAL_SOURCES.includes(kind)) reject("credential.source");
	const baseSource = stringField(source, "apiBaseSource", "credential.apiBaseSource");
	if (!API_BASE_SOURCES.includes(baseSource)) reject("credential.apiBaseSource");
	const login = record(source.login, "credential.login");
	const status = stringField(login, "status", "credential.login.status");
	if (!LOGIN_STATUSES.includes(status)) reject("credential.login.status");
	const apiUrl = optionalString(login, "apiUrl", "credential.login.apiUrl");
	const user = optionalString(login, "user", "credential.login.user");
	return {
		source: kind,
		reference: stringField(source, "reference", "credential.reference"),
		configured: booleanField(source, "configured", "credential.configured"),
		apiBase: stringField(source, "apiBase", "credential.apiBase"),
		apiBaseSource: baseSource,
		login: {
			status,
			path: stringField(login, "path", "credential.login.path"),
			hasRuntimeKey: booleanField(login, "hasRuntimeKey", "credential.login.hasRuntimeKey"),
			hasControlKey: booleanField(login, "hasControlKey", "credential.login.hasControlKey"),
			...apiUrl === void 0 ? {} : { apiUrl },
			...user === void 0 ? {} : { user }
		}
	};
}
/** Strictly parse one untrusted `opendesign/models` result. */
function parseModelsReport(value) {
	const source = record(value, "result");
	return {
		catalog: parseCatalog(source.catalog),
		credential: parseCredential(source.credential)
	};
}
/** The Host and Client descriptor for `opendesign/models`. */
const MODELS_DESCRIPTOR = makeRemoteDescriptor(MODELS_ENDPOINT, "models", `${REMOTE_PACKAGE}#OpenDesignModelsReport`, { parse: parseModelsReport });
//#endregion
//#region src/models-remote.ts
/** Project one catalog status onto the wire shape. */
function catalogReport(status) {
	return {
		source: status.source,
		apiBase: status.apiBase,
		cached: status.cached,
		...status.fetchedAt === void 0 ? {} : { fetchedAt: status.fetchedAt },
		...status.reason === void 0 ? {} : { reason: status.reason },
		models: status.models.map((entry) => ({
			id: entry.id,
			name: entry.name,
			contextWindow: entry.contextWindow,
			maxTokens: entry.maxTokens,
			cost: entry.cost,
			capability: entry.capability,
			inputModalities: [...entry.inputModalities],
			reasoningLevels: [...entry.reasoningLevels],
			default: entry.default,
			calibrated: entry.calibrated
		}))
	};
}
/** Project one credential resolution onto the wire shape, dropping the key. */
function credentialReport(chain) {
	return {
		source: chain.source,
		reference: chain.reference,
		configured: chain.apiKey !== void 0,
		apiBase: chain.apiBase,
		apiBaseSource: chain.apiBaseSource,
		login: {
			status: chain.login.status,
			path: chain.login.path,
			hasRuntimeKey: chain.login.hasRuntimeKey,
			hasControlKey: chain.login.hasControlKey,
			...chain.login.apiUrl === void 0 ? {} : { apiUrl: chain.login.apiUrl },
			...chain.login.user === void 0 ? {} : { user: chain.login.user }
		}
	};
}
/** The one report both browser surfaces consume. */
function buildModelsReport(catalog, chain) {
	return {
		catalog: catalogReport(catalog),
		credential: credentialReport(chain)
	};
}
/** The Cordis service the Typert Gateway resolves by {@link REMOTE_SERVICE}. */
var OpenDesignModelsService = class extends TypertRemoteService {
	deps;
	/**
	* The ticket 12 analytics invocation, present only when the plugin supplied
	* analytics deps. It shares this Service because one Cordis key cannot host
	* two instances; the `opendesign/models` method and descriptor are untouched.
	*/
	analytics;
	/** The ticket 10 quota read, present only when the plugin supplied quota deps. */
	usage;
	constructor(ctx, deps) {
		super(ctx, REMOTE_SERVICE, { namespace: REMOTE_NAMESPACE });
		this.deps = deps;
		if (deps.analytics !== void 0) {
			const analyticsDeps = deps.analytics;
			this.analytics = (query) => analyticsReport(analyticsDeps, query);
		}
		if (deps.quota !== void 0) {
			const quota = deps.quota;
			this.usage = () => quota();
		}
	}
	/** Read both Host-only facts fresh for one browser request. */
	async models() {
		const [catalog, chain] = await Promise.all([this.deps.catalogStatus(), this.deps.credentialStatus()]);
		return buildModelsReport(catalog, chain);
	}
};
/** The Host-face contribution: the models descriptor, plus analytics when wired. */
function hostContribution(deps) {
	return {
		package: REMOTE_PACKAGE,
		face: "host",
		schemas: [],
		model: {
			services: [],
			events: [],
			objects: []
		},
		invocations: [
			MODELS_DESCRIPTOR,
			...deps.analytics === void 0 ? [] : [ANALYTICS_DESCRIPTOR],
			...deps.quota === void 0 ? [] : [QUOTA_DESCRIPTOR]
		]
	};
}
/**
* Provide the service and register its descriptor on an optional Typert
* registry. A profile without the registry never reaches the callback.
*/
function applyModelsRemote(ctx, deps) {
	ctx.inject(["typert"], (remoteCtx) => {
		new OpenDesignModelsService(remoteCtx, deps);
		const unregister = remoteCtx.typert.register(hostContribution(deps));
		remoteCtx.effect(() => () => void unregister(), "dsh-opendesign-provider: models remote");
	});
}
//#endregion
//#region src/model-visibility.ts
/** 网页、终端与模型目录共用的选择规则；显式开关优先于白名单。 */
function modelIsVisible(id, allowlist, overrides) {
	const flag = overrides !== null && typeof overrides === "object" && !Array.isArray(overrides) ? overrides[id] : void 0;
	return typeof flag === "boolean" ? flag : allowlist.length === 0 || allowlist.includes(id);
}
//#endregion
//#region src/control-plane.ts
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
const DEFAULT_CONTROL_PLANE_API_URL = "https://amr-api.open-design.ai";
/** 单次控制面请求的超时（spec §额度）。 */
const CONTROL_PLANE_TIMEOUT_MS = 8e3;
/** 额度缓存有效期：命令与 Remote 共用同一份（spec §额度）。 */
const QUOTA_CACHE_TTL_MS = 6e4;
/** 实测的 5 小时窗口时长。 */
const QUOTA_FIVE_HOUR_SECONDS = 18e3;
/** 实测的 7 天窗口时长。 */
const QUOTA_SEVEN_DAY_SECONDS = 604800;
/** 窗口分类：只认实测的两个时长，其余一律 `other`。 */
function classifyQuotaWindow(durationSeconds) {
	if (durationSeconds === 18e3) return "five_hour";
	if (durationSeconds === 604800) return "seven_day";
	return "other";
}
/** 纯文本（可带前后空格）的数值字段：控制面把 credits 与美元都发成字符串。 */
function asNumber(value) {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(parsed) ? parsed : void 0;
}
function asText(value) {
	if (typeof value !== "string") return void 0;
	const text = value.trim();
	return text === "" ? void 0 : text;
}
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** 一页响应体，或读响应时的失败。 */
async function getJsonPage(fetchImpl, url, controlKey, timeoutMs) {
	const response = await fetchImpl(url, {
		method: "GET",
		headers: {
			authorization: `Bearer ${controlKey}`,
			accept: "application/json"
		},
		signal: AbortSignal.timeout(Math.max(1, Math.trunc(timeoutMs)))
	});
	if (!response.ok) throw new Error(`control plane answered HTTP ${response.status}`);
	const record = asRecord(JSON.parse(await response.text()));
	if (record === void 0) throw new Error("control plane answered a non-object body");
	return record;
}
function readWorkspace(page) {
	return {
		activeWorkspaceId: asText(page.activeWorkspaceId) ?? asText(page.workspaceId),
		personalTier: asText(page.personalMembershipTier)
	};
}
function readSummary(page) {
	return {
		tier: asText(page.membershipTier),
		balanceUsd: asNumber(page.balanceUsd),
		creditsPerUsd: asNumber(page.creditsPerUsd),
		subscriptionStatus: asText(page.subscriptionStatus),
		currentPeriodEnd: asText(page.subscriptionCurrentPeriodEnd)
	};
}
function readPreflight(page) {
	const plan = asRecord(page.codingPlan);
	const eligible = typeof plan?.eligible === "boolean" ? plan.eligible : void 0;
	const rawWindows = Array.isArray(plan?.windows) ? plan.windows : [];
	const windows = [];
	for (const raw of rawWindows) {
		const entry = asRecord(raw);
		const durationSeconds = asNumber(entry?.durationSeconds);
		if (entry === void 0 || durationSeconds === void 0) continue;
		const resetsAt = asText(entry.resetsAt);
		const resetMode = asText(entry.resetMode);
		windows.push({
			kind: classifyQuotaWindow(durationSeconds),
			durationSeconds,
			usedCredits: asNumber(entry.usedCredits) ?? 0,
			limitCredits: asNumber(entry.limitCredits) ?? 0,
			remainingCredits: asNumber(entry.remainingCredits) ?? 0,
			...resetsAt === void 0 ? {} : { resetsAt },
			...resetMode === void 0 ? {} : { resetMode }
		});
	}
	windows.sort((left, right) => left.durationSeconds - right.durationSeconds);
	const funding = page.funding === "wallet" || page.funding === "coding_plan" ? page.funding : void 0;
	return {
		eligible,
		tier: asText(plan?.tier),
		windows,
		balanceUsd: asNumber(page.balanceUsd),
		...funding !== void 0 ? { funding } : eligible === false ? { funding: "wallet" } : {}
	};
}
/** 控制面基址去掉末尾斜杠；登录态没给时用默认域名。 */
function controlBase(apiUrl) {
	const text = asText(apiUrl)?.replace(/\/+$/u, "") ?? "";
	return text === "" ? DEFAULT_CONTROL_PLANE_API_URL : text;
}
/**
* 只读额度客户端：一次 `read()` 依次问三个接口，解析成冻结快照。
*
* Host 侧 60 秒缓存，命令与 Remote 共用同一实例，因此两条展示面永远同一份数据。
*/
var OpenDesignControlPlane = class {
	deps;
	last;
	lastAttemptAt;
	constructor(deps = {}) {
		this.deps = deps;
	}
	/** 读一次额度：缓存命中直接返回，否则刷新；任何失败都降级而不抛错。 */
	async read(request = {}) {
		const at = (this.deps.now ?? Date.now)();
		const ttl = this.deps.cacheTtlMs ?? 6e4;
		if (request.force !== true && this.last !== void 0 && this.lastAttemptAt !== void 0 && at - this.lastAttemptAt < ttl) return this.last;
		const login = await this.login();
		const controlKey = login.state?.controlKey;
		if (controlKey === void 0) {
			const reading = {
				snapshot: {
					controlPlaneAvailable: false,
					windows: [],
					fetchedAt: new Date(at).toISOString()
				},
				reason: login.state === void 0 ? "login-unavailable" : "no-control-key"
			};
			this.last = reading;
			return reading;
		}
		try {
			const reading = await this.query(controlKey, controlBase(login.state?.apiUrl), request, at);
			this.last = reading;
			this.lastAttemptAt = at;
			return reading;
		} catch {
			this.lastAttemptAt = at;
			if (this.last !== void 0 && this.last.snapshot.controlPlaneAvailable) {
				const stale = {
					...this.last,
					snapshot: {
						...this.last.snapshot,
						stale: true
					}
				};
				this.last = stale;
				return stale;
			}
			const reading = {
				snapshot: {
					controlPlaneAvailable: false,
					windows: [],
					fetchedAt: new Date(at).toISOString()
				},
				reason: "unreachable"
			};
			this.last = reading;
			return reading;
		}
	}
	/** 当前登录态（不缓存：文件很小，且用户随时可能 `vela login`）。 */
	login() {
		const path = asText(typeof this.deps.loginPath === "function" ? this.deps.loginPath() : this.deps.loginPath) ?? defaultAmrConfigPath();
		return this.deps.readFile === void 0 ? readCliLoginState(path) : readCliLoginState(path, this.deps.readFile);
	}
	/** 三个 GET 的串行真相：工作区 → 摘要 → 预检（预检需要工作区 id）。 */
	async query(controlKey, base, request, at) {
		const fetchImpl = this.deps.fetchImpl ?? fetch;
		const timeoutMs = this.deps.timeoutMs ?? 8e3;
		const workspace = readWorkspace(await getJsonPage(fetchImpl, `${base}/api/v1/workspaces/current`, controlKey, timeoutMs));
		const summary = readSummary(await getJsonPage(fetchImpl, `${base}/api/v1/billing/summary`, controlKey, timeoutMs));
		const model = asText(request.model);
		const preflight = workspace.activeWorkspaceId === void 0 || model === void 0 ? void 0 : readPreflight(await getJsonPage(fetchImpl, `${base}/api/v1/workspaces/${workspace.activeWorkspaceId}/billing/preflight?model=${encodeURIComponent(model)}`, controlKey, timeoutMs));
		const snapshot = {
			controlPlaneAvailable: true,
			windows: preflight?.windows ?? [],
			fetchedAt: new Date(at).toISOString()
		};
		const tier = preflight?.tier ?? summary.tier ?? workspace.personalTier;
		if (tier !== void 0) snapshot.tier = tier;
		if (summary.subscriptionStatus !== void 0) snapshot.subscriptionStatus = summary.subscriptionStatus;
		if (summary.currentPeriodEnd !== void 0) snapshot.currentPeriodEnd = summary.currentPeriodEnd;
		const balance = summary.balanceUsd ?? preflight?.balanceUsd;
		if (balance !== void 0) snapshot.balanceUsd = balance;
		if (preflight?.funding !== void 0) snapshot.funding = preflight.funding;
		return {
			snapshot,
			...summary.creditsPerUsd === void 0 ? {} : { creditsPerUsd: summary.creditsPerUsd }
		};
	}
};
//#endregion
//#region src/command-locales.ts
const ZH = {
	description: "Open Design 额度与套餐",
	title: "Open Design 额度",
	planLine: "套餐：{tier} · 订阅 {status} · 本期至 {period}",
	windowFiveHour: "5 小时窗口",
	windowSevenDay: "7 天窗口",
	windowOther: "{duration} 秒窗口",
	windowDetail: "{used} / {limit} credits{usd}",
	windowBar: "{label}  {bar}  {percent}%",
	usdEquivalent: "（{usedUsd} / {limitUsd}）",
	modeSuffix: "（{mode}）",
	windowReset: "重置：{when}{mode}",
	walletBalance: "钱包余额：{balance}",
	fundingPlan: "计费口径：先扣 Design Plan 额度，用尽后扣钱包余额。",
	fundingWallet: "计费口径：当前按钱包余额计费，不扣 Design Plan 额度。",
	walletOnly: "Design Plan 未覆盖当前模型（eligible=false），按钱包余额计费。",
	noWindows: "控制面没有返回任何限额窗口。",
	fetchedAt: "数据时间：{when}",
	staleMark: "（数据已过期，展示的是上次成功查询的结果）",
	unavailableNoKey: "暂时读不到额度：CLI 登录态里没有 controlKey。",
	unavailableNoLogin: "暂时读不到额度：没有读到 Open Design CLI 登录态。",
	unavailableUnreachable: "暂时读不到额度：控制面暂时不可达。",
	unavailableHint: "可在控制台查看额度（https://open-design.ai/cloud/dashboard），或在终端执行 `vela login` 后重试。",
	errorText: "读取 Open Design 额度失败：{message}",
	credits: "credits",
	resetUnknown: "未知"
};
const EN = {
	description: "Open Design quota and plan",
	title: "Open Design quota",
	planLine: "Plan: {tier} · subscription {status} · period ends {period}",
	windowFiveHour: "5-hour window",
	windowSevenDay: "7-day window",
	windowOther: "{duration}s window",
	windowDetail: "{used} / {limit} credits{usd}",
	windowBar: "{label}  {bar}  {percent}%",
	usdEquivalent: " ({usedUsd} / {limitUsd})",
	modeSuffix: " ({mode})",
	windowReset: "Resets: {when}{mode}",
	walletBalance: "Wallet balance: {balance}",
	fundingPlan: "Billing: Design Plan credits first, then the wallet balance.",
	fundingWallet: "Billing: charged to the wallet balance; Design Plan credits are not used.",
	walletOnly: "The Design Plan does not cover this model (eligible=false); the wallet balance is charged.",
	noWindows: "The control plane returned no limit windows.",
	fetchedAt: "Fetched: {when}",
	staleMark: " (stale: showing the last successful reading)",
	unavailableNoKey: "Quota is unavailable: the CLI login state has no controlKey.",
	unavailableNoLogin: "Quota is unavailable: no Open Design CLI login state was found.",
	unavailableUnreachable: "Quota is unavailable: the control plane is unreachable right now.",
	unavailableHint: "Check your quota at https://open-design.ai/cloud/dashboard, or run `vela login` and try again.",
	errorText: "Reading Open Design quota failed: {message}",
	credits: "credits",
	resetUnknown: "unknown"
};
const COPY = {
	zh: ZH,
	en: EN
};
/** 取一条文案并填充占位符；缺失的键回落到英文副本。 */
function commandCopy(locale, key, values = {}) {
	return (COPY[locale]?.[key] ?? EN[key]).replace(/\{(\w+)\}/gu, (match, name) => values[name] ?? match);
}
//#endregion
//#region src/readable-error.ts
/**
* Readable error text for the settings page AND the Host-side failure paths.
*
* @module dsh-opendesign-provider/readable-error
*/
/**
* Turn a caught value into readable text.
*
* `error instanceof Error ? error.message : String(error)` degrades to the
* literal string `[object Object]` for a plain object with no `Error`
* prototype — which is exactly what a Remote call across the webview/host
* boundary can hand back: `dsh-typert-protocol` serializes a rejection for
* the wire, and a structurally-cloned value loses its prototype chain even
* when the host threw a real `Error` (issue #74). Reading a `message` string
* off the plain object first recovers the original text in that case; only a
* value with neither an `Error` prototype nor a usable `message` field falls
* through to a JSON dump.
*
* Shared by both halves on purpose. The browser client needs it for rejections
* that crossed the RPC boundary, and the Host needs it for values that reached
* it from a transport, a JSON body, or a user-thrown non-Error — the same
* degradation, one owner.
*/
function readableErrorText(error) {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (error !== null && typeof error === "object") {
		const message = error.message;
		if (typeof message === "string" && message !== "") return message;
		try {
			return JSON.stringify(error);
		} catch {
			return Object.prototype.toString.call(error);
		}
	}
	return String(error);
}
//#endregion
//#region src/commands.ts
/** 把 `Config.lang` 这类自由字符串收敛成支持的语言。 */
function resolveCommandLocale(value) {
	return value === "en" ? "en" : "zh";
}
/** 本地时间 `YYYY-MM-DD HH:mm`；坏时间戳返回 undefined，由调用方决定空态。 */
function formatDateTime(iso) {
	if (iso === void 0) return void 0;
	const date = new Date(iso);
	if (!Number.isFinite(date.getTime())) return void 0;
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** 十格方块条；上限未知（<=0）时整条留空，不假装已用满。 */
function bar(used, limit) {
	if (!(limit > 0)) return "░".repeat(10);
	const ratio = Math.max(0, Math.min(1, used / limit));
	const filled = ratio > 0 ? Math.max(1, Math.round(ratio * 10)) : 0;
	return "█".repeat(filled) + "░".repeat(10 - filled);
}
/** credits 整除显示；小数只出现在美元当量里。 */
function formatCredits(value) {
	return String(Math.round(value));
}
/** credits → 美元当量；没有 `creditsPerUsd` 时整段省略，不猜汇率。 */
function usdEquivalent(credits, creditsPerUsd) {
	if (creditsPerUsd === void 0 || !(creditsPerUsd > 0)) return void 0;
	return `$${(credits / creditsPerUsd).toFixed(2)}`;
}
function windowLabel(window, locale) {
	if (window.kind === "five_hour") return commandCopy(locale, "windowFiveHour");
	if (window.kind === "seven_day") return commandCopy(locale, "windowSevenDay");
	return commandCopy(locale, "windowOther", { duration: String(window.durationSeconds) });
}
/** 一个窗口两行：方块条 + 百分比，明细 + 重置时间（含 resetMode）。 */
function renderWindow(window, creditsPerUsd, locale) {
	const label = windowLabel(window, locale);
	const percent = window.limitCredits > 0 ? Math.round(window.usedCredits / window.limitCredits * 100) : 0;
	const usedUsd = usdEquivalent(window.usedCredits, creditsPerUsd);
	const limitUsd = usdEquivalent(window.limitCredits, creditsPerUsd);
	const usd = usedUsd === void 0 || limitUsd === void 0 ? "" : commandCopy(locale, "usdEquivalent", {
		usedUsd,
		limitUsd
	});
	const resetText = formatDateTime(window.resetsAt) ?? commandCopy(locale, "resetUnknown");
	const mode = window.resetMode === void 0 ? "" : commandCopy(locale, "modeSuffix", { mode: window.resetMode });
	return [commandCopy(locale, "windowBar", {
		label,
		bar: bar(window.usedCredits, window.limitCredits),
		percent: String(percent)
	}), `  ${commandCopy(locale, "windowDetail", {
		used: formatCredits(window.usedCredits),
		limit: formatCredits(window.limitCredits),
		usd
	})} · ${commandCopy(locale, "windowReset", {
		when: resetText,
		mode
	})}`];
}
/** 把一次读取渲染成完整的纯文本看板。 */
function renderQuota(reading, locale) {
	const snapshot = reading.snapshot;
	const lines = [commandCopy(locale, "title"), ""];
	if (!snapshot.controlPlaneAvailable) {
		const key = reading.reason === "login-unavailable" ? "unavailableNoLogin" : reading.reason === "unreachable" ? "unavailableUnreachable" : "unavailableNoKey";
		lines.push(commandCopy(locale, key), "", commandCopy(locale, "unavailableHint"));
		return lines.join("\n").trimEnd();
	}
	const planParts = [];
	if (snapshot.tier !== void 0) planParts.push(snapshot.tier);
	if (snapshot.subscriptionStatus !== void 0) planParts.push(snapshot.subscriptionStatus);
	const period = formatDateTime(snapshot.currentPeriodEnd);
	if (planParts.length > 0) lines.push(commandCopy(locale, "planLine", {
		tier: snapshot.tier ?? "—",
		status: snapshot.subscriptionStatus ?? "—",
		period: period ?? "—"
	}));
	if (snapshot.windows.length === 0) lines.push(snapshot.funding === "wallet" ? commandCopy(locale, "walletOnly") : commandCopy(locale, "noWindows"));
	else for (const window of snapshot.windows) lines.push("", ...renderWindow(window, reading.creditsPerUsd, locale));
	if (snapshot.balanceUsd !== void 0) lines.push("", commandCopy(locale, "walletBalance", { balance: `$${snapshot.balanceUsd.toFixed(2)}` }));
	if (snapshot.funding === "coding_plan") lines.push(commandCopy(locale, "fundingPlan"));
	else if (snapshot.funding === "wallet") lines.push(commandCopy(locale, "fundingWallet"));
	const fetched = formatDateTime(snapshot.fetchedAt);
	if (fetched !== void 0) {
		const stale = snapshot.stale === true ? commandCopy(locale, "staleMark") : "";
		lines.push("", commandCopy(locale, "fetchedAt", { when: fetched }) + stale);
	}
	return lines.join("\n").trimEnd();
}
/** 唯一的 `/opendesign` 命令定义。 */
function commandDefinition(deps) {
	return {
		name: "opendesign",
		description: "Open Design quota and plan",
		handler: async () => {
			const locale = deps.getLocale?.() ?? "zh";
			let model;
			try {
				model = await deps.model?.();
			} catch {
				model = void 0;
			}
			try {
				return {
					kind: "success",
					text: renderQuota(await deps.quota(model), locale)
				};
			} catch (error) {
				return {
					kind: "error",
					text: commandCopy(locale, "errorText", { message: readableErrorText(error) })
				};
			}
		}
	};
}
/** 在 `ctx.commands` 上注册命令（插件入口调用；`commands` 是可选服务）。 */
function applyCommands(ctx, deps) {
	ctx.commands.register(commandDefinition(deps));
}
//#endregion
//#region src/catalog-snapshot.ts
/** Canonical level order: the rank used by the picker and by coercions. */
const REASONING_LEVEL_ORDER = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/** The model the gateway marks default, kept at the top of the picker. */
const DEFAULT_MODEL_ID = "deepseek-v4.1-flash";
const ALL_LEVELS = REASONING_LEVEL_ORDER;
/** glm's gateway accepts only these three; minimal/medium/xhigh are folded. */
const GLM_LEVELS = [
	"low",
	"high",
	"max"
];
/** The 12-model snapshot, in the gateway's own id order. */
const CATALOG_SNAPSHOT = [
	{
		id: "claude-haiku-5.5",
		name: "Claude Haiku 5.5",
		contextWindow: 228e3,
		maxTokens: 128e3,
		cost: "low",
		capability: "standard",
		inputModalities: [
			"text",
			"image",
			"file"
		],
		reasoningLevels: ALL_LEVELS
	},
	{
		id: "deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		contextWindow: 232e3,
		maxTokens: 32e3,
		cost: "medium",
		capability: "standard",
		inputModalities: ["text"],
		reasoningLevels: ALL_LEVELS
	},
	{
		id: "deepseek-v4-flash-vision-exp",
		name: "DeepSeek V4 Flash Vision Exp",
		contextWindow: 232e3,
		maxTokens: 32e3,
		cost: "medium",
		capability: "standard",
		inputModalities: ["text", "image"],
		reasoningLevels: ALL_LEVELS
	},
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		contextWindow: 328e3,
		maxTokens: 128e3,
		cost: "high",
		capability: "advanced",
		inputModalities: ["text"],
		reasoningLevels: ALL_LEVELS
	},
	{
		id: DEFAULT_MODEL_ID,
		name: "DeepSeek V4.1 Flash",
		contextWindow: 328e3,
		maxTokens: 128e3,
		cost: "low",
		capability: "advanced",
		inputModalities: ["text", "image"],
		reasoningLevels: ALL_LEVELS,
		default: true
	},
	{
		id: "glm-5.3-flash",
		name: "GLM-5.3 Flash",
		contextWindow: 232e3,
		maxTokens: 32e3,
		cost: "low",
		capability: "advanced",
		inputModalities: [
			"text",
			"image",
			"video"
		],
		reasoningLevels: GLM_LEVELS
	},
	{
		id: "glm-5.3-flashx",
		name: "GLM-5.3 Flash-X",
		contextWindow: 232e3,
		maxTokens: 32e3,
		cost: "medium",
		capability: "advanced",
		inputModalities: [
			"text",
			"image",
			"file",
			"video"
		],
		reasoningLevels: GLM_LEVELS
	},
	{
		id: "gpt-6-luna",
		name: "GPT-6 Luna",
		contextWindow: 4e5,
		maxTokens: 128e3,
		cost: "low",
		capability: "standard",
		inputModalities: [
			"text",
			"image",
			"file"
		],
		reasoningLevels: ALL_LEVELS
	},
	{
		id: "hy4-preview",
		name: "Hunyuan H4 Preview",
		contextWindow: 232e3,
		maxTokens: 32e3,
		cost: "medium",
		capability: "advanced",
		inputModalities: ["text"],
		reasoningLevels: ALL_LEVELS
	},
	{
		id: "kimi-k2.7-code",
		name: "Kimi K2.7 Code",
		contextWindow: 262e3,
		maxTokens: 65536,
		cost: "medium",
		capability: "advanced",
		inputModalities: ["text", "image"],
		reasoningLevels: [
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh"
		]
	},
	{
		id: "mimo-v2.6-flash",
		name: "MiMo V2.6 Flash",
		contextWindow: 232e3,
		maxTokens: 32e3,
		cost: "low",
		capability: "standard",
		inputModalities: [
			"text",
			"image",
			"audio",
			"video"
		],
		reasoningLevels: ALL_LEVELS
	},
	{
		id: "mimo-v2.6-pro",
		name: "MiMo V2.6 Pro",
		contextWindow: 232e3,
		maxTokens: 32e3,
		cost: "medium",
		capability: "advanced",
		inputModalities: [
			"text",
			"image",
			"audio",
			"video"
		],
		reasoningLevels: ALL_LEVELS
	}
];
/** Look one snapshot entry up by exact model id; unknown ids answer `undefined`. */
function findCatalogModel(id) {
	return CATALOG_SNAPSHOT.find((entry) => entry.id === id);
}
/**
* The picker's order (design §5.4): the default model first, then `advanced`
* ahead of `standard`, cheaper ahead of dearer, and the id as the tie-break so
* two loads never disagree.
*
* Exported because the live catalog merges gateway rows into the same shape;
* both listings must sort through this one comparator or the picker would
* reorder itself when the gateway becomes reachable.
*/
function compareCatalogEntries(left, right) {
	const costRank = {
		low: 0,
		medium: 1,
		high: 2
	};
	if (left.default === true || right.default === true) return left.default === true ? -1 : 1;
	if (left.capability !== right.capability) return left.capability === "advanced" ? -1 : 1;
	const leftCost = costRank[left.cost];
	const rightCost = costRank[right.cost];
	if (leftCost !== rightCost) return leftCost - rightCost;
	return left.id.localeCompare(right.id);
}
/**
* The modalities the harness vocabulary can declare for this model: it knows
* `text` and `image` only, so `file`/`audio`/`video` are not advertised even
* when the vendor lists them — the adapter refuses those attachments anyway.
*/
function hostInputModalities(entry) {
	return entry.inputModalities.includes("image") ? ["text", "image"] : ["text"];
}
/** One-line picker subtitle: capability and cost tiers, then the usable window. */
function describeCatalogModel(entry) {
	return `${entry.capability} · ${entry.cost} cost · ${Math.round(entry.contextWindow / 1e3)}K context`;
}
/** 自定义上下文长度接受的上界（token）；覆盖任何已知模型窗口仍留有余量。 */
const CONTEXT_WINDOW_MAX = 1e7;
/**
* 判定一个值能否作为自定义上下文长度：边界内的安全整数，符合宿主模型元数据约束。
*
* 程序化构造的连接可能绕过 schemastery 归一化，所以 `resolveAdapterOptions`
* 也要重新判定——越界或非数值直接丢弃，回落到目录公布值，而不是让请求带着
* 一个网关会拒绝的窗口上线。
*/
function isValidContextWindow(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1e7;
}
/**
* 只接收合法条目的按模型覆盖表；空表、非对象与非法数值一律视为未设置。
* 配置校验会拒绝非整数或越界值；本函数额外保护绕过配置校验的程序化调用，
* 丢弃坏条目，不把非法窗口交给宿主。返回新对象；未设置时为 `undefined`。
*/
function readContextWindowOverrides(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return void 0;
	const entries = Object.entries(raw).filter((entry) => entry[0] !== "" && isValidContextWindow(entry[1]));
	return entries.length === 0 ? void 0 : Object.fromEntries(entries);
}
/**
* 一次模型解析的有效上下文长度：按模型覆盖 → 全局值 → 目录公布值。
*
* 适配器只在有目录条目时调用（未知模型保持既有的「无上下文宣告」形状），
* 所以 `catalog` 是已知的正数；按模型覆盖与全局值在 `resolveAdapterOptions`
* 已清洗，这里对程序化构造的连接再判一次，坏值静默回落到目录值。
*/
function effectiveContextWindow(catalog, model, options) {
	const perModel = options.contextWindowOverrides?.[model];
	if (isValidContextWindow(perModel)) return perModel;
	if (isValidContextWindow(options.contextWindow)) return options.contextWindow;
	return catalog;
}
//#endregion
//#region src/quirks.ts
/**
* 兼容规则（ticket 02）—— 本票需要的最小一组逐模型 quirks。
*
* 这里的规则都来自协议实测（`docs/grill/20261020-opendesign-protocol-probe.md`
* §3.2 / §3.3 / §5）与设计件 §4.3–§4.4：
*
* - `off` 必须发字面量 `"none"`；省略字段上游仍会思考。
* - 输出上限字段是 `max_completion_tokens`；`max_tokens` 全员不认。
* - glm 只接受 low/high/max，kimi 没有 off/max —— 逐模型档位域来自目录快照，
*   本模块只做「域内收敛」与「上线字面量映射」，不另存第二份档位表。
* - gpt-6-luna 与 claude-haiku-5.5 在 Chat 面完全不吐 `reasoning`（实测），它们的
*   思考只在 Responses / Messages 面可见；这不是 bug，界面上要标注「思考不可见」。
* - 上游不认输出上限（glm 实测 16 → 74 tokens）时由客户端硬截断兜底
*   （`stream-response.ts`，ticket 05）；kimi 的 low/medium 档另有思考预算门限。
*
* @module dsh-opendesign-provider/quirks
*/
/** The only output-cap field the gateway honours (`max_tokens` is ignored by every model). */
const OUTPUT_CAP_FIELD = "max_completion_tokens";
/** The wire spelling of "do not think": a literal, not an omitted field. */
const WIRE_REASONING_OFF = "none";
/** Unknown model ids get the full domain until the live directory teaches us otherwise (ticket 03). */
const UNKNOWN_MODEL_LEVELS = REASONING_LEVEL_ORDER;
/** Levels one model accepts, by exact id; unknown ids get the full set. */
function reasoningLevelsFor(model) {
	return findCatalogModel(model)?.reasoningLevels ?? UNKNOWN_MODEL_LEVELS;
}
/**
* The `reasoning_effort` value to send, or `undefined` to send no field.
*
* `off` is the one level whose wire spelling differs: the gateway accepts the
* literal `"none"` and rejects omission as "please think anyway".
*/
function wireReasoningEffort(level) {
	if (level === void 0) return void 0;
	return level === "off" ? WIRE_REASONING_OFF : level;
}
/**
* glm's three-tier domain cannot express the harness's seven levels. Design
* §4.4 fixes the fold: anything lighter than `high` collapses to `low`, and
* `xhigh` folds up to `max`.
*/
const COARSE_LEVEL_FOLDS = {
	off: "low",
	minimal: "low",
	low: "low",
	medium: "low",
	high: "high",
	xhigh: "max",
	max: "max"
};
/** Whether the model's domain is glm's coarse low/high/max set. */
function hasCoarseDomain(levels) {
	return levels.length === 3 && levels[0] === "low" && levels[1] === "high" && levels[2] === "max";
}
/**
* The nearest level this model actually accepts.
*
* A legal level passes through untouched. For a contiguous domain (kimi's
* `minimal..xhigh`) the requested level is clamped into range; for glm's coarse
* domain the design's explicit fold is applied instead of a distance rule, so
* `medium` cannot land on `high` and `xhigh` cannot stay on `high`.
*/
function coerceReasoningLevel(model, level) {
	const levels = reasoningLevelsFor(model);
	if (levels.includes(level)) return level;
	if (hasCoarseDomain(levels)) return COARSE_LEVEL_FOLDS[level];
	const target = REASONING_LEVEL_ORDER.indexOf(level);
	let best = levels[0] ?? level;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of levels) {
		const distance = Math.abs(REASONING_LEVEL_ORDER.indexOf(candidate) - target);
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}
/** 在 Chat Completions 面不吐 `reasoning` 的模型（协议实测 §3.3）。 */
const CHAT_THINKING_HIDDEN = ["gpt-6-luna", "claude-haiku-5.5"];
/**
* 该模型在 Chat 面是否会把思考发出来。
*
* 两个模型把思考藏在上游（gpt-6-luna 只在 `/v1/responses` 的 reasoning 项里给、
* claude-haiku-5.5 在 Chat 流里从不发 `reasoning`）。界面据此标注「思考不可见」，
* 用户才不用把「没有思考块」误读成「模型没思考」。
*/
function thinkingVisibleInChat(model) {
	return !CHAT_THINKING_HIDDEN.includes(model);
}
/**
* Messages 面「能给出可读思考、而 Chat 面看不到」的模型（ticket 13 的自动选路依据）。
*
* 实测（2026-10-21，真实 Key）：
* - `claude-haiku-5.5` 只有请求里显式开 `thinking` 才会吐 `thinking_delta`，且
*   Chat 面从不发 `reasoning`——换传输才是多出来的能力；
* - `gpt-6-luna` 在 Messages 面只回 `redacted_thinking`（加密块，无可读文本），
*   它的思考要在 `/v1/responses` 的 reasoning 项里才看得到，本插件不做那条协议，
*   所以它留在 Chat 面，不制造「切了也看不见」的传输；
* - `deepseek` 等模型两面都有可读思考，没有切过去的理由。
*/
function messagesThinkingVisible(model) {
	return model === "claude-haiku-5.5";
}
/**
* 显式思考档在 Messages 面要发的 `thinking.budget_tokens`。
*
* Anthropic 要求 `budget_tokens >= 1024` 且严格小于 `max_tokens`，两者都给不出
* 时就不发这个字段（宁可不显式开思考，也不发一个会被 400 拒掉的预算）。
*/
const MESSAGES_THINKING_BUDGETS = {
	off: 0,
	minimal: 1024,
	low: 1024,
	medium: 2048,
	high: 4096,
	xhigh: 8192,
	max: 16384
};
/** 该档在 Messages 面的思考预算；`undefined` = 不显式开思考。 */
function messagesThinkingBudget(level, cap) {
	if (level === void 0 || level === "off") return void 0;
	const wanted = MESSAGES_THINKING_BUDGETS[level];
	const budget = Math.min(wanted, Math.floor(cap) - 1);
	return budget >= 1024 ? budget : void 0;
}
/** kimi 是唯一有思考预算门限的模型（设计件 §4.3）。 */
const KIMI_MODEL_ID$1 = "kimi-k2.7-code";
/**
* kimi 各档的 `thinking_budget`（token），来自 2026-10-20 的逐档实测：
*
* - `minimal` 与 `low` → 8192；
* - `medium` → 32768；
* - `high` / `xhigh` → 无门限：`max_completion_tokens` 给 16 甚至 1 都返回 200，
*   上游没有可收敛的预算。设计件写的「high 更高」是当时的假设，实测不支持，
*   所以不编一个数字：给小上限就让它真截断。
*
* 报错原文：`max_completion_tokens [8192] must be greater than thinking_budget [8192]`。
*/
const KIMI_THINKING_BUDGETS = {
	minimal: 8192,
	low: 8192,
	medium: 32768
};
/**
* 该模型在该思考档的 `thinking_budget`；`undefined` = 这一档没有预算门限。
*
* 只对 kimi 生效：其他模型的档位不影响输出上限。
*/
function thinkingBudgetFor(model, level) {
	if (model !== KIMI_MODEL_ID$1 || level === void 0) return void 0;
	return KIMI_THINKING_BUDGETS[level];
}
/**
* 该档可用的最小 `max_completion_tokens`：上游要求严格「大于」预算，
* 所以是预算 + 1；没有门限的档返回 `undefined`。
*/
function outputCapFloor(model, level) {
	const budget = thinkingBudgetFor(model, level);
	return budget === void 0 ? void 0 : budget + 1;
}
/** 成功目录缓存的有效期（5 分钟，设计件 §5.1）。 */
const CATALOG_TTL_MS = 3e5;
/** 失败后到下一次重试的等待窗口（10 秒，设计件 §5.1）。 */
const CATALOG_RETRY_TTL_MS = 1e4;
/** kimi 的思考档需要比 `output_budget` 更大的上限（设计件 §5.1）。 */
const KIMI_MODEL_ID = "kimi-k2.7-code";
const KIMI_MIN_OUTPUT_TOKENS = 65536;
/**
* 严格解析 `GET /models` 的响应体：`{object:'list', data:[…]}`。
*
* 形状不合法一律抛 `PROTOCOL_ERROR`，由目录来源捕获后回落静态快照——坏目录
* 不能变成「0 个模型」的空选择器，也不能让选择器崩掉。
*/
function parseGatewayCatalog(payload) {
	if (!isRecord$2(payload)) throw protocolError("响应体不是 JSON 对象");
	if (payload.object !== "list") throw protocolError("缺少顶层 object:\"list\"");
	if (!Array.isArray(payload.data)) throw protocolError("缺少 data 数组");
	const models = payload.data.map((item, index) => parseGatewayModel(item, index));
	return {
		data: payload.data,
		models
	};
}
/** 拉取并解析一次实时目录；网络、HTTP 与解析失败都抛 {@link LlmError}。 */
async function fetchGatewayCatalog(request) {
	const fetchImpl = request.fetchImpl ?? fetch;
	const url = `${normalizeApiBase(request.apiBase)}/models`;
	let response;
	let raw;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			headers: {
				authorization: `Bearer ${request.apiKey}`,
				accept: "application/json"
			},
			signal: AbortSignal.timeout(Math.max(1, Math.trunc(request.timeoutMs ?? 1e4)))
		});
		raw = await response.text();
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new LlmError(`Open Design 目录暂时不可达：${reason}`, "TRANSPORT", { cause: error });
	}
	if (!response.ok) throw catalogHttpFailure(response.status);
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw protocolError("响应体不是合法 JSON");
	}
	return parseGatewayCatalog(parsed);
}
/**
* 把网关条目合并成选择器条目：网关决定「有哪些模型」，快照补「这个模型是什么」。
*
* 已知 id 用快照的显示名、思考档与模态；快照外的新模型标题化显示名、给全档
* 思考域、不给图片能力，并标记「未校准」。网关的 `enabled:false` 条目不进
* 选择器（按 Key 裁剪的一部分）。
*/
function mergeGatewayCatalog(facts) {
	const merged = [];
	for (const fact of facts) {
		if (!fact.enabled) continue;
		const known = findCatalogModel(fact.id);
		merged.push({
			id: fact.id,
			name: known?.name ?? titleizeModelId(fact.id),
			contextWindow: fact.contextBudget ?? fact.contextLimit ?? known?.contextWindow ?? 128e3,
			maxTokens: mergedMaxTokens(fact, known),
			cost: fact.cost ?? known?.cost ?? "medium",
			capability: fact.capability ?? known?.capability ?? "standard",
			inputModalities: known?.inputModalities ?? ["text"],
			reasoningLevels: known?.reasoningLevels ?? REASONING_LEVEL_ORDER,
			default: fact.default,
			calibrated: known !== void 0
		});
	}
	return merged.sort(compareCatalogEntries);
}
/** 内置 12 模型快照，按选择器顺序；网关不可达时的全量回退。 */
function staticGatewayCatalog() {
	return [...CATALOG_SNAPSHOT].map(snapshotEntry).sort(compareCatalogEntries);
}
/** 按 id 取静态快照条目；会话历史里的旧模型仍能解析出自己的能力。 */
function staticGatewayCatalogEntry(id) {
	const snapshot = findCatalogModel(id);
	return snapshot === void 0 ? void 0 : snapshotEntry(snapshot);
}
/**
* 选择器副标题：档位、成本与可用窗口；未校准与思考不可见的模型明确标注。
*
* 「思考不可见」是逐模型兼容事实（`quirks.ts`），不是 UI 新字段：标注跟着描述
* 一起走，模型卡与选择器都能看到同一句话。
*/
function describeGatewayCatalogEntry(entry) {
	const base = describeCatalogModel(entry);
	const described = entry.calibrated ? base : `${base} · 未校准`;
	return thinkingVisibleInChat(entry.id) ? described : `${described} · 思考不可见`;
}
/**
* 目录来源：持有一次进程内的目录状态，缓存与 TTL 都绑定 `apiBase`。
*
* 加载永远不抛错：目录是选择器的可选增强，网关故障只该降级为静态快照。
*/
var GatewayCatalogSource = class {
	fetchImpl;
	now;
	timeoutMs;
	loaded;
	inFlight;
	constructor(deps = {}) {
		this.fetchImpl = deps.fetchImpl;
		this.now = deps.now ?? Date.now;
		this.timeoutMs = deps.timeoutMs;
	}
	/**
	* 取当前目录：内存命中 → 磁盘缓存命中 → 请求网关；任何失败都回落到静态
	* 快照并记录原因。`apiKey` 是惰性解析的，未配置 Key 时也能列出静态模型。
	*/
	async load(connection, apiKey) {
		const apiBase = normalizeApiBase(connection.apiBase);
		const now = this.now();
		if (this.loaded !== void 0 && this.loaded.apiBase === apiBase && this.isFresh(this.loaded, now)) return statusOf(this.loaded);
		const cached = await readCatalogCache(connection.modelsCachePath, apiBase, now);
		if (cached !== void 0) {
			this.loaded = {
				apiBase,
				source: "live",
				loadedAt: cached.fetchedAt,
				models: cached.models,
				cached: true,
				fetchedAt: cached.fetchedAt
			};
			return statusOf(this.loaded);
		}
		if (this.inFlight !== void 0 && this.inFlight.apiBase === apiBase) return this.inFlight.promise;
		const promise = this.refresh(apiBase, connection.modelsCachePath, apiKey).finally(() => {
			if (this.inFlight?.promise === promise) this.inFlight = void 0;
		});
		this.inFlight = {
			apiBase,
			promise
		};
		return promise;
	}
	/** 同步读当前目录；从不发起网络请求（对话路径不等待目录刷新）。 */
	current(connection) {
		const apiBase = normalizeApiBase(connection.apiBase);
		if (this.loaded !== void 0 && this.loaded.apiBase === apiBase) return statusOf(this.loaded);
		return {
			apiBase,
			source: "static",
			models: staticGatewayCatalog(),
			cached: false
		};
	}
	async refresh(apiBase, modelsCachePath, apiKey) {
		try {
			const parsed = await fetchGatewayCatalog({
				apiBase,
				apiKey: await apiKey(),
				...this.fetchImpl === void 0 ? {} : { fetchImpl: this.fetchImpl },
				...this.timeoutMs === void 0 ? {} : { timeoutMs: this.timeoutMs }
			});
			const fetchedAt = this.now();
			await writeCatalogCache(modelsCachePath, {
				version: 1,
				apiBase,
				fetchedAt,
				data: parsed.data
			});
			this.loaded = {
				apiBase,
				source: "live",
				loadedAt: fetchedAt,
				models: mergeGatewayCatalog(parsed.models),
				cached: false,
				fetchedAt
			};
		} catch (error) {
			this.loaded = {
				apiBase,
				source: "static",
				loadedAt: this.now(),
				models: staticGatewayCatalog(),
				cached: false,
				reason: failureReasonOf(error)
			};
		}
		return statusOf(this.loaded);
	}
	isFresh(loaded, now) {
		const ttl = loaded.source === "live" ? CATALOG_TTL_MS : CATALOG_RETRY_TTL_MS;
		return now - loaded.loadedAt < ttl;
	}
};
/** 目录请求共用的地址归一：去掉尾部斜杠，端点拼接才唯一。 */
function normalizeApiBase(apiBase) {
	return (apiBase || "").replace(/\/+$/u, "");
}
/** 一次解析失败：稳定报 `PROTOCOL_ERROR`，附上具体缺了哪一块。 */
function protocolError(detail) {
	return new LlmError(`Open Design 返回的模型目录形状不合法（${detail}），已改用内置静态快照。`, "PROTOCOL_ERROR");
}
/** 非 2xx 的目录请求：仍按 401/5xx/其余分类，供来源标记原因。 */
function catalogHttpFailure(status) {
	if (status === 401 || status === 403) return new LlmError(`Open Design 拒绝了这把 API Key（${status}），模型目录改用内置静态快照。`, "AUTH", { status });
	if (status >= 500) return new LlmError(`Open Design 网关暂时不可用（HTTP ${status}），模型目录改用内置静态快照。`, "SERVER", { status });
	return new LlmError(`Open Design 拒绝了目录请求（HTTP ${status}），模型目录改用内置静态快照。`, "INVALID_REQUEST", { status });
}
/** 把失败原因收敛成设置页可读的一档，不把上游正文带进 UI。 */
function failureReasonOf(error) {
	if (!(error instanceof LlmError)) return "unreachable";
	switch (error.code) {
		case "AUTH": return "auth";
		case "PROTOCOL_ERROR": return "protocol";
		case "MISSING_CREDENTIAL": return "missing-credential";
		case "SERVER":
		case "INVALID_REQUEST":
		case "RATE_LIMIT":
		case "QUOTA_EXHAUSTED": return "http";
		default: return "unreachable";
	}
}
/** 一条网关模型：缺省 `enabled:true`、`default:false`；多余字段忽略。 */
function parseGatewayModel(item, index) {
	if (!isRecord$2(item)) throw protocolError(`data[${index}] 不是对象`);
	const id = item.id;
	if (typeof id !== "string" || id === "") throw protocolError(`data[${index}].id 不是非空字符串`);
	const enabled = readBoolean(item.enabled, true, `data[${index}].enabled`);
	const isDefault = readBoolean(item.default, false, `data[${index}].default`);
	const metadata = optionalRecord(item.metadata, `data[${index}].metadata`);
	const architecture = optionalRecord(item.architecture, `data[${index}].architecture`);
	return {
		id,
		enabled,
		default: isDefault,
		contextLimit: optionalTokenCount(metadata?.context_limit, `data[${index}].metadata.context_limit`),
		contextBudget: optionalTokenCount(metadata?.context_budget, `data[${index}].metadata.context_budget`),
		outputBudget: optionalTokenCount(metadata?.output_budget, `data[${index}].metadata.output_budget`),
		cost: optionalCost(metadata?.cost, `data[${index}].metadata.cost`),
		capability: optionalCapability(metadata?.capability, `data[${index}].metadata.capability`),
		inputModalities: readInputModalities(architecture?.input_modalities, `data[${index}].architecture.input_modalities`)
	};
}
/**
* 快照外 id 的显示名：按 `-` / `_` / `/` 切词并首字母大写
* （`brand-new-model` → `Brand New Model`）。取自网关的 id 只做展示，不改写。
*/
function titleizeModelId(id) {
	return id.split(/[-_/]+/u).filter((part) => part !== "").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || id;
}
/** 输出上限：网关值优先，kimi 额外保证 65536。 */
function mergedMaxTokens(fact, known) {
	if (fact.id === KIMI_MODEL_ID) return Math.max(fact.outputBudget ?? 32768, known?.maxTokens ?? KIMI_MIN_OUTPUT_TOKENS);
	return fact.outputBudget ?? known?.maxTokens ?? 32768;
}
/** 静态快照的一条，补齐成与网关条目相同的形状。 */
function snapshotEntry(snapshot) {
	return {
		id: snapshot.id,
		name: snapshot.name,
		contextWindow: snapshot.contextWindow,
		maxTokens: snapshot.maxTokens,
		cost: snapshot.cost,
		capability: snapshot.capability,
		inputModalities: snapshot.inputModalities,
		reasoningLevels: snapshot.reasoningLevels,
		default: snapshot.default === true,
		calibrated: true
	};
}
/** 内存目录转对外状态；不泄漏内部持有。 */
function statusOf(loaded) {
	return {
		apiBase: loaded.apiBase,
		source: loaded.source,
		models: loaded.models,
		cached: loaded.cached,
		...loaded.fetchedAt === void 0 ? {} : { fetchedAt: loaded.fetchedAt },
		...loaded.reason === void 0 ? {} : { reason: loaded.reason }
	};
}
/** 读缓存：版本、网关地址、TTL 与形状全部通过才算命中。 */
async function readCatalogCache(path, apiBase, now) {
	try {
		const raw = await readFile(path, "utf8");
		const document = JSON.parse(raw);
		if (!isRecord$2(document)) return void 0;
		if (document.version !== 1) return void 0;
		if (document.apiBase !== apiBase) return void 0;
		const fetchedAt = document.fetchedAt;
		if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)) return void 0;
		if (now - fetchedAt >= 3e5) return void 0;
		return {
			fetchedAt,
			models: mergeGatewayCatalog(parseGatewayCatalog({
				object: "list",
				data: document.data
			}).models)
		};
	} catch {
		return;
	}
}
/** 写缓存：目录不存在就建；写失败只丢缓存，不影响本次目录使用。 */
async function writeCatalogCache(path, document) {
	try {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(document), "utf8");
	} catch {}
}
/** 可选布尔字段；存在但不是布尔即协议错误。 */
function readBoolean(value, fallback, path) {
	if (value === void 0) return fallback;
	if (typeof value !== "boolean") throw protocolError(`${path} 不是布尔值`);
	return value;
}
/** 可选对象字段；存在但不是对象即协议错误。 */
function optionalRecord(value, path) {
	if (value === void 0) return void 0;
	if (!isRecord$2(value)) throw protocolError(`${path} 不是对象`);
	return value;
}
/** 可选 token 预算：正安全整数；存在但越界即协议错误。 */
function optionalTokenCount(value, path) {
	if (value === void 0) return void 0;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw protocolError(`${path} 不是正整数 token 数`);
	return value;
}
/** 可选成本档；存在但不在 low/medium/high 即协议错误。 */
function optionalCost(value, path) {
	if (value === void 0) return void 0;
	if (value === "low" || value === "medium" || value === "high") return value;
	throw protocolError(`${path} 不是 low/medium/high`);
}
/** 可选能力档；存在但不在 standard/advanced 即协议错误。 */
function optionalCapability(value, path) {
	if (value === void 0) return void 0;
	if (value === "standard" || value === "advanced") return value;
	throw protocolError(`${path} 不是 standard/advanced`);
}
/** 模态数组：只留宿主认识的五个词；未知的新模态忽略而不是判坏。 */
function readInputModalities(value, path) {
	if (value === void 0) return [];
	if (!Array.isArray(value)) throw protocolError(`${path} 不是数组`);
	const known = [
		"text",
		"image",
		"file",
		"audio",
		"video"
	];
	const modalities = [];
	for (const entry of value) {
		if (typeof entry !== "string") throw protocolError(`${path} 含非字符串元素`);
		const match = known.find((modality) => modality === entry);
		if (match !== void 0 && !modalities.includes(match)) modalities.push(match);
	}
	return modalities;
}
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region src/image-request.ts
/**
* Long edge one request image may keep, in pixels.
*
* 1568 is Anthropic's documented ceiling — their API downscales anything larger
* before the model sees it — and it sits inside the high-detail band of the
* OpenAI and Gemini tile schemes, so no upstream this gateway reaches reads
* more detail than the target keeps. Screenshots from a Retina display are the
* case this is for: 2880x1800 becomes 1568x980, a 3.4x pixel cut, and the
* models lose nothing they would not have downscaled themselves.
*/
const REQUEST_IMAGE_MAX_LONG_EDGE = 1568;
/**
* Encoded bytes one request image may keep, before base64 expansion. The same
* 1 MiB budget the harness's own multi-provider adapter defaults to; the
* attachment service keeps its smallest quality-ladder output when no quality
* fits, so this bounds bytes without ever refusing an image.
*/
const REQUEST_IMAGE_MAX_ENCODED_BYTES = 1048576;
/**
* Aspect-preserving projection onto a long-edge budget; never enlarges, and
* never returns a zero dimension.
*
* `dsh-attachment` exports an equivalent `longEdgeDimensions`, but it does not
* guard its inputs: a reference whose declared size is 0 or NaN — a malformed
* or fabricated attachment record — would project to a zero-sized target and
* make the encoder refuse the whole request. This local guard is the ONLY
* reason the function is not imported; do not replace it with the upstream one.
* `tests/image-tokens.test.ts` pins the degenerate cases.
*/
function longEdgeDimensions(width, height, longEdge) {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {
		width: Math.max(1, Math.round(width) || 1),
		height: Math.max(1, Math.round(height) || 1)
	};
	if (longEdge >= Math.max(width, height)) return {
		width,
		height
	};
	return width >= height ? {
		width: longEdge,
		height: Math.max(1, Math.round(longEdge * height / width))
	} : {
		width: Math.max(1, Math.round(longEdge * width / height)),
		height: longEdge
	};
}
/**
* The request target for one normalized attachment: its aspect ratio under the
* long-edge budget, plus the encoded-byte budget.
*/
function requestImageTarget(ref) {
	const projected = longEdgeDimensions(ref.width, ref.height, REQUEST_IMAGE_MAX_LONG_EDGE);
	return {
		width: projected.width,
		height: projected.height,
		maxBytes: REQUEST_IMAGE_MAX_ENCODED_BYTES
	};
}
//#endregion
//#region src/image-tokens.ts
/**
* Vision-token accounting for the model families the Open Design gateway routes to.
*
* The harness's token meter prices request images through
* `LlmAdapter.imageRequestPricing(provider, model).priceImages(blocks)` and,
* when a route declares nothing, falls back to a structural estimate that
* charges a handful of tokens for ANY image. On an image-heavy session that is
* not a rounding error: a screenshot loop can carry dozens of full-size images
* that the heuristic prices at ~0 tokens each, so context pressure is
* under-reported and the session walks into its own context window.
*
* This route is a gateway in front of many upstreams, so the estimate is per
* FAMILY, using each vendor's published rule, and the families are recognised
* by the catalog id (which names the vendor). Every formula is stated here
* rather than imported: the only in-tree implementations live inside the
* official adapters, and this plugin deliberately does not depend on those
* protocols. These are ESTIMATES for context accounting, not invoices — the
* provider's own usage remains authoritative for a completed request.
*
* @module dsh-opendesign-provider/image-tokens
*/
/**
* Which family prices one catalog model id.
*
* `generic` is not "we do not know the model" but "we cannot tell its visual
* rule apart from the known ones" — the Qwen, MiniMax, xAI, moonshot and
* sakana families all publish patch- or tile-based accounting close to the
* Anthropic rule, so the conservative fallback below covers them without
* pretending to more precision than we have.
*/
function imageTokenFamily(modelId) {
	const id = modelId.toLowerCase();
	const vendor = id.includes("/") ? id.slice(0, id.indexOf("/")) : "";
	if (id.startsWith("claude")) return "anthropic";
	if (id.startsWith("gpt") || /^o[1-9]/.test(id)) return "openai";
	if (vendor === "google" || id.startsWith("gemini")) return "google";
	if (vendor === "deepseek") return "deepseek";
	return "generic";
}
/**
* Visual tokens one request image costs on the given family, at the dimensions
* this route would actually send (see `./image-request.ts`).
*/
function imageTokenCost(family, width, height) {
	switch (family) {
		case "anthropic": return anthropicImageTokens(width, height);
		case "openai": return openAiImageTokens(width, height);
		case "google": return googleImageTokens(width, height);
		case "deepseek": return deepSeekImageTokens(width, height);
		default: return genericImageTokens(width, height);
	}
}
/** Convenience for callers that have a model id: family lookup plus the rule. */
function openDesignImageTokens(modelId, width, height) {
	return imageTokenCost(imageTokenFamily(modelId), width, height);
}
/**
* Anthropic: the image is first scaled to the request long edge (never
* enlarged), then charged roughly one token per 750 pixels.
* Source: Anthropic vision documentation, "Image size and token usage".
*/
function anthropicImageTokens(width, height) {
	const projected = longEdgeDimensions(width, height, REQUEST_IMAGE_MAX_LONG_EDGE);
	return Math.max(1, Math.ceil(projected.width * projected.height / 750));
}
/**
* OpenAI (high detail): scale to fit inside 2048x2048, then scale the shortest
* side to 768 px, then charge an 85-token base plus 170 tokens per 512x512
* tile. Source: OpenAI vision documentation, "Calculating costs".
*/
function openAiImageTokens(width, height) {
	let scaled = {
		width: Math.max(1, width),
		height: Math.max(1, height)
	};
	const longest = Math.max(scaled.width, scaled.height);
	if (longest > 2048) scaled = scaleBy(scaled, 2048 / longest);
	const shortest = Math.min(scaled.width, scaled.height);
	if (shortest > 768) scaled = scaleBy(scaled, 768 / shortest);
	return 85 + 170 * (Math.ceil(scaled.width / 512) * Math.ceil(scaled.height / 512));
}
/**
* Google Gemini: an image whose both sides are at most 384 px costs a flat 258
* tokens; anything larger is cropped into 768x768 tiles of 258 tokens each.
* Source: Gemini image-understanding documentation.
*/
function googleImageTokens(width, height) {
	if (width <= 384 && height <= 384) return 258;
	return 258 * Math.ceil(width / 768) * Math.ceil(height / 768);
}
/** 14-px patches, merged 3x3 into one token cell. */
const DEEPSEEK_PATCH_SIZE = 14;
const DEEPSEEK_DOWNSAMPLE_RATIO = 3;
/** The provider's cap on tokens for one request image. */
const DEEPSEEK_MAX_IMAGE_TOKENS = 1024;
/** Total-pixel floor; a smaller image is enlarged before grid projection. */
const DEEPSEEK_MIN_PIXELS = 295936;
/**
* DeepSeek: pad to 14-px patches, merge each 3x3 patch block into one token
* cell, charge one token per cell plus one separator per row plus two framing
* tokens, and cap one image at 1024 tokens by downscaling it aspect-preserving
* (images below 544x544 are enlarged first).
*
* Mirrors `deepSeekImageTokens` in the official `dsh-llm-deepseek` adapter
* (its `PATCH_SIZE`, `DOWNSAMPLE_RATIO`, `MAX_IMAGE_TOKENS` and `MIN_PIXELS`).
* The official solver picks the largest grid that fits the cap; this restates
* that as a bounded search over the scale factor, which lands on the same grid
* without vendoring the closed-form solver.
*/
function deepSeekImageTokens(width, height) {
	let scaled = {
		width: Math.max(1, width),
		height: Math.max(1, height)
	};
	const pixels = scaled.width * scaled.height;
	if (pixels < DEEPSEEK_MIN_PIXELS) scaled = scaleBy(scaled, Math.sqrt(DEEPSEEK_MIN_PIXELS / pixels));
	const direct = deepSeekGridTokens(scaled.width, scaled.height);
	if (direct <= DEEPSEEK_MAX_IMAGE_TOKENS) return direct;
	let low = 0;
	let high = 1;
	let best = direct;
	for (let step = 0; step < 24; step += 1) {
		const mid = (low + high) / 2;
		const tokens = deepSeekGridTokens(Math.max(1, Math.round(scaled.width * mid)), Math.max(1, Math.round(scaled.height * mid)));
		if (tokens <= DEEPSEEK_MAX_IMAGE_TOKENS) {
			low = mid;
			best = tokens;
		} else high = mid;
	}
	return best;
}
/** One token grid's charge: every row carries a separator, plus two framing tokens. */
function deepSeekGridTokens(width, height) {
	const cellsWide = cellCount(width);
	return cellCount(height) * (cellsWide + 1) + 2;
}
/** Token cells along one padded pixel axis. */
function cellCount(length) {
	const patches = Math.ceil(length / DEEPSEEK_PATCH_SIZE);
	return Math.ceil(patches / DEEPSEEK_DOWNSAMPLE_RATIO);
}
/**
* The conservative fallback for a family we cannot price exactly: the MOST
* expensive of the three simple published rules at these dimensions.
*
* Chosen deliberately. Under-reporting context is what lets a session walk into
* its own context window, while over-reporting only makes the meter cautious;
* for the real families this covers (Qwen's 28-px patches, MiniMax, xAI,
* moonshot, sakana) the Anthropic rule is the close one, and it is the maximum
* at every size except the sub-384-px band, where Gemini's flat 258 wins.
*/
function genericImageTokens(width, height) {
	return Math.max(anthropicImageTokens(width, height), openAiImageTokens(width, height), googleImageTokens(width, height));
}
/** Scale one dimension pair by a positive factor, rounded to whole pixels. */
function scaleBy(size, factor) {
	return {
		width: Math.max(1, Math.round(size.width * factor)),
		height: Math.max(1, Math.round(size.height * factor))
	};
}
//#endregion
//#region src/display-format.ts
/** Shared, dependency-free formatting for Host commands and browser surfaces. */
/** 毫秒 → 人类可读的秒数；整秒不带小数，其余保留一位。诊断与错误文案共用这一份。 */
function formatSeconds(ms) {
	return ms % 1e3 === 0 ? `${ms / 1e3} 秒` : `${(ms / 1e3).toFixed(1)} 秒`;
}
//#endregion
//#region src/error-taxonomy.ts
/**
* 上游错误的三态分类（ticket 06）。
*
* 网关的失败体有三种外层形状（协议实测 `docs/grill/20261020-opendesign-protocol-probe.md` §5）：
* 结构化 JSON `{"error":{code,message,type}}`、Go 的纯文本 `404 page not found`、
* nginx 的 HTML 错误页。分类只按 `content-type` 与体形状判断，绝不把 HTML 当 JSON 解析。
*
* 分类结论对外只有两件事：一个宿主认识的稳定错误码，和一段用户能照做的中文文案。
* 可重试性由 {@link retryableFailureCodes} 声明，适配器把它交给引擎的重试策略
* （`providerRetryPolicy`），确定性错误因此不会白烧额度。
*
* 本模块只被 Host 半侧引用，不导入 cordis / schemastery。
*
* @module dsh-opendesign-provider/error-taxonomy
*/
/** Codes the engine may retry; everything else fails once and surfaces. */
const RETRYABLE_CODES = [
	"EMPTY_RESPONSE",
	"RATE_LIMIT",
	"TIMEOUT",
	"TRANSIENT",
	"TRANSPORT"
];
/** The retryable set, as data, for the route's `providerRetryPolicy`. */
function retryableFailureCodes() {
	return RETRYABLE_CODES;
}
/**
* Classify one non-2xx exchange.
*
* @param input - status, raw body and the headers that decide the wording.
* @returns the `LlmError` to throw: stable `code`, actionable message, `status`.
*/
function classifyHttpFailure(input) {
	const failure = readFailure(input);
	switch (input.status) {
		case 401:
		case 403: return authFailure(input, failure);
		case 402: return quotaFailure(input, failure);
		case 404: return failure.shape === "json" ? badRequestFailure(input, failure) : protocolFailure(input, failure);
		case 429: return rateLimitFailure(input, failure);
		default:
			if (input.status >= 500) return isDeterministicReason(failure) ? wrappedBadRequestFailure(input, failure) : transientFailure(input, failure);
			if (input.status >= 400) return badRequestFailure(input, failure);
			return transientFailure(input, failure);
	}
}
/**
* 401/403：Key 被拒、不存在，或这把 Key 没有该模型的权限（入口层也可能回 403）。
* 下一步都是检查凭据与工作区权限，重试同一个请求不会变好。
*/
function authFailure(input, failure) {
	const headline = input.status === 403 ? "Open Design 拒绝了这次访问（403）：通常是这把 Key 没有该模型的权限，或入口层拦截了请求。请在 设置 → Open Design 检查 Key 与工作区权限" : "Open Design 拒绝了这把 API Key（401）。请在 设置 → Open Design 重新填入 Key，或到 https://open-design.ai/cloud/api-keys 检查/重建 Key";
	return new LlmError(`${headline}。` + upstreamDetail(failure) + bodyExcerpt(failure), "AUTH", { status: input.status });
}
/** 402：Design Plan 额度或余额不足，下一步是看额度或改用 BYOK。 */
function quotaFailure(input, failure) {
	return new LlmError("Design Plan 额度已用尽或余额不足（402）。请到 Open Design 控制台查看额度并充值，或改用 BYOK（在控制台自备上游 Key 后重试）。" + upstreamDetail(failure), "QUOTA_EXHAUSTED", { status: input.status });
}
/**
* 400（以及 502 包住的确定性 400）：网关把上游的请求拒绝包成自己的错误码，
* 真因在 `message` 的 `[code=…]` 前缀之后。这类错误重试只会得到同一个结果，
* 所以文案要说明「不重试」并把可改的地方指出来。
*/
function badRequestFailure(input, failure) {
	const reason = failure.message ?? failure.code ?? "上游没有给出原因";
	return new LlmError(`Open Design 上游拒绝了这条请求（HTTP ${input.status}）：${truncate$1(reason, 400)}` + requestIdNote(failure) + " 这属于确定性错误，重试同样会失败，本插件不会有任何重试；请按上面的原因修改请求（模型、角色、消息内容或输出上限）后重发。", "BAD_REQUEST", { status: input.status });
}
/**
* 404：地址不存在。Go 的纯文本 404 与 nginx 的 HTML 404 都是入口层给出的，
* 不是上游对请求的拒绝，所以不解析 JSON、也不劝用户改请求——要改的是 apiBase。
*/
function protocolFailure(input, failure) {
	const shape = failure.shape === "html" ? "网关回了一个 HTML 错误页（不是 JSON，多半来自 nginx/入口层）" : "网关回的不是 JSON";
	return new LlmError(`Open Design 网关的这个地址不存在（404）：${shape}。这通常说明 apiBase 配错了路径——插件会请求「{apiBase}/chat/completions」。请在 设置 → Open Design 检查 apiBase（默认 https://amr-link.open-design.ai/v1）。` + bodyExcerpt(failure), "PROTOCOL_ERROR", { status: input.status });
}
/** 非 JSON 体的原文摘录；JSON 体已经取过真因，不再重复引用整段。 */
function bodyExcerpt(failure) {
	return failure.excerpt === void 0 ? "" : ` 上游返回：${failure.excerpt}`;
}
/**
* 502（网关把上游 400 包成 5xx）：真因是确定性的，重试只会重放同一个失败，
* 所以归为 BAD_REQUEST，并把「网关包装过」这一点说清楚，免得用户去查网络。
*/
function wrappedBadRequestFailure(input, failure) {
	const reason = failure.message ?? "上游没有给出原因";
	return new LlmError(`Open Design 网关把上游的请求错误包成了 5xx（HTTP ${input.status}）：${truncate$1(reason, 400)}` + requestIdNote(failure) + " 真因是这条请求本身不被接受，属于确定性错误，重试同样会失败，本插件不会有任何重试；请按上面的原因修改请求（模型、角色、消息内容或输出上限）后重发。", "BAD_REQUEST", { status: input.status });
}
/** 5xx / 传输层：上游或网关的临时故障，交给引擎重试。 */
function transientFailure(input, failure) {
	return new LlmError(`Open Design 网关暂时不可用（HTTP ${input.status}），这通常是上游或网关的临时故障，不是请求本身的问题。插件会自动重试；若反复出现，请稍后再试或查看服务状态。` + upstreamDetail(failure) + bodyExcerpt(failure), "TRANSIENT", { status: input.status });
}
/**
* 429：限流。上游给了 `Retry-After` 就按它的时间等，没给就交给引擎的指数退避；
* 两种都可重试（本插件的临时故障预算最多 3 次，见 `transient-retry.ts`）。
*/
function rateLimitFailure(input, failure) {
	const retryAfterMs = retryAfterMsOf(input.retryAfter);
	const wait = retryAfterMs === void 0 ? "上游没有给出 Retry-After，插件会按指数退避自动重试。" : `上游要求 ${formatSeconds(retryAfterMs)} 后再试，插件会按这个时间等待后自动重试。`;
	return new LlmError(`Open Design 限流了这次请求（429）。${wait} 连续限流时请稍后再发，或降低并发。` + upstreamDetail(failure) + bodyExcerpt(failure), "RATE_LIMIT", {
		status: input.status,
		...retryAfterMs === void 0 ? {} : { providerRetryAfterMs: retryAfterMs }
	});
}
/** `Retry-After` 的秒数形式转成毫秒；缺失或不可解析就是「上游没给」。 */
function retryAfterMsOf(raw) {
	const seconds = Number((raw ?? "").trim());
	if (!Number.isFinite(seconds) || seconds <= 0) return void 0;
	return Math.round(seconds * 1e3);
}
/** 上游原因里明显属于临时故障的措辞：先判它们，避免被下面的否定式误判成确定性。 */
const TRANSIENT_REASON = /timeout|timed out|connection|reset|unavailable|overload|try again|temporar|rate limit|too many requests|internal error/iu;
/** 上游原因里属于「请求本身不被接受」的措辞（设计 §4.6 的确定性清单）。 */
const DETERMINISTIC_REASON = /incorrect role information|empty input messages|previous response|max_completion_tokens|max tokens|context length|context window|not supported|unsupported|invalid (?:model|role|request|parameter|value|image|content|argument)|must be (?:a|at least|less|greater|no more)/iu;
/**
* 一条上游错误是不是确定性的。
*
* 只有拿到具体原因才能判定：包成 5xx 且读不出原因的，按临时故障重试；
* 说得出「角色不对 / 消息为空 / 输出上限越界」这类原因的，重试没有意义。
*/
function isDeterministicReason(failure) {
	if (failure.message === void 0) return false;
	if (TRANSIENT_REASON.test(failure.message)) return false;
	return DETERMINISTIC_REASON.test(failure.message);
}
/**
* 200 但没有可展示的内容：`[DONE]` 之后什么都没有，或只有用量尾帧。
*
* 与协议错误分开：这次请求在上游是「成功」的，只是交回了空回复，重试可能
* 就好了（`EMPTY_RESPONSE` 在引擎的可重试集合里）；协议错误说的是网关根本
* 没按协议回话。
*/
function emptyResponseFailure() {
	return new LlmError("Open Design 的上游返回了空响应（HTTP 200，但流里既没有正文、思考、工具调用，也没有内容可以展示）。这次请求本身没有失败，属于上游异常，插件会自动重试；若反复出现，请换个模型或稍后再试。", "EMPTY_RESPONSE", { status: 200 });
}
/**
* 流空闲超时：连上了、也开始出内容了，然后上游（或代理）停止写入。
*
* 与请求超时分开：请求超时管「第一个字节」；这里管「半路挂住」——不中止的话，
* 一轮对话会一直等一个永远不来的下一个 token。
*/
function idleTimeoutFailure(idleTimeoutMs) {
	const seconds = idleTimeoutMs % 1e3 === 0 ? String(idleTimeoutMs / 1e3) : (idleTimeoutMs / 1e3).toFixed(1);
	return new LlmError(`Open Design 的流在 ${seconds} 秒内没有收到任何新数据（流空闲超时），已中止这次读取以免整轮卡住。常见原因是代理或中间层在长回复时截断了连接；请重试，必要时调大「流空闲超时」设置。`, "TIMEOUT");
}
/** 200 却不是 SSE：网关把 HTML 错误页或别的什么当成功回了。 */
function nonSseBodyFailure(head) {
	const excerpt = head.replace(/\s+/gu, " ").trim();
	return new LlmError("Open Design 网关对这个地址返回的不是 SSE 流（多半是 HTML 错误页或入口层的拦截页），所以无法解析出回复。请检查 apiBase 是否指向网关的 /v1 路径，以及代理是否改写了响应。" + (excerpt === "" ? "" : ` 收到的开头：${truncate$1(excerpt, 120)}`), "PROTOCOL_ERROR", { status: 200 });
}
/** 200 但没有响应体：连字节流都没有。 */
function missingBodyFailure() {
	return new LlmError("Open Design 返回了空的流式响应体，无法读取回复内容。请重试；若反复出现，请检查代理是否截断了流式响应。", "PROTOCOL_ERROR", { status: 200 });
}
/** 上游 request_id 单列一句，报障时可以直接引用。 */
function requestIdNote(failure) {
	return failure.requestId === void 0 ? "" : `（request_id: ${failure.requestId}）`;
}
/** 上游自己的话，从三态形状里取出来；取不到就返回空串。 */
function upstreamDetail(failure) {
	if (failure.shape === "empty") return "";
	if (failure.message !== void 0) return ` 上游原因：${truncate$1(failure.message, 400)}${requestIdNote(failure)}`;
	if (failure.code !== void 0) return ` 上游原因：${truncate$1(failure.code, 200)}`;
	return "";
}
/** `[code=xxx]` 前缀：网关的包装，不是原因本身。 */
const CODE_PREFIX = /^\s*\[code=[^\]]*\]\s*/u;
/** 上游 request_id：实测出现在 400 的 message 里，形如 `(request_id: <uuid>)`。 */
const REQUEST_ID = /\(request_id:\s*([A-Za-z0-9._-]+)\)/u;
/**
* 读出错误体的形状与真因。
*
* 只对 `application/json`（或看起来像 JSON 的对象体）解析；纯文本按原话引用，
* HTML 只承认它是 HTML，不做任何标签解析——把 nginx 页面当 JSON 解析会让
* 插件在网关异常时崩溃，而这正是用户最需要看到设置页的时候。
*/
function readFailure(input) {
	const raw = (input.body ?? "").trim();
	const contentType = (input.contentType ?? "").toLowerCase();
	if (raw === "") return {
		shape: "empty",
		code: void 0,
		message: void 0,
		requestId: void 0,
		excerpt: void 0
	};
	if (contentType.includes("html") || raw.startsWith("<")) return {
		shape: "html",
		code: void 0,
		message: void 0,
		requestId: void 0,
		excerpt: excerptOf(raw)
	};
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			shape: "text",
			code: void 0,
			message: void 0,
			requestId: void 0,
			excerpt: excerptOf(raw)
		};
	}
	const envelope = isRecord$1(parsed) && isRecord$1(parsed.error) ? parsed.error : void 0;
	if (envelope === void 0) return {
		shape: "json",
		code: void 0,
		message: void 0,
		requestId: void 0,
		excerpt: void 0
	};
	const rawMessage = typeof envelope.message === "string" ? envelope.message : "";
	const requestId = REQUEST_ID.exec(rawMessage)?.[1];
	const message = stripRequestId(rawMessage.replace(CODE_PREFIX, "")).trim();
	return {
		shape: "json",
		code: typeof envelope.code === "string" ? envelope.code : void 0,
		message: message === "" ? void 0 : message,
		requestId,
		excerpt: void 0
	};
}
/** 去掉 message 里的 request_id 括注：它会被单列成一句，避免同一串出现两次。 */
function stripRequestId(message) {
	return message.replace(REQUEST_ID, "").replace(/\s{2,}/gu, " ");
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function truncate$1(text, max) {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}
/** 非 JSON 体的摘录：折叠空白（HTML 每行一个标签），截断到 200 字。 */
function excerptOf(raw) {
	return truncate$1(raw.replace(/\s+/gu, " ").trim(), 200);
}
//#endregion
//#region src/output-tokens.ts
/**
* 输出 token 的估算（ticket 05）—— 客户端硬截断的计数依据。
*
* 网关只在尾帧报 `completion_tokens`（协议实测 §3.3–§3.6），等它到达再判断上限
* 已经晚了：不遵守上限的上游（glm 实测 16 → 74 tokens）会先把整段内容发完。
* 所以硬截断必须边收边估。估算规则刻意保守、可解释：
*
* - 中日韩文字、全角符号、假名、谚文与 emoji 按 1 字符 1 token（这些字符在
*   BPE 里几乎都是一字一 token）；
* - 换行按 1 token（`\n` 在主流分词器里独立成 token）；
* - 其余 ASCII 每 3 个字符 1 token（英文约 4 字符/token，短词与标点更密）。
*
* 估算只用于「该停了」，不用于计费或展示；上游一旦报出真实用量，就以真实值为准。
*
* @module dsh-opendesign-provider/output-tokens
*/
/** 估算里 ASCII 字符折算 token 的密度：3 字符 1 token。 */
const ASCII_CHARS_PER_TOKEN = 3;
/** 估算一段增量文本折合多少输出 token（可以是小数，调用方累加后再比较）。 */
function estimateOutputTokens(text) {
	let tokens = 0;
	for (const char of text) if ((char.codePointAt(0) ?? 0) >= 11904 || char === "\n" || char === "\r") tokens += 1;
	else tokens += 1 / ASCII_CHARS_PER_TOKEN;
	return tokens;
}
//#endregion
//#region src/request-content.ts
/**
* 请求内容的共用投影（ticket 07 的图片通路，ticket 13 起两条传输共用）。
*
* Chat Completions 与 Anthropic Messages 的消息形态不同，但「一张托管图片怎么变成
* 上线字节」「哪些附件本插件根本不接」这两件事与传输无关：图片一律按路由目标
* （`./image-request.ts` 的长边与字节预算）编码成 base64，file/audio/video 一律
* 以 `UNSUPPORTED_CONTENT` 拒绝。把这些规则放在一处，两条传输才不会对同一张图
* 给出两种解释。
*
* 本模块只被 Host 半侧引用，不导入 cordis / schemastery。
*
* @module dsh-opendesign-provider/request-content
*/
/** Whether the catalog declares image input for this exact model. */
function modelAcceptsImages(plan) {
	return plan.declaredModalities?.includes("image") === true;
}
/**
* Turn one durable image into wire bytes.
*
* The encoder is asked for the ROUTE target (long edge and byte budget from
* `./image-request.ts`), not the normalized original, so a Retina screenshot
* travels as the size the model would downscale to anyway. Encoding returns
* `undefined` when no attachment service is mounted: the image cannot become
* pixels, so the caller degrades it to its placeholder text instead of
* pretending the model saw it.
*/
async function encodeImage(plan, ref) {
	if (!modelAcceptsImages(plan)) throw imageCapabilityFailure(plan);
	if (plan.encoder === void 0) return void 0;
	const request = await plan.encoder.readImageRequest(ref, requestImageTarget(ref), plan.signal);
	return {
		mediaType: request.mediaType,
		data: Buffer.from(request.data).toString("base64")
	};
}
/** A refusal for one image on a model the catalog does not call image-capable. */
function imageCapabilityFailure(plan) {
	const capability = plan.declaredModalities === void 0 ? "Open Design 目录也没有为这个模型声明输入模态" : `目录声明的输入模态是 ${plan.declaredModalities.join("/") || "空"}`;
	return new LlmError(`llm-opendesign: 模型 "${plan.model}" 不支持图片输入（${capability}）。Open Design 本插件只支持文本与图片；请换用目录声明支持 image 的模型，或移除图片附件。`, "UNSUPPORTED_CONTENT");
}
/** Attachment kinds this route refuses by filename, and the word its message uses. */
const REJECTED_ATTACHMENT_KINDS = [{
	kind: "音频",
	extensions: [
		".mp3",
		".wav",
		".m4a",
		".aac",
		".ogg",
		".flac",
		".opus"
	]
}, {
	kind: "视频",
	extensions: [
		".mp4",
		".mov",
		".webm",
		".mkv",
		".avi",
		".m4v"
	]
}];
/**
* A `file` block: the gateway may declare file/audio/video modality, but this
* plugin carries no such content natively, so the refusal names what arrived
* and what is actually supported instead of failing as a generic error.
*/
function unsupportedFileFailure(ref) {
	const lower = ref.name.toLowerCase();
	const kind = REJECTED_ATTACHMENT_KINDS.find((candidate) => candidate.extensions.some((extension) => lower.endsWith(extension)))?.kind;
	const subject = kind === void 0 ? `file 附件「${ref.name}」` : `${kind}附件「${ref.name}」（以 file 形态送来）`;
	const remedy = kind === void 0 ? "请把需要的文件内容转成文本再发。" : `请把${kind}转成文字描述或截图（图片）再发。`;
	return new LlmError(`llm-opendesign: 不支持${subject}。Open Design 本插件只支持文本与图片；${remedy}`, "UNSUPPORTED_CONTENT");
}
/** A content block this plugin has no wire slot for (e.g. a plugin-extended audio/video block). */
function unsupportedBlockFailure(type) {
	return new LlmError(`llm-opendesign: 不支持 content 块类型 "${type}"。Open Design 本插件只支持文本与图片。`, "UNSUPPORTED_CONTENT");
}
/**
* Model-facing placeholder for an image the host has no way to encode: the
* model is told the pixels did not travel, rather than being handed a turn that
* looks like it saw the picture.
*/
function unencodedImageText(ref, model) {
	return `[Image sha256:${String(ref.attachmentId).slice(7, 15)} was not sent: this host has no attachment encoding service, so ${model} received no pixels for it. Ask the user to send the image again once attachments are available.]`;
}
/** An evicted image: the pixels never travel again, the model keeps its placeholder text. */
function offloadedPlaceholder(ref) {
	return offloadedImageText(ref);
}
/** An image on a text-only route: placeholder text instead of pixels (used by the token meter too). */
function textOnlyPlaceholder(ref) {
	return textOnlyImageText(ref);
}
//#endregion
//#region src/sse-frames.ts
/**
* SSE 分帧（ticket 04 的读取器，ticket 13 起两条传输共用）。
*
* 两条传输的行形态不同：Chat Completions 是 data-only 帧（实测），Anthropic
* Messages 则带 `event:` 行。分帧只按行切，不把 `event:` 当协议——事件类型由
* 各传输从载荷的 `type` 字段读，这样 `event:` 行缺失的流也能解析。
*
* 读取器只负责「一行 → 一个载荷对象」，不理解任何业务字段；空闲计时按「等下一片
* 数据」的时间起表，读到数据就重来。
*
* 本模块只被 Host 半侧引用，不导入 cordis / schemastery。
*
* @module dsh-opendesign-provider/sse-frames
*/
/**
* 逐行读 SSE，产出每个 `data:` 帧解析后的对象，遇 `[DONE]` 停止。
*
* 只按行分帧，不依赖空行边界，也不看 `event:` / `id:` / 注释行；一个 `data:`
* 行必须是一整段 JSON，行被网络切断时由缓冲区拼回。
*/
async function* readSsePayloads(body, seen, idleTimeoutMs) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const idleMs = Math.max(0, Math.trunc(idleTimeoutMs));
	let buffer = "";
	let idleTimer;
	let idleExpired = false;
	const armIdleTimer = () => {
		if (idleMs === 0) return;
		idleTimer = setTimeout(() => {
			idleExpired = true;
			reader.cancel().catch(() => {});
		}, idleMs);
	};
	const disarmIdleTimer = () => {
		if (idleTimer === void 0) return;
		clearTimeout(idleTimer);
		idleTimer = void 0;
	};
	try {
		for (;;) {
			armIdleTimer();
			const chunk = await reader.read();
			disarmIdleTimer();
			if (idleExpired) throw idleTimeoutFailure(idleMs);
			if (chunk.done) break;
			const text = decoder.decode(chunk.value, { stream: true });
			buffer += text;
			if (seen.head.length < 200) seen.head += text.slice(0, 200 - seen.head.length);
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const frame = frameOf(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				if (frame.startsWith("data:")) seen.frames += 1;
				const payload = parseFrame(frame);
				if (payload === "done") return;
				if (payload !== void 0) yield payload;
			}
		}
		const tail = parseFrame(frameOf(buffer));
		if (tail !== void 0 && tail !== "done") yield tail;
	} finally {
		disarmIdleTimer();
		await reader.cancel().catch(() => {});
	}
}
/** 去掉行尾 `\r`；SSE 的换行既可能是 `\n` 也可能是 `\r\n`。 */
function frameOf(line) {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}
/** 解析一行 SSE：`data:` 载荷 → 对象（或终止标记），其余行（`event:`、注释、空行）忽略。 */
function parseFrame(line) {
	if (!line.startsWith("data:")) return void 0;
	const payload = line.slice(5).replace(/^ /u, "").trim();
	if (payload === "") return void 0;
	if (payload === "[DONE]") return "done";
	let parsed;
	try {
		parsed = JSON.parse(payload);
	} catch {
		throw new LlmError(`llm-opendesign: Open Design 的流式响应里有一帧不是合法 JSON：${truncate(payload)}`, "PROTOCOL_ERROR");
	}
	if (!isRecord(parsed)) throw new LlmError(`llm-opendesign: Open Design 的流式响应里有一帧不是 JSON 对象：${truncate(payload)}`, "PROTOCOL_ERROR");
	return parsed;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function numberValue(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function truncate(text, max = 300) {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}
//#endregion
//#region src/messages-transport.ts
/**
* Anthropic Messages 传输（ticket 13）—— 可选第二条协议面。
*
* 线上事实来自协议实测（`docs/grill/20261020-opendesign-protocol-probe.md` §1）：
*
* - 端点是 `POST {apiBase}/messages`，**必须**带 `anthropic-version: 2023-06-01`
*   头（缺头 400 `anthropic-version header is required`）；`Bearer` 与 `x-api-key`
*   等价，这里沿用凭据链既有的 `Authorization: Bearer`；
* - 请求体是 Anthropic 形态：`model`、`messages`（content block）、`system`、
*   `tools[].input_schema`、`max_tokens`（必填）、`stream: true`；Chat Completions
*   的 `max_completion_tokens` / `stream_options` / `reasoning_effort` 一个都不发；
* - 流是真 Anthropic SSE：`message_start` / `content_block_start` /
*   `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop`，
*   另有 `ping` 与 `error`；
* - 网关会先开一个空 `thinking` 块（`signature: ""`）再开正文块，客户端必须容忍；
* - 跨模型可用：`gpt-6-luna`、`claude-haiku-5.5` 的思考只在这一面可见。
*
* 本模块只被 Host 半侧引用，不导入 cordis / schemastery。
*
* @module dsh-opendesign-provider/messages-transport
*/
/** The Messages endpoint, relative to `apiBase`. */
const MESSAGES_ENDPOINT = "/messages";
/** The protocol version header the gateway requires on every Messages call (probe §1 #1). */
const ANTHROPIC_VERSION_HEADER = "anthropic-version";
/** The only version the gateway accepts today (probe §1 #2). */
const ANTHROPIC_VERSION = "2023-06-01";
/** Default: Chat Completions, with the two thinking-hidden models routed to Messages. */
const DEFAULT_PROTOCOL = "auto";
/** Narrow an arbitrary config value to a protocol setting. */
function isProtocolSetting(value) {
	return value === "chat" || value === "messages" || value === "auto";
}
/**
* 这一次调用走哪条传输。
*
* - 显式 `chat` / `messages` 是用户的决定，优先照办；
* - `auto`（默认）只把「Messages 面能给出可读思考、Chat 面看不到」的模型送去
*   Messages——换传输是多出来的能力，不是换掉既有行为；其余模型继续走 Chat，
*   所以默认路径与 ticket 04–07 完全一致；
* - 已经回落过的模型（`remembered`）直接走 Chat，避免每次都要先失败一次。
*/
function selectTransport(model, protocol, remembered) {
	if (protocol === "chat") return "chat";
	if (remembered.has(model)) return "chat";
	if (protocol === "messages") return "messages";
	return messagesThinkingVisible(model) ? "messages" : "chat";
}
/**
* 一个流里最多容忍多少个无法识别的事件。
*
* 未知事件按设计忽略（网关会加新事件，插件不该因此失败），但一个只吐未知事件的
* 流不能白白读到底：超过这个数就按协议错误收尾，既保住「忽略未知」也守住上限。
*/
const MAX_UNKNOWN_EVENTS = 5e3;
/**
* Build the Messages request body for one call.
*
* `max_tokens` is required by the protocol, so it carries the same effective
* output cap the Chat face sends as `max_completion_tokens` (ticket 05): one
* number, one meaning, whichever face the call takes.
*/
async function buildMessagesRequestBody(options, cap, images, level) {
	const system = systemTextOf(options);
	const body = {
		model: options.model,
		max_tokens: cap,
		stream: true,
		messages: await toMessagesWire(options, images)
	};
	if (system !== "") body.system = system;
	if (options.tools !== void 0 && options.tools.length > 0) body.tools = options.tools.map(toMessagesTool);
	const thinkingBudget = messagesThinkingBudget(level, cap);
	if (thinkingBudget !== void 0) body.thinking = {
		type: "enabled",
		budget_tokens: thinkingBudget
	};
	return body;
}
/** One tool declaration in the Anthropic `{name, description, input_schema}` shape. */
function toMessagesTool(tool) {
	return {
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters
	};
}
/**
* The `system` field: the caller's one-shot system text plus every system-role
* message (a loop-built request carries the prompt as message 0).
*
* Anthropic reads ONE leading system prompt, so the blocks are joined in order;
* `developer` folds into `system` exactly as it does on the Chat face (glm
* rejects that role, and uniformity is the conservative route-wide choice).
*/
function systemTextOf(options) {
	const parts = [];
	const oneShot = options.system?.trim();
	if (oneShot !== void 0 && oneShot !== "") parts.push(oneShot);
	for (const message of options.messages) {
		if (message.role !== "system" && message.role !== "developer") continue;
		const text = textOfBlocks(message.content).trim();
		if (text !== "") parts.push(text);
	}
	return parts.join("\n\n");
}
/** Every text block of one message, joined — the string form Anthropic accepts. */
function textOfBlocks(content) {
	const parts = [];
	for (const block of content) if (block.type === "text") parts.push(block.text);
	return parts.join("\n");
}
/** Map the harness conversation onto the Messages wire, skipping blocks it has no slot for. */
async function toMessagesWire(options, images) {
	const messages = [];
	for (const message of options.messages) {
		if (message.role === "system" || message.role === "developer") continue;
		const wire = await toMessagesMessage(message, images);
		if (wire !== void 0) messages.push(wire);
	}
	return messages;
}
/**
* One message in Messages form.
*
* Reasoning blocks are history-only and never echoed back; tool addition/removal
* blocks are projection metadata whose declarations travel in `tools`.
*/
async function toMessagesMessage(message, images) {
	if (message.role === "tool") return {
		role: "user",
		content: [{
			type: "tool_result",
			tool_use_id: message.toolCallId,
			content: textOfBlocks(message.content)
		}]
	};
	const parts = [];
	for (const block of message.content) switch (block.type) {
		case "text":
			if (block.text !== "") parts.push({
				type: "text",
				text: block.text
			});
			break;
		case "tool-call":
			parts.push({
				type: "tool_use",
				id: block.id,
				name: block.name,
				input: toolInputOf(block.arguments)
			});
			break;
		case "reasoning":
		case "tool-addition":
		case "tool-removal": break;
		case "image": {
			if (block.offloaded === true) {
				parts.push({
					type: "text",
					text: offloadedPlaceholder(block.attachment)
				});
				break;
			}
			const image = await encodeImage(images, block.attachment);
			parts.push(image === void 0 ? {
				type: "text",
				text: unencodedImageText(block.attachment, images.model)
			} : {
				type: "image",
				source: {
					type: "base64",
					media_type: image.mediaType,
					data: image.data
				}
			});
			break;
		}
		case "file": throw unsupportedFileFailure(block.attachment);
		default: throw unsupportedBlockFailure(String(block.type));
	}
	if (parts.length === 0) return void 0;
	return {
		role: message.role === "assistant" ? "assistant" : "user",
		content: parts
	};
}
/** One historical tool-call's arguments as the object Anthropic's `input` field takes. */
function toolInputOf(argumentsText) {
	if (argumentsText.trim() === "") return {};
	try {
		const parsed = JSON.parse(argumentsText);
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
/**
* 把一次 Messages 流式响应映射成 {@link StreamChunk} 序列。
*
* 块下标按首次出现的顺序分配（思考 → 正文 → 工具调用），`content_block_stop`
* 关闭对应块；流提前结束也不丢已经产出的内容。`cap` 是同一个客户端硬截断上限：
* 累计估算（或上游报出的 output tokens）越线即停止读取，以「因长度结束」收尾。
*/
async function* streamedMessagesChunks(body, cap, idleTimeoutMs = 0) {
	const blocks = /* @__PURE__ */ new Map();
	const toolCalls = /* @__PURE__ */ new Map();
	let nextIndex = 0;
	let started = 0;
	let finishSpelling;
	let inputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	let outputTokens = 0;
	let unknownEvents = 0;
	let estimatedOutputTokens = 0;
	let truncated = false;
	const seen = {
		frames: 0,
		head: ""
	};
	/** 关闭一个已开启的块；重复关闭是空操作。 */
	function* closeBlock(wireIndex) {
		const open = blocks.get(wireIndex);
		if (open === void 0) return;
		blocks.delete(wireIndex);
		yield {
			type: "block-end",
			index: open.index,
			block: open.kind === "text" ? {
				type: "text",
				text: open.text
			} : {
				type: "reasoning",
				text: open.text
			}
		};
	}
	for await (const payload of readSsePayloads(body, seen, idleTimeoutMs)) {
		const type = typeof payload.type === "string" ? payload.type : "";
		switch (type) {
			case "message_start": {
				const usage = isRecord(payload.message) ? payload.message.usage : void 0;
				if (isRecord(usage)) {
					inputTokens = numberValue(usage.input_tokens) ?? inputTokens;
					cacheReadTokens = numberValue(usage.cache_read_input_tokens) ?? cacheReadTokens;
					cacheWriteTokens = numberValue(usage.cache_creation_input_tokens) ?? cacheWriteTokens;
					outputTokens = numberValue(usage.output_tokens) ?? outputTokens;
				}
				break;
			}
			case "content_block_start": {
				const wireIndex = numberValue(payload.index);
				const block = payload.content_block;
				if (wireIndex === void 0 || !isRecord(block)) break;
				if (block.type === "tool_use") {
					yield* closeOpenBlocks(blocks);
					const call = {
						index: nextIndex,
						id: typeof block.id === "string" && block.id !== "" ? block.id : randomUUID(),
						name: typeof block.name === "string" ? block.name : "",
						arguments: ""
					};
					toolCalls.set(wireIndex, call);
					nextIndex += 1;
					started += 1;
					yield {
						type: "block-start",
						index: call.index,
						blockType: "tool-call"
					};
					const initial = isRecord(block.input) && Object.keys(block.input).length > 0 ? JSON.stringify(block.input) : "";
					call.arguments += initial;
					if (initial !== "") estimatedOutputTokens += estimateOutputTokens(initial);
					yield {
						type: "tool-call-delta",
						index: call.index,
						id: ToolCallId(call.id),
						name: call.name,
						argumentsDelta: initial
					};
					break;
				}
				if (block.type === "text" && typeof block.text === "string" && block.text !== "") {
					if (yield* appendBlockDelta(blocks, wireIndex, nextIndex, "text", block.text)) {
						nextIndex += 1;
						started += 1;
					}
				}
				break;
			}
			case "content_block_delta": {
				const wireIndex = numberValue(payload.index);
				const delta = payload.delta;
				if (wireIndex === void 0 || !isRecord(delta)) break;
				if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text !== "") {
					if (yield* appendBlockDelta(blocks, wireIndex, nextIndex, "text", delta.text)) {
						nextIndex += 1;
						started += 1;
					}
					estimatedOutputTokens += estimateOutputTokens(delta.text);
				} else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && delta.partial_json !== "") {
					const call = toolCalls.get(wireIndex);
					if (call === void 0) break;
					call.arguments += delta.partial_json;
					estimatedOutputTokens += estimateOutputTokens(delta.partial_json);
					yield {
						type: "tool-call-delta",
						index: call.index,
						id: ToolCallId(call.id),
						argumentsDelta: delta.partial_json
					};
				} else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking !== "") {
					if (yield* appendBlockDelta(blocks, wireIndex, nextIndex, "reasoning", delta.thinking)) {
						nextIndex += 1;
						started += 1;
					}
					estimatedOutputTokens += estimateOutputTokens(delta.thinking);
				}
				break;
			}
			case "content_block_stop": {
				const wireIndex = numberValue(payload.index);
				if (wireIndex === void 0) break;
				yield* closeBlock(wireIndex);
				const call = toolCalls.get(wireIndex);
				if (call !== void 0) {
					toolCalls.delete(wireIndex);
					yield {
						type: "block-end",
						index: call.index,
						block: {
							type: "tool-call",
							id: ToolCallId(call.id),
							name: call.name,
							arguments: call.arguments === "" ? "{}" : call.arguments
						}
					};
				}
				break;
			}
			case "message_delta": {
				if (isRecord(payload.delta) && typeof payload.delta.stop_reason === "string") finishSpelling = payload.delta.stop_reason;
				const usage = payload.usage;
				if (isRecord(usage)) outputTokens = numberValue(usage.output_tokens) ?? outputTokens;
				break;
			}
			case "message_stop": break;
			case "ping": break;
			case "error": throw messagesErrorEvent(payload);
			default:
				unknownEvents += 1;
				if (unknownEvents > 5e3) throw new LlmError(`llm-opendesign: Open Design 的 Messages 流里有超过 ${MAX_UNKNOWN_EVENTS} 个无法识别的事件（最后一个是 "${truncate(type, 60)}"），已停止读取以免空转。`, "PROTOCOL_ERROR");
		}
		if (Math.max(estimatedOutputTokens, outputTokens) >= cap) {
			truncated = true;
			break;
		}
	}
	if (started === 0 && toolCalls.size === 0) {
		if (seen.frames === 0 && seen.head.trimStart().startsWith("<")) throw nonSseBodyFailure(seen.head);
		throw emptyResponseFailure();
	}
	for (const wireIndex of [...blocks.keys()]) yield* closeBlock(wireIndex);
	for (const call of toolCalls.values()) yield {
		type: "block-end",
		index: call.index,
		block: {
			type: "tool-call",
			id: ToolCallId(call.id),
			name: call.name,
			arguments: call.arguments === "" ? "{}" : call.arguments
		}
	};
	const usage = usageOf$1({
		inputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		outputTokens
	});
	if (usage !== void 0) yield {
		type: "usage",
		usage
	};
	yield {
		type: "finish",
		reason: truncated ? { kind: "max-tokens" } : finishReasonOf$1(finishSpelling, toolCalls.size, outputTokens, cap)
	};
}
/** 关闭所有还开着的文本/思考块（新块开始前收尾，保住块的先后顺序）。 */
function* closeOpenBlocks(blocks) {
	for (const wireIndex of [...blocks.keys()]) {
		const open = blocks.get(wireIndex);
		blocks.delete(wireIndex);
		yield {
			type: "block-end",
			index: open.index,
			block: open.kind === "text" ? {
				type: "text",
				text: open.text
			} : {
				type: "reasoning",
				text: open.text
			}
		};
	}
}
/** 取得（必要时开启）某个 wire 下标上的块：块按首次出现分配宿主下标。 */
function openBlock(blocks, wireIndex, nextIndex, kind) {
	const existing = blocks.get(wireIndex);
	if (existing !== void 0) return {
		block: existing,
		created: false
	};
	const block = {
		index: nextIndex,
		kind,
		text: ""
	};
	blocks.set(wireIndex, block);
	return {
		block,
		created: true
	};
}
/**
* 让一个块的增量逐帧产出；首次出现时补 block-start。
*
* 返回值说明这一次是否新开了块：新开要占用下一个宿主下标。
*/
function* appendBlockDelta(blocks, wireIndex, nextIndex, kind, text) {
	const open = openBlock(blocks, wireIndex, nextIndex, kind);
	open.block.text += text;
	if (open.created) yield {
		type: "block-start",
		index: open.block.index,
		blockType: kind
	};
	yield kind === "reasoning" ? {
		type: "reasoning-delta",
		index: open.block.index,
		text
	} : {
		type: "text-delta",
		index: open.block.index,
		text
	};
	return open.created;
}
/**
* 终态原因，缺省时推断。
*
* `stop_reason` 在 `message_delta` 里，网关若没给就不算失败：有工具调用就是工具
* 调用，输出吃满上限就是长度截断，其余算正常结束（与 Chat 面同一套推断）。
*/
function finishReasonOf$1(spelling, toolCallCount, outputTokens, cap) {
	if (spelling === "max_tokens") return { kind: "max-tokens" };
	if (spelling === "tool_use") return { kind: "tool-calls" };
	if (spelling !== void 0) return { kind: "stop" };
	if (toolCallCount > 0) return { kind: "tool-calls" };
	if (outputTokens >= cap) return { kind: "max-tokens" };
	return { kind: "stop" };
}
/**
* Anthropic 的用量映射成宿主的不相交记账。
*
* `input_tokens` 本来就是「未命中缓存」的那一段，缓存读/写单列
* （`cache_read_input_tokens` / `cache_creation_input_tokens`），所以三者可以直接
* 相加得到总输入；总量字段 Anthropic 不给，这里按上游的聚合计数派生。
*/
function usageOf$1(counts) {
	const total = counts.inputTokens + counts.cacheReadTokens + counts.cacheWriteTokens + counts.outputTokens;
	if (total === 0) return void 0;
	return {
		inputTokens: counts.inputTokens,
		outputTokens: counts.outputTokens,
		totalTokens: total,
		cacheReadTokens: counts.cacheReadTokens,
		cacheWriteTokens: counts.cacheWriteTokens
	};
}
/** 流内 `error` 事件按类型给出宿主错误码；未识别的类型按临时故障处理。 */
function messagesErrorEvent(payload) {
	const error = isRecord(payload.error) ? payload.error : {};
	const type = typeof error.type === "string" ? error.type : "unknown_error";
	const message = typeof error.message === "string" ? error.message : "";
	const detail = message === "" ? "" : `：${truncate(message, 400)}`;
	if (type === "invalid_request_error") return new LlmError(`Open Design 的 Messages 面拒绝了这条请求（${type}）${detail}。这属于确定性错误，重试同样会失败。`, "BAD_REQUEST");
	if (type === "authentication_error" || type === "permission_error") return new LlmError(`Open Design 拒绝了这把 API Key（${type}）${detail}。请在 设置 → Open Design 检查 Key。`, "AUTH");
	if (type === "rate_limit_error") return new LlmError(`Open Design 限流了这次请求（${type}）${detail}。插件会自动重试；连续限流时请稍后再发。`, "RATE_LIMIT");
	return new LlmError(`Open Design 的 Messages 流返回了错误事件（${type}）${detail}。这通常是上游临时故障，插件会自动重试。`, "TRANSIENT");
}
//#endregion
//#region src/output-budget.ts
/**
* 输出上限的有效值（ticket 05）—— 宿主预算、模型输出预算与绝对上限的取小规则。
*
* 设计件 §4.3 把请求上限钉成 `min(DSH 预算, output_budget, 262144)`，并且只
* 用 `max_completion_tokens` 发送。协议实测（`docs/grill/20261020-opendesign-protocol-probe.md`
* §3.1）给出的两个边界决定了这里的常量：
*
* - `262144` 是网关接受的最大上限（`Range of max_tokens should be [1, 262144]`），
*   超过它的请求会被直接拒绝；
* - `max_tokens` 对所有被测模型都不生效，所以本 bundle 从不发它；`0`
*   也不再表示「省略上限字段」，而是「没有宿主预算」。
*
* 模块保持纯函数（无 node 依赖），设置页与 Host 侧可以共用同一套边界。
*
* @module dsh-opendesign-provider/output-budget
*/
/**
* 网关接受的绝对上限（含）：再大一个就会被上游以
* `Range of max_tokens should be [1, 262144]` 拒绝。
*/
const MAX_OUTPUT_TOKEN_LIMIT = 262144;
/**
* 一个值能否作为用户输出预算：0 哨兵，或绝对上限内的整数。
*
* 程序化构造的连接可以绕过 schemastery 归一化，所以 resolve 步骤会再判一次，
* 把越界值回落到「未设置」，而不是让请求带着一个必被拒的预算上线。
*/
function isValidMaxOutputTokens(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 262144;
}
/**
* 本次请求实际发送的 `max_completion_tokens`。
*
* 先按 `min(模型预算, 绝对上限)` 定出模型的硬边界，再用宿主预算收紧；最后
* 应用思考档下限。下限可以高于宿主预算与模型预算——那是模型接受该档的硬
* 门槛，压低它只会换来 400——但仍然不得越过绝对上限。
*/
function effectiveOutputCap(facts) {
	const model = bounded(facts.modelBudget, 1);
	const host = facts.hostBudget;
	const capped = isHostBudget(host) ? Math.min(model, bounded(host, model)) : model;
	if (facts.thinkingFloor === void 0) return capped;
	return Math.min(MAX_OUTPUT_TOKEN_LIMIT, Math.max(capped, bounded(facts.thinkingFloor, capped)));
}
/** 把任意来源的数值夹进 `[1, 262144]`；非法值回落到 `fallback`。 */
function bounded(value, fallback) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(MAX_OUTPUT_TOKEN_LIMIT, Math.max(1, Math.trunc(value)));
}
/**
* 宿主预算是否真的能收紧上限：0 是哨兵，负数/小数/NaN 是绕过校验的脏值，
* 两者都按「未设置」处理，而不是把上限压成 1。
*/
function isHostBudget(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
//#endregion
//#region src/transport-retry.ts
/**
* A bounded retry budget for `TRANSPORT` failures (issue #39, second report).
*
* The route policy (`providerRetryPolicy` in `./adapter.ts`) declares which codes
* are worth another attempt — `EMPTY_RESPONSE`, `RATE_LIMIT`, `TIMEOUT`,
* `TRANSIENT`, `TRANSPORT` since ticket 06 — and the engine owns the backoff. A
* connection that cannot be established still needs its own, configurable cap:
* a blip the first few attempts absorb, an outage no in-request waiting fixes.
* So transport failures get this budget, cleared at each new STEP (one step = one
* model request). `agent/status` → `idle` is NOT the reset (one `running` phase
* spans a turn's steps), and neither is `assistant/attempt` (appended for the
* FAILED attempt itself, which would clear the budget on every failure).
*
* @module
*/
/** Failure code this budget covers. */
const TRANSPORT_FAILURE_CODE = "TRANSPORT";
/**
* The effective transport-retry cap from raw config.
*
* Shared by the request-failure handler and the diagnostics snapshot so the
* number the user reads is the number the handler uses: a missing or unusable
* value falls back to {@link DEFAULT_TRANSPORT_MAX_RETRIES}, a large one clamps
* to {@link MAX_TRANSPORT_MAX_RETRIES}.
*
* @param raw - the config value as written (may be anything a hand-edited document carries).
* @returns the effective cap.
*/
function readTransportMaxRetries(raw) {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 5;
	return Math.min(Math.trunc(raw), 50);
}
/** One agent's live transport-failure count, keyed weakly so a dropped agent cannot leak. */
const counts$1 = /* @__PURE__ */ new WeakMap();
/**
* Count one attempt's outcome against the transport budget.
*
* @param agent - the identity the budget is scoped to (the agent object).
* @param failureCode - the failed attempt's `LlmFailure.code`.
* @param maxRetries - transport retries to absorb before the failure surfaces.
* @returns `'ignored'` for any non-transport code (the route policy decides
*   those, unchanged), `'retry'` while the budget has room, `'exhausted'` once
*   it does not.
*/
function absorbTransportFailure(agent, failureCode, maxRetries) {
	if (failureCode !== "TRANSPORT") return "ignored";
	const used = counts$1.get(agent) ?? 0;
	if (used >= maxRetries) return "exhausted";
	counts$1.set(agent, used + 1);
	return "retry";
}
/** Clear one agent's transport budget (a new step starts, or the turn ended). */
function resetTransportFailures(agent) {
	counts$1.delete(agent);
}
/**
* What one session event means for the transport budget.
*
* Pure and exported on purpose: the choice of event is the part of this design
* that is easy to get plausibly wrong (see the module comment), so it is stated
* once, where a test can pin it.
*
* @param type - the appended session event's type.
* @returns `'reset'` for a new step, `'forget'` when the turn ended (the
*   session → agent mapping is no longer needed), otherwise `'none'`.
*/
function transportResetAction(type) {
	if (type === "step/start") return "reset";
	if (type === "turn/end") return "forget";
	return "none";
}
/**
* The diagnosis a capped turn ends with. Bilingual, because the harness renders
* a failed turn's message verbatim and this plugin's other user-facing failures
* are too; it names the retry budget and the checks that actually help instead
* of the bare "fetch failed" chain the retry chrome would otherwise show.
*/
function transportBudgetMessage(failureMessage, maxRetries) {
	return `${failureMessage}；Open Design API 连接在连续重试后仍失败——已停止重试以免整轮卡死。插件已自动重试 ${maxRetries} 次。通常说明当前网络到 Open Design 网关的连接不通，常见原因是代理未生效：DSH 只读取环境变量 HTTPS_PROXY/HTTP_PROXY（系统代理/PAC 不会被读取），请确认启动 DSH 的终端里已导出代理，或先关闭代理直连后重试。网络恢复后直接重发即可 — Open Design API transport still failed after ${maxRetries} automatic retries, which were stopped so the turn could not stall for minutes. This is a connectivity problem between this machine and the Open Design gateway, not a context-window or request-size rejection. Common cause: the proxy is not reaching the harness — DSH reads HTTPS_PROXY/HTTP_PROXY from the environment only (a Windows system proxy/PAC setting is not consulted), so export it in the launching shell, or turn the proxy off and retry. Resend when the network recovers; the budget is per request and has been reset`;
}
//#endregion
//#region src/diagnostics.ts
/**
* Build the redacted snapshot.
*
* Field-by-field on purpose: an object typed as {@link DiagnosticsFacts} may still
* carry extra properties at runtime (a caller passing a richer observation record),
* and copying the whole object would leak them. Nothing here ever reads a value
* that could be a key.
*/
function diagnosticsSnapshot(facts) {
	return {
		version: 1,
		gateway: facts.gateway,
		catalog: {
			source: facts.catalog.source,
			models: facts.catalog.models,
			visible: facts.catalog.visible,
			...facts.catalog.fallbackReason === void 0 ? {} : { fallbackReason: facts.catalog.fallbackReason }
		},
		credential: {
			ref: facts.credential.ref,
			present: facts.credential.present === true
		},
		cliLogin: {
			path: facts.cliLogin.path,
			status: facts.cliLogin.status,
			hasRuntimeKey: facts.cliLogin.hasRuntimeKey === true
		},
		context: {
			windowOverride: facts.contextWindow ?? null,
			overriddenModels: Object.keys(facts.contextWindowOverrides ?? {}).length
		},
		output: { maxTokensOverride: facts.maxOutputTokens ?? null },
		timeouts: {
			requestMs: facts.requestTimeoutMs,
			streamIdleMs: facts.streamIdleTimeoutMs
		},
		retry: {
			transportMaxRetries: facts.transportMaxRetries ?? 5,
			retryableCodes: [...facts.retryableCodes]
		}
	};
}
/**
* Render the snapshot as the multi-line text the settings page copies.
*
* One line per setting, each labelled with what it means rather than the raw key
* name, so a pasted block reads on its own in a support thread. The first line
* states the redaction promise; the last one lists the retry budget and the codes
* the engine may retry, which is what a stall or a retry storm is diagnosed on.
*/
function formatDiagnostics(snapshot) {
	const catalog = snapshot.catalog.source === "live" ? `实时目录（${snapshot.catalog.models} 个模型，可见 ${snapshot.catalog.visible} 个）` : `静态快照（${snapshot.catalog.models} 个模型，可见 ${snapshot.catalog.visible} 个${snapshot.catalog.fallbackReason === void 0 ? "" : `；实时目录失败原因：${snapshot.catalog.fallbackReason}`}）`;
	const credential = snapshot.credential.present ? "已配置" : "未配置";
	const window = snapshot.context.windowOverride === null ? `跟随目录（逐模型覆盖 ${snapshot.context.overriddenModels} 个）` : `${snapshot.context.windowOverride}（逐模型覆盖 ${snapshot.context.overriddenModels} 个）`;
	const output = snapshot.output.maxTokensOverride === null ? "跟随模型" : String(snapshot.output.maxTokensOverride);
	return [
		"Open Design 诊断（当前生效配置；密钥只显示引用名与是否存在，不含密钥明文）",
		`网关地址：${snapshot.gateway}`,
		`目录来源：${catalog}`,
		`上下文窗口：${window}`,
		`输出上限：${output}`,
		`凭据引用：${snapshot.credential.ref}（${credential}）`,
		`CLI 登录态：${snapshot.cliLogin.path}（${describeLogin(snapshot.cliLogin)}）`,
		`请求超时：${formatSeconds(snapshot.timeouts.requestMs)}；流空闲超时：${formatSeconds(snapshot.timeouts.streamIdleMs)}`,
		`传输重试上限：${snapshot.retry.transportMaxRetries} 次；可重试错误码：${snapshot.retry.retryableCodes.join("、")}`
	].join("\n");
}
/**
* One phrase for the CLI login state, in the words the user needs to act on:
* a missing file means "run `vela login`", a malformed one means "the file is
* there but unusable", and `ok` still distinguishes "no runtime key inside".
*/
function describeLogin(login) {
	if (login.path === "") return "未知（本次诊断没有接上凭据探测）";
	switch (login.status) {
		case "ok": return login.hasRuntimeKey ? "可读，含 runtimeKey" : "可读，但没有 runtimeKey（需要先 vela login）";
		case "malformed": return "文件存在但不是合法 JSON（可删掉后重新 vela login）";
		case "missing": return "文件不存在（没有 CLI 登录态）";
		default: return "文件存在但不可读（检查权限）";
	}
}
/** Milliseconds as seconds, collapsing whole seconds (`300 秒`). */
//#endregion
//#region src/stream-response.ts
/**
* 流式响应映射（ticket 04）—— 把 Chat Completions 的 SSE 字节流转成宿主认得
* 的 {@link StreamChunk} 序列。
*
* 线上事实来自协议实测（`docs/grill/20261020-opendesign-protocol-probe.md` §3.3–§3.6）
* 与设计件 §4.5：
*
* - 正文在 `choices[].delta.content`；思考在非标准字段 `delta.reasoning`
*   （伴随 `delta.reasoning_details[]`），**不是** `reasoning_content`；
* - 思考首帧可能是空串（deepseek 会先发 `reasoning:""`），空增量不产出任何块；
* - `delta.tool_calls[]` 用 `index` 认领同一次调用，`id/name` 只在首片出现、
*   `arguments` 逐片拼接；
* - 尾帧是 `choices: []` 只带 `usage` 的帧，必须计入；
* - `finish_reason` 可缺省（gpt-6-luna 贴近实测），缺省时按内容/工具/上限推断；
* - `data: [DONE]` 是终止标记，其后的帧一律不看；`event:` 行不参与分派；
* - 累计输出（思考 + 正文 + 工具参数，含上游报出的 usage）达到上限就停止读取，
*   保留已产出的内容并以「因长度结束」收尾（ticket 05 的客户端硬截断）。
*
* 本模块只被 Host 半侧引用，不导入 cordis / schemastery。
*
* @module dsh-opendesign-provider/stream-response
*/
/**
* 把一次流式响应映射成块序列。
*
* 块按首次出现的顺序分配下标：思考 → 正文 → 逐个工具调用；结束时按同一顺序
* 关闭。这样宿主装配器拿到的消息与「先想、再说、再调工具」的语义一致。
*/
async function* streamedCompletionChunks(body, cap, idleTimeoutMs = 0) {
	let nextIndex = 0;
	let reasoning;
	let text;
	const toolCalls = /* @__PURE__ */ new Map();
	let finishSpelling;
	let usage;
	let estimatedOutputTokens = 0;
	let reportedOutputTokens = 0;
	let truncated = false;
	/** 关闭当前思考块：下一类内容开始时收尾，块的形态与一次性响应完全一致。 */
	function* closeReasoning() {
		if (reasoning === void 0) return;
		yield {
			type: "block-end",
			index: reasoning.index,
			block: {
				type: "reasoning",
				text: reasoning.text
			}
		};
		reasoning = void 0;
	}
	/** 关闭当前正文块。 */
	function* closeText() {
		if (text === void 0) return;
		yield {
			type: "block-end",
			index: text.index,
			block: {
				type: "text",
				text: text.text
			}
		};
		text = void 0;
	}
	const seen = {
		frames: 0,
		head: ""
	};
	for await (const payload of readSsePayloads(body, seen, idleTimeoutMs)) {
		const reported = usageOf(payload.usage);
		if (reported !== void 0) {
			usage = reported;
			reportedOutputTokens = Math.max(reportedOutputTokens, reported.outputTokens);
		}
		const choice = firstChoice(payload);
		if (choice === void 0) {
			if (reportedOutputTokens >= cap) {
				truncated = true;
				break;
			}
			continue;
		}
		if (typeof choice.finish_reason === "string") finishSpelling = choice.finish_reason;
		const delta = isRecord(choice.delta) ? choice.delta : {};
		const reasoningDelta = reasoningTextOf(delta);
		if (reasoningDelta !== "") {
			if (reasoning === void 0) {
				reasoning = {
					index: nextIndex++,
					text: ""
				};
				yield {
					type: "block-start",
					index: reasoning.index,
					blockType: "reasoning"
				};
			}
			reasoning.text += reasoningDelta;
			estimatedOutputTokens += estimateOutputTokens(reasoningDelta);
			yield {
				type: "reasoning-delta",
				index: reasoning.index,
				text: reasoningDelta
			};
		}
		const textDelta = textOf(delta.content);
		if (textDelta !== "") {
			if (text === void 0) {
				yield* closeReasoning();
				text = {
					index: nextIndex++,
					text: ""
				};
				yield {
					type: "block-start",
					index: text.index,
					blockType: "text"
				};
			}
			text.text += textDelta;
			estimatedOutputTokens += estimateOutputTokens(textDelta);
			yield {
				type: "text-delta",
				index: text.index,
				text: textDelta
			};
		}
		for (const fragment of toolCallFragments(delta.tool_calls)) {
			let call = toolCalls.get(fragment.index);
			if (call === void 0) {
				yield* closeReasoning();
				yield* closeText();
				call = {
					index: nextIndex++,
					id: fragment.id === "" ? randomUUID() : fragment.id,
					name: "",
					arguments: ""
				};
				toolCalls.set(fragment.index, call);
				yield {
					type: "block-start",
					index: call.index,
					blockType: "tool-call"
				};
			}
			if (fragment.name !== "") call.name = fragment.name;
			call.arguments += fragment.argumentsDelta;
			estimatedOutputTokens += estimateOutputTokens(fragment.argumentsDelta);
			yield {
				type: "tool-call-delta",
				index: call.index,
				id: ToolCallId(call.id),
				...fragment.name === "" ? {} : { name: fragment.name },
				argumentsDelta: fragment.argumentsDelta
			};
		}
		if (Math.max(estimatedOutputTokens, reportedOutputTokens) >= cap) {
			truncated = true;
			break;
		}
	}
	if (reasoning === void 0 && text === void 0 && toolCalls.size === 0) {
		if (seen.frames === 0 && seen.head.trimStart().startsWith("<")) throw nonSseBodyFailure(seen.head);
		throw emptyResponseFailure();
	}
	yield* closeReasoning();
	yield* closeText();
	for (const call of toolCalls.values()) yield {
		type: "block-end",
		index: call.index,
		block: {
			type: "tool-call",
			id: ToolCallId(call.id),
			name: call.name,
			arguments: call.arguments === "" ? "{}" : call.arguments
		}
	};
	if (usage !== void 0) yield {
		type: "usage",
		usage
	};
	yield {
		type: "finish",
		reason: truncated ? { kind: "max-tokens" } : finishReasonOf(finishSpelling, toolCalls.size, usage, cap)
	};
}
/** 第一项 choice；`choices: []` 的 usage 尾帧与畸形帧都读不到。 */
function firstChoice(payload) {
	if (!Array.isArray(payload.choices)) return void 0;
	return isRecord(payload.choices[0]) ? payload.choices[0] : void 0;
}
/**
* 工具调用分片：`index` 认领调用，`id`/`name` 首片才有，`arguments` 逐片拼接。
*
* 缺 `index` 的网关按数组位置兜底，缺 `id` 由调用方补 UUID。
*/
function toolCallFragments(raw) {
	if (!Array.isArray(raw)) return [];
	const fragments = [];
	raw.forEach((entry, position) => {
		if (!isRecord(entry)) return;
		const fn = isRecord(entry.function) ? entry.function : {};
		const args = fn.arguments;
		fragments.push({
			index: numberValue(entry.index) ?? position,
			id: typeof entry.id === "string" ? entry.id : "",
			name: typeof fn.name === "string" ? fn.name : "",
			argumentsDelta: typeof args === "string" ? args : isRecord(args) || Array.isArray(args) ? JSON.stringify(args) : ""
		});
	});
	return fragments;
}
/**
* 终态原因，缺省时推断。
*
* `finish_reason` 可以整场都不出现（gpt-6-luna 的贴近实况），所以缺省不是失败：
* 有工具调用就是工具调用，输出吃满了本次请求的上限就是长度截断，其余算正常结束。
*/
function finishReasonOf(spelling, toolCallCount, usage, cap) {
	if (spelling === "length" || spelling === "max_tokens") return { kind: "max-tokens" };
	if (spelling === "tool_calls" || spelling === "function_call") return { kind: "tool-calls" };
	if (spelling !== void 0) return { kind: "stop" };
	if (toolCallCount > 0) return { kind: "tool-calls" };
	if (usage !== void 0 && usage.outputTokens >= cap) return { kind: "max-tokens" };
	return { kind: "stop" };
}
/** 不相交的 token 记账：缓存输入与思考 token 单列（与设计件 §4.5 一致）。 */
function usageOf(raw) {
	if (!isRecord(raw)) return void 0;
	const prompt = numberValue(raw.prompt_tokens) ?? 0;
	const completion = numberValue(raw.completion_tokens) ?? 0;
	const cacheRead = isRecord(raw.prompt_tokens_details) ? numberValue(raw.prompt_tokens_details.cached_tokens) ?? 0 : 0;
	const reasoning = isRecord(raw.completion_tokens_details) ? numberValue(raw.completion_tokens_details.reasoning_tokens) : void 0;
	const usage = {
		inputTokens: Math.max(0, prompt - cacheRead),
		outputTokens: completion,
		cacheReadTokens: cacheRead
	};
	const total = numberValue(raw.total_tokens);
	if (total !== void 0) usage.totalTokens = total;
	if (reasoning !== void 0) usage.reasoningTokens = reasoning;
	return usage;
}
/** 正文增量：字符串或分片数组（部分网关会把 content 拆成 parts）。 */
function textOf(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const part of content) if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
	return parts.join("");
}
/**
* 思考增量：非标准 `reasoning` 标量优先，`reasoning_details[]` 作为兜底。
*
* 两者同时出现时只取标量，否则同一段思考会被计两遍。
*/
function reasoningTextOf(delta) {
	if (typeof delta.reasoning === "string" && delta.reasoning !== "") return delta.reasoning;
	if (!Array.isArray(delta.reasoning_details)) return "";
	const parts = [];
	for (const detail of delta.reasoning_details) if (isRecord(detail) && typeof detail.text === "string") parts.push(detail.text);
	return parts.join("");
}
//#endregion
//#region src/adapter.ts
/**
* The Open Design LLM adapter: one Chat Completions transport.
*
* Ticket 02 wired the walking skeleton end to end; ticket 03 made the picker
* read the gateway's live `GET {apiBase}/models` (per-key, with the 12-model
* static snapshot as the offline fallback) and exposes the catalog's
* provenance through {@link OpenDesignAdapter.catalogStatus}; ticket 04 turned
* the transport into a real stream — one `stream: true` call is read as SSE and
* mapped, delta by delta, into the `StreamChunk` sequence (thinking, text,
* tool calls, usage, finish), so the reply is visible while it is generated.
* Ticket 07 carries images: a model the catalog declares image-capable gets the
* host's request-encoded bytes as an OpenAI multi-part `image_url` data URL,
* while file/audio/video attachments and images on a text-only model are refused
* as `UNSUPPORTED_CONTENT` naming the capability. Ticket 05 bounds the answer:
* `max_completion_tokens` is the smallest of the host budget, the model's own
* budget and the gateway ceiling, raised to the selected thinking level's floor
* when the model demands one (kimi), and the stream hard-truncates at that cap
* with a `max-tokens` finish. Ticket 06 routes every failure through
* `./error-taxonomy.ts` (three body shapes, deterministic vs retryable, empty
* response, idle timeout), declares the route's retry policy from that table, and
* exposes `diagnostics()` for the settings page's redacted config copy. The
* transport seam here is deliberately the single Chat Completions call the design
* settles on.
*
* Request facts come from the live connection thunk and the credential
* resolver handed in by the plugin entry, so a settings write reaches the next
* request without a restart. Nothing in this module imports cordis or
* schemastery.
*
* @module dsh-opendesign-provider/adapter
*/
/** Default budget for the first byte of a response. */
const DEFAULT_REQUEST_TIMEOUT_MS = 3e5;
/** Default budget for a stream that stalls after connecting. */
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
/** Display names for the reasoning levels, least to greatest. */
const EFFORT_NAMES = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max"
};
/** The Open Design adapter: catalog plus the Chat Completions transport. */
var OpenDesignAdapter = class extends LlmAdapter {
	deps;
	catalog;
	/** Models that asked for Messages and found the gateway not serving it (ticket 13). */
	fallbacks = /* @__PURE__ */ new Map();
	constructor(deps) {
		super();
		this.deps = deps;
		this.catalog = new GatewayCatalogSource({
			...deps.fetchImpl === void 0 ? {} : { fetchImpl: deps.fetchImpl },
			...deps.now === void 0 ? {} : { now: deps.now }
		});
	}
	/**
	* The engine's retry decision for this route, declared from the classification
	* table: only `EMPTY_RESPONSE` / `RATE_LIMIT` / `TIMEOUT` / `TRANSIENT` /
	* `TRANSPORT` are worth another attempt. `AUTH`, `QUOTA_EXHAUSTED`,
	* `BAD_REQUEST` and `PROTOCOL_ERROR` fail identically every time, so declaring
	* them non-retryable is what keeps a deterministic 400 from burning quota.
	*/
	providerRetryPolicy(_provider) {
		return resolveRetryPolicy({
			mode: "normal",
			retryableCodes: [...retryableFailureCodes()]
		}, `llm-opendesign: provider "${PROVIDER_DISPLAY_NAME}" retryPolicy`);
	}
	/** Report the route under the product name, preserving the engine's id. */
	providerInfo(provider) {
		return {
			id: provider,
			name: PROVIDER_DISPLAY_NAME
		};
	}
	/**
	* The models the picker may list: the gateway's live directory when it
	* answers (per-key, so possibly fewer or more than the 12 known models),
	* otherwise the static snapshot. Filtered by the allowlist and the
	* per-model toggles, in the design's display order.
	*/
	async listModels(provider) {
		const connection = this.deps.options();
		const catalog = await this.loadCatalog(connection);
		const allowlist = connection.visibleModels ?? [];
		return catalog.models.filter((entry) => modelIsVisible(entry.id, allowlist, connection.modelVisibility)).map((entry) => ({
			provider,
			id: entry.id,
			name: entry.name,
			description: describeGatewayCatalogEntry(entry),
			inputModalities: hostInputModalities(entry)
		}));
	}
	/**
	* The catalog's provenance as data for the settings page and model cards
	* (ticket 08): which gateway it is bound to, whether it is live or the
	* static snapshot, why it fell back, and which entries are uncalibrated.
	*/
	async catalogStatus() {
		return this.loadCatalog(this.deps.options());
	}
	/**
	* The redacted "current effective configuration" block (ticket 06).
	*
	* This is the data half of the settings page's copy button; the button itself
	* belongs to ticket 08. The catalog is read from memory, never the network: the
	* snapshot reports what conversations would use right now, and a diagnostic must
	* never become the outage (or stall the page). `./diagnostics.ts`'s
	* `formatDiagnostics` renders the copyable text.
	*/
	async diagnostics() {
		const base = this.deps.options();
		const connection = await this.deps.resolveConnection?.(base) ?? base;
		const catalog = this.currentCatalog(connection);
		const credential = await this.deps.credentialState?.();
		const allowlist = connection.visibleModels ?? [];
		return diagnosticsSnapshot({
			gateway: apiBaseOf(connection),
			catalog: {
				source: catalog.source === "live" ? "live" : "snapshot",
				models: catalog.models.length,
				visible: catalog.models.filter((entry) => modelIsVisible(entry.id, allowlist, connection.modelVisibility)).length,
				...catalog.reason === void 0 ? {} : { fallbackReason: catalog.reason }
			},
			credential: {
				ref: credential?.ref ?? "OPEN_DESIGN_API_KEY",
				present: credential?.present === true
			},
			cliLogin: credential?.login ?? {
				path: "",
				status: "missing",
				hasRuntimeKey: false
			},
			contextWindow: connection.contextWindow,
			contextWindowOverrides: connection.contextWindowOverrides ?? {},
			maxOutputTokens: connection.maxOutputTokens,
			requestTimeoutMs: connection.requestTimeoutMs,
			streamIdleTimeoutMs: connection.streamIdleTimeoutMs,
			transportMaxRetries: connection.transportMaxRetries,
			retryableCodes: retryableFailureCodes()
		});
	}
	/**
	* Everything the harness needs for one exact model: the usable context
	* window (custom overrides included), the output budget it will request, the
	* levels this model accepts, and whether images fit.
	*/
	async resolveModel(provider, model) {
		const connection = this.deps.options();
		const entry = lookupCatalogEntry(this.currentCatalog(connection).models, model);
		if (entry === void 0) return {
			provider,
			id: model,
			name: model,
			reasoning: { efforts: effortInfos(REASONING_LEVEL_ORDER) }
		};
		return {
			provider,
			id: model,
			name: entry.name,
			description: describeGatewayCatalogEntry(entry),
			inputModalities: hostInputModalities(entry),
			context: { contextWindow: effectiveContextWindow(entry.contextWindow, model, connection) },
			defaultMaxTokens: entry.maxTokens,
			reasoning: { efforts: effortInfos(entry.reasoningLevels) }
		};
	}
	/**
	* The request-image projection this route asks the host for: long edge 1568
	* and a 1 MiB encoded budget (see `./image-request.ts`). It is the same target
	* `stream()` encodes to, so any preview computed elsewhere matches the bytes
	* that actually travel.
	*/
	imageRequestTarget(_provider, _model, image) {
		return requestImageTarget(image);
	}
	/**
	* Vision-token pricing for the meter (see `./image-tokens.ts`).
	*
	* A model the catalog calls image-capable pays its family's published rule. An
	* offloaded occurrence, and every image on a route that takes text only,
	* travels as placeholder text instead of pixels: 0 visual tokens plus that
	* exact text, so the meter counts what the model actually reads. A model
	* neither catalog nor snapshot knows declares nothing here.
	*/
	imageRequestPricing(_provider, model) {
		const entry = lookupCatalogEntry(this.currentCatalog(this.deps.options()).models, model);
		if (entry === void 0) return void 0;
		const vision = entry.inputModalities.includes("image");
		return { priceImages: (images) => images.map((image) => {
			if (image.offloaded === true) return {
				visualTokens: 0,
				text: offloadedPlaceholder(image.attachment)
			};
			if (!vision) return {
				visualTokens: 0,
				text: textOnlyPlaceholder(image.attachment)
			};
			return {
				visualTokens: openDesignImageTokens(model, image.attachment.width, image.attachment.height),
				text: ""
			};
		}) };
	}
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
	async *stream(options) {
		const base = this.deps.options();
		const connection = await this.deps.resolveConnection?.(base) ?? base;
		const apiKey = await this.deps.resolveApiKey(connection);
		const entry = lookupCatalogEntry(this.currentCatalog(connection).models, options.model);
		const level = selectedReasoningLevel(options.model, options.reasoningEffort);
		const plan = {
			options,
			connection,
			apiKey,
			entry,
			level,
			cap: outputCapFor(options, entry, connection, options.model, level),
			fetchImpl: this.deps.fetchImpl ?? fetch
		};
		const protocol = connection.protocol ?? "auto";
		if (selectTransport(options.model, protocol, this.fallbacks) === "chat") {
			yield* this.streamChat(plan);
			return;
		}
		let emitted = false;
		try {
			for await (const chunk of this.streamMessages(plan)) {
				emitted = true;
				yield chunk;
			}
			return;
		} catch (error) {
			if (protocol !== "auto" || emitted || !isRoutingFallback(error)) throw error;
			this.rememberFallback(options.model, error);
		}
		yield* this.streamChat(plan);
	}
	/**
	* The automatic transports that fell back to Chat, as data (ticket 13).
	*
	* One entry per model that ever asked for Messages and found the gateway not
	* serving it; the settings page's diagnostics and the plugin's log line both
	* read this instead of a mutable global.
	*/
	transportFallbacks() {
		return [...this.fallbacks.entries()].map(([model, fallback]) => ({
			model,
			...fallback
		}));
	}
	/**
	* One streaming Chat Completions call (ticket 04), the default transport.
	*
	* The request sends only the fields the gateway actually honours: the model
	* id, the mapped messages, `stream: true` with `stream_options.include_usage`
	* so the usage tail frame arrives, `max_completion_tokens` and the model's own
	* `reasoning_effort`. It never sends `max_tokens` (no model honours it),
	* `store` (server-side default) or `temperature` (unverified).
	*/
	async *streamChat(plan) {
		const { options, connection, apiKey, entry, level, cap, fetchImpl } = plan;
		const callerSignal = options.signal;
		const body = await buildRequestBody(options, cap, {
			model: options.model,
			declaredModalities: entry?.inputModalities,
			encoder: this.deps.attachments?.(),
			signal: callerSignal
		}, level);
		const signal = requestSignal(callerSignal, connection.requestTimeoutMs);
		let response;
		try {
			response = await fetchImpl(`${apiBaseOf(connection)}/chat/completions`, {
				method: "POST",
				headers: {
					...attributionHeaders(),
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
					accept: "text/event-stream"
				},
				body: JSON.stringify(body),
				signal
			});
		} catch (error) {
			throw requestFailure(error, callerSignal?.aborted === true);
		}
		if (!response.ok) {
			let raw;
			try {
				raw = await response.text();
			} catch {
				raw = "";
			}
			throw classifyHttpFailure({
				status: response.status,
				body: raw,
				contentType: response.headers.get("content-type"),
				retryAfter: response.headers.get("retry-after")
			});
		}
		if (response.body === null) throw missingBodyFailure();
		try {
			yield* streamedCompletionChunks(response.body, cap, connection.streamIdleTimeoutMs);
		} catch (error) {
			if (error instanceof LlmError) throw error;
			throw requestFailure(error, callerSignal?.aborted === true);
		}
	}
	/**
	* One streaming Anthropic Messages call (ticket 13), the optional transport.
	*
	* The endpoint and body are Anthropic-shaped (see `./messages-transport.ts`):
	* `{apiBase}/messages`, a mandatory `anthropic-version` header, `max_tokens`
	* carrying the same effective output cap, and none of the Chat-only fields.
	* The bearer key comes from the same credential chain.
	*/
	async *streamMessages(plan) {
		const { options, connection, apiKey, entry, cap, fetchImpl } = plan;
		const callerSignal = options.signal;
		const body = await buildMessagesRequestBody(options, cap, {
			model: options.model,
			declaredModalities: entry?.inputModalities,
			encoder: this.deps.attachments?.(),
			signal: callerSignal
		}, plan.level);
		const signal = requestSignal(callerSignal, connection.requestTimeoutMs);
		let response;
		try {
			response = await fetchImpl(`${apiBaseOf(connection)}${MESSAGES_ENDPOINT}`, {
				method: "POST",
				headers: {
					...attributionHeaders(),
					authorization: `Bearer ${apiKey}`,
					[ANTHROPIC_VERSION_HEADER]: ANTHROPIC_VERSION,
					"content-type": "application/json",
					accept: "text/event-stream"
				},
				body: JSON.stringify(body),
				signal
			});
		} catch (error) {
			throw requestFailure(error, callerSignal?.aborted === true);
		}
		if (!response.ok) {
			let raw;
			try {
				raw = await response.text();
			} catch {
				raw = "";
			}
			throw classifyHttpFailure({
				status: response.status,
				body: raw,
				contentType: response.headers.get("content-type"),
				retryAfter: response.headers.get("retry-after")
			});
		}
		if (response.body === null) throw missingBodyFailure();
		try {
			yield* streamedMessagesChunks(response.body, cap, connection.streamIdleTimeoutMs);
		} catch (error) {
			if (error instanceof LlmError) throw error;
			throw requestFailure(error, callerSignal?.aborted === true);
		}
	}
	/** Remember that Messages did not work for this model, and say so once. */
	rememberFallback(model, error) {
		const reason = error instanceof Error ? error.message : String(error);
		this.fallbacks.set(model, {
			from: "messages",
			reason
		});
		this.deps.onTransportFallback?.({
			model,
			from: "messages",
			to: "chat",
			reason
		});
	}
	/**
	* Load the catalog for listing/status. Never throws: a gateway failure is a
	* fallback to the static snapshot with the reason recorded for ticket 08.
	*/
	async loadCatalog(connection) {
		const resolved = await this.deps.resolveConnection?.(connection) ?? connection;
		return this.catalog.load(this.catalogTarget(resolved), () => this.deps.resolveApiKey(resolved));
	}
	/** The in-memory catalog for the conversation path; never touches the network. */
	currentCatalog(connection) {
		return this.catalog.current(this.catalogTarget(connection));
	}
	/** The catalog's binding: one normalized gateway address plus one cache file. */
	catalogTarget(connection) {
		return {
			apiBase: apiBaseOf(connection),
			modelsCachePath: connection.modelsCachePath
		};
	}
};
/**
* The merged entry for one model: the current catalog first, then the static
* snapshot, so a model the key no longer lists (e.g. restored history) still
* resolves its known capacities.
*/
function lookupCatalogEntry(entries, model) {
	return entries.find((entry) => entry.id === model) ?? staticGatewayCatalogEntry(model);
}
/** The base URL without a trailing slash, so the endpoint join is unambiguous. */
function apiBaseOf(connection) {
	return (connection.apiBase || "https://amr-link.open-design.ai/v1").replace(/\/+$/u, "");
}
/** The bearer key plus a timeout, composed with the caller's own cancellation. */
function requestSignal(callerSignal, timeoutMs) {
	const timeout = AbortSignal.timeout(Math.max(1, Math.trunc(timeoutMs)));
	return callerSignal === void 0 ? timeout : AbortSignal.any([callerSignal, timeout]);
}
/**
* The `max_completion_tokens` this call sends: the host budget, the model's
* output budget and the gateway's absolute ceiling, smallest wins, raised to
* the selected thinking level's floor when the model demands one (kimi).
*
* The host's per-call budget outranks the connection setting; both use the
* zero sentinel to mean "no host budget" (design §4.3).
*/
function outputCapFor(options, entry, connection, model, level) {
	return effectiveOutputCap({
		hostBudget: options.maxTokens ?? connection.maxOutputTokens,
		modelBudget: entry?.maxTokens ?? 32768,
		thinkingFloor: outputCapFloor(model, level)
	});
}
/** The reasoning level to send: a known level, coerced into the model's own domain. */
function selectedReasoningLevel(model, requested) {
	if (requested === void 0) return void 0;
	const known = REASONING_LEVEL_ORDER.find((level) => level === requested);
	return known === void 0 ? void 0 : coerceReasoningLevel(model, known);
}
/**
* Build the Chat Completions request body for one call.
*
* The cap and the reasoning level travel together (ticket 05): the level both
* maps to `reasoning_effort` and decides the model's thinking-budget floor, so
* one resolved level feeds both the body and {@link outputCapFor}.
*/
async function buildRequestBody(options, cap, images, level) {
	const body = {
		model: options.model,
		messages: await toWireMessages(options, images),
		stream: true,
		stream_options: { include_usage: true },
		[OUTPUT_CAP_FIELD]: cap
	};
	if (options.tools !== void 0 && options.tools.length > 0) body.tools = options.tools.map(toWireTool);
	const effort = wireReasoningEffort(level);
	if (effort !== void 0) body.reasoning_effort = effort;
	return body;
}
/** One tool declaration in the OpenAI `{type:'function', function}` shape. */
function toWireTool(tool) {
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters
		}
	};
}
/** Map the harness conversation onto the wire, skipping blocks the wire has no slot for. */
async function toWireMessages(options, images) {
	const messages = [];
	const system = options.system?.trim();
	if (system !== void 0 && system !== "") messages.push({
		role: "system",
		content: system
	});
	for (const message of options.messages) {
		const wire = await toWireMessage(message, images);
		if (wire !== void 0) messages.push(wire);
	}
	return messages;
}
/**
* One message in wire form.
*
* `developer` downgrades to `system` route-wide: the gateway rejects that role
* for glm (400 `Incorrect role information`), and the conservative choice is
* uniform rather than per-model. Reasoning blocks are history-only and never
* echoed back; tool addition/removal blocks are projection metadata whose
* declarations travel in `tools`.
*
* A message with an image becomes the OpenAI multi-part `content` array (text
* and `image_url` parts in block order); a text-only message keeps the plain
* string the gateway has always accepted.
*/
async function toWireMessage(message, images) {
	const parts = [];
	const toolCalls = [];
	for (const block of message.content) switch (block.type) {
		case "text":
			if (block.text !== "") parts.push({
				type: "text",
				text: block.text
			});
			break;
		case "tool-call":
			toolCalls.push({
				id: block.id,
				type: "function",
				function: {
					name: block.name,
					arguments: block.arguments
				}
			});
			break;
		case "reasoning":
		case "tool-addition":
		case "tool-removal": break;
		case "image": {
			if (block.offloaded === true) {
				parts.push({
					type: "text",
					text: offloadedPlaceholder(block.attachment)
				});
				break;
			}
			const image = await encodeImage(images, block.attachment);
			parts.push(image === void 0 ? {
				type: "text",
				text: unencodedImageText(block.attachment, images.model)
			} : {
				type: "image_url",
				image_url: { url: `data:${image.mediaType};base64,${image.data}` }
			});
			break;
		}
		case "file": throw unsupportedFileFailure(block.attachment);
		default: throw unsupportedBlockFailure(String(block.type));
	}
	const content = wireContent(parts);
	if (message.role === "tool") return {
		role: "tool",
		content,
		tool_call_id: message.toolCallId
	};
	if (message.role === "assistant") {
		if (parts.length === 0 && toolCalls.length === 0) return void 0;
		return toolCalls.length === 0 ? {
			role: "assistant",
			content
		} : {
			role: "assistant",
			content,
			tool_calls: toolCalls
		};
	}
	if (parts.length === 0) return void 0;
	return {
		role: message.role === "user" ? "user" : "system",
		content
	};
}
/**
* The wire `content` for one message: the plain string the gateway has always
* accepted when every part is text, and the multi-part array only when an image
* really travels (so nothing about text-only requests changes).
*/
function wireContent(parts) {
	if (parts.every((part) => part.type === "text")) return parts.map((part) => part.type === "text" ? part.text : "").join("\n");
	return [...parts];
}
/**
* Whether a Messages failure says "this face is not available here" rather than
* "this request is wrong".
*
* Only the routing failures fall back: a missing route (404 / non-SSE / a broken
* frame) or a deterministic refusal that names the protocol. An auth, quota,
* rate-limit or transport failure would fail identically on Chat, so retrying it
* on the other face would only cost a second request.
*/
function isRoutingFallback(error) {
	if (!(error instanceof LlmError)) return false;
	if (error.code === "PROTOCOL_ERROR") return true;
	return error.code === "BAD_REQUEST" && /anthropic[- ]version|not supported|unsupported/iu.test(error.message);
}
/** A thrown fetch (connect failure, timeout, caller cancellation) as an `LlmError`. */
function requestFailure(error, callerAborted) {
	if (callerAborted) return new LlmError("Open Design 请求已取消。", "ABORTED", { cause: error });
	if (error instanceof Error && error.name === "TimeoutError") return new LlmError("Open Design 请求超时：网关在配置的时限内没有返回响应。请稍后重试或调大请求超时设置。", "TIMEOUT", { cause: error });
	const reason = error instanceof Error ? error.message : String(error);
	return new LlmError(`无法连接 Open Design（传输层失败）：${reason}`, "TRANSPORT", { cause: error });
}
/** The effort list the picker shows, in the model's own order. */
function effortInfos(levels) {
	return levels.map((level) => ({
		id: ReasoningEffortId(level),
		name: EFFORT_NAMES[level]
	}));
}
/**
* 值得再试一次的失败码：空回复、网关临时故障、超时，以及 429 限流（有 Retry-After
* 时引擎按上游时间等，没有则指数退避）。确定性错误（`AUTH` / `QUOTA_EXHAUSTED` /
* `BAD_REQUEST` / `PROTOCOL_ERROR`）不在此列：重试只会重放同一个失败。
*/
const boundedCodes = /* @__PURE__ */ new Set([
	"EMPTY_RESPONSE",
	"TRANSIENT",
	"TIMEOUT",
	"THROTTLED",
	"RATE_LIMIT"
]);
const counts = /* @__PURE__ */ new WeakMap();
function absorbTransientFailure(agent, code) {
	if (!boundedCodes.has(code)) return "ignored";
	const used = counts.get(agent) ?? 0;
	if (used >= 3) return "exhausted";
	counts.set(agent, used + 1);
	return "retry";
}
function resetTransientFailures(agent) {
	counts.delete(agent);
}
function transientBudgetMessage(code, message) {
	return `Open Design 请求在 3 次自动重试后仍失败，已停止重试（${code}）。请稍后重新发送；若反复出现，请检查服务状态或请求耗时诊断。 原因：${message}`;
}
//#endregion
//#region src/config-volatile.ts
/**
* Volatile-config helpers for dsh 0.1.7's schema-derived profile Config.
*
* 0.1.7's `settings.describe()` projects each entry's schema through
* `volatileForm()`, so a form contains ONLY nodes carrying `meta.volatile`
* and a form edit is refused unless its path lies beneath a marked node. The
* loader then resolves each marked field into a frozen `{ get() }` reference
* that is written IN PLACE (no remount) and announced with
* `loader/volatile-update`. Two helpers keep the rest of the plugin reading a
* PLAIN `Config`: `markVolatile()` applies the mark, and
* `unwrapVolatileConfig()` reads every top-level field through its reference
* when one is present — FRESH per call, because a reference's identity is
* stable while its value changes.
*
* Only TOP-LEVEL fields are marked (a form write names a top-level path such
* as `accounts` or `modelVisibility.<id>`), so one unwrap level is complete.
* The literal `apiKey` secret stays unmarked on purpose: no settings surface
* writes it — page and TUI both write keys through the credentials seam — so a
* config-file edit to it reloading the fiber is correct for a secret literal.
*
* `volatileWrite()` is the third helper and the only WRITE in this module: it
* commits into a reference that belongs to ANOTHER plugin entry (`ctx.web`'s
* `searchProvider`), which no host API addresses directly. It is the degraded
* path behind `ctx.settings.update()`; see its own note for why the disk-backed
* path is preferred.
*
* @module dsh-opendesign-provider/config-volatile
*/
/**
* Mark one schema field volatile.
*
* `.volatile()` is unconditional: it is a schemastery 3.18.3 feature and the
* supported engine ships `~3.18.5`, so the
* method is always present. It is reached through a structural member so the caller's
* declared field type survives — the mark changes what the schema PARSES to (a
* live reference), not the plugin-facing `Config` shape.
*/
function markVolatile(schema) {
	return schema.volatile();
}
/**
* Mark every field of a Config field dict volatile, except the named
* composition-only secrets (`apiKey` here, which no settings surface writes).
*/
function markVolatileFields(fields, skip = []) {
	return Object.fromEntries(Object.entries(fields).map(([name, schema]) => [name, skip.includes(name) ? schema : markVolatile(schema)]));
}
/**
* Whether a resolved config value is a volatile reference.
*
* Duck-typed on the two properties `createVolatile` produces (frozen object
* with a `get` method) rather than cosmokit's private `write` symbol, because
* cosmokit is not a peer of this bundle. Config values are plain parsed JSON
* (or `!!jsExpr` wrappers), which are never frozen, so the test cannot
* misfire on an ordinary field.
*/
function isVolatileRef(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.isFrozen(value) && typeof value.get === "function";
}
/**
* Read one config object as PLAIN values.
*
* Every top-level field found to be a volatile reference is read through
* `.get()` — freshly on every call, so a live update lands on the very next
* read (the loader resolves EVERY marked node into a reference, unset fields
* included, so a loader-parsed config always yields a fresh object here). The
* pass-through for a field that is not a reference is what keeps the unmarked
* `apiKey` literal readable.
*/
function unwrapVolatileConfig(config) {
	const source = config;
	if (typeof source !== "object" || source === null) return config;
	const plain = {};
	for (const [field, value] of Object.entries(source)) plain[field] = isVolatileRef(value) ? value.get() : value;
	return plain;
}
//#endregion
//#region src/index.ts
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
* catalog/credential facts through `opendesign/models`. Ticket 10 adds the P1
* quota face: a read-only control-plane client, the `opendesign/usage` Remote
* and the `/opendesign` command — all degraded gracefully without a control
* key, and none of them on the inference path.
*
* @module dsh-opendesign-provider
*/
const name = "llm-opendesign";
const inject = ["llm"];
/**
* The Config schema: every field volatile except the composition-only `apiKey`
* secret. Settings forms are projected from the schema's `meta.volatile`
* nodes, so an unmarked field would be invisible to AND unwritable from the
* settings page. The loader hands `apply()` a live reference per marked field,
* so writes commit in place without remounting this fiber.
*/
const Config = z.object(markVolatileFields({
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	apiKey: z.string().role("secret"),
	apiBase: z.string(),
	modelsCachePath: z.string(),
	amrConfigPath: z.string(),
	requestTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS),
	streamIdleTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS),
	transportMaxRetries: z.number().min(0).max(50),
	visibleModels: z.array(z.string()),
	modelVisibility: z.dict(z.boolean()),
	contextWindow: z.number().min(1).max(CONTEXT_WINDOW_MAX).step(1),
	contextWindowOverrides: z.dict(z.number().min(1).max(CONTEXT_WINDOW_MAX).step(1)),
	maxOutputTokens: z.number().min(0).max(MAX_OUTPUT_TOKEN_LIMIT).step(1),
	protocol: z.union([
		z.const("chat"),
		z.const("messages"),
		z.const("auto")
	]).default("auto"),
	lang: z.string().pattern(/^(zh|en)$/).default("zh"),
	showSidebarQuota: z.boolean().default(false)
}, ["apiKey"]));
/**
* The one explicit resolve step from raw config to validated connection facts.
* Programmatic construction may bypass Schemastery normalization, so every
* default is re-judged here — for the composition entry at load and for every
* settings-backed read.
*/
function resolveAdapterOptions(config) {
	return {
		apiKeyEnv: credentialRef(config.apiKeyEnv ?? "OPEN_DESIGN_API_KEY"),
		apiBase: config.apiBase ?? "https://amr-link.open-design.ai/v1",
		modelsCachePath: config.modelsCachePath ?? join(homedir(), ".opendesign/models-cache.json"),
		requestTimeoutMs: config.requestTimeoutMs ?? 3e5,
		streamIdleTimeoutMs: config.streamIdleTimeoutMs ?? 3e5,
		visibleModels: Array.isArray(config.visibleModels) ? config.visibleModels.filter((id) => typeof id === "string" && id !== "") : void 0,
		modelVisibility: readModelVisibility(config.modelVisibility),
		contextWindow: isValidContextWindow(config.contextWindow) ? config.contextWindow : void 0,
		contextWindowOverrides: readContextWindowOverrides(config.contextWindowOverrides),
		maxOutputTokens: isValidMaxOutputTokens(config.maxOutputTokens) ? config.maxOutputTokens : void 0,
		transportMaxRetries: readTransportMaxRetries(config.transportMaxRetries),
		protocol: isProtocolSetting(config.protocol) ? config.protocol : DEFAULT_PROTOCOL
	};
}
/**
* Per-model visibility overrides, cleaned for the adapter: a non-object or a
* non-boolean entry is dropped rather than reaching the picker filter, and an
* all-empty map reads as no map.
*/
function readModelVisibility(raw) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
	const entries = Object.entries(raw).filter((entry) => entry[0] !== "" && typeof entry[1] === "boolean");
	return entries.length === 0 ? void 0 : Object.fromEntries(entries);
}
function apply(ctx, config) {
	const current = () => unwrapVolatileConfig(config);
	const options = () => resolveAdapterOptions(current());
	const resolveReference = async (reference) => {
		const ref = credentialRef(reference);
		const credentials = ctx.get("credentials");
		if (credentials !== void 0) {
			const hit = await credentials.resolve(ref);
			return hit?.value !== void 0 && hit.value.length > 0 ? hit.value : void 0;
		}
		const ambient = launchEnvironmentOf(ctx).get(ref);
		return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
	};
	const resolveChain = () => resolveCredentialChain(current(), { resolveReference });
	const resolveApiKey = async () => {
		const chain = await resolveChain();
		if (chain.apiKey === void 0) throw new LlmError(missingCredentialMessage(chain.reference), "MISSING_CREDENTIAL");
		const origin = chain.source === "literal" ? "config.apiKey" : chain.source === "reference" ? chain.reference : `${chain.login.path}（profiles.prod.runtimeKey）`;
		return assertUsableApiKey(chain.apiKey, "llm-opendesign", origin);
	};
	const resolveConnection = async (connection) => {
		const chain = await resolveChain();
		return {
			...connection,
			apiBase: chain.apiBase
		};
	};
	const attachments = () => ctx.get("attachments");
	const credentialState = async () => {
		try {
			const chain = await resolveChain();
			return {
				ref: chain.reference,
				present: chain.apiKey !== void 0,
				login: {
					path: chain.login.path,
					status: chain.login.status,
					hasRuntimeKey: chain.login.hasRuntimeKey
				}
			};
		} catch {
			return {
				ref: credentialRef(current().apiKeyEnv ?? "OPEN_DESIGN_API_KEY"),
				present: false,
				login: {
					path: defaultAmrConfigPath(),
					status: "unreadable",
					hasRuntimeKey: false
				}
			};
		}
	};
	const onTransportFallback = (event) => {
		console.warn(`[llm-opendesign] ${event.from} 传输不可用，已回落到 ${event.to}（${event.model}）：${event.reason.slice(0, 200)}`);
	};
	const adapter = new OpenDesignAdapter({
		options,
		resolveApiKey,
		resolveConnection,
		attachments,
		credentialState,
		onTransportFallback
	});
	ctx.llm.registerConfigurableProviders([{
		provider: PROVIDER,
		displayName: PROVIDER_DISPLAY_NAME,
		settingsNs: NS,
		settingsPath: []
	}]);
	ctx.llm.registerAdapter([PROVIDER], adapter);
	applyModelsRemote(ctx, {
		catalogStatus: () => adapter.catalogStatus(),
		credentialStatus: resolveChain,
		quota: async () => (await readQuota(await defaultModel())).snapshot,
		analytics: {
			sessionQuery: () => ctx.get("sessionQuery"),
			catalogStatus: () => adapter.catalogStatus(),
			isVisible: (id) => {
				const connection = options();
				return modelIsVisible(id, connection.visibleModels ?? [], connection.modelVisibility);
			}
		}
	});
	const controlPlane = new OpenDesignControlPlane({ loginPath: () => current().amrConfigPath });
	const readQuota = (model) => controlPlane.read(model === void 0 ? {} : { model });
	const defaultModel = async () => {
		try {
			const status = await adapter.catalogStatus();
			return status.models.find((entry) => entry.default)?.id ?? status.models[0]?.id;
		} catch {
			return;
		}
	};
	ctx.inject(["commands"], (commandCtx) => {
		applyCommands(commandCtx, {
			quota: readQuota,
			model: defaultModel,
			getLocale: () => resolveCommandLocale(current().lang)
		});
	});
	const transportMaxRetries = () => readTransportMaxRetries(current().transportMaxRetries);
	const sessionAgents = /* @__PURE__ */ new WeakMap();
	ctx.on("agent/request-error", async ({ agent, provider, failure, signal }, next) => {
		if (signal.aborted || provider !== "open-design") return next();
		const session = Reflect.get(agent, "session");
		if (typeof session === "object" && session !== null) sessionAgents.set(session, agent);
		const transient = absorbTransientFailure(agent, failure.code);
		if (transient === "exhausted") throw new Error(transientBudgetMessage(failure.code, failure.message));
		if (transient === "retry") return next();
		const decision = absorbTransportFailure(agent, failure.code, transportMaxRetries());
		if (decision === "ignored") return next();
		if (decision === "retry") return { kind: "retry" };
		const message = transportBudgetMessage(failure.message, transportMaxRetries());
		ctx.logger.warn(`llm-opendesign: transport retry budget exhausted for ${PROVIDER} (${TRANSPORT_FAILURE_CODE})`);
		throw new Error(message);
	});
	ctx.on("session/event", (session, event) => {
		const action = transportResetAction(event.type);
		if (action === "forget") {
			sessionAgents.delete(session);
			return;
		}
		if (action !== "reset") return;
		const agent = sessionAgents.get(session);
		if (agent !== void 0) {
			resetTransportFailures(agent);
			resetTransientFailures(agent);
		}
	});
	ctx.on("agent/status", ({ agent, status }) => {
		if (status === "idle") {
			resetTransportFailures(agent);
			resetTransientFailures(agent);
		}
	});
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.effect(() => {
			const dispose = settingsCtx.settings.configure({ auto: false }, ctx.fiber);
			return () => {
				dispose();
			};
		}, "dsh-opendesign-provider: settings auto-form policy");
	});
}
//#endregion
export { ANALYTICS_LOCALE_NS, ANALYTICS_SECTION_ID, CONTROL_PLANE_TIMEOUT_MS, Config, DEFAULT_API_BASE, DEFAULT_API_KEY_ENV, DEFAULT_CONTROL_PLANE_API_URL, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, MODELS_CACHE_RELATIVE_PATH, MODEL_CARD_KEY, NS, OpenDesignAdapter, OpenDesignControlPlane, PACKAGE_NAME, PANEL_ID, PLUGIN_ID, PROVIDER, PROVIDER_DISPLAY_NAME, QUOTA_CACHE_TTL_MS, QUOTA_DESCRIPTOR, QUOTA_ENDPOINT, QUOTA_FIVE_HOUR_SECONDS, QUOTA_SEVEN_DAY_SECONDS, REMOTE_ENDPOINTS, REMOTE_NAMESPACE, REMOTE_SERVICE, REQUEST_TIMING_ENV, SETTINGS_SECTION_ID, STREAM_TRACE_ENV, apply, applyCommands, classifyQuotaWindow, commandDefinition, diagnosticsSnapshot, foldAnalytics, formatDiagnostics, inject, name, parseAnalyticsQuery, parseAnalyticsReport, parseQuotaSnapshot, renderQuota, resolveAdapterOptions, retryableFailureCodes };

//# sourceMappingURL=index.js.map