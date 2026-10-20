/**
 * Settings-scope lifecycle over the `remote.settings` wire (node:test, no
 * network, no React): what the settings page and the Models-page card rely on
 * when they read a namespace and commit a write.
 *
 * Ticket 01 keeps the generic scope and drops the previous provider page controller
 * that used to consume it; ticket 08's page will consume the same face. These
 * cases therefore drive the scope directly through a fake remote.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createSettingsScope,
  type SettingsPathOp,
  type SettingsRemoteNamespace,
  type SettingsRetryTimer,
  type SettingsScopeContext,
} from '../src/client/settings-scope.ts'

/** Drain every pending microtask and zero-delay timer. */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => { setTimeout(resolve, 5) })
}

type Row = Record<string, unknown>
type NamespaceRow = {
  ns?: unknown
  value?: unknown
  base?: unknown
  user?: unknown
  revision?: unknown
}

interface FakeRemote {
  context: SettingsScopeContext
  namespace: SettingsRemoteNamespace
  describeCalls: () => number
  mutations: Array<{ ns: string; ops: readonly SettingsPathOp[]; revision: number | undefined }>
  setWritable(writable: boolean): void
  setConflict(conflict: boolean): void
}

/** A fake `remote.settings` whose describe view and mutate answer the test owns. */
function makeRemote(rows: NamespaceRow[], writable = true): FakeRemote {
  let view = { namespaces: rows, writable }
  let conflict = false
  const mutations: FakeRemote['mutations'] = []
  let describes = 0
  const namespace: SettingsRemoteNamespace = {
    async describe() {
      describes += 1
      return { ok: true, value: view }
    },
    async mutate(ns, ops, revision) {
      mutations.push({ ns, ops, revision })
      if (conflict) return { ok: false, error: { message: 'SETTINGS_CONFLICT' } }
      const current = view.namespaces.find((row) => row.ns === ns)
      const value = { ...(current?.value as Row | undefined) }
      for (const op of ops) {
        if (op.op === 'set') value[op.path[0]!] = op.value
        else delete value[op.path[0]!]
      }
      const next = { ns, value, base: current?.base, user: current?.user, revision: Number(current?.revision ?? 0) + 1 }
      view = { namespaces: view.namespaces.map((row) => (row.ns === ns ? next : row)), writable: view.writable }
      return { ok: true, value: next }
    },
  }
  return {
    context: { remote: {} },
    namespace,
    describeCalls: () => describes,
    mutations,
    setWritable(next) { view = { ...view, writable: next } },
    setConflict(next) { conflict = next },
  }
}

/** Timers the scope would use for a failed first read; tests never wait on them. */
const fakeTimer: SettingsRetryTimer = { set: () => 0, clear: () => {} }

const NAMESPACE = 'llm-opendesign'

test('describe publishes the namespace row and the Host write posture', async () => {
  const remote = makeRemote([{
    ns: NAMESPACE,
    value: { apiBase: 'https://example.invalid/v1' },
    base: { apiBase: 'https://base.invalid/v1' },
    user: { apiBase: 'https://example.invalid/v1' },
    revision: 7,
  }])
  const scope = createSettingsScope<Row>(remote.context, NAMESPACE, () => remote.namespace, fakeTimer)
  await flush()
  const snapshot = scope.getSnapshot()
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.mode, 'host')
  assert.equal(snapshot.writable, true)
  assert.equal(snapshot.revision, 7)
  assert.deepEqual(snapshot.value, { apiBase: 'https://example.invalid/v1' })
  assert.deepEqual(snapshot.base, { apiBase: 'https://base.invalid/v1' })
  assert.deepEqual(snapshot.user, { apiBase: 'https://example.invalid/v1' })
  await scope.dispose()
})

test('a single field write sends the set op behind the described revision', async () => {
  const remote = makeRemote([{ ns: NAMESPACE, value: {}, revision: 3 }])
  const scope = createSettingsScope<Row>(remote.context, NAMESPACE, () => remote.namespace, fakeTimer)
  await flush()
  await scope.set('apiBase', 'https://next.invalid/v1')

  assert.deepEqual(remote.mutations, [{
    ns: NAMESPACE,
    ops: [{ op: 'set', path: ['apiBase'], value: 'https://next.invalid/v1' }],
    revision: 3,
  }])
  assert.equal(remote.describeCalls(), 1, 'an accepted write folds the answer in, no re-read')
  assert.deepEqual(scope.getSnapshot().value, { apiBase: 'https://next.invalid/v1' })
  assert.equal(scope.getSnapshot().revision, 4)
  await scope.dispose()
})

test('a conflict is reported and the Host state is re-read', async () => {
  const remote = makeRemote([{ ns: NAMESPACE, value: { apiBase: 'old' }, revision: 1 }])
  const scope = createSettingsScope<Row>(remote.context, NAMESPACE, () => remote.namespace, fakeTimer)
  await flush()
  remote.setConflict(true)
  assert.equal(await scope.mutate([{ op: 'set', path: ['apiBase'], value: 'draft' }]), 'conflict')
  assert.equal(remote.describeCalls(), 2, 'the rejected write triggers a recovery read')
  assert.deepEqual(scope.getSnapshot().value, { apiBase: 'old' })
  await scope.dispose()
})

test('a missing namespace row degrades to unavailable, never ready-with-nothing', async () => {
  const remote = makeRemote([], false)
  const scope = createSettingsScope<Row>(remote.context, NAMESPACE, () => remote.namespace, fakeTimer)
  await flush()
  const snapshot = scope.getSnapshot()
  assert.equal(snapshot.status, 'unavailable')
  assert.equal(snapshot.writable, false)
  assert.equal(snapshot.value, undefined)
  await scope.dispose()
})

test('a namespace that never mounts keeps the scope read-only and does not throw', async () => {
  const remote = makeRemote([{ ns: NAMESPACE, value: {}, revision: 1 }])
  const never = createSettingsScope<Row>(remote.context, NAMESPACE, () => undefined, fakeTimer)
  await flush()
  assert.equal(never.getSnapshot().writable, false)
  await never.dispose()
})
