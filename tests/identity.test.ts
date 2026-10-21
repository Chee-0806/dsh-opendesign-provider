/**
 * Open Design identity contract: the provider route, settings namespace,
 * credential reference, Remote namespace, slot ids and package metadata all
 * have to name the same product. The constants live in `src/identity.ts`;
 * these cases pin the values and the two files that cannot import them
 * (`cordis.patch.yml` and `package.json`).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_API_BASE,
  DEFAULT_API_KEY_ENV,
  MODELS_CACHE_RELATIVE_PATH,
  MODEL_CARD_KEY,
  NS,
  PACKAGE_NAME,
  PANEL_ID,
  PANEL_LOCALE_NS,
  PLUGIN_ID,
  PROVIDER,
  PROVIDER_DISPLAY_NAME,
  REMOTE_ENDPOINTS,
  REMOTE_NAMESPACE,
  REMOTE_SERVICE,
  REQUEST_TIMING_ENV,
  SETTINGS_SECTION_ID,
  STREAM_TRACE_ENV,
} from '../src/identity.ts'

const root = new URL('..', import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8')

test('identity constants pin the Open Design provider surface', () => {
  assert.equal(PACKAGE_NAME, '@mars-sea/dsh-opendesign-provider')
  assert.equal(PROVIDER, 'open-design')
  assert.equal(PROVIDER_DISPLAY_NAME, 'Open Design')
  assert.equal(NS, 'llm-opendesign')
  assert.equal(PLUGIN_ID, 'llm-opendesign')
  assert.equal(DEFAULT_API_KEY_ENV, 'OPEN_DESIGN_API_KEY')
  assert.equal(DEFAULT_API_BASE, 'https://amr-link.open-design.ai/v1')
  assert.equal(MODELS_CACHE_RELATIVE_PATH, '.opendesign/models-cache.json')
  assert.equal(REMOTE_NAMESPACE, 'opendesign')
  assert.equal(REMOTE_SERVICE, 'opendesignUsage')
  assert.deepEqual(REMOTE_ENDPOINTS, ['usage', 'models'])
  assert.equal(SETTINGS_SECTION_ID, 'opendesign')
  assert.equal(MODEL_CARD_KEY, 'llm-opendesign')
  assert.equal(PANEL_ID, 'opendesign-panel')
  assert.equal(PANEL_LOCALE_NS, 'panel.opendesign')
  assert.equal(REQUEST_TIMING_ENV, 'DSH_OPENDESIGN_TIMING')
  assert.equal(STREAM_TRACE_ENV, 'DSH_OPENDESIGN_TRACE')
})

test('the bundle patch inserts exactly one Open Design plugin row', () => {
  const patch = read('./cordis.patch.yml')
  assert.match(patch, /^ {4}- id: llm-opendesign$/m)
  assert.match(patch, /name: "@mars-sea\/dsh-opendesign-provider"/)
  assert.match(patch, /apiKeyEnv: OPEN_DESIGN_API_KEY/)
  assert.equal((patch.match(/^ {4}- id: /gm) ?? []).length, 1, 'one insert row, no profile rewrites')
})

test('package metadata names the Open Design package, not the old provider', () => {
  const pkg = JSON.parse(read('./package.json')) as {
    name: string
    version: string
    description: string
    keywords: string[]
    dsh?: { bundle?: { patch?: string }; client?: { platform?: string } }
    repository?: { url?: string }
    bugs?: { url?: string }
    homepage?: string
  }
  assert.equal(pkg.name, PACKAGE_NAME)
  assert.equal(pkg.version, '0.1.0')
  assert.match(pkg.description, /Open Design/)
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.ok(pkg.keywords.includes('open-design'))
  for (const url of [pkg.repository?.url, pkg.bugs?.url, pkg.homepage]) {
    assert.ok(typeof url === 'string' && url.includes('dsh-opendesign-provider'), String(url))
  }
})

test('both locale documents title the provider "Open Design"', () => {
  for (const locale of ['zh', 'en']) {
    const copy = JSON.parse(read(`./locale/${locale}.json`)) as {
      meta: { title: string; description: string }
    }
    assert.match(copy.meta.title, /Open Design/)
    assert.match(copy.meta.description, /Open Design/)
  }
})
