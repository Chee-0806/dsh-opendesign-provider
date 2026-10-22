/**
 * Design-token layer tests (node:test, zero deps). Run with `npm test`.
 *
 * The token layer is the one part of this bundle that becomes a second source
 * of truth if it is allowed to drift, so it is pinned from both directions:
 *
 * - **Containment.** The layer must not write `:root`. It lives on our own
 *   surface roots, which keeps the plugin out of the host's global namespace
 *   and keeps `tests/styles.test.ts`'s issue-#48 contract true.
 * - **No colours.** Every value here is a metric. The moment a `#` or an
 *   `rgba(` appears, the bundle has started carrying its own palette beside the
 *   host's 101 aliases, and dark mode stops being free.
 * - **Agreement with the reference.** Both stylesheets may only reference
 *   tokens this module actually defines. A typo in `var(--od-space-6)` is
 *   invisible in CSS (it silently falls back to `inherit`), so the only place it
 *   can be caught is here.
 *
 * The forward check — every token here must be referenced by a stylesheet, so a
 * token cannot be dead weight — is deliberately NOT in this ticket: it lands
 * with the metric migration in tickets 02/03, when the reference count stops
 * being zero. See ticket 04 §1b.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TOKEN_CSS, TOKEN_CSS_ID } from '../src/client/tokens.ts'
import { PAGE_CSS, PAGE_CSS_ID } from '../src/client/page-styles.ts'
import { PANEL_CSS, PANEL_CSS_ID } from '../src/client/panel-styles.ts'

/** Drop `/* … *\/` comments so prose about `:root` cannot trip a check. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every `--od-*` custom property this layer declares. */
function declaredTokens(css: string): string[] {
  return [...stripComments(css).matchAll(/(--od-[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1]!)
}

/** Every `--od-*` token a stylesheet references through `var()`. */
function referencedTokens(css: string): string[] {
  return [...stripComments(css).matchAll(/var\(\s*(--od-[A-Za-z0-9-]+)/g)].map((match) => match[1]!)
}

test('the token layer never writes :root', () => {
  const css = stripComments(TOKEN_CSS)
  assert.doesNotMatch(css, /:root/u, 'the token layer must stay inside our own surface scope')
  assert.doesNotMatch(css, /(^|[\s,}])html\b/u, 'the token layer must not style the document root')
  assert.doesNotMatch(css, /(^|[\s,}])body\b/u, 'the token layer must not style the body')
})

test('the token layer carries no colours — every value is a metric', () => {
  const css = stripComments(TOKEN_CSS)
  // Declarations only: the selector list may legitimately name a class.
  const declarations = [...css.matchAll(/(--od-[A-Za-z0-9-]+)\s*:\s*([^;}]+)/g)]
  assert.ok(declarations.length > 0, 'the token block is empty')
  const offenders: string[] = []
  for (const [, name, value] of declarations) {
    if (name === undefined || value === undefined) continue
    if (/#[0-9a-fA-F]{3,8}\b/u.test(value) || /\brgba?\(/u.test(value)) {
      offenders.push(`${name}: ${value.trim()}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the token layer invented a colour; colours come from the host aliases (ADR-0004):\n${offenders.join('\n')}`,
  )
})

test('the token block is scoped to our own classes only', () => {
  const css = stripComments(TOKEN_CSS).trim()
  const open = css.indexOf('{')
  assert.ok(open > 0, 'the token block has no selector')
  const selectorList = css.slice(0, open)
  const selectors = selectorList.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
  assert.ok(selectors.length > 0, 'the token block has no selectors')
  for (const selector of selectors) {
    // A plain class selector anchored on our own prefix.
    assert.match(
      selector,
      /^\.od[a-z-]*(?:[-_]\w+)*$/u,
      `token selector "${selector}" is not one of our own od-/odp- classes`,
    )
  }
  // The roots are the surfaces' own classes; there is no separate opt-in class,
  // because a class no component renders is a promise nothing keeps.
  for (const root of ['.od-section', '.od-providerCard']) {
    assert.ok(selectors.includes(root), `the token block must cover ${root}`)
  }
  for (const root of ['.odp-main', '.odp-foot', '.odp-railButton']) {
    assert.ok(selectors.includes(root), `the token block must cover ${root}`)
  }
})

test('both stylesheets only reference tokens this layer defines', () => {
  // Every `--od-*` these sheets read must come from the shared layer. A sheet
  // declaring its own private variable is not accepted any more: the one such
  // variable (the save bar's tone) went away with its dead rules, and letting a
  // second tongue grow per sheet is exactly how the two tables drift apart.
  const declared = new Set(declaredTokens(TOKEN_CSS))
  const offenders: string[] = []
  for (const [sheet, css] of [['PAGE_CSS', PAGE_CSS], ['PANEL_CSS', PANEL_CSS]] as const) {
    for (const token of new Set(referencedTokens(css))) {
      // An undefined custom property is silently `inherit` at runtime, so a typo
      // here renders as a broken layout with no error anywhere else.
      if (!declared.has(token)) offenders.push(`${sheet} → ${token}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these referenced tokens are not defined in the token layer:\n${offenders.join('\n')}`,
  )
})

test('neither stylesheet uses the harness brand-primary alias as an accent', () => {
  // ADR-0004: `--dsw-alias-brand-primary` resolves to a monochrome in the
  // harness (#0f1115 / #f9fafb), so using it for a progress fill or a checked
  // switch paints a near-black bar on light and a near-white bar on dark. The
  // readable accent is `state-business-primary`.
  for (const [sheet, css] of [['PAGE_CSS', PAGE_CSS], ['PANEL_CSS', PANEL_CSS]] as const) {
    const offenders = [...stripComments(css).matchAll(/[^;{}]*var\(--dsw-alias-brand-primary\)[^;}]*/gu)]
      .map((match) => match[0].trim())
    assert.deepEqual(
      offenders,
      [],
      `${sheet} treats the harness brand-primary (a monochrome) as an accent; use state-business-primary instead:\n${offenders.join('\n')}`,
    )
  }
})

test('the token layer id is distinct from both stylesheet ids', () => {
  assert.match(TOKEN_CSS_ID, /^@mars-sea\/dsh-opendesign-provider\//u)
  assert.notEqual(TOKEN_CSS_ID, PAGE_CSS_ID)
  assert.notEqual(TOKEN_CSS_ID, PANEL_CSS_ID)
  assert.notEqual(PAGE_CSS_ID, PANEL_CSS_ID)
})
