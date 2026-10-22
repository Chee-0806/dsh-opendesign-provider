/**
 * Design-token layer shared by both stylesheets.
 *
 * Adopted from the external brand package (Open Design's `DeepSeek Harness`
 * system, previously published under the name `Product`). See ADR-0004 for why
 * the split is what it is:
 *
 * - **Shapes, posture rules and the STEP SHAPE come from the brand package**
 *   (DESIGN.md): a 4px half-step grid, the 4/8/12/16 radius ladder, a control-
 *   height ladder, a type ramp.
 * - **The concrete values in this file are the HOST's**, read out of the
 *   harness's own primitives (Input 32px, Button 36/28, Switch 20px track,
 *   DisclosureRow 24px, radius 4/8/12/16) rather than copied from the package's
 *   antd-derived `tokens.compact.json`. The package's numbers describe a
 *   standalone desktop shell (44px controls); these surfaces sit inside the
 *   harness settings dialog and have to line up with the connectors beside them.
 *   Where the host itself uses a 2px step (a 6px gap, a 14px inset) that step is
 *   kept and named rather than snapped to 4px, because snapping would move
 *   controls away from the native ones.
 * - **Colours come from the host, never from the package.** The package's
 *   palette is derived from a pasted `designmd://` seed and knows nothing about
 *   the harness. The harness publishes 101 `--dsw-alias-*` semantic tokens on
 *   `<body>` and swaps the whole set under `body[data-ds-dark-theme]`, so
 *   reading them is what makes dark mode free and keeps these surfaces looking
 *   like part of the shell instead of an attached panel.
 *
 * Three deliberate departures from the package's literal spec, each argued in
 * ADR-0004:
 *
 * 1. **Density is the package's `compact` algorithm, not its `default`.** The
 *    package's 44px control is correct for a standalone desktop shell; these
 *    surfaces live inside the harness settings dialog, beside native controls
 *    that are 32px (Input) / 36px (Button md) / 28px (Button sm) / 20px
 *    (Switch). A 44px control here would read as a foreign component.
 * 2. **Strokes stay at the harness's 0.5px hairline**, not the package's 1px.
 *    Stroke weight is a "same frame as the host" fact; radius and shape are
 *    what the package actually owns.
 * 3. **The accent is `--dsw-alias-state-business-primary`, not
 *    `--dsw-alias-brand-primary`.** In the harness those two names mean the
 *    opposite of what they suggest: `brand-primary` resolves to a *monochrome*
 *    (#0f1115 light / #f9fafb dark, same value as `label-primary`), and the
 *    real blue accent is `state-business-primary` (#4176e6 / #7aaaff). Using
 *    `brand-primary` for a progress fill or a checked switch painted a near-
 *    black bar on light and a near-white bar on dark — which is exactly the bug
 *    this ticket fixes.
 *
 * The custom properties are declared on the plugin's own scope, never on
 * `:root`. Two reasons: writing `:root` would leak into the host and every
 * other plugin, and `tests/styles.test.ts` pins containment (issue #48) — every
 * selector this bundle ships must be qualified by one of our own `od-`/`odp-`
 * classes. {@link TOKEN_ROOTS} is that anchor, and it names the surfaces' own
 * roots rather than `:root`.
 *
 * @module dsh-opendesign-provider/client/tokens
 */

/**
 * Stylesheet id for the token layer — the `data-plugin-css` value that keeps
 * injection idempotent.
 *
 * Same package prefix as the other two sheets, and DISTINCT from both: the id
 * keys the style tag, so a shared id would silently drop whichever sheet was
 * injected second.
 */
export const TOKEN_CSS_ID = '@mars-sea/dsh-opendesign-provider/DesignTokens.module.css'

/**
 * The selectors that carry the token block: the surfaces' existing roots.
 *
 * Hanging the tokens off markup that is already there means the layer needs no
 * change to any component, and a surface cannot forget to opt in (which is how
 * a token layer rots: new surface, missing class, silent `inherit`). There is
 * deliberately no separate `od-tokens` opt-in class — a class nobody renders is
 * a promise nobody keeps, and `tests/css-hygiene.test.ts` would rightly call it
 * markup-less.
 */
const TOKEN_ROOTS = [
  '.od-section',
  '.od-providerCard',
  '.odp-main',
  '.odp-foot',
  '.odp-railButton',
].join(',')

/**
 * Metric tokens from the brand package.
 *
 * Only tokens the two stylesheets actually consume are listed: an unused token
 * is an untested claim, and `tests/css-hygiene.test.ts` fails the build if one
 * appears. Add a step when a rule needs it, not before. Every value is a metric:
 * no colour, no `rgba()`, no `#` — a colour here would be a second source of
 * truth beside the host aliases.
 */
export const TOKEN_CSS = `
${TOKEN_ROOTS}{
/* ---- spacing: 8px baseline, 4px half-step (package §Layout) */
--od-space-1:2px;
--od-space-2:4px;
--od-space-3:6px;
--od-space-4:8px;
--od-space-5:10px;
--od-space-6:12px;
--od-space-7:14px;
--od-space-8:16px;
--od-space-10:20px;
--od-space-12:24px;
--od-space-20:40px;
/* ---- radius: the package's 4/8/12/16 ladder; pill for capsules only */
--od-radius-xs:4px;
--od-radius-sm:8px;
--od-radius-md:12px;
--od-radius-pill:999px;
/* ---- stroke: the harness hairline, kept over the package's 1px (ADR-0004) */
--od-hairline:.5px;
--od-stroke:1px;
/* ---- control heights: the package's compact ladder, aligned with the
   harness's native 28 / 32 / 36 (ADR-0004 §Density) */
--od-control-sm:28px;
--od-control:32px;
--od-control-lg:36px;
/* The floating save bar's own height. Not a control step: no control in these
   surfaces is 44px tall (ADR-0004 §Density explains why 44px controls would be
   wrong inside the harness dialog). */
--od-bar-h:44px;
/* ---- type ramp: 12/18 · 13/20 · 14/22 · 15/22 · 20/28 (package §Typography) */
--od-font-xs:11px;
--od-font-sm:12px;
--od-font-label:13px;
--od-font-base:14px;
--od-font-lg:15px;
--od-font-title:20px;
--od-leading-xs:16px;
--od-leading-sm:18px;
--od-leading-label:20px;
--od-leading-base:22px;
--od-leading-title:28px;
/* ---- focus: the ring offset every focusable control shares */
--od-focus-offset:2px;
/* ---- motion: the package's fast/mid pair and its ease-out curve */
--od-motion-fast:.1s;
--od-motion-mid:.2s;
--od-motion-slow:.3s;
--od-ease-out:cubic-bezier(.215,.61,.355,1);
}
`
