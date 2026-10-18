---
name: dsh-release-upgrade
description: Audit and upgrade this plugin against an official DeepSeek Harness (dsh) release. Use when a new dsh tag/release is published, when peer ranges or dsh compatibility records need changing, or when a release may affect plugin services, client slots, settings, tools, or the LLM adapter. This skill is for DSH itself; use dsh-commandcode-upstream for Command Code CLI/catalog changes.
---

# DSH release upgrade audit

Use this skill for an **official DeepSeek Harness release**, not for the Command Code provider's own CLI/catalog. The target is usually a GitHub tag such as `dsh-v0.1.7-rc.2`; the baseline is the currently supported release in the same RC or alpha channel, chosen explicitly from this repository's `package.json`.

## Scope and safety

- A check is read-only with respect to plugin files. The collector only clones public source into the requested output directory and reads public GitHub release metadata.
- Do not edit plugin files, change peer ranges, publish, or commit until the evidence has been reviewed and the user has authorized the update. Once authorized, keep the exact-engine rule below.
- Never treat a successful clone or a local `node_modules` test as proof of engine compatibility. The real proof is `npm run test:engine` against the target engine.
- Do not run authenticated generation, paid probes, or credential-file scans as part of this skill.

## Collect the release delta

From the repository root:

```sh
python3 .agents/skills/dsh-release-upgrade/scripts/collect.py \
  --baseline dsh-v0.2.0-rc.2 \
  --target 'dsh-v<new-version>' \
  --out /tmp/dsh-release-audit-YYYYMMDD-XXXX
```

Always pass `--baseline <tag>` naming a release the current `package.json` still declares. Choose it by the channel the current declarations show — RC replaces RC, alpha replaces alpha — and when the manifest holds a single release, that release is the baseline. Naming it explicitly keeps the comparison auditable and keeps the same invocation working if the manifest grows back to two releases; the collector's implicit baseline applies only to a single-release manifest and it rejects an ambiguous multi-release one. When the previously verified release is no longer declared (for example a channel was dropped), collect a second delta from that last verified tag to isolate what this round actually changed. Add `--repo https://github.com/deepseek-ai/deepseek-harness` only when auditing a fork or mirror.

The output contains:

- `release.json` and `manifest.json`: target release metadata, tag SHAs, request URL, and collection errors;
- `changed-files.txt` and `diff.txt`: the complete public source delta;
- `package-delta.json`: changed published package manifests, versions, dependencies, and peer ranges;
- `imports.json`: package specifiers imported by this plugin's `src/` files;
- `report.txt`: changed packages and high-risk paths grouped for review;
- `source-baseline/` and `source-target/`: shallow public checkouts for manual inspection.

If the script exits 2 or records an error, the evidence is incomplete. Do not report “no breaking changes”; fix collection or obtain the missing source/tag first.

## Review checklist

