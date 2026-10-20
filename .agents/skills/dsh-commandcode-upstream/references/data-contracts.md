# Data extraction and snapshot contracts

## Official sources and independence

- Catalog: `https://api.commandcode.ai/provider/v1/models` (public; ID/name/context, no account key).
- Pricing: `https://commandcode.ai/docs/resources/pricing-limits`.
- Capability registry: `https://commandcode.ai/docs/reference/cli/models`.
- Plans: `https://commandcode.ai/docs/plans/go`, `/goat`, `/pro`, `/max`; Provider: `https://commandcode.ai/docs/provider`.
- Zero data retention: `https://commandcode.ai/docs/resources/zdr` (routing rule, failure code, plan metering) and the ZDR section of `/docs/provider` (the `x-cmd-zdr: 1` request header).
- Release narrative: `https://commandcode.ai/changelog`, `https://commandcode.ai/docs/whats-new`.

Do not depend on GitHub releases/tags for npm version discovery. They were empty in earlier checks but that is not an eternal property. npm and the official website remain the direct sources for this workflow.

The CLI, website and API may update on different schedules. Save raw files and acquisition timestamps; a cached ETag is not proof the underlying business data is current. The scripts force a fresh request and preserve metadata but cannot guarantee cross-source atomicity. Retry a surprising discrepancy in a new evidence directory before treating it as retirement. Never reuse the runtime catalog cache to claim a fresh upstream check.

## CLI static parsing

The extractor uses the repo's TypeScript parser/checker, follows bindings by symbol and accepts only known literal/object/array/Map/Set shapes. No `eval`, VM execution or imported CLI is allowed. Function names are semantic anchors, not assumed permanent API: missing/ambiguous anchors fail explicitly and require inspection. A renamed anchor is not an empty table.

Current anchors are `getSupportedEfforts`, `buildModelGroups`, `getPlanInfo`, `modelSupportsZdr` and `knownModelSupportsZdr`. The registry has multiple serving providers and transport specs; filtering only `provider: commandcode` loses premium models. Conversely, scanning every object containing `reasoningEfforts` mixes unrelated OAuth registries. Follow the registry consumer and helper, cross-check their complete results, and retain provider/spec metadata in the report. Literal-only models, shared ID/effort references, hidden entries and computed visibility all need accounting. Computed `hidden` getters are preserved as review evidence, not executed or guessed.

Effort absence is meaningful only after the map was successfully parsed and the model is accounted for. A registry/helper disagreement is a review item. When a release is unchanged, still compare extracted data against the actual local snapshot. When versions differ, compare the full pinned/latest tables; changelog omissions are common.

Subscription maps must cover identical plan keys. Preserve normalization `toLowerCase().replace(/_/g, '-')` and longest-prefix precedence (`individual-pro-v1` and `individual-provider` before `individual-pro`). Verify upstream call-site semantics on changes. Plugin-added `tierWeight` is not extracted from the CLI and must be deliberately reviewed for new plans.

## Website structure and identity

Decode `self.__next_f.push([1, "..."])` JSON string chunks, concatenate in order, then parse JSON containers and walk objects. This avoids matching braces inside strings. Keep unrelated JSON-LD out through schema checks. Flight references such as `$undefined` are not truthy capability flags; `availability` and `caps.vision` must contain real booleans. A future `$ref` or spread form requires resolution or an incomplete result.

Pricing model entries contain `availability`, `caps`, `contextWindow`, `deal`, `tiers`, `timeOfDay`, `deprecated` and other metadata. Collect a complete registry, preserve raw terms, and report conflicting duplicate fields. The same object may appear multiple times or one occurrence may carry additional fields. The helper cross-checks Go embedded objects but does not yet parse GOAT/Pro/Max rendered membership automatically: inspect those pages before accepting plan changes.

A display name is NOT a unique row key in the rendered pricing table: since the 2026-10-19 MiniMax M3.1 Flash launch, a paid row and its limited-time free twin share one label, while only the paid row has an estimator-array record. `scripts/sync-model-prices.mjs` therefore groups rendered rows by name and pairs the record by row SHAPE (`Free` in all three rate cells vs numeric cells), requiring exactly one match and failing on same-shape duplicates; the numeric row is still compared rate-by-rate. Never let "the last row with this name" win, and never treat a de-duplicated map as cross-checked evidence.

Use exact catalog IDs for plugin snapshots. A pricing slug, display-name match or ID suffix produces a candidate, not identity proof. For example, a dated Haiku catalog ID and the short docs ID require an explicit reviewed alias. Each alias must have one target; multiple catalog rows mapping to one pricing object require manual resolution. Model IDs are case-sensitive data. Preserve retired/docs-only rows in evidence without reintroducing them into the active picker.

