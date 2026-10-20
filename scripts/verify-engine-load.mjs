/**
 * Engine-load smoke test: prove this bundle LINKS and EVALUATES against a real
 * dsh engine before it ships, and that its Host assembly registers only the
 * Open Design provider, adapter, optional models Remote and settings bridge.
 *
 * The check installs each declared-compatible engine (reusing a scratch npm
 * cache), stages the published surface next to that engine's peers, then:
 *
 * 1. imports the built entry in a child process and reads its plugin shape;
 * 2. checks every static named import still exists on the engine;
 * 3. asks the engine's own plugin-compatibility preflight to admit the bundle;
 * 4. audits the client bundle's `require()` calls against the platform seeds;
 * 5. parses the Config schema and proves every field except the secret literal
 *    is volatile and exposes a live reference;
 * 6. loads `apply()` into a real cordis Context with fake `llm`/`settings`
 *    services and asserts the registrations (and only those).
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCOPE = '@deepseek-ai'
const PACKAGE_NAME = '@mars-sea/dsh-opendesign-provider'
const PLUGIN_NAME = 'llm-opendesign'
const PROVIDER = 'open-design'
/** The published surface, i.e. what `npm pack` would put in the tarball. */
const PUBLISHED = ['lib', 'package.json', 'cordis.patch.yml']

const repositoryDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const failures = []
const warnings = []

function fail(message) {
  failures.push(message)
}

function warn(message) {
  warnings.push(message)
}

function report(engine) {
  for (const message of warnings) process.stdout.write(`  warn  ${message}\n`)
  if (failures.length === 0) {
    process.stdout.write(`engine-load smoke passed against dsh ${engine}\n`)
    return true
  }
  for (const message of failures) process.stderr.write(`  FAIL  ${message}\n`)
  process.stderr.write(`engine-load smoke FAILED against dsh ${engine} (${failures.length})\n`)
  return false
}

function abort(message) {
  process.stderr.write(`verify-engine-load: ${message}\n`)
  process.exit(2)
}

/** Run a child command, or throw with its output. */
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function parseArgs(argv) {
  const options = { engine: process.env.DSH_ENGINE, version: undefined, keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--engine') options.engine = argv[++index]
    else if (arg === '--version') options.version = argv[++index]
    else if (arg === '--keep') options.keep = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0] + '*/\n')
      process.exit(0)
    } else abort(`unknown argument ${arg}`)
  }
  return options
}

/** Compare two semver strings, prerelease-aware. Enough for dsh's own versions. */
function compareVersions(a, b) {
  const split = (value) => {
    const [core, prerelease = ''] = String(value).split('-', 2)
    return { numbers: core.split('.').map(Number), prerelease: prerelease === '' ? [] : prerelease.split('.') }
  }
  const left = split(a)
  const right = split(b)
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length
  }
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const one = left.prerelease[index]
    const two = right.prerelease[index]
    if (one === undefined) return -1
    if (two === undefined) return 1
    if (one === two) continue
    const numeric = /^\d+$/.test(one) && /^\d+$/.test(two)
    if (numeric) return Number(one) - Number(two)
    return one < two ? -1 : 1
  }
  return 0
}

/**
 * Every release `package.json` claims to support, oldest first. Each one is
 * exercised: a declared-but-unverified engine is exactly the bad pairing this
 * check exists to prevent.
 */
function declaredEngineVersions() {
  const pkg = JSON.parse(readFileSync(join(repositoryDir, 'package.json'), 'utf8'))
  const releases = Object.keys(pkg.dsh?.compatibility?.dshReleases ?? {})
  if (releases.length === 0) abort('package.json declares no dsh.compatibility.dshReleases')
  return releases.sort(compareVersions)
}

/** The engine's module directory plus its dsh-llm version. */
function resolveEngine(dir) {
  for (const modules of [join(dir, 'node_modules'), dir]) {
    const manifest = join(modules, SCOPE, 'dsh-llm', 'package.json')
    if (existsSync(manifest)) {
      return { modules, root: dirname(modules), version: JSON.parse(readFileSync(manifest, 'utf8')).version }
    }
  }
  abort(`${dir} is not an engine: no ${SCOPE}/dsh-llm under it or its node_modules.\n`
    + '  Point --engine at an installed dsh (the npx cache entry) or at a profile.')
}

