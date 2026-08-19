# ChatGPT Autonomous Dev Loop Skill — Design

Date: 2026-08-19
Status: proposed implementation design

## Goal

Add a reusable `autonomous-dev-loop` skill that lets ChatGPT act as the implementation and orchestration plane for repository work when it has connected GitHub access plus web/browser verification, without requiring a separate coding agent.

The skill should automatically select and compose Matt Pocock engineering skills when they are available, use repository and runtime evidence rather than self-reported completion, and continue repair cycles until acceptance criteria pass or a genuine external blocker is reached.

## Context

The repository already contains the canonical Universal Agent Loop (UAL) protocol, a dependency-free Node reference engine, deterministic tests, and an OpenCode adapter. The existing adapter contract assumes an execution harness can locate the protocol and use the reference engine for deterministic classification. ChatGPT web can have strong GitHub read/write, CI visibility, network, skills, and browser capabilities while lacking a persistent local checkout, shell, or git binary.

A ChatGPT skill must not pretend those local capabilities exist. It also should not fork the UAL protocol or duplicate Matt Pocock's individual engineering methods.

## Decision

Implement v1 as a **UAL-aligned companion control-plane skill**, not as a fully compliant UAL harness adapter.

Location:

```text
skills/autonomous-dev-loop/SKILL.md
```

The skill will reuse UAL concepts and truth/verification rules but will not claim adapter-contract compliance when the ChatGPT runtime cannot execute the reference engine or persist local `.agent-loop/` state.

This keeps the semantic boundary honest:

- `protocol/` remains canonical UAL.
- `adapters/opencode/` remains a true harness adapter backed by the engine.
- `skills/autonomous-dev-loop/` becomes the ChatGPT-native orchestration skill for connected-tool execution.

A later v2 may become a true ChatGPT adapter if ChatGPT exposes an execution primitive capable of running the UAL engine or if UAL formally defines a remote deterministic-engine interface.

## Alternatives Considered

### 1. Copy the OpenCode adapter and rename it for ChatGPT

Rejected. The OpenCode adapter assumes local shell, filesystem, git, and the Node engine. Copying it would encode capabilities ChatGPT web may not have and would create false evidence.

### 2. Fork the UAL state machine inside the ChatGPT skill

Rejected. This duplicates canonical lifecycle semantics and would drift from `protocol/` and the reference engine over time.

### 3. UAL-aligned companion skill

Chosen for v1. It preserves the strongest UAL invariants while explicitly operating through capabilities ChatGPT actually has: GitHub, CI evidence, deployment URLs, browser/runtime checks, web research, and reusable skills.

## Triggering and Discovery

The skill frontmatter will use discovery-oriented wording only:

```yaml
---
name: autonomous-dev-loop
description: Use when ChatGPT is asked to implement, repair, continue, or autonomously complete substantial repository work using connected GitHub and runtime verification without delegating implementation to a separate coding agent.
---
```

The body will require capability discovery at the start of each loop. At minimum it must establish whether these are available:

- repository read
- repository write
- issue/PR read
- issue/PR write
- CI visibility
- deployment/runtime URL
- browser verification
- reusable skill loading

Missing optional capabilities degrade verification; missing capabilities required for the requested action produce an explicit blocker rather than fabricated evidence.

## Lifecycle

The skill owns this ChatGPT-native lifecycle:

```text
ORIENT
  -> RECONCILE
  -> CLASSIFY
  -> PLAN/ROUTE
  -> IMPLEMENT
  -> VERIFY
  -> REVIEW
  -> PASS | REPAIR
  -> VERIFY
  -> REVIEW
  -> ...
```

### ORIENT

Read repository instructions, current branch/PR/issue state, relevant source, current tests/workflows, and current accepted requirements. Do not begin by rewriting existing planning artifacts.

### RECONCILE

Separate implementation truth from intent truth. Reuse current specs, tickets, wayfinder maps, PRs, and prior accepted decisions. Treat conflicts as conflicts until resolved.

Evidence precedence follows UAL `truth-model.md`:

```text
runtime/deployed behavior
> current repository state
> deterministic tests/CI
> self-reported status
```

A prior agent or previous ChatGPT turn saying "done" is never sufficient evidence.

### CLASSIFY

Decide whether the task is trivial or substantial and whether requirements are clear enough to implement. Substantial ambiguous work routes through planning/specification before code changes. Existing accepted artifacts are preferred over generating new ones.

### PLAN/ROUTE

Automatically load the smallest applicable reusable skill set. Matt Pocock skills are preferred when installed/accessible.

Routing examples:

- unclear feature -> `to-spec`
- implementation map needed -> `wayfinder`
- ticket decomposition needed -> `to-tickets`
- feature/bug implementation -> `tdd` then `implement`
- defect/root-cause work -> `diagnosing-bugs`
- unknown technical fact -> `research`
- completed substantial implementation -> `code-review`
- merge conflict -> `resolving-merge-conflicts`

Nested skills are bounded methods. They never get to declare the outer loop complete.

### IMPLEMENT

ChatGPT makes repository changes directly through connected GitHub write tools. Changes should be scoped, reviewable, and made on a non-default working branch unless the current repository workflow explicitly requires otherwise.

For implementation work, use test-first behavior where the available environment makes a meaningful failing test observable. When ChatGPT cannot execute tests locally, it should add or modify the test first, publish that isolated red state only when repository policy and user authority permit it, observe CI failure, then implement the minimal green change. If an isolated red commit would be unsafe or materially disruptive, record the limitation and use the strongest available deterministic verification without falsely claiming a witnessed RED phase.

### VERIFY

Use the highest available evidence tier:

1. deployed/runtime behavior
2. deterministic CI/tests
3. static/build/type/lint evidence
4. acceptance-criteria inspection
5. independent critical review
6. builder self-assessment

For web applications, successful CI alone is insufficient when a preview/deployment URL is available. Browser verification should cover the changed user-visible behavior and relevant console/runtime errors.

Verification evidence must identify the repository state or commit SHA it applies to. A later implementation change makes prior verification stale.

### REVIEW

Review is a distinct phase after implementation verification.

For substantial work, prefer Matt Pocock `code-review`. If unavailable, perform a fresh review pass with explicit role separation from the builder phase.

Review checks:

- acceptance criteria
- missing cases
- regression risk
- unintended scope drift
- architectural fit
- security/privacy implications where relevant
- sufficiency and freshness of verification evidence

The implementer phase cannot waive review findings.

### REPAIR

Any failed test, browser defect, runtime error, or material review finding routes to REPAIR. Diagnose the failure, make the narrowest corrective change, then repeat VERIFY and REVIEW.

Do not stop because one repair attempt failed. Stop only on PASS, a genuine external blocker, lost authority, or a rollover requirement that creates concrete continuity risk.

## Completion Contract

The skill may claim completion only when:

- requested acceptance criteria are satisfied;
- implementation evidence is current for the final repository state;
- substantial work has a current review pass;
- no known material findings remain unresolved;
- requested publication/deployment actions are either completed with authority or explicitly reported as remaining external actions.

"Changes written" is not completion. "CI green" is not automatically completion when runtime verification is available and relevant.

## Authority and Safety

Repository mutation requires explicit user authorization for the task. The skill must not infer merge, production deployment, destructive data mutation, secret changes, billing actions, or other high-impact external operations merely from authorization to implement code.

Use a working branch by default. Do not merge to the default branch without explicit authority. Never place secrets in source, logs, issues, or skill state.

## Continuity

The skill should maintain a concise checkpoint in conversation and, where appropriate and authorized, in an existing GitHub issue/PR comment or repository-native artifact. It must distinguish:

- `ROLLOVER_RECOMMENDED`: context is growing but work can safely continue;
- `ROLLOVER_REQUIRED`: continuing risks losing state or correctness.

A rollover checkpoint must include current repository/branch/commit, accepted intent, completed work, verification evidence, unresolved findings, and the next valid action.

The v1 skill does not invent a new durable UAL state format. It uses existing project artifacts when present and conversational continuity otherwise.

## Files to Add or Change

Initial implementation scope:

```text
skills/autonomous-dev-loop/SKILL.md
skills/autonomous-dev-loop/references/review-gates.md   # only if SKILL.md exceeds concise target
skills/autonomous-dev-loop/references/tool-mapping.md  # ChatGPT GitHub/browser capability mapping

tests/autonomous-dev-loop-skill.test.js                # static conformance tests
README.md                                               # document the companion skill and non-adapter status
AGENTS.md                                               # add skills/ to repository layout if needed
```

No changes to canonical `protocol/` semantics are required for v1.

## Testing Strategy

Skill creation follows documentation TDD.

### RED

Define pressure scenarios before authoring the skill. Baseline behavior should demonstrate likely failure modes, including:

1. Agent stops after writing code without runtime evidence.
2. Agent trusts a prior "done" claim instead of inspecting GitHub.
3. Agent runs one code review but does not repair and re-review findings.
4. Agent chooses a Matt skill manually only after user prompts for it.
5. Agent claims tests passed when it cannot execute or observe them.
6. Agent merges/deploys from generic implementation authorization.
7. Agent loops cosmetically despite all material gates passing.
8. Agent loses state across context rollover.

Where true subagent pressure testing is not available in ChatGPT, encode deterministic static conformance tests for required and forbidden skill language, and document that limitation instead of claiming behavioral RED/GREEN evidence that was not observed.

### GREEN

Author the minimum `SKILL.md` that closes the observed/static gaps. Run repository tests plus the new conformance suite.

### REFACTOR

Reduce duplicated process text, push heavy tool-specific material into references, and verify all tests remain green.

## Acceptance Criteria

1. `skills/autonomous-dev-loop/SKILL.md` is valid Agent Skills markdown with concise discovery-oriented frontmatter.
2. The skill automatically routes to reusable/Matt Pocock skills based on task state without requiring user invocation.
3. The skill explicitly distinguishes builder, verifier, and reviewer phases.
4. It never treats self-reported completion as strong evidence.
5. It requires current evidence tied to the final repository state.
6. Failed verification/review enters a repair loop and returns through verification/review.
7. It degrades honestly when shell/local test execution is unavailable.
8. It does not claim full UAL adapter compliance in v1.
9. It does not duplicate canonical UAL protocol semantics or copy Matt skill bodies.
10. It preserves explicit authority gates for merge, deploy, destructive operations, credentials, and other high-impact actions.
11. Existing `npm test` remains green.
12. New skill conformance tests pass.
13. README/AGENTS clearly distinguish canonical UAL adapters from the ChatGPT companion skill.

## Out of Scope for v1

- A remote service that executes the UAL Node engine for ChatGPT.
- Automatic GitHub Actions workflow dispatch solely to emulate a local shell.
- A new durable state format.
- Copying or vendoring Matt Pocock skills.
- Automatic production deployment or default-branch merge authority.
- Replacing the existing OpenCode adapter.

## Future Path

If ChatGPT gains a reliable shell/checkout execution primitive, or UAL defines a remote engine API, migrate this companion skill into `adapters/chatgpt/` and make it fully conformant with `protocol/adapter-contract.md`. Until then, capability honesty is more important than claiming adapter parity.
