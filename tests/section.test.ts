/**
 * Settings-page fold tests (node:test, zero deps). Run with `npm test`.
 *
 * Issue #94 put the Models & context group behind its own heading, collapsed by
 * default, like the Advanced card. Folding is only safe while a blocked save
 * stays explained: the group's rows are off screen once it folds, so the
 * heading has to carry the warning itself. These cases pin the judgement behind
 * that warning — both staged numbers the group owns and its per-model context
 * rows — for the Models group and for Advanced, whose rows have the same
 * problem and whose behaviour the reporter asked to match.
 *
 * The React tree is not rendered here (`react-dom` is not a dependency): the
 * decision is a pure function over the page state, so it is tested directly,
 * like the other React-free controller tests in this directory.
 */

import { register } from 'node:module'

// `section.tsx` renders UI primitives whose npm entry cannot be resolved by
// node alone; the loader hook stands them in. Registered before the dynamic
// import below, since static imports would hoist above this call.
register(new URL('./_css-module-loader.mjs', import.meta.url).href)

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { SettingsPageState, StagedField } from '../src/client/settings.ts'

const { advancedGroupInvalid, modelsGroupInvalid } = await import('../src/client/section.tsx')

/** One staged field draft; only `invalid` matters to the group judgements. */
function staged(invalid: boolean): StagedField {
  return {
    text: '',
    clear: false,
    overridden: false,
    invalid,
    invalidReason: invalid ? 'format' : undefined,
  }
}

/** The Models & context group's own state: the plan switch, two numbers, the override rows. */
function modelsState(over: {
  filterModelsByPlan?: boolean
  contextWindow?: boolean
  maxOutputTokens?: boolean
  rows?: readonly boolean[]
}): Pick<
  SettingsPageState,
  'filterModelsByPlan' | 'contextWindow' | 'maxOutputTokens' | 'contextWindowOverrides'
> {
  return {
    filterModelsByPlan: staged(over.filterModelsByPlan ?? false),
    contextWindow: staged(over.contextWindow ?? false),
    maxOutputTokens: staged(over.maxOutputTokens ?? false),
    contextWindowOverrides: (over.rows ?? []).map((invalid, index) => ({
      model: `vendor/model-${index}`,
      text: '256K',
      invalid,
      invalidReason: invalid ? 'tooSmall' as const : undefined,
    })),
  }
}

/** A fully valid Advanced card; each case flips exactly one draft. */
const VALID_ADVANCED = {
  apiBase: staged(false),
  requestTimeoutMs: staged(false),
  streamIdleTimeoutMs: staged(false),
  transportMaxRetries: staged(false),
  offloadSeenImagesForCache: staged(false),
}
const ADVANCED_KEYS = [
  'apiBase',
  'requestTimeoutMs',
  'streamIdleTimeoutMs',
  'transportMaxRetries',
  'offloadSeenImagesForCache',
] as const

test('modelsGroupInvalid: nothing staged → no heading warning', () => {
  assert.equal(modelsGroupInvalid(modelsState({})), false)
})

test('modelsGroupInvalid: every draft valid → no heading warning', () => {
  assert.equal(modelsGroupInvalid(modelsState({ rows: [false, false] })), false)
})

test('modelsGroupInvalid: a bad custom context length warns', () => {
  assert.equal(modelsGroupInvalid(modelsState({ contextWindow: true })), true)
})

test('modelsGroupInvalid: a bad output limit warns', () => {
  assert.equal(modelsGroupInvalid(modelsState({ maxOutputTokens: true })), true)
})

test('modelsGroupInvalid: a bad plan-filter draft warns', () => {
  // The rendered switch cannot produce this draft, but the save guard walks the
  // same staged plan — the heading must not be able to contradict it.
  assert.equal(modelsGroupInvalid(modelsState({ filterModelsByPlan: true })), true)
})

test('modelsGroupInvalid: one bad per-model context row warns', () => {
  // The rows are the group's third owner and the easiest one to forget: their
  // drafts are validated per row, not through a StagedField on the page state.
  assert.equal(modelsGroupInvalid(modelsState({ rows: [false, true, false] })), true)
})

test('advancedGroupInvalid: nothing customized → no heading warning', () => {
  assert.equal(advancedGroupInvalid(VALID_ADVANCED), false)
})

for (const key of ADVANCED_KEYS) {
  test(`advancedGroupInvalid: a bad ${key} warns`, () => {
    assert.equal(advancedGroupInvalid({ ...VALID_ADVANCED, [key]: staged(true) }), true)
  })
}
