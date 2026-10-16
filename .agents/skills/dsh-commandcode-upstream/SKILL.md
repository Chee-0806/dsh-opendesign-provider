---
name: dsh-commandcode-upstream
description: Check or update this plugin against official Command Code CLI and documentation changes, including model capabilities, reasoning efforts, plans, deals, pricing schedules, zero-data-retention coverage and protocol drift. Use for upstream upgrade checks or evaluating whether the plugin needs synchronization.
---

# Command Code upstream synchronization

Keep `@mars-sea/dsh-commandcode-provider` aligned with official public evidence. Check both CLI releases and independently changing catalog/docs, even when `COMMAND_CODE_CLI_VERSION` is already latest. A version match alone never means all data is current.

## Scope

- For checks, diagnosis or planning, collect and report without editing plugin files. For an authorized update, review evidence then apply the scoped changes. Existing user authorization remains valid; do not ask again for approved work.
- Scripts only fetch public GET endpoints and write evidence/reports into the chosen output directory. They do not read credentials, run downloaded CLI code, make generation requests or edit plugin snapshots.
- Static protocol inspection is part of a check. Authenticated probes and paid generation are separate from public-data collection; perform them only within explicit user authorization. Never scan pi/OMP credential files.
- Follow repository rules for commits and releases; checking or synchronizing upstream does not authorize publication.

## Collect and inspect

Run from the repository root. Requires Python 3.10+, Node and the repository's existing TypeScript dev dependency; no extra packages are needed. Resolve the skill path if installed elsewhere.

```sh
python3 .agents/skills/dsh-commandcode-upstream/scripts/fetch.py --out /tmp/commandcode-check-UNIQUE
python3 .agents/skills/dsh-commandcode-upstream/scripts/audit.py --input /tmp/commandcode-check-UNIQUE
```

Choose a NEW output directory for each collection. `fetch.py` records HTTP outcome, time, URL, content hash and available cache headers in `manifest.json`. It downloads the npm `latest` tarball using the registry's `dist.tarball`, verifies SHA-512 integrity and extracts only `dist/cli.mjs`. If the pinned local version differs, it also fetches that baseline for a whole-table diff. A failed fetch exits 2 but leaves a failure manifest; do not substitute old files or treat the failure as no change. Resolve network permission failures through the available tool approval mechanism, then rerun into a new directory.

`audit.py` verifies stored hashes and performs offline parsing and reconciliation. Read `report.txt`, then the relevant fields of `report.json`:

- `errors`: unavailable sources, invalid schemas, missing/ambiguous mappings or missing required fields. Exit 2 / `incomplete` means evidence is insufficient.
- `review`: source conflicts, candidate aliases, dynamic model visibility, promotional terms, schedules and remaining manual checks.
- `models`, `cli`, `sources`: normalized evidence with original metadata retained.
- `catalogViews`: the two catalog views side by side (`default` vs `?view=client`) with their `catalogVersion`s and the ids only one of them serves. The extra client-only ids are the rows the default view hides (8 at the 2026-10-16 check); a drift item also lands in `review`.
- `zdr`, `zdrDocs`: the zero-data-retention exception sets (per CLI anchor, plus their union) and the docs page's still-current mechanism markers. From command-code@1.82.4 the CLI no longer bundles a set to read, so `zdrResolution` carries the rework: `artifactExceptions`, the `artifactMigratedAnchors` that moved to the catalog, `catalogZdrFalse` from `?view=client`, and their `union` — that union is the membership a snapshot should carry.
- `cli.effortSource` / `cli.effortError` / `cli.effortConflict`: where the artifact's effort table came from (`bundled-map` before 1.82.4, `registry-rows` after, where the bundled Map is gone and the rows are the only artifact-side source), why the Map could not be read, and any row where the two disagree. `review` repeats both as `effortSource` / `effortArtifactConflict`, and `cli.efforts` is still an id → levels map.
- `docsOnly`, `cliOnly`: differences from the current API response, **not a removal list**.
- `cliDiff`: changes from the pinned CLI when its version differs, including existing models gaining/losing effort levels and ZDR exception membership.
- `localSnapshots`, `candidateDiffs`, `dealEvidence`: differences against the actual dirty working-tree snapshots. Candidate removals can mean missing evidence or catalog drift; never apply them blindly.

A `catalogClientMissing` review item means the evidence was collected before 2026-10-16 and has only the default view: effort, `zdr`, `inputModalities` and `minimumPlan` then have no authoritative source, and the capability columns come from the CLI artifact alone.

Exit 0 means automated extraction completed, **not approval to apply**. Status remains `review-required`, `readyToApply=false` and protocol remains `not-verified`: the helper does not automate prose interpretation, all plan-page semantics, or server behavior.

Aliases proposed by name or ID suffix are suggestions only. After verifying each against the official model profile/registry and CLI, save an explicit JSON object `{ "catalog/id": "pricing-id" }` outside the repo and rerun with `--aliases /path/aliases.json`. Do not approve ambiguous or many-to-one mappings. No automatic lowercasing, prefix stripping or date-suffix removal establishes identity.

## Source decisions

