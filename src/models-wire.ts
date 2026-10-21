/**
 * Wire contract for the `opendesign/models` Remote (ticket 08).
 *
 * The browser never holds the API key and cannot read `~/.amr/config.json`, so
 * the Host serves one report that answers both questions the settings page and
 * the Models-page card ask: which catalog is in effect (live or static, and
 * which entries are uncalibrated) and what the credential chain resolved to
 * (source, reference, base URL, CLI login state and control-key availability).
 *
 * The report deliberately has no field that could carry a key value. Its strict
 * parser is the boundary validator on both halves; the descriptor and
 * contribution below are the only registration shape either half uses.
 *
 * Client-bundle safe: only type imports cross into Host-only modules.
 *
 * @module dsh-opendesign-provider/models-wire
 */

import type { InvocationDescriptor, TypertRemoteContribution, TypertSchema } from '@deepseek-ai/dsh-typert-protocol'
import type { ApiBaseSource, CliLoginStatus, CredentialSource } from './credentials.ts'
import {
  makeBoundaryValidator,
  makeRemoteDescriptor,
  REMOTE_NAMESPACE,
  REMOTE_PACKAGE,
} from './wire-shared.ts'

/** Canonical `<namespace>/<method>` endpoint of the models report. */
export const MODELS_ENDPOINT = `${REMOTE_NAMESPACE}/models`

/** One catalog entry as the settings page needs it (no adapter-only fields). */
export interface ModelsReportEntry {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  cost: 'low' | 'medium' | 'high'
  capability: 'standard' | 'advanced'
  inputModalities: string[]
  reasoningLevels: string[]
  default: boolean
  /** Whether the static snapshot knows this id (false = uncalibrated). */
  calibrated: boolean
}

/** The catalog half: provenance plus entries. */
export interface ModelsReportCatalog {
  source: 'live' | 'static'
  apiBase: string
  cached: boolean
  fetchedAt?: number | undefined
  reason?: string | undefined
  models: ModelsReportEntry[]
}

/** The credential half: presence and provenance only, never a value. */
export interface ModelsReportCredential {
  source: CredentialSource
  reference: string
  configured: boolean
  apiBase: string
  apiBaseSource: ApiBaseSource
  login: {
    status: CliLoginStatus
    path: string
    hasRuntimeKey: boolean
    hasControlKey: boolean
    apiUrl?: string | undefined
    user?: string | undefined
  }
}

/** The whole `opendesign/models` result. */
export interface OpenDesignModelsReport {
  catalog: ModelsReportCatalog
  credential: ModelsReportCredential
}

const {
  reject,
  record,
  stringField,
  numberField,
  booleanField,
} = makeBoundaryValidator('opendesign/models result:')

const CREDENTIAL_SOURCES: readonly string[] = ['literal', 'reference', 'cli-login', 'none']
const API_BASE_SOURCES: readonly string[] = ['config', 'cli-login', 'default']
const LOGIN_STATUSES: readonly string[] = ['ok', 'missing', 'malformed', 'unreadable']
const COSTS: readonly string[] = ['low', 'medium', 'high']
const CAPABILITIES: readonly string[] = ['standard', 'advanced']

/** Read one optional string and reject a present non-string. */
function optionalString(source: Record<string, unknown>, key: string, field: string): string | undefined {
  if (source[key] === undefined) return undefined
  return stringField(source, key, field)
}

/** Read one optional finite number and reject a present non-number. */
function optionalNumber(source: Record<string, unknown>, key: string, field: string): number | undefined {
  if (source[key] === undefined) return undefined
  return numberField(source, key, field)
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) reject(field)
  const items: string[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') reject(field)
    items.push(item as string)
  }
  return items
}

function parseEntry(value: unknown, field: string): ModelsReportEntry {
  const source = record(value, field)
  const cost = stringField(source, 'cost', `${field}.cost`)
  if (!COSTS.includes(cost)) reject(`${field}.cost`)
  const capability = stringField(source, 'capability', `${field}.capability`)
  if (!CAPABILITIES.includes(capability)) reject(`${field}.capability`)
  return {
    id: stringField(source, 'id', `${field}.id`),
    name: stringField(source, 'name', `${field}.name`),
    contextWindow: numberField(source, 'contextWindow', `${field}.contextWindow`),
    maxTokens: numberField(source, 'maxTokens', `${field}.maxTokens`),
    cost: cost as ModelsReportEntry['cost'],
    capability: capability as ModelsReportEntry['capability'],
    inputModalities: stringList(source.inputModalities, `${field}.inputModalities`),
    reasoningLevels: stringList(source.reasoningLevels, `${field}.reasoningLevels`),
    default: booleanField(source, 'default', `${field}.default`),
    calibrated: booleanField(source, 'calibrated', `${field}.calibrated`),
  }
}

