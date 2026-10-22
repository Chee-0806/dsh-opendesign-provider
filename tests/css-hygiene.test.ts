/**
 * CSS hygiene guards (node:test, zero deps). Run with `npm test`.
 *
 * Both stylesheets are hand-maintained GLOBAL CSS strings, and both had rotted
 * in exactly the same way: when a surface was rewritten or removed, its rules
 * stayed behind. Measured before this guard existed:
 *
 * | sheet | rules | dead |
 * | --- | --- | --- |
 * | `page-styles.ts` | 221 | 98 (44%) |
 * | `panel-styles.ts` | 193 | 143 (74%) |
 *
 * That is 241 rules styling markup no component renders. It is not free: dead
 * rules were tokenised by a later refactor, dead tokens survived the pruning
 * that followed, and a reader cannot tell a live rule from a fossil. Nothing in
 * the suite noticed, because containment (`tests/styles.test.ts`) only asks
 * whether a selector can reach FOREIGN markup, never whether it reaches ours.
 *
 * So this file asks the opposite question, both ways:
 *
 * - **No dead rules.** Every rule's `od-`/`odp-` classes must appear somewhere
 *   in the client sources, the preview harness, or the tests.
 * - **No dead tokens.** Every `--od-*` in the token layer must be referenced by
 *   a rule in one of the two sheets.
 *
 * Both checks are two-sided on purpose: the first would pass vacuously if the
 * markup scan returned nothing, the second if the token scan did, and the
 * fixture test below proves the parser still finds rules at all.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { PAGE_CSS } from '../src/client/page-styles.ts'
import { PANEL_CSS } from '../src/client/panel-styles.ts'
import { TOKEN_CSS } from '../src/client/tokens.ts'

const repositoryDir = join(import.meta.dirname, '..')

/** Drop `/* … *\/` comments so prose can never satisfy or trip a check. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** One declaration block, with the at-rule prelude it sits under. */
interface Rule {
  selector: string
  body: string
}

/**
 * Walk a stylesheet into flat rules. At-rules recurse instead of being treated
 * as rules, so a `@media`/`@container` wrapper cannot hide a selector from the
 * dead-rule audit — several of the fossils deleted in this round were inside
 * such wrappers.
 */
function parseRules(css: string): Rule[] {
  const out: Rule[] = []
  const walk = (text: string): void => {
    let index = 0
    while (index < text.length) {
      const open = text.indexOf('{', index)
      if (open < 0) break
      const prelude = text.slice(index, open).trim()
      let depth = 1
      let cursor = open + 1
      while (cursor < text.length && depth > 0) {
        if (text[cursor] === '{') depth += 1
        else if (text[cursor] === '}') depth -= 1
        cursor += 1
      }
      const body = text.slice(open + 1, cursor - 1)
      if (prelude.startsWith('@')) walk(body)
      else if (prelude !== '') out.push({ selector: prelude, body })
      index = cursor
    }
  }
  walk(stripComments(css))
  return out
}

/** Our own class names inside one selector list. */
function ownClasses(selector: string): string[] {
  return [...selector.matchAll(/\.((?:od|odp)-[A-Za-z0-9]+)/gu)].map((match) => match[1]!)
}

/**
 * Source files whose class names count as "somebody renders this".
 *
 * The two stylesheets are EXCLUDED, and that exclusion is the whole check: if
 * they counted, every class a rule defines would also "appear" in a source file
 * (the rule itself), and the dead-rule audit would pass vacuously. A probe rule
 * with an invented class name is asserted to be caught below for exactly this
 * reason.
 */
const STYLESHEET_FILES = new Set(['page-styles.ts', 'panel-styles.ts', 'tokens.ts'])

/**
 * Every `od-`/`odp-` class name that some source file could render.
 *
 * Deliberately over-inclusive otherwise: this scans the components, the preview
 * harness and the tests (which query classes as selectors). Over-inclusion can
 * only make the dead-rule check more permissive — never a false failure — and
 * the alternative (parsing JSX) would be a second thing to keep correct.
 */
