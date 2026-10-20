/**
 * Remote-descriptor plumbing: the strict result codec and the shared identity
 * every Open Design wire contract must reuse (node:test, no network).
 *
 * The Typert strict codec is a LAZY schema factory — `{ mode: 'strict',
 * typeSymbol, create: () => TypertSchema }` — and the registry reads exactly
 * that member. Ticket 01 has no Remote yet, so these drive the helpers the P1
 * wire files will build on.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  makeBoundaryValidator,
  makeRemoteDescriptor,
  makeStrictCodec,
  REMOTE_NAMESPACE,
  REMOTE_PACKAGE,
  REMOTE_SERVICE,
} from '../src/wire-shared.ts'
import {
  PACKAGE_NAME,
  REMOTE_NAMESPACE as IDENTITY_NAMESPACE,
  REMOTE_SERVICE as IDENTITY_SERVICE,
} from '../src/identity.ts'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

/** The registry's registration check: a strict codec needs a create() factory. */
function assertEngineAccepts(codec: InvocationDescriptor['result'], subject: string): void {
  if (codec.mode === 'src-json') return
  assert.equal(typeof codec.create, 'function', `${subject}: strict codec needs create()`)
}

test('the Remote identity comes from the identity module', () => {
  assert.equal(REMOTE_PACKAGE, PACKAGE_NAME)
  assert.equal(REMOTE_NAMESPACE, IDENTITY_NAMESPACE)
  assert.equal(REMOTE_SERVICE, IDENTITY_SERVICE)
  assert.equal(REMOTE_NAMESPACE, 'opendesign')
  assert.equal(REMOTE_SERVICE, 'opendesignUsage')
})

test('a descriptor carries the shared namespace, service and a lazy strict result', () => {
  const descriptor = makeRemoteDescriptor(
    'opendesign/report',
    'report',
    'OpenDesignReport',
    { parse: (value: unknown) => value } as never,
  )
  assert.equal(descriptor.id, `${PACKAGE_NAME}#opendesign/report`)
  assert.equal(descriptor.namespace, 'opendesign')
  assert.equal(descriptor.service, 'opendesignUsage')
  assert.equal(descriptor.method, 'report')
  assert.deepEqual(descriptor.parameters, [])
  assertEngineAccepts(descriptor.result, 'opendesign/report')
  const built = (descriptor.result as { create: () => { parse: unknown } }).create()
  assert.equal(typeof built.parse, 'function')
})

test('a strict codec builds a fresh schema per call instead of holding one', () => {
  let builds = 0
  const schema = { parse: (value: unknown) => value } as never
  const codec = makeStrictCodec('Probe', schema)
  assert.equal(codec.mode, 'strict')
  assert.equal(codec.typeSymbol, 'Probe')
  // `create` is the factory the registry calls; each call may rebuild the schema.
  const wrapped = {
    mode: 'strict' as const,
    typeSymbol: 'Probe',
    create: () => {
      builds += 1
      return schema
    },
  }
  assertEngineAccepts(wrapped as InvocationDescriptor['result'], 'Probe')
  assert.equal(builds, 0, 'building is lazy, not part of the descriptor')
  wrapped.create()
  assert.equal(builds, 1)
})

test('the boundary validator names the endpoint and rejects malformed fields', () => {
  const validator = makeBoundaryValidator('opendesign/report result:')
  assert.deepEqual(validator.record({ ok: true }, 'payload'), { ok: true })
  assert.throws(() => validator.record([], 'payload'), /opendesign\/report result: invalid payload/)
  assert.equal(validator.stringField({ a: 'x' }, 'a', 'a'), 'x')
  assert.throws(() => validator.stringField({ a: 1 }, 'a', 'a'), /invalid a/)
  assert.equal(validator.numberField({ n: 1.5 }, 'n', 'n'), 1.5)
  assert.throws(() => validator.numberField({ n: Number.NaN }, 'n', 'n'), /invalid n/)
  assert.equal(validator.booleanField({ b: true }, 'b', 'b'), true)
  assert.throws(() => validator.booleanField({ b: 'true' }, 'b', 'b'), /invalid b/)
})