/** Install one engine release into a scratch root and return it. */
function installEngine(version) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-engine-load-'))
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'dsh-engine-load', private: true, version: '0.0.0' }, null, 2)}\n`)
  const cache = join(tmpdir(), 'dsh-engine-load-npm-cache')
  mkdirSync(cache, { recursive: true })
  process.stdout.write(`installing ${SCOPE}/dsh@${version} (first run downloads the engine)\n`)
  run(npm, ['install', '--no-audit', '--no-fund', '--cache', cache, `${SCOPE}/dsh@${version}`], root)
  return root
}

/** Every static named import in one built file, by module specifier. */
function namedImports(source) {
  const imports = new Map()
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const names = match[1]
      .split(',')
      .map((entry) => entry.trim().split(/\s+as\s+/)[0].trim())
      .filter((name) => name !== '' && !name.startsWith('type '))
    if (names.length === 0) continue
    const existing = imports.get(match[2]) ?? new Set()
    for (const name of names) existing.add(name)
    imports.set(match[2], existing)
  }
  return imports
}

/** Every `require("…")` specifier in one built client bundle. */
function requiredModules(source) {
  return new Set([...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]))
}

/** Resolve one specifier from the engine root and read its runtime exports. */
async function engineExports(engineRoot, specifier) {
  const require = createRequire(join(engineRoot, 'probe.cjs'))
  let resolved
  try {
    resolved = require.resolve(specifier)
  } catch (error) {
    return { resolved: false, names: new Set(), error: error.message }
  }
  try {
    const module = await import(pathToFileURL(resolved).href)
    return { resolved: true, names: new Set(Object.keys(module)), error: undefined }
  } catch (error) {
    return { resolved: true, names: new Set(), error: error.message }
  }
}

/** The platform seed words the Web shell hands to every client bundle. */
function platformSeeds(modules) {
  const dist = join(modules, SCOPE, 'dsh-web-frontend', 'dist', 'assets')
  if (!existsSync(dist)) return undefined
  const asset = readdirSync(dist).find((name) => name.startsWith('index-') && name.endsWith('.js'))
  if (asset === undefined) return undefined
  const source = readFileSync(join(dist, asset), 'utf8')
  return (specifier) => {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:"${escaped}"|\\b${escaped})\\s*:`).test(source)
  }
}

