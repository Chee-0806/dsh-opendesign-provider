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
 * harness theme aliases with neutral fallbacks; the `odp-` prefix keeps these
 * clear of the settings page's `od-` set.
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
.odp-foot{box-sizing:border-box;flex:0 0 auto;width:100%;min-width:0;font:inherit;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;background:0 0;border:1px solid transparent;border-radius:10px;flex-direction:column;gap:6px;margin:0 0 4px;padding:8px;display:flex}
.odp-foot:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.odp-foot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.odp-footTop{align-items:center;gap:8px;min-width:0;display:flex}
.odp-footName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;font-size:13px;font-weight:500;line-height:20px}
/* One block per quota window: a head line carrying the window's own spend and
   limit, then the FULL-WIDTH bar under it. Stacking the two lets the card show
   the dollar figures — the reason this surface exists — without squeezing the
   bar into what is left beside them. Mirrors the dashboard's window block. */
.odp-footRow{flex-direction:column;gap:4px;min-width:0;display:flex}
.odp-footHead{align-items:baseline;gap:8px;min-width:0;display:flex}
.odp-footLabel{flex:1;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
.odp-footAmount{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
/* The card's markup must stay PHRASING content — it renders inside the shell's
   own button — so these bars are spans, which makes display:block load-bearing:
   an inline box ignores width outright, so the fill would collapse to 0x0 and
   the bar would show no usage. */
.odp-footBar{display:block;background:var(--dsw-alias-bg-layer-2);border-radius:999px;height:5px;overflow:hidden}
.odp-footFill{display:block;background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.odp-footFillWarn{background:var(--dsw-alias-state-error-primary)}
.odp-footPct{flex:none;width:34px;color:var(--dsw-alias-label-secondary);text-align:right;font-size:12px;line-height:16px;font-variant-numeric:tabular-nums}

/* The 56px rail: one icon button on the shell's own 36px rail cell, so the
   collapsed column keeps a single 18px glyph like its siblings. */
.odp-railButton{box-sizing:border-box;width:36px;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid transparent;border-radius:8px;flex:none;justify-content:center;align-items:center;margin:0 0 4px;padding:0;display:inline-flex}
.odp-railButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.odp-railButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* The ring glyph, sized entirely by its own width/height attribute, so the
   footer row, the rail button and the dashboard can each ask for their own. */
.odp-glyph{flex:none;justify-content:center;align-items:center;display:inline-flex;color:var(--dsw-alias-brand-primary)}

/* ------------------------------------------------------------ dashboard */
.odp-main{background:var(--dsw-alias-bg-layer-1);width:100%;height:100%;overflow:auto;display:block}
.odp-mainInner{max-width:760px;margin:0 auto;padding:24px 20px 40px;flex-direction:column;gap:14px;display:flex;color:var(--dsw-alias-label-primary)}
.odp-header{align-items:center;gap:10px;display:flex;flex-wrap:wrap}
.odp-headerText{flex-direction:column;gap:2px;display:flex;min-width:0}
.odp-title{margin:0;font-size:18px;font-weight:600;line-height:1.4}
.odp-subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.odp-spacer{flex:1}
.odp-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums}
/* 关闭图标沿用原语义与按钮尺寸，线性 SVG 随宿主文字颜色变化。 */
.odp-close{min-width:28px;justify-content:center;padding-left:0;padding-right:0}
.odp-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
/* Dashboard header actions: the refresh control and the panel-closing × both fit
   the 28px header row, so the dashboard stays escapable without stealing height
   from the numbers it exists to show. */
.odp-dashboardActions{flex:none;align-items:center;gap:8px;display:flex}
.odp-action{box-sizing:border-box;min-height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;justify-content:center;align-items:center;padding:0 10px;font:inherit;font-size:12px;line-height:18px;display:inline-flex}
.odp-action:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.odp-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.odp-action:disabled{opacity:.5;cursor:progress}
.odp-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}

.odp-notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:12px 14px;flex-direction:column;gap:4px;display:flex}
.odp-noticeError{border-color:var(--dsw-alias-state-error-primary)}
.odp-noticeTitle{margin:0;font-size:13px;font-weight:600;line-height:1.5}
.odp-noticeError .odp-noticeTitle{color:var(--dsw-alias-state-error-primary)}
.odp-noticeHint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}
.odp-noticeDetail{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;word-break:break-word}

