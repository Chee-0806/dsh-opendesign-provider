# dsh-opendesign-provider

English | [简体中文](README.zh-CN.md)

Unofficial [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) LLM provider for **Open
Design**. It registers the `open-design` provider route under the `llm-opendesign` plugin row, so one profile
can use Open Design models next to every other provider without route or namespace conflicts.

This project is a community integration. It is **not affiliated with or endorsed by Open Design /
Powerformer**, and your use of the Open Design service is governed by Open Design's own terms.

**Status: P0, the P1 quota surface and the P2 money-free analytics are in.** Chat Completions transport, live
model catalog, credential chain, settings page, the opt-in sidebar quota card with its dashboard, the
`/opendesign` command, and the model analytics read (tokens, speed, failures/retries, usage coverage,
cost/capability tiers — never an amount; ADR-0002) are all delivered.

## Install

```sh
# once the package is published
dsh plugin add @mars-sea/dsh-opendesign-provider

# or from a local build
npm ci
npm run build
npm pack
dsh plugin add ./mars-sea-dsh-opendesign-provider-0.1.0.tgz
```

Restart the app after installing. Then check:

- **Settings → Open Design** shows the page (connection, models and context, display, advanced).
- **Settings → Models** shows the Open Design card with the key state and the catalog source.
- **Settings → Model analytics** compares the Open Design models found in local history. It reads only the
  host's own session log, never the model plane, and reports tokens, first-token/total latency, failures,
  retries and usage coverage. The cost column is the catalog `low`/`medium`/`high` word; no dollar amount is
  shown or computed.

The bundle ships `lib/`, its `cordis.patch.yml` row and the `dsh.client` declaration. It only inserts its own
`llm-opendesign` row and never rewrites another provider's route, so it coexists with an already installed
Command Code plugin.

> The package has **no plugin icon** yet (the `icon` metadata field is intentionally absent). A brand asset
> must come from a design source; nothing is faked here.

## Identifiers

| Item | Value |
| --- | --- |
| Package | `@mars-sea/dsh-opendesign-provider` |
| Provider route | `open-design` |
| Display name | `Open Design` |
| Settings namespace / plugin row | `llm-opendesign` |
| Default credential reference | `OPEN_DESIGN_API_KEY` |
| Default API base | `https://amr-link.open-design.ai/v1` |
| Model catalog cache | `~/.opendesign/models-cache.json` |
| CLI login state (read-only) | `~/.amr/config.json` |
| Remote namespace | `opendesign` (`models`, `analytics`, `usage`) |
| Telemetry switches | `DSH_OPENDESIGN_TIMING`, `DSH_OPENDESIGN_TRACE` |

## Credentials

Resolution is one ordered pass; the first hit wins:

1. **Explicit key** — `config.apiKey` in the composition (secret role, redacted everywhere).
2. **Credential reference** — `config.apiKeyEnv`, default `OPEN_DESIGN_API_KEY`, resolved through the
   credentials seam (the Models page writes here) or the launching environment.
3. **CLI login state** — `~/.amr/config.json` → `profiles.prod.runtimeKey`, written by `vela login`. Used only
   when neither layer above has a value.

The gateway address follows the key's source: an explicit `config.apiBase` always wins; a key from the CLI
login state uses that state's server-issued `linkUrl` with `/v1` appended when the URL is a bare origin (the
live `linkUrl` is a host, e.g. `https://amr-link.open-design.ai`); everything else uses the default gateway.

The plugin **never writes** `~/.amr/config.json` and never prints a key. Settings and diagnostics only show the
reference name, whether it resolves and where the key came from. `profiles.prod.controlKey` is read by the
quota feature (read-only, never written back) and is not used for inference.

No browser login, no device-code flow, no account pool: Open Design is a single-key model.

## Models

The picker reads `GET {apiBase}/models` per key. When the gateway is unreachable, unauthorized or returns a
malformed body, the built-in 12-model snapshot is used and the catalog source is reported as `static`; the
settings page and model card show the provenance. The gateway may return more or fewer than 12 ids — only the
static fallback is fixed. A model outside the snapshot is still selectable, marked **uncalibrated**, with all
reasoning levels and no image capability.

