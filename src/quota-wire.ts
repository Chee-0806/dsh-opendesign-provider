/**
 * Wire contract for the `opendesign/usage` Remote (ticket 10).
 *
 * The frozen quota snapshot (spec §额度) is the only thing this Remote carries:
 * tier, subscription period, wallet balance, the billing `funding` and the
 * five-hour / seven-day windows with their reset times. `creditsPerUsd` is
 * deliberately absent — it is a presentation conversion the Host applies when
 * it renders, not quota state a browser surface needs to trust.
 *
 * The strict parser is the boundary validator on both halves; `controlPlaneAvailable`
 * is required so "no control key" can never be mistaken for "zero usage".
 *
 * Client-bundle safe: only type imports cross into Host-only modules.
 *
 * @module dsh-opendesign-provider/quota-wire
 */

import type { InvocationDescriptor, TypertRemoteContribution, TypertSchema } from '@deepseek-ai/dsh-typert-protocol'
import type { QuotaSnapshot, QuotaWindow, QuotaWindowKind } from './control-plane.ts'
import {
  makeBoundaryValidator,
  makeRemoteDescriptor,
  REMOTE_NAMESPACE,
  REMOTE_PACKAGE,
} from './wire-shared.ts'

/** Canonical `<namespace>/<method>` endpoint of the quota snapshot. */
export const QUOTA_ENDPOINT = `${REMOTE_NAMESPACE}/usage`

/**
 * The Cordis service key the quota Remote is provided under. The models Remote
 * owns `opendesignUsage`; Cordis rejects a second service on the same key, so
 * the quota half brings its own.
 */
export const QUOTA_SERVICE = 'opendesignQuota'

const { reject, record, stringField, numberField, booleanField } = makeBoundaryValidator(
  'opendesign/usage result:',
)

const WINDOW_KINDS: readonly string[] = ['five_hour', 'seven_day', 'other']
const FUNDINGS: readonly string[] = ['wallet', 'coding_plan']

function optionalString(source: Record<string, unknown>, key: string, field: string): string | undefined {
  if (source[key] === undefined) return undefined
  return stringField(source, key, field)
}

function parseWindow(value: unknown, field: string): QuotaWindow {
  const source = record(value, field)
  const kind = stringField(source, 'kind', `${field}.kind`)
  if (!WINDOW_KINDS.includes(kind)) reject(`${field}.kind`)
  const resetsAt = optionalString(source, 'resetsAt', `${field}.resetsAt`)
  const resetMode = optionalString(source, 'resetMode', `${field}.resetMode`)
  return {
    kind: kind as QuotaWindowKind,
    durationSeconds: numberField(source, 'durationSeconds', `${field}.durationSeconds`),
    usedCredits: numberField(source, 'usedCredits', `${field}.usedCredits`),
    limitCredits: numberField(source, 'limitCredits', `${field}.limitCredits`),
    remainingCredits: numberField(source, 'remainingCredits', `${field}.remainingCredits`),
    ...(resetsAt === undefined ? {} : { resetsAt }),
    ...(resetMode === undefined ? {} : { resetMode }),
  }
}

/** Strictly parse one untrusted `opendesign/usage` result. */
export function parseQuotaSnapshot(value: unknown): QuotaSnapshot {
  const source = record(value, 'result')
  if (!Array.isArray(source.windows)) reject('windows')
  const funding = optionalString(source, 'funding', 'funding')
  if (funding !== undefined && !FUNDINGS.includes(funding)) reject('funding')
  const tier = optionalString(source, 'tier', 'tier')
  const subscriptionStatus = optionalString(source, 'subscriptionStatus', 'subscriptionStatus')
  const currentPeriodEnd = optionalString(source, 'currentPeriodEnd', 'currentPeriodEnd')
  const balanceUsd = source.balanceUsd === undefined
    ? undefined
    : numberField(source, 'balanceUsd', 'balanceUsd')
  return {
    controlPlaneAvailable: booleanField(source, 'controlPlaneAvailable', 'controlPlaneAvailable'),
    ...(tier === undefined ? {} : { tier }),
    ...(subscriptionStatus === undefined ? {} : { subscriptionStatus }),
    ...(currentPeriodEnd === undefined ? {} : { currentPeriodEnd }),
    ...(balanceUsd === undefined ? {} : { balanceUsd }),
    ...(funding === undefined ? {} : { funding: funding as 'wallet' | 'coding_plan' }),
    windows: (source.windows as unknown[]).map((entry, index) => parseWindow(entry, `windows[${index}]`)),
    fetchedAt: stringField(source, 'fetchedAt', 'fetchedAt'),
    ...(source.stale === undefined ? {} : { stale: booleanField(source, 'stale', 'stale') }),
  }
}

/** The strict result codec the Typert registry validates with. */
export const quotaSchema: TypertSchema<QuotaSnapshot> = {
  parse: parseQuotaSnapshot,
}

/** The Host descriptor for `opendesign/usage`. */
export const QUOTA_DESCRIPTOR: InvocationDescriptor = makeRemoteDescriptor<QuotaSnapshot>(
  QUOTA_ENDPOINT,
  'usage',
  `${REMOTE_PACKAGE}#QuotaSnapshot`,
  quotaSchema,
  QUOTA_SERVICE,
)

/** The Client-face contribution it mounts. */
export const QUOTA_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: REMOTE_PACKAGE,
  descriptors: [QUOTA_DESCRIPTOR],
}

/*
 * The typed Remote face lives in `remote-map.ts`: Typert's namespace
 * augmentation must declare every `opendesign` endpoint in one place.
 */
