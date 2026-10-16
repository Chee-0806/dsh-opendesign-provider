/**
 * Output-budget helpers (issue #74) — bounds, the omit sentinel, precedence.
 * Node:test, zero deps. Run with `npm test`.
 *
 * The report asked for a knob that stops the adapter from writing `max_tokens`
 * at all, and for the failure not to be silent. These pin the three decisions
 * that keep it honest: the sentinel is not a budget, a user value only ever
 * tightens the derived one, and the Messages transport plus an explicit
 * per-call budget both opt out of omitting.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_OUTPUT_TOKEN_LIMIT,
  OMIT_OUTPUT_TOKENS,
  applyMaxOutputTokens,
  isValidMaxOutputTokens,
  omitOutputTokens,
} from '../src/output-budget.ts'

test('isValidMaxOutputTokens accepts the omit sentinel and whole counts up to the gateway cap', () => {
  assert.equal(isValidMaxOutputTokens(OMIT_OUTPUT_TOKENS), true)
  assert.equal(isValidMaxOutputTokens(1), true)
  assert.equal(isValidMaxOutputTokens(64_000), true)
  assert.equal(isValidMaxOutputTokens(MAX_OUTPUT_TOKEN_LIMIT), true)
  // Above the cap the gateway refuses the request, so the value is invalid
  // rather than merely large.
  assert.equal(isValidMaxOutputTokens(MAX_OUTPUT_TOKEN_LIMIT + 1), false)
  assert.equal(isValidMaxOutputTokens(200_704), false)
  assert.equal(isValidMaxOutputTokens(-1), false)
  assert.equal(isValidMaxOutputTokens(64_000.5), false)
  assert.equal(isValidMaxOutputTokens(NaN), false)
  assert.equal(isValidMaxOutputTokens(Infinity), false)
  assert.equal(isValidMaxOutputTokens('64000'), false)
  assert.equal(isValidMaxOutputTokens(undefined), false)
  assert.equal(isValidMaxOutputTokens(null), false)
})

test('applyMaxOutputTokens only ever tightens the derived budget', () => {
  // Unset is the default path: the derived value stands untouched.
  assert.equal(applyMaxOutputTokens(131_072, undefined), 131_072)
  // A smaller user value wins…
  assert.equal(applyMaxOutputTokens(131_072, 64_000), 64_000)
  // …a larger one cannot raise what the model or gateway already allows…
  assert.equal(applyMaxOutputTokens(64_000, 131_072), 64_000)
  // …and the omit sentinel is an instruction, not a budget, so it does not
  // collapse the derived value to zero either.
  assert.equal(applyMaxOutputTokens(131_072, OMIT_OUTPUT_TOKENS), 131_072)
})

test('omitOutputTokens requires the sentinel and a transport that accepts an absent field', () => {
  // The happy path: the sentinel on a transport whose field is optional.
  assert.equal(omitOutputTokens(OMIT_OUTPUT_TOKENS, 'cli'), true)
  assert.equal(omitOutputTokens(OMIT_OUTPUT_TOKENS, 'openai'), true)
  // Every other configured value keeps sending the field.
  assert.equal(omitOutputTokens(64_000, 'openai'), false)
  assert.equal(omitOutputTokens(undefined, 'cli'), false)
  // Claude's endpoint requires the field — omitting it there would break the
  // whole family rather than lengthen an answer.
  assert.equal(omitOutputTokens(OMIT_OUTPUT_TOKENS, 'messages'), false)
})

test('an explicit per-call budget outranks the plugin-wide omit setting', () => {
  // The session-title call passes 64 tokens precisely because its output must
  // stay bounded (issue #88); dropping the field there would let a title run
  // long instead of making an answer fit.
  assert.equal(omitOutputTokens(OMIT_OUTPUT_TOKENS, 'cli', 64), false)
  assert.equal(omitOutputTokens(OMIT_OUTPUT_TOKENS, 'openai', 64), false)
  // Any explicit figure opts out, not just the small ones.
  assert.equal(omitOutputTokens(OMIT_OUTPUT_TOKENS, 'openai', 4_096), false)
  // And the guards compose: without the sentinel the setting is off anyway.
  assert.equal(omitOutputTokens(64_000, 'openai', 64), false)
})
