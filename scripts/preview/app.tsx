/**
 * Browser entry for the interactive UI preview.
 *
 * `scripts/preview-ui.mjs` bundles this file with esbuild and writes a thin
 * `index.html` next to it. Everything here runs in the page: the REAL
 * components from `src/client`, driven by the REAL controllers over an
 * in-memory `remote.settings` scope and fake credentials/models/usage wires.
 *
 * What that buys over the server-rendered preview:
 * - the fold buttons actually fold (component `useState` runs),
 * - the model checkboxes, text fields, key actions and save/discard buttons
 *   really mutate the controller, so every disabled/notice/dirty state is
 *   reachable by clicking,
 * - the theme switch re-reads the same `--dsw-*` aliases the host would set.
 *
 * What it still does not prove:
 * - the host's own theme values (the tokens below are neutral samples),
 * - the host's real remotes (writes land in memory, nothing is persisted),
 * - the layout of the surrounding settings page (each case is one surface).
 *
 * This file lives outside `tsconfig.include` on purpose: it is a dev tool, not
 * shipped code, and typing it against the harness slot generics would buy
 * nothing the components' own tests do not already pin.
 */

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { OpenDesignSettingsPage } from '../../src/client/section.tsx'
import { OpenDesignProviderCard } from '../../src/client/card.tsx'
import { OpenDesignQuotaCard, OpenDesignQuotaDashboard } from '../../src/client/panel-ui.tsx'
import { cardMode, OpenDesignSettingsController } from '../../src/client/settings.ts'
import { OpenDesignQuotaPanelController } from '../../src/client/panel.ts'
import { PAGE_CSS } from '../../src/client/page-styles.ts'
import { PANEL_CSS } from '../../src/client/panel-styles.ts'
import { zh as zhSettings } from '../../src/client/locales.ts'
import { panelTranslate } from '../../src/client/panel-locales.ts'

import type { OpenDesignModelsReport } from '../../src/models-wire.ts'
import type { QuotaSnapshot } from '../../src/control-plane.ts'
import type { SettingsPageState } from '../../src/client/settings.ts'

// ---------------------------------------------------------------- translation

/** One dictionary as a `Translate` face, with `{placeholder}` expansion. */
function translate(dictionary: Record<string, string>) {
  return (key: string, params?: Record<string, unknown>): string => {
    const template = dictionary[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      (params[name] === undefined ? match : String(params[name])))
  }
}

const tSettings = translate(zhSettings)
const tPanel = panelTranslate('zh')

// -------------------------------------------------------------------- fixtures

const NOW = Date.parse('2026-10-21T03:00:00.000Z')