/** Copy the published surface into a tree whose peers are the engine's. */
function stageBundle(engineModules, scratch) {
  const modules = join(scratch, 'node_modules')
  mkdirSync(modules, { recursive: true })
  for (const entry of readdirSync(engineModules)) {
    if (entry.startsWith('.')) continue
    symlinkSync(join(engineModules, entry), join(modules, entry), 'dir')
  }
  const target = join(modules, ...PACKAGE_NAME.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  // COPIED, never linked: Node resolves a symlinked package's imports from its
  // realpath, which is exactly the resolution that hid the original bug.
  for (const entry of PUBLISHED) {
    cpSync(join(repositoryDir, entry), join(target, entry), { recursive: true })
  }
  return target
}

/** Check 1: the bundle links and evaluates with the engine's own peers. */
async function checkLink(engineModules, scratch) {
  const staged = stageBundle(engineModules, scratch)
  const probe = join(scratch, 'probe.mjs')
  writeFileSync(probe, [
    `const mod = await import(${JSON.stringify(PACKAGE_NAME)})`,
    `process.stdout.write(JSON.stringify({`,
    `  name: mod.name,`,
    `  inject: mod.inject,`,
    `  apply: typeof mod.apply,`,
    `  config: typeof mod.Config,`,
    `  adapter: typeof mod.OpenDesignAdapter,`,
    `}))`,
    '',
  ].join('\n'))
  let output
  try {
    output = run(process.execPath, [probe], scratch)
  } catch (error) {
    const lines = String(error.message).split('\n')
    const detail = lines.find((line) => line.includes('SyntaxError'))
      ?? lines.find((line) => line.includes('Cannot find'))?.trim()
      ?? 'the bundle could not be imported'
    fail(`the built bundle does not load on this engine: ${detail.trim()}`)
    return undefined
  }
  let plugin
  try {
    plugin = JSON.parse(output.trim().split('\n').at(-1))
  } catch {
    fail(`the bundle loaded but the probe printed no plugin shape: ${output.trim()}`)
    return undefined
  }
  if (plugin.name !== PLUGIN_NAME) fail(`plugin name is ${String(plugin.name)}, expected ${PLUGIN_NAME}`)
  if (plugin.apply !== 'function') fail('the plugin entry exports no apply()')
  if (plugin.config !== 'function') fail('the plugin entry exports no Config schema')
  if (plugin.adapter !== 'function') fail('the plugin entry exports no OpenDesignAdapter')
  if (JSON.stringify(plugin.inject) !== JSON.stringify(['llm'])) {
    fail(`the plugin inject list is ${JSON.stringify(plugin.inject)}, expected ["llm"]`)
  }
  return staged
}

/** Check 2: every static named import exists on the engine. */
async function checkNamedImports(engineRoot) {
  const source = readFileSync(join(repositoryDir, 'lib', 'index.js'), 'utf8')
  for (const [specifier, names] of namedImports(source)) {
    if (specifier.startsWith('node:') || !specifier.startsWith(SCOPE)) continue
    const exported = await engineExports(engineRoot, specifier)
    if (!exported.resolved) {
      fail(`${specifier} does not resolve on this engine: ${exported.error}`)
      continue
    }
    const missing = [...names].filter((name) => !exported.names.has(name))
    if (missing.length > 0) {
      fail(`${specifier} exports no ${missing.join(', ')} — a static import of it fails at ESM link time`)
    }
  }
}

/** Check 3: the engine's own compatibility preflight admits this plugin. */
async function checkEngineAdmission(engineRoot, version) {
  const require = createRequire(join(engineRoot, 'probe.cjs'))
  let entry
  try {
    entry = require.resolve(`${SCOPE}/dsh-app-boot`)
  } catch (error) {
    warn(`dsh ${version} ships no ${SCOPE}/dsh-app-boot: the host compatibility preflight was not exercised (${error.message})`)
    return
  }
  let evaluate
  try {
    evaluate = (await import(pathToFileURL(entry).href)).evaluatePluginCompatibility
  } catch (error) {
    fail(`${SCOPE}/dsh-app-boot cannot be loaded on this engine: ${error.message}`)
    return
  }
  if (typeof evaluate !== 'function') {
    warn(`dsh ${version} exports no evaluatePluginCompatibility: the host compatibility preflight was not exercised`)
    return
  }
  const manifest = JSON.parse(readFileSync(join(repositoryDir, 'package.json'), 'utf8'))
  let issue
  try {
    issue = evaluate(manifest, undefined, version)
  } catch (error) {
    fail(`the host compatibility preflight cannot read this plugin's manifest on dsh ${version}: ${error.message}`)
    return
  }
  if (issue === undefined || issue.exempted === true) {
    process.stdout.write(`host compatibility preflight admits this plugin on dsh ${version}\n`)
    return
  }
  const unmet = issue.requirements ?? issue.peers ?? {}
  fail(`the host compatibility preflight REJECTS this plugin on dsh ${version}: ${JSON.stringify(unmet)}`)
}

/** Check 4: the client bundle requires only seeds or mounted client rows. */
function checkClientRequires(engineModules) {
  const path = join(repositoryDir, 'lib', 'client.js')
  if (!existsSync(path)) {
    fail('lib/client.js is missing; the dsh.client entry cannot load')
    return
  }
  const source = readFileSync(path, 'utf8')
  if (!source.includes('__ModuleLoader__.load(') || !source.includes(JSON.stringify(PACKAGE_NAME))) {
    fail(`lib/client.js does not declare ${PACKAGE_NAME} in its loader banner`)
  }
  const seeded = platformSeeds(engineModules)
  if (seeded === undefined) {
    warn('no dsh-web-frontend dist in this engine, skipped the client require audit')
    return
  }
  for (const specifier of requiredModules(source)) {
    if (specifier.startsWith('node:')) continue
    if (seeded(specifier)) continue
    const manifest = join(engineModules, ...specifier.split('/'), 'package.json')
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).dsh?.client !== undefined) continue
    fail(`lib/client.js requires "${specifier}", which is neither a platform seed nor a mounted dsh.client row`)
  }
}

