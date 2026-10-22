/**
 * Stylesheet for the Open Design plans & quota panel (the sidebar footer card
 * and the dashboard it opens).
 *
 * Returned as a string, not injected here, so importing this module has no DOM
 * side effect: `./index.ts` installs it once under {@link PANEL_CSS_ID} and
 * removes it when the fiber unwinds.
 *
 * These rules are GLOBAL CSS, so containment is a contract (issue #48): every
 * selector is qualified by one of our own `odp-` classes except the sidebar
 * anchor below, which carries its justification in place. `tests/styles.test.ts`
 * audits both stylesheets against the real foreign class stems. Colours are
 * harness theme aliases; the `odp-` prefix keeps these clear of the settings
 * page's `od-` set.
 *
 * Metrics come from the shared token layer (`--od-space-*`, `--od-radius-*`,
 * `--od-control-*`, `--od-font-*`, `--od-leading-*`, `--od-motion-*` in
 * `./tokens.ts`); colours come from the host's `--dsw-alias-*` palette. ADR-0004
 * explains why that split is not a matter of taste: the host's `brand-primary`
 * is a monochrome, and every "accent" here used to paint near-black on light and
 * near-white on dark.
 *
 * @module dsh-opendesign-provider/client/panel-styles
 */

/**
 * Stylesheet id — the `data-plugin-css` value that makes injection idempotent.
 *
 * The prefix must match this package's real name and the settings-page sheet's
 * (`PAGE_CSS_ID`); the two ids must also stay DISTINCT, since they key two
 * separate style tags and a shared id would make the second injection a no-op.
 */
export const PANEL_CSS_ID = '@mars-sea/dsh-opendesign-provider/OpenDesignPanel.module.css'

