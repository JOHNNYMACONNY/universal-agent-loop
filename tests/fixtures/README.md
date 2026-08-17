# Test fixture conventions

Fixtures are generated programmatically by `tests/helpers.mjs` into
temporary git repositories (hermetic: no network, no real GitHub).

## Artifact conventions the engine discovers

- **Specs**: any markdown whose frontmatter has `ual_type: spec`, or whose
  path matches `spec`. Status via `status: draft|accepted|superseded`.
  Supersedure via `supersedes: [<id>]`. Conflict detection groups by
  `topic:`.
- **Tickets**: `ual_type: ticket` or path match `ticket|task`.
  `status: open|in-progress|done`. Checkbox items (`- [ ]` / `- [x]`)
  measure progress. `verification: [...]` lists evidence.
- **Wayfinder maps**: `ual_type: wayfinder_map`, `status: active|resolved`,
  `unresolved: [<decision ticket names>]`.
- **Handoffs**: files under `.agent-loop/handoffs/`, frontmatter per
  `protocol/handoff.md`; `head:`/`branch:` enable staleness checks.
- **State**: `.agent-loop/state.json` per `protocol/artifacts.md` §6.
- **Pull requests**: discovered through `gh`. Tests inject a fake via the
  `AGENT_LOOP_GH` env var (`installFakeGh` in helpers), so PR/CI scenarios
  stay hermetic.

## Why frontmatter

Frontmatter gives deterministic parsing. Heuristic filename matching is a
fallback for real repositories that do not declare `ual_type`. The
classification rules K1–K6 (protocol/artifacts.md) never rely on
timestamps.
