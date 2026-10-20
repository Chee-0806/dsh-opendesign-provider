# AGENTS.md

Instructions for AI coding agents working in this repository. Read the references relevant to the task,
including more than one when work spans subsystems; do not load the whole reference set by default. Confirm
mutable facts against current source, tests, and upstream evidence.

## Project

This is the unofficial `@mars-sea/dsh-opendesign-provider` bundle for DeepSeek Harness. It registers the
`open-design` LLM route through `llm-opendesign` and ships `lib/`, `dsh.bundle` metadata, and
`cordis.patch.yml`.

The repository was forked from the previous provider scaffold and is being converted in place. The design,
task tickets and fact baseline live in [docs/opendesign/](docs/opendesign/); the previous provider's
documentation and upstream-audit skill are archived under [docs/legacy-commandcode/](docs/legacy-commandcode/)
as historical evidence and must not be extended.

## Boundaries for every task

- Preserve unrelated tracked and untracked worktree changes. Keep changes focused on the request.
- Do not commit, tag, push, publish, or create a GitHub Release unless the user explicitly asks.
- Never print, log or commit a literal API key. Settings surfaces write through the credentials seam;
  diagnostics name the reference and its presence only.
- Preserve the public exports from `src/index.ts` (`name`, `inject`, `Config`, `apply`) and the `dsh.bundle`
  manifest shape used by the Harness loader.
- Treat version counts, upstream behavior and historical diagnoses in archived documents as evidence to
  verify against current source, tests and upstream facts when relevant.
- Do not reintroduce the previous provider's browser login, account pool, enrollment, web search, ZDR,
  plan-tier pricing or the previous provider's slash command.

## References

- Product identity, provider/settings/Remote names: `src/identity.ts` and `GLOSSARY.md` section 7.
- Architecture, deletion list and staged plan: [docs/opendesign/00-改造设计.md](docs/opendesign/00-改造设计.md)
  and [docs/opendesign/03-spec.md](docs/opendesign/03-spec.md).
- Non-obvious decisions: [docs/adr/](docs/adr/) (single Chat Completions transport, no money display,
  reading the Open Design CLI login state as a credential fallback).
- Local issue tracker and spec conventions: [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).
- Archived previous-provider evidence (read-only): [docs/legacy-commandcode/](docs/legacy-commandcode/).

## Verification

- For source changes, run `npm run typecheck`, `npm test`, and `npm run build`; `lib/` is committed only
  from the final acceptance ticket, so check `git diff -- lib/` rather than committing a local rebuild.
- Run `npm run test:engine` when a Harness peer range, engine version, or engine-facing contract changes,
  and before publishing. Run `npm run test:install` after DSH peer metadata changes.
- `npm run test:pack` checks the published entrypoints listed in `package.json`.
- For documentation-only changes, check links, references and instruction consistency; a full code test
  suite is unnecessary unless the documentation change exposes a code-contract concern.
- Report tests that could not run and distinguish local checks from authenticated, deployed, or
  live-provider validation.

## Agent skills

### Issue tracker

issue 与 spec 以本地 markdown 存放在 `.scratch/<feature-slug>/`（GitHub Issues 已关闭，`.scratch/` 不入库）。见
`docs/agents/issue-tracker.md`。

### Triage labels

默认五个 triage 角色名即标签名（`needs-triage` / `needs-info` / `ready-for-agent` /
`ready-for-human` / `wontfix`），写在票文件顶部 `Status:` 行。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（single-context）：仓库根 `GLOSSARY.md` + `docs/adr/`。见 `docs/agents/domain.md`。