`KNOWN_PLANS` must have positive availability evidence; never assign Provider merely because lower tiers did not match. Check non-decreasing availability through tiers and re-evaluate assumptions if it fails. Do not equate a successful generation with subscription inclusion: on-demand credits can bypass tier restrictions, and unrelated failures can prevent a permitted model from generating.

## Zero data retention exceptions

`KNOWN_NON_ZDR_MODELS` 记录已知不具备零数据保留上游的模型，用于能力说明与拒绝诊断。用户启用 `Config.zdr` 时，始终发送 `x-cmd-zdr: 1`（官方 CLI 对应 `CMD_ZDR=1`）；上游无可用路由时以 `422 cmd_zdr_no_providers` 拒绝。不能因为模型在例外集中就自动移除请求头，或回退到保留数据的上游；任何放宽隐私要求都必须由用户明确选择。

Extraction follows the CLI's own predicates by symbol, never by variable name: `modelSupportsZdr(e){return !SET.has(canonicalize(e))}` and `knownModelSupportsZdr(e){… !SET.has(t)}`. The receiver of the negated `.has(...)` is the exception set, whose members may be enum references (`new Set([eD.MEMBER.id, …])`) resolved through the member-access branch of the extractor. Both anchors are unioned; a release that keeps only one still extracts, and a release that drops both FAILS rather than reporting "every model covered". A disagreement between the two anchors is reported as a review item, not silently resolved — the 1.62.0 → 1.64.0 diff is exactly such a one-entry divergence (`meituan/LongCat-2.0`), while their union was unchanged.

The docs page is not the per-model source (it is prose: "99% of our models have ZDR-capable upstreams … only a small handful of models are affected"), so the audit only re-verifies its still documents the mechanism: the markers `x-cmd-zdr`, `cmd_zdr_no_providers` and `CMD_ZDR` must appear in the decoded Flight text. A missing marker means the page moved or the feature changed shape, and the report must say so instead of claiming a check.

Snapshot semantics are "not listed ⇒ covered", matching the CLI: an id absent from the exception list is treated as ZDR-capable. Do not invert this direction while syncing — a false positive costs one request with a diagnosed 422, while a false negative silently drops the privacy guarantee for served models (and for new catalog entries the tables never list). The local table intentionally keeps ids the public catalog does not serve (CLI/pricing-visible only, e.g. a hidden `:free` sibling) because a Go-plan request can still name them. Priced note: ZDR is pass-through per upstream and usually dearer, and `src/model-prices.ts` quotes ordinary rates — that caveat belongs to the runtime docs, not to this table.

## Dates, deals and pricing

Distinguish explicit no-expiry, conditional “while capacity lasts”, date-limited, already expired and unknown terms. No date does not mean permanent. Preserve all raw terms; do not convert a date-only value to midnight UTC unless the official timezone/end-date semantics support it. For “through date” terms, confirm the inclusive end and timezone before generating an exclusive ISO cutoff. `dealLabel` must hide expired offers. Snapshot `free: true` only for a verified current no-cost offer.

Peak membership requires an actual `timeOfDay` object, not presence of the key with `$undefined`. Read `effective`, UTC windows, weekdays and prices. The current plugin supports shared whole-hour ranges and Peak/Half labels; a different timezone, fractional-hour window, schedule per model or non-2x ratio is a runtime-model change, not a snapshot tweak. Review and test that scope explicitly. Historical hourly annotations can appear next to the next model in flattened text; do not infer ownership from proximity.

Tests for changes should cover effective/expiry boundaries, weekday/weekend transitions and models without hourly pricing. Keep the existing 7h/weekday, 0h/weekend, 35h/week expectations only while current official evidence supports them; don't treat historical counts as permanent upstream constraints.

## Evidence states

Reports intentionally distinguish failed extraction (`incomplete`) from usable evidence needing review (`review-required`). `readyToApply` always stays false in the helper because several checks require judgment. In particular:

- Missing files/schema/IDs never mean no changes.
- Candidate diffs are not patches, and `after: null` does not authorize deletion.
- Source disagreement is retained, even if one source matches current code.
- All snapshot families — efforts, plans, vision, thinking, subscriptions, deals, peak pricing/windows and the ZDR exception list — plus the version must be accounted for before a complete synchronization claim.
- Real server compatibility remains a separate evidence category from static data coverage.
