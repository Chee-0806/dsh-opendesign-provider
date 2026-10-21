/**
 * Host half of the `opendesign` namespace: `opendesign/models` (ticket 08) and,
 * when the plugin supplies analytics deps, `opendesign/analytics` (ticket 12).
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
import type { QuotaSnapshot } from './control-plane.ts'
import { QUOTA_DESCRIPTOR } from './quota-wire.ts'
import { analyticsReport, type OpenDesignAnalyticsDeps } from './analytics-remote.ts'
import {
  ANALYTICS_DESCRIPTOR,
  type AnalyticsQuery,
  type OpenDesignAnalyticsReport,
} from './analytics-wire.ts'
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
  /**
   * Ticket 12's analytics read. Supplying it adds the `analytics` method to
   * this one Service and registers its descriptor. It lives here because
   * Cordis allows exactly one Service per key (`opendesignUsage`) and two
   * `ctx.inject(['typert'])` scopes cannot see each other's services.
   */
  analytics?: OpenDesignAnalyticsDeps | undefined
  /**
   * Ticket 10's quota read. Supplying it adds the `usage` method to this one
   * Service and registers its descriptor — the Typert Gateway resolves one
   * service per namespace, so a second service could never receive the call.
   */
  quota?: (() => Promise<QuotaSnapshot>) | undefined
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

  /**
   * The ticket 12 analytics invocation, present only when the plugin supplied
   * analytics deps. It shares this Service because one Cordis key cannot host
   * two instances; the `opendesign/models` method and descriptor are untouched.
   */
  readonly analytics?: ((query: AnalyticsQuery) => Promise<OpenDesignAnalyticsReport>) | undefined

  /** The ticket 10 quota read, present only when the plugin supplied quota deps. */
  readonly usage?: (() => Promise<QuotaSnapshot>) | undefined

  constructor(ctx: Context, deps: OpenDesignModelsDeps) {
    super(ctx, REMOTE_SERVICE, { namespace: REMOTE_NAMESPACE })
    this.deps = deps
    if (deps.analytics !== undefined) {
      const analyticsDeps = deps.analytics
      this.analytics = (query: AnalyticsQuery) => analyticsReport(analyticsDeps, query)
    }
    if (deps.quota !== undefined) {
      const quota = deps.quota
      this.usage = () => quota()
    }
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

/** The Host-face contribution: the models descriptor, plus analytics when wired. */
function hostContribution(deps: OpenDesignModelsDeps): {
  package: string
  face: 'host'
  schemas: unknown[]
  model: { services: unknown[]; events: unknown[]; objects: unknown[] }
  invocations: unknown[]
} {
  return {
    package: REMOTE_PACKAGE,
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [
      MODELS_DESCRIPTOR,
      ...(deps.analytics === undefined ? [] : [ANALYTICS_DESCRIPTOR]),
      ...(deps.quota === undefined ? [] : [QUOTA_DESCRIPTOR]),
    ],
  }
}

/**
 * Provide the service and register its descriptor on an optional Typert
 * registry. A profile without the registry never reaches the callback.
 */
export function applyModelsRemote(ctx: Context, deps: OpenDesignModelsDeps): void {
  ctx.inject(['typert'], (remoteCtx) => {
    new OpenDesignModelsService(remoteCtx, deps)
    const registry = remoteCtx.typert as unknown as TypertContributionRegistry
    const unregister = registry.register(hostContribution(deps))
    remoteCtx.effect(() => () => void unregister(), 'dsh-opendesign-provider: models remote')
  })
}
