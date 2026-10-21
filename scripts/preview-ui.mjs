/**
 * Offline static preview for this bundle's three client surfaces.
 *
 * The browser half has no dev server: `lib/client.js` is a slot plugin the DSH
 * web client loads, so the only way to see the settings page, the Models-page
 * card, the quota card/dashboard or the analytics page is to build, pack,
 * install into a real profile and restart the app. That loop is fine for
 * acceptance and far too slow for iterating on spacing or colour.
 *
 * This script renders the SAME components from source with real controllers —
 * the state is produced by `OpenDesignSettingsController`,
 * `OpenDesignQuotaPanelController` and `OpenDesignAnalyticsController`, never
 * hand-written — and writes one self-contained HTML file. Re-run it and
 * refresh the browser; no build, no pack, no restart.
 *
 * What it shares with the tests, and why:
 * - `tests/_css-module-loader.mjs` serves empty modules for the primitives'
 *   CSS imports and stubs the UI barrel. Reusing it keeps the preview on the
 *   exact assembly path `tests/client-boot.test.ts` already pins, instead of a
 *   second private stub that could drift.
 *
 * What it deliberately does NOT prove:
 * - No interactivity: every surface is server-rendered markup, so click paths,
 *   focus rings and live store updates are out of scope — `npm test` covers the
 *   controller behaviour and the real profile covers the interaction.
 * - No real host theming: the two theme blocks below are NEUTRAL SAMPLES for
 *   the `--dsw-*` aliases the stylesheets read without fallbacks. They are not
 *   a copy of the harness palette and must not be treated as the record of it.
 *
 * Output: `.scratch/ui-preview/index.html` (git-ignored, like the rest of
 * `.scratch/`). Open it directly; there is no server.
 *
 * Add `?only=<case-id>` to isolate one surface (ids are printed at the end of
 * each run, and shown next to every case heading) — useful when a single
 * surface needs undivided attention.
 */

import { register } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The React tree imports primitives that pull CSS modules; serve empty modules
// before the dynamic imports below (static imports would hoist above this).
register(new URL('../tests/_css-module-loader.mjs', import.meta.url).href)

const React = await import('react')
const createElement = React.createElement ?? React.default.createElement
const server = await import('react-dom/server')
const renderToStaticMarkup = server.renderToStaticMarkup ?? server.default.renderToStaticMarkup

const { OpenDesignSettingsPage } = await import('../src/client/section.tsx')
const { OpenDesignProviderCard } = await import('../src/client/card.tsx')
const { OpenDesignQuotaCard, OpenDesignQuotaDashboard } = await import('../src/client/panel-ui.tsx')
const { OpenDesignAnalyticsPage } = await import('../src/client/analytics-section.tsx')
const { OpenDesignSettingsController, cardMode } = await import('../src/client/settings.ts')
const { OpenDesignQuotaPanelController } = await import('../src/client/panel.ts')
const { OpenDesignAnalyticsController } = await import('../src/client/analytics.ts')
const { PAGE_CSS } = await import('../src/client/page-styles.ts')
const { PANEL_CSS } = await import('../src/client/panel-styles.ts')
const { zh: zhSettings } = await import('../src/client/locales.ts')
const { panelTranslate } = await import('../src/client/panel-locales.ts')
const { zh: zhAnalytics } = await import('../src/client/analytics-locales.ts')

const repositoryDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- translation

/**
 * One dictionary as a `Translate` face.
 *
 * The components call `t(key)` and, for the panel, `t(key, params)` with
 * `{placeholder}` templates — the same shape the harness runtime expands.
 */
function translate(dictionary) {
  return (key, params) => {
    const template = dictionary[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      (params[name] === undefined ? match : String(params[name])))
  }
}

const tSettings = translate(zhSettings)
const tPanel = panelTranslate('zh')
const tAnalytics = translate(zhAnalytics)

// -------------------------------------------------------------------- fixtures

const NOW = Date.parse('2026-10-21T03:00:00.000Z')

