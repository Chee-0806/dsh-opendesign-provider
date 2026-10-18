/**
 * Volatile-config helpers for dsh 0.1.7's schema-derived profile Config.
 *
 * 0.1.7's `settings.describe()` projects each entry's schema through
 * `volatileForm()`, so a form contains ONLY nodes carrying `meta.volatile`
 * and a form edit is refused unless its path lies beneath a marked node. The
 * loader then resolves each marked field into a frozen `{ get() }` reference
 * that is written IN PLACE (no remount) and announced with
 * `loader/volatile-update`. Two helpers keep the rest of the plugin reading a
 * PLAIN `Config`: `markVolatile()` applies the mark, and
 * `unwrapVolatileConfig()` reads every top-level field through its reference
 * when one is present — FRESH per call, because a reference's identity is
 * stable while its value changes.
 *
 * Only TOP-LEVEL fields are marked (a form write names a top-level path such
 * as `accounts` or `modelVisibility.<id>`), so one unwrap level is complete.
 * The literal `apiKey` secret stays unmarked on purpose: no settings surface
 * writes it — page and TUI both write keys through the credentials seam — so a
 * config-file edit to it reloading the fiber is correct for a secret literal.
 *
 * `volatileWrite()` is the third helper and the only WRITE in this module: it
 * commits into a reference that belongs to ANOTHER plugin entry (`ctx.web`'s
 * `searchProvider`), which no host API addresses directly. It is the degraded
 * path behind `ctx.settings.update()`; see its own note for why the disk-backed
 * path is preferred.
 *
 * @module dsh-commandcode-provider/config-volatile
 */

/**
 * Mark one schema field volatile.
 *
 * `.volatile()` is unconditional: it is a schemastery 3.18.3 feature and the
 * supported engine ships `~3.18.5`, so the
 * method is always present. It is reached through a structural member so the caller's
 * declared field type survives — the mark changes what the schema PARSES to (a
 * live reference), not the plugin-facing `Config` shape.
 */
export function markVolatile<S>(schema: S): S {
  return (schema as S & { volatile(): S }).volatile()
}

/**
 * Mark every field of a Config field dict volatile, except the named
 * composition-only secrets (`apiKey` here, which no settings surface writes).
 */
export function markVolatileFields<D extends Record<string, unknown>>(
  fields: D,
  skip: readonly string[] = [],
): D {
  return Object.fromEntries(
    Object.entries(fields).map(([name, schema]) => [name, skip.includes(name) ? schema : markVolatile(schema)]),
  ) as D
}

/** A resolved volatile config reference: the frozen `{ get() }` cosmokit hands out. */
export interface VolatileRef {
  get(): unknown
}

/**
 * Whether a resolved config value is a volatile reference.
 *
 * Duck-typed on the two properties `createVolatile` produces (frozen object
 * with a `get` method) rather than cosmokit's private `write` symbol, because
 * cosmokit is not a peer of this bundle. Config values are plain parsed JSON
 * (or `!!jsExpr` wrappers), which are never frozen, so the test cannot
 * misfire on an ordinary field.
 */
export function isVolatileRef(value: unknown): value is VolatileRef {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.isFrozen(value)
    && typeof (value as VolatileRef).get === 'function'
}

/**
 * The commit protocol cosmokit's `createVolatile` installs on every reference.
 *
 * `Symbol.for` — not a local `Symbol()` — because cosmokit registers it
 * globally precisely so copies of the shared library loaded twice (ESM/CJS, two
 * node_modules trees) still recognize each other's references. Reaching it
 * through the global registry is what lets this bundle commit a value without
 * taking `@deepseek-ai/cosmokit` as a dependency.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Commit a value into a RUNNING volatile reference and verify it landed.
 *
 * This is the DEGRADED write path, and it is deliberately second choice: the
 * reference is the live config the owner reads per call, but the value never
 * reaches the profile document, so the next loader commit for that entry (any
 * `loader/volatile-update`, including one caused by an unrelated field of the
 * same entry) re-resolves the raw config and overwrites it. The official
 * `ctx.settings.update()` path exists to avoid exactly that; this one keeps the
 * CURRENT process coherent when settings is unavailable or refuses the write.
 *
 * Reading back is not optional: the write method is an internal protocol, so a
 * future cosmokit that renames the symbol, hides it, or changes the value shape
 * must degrade to "not applied" instead of silently pretending success.
 *
 * @param ref - Candidate volatile reference; anything else returns `false`.
 * @param value - Value to commit.
 * @returns Whether the reference now reads back as `value`.
 */
export function volatileWrite(ref: unknown, value: unknown): boolean {
  if (!isVolatileRef(ref)) return false
  const write = (ref as unknown as Record<symbol, unknown>)[VOLATILE_WRITE]
  if (typeof write !== 'function') return false
  try {
    ;(write as (this: unknown, next: unknown) => void).call(ref, value)
  } catch {
    return false
  }
  try {
    return Object.is(ref.get(), value)
  } catch {
    return false
  }
}

/**
 * Read one config object as PLAIN values.
 *
 * Every top-level field found to be a volatile reference is read through
 * `.get()` — freshly on every call, so a live update lands on the very next
 * read (the loader resolves EVERY marked node into a reference, unset fields
 * included, so a loader-parsed config always yields a fresh object here). The
 * pass-through for a field that is not a reference is what keeps the unmarked
 * `apiKey` literal readable.
 */
export function unwrapVolatileConfig<C>(config: C): C {
  const source = config as C & Record<string, unknown>
  if (typeof source !== 'object' || source === null) return config
  const plain: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(source)) {
    plain[field] = isVolatileRef(value) ? value.get() : value
  }
  return plain as C
}
