window.__ModuleLoader__.load({
	id: "@mars-sea/dsh-opendesign-provider",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		/** The settings namespace and plugin-row id (`llm-opendesign`). */
		const NS = "llm-opendesign";
		/** The credential reference the Models page writes when no literal key is set. */
		const DEFAULT_API_KEY_ENV = "OPEN_DESIGN_API_KEY";
		/** The wire namespace shared by every Remote this plugin serves. */
		const REMOTE_NAMESPACE = "opendesign";
		/**
		* The Cordis service key the Gateway resolves the models Remote from. Cordis
		* allows one service per key, so the quota Remote (ticket 10) provides its own
		* key — see `QUOTA_SERVICE` in `quota-wire.ts`.
		*/
		const REMOTE_SERVICE = "opendesignUsage";
		/** The settings-page slot id (`settings.section`). */
		const SETTINGS_SECTION_ID = "opendesign";
		/** The analytics page's own `settings.section` id (ticket 12). */
		const ANALYTICS_SECTION_ID = "opendesign-analytics";
		/** Locale namespace both browser surfaces declare for their copy. */
		const SETTINGS_LOCALE_NS = "settings.opendesign";
		/** Locale namespace the analytics page declares for its own copy. */
		const ANALYTICS_LOCALE_NS = "analytics.opendesign";
		/** The Models-page provider-card key (`settings.models.provider-card`). */
		const MODEL_CARD_KEY = "llm-opendesign";
		/** The quota panel's `main` / `sidebar.footer.action` id. */
		const PANEL_ID = "opendesign-panel";
		/** Locale namespace the two quota-panel surfaces declare (distinct from the settings page's). */
		const PANEL_LOCALE_NS = "panel.opendesign";
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
		//#region src/models-wire.ts
		/** Canonical `<namespace>/<method>` endpoint of the models report. */
		const MODELS_ENDPOINT = `${REMOTE_NAMESPACE}/models`;
		const { reject: reject$1, record: record$1, stringField: stringField$1, numberField: numberField$1, booleanField: booleanField$1 } = makeBoundaryValidator("opendesign/models result:");
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
		const COSTS$1 = [
			"low",
			"medium",
			"high"
		];
		const CAPABILITIES$1 = ["standard", "advanced"];
		/** Read one optional string and reject a present non-string. */
		function optionalString$1(source, key, field) {
			if (source[key] === void 0) return void 0;
			return stringField$1(source, key, field);
		}
		/** Read one optional finite number and reject a present non-number. */
		function optionalNumber(source, key, field) {
			if (source[key] === void 0) return void 0;
			return numberField$1(source, key, field);
		}
		function stringList(value, field) {
			if (!Array.isArray(value)) reject$1(field);
			const items = [];
			for (const item of value) {
				if (typeof item !== "string") reject$1(field);
				items.push(item);
			}
			return items;
		}
		function parseEntry(value, field) {
			const source = record$1(value, field);
			const cost = stringField$1(source, "cost", `${field}.cost`);
			if (!COSTS$1.includes(cost)) reject$1(`${field}.cost`);
			const capability = stringField$1(source, "capability", `${field}.capability`);
			if (!CAPABILITIES$1.includes(capability)) reject$1(`${field}.capability`);
			return {
				id: stringField$1(source, "id", `${field}.id`),
				name: stringField$1(source, "name", `${field}.name`),
				contextWindow: numberField$1(source, "contextWindow", `${field}.contextWindow`),
				maxTokens: numberField$1(source, "maxTokens", `${field}.maxTokens`),
				cost,
				capability,
				inputModalities: stringList(source.inputModalities, `${field}.inputModalities`),
				reasoningLevels: stringList(source.reasoningLevels, `${field}.reasoningLevels`),
				default: booleanField$1(source, "default", `${field}.default`),
				calibrated: booleanField$1(source, "calibrated", `${field}.calibrated`)
			};
		}
		function parseCatalog(value) {
			const source = record$1(value, "catalog");
			const kind = stringField$1(source, "source", "catalog.source");
			if (kind !== "live" && kind !== "static") reject$1("catalog.source");
			if (!Array.isArray(source.models)) reject$1("catalog.models");
			const fetchedAt = optionalNumber(source, "fetchedAt", "catalog.fetchedAt");
			const reason = optionalString$1(source, "reason", "catalog.reason");
			return {
				source: kind,
				apiBase: stringField$1(source, "apiBase", "catalog.apiBase"),
				cached: booleanField$1(source, "cached", "catalog.cached"),
				...fetchedAt === void 0 ? {} : { fetchedAt },
				...reason === void 0 ? {} : { reason },
				models: source.models.map((entry, index) => parseEntry(entry, `catalog.models[${index}]`))
			};
		}
		function parseCredential(value) {
			const source = record$1(value, "credential");
			const kind = stringField$1(source, "source", "credential.source");
			if (!CREDENTIAL_SOURCES.includes(kind)) reject$1("credential.source");
			const baseSource = stringField$1(source, "apiBaseSource", "credential.apiBaseSource");
			if (!API_BASE_SOURCES.includes(baseSource)) reject$1("credential.apiBaseSource");
			const login = record$1(source.login, "credential.login");
			const status = stringField$1(login, "status", "credential.login.status");
			if (!LOGIN_STATUSES.includes(status)) reject$1("credential.login.status");
			const apiUrl = optionalString$1(login, "apiUrl", "credential.login.apiUrl");
			const user = optionalString$1(login, "user", "credential.login.user");
			return {
				source: kind,
				reference: stringField$1(source, "reference", "credential.reference"),
				configured: booleanField$1(source, "configured", "credential.configured"),
				apiBase: stringField$1(source, "apiBase", "credential.apiBase"),
				apiBaseSource: baseSource,
				login: {
					status,
					path: stringField$1(login, "path", "credential.login.path"),
					hasRuntimeKey: booleanField$1(login, "hasRuntimeKey", "credential.login.hasRuntimeKey"),
					hasControlKey: booleanField$1(login, "hasControlKey", "credential.login.hasControlKey"),
					...apiUrl === void 0 ? {} : { apiUrl },
					...user === void 0 ? {} : { user }
				}
			};
		}
		/** Strictly parse one untrusted `opendesign/models` result. */
		function parseModelsReport(value) {
			const source = record$1(value, "result");
			return {
				catalog: parseCatalog(source.catalog),
				credential: parseCredential(source.credential)
			};
		}
		/** The Client-face contribution it mounts. */
		const MODELS_REMOTE_CONTRIBUTION = {
			package: REMOTE_PACKAGE,
			descriptors: [makeRemoteDescriptor(MODELS_ENDPOINT, "models", `${REMOTE_PACKAGE}#OpenDesignModelsReport`, { parse: parseModelsReport })]
		};
		//#endregion
		//#region src/quota-wire.ts
		/** Canonical `<namespace>/<method>` endpoint of the quota snapshot. */
		const QUOTA_ENDPOINT = `${REMOTE_NAMESPACE}/usage`;
		/**
		* The Cordis service key the quota Remote is provided under. The models Remote
		* owns `opendesignUsage`; Cordis rejects a second service on the same key, so
		* the quota half brings its own.
		*/
		const QUOTA_SERVICE = "opendesignQuota";
		const { reject, record, stringField, numberField, booleanField } = makeBoundaryValidator("opendesign/usage result:");
		const WINDOW_KINDS = [
			"five_hour",
			"seven_day",
			"other"
		];
		const FUNDINGS = ["wallet", "coding_plan"];
		function optionalString(source, key, field) {
			if (source[key] === void 0) return void 0;
			return stringField(source, key, field);
		}
		function parseWindow(value, field) {
			const source = record(value, field);
			const kind = stringField(source, "kind", `${field}.kind`);
			if (!WINDOW_KINDS.includes(kind)) reject(`${field}.kind`);
			const resetsAt = optionalString(source, "resetsAt", `${field}.resetsAt`);
			const resetMode = optionalString(source, "resetMode", `${field}.resetMode`);
			return {
				kind,
				durationSeconds: numberField(source, "durationSeconds", `${field}.durationSeconds`),
				usedCredits: numberField(source, "usedCredits", `${field}.usedCredits`),
				limitCredits: numberField(source, "limitCredits", `${field}.limitCredits`),
				remainingCredits: numberField(source, "remainingCredits", `${field}.remainingCredits`),
				...resetsAt === void 0 ? {} : { resetsAt },
				...resetMode === void 0 ? {} : { resetMode }
			};
		}
		/** Strictly parse one untrusted `opendesign/usage` result. */
		function parseQuotaSnapshot(value) {
			const source = record(value, "result");
			if (!Array.isArray(source.windows)) reject("windows");
			const funding = optionalString(source, "funding", "funding");
			if (funding !== void 0 && !FUNDINGS.includes(funding)) reject("funding");
			const tier = optionalString(source, "tier", "tier");
			const subscriptionStatus = optionalString(source, "subscriptionStatus", "subscriptionStatus");
			const currentPeriodEnd = optionalString(source, "currentPeriodEnd", "currentPeriodEnd");
			const balanceUsd = source.balanceUsd === void 0 ? void 0 : numberField(source, "balanceUsd", "balanceUsd");
			return {
				controlPlaneAvailable: booleanField(source, "controlPlaneAvailable", "controlPlaneAvailable"),
				...tier === void 0 ? {} : { tier },
				...subscriptionStatus === void 0 ? {} : { subscriptionStatus },
				...currentPeriodEnd === void 0 ? {} : { currentPeriodEnd },
				...balanceUsd === void 0 ? {} : { balanceUsd },
				...funding === void 0 ? {} : { funding },
				windows: source.windows.map((entry, index) => parseWindow(entry, `windows[${index}]`)),
				fetchedAt: stringField(source, "fetchedAt", "fetchedAt"),
				...source.stale === void 0 ? {} : { stale: booleanField(source, "stale", "stale") }
			};
		}
		/** The Client-face contribution it mounts. */
		const QUOTA_REMOTE_CONTRIBUTION = {
			package: REMOTE_PACKAGE,
			descriptors: [makeRemoteDescriptor(QUOTA_ENDPOINT, "usage", `${REMOTE_PACKAGE}#QuotaSnapshot`, { parse: parseQuotaSnapshot }, [], QUOTA_SERVICE)]
		};
		//#endregion
		//#region src/analytics-wire.ts
		/** Canonical `<namespace>/<method>` endpoint of the analytics report. */
		const ANALYTICS_ENDPOINT = `${REMOTE_NAMESPACE}/analytics`;
		const MAX_RECENT_SESSIONS$1 = 100;
		const MAX_RANGE_MS = 316224e5;
		const queryValidator = makeBoundaryValidator("opendesign/analytics query:");
		const resultValidator = makeBoundaryValidator("opendesign/analytics result:");
		const COSTS = [
			"low",
			"medium",
			"high",
			"unknown"
		];
		const CAPABILITIES = [
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
				if (!Number.isInteger(sessions) || sessions < 1 || sessions > MAX_RECENT_SESSIONS$1) queryValidator.reject(`${prefix}recent.sessions`);
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
			if (!COSTS.includes(cost)) resultValidator.reject(`${field}cost`);
			const capability = resultValidator.stringField(source, "capability", `${field}capability`);
			if (!CAPABILITIES.includes(capability)) resultValidator.reject(`${field}capability`);
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
		/** The Client-face contribution it mounts. */
		const ANALYTICS_REMOTE_CONTRIBUTION = {
			package: REMOTE_PACKAGE,
			descriptors: [makeRemoteDescriptor(ANALYTICS_ENDPOINT, "analytics", `${REMOTE_PACKAGE}#OpenDesignAnalyticsReport`, { parse: parseAnalyticsReport }, [makeRemoteParameter("query", `${REMOTE_PACKAGE}#AnalyticsQuery`, { parse: parseAnalyticsQuery })])]
		};
		//#endregion
		//#region src/client/snapshot-store.ts
		/** Notify every subscriber without letting one faulty UI consumer suppress the rest. */
		function notifyListeners(listeners) {
			for (const listener of listeners) try {
				listener();
			} catch (error) {
				console.error("[dsh-opendesign-provider] snapshot subscriber failed:", error);
			}
		}
		/** Create one observable snapshot store. */
		function createSnapshotStore(initial) {
			let snapshot = initial;
			const listeners = /* @__PURE__ */ new Set();
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set(value) {
					if (Object.is(value, snapshot)) return;
					snapshot = value;
					notifyListeners(listeners);
				}
			};
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
		//#region src/client/settings-scope.ts
		/**
		* Browser settings scope over the `remote.settings` Typert namespace.
		*
		* The harness's own `settingsScope` client wrapper was REMOVED by the 0.1.7
		* settings rewrite and has no replacement, so this module IS the client half:
		* it speaks the `describe()` / `mutate(namespace, ops, revision)` wire directly
		* and implements the `SettingsScope<T>` face the settings-page controller
		* consumes. `view.writable` is the Host's own authorization fact — the client
		* never infers write permission from localhost, URL shape or origin.
		*
		* **Capture the namespace from an inject-scoped context, never read it off
		* `ctx.remote`.** React-free so `tests/settings-scope.test.ts` can drive the
		* lifecycle over a fake remote.
		*
		* @module dsh-opendesign-provider/client/settings-scope
		*/
		/**
		* Backoff before re-reading a directory whose FIRST read failed, in millis.
		*
		* Only a failure with NOTHING held retries. With no view the scope keeps its
		* initial `{ status: 'loading', writable: false }` snapshot and the settings
		* page renders fully disabled, while the forwarded invalidation signals need a
		* live Host to fire and the namespace only re-mounts on a reload. A failure
		* with a held view retries nothing — the page already shows the last good
		* document (`tests/settings-scope.test.ts` pins both).
		*/
		const SETTINGS_DESCRIBE_RETRY_MS = [
			1e3,
			2e3,
			4e3
		];
		/** The production timer: a browser/node timeout, no polling. */
		const REAL_SETTINGS_TIMER = {
			set(callback, ms) {
				const handle = setTimeout(callback, ms);
				handle.unref?.();
				return handle;
			},
			clear(handle) {
				clearTimeout(handle);
			}
		};
		/** Shallow equality over the snapshot fields, so an unchanged derive never churns subscribers. */
		function sameSnapshot(a, b) {
			return a.status === b.status && Object.is(a.value, b.value) && Object.is(a.base, b.base) && Object.is(a.user, b.user) && Object.is(a.revision, b.revision) && a.writable === b.writable && a.mode === b.mode;
		}
		/** Accept a decoded row value only when it is the object a settings section is. */
		function decodeRow(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
			return value;
		}
		/**
		* One shared mirror of the Host `settings.describe()` view.
		*
		* The run loop is the harness's own: serialize behind `inFlight`, fold a
		* concurrent invalidation into exactly one rerun, and hold the previous view
		* across a failed read (status stays `ready` with an `error`, or returns to
		* `idle` when nothing was ever held).
		*/
		var SettingsDescribeMirror = class {
			resolveRemote;
			timer;
			store;
			inFlight;
			rerun = false;
			generation = 0;
			/** Pending retry handle and how many of {@link SETTINGS_DESCRIBE_RETRY_MS} are spent. */
			retryHandle;
			retries = 0;
			disposed = false;
			constructor(resolveRemote, timer = REAL_SETTINGS_TIMER) {
				this.resolveRemote = resolveRemote;
				this.timer = timer;
				this.store = createSnapshotStore({
					status: "idle",
					view: null,
					error: null
				});
			}
			getSnapshot() {
				return this.store.getSnapshot();
			}
			subscribe(listener) {
				return this.store.subscribe(listener);
			}
			/** The cheap idempotent entry: kick a first read. */
			ensure() {
				this.load();
			}
			/**
			* Refresh from the Host. A call during an in-flight read marks one rerun
			* after it settles instead of racing a second wire read.
			* @returns settlement after this call's freshness is reflected.
			*/
			load() {
				if (this.disposed) return Promise.resolve();
				this.clearRetry();
				if (this.inFlight !== void 0) {
					this.rerun = true;
					return this.inFlight;
				}
				const run = Promise.resolve().then(() => this.run());
				this.inFlight = run;
				return run;
			}
			/**
			* Fold one write answer's namespace ROW into the held view without a wire
			* read, and invalidate any read still in flight: a read begun before the
			* write committed must not publish the pre-write document over it. With no
			* held document the answer is not published as a partial document — the
			* next read (or the failed-write recovery) picks it up.
			* @param row - The namespace view a settings write answered with.
			*/
			acceptView(row) {
				const before = this.store.getSnapshot();
				this.generation += 1;
				if (this.inFlight !== void 0) this.rerun = true;
				if (before.view === null) return;
				const held = before.view;
				const namespaces = held.namespaces?.some((candidate) => candidate.ns === row.ns) ? held.namespaces.map((candidate) => candidate.ns === row.ns ? row : candidate) : [...held.namespaces ?? [], row];
				this.store.set({
					...before,
					view: {
						...held,
						namespaces
					}
				});
			}
			async run() {
				try {
					for (;;) {
						const before = this.store.getSnapshot();
						if (before.status === "idle") this.store.set({
							...before,
							status: "loading"
						});
						this.rerun = false;
						const generation = ++this.generation;
						let outcome;
						try {
							const namespace = this.resolveRemote();
							if (namespace === void 0) throw new Error("the settings remote namespace is not mounted");
							const response = await namespace.describe();
							if (response.ok) {
								const value = response.value;
								outcome = typeof value === "object" && value !== null ? { view: value } : { failure: "settings describe answered no view" };
							} else outcome = { failure: response.error?.message ?? "settings describe failed" };
						} catch (error) {
							outcome = { failure: readableErrorText(error) };
						}
						if (generation !== this.generation) continue;
						if ("view" in outcome) {
							this.retries = 0;
							this.store.set({
								status: "ready",
								view: outcome.view,
								error: null
							});
						} else {
							const held = this.store.getSnapshot();
							this.store.set({
								status: held.view === null ? "idle" : "ready",
								view: held.view,
								error: outcome.failure
							});
							if (held.view === null) this.scheduleRetry();
						}
						if (!this.rerun) break;
					}
				} finally {
					this.inFlight = void 0;
				}
			}
			/**
			* Schedule the next retry of a failed FIRST read ({@link SETTINGS_DESCRIBE_RETRY_MS}).
			* Bounded: once the ladder is spent the scope keeps its degraded snapshot,
			* exactly as before, until an invalidation or a namespace re-mount arrives.
			*/
			scheduleRetry() {
				if (this.disposed || this.retries >= SETTINGS_DESCRIBE_RETRY_MS.length) return;
				const delay = SETTINGS_DESCRIBE_RETRY_MS[this.retries];
				this.retries += 1;
				this.retryHandle = this.timer.set(() => {
					this.retryHandle = void 0;
					this.load();
				}, delay);
			}
			/** Cancel a pending retry (a live read is starting, or the scope is going away). */
			clearRetry() {
				if (this.retryHandle !== void 0) this.timer.clear(this.retryHandle);
				this.retryHandle = void 0;
			}
			/** Stop the mirror: no further reads, and no retry may fire after disposal. */
			dispose() {
				this.disposed = true;
				this.clearRetry();
			}
		};
		/**
		* One namespace's derived scope over the shared mirror, plus its serialized
		* Host writes — the face the settings page will consume
		* (`getSnapshot` / `subscribe` / `set` / `unset`).
		*/
		var RemoteSettingsScope = class {
			resolveRemote;
			store;
			mirror;
			namespace;
			tail = Promise.resolve();
			writeGeneration = 0;
			disposed = false;
			unsubscribe;
			/** Revision answered by a superseded write still ahead of the mirror. */
			pendingRevision;
			constructor(resolveRemote, mirror, namespace) {
				this.resolveRemote = resolveRemote;
				this.mirror = mirror;
				this.namespace = namespace;
				this.store = createSnapshotStore({
					status: "loading",
					value: void 0,
					base: void 0,
					user: void 0,
					revision: void 0,
					writable: false,
					mode: "host"
				});
				this.unsubscribe = mirror.subscribe(() => {
					this.derive();
				});
				this.derive();
			}
			getSnapshot() {
				return this.store.getSnapshot();
			}
			subscribe(listener) {
				return this.store.subscribe(listener);
			}
			/** Queue one field write (the single-path `set` op form). */
			async set(field, value) {
				await this.mutate([{
					op: "set",
					path: [field],
					value
				}]);
			}
			/** Queue one field clear (the single-path `unset` op form). */
			async unset(field) {
				await this.mutate([{
					op: "unset",
					path: [field]
				}]);
			}
			/**
			* Queue one atomic namespace mutation behind the single-flight fence.
			* A rejected write (e.g. `SETTINGS_CONFLICT`) re-reads the Host so the
			* snapshot reports what actually landed; an accepted one folds its answer
			* in directly — unless a newer write already superseded it, in which case
			* that answer's revision becomes the next write's fence.
			*/
			mutate(ops, expectedRevision) {
				const ownedOps = structuredClone(ops);
				const generation = ++this.writeGeneration;
				return this.enqueue(async () => {
					const revision = expectedRevision ?? this.pendingRevision ?? this.getSnapshot().revision;
					const response = await this.mutateRemote(ownedOps, revision);
					if (!response.ok) {
						await this.recover(generation);
						return response.error?.message?.includes("SETTINGS_CONFLICT") ? "conflict" : "failed";
					}
					const row = response.value;
					if (row?.ns !== this.namespace || decodeRow(row.value) === void 0 || typeof row.revision !== "number") {
						await this.recover(generation);
						return "failed";
					}
					if (this.disposed) return "accepted";
					if (generation === this.writeGeneration) {
						this.pendingRevision = void 0;
						this.mirror.acceptView(row);
					} else this.pendingRevision = typeof row.revision === "number" ? row.revision : void 0;
					return "accepted";
				});
			}
			async mutateRemote(ops, revision) {
				try {
					const namespace = this.resolveRemote();
					if (namespace === void 0) return {
						ok: false,
						error: { message: "the settings remote namespace is not mounted" }
					};
					return await namespace.mutate(this.namespace, ops, revision);
				} catch (error) {
					return {
						ok: false,
						error: { message: readableErrorText(error) }
					};
				}
			}
			/** Reload Host state for the latest failed write; superseded failures leave recovery to it. */
			async recover(generation) {
				if (this.disposed || generation !== this.writeGeneration) return;
				this.pendingRevision = void 0;
				await this.mirror.load();
			}
			/** Derive this namespace's snapshot from the mirror's held view. */
			derive() {
				if (this.disposed) return;
				const mirrored = this.mirror.getSnapshot();
				if (mirrored.view === null || mirrored.view === void 0) return;
				const writable = mirrored.view.writable === true;
				const row = mirrored.view.namespaces?.find((candidate) => candidate.ns === this.namespace);
				if (row === void 0) {
					this.publish({
						status: "unavailable",
						writable
					});
					return;
				}
				const decoded = decodeRow(row.value);
				if (decoded === void 0) return;
				this.publish({
					status: "ready",
					writable,
					value: decoded,
					base: row.base,
					user: row.user,
					revision: typeof row.revision === "number" ? row.revision : void 0
				});
			}
			/** Publish `next` over the current snapshot, skipping the write when nothing changed. */
			publish(next) {
				const current = this.store.getSnapshot();
				const candidate = {
					status: next.status,
					value: "value" in next ? next.value : current.value,
					base: "base" in next ? next.base : current.base,
					user: "user" in next ? next.user : current.user,
					revision: "revision" in next ? next.revision : current.revision,
					writable: next.writable,
					mode: current.mode
				};
				if (sameSnapshot(candidate, current)) return;
				this.store.set(candidate);
			}
			/** Queue operations one at a time; disposal makes the queue inert. */
			enqueue(operation) {
				if (this.disposed) return Promise.resolve("cancelled");
				const task = this.tail.then(async () => {
					if (this.disposed) return "cancelled";
					return operation();
				});
				this.tail = task.then(() => {}, () => {});
				return task;
			}
			/** Stop queued operations, stop deriving, and wait for the current wire call to settle. */
			async dispose() {
				this.disposed = true;
				this.writeGeneration += 1;
				this.unsubscribe?.();
				await this.tail;
			}
		};
		/**
		* Build the plugin's settings scope for one namespace.
		*
		* Subscribes the two signals that can move the Host view — the forwarded
		* `settings/document-updated` invalidation and (when the client exposes it)
		* `connection/reset` — kicks the first describe read, and derives the namespace
		* row on every mirror change.
		*
		* `resolveRemote` must be the INJECT-CAPTURED namespace (see
		* {@link SettingsRemoteResolver}), and the caller that owns that inject calls
		* {@link ManagedSettingsScope.refresh} once the namespace lands — that is what
		* turns the first, namespace-less read into a served one. A profile that never
		* mounts the namespace leaves the page in its degraded (`unavailable`,
		* read-only) state instead of throwing.
		*
		* @param namespace - Settings namespace (profile entry id) this scope binds.
		*/
		function createSettingsScope(context, namespace, resolveRemote, timer = REAL_SETTINGS_TIMER) {
			const mirror = new SettingsDescribeMirror(resolveRemote, timer);
			const scope = new RemoteSettingsScope(resolveRemote, mirror, namespace);
			const disposers = [];
			if (typeof context.remote.$on === "function") {
				const off = context.remote.$on("settings/document-updated", () => {
					mirror.ensure();
				});
				if (typeof off === "function") disposers.push(off);
			}
			if (typeof context.on === "function") {
				const off = context.on("connection/reset", () => {
					mirror.load();
				});
				if (typeof off === "function") disposers.push(off);
			}
			mirror.ensure();
			return {
				getSnapshot: () => scope.getSnapshot(),
				subscribe: (listener) => scope.subscribe(listener),
				set: (field, value) => scope.set(field, value),
				unset: (field) => scope.unset(field),
				mutate: (ops, revision) => scope.mutate(ops, revision),
				refresh: () => {
					mirror.load();
				},
				dispose: async () => {
					for (const dispose of disposers.splice(0)) dispose();
					mirror.dispose();
					await scope.dispose();
				}
			};
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
		//#endregion
		//#region src/client/settings.ts
		/**
		* Browser-side controller for the Open Design settings page and Models-page
		* card (ticket 08).
		*
		* It owns the staged draft → one batch `mutate` fenced by the Host revision →
		* a separately confirmed credential write, never the other order. Config
		* fields and the key live on different wires on purpose: the key can only ever
		* reach this plugin's own credential reference, while the settings document
		* receives ordinary fields. A conflict keeps every draft, including the key
		* draft, and writes no credential.
		*
		* React-free so tests drive the same state the page renders. The controller
		* reads Host facts through three injected seams: the namespace scope
		* (`remote.settings`), the credentials namespace, and the `opendesign/models`
		* report (catalog provenance + credential provenance).
		*
		* @module dsh-opendesign-provider/client/settings
		*/
		/** Host transport retry ceiling, mirrored from the Config schema. */
		const MAX_TRANSPORT_RETRIES = 20;
		/** Initial empty drafts before the first scope read lands. */
		const EMPTY_FIELD = () => ({
			text: "",
			invalid: false,
			changed: false
		});
		/** Build the seven-field draft table with fresh objects. */
		function emptyFields() {
			return {
				apiBase: EMPTY_FIELD(),
				modelsCachePath: EMPTY_FIELD(),
				requestTimeoutMs: EMPTY_FIELD(),
				streamIdleTimeoutMs: EMPTY_FIELD(),
				transportMaxRetries: EMPTY_FIELD(),
				contextWindow: EMPTY_FIELD(),
				maxOutputTokens: EMPTY_FIELD()
			};
		}
		/** Read a finite number, tolerating a trailing/leading blank but nothing else. */
		function numberText(text) {
			if (text.trim() === "") return void 0;
			const value = Number(text);
			return Number.isFinite(value) ? value : void 0;
		}
		/** Validate one whole-number field inside an inclusive range. */
		function integerDraft(text, min, max) {
			if (text.trim() === "") return { invalid: false };
			const value = Number(text);
			if (!Number.isSafeInteger(value)) return {
				invalid: true,
				reason: "format"
			};
			if (value < min) return {
				invalid: true,
				reason: "tooSmall"
			};
			if (value > max) return {
				invalid: true,
				reason: "tooLarge"
			};
			return {
				invalid: false,
				value
			};
		}
		/** Validate one timeout draft written in seconds. */
		function timeoutDraft(text) {
			const value = numberText(text);
			if (value === void 0) return {
				invalid: true,
				reason: "format"
			};
			if (value < .001) return {
				invalid: true,
				reason: "tooSmall"
			};
			if (value > 3600) return {
				invalid: true,
				reason: "tooLarge"
			};
			return {
				invalid: false,
				valueMs: Math.round(value * 1e3)
			};
		}
		/** Draft text for a stored millisecond timeout. */
		function secondsText(ms) {
			return typeof ms === "number" && Number.isFinite(ms) ? String(ms / 1e3) : "";
		}
		/** Plain text of one stored field. */
		function storedText(value) {
			if (typeof value === "string") return value;
			if (typeof value === "number" && Number.isFinite(value)) return String(value);
			return "";
		}
		/** The settings document's own api-key reference, or the plugin default. */
		function referenceOf(value) {
			const ref = value?.apiKeyEnv;
			return typeof ref === "string" && ref.trim() !== "" ? ref : DEFAULT_API_KEY_ENV;
		}
		/** A pasted value's URL credentials never reach a copied diagnostic. */
		function redactUrl(value) {
			try {
				const url = new URL(value);
				url.username = "";
				url.password = "";
				return url.toString();
			} catch {
				return value;
			}
		}
		/** Secret-shaped tokens are redacted even if a reader pasted one into a field. */
		function redactSecrets(value) {
			return value.replace(/\b(?:sk-[A-Za-z0-9_-]{4,}|vela_(?:ctrl|rt)_[A-Za-z0-9_-]{4,})\b/gu, "<redacted>");
		}
		/** The Models-page card's three render postures. */
		function cardMode(state) {
			if (state.status !== "ready") return "unavailable";
			return state.writable ? "ready" : "readonly";
		}
		/** Context rows: every catalog model plus any override key the catalog omits. */
		function contextRows(models, overrides) {
			const ids = new Set(models.map((model) => model.id));
			for (const id of Object.keys(overrides)) ids.add(id);
			return [...ids].map((model) => {
				const raw = overrides[model];
				return {
					model,
					text: typeof raw === "number" && Number.isFinite(raw) ? String(raw) : "",
					invalid: false
				};
			});
		}
		/** Empty defaults so every consumer sees the same shape before the first read. */
		function initialPageState() {
			return {
				status: "loading",
				writable: false,
				apiKeyConfigured: false,
				apiKeyKnown: false,
				apiKeyWritable: false,
				apiKeyReference: DEFAULT_API_KEY_ENV,
				credentialSource: "unknown",
				loginStatus: "unknown",
				hasControlKey: false,
				controlKeyWarning: false,
				catalogSource: "unknown",
				catalogCached: false,
				models: [],
				visibleModels: [],
				contextOverrides: [],
				fields: emptyFields(),
				language: "zh",
				showSidebarQuota: false,
				showSidebarQuotaDraft: false,
				keyDraft: "",
				keyAction: "none",
				dirty: false,
				saving: false
			};
		}
		/**
		* One settings-page controller. Constructing it starts the first credential
		* and catalog reads; `dispose()` stops the scope subscription.
		*/
		var OpenDesignSettingsController = class {
			scope;
			store;
			unsubscribeScope;
			credentials;
			models;
			disposed = false;
			selected = /* @__PURE__ */ new Set();
			modelsChanged = false;
			overridesChanged = false;
			languageChanged = false;
			sidebarQuotaChanged = false;
			overrides = {};
			modelCatalog = [];
			snapshot;
			constructor(scope, credentials, models) {
				this.scope = scope;
				this.credentials = credentials;
				this.models = models;
				this.snapshot = scope.getSnapshot();
				this.store = createSnapshotStore({
					...initialPageState(),
					status: this.snapshot.status,
					writable: this.snapshot.writable
				});
				this.resetDrafts();
				this.unsubscribeScope = this.scope.subscribe(() => {
					this.deriveFromScope();
				});
				this.refreshCredentials();
				this.refreshModels();
			}
			/** The current render state. */
			state() {
				return this.store.getSnapshot();
			}
			/** Subscribe to render-state changes. */
			subscribe(listener) {
				return this.store.subscribe(listener);
			}
			/** Read the Host namespace again (mount after boot, external edits). */
			refresh() {
				this.snapshot = this.scope.getSnapshot();
				this.deriveFromScope();
				this.refreshCredentials();
				this.refreshModels();
			}
			/** Stage one text field. */
			edit(field, text) {
				if (this.disposed) return;
				const state = this.state();
				const draft = this.validateField(field, {
					...state.fields[field],
					text,
					changed: true
				});
				this.publish({
					...state,
					fields: {
						...state.fields,
						[field]: draft
					},
					dirty: true,
					notice: void 0
				});
			}
			/** Restore one field to the Host's saved value. */
			resetField(field) {
				if (this.disposed) return;
				const state = this.state();
				this.publish({
					...state,
					fields: {
						...state.fields,
						[field]: this.storedDraft(field)
					},
					dirty: this.computeDirty(),
					notice: void 0
				});
			}
			/** Flip one model's visibility. */
			toggleModel(id) {
				if (this.disposed) return;
				const state = this.state();
				const next = new Set(this.selected);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				this.selected = next;
				this.modelsChanged = true;
				this.publish(this.withModels(state));
			}
			/** Stage the global context-window value. */
			editContextWindow(text) {
				this.edit("contextWindow", text);
			}
			/** Stage one per-model context-window override; an empty value removes it. */
			editContextOverride(model, text) {
				if (this.disposed) return;
				this.overrides = {
					...this.overrides,
					[model]: text
				};
				this.overridesChanged = true;
				const state = this.state();
				this.publish(this.withModels(state));
			}
			/** Stage the host-side language (`zh` / `en`). */
			setLanguage(language) {
				if (this.disposed) return;
				if (language !== "zh" && language !== "en") return;
				this.languageChanged = true;
				this.publish({
					...this.state(),
					language,
					dirty: true,
					notice: void 0
				});
			}
			/** Stage the Display section's sidebar-quota switch (one batch with every other field). */
			setShowSidebarQuota(value) {
				if (this.disposed) return;
				this.sidebarQuotaChanged = true;
				this.publish({
					...this.state(),
					showSidebarQuotaDraft: value,
					dirty: true,
					notice: void 0
				});
			}
			/** Stage the key field (write-only; the value is never rendered back). */
			setKey(value) {
				if (this.disposed) return;
				this.publish({
					...this.state(),
					keyDraft: value,
					keyAction: "set",
					dirty: true,
					notice: void 0
				});
			}
			/** Stage a clear of this plugin's credential reference. */
			clearKey() {
				if (this.disposed) return;
				this.publish({
					...this.state(),
					keyDraft: "",
					keyAction: "clear",
					dirty: true,
					notice: void 0
				});
			}
			/** Drop every draft, including the key draft. */
			discard() {
				if (this.disposed) return;
				this.resetDrafts();
				this.publish({
					...this.state(),
					notice: {
						kind: "info",
						key: "noChanges"
					}
				});
			}
			/**
			* Validate, then commit one batch to the namespace and (only after it is
			* accepted) the key to this plugin's credential reference. A conflict keeps
			* the drafts; a failed credential keeps the key draft.
			*/
			async save() {
				const state = this.state();
				if (this.disposed || state.saving) return {
					config: "none",
					credential: "none"
				};
				if (state.status !== "ready" || !state.writable) {
					this.publish({
						...state,
						notice: {
							kind: "error",
							key: "failed"
						}
					});
					return {
						config: "none",
						credential: "none"
					};
				}
				const validated = this.validateAll(state);
				if (!validated.valid) {
					this.publish({
						...validated.state,
						notice: {
							kind: "error",
							key: "invalid"
						}
					});
					return {
						config: "none",
						credential: "none"
					};
				}
				const ops = this.buildOps(validated.state);
				const keyAction = state.keyAction;
				const keyDraft = state.keyDraft;
				const hasCredential = keyAction === "clear" || keyAction === "set" && keyDraft.trim() !== "";
				if (ops.length === 0 && !hasCredential) {
					this.publish({
						...validated.state,
						notice: {
							kind: "info",
							key: "noChanges"
						}
					});
					return {
						config: "none",
						credential: "none"
					};
				}
				this.publish({
					...validated.state,
					saving: true
				});
				let config = "none";
				let next = this.state();
				if (ops.length > 0) {
					const result = await this.scope.mutate(ops, this.snapshot.revision);
					if (result === "conflict") {
						this.publish({
							...this.state(),
							saving: false,
							notice: {
								kind: "error",
								key: "conflict"
							}
						});
						return {
							config: "conflict",
							credential: "none"
						};
					}
					if (result !== "accepted") {
						this.publish({
							...this.state(),
							saving: false,
							notice: {
								kind: "error",
								key: "failed"
							}
						});
						return {
							config: "failed",
							credential: "none"
						};
					}
					config = "confirmed";
					this.snapshot = this.scope.getSnapshot();
					this.resetDrafts();
					if (hasCredential) this.publish({
						...this.state(),
						keyDraft,
						keyAction,
						dirty: true
					});
					next = this.state();
				}
				let credential = "none";
				if (hasCredential) {
					const reference = referenceOf(this.snapshot.value);
					const api = this.credentials;
					if (api === void 0) {
						this.publish({
							...next,
							saving: false,
							notice: {
								kind: "error",
								key: "credentialFailed"
							}
						});
						return {
							config,
							credential: "failed"
						};
					}
					if (!(keyAction === "clear" ? await api.unset(reference) : await api.set(reference, keyDraft.trim())).ok) {
						this.publish({
							...this.state(),
							saving: false,
							notice: {
								kind: "error",
								key: "credentialFailed"
							}
						});
						return {
							config,
							credential: "failed"
						};
					}
					credential = "confirmed";
					next = {
						...this.state(),
						keyDraft: "",
						keyAction: "none",
						apiKeyConfigured: keyAction === "set",
						apiKeyKnown: true
					};
					this.resetDrafts();
				}
				this.publish({
					...this.derivedDrafts(),
					...next,
					saving: false,
					dirty: false,
					notice: {
						kind: "success",
						key: "saved"
					}
				});
				return {
					config,
					credential
				};
			}
			/** The copyable, redacted diagnostic; drafts and keys stay out. */
			diagnosticText() {
				const state = this.state();
				const base = redactUrl(redactSecrets(state.fields.apiBase.text || state.catalogApiBase || ""));
				return [
					"Open Design 诊断",
					`- 凭据引用：${state.apiKeyReference}`,
					`- API Key：${state.apiKeyConfigured ? "已设置" : state.apiKeyKnown ? "未设置" : "未知"}`,
					`- 凭据来源：${state.credentialSource}`,
					`- 网关地址：${base || "(默认)"}`,
					`- CLI 登录态：${state.loginStatus}`,
					`- controlKey：${state.hasControlKey ? "可用" : "不可用"}`,
					`- 模型目录：${state.catalogSource}${state.catalogReason === void 0 ? "" : `（回落：${state.catalogReason}）`}`,
					`- 可见模型：${state.visibleModels.length === 0 ? "全部" : state.visibleModels.join(", ")}`
				].join("\n");
			}
			/** Read credential presence for the document's reference. */
			async refreshCredentials() {
				if (this.disposed) return;
				const reference = referenceOf(this.snapshot.value);
				const api = this.credentials;
				if (api === void 0) {
					this.publish({
						...this.state(),
						apiKeyKnown: false,
						apiKeyWritable: false
					});
					return;
				}
				try {
					const response = await api.describe([reference]);
					if (this.disposed) return;
					if (referenceOf(this.snapshot.value) !== reference) {
						await this.refreshCredentials();
						return;
					}
					const info = response.ok ? response.value?.[reference] : void 0;
					if (!response.ok || info === void 0) {
						this.publish({
							...this.state(),
							apiKeyKnown: false
						});
						return;
					}
					this.publish({
						...this.state(),
						apiKeyReference: reference,
						apiKeyKnown: true,
						apiKeyWritable: info.writable,
						apiKeyConfigured: this.state().apiKeyConfigured || info.configured
					});
				} catch {
					if (!this.disposed) this.publish({
						...this.state(),
						apiKeyKnown: false
					});
				}
			}
			/** Read catalog provenance and the Host's credential-source facts. */
			async refreshModels() {
				if (this.disposed) return;
				const api = this.models;
				if (api === void 0) {
					this.publish({
						...this.state(),
						catalogSource: "unknown"
					});
					return;
				}
				try {
					const response = await api.models();
					if (this.disposed) return;
					if (!response.ok || response.value === void 0) {
						this.publish({
							...this.state(),
							catalogSource: "unknown"
						});
						return;
					}
					this.applyReport(response.value);
				} catch {
					if (!this.disposed) this.publish({
						...this.state(),
						catalogSource: "unknown"
					});
				}
			}
			/** Stop the scope subscription; no further publishes happen. */
			dispose() {
				this.disposed = true;
				this.unsubscribeScope();
			}
			applyReport(report) {
				const state = this.state();
				const credential = report.credential;
				const catalog = report.catalog;
				const next = {
					...state,
					catalogSource: catalog.source,
					catalogCached: catalog.cached,
					...catalog.apiBase === "" ? {} : { catalogApiBase: catalog.apiBase },
					...catalog.reason === void 0 ? {} : { catalogReason: catalog.reason },
					credentialSource: credential.source,
					loginStatus: credential.login.status,
					hasControlKey: credential.login.hasControlKey,
					controlKeyWarning: credential.login.status === "ok" && !credential.login.hasControlKey,
					apiKeyConfigured: credential.configured,
					apiKeyKnown: state.apiKeyKnown || credential.configured
				};
				this.modelCatalog = catalog.models;
				this.publish({ ...this.withModels(next) });
			}
			/** Rebuild the model rows, visible selection and override rows from the report. */
			withModels(state, models = this.modelCatalog) {
				const rows = models;
				const allowlist = Array.isArray(this.snapshot.value?.visibleModels) ? this.snapshot.value.visibleModels.filter((id) => typeof id === "string") : [];
				if (!this.modelsChanged && this.selected.size === 0) this.selected = new Set(allowlist.length === 0 ? rows.map((row) => row.id) : allowlist);
				const visible = new Set(this.selected);
				const rowsById = new Map(rows.map((row) => [row.id, row]));
				const visibleModels = [...visible].filter((id) => rows.length === 0 || rowsById.has(id));
				const overrideRows = this.contextRowsFor(rows);
				return {
					...state,
					models: rows.map((row) => ({
						id: row.id,
						name: row.name,
						contextWindow: row.contextWindow,
						maxTokens: row.maxTokens,
						cost: row.cost,
						capability: row.capability,
						calibrated: row.calibrated,
						visible: visible.has(row.id)
					})),
					visibleModels,
					contextOverrides: overrideRows
				};
			}
			contextRowsFor(models) {
				const stored = this.snapshot.value?.contextWindowOverrides;
				const rows = contextRows(models, { ...stored !== null && typeof stored === "object" && !Array.isArray(stored) ? stored : {} });
				for (const row of rows) if (Object.hasOwn(this.overrides, row.model)) row.text = this.overrides[row.model];
				for (const [model, text] of Object.entries(this.overrides)) if (!rows.some((row) => row.model === model)) rows.push({
					model,
					text,
					invalid: false
				});
				return rows.map((row) => {
					const checked = this.validateContextOverride(row.text);
					return {
						...row,
						invalid: checked.invalid,
						...checked.reason === void 0 ? {} : { reason: checked.reason }
					};
				});
			}
			/** The initial draft table from the scope document. */
			resetDrafts() {
				const value = this.snapshot.value ?? {};
				this.overrides = Object.fromEntries(Object.entries(value.contextWindowOverrides !== null && typeof value.contextWindowOverrides === "object" && !Array.isArray(value.contextWindowOverrides) ? value.contextWindowOverrides : {}).filter(([, override]) => typeof override === "number" && Number.isFinite(override)).map(([id, override]) => [id, String(override)]));
				this.selected = new Set(Array.isArray(value.visibleModels) ? value.visibleModels.filter((id) => typeof id === "string") : []);
				this.modelsChanged = false;
				this.overridesChanged = false;
				this.languageChanged = false;
				this.sidebarQuotaChanged = false;
				this.publish({
					...this.derivedDrafts(),
					keyDraft: "",
					keyAction: "none",
					dirty: false
				});
			}
			/** The field table and model rows rebuilt from the Host document. */
			derivedDrafts() {
				const value = this.snapshot.value ?? {};
				const fields = emptyFields();
				fields.apiBase.text = storedText(value.apiBase);
				fields.modelsCachePath.text = storedText(value.modelsCachePath);
				fields.requestTimeoutMs.text = secondsText(value.requestTimeoutMs);
				fields.streamIdleTimeoutMs.text = secondsText(value.streamIdleTimeoutMs);
				fields.transportMaxRetries.text = storedText(value.transportMaxRetries);
				fields.contextWindow.text = storedText(value.contextWindow);
				fields.maxOutputTokens.text = storedText(value.maxOutputTokens);
				const page = this.state();
				return this.withModels({
					...page,
					status: this.snapshot.status === "ready" ? "ready" : this.snapshot.status === "unavailable" ? "unavailable" : "loading",
					writable: this.snapshot.writable,
					language: typeof value.lang === "string" ? value.lang : "zh",
					showSidebarQuota: value.showSidebarQuota === true,
					showSidebarQuotaDraft: this.sidebarQuotaChanged ? page.showSidebarQuotaDraft : value.showSidebarQuota === true,
					apiKeyReference: referenceOf(value),
					fields: Object.fromEntries(Object.entries(fields).map(([field, draft]) => [field, this.validateField(field, draft)]))
				});
			}
			deriveFromScope() {
				if (this.disposed) return;
				this.snapshot = this.scope.getSnapshot();
				const ready = this.snapshot.status === "ready";
				const next = {
					...this.state(),
					status: this.snapshot.status,
					writable: this.snapshot.writable,
					apiKeyReference: referenceOf(this.snapshot.value)
				};
				if (!ready) {
					this.publish({
						...next,
						status: "unavailable"
					});
					return;
				}
				if (this.savingOrDirty()) {
					this.publish({
						...next,
						status: "ready"
					});
					return;
				}
				this.resetDrafts();
			}
			savingOrDirty() {
				const state = this.state();
				return state.saving || state.dirty;
			}
			computeDirty() {
				return this.state().dirty;
			}
			storedDraft(field) {
				const value = this.snapshot.value ?? {};
				return {
					...this.validateField(field, {
						...EMPTY_FIELD(),
						text: this.storedTextFor(field, value)
					}),
					changed: false
				};
			}
			storedTextFor(field, value) {
				switch (field) {
					case "requestTimeoutMs": return secondsText(value.requestTimeoutMs);
					case "streamIdleTimeoutMs": return secondsText(value.streamIdleTimeoutMs);
					default: return storedText(value[field]);
				}
			}
			validateField(field, draft) {
				switch (field) {
					case "apiBase":
						if (draft.text.trim() === "") return {
							...draft,
							invalid: false
						};
						try {
							const url = new URL(draft.text);
							if (url.protocol !== "http:" && url.protocol !== "https:" || url.hostname === "") return {
								...draft,
								invalid: true,
								reason: "format"
							};
							return {
								...draft,
								invalid: false
							};
						} catch {
							return {
								...draft,
								invalid: true,
								reason: "format"
							};
						}
					case "modelsCachePath": return {
						...draft,
						invalid: false
					};
					case "requestTimeoutMs":
					case "streamIdleTimeoutMs": {
						if (draft.text.trim() === "") return {
							...draft,
							invalid: false
						};
						const checked = timeoutDraft(draft.text);
						return {
							...draft,
							invalid: checked.invalid,
							...checked.reason === void 0 ? {} : { reason: checked.reason }
						};
					}
					case "transportMaxRetries": {
						const checked = integerDraft(draft.text, 0, MAX_TRANSPORT_RETRIES);
						return {
							...draft,
							invalid: checked.invalid,
							...checked.reason === void 0 ? {} : { reason: checked.reason }
						};
					}
					case "contextWindow": {
						if (draft.text.trim() === "") return {
							...draft,
							invalid: false
						};
						const checked = integerDraft(draft.text, 1, CONTEXT_WINDOW_MAX);
						return {
							...draft,
							invalid: checked.invalid,
							...checked.reason === void 0 ? {} : { reason: checked.reason }
						};
					}
					case "maxOutputTokens": {
						if (draft.text.trim() === "") return {
							...draft,
							invalid: false
						};
						const checked = integerDraft(draft.text, 0, MAX_OUTPUT_TOKEN_LIMIT);
						return {
							...draft,
							invalid: checked.invalid,
							...checked.reason === void 0 ? {} : { reason: checked.reason }
						};
					}
				}
			}
			validateContextOverride(text) {
				if (text.trim() === "") return { invalid: false };
				const checked = integerDraft(text, 1, CONTEXT_WINDOW_MAX);
				return {
					invalid: checked.invalid,
					...checked.reason === void 0 ? {} : { reason: checked.reason }
				};
			}
			validateAll(state) {
				const fields = { ...state.fields };
				let valid = !state.saving;
				for (const field of Object.keys(fields)) {
					const checked = this.validateField(field, fields[field]);
					fields[field] = checked;
					if (checked.invalid) valid = false;
				}
				const contextOverrides = state.contextOverrides.map((row) => {
					const checked = this.validateContextOverride(row.text);
					if (checked.invalid) valid = false;
					return {
						...row,
						invalid: checked.invalid,
						...checked.reason === void 0 ? {} : { reason: checked.reason }
					};
				});
				return {
					valid,
					state: {
						...state,
						fields,
						contextOverrides
					}
				};
			}
			/** Only changed fields become ops; empty means "inherit the layer below". */
			buildOps(state) {
				const ops = [];
				for (const field of Object.keys(state.fields)) {
					const draft = state.fields[field];
					if (!draft.changed) continue;
					const value = this.opValue(field, draft.text);
					ops.push(value === void 0 ? {
						op: "unset",
						path: [field]
					} : {
						op: "set",
						path: [field],
						value
					});
				}
				if (this.modelsChanged) ops.push({
					op: "set",
					path: ["visibleModels"],
					value: [...state.visibleModels]
				});
				if (this.languageChanged) ops.push({
					op: "set",
					path: ["lang"],
					value: state.language
				});
				if (this.sidebarQuotaChanged) ops.push({
					op: "set",
					path: ["showSidebarQuota"],
					value: state.showSidebarQuotaDraft
				});
				if (this.overridesChanged) {
					const overrides = {};
					for (const row of state.contextOverrides) {
						if (row.text.trim() === "") continue;
						const value = Number(row.text);
						if (isValidContextWindow(value)) overrides[row.model] = value;
					}
					ops.push(Object.keys(overrides).length === 0 ? {
						op: "unset",
						path: ["contextWindowOverrides"]
					} : {
						op: "set",
						path: ["contextWindowOverrides"],
						value: overrides
					});
				}
				return ops;
			}
			opValue(field, text) {
				switch (field) {
					case "apiBase":
					case "modelsCachePath": return text.trim() === "" ? void 0 : text.trim();
					case "requestTimeoutMs":
					case "streamIdleTimeoutMs": return timeoutDraft(text).valueMs;
					case "transportMaxRetries":
					case "contextWindow":
					case "maxOutputTokens": {
						if (text.trim() === "") return void 0;
						const value = Number(text);
						return Number.isFinite(value) ? value : void 0;
					}
				}
			}
			publish(state) {
				if (this.disposed) return;
				this.store.set({
					...state,
					dirty: state.dirty || this.stateDirty(state)
				});
			}
			/** Any staged change counts as dirty, not just text fields. */
			stateDirty(state) {
				if (state.keyAction !== "none") return true;
				if (state.keyDraft !== "") return true;
				if (this.modelsChanged || this.overridesChanged || this.languageChanged || this.sidebarQuotaChanged) return true;
				return Object.values(state.fields).some((draft) => draft.changed);
			}
		};
		//#endregion
		//#region src/client/locales.ts
		/** The notice keys map onto dictionary keys one-for-one. */
		const NOTICES = {
			saved: "saved",
			conflict: "conflict",
			failed: "failed",
			invalid: "invalid",
			noChanges: "noChanges",
			credentialFailed: "credentialFailed"
		};
		/** Translate one controller notice key. */
		function noticeText(t, key) {
			return t(NOTICES[key]);
		}
		/** Chinese copy; the source of truth for the key set. */
		const zh$1 = {
			nav: "Open Design",
			title: "Open Design",
			intro: "通过 Open Design 的额度调用模型。密钥只保存为凭据引用，页面不会显示明文。",
			readOnly: "当前配置不可写。请确认宿主设置服务可用，或用 composition 配置后重启。",
			connection: "连接",
			connectionDesc: "填入 API Key，或直接复用桌面端 / CLI 的登录态。显式 Key 优先于登录态。",
			apiKey: "API Key",
			apiKeyHint: "保存后只显示「已设置 / 未设置」；值写入凭据引用，不进入设置文档。",
			apiKeySet: "已设置",
			apiKeyUnset: "未设置",
			apiKeyUnknown: "状态未知",
			apiKeyLocked: "凭据服务当前不可写",
			apiKeyPlaceholder: "粘贴 Open Design API Key",
			clearKey: "清除 Key",
			apiBase: "网关地址",
			apiBaseHint: "留空使用默认网关；密钥来自 CLI 登录态时使用其下发的地址。",
			loginStatus: "CLI 登录态",
			loginOk: "可读",
			loginMissing: "未找到 ~/.amr/config.json",
			loginMalformed: "文件格式不可用",
			loginUnreadable: "文件不可读",
			loginUnknown: "未知",
			loginHint: "在终端执行 `vela login` 后，本插件无需再配置 Key 即可复用登录态。",
			loginUse: "未显式配置 Key 时自动使用登录态，不会写入该文件。",
			controlKeyWarn: "有登录态但没有控制密钥：推理不受影响，额度功能（P1）暂不可用。",
			modelsSection: "模型与上下文",
			modelsSectionDesc: "选择选择器里可见的模型，并覆盖上下文窗口与单次输出上限。",
			visibleModels: "可见模型",
			visibleModelsHint: "只影响模型选择器；取消全部会回到「全部可见」。",
			uncalibrated: "未校准",
			contextWindow: "上下文窗口",
			contextWindowHint: "全局覆盖值，留空则使用目录公布值。",
			contextOverrides: "按模型覆盖",
			contextOverridesHint: "只填需要覆盖的模型；留空表示跟随全局值。",
			maxOutputTokens: "输出上限",
			maxOutputTokensHint: "留空跟随默认；0 表示不发送输出上限字段。",
			displaySection: "显示",
			displaySectionDesc: "界面语言与额度卡显示。",
			language: "语言",
			sidebarQuota: "侧栏额度卡",
			sidebarQuotaHint: "默认关闭；开启后显示套餐档位与 7 天窗口进度（Go 档另有 5 小时窗口），点击进入额度面板。",
			advanced: "高级",
			advancedDesc: "网络超时、传输重试、目录缓存与诊断。",
			requestTimeout: "请求超时（秒）",
			requestTimeoutHint: "等待响应首字节的时间，默认 300 秒。",
			streamIdleTimeout: "流空闲超时（秒）",
			streamIdleTimeoutHint: "流建立后允许的最长静默时间，默认 300 秒。",
			transportMaxRetries: "传输重试次数",
			transportMaxRetriesHint: "一次请求最多吸收的传输失败次数，默认 5。",
			modelsCachePath: "目录缓存路径",
			modelsCachePathHint: "留空使用 ~/.opendesign/models-cache.json。",
			diagnostics: "诊断",
			diagnosticsHint: "复制当前有效配置与来源；密钥永远脱敏。",
			copyDiagnostics: "复制诊断",
			copied: "已复制",
			catalogSource: "目录来源",
			catalogLive: "网关实时",
			catalogStatic: "内置快照",
			catalogUnknown: "未知",
			catalogCached: "来自磁盘缓存",
			catalogReason: "回落原因",
			save: "保存",
			saving: "保存中…",
			discard: "放弃更改",
			saved: "已保存",
			conflict: "配置已被其他窗口修改，草稿已保留。",
			failed: "保存失败，请重试。",
			invalid: "有字段填写不合法，请检查后再保存。",
			noChanges: "没有需要保存的更改。",
			credentialFailed: "配置已确认，但密钥写入失败；草稿已保留。",
			invalidFormat: "格式不正确",
			invalidTooSmall: "小于允许的最小值",
			invalidTooLarge: "超过允许的最大值",
			cardTitle: "Open Design",
			cardKeyMissing: "未设置 API Key",
			cardPaste: "粘贴 Key 后保存",
			cardSave: "保存 Key",
			cardCatalog: "目录",
			cardUncalibrated: "未校准"
		};
		/** English copy with the exact same key set. */
		const en$1 = {
			nav: "Open Design",
			title: "Open Design",
			intro: "Use Open Design credits for model calls. The key is stored only as a credential reference; this page never shows it.",
			readOnly: "This configuration is read-only. Check that the Host settings service is available, or configure it in the composition and restart.",
			connection: "Connection",
			connectionDesc: "Paste an API key, or reuse the desktop / CLI login state. An explicit key wins over the login state.",
			apiKey: "API key",
			apiKeyHint: "After saving, only \"set / not set\" is shown; the value goes to a credential reference, never the settings document.",
			apiKeySet: "Set",
			apiKeyUnset: "Not set",
			apiKeyUnknown: "Unknown",
			apiKeyLocked: "The credential service is not writable",
			apiKeyPlaceholder: "Paste an Open Design API key",
			clearKey: "Clear key",
			apiBase: "Gateway URL",
			apiBaseHint: "Leave blank for the default gateway; a CLI-login key uses its server-issued URL.",
			loginStatus: "CLI login state",
			loginOk: "Readable",
			loginMissing: "~/.amr/config.json not found",
			loginMalformed: "Unreadable format",
			loginUnreadable: "File cannot be read",
			loginUnknown: "Unknown",
			loginHint: "Run `vela login` in a terminal and this plugin reuses the login state without any key configuration.",
			loginUse: "Used automatically when no explicit key is configured; this file is never written.",
			controlKeyWarn: "A login state exists but has no control key: inference is unaffected, quota features (P1) are unavailable.",
			modelsSection: "Models & context",
			modelsSectionDesc: "Choose which models the picker lists, and override context windows and the per-turn output cap.",
			visibleModels: "Visible models",
			visibleModelsHint: "Affects the model picker only; clearing every box returns to \"all visible\".",
			uncalibrated: "Uncalibrated",
			contextWindow: "Context window",
			contextWindowHint: "Global override; leave blank to follow the catalog figure.",
			contextOverrides: "Per-model overrides",
			contextOverridesHint: "Fill only the models you need; blank follows the global value.",
			maxOutputTokens: "Output cap",
			maxOutputTokensHint: "Leave blank for the default; 0 omits the output-cap field.",
			displaySection: "Display",
			displaySectionDesc: "Interface language and the quota card.",
			language: "Language",
			sidebarQuota: "Sidebar quota card",
			sidebarQuotaHint: "Off by default. When on, shows the plan tier and the 7-day window (Go also shows the 5-hour window); click through for the quota panel.",
			advanced: "Advanced",
			advancedDesc: "Network timeouts, transport retries, catalog cache and diagnostics.",
			requestTimeout: "Request timeout (seconds)",
			requestTimeoutHint: "Time to the response first byte; 300 seconds by default.",
			streamIdleTimeout: "Stream idle timeout (seconds)",
			streamIdleTimeoutHint: "Longest allowed silence after the stream opens; 300 seconds by default.",
			transportMaxRetries: "Transport retries",
			transportMaxRetriesHint: "Transport failures one request absorbs; 5 by default.",
			modelsCachePath: "Catalog cache path",
			modelsCachePathHint: "Leave blank for ~/.opendesign/models-cache.json.",
			diagnostics: "Diagnostics",
			diagnosticsHint: "Copy the effective configuration and provenance; keys are always redacted.",
			copyDiagnostics: "Copy diagnostics",
			copied: "Copied",
			catalogSource: "Catalog source",
			catalogLive: "Live gateway",
			catalogStatic: "Built-in snapshot",
			catalogUnknown: "Unknown",
			catalogCached: "Read from disk cache",
			catalogReason: "Fallback reason",
			save: "Save",
			saving: "Saving…",
			discard: "Discard changes",
			saved: "Saved",
			conflict: "The configuration changed in another window; your draft was kept.",
			failed: "Save failed. Try again.",
			invalid: "Some fields are invalid; fix them before saving.",
			noChanges: "Nothing to save.",
			credentialFailed: "The configuration was confirmed, but the key could not be written; the draft was kept.",
			invalidFormat: "Invalid format",
			invalidTooSmall: "Below the minimum",
			invalidTooLarge: "Above the maximum",
			cardTitle: "Open Design",
			cardKeyMissing: "No API key set",
			cardPaste: "Paste a key, then save",
			cardSave: "Save key",
			cardCatalog: "Catalog",
			cardUncalibrated: "Uncalibrated"
		};
		//#endregion
		//#region src/client/section.tsx
		/**
		* The Open Design settings page (`settings.section`, id `opendesign`).
		*
		* Four groups in the order the design fixes: Connection, Models & context,
		* Display, Advanced. The page is a projection of the shared controller — the
		* same one the Models-page card uses — so the two surfaces cannot disagree
		* about key presence or catalog provenance. Copy comes only from the
		* `settings.opendesign` locale namespace.
		*
		* @module dsh-opendesign-provider/client/section
		*/
		/** Translate one validation reason, or undefined when the draft is valid. */
		function fieldError(t, draft) {
			if (!draft.invalid) return void 0;
			if (draft.reason === "tooSmall") return t("invalidTooSmall");
			if (draft.reason === "tooLarge") return t("invalidTooLarge");
			return t("invalidFormat");
		}
		/** One labelled text row with an optional hint and validation message. */
		function FieldRow(props) {
			const error = fieldError(props.t, props.draft);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "od-field",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "od-fieldHead",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "od-label",
							children: props.label
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: error === void 0 ? "od-input" : "od-input od-inputInvalid",
						type: props.type ?? "text",
						value: props.draft.text,
						placeholder: props.placeholder,
						disabled: props.disabled,
						onChange: (event) => props.onChange(event.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "od-hint",
						children: props.hint
					}),
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "od-rowError",
						children: error
					})
				]
			});
		}
		/** One catalog model checkbox with its uncalibrated mark. */
		function ModelRow(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "od-checkRow",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "od-check",
						type: "checkbox",
						checked: props.model.visible,
						disabled: props.disabled,
						onChange: props.onToggle
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "od-checkName",
						children: props.model.name
					}),
					props.model.calibrated ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "od-badgeWarn",
						children: props.t("uncalibrated")
					})
				]
			});
		}
		/** One per-model context-window override row. */
		function ContextRow(props) {
			const error = fieldError(props.t, props.row);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "od-contextItem",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "od-label",
						children: props.modelName
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: error === void 0 ? "od-input od-contextValue" : "od-input od-contextValue od-inputInvalid",
						type: "text",
						inputMode: "numeric",
						value: props.row.text,
						disabled: props.disabled,
						onChange: (event) => props.onChange(event.target.value)
					}),
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "od-rowError od-contextError",
						children: error
					})
				]
			});
		}
		/** The settings page. */
		function OpenDesignSettingsPage(props) {
			const { t } = props;
			const state = (0, react.useSyncExternalStore)(props.settingsStore.subscribe, props.settingsStore.getSnapshot, props.settingsStore.getSnapshot);
			const disabled = !state.writable || state.saving;
			const catalogLabel = state.catalogSource === "live" ? t("catalogLive") : state.catalogSource === "static" ? t("catalogStatic") : t("catalogUnknown");
			const loginLabel = state.loginStatus === "ok" ? t("loginOk") : state.loginStatus === "missing" ? t("loginMissing") : state.loginStatus === "malformed" ? t("loginMalformed") : state.loginStatus === "unreadable" ? t("loginUnreadable") : t("loginUnknown");
			const copyDiagnostics = () => {
				const text = props.diagnosticText();
				navigator.clipboard?.writeText(text);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "od-section",
				"aria-label": t("title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: "od-title",
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "od-intro",
						children: t("intro")
					}),
					state.writable ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "od-readOnly",
						children: t("readOnly")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "od-group",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "od-groupHead",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "od-groupTitle",
									children: t("connection")
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "od-groupDesc",
								children: t("connectionDesc")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "od-rows",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "od-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "od-rowText",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "od-rowTitleLine",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "od-rowTitle",
													children: t("apiKey")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: state.apiKeyConfigured ? "od-badge" : "od-badgeMuted",
													children: state.apiKeyConfigured ? t("apiKeySet") : state.apiKeyKnown ? t("apiKeyUnset") : t("apiKeyUnknown")
												})]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "od-rowDesc",
												children: t("apiKeyHint")
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "od-rowControl",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "od-input od-rowInputWide",
												type: "password",
												autoComplete: "off",
												value: state.keyDraft,
												placeholder: t("apiKeyPlaceholder"),
												disabled: disabled || !state.apiKeyWritable,
												onChange: (event) => props.setKey(event.target.value)
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "od-linkButton",
												type: "button",
												disabled,
												onClick: () => props.clearKey(),
												children: t("clearKey")
											})]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
										t,
										label: t("apiBase"),
										hint: t("apiBaseHint"),
										draft: state.fields.apiBase,
										disabled,
										placeholder: "https://amr-link.open-design.ai/v1",
										onChange: (text) => props.edit("apiBase", text)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "od-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "od-rowText",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "od-rowTitle",
													children: t("loginStatus")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "od-rowDesc",
													children: t("loginHint")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "od-rowDesc",
													children: t("loginUse")
												})
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "od-rowControl",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: state.loginStatus === "ok" ? "od-badge" : "od-badgeMuted",
												children: loginLabel
											})
										})]
									}),
									state.controlKeyWarning ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "od-rowError",
										children: t("controlKeyWarn")
									}) : null
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "od-group od-groupDivided",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "od-groupHead",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "od-groupTitle",
									children: t("modelsSection")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "od-badgeMuted",
									children: catalogLabel
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "od-groupDesc",
								children: t("modelsSectionDesc")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "od-rows",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "od-field",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "od-fieldHead",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "od-label",
													children: t("visibleModels")
												})
											}),
											state.models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "od-hint",
												children: t("modelsSectionDesc")
											}) : state.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelRow, {
												t,
												model,
												disabled,
												onToggle: () => props.toggleModel(model.id)
											}, model.id)),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "od-hint",
												children: t("visibleModelsHint")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
										t,
										label: t("contextWindow"),
										hint: t("contextWindowHint"),
										draft: state.fields.contextWindow,
										disabled,
										onChange: (text) => props.editContextWindow(text)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "od-field",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "od-fieldHead",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "od-label",
													children: t("contextOverrides")
												})
											}),
											state.contextOverrides.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContextRow, {
												t,
												row,
												modelName: state.models.find((model) => model.id === row.model)?.name ?? row.model,
												disabled,
												onChange: (text) => props.editContextOverride(row.model, text)
											}, row.model)),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "od-hint",
												children: t("contextOverridesHint")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
										t,
										label: t("maxOutputTokens"),
										hint: t("maxOutputTokensHint"),
										draft: state.fields.maxOutputTokens,
										disabled,
										onChange: (text) => props.edit("maxOutputTokens", text)
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "od-group od-groupDivided",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "od-groupHead",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "od-groupTitle",
									children: t("displaySection")
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "od-groupDesc",
								children: t("displaySectionDesc")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "od-rows",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "od-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "od-rowText",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "od-rowTitle",
												children: t("language")
											})
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "od-rowControl",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												className: "od-input",
												value: state.language,
												disabled,
												onChange: (event) => props.setLanguage(event.target.value),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "zh",
													children: "中文"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "en",
													children: "English"
												})]
											})
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "od-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "od-rowText",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "od-rowTitle",
												children: t("sidebarQuota")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "od-rowDesc",
												children: t("sidebarQuotaHint")
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "od-rowControl",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "od-check",
												type: "checkbox",
												checked: state.showSidebarQuotaDraft,
												disabled,
												onChange: (event) => props.setShowSidebarQuota(event.target.checked)
											})
										})]
									}),
									state.showSidebarQuotaDraft && state.controlKeyWarning ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "od-rowError",
										children: t("controlKeyWarn")
									}) : null
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "od-group od-groupDivided",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "od-groupHead",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "od-groupTitle",
									children: t("advanced")
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "od-groupDesc",
								children: t("advancedDesc")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "od-rows",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
										t,
										label: t("requestTimeout"),
										hint: t("requestTimeoutHint"),
										draft: state.fields.requestTimeoutMs,
										disabled,
										onChange: (text) => props.edit("requestTimeoutMs", text)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
										t,
										label: t("streamIdleTimeout"),
										hint: t("streamIdleTimeoutHint"),
										draft: state.fields.streamIdleTimeoutMs,
										disabled,
										onChange: (text) => props.edit("streamIdleTimeoutMs", text)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
										t,
										label: t("transportMaxRetries"),
										hint: t("transportMaxRetriesHint"),
										draft: state.fields.transportMaxRetries,
										disabled,
										onChange: (text) => props.edit("transportMaxRetries", text)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
										t,
										label: t("modelsCachePath"),
										hint: t("modelsCachePathHint"),
										draft: state.fields.modelsCachePath,
										disabled,
										onChange: (text) => props.edit("modelsCachePath", text)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "od-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "od-rowText",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "od-rowTitle",
												children: t("diagnostics")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "od-rowDesc",
												children: t("diagnosticsHint")
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "od-rowControl",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "od-linkButton",
												type: "button",
												onClick: copyDiagnostics,
												children: t("copyDiagnostics")
											})
										})]
									})
								]
							})
						]
					}),
					state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "od-saveBarDock",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "od-saveBar od-saveBarShown",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "od-saveBarText",
								children: state.notice === void 0 ? t("intro") : noticeText(t, state.notice.key)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "od-saveBarActions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "od-saveBarButton od-saveBarGhost",
									type: "button",
									disabled: state.saving,
									onClick: () => props.discard(),
									children: t("discard")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "od-saveBarButton od-saveBarPrimary",
									type: "button",
									disabled,
									onClick: () => props.save(),
									children: state.saving ? t("saving") : t("save")
								})]
							})]
						})
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/card.tsx
		/**
		* The Open Design panel inside the Models page
		* (`settings.models.provider-card`, key `llm-opensign` — the directory row's
		* settings namespace `llm-opendesign`).
		*
		* The card is deliberately compact: key status, one paste field, the catalog's
		* provenance and the uncalibrated mark. Both the status and the catalog facts
		* come from the shared settings controller, so this surface never invents a
		* second answer for what the settings page already knows.
		*
		* @module dsh-opendesign-provider/client/card
		*/
		/** One compact status pill. */
		function Badge({ ok, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ok ? "od-badge" : "od-badgeMuted",
				children
			});
		}
		/** The Models-page provider card. */
		function OpenDesignProviderCard(props) {
			const { t } = props;
			const state = (0, react.useSyncExternalStore)(props.settingsStore.subscribe, props.settingsStore.getSnapshot, props.settingsStore.getSnapshot);
			const [paste, setPaste] = (0, react.useState)("");
			const mode = cardMode(state);
			const disabled = mode !== "ready" || state.saving;
			const keySet = state.apiKeyConfigured;
			const catalogLabel = state.catalogSource === "live" ? t("catalogLive") : state.catalogSource === "static" ? t("catalogStatic") : t("catalogUnknown");
			const uncalibrated = state.models.filter((model) => !model.calibrated).length;
			const save = () => {
				if (paste.trim() === "") return;
				props.setKey(paste.trim());
				props.save();
				setPaste("");
			};
			if (mode === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "od-providerCard",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "od-hint",
					children: t("apiKeyUnknown")
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "od-providerCard",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "od-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "od-rowText",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "od-rowTitleLine",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "od-rowTitle",
									children: t("cardTitle")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
									ok: keySet,
									children: keySet ? t("apiKeySet") : state.apiKeyKnown ? t("apiKeyUnset") : t("apiKeyUnknown")
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "od-rowDesc",
								children: t("apiKeyHint")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "od-rowControl",
							children: keySet ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "od-linkButton",
								type: "button",
								disabled,
								onClick: () => {
									props.clearKey();
									props.save();
								},
								children: t("clearKey")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "od-input od-rowInput",
								type: "password",
								autoComplete: "off",
								value: paste,
								placeholder: t("apiKeyPlaceholder"),
								disabled: disabled || !state.apiKeyWritable,
								onChange: (event) => setPaste(event.target.value)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "od-linkButton",
								type: "button",
								disabled: disabled || paste.trim() === "",
								onClick: save,
								children: t("cardSave")
							})] })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "od-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "od-rowText",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "od-rowTitleLine",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "od-rowTitle",
										children: t("cardCatalog")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "od-badgeMuted",
										children: catalogLabel
									}),
									state.catalogCached ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "od-badgeMuted",
										children: t("catalogCached")
									}) : null
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "od-rowDesc",
								children: [state.catalogApiBase ?? "", state.catalogReason === void 0 ? "" : ` · ${t("catalogReason")}: ${state.catalogReason}`]
							})]
						}), uncalibrated > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "od-rowControl",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "od-badgeWarn",
								children: [
									t("cardUncalibrated"),
									" ",
									uncalibrated
								]
							})
						}) : null]
					}),
					state.controlKeyWarning ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "od-hint",
						children: t("controlKeyWarn")
					}) : null,
					state.notice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: state.notice.kind === "error" ? "od-rowError" : "od-hint",
						children: noticeText(t, state.notice.key)
					})
				]
			});
		}
		//#endregion
		//#region src/client/page-styles.ts
		/**
		* Stylesheet for the Open Design settings page — and the Models-page provider
		* card, which shares its `od-` classes.
		*
		* Returned as a string, not injected here, so importing this module has no DOM
		* side effect: `./index.ts` installs it once under {@link PAGE_CSS_ID}. It is a
		* module of its own rather than a literal in the entry so `tests/styles.test.ts`
		* can audit every rule without importing the React tree (which pulls
		* `*.module.css` through the primitives package and needs a loader registered
		* first). The rules are GLOBAL CSS, so containment is a contract (issue #48):
		* every selector is qualified by one of our own `od-` classes. Colours are
		* harness theme aliases with neutral fallbacks, and the `od-` prefix keeps
		* these clear of the panel's `odp-` set.
		*
		* @module dsh-opendesign-provider/client/page-styles
		*/
		/**
		* Stylesheet id — the `data-plugin-css` value that makes injection idempotent.
		*
		* The prefix must match this package's real name and the panel stylesheet's
		* (`PANEL_CSS_ID`); the two ids must also stay DISTINCT, since they key two
		* separate style tags and a shared id would make the second injection a no-op.
		*/
		const PAGE_CSS_ID = "@mars-sea/dsh-opendesign-provider/OpenDesignSettingsPage.module.css";
		/**
		* The settings-page stylesheet.
		*
		* The metrics are the harness's own settings pages', read out of the 0.1.7
		* bundles so the page sits beside General and Models without looking foreign:
		* a row is 12px of padding, its title 14/22 label-primary and its description
		* 12/18 label-tertiary, the control on the right. The hairline rhythm is
		* section-level: a 0.5px border-l2 rule separates the GROUPS (see
		* `od-groupDivided`), never the rows inside one, so a group's rows read as one
		* list. Selectors and buttons are
		* capsules (36px / 28px compact), inputs are
		* 32px with an 8px radius and a 0.5px border-l4 edge, a card is a 0.5px
		* border-l4 outline with a 16px radius, and a nested panel is a
		* bg-module-platform fill with a 12px radius. Errors use state-error-primary.
		*/
		const PAGE_CSS = `
.od-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex}
.od-title{margin:0;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px}
.od-intro{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}
.od-readOnly{margin:8px 0 0;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-tertiary));font-size:12px;line-height:18px}
.od-spacer{flex:1}
.od-group{flex-direction:column;display:flex;margin-top:28px}
.od-groupDivided{margin-top:24px;padding-top:20px;border-top:.5px solid var(--dsw-alias-border-l2)}
.od-groupHead{align-items:center;gap:8px;display:flex;min-height:28px;padding-bottom:4px}
.od-groupTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.od-groupDesc{margin:0 0 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-rows>.od-groupDesc{margin:0;padding:4px 0 0}
.od-disclosure{width:100%;padding:0 0 4px;border:0;background:0 0;font:inherit;text-align:left;cursor:pointer;border-radius:6px}
.od-disclosure:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.od-rows{flex-direction:column;display:flex}
.od-row{align-items:center;gap:8px;display:flex;padding:12px 0}
.od-rowFlush{padding:0}
.od-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:32px;display:flex}
.od-rowTitleLine{align-items:center;gap:8px;display:flex;min-width:0}
.od-rowTitle{min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.od-rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-rowDesc p{margin:0}
.od-rowDesc p+p{margin-top:4px}
.od-rowError{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.od-rowControl{flex:none;align-items:center;justify-content:flex-end;gap:8px;display:inline-flex;max-width:60%}
.od-rowInput{width:200px}
.od-rowInputWide{width:280px}
.od-linkButton{box-sizing:border-box;flex:none;align-items:center;display:inline-flex;height:28px;padding:0 10px;border:0;border-radius:14px;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.od-linkButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.od-linkButton:disabled{cursor:default;opacity:.4}
.od-linkButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.od-badges{align-items:center;gap:8px;display:inline-flex}
.od-badge,.od-badgeMuted{flex:none;align-items:center;display:inline-flex;white-space:nowrap;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:12px;font-weight:500;line-height:17px}
.od-badge{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.od-badgeMuted{border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}
.od-badgeWarn{background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.od-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.od-field+.od-field{border-top:.5px solid var(--dsw-alias-border-l2)}
.od-fieldHead{align-items:center;gap:8px;display:flex}
.od-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.od-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:18px}
.od-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.od-reset:disabled{cursor:default;opacity:.4}
.od-input{box-sizing:border-box;height:32px;min-width:0;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font:inherit;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.od-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.od-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.od-input:disabled{opacity:.6;cursor:default}
.od-inputInvalid{border-color:var(--dsw-alias-state-error-primary)}
.od-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.od-modelSelectAnchor{flex-direction:column;align-items:stretch;gap:6px;display:inline-flex;min-width:160px}
.od-selector{box-sizing:border-box;align-items:center;gap:12px;display:inline-flex;height:36px;padding:0 14px;border:0;border-radius:18px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer}
.od-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.od-selector:disabled{cursor:default;opacity:.4}
.od-selector:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.od-selectorText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.od-selectorCaret{flex-shrink:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);width:6px;height:6px;margin-bottom:3px;transform:rotate(45deg)}
/* The search box sits inside the Menu anchor, so typing in it never trips
 * the Menu's outside-click close. */
.od-modelSearch{width:100%}
.od-modelSearch::-webkit-search-cancel-button{cursor:pointer}
.od-checkRow{align-items:center;gap:8px;display:inline-flex;min-width:0}
.od-checkRow:hover{cursor:pointer}
/* A hand-drawn box, not the platform's accent-color checkbox: the native
 * control's colours come from color-scheme, which the theme sets once at BOOT
 * and never re-applies in-session, so a native box can paint light-chrome white
 * on a dark page. The mark rides a brand-primary fill, so it takes the brand
 * foreground (the only pairing that survives dark mode's near-white brand), and
 * the outline is a border-l3 hairline because border-l2 leaves an unchecked box
 * invisible against the menu surface. */
.od-check{box-sizing:border-box;appearance:none;flex-shrink:0;width:16px;height:16px;margin:0;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;background:0 0;position:relative}
.od-check:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.od-check:checked::after{content:'';position:absolute;top:3px;left:5px;width:3px;height:7px;border:solid var(--dsw-alias-label-primary-foreground,#fff);border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}
.od-checkName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Modelled on the platform's own Switch primitive (ui-primitives
 * Switch.module.css): a 36x20 capsule padding its track by 2px and sliding a
 * 16px thumb across the 32px content box. Three things are load-bearing.
 * (1) corner-shape:round on BOTH track and thumb — the theme sets a global
 * superellipse corner shape, which squares a capsule's ends off around a round
 * thumb. (2) No literal colours: brand-primary INVERTS between the modes, so a
 * hardcoded white thumb vanishes on the checked track in dark mode; the brand
 * foreground is what the platform paints on that fill. (3) border-l3 as the
 * off track — border-l2 leaves it indistinguishable from the page. */
.od-toggle{box-sizing:border-box;appearance:none;flex-shrink:0;width:36px;height:20px;margin:0;padding:2px;border:0;border-radius:10px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer;position:relative}
.od-toggle:checked{background:var(--dsw-alias-brand-primary)}
.od-toggle::after{content:'';display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}
.od-toggle:checked::after{transform:translateX(16px)}
.od-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.od-toggle:disabled{cursor:default;opacity:.5}
.od-chevron{flex-shrink:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);width:7px;height:7px;margin-right:6px;margin-bottom:3px;transform:rotate(45deg);transition:transform .15s ease}
.od-chevronUp{transform:rotate(-135deg);margin-bottom:-3px}
.od-accountMode{align-items:center;gap:4px;display:flex;margin:-4px 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.od-accountList{flex-direction:column;gap:8px;display:flex}
.od-accountList+.od-addButton,.od-accountList+.od-addPanel{margin-top:8px}
.od-accountItem{flex-direction:column;gap:10px;display:flex;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px}
.od-accountItemActive{border-color:var(--dsw-static-neutral-bluish-400,var(--dsw-alias-border-l3))}
.od-accountHead{align-items:center;gap:4px;display:flex;min-height:28px}
.od-accountToggle{align-items:center;gap:8px;display:flex;flex:1;min-width:0;padding:0;background:0 0;border:0;color:inherit;cursor:pointer;font:inherit;text-align:left}
.od-accountToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
.od-accountName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.od-iconButton{flex-shrink:0;align-items:center;justify-content:center;display:inline-flex;width:28px;height:28px;padding:0;background:0 0;border:0;border-radius:6px;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.od-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.od-iconButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
/* Per-model context-length override rows (issue #86): the error wraps onto
   its own line beneath the select/input/remove trio. The three cells form a
   fixed column contract — flexible model, 112px value, 28px remove — and the
   od-contextHead labels repeat the first two (plus the remove cell's width
   as a spacer) so they sit exactly over their columns. */
.od-contextItem{align-items:center;gap:8px;display:flex;flex-wrap:wrap;padding:8px 0}
.od-contextHead{align-items:center;gap:8px;display:flex;flex-wrap:wrap;padding:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-contextHeadModel{flex:1;min-width:200px}
.od-contextHeadValue{flex:none;width:112px}
.od-contextHeadGap{flex:none;width:28px}
.od-contextSelect{position:relative;display:block;flex:1;min-width:200px}
/* appearance:none swaps the platform arrow for the od-contextCaret, shaped
   like od-selectorCaret so every dropdown in the plugin opens with the same
   hand-drawn chevron. */
.od-contextModel{box-sizing:border-box;appearance:none;-webkit-appearance:none;width:100%;padding-inline-end:26px;text-overflow:ellipsis;cursor:pointer}
.od-contextCaret{position:absolute;inset-inline-end:12px;top:50%;width:6px;height:6px;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:translateY(-50%) rotate(45deg);pointer-events:none}
.od-contextSelect:has(.od-contextModel:disabled) .od-contextCaret{opacity:.6}
.od-contextValue{flex:none;width:112px}
.od-contextError{flex-basis:100%}
/* Three dots from one element: the dot plus two box-shadow copies. */
.od-kebab{width:3px;height:3px;border-radius:50%;corner-shape:round;background:currentColor;box-shadow:0 -5px 0 currentColor,0 5px 0 currentColor}
.od-tabDot{flex-shrink:0;width:8px;height:8px;border-radius:50%;corner-shape:round}
.od-tabDotOk{background:var(--dsw-alias-state-success-primary)}
.od-tabDotBlank{background:0 0;border:0}
.od-tabDotWarn{background:var(--dsw-alias-state-warn-primary,#d97706)}
.od-tabDotError{background:var(--dsw-alias-state-error-primary)}
.od-accountMeters{flex-wrap:wrap;gap:6px 20px;display:flex;padding-left:16px}
.od-miniMeter{align-items:center;gap:8px;display:inline-flex;font-size:12px;line-height:18px}
.od-miniMeterLabel{color:var(--dsw-alias-label-tertiary)}
.od-miniMeterTrack{overflow:hidden;background:var(--dsw-alias-bg-module-platform);border-radius:999px;width:64px;height:4px}
.od-miniMeterFill{display:block;background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%}
.od-miniMeterValue{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.od-accountSetup,.od-loginStatus{flex-direction:column;gap:8px;display:flex;padding-left:16px}
.od-loginStatus{flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 12px}
.od-loginStatus>p{margin:0;font-size:12px;line-height:18px}
.od-accountDetails{container-type:inline-size;border-top:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:14px;display:flex;padding-top:12px}
.od-inlineForm,.od-confirmBar{flex-direction:column;gap:8px;display:flex}
.od-inlineActions{align-items:center;gap:8px;display:flex}
.od-confirmBar{border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;padding:12px 14px}
.od-confirmText{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;line-height:22px}
.od-dangerButton{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.od-dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.od-addButton{box-sizing:border-box;align-items:center;justify-content:center;gap:6px;display:flex;width:100%;height:44px;border:1px dashed var(--dsw-alias-border-l3);border-radius:16px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.od-addButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.od-addButton:disabled{cursor:default;opacity:.4}
.od-addButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.od-addGlyph{position:relative;width:12px;height:12px}
.od-addGlyph::before,.od-addGlyph::after{content:'';position:absolute;background:currentColor;border-radius:1px}
.od-addGlyph::before{left:0;right:0;top:5.25px;height:1.5px}
.od-addGlyph::after{top:0;bottom:0;left:5.25px;width:1.5px}
.od-addPanel{flex-direction:column;gap:12px;display:flex;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
.od-panelTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.od-accountReport{flex-direction:column;gap:14px;display:flex}
.od-usageHead{align-items:center;gap:8px;display:flex}
.od-usageTitle{color:var(--dsw-alias-label-primary);flex:1;margin:0;font-size:14px;font-weight:500;line-height:22px}
.od-usageAccount{max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-usagePlan{flex:none;white-space:nowrap;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:999px;corner-shape:round;padding:0 7px;font-size:12px;font-weight:500;line-height:17px}
.od-usagePlanStatus{flex:none;margin:0;white-space:nowrap;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.od-usageHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
/* Two fixed grids, not one auto-fit track: auto-fit wrapped the four activity
 * tiles 3 + 1 at the details' width. The activity row folds to 2 × 2 in a
 * narrow details panel. */
.od-usageStats{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;display:grid}
.od-usageStatsActivity{grid-template-columns:repeat(4,minmax(0,1fr))}
.od-usageStatsBalance{grid-template-columns:repeat(3,minmax(0,1fr))}
@container (max-width:460px){.od-usageStatsActivity{grid-template-columns:repeat(2,minmax(0,1fr))}}
.od-usageStat{min-width:0;flex-direction:column;gap:2px;display:flex;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
.od-usageStatLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-usageStatValue{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px;font-variant-numeric:tabular-nums}
.od-usageStatSub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.od-usageWindows{flex-direction:column;gap:14px;display:flex}
.od-usageWindow{flex-direction:column;gap:6px;display:flex}
.od-usageWindowHead{align-items:baseline;gap:8px;display:flex}
.od-usageWindowLabel{color:var(--dsw-alias-label-secondary);flex:1;font-size:12px;line-height:18px}
.od-usageWindowValue{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.od-usageExceeded{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.od-usageBar{overflow:hidden;background:var(--dsw-alias-bg-module-platform);border-radius:999px;height:4px}
.od-usageBarFill{background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.od-usageBarFillWarn{background:var(--dsw-alias-state-error-primary)}
.od-usageWindowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.od-usageMeta{align-items:center;gap:8px;display:flex}
.od-usageMetaSpacer{flex:1}
.od-usageUpdated{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.od-usagePartial{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.od-usageBlocked{border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.od-usageBlockedTitle{color:var(--dsw-alias-state-error-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}
.od-usageBlockedHint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}
.od-usageBlockedDetail{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;word-break:break-word}
.od-version{margin:32px 0 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-versionLink{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));text-decoration:none}
.od-versionLink:hover{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-position:under}
.od-providerCard{flex-direction:column;display:flex}
.od-footer{justify-content:flex-end;align-items:center;gap:8px;display:flex}
.od-failed{display:inline-block;max-width:260px;min-width:0;color:var(--dsw-alias-state-error-primary);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}
.od-loginLink{color:var(--dsw-alias-link,var(--dsw-alias-brand-primary));text-decoration:none;font-size:12px;line-height:18px}
.od-loginLink:hover{text-decoration:underline;text-underline-position:under}
.od-loginDone{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary))}
.od-loginError{color:var(--dsw-alias-state-error-primary)}
/* The floating save bar: a centered capsule pinned to the bottom of the
 * settings scrollport. The dock is a zero-height sticky strip at the end of the
 * page, so the bar overlays the scrolling content instead of taking a row of
 * its own; while shown, the section reserves room at its end so the last line
 * can scroll clear. Hidden, it sinks and fades, and visibility (switched after
 * the transition) takes its buttons out of the tab order. Its surface is an
 * elevated layer (bg-layer-1 over the settings panel's layer-2) with the
 * platform's prominent elevation and no stroke, and its corners are concentric
 * (a 44px capsule around 36px buttons inset by 4px) so the gap around each
 * button is even. */
.od-sectionWithBar{padding-bottom:80px}
.od-saveBarDock{position:sticky;bottom:0;z-index:2;height:0;pointer-events:none}
.od-saveBar{--od-saveBar-tone:var(--dsw-alias-state-warn-primary,#d97706);position:absolute;left:50%;bottom:20px;box-sizing:border-box;width:max-content;max-width:calc(100% - 24px);align-items:center;gap:10px;display:flex;height:44px;padding:4px 4px 4px 16px;border:0;border-radius:22px;corner-shape:round;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 12px 32px -8px rgba(0,0,0,.24),0 2px 8px rgba(0,0,0,.08));opacity:0;visibility:hidden;transform:translate(-50%,12px);transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}
.od-saveBarShown{opacity:1;visibility:visible;transform:translate(-50%,0);pointer-events:auto;transition:opacity .2s ease,transform .24s cubic-bezier(.2,.9,.3,1.1),visibility 0s}
.od-saveBar-error{--od-saveBar-tone:var(--dsw-alias-state-error-primary)}
.od-saveBar-success{--od-saveBar-tone:var(--dsw-alias-state-success-primary,#16a34a);padding-right:18px}
.od-saveBarIcon{flex-shrink:0;align-items:center;justify-content:center;display:inline-flex;width:16px;height:16px;color:var(--od-saveBar-tone)}
.od-saveBarPulse{width:8px;height:8px;border-radius:50%;corner-shape:round;background:var(--od-saveBar-tone)}
.od-saveBarText{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.od-saveBar-error .od-saveBarText{color:var(--dsw-alias-state-error-primary)}
.od-saveBarActions{flex-shrink:0;align-items:center;gap:4px;display:flex;margin-left:8px}
.od-saveBarButton{box-sizing:border-box;height:36px;padding:0 16px;border:0;border-radius:18px;corner-shape:round;font:inherit;font-size:14px;line-height:22px;white-space:nowrap;cursor:pointer}
.od-saveBarButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.od-saveBarButton:disabled{cursor:default;opacity:.4}
.od-saveBarGhost{background:0 0;color:var(--dsw-alias-label-primary)}
.od-saveBarGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.od-saveBarPrimary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff)}
.od-saveBarPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)))}
/* Analytics page (ticket 12): a draft filter row, a summary strip and one
 * comparison table. The table lives in a horizontal scroll container so a wide
 * nine-column comparison never forces the settings panel to scroll sideways. */
.od-analyticsFilters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px}
.od-analyticsModes{display:inline-flex;padding:2px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.od-modeButton{box-sizing:border-box;height:32px;padding:0 12px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.od-modeButtonActive{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.od-modeButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.od-analyticsField{display:flex;flex-direction:column;gap:4px}
.od-analyticsNumber{width:96px}
.od-analyticsNotices{margin:12px 0 0}
.od-analyticsSummary{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:8px;margin:12px 0}
.od-analyticsStat{display:flex;flex-direction:column;gap:2px;padding:8px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.od-analyticsStatLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.od-analyticsStatValue{color:var(--dsw-alias-label-primary);font-size:16px;line-height:24px;font-variant-numeric:tabular-nums}
.od-analyticsTableWrap{overflow-x:auto}
.od-analyticsTable{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.od-analyticsTable th,.od-analyticsTable td{padding:8px 10px;border-bottom:0.5px solid var(--dsw-alias-border-l2);text-align:right;white-space:nowrap}
.od-analyticsTable th:first-child,.od-analyticsTable td:first-child{text-align:left}
.od-analyticsTable th{color:var(--dsw-alias-label-secondary);font-weight:500}
.od-analyticsTable td{color:var(--dsw-alias-label-primary)}
@media (prefers-reduced-motion:reduce){.od-chevron,.od-toggle::after,.od-usageBarFill,.od-saveBar,.od-saveBarShown{transition:none}}
`;
		//#endregion
		//#region src/client/panel-styles.ts
		/**
		* Stylesheet for the Open Design plans & quota panel (the sidebar footer card
		* and the dashboard it opens).
		*
		* Returned as a string, not injected here, so importing this module has no DOM
		* side effect: `./index.ts` installs it once under {@link PANEL_CSS_ID} and
		* removes it when the fiber unwinds.
		*
		* These rules are GLOBAL CSS, so containment is a contract (issue #48): every
		* selector is qualified by one of our own `odp-` classes except the sidebar
		* anchor below, which carries its justification in place. `tests/styles.test.ts`
		* audits both stylesheets against the real foreign class stems. Colours are
		* harness theme aliases with neutral fallbacks; the `odp-` prefix keeps these
		* clear of the settings page's `od-` set.
		*
		* @module dsh-opendesign-provider/client/panel-styles
		*/
		/**
		* Stylesheet id — the `data-plugin-css` value that makes injection idempotent.
		*
		* The prefix must match this package's real name and the settings-page sheet's
		* (`PAGE_CSS_ID`); the two ids must also stay DISTINCT, since they key two
		* separate style tags and a shared id would make the second injection a no-op.
		*/
		const PANEL_CSS_ID = "@mars-sea/dsh-opendesign-provider/OpenDesignPanel.module.css";
		/** The panel stylesheet. */
		const PANEL_CSS = `
/* ------------------------------------------------- sidebar footer card */
/* The shell renders this list ABOVE the Settings seat, so the card is the
   sidebar's bottom-most content, and supplies no chrome: the entry IS the
   button. Deliberately quiet — a surface beside Settings should read as part of
   the column — with one hover step and a hairline border.

   The shell's container is a flex ROW whose occupants each declare a full-width
   line and shrink-proof flex, so as a row it would overflow the column: this
   card cannot shrink and the neighbouring chip would absorb the overflow and
   collapse to nothing. The first rule is that fix, and THE ANCHOR IS
   LOAD-BEARING (issue #48): "footerActions" is not a stem this shell owns alone
   — dsh-client-ui-user-questions renders the ask-user-question dialog's button
   row as Mbwy4a_footerActions, and the unanchored rule stacked THAT row's
   side-by-side buttons on every page. "footArea" is declared by
   dsh-client-ui-sidebar alone (audited across every client bundle of the
   0.1.6-alpha.1 engine, and against our own od-/odp- names, which collide with
   no engine class). The DESCENDANT combinator survives a wrapper element
   appearing between the two, so a restructured shell degrades to its own row
   rather than losing the fix. tests/styles.test.ts pins both halves. */
[class*="_footArea"] [class*="_footerActions"]{flex-direction:column}
.odp-foot{box-sizing:border-box;flex:0 0 auto;width:100%;min-width:0;font:inherit;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;background:0 0;border:1px solid transparent;border-radius:10px;flex-direction:column;gap:6px;margin:0 0 4px;padding:8px;display:flex}
.odp-foot:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.odp-foot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.odp-footTop{align-items:center;gap:8px;min-width:0;display:flex}
.odp-footName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;font-size:13px;font-weight:500;line-height:20px}
/* One block per quota window: a head line carrying the window's own spend and
   limit, then the FULL-WIDTH bar under it. Stacking the two lets the card show
   the dollar figures — the reason this surface exists — without squeezing the
   bar into what is left beside them. Mirrors the dashboard's window block. */
.odp-footRow{flex-direction:column;gap:4px;min-width:0;display:flex}
.odp-footHead{align-items:baseline;gap:8px;min-width:0;display:flex}
.odp-footLabel{flex:1;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
.odp-footAmount{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
/* The card's markup must stay PHRASING content — it renders inside the shell's
   own button — so these bars are spans, which makes display:block load-bearing:
   an inline box ignores width outright, so the fill would collapse to 0x0 and
   the bar would show no usage. */
.odp-footBar{display:block;background:var(--dsw-alias-bg-layer-2);border-radius:999px;height:5px;overflow:hidden}
.odp-footFill{display:block;background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.odp-footFillWarn{background:var(--dsw-alias-state-error-primary)}
.odp-footPct{flex:none;width:34px;color:var(--dsw-alias-label-secondary);text-align:right;font-size:12px;line-height:16px;font-variant-numeric:tabular-nums}

/* The 56px rail: one icon button on the shell's own 36px rail cell, so the
   collapsed column keeps a single 18px glyph like its siblings. */
.odp-railButton{box-sizing:border-box;width:36px;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid transparent;border-radius:8px;flex:none;justify-content:center;align-items:center;margin:0 0 4px;padding:0;display:inline-flex}
.odp-railButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.odp-railButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* The ring glyph, sized entirely by its own width/height attribute, so the
   footer row, the rail button and the dashboard can each ask for their own. */
.odp-glyph{flex:none;justify-content:center;align-items:center;display:inline-flex;color:var(--dsw-alias-brand-primary)}

/* ------------------------------------------------------------ dashboard */
.odp-main{background:var(--dsw-alias-bg-layer-1);width:100%;height:100%;overflow:auto;display:block}
.odp-mainInner{max-width:760px;margin:0 auto;padding:24px 20px 40px;flex-direction:column;gap:14px;display:flex;color:var(--dsw-alias-label-primary)}
.odp-header{align-items:center;gap:10px;display:flex;flex-wrap:wrap}
.odp-headerText{flex-direction:column;gap:2px;display:flex;min-width:0}
.odp-title{margin:0;font-size:18px;font-weight:600;line-height:1.4}
.odp-subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.odp-spacer{flex:1}
.odp-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums}
/* 关闭图标沿用原语义与按钮尺寸，线性 SVG 随宿主文字颜色变化。 */
.odp-close{min-width:28px;justify-content:center;padding-left:0;padding-right:0}
.odp-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
/* Dashboard header actions: the refresh control and the panel-closing × both fit
   the 28px header row, so the dashboard stays escapable without stealing height
   from the numbers it exists to show. */
.odp-dashboardActions{flex:none;align-items:center;gap:8px;display:flex}
.odp-action{box-sizing:border-box;min-height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;justify-content:center;align-items:center;padding:0 10px;font:inherit;font-size:12px;line-height:18px;display:inline-flex}
.odp-action:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.odp-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.odp-action:disabled{opacity:.5;cursor:progress}
.odp-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}

.odp-notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:12px 14px;flex-direction:column;gap:4px;display:flex}
.odp-noticeError{border-color:var(--dsw-alias-state-error-primary)}
.odp-noticeTitle{margin:0;font-size:13px;font-weight:600;line-height:1.5}
.odp-noticeError .odp-noticeTitle{color:var(--dsw-alias-state-error-primary)}
.odp-noticeHint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}
.odp-noticeDetail{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;word-break:break-word}

.odp-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;padding:16px 18px;flex-direction:column;gap:16px;display:flex}
.odp-cardHead{align-items:center;gap:10px;display:flex;flex-wrap:wrap}
.odp-avatar{flex:none;width:28px;height:28px;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-module-platform);border-radius:50%;justify-content:center;align-items:center;font-size:12px;font-weight:600;line-height:1;display:inline-flex}
.odp-cardIdentity{flex-direction:column;gap:1px;min-width:0;display:flex}
.odp-cardTitle{font-size:13px;font-weight:600;line-height:1.4}
.odp-cardOwner{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.odp-block{flex-direction:column;gap:8px;display:flex}
.odp-blockTitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;line-height:1.5;text-transform:uppercase;letter-spacing:.04em}
.odp-planRow{align-items:center;gap:8px;display:flex;flex-wrap:wrap}
.odp-fieldLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.odp-planName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:1.5}

/* The monthly credits and the usage totals share one grid. */
.odp-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.odp-tile{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;flex-direction:column;gap:2px;display:flex;min-width:0}
.odp-tileLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.odp-tileValue{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4;font-variant-numeric:tabular-nums}
.odp-tileSub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Quota bars: the monthly bar and the two windows. */
.odp-windows{flex-direction:column;gap:14px;display:flex}
.odp-window{flex-direction:column;gap:6px;display:flex}
.odp-windowHead{align-items:baseline;gap:8px;display:flex}
.odp-windowLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:1.5}
.odp-windowValue{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap}
.odp-windowPct{color:var(--dsw-alias-label-primary);min-width:38px;text-align:right;font-size:12px;font-weight:600;line-height:1.5;font-variant-numeric:tabular-nums}
.odp-warnTag{white-space:nowrap;background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary));border-radius:999px;padding:0 8px;font-size:12px;font-weight:600;line-height:17px}
.odp-bar{overflow:hidden;background:var(--dsw-alias-bg-layer-1);border-radius:999px;height:8px}
.odp-barFill{background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.odp-barFillWarn{background:var(--dsw-alias-state-error-primary)}
.odp-windowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}

.odp-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-brand-primary);border-radius:999px;padding:1px 8px;font-size:12px;font-weight:600;line-height:17px}
.odp-badgeError{background:transparent;color:var(--dsw-alias-state-error-primary)}
.odp-badgeWarn{background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
.odp-badgeMuted{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:12px;font-weight:500;line-height:17px;max-width:220px;overflow:hidden;text-overflow:ellipsis}

/* Account switch: plain buttons, like the settings page's usage carousel. */
.odp-tabs{flex-wrap:wrap;gap:6px;display:flex}
.odp-tab{align-items:center;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px;display:inline-flex;gap:6px}
.odp-tab:hover:not(.odp-tabActive){color:var(--dsw-alias-label-primary)}
.odp-tabActive{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}

@media (prefers-reduced-motion:reduce){.odp-footFill,.odp-barFill{transition:none}}
/* 分析页继承设置页和宿主控件的语义变量；独立选择器不影响账号额度页面。 */
.odp-mainInnerAnalysis{max-width:1040px;box-sizing:border-box}
/* 宿主侧栏会缩窄中心面板，按实际可用宽度切换列数，而不是仅看浏览器宽度。 */
.odp-analysis{font-size:14px;line-height:22px;min-width:0;color:var(--dsw-alias-label-primary);container-type:inline-size;container-name:odp-analysis}
.odp-analysisFilters{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:8px 0 20px}
.odp-analysisField{display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);min-width:0}
.odp-analysisFilters .odp-analysisField{flex:0 1 158px}
.odp-analysisFilters .odp-analysisScopeField{flex-basis:184px}
.odp-analysisFilters .odp-analysisDateField{flex-basis:166px}
/* 对齐原生选择器、日期输入与按钮的边框盒；保留独立箭头留白和点击区域。 */
.odp-analysisInput{box-sizing:border-box;width:100%;min-width:0;height:36px;padding:0 11px;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l4);border-radius:8px}
.odp-analysisSelectShell{position:relative;display:block;width:100%;min-width:0}
.odp-analysisSelect{appearance:none;-webkit-appearance:none;padding-inline-end:40px;text-overflow:ellipsis;cursor:pointer;border:0;border-radius:18px;background:var(--dsw-alias-bg-module-platform)}
.odp-analysisSelectShell > .odp-analysisChevron{position:absolute;inset-inline-end:12px;top:50%;transform:translateY(-50%) rotate(90deg);pointer-events:none}
.odp-analysisSelect:disabled + .odp-analysisChevron{opacity:.6}
.odp-analysisInput::placeholder{color:var(--dsw-alias-label-tertiary)}
.odp-analysisApply{box-sizing:border-box;flex:none;height:36px;font:inherit;font-size:14px;line-height:22px;white-space:nowrap;padding:0 20px;border:0;border-radius:var(--dsw-radius-md,18px);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);cursor:pointer;margin-left:2px}
.odp-analysisApply:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.odp-analysisApply:disabled{opacity:.4;cursor:wait}
.odp-analysisInput:disabled{opacity:.6}
.odp-analysisInput:focus-visible,.odp-analysisApply:focus-visible,.odp-analysisTab:focus-visible,.odp-analysisPanel:focus-visible,.odp-analysisModelSummary:focus-visible,.odp-analysisScenarioSummary:focus-visible,.odp-analysisDisclosure:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
/* 模型列表会裁切圆角，内收焦点框以保持第一行和最后一行也清晰可见。 */
.odp-analysisModelSummary:focus-visible,.odp-analysisScenarioSummary:focus-visible{outline-offset:-3px;border-radius:6px}
.odp-analysisScope{display:flex;justify-content:space-between;gap:8px 18px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-bottom:12px}
.odp-analysisScope > span:first-child{color:var(--dsw-alias-label-primary);font-weight:500}
.odp-analysisOverview{display:grid;grid-template-columns:1.45fr repeat(3,1fr);gap:20px;padding:16px 18px;background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;font-variant-numeric:tabular-nums}
.odp-analysisMetric{display:flex;flex-direction:column;gap:3px;min-width:0}
.odp-analysisLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-weight:400}
.odp-analysisValue{font-size:14px;line-height:22px;font-weight:500;overflow-wrap:anywhere}
.odp-analysisSub{display:block;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-weight:400;overflow-wrap:anywhere}
.odp-analysisOverview .odp-analysisMetric{gap:5px}
.odp-analysisOverview .odp-analysisValue{font-size:20px;line-height:28px;font-weight:500}
.odp-analysisNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:9px 0 0}
.odp-analysisMessage{margin:12px 0 0;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-layer-3);font-size:14px;line-height:22px}
.odp-analysisWarning{display:flex;align-items:flex-start;gap:8px}
.odp-analysisIcon{flex:none}
.odp-analysisWarning > .odp-analysisIcon{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));margin-top:3px}
.odp-analysisWarning p{margin:0}
.odp-analysisWarning p + p{margin-top:5px}
.odp-analysisError{color:var(--dsw-alias-state-error-primary)}
/* 沿用宿主分段控件的轨道、浮层与胶囊尺寸，保留原有页签键盘语义。 */
.odp-analysisTabs{box-sizing:border-box;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:4px;border:0;border-radius:var(--dsw-radius-md,18px);background:var(--dsw-alias-interactive-bg-hover);margin:22px 0 0;max-width:100%}
.odp-analysisTab{height:28px;padding:0 16px;border:0;border-radius:var(--dsw-radius-sm,14px);background:transparent;font:inherit;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer}
.odp-analysisTab:hover,.odp-analysisTab[aria-selected="true"]{color:var(--dsw-alias-label-primary)}
.odp-analysisTab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft)}
.odp-analysisTabCount{display:inline-flex;justify-content:center;min-width:16px;padding:0 4px;margin-left:6px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.odp-analysisPanel{padding-top:20px;min-width:0}
.odp-analysisPanel[hidden]{display:none}
.odp-analysisSectionHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.odp-analysisHeading{font-size:14px;line-height:22px;font-weight:500;margin:0}
.odp-analysisSectionHead .odp-analysisNote{margin:0;max-width:56ch}
.odp-analysisModels{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;overflow:hidden}
.odp-analysisModelRow + .odp-analysisModelRow{border-top:.5px solid var(--dsw-alias-border-l2)}
.odp-analysisTableHead,.odp-analysisModelSummary,.odp-analysisScenarioSummary{position:relative;display:grid;grid-template-columns:minmax(190px,2.1fr) minmax(150px,1.45fr) minmax(90px,.9fr) minmax(90px,.9fr) minmax(100px,1fr) 16px;gap:18px;align-items:center;padding:16px 18px;font-variant-numeric:tabular-nums}
.odp-analysisTableHead{padding-top:11px;padding-bottom:11px;background:var(--dsw-alias-interactive-bg-hover);border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.odp-analysisTableHead > span:not(:first-child){text-align:right}
.odp-analysisScenarioHead,.odp-analysisScenarioSummary{grid-template-columns:minmax(190px,2fr) minmax(118px,1.1fr) minmax(155px,1.35fr) minmax(142px,1.15fr) 16px}
.odp-analysisModelSummary,.odp-analysisScenarioSummary{cursor:pointer;list-style:none;min-height:60px}
.odp-analysisModelSummary::-webkit-details-marker,.odp-analysisScenarioSummary::-webkit-details-marker,.odp-analysisDisclosure::-webkit-details-marker{display:none}
.odp-analysisModelSummary:hover,.odp-analysisScenarioSummary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.odp-analysisIdentity{display:flex;flex-direction:column;gap:2px;min-width:0}
.odp-analysisModelName{font-size:14px;line-height:22px;font-weight:500;overflow-wrap:anywhere}
.odp-analysisModelCount{margin-top:3px}
.odp-analysisModelSummary > .odp-analysisMetric,.odp-analysisScenarioSummary > .odp-analysisMetric{align-items:flex-end}
/* 宽表使用集中表头，但保留每个指标的无障碍标签；窄面板恢复可见标签。 */
.odp-analysisModelSummary .odp-analysisMetricLabel,.odp-analysisScenarioSummary .odp-analysisMetricLabel,.odp-analysisSearchLabel{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.odp-analysisShare{display:flex;align-items:center;gap:8px;width:100%;max-width:148px;margin-top:3px}
.odp-analysisShareTrack{display:block;flex:1;height:4px;overflow:hidden;background:var(--dsw-alias-bg-module-platform);border-radius:999px}
.odp-analysisShareFill{display:block;height:100%;background:var(--dsw-alias-label-secondary);border-radius:999px}
.odp-analysisShareValue{font-size:12px;line-height:18px;min-width:40px;text-align:right;color:var(--dsw-alias-label-tertiary)}
.odp-analysisChevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.odp-analysisModelRow[open] > .odp-analysisModelSummary > .odp-analysisChevron,.odp-analysisModelRow[open] > .odp-analysisScenarioSummary > .odp-analysisChevron,.odp-analysisAggregate[open] > .odp-analysisDisclosure > .odp-analysisChevron,.odp-analysisRules[open] > .odp-analysisDisclosure > .odp-analysisChevron{transform:rotate(90deg)}
.odp-analysisDetails{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px;padding:16px 18px;background:var(--dsw-alias-bg-module-platform);border-top:.5px solid var(--dsw-alias-border-l2)}
.odp-analysisDetailTitle{font-size:12px;line-height:18px;font-weight:600;margin:0 0 11px}
.odp-analysisFacts{margin:0;display:flex;flex-direction:column;gap:8px}
.odp-analysisFact{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0}
.odp-analysisFactValue{font-size:14px;line-height:22px;margin:0;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;min-width:0}
.odp-analysisFact .odp-analysisLabel{flex-shrink:0}
.odp-analysisFooter{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-top:14px}
.odp-analysisAggregate{flex:1;min-width:210px}
.odp-analysisAggregate > .odp-analysisDetails{border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;margin-top:6px}
.odp-analysisDisclosure{display:flex;gap:7px;align-items:center;cursor:pointer;list-style:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:7px 0}
.odp-analysisDisclosure > .odp-analysisChevron{width:14px;height:14px}
.odp-analysisMonthly{flex:none;max-width:340px;display:flex;justify-content:flex-end;flex-wrap:wrap;gap:2px 8px;align-items:baseline;text-align:right;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding-top:5px}
.odp-analysisMonthlyValue{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.odp-analysisMonthly .odp-analysisNote{width:100%;margin:0}
.odp-analysisAssumption{font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);margin:0 0 18px;max-width:76ch}
.odp-analysisBaseline{margin:0 0 16px}
.odp-analysisSearch{flex:0 1 270px}
.odp-analysisSearchShell{position:relative;display:block}
.odp-analysisSearchShell > .odp-analysisIcon{position:absolute;top:10px;left:11px;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.odp-analysisSearch .odp-analysisInput{padding-left:35px}
.odp-analysisScenarioDetails{grid-template-columns:minmax(0,1fr) minmax(0,2fr)}
.odp-analysisScenarioDetails .odp-analysisFactValue{max-width:70%}
.odp-analysisEmpty{font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);text-align:center;padding:34px 18px;margin:0;border:1px dashed var(--dsw-alias-border-l4);border-radius:8px}
.odp-analysisRules{margin-top:22px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:8px}
.odp-analysisRulesBody{display:grid;grid-template-columns:1fr 1fr;gap:24px;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px;margin-top:9px}
.odp-analysisRulesBody p{margin:0 0 10px}
@container odp-analysis (max-width:920px){
.odp-analysisTableHead{display:none}
.odp-analysisModelSummary{grid-template-columns:repeat(4,minmax(0,1fr)) 16px;gap:12px 18px}
.odp-analysisScenarioSummary{grid-template-columns:repeat(3,minmax(0,1fr)) 16px;gap:12px 18px}
.odp-analysisModelSummary > .odp-analysisIdentity,.odp-analysisScenarioSummary > .odp-analysisIdentity{grid-column:1/-2}
.odp-analysisModelSummary > .odp-analysisChevron{grid-column:5;grid-row:1;justify-self:end}
.odp-analysisScenarioSummary > .odp-analysisChevron{grid-column:4;grid-row:1;justify-self:end}
.odp-analysisModelSummary > .odp-analysisMetric,.odp-analysisScenarioSummary > .odp-analysisMetric{align-items:flex-start}
.odp-analysisModelSummary .odp-analysisMetricLabel,.odp-analysisScenarioSummary .odp-analysisMetricLabel{position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip:auto;white-space:normal}
.odp-analysisDetails{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@container odp-analysis (max-width:588px){
.odp-analysisFilters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.odp-analysisFilters[data-mode="range"] .odp-analysisScopeField{grid-column:1/-1}
.odp-analysisApply{grid-column:1/-1;margin:0;width:100%}
.odp-analysisOverview{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 18px;padding:16px}
.odp-analysisModelSummary,.odp-analysisScenarioSummary{grid-template-columns:repeat(2,minmax(0,1fr));gap:15px 18px;padding:16px}
.odp-analysisModelSummary > .odp-analysisIdentity,.odp-analysisScenarioSummary > .odp-analysisIdentity{grid-column:1/-1;padding-right:24px}
.odp-analysisModelSummary > .odp-analysisChevron,.odp-analysisScenarioSummary > .odp-analysisChevron{position:absolute;top:18px;right:16px;grid-column:auto;grid-row:auto}
.odp-analysisDetails,.odp-analysisScenarioDetails{gap:20px;grid-template-columns:1fr;padding:16px}
.odp-analysisAggregate{width:100%;min-width:0}
.odp-analysisMonthly{width:100%;max-width:none;justify-content:flex-start;text-align:left;padding-top:0}
.odp-analysisSectionHead{align-items:flex-start}
.odp-analysisSectionHead .odp-analysisSearch{flex-basis:100%;width:100%;order:2}
.odp-analysisRulesBody{grid-template-columns:1fr;gap:12px}
/* 英文页签带数量时允许换行，避免轨道或文字撑出宿主的窄面板。 */
.odp-analysisTabs{margin-top:18px;grid-auto-columns:minmax(0,1fr)}
.odp-analysisTab{height:auto;min-height:28px;padding:4px 8px;white-space:normal}
}
@media (max-width:640px){.odp-mainInnerAnalysis{padding:20px 16px 32px}}
`;
		//#endregion
		//#region src/client/panel-locales.ts
		/** 中文文案（键集真源）。 */
		const ZH = {
			title: "额度面板",
			subtitle: "套餐、额度窗口与钱包余额",
			tierLine: "套餐 {tier}",
			tierUnknown: "未知档位",
			statusLine: "订阅 {status}",
			periodLine: "本期至 {when}",
			balanceLine: "钱包余额 {amount}",
			windowFiveHour: "5 小时窗口",
			windowSevenDay: "7 天窗口",
			windowOther: "{duration} 秒窗口",
			amountLine: "{used} / {limit} credits",
			remainingLine: "剩余 {percent}%",
			resetLine: "重置 {when}",
			resetUnknown: "重置时间未知",
			fundingPlan: "当前从 Design Plan 额度扣减。",
			fundingWallet: "当前按钱包余额扣费，不扣 Design Plan 额度。",
			explainer: "计费顺序：先扣 Design Plan 额度，再扣套餐额度（仅 Plus/Pro/Max），未覆盖时扣钱包余额。",
			walletOnly: "Design Plan 未覆盖当前模型（eligible=false），按钱包余额计费。",
			noWindows: "控制面没有返回限额窗口。",
			emptyUnknown: "暂无额度窗口数据。",
			stale: "已过期",
			fetchedAt: "数据时间 {when}",
			loadFailed: "读取额度失败，显示的是上次成功的数据。",
			loading: "正在读取额度…",
			unavailable: "额度不可用：需要 CLI 登录态里的 controlKey（执行 `vela login` 后重试）。",
			refresh: "刷新",
			refreshing: "刷新中…",
			open: "打开额度面板",
			close: "关闭面板",
			unknownPercent: "—"
		};
		/** 英文文案（键集与中文完全一致）。 */
		const EN = {
			title: "Quota panel",
			subtitle: "Plan, quota windows and wallet balance",
			tierLine: "Plan {tier}",
			tierUnknown: "Unknown plan",
			statusLine: "Subscription {status}",
			periodLine: "Period ends {when}",
			balanceLine: "Wallet balance {amount}",
			windowFiveHour: "5-hour window",
			windowSevenDay: "7-day window",
			windowOther: "{duration}s window",
			amountLine: "{used} / {limit} credits",
			remainingLine: "{percent}% left",
			resetLine: "Resets {when}",
			resetUnknown: "Reset time unknown",
			fundingPlan: "Currently charged to Design Plan credits.",
			fundingWallet: "Currently charged to the wallet balance; Design Plan credits are not used.",
			explainer: "Billing order: Design Plan credits first, then plan credits (Plus/Pro/Max only), then the wallet balance when neither covers the model.",
			walletOnly: "The Design Plan does not cover this model (eligible=false); the wallet balance is charged.",
			noWindows: "The control plane returned no limit windows.",
			emptyUnknown: "No quota window data yet.",
			stale: "Stale",
			fetchedAt: "Fetched {when}",
			loadFailed: "Reading quota failed; showing the last successful reading.",
			loading: "Reading quota…",
			unavailable: "Quota is unavailable: the CLI login state needs a controlKey (run `vela login` and retry).",
			refresh: "Refresh",
			refreshing: "Refreshing…",
			open: "Open the quota panel",
			close: "Close panel",
			unknownPercent: "—"
		};
		/** 设置事实到面板事实的投影。 */
		function factsState(facts) {
			return {
				showSidebarQuota: facts.showSidebarQuota === true,
				hasControlKey: facts.hasControlKey === true,
				controlKeyKnown: facts.loginStatus !== "unknown"
			};
		}
		/**
		* 一个额度面板控制器。构造即开始跟随设置事实；`dispose()` 停止订阅，此后不再
		* 读取也不再发布。
		*/
		var OpenDesignQuotaPanelController = class {
			store;
			deps;
			now;
			refreshIntervalMs;
			unsubscribe;
			lastAttemptAt;
			inFlight;
			disposed = false;
			constructor(deps) {
				this.deps = deps;
				this.now = deps.now ?? Date.now;
				this.refreshIntervalMs = deps.refreshIntervalMs ?? 3e5;
				const initial = factsState(deps.settings.getSnapshot());
				this.store = createSnapshotStore({
					...initial,
					open: false,
					loading: false,
					failed: false
				});
				this.unsubscribe = deps.settings.subscribe(() => {
					this.syncSettings();
				});
				if (this.enabled()) this.refresh();
			}
			/** 当前渲染事实。 */
			state() {
				return this.store.getSnapshot();
			}
			/** 订阅渲染事实变化。 */
			subscribe(listener) {
				return this.store.subscribe(listener);
			}
			/** 打开中间栏仪表盘：选中本面板并按节流刷新一次。 */
			openPanel() {
				if (this.disposed || !this.enabled()) return;
				this.publish({
					...this.state(),
					open: true
				});
				this.deps.selectPanel?.(PANEL_ID);
				this.refresh();
			}
			/** 关闭仪表盘并回到会话。 */
			closePanel() {
				if (this.disposed) return;
				if (!this.state().open) return;
				this.publish({
					...this.state(),
					open: false
				});
				this.deps.selectPanel?.(null);
			}
			/**
			* 读一次额度。默认受 5 分钟节流约束；`force` 是用户点「刷新」的路径。
			* 关闭状态、已销毁或已有一次读取在途时直接返回。
			*/
			async refresh(force = false) {
				if (this.disposed || !this.enabled()) return;
				if (this.inFlight !== void 0) return;
				const at = this.now();
				if (!force && this.lastAttemptAt !== void 0 && at - this.lastAttemptAt < this.refreshIntervalMs) return;
				this.lastAttemptAt = at;
				const run = this.load();
				this.inFlight = run;
				try {
					await run;
				} finally {
					if (this.inFlight === run) this.inFlight = void 0;
				}
			}
			/** 停止设置订阅；在途读取的结果不再发布。 */
			dispose() {
				this.disposed = true;
				this.unsubscribe();
			}
			/** 一次实际读取与结果折叠。 */
			async load() {
				this.publish({
					...this.state(),
					loading: true
				});
				let next;
				try {
					const result = await this.deps.load();
					if (this.disposed || !this.enabled()) return;
					if (result.ok && result.value !== void 0) next = {
						...this.state(),
						loading: false,
						failed: false,
						snapshot: result.value,
						lastSuccessAt: this.now()
					};
					else next = this.failedState();
				} catch {
					if (this.disposed || !this.enabled()) return;
					next = this.failedState();
				}
				this.publish(next);
			}
			/** 失败时的状态：保留旧读数并标成过期，绝不把失败当零额度。 */
			failedState() {
				const state = this.state();
				return {
					...state,
					loading: false,
					failed: true,
					...state.snapshot === void 0 ? {} : { snapshot: {
						...state.snapshot,
						stale: true
					} }
				};
			}
			/** 设置事实变化：开关打开就拉一次，关闭就收起面板并停止读取。 */
			syncSettings() {
				if (this.disposed) return;
				const wasEnabled = this.enabled();
				const state = this.state();
				const facts = factsState(this.deps.settings.getSnapshot());
				if (facts.showSidebarQuota !== state.showSidebarQuota || facts.hasControlKey !== state.hasControlKey || facts.controlKeyKnown !== state.controlKeyKnown) this.publish({
					...state,
					...facts
				});
				const enabled = this.enabled();
				if (enabled && !wasEnabled) {
					this.refresh();
					return;
				}
				if (!enabled && wasEnabled) {
					if (state.open) this.deps.selectPanel?.(null);
					this.publish({
						...this.state(),
						open: false
					});
				}
			}
			/** 开关打开且控制密钥可用（登录态未知时先按可用处理，读一次才能给原因）。 */
			enabled() {
				const state = this.state();
				return state.showSidebarQuota && !(state.controlKeyKnown && !state.hasControlKey);
			}
			publish(state) {
				if (this.disposed) return;
				this.store.set(state);
			}
		};
		//#endregion
		//#region src/client/panel-view.ts
		/** 已知档位按官方写法显示；未知档位原样显示，不猜。 */
		const TIER_LABELS = {
			go: "Go",
			plus: "Plus",
			pro: "Pro",
			max: "Max"
		};
		/** 界面里的档位名：已知档位首字母大写，未知值原样。 */
		function tierLabel(tier) {
			const trimmed = tier.trim();
			return TIER_LABELS[trimmed.toLowerCase()] ?? trimmed;
		}
		/** 本地化的日期时间（月日 + 时分）；坏时间戳返回 undefined。 */
		function formatPanelTime(iso, locale, timeZone) {
			const date = new Date(iso);
			if (!Number.isFinite(date.getTime())) return void 0;
			const options = {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
				...timeZone === void 0 ? {} : { timeZone }
			};
			return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", options).format(date);
		}
		/** credits 只保留整数（面板与 `/opendesign` 命令同一口径）。 */
		function credits(value) {
			return Number.isFinite(value) ? Math.round(value) : 0;
		}
		/** 百分比取整并夹到 0–100；上限 ≤ 0 时无法计算，返回 undefined。 */
		function percentOf(used, limit) {
			if (!(limit > 0)) return void 0;
			const ratio = used / limit * 100;
			if (!Number.isFinite(ratio)) return void 0;
			return Math.min(100, Math.max(0, Math.round(ratio)));
		}
		/** 一个窗口的投影。 */
		function windowView(window, t, locale, timeZone) {
			const used = credits(window.usedCredits);
			const limit = credits(window.limitCredits);
			const percent = percentOf(used, limit);
			const shownPercent = percent ?? 0;
			const remainingPercent = percent === void 0 ? 0 : 100 - percent;
			const when = window.resetsAt === void 0 ? void 0 : formatPanelTime(window.resetsAt, locale, timeZone);
			const label = window.kind === "five_hour" ? t("windowFiveHour") : window.kind === "seven_day" ? t("windowSevenDay") : t("windowOther", { duration: String(window.durationSeconds) });
			return {
				kind: window.kind,
				label,
				used,
				limit,
				percent: shownPercent,
				remainingPercent,
				percentText: percent === void 0 ? t("unknownPercent") : `${percent}%`,
				remainingText: percent === void 0 ? t("unknownPercent") : t("remainingLine", { percent: remainingPercent }),
				amountText: t("amountLine", {
					used: String(used),
					limit: String(limit)
				}),
				resetText: when === void 0 ? t("resetUnknown") : t("resetLine", { when }),
				overLimit: limit > 0 ? used > limit : used > 0
			};
		}
		/**
		* 投影一次面板状态。纯函数：同一输入永远同一输出，渲染时机与副作用都归控制器。
		*/
		function buildQuotaPanelView(input) {
			const { t, snapshot } = input;
			const allowed = !(input.controlKeyKnown && !input.hasControlKey);
			const available = snapshot?.controlPlaneAvailable === true;
			const visible = input.showSidebarQuota && allowed && available;
			const reasonText = input.showSidebarQuota && !visible && !input.loading ? t("unavailable") : void 0;
			if (!available || snapshot === void 0) return {
				visible,
				reasonText,
				tierText: void 0,
				statusText: void 0,
				periodText: void 0,
				balanceText: void 0,
				fundingText: void 0,
				explainerText: t("explainer"),
				windows: [],
				emptyText: void 0,
				staleText: void 0,
				fetchedText: void 0,
				loadFailedText: input.failed ? t("loadFailed") : void 0,
				loading: input.loading
			};
			const tier = snapshot.tier === void 0 ? void 0 : tierLabel(snapshot.tier);
			const isGo = snapshot.tier?.trim().toLowerCase() === "go";
			const windows = snapshot.windows.filter((window) => window.kind !== "five_hour" || isGo).map((window) => windowView(window, t, input.locale, input.timeZone));
			const period = snapshot.currentPeriodEnd === void 0 ? void 0 : formatPanelTime(snapshot.currentPeriodEnd, input.locale, input.timeZone);
			const fetched = formatPanelTime(snapshot.fetchedAt, input.locale, input.timeZone);
			const emptyText = windows.length > 0 ? void 0 : snapshot.funding === "wallet" ? t("walletOnly") : t("noWindows");
			return {
				visible,
				reasonText,
				tierText: tier === void 0 ? t("tierUnknown") : t("tierLine", { tier }),
				statusText: snapshot.subscriptionStatus === void 0 ? void 0 : t("statusLine", { status: snapshot.subscriptionStatus }),
				periodText: period === void 0 ? void 0 : t("periodLine", { when: period }),
				balanceText: snapshot.balanceUsd === void 0 ? void 0 : t("balanceLine", { amount: `$${snapshot.balanceUsd.toFixed(2)}` }),
				fundingText: snapshot.funding === "coding_plan" ? t("fundingPlan") : snapshot.funding === "wallet" ? t("fundingWallet") : void 0,
				explainerText: t("explainer"),
				windows,
				emptyText,
				staleText: snapshot.stale === true ? t("stale") : void 0,
				fetchedText: fetched === void 0 ? void 0 : t("fetchedAt", { when: fetched }),
				loadFailedText: input.failed ? t("loadFailed") : void 0,
				loading: input.loading
			};
		}
		//#endregion
		//#region src/client/panel-ui.tsx
		/**
		* The two quota-panel surfaces (ticket 11): the opt-in sidebar card
		* (`sidebar.footer.action`) and the dashboard it opens in the layout's keyed
		* `main` cell.
		*
		* Both are projections of one React-free view model (`panel-view.ts`), so the
		* card and the dashboard cannot disagree about tier, windows or the stale mark.
		* The card is a `<button>`: the sidebar shell renders footer actions inside its
		* own action column without chrome, so the entry itself must be the control.
		* Collapsed to the rail (`wide === false`) the entry becomes one icon button.
		*
		* @module dsh-opendesign-provider/client/panel-ui
		*/
		/** The quota ring mark used by the card and the collapsed rail. */
		function RingGlyph({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "odp-glyph",
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				focusable: "false",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "12",
					cy: "12",
					r: "7.5",
					stroke: "currentColor",
					strokeWidth: "2"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 4.5A7.5 7.5 0 0 1 19.5 12",
					stroke: "currentColor",
					strokeWidth: "2",
					strokeLinecap: "round"
				})]
			});
		}
		/** One window's progress block, shared by the card and the dashboard. */
		function WindowRow(props) {
			const fill = props.window.overLimit ? "odp-barFill odp-barFillWarn" : "odp-barFill";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "odp-window",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "odp-windowHead",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "odp-windowLabel",
								children: props.window.label
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "odp-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "odp-windowValue",
								children: props.window.amountText
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "odp-windowPct",
								children: props.window.percentText
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "odp-bar",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: fill,
							style: { width: `${props.window.percent}%` }
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "odp-windowReset",
						children: [
							props.window.resetText,
							" · ",
							props.window.remainingText
						]
					})
				]
			});
		}
		/** The opt-in sidebar card; renders nothing while the switch is off or quota is unavailable. */
		function OpenDesignQuotaCard(props) {
			const state = (0, react.useSyncExternalStore)(props.panelStore.subscribe, props.panelStore.getSnapshot, props.panelStore.getSnapshot);
			const t = props.t;
			const view = buildQuotaPanelView({
				...state,
				t,
				locale: props.panelLocale()
			});
			if (!view.visible) return null;
			if (props.wide === false) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				className: "odp-railButton",
				type: "button",
				title: t("open"),
				"aria-label": t("open"),
				onClick: () => props.panelOpen(),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RingGlyph, { size: 18 })
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				className: "odp-foot",
				type: "button",
				title: t("open"),
				"aria-label": t("open"),
				onClick: () => props.panelOpen(),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "odp-footTop",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "odp-footName",
							children: view.tierText
						}), view.staleText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "odp-badgeWarn",
							children: view.staleText
						})]
					}),
					view.windows.map((window) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "odp-footRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "odp-footHead",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "odp-footLabel",
								children: window.label
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "odp-footAmount",
								children: window.amountText
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "odp-footBar",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: window.overLimit ? "odp-footFill odp-footFillWarn" : "odp-footFill",
								style: { width: `${window.percent}%` }
							})
						})]
					}, window.kind)),
					view.windows.length > 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "odp-footLabel",
						children: view.fundingText ?? view.emptyText
					})
				]
			});
		}
		/** The dashboard cell; empty unless the card opened it. */
		function OpenDesignQuotaDashboard(props) {
			const state = (0, react.useSyncExternalStore)(props.panelStore.subscribe, props.panelStore.getSnapshot, props.panelStore.getSnapshot);
			const t = props.t;
			const view = buildQuotaPanelView({
				...state,
				t,
				locale: props.panelLocale()
			});
			if (!state.open || !view.visible) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: "odp-main",
				"aria-label": t("title"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "odp-mainInner",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "odp-header",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "odp-headerText",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									className: "odp-title",
									children: t("title")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "odp-subtitle",
									children: t("subtitle")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "odp-spacer" }),
							view.staleText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "odp-badgeWarn",
								children: view.staleText
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "odp-dashboardActions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "odp-action",
									type: "button",
									disabled: state.loading,
									onClick: () => props.panelRefresh(),
									children: state.loading ? t("refreshing") : t("refresh")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "odp-action",
									type: "button",
									"aria-label": t("close"),
									title: t("close"),
									onClick: () => props.panelClose(),
									children: "×"
								})]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "odp-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "odp-block",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										className: "odp-blockTitle",
										children: t("title")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "odp-planRow",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "odp-planName",
												children: view.tierText
											}),
											view.statusText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "odp-badgeMuted",
												children: view.statusText
											}),
											view.balanceText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "odp-badge",
												children: view.balanceText
											})
										]
									}),
									view.periodText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "odp-hint",
										children: view.periodText
									}),
									view.fetchedText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "odp-hint",
										children: view.fetchedText
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "odp-windows",
								children: view.windows.map((window) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WindowRow, { window }, window.kind))
							}),
							view.emptyText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "odp-hint",
								children: view.emptyText
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "odp-block",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "odp-hint",
									children: view.explainerText
								}), view.fundingText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "odp-hint",
									children: view.fundingText
								})]
							}),
							view.loadFailedText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "odp-error",
								children: view.loadFailedText
							})
						]
					})]
				})
			});
		}
		//#endregion
		//#region src/client/analytics-locales.ts
		/** Chinese copy. */
		const zh = {
			nav: "模型分析",
			title: "模型分析",
			intro: "按最近会话或日期范围读取本机历史，比较模型用量、速度、失败与重试；只读历史，不发起模型请求。",
			filterRecent: "最近会话",
			filterRange: "日期范围",
			recentSessions: "会话数（1–100）",
			from: "开始日期",
			to: "结束日期",
			read: "读取",
			reading: "读取中…",
			loading: "正在读取本机历史…",
			unavailable: "当前宿主没有挂载会话历史查询服务，无法读取历史；模型对话本身不受影响。",
			failed: "读取失败，请稍后重试。",
			empty: "这段历史里没有 Open Design 的模型请求。",
			readFailed: "读取失败，下面的结果可能已过期。",
			invalidRange: "日期范围无效：开始日必须不晚于结束日，且跨度不超过 366 天。",
			columnModel: "模型",
			columnRequests: "请求数",
			columnTokens: "Tokens",
			columnFirstToken: "首字延迟",
			columnDuration: "总时长",
			columnFailureRate: "失败率",
			columnRetries: "重试数",
			columnCost: "成本档位",
			columnCapability: "能力档",
			summaryRequests: "请求",
			summarySessions: "会话",
			summaryTokens: "Token 总量",
			summaryFirstToken: "平均首字延迟",
			summaryDuration: "平均总时长",
			summaryFailureRate: "失败率",
			summaryRetries: "重试",
			summaryCoverage: "用量覆盖率",
			costLow: "低",
			costMedium: "中",
			costHigh: "高",
			costUnknown: "未知",
			capabilityStandard: "标准",
			capabilityAdvanced: "高级",
			capabilityUnknown: "未知",
			missing: "缺失",
			msUnit: "毫秒",
			historyUnsupported: "宿主未提供历史查询服务，本次没有任何历史可读。",
			historyUnreadable: "历史查询服务读取失败，本次结果不完整。",
			truncated: "历史读取达到上限，结果不完整（最多 100 个会话、20 万个事件）。",
			partialUsage: "有请求未上报用量，缺失部分不计入 Token 合计。",
			unknownModels: "有模型不在当前目录中，成本档位与能力档标为未知。",
			costNote: "成本档位来自目录的 low/medium/high 词，只表示档位，不含任何金额。"
		};
		/** English copy, key-for-key with {@link zh}. */
		const en = {
			nav: "Model analytics",
			title: "Model analytics",
			intro: "Read local history for a recent-session count or a date range to compare model usage, speed, failures and retries. History is read-only; no model request is sent.",
			filterRecent: "Recent sessions",
			filterRange: "Date range",
			recentSessions: "Sessions (1–100)",
			from: "From",
			to: "To",
			read: "Read",
			reading: "Reading…",
			loading: "Reading local history…",
			unavailable: "This Host mounts no session-history query service, so history cannot be read. Conversations themselves are unaffected.",
			failed: "The read failed. Try again.",
			empty: "This history contains no Open Design model requests.",
			readFailed: "The read failed; the result below may be out of date.",
			invalidRange: "Invalid date range: the start must not be after the end, and the span must not exceed 366 days.",
			columnModel: "Model",
			columnRequests: "Requests",
			columnTokens: "Tokens",
			columnFirstToken: "First token",
			columnDuration: "Duration",
			columnFailureRate: "Failure rate",
			columnRetries: "Retries",
			columnCost: "Cost tier",
			columnCapability: "Capability",
			summaryRequests: "Requests",
			summarySessions: "Sessions",
			summaryTokens: "Total tokens",
			summaryFirstToken: "Avg first token",
			summaryDuration: "Avg duration",
			summaryFailureRate: "Failure rate",
			summaryRetries: "Retries",
			summaryCoverage: "Usage coverage",
			costLow: "Low",
			costMedium: "Medium",
			costHigh: "High",
			costUnknown: "Unknown",
			capabilityStandard: "Standard",
			capabilityAdvanced: "Advanced",
			capabilityUnknown: "Unknown",
			missing: "Missing",
			msUnit: "ms",
			historyUnsupported: "The Host offers no history query service, so this read has no history.",
			historyUnreadable: "The history query service failed, so this result is incomplete.",
			truncated: "The history read hit its limit and is incomplete (at most 100 sessions and 200,000 events).",
			partialUsage: "Some requests reported no usage; the missing part is not counted as tokens.",
			unknownModels: "Some models are not in the current catalog, so their cost tier and capability are unknown.",
			costNote: "The cost tier is the catalog low/medium/high word. It is a tier only and carries no amount."
		};
		//#endregion
		//#region src/client/analytics.ts
		const DAY_MS = 864e5;
		const MAX_RANGE_DAYS = 366;
		const MIN_RECENT_SESSIONS = 1;
		const MAX_RECENT_SESSIONS = 100;
		const DEFAULT_RECENT_SESSIONS = 20;
		/** `Date#getTimezoneOffset`-style shift of one instant into local wall time. */
		function toLocalWall(epochMs, offsetMinutes) {
			return /* @__PURE__ */ new Date(epochMs - offsetMinutes * 6e4);
		}
		/** Format one instant as a local calendar day (`YYYY-MM-DD`). */
		function localDay(epochMs, offsetMinutes) {
			const wall = toLocalWall(epochMs, offsetMinutes);
			return `${wall.getUTCFullYear()}-${String(wall.getUTCMonth() + 1).padStart(2, "0")}-${String(wall.getUTCDate()).padStart(2, "0")}`;
		}
		/** Parse one `YYYY-MM-DD` into a local-midnight epoch, or undefined. */
		function dayStartEpoch(text, offsetMinutes) {
			const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
			if (match === null) return void 0;
			const year = Number(match[1]);
			const month = Number(match[2]);
			const day = Number(match[3]);
			const utc = Date.UTC(year, month - 1, day);
			const roundTrip = new Date(utc);
			if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) return;
			return utc + offsetMinutes * 6e4;
		}
		/** Clamp a draft session count; a non-numeric draft keeps the previous value. */
		function clampSessions(text, previous) {
			const parsed = Number(text);
			if (!Number.isInteger(parsed)) return previous;
			return Math.min(MAX_RECENT_SESSIONS, Math.max(MIN_RECENT_SESSIONS, parsed));
		}
		/**
		* The analytics page controller. One submitted filter, one in-flight read.
		*/
		var OpenDesignAnalyticsController = class {
			resolveApi;
			now;
			offsetMinutes;
			store;
			/** Monotonic read id; a slower earlier read must not overwrite a newer one. */
			generation = 0;
			constructor(resolveApi, options = {}) {
				this.resolveApi = resolveApi;
				this.now = options.now ?? Date.now;
				this.offsetMinutes = options.localOffsetMinutes ?? new Date(this.now()).getTimezoneOffset();
				const today = localDay(this.now(), this.offsetMinutes);
				const from = localDay(this.now() - 6 * DAY_MS, this.offsetMinutes);
				this.store = createSnapshotStore({
					status: "idle",
					mode: "recent",
					recentSessions: DEFAULT_RECENT_SESSIONS,
					rangeFrom: from,
					rangeTo: today
				});
			}
			/** The current page state. */
			state() {
				return this.store.getSnapshot();
			}
			/** Reactive face the React page consumes. */
			getSnapshot() {
				return this.store.getSnapshot();
			}
			subscribe(listener) {
				return this.store.subscribe(listener);
			}
			/** No timers or sockets to release; kept for the slot's disposer shape. */
			dispose() {}
			setMode(mode) {
				const state = this.state();
				if (mode === state.mode) return;
				this.commit({
					...state,
					mode
				});
			}
			setRecentSessions(text) {
				const state = this.state();
				this.commit({
					...state,
					recentSessions: clampSessions(text, state.recentSessions)
				});
			}
			setRangeFrom(text) {
				this.commit({
					...this.state(),
					rangeFrom: text
				});
			}
			setRangeTo(text) {
				this.commit({
					...this.state(),
					rangeTo: text
				});
			}
			/**
			* Submit the current draft as one history read.
			* @returns the state after the read settles.
			*/
			async refresh() {
				const api = this.resolveApi();
				if (api === void 0) return this.commit({
					...this.state(),
					status: "unavailable",
					notice: void 0
				});
				const scope = this.submittedScope();
				if (scope === void 0) return this.commit({
					...this.state(),
					status: "failed",
					notice: "invalidRange"
				});
				const generation = ++this.generation;
				const current = () => generation === this.generation;
				this.commit({
					...this.state(),
					status: "loading",
					notice: void 0
				});
				let answer;
				try {
					answer = await api.analytics({ scope });
				} catch {
					return current() ? this.commit({
						...this.state(),
						status: "failed",
						notice: "readFailed"
					}) : this.state();
				}
				if (!current()) return this.state();
				if (!answer.ok) return this.commit({
					...this.state(),
					status: "failed",
					notice: "readFailed"
				});
				return this.commit({
					...this.state(),
					status: "ready",
					report: answer.value,
					notice: void 0
				});
			}
			/** Turn the draft into the wire scope, or undefined when it is invalid. */
			submittedScope() {
				const state = this.state();
				if (state.mode === "recent") return {
					kind: "recent",
					sessions: state.recentSessions
				};
				const from = dayStartEpoch(state.rangeFrom, this.offsetMinutes);
				const to = dayStartEpoch(state.rangeTo, this.offsetMinutes);
				if (from === void 0 || to === void 0) return void 0;
				const end = to + DAY_MS;
				if (end <= from || end - from > MAX_RANGE_DAYS * DAY_MS) return void 0;
				return {
					kind: "range",
					from,
					to: end
				};
			}
			commit(next) {
				this.store.set(next);
				return next;
			}
		};
		//#endregion
		//#region src/client/analytics-view.ts
		const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
		/** Group digits without ever looking like a currency. */
		function withGrouping(value) {
			return NUMBER_FORMAT.format(value);
		}
		/** Percent from a part/whole pair; `undefined` when there is no whole. */
		function percent(part, whole) {
			return whole === 0 ? void 0 : `${Math.round(part / whole * 100)}%`;
		}
		/** Milliseconds plus the translated unit. */
		function milliseconds(value, t) {
			return value === void 0 ? t("missing") : `${withGrouping(value)} ${t("msUnit")}`;
		}
		/** Cost tier → its label key. */
		function costKey(row) {
			switch (row.cost) {
				case "low": return "costLow";
				case "medium": return "costMedium";
				case "high": return "costHigh";
				default: return "costUnknown";
			}
		}
		/** Capability tier → its label key. */
		function capabilityKey(row) {
			switch (row.capability) {
				case "standard": return "capabilityStandard";
				case "advanced": return "capabilityAdvanced";
				default: return "capabilityUnknown";
			}
		}
		/** The fixed comparison headers. */
		function columns(t) {
			return [
				{
					key: "model",
					label: t("columnModel")
				},
				{
					key: "requests",
					label: t("columnRequests")
				},
				{
					key: "tokens",
					label: t("columnTokens")
				},
				{
					key: "firstToken",
					label: t("columnFirstToken")
				},
				{
					key: "duration",
					label: t("columnDuration")
				},
				{
					key: "failureRate",
					label: t("columnFailureRate")
				},
				{
					key: "retries",
					label: t("columnRetries")
				},
				{
					key: "cost",
					label: t("columnCost")
				},
				{
					key: "capability",
					label: t("columnCapability")
				}
			];
		}
		/** Project one model row. */
		function viewRow(row, t) {
			const tokens = row.requestsWithUsage === 0 ? t("missing") : withGrouping(row.totalTokens);
			return {
				model: row.model,
				name: row.name,
				cells: {
					model: row.name,
					requests: withGrouping(row.requests),
					tokens,
					firstToken: milliseconds(row.avgFirstTokenMs, t),
					duration: milliseconds(row.avgDurationMs, t),
					failureRate: percent(row.failed, row.requests) ?? t("missing"),
					retries: withGrouping(row.retries),
					cost: t(costKey(row)),
					capability: t(capabilityKey(row))
				}
			};
		}
		/** The summary block above the table. */
		function summary(report, t) {
			const totals = report.totals;
			const coverage = totals.requests === 0 ? t("missing") : `${withGrouping(totals.requestsWithUsage)}/${withGrouping(totals.requests)}`;
			return [
				{
					key: "requests",
					label: t("summaryRequests"),
					value: withGrouping(totals.requests)
				},
				{
					key: "sessions",
					label: t("summarySessions"),
					value: withGrouping(totals.sessions)
				},
				{
					key: "tokens",
					label: t("summaryTokens"),
					value: totals.requestsWithUsage === 0 ? t("missing") : withGrouping(totals.totalTokens)
				},
				{
					key: "firstToken",
					label: t("summaryFirstToken"),
					value: milliseconds(totals.avgFirstTokenMs, t)
				},
				{
					key: "duration",
					label: t("summaryDuration"),
					value: milliseconds(totals.avgDurationMs, t)
				},
				{
					key: "failureRate",
					label: t("summaryFailureRate"),
					value: percent(totals.failed, totals.requests) ?? t("missing")
				},
				{
					key: "retries",
					label: t("summaryRetries"),
					value: withGrouping(totals.retries)
				},
				{
					key: "coverage",
					label: t("summaryCoverage"),
					value: coverage
				}
			];
		}
		/** Which top-level status the view lands on. */
		function viewStatus(state) {
			if (state.status === "loading" || state.status === "unavailable" || state.status === "failed") return state.status;
			if (state.report === void 0) return state.status === "ready" ? "empty" : "idle";
			return state.report.totals.requests === 0 ? "empty" : "ready";
		}
		/**
		* Build every rendered string from the page state.
		* @param input - page state and bound translate function.
		* @returns the complete view model.
		*/
		function buildAnalyticsView(input) {
			const { state, t } = input;
			const report = state.report;
			const status = viewStatus(state);
			const notices = [];
			if (state.status === "loading") notices.push(t("loading"));
			if (state.status === "unavailable") notices.push(t("unavailable"));
			if (state.status === "failed") notices.push(state.notice === "invalidRange" ? t("invalidRange") : t("readFailed"));
			if (report !== void 0) {
				if (!report.history.available) notices.push(report.history.reason === "unreadable" ? t("historyUnreadable") : t("historyUnsupported"));
				if (report.history.truncated) notices.push(t("truncated"));
				if (report.totals.requestsWithoutUsage > 0) notices.push(t("partialUsage"));
				if (report.models.some((row) => row.cost === "unknown")) notices.push(t("unknownModels"));
				if (report.totals.requests === 0) notices.push(t("empty"));
			}
			return {
				status,
				title: t("title"),
				intro: t("intro"),
				notices,
				summary: report === void 0 ? [] : summary(report, t),
				columns: columns(t),
				rows: report === void 0 ? [] : report.models.map((row) => viewRow(row, t)),
				footnote: t("costNote")
			};
		}
		//#endregion
		//#region src/client/analytics-section.tsx
		/**
		* The Open Design analytics page (`settings.section`, id `opendesign-analytics`).
		*
		* A thin projection of {@link OpenDesignAnalyticsController} and
		* {@link buildAnalyticsView}: the filter is a draft until "read" is pressed,
		* and every rendered string comes from the locale namespace, so the page never
		* assembles copy and never formats a monetary value.
		*
		* @module dsh-opendesign-provider/client/analytics-section
		*/
		/** The analytics page. */
		function OpenDesignAnalyticsPage(props) {
			const { t } = props;
			const state = (0, react.useSyncExternalStore)(props.store.subscribe, props.store.getSnapshot, props.store.getSnapshot);
			const view = buildAnalyticsView({
				state,
				t
			});
			const busy = state.status === "loading";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "od-section",
				"aria-label": view.title,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: "od-title",
						children: view.title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "od-intro",
						children: view.intro
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "od-group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "od-groupHead",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: "od-groupTitle",
								children: t("filterRecent")
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "od-analyticsFilters",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "od-analyticsModes",
									role: "group",
									"aria-label": t("title"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: state.mode === "recent" ? "od-modeButton od-modeButtonActive" : "od-modeButton",
										type: "button",
										"aria-pressed": state.mode === "recent",
										onClick: () => props.setMode("recent"),
										children: t("filterRecent")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: state.mode === "range" ? "od-modeButton od-modeButtonActive" : "od-modeButton",
										type: "button",
										"aria-pressed": state.mode === "range",
										onClick: () => props.setMode("range"),
										children: t("filterRange")
									})]
								}),
								state.mode === "recent" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "od-analyticsField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "od-label",
										children: t("recentSessions")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "od-input od-analyticsNumber",
										type: "number",
										min: 1,
										max: 100,
										value: String(state.recentSessions),
										disabled: busy,
										onChange: (event) => props.setRecentSessions(event.target.value)
									})]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "od-analyticsField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "od-label",
										children: t("from")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "od-input",
										type: "date",
										value: state.rangeFrom,
										disabled: busy,
										onChange: (event) => props.setRangeFrom(event.target.value)
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "od-analyticsField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "od-label",
										children: t("to")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "od-input",
										type: "date",
										value: state.rangeTo,
										disabled: busy,
										onChange: (event) => props.setRangeTo(event.target.value)
									})]
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "od-linkButton",
									type: "button",
									disabled: busy,
									onClick: () => void props.refresh(),
									children: busy ? t("reading") : t("read")
								})
							]
						})]
					}),
					view.notices.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "od-analyticsNotices",
						children: view.notices.map((notice) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "od-hint",
							children: notice
						}, notice))
					}),
					view.summary.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "od-analyticsSummary",
						children: view.summary.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "od-analyticsStat",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "od-analyticsStatLabel",
								children: item.label
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "od-analyticsStatValue",
								children: item.value
							})]
						}, item.key))
					}),
					view.rows.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "od-group od-groupDivided",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "od-analyticsTableWrap",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "od-analyticsTable",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: view.columns.map((column) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
									scope: "col",
									children: column.label
								}, column.key)) }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: view.rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: view.columns.map((column) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									"data-column": column.key,
									title: row.name,
									children: row.cells[column.key]
								}, column.key)) }, row.model)) })]
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "od-hint",
							children: view.footnote
						})]
					}),
					view.rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "od-hint",
						children: view.footnote
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Install one stylesheet by id and return a disposer for its owning effect. */
		function injectCss(id, css) {
			if (typeof document === "undefined") return () => {};
			if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = "@mars-sea/dsh-opendesign-provider";
			tag.dataset.pluginCss = id;
			tag.textContent = css;
			document.head.appendChild(tag);
			return () => tag.remove();
		}
		/**
		* The one client-face contribution: every Host descriptor lives under the same
		* package, so they mount together — the Gateway merges the `opendesign`
		* namespace once, and no half can land without the others.
		*/
		const CLIENT_REMOTE_CONTRIBUTION = {
			package: MODELS_REMOTE_CONTRIBUTION.package,
			descriptors: [
				...MODELS_REMOTE_CONTRIBUTION.descriptors,
				...QUOTA_REMOTE_CONTRIBUTION.descriptors,
				...ANALYTICS_REMOTE_CONTRIBUTION.descriptors
			]
		};
		/** Client plugin body. */
		function apply(ctx) {
			const removeCss = injectCss(PAGE_CSS_ID, PAGE_CSS);
			ctx.effect(() => removeCss, "dsh-opendesign-provider: page styles");
			ctx.effect(() => ctx.locale.register(SETTINGS_LOCALE_NS, {
				zh: zh$1,
				en: en$1
			}), "dsh-opendesign-provider: page copy");
			ctx.effect(() => ctx.locale.register(PANEL_LOCALE_NS, {
				zh: ZH,
				en: EN
			}), "dsh-opendesign-provider: panel copy");
			const removePanelCss = injectCss(PANEL_CSS_ID, PANEL_CSS);
			ctx.effect(() => removePanelCss, "dsh-opendesign-provider: panel styles");
			ctx.effect(() => ctx.locale.register(ANALYTICS_LOCALE_NS, {
				zh,
				en
			}), "dsh-opendesign-provider: analytics copy");
			let settingsNamespace;
			let credentialsNamespace;
			let modelsNamespace;
			let analyticsNamespace;
			const scope = createSettingsScope(ctx, NS, () => settingsNamespace);
			ctx.effect(() => () => {
				scope.dispose();
			}, "dsh-opendesign-provider: settings scope");
			const credentials = {
				async describe(refs) {
					return credentialsNamespace?.describe(refs) ?? {
						ok: false,
						error: { message: "credentials remote is not mounted" }
					};
				},
				async set(ref, value) {
					return credentialsNamespace?.set(ref, value) ?? {
						ok: false,
						error: { message: "credentials remote is not mounted" }
					};
				},
				async unset(ref) {
					return credentialsNamespace?.unset(ref) ?? {
						ok: false,
						error: { message: "credentials remote is not mounted" }
					};
				}
			};
			const models = { async models() {
				const answer = await modelsNamespace?.models?.();
				if (answer !== void 0) return answer.ok ? {
					ok: true,
					value: answer.value
				} : { ok: false };
				return {
					ok: false,
					error: { message: "opendesign/models remote is not mounted" }
				};
			} };
			const loadQuota = async () => {
				const usage = modelsNamespace?.usage;
				if (usage === void 0) return {
					ok: false,
					error: { message: "opendesign/usage remote is not mounted" }
				};
				return usage();
			};
			const controller = new OpenDesignSettingsController(scope, credentials, models);
			ctx.effect(() => () => controller.dispose(), "dsh-opendesign-provider: settings controller");
			const analytics = new OpenDesignAnalyticsController(() => {
				const namespace = analyticsNamespace;
				if (namespace?.analytics === void 0) return void 0;
				return { analytics: (query) => namespace.analytics(query) };
			});
			ctx.effect(() => () => analytics.dispose(), "dsh-opendesign-provider: analytics controller");
			const settingsStore = {
				getSnapshot: () => controller.state(),
				subscribe: (listener) => controller.subscribe(listener)
			};
			const selectPanel = (panelId) => {
				const select = ctx.get("layout")?.selectPanel;
				if (typeof select !== "function") return;
				try {
					select(panelId);
				} catch {
					if (panelId !== null) return;
					try {
						select("conversation");
					} catch {}
				}
			};
			const panel = new OpenDesignQuotaPanelController({
				load: loadQuota,
				settings: settingsStore,
				selectPanel
			});
			ctx.effect(() => () => panel.dispose(), "dsh-opendesign-provider: quota panel controller");
			const panelStore = {
				getSnapshot: () => panel.state(),
				subscribe: (listener) => panel.subscribe(listener)
			};
			const panelFace = () => ({
				panelStore,
				panelState: () => panel.state(),
				panelOpen: () => panel.openPanel(),
				panelClose: () => panel.closePanel(),
				panelRefresh: () => {
					panel.refresh(true);
				},
				panelLocale: () => ctx.locale.getLocale().active === "en" ? "en" : "zh"
			});
			ctx.inject(["remote.settings"], (settingsCtx) => {
				settingsNamespace = settingsCtx.remote.settings;
				scope.refresh();
				settingsCtx.effect(() => () => {
					settingsNamespace = void 0;
				}, "dsh-opendesign-provider: settings namespace");
			});
			ctx.inject(["remote.credentials"], (credentialsCtx) => {
				credentialsNamespace = credentialsCtx.remote.credentials;
				controller.refreshCredentials();
				credentialsCtx.effect(() => () => {
					credentialsNamespace = void 0;
				}, "dsh-opendesign-provider: credentials namespace");
			});
			const remote = ctx.remote;
			ctx.effect(() => {
				let cancelled = false;
				let unmount;
				remote.$mount(CLIENT_REMOTE_CONTRIBUTION).then((dispose) => {
					if (cancelled) {
						dispose();
						return;
					}
					unmount = dispose;
					ctx.inject(["remote.opendesign"], (modelsCtx) => {
						const namespace = modelsCtx.remote.opendesign;
						modelsNamespace = namespace;
						analyticsNamespace = namespace;
						controller.refreshModels();
						panel.refresh(true);
						modelsCtx.effect(() => () => {
							modelsNamespace = void 0;
							analyticsNamespace = void 0;
						}, "dsh-opendesign-provider: models namespace");
					});
				}).catch((error) => {
					console.error("[dsh-opendesign-provider] could not mount opendesign remotes:", error);
				});
				return () => {
					cancelled = true;
					unmount?.();
				};
			}, "dsh-opendesign-provider: models remote");
			const pageFace = () => ({
				settingsStore,
				state: () => controller.state(),
				cardMode: () => cardMode(controller.state()),
				edit: (field, text) => controller.edit(field, text),
				resetField: (field) => controller.resetField(field),
				toggleModel: (id) => controller.toggleModel(id),
				editContextWindow: (text) => controller.editContextWindow(text),
				editContextOverride: (model, text) => controller.editContextOverride(model, text),
				setLanguage: (language) => controller.setLanguage(language),
				setShowSidebarQuota: (value) => controller.setShowSidebarQuota(value),
				setKey: (value) => controller.setKey(value),
				clearKey: () => controller.clearKey(),
				save: () => controller.save(),
				discard: () => controller.discard(),
				diagnosticText: () => controller.diagnosticText(),
				refresh: () => controller.refresh()
			});
			const analyticsFace = () => ({
				store: {
					getSnapshot: () => analytics.state(),
					subscribe: (listener) => analytics.subscribe(listener)
				},
				setMode: (mode) => analytics.setMode(mode),
				setRecentSessions: (text) => analytics.setRecentSessions(text),
				setRangeFrom: (text) => analytics.setRangeFrom(text),
				setRangeTo: (text) => analytics.setRangeTo(text),
				refresh: () => analytics.refresh()
			});
			ctx.slots.inject("settings.section", () => [ctx.slots.register({
				name: "settings.section",
				id: SETTINGS_SECTION_ID,
				order: 12,
				label: () => ctx.locale.bind(SETTINGS_LOCALE_NS)("nav"),
				locale: SETTINGS_LOCALE_NS,
				inject: pageFace
			}, OpenDesignSettingsPage), ctx.slots.register({
				name: "settings.section",
				id: ANALYTICS_SECTION_ID,
				order: 13,
				label: () => ctx.locale.bind(ANALYTICS_LOCALE_NS)("nav"),
				locale: ANALYTICS_LOCALE_NS,
				inject: analyticsFace
			}, OpenDesignAnalyticsPage)]);
			ctx.slots.inject("settings.models.provider-card", () => ctx.slots.register({
				name: "settings.models.provider-card",
				key: MODEL_CARD_KEY,
				locale: SETTINGS_LOCALE_NS,
				inject: () => pageFace()
			}, OpenDesignProviderCard));
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: PANEL_LOCALE_NS,
				inject: () => panelFace()
			}, OpenDesignQuotaDashboard));
			ctx.inject(["layout"], () => {
				ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
					name: "sidebar.footer.action",
					id: PANEL_ID,
					order: 1,
					locale: PANEL_LOCALE_NS,
					inject: () => panelFace()
				}, OpenDesignQuotaCard));
			});
		}
		const inject = [
			"slots",
			"locale",
			"remote"
		];
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map