| Model id | Display name | Context | Output | Cost | Capability | Input |
| --- | --- | --- | --- | --- | --- | --- |
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash (default) | 328K | 128000 | low | advanced | text, image |
| `glm-5.3-flash` | GLM-5.3 Flash | 232K | 32000 | low | advanced | text, image, video* |
| `glm-5.3-flashx` | GLM-5.3 Flash-X | 232K | 32000 | medium | advanced | text, image, file*, video* |
| `hy4-preview` | Hunyuan H4 Preview | 232K | 32000 | medium | advanced | text |
| `kimi-k2.7-code` | Kimi K2.7 Code | 262K | 65536 | medium | advanced | text, image |
| `mimo-v2.6-pro` | MiMo V2.6 Pro | 232K | 32000 | medium | advanced | text, image, audio*, video* |
| `deepseek-v4-pro` | DeepSeek V4 Pro | 328K | 128000 | high | advanced | text |
| `claude-haiku-5.5` | Claude Haiku 5.5 | 228K | 128000 | low | standard | text, image, file* |
| `gpt-6-luna` | GPT-6 Luna | 400K | 128000 | low | standard | text, image, file* |
| `mimo-v2.6-flash` | MiMo V2.6 Flash | 232K | 32000 | low | standard | text, image, audio*, video* |
| `deepseek-v4-flash` | DeepSeek V4 Flash | 232K | 32000 | medium | standard | text |
| `deepseek-v4-flash-vision-exp` | DeepSeek V4 Flash Vision Exp | 232K | 32000 | medium | standard | text, image |

\* The gateway advertises the modality, but this plugin only accepts **text and image**. File, audio and video
attachments are refused as `UNSUPPORTED_CONTENT` with the model's declared capability named.

Context is the gateway's `context_budget` (usable input), not the nominal `context_limit`. Kimi's 65536 output
budget is raised above its 32000 `output_budget` so its thinking levels fit. Cost and capability are tier
labels, **not** prices.

## Model analytics

**Settings → Model analytics** compares the Open Design models present in local history. It reads the host's
own session log through the optional `sessionQuery` service — never the model plane — and only when the user
presses **Read**; nothing is scanned at boot or polled in the background.

- Filters: the most recent 1–100 sessions that contain an Open Design request, or a local-calendar date range
  (start/end inclusive on screen, half-open `[from, to)` on the wire, at most 366 days).
- Columns: requests, total tokens, average first-token latency, average total duration, failure rate, retries,
  the catalog's cost tier (`low`/`medium`/`high`) and capability tier (`standard`/`advanced`).
- Missing data stays missing: a request whose adapter reported no usage counts as a request but contributes no
  tokens, and a model absent from the current catalog shows `unknown` tiers instead of a made-up value.
- The scan is bounded (100 candidate sessions, 200 000 own events) and reports truncation. A forked session
  counts only its own events, so branch inheritance never double-counts an ancestor's requests.
- A profile without a session-query service shows "unavailable" with the reason; conversations are unaffected.

There is **no money dimension**: no price table, no dollar amount and no `≈` estimate. ADR-0002 keeps this
deliberate — use the Open Design control plane for billing.

## Reasoning levels

| Models | Selectable levels | Notes |
| --- | --- | --- |
| Nine full-domain models (`claude-haiku-5.5`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `deepseek-v4-pro`, `deepseek-v4.1-flash`, `gpt-6-luna`, `hy4-preview`, `mimo-v2.6-flash`, `mimo-v2.6-pro`) | `off` … `max` | `off` sends the literal `none` (omitting the field still thinks) |
| `glm-5.3-flash`, `glm-5.3-flashx` | `low`, `high`, `max` | lighter levels fold to `low`, `xhigh` folds to `max`; `off` becomes `low` and the UI says the model cannot disable thinking |
| `kimi-k2.7-code` | `minimal`, `low`, `medium`, `high`, `xhigh` | no `off`, no `max`; `max_completion_tokens` is raised above the level's thinking budget |