/** The panel stylesheet. */
export const PANEL_CSS = `
/* ------------------------------------------------- sidebar footer card */
/* The shell renders this list ABOVE the Settings seat, so the card is the
   sidebar's bottom-most content, and supplies no chrome: the entry IS the
   button. Deliberately quiet — a surface beside Settings should read as part of
   the column — with one hover step and a hairline border.

   The shell's container is a flex ROW whose occupants each declare a full-width
   line and shrink-proof flex, so as a row it would overflow the column: this
   card cannot shrink and the neighbouring chip would absorb the overflow and
   collapse to nothing. The first rule is that fix, and THE ANCHOR IS
   LOAD-BEARING (issue #48): "footerActions" is not a stem this shell owns alone
   — dsh-client-ui-user-questions renders the ask-user-question dialog's button
   row as Mbwy4a_footerActions, and the unanchored rule stacked THAT row's
   side-by-side buttons on every page. "footArea" is declared by
   dsh-client-ui-sidebar alone (audited across every client bundle of the
   0.1.6-alpha.1 engine, and against our own od-/odp- names, which collide with
   no engine class). The DESCENDANT combinator survives a wrapper element
   appearing between the two, so a restructured shell degrades to its own row
   rather than losing the fix. tests/styles.test.ts pins both halves. */
[class*="_footArea"] [class*="_footerActions"]{flex-direction:column}
/* The card is a NARROW container (a quarter-width sidebar column), so its inset
   and row rhythm are the tight ones — an 8px inset and 6px between the tier line
   and each window — and must not borrow the dashboard's wide spacing. */
.odp-foot{box-sizing:border-box;flex:0 0 auto;width:100%;min-width:0;font:inherit;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;background:0 0;border:var(--od-hairline) solid transparent;border-radius:var(--od-radius-sm);flex-direction:column;gap:var(--od-space-3);margin:0 0 var(--od-space-2);padding:var(--od-space-4);display:flex}
.odp-foot:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.odp-foot:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:var(--od-focus-offset)}
.odp-footTop{align-items:center;gap:var(--od-space-4);min-width:0;display:flex}
.odp-footName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;font-size:var(--od-font-label);font-weight:500;line-height:var(--od-leading-label)}
/* One block per quota window: a head line carrying the window's own spend and
   limit, then the FULL-WIDTH bar under it. Stacking the two lets the card show
   the dollar figures — the reason this surface exists — without squeezing the
   bar into what is left beside them. Mirrors the dashboard's window block. */
.odp-footRow{flex-direction:column;gap:var(--od-space-2);min-width:0;display:flex}
.odp-footHead{align-items:baseline;gap:var(--od-space-4);min-width:0;display:flex}
.odp-footLabel{flex:1;color:var(--dsw-alias-label-tertiary);font-size:var(--od-font-sm);line-height:var(--od-leading-xs)}
.odp-footAmount{flex:none;color:var(--dsw-alias-label-secondary);font-size:var(--od-font-sm);line-height:var(--od-leading-xs);font-variant-numeric:tabular-nums;white-space:nowrap}
/* The card's markup must stay PHRASING content — it renders inside the shell's
   own button — so these bars are spans, which makes display:block load-bearing:
   an inline box ignores width outright, so the fill would collapse to 0x0 and
   the bar would show no usage.

   THE TRACK COLOUR IS LOAD-BEARING (a real defect from the previous round): the
   track sits on the card's own surface, and painting it with that same layer
   alias made a 0%-used window render as nothing at all — the bar disappeared
   instead of reading as empty. bg-module-platform is the host's neutral
   recessed-track colour and stays visibly distinct from every layer this card
   can sit on, in both themes. Do not swap it for a layer alias. */
.odp-footBar{display:block;background:var(--dsw-alias-bg-module-platform);border-radius:var(--od-radius-pill);height:5px;overflow:hidden}
.odp-footFill{display:block;background:var(--dsw-alias-state-business-primary);border-radius:var(--od-radius-pill);height:100%;transition:width var(--od-motion-slow) var(--od-ease-out)}
/* Over-limit is a state, and state is never colour alone: the fill turns error
   red AND the window's text carries the state. Nothing here may clip that text. */
.odp-footFillWarn{background:var(--dsw-alias-state-error-primary)}

/* The 56px rail: one icon button on the shell's own 36px rail cell, so the
   collapsed column keeps a single 18px glyph like its siblings. */
.odp-railButton{box-sizing:border-box;width:var(--od-control-lg);height:var(--od-control-lg);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:var(--od-hairline) solid transparent;border-radius:var(--od-radius-sm);flex:none;justify-content:center;align-items:center;margin:0 0 var(--od-space-2);padding:0;display:inline-flex}
.odp-railButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.odp-railButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:var(--od-focus-offset)}

/* The ring glyph, sized entirely by its own width/height attribute, so the
   footer row, the rail button and the dashboard can each ask for their own. */
.odp-glyph{flex:none;justify-content:center;align-items:center;display:inline-flex;color:var(--dsw-alias-state-business-primary)}

/* ------------------------------------------------------------ dashboard */
.odp-main{background:var(--dsw-alias-bg-layer-1);width:100%;height:100%;overflow:auto;display:block}
.odp-mainInner{max-width:760px;margin:0 auto;padding:var(--od-space-12) var(--od-space-10) var(--od-space-20);flex-direction:column;gap:var(--od-space-7);display:flex;color:var(--dsw-alias-label-primary)}
.odp-header{align-items:center;gap:var(--od-space-5);display:flex;flex-wrap:wrap}
.odp-headerText{flex-direction:column;gap:var(--od-space-1);display:flex;min-width:0}
.odp-title{margin:0;font-size:var(--od-font-title);font-weight:600;line-height:var(--od-leading-title)}
.odp-subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--od-font-sm);line-height:var(--od-leading-sm)}
.odp-spacer{flex:1}
.odp-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--od-font-sm);line-height:var(--od-leading-sm)}
/* Dashboard header actions: the refresh control and the panel-closing × are
   SECONDARY controls — an outline on the layer colour, never a filled primary
   block. The one filled primary action belongs to the settings page's save bar,
   which does not live on this surface, so keeping these outlined is what stops
   the dashboard from competing with it. Both fit the 28px header row, so the
   dashboard stays escapable without stealing height from the numbers it exists
   to show. */
.odp-dashboardActions{flex:none;align-items:center;gap:var(--od-space-4);display:flex}
.odp-action{box-sizing:border-box;min-height:var(--od-control-sm);color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:var(--od-hairline) solid var(--dsw-alias-border-l2);border-radius:var(--od-radius-sm);justify-content:center;align-items:center;padding:0 var(--od-space-5);font:inherit;font-size:var(--od-font-sm);line-height:var(--od-leading-sm);display:inline-flex}
.odp-action:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.odp-action:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:var(--od-focus-offset)}
.odp-action:disabled{opacity:.5;cursor:progress}
.odp-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:var(--od-font-sm);line-height:var(--od-leading-sm)}

/* The dashboard body card is divided by HAIRLINES, not lifted by a shadow
   (DESIGN.md posture: one level uses either a stroke or an elevation, never
   both). Elevation is reserved for true overlays, and this sheet has none.

   The surface is bg-layer-2, NOT bg-layer-3, and that is load-bearing for the
   same reason the bar track keeps bg-module-platform: in the host's dark
   palette bg-layer-3 and bg-module-platform resolve to the SAME value
   (#353638), so a card on layer-3 makes every 0%-used track inside it vanish —
   the exact defect this sheet's track rule exists to prevent, reintroduced one
   layer up. On layer-2 the track is a visible step lighter in dark; in light
   both layer-2 and layer-3 are #ffffff, so this changes nothing there. */
.odp-card{border:var(--od-hairline) solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:var(--od-radius-md);padding:var(--od-space-8);flex-direction:column;gap:var(--od-space-8);display:flex}
.odp-block{flex-direction:column;gap:var(--od-space-4);display:flex}
.odp-blockTitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--od-font-sm);font-weight:600;line-height:var(--od-leading-sm);text-transform:uppercase;letter-spacing:.04em}
.odp-planRow{align-items:center;gap:var(--od-space-4);display:flex;flex-wrap:wrap}
.odp-planName{color:var(--dsw-alias-label-primary);font-size:var(--od-font-label);font-weight:600;line-height:var(--od-leading-label)}

/* Quota bars: the two windows, single-column at every width so the numbers are
   never squeezed by the bar or pushed into a second row. */
.odp-windows{flex-direction:column;gap:var(--od-space-7);display:flex}
.odp-window{flex-direction:column;gap:var(--od-space-3);display:flex}
.odp-windowHead{align-items:baseline;gap:var(--od-space-4);display:flex}
.odp-windowLabel{color:var(--dsw-alias-label-secondary);font-size:var(--od-font-sm);font-weight:500;line-height:var(--od-leading-sm)}
.odp-windowValue{color:var(--dsw-alias-label-secondary);font-size:var(--od-font-sm);line-height:var(--od-leading-sm);font-variant-numeric:tabular-nums;white-space:nowrap}
/* A fixed percentage column, so the '<1%' string (business logic, not this
   sheet's concern) cannot push the head line into a second row or widen the
   block. 38px holds '100%' in the tabular face with room to spare. */
.odp-windowPct{color:var(--dsw-alias-label-primary);min-width:38px;text-align:right;font-size:var(--od-font-sm);font-weight:600;line-height:var(--od-leading-sm);font-variant-numeric:tabular-nums}
/* The track follows the card's rule: a neutral recessed colour that is distinct
   from the card surface, so a 0% window still reads as an empty bar. */
.odp-bar{overflow:hidden;background:var(--dsw-alias-bg-module-platform);border-radius:var(--od-radius-pill);height:8px}
.odp-barFill{background:var(--dsw-alias-state-business-primary);border-radius:var(--od-radius-pill);height:100%;transition:width var(--od-motion-slow) var(--od-ease-out)}
.odp-barFillWarn{background:var(--dsw-alias-state-error-primary)}
.odp-windowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--od-font-sm);line-height:var(--od-leading-sm)}

/* Capsules: the accent carries the balance figure, the muted one the status,
   the warn one the stale mark. All are 4px-radius tags, so the type ramp sets their
   height instead of a per-badge padding hack. */
.odp-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-business-primary);border-radius:var(--od-radius-xs);padding:0 var(--od-space-4);font-size:var(--od-font-sm);font-weight:600;line-height:var(--od-leading-sm)}
.odp-badgeWarn{white-space:nowrap;background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary));border-radius:var(--od-radius-xs);padding:0 var(--od-space-4);font-size:var(--od-font-sm);font-weight:600;line-height:var(--od-leading-sm)}
.odp-badgeMuted{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:var(--od-radius-xs);padding:0 var(--od-space-4);font-size:var(--od-font-sm);font-weight:500;line-height:var(--od-leading-sm);max-width:220px;overflow:hidden;text-overflow:ellipsis}

@media (prefers-reduced-motion:reduce){.odp-footFill,.odp-barFill{transition:none}}
`
