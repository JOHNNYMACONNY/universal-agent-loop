# AGENTS.md — universal-agent-loop

Canonical harness-neutral agent orchestration protocol (UAL) + reference
engine + harness adapters.

## Layout

- `protocol/` — canonical specification. Source of truth. Changes here
  change semantics; update engine/adapters to match, never the reverse.
- `src/` — dependency-free Node (ESM) reference engine. Deterministic
  parts only; judgment belongs to the calling agent.
- `bin/agent-loop.js` — CLI: capabilities, scan, plan, state, authority,
  handoff.
- `adapters/opencode/` — OpenCode global skill + install.sh.
- `tests/` — node:test fixture suites (required cases + adversarial).

## Commands

- Test: `npm test` (Node >= 18, zero dependencies).
- Run engine: `node bin/agent-loop.js <command>` (see `--help`).
- Install OpenCode adapter: `adapters/opencode/install.sh`.

## Rules

- No runtime dependencies. No timestamps-based classification. No repo
  mutation from engine code paths except explicit `state`/`handoff`
  writes into `.agent-loop/`.
- Tests are hermetic: temp git repos, fake `gh` via `AGENT_LOOP_GH`.
- No secrets anywhere. Use synthetic placeholders.
