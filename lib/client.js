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
		/** The Cordis service key the Gateway resolves those Remotes from. */
		const REMOTE_SERVICE = "opendesignUsage";
		/** The settings-page slot id (`settings.section`). */
		const SETTINGS_SECTION_ID = "opendesign";
		/** Locale namespace both browser surfaces declare for their copy. */
		const SETTINGS_LOCALE_NS = "settings.opendesign";
		/** The Models-page provider-card key (`settings.models.provider-card`). */
		const MODEL_CARD_KEY = "llm-opendesign";
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
		/**
		* Build one strict invocation descriptor. Every Open Design Remote shares the
		* `opendesign` namespace, the `opendesignUsage` service, and a strict result
		* — only the endpoint, method, result type symbol, and schema differ.
		*/
		function makeRemoteDescriptor(endpoint, method, typeSymbol, schema) {
			return {
				id: `${REMOTE_PACKAGE}#${endpoint}`,
				service: REMOTE_SERVICE,
				namespace: REMOTE_NAMESPACE,
				method,
				invocation: { kind: "direct" },
				parameters: [],
				result: makeStrictCodec(typeSymbol, schema)
			};
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
		/** The Client-face contribution it mounts. */
		const MODELS_REMOTE_CONTRIBUTION = {
			package: REMOTE_PACKAGE,
			descriptors: [makeRemoteDescriptor(MODELS_ENDPOINT, "models", `${REMOTE_PACKAGE}#OpenDesignModelsReport`, { parse: parseModelsReport })]
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
				if (this.modelsChanged || this.overridesChanged || this.languageChanged) return true;
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
		const zh = {
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
			quotaComing: "额度卡开关将在 P1 额度功能中提供。",
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
		const en = {
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
			quotaComing: "The quota card toggle arrives with the P1 quota feature.",
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
				className: "cc-field",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "cc-fieldHead",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "cc-label",
							children: props.label
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: error === void 0 ? "cc-input" : "cc-input cc-inputInvalid",
						type: props.type ?? "text",
						value: props.draft.text,
						placeholder: props.placeholder,
						disabled: props.disabled,
						onChange: (event) => props.onChange(event.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "cc-hint",
						children: props.hint
					}),
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "cc-rowError",
						children: error
					})
				]
			});
		}
		/** One catalog model checkbox with its uncalibrated mark. */
		function ModelRow(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "cc-checkRow",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "cc-check",
						type: "checkbox",
						checked: props.model.visible,
						disabled: props.disabled,
						onChange: props.onToggle
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "cc-checkName",
						children: props.model.name
					}),
					props.model.calibrated ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "cc-badgeWarn",
						children: props.t("uncalibrated")
					})
				]
			});
		}
		/** One per-model context-window override row. */
		function ContextRow(props) {
			const error = fieldError(props.t, props.row);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "cc-contextItem",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "cc-label",
						children: props.modelName
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: error === void 0 ? "cc-input cc-contextValue" : "cc-input cc-contextValue cc-inputInvalid",
						type: "text",
						inputMode: "numeric",
						value: props.row.text,
						disabled: props.disabled,
						onChange: (event) => props.onChange(event.target.value)
					}),
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "cc-rowError cc-contextError",
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
				className: "cc-section",
				"aria-label": t("title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: "cc-title",
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "cc-intro",
						children: t("intro")
					}),
					state.writable ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "cc-readOnly",
						children: t("readOnly")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "cc-group",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "cc-groupHead",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "cc-groupTitle",
									children: t("connection")
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cc-groupDesc",
								children: t("connectionDesc")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cc-rows",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "cc-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "cc-rowText",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "cc-rowTitleLine",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "cc-rowTitle",
													children: t("apiKey")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: state.apiKeyConfigured ? "cc-badge" : "cc-badgeMuted",
													children: state.apiKeyConfigured ? t("apiKeySet") : state.apiKeyKnown ? t("apiKeyUnset") : t("apiKeyUnknown")
												})]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "cc-rowDesc",
												children: t("apiKeyHint")
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "cc-rowControl",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "cc-input cc-rowInputWide",
												type: "password",
												autoComplete: "off",
												value: state.keyDraft,
												placeholder: t("apiKeyPlaceholder"),
												disabled: disabled || !state.apiKeyWritable,
												onChange: (event) => props.setKey(event.target.value)
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "cc-linkButton",
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
										className: "cc-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "cc-rowText",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "cc-rowTitle",
													children: t("loginStatus")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "cc-rowDesc",
													children: t("loginHint")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "cc-rowDesc",
													children: t("loginUse")
												})
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "cc-rowControl",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: state.loginStatus === "ok" ? "cc-badge" : "cc-badgeMuted",
												children: loginLabel
											})
										})]
									}),
									state.controlKeyWarning ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "cc-rowError",
										children: t("controlKeyWarn")
									}) : null
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "cc-group cc-groupDivided",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cc-groupHead",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "cc-groupTitle",
									children: t("modelsSection")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "cc-badgeMuted",
									children: catalogLabel
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cc-groupDesc",
								children: t("modelsSectionDesc")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cc-rows",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "cc-field",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "cc-fieldHead",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "cc-label",
													children: t("visibleModels")
												})
											}),
											state.models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "cc-hint",
												children: t("modelsSectionDesc")
											}) : state.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelRow, {
												t,
												model,
												disabled,
												onToggle: () => props.toggleModel(model.id)
											}, model.id)),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "cc-hint",
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
										className: "cc-field",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "cc-fieldHead",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "cc-label",
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
												className: "cc-hint",
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
						className: "cc-group cc-groupDivided",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "cc-groupHead",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "cc-groupTitle",
									children: t("displaySection")
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cc-groupDesc",
								children: t("displaySectionDesc")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cc-rows",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "cc-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "cc-rowText",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "cc-rowTitle",
											children: t("language")
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "cc-rowControl",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											className: "cc-input",
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
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "cc-hint",
									children: t("quotaComing")
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "cc-group cc-groupDivided",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "cc-groupHead",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "cc-groupTitle",
									children: t("advanced")
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cc-groupDesc",
								children: t("advancedDesc")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cc-rows",
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
										className: "cc-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "cc-rowText",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "cc-rowTitle",
												children: t("diagnostics")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "cc-rowDesc",
												children: t("diagnosticsHint")
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "cc-rowControl",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "cc-linkButton",
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
						className: "cc-saveBarDock",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "cc-saveBar cc-saveBarShown",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cc-saveBarText",
								children: state.notice === void 0 ? t("intro") : noticeText(t, state.notice.key)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cc-saveBarActions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "cc-saveBarButton cc-saveBarGhost",
									type: "button",
									disabled: state.saving,
									onClick: () => props.discard(),
									children: t("discard")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "cc-saveBarButton cc-saveBarPrimary",
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
				className: ok ? "cc-badge" : "cc-badgeMuted",
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
				className: "cc-providerCard",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "cc-hint",
					children: t("apiKeyUnknown")
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "cc-providerCard",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "cc-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "cc-rowText",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "cc-rowTitleLine",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "cc-rowTitle",
									children: t("cardTitle")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
									ok: keySet,
									children: keySet ? t("apiKeySet") : state.apiKeyKnown ? t("apiKeyUnset") : t("apiKeyUnknown")
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "cc-rowDesc",
								children: t("apiKeyHint")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "cc-rowControl",
							children: keySet ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "cc-linkButton",
								type: "button",
								disabled,
								onClick: () => {
									props.clearKey();
									props.save();
								},
								children: t("clearKey")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "cc-input cc-rowInput",
								type: "password",
								autoComplete: "off",
								value: paste,
								placeholder: t("apiKeyPlaceholder"),
								disabled: disabled || !state.apiKeyWritable,
								onChange: (event) => setPaste(event.target.value)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "cc-linkButton",
								type: "button",
								disabled: disabled || paste.trim() === "",
								onClick: save,
								children: t("cardSave")
							})] })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "cc-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "cc-rowText",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "cc-rowTitleLine",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "cc-rowTitle",
										children: t("cardCatalog")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "cc-badgeMuted",
										children: catalogLabel
									}),
									state.catalogCached ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "cc-badgeMuted",
										children: t("catalogCached")
									}) : null
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "cc-rowDesc",
								children: [state.catalogApiBase ?? "", state.catalogReason === void 0 ? "" : ` · ${t("catalogReason")}: ${state.catalogReason}`]
							})]
						}), uncalibrated > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "cc-rowControl",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "cc-badgeWarn",
								children: [
									t("cardUncalibrated"),
									" ",
									uncalibrated
								]
							})
						}) : null]
					}),
					state.controlKeyWarning ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "cc-hint",
						children: t("controlKeyWarn")
					}) : null,
					state.notice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: state.notice.kind === "error" ? "cc-rowError" : "cc-hint",
						children: noticeText(t, state.notice.key)
					})
				]
			});
		}
		//#endregion
		//#region src/client/page-styles.ts
		/**
		* Stylesheet for the Open Design settings page — and the Models-page provider
		* card, which shares its `cc-` classes.
		*
		* Returned as a string, not injected here, so importing this module has no DOM
		* side effect: `./index.ts` installs it once under {@link PAGE_CSS_ID}. It is a
		* module of its own rather than a literal in the entry so `tests/styles.test.ts`
		* can audit every rule without importing the React tree (which pulls
		* `*.module.css` through the primitives package and needs a loader registered
		* first). The rules are GLOBAL CSS, so containment is a contract (issue #48):
		* every selector is qualified by one of our own `cc-` classes. Colours are
		* harness theme aliases with neutral fallbacks, and the `cc-` prefix keeps
		* these clear of the panel's `ccp-` set.
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
		* `cc-groupDivided`), never the rows inside one, so a group's rows read as one
		* list. Selectors and buttons are
		* capsules (36px / 28px compact), inputs are
		* 32px with an 8px radius and a 0.5px border-l4 edge, a card is a 0.5px
		* border-l4 outline with a 16px radius, and a nested panel is a
		* bg-module-platform fill with a 12px radius. Errors use state-error-primary.
		*/
		const PAGE_CSS = `
.cc-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex}
.cc-title{margin:0;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px}
.cc-intro{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}
.cc-readOnly{margin:8px 0 0;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-tertiary));font-size:12px;line-height:18px}
.cc-spacer{flex:1}
.cc-group{flex-direction:column;display:flex;margin-top:28px}
.cc-groupDivided{margin-top:24px;padding-top:20px;border-top:.5px solid var(--dsw-alias-border-l2)}
.cc-groupHead{align-items:center;gap:8px;display:flex;min-height:28px;padding-bottom:4px}
.cc-groupTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.cc-groupDesc{margin:0 0 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.cc-rows>.cc-groupDesc{margin:0;padding:4px 0 0}
.cc-disclosure{width:100%;padding:0 0 4px;border:0;background:0 0;font:inherit;text-align:left;cursor:pointer;border-radius:6px}
.cc-disclosure:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.cc-rows{flex-direction:column;display:flex}
.cc-row{align-items:center;gap:8px;display:flex;padding:12px 0}
.cc-rowFlush{padding:0}
.cc-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:32px;display:flex}
.cc-rowTitleLine{align-items:center;gap:8px;display:flex;min-width:0}
.cc-rowTitle{min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.cc-rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.cc-rowDesc p{margin:0}
.cc-rowDesc p+p{margin-top:4px}
.cc-rowError{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.cc-rowControl{flex:none;align-items:center;justify-content:flex-end;gap:8px;display:inline-flex;max-width:60%}
.cc-rowInput{width:200px}
.cc-rowInputWide{width:280px}
.cc-linkButton{box-sizing:border-box;flex:none;align-items:center;display:inline-flex;height:28px;padding:0 10px;border:0;border-radius:14px;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.cc-linkButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.cc-linkButton:disabled{cursor:default;opacity:.4}
.cc-linkButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.cc-badges{align-items:center;gap:8px;display:inline-flex}
.cc-badge,.cc-badgeMuted{flex:none;align-items:center;display:inline-flex;white-space:nowrap;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:12px;font-weight:500;line-height:17px}
.cc-badge{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.cc-badgeMuted{border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}
.cc-badgeWarn{background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.cc-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.cc-field+.cc-field{border-top:.5px solid var(--dsw-alias-border-l2)}
.cc-fieldHead{align-items:center;gap:8px;display:flex}
.cc-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.cc-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:18px}
.cc-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.cc-reset:disabled{cursor:default;opacity:.4}
.cc-input{box-sizing:border-box;height:32px;min-width:0;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font:inherit;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.cc-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.cc-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.cc-input:disabled{opacity:.6;cursor:default}
.cc-inputInvalid{border-color:var(--dsw-alias-state-error-primary)}
.cc-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.cc-modelSelectAnchor{flex-direction:column;align-items:stretch;gap:6px;display:inline-flex;min-width:160px}
.cc-selector{box-sizing:border-box;align-items:center;gap:12px;display:inline-flex;height:36px;padding:0 14px;border:0;border-radius:18px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer}
.cc-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.cc-selector:disabled{cursor:default;opacity:.4}
.cc-selector:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.cc-selectorText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-selectorCaret{flex-shrink:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);width:6px;height:6px;margin-bottom:3px;transform:rotate(45deg)}
/* The search box sits inside the Menu anchor, so typing in it never trips
 * the Menu's outside-click close. */
.cc-modelSearch{width:100%}
.cc-modelSearch::-webkit-search-cancel-button{cursor:pointer}
.cc-checkRow{align-items:center;gap:8px;display:inline-flex;min-width:0}
.cc-checkRow:hover{cursor:pointer}
/* A hand-drawn box, not the platform's accent-color checkbox: the native
 * control's colours come from color-scheme, which the theme sets once at BOOT
 * and never re-applies in-session, so a native box can paint light-chrome white
 * on a dark page. The mark rides a brand-primary fill, so it takes the brand
 * foreground (the only pairing that survives dark mode's near-white brand), and
 * the outline is a border-l3 hairline because border-l2 leaves an unchecked box
 * invisible against the menu surface. */
.cc-check{box-sizing:border-box;appearance:none;flex-shrink:0;width:16px;height:16px;margin:0;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;background:0 0;position:relative}
.cc-check:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.cc-check:checked::after{content:'';position:absolute;top:3px;left:5px;width:3px;height:7px;border:solid var(--dsw-alias-label-primary-foreground,#fff);border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}
.cc-checkName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Modelled on the platform's own Switch primitive (ui-primitives
 * Switch.module.css): a 36x20 capsule padding its track by 2px and sliding a
 * 16px thumb across the 32px content box. Three things are load-bearing.
 * (1) corner-shape:round on BOTH track and thumb — the theme sets a global
 * superellipse corner shape, which squares a capsule's ends off around a round
 * thumb. (2) No literal colours: brand-primary INVERTS between the modes, so a
 * hardcoded white thumb vanishes on the checked track in dark mode; the brand
 * foreground is what the platform paints on that fill. (3) border-l3 as the
 * off track — border-l2 leaves it indistinguishable from the page. */
.cc-toggle{box-sizing:border-box;appearance:none;flex-shrink:0;width:36px;height:20px;margin:0;padding:2px;border:0;border-radius:10px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer;position:relative}
.cc-toggle:checked{background:var(--dsw-alias-brand-primary)}
.cc-toggle::after{content:'';display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}
.cc-toggle:checked::after{transform:translateX(16px)}
.cc-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.cc-toggle:disabled{cursor:default;opacity:.5}
.cc-chevron{flex-shrink:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);width:7px;height:7px;margin-right:6px;margin-bottom:3px;transform:rotate(45deg);transition:transform .15s ease}
.cc-chevronUp{transform:rotate(-135deg);margin-bottom:-3px}
.cc-accountMode{align-items:center;gap:4px;display:flex;margin:-4px 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.cc-accountList{flex-direction:column;gap:8px;display:flex}
.cc-accountList+.cc-addButton,.cc-accountList+.cc-addPanel{margin-top:8px}
.cc-accountItem{flex-direction:column;gap:10px;display:flex;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px}
.cc-accountItemActive{border-color:var(--dsw-static-neutral-bluish-400,var(--dsw-alias-border-l3))}
.cc-accountHead{align-items:center;gap:4px;display:flex;min-height:28px}
.cc-accountToggle{align-items:center;gap:8px;display:flex;flex:1;min-width:0;padding:0;background:0 0;border:0;color:inherit;cursor:pointer;font:inherit;text-align:left}
.cc-accountToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
.cc-accountName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.cc-iconButton{flex-shrink:0;align-items:center;justify-content:center;display:inline-flex;width:28px;height:28px;padding:0;background:0 0;border:0;border-radius:6px;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.cc-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cc-iconButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
/* Per-model context-length override rows (issue #86): the error wraps onto
   its own line beneath the select/input/remove trio. The three cells form a
   fixed column contract — flexible model, 112px value, 28px remove — and the
   cc-contextHead labels repeat the first two (plus the remove cell's width
   as a spacer) so they sit exactly over their columns. */
.cc-contextItem{align-items:center;gap:8px;display:flex;flex-wrap:wrap;padding:8px 0}
.cc-contextHead{align-items:center;gap:8px;display:flex;flex-wrap:wrap;padding:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.cc-contextHeadModel{flex:1;min-width:200px}
.cc-contextHeadValue{flex:none;width:112px}
.cc-contextHeadGap{flex:none;width:28px}
.cc-contextSelect{position:relative;display:block;flex:1;min-width:200px}
/* appearance:none swaps the platform arrow for the cc-contextCaret, shaped
   like cc-selectorCaret so every dropdown in the plugin opens with the same
   hand-drawn chevron. */
.cc-contextModel{box-sizing:border-box;appearance:none;-webkit-appearance:none;width:100%;padding-inline-end:26px;text-overflow:ellipsis;cursor:pointer}
.cc-contextCaret{position:absolute;inset-inline-end:12px;top:50%;width:6px;height:6px;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:translateY(-50%) rotate(45deg);pointer-events:none}
.cc-contextSelect:has(.cc-contextModel:disabled) .cc-contextCaret{opacity:.6}
.cc-contextValue{flex:none;width:112px}
.cc-contextError{flex-basis:100%}
/* Three dots from one element: the dot plus two box-shadow copies. */
.cc-kebab{width:3px;height:3px;border-radius:50%;corner-shape:round;background:currentColor;box-shadow:0 -5px 0 currentColor,0 5px 0 currentColor}
.cc-tabDot{flex-shrink:0;width:8px;height:8px;border-radius:50%;corner-shape:round}
.cc-tabDotOk{background:var(--dsw-alias-state-success-primary)}
.cc-tabDotBlank{background:0 0;border:0}
.cc-tabDotWarn{background:var(--dsw-alias-state-warn-primary,#d97706)}
.cc-tabDotError{background:var(--dsw-alias-state-error-primary)}
.cc-accountMeters{flex-wrap:wrap;gap:6px 20px;display:flex;padding-left:16px}
.cc-miniMeter{align-items:center;gap:8px;display:inline-flex;font-size:12px;line-height:18px}
.cc-miniMeterLabel{color:var(--dsw-alias-label-tertiary)}
.cc-miniMeterTrack{overflow:hidden;background:var(--dsw-alias-bg-module-platform);border-radius:999px;width:64px;height:4px}
.cc-miniMeterFill{display:block;background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%}
.cc-miniMeterValue{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cc-accountSetup,.cc-loginStatus{flex-direction:column;gap:8px;display:flex;padding-left:16px}
.cc-loginStatus{flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 12px}
.cc-loginStatus>p{margin:0;font-size:12px;line-height:18px}
.cc-accountDetails{container-type:inline-size;border-top:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:14px;display:flex;padding-top:12px}
.cc-inlineForm,.cc-confirmBar{flex-direction:column;gap:8px;display:flex}
.cc-inlineActions{align-items:center;gap:8px;display:flex}
.cc-confirmBar{border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;padding:12px 14px}
.cc-confirmText{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;line-height:22px}
.cc-dangerButton{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.cc-dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.cc-addButton{box-sizing:border-box;align-items:center;justify-content:center;gap:6px;display:flex;width:100%;height:44px;border:1px dashed var(--dsw-alias-border-l3);border-radius:16px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.cc-addButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.cc-addButton:disabled{cursor:default;opacity:.4}
.cc-addButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.cc-addGlyph{position:relative;width:12px;height:12px}
.cc-addGlyph::before,.cc-addGlyph::after{content:'';position:absolute;background:currentColor;border-radius:1px}
.cc-addGlyph::before{left:0;right:0;top:5.25px;height:1.5px}
.cc-addGlyph::after{top:0;bottom:0;left:5.25px;width:1.5px}
.cc-addPanel{flex-direction:column;gap:12px;display:flex;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
.cc-panelTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.cc-accountReport{flex-direction:column;gap:14px;display:flex}
.cc-usageHead{align-items:center;gap:8px;display:flex}
.cc-usageTitle{color:var(--dsw-alias-label-primary);flex:1;margin:0;font-size:14px;font-weight:500;line-height:22px}
.cc-usageAccount{max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.cc-usagePlan{flex:none;white-space:nowrap;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:999px;corner-shape:round;padding:0 7px;font-size:12px;font-weight:500;line-height:17px}
.cc-usagePlanStatus{flex:none;margin:0;white-space:nowrap;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.cc-usageHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
/* Two fixed grids, not one auto-fit track: auto-fit wrapped the four activity
 * tiles 3 + 1 at the details' width. The activity row folds to 2 × 2 in a
 * narrow details panel. */
.cc-usageStats{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;display:grid}
.cc-usageStatsActivity{grid-template-columns:repeat(4,minmax(0,1fr))}
.cc-usageStatsBalance{grid-template-columns:repeat(3,minmax(0,1fr))}
@container (max-width:460px){.cc-usageStatsActivity{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cc-usageStat{min-width:0;flex-direction:column;gap:2px;display:flex;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
.cc-usageStatLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.cc-usageStatValue{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px;font-variant-numeric:tabular-nums}
.cc-usageStatSub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-usageWindows{flex-direction:column;gap:14px;display:flex}
.cc-usageWindow{flex-direction:column;gap:6px;display:flex}
.cc-usageWindowHead{align-items:baseline;gap:8px;display:flex}
.cc-usageWindowLabel{color:var(--dsw-alias-label-secondary);flex:1;font-size:12px;line-height:18px}
.cc-usageWindowValue{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.cc-usageExceeded{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.cc-usageBar{overflow:hidden;background:var(--dsw-alias-bg-module-platform);border-radius:999px;height:4px}
.cc-usageBarFill{background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.cc-usageBarFillWarn{background:var(--dsw-alias-state-error-primary)}
.cc-usageWindowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.cc-usageMeta{align-items:center;gap:8px;display:flex}
.cc-usageMetaSpacer{flex:1}
.cc-usageUpdated{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.cc-usagePartial{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.cc-usageBlocked{border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.cc-usageBlockedTitle{color:var(--dsw-alias-state-error-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}
.cc-usageBlockedHint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}
.cc-usageBlockedDetail{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;word-break:break-word}
.cc-version{margin:32px 0 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.cc-versionLink{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));text-decoration:none}
.cc-versionLink:hover{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-position:under}
.cc-providerCard{flex-direction:column;display:flex}
.cc-footer{justify-content:flex-end;align-items:center;gap:8px;display:flex}
.cc-failed{display:inline-block;max-width:260px;min-width:0;color:var(--dsw-alias-state-error-primary);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}
.cc-loginLink{color:var(--dsw-alias-link,var(--dsw-alias-brand-primary));text-decoration:none;font-size:12px;line-height:18px}
.cc-loginLink:hover{text-decoration:underline;text-underline-position:under}
.cc-loginDone{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary))}
.cc-loginError{color:var(--dsw-alias-state-error-primary)}
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
.cc-sectionWithBar{padding-bottom:80px}
.cc-saveBarDock{position:sticky;bottom:0;z-index:2;height:0;pointer-events:none}
.cc-saveBar{--cc-saveBar-tone:var(--dsw-alias-state-warn-primary,#d97706);position:absolute;left:50%;bottom:20px;box-sizing:border-box;width:max-content;max-width:calc(100% - 24px);align-items:center;gap:10px;display:flex;height:44px;padding:4px 4px 4px 16px;border:0;border-radius:22px;corner-shape:round;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 12px 32px -8px rgba(0,0,0,.24),0 2px 8px rgba(0,0,0,.08));opacity:0;visibility:hidden;transform:translate(-50%,12px);transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}
.cc-saveBarShown{opacity:1;visibility:visible;transform:translate(-50%,0);pointer-events:auto;transition:opacity .2s ease,transform .24s cubic-bezier(.2,.9,.3,1.1),visibility 0s}
.cc-saveBar-error{--cc-saveBar-tone:var(--dsw-alias-state-error-primary)}
.cc-saveBar-success{--cc-saveBar-tone:var(--dsw-alias-state-success-primary,#16a34a);padding-right:18px}
.cc-saveBarIcon{flex-shrink:0;align-items:center;justify-content:center;display:inline-flex;width:16px;height:16px;color:var(--cc-saveBar-tone)}
.cc-saveBarPulse{width:8px;height:8px;border-radius:50%;corner-shape:round;background:var(--cc-saveBar-tone)}
.cc-saveBarText{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.cc-saveBar-error .cc-saveBarText{color:var(--dsw-alias-state-error-primary)}
.cc-saveBarActions{flex-shrink:0;align-items:center;gap:4px;display:flex;margin-left:8px}
.cc-saveBarButton{box-sizing:border-box;height:36px;padding:0 16px;border:0;border-radius:18px;corner-shape:round;font:inherit;font-size:14px;line-height:22px;white-space:nowrap;cursor:pointer}
.cc-saveBarButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.cc-saveBarButton:disabled{cursor:default;opacity:.4}
.cc-saveBarGhost{background:0 0;color:var(--dsw-alias-label-primary)}
.cc-saveBarGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.cc-saveBarPrimary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff)}
.cc-saveBarPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)))}
@media (prefers-reduced-motion:reduce){.cc-chevron,.cc-toggle::after,.cc-usageBarFill,.cc-saveBar,.cc-saveBarShown{transition:none}}
`;
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
		/** Client plugin body. */
		function apply(ctx) {
			const removeCss = injectCss(PAGE_CSS_ID, PAGE_CSS);
			ctx.effect(() => removeCss, "dsh-opendesign-provider: page styles");
			ctx.effect(() => ctx.locale.register(SETTINGS_LOCALE_NS, {
				zh,
				en
			}), "dsh-opendesign-provider: page copy");
			let settingsNamespace;
			let credentialsNamespace;
			let modelsNamespace;
			const scope = createSettingsScope(ctx, NS, () => settingsNamespace);
			ctx.effect(() => () => {
				scope.dispose();
			}, "dsh-opendesign-provider: settings scope");
			const controller = new OpenDesignSettingsController(scope, {
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
			}, { async models() {
				return modelsNamespace?.models?.() ?? {
					ok: false,
					error: { message: "opendesign/models remote is not mounted" }
				};
			} });
			ctx.effect(() => () => controller.dispose(), "dsh-opendesign-provider: settings controller");
			const settingsStore = {
				getSnapshot: () => controller.state(),
				subscribe: (listener) => controller.subscribe(listener)
			};
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
				remote.$mount(MODELS_REMOTE_CONTRIBUTION).then((dispose) => {
					if (cancelled) {
						dispose();
						return;
					}
					unmount = dispose;
					ctx.inject(["remote.opendesign"], (modelsCtx) => {
						modelsNamespace = modelsCtx.remote.opendesign;
						controller.refreshModels();
						modelsCtx.effect(() => () => {
							modelsNamespace = void 0;
						}, "dsh-opendesign-provider: models namespace");
					});
				}).catch((error) => {
					console.error("[dsh-opendesign-provider] could not mount opendesign/models:", error);
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
				setKey: (value) => controller.setKey(value),
				clearKey: () => controller.clearKey(),
				save: () => controller.save(),
				discard: () => controller.discard(),
				diagnosticText: () => controller.diagnosticText(),
				refresh: () => controller.refresh()
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: SETTINGS_SECTION_ID,
				order: 12,
				label: () => ctx.locale.bind(SETTINGS_LOCALE_NS)("nav"),
				locale: SETTINGS_LOCALE_NS,
				inject: pageFace
			}, OpenDesignSettingsPage));
			ctx.slots.inject("settings.models.provider-card", () => ctx.slots.register({
				name: "settings.models.provider-card",
				key: MODEL_CARD_KEY,
				locale: SETTINGS_LOCALE_NS,
				inject: () => pageFace()
			}, OpenDesignProviderCard));
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