/** Check 5: the Config schema really drives this engine's settings forms. */
async function checkVolatileConfig(staged) {
  if (staged === undefined) return
  const plugin = await import(pathToFileURL(join(staged, 'lib', 'index.js')).href)
  const fields = plugin.Config?.dict
  if (fields === undefined || fields.apiBase === undefined) {
    fail('the staged Config schema carries no dict, so its settings-form surface cannot be checked')
    return
  }
  if (typeof fields.apiBase.volatile !== 'function') {
    fail('this engine\'s schemastery has no .volatile(); the settings page would render no editable field')
    return
  }
  for (const [name, field] of Object.entries(fields)) {
    const marked = field?.meta?.volatile === true
    if (name === 'apiKey') {
      if (marked) fail('Config.apiKey must stay unmarked: it is the composition-only secret literal')
      continue
    }
    if (!marked) fail(`Config.${name} is not volatile — settings forms cannot see or write it`)
  }
  let parsed
  try {
    parsed = plugin.Config({ apiKeyEnv: 'engine-load-probe' })
  } catch (error) {
    fail(`Config rejected the engine-load probe config: ${error.message}`)
    return
  }
  const ref = parsed?.apiKeyEnv
  if (ref === null || typeof ref !== 'object' || typeof ref.get !== 'function') {
    fail('Config parses to plain values on this engine, so volatile writes cannot commit in place')
  } else if (ref.get() !== 'engine-load-probe') {
    fail(`the parsed reference answered ${String(ref.get())}, expected the probe value`)
  }
}

/** Check 6: real cordis assembly registers the provider, adapter and settings bridge. */
async function checkHostAssembly(staged, engineModules) {
  if (staged === undefined) return
  const require = createRequire(join(dirname(engineModules), 'assembly-probe.cjs'))
  const load = async (name) => import(pathToFileURL(require.resolve(name)).href)
  const [{ Context, Service }, plugin] = await Promise.all([
    load(`${SCOPE}/cordis`),
    import(pathToFileURL(join(staged, 'lib', 'index.js')).href),
  ])
  const providers = []
  const adapters = []
  const configured = []
  const injected = []
  class ProbeLlm extends Service {
    constructor(context) { super(context, 'llm') }
    registerConfigurableProviders(entries) { providers.push(...entries); return () => {} }
    registerAdapter(services, adapter) { adapters.push({ services, adapter }); return () => {} }
  }
  class ProbeSettings extends Service {
    constructor(context) { super(context, 'settings') }
    configure(presentation) { configured.push(presentation); return () => {} }
  }
  const ctx = new Context()
  try {
    new ProbeLlm(ctx)
    new ProbeSettings(ctx)
    const inject = ctx.inject.bind(ctx)
    ctx.inject = (services, callback) => {
      injected.push([...services])
      return inject(services, callback)
    }
    await ctx.plugin({ inject: plugin.inject, apply(context) { plugin.apply(context, plugin.Config({})) } })
    if (providers.length !== 1) fail(`apply() registered ${providers.length} configurable providers, expected 1`)
    else {
      const entry = providers[0]
      if (entry.provider !== PROVIDER) fail(`provider route is ${String(entry.provider)}, expected ${PROVIDER}`)
      if (entry.displayName !== 'Open Design') fail(`provider display name is ${String(entry.displayName)}`)
      if (entry.settingsNs !== PLUGIN_NAME) fail(`provider settings namespace is ${String(entry.settingsNs)}`)
      if (!Array.isArray(entry.settingsPath) || entry.settingsPath.length !== 0) fail('provider settingsPath is not []')
    }
    if (adapters.length !== 1) fail(`apply() registered ${adapters.length} adapters, expected 1`)
    else {
      if (JSON.stringify(adapters[0].services) !== JSON.stringify([PROVIDER])) fail('the adapter serves an unexpected route')
      const info = adapters[0].adapter.providerInfo(PROVIDER)
      if (info.id !== PROVIDER || info.name !== 'Open Design') fail(`adapter providerInfo() is ${JSON.stringify(info)}`)
    }
    if (JSON.stringify(injected) !== JSON.stringify([['typert'], ['settings']])) {
      fail(`apply() injected ${JSON.stringify(injected)}, expected the optional models Remote and the settings bridge`)
    }
    if (configured.length !== 1 || configured[0]?.auto !== false) {
      fail(`settings.configure() received ${JSON.stringify(configured)}, expected [{ auto: false }]`)
    }
  } catch (error) {
    fail(`Host assembly failed on this engine: ${error.stack ?? error.message}`)
  } finally {
    await ctx.fiber.dispose()
  }
}

