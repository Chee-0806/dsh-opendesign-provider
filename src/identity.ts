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
export const PACKAGE_NAME = '@mars-sea/dsh-opendesign-provider'

/** The single LLM route this plugin owns. */
export const PROVIDER = 'open-design'

/** The name shown in the Models page, the settings page and errors. */
export const PROVIDER_DISPLAY_NAME = 'Open Design'

/** The settings namespace and plugin-row id (`llm-opendesign`). */
export const NS = 'llm-opendesign'

/** The plugin row id inserted by `cordis.patch.yml`. */
export const PLUGIN_ID = 'llm-opendesign'

/** The credential reference the Models page writes when no literal key is set. */
export const DEFAULT_API_KEY_ENV = 'OPEN_DESIGN_API_KEY'

/** The model plane's default base URL (the CLI login state can override it). */
export const DEFAULT_API_BASE = 'https://amr-link.open-design.ai/v1'

/** Model-catalog cache, relative to the user's home directory. */
export const MODELS_CACHE_RELATIVE_PATH = '.opendesign/models-cache.json'

/** Open Design CLI login state, relative to the user's home directory. */
export const AMR_CONFIG_RELATIVE_PATH = '.amr/config.json'

/** The wire namespace shared by every Remote this plugin serves. */
export const REMOTE_NAMESPACE = 'opendesign'

/**
 * The Cordis service key the Gateway resolves the models Remote from. Cordis
 * allows one service per key, so the quota Remote (ticket 10) provides its own
 * key — see `QUOTA_SERVICE` in `quota-wire.ts`.
 */
export const REMOTE_SERVICE = 'opendesignUsage'

/** The endpoint names under {@link REMOTE_NAMESPACE}. */
export const REMOTE_ENDPOINTS = ['usage', 'models', 'analytics'] as const

/** The settings-page slot id (`settings.section`). */
export const SETTINGS_SECTION_ID = 'opendesign'

/** The analytics page's own `settings.section` id (ticket 12). */
export const ANALYTICS_SECTION_ID = 'opendesign-analytics'

/** Locale namespace both browser surfaces declare for their copy. */
export const SETTINGS_LOCALE_NS = 'settings.opendesign'

/** Locale namespace the analytics page declares for its own copy. */
export const ANALYTICS_LOCALE_NS = 'analytics.opendesign'

/** The Models-page provider-card key (`settings.models.provider-card`). */
export const MODEL_CARD_KEY = 'llm-opendesign'

/** The quota panel's `main` / `sidebar.footer.action` id. */
export const PANEL_ID = 'opendesign-panel'

/** Locale namespace the two quota-panel surfaces declare (distinct from the settings page's). */
export const PANEL_LOCALE_NS = 'panel.opendesign'

/** Opt-in raw request-timing trace environment variable. */
export const REQUEST_TIMING_ENV = 'DSH_OPENDESIGN_TIMING'

/** Opt-in raw stream-trace environment variable. */
export const STREAM_TRACE_ENV = 'DSH_OPENDESIGN_TRACE'
