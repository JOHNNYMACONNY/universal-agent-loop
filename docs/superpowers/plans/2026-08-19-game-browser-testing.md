# Game Browser Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implemented, review-repaired, and reconciled on `chatgpt/autonomous-dev-loop`.

**Goal:** Add a reusable autonomous browser-game QA skill and integrate it into the ChatGPT autonomous development loop without adding browser runtime dependencies to UAL.

**Architecture:** `game-browser-testing` is a bounded runtime-agnostic skill invoked by `autonomous-dev-loop` during interactive VERIFY/REVIEW. It defaults to autonomous exploratory QA, supports explicit scenarios, follows sense → act → verify, and returns structured findings/evidence to the outer loop. The remote browser/MCP/plugin implementation remains a separate deployable component.

**Tech Stack:** Agent Skills markdown, Node >=18, `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-19-game-browser-testing-design.md`

## Global Constraints

- V1 targets public/deployed browser games only.
- `protocol/` remains canonical and unchanged.
- UAL keeps zero runtime dependencies.
- The tester is a bounded capability and cannot terminate the outer development lifecycle.
- Autonomous exploratory QA is the default; explicit scenarios augment or constrain it.
- Use only browser capabilities actually available; never fabricate execution/evidence.
- Optional `window.__GAME_TEST__` instrumentation may strengthen evidence but must not replace black-box verification of user-visible behavior.
- Material browser findings route the outer loop through REPAIR → fresh VERIFY → REVIEW.
- No merge, deploy, credentials, billing, destructive external actions, or unrelated-site interaction without separate authority.

---

### Task 1: Conformance tests for the new skill

- [x] Add Agent Skills frontmatter and bounded-companion assertions.
- [x] Add autonomous-first and scenario-driven mode assertions.
- [x] Add sense → act → verify plus canvas/WebGL assertions.
- [x] Add optional `window.__GAME_TEST__` instrumentation assertions.
- [x] Add structured findings, materiality, deterministic session-status, safety, and capability-honesty assertions.
- [x] Add integration assertions against `autonomous-dev-loop`.
- [x] Preserve test-first repository ordering. Direct initial RED could not be witnessed because this ChatGPT harness cannot run the repo locally or inspect push-triggered Actions; that limitation was recorded rather than fabricated.

### Task 2: Implement bounded `game-browser-testing`

- [x] Add discovery-oriented frontmatter and bounded-role invariants.
- [x] Implement capability discovery and honest degradation.
- [x] Make autonomous exploratory QA the default with bounded high-value goal selection.
- [x] Add scenario mode, state reset guidance, and sense → act → verify.
- [x] Add canvas/WebGL and optional read-oriented instrumentation guidance.
- [x] Add structured findings with `severity`, `material`, reproduction/evidence/confidence.
- [x] Add deterministic `status`: PASS | FINDINGS | BLOCKED_CAPABILITY.
- [x] Define materiality so cosmetic preference cannot force repair loops.

### Task 3: Integrate with `autonomous-dev-loop`

- [x] Route interactive game/browser verification to `game-browser-testing` automatically when applicable.
- [x] Prefer native installation; otherwise load the canonical UAL copy from `JOHNNYMACONNY/universal-agent-loop/skills/game-browser-testing/SKILL.md` rather than trusting an arbitrary target repo fallback.
- [x] Interpret PASS as runtime evidence only, FINDINGS with material findings as REPAIR, and BLOCKED_CAPABILITY as a verification blocker/limitation.
- [x] Preserve evidence freshness: implementation mutation stales browser/runtime evidence.
- [x] Preserve honest degradation when browser-control is unavailable.

### Task 4: Documentation and repository reconciliation

- [x] Document `skills/game-browser-testing/` in README.
- [x] Document the skill and external-browser-runtime boundary in AGENTS.
- [x] Reconcile the accepted design with review-driven materiality/status/canonical-fallback decisions.
- [x] Reconcile this implementation plan so completed work does not look pending.

### Task 5: Independent review → repair loop

- [x] Review against repo standards (`AGENTS.md`) and the accepted design using the canonical Matt Pocock two-axis review method as the guide.
- [x] Repair PASS semantics so reproduced material bugs cannot coexist with PASS.
- [x] Repair test brittleness around evidence-freshness/materiality wording.
- [x] Repair companion-skill loading so it is portable across unrelated target repositories.
- [x] Define materiality separately from severity to prevent cosmetic repair loops.
- [x] Add deterministic PASS/FINDINGS/BLOCKED_CAPABILITY handling.
- [x] Re-review after each repair until no material standards/spec findings remained.

## Final Evidence

- Relevant fetched-branch conformance suites were mirrored and executed locally in this ChatGPT session: **21/21 PASS** (`autonomous-dev-loop` + `game-browser-testing`).
- The local mirror verifies the exact skill/test contract content fetched or written during this session; it is not a claim that the repository's complete `npm test` suite or GitHub Actions run was directly observed.
- Full push-triggered GitHub Actions evidence remains unavailable through the current connector because no PR was opened and the available workflow lookup is PR-oriented.
- No PR, merge, deploy, release, credential change, or production mutation was performed.
- Final review outcome: **0 unresolved material standards findings; 0 unresolved material spec findings.**
