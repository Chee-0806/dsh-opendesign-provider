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
 * 131 072, chosen against a measured provider limit rather than a round guess.
 * Probing `/alpha/generate` directly on 2026-09-28: 64 000 → 200, 131 072 → 200,
 * 196 608 → 200, **200 000 → 200, 200 704 → 400**, 1 000 000 → 400. The server
 * therefore caps `max_tokens` at 200 000, and it does so identically for a
 * 262 144-window model (`stealth/pixel-canary`, retired by Command Code on
 * 2026-10-01 and named here only as the probe's subject) and a 1 000 000-window
 * one (`stealth/space-bunny-alpha`) — the cap is global, not per model. 131 072
 * keeps a 35 % margin under it while covering the real output ceiling of the
 * models that have one (Claude 64 K, Gemini 64 K, several at 128 K).
 *
 * The old 64 000 was never a provider requirement: it cost nothing in latency
 * (a 64 000 request answered headers in 1.28 s against 1.57 s for 131 072) but
 * it did cap what a model could ever say in one turn.
 *
 * No client-side clamp is applied on top of this: an earlier version pre-shrank
 * `max_tokens` from an estimate of the prompt already sent (`requestContextBudget()`,
 * issue #67), but that estimate over-corrected on ordinary long conversations —
 * exactly the "output gets cut short as the conversation grows" symptom issue #74
 * reported — while a live A/B probe (2026-09-30, `stealth/space-bunny-alpha`,
 * ~19.6% over its 1,000,000-token window with no client-side shrink) showed the
 * endpoint answers a genuine overflow with an unambiguous `400 … exceeds the
 * model's context window`, which `isContextOverflowDetail()` classifies as
 * `CONTEXT_WINDOW_EXCEEDED` independently of this constant.
 *
 * A user-set positive budget can only TIGHTEN this, never raise it — a figure
 * above the cap would be refused by the gateway anyway, so the settings field
 * refuses it at the input instead of spending a round trip to learn that.
 *
 * Lives here rather than in `adapter.ts` so the browser settings page can bound
 * its input by the same figure the Host enforces; `adapter.ts` re-exports it
 * under its historical name.
 */
export const MAX_OUTPUT_TOKEN_LIMIT = 131_072

/**
 * The `maxOutputTokens` value that asks the adapter to send NO `max_tokens`
 * field at all, leaving the per-turn output size to the platform (issue #74).
 * Only the CLI and OpenAI transports can honour it: Anthropic's Messages
 * endpoint requires the field, so that route keeps sending its derived budget.
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