const REPORT = {
  catalog: {
    source: 'live',
    apiBase: 'https://runtime.opendesign.example/v1',
    cached: false,
    models: [
      {
        id: 'deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        contextWindow: 328000,
        maxTokens: 128000,
        cost: 'low',
        capability: 'advanced',
        inputModalities: ['text', 'image'],
        reasoningLevels: ['off', 'high'],
        default: true,
        calibrated: true,
      },
      {
        id: 'gpt-6-luna',
        name: 'GPT-6 Luna',
        contextWindow: 200000,
        maxTokens: 64000,
        cost: 'medium',
        capability: 'advanced',
        inputModalities: ['text', 'image'],
        reasoningLevels: ['off', 'medium', 'high'],
        default: false,
        calibrated: true,
      },
      {
        id: 'hy4-preview',
        name: 'Hunyuan H4 Preview',
        contextWindow: 232000,
        maxTokens: 32000,
        cost: 'medium',
        capability: 'standard',
        inputModalities: ['text'],
        reasoningLevels: ['off', 'medium'],
        default: false,
        calibrated: false,
      },
    ],
  },
  credential: {
    source: 'literal',
    reference: 'OPEN_DESIGN_API_KEY',
    configured: true,
    apiBase: 'https://runtime.opendesign.example/v1',
    apiBaseSource: 'config',
    login: {
      status: 'ok',
      path: '~/.amr/config.json',
      hasRuntimeKey: true,
      hasControlKey: true,
    },
  },
}

/** The CLI-login posture: key resolved from `vela login`, but no controlKey. */
const REPORT_CLI = {
  catalog: { ...REPORT.catalog, source: 'static', cached: true, reason: 'live catalog read failed' },
  credential: {
    ...REPORT.credential,
    source: 'cli-login',
    apiBaseSource: 'cli-login',
    login: { ...REPORT.credential.login, hasControlKey: false },
  },
}

/** The settings document the controller projects its drafts from. */
const DOC = {
  apiKeyEnv: 'OPEN_DESIGN_API_KEY',
  apiBase: 'https://runtime.opendesign.example/v1',
  modelsCachePath: '~/.cache/opendesign/models.json',
  requestTimeoutMs: 300_000,
  streamIdleTimeoutMs: 60_000,
  transportMaxRetries: 5,
  contextWindow: 328_000,
  maxOutputTokens: 64_000,
  visibleModels: ['deepseek-v4.1-flash', 'hy4-preview'],
  contextWindowOverrides: { 'deepseek-v4.1-flash': 400_000 },
  lang: 'zh',
  showSidebarQuota: true,
}

const QUOTA = {
  controlPlaneAvailable: true,
  tier: 'Pro',
  subscriptionStatus: 'active',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  balanceUsd: 12.4,
  funding: 'coding_plan',
  windows: [
    {
      kind: 'five_hour',
      durationSeconds: 18_000,
      usedCredits: 420,
      limitCredits: 1200,
      remainingCredits: 780,
      resetsAt: '2026-10-21T07:10:00.000Z',
      resetMode: 'rolling',
    },
    {
      kind: 'seven_day',
      durationSeconds: 604_800,
      usedCredits: 2150,
      limitCredits: 3000,
      remainingCredits: 850,
      resetsAt: '2026-10-27T00:00:00.000Z',
    },
  ],
  fetchedAt: '2026-10-21T02:58:00.000Z',
}

const ANALYTICS = {
  generatedAt: NOW,
  scope: { kind: 'recent', sessions: 20 },
  history: {
    available: true,
    sessionsScanned: 6,
    sessionsSkipped: 1,
    eventsScanned: 42,
    inheritedEventsSkipped: 2,
    truncated: false,
  },
  totals: {
    requests: 42,
    sessions: 6,
    succeeded: 40,
    failed: 1,
    interrupted: 1,
    retries: 3,
    inputTokens: 812_400,
    outputTokens: 96_300,
    totalTokens: 908_700,
    requestsWithUsage: 42,
    requestsWithoutUsage: 0,
    firstTokenSamples: 41,
    avgFirstTokenMs: 640,
    durationSamples: 41,
    avgDurationMs: 7400,
  },
  models: [
    {
      model: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      cost: 'low',
      capability: 'advanced',
      visible: true,
      calibrated: true,
      requests: 31,
      succeeded: 30,
      failed: 1,
      interrupted: 0,
      retries: 2,
      inputTokens: 702_100,
      outputTokens: 81_900,
      totalTokens: 784_000,
      requestsWithUsage: 31,
      requestsWithoutUsage: 0,
      firstTokenSamples: 30,
      avgFirstTokenMs: 520,
      durationSamples: 30,
      avgDurationMs: 6100,
    },
    {
      model: 'gpt-6-luna',
      name: 'GPT-6 Luna',
      cost: 'medium',
      capability: 'advanced',
      visible: true,
      calibrated: true,
      requests: 11,
      succeeded: 10,
      failed: 0,
      interrupted: 1,
      retries: 1,
      inputTokens: 110_300,
      outputTokens: 14_400,
      totalTokens: 124_700,
      requestsWithUsage: 11,
      requestsWithoutUsage: 0,
      firstTokenSamples: 11,
      avgFirstTokenMs: 980,
      durationSamples: 11,
      avgDurationMs: 10_900,
    },
    {
      model: 'hy4-preview',
      name: 'Hunyuan H4 Preview',
      cost: 'medium',
      capability: 'standard',
      visible: false,
      calibrated: false,
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
      avgFirstTokenMs: undefined,
      durationSamples: 0,
      avgDurationMs: undefined,
    },
  ],
}

