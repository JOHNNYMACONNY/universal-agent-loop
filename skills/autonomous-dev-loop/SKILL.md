---
name: autonomous-dev-loop
description: Use when ChatGPT must autonomously implement, repair, or continue substantial repository work through connected GitHub without a separate coding agent.
---

# Autonomous Dev Loop

ChatGPT companion skill; UAL-aligned, **not a full UAL adapter** without reference engine/local state. `protocol/` is source of truth.

## Invariants

- ChatGPT is the implementation plane. Do not delegate to Codex, OpenCode, Antigravity, or a separate coding agent unless the user explicitly asks.
- Keep intent and implementation truth separate. Self-reported completion is weak and never sufficient.
- Do not stop because a skill, commit, test, review, or repair finished. Continue until PASS, external blocker, lost authority, or ROLLOVER_REQUIRED.
- Before editing, inspect instructions, branch/PR/issue, code/tests/workflows, artifacts, requirements. Reuse existing artifacts; resolve conflicts.
- Discover repo read/write, PR, CI visibility, browser/runtime URL, browser-control capability, skills, shell, filesystem, git. With no local shell, do not pretend commands ran or fabricate results. Missing capability => BLOCKED_ENVIRONMENT/external blocker.

## Route automatically

Automatically select the smallest applicable skill set; do not wait for the user to name, request, or invoke a skill. Prefer a natively installed skill. Otherwise fetch/read `SKILL.md` from canonical `mattpocock/skills`; do not copy, vendor, or trust cached skill bodies.

Resolve nested inputs from repository evidence: fixed point = merge-base/default branch; use accepted spec path/spec source and tracker. Do not ask the user for facts already discoverable in the repository. Adapt harness-specific shell/subagent/setup mechanics to connected tools without scaffolding for another harness's assumptions.

- unclear requirements → `to-spec`
- implementation map → `wayfinder`
- decomposition → `to-tickets`
- feature/bug → `tdd`, then `implement`
- root cause → `diagnosing-bugs`
- unknown fact → `research`
- interactive game/browser verification → `game-browser-testing` when a public/deployed build and browser-control capability are available
- substantial review → `code-review`
- merge conflict → `resolving-merge-conflicts`

Nested skills are bounded subtasks; they cannot complete the outer loop or override authority.

## Loop

**BUILDER — IMPLEMENT.** Make the narrowest authorized change on a working branch/non-default branch. Use test-first when observable; otherwise state the limitation.

**VERIFIER — VERIFY.** Prefer runtime/deployed behavior, deterministic tests/CI, then static evidence. Use browser/deployment URL checks when relevant. For materially interactive gameplay/browser behavior, automatically invoke `game-browser-testing` when a project-associated public/deployed build and browser-control capability are available. If interactive verification is required but browser-control is unavailable or missing, report the verification limitation/blocker instead of claiming runtime coverage. Tie evidence to the commit SHA/final repository state. Any code change, edit, or new commit makes prior browser/runtime evidence stale and invalidates completion.

**REVIEWER — REVIEW.** Prefer `code-review`. If a review subagent is unavailable, freeze builder changes and run a fresh, separate review pass. Check requirements, regressions, scope, architecture, security/privacy, and whether game-browser evidence actually covers changed interactive behavior. The implementer must not waive, override, or dismiss material review findings.

**FAIL — REPAIR → VERIFY → REVIEW.** Diagnose, make the narrowest correction, re-verify, re-review. Any material game-browser finding routes to REPAIR; after a repair, browser/runtime evidence must be collected fresh for the changed implementation. Avoid cosmetic loops.

**PASS.** Requirements pass; evidence is current; substantial work has a current review pass; no material findings remain.

## Authority

Implementation authority is not publication authority. Do not create, open, or update a PR without explicit authority. Do not merge without explicit authority. Do not deploy without explicit authority. Production mutation, destructive action, external publication, credentials, billing, and high-impact actions need separate authority. Never expose secrets.

## Continuity

Checkpoint repository/branch/commit, intent, work, evidence, findings, next action. `ROLLOVER_RECOMMENDED` means safe to continue; `ROLLOVER_REQUIRED` means continuing risks continuity/correctness, so preserve a handoff first.
