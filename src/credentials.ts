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

import { readFile as readFileFromDisk } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { AMR_CONFIG_RELATIVE_PATH, DEFAULT_API_BASE, DEFAULT_API_KEY_ENV } from './identity.ts'

/** How one attempt to read the CLI login state ended. */
export type CliLoginStatus = 'ok' | 'missing' | 'malformed' | 'unreadable'

/**
 * The fields this plugin consumes out of `profiles.prod`. Every field is
 * optional: a half-written login state degrades field by field instead of
 * invalidating the whole reading.
 */
export interface CliLoginState {
  runtimeKey?: string | undefined
  controlKey?: string | undefined
  linkUrl?: string | undefined
  apiUrl?: string | undefined
  user?: string | undefined
}

/** One reading of the login state, including the path that was consulted. */
export interface CliLoginReading {
  status: CliLoginStatus
  path: string
  state?: CliLoginState
}

/** The safe, value-free projection of a login reading for UI and diagnostics. */
export interface CliLoginFacts {
  status: CliLoginStatus
  path: string
  hasRuntimeKey: boolean
  hasControlKey: boolean
  apiUrl?: string | undefined
  user?: string | undefined
}

/** Where the request's key came from. */
export type CredentialSource = 'literal' | 'reference' | 'cli-login' | 'none'

/** Where the request's base URL came from. */
export type ApiBaseSource = 'config' | 'cli-login' | 'default'

/** Config fields the chain reads (a structural subset of the Host Config). */
export interface CredentialChainConfig {
  apiKey?: string | undefined
  apiKeyEnv?: string | undefined
  apiBase?: string | undefined
  amrConfigPath?: string | undefined
}

/** Injected I/O and credential seams; all of them have production defaults. */
export interface CredentialChainDeps {
  /** Resolve one credential reference; absent means "no reference layer". */
  resolveReference?: ((reference: string) => Promise<string | undefined> | string | undefined) | undefined
  /** Test seam for reading the login state file; defaults to `node:fs/promises`. */
  readFile?: ((path: string) => Promise<string>) | undefined
  /** Test seam for the home directory; defaults to `os.homedir()`. */
  homeDir?: string | undefined
}

/** One fully resolved credential chain. The control key is intentionally absent. */
export interface CredentialChainResult {
  source: CredentialSource
  /** The resolved runtime key; never render, log or serialize this value. */
  apiKey?: string | undefined
  /** The reference the second layer consulted, set even when the layer missed. */
  reference: string
  apiBase: string
  apiBaseSource: ApiBaseSource
  login: CliLoginFacts
}

/** The login state's default path (`~/.amr/config.json`). */
export function defaultAmrConfigPath(homeDir: string = homedir()): string {
  return join(homeDir, AMR_CONFIG_RELATIVE_PATH)
}

/** The production reader, pinned to UTF-8 so the seam returns a string. */
const readUtf8 = (path: string): Promise<string> => readFileFromDisk(path, 'utf8')

/** Read one non-empty string field, trimming surrounding whitespace. */
function textField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text === '' ? undefined : text
}

/**
 * Read `profiles.prod` out of the CLI login state. Never throws: a missing
 * file, an unreadable file, invalid JSON and a missing `profiles.prod` are
 * reported as statuses so callers can explain the degraded path.
 */
export async function readCliLoginState(
  path: string = defaultAmrConfigPath(),
  readFile: (path: string) => Promise<string> = readUtf8,
): Promise<CliLoginReading> {
  let raw: string
  try {
    raw = await readFile(path)
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
    return { status: code === 'ENOENT' ? 'missing' : 'unreadable', path }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'malformed', path }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'malformed', path }
  }
  const profiles = (parsed as Record<string, unknown>).profiles
  if (typeof profiles !== 'object' || profiles === null || Array.isArray(profiles)) {
    return { status: 'malformed', path }
  }
  const prod = (profiles as Record<string, unknown>).prod
  if (typeof prod !== 'object' || prod === null || Array.isArray(prod)) {
    return { status: 'malformed', path }
  }
  const record = prod as Record<string, unknown>
  const state: CliLoginState = {
    runtimeKey: textField(record, 'runtimeKey'),
    controlKey: textField(record, 'controlKey'),
    linkUrl: textField(record, 'linkUrl'),
    apiUrl: textField(record, 'apiUrl'),
    user: textField(record, 'user'),
  }
  return { status: 'ok', path, state }
}

/** Project a reading onto the facts that are safe to show or serialize. */
export function cliLoginFacts(reading: CliLoginReading): CliLoginFacts {
  return {
    status: reading.status,
    path: reading.path,
    hasRuntimeKey: reading.state?.runtimeKey !== undefined,
    hasControlKey: reading.state?.controlKey !== undefined,
    ...(reading.state?.apiUrl === undefined ? {} : { apiUrl: reading.state.apiUrl }),
    ...(reading.state?.user === undefined ? {} : { user: reading.state.user }),
  }
}

