/**
 * Stylesheet for the Open Design settings page — and the Models-page provider
 * card, which shares its `od-` classes.
 *
 * Returned as a string, not injected here, so importing this module has no DOM
 * side effect: `./index.ts` installs it once under {@link PAGE_CSS_ID}. It is a
 * module of its own rather than a literal in the entry so `tests/styles.test.ts`
 * can audit every rule without importing the React tree (which pulls
 * `*.module.css` through the primitives package and needs a loader registered
 * first). The rules are GLOBAL CSS, so containment is a contract (issue #48):
 * every selector is qualified by one of our own `od-` classes. Colours are
 * harness theme aliases with neutral fallbacks, and the `od-` prefix keeps
 * these clear of the panel's `odp-` set.
 *
 * METRICS come from the shared token layer (`./tokens.ts`), never from literal
 * pixels, so the page cannot drift from the panel:
 *
 * - a row is `--od-space-6` (12px) of padding, its title `--od-font-base` /
 *   `--od-leading-base` (14/22) label-primary and its description
 *   `--od-font-sm` / `--od-leading-sm` (12/18) label-tertiary; the control sits
 *   on the right at `--od-control` (32px) for inputs, `--od-control-sm` (28px)
 *   for secondary text actions and `--od-control-lg` (36px) for the save bar's
 *   pair;
 * - the radius ladder is the brand package's (DESIGN.md §Layout): `-xs` 4px for
 *   badges and menu items, `-sm` 8px for buttons, inputs and selectors, `-md`
 *   12px for cards and floating layers. The package has no pill step, and the
 *   harness's own Button/Input are 12px/8px rectangles, so the plugin's old
 *   the old 999px capsules were the one shape that matched neither;
 * - inputs are `--od-control` tall with a `--od-radius-sm` (8px) radius and a
 *   `--od-hairline` (.5px) border-l4 edge; errors use state-error-primary.
 *
 * The hairline rhythm is section-level: a `.5px` border-l2 rule separates the
 * GROUPS (see `od-groupDivided`), never the rows inside one, so a group's rows
 * read as one list.
 *
 * Two posture rules are easy to break by accident, so they are pinned by
 * comments where they bite: `od-saveBarPrimary` is the page's ONLY solid fill
 * (every other action is ghost or text), and every button-like control paints
 * the same host focus ring. Text inputs are the one deliberate exception and
 * follow the host's own Input primitive instead — an accent border, no ring —
 * because that is what the adjacent native fields do (ADR-0004 §Density).
 *
 * Values that stay literal are intrinsic component geometry, not design steps:
 * the control column width (288px), input widths (180/240px), the menu card
 * (400px), the switch track (44x26px) and the chevron/caret/check glyph
 * measures. Those are the component's own size, not a spacing decision.
 *
 * @module dsh-opendesign-provider/client/page-styles
 */

/**
 * Stylesheet id — the `data-plugin-css` value that makes injection idempotent.
 *
 * The prefix must match this package's real name and the panel stylesheet's
 * (`PANEL_CSS_ID`); the two ids must also stay DISTINCT, since they key two
 * separate style tags and a shared id would make the second injection a no-op.
 */
export const PAGE_CSS_ID = '@mars-sea/dsh-opendesign-provider/OpenDesignSettingsPage.module.css'

/**
 * The settings-page stylesheet.
 *
 * The metrics are the harness's own settings pages', read out of the host
 * bundles so the page sits beside General and Models without looking foreign:
 * a row is 12px of padding, its title 14/22 label-primary and its description
 * 12/18 label-tertiary, the control on the right at the host's 32px input
 * height. Every one of those is a token reference rather than a literal — see
 * the module comment for the mapping and for the values that deliberately stay
 * literal (component geometry).
 *
 * A note on the focus ring: button-like controls here all paint the host ring
 * (`--dsw-focus-ring-width` / `--dsw-focus-ring-color`, falling back to the
 * accent), because the page previously carried three different focus shapes —
 * a grey `box-shadow` ring on some, an accent `outline` on others, and a bare
 * border-colour change on `.od-input`. Text inputs keep the border-colour form
 * on purpose: that is exactly what the host's own Input primitive does.
 */