| Field | Primary evidence | Validation / limit |
| --- | --- | --- |
| Version / CLI artifact | `https://registry.npmjs.org/command-code/latest` | Match version to artifact; integrity check before extraction |
| Catalog ID, display name, context | `https://api.commandcode.ai/provider/v1/models` | Public GET; validate unique IDs and positive context; do not use a filtered picker or its stale cache |
| Catalog capabilities (effort, ZDR, modalities, minimum plan, pricing) | `https://api.commandcode.ai/provider/v1/models?view=client` | The default view carries NONE of these fields. Authoritative from command-code@1.82.4, when `getSupportedEfforts`/`knownModelSupportsZdr` became catalog lookups; report the two views' id drift rather than merging silently |
| Efforts | From 1.82.4 the `?view=client` `reasoningEfforts`; before that the CLI map read by `getSupportedEfforts()` | Cross-check the artifact's registry rows (`buildModelGroups()`) either way; on the newer train the bundled Map is gone, so the rows are the only artifact-side source |
| Automatic reasoning | CLI registry `reasoning` with no supported efforts | Check all serving providers; not an OAuth-only table and not a provider-name filter |
| Vision | Official `/docs/reference/cli/models` row capability label | Compare pricing `caps.vision` and CLI modalities; textual Vision fallback does not count |
| Minimum plan | Pricing embedded `availability` | Cross-check Go data and remaining plan pages; absent/false are different; missing tier is unknown |
| Subscription names / credits | Maps actually referenced by CLI `getPlanInfo()` | Matching key sets; `tierWeight` remains a reviewed plugin policy |
| Deals | Pricing embedded `deal` plus rendered terms | Expiry, date timezone and conditional availability require review |
| Peak membership / schedule | Pricing embedded `timeOfDay` plus prose | Effective date, weekday, timezone, boundaries and ratios; never use flattened row annotations. Compare against the generator's own source (`/docs/resources/pricing-limits`), not the `/pricing` marketing page — they disagree |
| ZDR exceptions | From 1.82.4 the `?view=client` `zdr:false` set UNIONED with any surviving CLI negated set; before that the negated sets behind `modelSupportsZdr` / `knownModelSupportsZdr` | The CLI's default flipped from "unlisted means covered" to "unlisted means NOT covered", so a membership that merely disappeared from the artifact is not evidence it is covered. Re-check the routing rule against the `/docs/resources/zdr` page markers |
| Protocol / login / billing / search | CLI call sites, official docs and changelog | Static evidence does not prove server compatibility; see reference below |

Read [references/data-contracts.md](references/data-contracts.md) when resolving source conflicts, parser changes, dates, aliases or snapshot edits. Read [references/protocol.md](references/protocol.md) for protocol, login and account-flow verification.

The official website is a changing source, not a versioned schema. Current extraction decodes Next.js Flight string chunks before walking JSON containers. It merges repeated model objects while reporting contradictory fields, and checks against the visible capability registry. If extraction fails, inspect the saved HTML/DOM and update the parser with a fixture; do not fall back to unchecked name matching or an empty successful result. Root `/llms.txt` was unavailable in the 2026-09-09 check; do not assume a Markdown endpoint exists. Discover moved pages from current official navigation (Provider docs are `/docs/provider`, not the old `/docs/plans/provider`).

## Review and apply

1. Complete every required data category, including deals/peak pricing, subscription maps and the ZDR exception list. Read changelog and What's New independently of the version comparison. Resolve conflicts explicitly; report missing evidence as unknown. Counts are observations, never hardcoded expected totals.
2. Confirm minimum-tier availability is monotonic before representing it in `KNOWN_PLANS`. Missing from low tiers is not evidence of Provider availability. A new or non-monotonic tier needs review of the plugin's representation.
3. Diff the full effort map, including effort-less models and existing IDs. Preserve differences between CLI registry, helper, public API and docs rather than choosing whichever matches the local snapshot.
4. Within authorized scope, update `src/capabilities.ts` (all snapshot families, `KNOWN_NON_ZDR_MODELS` included), `COMMAND_CODE_CLI_VERSION` in `src/adapter.ts`, focused tests and affected README/AGENTS evidence notes. Do not change runtime behavior merely because the header version changed. The ZDR list is a plain snapshot sync: `tests/zdr.test.ts` pins the expected membership, so a list edit updates that test deliberately — never delete an entry to make a diff disappear.
5. Preserve picker behavior: plan · active deal · Peak/Half · Image · context; omit irrelevant markers, never add “Text only”. Free models first, then plan tier, then name. `KNOWN_THINKING_MODELS` remains undisplayed. Named requests stay independent of picker filters.
6. For plugin changes run `npm run typecheck`, `npm test`, `npm run build`. For skill-only changes run the skill tests and a real fetch/audit; do not rebuild unrelated dirty plugin artifacts. Use `test:install` only if peer metadata changed.

Skill regression checks (from repository root):

```sh
python3 -m unittest discover -s .agents/skills/dsh-commandcode-upstream/tests -p 'test_*.py'
node --test .agents/skills/dsh-commandcode-upstream/tests/extract-cli.test.mjs
```

Finish with version comparison, verified categories, concrete changes/conflicts and remaining evidence limits. “No upstream changes” is appropriate only after required sources were successfully checked and manual reviews completed; do not confuse it with “no version bump”.