/** One non-empty trimmed string, or undefined. */
function clean(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text === '' ? undefined : text
}

/**
 * Resolve one request's credential facts.
 *
 * The reference layer is asked exactly once and only when no literal key is
 * configured; a rejection from that layer is treated as a miss so the CLI
 * login state can still serve the request. Nothing here throws for a missing
 * credential — the caller decides how to surface "no key".
 */
export async function resolveCredentialChain(
  config: CredentialChainConfig,
  deps: CredentialChainDeps = {},
): Promise<CredentialChainResult> {
  const reference = clean(config.apiKeyEnv) ?? DEFAULT_API_KEY_ENV
  const login = await readCliLoginState(
    clean(config.amrConfigPath) ?? defaultAmrConfigPath(deps.homeDir),
    deps.readFile ?? readUtf8,
  )

  const literal = clean(config.apiKey)
  let source: CredentialSource = 'none'
  let apiKey: string | undefined

  if (literal !== undefined) {
    source = 'literal'
    apiKey = literal
  } else {
    let referenced: string | undefined
    if (deps.resolveReference !== undefined) {
      try {
        referenced = clean(await deps.resolveReference(reference))
      } catch {
        // A credential-seam failure is a miss for this layer, not a dead chain.
        referenced = undefined
      }
    }
    if (referenced !== undefined) {
      source = 'reference'
      apiKey = referenced
    } else if (login.state?.runtimeKey !== undefined) {
      source = 'cli-login'
      apiKey = login.state.runtimeKey
    }
  }

  const explicitBase = clean(config.apiBase)
  const loginBase = login.state?.linkUrl
  const apiBaseSource: ApiBaseSource = explicitBase !== undefined
    ? 'config'
    : source === 'cli-login' && loginBase !== undefined
      ? 'cli-login'
      : 'default'
  const apiBase = apiBaseSource === 'config'
    ? explicitBase!
    : apiBaseSource === 'cli-login'
      ? cliLoginApiBase(loginBase!)
      : DEFAULT_API_BASE

  return {
    source,
    ...(apiKey === undefined ? {} : { apiKey }),
    reference,
    apiBase,
    apiBaseSource,
    login: cliLoginFacts(login),
  }
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
export function cliLoginApiBase(linkUrl: string): string {
  const trimmed = linkUrl.trim().replace(/\/+$/u, '')
  if (trimmed === '') return DEFAULT_API_BASE
  try {
    const url = new URL(trimmed)
    return url.pathname === '' || url.pathname === '/'
      ? `${trimmed}/v1`
      : trimmed
  } catch {
    return trimmed
  }
}

/** The two ways forward when neither the config nor the CLI login state has a key. */
export function missingCredentialMessage(reference: string = DEFAULT_API_KEY_ENV): string {
  return `还没有可用的 Open Design API Key（provider 路由 "open-design"，凭据引用 ${reference}）。`
    + '请在 设置 → Open Design 填入 API Key（或在启动环境导出该变量、在 composition 里设置 config.apiKey）；'
    + '也可以在终端执行 `vela login` 复用桌面端登录态。'
    + 'Key 在 https://open-design.ai/cloud/api-keys 创建。'
}

/** Secret-shaped tokens that must never reach a copied diagnostic. */
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{4,}|vela_(?:ctrl|rt)_[A-Za-z0-9_-]{4,})\b/gu

/** Drop the userinfo part of a URL so a pasted diagnostic cannot leak it. */
function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return value
  }
}

/** Replace anything secret-shaped in free text. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, '<redacted>')
}

/**
 * The copyable diagnostic. It names the reference and reports presence and
 * provenance only; neither the literal key nor the CLI runtime/control keys
 * have a slot in the output, and URL userinfo is stripped.
 */
export function formatCredentialDiagnostic(result: CredentialChainResult): string {
  const sourceLabel = {
    literal: 'literal（config.apiKey）',
    reference: `凭据引用 ${result.reference}`,
    'cli-login': 'CLI 登录态 runtimeKey',
    none: '未配置',
  }[result.source]
  const baseLabel = {
    config: 'config.apiBase',
    'cli-login': 'CLI 登录态 linkUrl',
    default: '默认网关',
  }[result.apiBaseSource]
  const loginLabel = {
    ok: '可读',
    missing: '文件不存在',
    malformed: '格式不可用',
    unreadable: '不可读',
  }[result.login.status]
  return [
    'Open Design 凭据诊断',
    `- API Key：${result.source === 'none' ? '未设置' : `已设置（来源：${sourceLabel}）`}`,
    `- 凭据引用：${result.reference}`,
    `- 网关地址：${redactUrl(redactSecrets(result.apiBase))}（来源：${baseLabel}）`,
    `- CLI 登录态：${loginLabel}（${result.login.path}）`,
    `- controlKey：${result.login.hasControlKey ? '可用' : '不可用'}`,
  ].join('\n')
}