const REPORT: OpenDesignModelsReport = {
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
const REPORT_CLI: OpenDesignModelsReport = {
  catalog: { ...REPORT.catalog, source: 'static', cached: true, reason: 'live catalog read failed' },
  credential: {
    ...REPORT.credential,
    source: 'cli-login',
    apiBaseSource: 'cli-login',
    login: { ...REPORT.credential.login, hasControlKey: false },
  },
}

/** The settings document the controller projects its drafts from. */
const DOC: Record<string, unknown> = {
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

const QUOTA: QuotaSnapshot = {
  controlPlaneAvailable: true,
  // Go is the one tier that carries the 5-hour window; the view filters that
  // window out for every other tier, so this is the only shape that shows two.
  tier: 'Go',
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

/** Wallet-funded, no windows: the card falls back to one funding line. */
const QUOTA_WALLET: QuotaSnapshot = {
  controlPlaneAvailable: true,
  tier: 'Pro',
  subscriptionStatus: 'canceled',
  balanceUsd: 3.2,
  funding: 'wallet',
  windows: [],
  fetchedAt: '2026-10-21T02:58:00.000Z',
}

// ------------------------------------------------------------------ assemblies

/** Let the controllers' first reads (credentials, catalog, usage) settle. */
async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((done) => setTimeout(done, 0))
  }
}

/** One in-memory `remote.settings` scope holding a single namespace row. */
function memoryScope(value: Record<string, unknown>, options: { writable?: boolean } = {}) {
  let snapshot = {
    status: 'ready' as const,
    value: { ...value },
    base: {},
    user: { ...value },
    revision: 1,
    writable: options.writable ?? true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async set() {},
    async unset() {},
    async mutate(ops: Array<{ op: string; path: readonly string[]; value?: unknown }>, expectedRevision?: number) {
      if (expectedRevision !== undefined && expectedRevision !== snapshot.revision) return 'conflict'
      const next: Record<string, unknown> = { ...snapshot.value }
      for (const op of ops) {
        const [field] = op.path
        if (field === undefined) continue
        if (op.op === 'set') next[field] = op.value
        else delete next[field]
      }
      snapshot = { ...snapshot, value: next, user: next, revision: snapshot.revision + 1 }
      for (const listener of listeners) listener()
      return 'accepted'
    },
  }
}

/** A credentials namespace reporting one reference's value-free facts. */
function credentialsApi(configured: boolean, writable = true) {
  return {
    async describe(refs: string[]) {
      return {
        ok: true,
        value: Object.fromEntries(refs.map((ref) => [ref, { configured, writable }])),
      }
    },
    async set() { return { ok: true } },
    async unset() { return { ok: true } },
  }
}

/** Build a settings controller over a fresh document and settle its first read. */
async function settings(options: {
  doc?: Record<string, unknown>
  report?: OpenDesignModelsReport
  configured?: boolean
  writable?: boolean
} = {}): Promise<OpenDesignSettingsController> {
  const controller = new OpenDesignSettingsController(
    memoryScope(options.doc ?? DOC, { writable: options.writable ?? true }) as never,
    credentialsApi(options.configured ?? true) as never,
    { async models() { return { ok: true, value: options.report ?? REPORT } } } as never,
  )
  await settle()
  return controller
}

/** The injected face `src/client/index.ts` hands the two settings surfaces. */
function settingsFace(controller: OpenDesignSettingsController) {
  return {
    settingsStore: {
      getSnapshot: (): SettingsPageState => controller.state(),
      subscribe: (listener: () => void) => controller.subscribe(listener),
    },
    state: () => controller.state(),
    cardMode: () => cardMode(controller.state()),
    edit: (field: never, text: string) => controller.edit(field, text),
    resetField: (field: never) => controller.resetField(field),
    toggleModel: (id: string) => controller.toggleModel(id),
    showAllModels: () => controller.showAllModels(),
    editContextWindow: (text: string) => controller.editContextWindow(text),
    editContextOverride: (model: string, text: string) => controller.editContextOverride(model, text),
    setLanguage: (language: string) => controller.setLanguage(language),
    setShowSidebarQuota: (value: boolean) => controller.setShowSidebarQuota(value),
    setKey: (value: string) => controller.setKey(value),
    clearKey: () => controller.clearKey(),
    save: () => controller.save(),
    discard: () => controller.discard(),
    diagnosticText: () => controller.diagnosticText(),
    refresh: () => controller.refresh(),
  }
}

/** Build a quota controller with the switch on and one settled reading. */
async function quota(options: {
  snapshot?: QuotaSnapshot
  open?: boolean
  hasControlKey?: boolean
} = {}): Promise<OpenDesignQuotaPanelController> {
  const controller = new OpenDesignQuotaPanelController({
    load: async () => ({ ok: true, value: options.snapshot ?? QUOTA }),
    settings: {
      getSnapshot: () => ({
        showSidebarQuota: true,
        hasControlKey: options.hasControlKey ?? true,
        loginStatus: (options.hasControlKey ?? true) ? 'ok' : 'missing',
      }),
      subscribe: () => () => {},
    },
    now: () => NOW,
    selectPanel: () => {},
  } as never)
  await settle()
  if (options.open === true) controller.openPanel()
  return controller
}

/** The injected face the two quota seats receive. */
function panelFace(controller: OpenDesignQuotaPanelController) {
  return {
    panelStore: {
      getSnapshot: () => controller.state(),
      subscribe: (listener: () => void) => controller.subscribe(listener),
    },
    panelState: () => controller.state(),
    panelOpen: () => controller.openPanel(),
    panelClose: () => controller.closePanel(),
    panelRefresh: () => { void controller.refresh(true) },
    panelLocale: () => 'zh' as const,
  }
}

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
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px 24px;
    background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
  }
  [data-theme="dark"] .pv-bar {
    background: rgba(17, 19, 24, 0.9);
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }
  .pv-barTop { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
  .pv-barTitle { font-weight: 600; letter-spacing: 0.01em; white-space: nowrap; }
  .pv-barMeta { font-size: 12px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pv-spacer { flex: 1 1 auto; }
  .pv-toggle {
    flex: none; white-space: nowrap;
    font: inherit; font-size: 12px; padding: 6px 14px; cursor: pointer;
    border-radius: 999px; border: 1px solid rgba(17, 24, 39, 0.18);
    background: transparent; color: inherit;
  }
  [data-theme="dark"] .pv-toggle { border-color: rgba(255, 255, 255, 0.22); }
  .pv-toggle:hover { background: rgba(17, 24, 39, 0.06); }
  [data-theme="dark"] .pv-toggle:hover { background: rgba(255, 255, 255, 0.08); }
  /* One scrollable row: twelve pills would otherwise wrap and shove the frame
     down every time the window narrows. */
  .pv-nav { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
  .pv-navLink {
    flex: none; white-space: nowrap;
    font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
    border: 1px solid transparent; background: rgba(17, 24, 39, 0.05); color: inherit;
  }
  [data-theme="dark"] .pv-navLink { background: rgba(255, 255, 255, 0.08); }
  .pv-navLink:hover { border-color: rgba(17, 24, 39, 0.2); }
  .pv-navLink[aria-current="true"] {
    background: #2563eb; border-color: #2563eb; color: #fff;
  }
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
  .pv-frame.pane { padding: 24px; }
  /* 720 is the page's own max-width, plus this frame's 24px content padding. */
  .pv-frame.page { max-width: 768px; }
  .pv-frame.card { max-width: 720px; }
  .pv-frame.sidebar { width: 248px; padding: 8px; background: var(--dsw-alias-bg-layer-2); }
  .pv-frame.rail { width: 64px; padding: 8px; background: var(--dsw-alias-bg-layer-2); }
  .pv-frame.dashboard { max-width: 960px; padding: 0; }
  .pv-foot {
    padding: 32px 24px 0; font-size: 12px; opacity: 0.5; max-width: 720px;
  }
  .pv-fatal {
    margin: 24px; padding: 16px; border-radius: 8px;
    background: #fef2f2; color: #991b1b; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
  }
`

// ------------------------------------------------------------------- the page

/** One rendered case, already mounted. */
type Case = { id: string; title: string; short: string; note: string; frame: string; body: JSX.Element }

/**
 * Mount one surface with its own controller. Each case owns a fresh controller
 * so editing one never perturbs another.
 */
async function buildCases(): Promise<Case[]> {
  const healthy = await settings()
  const dirty = await settings()
  dirty.edit('apiBase' as never, 'not a url')
  dirty.edit('transportMaxRetries' as never, '99')

  return [
    {
      id: 'settings-ready',
      title: '设置页 · 就绪',
      short: '设置 · 就绪',
      note: '可写、live 目录、Key 已设置、一个未校准模型、一条 per-model 覆盖 —— 分组与字段都能点开合上',
      frame: 'pane page',
      body: <OpenDesignSettingsPage {...settingsFace(healthy)} t={tSettings as never} />,
    },
    {
      id: 'settings-dirty',
      title: '设置页 · 脏草稿与校验',
      short: '设置 · 脏草稿',
      note: 'apiBase 格式错误 + 重试次数超上限：底部保存条应出现，可点「放弃更改」还原',
      frame: 'pane page',
      body: <OpenDesignSettingsPage {...settingsFace(dirty)} t={tSettings as never} />,
    },
    {
      id: 'settings-readonly',
      title: '设置页 · 只读',
      short: '设置 · 只读',
      note: '宿主命名空间不可写：控件全部禁用，折叠仍然可用',
      frame: 'pane page',
      body: <OpenDesignSettingsPage {...settingsFace(await settings({ writable: false }))} t={tSettings as never} />,
    },
    {
      id: 'settings-cli',
      title: '设置页 · CLI 登录态无 controlKey',
      short: '设置 · CLI 降级',
      note: '凭据来自 vela login、目录退化为 static，额度功能应有的降级提示',
      frame: 'pane page',
      body: <OpenDesignSettingsPage {...settingsFace(await settings({ report: REPORT_CLI }))} t={tSettings as never} />,
    },
    {
      id: 'provider-card',
      title: '模型卡 · 就绪',
      short: '模型卡',
      note: 'Models 页的 provider-card，与设置页共享同一个控制器；点「清除 Key」会真的改写状态',
      frame: 'pane card',
      body: (
        <OpenDesignProviderCard
          {...settingsFace(await settings())}
          t={tSettings as never}
          provider={{
            provider: 'open-design',
            displayName: 'Open Design',
            settingsNs: 'llm-opendesign',
            settingsPath: ['llm-opendesign'],
            active: true,
            declared: true,
          }}
          configured
          keyConfigured
        />
      ),
    },
    {
      id: 'quota-card-wide',
      title: '额度卡 · 侧栏展开',
      short: '额度卡 · 展开',
      note: '侧栏底部、宽态：档位 + 两个窗口的进度条（Go 档才有 5 小时窗口）',
      frame: 'pane sidebar',
      body: <OpenDesignQuotaCard {...panelFace(await quota())} t={tPanel as never} wide />,
    },
    {
      id: 'quota-card-rail',
      title: '额度卡 · 侧栏收起',
      short: '额度卡 · 收起',
      note: '收起成图标轨时的形态，只剩一个环形指示灯',
      frame: 'pane rail',
      body: <OpenDesignQuotaCard {...panelFace(await quota())} t={tPanel as never} wide={false} />,
    },
    {
      id: 'quota-dashboard',
      title: '额度仪表盘',
      short: '额度仪表盘',
      note: '中间栏：档位、两个窗口、重置时间、钱包余额与计费顺序说明',
      frame: 'pane dashboard',
      body: <OpenDesignQuotaDashboard {...panelFace(await quota({ open: true }))} t={tPanel as never} />,
    },
    {
      id: 'quota-unavailable',
      title: '额度卡 · 无 controlKey',
      short: '额度卡 · 无 key',
      note: '降级：卡片不渲染（此处空白即正确结果，宿主不应出现空壳）',
      frame: 'pane sidebar',
      body: <OpenDesignQuotaCard {...panelFace(await quota({ hasControlKey: false }))} t={tPanel as never} wide />,
    },
    {
      id: 'quota-wallet',
      title: '额度卡 · 钱包计费',
      short: '额度卡 · 钱包',
      note: '没有额度窗口、funding=wallet：卡片只剩一行计费口径',
      frame: 'pane sidebar',
      body: <OpenDesignQuotaCard {...panelFace(await quota({ snapshot: QUOTA_WALLET }))} t={tPanel as never} wide />,
    },
  ]
}

/** The whole preview: theme switch, a jump list, and every case. */
function PreviewPage(props: { cases: Case[] }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [only, setOnly] = useState<string | undefined>(
    () => new URLSearchParams(location.search).get('only') ?? undefined,
  )
  // The theme lives on the document element, outside React's tree; the effect
  // is the only place it is written, once per switch.
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const visible = props.cases.filter((entry) => only === undefined || entry.id === only)
  return (
    <>
      <style>{`:root {${THEME_TOKENS}} [data-theme="dark"] {${THEME_DARK}}`}</style>
      <style>{SHELL_CSS}</style>
      <style data-plugin-css="page">{PAGE_CSS}</style>
      <style data-plugin-css="panel">{PANEL_CSS}</style>
      <header className="pv-bar">
        <div className="pv-barTop">
          <span className="pv-barTitle">Open Design · UI 预览</span>
          <span className="pv-barMeta">真实组件 + 真实控制器 · 可点击</span>
          <span className="pv-spacer" />
          <button
            className="pv-toggle"
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
        </div>
        <nav className="pv-nav">
          <button
            className="pv-navLink"
            type="button"
            aria-current={only === undefined}
            onClick={() => setOnly(undefined)}
          >
            全部
          </button>
          {props.cases.map((entry) => (
            <button
              className="pv-navLink"
              key={entry.id}
              type="button"
              title={entry.id}
              aria-current={only === entry.id}
              onClick={() => setOnly(entry.id)}
            >
              {entry.short}
            </button>
          ))}
        </nav>
      </header>
      <main className="pv-stack">
        {visible.length === 0
          ? <p className="pv-foot">没有名为 “{only}” 的场景。</p>
          : null}
        {visible.map((entry) => (
          <section className="pv-case" id={entry.id} key={entry.id}>
            <div className="pv-caseHead">
              <h2 className="pv-caseTitle">{entry.title}</h2>
              <span className="pv-caseNote">{entry.note}</span>
              <span className="pv-caseId">{entry.id}</span>
            </div>
            <div className={`pv-frame ${entry.frame}`}>{entry.body}</div>
          </section>
        ))}
        <p className="pv-foot">
          主题色是中性样例，用来让 <code>--dsw-*</code> 别名有值可解析，不代表宿主真实调色板。
          这里的写操作落在内存里，刷新即还原；真实宿主里的持久化与 Remote 契约由 <code>npm test</code> 覆盖。
        </p>
      </main>
    </>
  )
}

/** Render failures onto the page: a blank screen hides the reason. */
function reportFatal(error: unknown): void {
  const root = document.getElementById('root')
  const text = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)
  if (root === null) return
  root.innerHTML = `<pre class="pv-fatal">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c))}</pre>`
}

async function main(): Promise<void> {
  const cases = await buildCases()
  const root = document.getElementById('root')
  if (root === null) throw new Error('preview root is missing')
  createRoot(root).render(<PreviewPage cases={cases} />)
}

void main().catch(reportFatal)