// ------------------------------------------------------------------ assemblies

/** Let the controllers' first reads (credentials, catalog, usage) settle. */
async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((done) => setTimeout(done, 0))
  }
}

/** One in-memory `remote.settings` scope holding a single namespace row. */
function memoryScope(value, { writable = true, status = 'ready' } = {}) {
  let snapshot = {
    status,
    value: { ...value },
    base: {},
    user: { ...value },
    revision: 1,
    writable,
    mode: 'host',
  }
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async set() {},
    async unset() {},
    async mutate(ops, expectedRevision) {
      if (expectedRevision !== undefined && expectedRevision !== snapshot.revision) return 'conflict'
      const next = { ...snapshot.value }
      for (const op of ops) {
        const [field] = op.path
        if (field === undefined) continue
        if (op.op === 'set') next[field] = op.value
        else delete next[field]
      }
      snapshot = { ...snapshot, value: next, revision: snapshot.revision + 1 }
      for (const listener of listeners) listener()
      return 'accepted'
    },
  }
}

/** A credentials namespace reporting one reference's value-free facts. */
function credentialsApi(configured, writable = true) {
  return {
    async describe(refs) {
      return {
        ok: true,
        value: Object.fromEntries(refs.map((ref) => [ref, { configured, writable }])),
      }
    },
    async set() {
      return { ok: true }
    },
    async unset() {
      return { ok: true }
    },
  }
}

/** Build a settings controller over a fresh document and settle its first read. */
async function settings({ doc = DOC, report = REPORT, configured = true, writable = true } = {}) {
  const controller = new OpenDesignSettingsController(
    memoryScope(doc, { writable }),
    credentialsApi(configured),
    { async models() { return { ok: true, value: report } } },
  )
  await settle()
  return controller
}

/** The injected face `src/client/index.ts` hands the two settings surfaces. */
function settingsFace(controller) {
  return {
    settingsStore: {
      getSnapshot: () => controller.state(),
      subscribe: (listener) => controller.subscribe(listener),
    },
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
    refresh: () => controller.refresh(),
  }
}

/** Build a quota controller with the switch on and one settled reading. */
async function quota({ snapshot = QUOTA, open = false, hasControlKey = true } = {}) {
  const controller = new OpenDesignQuotaPanelController({
    load: async () => ({ ok: true, value: snapshot }),
    settings: {
      getSnapshot: () => ({
        showSidebarQuota: true,
        hasControlKey,
        loginStatus: hasControlKey ? 'ok' : 'missing',
      }),
      subscribe: () => () => {},
    },
    now: () => NOW,
    selectPanel: () => {},
  })
  await settle()
  if (open) controller.openPanel()
  return controller
}

/** The injected face the two quota seats receive. */
function panelFace(controller) {
  return {
    panelStore: {
      getSnapshot: () => controller.state(),
      subscribe: (listener) => controller.subscribe(listener),
    },
    panelState: () => controller.state(),
    panelOpen: () => controller.openPanel(),
    panelClose: () => controller.closePanel(),
    panelRefresh: () => { void controller.refresh(true) },
    panelLocale: () => 'zh',
  }
}

/** Build an analytics controller and optionally perform one read. */
async function analytics({ read = true } = {}) {
  const controller = new OpenDesignAnalyticsController(
    () => ({ analytics: async () => ({ ok: true, value: ANALYTICS }) }),
    { now: () => NOW, localOffsetMinutes: -480 },
  )
  if (read) {
    controller.setRecentSessions('20')
    await controller.refresh()
  }
  return controller
}

