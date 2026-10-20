/**
 * Host half of `opendesign/models` (ticket 08).
 *
 * The settings page and the Models-page card need two Host-only facts: the
 * catalog's provenance (`OpenDesignAdapter.catalogStatus()`, ticket 03) and
 * the credential chain's outcome (ticket 08). Neither the API key nor the CLI
 * login state's keys cross the Remote: the report carries presence and source
 * only.
 *
 * The whole wiring rides an optional `ctx.inject(['typert'], …)` fiber, so a
 * headless profile without the web stack simply never mounts it; a browser
 * bundle older or newer than the Host degrades to the unknown-catalog state.
 *
 * @module dsh-opendesign-provider/models-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { CredentialChainResult } from './credentials.ts'
import type { GatewayCatalogStatus } from './gateway-facts.ts'
import { REMOTE_NAMESPACE, REMOTE_SERVICE } from './identity.ts'
import {
  MODELS_DESCRIPTOR,
  type ModelsReportCatalog,
  type OpenDesignModelsReport,
} from './models-wire.ts'
import { REMOTE_PACKAGE } from './wire-shared.ts'

/** Everything the service reads beyond its Cordis context. */
export interface OpenDesignModelsDeps {
  /** The adapter's catalog provenance; never throws for a reachable route. */
  catalogStatus: () => Promise<GatewayCatalogStatus>
  /** The credential chain's safe projection; never contains the key values. */
  credentialStatus: () => Promise<CredentialChainResult>
}

/** Project one catalog status onto the wire shape. */
function catalogReport(status: GatewayCatalogStatus): ModelsReportCatalog {
  return {
    source: status.source,
    apiBase: status.apiBase,
    cached: status.cached,
    ...(status.fetchedAt === undefined ? {} : { fetchedAt: status.fetchedAt }),
    ...(status.reason === undefined ? {} : { reason: status.reason }),
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
      calibrated: entry.calibrated,
    })),
  }
}

/** Project one credential resolution onto the wire shape, dropping the key. */
function credentialReport(chain: CredentialChainResult): OpenDesignModelsReport['credential'] {
  return {
    source: chain.source,
    reference: chain.reference,
    configured: chain.apiKey !== undefined,
    apiBase: chain.apiBase,
    apiBaseSource: chain.apiBaseSource,
    login: {
      status: chain.login.status,
      path: chain.login.path,
      hasRuntimeKey: chain.login.hasRuntimeKey,
      hasControlKey: chain.login.hasControlKey,
      ...(chain.login.apiUrl === undefined ? {} : { apiUrl: chain.login.apiUrl }),
      ...(chain.login.user === undefined ? {} : { user: chain.login.user }),
    },
  }
}

/** The one report both browser surfaces consume. */
export function buildModelsReport(
  catalog: GatewayCatalogStatus,
  chain: CredentialChainResult,
): OpenDesignModelsReport {
  return {
    catalog: catalogReport(catalog),
    credential: credentialReport(chain),
  }
}

/** The Cordis service the Typert Gateway resolves by {@link REMOTE_SERVICE}. */
export class OpenDesignModelsService extends TypertRemoteService {
  private readonly deps: OpenDesignModelsDeps

  constructor(ctx: Context, deps: OpenDesignModelsDeps) {
    super(ctx, REMOTE_SERVICE, { namespace: REMOTE_NAMESPACE })
    this.deps = deps
  }

  /** Read both Host-only facts fresh for one browser request. */
  async models(): Promise<OpenDesignModelsReport> {
    const [catalog, chain] = await Promise.all([
      this.deps.catalogStatus(),
      this.deps.credentialStatus(),
    ])
    return buildModelsReport(catalog, chain)
  }
}

/** The registry method surface this module uses (structural, like the old wire). */
interface TypertContributionRegistry {
  register(contribution: {
    package: string
    face: 'host'
    schemas: unknown[]
    model: { services: unknown[]; events: unknown[]; objects: unknown[] }
    invocations: unknown[]
  }): () => void | Promise<void>
}

/** The Host-face contribution carrying the one descriptor. */
const MODELS_HOST_CONTRIBUTION = {
  package: REMOTE_PACKAGE,
  face: 'host' as const,
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [MODELS_DESCRIPTOR],
}

/**
 * Provide the service and register its descriptor on an optional Typert
 * registry. A profile without the registry never reaches the callback.
 */
export function applyModelsRemote(ctx: Context, deps: OpenDesignModelsDeps): void {
  ctx.inject(['typert'], (remoteCtx) => {
    new OpenDesignModelsService(remoteCtx, deps)
    const registry = remoteCtx.typert as unknown as TypertContributionRegistry
    const unregister = registry.register(MODELS_HOST_CONTRIBUTION)
    remoteCtx.effect(() => () => void unregister(), 'dsh-opendesign-provider: models remote')
  })
}
