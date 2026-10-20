# dsh-opendesign-provider

Unofficial [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) LLM provider plugin for
**Open Design**. It registers the `open-design` route under the `llm-opendesign` plugin row, so a profile can
load Open Design models next to other providers without route or namespace conflicts.

> **Status: ticket-01 pre-refactor skeleton.** The plugin loads, registers its provider and adapter, and
> keeps the settings namespace; the Chat Completions transport, live model catalog, settings page and
> Design Plan quota panel land in the tickets listed under [docs/opendesign/](docs/opendesign/). Until
> ticket 02 a request fails loudly with `NOT_IMPLEMENTED` rather than returning an empty reply.

## Install

```sh
dsh plugin add @mars-sea/dsh-opendesign-provider
```

The package ships `lib/`, its `dsh.bundle` patch and the `dsh.client` declaration. `npm pack` output can be
installed into a desktop profile like any other bundle.

## Configuration

The bundle patch inserts one row and reads a single credential reference:

```yaml
- id: llm-opendesign
  name: "@mars-sea/dsh-opendesign-provider"
  config:
    apiKeyEnv: OPEN_DESIGN_API_KEY
```

Resolve the key by storing `OPEN_DESIGN_API_KEY` through the credentials seam (the Models page does this),
exporting it in the launching environment, or setting the composition-only `config.apiKey`. Open Design keys
are created at <https://open-design.ai/cloud/api-keys>. The CLI login state (`vela login`) joins the credential
chain in ticket 08.

| Identity | Value |
| --- | --- |
| Provider route | `open-design` |
| Display name | `Open Design` |
| Settings namespace / plugin row | `llm-opendesign` |
| Default credential reference | `OPEN_DESIGN_API_KEY` |
| Default API base | `https://amr-link.open-design.ai/v1` |
| Model cache | `~/.opendesign/models-cache.json` |
| Remote namespace / service | `opendesign` / `opendesignUsage` |

## Documentation

- Design and staged plan: [docs/opendesign/00-改造设计.md](docs/opendesign/00-改造设计.md)
- Specification and acceptance seams: [docs/opendesign/03-spec.md](docs/opendesign/03-spec.md)
- Decisions: [docs/adr/](docs/adr/)
- Terminology: [GLOSSARY.md](GLOSSARY.md) section 7
- Archived previous-provider history (read-only): [docs/legacy-commandcode/](docs/legacy-commandcode/)

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:engine
npm run test:pack
```

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the upstream scaffold attribution.
