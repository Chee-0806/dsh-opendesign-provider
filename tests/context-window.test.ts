/**
 * Custom context-length helpers (issue #86) — bounds, cleaning, precedence.
 * Node:test, zero deps. Run with `npm test`.
 *
 * The three helpers are shared by the Host schema resolution
 * (`resolveAdapterOptions`) and the browser settings page, so one invalid
 * value judged here is invalid on every surface.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTEXT_WINDOW_MAX,
  CONTEXT_WINDOW_MIN,
  effectiveContextWindow,
  isValidContextWindow,
  readContextWindowOverrides,
} from '../src/context-window.ts'

test('isValidContextWindow accepts only whole token counts inside the bounds', () => {
  assert.equal(isValidContextWindow(CONTEXT_WINDOW_MIN), true)
  assert.equal(isValidContextWindow(CONTEXT_WINDOW_MAX), true)
  assert.equal(isValidContextWindow(128_000), true)
  assert.equal(isValidContextWindow(32_768.5), false)
  assert.equal(isValidContextWindow(0), false)
  assert.equal(isValidContextWindow(-1), false)
  assert.equal(isValidContextWindow(CONTEXT_WINDOW_MAX + 1), false)
  assert.equal(isValidContextWindow(NaN), false)
  assert.equal(isValidContextWindow(Infinity), false)
  assert.equal(isValidContextWindow('128000'), false)
  assert.equal(isValidContextWindow(undefined), false)
  assert.equal(isValidContextWindow(null), false)
  assert.equal(isValidContextWindow({}), false)
})

test('readContextWindowOverrides keeps only valid entries and returns undefined for none', () => {
  // Nothing set — or nothing usable — reads as no overrides at all, so a
  // hand-edited document cannot smuggle a bad window onto the wire.
  assert.equal(readContextWindowOverrides(undefined), undefined)
  assert.equal(readContextWindowOverrides(null), undefined)
  assert.equal(readContextWindowOverrides([]), undefined)
  assert.equal(readContextWindowOverrides('x'), undefined)
  assert.equal(readContextWindowOverrides({}), undefined)
  assert.equal(readContextWindowOverrides({ onlyBad: 0 }), undefined)
  assert.equal(readContextWindowOverrides({ outOfRange: CONTEXT_WINDOW_MAX + 1 }), undefined)

  const cleaned = readContextWindowOverrides({
    'deepseek/deepseek-v4-pro': 64_000,
    zero: 0,
    negative: -1,
    fractional: 32_768.5,
    '': 128_000,
    notANumber: '42',
  })
  assert.deepEqual(cleaned, { 'deepseek/deepseek-v4-pro': 64_000 })

  // A fresh object: later writes never mutate the caller's document.
  const input = { a: 1_000 }
  assert.notEqual(readContextWindowOverrides(input), input)
})

test('effectiveContextWindow resolves per-model over global over catalog', () => {
  const options = {
    contextWindow: 200_000,
    contextWindowOverrides: { a: 64_000 },
  }
  // A per-model row wins over the global value…
  assert.equal(effectiveContextWindow(1_000_000, 'a', options), 64_000)
  // …the global value wins over the catalog for everything else…
  assert.equal(effectiveContextWindow(1_000_000, 'b', options), 200_000)
  // …and with nothing set the catalog value stands.
  assert.equal(effectiveContextWindow(1_000_000, 'a', {}), 1_000_000)
  assert.equal(
    effectiveContextWindow(128_000, 'a', { contextWindow: undefined, contextWindowOverrides: undefined }),
    128_000,
  )
  // Programmatic garbage (a config that bypassed Schemastery) falls through
  // to the catalog rather than reaching the harness as an invalid window.
  assert.equal(
    effectiveContextWindow(128_000, 'a', { contextWindow: -5, contextWindowOverrides: { a: 0 } }),
    128_000,
  )
  // A valid global value still applies when the per-model entry is garbage.
  assert.equal(
    effectiveContextWindow(128_000, 'a', { contextWindow: 64_000, contextWindowOverrides: { a: Number.NaN } }),
    64_000,
  )
  assert.equal(
    effectiveContextWindow(128_000, 'a', { contextWindow: 32_768.5, contextWindowOverrides: { a: 64_000.5 } }),
    128_000,
  )
})