export const PAGE_CSS = `
.od-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex}
.od-title{margin:0;color:var(--dsw-alias-label-primary);font-size:var(--od-font-title);font-weight:500;line-height:var(--od-leading-title)}
.od-intro{margin:var(--od-space-3) 0 0;color:var(--dsw-alias-label-tertiary);font-size:var(--od-font-base);line-height:var(--od-leading-base)}
.od-readOnly{margin:var(--od-space-4) 0 0;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-tertiary));font-size:var(--od-font-label);line-height:var(--od-leading-label)}
.od-group{flex-direction:column;display:flex;margin-top:var(--od-space-12)}
.od-groupDivided{margin-top:var(--od-space-12);padding-top:var(--od-space-10);border-top:var(--od-hairline) solid var(--dsw-alias-border-l2)}
.od-groupHead{align-items:center;gap:var(--od-space-4);display:flex;min-height:var(--od-control);padding-bottom:var(--od-space-3)}
.od-groupTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:var(--od-font-lg);font-weight:500;line-height:var(--od-leading-base)}
.od-groupDesc{margin:0 0 var(--od-space-4);color:var(--dsw-alias-label-tertiary);font-size:var(--od-font-sm);line-height:var(--od-leading-sm)}
.od-rows>.od-groupDesc{margin:0;padding:var(--od-space-2) 0 0}
.od-disclosure{width:100%;padding:0 0 var(--od-space-2);border:0;background:0 0;font:inherit;text-align:left;cursor:pointer;border-radius:var(--od-radius-sm)}
.od-disclosure:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:var(--od-focus-offset)}
/* A disclosure row: label grows, badge/summary/chevron hold their size, and the
   chevron sits flush right (the bare .od-chevron rule reserves 6px for the
   selector case, which would leave the row visibly ragged here). */
.od-disclosureRow{align-items:center;gap:var(--od-space-4);display:flex;width:100%}
.od-disclosureRow .od-chevron{margin-right:0}
.od-disclosureRow:hover .od-chevron{border-color:var(--dsw-alias-label-secondary)}
.od-disclosureGroup{padding:0;color:var(--dsw-alias-label-primary)}
.od-disclosureField{padding:0;color:var(--dsw-alias-label-primary);font-size:var(--od-font-label);font-weight:500;line-height:var(--od-leading-label)}
.od-disclosureLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.od-disclosureSummary{flex:none;color:var(--dsw-alias-label-tertiary);font-size:var(--od-font-sm);line-height:var(--od-leading-sm);font-variant-numeric:tabular-nums}
.od-groupTitleToggle{flex:1;min-width:0}
.od-rows{flex-direction:column;display:flex}
.od-row{align-items:center;gap:var(--od-space-4);display:flex;padding:var(--od-space-6) 0}
.od-rowText{flex-direction:column;flex:1;gap:var(--od-space-2);min-width:0;padding-right:var(--od-space-8);display:flex}
.od-rowTitleLine{align-items:center;gap:var(--od-space-4);display:flex;min-width:0}
.od-rowTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:var(--od-font-base);font-weight:400;line-height:var(--od-leading-base)}
.od-rowDesc{color:var(--dsw-alias-label-tertiary);font-size:var(--od-font-sm);line-height:var(--od-leading-sm)}
.od-rowDesc p{margin:0}
.od-rowDesc p+p{margin-top:var(--od-space-2)}
.od-rowError{margin:0;color:var(--dsw-alias-state-error-primary);font-size:var(--od-font-sm);line-height:var(--od-leading-sm)}
.od-rowControl{flex:none;align-items:center;justify-content:flex-end;gap:var(--od-space-4);display:inline-flex;max-width:60%}
/* Fixed control widths, not spacing: these are the column's own sizes. */
.od-rowInput{width:180px}
.od-rowInputWide{width:240px}
.od-linkButton{box-sizing:border-box;flex:none;align-items:center;display:inline-flex;height:var(--od-control-sm);padding:0 var(--od-space-5);border:0;border-radius:var(--od-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--od-font-sm);line-height:var(--od-leading-sm);white-space:nowrap;cursor:pointer}
.od-linkButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.od-linkButton:disabled{cursor:default;opacity:.4}
.od-linkButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:var(--od-focus-offset)}
.od-badge,.od-badgeMuted,.od-badgeWarn{flex:none;align-items:center;display:inline-flex;white-space:nowrap;border-radius:var(--od-radius-xs);corner-shape:round;padding:1px var(--od-space-4);font-size:var(--od-font-sm);font-weight:500;line-height:var(--od-leading-sm)}
.od-badge{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.od-badgeMuted{border:var(--od-hairline) solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}
/* An outline, not a filled block: the amber fill read as an error where the
   fact is only "calibration unknown", and it pulled the eye off the row. */
.od-badgeWarn{border:var(--od-hairline) solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.od-field{flex-direction:column;gap:var(--od-space-2);padding:var(--od-space-6) 0;display:flex}
.od-field+.od-field{border-top:var(--od-hairline) solid var(--dsw-alias-border-l2)}
.od-input{box-sizing:border-box;height:var(--od-control);min-width:0;padding:0 var(--od-space-5);border:var(--od-hairline) solid var(--dsw-alias-border-l4);border-radius:var(--od-radius-sm);background:var(--dsw-alias-bg-layer-1);font:inherit;color:var(--dsw-alias-label-primary);font-size:var(--od-font-label);line-height:var(--od-leading-label)}
.od-input::placeholder{color:var(--dsw-alias-label-dimmed)}
/* Text fields follow the host Input primitive: the accent moves to the border
   and no ring is drawn, so a focused input looks like the native one beside it.
   Every button-like control uses the host ring instead (see the module note). */
.od-input:focus-visible{border-color:var(--dsw-alias-state-business-primary);outline:none}
.od-input:disabled{opacity:.6;cursor:default}
.od-inputInvalid{border-color:var(--dsw-alias-state-error-primary)}
.od-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--od-font-sm);line-height:var(--od-leading-sm)}
/* ---------------------------------------------- two-column field rows */
/* The page's default shape: title and description on the left, one control on
   the right. A full-width input under its label left half of every row empty.
   The control column is a FIXED width and its contents are left-aligned: right
   alignment made every row's input start at a different x, because each had its
   own width, and the stack of left edges is what the eye reads as ragged. */
.od-fieldRow{align-items:flex-start}
/* Only the single-input field rows get the fixed column; a row whose control is
   a dropdown or a button pair sizes itself. The od-inputRow class is set by FieldRow. */
.od-inputRow>.od-rowControl{flex:0 0 288px;justify-content:flex-start;min-width:0}
.od-inputRow>.od-rowControl>.od-input{width:100%;min-width:0;flex:1 1 auto}
/* The API-key row pairs its input with a Clear button; the input yields width to
   the button instead of pushing it out of the column. */
.od-inputRow>.od-rowControl>.od-input+.od-linkButton{margin-left:var(--od-space-4)}
/* Every other row's control (badge, select, switch, button) shares the same
   fixed column as the input rows, so all controls start on one vertical line.
   Without this each row right-aligned its own width: the select sat at 100px
   from the right, the switch at 50px, and the page read as a zigzag. */
.od-fieldRow>.od-rowControl{flex:0 0 288px;justify-content:flex-start;min-width:0}
.od-fieldInput{width:100%}
/* The allowlist trigger and the panel it opens; the panel overlays the page
   instead of pushing the fields below it down (twelve models did). */
.od-allowlist{flex:none;align-items:center;justify-content:flex-end;gap:var(--od-space-6);display:inline-flex}
.od-allowlistAnchor{position:relative;display:inline-flex}
/* A filled trigger: on bg-layer-1 the shared .od-selector is white-on-white and
   stops reading as a button at all. */
.od-allowlistTrigger{height:var(--od-control);min-width:168px;border:var(--od-hairline) solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
/* A floating layer: elevation and no stroke (DESIGN.md posture rule — a surface
   that is lifted by a shadow must not also carry a border). The card's 400px
   width and 380px height are its own size; the viewport margin inside the calc
   is a layout constant, not a spacing step. */
.od-allowlistMenu{position:absolute;top:calc(100% + var(--od-space-4));right:0;z-index:5;flex-direction:column;gap:var(--od-space-1);width:400px;max-width:calc(100vw - 64px);max-height:380px;padding:var(--od-space-4);border:0;border-radius:var(--od-radius-md);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 12px 32px -8px rgba(0,0,0,.24));display:flex;overflow-y:auto}
/* Menu rows are concentric with the card: a 12px radius, inset by the card's
   8px padding, leaves a 4px inner radius. */
.od-allowlistItem{align-items:center;gap:var(--od-space-5);padding:var(--od-space-4) var(--od-space-5);border-radius:var(--od-radius-xs);display:flex;cursor:pointer}
.od-allowlistItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.od-allowlistName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--od-font-base);line-height:var(--od-leading-base)}
.od-allowlistEmpty{margin:0;padding:var(--od-space-4)}
.od-allowlistMenuUp{top:auto;bottom:calc(100% + var(--od-space-4))}
/* Per-model override list: one model select, one context-length input and one
   remove cell per row, with the add action living in the header row. The three
   cells and the two header labels share one column contract — flexible model,
   140px value, 28px action — so the header sits exactly over its columns. */
.od-overrides{flex-direction:column;gap:var(--od-space-4);display:flex}
.od-overrideHead{align-items:center;gap:var(--od-space-4);display:flex;color:var(--dsw-alias-label-tertiary);font-size:var(--od-font-sm);line-height:var(--od-leading-sm)}
.od-overrideHeadModel{flex:1;min-width:160px}
.od-overrideHeadValue{flex:none;width:140px}
.od-overrideAdd{flex:none;margin-inline-start:auto;height:var(--od-control-sm);padding:0 var(--od-space-4)}
.od-overrideRow{align-items:center;gap:var(--od-space-4);display:flex;flex-wrap:wrap}
.od-overrideModel{flex:1;min-width:160px}
.od-overrideValue{flex:none;width:140px}
.od-overrideError{flex-basis:100%}
.od-selector{box-sizing:border-box;align-items:center;gap:var(--od-space-4);display:inline-flex;height:var(--od-control);padding:0 var(--od-space-7);border:0;border-radius:var(--od-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--od-font-label);line-height:var(--od-leading-label);text-align:left;cursor:pointer}
.od-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.od-selector:disabled{cursor:default;opacity:.4}
.od-selector:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:var(--od-focus-offset)}
.od-selectorText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The caret is a rotated square drawn out of two 1.5px borders; its 6px box and
   3px optical drop are glyph geometry, not spacing steps. */
.od-selectorCaret{flex-shrink:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);width:6px;height:6px;margin-bottom:3px;transform:rotate(45deg)}
/* A hand-drawn box, not the platform's accent-color checkbox: the native
 * control's colours come from color-scheme, which the theme sets once at BOOT
 * and never re-applies in-session, so a native box can paint light-chrome white
 * on a dark page. The mark rides a label-primary fill (see the next rule), so it
 * takes the layer colour, and the outline is a border-l3 hairline because
 * border-l2 leaves an unchecked box invisible against the menu surface. The
 * 18px box, 4px radius and tick measures are the control's own geometry. */
.od-check{box-sizing:border-box;appearance:none;flex-shrink:0;width:18px;height:18px;margin:0;border:var(--od-stroke) solid var(--dsw-alias-border-l3);border-radius:var(--od-radius-xs);background:0 0;position:relative}
/* Selection is filled with the label colour, not the brand accent: the page has
   one strong colour (the primary action), and a dozen blue checkboxes competed
   with it. The tick is painted in the layer colour so it inverts by itself. */
.od-check:checked{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary)}
.od-check:checked::after{content:'';position:absolute;top:3px;left:6px;width:3.5px;height:7px;border:solid var(--dsw-alias-bg-layer-1);border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}
.od-check:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:var(--od-focus-offset)}
/* A pill switch for on/off facts. Same input, different affordance: a square
   checkbox reads as "pick several of these", which a lone toggle is not. The
   44x26 track and 22px thumb are the switch's own geometry; its radius is the
   pill token because a pill of a 26px track is exactly 13px. */
.od-switch{box-sizing:border-box;appearance:none;flex-shrink:0;width:44px;height:26px;margin:0;border-radius:var(--od-radius-pill);background:var(--dsw-alias-border-l4);position:relative;cursor:pointer;transition:background var(--od-motion-fast) var(--od-ease-out)}
.od-switch::after{content:'';position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.24);transition:transform var(--od-motion-fast) var(--od-ease-out)}
.od-switch:checked{background:var(--dsw-alias-label-primary)}
.od-switch:checked::after{transform:translateX(18px)}
.od-switch:disabled{opacity:.5;cursor:default}
.od-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:var(--od-focus-offset)}
/* The chevron is a rotated square out of two 1.5px borders; its 7px box and the
   6/3px margins are optical geometry, not layout steps. */
.od-chevron{flex-shrink:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);width:7px;height:7px;margin-right:6px;margin-bottom:3px;transform:rotate(45deg);transition:transform var(--od-motion-fast) var(--od-ease-out)}
.od-chevronUp{transform:rotate(-135deg);margin-bottom:-3px}
.od-iconButton{flex-shrink:0;align-items:center;justify-content:center;display:inline-flex;width:var(--od-control-sm);height:var(--od-control-sm);padding:0;background:0 0;border:0;border-radius:var(--od-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer}
.od-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.od-iconButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:var(--od-focus-offset)}
/* Allowlist groups inside the dropdown: capability · cost, then its models. */
.od-allowlistGroup{border:0;margin:0;padding:0;min-width:0}
.od-allowlistGroupLabel{padding:var(--od-space-4) var(--od-space-5) var(--od-space-1);color:var(--dsw-alias-label-tertiary);font-size:var(--od-font-xs);line-height:var(--od-leading-xs);font-weight:600;letter-spacing:.02em}
.od-allowlistShowAll{background:0 0;border:0;width:100%;font:inherit;font-size:var(--od-font-label);line-height:var(--od-leading-label);color:var(--dsw-alias-label-secondary);text-align:start}
.od-allowlistShowAll:disabled{opacity:.5;cursor:default}
.od-providerCard{flex-direction:column;display:flex}
/* The floating save bar: a centered 12px-radius pill pinned to the bottom of the
 * settings scrollport. The dock is a zero-height sticky strip at the end of the
 * page, so the bar overlays the scrolling content instead of taking a row of
 * its own; while shown, the section reserves room at its end so the last line
 * can scroll clear. Hidden, it sinks and fades, and visibility (switched after
 * the transition) takes its buttons out of the tab order. Its surface is an
 * elevated layer (bg-layer-1 over the settings panel's layer-2) with the
 * platform's prominent elevation and no stroke, and its corners are concentric:
 * a 12px radius around 8px-radius buttons inset by 4px (12 − 4 = 8), so the gap
 * around each button reads even. The reserved 80px is two 40px steps, i.e. the
 * bar plus the offset it lifts from. */
.od-sectionWithBar{padding-bottom:calc(var(--od-space-20) * 2)}
.od-saveBarDock{position:sticky;bottom:0;z-index:2;height:0;pointer-events:none}
.od-saveBar{position:absolute;left:50%;bottom:var(--od-space-10);box-sizing:border-box;width:max-content;max-width:calc(100% - var(--od-space-12));align-items:center;gap:var(--od-space-5);display:flex;height:var(--od-bar-h);padding:var(--od-space-2) var(--od-space-2) var(--od-space-2) var(--od-space-8);border:0;border-radius:var(--od-radius-md);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 12px 32px -8px rgba(0,0,0,.24),0 2px 8px rgba(0,0,0,.08));opacity:0;visibility:hidden;transform:translate(-50%,var(--od-space-6));transition:opacity var(--od-motion-fast) var(--od-ease-out),transform var(--od-motion-fast) var(--od-ease-out),visibility 0s linear var(--od-motion-fast)}
.od-saveBarShown{opacity:1;visibility:visible;transform:translate(-50%,0);pointer-events:auto;transition:opacity var(--od-motion-mid) var(--od-ease-out),transform var(--od-motion-mid) var(--od-ease-out),visibility 0s}
.od-saveBarText{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:var(--od-font-base);line-height:var(--od-leading-base)}
.od-saveBarActions{flex-shrink:0;align-items:center;gap:var(--od-space-2);display:flex;margin-left:var(--od-space-4)}
.od-saveBarButton{box-sizing:border-box;height:var(--od-control-lg);padding:0 var(--od-space-8);border:0;border-radius:var(--od-radius-sm);corner-shape:round;font:inherit;font-size:var(--od-font-base);line-height:var(--od-leading-base);white-space:nowrap;cursor:pointer}
.od-saveBarButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:var(--od-focus-offset)}
.od-saveBarButton:disabled{cursor:default;opacity:.4}
.od-saveBarGhost{background:0 0;color:var(--dsw-alias-label-primary)}
.od-saveBarGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
/* Same neutral emphasis as the checkboxes and switches: one strong colour on
   the page, and it is the label colour, not a brand hue. This is the viewport's
   ONLY solid fill — every other action on the page is ghost or text. */
.od-saveBarPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.od-saveBarPrimary:hover:not(:disabled){opacity:.85}
@media (prefers-reduced-motion:reduce){.od-chevron,.od-switch::after,.od-saveBar,.od-saveBarShown{transition:none}}
`