.odp-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;padding:16px 18px;flex-direction:column;gap:16px;display:flex}
.odp-cardHead{align-items:center;gap:10px;display:flex;flex-wrap:wrap}
.odp-avatar{flex:none;width:28px;height:28px;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-module-platform);border-radius:50%;justify-content:center;align-items:center;font-size:12px;font-weight:600;line-height:1;display:inline-flex}
.odp-cardIdentity{flex-direction:column;gap:1px;min-width:0;display:flex}
.odp-cardTitle{font-size:13px;font-weight:600;line-height:1.4}
.odp-cardOwner{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.odp-block{flex-direction:column;gap:8px;display:flex}
.odp-blockTitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;line-height:1.5;text-transform:uppercase;letter-spacing:.04em}
.odp-planRow{align-items:center;gap:8px;display:flex;flex-wrap:wrap}
.odp-fieldLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.odp-planName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:1.5}

/* The monthly credits and the usage totals share one grid. */
.odp-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.odp-tile{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;flex-direction:column;gap:2px;display:flex;min-width:0}
.odp-tileLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.odp-tileValue{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4;font-variant-numeric:tabular-nums}
.odp-tileSub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Quota bars: the monthly bar and the two windows. */
.odp-windows{flex-direction:column;gap:14px;display:flex}
.odp-window{flex-direction:column;gap:6px;display:flex}
.odp-windowHead{align-items:baseline;gap:8px;display:flex}
.odp-windowLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:1.5}
.odp-windowValue{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap}
.odp-windowPct{color:var(--dsw-alias-label-primary);min-width:38px;text-align:right;font-size:12px;font-weight:600;line-height:1.5;font-variant-numeric:tabular-nums}
.odp-warnTag{white-space:nowrap;background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary));border-radius:999px;padding:0 8px;font-size:12px;font-weight:600;line-height:17px}
.odp-bar{overflow:hidden;background:var(--dsw-alias-bg-layer-1);border-radius:999px;height:8px}
.odp-barFill{background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.odp-barFillWarn{background:var(--dsw-alias-state-error-primary)}
.odp-windowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}

