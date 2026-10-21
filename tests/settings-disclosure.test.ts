/**
 * Settings-page disclosure behavior (the collapse wiring the page depends on).
 *
 * The CSS for `.od-disclosure`/`.od-chevron` shipped in ticket 08 but the page
 * kept rendering static group heads, so nothing could collapse. These tests pin
 * the two halves of that regression: the components fold, and every group/field
 * on the page actually uses them instead of a hand-rolled `od-groupHead`.
 */

import { register } from 'node:module'

register(new URL('./_css-module-loader.mjs', import.meta.url).href)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'

const { SettingsGroup, SettingsField, DisclosureHeader } = await import('../src/client/section.tsx')

const page = (): string => readFileSync(new URL('../src/client/section.tsx', import.meta.url), 'utf8')

test('a group is folded until its header is clicked, and keeps its heading level', () => {
  const markup = renderToStaticMarkup(createElement(SettingsGroup, {
    title: '模型与上下文',
    desc: 'desc text',
    children: createElement('p', null, 'body text'),
  }))
  assert.match(markup, /<h3[^>]*>/u)
  assert.match(markup, /aria-expanded="false"/u)
  assert.match(markup, /模型与上下文/u)
  assert.match(markup, /<div hidden="">/u, 'folded group keeps its body mounted but hidden')
  assert.match(markup, /body text/u)
  assert.match(markup, /od-chevron/u)
})

test('a group marked open renders its description and body', () => {
  const markup = renderToStaticMarkup(createElement(SettingsGroup, {
    title: '连接',
    desc: 'desc text',
    defaultOpen: true,
    children: createElement('p', null, 'body text'),
  }))
  assert.match(markup, /aria-expanded="true"/u)
  assert.match(markup, /desc text/u)
  assert.match(markup, /body text/u)
})

test('the first group drops the divider class, later groups keep it', () => {
  const first = renderToStaticMarkup(createElement(SettingsGroup, { title: 'a', first: true, defaultOpen: true, children: null }))
  const later = renderToStaticMarkup(createElement(SettingsGroup, { title: 'b', defaultOpen: true, children: null }))
  assert.match(first, /class="od-group"/u)
  assert.doesNotMatch(first, /od-groupDivided/u)
  assert.match(later, /od-groupDivided/u)
})

test('a folded field still reports its summary, and hides its children', () => {
  const markup = renderToStaticMarkup(createElement(SettingsField, {
    label: '模型白名单',
    summary: '2/3',
    defaultOpen: false,
    children: createElement('p', null, 'rows'),
  }))
  assert.match(markup, /aria-expanded="false"/u)
  assert.match(markup, /2\/3/u)
  assert.match(markup, /模型白名单/u)
  assert.match(markup, /<div hidden="">/u, 'folded field keeps its children mounted so drafts survive')
})

test('a field is open by default when the page asks for it', () => {
  const markup = renderToStaticMarkup(createElement(SettingsField, {
    label: '模型白名单',
    children: createElement('p', null, 'rows'),
  }))
  assert.match(markup, /aria-expanded="true"/u)
  assert.match(markup, /rows/u)
})

test('the disclosure header is one button with aria-expanded and a decorative chevron', () => {
  const markup = renderToStaticMarkup(createElement(DisclosureHeader, {
    label: '高级',
    open: false,
    onToggle: () => {},
    scale: 'group',
  }))
  assert.match(markup, /<button[^>]*aria-expanded="false"/u)
  assert.match(markup, /aria-hidden="true"/u)
  assert.match(markup, /高级/u)
})

test('every settings group on the page is a disclosure, not a static head', () => {
  const source = page()
  assert.equal((source.match(/<SettingsGroup\b/gu) ?? []).length, 4, 'four groups must use SettingsGroup')
  // The allowlist became a dropdown (its trigger opens the picker), so the one
  // remaining collapsible field is the per-model override list.
  assert.equal((source.match(/<SettingsField\b/gu) ?? []).length, 1, 'the override list must fold')
  assert.equal((source.match(/<ModelAllowlist\b/gu) ?? []).length, 1, 'the allowlist must be a dropdown')
  assert.doesNotMatch(source, /<div className="od-group(?: od-groupDivided)?">\s*<div className="od-groupHead">/u,
    'a static od-groupHead means a group lost its disclosure')
  // 高级 starts folded; the models group opens (its fields carry the folds).
  assert.doesNotMatch(source, /<SettingsGroup title=\{t\('advanced'\)\}[^>]*defaultOpen/u)
  assert.match(source, /title=\{t\('modelsSection'\)\}[\s\S]{0,120}defaultOpen/u)
})