`gpt-6-luna` and `claude-haiku-5.5` do not emit reasoning on the Chat Completions face at all. They are marked
**thinking not visible**; a missing reasoning block does not mean the model did not think.

## Output cap and hard truncation

Each request sends exactly one cap field, `max_completion_tokens` (never `max_tokens`, which no model honors).
The value is `min(host budget, model output budget, 262144)`, raised to the selected thinking level's floor
when the model requires one (kimi). Setting `0` means "no host budget" rather than "omit the field".

Because deepseek and glm demonstrably ignore the field, the adapter counts output itself — including reasoning
tokens — and stops reading at the cap, ending the reply with `max-tokens` while keeping what was received. A
16-token cap on deepseek therefore really stops at ~16 tokens even though the upstream would have sent hundreds.

## Errors

Every failure is one stable code plus text that says what to do. Deterministic failures are never retried.

| Code | Meaning | Next step |
| --- | --- | --- |
| `MISSING_CREDENTIAL` | No key on any of the three layers | Paste a key in Settings → Open Design, export `OPEN_DESIGN_API_KEY`, or run `vela login` |
| `AUTH` | 401/403: key rejected, or no permission for that model | Re-check or rebuild the key at <https://open-design.ai/cloud/api-keys>, check workspace permissions |
| `QUOTA_EXHAUSTED` | 402: Design Plan quota or balance exhausted | Check quota in the console, top up, or switch to BYOK |
| `BAD_REQUEST` | 400, and 502-wrapped deterministic 400: the request itself is refused; the real reason is quoted, including `request_id` | Fix the model / role / message / cap; retrying cannot help |
| `PROTOCOL_ERROR` | 404 text/HTML (wrong `apiBase`), non-SSE 200, missing body | Check `apiBase` points at the gateway's `/v1` and that no proxy rewrites the stream |
| `RATE_LIMIT` | 429; honors `Retry-After` when present | Wait, then reduce concurrency |
| `TRANSIENT` | 5xx without a deterministic reason | Retried automatically (bounded) |
| `TRANSPORT` | Connection-level failure (DNS, TLS, reset) | Retried within a bounded budget; the message names the budget |
| `TIMEOUT` | First byte or stream idle timeout | Retry, or raise the timeout in Settings → Open Design |
| `EMPTY_RESPONSE` | HTTP 200 with no text, thinking or tool call | Retried automatically; try another model if it persists |
| `UNSUPPORTED_CONTENT` | File/audio/video attachment, or an image on a text-only model | Send text/image only, or pick a vision model |
| `UNSUPPORTED_OPTION` | An option this route cannot express (e.g. `logprobs`) | Remove the option |

404 is split by body shape: JSON `model_not_found` means a bad model id → `BAD_REQUEST`; plain text or HTML
means a bad path → `PROTOCOL_ERROR`.

## Quota panel and `/opendesign`