/** The injected face the analytics page receives. */
function analyticsFace(controller) {
  return {
    store: {
      getSnapshot: () => controller.state(),
      subscribe: (listener) => controller.subscribe(listener),
    },
    setMode: (mode) => controller.setMode(mode),
    setRecentSessions: (text) => controller.setRecentSessions(text),
    setRangeFrom: (text) => controller.setRangeFrom(text),
    setRangeTo: (text) => controller.setRangeTo(text),
    refresh: () => controller.refresh(),
  }
}

// -------------------------------------------------------------------- rendering

const CASES = []

/** Append one rendered case to the page. */
function add(testCase) {
  CASES.push(testCase)
}

const renderSettings = (controller) =>
  renderToStaticMarkup(createElement(OpenDesignSettingsPage, { ...settingsFace(controller), t: tSettings }))

const renderAnalytics = (controller) =>
  renderToStaticMarkup(createElement(OpenDesignAnalyticsPage, { ...analyticsFace(controller), t: tAnalytics }))

// 1 — settings page, healthy
add({
  id: 'settings-ready',
  title: '设置页 · 就绪',
  note: '可写、live 目录、Key 已设置、一个未校准模型、一条 per-model 上下文覆盖',
  frame: 'pane page',
  html: renderSettings(await settings()),
})

// 2 — settings page, dirty drafts with validation errors
{
  const controller = await settings()
  controller.edit('apiBase', 'not a url')
  controller.edit('transportMaxRetries', '99')
  add({
    id: 'settings-dirty',
    title: '设置页 · 脏草稿与校验',
    note: 'apiBase 格式错误 + 重试次数超上限；保存条应出现并可丢弃',
    frame: 'pane page',
    html: renderSettings(controller),
  })
}

// 3 — settings page, read-only profile
add({
  id: 'settings-readonly',
  title: '设置页 · 只读',
  note: '宿主命名空间不可写：整页禁用并显示只读提示',
  frame: 'pane page',
  html: renderSettings(await settings({ writable: false })),
})

// 4 — settings page, CLI login without a controlKey
add({
  id: 'settings-cli',
  title: '设置页 · CLI 登录态无 controlKey',
  note: '凭据来自 vela login、目录退化为 static，额度功能应有的降级提示',
  frame: 'pane page',
  html: renderSettings(await settings({ report: REPORT_CLI, configured: true })),
})

// 5 — Models-page provider card
{
  const controller = await settings()
  add({
    id: 'provider-card',
    title: '模型卡 · 就绪',
    note: 'Models 页的 provider-card，与设置页共享同一个控制器',
    frame: 'pane card',
    html: renderToStaticMarkup(createElement(OpenDesignProviderCard, {
      ...settingsFace(controller),
      t: tSettings,
      provider: {
        provider: 'open-design',
        displayName: 'Open Design',
        settingsNs: 'llm-opendesign',
        settingsPath: ['llm-opendesign'],
        active: true,
        declared: true,
      },
      configured: true,
      keyConfigured: true,
    })),
  })
}

// 6 — sidebar quota card, wide
add({
  id: 'quota-card-wide',
  title: '额度卡 · 侧栏展开',
  note: '侧栏底部、宽态：档位 + 两个窗口的进度条',
  frame: 'pane sidebar',
  html: renderToStaticMarkup(createElement(OpenDesignQuotaCard, {
    ...panelFace(await quota()), t: tPanel, wide: true,
  })),
})

// 7 — sidebar quota card, collapsed to the icon rail
add({
  id: 'quota-card-rail',
  title: '额度卡 · 侧栏收起',
  note: '收起成图标轨时的形态，只剩一个环形指示灯',
  frame: 'pane rail',
  html: renderToStaticMarkup(createElement(OpenDesignQuotaCard, {
    ...panelFace(await quota()), t: tPanel, wide: false,
  })),
})

// 8 — quota dashboard
add({
  id: 'quota-dashboard',
  title: '额度仪表盘',
  note: '中间栏：档位、两个窗口、重置时间、钱包余额与计费顺序说明',
  frame: 'pane dashboard',
  html: renderToStaticMarkup(createElement(OpenDesignQuotaDashboard, {
    ...panelFace(await quota({ open: true })), t: tPanel,
  })),
})

// 9 — quota card with no controlKey (must render nothing)
add({
  id: 'quota-unavailable',
  title: '额度卡 · 无 controlKey',
  note: '降级：卡片不渲染（此处空白即正确结果，宿主人格不应出现空壳）',
  frame: 'pane sidebar',
  html: renderToStaticMarkup(createElement(OpenDesignQuotaCard, {
    ...panelFace(await quota({ hasControlKey: false })), t: tPanel, wide: true,
  })) || '<p class="pv-empty">（未渲染，符合预期）</p>',
})

