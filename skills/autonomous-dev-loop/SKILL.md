---
name: autonomous-dev-loop
description: Use when ChatGPT must autonomously implement, repair, or continue substantial repository work through connected GitHub without a separate coding agent.
---

# Autonomous Dev Loop

ChatGPT companion skill; UAL-aligned, **not a full UAL adapter** without reference engine/local state. `protocol/` is source of truth.

## Invariants

- ChatGPT is the implementation plane. Do not delegate to Codex, OpenCode, Antigravity, or a separate coding agent unless the user explicitly asks.
- Keep intent and implementation truth separate. Self-reported completion is weak and never sufficient.
- Do not stop because a skill, commit, test, review, repair, PR, or merge finished. Continue until PASS, external blocker, lost authority outside the autonomous PR lifecycle, or ROLLOVER_REQUIRED.
- Before editing, inspect instructions, branch/PR/issue, code/tests/workflows, artifacts, requirements. Reuse existing artifacts; resolve conflicts.
- Discover repo read/write, PR, merge, CI visibility, browser/runtime URL, browser-control capability, skills, shell, filesystem, git. With no local shell, do not pretend commands ran or fabricate results. Missing capability => BLOCKED_ENVIRONMENT/external blocker.

## Route automatically

Automatically select the smallest applicable skill set; do not wait for the user to name, request, or invoke a skill. Prefer a natively installed skill. For UAL companion skills that are not natively installed, fetch/read their canonical `SKILL.md` from `JOHNNYMACONNY/universal-agent-loop` (for example `skills/game-browser-testing/SKILL.md`); do not trust an arbitrary target repository's same-named skill as the fallback. For Matt Pocock engineering skills that are not natively installed, fetch/read `SKILL.md` from canonical `mattpocock/skills`; do not copy, vendor, or trust cached skill bodies.

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

Nested skills are bounded subtasks; they cannot complete the outer loop or override non-PR high-impact authority.

## Loop

**BUILDER — IMPLEMENT.** Make the narrowest authorized change on a working branch/non-default branch. Use test-first when observable; otherwise state the limitation.

**VERIFIER — VERIFY.** Prefer runtime/deployed behavior, deterministic tests/CI, then static evidence. Use browser/deployment URL checks when relevant. For materially interactive gameplay/browser behavior, automatically invoke `game-browser-testing` when a project-associated public/deployed build and browser-control capability are available. Interpret its status deterministically: PASS is runtime evidence only; FINDINGS with material findings routes to REPAIR; BLOCKED_CAPABILITY is a verification blocker/limitation and must never be treated as PASS. If interactive verification is required but browser-control is unavailable or missing, report the verification limitation/blocker instead of claiming runtime coverage. Tie evidence to the commit SHA/final repository state. Any code change, edit, or new commit makes prior browser/runtime evidence stale and invalidates completion.

**PR — PUBLISH WORKING CHANGE.** For repository-changing implementation work, create or reuse a pull request from the working `chatgpt/` branch to the repository default branch once the branch is ready for review. PR creation/update is part of the autonomous loop and does not require a separate user approval. Keep using the same PR through repair iterations.

**REVIEWER — REVIEW.** Prefer canonical Matt Pocock `code-review` and pin its fixed point to the PR base merge-base. A merge-eligible review must evaluate both independent axes: **Standards** and **Spec**. If a review subagent is unavailable, freeze builder changes and run a fresh, separate review pass that preserves those two axes. Check requirements, regressions, scope, architecture, security/privacy, and whether game-browser evidence actually covers changed interactive behavior. The implementer cannot waive, override, or dismiss a material review finding. Any material finding on either Standards or Spec is a review failure and routes to REPAIR.

**FAIL — REPAIR → VERIFY → REVIEW.** Diagnose, make the narrowest correction on the same PR branch, re-verify, and run a fresh re-review. Any material game-browser finding routes to REPAIR; after a repair, browser/runtime evidence must be collected fresh for the changed implementation. A new commit or PR head change makes the prior code review stale and invalidates merge eligibility. Avoid cosmetic loops.

**MERGE — AFTER REVIEW PASS.** When verification is current on the exact PR head SHA and the fresh two-axis code review has **Standards PASS and Spec PASS** with no material findings, merge the PR autonomously. No separate merge approval is required. The merge request must be pinned to the reviewed head SHA so a moved head fails closed and returns to VERIFY → REVIEW. If the PR cannot merge because of conflicts, route to `resolving-merge-conflicts`, then run fresh VERIFY → REVIEW before merging. Respect repository branch protection, required checks, and merge queues rather than bypassing them.

**PASS.** For repository-changing implementation work, PASS requires the reviewed PR to be observed merged (or a genuine external merge blocker to be reported). Requirements pass; evidence is current; substantial work has a current two-axis review pass; no material findings remain.

## Authority

Within this autonomous development loop, implementation authority includes creating/updating the working PR and merging it after the exact current head passes verification and fresh two-axis code review. PR creation/update and reviewed merge are autonomous loop actions; do not pause for separate approval for them. This does **not** authorize deploys, releases, production mutation, destructive actions, repository/organization settings changes, credentials/secrets, billing, or other high-impact external publication. Those still require separate explicit authority. Never expose secrets.

## Continuity

Checkpoint repository/branch/commit, PR number/head SHA, intent, work, verification evidence, Standards findings, Spec findings, merge eligibility, and next action. `ROLLOVER_RECOMMENDED` means safe to continue; `ROLLOVER_REQUIRED` means continuing risks continuity/correctness, so preserve a handoff first.