The sidebar card, its dashboard and the `/opendesign` text board all read the control plane with the CLI login
state's `controlKey`. The card is **opt-in**: Settings → Open Design → Display → "Sidebar quota card", off by
default. When on, it shows the plan tier and the 7-day window (Go also shows the 5-hour window); clicking it
opens a dashboard with both windows, reset times, the wallet balance and the billing order ("Design Plan
credits first, then plan credits, then the wallet"). A stale reading keeps its last value and is marked
"Stale".

Without a control key nothing is rendered and nothing is refreshed — the settings page says "inference works,
quota is unavailable". Inference is never gated on quota. The card refreshes on open, at most once every five
minutes, and on demand from the dashboard's Refresh button.

## Settings page

- **Connection**: API key (write/clear through the credential reference), `apiBase`, CLI login state status.
- **Models and context**: visible models, per-model context overrides, global output cap.
- **Display**: language, sidebar quota card (off by default).
- **Advanced**: request timeout, stream idle timeout, transport retries, catalog cache path, copy a redacted
  effective-configuration diagnostic.

Writes follow the host's settings-write lifecycle: one draft, one batched revision-fenced mutate, credentials
confirmed separately, conflicts keep the draft.

## Known limitations

- **No invented USD amounts.** Cost is a tier label; the quota panel shows credit windows and the wallet
  balance the control plane reports, never a derived invoice.
- **No browser/device login, no account pool, no ZDR, no web search, no plan filtering.** They have no Open
  Design equivalent.
- **Single credential.** The last resolved key serves the profile; no rotation.
- **Thinking visibility depends on the transport.** On the Chat face `gpt-6-luna` and `claude-haiku-5.5`
  emit no reasoning. `config.protocol: auto` (the default) routes `claude-haiku-5.5` over the optional
  Messages transport, where its thinking is readable once an explicit thinking budget is requested; the
  gateway only returns `redacted_thinking` (encrypted) for `gpt-6-luna` there, so readable reasoning for it
  exists only on the Responses API, which this plugin does not implement.
- **File/audio/video input is refused** even when the gateway advertises the modality.
- **No plugin icon** yet.
- **No TUI settings page**; the settings page is the web UI. (P2 if needed.)
- **Chat Completions is the default transport**; the optional Anthropic Messages transport
  (`config.protocol: chat | messages | auto`) covers the thinking-hidden models and falls back to Chat once
  if the gateway does not serve it. The Responses API is out of scope (ADR-0001).
- `temperature`, `stop`, `logprobs` and `store` are not sent. `developer` messages are downgraded to `system`
  because glm rejects the role.
- **429 / `Retry-After` is implemented but not observed live** (the probes never triggered a limit), and there
  are no `x-ratelimit-*` headers to lean on.
- **Settings-page interaction is verified by tests and by a real-profile install**; the browser pass is the
  maintainer's restart step after installing the packed tarball (the bundle layer loads at boot).

## Verify

```sh
npm run typecheck
npm test
npm run build && git diff --exit-code -- lib/
npm run test:pack
npm run test:engine     # loads the built bundle on both declared engines
npm run test:install    # pnpm isolated install of the packed tarball
npm run test:live       # real key: nine P0 cases, PASS/FAIL/SKIP
```

`npm run test:live` reads the key from `OPEN_DESIGN_API_KEY` or `~/.amr/config.json` and never prints or stores
it; it uses a throw-away catalog cache. Exit codes: `0` no capability failure, `1` a capability failure,
`2` no usable credential (every live case skipped). `--case N` runs one case, `--list` lists them.

See [docs/opendesign/02-P0验收记录.md](docs/opendesign/02-P0验收记录.md) for the recorded acceptance run.

## Rollback

There is no data migration and no background work: the bundle is plain JS plus one settings section.

1. Remove the package with the same mechanism used to install it: `dsh plugin remove
   @mars-sea/dsh-opendesign-provider`, or delete the `llm-opendesign` row from the profile's plugin
   configuration / `node_modules`.
2. Restart the app. The provider route, model card and settings page disappear.
3. Optional cleanup: delete the `llm-opendesign` section from the profile's `settings.yaml`, and delete
   `~/.opendesign/models-cache.json`.
4. `~/.amr/config.json` is never touched, so the CLI login state survives a rollback.

Removing this bundle does not affect an installed Command Code plugin.

## Documentation

- Design and staged plan: [docs/opendesign/00-改造设计.md](docs/opendesign/00-改造设计.md)
- Specification: [docs/opendesign/03-spec.md](docs/opendesign/03-spec.md)
- P0 acceptance record: [docs/opendesign/02-P0验收记录.md](docs/opendesign/02-P0验收记录.md)
- Decisions: [docs/adr/](docs/adr/)
- Terminology: [GLOSSARY.md](GLOSSARY.md) section 7
- Archived previous-provider history (read-only): [docs/legacy-commandcode/](docs/legacy-commandcode/)

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the upstream scaffold attribution and the Open Design
non-affiliation statement.
