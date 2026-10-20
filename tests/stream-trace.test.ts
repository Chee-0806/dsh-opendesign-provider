/**
 * Raw-stream trace tests (`src/stream-trace.ts` + its adapter wiring).
 *
 * The trace is the diagnostic for "the response stopped in the middle and
 * nothing said why": it is the only artifact that separates a provider-side cut
 * from a parser miss. These pin that it stays free when off, that it never takes
 * the request down with it, and that its records describe a cut.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  boundTraceText,
  openStreamTrace,
  resolveStreamTracePath,
  STREAM_TRACE_DEFAULT_FILE,
  STREAM_TRACE_MAX_BYTES,
  STREAM_TRACE_MAX_TEXT,
} from '../src/stream-trace.ts'

/** A throwaway directory removed with the test that made it. */
function scratch(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-opendesign-trace-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Read a trace file back as records. */
function records(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

// Switch resolution

test('the trace is off unless the environment names it', () => {
  assert.equal(resolveStreamTracePath(undefined), undefined)
  assert.equal(resolveStreamTracePath(''), undefined)
  assert.equal(resolveStreamTracePath('   '), undefined)
  // A bare flag means "somewhere sensible", not "a file called 1".
  for (const flag of ['1', 'true', 'YES', 'On']) {
    assert.equal(resolveStreamTracePath(flag), join(tmpdir(), STREAM_TRACE_DEFAULT_FILE))
  }
  // Explicit off-spellings disable rather than becoming a file name: `false`
  // used to switch the trace ON and write the conversation to ./false.
  for (const off of ['0', 'false', 'FALSE', 'no', 'off', ' off ']) {
    assert.equal(resolveStreamTracePath(off), undefined)
  }
  assert.equal(resolveStreamTracePath('/tmp/x.jsonl'), '/tmp/x.jsonl')
  assert.equal(resolveStreamTracePath('  /tmp/x.jsonl  '), '/tmp/x.jsonl')
})

test('boundTraceText keeps short text and marks what it dropped', () => {
  assert.equal(boundTraceText('hello', 10), 'hello')
  assert.equal(boundTraceText('hello', 5), 'hello')
  assert.equal(boundTraceText('hello world', 5), 'hello…[+6 chars]')
  assert.equal(boundTraceText('x'.repeat(STREAM_TRACE_MAX_TEXT + 4)).endsWith('…[+4 chars]'), true)
})

// Writer

test('an unset switch yields an inert writer', () => {
  const trace = openStreamTrace('open-design/m')
  assert.equal(trace.enabled, false)
  // Both members are safe to call on the disabled stand-in.
  trace.record('anything', { a: 1 })
  trace.close()
})

test('records are JSONL in arrival order, stamped with elapsed milliseconds', (t) => {
  const dir = scratch(t)
  const path = join(dir, 'nested', 'trace.jsonl')
  let clock = 1_000
  const trace = openStreamTrace('open-design/deepseek', { path, now: () => clock })
  assert.equal(trace.enabled, true)
  assert.equal(records(path)[0]!.event, 'stream-open')
  clock = 1_250
  trace.record('chunk', { n: 1, text: 'hi' })
  clock = 9_999
  trace.close()
  const written = records(path)
  assert.deepEqual(written.map((r) => r.event), ['stream-open', 'chunk', 'stream-close'])
  assert.deepEqual(written.map((r) => r.at), [0, 250, 8999])
  assert.equal(written[1]!.scope, 'open-design/deepseek')
  assert.equal(written[1]!.n, 1)
  assert.equal(written[1]!.text, 'hi')
  assert.equal(typeof written[2]!.bytes, 'number')
})

test('a trace that cannot be written disables itself instead of throwing', (t) => {
  const dir = scratch(t)
  // A path whose parent is a FILE cannot be prepared, so the writer degrades.
  const blocker = join(dir, 'blocker')
  writeFileSync(blocker, 'not a directory')
  const trace = openStreamTrace('open-design/m', { path: join(blocker, 'trace.jsonl') })
  assert.equal(trace.enabled, false)
  trace.record('chunk', { text: 'x' })
  trace.close()
})

test('an unserializable payload drops that record only', (t) => {
  const dir = scratch(t)
  const path = join(dir, 'trace.jsonl')
  const trace = openStreamTrace('open-design/m', { path })
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  trace.record('bad', cyclic)
  trace.record('good', { ok: true })
  assert.deepEqual(records(path).map((r) => r.event), ['stream-open', 'good'])
})

test('one request cannot write past the cap', (t) => {
  const dir = scratch(t)
  const path = join(dir, 'trace.jsonl')
  const trace = openStreamTrace('open-design/m', { path })
  const payload = 'x'.repeat(64 * 1024)
  for (let i = 0; i < Math.ceil(STREAM_TRACE_MAX_BYTES / payload.length) + 4; i += 1) {
    trace.record('chunk', { text: payload })
  }
  const written = records(path)
  assert.equal(written[written.length - 1]!.event, 'trace-capped')
  assert.equal(written[written.length - 1]!.scope, 'open-design/m')
  // Payload stops, but bounded terminal metadata survives a long generation.
  trace.record('after', {})
  trace.record('end', { outcome: 'output-token-limit', finishReason: 'length' })
  trace.close()
  trace.close()
  assert.deepEqual(records(path).slice(written.length).map(record => record.event), ['end', 'stream-close'])
  assert.equal(records(path).at(-2)?.finishReason, 'length')
})
