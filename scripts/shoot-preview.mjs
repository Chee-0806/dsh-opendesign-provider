#!/usr/bin/env node
/**
 * Screenshot every preview case, light and dark, into `.scratch/shots/`.
 *
 * The preview page has no dev server (see `scripts/preview-ui.mjs`), so the only
 * way to look at these surfaces repeatedly is to drive a headless browser at the
 * built `index.html`. This wraps that loop so a UI change can be looked at in one
 * command instead of ten.
 *
 * Two things make the dark capture correct:
 *
 * - The theme lives in React state and an effect writes it to
 *   `<html data-theme>`; editing the HTML attribute in the file does nothing,
 *   because the effect rewrites it on mount. So the dark run injects a click on
 *   the preview's own theme toggle after mount, which is the same path a human
 *   takes.
 * - Every case is captured at a fixed viewport width so "before" and "after"
 *   shots are directly comparable.
 *
 * Usage:
 *   node scripts/shoot-preview.mjs                 # all cases, light + dark
 *   node scripts/shoot-preview.mjs settings-ready  # one case, both themes
 *   PREFIX=before node scripts/shoot-preview.mjs   # custom filename prefix
 *
 * Requires a locally installed Chrome; override with `CHROME_PATH`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const previewDir = join(repositoryDir, '.scratch', 'ui-preview')
const shotsDir = join(repositoryDir, '.scratch', 'shots')
const plainPage = join(previewDir, 'index.html')
const darkPage = join(previewDir, 'index-dark.html')

/** Case ids, read out of the preview source so the list cannot drift from it. */
function caseIds() {
  const source = readFileSync(join(repositoryDir, 'scripts', 'preview', 'app.tsx'), 'utf8')
  return [...source.matchAll(/^\s+id: '([a-z0-9-]+)',$/gmu)].map((match) => match[1])
}

/** The page whose theme toggle has been clicked once, i.e. the dark capture. */
function writeDarkPage() {
  const html = readFileSync(plainPage, 'utf8')
  // The injected click runs after React mounts and its effect has published the
  // initial theme; clicking is exactly what a human does, so this cannot drift
  // from the real toggle path.
  const inject = '<script>setTimeout(function () { var b = document.querySelector(".pv-toggle"); if (b) b.click() }, 900)</script>'
  writeFileSync(darkPage, html.replace('</body>', `${inject}</body>`), 'utf8')
}

const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const chrome = candidates.find((path) => existsSync(path))
if (chrome === undefined) {
  process.stderr.write('no Chrome found; set CHROME_PATH to a Chrome/Chromium binary\n')
  process.exit(1)
}

if (!existsSync(plainPage)) {
  process.stderr.write(`${plainPage} is missing — run "npm run preview:ui" first\n`)
  process.exit(1)
}

mkdirSync(shotsDir, { recursive: true })
writeDarkPage()

const requested = process.argv.slice(2)
const ids = requested.length > 0 ? requested : caseIds()
const prefix = process.env.PREFIX ?? 'shot'
const only = process.env.CASE
const height = process.env.HEIGHT ?? '1600'
const width = process.env.WIDTH ?? '1400'

if (ids.length === 0) {
  process.stderr.write('no preview cases found in scripts/preview/app.tsx\n')
  process.exit(1)
}

for (const id of ids) {
  if (only !== undefined && only !== id) continue
  for (const [theme, page] of [['', plainPage], ['dark-', darkPage]]) {
    const out = join(shotsDir, `${prefix}-${theme}${id}.png`)
    execFileSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--virtual-time-budget=6000',
        `--window-size=${width},${height}`,
        `--screenshot=${out}`,
        `file://${page}?only=${id}`,
      ],
      { stdio: 'ignore' },
    )
    process.stdout.write(`${out}\n`)
  }
}