/** Check 7: the bundle patch inserts exactly the Open Design row. */
function checkBundlePatch() {
  const patch = readFileSync(join(repositoryDir, 'cordis.patch.yml'), 'utf8')
  const rows = [...patch.matchAll(/^ {4}- id: (.+)$/gm)]
  if (rows.length !== 1) {
    fail(`cordis.patch.yml inserts ${rows.length} rows, expected exactly 1`)
    return
  }
  if (rows[0][1] !== PLUGIN_NAME) fail(`the bundle patch inserts ${rows[0][1]}, expected ${PLUGIN_NAME}`)
  if (!patch.includes(`name: "${PACKAGE_NAME}"`)) fail(`the bundle patch does not name ${PACKAGE_NAME}`)
}

async function verify(options) {
  const version = options.version ?? (options.engine === undefined ? declaredEngineVersions().at(-1) : undefined)
  let engineRoot = options.engine
  let scratch
  let installed
  try {
    if (engineRoot === undefined) {
      installed = installEngine(version)
      engineRoot = installed
    }
    const engine = resolveEngine(engineRoot)
    process.stdout.write(`engine: dsh ${engine.version} at ${engine.root}\n`)
    scratch = mkdtempSync(join(tmpdir(), 'dsh-engine-load-tree-'))
    const staged = await checkLink(engine.modules, scratch)
    await checkNamedImports(engine.modules)
    await checkEngineAdmission(engine.modules, engine.version)
    checkClientRequires(engine.modules)
    checkBundlePatch()
    await checkVolatileConfig(staged)
    await checkHostAssembly(staged, engine.modules)
    if (version !== undefined && engine.version !== version) {
      warn(`engine reports ${engine.version}, expected ${version}`)
    }
    return report(engine.version)
  } finally {
    if (scratch !== undefined && !options.keep) rmSync(scratch, { recursive: true, force: true })
    if (installed !== undefined && !options.keep) rmSync(installed, { recursive: true, force: true })
  }
}

async function main(argv) {
  const options = parseArgs(argv)
  if (options.engine !== undefined || options.version !== undefined) {
    process.exit((await verify(options)) ? 0 : 1)
  }
  const versions = declaredEngineVersions()
  let passed = true
  for (const [index, version] of versions.entries()) {
    if (index > 0) process.stdout.write('\n')
    process.stdout.write(`===== 引擎矩阵 ${index + 1}/${versions.length}: dsh ${version} =====\n`)
    failures.length = 0
    warnings.length = 0
    passed = (await verify({ ...options, version })) && passed
  }
  if (versions.length > 1) {
    process.stdout.write(
      passed
        ? `engine-load smoke passed on all ${versions.length} declared-compatible engines (${versions.join(', ')})\n`
        : `engine-load smoke FAILED on at least one of ${versions.length} declared-compatible engines (${versions.join(', ')})\n`,
    )
  }
  process.exit(passed ? 0 : 1)
}

await main(process.argv.slice(2))
