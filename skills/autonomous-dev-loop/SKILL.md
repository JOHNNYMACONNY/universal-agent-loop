---
name: autonomous-dev-loop
description: Use when ChatGPT is asked to implement, repair, continue, or autonomously complete substantial repository work using connected GitHub and runtime verification without delegating implementation to a separate coding agent.
---

# Autonomous Dev Loop

## Purpose

This is a ChatGPT companion skill aligned with canonical UAL. It is **not a full UAL adapter** when ChatGPT cannot execute the reference engine or persist local UAL state. `protocol/` remains the source of truth for UAL semantics; this skill must not invent conflicting lifecycle rules.

## Core rule

Keep intent truth separate from implementation truth. Self-reported completion is weak evidence and never sufficient by itself. Prefer runtime/deployed behavior, current repository state, deterministic tests/CI, then critical review.

Do not stop because a skill, commit, test, review, or repair attempt finished. Continue authorized work until PASS, a genuine external blocker, lost authority, or ROLLOVER_REQUIRED.

## Start by orienting

Inspect the current repository, branch/PR/issue, repo instructions, relevant source, tests/workflows, existing specs/tickets/maps/handoffs, and accepted requirements. Reuse current artifacts instead of recreating them. Resolve material conflicts between intent and implementation before advancing.

Discover actual capabilities: repository read/write, issue/PR access, CI visibility, browser/runtime URL access, reusable skills, shell, filesystem, and git. If a required capability is missing, report BLOCKED_ENVIRONMENT or the specific external blocker. With no local shell, do not pretend commands ran or fabricate test results; use GitHub, CI, and runtime evidence that can actually be observed.

## Route methods automatically

Automatically select the smallest applicable reusable skill set. Do not wait for the user to name, request, or invoke a skill.

- unclear requirements → `to-spec`
- implementation map needed → `wayfinder`
- decomposition/tracker work → `to-tickets`
- feature or bug implementation → `tdd`, then `implement`
- root-cause work → `diagnosing-bugs`
- unknown technical facts → `research`
- substantial completed work → `code-review`
- merge conflicts → `resolving-merge-conflicts`

Nested skills are bounded subtasks. They cannot declare the outer loop complete or override authority.

## Execute the loop

**BUILDER — IMPLEMENT.** Make the narrowest authorized change on a working branch or non-default branch. Use test-first behavior when a meaningful failing test can be observed. If shell execution is unavailable, prefer observable CI or another deterministic runner; otherwise state the verification limitation instead of claiming a witnessed RED/GREEN cycle.

**VERIFIER — VERIFY.** Evaluate the implementation using the highest available evidence: runtime/deployed behavior, deterministic tests/CI, static/build/type/lint evidence, then acceptance-criteria inspection. For user-visible web changes, use browser or deployment URL verification when available. Tie evidence to the commit SHA or final repository state it verifies. A code change, edit, or new commit makes prior implementation evidence stale and invalidates completion until re-verified.

**REVIEWER — REVIEW.** Perform a distinct critical pass after verification. Prefer `code-review` for substantial work. Check acceptance criteria, missing cases, regressions, scope drift, architecture, security/privacy where relevant, and evidence sufficiency. The implementer must not waive, override, or dismiss material review findings.

**FAIL — REPAIR → VERIFY → REVIEW.** Any material test failure, runtime/browser defect, or review finding enters REPAIR. Diagnose first, make the narrowest correction, then return through VERIFY and REVIEW. Avoid cosmetic loops after all material gates pass.

**PASS.** Claim completion only when acceptance criteria pass, evidence is current for the final repository state, substantial work has a current review pass, and no known material findings remain.

## Authority

Authorization to implement does not imply authorization to merge or deploy. Do not merge without explicit authority. Do not deploy without explicit authority. Treat production mutation, destructive actions, secret or credential changes, billing, and other high-impact external actions as separate authority gates. Never place secrets in source, logs, issues, or reports.

## Continuity

Keep a concise checkpoint with repository/branch/commit, accepted intent, completed work, verification evidence, unresolved findings, and next valid action. `ROLLOVER_RECOMMENDED` means context is growing but safe to continue. `ROLLOVER_REQUIRED` means continued work creates a concrete continuity or correctness risk; preserve a handoff before continuing in a fresh conversation.
