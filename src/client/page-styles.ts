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
 * The metrics are the harness's own settings pages', read out of the 0.1.7
 * bundles so the page sits beside General and Models without looking foreign:
 * a row is 12px of padding, its title 14/22 label-primary and its description
 * 12/18 label-tertiary, the control on the right. The hairline rhythm is
 * section-level: a 0.5px border-l2 rule separates the GROUPS (see
 * `od-groupDivided`), never the rows inside one, so a group's rows read as one
 * list. Selectors and buttons are
 * capsules (36px / 28px compact), inputs are
 * 32px with an 8px radius and a 0.5px border-l4 edge, a card is a 0.5px
 * border-l4 outline with a 16px radius, and a nested panel is a
 * bg-module-platform fill with a 12px radius. Errors use state-error-primary.
 */
export const PAGE_CSS = `
.od-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex}
.od-title{margin:0;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px}
.od-intro{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}
.od-readOnly{margin:8px 0 0;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-tertiary));font-size:12px;line-height:18px}
.od-spacer{flex:1}
.od-group{flex-direction:column;display:flex;margin-top:28px}
.od-groupDivided{margin-top:24px;padding-top:20px;border-top:.5px solid var(--dsw-alias-border-l2)}
.od-groupHead{align-items:center;gap:8px;display:flex;min-height:28px;padding-bottom:4px}
.od-groupTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.od-groupDesc{margin:0 0 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-rows>.od-groupDesc{margin:0;padding:4px 0 0}
.od-disclosure{width:100%;padding:0 0 4px;border:0;background:0 0;font:inherit;text-align:left;cursor:pointer;border-radius:6px}
.od-disclosure:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.od-rows{flex-direction:column;display:flex}
.od-row{align-items:center;gap:8px;display:flex;padding:12px 0}
.od-rowFlush{padding:0}
.od-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:32px;display:flex}
.od-rowTitleLine{align-items:center;gap:8px;display:flex;min-width:0}
.od-rowTitle{min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.od-rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-rowDesc p{margin:0}
.od-rowDesc p+p{margin-top:4px}
.od-rowError{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.od-rowControl{flex:none;align-items:center;justify-content:flex-end;gap:8px;display:inline-flex;max-width:60%}
.od-rowInput{width:200px}
.od-rowInputWide{width:280px}
.od-linkButton{box-sizing:border-box;flex:none;align-items:center;display:inline-flex;height:28px;padding:0 10px;border:0;border-radius:14px;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.od-linkButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.od-linkButton:disabled{cursor:default;opacity:.4}
.od-linkButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.od-badges{align-items:center;gap:8px;display:inline-flex}
.od-badge,.od-badgeMuted{flex:none;align-items:center;display:inline-flex;white-space:nowrap;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:12px;font-weight:500;line-height:17px}
.od-badge{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.od-badgeMuted{border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}
.od-badgeWarn{background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.od-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.od-field+.od-field{border-top:.5px solid var(--dsw-alias-border-l2)}
.od-fieldHead{align-items:center;gap:8px;display:flex}
.od-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.od-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:18px}
.od-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.od-reset:disabled{cursor:default;opacity:.4}
.od-input{box-sizing:border-box;height:32px;min-width:0;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font:inherit;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.od-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.od-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.od-input:disabled{opacity:.6;cursor:default}
.od-inputInvalid{border-color:var(--dsw-alias-state-error-primary)}
.od-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.od-modelSelectAnchor{flex-direction:column;align-items:stretch;gap:6px;display:inline-flex;min-width:160px}
.od-selector{box-sizing:border-box;align-items:center;gap:12px;display:inline-flex;height:36px;padding:0 14px;border:0;border-radius:18px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer}
.od-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.od-selector:disabled{cursor:default;opacity:.4}
.od-selector:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.od-selectorText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.od-selectorCaret{flex-shrink:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);width:6px;height:6px;margin-bottom:3px;transform:rotate(45deg)}
/* The search box sits inside the Menu anchor, so typing in it never trips
 * the Menu's outside-click close. */
.od-modelSearch{width:100%}
.od-modelSearch::-webkit-search-cancel-button{cursor:pointer}
.od-checkRow{align-items:center;gap:8px;display:inline-flex;min-width:0}
.od-checkRow:hover{cursor:pointer}
/* A hand-drawn box, not the platform's accent-color checkbox: the native
 * control's colours come from color-scheme, which the theme sets once at BOOT
 * and never re-applies in-session, so a native box can paint light-chrome white
 * on a dark page. The mark rides a brand-primary fill, so it takes the brand
 * foreground (the only pairing that survives dark mode's near-white brand), and
 * the outline is a border-l3 hairline because border-l2 leaves an unchecked box
 * invisible against the menu surface. */
.od-check{box-sizing:border-box;appearance:none;flex-shrink:0;width:16px;height:16px;margin:0;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;background:0 0;position:relative}
.od-check:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.od-check:checked::after{content:'';position:absolute;top:3px;left:5px;width:3px;height:7px;border:solid var(--dsw-alias-label-primary-foreground,#fff);border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}
.od-checkName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Modelled on the platform's own Switch primitive (ui-primitives
 * Switch.module.css): a 36x20 capsule padding its track by 2px and sliding a
 * 16px thumb across the 32px content box. Three things are load-bearing.
 * (1) corner-shape:round on BOTH track and thumb — the theme sets a global
 * superellipse corner shape, which squares a capsule's ends off around a round
 * thumb. (2) No literal colours: brand-primary INVERTS between the modes, so a
 * hardcoded white thumb vanishes on the checked track in dark mode; the brand
 * foreground is what the platform paints on that fill. (3) border-l3 as the
 * off track — border-l2 leaves it indistinguishable from the page. */
.od-toggle{box-sizing:border-box;appearance:none;flex-shrink:0;width:36px;height:20px;margin:0;padding:2px;border:0;border-radius:10px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer;position:relative}
.od-toggle:checked{background:var(--dsw-alias-brand-primary)}
.od-toggle::after{content:'';display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}
.od-toggle:checked::after{transform:translateX(16px)}
.od-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.od-toggle:disabled{cursor:default;opacity:.5}
.od-chevron{flex-shrink:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);width:7px;height:7px;margin-right:6px;margin-bottom:3px;transform:rotate(45deg);transition:transform .15s ease}
.od-chevronUp{transform:rotate(-135deg);margin-bottom:-3px}
.od-accountMode{align-items:center;gap:4px;display:flex;margin:-4px 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.od-accountList{flex-direction:column;gap:8px;display:flex}
.od-accountList+.od-addButton,.od-accountList+.od-addPanel{margin-top:8px}
.od-accountItem{flex-direction:column;gap:10px;display:flex;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px}
.od-accountItemActive{border-color:var(--dsw-static-neutral-bluish-400,var(--dsw-alias-border-l3))}
.od-accountHead{align-items:center;gap:4px;display:flex;min-height:28px}
.od-accountToggle{align-items:center;gap:8px;display:flex;flex:1;min-width:0;padding:0;background:0 0;border:0;color:inherit;cursor:pointer;font:inherit;text-align:left}
.od-accountToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
.od-accountName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.od-iconButton{flex-shrink:0;align-items:center;justify-content:center;display:inline-flex;width:28px;height:28px;padding:0;background:0 0;border:0;border-radius:6px;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.od-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.od-iconButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
/* Per-model context-length override rows (issue #86): the error wraps onto
   its own line beneath the select/input/remove trio. The three cells form a
   fixed column contract — flexible model, 112px value, 28px remove — and the
   od-contextHead labels repeat the first two (plus the remove cell's width
   as a spacer) so they sit exactly over their columns. */
.od-contextItem{align-items:center;gap:8px;display:flex;flex-wrap:wrap;padding:8px 0}
.od-contextHead{align-items:center;gap:8px;display:flex;flex-wrap:wrap;padding:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-contextHeadModel{flex:1;min-width:200px}
.od-contextHeadValue{flex:none;width:112px}
.od-contextHeadGap{flex:none;width:28px}
.od-contextSelect{position:relative;display:block;flex:1;min-width:200px}
/* appearance:none swaps the platform arrow for the od-contextCaret, shaped
   like od-selectorCaret so every dropdown in the plugin opens with the same
   hand-drawn chevron. */
.od-contextModel{box-sizing:border-box;appearance:none;-webkit-appearance:none;width:100%;padding-inline-end:26px;text-overflow:ellipsis;cursor:pointer}
.od-contextCaret{position:absolute;inset-inline-end:12px;top:50%;width:6px;height:6px;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:translateY(-50%) rotate(45deg);pointer-events:none}
.od-contextSelect:has(.od-contextModel:disabled) .od-contextCaret{opacity:.6}
.od-contextValue{flex:none;width:112px}
.od-contextError{flex-basis:100%}
/* Three dots from one element: the dot plus two box-shadow copies. */
.od-kebab{width:3px;height:3px;border-radius:50%;corner-shape:round;background:currentColor;box-shadow:0 -5px 0 currentColor,0 5px 0 currentColor}
.od-tabDot{flex-shrink:0;width:8px;height:8px;border-radius:50%;corner-shape:round}
.od-tabDotOk{background:var(--dsw-alias-state-success-primary)}
.od-tabDotBlank{background:0 0;border:0}
.od-tabDotWarn{background:var(--dsw-alias-state-warn-primary,#d97706)}
.od-tabDotError{background:var(--dsw-alias-state-error-primary)}
.od-accountMeters{flex-wrap:wrap;gap:6px 20px;display:flex;padding-left:16px}
.od-miniMeter{align-items:center;gap:8px;display:inline-flex;font-size:12px;line-height:18px}
.od-miniMeterLabel{color:var(--dsw-alias-label-tertiary)}
.od-miniMeterTrack{overflow:hidden;background:var(--dsw-alias-bg-module-platform);border-radius:999px;width:64px;height:4px}
.od-miniMeterFill{display:block;background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%}
.od-miniMeterValue{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.od-accountSetup,.od-loginStatus{flex-direction:column;gap:8px;display:flex;padding-left:16px}
.od-loginStatus{flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 12px}
.od-loginStatus>p{margin:0;font-size:12px;line-height:18px}
.od-accountDetails{container-type:inline-size;border-top:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:14px;display:flex;padding-top:12px}
.od-inlineForm,.od-confirmBar{flex-direction:column;gap:8px;display:flex}
.od-inlineActions{align-items:center;gap:8px;display:flex}
.od-confirmBar{border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;padding:12px 14px}
.od-confirmText{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;line-height:22px}
.od-dangerButton{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.od-dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.od-addButton{box-sizing:border-box;align-items:center;justify-content:center;gap:6px;display:flex;width:100%;height:44px;border:1px dashed var(--dsw-alias-border-l3);border-radius:16px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.od-addButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.od-addButton:disabled{cursor:default;opacity:.4}
.od-addButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.od-addGlyph{position:relative;width:12px;height:12px}
.od-addGlyph::before,.od-addGlyph::after{content:'';position:absolute;background:currentColor;border-radius:1px}
.od-addGlyph::before{left:0;right:0;top:5.25px;height:1.5px}
.od-addGlyph::after{top:0;bottom:0;left:5.25px;width:1.5px}
.od-addPanel{flex-direction:column;gap:12px;display:flex;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
.od-panelTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.od-accountReport{flex-direction:column;gap:14px;display:flex}
.od-usageHead{align-items:center;gap:8px;display:flex}
.od-usageTitle{color:var(--dsw-alias-label-primary);flex:1;margin:0;font-size:14px;font-weight:500;line-height:22px}
.od-usageAccount{max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-usagePlan{flex:none;white-space:nowrap;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:999px;corner-shape:round;padding:0 7px;font-size:12px;font-weight:500;line-height:17px}
.od-usagePlanStatus{flex:none;margin:0;white-space:nowrap;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.od-usageHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
/* Two fixed grids, not one auto-fit track: auto-fit wrapped the four activity
 * tiles 3 + 1 at the details' width. The activity row folds to 2 × 2 in a
 * narrow details panel. */
.od-usageStats{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;display:grid}
.od-usageStatsActivity{grid-template-columns:repeat(4,minmax(0,1fr))}
.od-usageStatsBalance{grid-template-columns:repeat(3,minmax(0,1fr))}
@container (max-width:460px){.od-usageStatsActivity{grid-template-columns:repeat(2,minmax(0,1fr))}}
.od-usageStat{min-width:0;flex-direction:column;gap:2px;display:flex;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
.od-usageStatLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-usageStatValue{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px;font-variant-numeric:tabular-nums}
.od-usageStatSub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.od-usageWindows{flex-direction:column;gap:14px;display:flex}
.od-usageWindow{flex-direction:column;gap:6px;display:flex}
.od-usageWindowHead{align-items:baseline;gap:8px;display:flex}
.od-usageWindowLabel{color:var(--dsw-alias-label-secondary);flex:1;font-size:12px;line-height:18px}
.od-usageWindowValue{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.od-usageExceeded{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.od-usageBar{overflow:hidden;background:var(--dsw-alias-bg-module-platform);border-radius:999px;height:4px}
.od-usageBarFill{background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.od-usageBarFillWarn{background:var(--dsw-alias-state-error-primary)}
.od-usageWindowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.od-usageMeta{align-items:center;gap:8px;display:flex}
.od-usageMetaSpacer{flex:1}
.od-usageUpdated{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.od-usagePartial{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.od-usageBlocked{border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.od-usageBlockedTitle{color:var(--dsw-alias-state-error-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}
.od-usageBlockedHint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}
.od-usageBlockedDetail{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;word-break:break-word}
.od-version{margin:32px 0 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.od-versionLink{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));text-decoration:none}
.od-versionLink:hover{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-position:under}
.od-providerCard{flex-direction:column;display:flex}
.od-footer{justify-content:flex-end;align-items:center;gap:8px;display:flex}
.od-failed{display:inline-block;max-width:260px;min-width:0;color:var(--dsw-alias-state-error-primary);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}
.od-loginLink{color:var(--dsw-alias-link,var(--dsw-alias-brand-primary));text-decoration:none;font-size:12px;line-height:18px}
.od-loginLink:hover{text-decoration:underline;text-underline-position:under}
.od-loginDone{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary))}
.od-loginError{color:var(--dsw-alias-state-error-primary)}
/* The floating save bar: a centered capsule pinned to the bottom of the
 * settings scrollport. The dock is a zero-height sticky strip at the end of the
 * page, so the bar overlays the scrolling content instead of taking a row of
 * its own; while shown, the section reserves room at its end so the last line
 * can scroll clear. Hidden, it sinks and fades, and visibility (switched after
 * the transition) takes its buttons out of the tab order. Its surface is an
 * elevated layer (bg-layer-1 over the settings panel's layer-2) with the
 * platform's prominent elevation and no stroke, and its corners are concentric
 * (a 44px capsule around 36px buttons inset by 4px) so the gap around each
 * button is even. */
.od-sectionWithBar{padding-bottom:80px}
.od-saveBarDock{position:sticky;bottom:0;z-index:2;height:0;pointer-events:none}
.od-saveBar{--od-saveBar-tone:var(--dsw-alias-state-warn-primary,#d97706);position:absolute;left:50%;bottom:20px;box-sizing:border-box;width:max-content;max-width:calc(100% - 24px);align-items:center;gap:10px;display:flex;height:44px;padding:4px 4px 4px 16px;border:0;border-radius:22px;corner-shape:round;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 12px 32px -8px rgba(0,0,0,.24),0 2px 8px rgba(0,0,0,.08));opacity:0;visibility:hidden;transform:translate(-50%,12px);transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}
.od-saveBarShown{opacity:1;visibility:visible;transform:translate(-50%,0);pointer-events:auto;transition:opacity .2s ease,transform .24s cubic-bezier(.2,.9,.3,1.1),visibility 0s}
.od-saveBar-error{--od-saveBar-tone:var(--dsw-alias-state-error-primary)}
.od-saveBar-success{--od-saveBar-tone:var(--dsw-alias-state-success-primary,#16a34a);padding-right:18px}
.od-saveBarIcon{flex-shrink:0;align-items:center;justify-content:center;display:inline-flex;width:16px;height:16px;color:var(--od-saveBar-tone)}
.od-saveBarPulse{width:8px;height:8px;border-radius:50%;corner-shape:round;background:var(--od-saveBar-tone)}
.od-saveBarText{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.od-saveBar-error .od-saveBarText{color:var(--dsw-alias-state-error-primary)}
.od-saveBarActions{flex-shrink:0;align-items:center;gap:4px;display:flex;margin-left:8px}
.od-saveBarButton{box-sizing:border-box;height:36px;padding:0 16px;border:0;border-radius:18px;corner-shape:round;font:inherit;font-size:14px;line-height:22px;white-space:nowrap;cursor:pointer}
.od-saveBarButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.od-saveBarButton:disabled{cursor:default;opacity:.4}
.od-saveBarGhost{background:0 0;color:var(--dsw-alias-label-primary)}
.od-saveBarGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.od-saveBarPrimary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff)}
.od-saveBarPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)))}
/* Analytics page (ticket 12): a draft filter row, a summary strip and one
 * comparison table. The table lives in a horizontal scroll container so a wide
 * nine-column comparison never forces the settings panel to scroll sideways. */
.od-analyticsFilters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px}
.od-analyticsModes{display:inline-flex;padding:2px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.od-modeButton{box-sizing:border-box;height:32px;padding:0 12px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.od-modeButtonActive{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.od-modeButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.od-analyticsField{display:flex;flex-direction:column;gap:4px}
.od-analyticsNumber{width:96px}
.od-analyticsNotices{margin:12px 0 0}
.od-analyticsSummary{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:8px;margin:12px 0}
.od-analyticsStat{display:flex;flex-direction:column;gap:2px;padding:8px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.od-analyticsStatLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.od-analyticsStatValue{color:var(--dsw-alias-label-primary);font-size:16px;line-height:24px;font-variant-numeric:tabular-nums}
.od-analyticsTableWrap{overflow-x:auto}
.od-analyticsTable{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.od-analyticsTable th,.od-analyticsTable td{padding:8px 10px;border-bottom:0.5px solid var(--dsw-alias-border-l2);text-align:right;white-space:nowrap}
.od-analyticsTable th:first-child,.od-analyticsTable td:first-child{text-align:left}
.od-analyticsTable th{color:var(--dsw-alias-label-secondary);font-weight:500}
.od-analyticsTable td{color:var(--dsw-alias-label-primary)}
@media (prefers-reduced-motion:reduce){.od-chevron,.od-toggle::after,.od-usageBarFill,.od-saveBar,.od-saveBarShown{transition:none}}
`
