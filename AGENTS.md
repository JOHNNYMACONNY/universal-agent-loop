# AGENTS.md — universal-agent-loop

Canonical harness-neutral agent orchestration protocol (UAL) + reference
engine + harness adapters + capability-honest companion skills.

## Layout

- `protocol/` — canonical specification. Source of truth. Changes here
  change semantics; update engine/adapters to match, never the reverse.
- `src/` — dependency-free Node (ESM) reference engine. Deterministic
  parts only; judgment belongs to the calling agent.
- `bin/agent-loop.js` — CLI: capabilities, scan, plan, state, authority,
  handoff.
- `adapters/opencode/` — OpenCode global skill + install.sh.
- `skills/autonomous-dev-loop/` — ChatGPT companion control-plane skill for
  connected GitHub/CI/runtime execution without a separate coding agent.
  It is UAL-aligned but not a full adapter when the UAL engine cannot run.
- `skills/game-browser-testing/` — bounded autonomous browser-game QA skill
  for public/deployed builds. It consumes whatever browser-control capability
  the active harness actually exposes and returns evidence/findings to its
  caller; it does not own lifecycle completion.
- `tests/` — node:test fixture suites (required cases + adversarial + skill
  conformance).

## Commands

- Test: `npm test` (Node >= 18, zero dependencies).
- Run engine: `node bin/agent-loop.js <command>` (see `--help`).
- Install OpenCode adapter: `adapters/opencode/install.sh`.

## Rules

- No runtime dependencies. No timestamps-based classification. No repo
  mutation from engine code paths except explicit `state`/`handoff`
  writes into `.agent-loop/`.
- `protocol/` remains canonical. Companion skills may reuse invariants but
  must not fork lifecycle semantics or claim capabilities they do not have.
- Do not embed browser infrastructure (remote browser service, Playwright,
  MCP server, browser daemon) into the canonical protocol/reference engine.
  Browser QA skills describe behavior and capability contracts; the callable
  runtime is supplied externally by the harness/plugin environment.
- Game browser QA defaults to autonomous exploratory testing, may accept
  explicit scenarios, and must treat material findings as evidence for the
  outer orchestrator rather than declaring implementation completion.
- Tests are hermetic: temp git repos, fake `gh` via `AGENT_LOOP_GH`, plus
  deterministic static checks for skill contracts.
- No secrets anywhere. Use synthetic placeholders.
