/**
 * Output-budget bounds shared by the Host, the browser settings page and the
 * adapter (issue #74).
 *
 * The module stays pure (no node imports) so the client bundle can inline it,
 * exactly like `context-window.ts`. The report behind issue #74 asked for a
 * knob that stops the adapter from writing `max_tokens` at all; that is the
 * `0` sentinel here rather than a separate `null` spelling, because the value
 * travels through one numeric settings field on both surfaces.
 */

/**
 * The output budget this bundle asks for, and the ceiling it will never exceed.
 *
 * 131 072 is the ceiling this bundle asks for until the Open Design output
 * budget lands (ticket 05 derives it from the catalog's `output_budget`). A
 * user-set positive budget can only TIGHTEN this, never raise it; a larger
 * request would be refused upstream anyway, so the settings field refuses it at
 * the input instead of spending a round trip to learn that.
 *
 * Lives here rather than in `adapter.ts` so the browser settings page can bound
 * its input by the same figure the Host enforces; the adapter re-exports it
 * under its historical name.
 */
export const MAX_OUTPUT_TOKEN_LIMIT = 131_072

/**
 * The `maxOutputTokens` value that asks the adapter to send no output-cap
 * field at all, leaving the per-turn output size to the platform. The Open
 * Design Chat Completions transport can honour it; a future Messages transport
 * would not, because that endpoint requires the field.
 *
 * This is also the field's lower bound, which is why no separate `MIN_` constant
 * exists: zero is not a small budget, it is the instruction.
 */
export const OMIT_OUTPUT_TOKENS = 0

/**
 * Whether a value can serve as a user output budget: the omit sentinel, or a
 * whole token count inside the gateway's own ceiling.
 *
 * Programmatically built connections can bypass schemastery normalization, so
 * the resolve step re-judges every value here and drops an out-of-range one
 * back to "unset" instead of letting the request carry a budget the gateway
 * refuses.
 */
export function isValidMaxOutputTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= OMIT_OUTPUT_TOKENS && value <= MAX_OUTPUT_TOKEN_LIMIT
}

/**
 * Apply a user output budget to a derived one.
 *
 * `undefined` means the user set nothing, so the derived ceiling stands
 * unchanged — the default path, and the one every existing profile takes.
 * {@link OMIT_OUTPUT_TOKENS} is a wire instruction rather than a number, so it
 * also leaves the derived budget alone; {@link omitOutputTokens} is what turns
 * it into an absent field.
 */
export function applyMaxOutputTokens(derived: number, configured: number | undefined): number {
  if (configured === undefined || configured === OMIT_OUTPUT_TOKENS) return derived
  return Math.min(derived, configured)
}

/**
 * Whether this attempt must send no `max_tokens` field at all.
 *
 * Two guards narrow this beyond the user's own setting, and both are
 * correctness requirements rather than conveniences:
 *
 * - The Messages route is excluded deliberately: the endpoint rejects a body
 *   without the field (`Invalid input: expected number, received undefined at
 *   max_tokens`), so omitting it there would not lengthen an answer, it would
 *   make the whole Claude family unusable. The CLI and OpenAI transports accept
 *   an absent field, which is where the setting does what it promises.
 * - An explicit per-call budget from the host is an instruction, not a default,
 *   so it wins over the plugin-wide setting. `session-title` is the concrete
 *   case: it asks for 64 tokens precisely because its output must stay bounded,
 *   and dropping the field there would let a title generation run long instead
 *   of making a long answer fit (issue #88's fix depends on that bound).
 */
export function omitOutputTokens(
  configured: number | undefined,
  protocol: string,
  hostRequestedTokens?: number,
): boolean {
  if (configured !== OMIT_OUTPUT_TOKENS) return false
  if (protocol === 'messages') return false
  return hostRequestedTokens === undefined
}