.odp-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-brand-primary);border-radius:999px;padding:1px 8px;font-size:12px;font-weight:600;line-height:17px}
.odp-badgeError{background:transparent;color:var(--dsw-alias-state-error-primary)}
.odp-badgeWarn{background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
.odp-badgeMuted{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:12px;font-weight:500;line-height:17px;max-width:220px;overflow:hidden;text-overflow:ellipsis}

/* Account switch: plain buttons, like the settings page's usage carousel. */
.odp-tabs{flex-wrap:wrap;gap:6px;display:flex}
.odp-tab{align-items:center;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px;display:inline-flex;gap:6px}
.odp-tab:hover:not(.odp-tabActive){color:var(--dsw-alias-label-primary)}
.odp-tabActive{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}

@media (prefers-reduced-motion:reduce){.odp-footFill,.odp-barFill{transition:none}}
/* 分析页继承设置页和宿主控件的语义变量；独立选择器不影响账号额度页面。 */
.odp-mainInnerAnalysis{max-width:1040px;box-sizing:border-box}
/* 宿主侧栏会缩窄中心面板，按实际可用宽度切换列数，而不是仅看浏览器宽度。 */
.odp-analysis{font-size:14px;line-height:22px;min-width:0;color:var(--dsw-alias-label-primary);container-type:inline-size;container-name:odp-analysis}
.odp-analysisFilters{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:8px 0 20px}
.odp-analysisField{display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);min-width:0}
.odp-analysisFilters .odp-analysisField{flex:0 1 158px}
.odp-analysisFilters .odp-analysisScopeField{flex-basis:184px}
.odp-analysisFilters .odp-analysisDateField{flex-basis:166px}
/* 对齐原生选择器、日期输入与按钮的边框盒；保留独立箭头留白和点击区域。 */
.odp-analysisInput{box-sizing:border-box;width:100%;min-width:0;height:36px;padding:0 11px;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l4);border-radius:8px}
.odp-analysisSelectShell{position:relative;display:block;width:100%;min-width:0}
.odp-analysisSelect{appearance:none;-webkit-appearance:none;padding-inline-end:40px;text-overflow:ellipsis;cursor:pointer;border:0;border-radius:18px;background:var(--dsw-alias-bg-module-platform)}
.odp-analysisSelectShell > .odp-analysisChevron{position:absolute;inset-inline-end:12px;top:50%;transform:translateY(-50%) rotate(90deg);pointer-events:none}
.odp-analysisSelect:disabled + .odp-analysisChevron{opacity:.6}
.odp-analysisInput::placeholder{color:var(--dsw-alias-label-tertiary)}
.odp-analysisApply{box-sizing:border-box;flex:none;height:36px;font:inherit;font-size:14px;line-height:22px;white-space:nowrap;padding:0 20px;border:0;border-radius:var(--dsw-radius-md,18px);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);cursor:pointer;margin-left:2px}
.odp-analysisApply:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.odp-analysisApply:disabled{opacity:.4;cursor:wait}
.odp-analysisInput:disabled{opacity:.6}
.odp-analysisInput:focus-visible,.odp-analysisApply:focus-visible,.odp-analysisTab:focus-visible,.odp-analysisPanel:focus-visible,.odp-analysisModelSummary:focus-visible,.odp-analysisScenarioSummary:focus-visible,.odp-analysisDisclosure:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
/* 模型列表会裁切圆角，内收焦点框以保持第一行和最后一行也清晰可见。 */
.odp-analysisModelSummary:focus-visible,.odp-analysisScenarioSummary:focus-visible{outline-offset:-3px;border-radius:6px}
.odp-analysisScope{display:flex;justify-content:space-between;gap:8px 18px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-bottom:12px}
.odp-analysisScope > span:first-child{color:var(--dsw-alias-label-primary);font-weight:500}
.odp-analysisOverview{display:grid;grid-template-columns:1.45fr repeat(3,1fr);gap:20px;padding:16px 18px;background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;font-variant-numeric:tabular-nums}
.odp-analysisMetric{display:flex;flex-direction:column;gap:3px;min-width:0}
.odp-analysisLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-weight:400}
.odp-analysisValue{font-size:14px;line-height:22px;font-weight:500;overflow-wrap:anywhere}
.odp-analysisSub{display:block;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-weight:400;overflow-wrap:anywhere}
.odp-analysisOverview .odp-analysisMetric{gap:5px}
.odp-analysisOverview .odp-analysisValue{font-size:20px;line-height:28px;font-weight:500}
.odp-analysisNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:9px 0 0}
.odp-analysisMessage{margin:12px 0 0;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-layer-3);font-size:14px;line-height:22px}
.odp-analysisWarning{display:flex;align-items:flex-start;gap:8px}
.odp-analysisIcon{flex:none}
.odp-analysisWarning > .odp-analysisIcon{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));margin-top:3px}
.odp-analysisWarning p{margin:0}
.odp-analysisWarning p + p{margin-top:5px}
.odp-analysisError{color:var(--dsw-alias-state-error-primary)}
/* 沿用宿主分段控件的轨道、浮层与胶囊尺寸，保留原有页签键盘语义。 */
.odp-analysisTabs{box-sizing:border-box;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:4px;border:0;border-radius:var(--dsw-radius-md,18px);background:var(--dsw-alias-interactive-bg-hover);margin:22px 0 0;max-width:100%}
.odp-analysisTab{height:28px;padding:0 16px;border:0;border-radius:var(--dsw-radius-sm,14px);background:transparent;font:inherit;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer}
.odp-analysisTab:hover,.odp-analysisTab[aria-selected="true"]{color:var(--dsw-alias-label-primary)}
.odp-analysisTab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft)}
.odp-analysisTabCount{display:inline-flex;justify-content:center;min-width:16px;padding:0 4px;margin-left:6px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.odp-analysisPanel{padding-top:20px;min-width:0}
.odp-analysisPanel[hidden]{display:none}
.odp-analysisSectionHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.odp-analysisHeading{font-size:14px;line-height:22px;font-weight:500;margin:0}
.odp-analysisSectionHead .odp-analysisNote{margin:0;max-width:56ch}
.odp-analysisModels{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;overflow:hidden}
.odp-analysisModelRow + .odp-analysisModelRow{border-top:.5px solid var(--dsw-alias-border-l2)}
.odp-analysisTableHead,.odp-analysisModelSummary,.odp-analysisScenarioSummary{position:relative;display:grid;grid-template-columns:minmax(190px,2.1fr) minmax(150px,1.45fr) minmax(90px,.9fr) minmax(90px,.9fr) minmax(100px,1fr) 16px;gap:18px;align-items:center;padding:16px 18px;font-variant-numeric:tabular-nums}
.odp-analysisTableHead{padding-top:11px;padding-bottom:11px;background:var(--dsw-alias-interactive-bg-hover);border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.odp-analysisTableHead > span:not(:first-child){text-align:right}
.odp-analysisScenarioHead,.odp-analysisScenarioSummary{grid-template-columns:minmax(190px,2fr) minmax(118px,1.1fr) minmax(155px,1.35fr) minmax(142px,1.15fr) 16px}
.odp-analysisModelSummary,.odp-analysisScenarioSummary{cursor:pointer;list-style:none;min-height:60px}
.odp-analysisModelSummary::-webkit-details-marker,.odp-analysisScenarioSummary::-webkit-details-marker,.odp-analysisDisclosure::-webkit-details-marker{display:none}
.odp-analysisModelSummary:hover,.odp-analysisScenarioSummary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.odp-analysisIdentity{display:flex;flex-direction:column;gap:2px;min-width:0}
.odp-analysisModelName{font-size:14px;line-height:22px;font-weight:500;overflow-wrap:anywhere}
.odp-analysisModelCount{margin-top:3px}
.odp-analysisModelSummary > .odp-analysisMetric,.odp-analysisScenarioSummary > .odp-analysisMetric{align-items:flex-end}
/* 宽表使用集中表头，但保留每个指标的无障碍标签；窄面板恢复可见标签。 */
.odp-analysisModelSummary .odp-analysisMetricLabel,.odp-analysisScenarioSummary .odp-analysisMetricLabel,.odp-analysisSearchLabel{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.odp-analysisShare{display:flex;align-items:center;gap:8px;width:100%;max-width:148px;margin-top:3px}
.odp-analysisShareTrack{display:block;flex:1;height:4px;overflow:hidden;background:var(--dsw-alias-bg-module-platform);border-radius:999px}
.odp-analysisShareFill{display:block;height:100%;background:var(--dsw-alias-label-secondary);border-radius:999px}
.odp-analysisShareValue{font-size:12px;line-height:18px;min-width:40px;text-align:right;color:var(--dsw-alias-label-tertiary)}
.odp-analysisChevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.odp-analysisModelRow[open] > .odp-analysisModelSummary > .odp-analysisChevron,.odp-analysisModelRow[open] > .odp-analysisScenarioSummary > .odp-analysisChevron,.odp-analysisAggregate[open] > .odp-analysisDisclosure > .odp-analysisChevron,.odp-analysisRules[open] > .odp-analysisDisclosure > .odp-analysisChevron{transform:rotate(90deg)}
.odp-analysisDetails{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px;padding:16px 18px;background:var(--dsw-alias-bg-module-platform);border-top:.5px solid var(--dsw-alias-border-l2)}
.odp-analysisDetailTitle{font-size:12px;line-height:18px;font-weight:600;margin:0 0 11px}
.odp-analysisFacts{margin:0;display:flex;flex-direction:column;gap:8px}
.odp-analysisFact{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0}
.odp-analysisFactValue{font-size:14px;line-height:22px;margin:0;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;min-width:0}
.odp-analysisFact .odp-analysisLabel{flex-shrink:0}
.odp-analysisFooter{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-top:14px}
.odp-analysisAggregate{flex:1;min-width:210px}
.odp-analysisAggregate > .odp-analysisDetails{border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;margin-top:6px}
.odp-analysisDisclosure{display:flex;gap:7px;align-items:center;cursor:pointer;list-style:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:7px 0}
.odp-analysisDisclosure > .odp-analysisChevron{width:14px;height:14px}
.odp-analysisMonthly{flex:none;max-width:340px;display:flex;justify-content:flex-end;flex-wrap:wrap;gap:2px 8px;align-items:baseline;text-align:right;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding-top:5px}
.odp-analysisMonthlyValue{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.odp-analysisMonthly .odp-analysisNote{width:100%;margin:0}
.odp-analysisAssumption{font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);margin:0 0 18px;max-width:76ch}
.odp-analysisBaseline{margin:0 0 16px}
.odp-analysisSearch{flex:0 1 270px}
.odp-analysisSearchShell{position:relative;display:block}
.odp-analysisSearchShell > .odp-analysisIcon{position:absolute;top:10px;left:11px;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.odp-analysisSearch .odp-analysisInput{padding-left:35px}
.odp-analysisScenarioDetails{grid-template-columns:minmax(0,1fr) minmax(0,2fr)}
.odp-analysisScenarioDetails .odp-analysisFactValue{max-width:70%}
.odp-analysisEmpty{font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);text-align:center;padding:34px 18px;margin:0;border:1px dashed var(--dsw-alias-border-l4);border-radius:8px}
.odp-analysisRules{margin-top:22px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:8px}
.odp-analysisRulesBody{display:grid;grid-template-columns:1fr 1fr;gap:24px;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px;margin-top:9px}
.odp-analysisRulesBody p{margin:0 0 10px}
@container odp-analysis (max-width:920px){
.odp-analysisTableHead{display:none}
.odp-analysisModelSummary{grid-template-columns:repeat(4,minmax(0,1fr)) 16px;gap:12px 18px}
.odp-analysisScenarioSummary{grid-template-columns:repeat(3,minmax(0,1fr)) 16px;gap:12px 18px}
.odp-analysisModelSummary > .odp-analysisIdentity,.odp-analysisScenarioSummary > .odp-analysisIdentity{grid-column:1/-2}
.odp-analysisModelSummary > .odp-analysisChevron{grid-column:5;grid-row:1;justify-self:end}
.odp-analysisScenarioSummary > .odp-analysisChevron{grid-column:4;grid-row:1;justify-self:end}
.odp-analysisModelSummary > .odp-analysisMetric,.odp-analysisScenarioSummary > .odp-analysisMetric{align-items:flex-start}
.odp-analysisModelSummary .odp-analysisMetricLabel,.odp-analysisScenarioSummary .odp-analysisMetricLabel{position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip:auto;white-space:normal}
.odp-analysisDetails{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@container odp-analysis (max-width:588px){
.odp-analysisFilters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.odp-analysisFilters[data-mode="range"] .odp-analysisScopeField{grid-column:1/-1}
.odp-analysisApply{grid-column:1/-1;margin:0;width:100%}
.odp-analysisOverview{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 18px;padding:16px}
.odp-analysisModelSummary,.odp-analysisScenarioSummary{grid-template-columns:repeat(2,minmax(0,1fr));gap:15px 18px;padding:16px}
.odp-analysisModelSummary > .odp-analysisIdentity,.odp-analysisScenarioSummary > .odp-analysisIdentity{grid-column:1/-1;padding-right:24px}
.odp-analysisModelSummary > .odp-analysisChevron,.odp-analysisScenarioSummary > .odp-analysisChevron{position:absolute;top:18px;right:16px;grid-column:auto;grid-row:auto}
.odp-analysisDetails,.odp-analysisScenarioDetails{gap:20px;grid-template-columns:1fr;padding:16px}
.odp-analysisAggregate{width:100%;min-width:0}
.odp-analysisMonthly{width:100%;max-width:none;justify-content:flex-start;text-align:left;padding-top:0}
.odp-analysisSectionHead{align-items:flex-start}
.odp-analysisSectionHead .odp-analysisSearch{flex-basis:100%;width:100%;order:2}
.odp-analysisRulesBody{grid-template-columns:1fr;gap:12px}
/* 英文页签带数量时允许换行，避免轨道或文字撑出宿主的窄面板。 */
.odp-analysisTabs{margin-top:18px;grid-auto-columns:minmax(0,1fr)}
.odp-analysisTab{height:auto;min-height:28px;padding:4px 8px;white-space:normal}
}
@media (max-width:640px){.odp-mainInnerAnalysis{padding:20px 16px 32px}}
`
