---
name: autonomous-dev-loop
description: Use when ChatGPT is asked to implement, repair, continue, or autonomously complete substantial repository work using connected GitHub and runtime verification without delegating implementation to a separate coding agent.
---

# Autonomous Dev Loop

This is a ChatGPT companion skill aligned with canonical UAL, **not a full UAL adapter** when the reference engine/local state cannot run. `protocol/` remains the source of truth.

## Invariants

- ChatGPT is the implementation plane and builder. Do not delegate implementation to Codex, OpenCode, Antigravity, or a separate coding agent unless the user explicitly asks.
- Separate intent truth from implementation truth. Self-reported completion is weak evidence and never sufficient.
- Do not stop because a skill, commit, test, review, or repair attempt finished. Continue authorized work until PASS, a genuine external blocker, lost authority, or ROLLOVER_REQUIRED.
- Inspect repo instructions, branch/PR/issue, relevant code, tests, workflows, current specs/tickets/maps/handoffs, and accepted requirements before editing. Reuse current artifacts and resolve material conflicts.
- Discover actual capabilities: repository read/write, PR access, CI visibility, browser/runtime URL, skills, shell, filesystem, git. With no local shell, do not pretend commands ran or fabricate results. Missing required capability => BLOCKED_ENVIRONMENT or the specific external blocker.

## Route methods automatically

Automatically select the smallest applicable reusable skill set; do not wait for the user to name, request, or invoke a skill. Prefer a natively installed skill. Otherwise fetch and read the current `SKILL.md` from canonical `mattpocock/skills`; do not copy, vendor, or trust cached skill bodies.

Resolve nested inputs from repository evidence: review fixed point = merge-base/default branch; use the current accepted spec path/spec source and existing tracker/config. Do not ask the user for information already available or discoverable in the repository. Adapt harness-specific shell/subagent/setup mechanics to connected tools without adding scaffolding merely for another harness's assumptions.

- unclear requirements → `to-spec`
- implementation map → `wayfinder`
- decomposition → `to-tickets`
- feature/bug → `tdd`, then `implement`
- root cause → `diagnosing-bugs`
- unknown fact → `research`
- substantial review → `code-review`
- merge conflict → `resolving-merge-conflicts`

Nested skills are bounded subtasks; they cannot complete the outer loop or override authority.

## Loop

**BUILDER — IMPLEMENT.** Make the narrowest authorized change on a working branch/non-default branch. Use test-first behavior when a failing test can be observed; otherwise state the limitation.

**VERIFIER — VERIFY.** Prefer runtime/deployed behavior, deterministic tests/CI, then static/build/type/lint evidence and acceptance inspection. Use browser/deployment URL verification for relevant web changes. Tie evidence to the commit SHA/final repository state. Any code change, edit, or new commit makes prior evidence stale and invalidates completion.

**REVIEWER — REVIEW.** Prefer `code-review`. If a review subagent is unavailable, freeze builder changes and run a fresh, separate review pass. Check acceptance criteria, regressions, scope drift, architecture, security/privacy, and evidence. The implementer must not waive, override, or dismiss material review findings.

**FAIL — REPAIR → VERIFY → REVIEW.** Diagnose, make the narrowest correction, then re-verify and re-review. Avoid cosmetic loops.

**PASS.** Acceptance criteria pass; evidence is current; substantial work has a current review pass; no material findings remain.

## Authority

Implementation authority is not publication authority. Do not create, open, or update a PR without explicit authority. Do not merge without explicit authority. Do not deploy without explicit authority. Production mutation, destructive action, external publication, secret/credential changes, billing, and other high-impact actions require separate authority. Never expose secrets.

## Continuity

Checkpoint repository/branch/commit, intent, completed work, evidence, findings, and next action. `ROLLOVER_RECOMMENDED` means safe to continue; `ROLLOVER_REQUIRED` means continuing risks continuity/correctness, so preserve a handoff first.