1. **Engine identity and packaging.** Compare the target's `@deepseek-ai/dsh-*` package versions with every peer and development range, `dsh.compatibility.dsh`, `engines.dsh`, and the `dshReleases` records. **The maintenance policy is one verified engine per channel, and a channel with no newly verified release leaves the matrix instead of keeping a stale entry — so the matrix is currently a single release (`0.2.1-rc.2`).** Replace the previous version in the same channel after verification and never accumulate historical branches. Keep every entry an exact bare version and update all four declarations plus the lock together. Keep `@deepseek-ai/cordis` and `@deepseek-ai/schemastery` paired with the retained engine — a disjunction only while several engines are declared, a single `~` branch each when the matrix holds one (`~4.0.5` / `~3.18.5` today), never a caret. Keep `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-slots`, and `react` optional only while they are the client-seeded modules, and keep each optional peer in `devDependencies`.
2. **Host API/link surface.** Review changed files under `packages/llm/llm`, `packages/settings`, `packages/credentials`, `packages/commands`, `packages/web`, `packages/interaction`, `packages/tools`, and `packages/typert`. Compare every static named import in `lib/index.js` with the target engine's exports. `npm run test:engine` is mandatory after any peer bump because a missing named export is an ESM link-time failure.
3. **Client graph and slots.** Compare `src/client/index.ts`, `tsdown.config.ts`, the `dsh.client` manifest block, and the target Web shell's seed table. Check `settings.section`, `settings.models.provider-card`, `main`, `sidebar.footer.action`, and `conversation.composer.dock` declarations. The manifest `dsh.client.inject` list is a module graph, not the exported Cordis service list. The browser plugin's exported `inject` is intentionally only `slots`, `locale`, and `remote`; never add nested `remote.settings`, `remote.credentials`, or `remote.commandcode` services to it. Capture nested Remote namespaces through their own inject-scoped contexts.
4. **Settings.** Verify the rc.2 `SettingsForms`/`loader/volatile-update` contract: every Config field except the composition-only `apiKey` secret must be volatile, a settings write must be able to reach the running fiber, and the settings entry id must remain `llm-commandcode` so the one-time settings import cannot strand a section.
5. **LLM adapter and tools.** Diff `GenerateOptions`, `RequestMessage`, `ContentBlock`, `LlmError`, and model capability types. Exercise real engine constructors in `npm run test:engine`; a structural fake is insufficient. If the target adds dynamic tool updates, only advertise `toolUpdate` when the adapter can honor the selected mode. `addition-only` is valid when every request sends the complete active tool list and the adapter can safely ignore or encode `tool-addition` developer messages; do not claim `in-history` unless removal/update blocks are actually represented on the provider wire.
6. **Approval.** This plugin no longer answers approval requests — the opt-in AI command guard and its System One decision endpoint were removed, so the `approval` seam is not injected at all. Diff `approval/request` / `tools/pre-execute` only to confirm the plugin still stays out of that path, and confirm no reintroduced auto-approval answerer sneaks back in without an explicit, documented decision.
7. **Optional seams and persistence.** Recheck web-search registration/selection, TUI settings' structural seam, cost/session projections, image-offload contract, and any newly introduced schedule/account services. Optional features must not become hard client/host gates merely because the new engine ships them. **A selection or other mutable field that became a `Volatile` config reference must be written through the settings path** (the loader commits it in place), not by assigning an instance field: `0.2.1-rc.2` deleted `WebRuntime`'s private `searchProviderId`/`fetchProviderId`, and the previous field write kept succeeding while selecting nothing. Check `Volatile`-typed fields on every optional service, and remember that a shipped settings card may write the same field, so a runtime selector has to coordinate with that writer rather than assume it owns the value. A newly added adapter hook (for example `imageRequestTarget`) ships a default implementation; overriding it is required only when the adapter's own projection differs from that default.
8. **Build and published surface.** Run, in order: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:engine`, and `npm run test:install` when peer metadata changed. Inspect the built client `require()` calls against the target Web shell's static seed table.

## Applying an authorized update

- Verify the official npm dist-tags and GitHub release records. Update the exact engine declarations and the package lock together, replacing the release in the channel that the current `package.json` shows. Run the engine and isolated-install matrices over the retained release set — one engine after this round's collapse to a single RC, and every retained release whenever the matrix holds more; local checks must use a development tree admitted by the new range. Keep Cordis and Schemastery paired with their engine release rather than guessing versions from the channel name.
- Adapt only changes proven necessary by the collected source delta and tests. Preserve the existing plugin architecture and security boundaries; do not add a second settings implementation, a new credential path, or a hard dependency for an optional service.
- Add focused tests for every changed contract. For a new engine capability, prefer a real `test:engine` fixture over a fake-only test.
- Update both READMEs and `CHANGELOG.md` when the supported engine or user-visible behavior changes. Bump the plugin version only as part of the authorized release work; do not publish automatically.
- Re-run the collector after the edit when a future DSH release is the next comparison baseline. The skill is intentionally repeatable: a new invocation with a new target is the whole upgrade audit.

## Reporting

The final report must include: baseline→target tags and SHAs, changed official packages, breaking API/type/event/slot findings, implemented changes, tests run with exit codes, features deliberately not adopted and why, and any evidence still missing. Distinguish “no observed break” from “fully proven compatible”.
