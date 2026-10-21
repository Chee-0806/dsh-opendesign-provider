/**
 * Shared boundary-validation and Remote-descriptor plumbing for the plugin's
 * hand-rolled Typert wire contracts (`opendesign/report`, `opendesign/models`,
 * `opendesign/usage`).
 *
 * Every Remote this plugin serves crosses the Typert Gateway with a strict
 * result schema: the Host half registers a descriptor against a Cordis service
 * and the browser half mounts the matching contribution on `ctx.remote`. This
 * module is dependency-free (beyond type-only Typert imports) so the client
 * bundle can inline it, and it holds the schema helpers and descriptor
 * boilerplate the wire files used to duplicate.
 *
 * The identity constants below are the single source for the namespace and
 * service names every wire file reuses; the models and quota Remotes each
 * provide one Cordis service and register one descriptor through this module.
 *
 * @module dsh-opendesign-provider/wire-shared
 */
import type { InvocationDescriptor, InvocationParameterDescriptor, TypertSchema } from '@deepseek-ai/dsh-typert-protocol'

import { PACKAGE_NAME, REMOTE_NAMESPACE, REMOTE_SERVICE } from './identity.ts'

/** The npm package identity every contribution and descriptor claims. */
export const REMOTE_PACKAGE = PACKAGE_NAME

export { REMOTE_NAMESPACE, REMOTE_SERVICE }

/** The read/validate helpers one boundary codec needs. */
export interface BoundaryValidator {
  /** Reject one boundary value with a field-naming error. */
  reject(field: string): never
  /** Narrow an unknown value to a plain record, or reject. */
  record(value: unknown, field: string): Record<string, unknown>
  /** Read one required string field (`field` is the dotted error label). */
  stringField(source: Record<string, unknown>, key: string, field: string): string
  /** Read one required finite number field (`field` is the dotted error label). */
  numberField(source: Record<string, unknown>, key: string, field: string): number
  /** Read one required boolean field (`field` is the dotted error label). */
  booleanField(source: Record<string, unknown>, key: string, field: string): boolean
}

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
export function makeBoundaryValidator(prefix: string): BoundaryValidator {
  const reject = (field: string): never => {
    throw new TypeError(`${prefix} invalid ${field}`)
  }
  const record = (value: unknown, field: string): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : reject(field)
  const stringField = (source: Record<string, unknown>, key: string, field: string): string =>
    typeof source[key] === 'string' ? source[key] as string : reject(field)
  const numberField = (source: Record<string, unknown>, key: string, field: string): number =>
    typeof source[key] === 'number' && Number.isFinite(source[key] as number)
      ? source[key] as number
      : reject(field)
  const booleanField = (source: Record<string, unknown>, key: string, field: string): boolean =>
    typeof source[key] === 'boolean' ? source[key] as boolean : reject(field)
  return { reject, record, stringField, numberField, booleanField }
}

/**
 * One strict result codec: `mode: 'strict'` carries the LAZY schema factory
 * (`create()`) the registry requires and the Gateway validates with
 * (`codec.create().parse`). There is NO `schema` member — issue #49.
 */
interface StrictCodec<Output> {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly create: () => TypertSchema<Output>
}

/** Use the same strict-codec shape for invocation parameters and results. */
export function makeStrictCodec<Output>(typeSymbol: string, schema: TypertSchema<Output>): StrictCodec<Output> {
  return { mode: 'strict', typeSymbol, create: () => schema }
}

/** Build one JSON business parameter carried in the wire `args` object. */
export function makeRemoteParameter<Input>(
  name: string,
  typeSymbol: string,
  schema: TypertSchema<Input>,
): InvocationParameterDescriptor {
  return {
    name,
    wire: name,
    source: 'json',
    codec: makeStrictCodec(typeSymbol, schema),
  }
}

/**
 * Build one strict invocation descriptor. Every Open Design Remote shares the
 * `opendesign` namespace and a strict result — only the endpoint, method,
 * Cordis service key, result type symbol, parameters and schema differ.
 *
 * `parameters` defaults to none (a parameterless method sends an empty `args`
 * object); `service` defaults to {@link REMOTE_SERVICE}. The quota Remote
 * provides its own key (Cordis allows exactly one service per key) and the
 * Gateway resolves the receiving service by this field.
 */
export function makeRemoteDescriptor<Output>(
  endpoint: string,
  method: string,
  typeSymbol: string,
  schema: TypertSchema<Output>,
  parameters: readonly InvocationParameterDescriptor[] = [],
  service: string = REMOTE_SERVICE,
): InvocationDescriptor {
  return {
    id: `${REMOTE_PACKAGE}#${endpoint}`,
    service,
    namespace: REMOTE_NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: makeStrictCodec(typeSymbol, schema),
  }
}