// 10 — analytics page with a report
add({
  id: 'analytics-ready',
  title: '分析页 · 有数据',
  note: '最近 20 个会话的聚合：总量、每模型表、成本档位（无金额）',
  frame: 'pane page',
  html: renderAnalytics(await analytics()),
})

// 11 — analytics page before the first read
add({
  id: 'analytics-idle',
  title: '分析页 · 未读取',
  note: '用户没点「读取」前的空态；页面不应自动扫描历史',
  frame: 'pane page',
  html: renderAnalytics(await analytics({ read: false })),
})

// ------------------------------------------------------------------ page shell

/**
 * Neutral samples for the `--dsw-*` aliases the stylesheets read.
 *
 * Most references carry NO fallback, so an undefined alias renders as plain
 * `inherit`/transparent — without these blocks the preview would show the
 * right layout in the wrong colours. These are placeholders, not the harness
 * palette: never read a real theme decision out of them.
 */
const THEME_TOKENS = `
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-layer-2: #f7f8fa;
  --dsw-alias-bg-layer-3: #ffffff;
  --dsw-alias-bg-module-platform: #ffffff;
  --dsw-alias-border-l2: #e5e7eb;
  --dsw-alias-border-l3: #d1d5db;
  --dsw-alias-border-l4: #9ca3af;
  --dsw-alias-brand-primary: #3b82f6;
  --dsw-alias-button-primary-fill: #2563eb;
  --dsw-alias-button-primary-hover: #1d4ed8;
  --dsw-alias-interactive-bg-hover: rgba(17, 24, 39, 0.06);
  --dsw-alias-interactive-bg-hover-danger: rgba(220, 38, 38, 0.08);
  --dsw-alias-label-primary: #111827;
  --dsw-alias-label-primary-foreground: #ffffff;
  --dsw-alias-label-secondary: #4b5563;
  --dsw-alias-label-tertiary: #6b7280;
  --dsw-alias-label-dimmed: #9ca3af;
  --dsw-alias-link: #2563eb;
  --dsw-alias-state-error-primary: #dc2626;
  --dsw-alias-state-success-primary: #16a34a;
  --dsw-alias-state-warn-label: #b45309;
  --dsw-alias-state-warn-primary: #f59e0b;
  --dsw-alias-state-warn-tertiary: #fde68a;
  --dsw-elevation-prominent: 0 12px 32px -8px rgba(15, 23, 42, 0.24);
  --dsw-elevation-soft: 0 1px 2px rgba(15, 23, 42, 0.06);
  --dsw-static-neutral-bluish-400: #94a3b8;
  --dsw-radius-md: 8px;
  --dsw-radius-sm: 6px;
`

const THEME_DARK = `
  --dsw-alias-bg-layer-1: #16181d;
  --dsw-alias-bg-layer-2: #1c1f26;
  --dsw-alias-bg-layer-3: #22262e;
  --dsw-alias-bg-module-platform: #1c1f26;
  --dsw-alias-border-l2: #2b3039;
  --dsw-alias-border-l3: #383e49;
  --dsw-alias-border-l4: #4b525e;
  --dsw-alias-brand-primary: #60a5fa;
  --dsw-alias-button-primary-fill: #3b82f6;
  --dsw-alias-button-primary-hover: #2563eb;
  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.08);
  --dsw-alias-interactive-bg-hover-danger: rgba(248, 113, 113, 0.12);
  --dsw-alias-label-primary: #f3f4f6;
  --dsw-alias-label-primary-foreground: #0b0d11;
  --dsw-alias-label-secondary: #b8bec9;
  --dsw-alias-label-tertiary: #8d95a3;
  --dsw-alias-label-dimmed: #6b7380;
  --dsw-alias-link: #7ab0ff;
  --dsw-alias-state-error-primary: #f87171;
  --dsw-alias-state-success-primary: #4ade80;
  --dsw-alias-state-warn-label: #fbbf24;
  --dsw-alias-state-warn-primary: #f59e0b;
  --dsw-alias-state-warn-tertiary: #453312;
  --dsw-elevation-prominent: 0 12px 32px -8px rgba(0, 0, 0, 0.6);
  --dsw-elevation-soft: 0 1px 2px rgba(0, 0, 0, 0.4);
  --dsw-static-neutral-bluish-400: #7d8794;
  --dsw-radius-md: 8px;
  --dsw-radius-sm: 6px;
`