function parseCatalog(value: unknown): ModelsReportCatalog {
  const source = record(value, 'catalog')
  const kind = stringField(source, 'source', 'catalog.source')
  if (kind !== 'live' && kind !== 'static') reject('catalog.source')
  if (!Array.isArray(source.models)) reject('catalog.models')
  const fetchedAt = optionalNumber(source, 'fetchedAt', 'catalog.fetchedAt')
  const reason = optionalString(source, 'reason', 'catalog.reason')
  return {
    source: kind as 'live' | 'static',
    apiBase: stringField(source, 'apiBase', 'catalog.apiBase'),
    cached: booleanField(source, 'cached', 'catalog.cached'),
    ...(fetchedAt === undefined ? {} : { fetchedAt }),
    ...(reason === undefined ? {} : { reason }),
    models: (source.models as unknown[]).map((entry, index) => parseEntry(entry, `catalog.models[${index}]`)),
  }
}

function parseCredential(value: unknown): ModelsReportCredential {
  const source = record(value, 'credential')
  const kind = stringField(source, 'source', 'credential.source')
  if (!CREDENTIAL_SOURCES.includes(kind)) reject('credential.source')
  const baseSource = stringField(source, 'apiBaseSource', 'credential.apiBaseSource')
  if (!API_BASE_SOURCES.includes(baseSource)) reject('credential.apiBaseSource')
  const login = record(source.login, 'credential.login')
  const status = stringField(login, 'status', 'credential.login.status')
  if (!LOGIN_STATUSES.includes(status)) reject('credential.login.status')
  const apiUrl = optionalString(login, 'apiUrl', 'credential.login.apiUrl')
  const user = optionalString(login, 'user', 'credential.login.user')
  return {
    source: kind as CredentialSource,
    reference: stringField(source, 'reference', 'credential.reference'),
    configured: booleanField(source, 'configured', 'credential.configured'),
    apiBase: stringField(source, 'apiBase', 'credential.apiBase'),
    apiBaseSource: baseSource as ApiBaseSource,
    login: {
      status: status as CliLoginStatus,
      path: stringField(login, 'path', 'credential.login.path'),
      hasRuntimeKey: booleanField(login, 'hasRuntimeKey', 'credential.login.hasRuntimeKey'),
      hasControlKey: booleanField(login, 'hasControlKey', 'credential.login.hasControlKey'),
      ...(apiUrl === undefined ? {} : { apiUrl }),
      ...(user === undefined ? {} : { user }),
    },
  }
}

/** Strictly parse one untrusted `opendesign/models` result. */
export function parseModelsReport(value: unknown): OpenDesignModelsReport {
  const source = record(value, 'result')
  return {
    catalog: parseCatalog(source.catalog),
    credential: parseCredential(source.credential),
  }
}

/** The strict result codec the Typert registry validates with. */
export const modelsSchema: TypertSchema<OpenDesignModelsReport> = {
  parse: parseModelsReport,
}

/** The Host and Client descriptor for `opendesign/models`. */
export const MODELS_DESCRIPTOR: InvocationDescriptor = makeRemoteDescriptor<OpenDesignModelsReport>(
  MODELS_ENDPOINT,
  'models',
  `${REMOTE_PACKAGE}#OpenDesignModelsReport`,
  modelsSchema,
)

/** The Client-face contribution it mounts. */
export const MODELS_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: REMOTE_PACKAGE,
  descriptors: [MODELS_DESCRIPTOR],
}

/*
 * The typed Remote face lives in `remote-map.ts`: Typert's namespace
 * augmentation must declare every `opendesign` endpoint in one place. It is a
 * source-level type contract (the declaration bundler strips module
 * augmentations from `lib/index.d.ts`, for every wire module, before and after
 * this ticket).
 */
