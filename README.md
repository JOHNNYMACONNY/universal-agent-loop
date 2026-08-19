# Universal Agent Loop (UAL)

A portable, project-agnostic orchestration protocol for coding agents.

UAL separates the **canonical protocol** (this repository) from **harness
adapters** (thin per-harness integrations):

```text
Canonical Universal Protocol          (protocol/)
          |
          v
Harness Adapter Contract              (protocol/adapter-contract.md)
          |
          +-- OpenCode adapter        (adapters/opencode/)
          +-- Codex adapter           [future]
          +-- Antigravity adapter     [future]
```

The protocol owns the lifecycle. Skills, subagents, models, trackers, and
harness-native commands perform bounded subtasks inside the lifecycle. They
never own or terminate it.

## Contents

- `protocol/` — the canonical specification. Harness-neutral. Read these in
  order: `lifecycle.md`, `artifacts.md`, `truth-model.md`, `authority.md`,
  `capabilities.md`, `handoff.md`, `adapter-contract.md`.
- `src/`, `bin/agent-loop.js` — the reference engine: a dependency-free
  Node.js CLI that performs the deterministic parts of the protocol
  (repository scan, artifact reconciliation, lifecycle entry resolution,
  authority gating, durable state, handoff validation, capability report).
- `adapters/opencode/` — the OpenCode global skill implementing the adapter
  contract, plus its installer.
- `skills/autonomous-dev-loop/` — a UAL-aligned ChatGPT companion skill for
  autonomous implementation/review loops using connected GitHub, CI, and
  runtime/browser evidence without a separate coding agent. It is **not** a
  full UAL harness adapter when ChatGPT cannot execute the reference engine
  or persist local UAL state.
- `tests/` — fixture-driven tests over normal and adversarial repository
  states plus static skill-conformance tests. Run with `npm test` (Node >= 18,
  zero dependencies).

## Design rules

- The protocol documents are the source of truth. The engine and adapters
  implement them; they do not redefine them.
- Companion skills may reuse UAL invariants but must state capability
  limitations explicitly rather than claiming adapter parity.
- Deterministic parsing and state transitions live in the engine. Judgment
  calls (task scope, architecture decisions, critic review) belong to the
  agent and are passed into the engine as explicit inputs.
- Smallest durable footprint: the engine writes `.agent-loop/` only when
  durable state is actually required, and stores references to existing
  project artifacts instead of copying them.
- No secrets in source, tests, fixtures, commits, or reports.

## Quick start

```bash
# From any repository, with this repo on disk:
node /path/to/universal-agent-loop/bin/agent-loop.js capabilities
node /path/to/universal-agent-loop/bin/agent-loop.js scan
node /path/to/universal-agent-loop/bin/agent-loop.js plan \
  --task-profile '{"scope":"substantial","clarity":"ambiguous","summary":"..."}'
```

OpenCode users: see `adapters/opencode/install.sh` to install the global
skill. It does not modify `opencode.json` or any existing skill.

ChatGPT users: `skills/autonomous-dev-loop/SKILL.md` is the companion
control-plane skill. It should automatically route reusable engineering
skills, implement through connected GitHub, verify through observable
CI/runtime evidence, and repair/re-review until material gates pass or a real
external blocker is reached.

## Authority

The engine never pushes, opens PRs, merges, deploys, or touches credentials
unless that authority was explicitly granted and recorded. Companion skills
preserve the same separation of implementation authority from merge, deploy,
production mutation, destructive action, and credential authority. See
`protocol/authority.md`.