/** Chrome for this preview only — never part of either shipped stylesheet. */
const SHELL_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: #eef0f4;
    color: #111827;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  [data-theme="dark"] body { background: #0b0d11; color: #e5e7eb; }
  .pv-bar {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 12px;
    padding: 12px 24px;
    background: rgba(255, 255, 255, 0.86); backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
  }
  [data-theme="dark"] .pv-bar {
    background: rgba(17, 19, 24, 0.86);
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }
  .pv-barTitle { font-weight: 600; letter-spacing: 0.01em; }
  .pv-barMeta { font-size: 12px; opacity: 0.6; }
  .pv-spacer { flex: 1 1 auto; }
  .pv-toggle {
    font: inherit; font-size: 12px; padding: 6px 14px; cursor: pointer;
    border-radius: 999px; border: 1px solid rgba(17, 24, 39, 0.18);
    background: transparent; color: inherit;
  }
  [data-theme="dark"] .pv-toggle { border-color: rgba(255, 255, 255, 0.22); }
  .pv-toggle:hover { background: rgba(17, 24, 39, 0.06); }
  [data-theme="dark"] .pv-toggle:hover { background: rgba(255, 255, 255, 0.08); }

  .pv-stack { display: flex; flex-direction: column; gap: 32px; padding: 32px 24px 96px; }
  .pv-case { display: flex; flex-direction: column; gap: 10px; }
  .pv-caseHead { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .pv-caseTitle { margin: 0; font-size: 14px; font-weight: 600; }
  .pv-caseNote { margin: 0; font-size: 12px; opacity: 0.62; }
  .pv-caseId { font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; opacity: 0.4; }

  .pv-frame {
    background: var(--dsw-alias-bg-layer-1);
    color: var(--dsw-alias-label-primary);
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 12px;
    overflow: hidden;
  }
  .pv-pane { padding: 24px; }
  .pv-frame.page { max-width: 808px; }
  .pv-frame.card { max-width: 720px; }
  .pv-frame.sidebar { width: 248px; padding: 8px; background: var(--dsw-alias-bg-layer-2); }
  .pv-frame.rail { width: 64px; padding: 8px; background: var(--dsw-alias-bg-layer-2); }
  .pv-frame.dashboard { max-width: 960px; padding: 0; }
  .pv-empty { margin: 0; padding: 12px; font-size: 12px; opacity: 0.5; }
  .pv-foot {
    padding: 32px 24px 0; font-size: 12px; opacity: 0.5; max-width: 720px;
  }
`

const stamp = new Date().toISOString()

const casesHtml = CASES.map((testCase) => `
    <section class="pv-case" id="${testCase.id}">
      <div class="pv-caseHead">
        <h2 class="pv-caseTitle">${testCase.title}</h2>
        <span class="pv-caseNote">${testCase.note}</span>
        <span class="pv-caseId">${testCase.id}</span>
      </div>
      <div class="pv-frame ${testCase.frame}">${testCase.html}</div>
    </section>`).join('\n')

const html = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Design · UI 预览</title>
<style>
:root {${THEME_TOKENS}
}
[data-theme="dark"] {${THEME_DARK}
}
${SHELL_CSS}
</style>
<style data-plugin-css="page">${PAGE_CSS}</style>
<style data-plugin-css="panel">${PANEL_CSS}</style>
</head>
<body>
<header class="pv-bar">
  <span class="pv-barTitle">Open Design · UI 预览</span>
  <span class="pv-barMeta">${stamp} · 静态渲染，无交互</span>
  <span class="pv-spacer"></span>
  <button class="pv-toggle" type="button" onclick="var r=document.documentElement;r.dataset.theme=r.dataset.theme==='dark'?'light':'dark'">切换深浅色</button>
</header>
<main class="pv-stack">${casesHtml}
  <p class="pv-foot">
    主题色是中性样例，用来让 <code>--dsw-*</code> 别名有值可解析，不代表宿主真实调色板。
    交互与真实主题请以安装后的 DSH 客户端为准；状态流转由 <code>npm test</code> 覆盖。
  </p>
</main>
</body>
</html>
`

const outDir = join(repositoryDir, '.scratch', 'ui-preview')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'index.html')
writeFileSync(outFile, html, 'utf8')

process.stdout.write(`preview written: ${outFile}\n`)
process.stdout.write(`cases: ${CASES.map((entry) => entry.id).join(', ')}\n`)