function knownClasses(): Set<string> {
  const files: string[] = []
  const collect = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        collect(path)
        continue
      }
      if (STYLESHEET_FILES.has(entry.name)) continue
      if (/\.(?:ts|tsx|mjs|js)$/u.test(entry.name)) files.push(path)
    }
  }
  collect(join(repositoryDir, 'src'))
  collect(join(repositoryDir, 'tests'))
  collect(join(repositoryDir, 'scripts'))

  const names = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\b((?:od|odp)-[A-Za-z0-9]+)\b/gu)) names.add(match[1]!)
  }
  return names
}

/** Rules whose every own class is unknown to the sources — i.e. dead rules. */
function deadRules(css: string, known: Set<string>): Rule[] {
  return parseRules(css).filter((rule) => {
    const classes = ownClasses(rule.selector)
    // A rule with no own class is not this sheet's business (the sidebar anchor
    // in `PANEL_CSS` is the documented exception), so it cannot be judged dead.
    if (classes.length === 0) return false
    return classes.every((name) => !known.has(name))
  })
}

test('the parser still finds rules, so the dead-rule audit cannot pass vacuously', () => {
  assert.ok(parseRules(PAGE_CSS).length > 50, 'PAGE_CSS parsed to implausibly few rules')
  assert.ok(parseRules(PANEL_CSS).length > 20, 'PANEL_CSS parsed to implausibly few rules')
  assert.ok(knownClasses().size > 50, 'the markup scan found implausibly few class names')
})

test('the dead-rule detector actually catches a dead rule', () => {
  // Self-test the detector on a synthetic sheet, because the real check is
  // vacuous in exactly one way that looks like success: scan the stylesheets
  // themselves for class names and every rule vouches for its own classes.
  // The probe class is assembled at runtime on purpose: a literal would appear
  // in this file, this file is scanned as a source of live class names, and the
  // detector would count the probe as "somebody renders this".
  const probeClass = ['od', 'invented', 'Dead', 'Probe'].join('-')
  const liveClass = 'od-rowTitle' // genuinely rendered by section.tsx
  const probe = `.${probeClass}{color:red}\n.${liveClass}{color:blue}`
  const dead = deadRules(probe, knownClasses())
  assert.deepEqual(
    dead.map((rule) => rule.selector),
    [`.${probeClass}`],
    'the detector missed a synthetic dead rule (or flagged a live one)',
  )
})

test('PAGE_CSS carries no dead rules', () => {
  const dead = deadRules(PAGE_CSS, knownClasses())
  assert.deepEqual(
    dead.map((rule) => rule.selector),
    [],
    `these PAGE_CSS rules style markup no component renders; delete them (a deleted surface leaves no rule behind):\n${dead.map((rule) => rule.selector).join('\n')}`,
  )
})

test('PANEL_CSS carries no dead rules', () => {
  const dead = deadRules(PANEL_CSS, knownClasses())
  assert.deepEqual(
    dead.map((rule) => rule.selector),
    [],
    `these PANEL_CSS rules style markup no component renders; delete them:\n${dead.map((rule) => rule.selector).join('\n')}`,
  )
})

test('the removed analytics surface left no rules behind', () => {
  // The analytics page was deleted in 2026-10-21; its stylesheet block was not,
  // and 117 lines of it survived a further round of edits. A one-line guard is
  // cheaper than rediscovering that (ticket 03 §1).
  assert.equal(PANEL_CSS.includes('odp-analysis'), false, 'PANEL_CSS still styles the removed analytics page')
  assert.equal(PAGE_CSS.includes('od-analysis'), false, 'PAGE_CSS still styles the removed analytics page')
})

test('every design token is referenced by a stylesheet', () => {
  const declared = new Set(
    [...stripComments(TOKEN_CSS).matchAll(/(--od-[A-Za-z0-9-]+)\s*:/gu)].map((match) => match[1]!),
  )
  assert.ok(declared.size > 20, 'the token block parsed to implausibly few tokens')

  const referenced = new Set(
    [...`${PAGE_CSS}${PANEL_CSS}`.matchAll(/var\(\s*(--od-[A-Za-z0-9-]+)/gu)].map((match) => match[1]!),
  )

  const unused = [...declared].filter((token) => !referenced.has(token))
  assert.deepEqual(
    unused,
    [],
    `these tokens are declared but never used; an unused token is an untested claim — delete it until a rule needs it:\n${unused.join('\n')}`,
  )
})
