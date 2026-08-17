---
name: universal-agent-loop
description: Universal Agent Loop (UAL) orchestration protocol. Use for any substantial or multi-step coding task, any request to resume/continue existing work, or when planning artifacts (specs, tickets, wayfinder maps, PRs, handoffs) may already exist. Owns the lifecycle DISCOVER→RECONCILE→CLASSIFY→(DIRECT_EXECUTE|WAYFIND|SPEC|TICKET)→IMPLEMENT→VERIFY→CRITIC→COMPLETE_LOCAL→PUBLISH_GATE. Reuses existing artifacts, enforces push/PR/deploy authority gates, survives context rollover. Skip only for single trivially-scoped edits with no existing artifacts.
license: MIT
compatibility: opencode
metadata:
  protocol: universal-agent-loop
  version: "1"
---

# Universal Agent Loop (OpenCode adapter)

You are the execution plane. The canonical protocol owns the lifecycle; this
skill is only an adapter. The canonical documents are the source of truth —
read them when any situation is not covered here.

## Setup (once per session)

```bash
UAL_HOME="$(cat ~/.agents/skills/universal-agent-loop/PROTOCOL_HOME)"
node "$UAL_HOME/bin/agent-loop.js" capabilities
```

If `PROTOCOL_HOME` is missing or stale, stop and report
BLOCKED_ENVIRONMENT. Read `$UAL_HOME/protocol/*.md` for full semantics;
this file is a faithful summary, not a replacement.

## The loop

1. **DISCOVER** — run `node "$UAL_HOME/bin/agent-loop.js" scan`. Read
   AGENTS.md/CLAUDE.md and repo-local instructions. Note capabilities.
2. **RECONCILE** — the scan classifies every artifact
   (CURRENT/PARTIAL/STALE/SUPERSEDED/CONFLICTING/UNVERIFIED). Reuse
   existing specs, tickets, maps, PRs, handoffs. Never recreate artifacts
   that exist. Resolve conflicts before advancing.
3. **CLASSIFY** — judge the task profile yourself
   (`scope: trivial|substantial`, `clarity: clear|ambiguous`), then run
   `plan --task-profile '{"scope":...,"clarity":...}'` and follow its
   deterministic entry state. Resume rules beat classification.
4. **Execute the entry state:**
   - DIRECT_EXECUTE — do the tiny change directly.
   - WAYFIND — invoke the `wayfinder` skill (or tracker equivalent) as a
     bounded subtask. When no important unresolved decision remains,
     advance to SPEC. Wayfinder finishing never ends the loop.
   - SPEC — invoke `to-spec` or update the existing accepted spec.
   - TICKET — invoke `to-tickets` or the repo's existing tracker
     convention. Do not invent a new tracker layout.
   - IMPLEMENT — do the work (TDD via `tdd` skill where practical).
   - VERIFY — run the highest-tier deterministic evidence available
     (runtime > tests > static checks). Record it:
     `state record-verification --command "..." --result pass|fail`.
     A current `fail` routes to REPAIR; missing evidence routes to VERIFY.
   - CRITIC — independent review. Hierarchy: (1) invoke the `code-review`
     skill when available (preferred default for substantial work),
     (2) a fresh subagent reviewer, (3) a fresh-prompt review pass.
     Evaluate: acceptance criteria, missing cases, scope drift, unrelated
     damage, evidence sufficiency. Record the outcome:
     `state record-critic --result pass|fail --method code-review`.
     Findings -> REPAIR -> VERIFY -> CRITIC. No cosmetic polishing loops.
     The code-review skill is a bounded subtask: it never terminates the
     loop, never redefines completion, never overrides authority gates.
     Substantial work reaches COMPLETE_LOCAL only with a CURRENT critic
     pass. Currency is anchored to the implementation fingerprint
     (HEAD + staged + unstaged + relevant untracked content): editing
     files after verification or review — even without committing —
     stales the evidence and routes back to VERIFY/CRITIC. Trivial
     DIRECT_EXECUTE edits may complete after VERIFY without CRITIC.
5. **Autonomy** — after every subtask ask only: does authorized work
   remain? If yes, continue. If no, COMPLETE_LOCAL. Never stop because a
   skill, ticket, commit, subagent, or single verification finished.
6. **COMPLETE_LOCAL is a boundary.** When all authorized local work is
   done and verified (current verification + current critic pass for
   substantial work), transition to COMPLETE_LOCAL and STOP advancing.
7. **PUBLISH_GATE** — enter ONLY on a new explicit control-plane
   directive requesting publication evaluation:
   `state transition PUBLISH_GATE --control-plane-directive`.
   The engine refuses the transition without the flag. Then enumerate
   remaining actions (push, PR, merge, deploy) and check each:
   `authority check PUSH CREATE_PR` (grants from state file). Denied →
   report BLOCKED_EXTERNAL_AUTH with the exact actions requested. Never
   push/PR/merge/deploy without explicit recorded authority.

## Authority

Before any irreversible or public action (PUSH, CREATE_PR, UPDATE_PR,
MERGE, DEPLOY, PRODUCTION_MUTATION, EXTERNAL_PUBLICATION,
SECRET_OR_CREDENTIAL_ACTION), run `authority check`. Local
read/edit/test/commit proceed when the task clearly authorizes
implementation. Record grants at `state init --authority ...`.

## Durable state and rollover

For non-trivial work, keep `.agent-loop/state.json` current via
`state init/transition/record-verification`. On ROLLOVER_REQUIRED, run
`handoff write` with destination/remaining/next_valid_action filled, then
state the rollover in your report. A fresh session resumes from disk:
scan, read state + newest handoff, continue from the earliest unresolved
state. Never restart planning automatically.

## Git safety

Discover topology before any mutation (`scan` reports branch, HEAD,
detached, dirty, worktrees). Never reset, clean, discard, or overwrite
unrelated changes. Dirty unrelated work is preserved, always.

## Report

At meaningful checkpoints, report in the canonical format from
`protocol/adapter-contract.md` §3: STATE / PROJECT /
CURRENT_LIFECYCLE_STATE / DISCOVERED / RECONCILED / CHANGED /
REUSED_EXISTING_ARTIFACTS / VERIFICATION / GIT / AUTHORITY /
RISKS_OR_CONFLICTS / NEXT_VALID_ACTION. Concise, factual, evidence-based —
"done" claims without command output are not evidence.
