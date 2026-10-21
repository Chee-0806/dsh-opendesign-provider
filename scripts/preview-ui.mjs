/**
 * Builds the interactive UI preview for this bundle's client surfaces.
 *
 * The browser half has no dev server: `lib/client.js` is a slot plugin the DSH
 * web client loads, so the only way to see the settings page, the Models-page
 * card or the quota card/dashboard is to build, pack, install into a real
 * profile and restart the app. That loop is fine for
 * acceptance and far too slow for iterating on layout, colour or interaction.
 *
 * This script bundles `scripts/preview/app.tsx` with esbuild and writes a thin
 * `index.html` beside it. The page runs the REAL components over REAL
 * controllers and an in-memory settings scope, so folding, editing, saving and
 * discarding all work by clicking — nothing is a screenshot.
 *
 * Output goes to `.scratch/ui-preview/` and is git-ignored, like the rest of
 * `.scratch/`. Open `index.html` directly; there is no server to start.
 *
 * Format notes:
 * - IIFE, not ESM: a `file://` page cannot load `<script type="module">` (the
 *   origin is `null`, so the module fetch fails CORS). A classic script works.
 * - Sourcemaps are written next to the bundle so DevTools shows the original
 *   `src/client/*.tsx` frames while debugging.
 *
 * Add `?only=<case-id>` to isolate one surface; the ids are listed in the
 * page's own jump bar.
 */

import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repositoryDir, '.scratch', 'ui-preview')
const outFile = join(outDir, 'app.js')
const entry = join(repositoryDir, 'scripts', 'preview', 'app.tsx')

mkdirSync(outDir, { recursive: true })

try {
  await build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    // IIFE keeps `file://` working; see the header note.
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: true,
    // React's production build: no dev warnings in the console, smaller file.
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  })
} catch (error) {
  process.stderr.write(`preview bundle failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
  throw error
}

const html = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Design · UI 预览</title>
</head>
<body>
<div id="root"></div>
<script src="./app.js"></script>
</body>
</html>
`

const htmlFile = join(outDir, 'index.html')
writeFileSync(htmlFile, html, 'utf8')

process.stdout.write(`preview written: ${htmlFile}\n`)
process.stdout.write(`bundle: ${outFile}\n`)
