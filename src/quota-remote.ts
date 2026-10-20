/**
 * Host half of `opendesign/usage` (ticket 10).
 *
 * One job: hand the browser the same frozen quota snapshot the `/opendesign`
 * command renders, from the same {@link OpenDesignControlPlane} instance — so
 * the command and the P1 panel never disagree and never double-query the
 * control plane inside the 60-second window.
 *
 * The wiring rides an optional `ctx.inject(['typert'], …)` fiber, exactly like
 * the models Remote: a headless profile without the web stack never mounts it,
 * and the command keeps working on its own.
 *
 * @module dsh-opendesign-provider/quota-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { QuotaReading, QuotaSnapshot } from './control-plane.ts'
import { REMOTE_NAMESPACE } from './identity.ts'
import { QUOTA_DESCRIPTOR, QUOTA_SERVICE } from './quota-wire.ts'
import { REMOTE_PACKAGE } from './wire-shared.ts'

/** Everything the service reads beyond its Cordis context. */
export interface OpenDesignQuotaDeps {
  /** One quota reading (the Host's 60-second cache lives behind this thunk). */
  quota: () => Promise<QuotaReading>
}

/** The Cordis service the Typert Gateway resolves by {@link QUOTA_SERVICE}. */
export class OpenDesignQuotaService extends TypertRemoteService {
  private readonly deps: OpenDesignQuotaDeps

  constructor(ctx: Context, deps: OpenDesignQuotaDeps) {
    super(ctx, QUOTA_SERVICE, { namespace: REMOTE_NAMESPACE })
    this.deps = deps
  }

  /** The frozen snapshot, `stale` flag and all — never a raw control-plane page. */
  async usage(): Promise<QuotaSnapshot> {
    const reading = await this.deps.quota()
    return reading.snapshot
  }
}

/** The registry method surface this module uses (structural, like the models Remote). */
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
const QUOTA_HOST_CONTRIBUTION = {
  package: REMOTE_PACKAGE,
  face: 'host' as const,
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [QUOTA_DESCRIPTOR],
}

/**
 * Provide the service and register its descriptor on an optional Typert
 * registry. A profile without the registry never reaches the callback.
 */
export function applyQuotaRemote(ctx: Context, deps: OpenDesignQuotaDeps): void {
  ctx.inject(['typert'], (remoteCtx) => {
    new OpenDesignQuotaService(remoteCtx, deps)
    const registry = remoteCtx.typert as unknown as TypertContributionRegistry
    const unregister = registry.register(QUOTA_HOST_CONTRIBUTION)
    remoteCtx.effect(() => () => void unregister(), 'dsh-opendesign-provider: quota remote')
  })
}
