# Autonomous Dev Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and independently verify a reusable ChatGPT-native `autonomous-dev-loop` skill without involving the game project.

**Architecture:** Add a companion skill under `skills/` that reuses Universal Agent Loop truth/authority concepts and automatically routes to reusable engineering skills, while explicitly degrading when ChatGPT lacks shell/local git. A minimal GitHub Actions workflow provides remote deterministic execution so ChatGPT can witness RED/GREEN test evidence.

**Tech Stack:** Agent Skills markdown, Node >=18, `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-19-chatgpt-autonomous-dev-loop-design.md`

## Global Constraints

- Do not change canonical `protocol/` semantics for v1.
- Do not copy or vendor Matt Pocock skill bodies.
- Do not claim full UAL adapter compliance.
- Preserve explicit authority gates for merge, deployment, destructive operations, credentials, billing, and other high-impact actions.
- Verification claims must be tied to observed repository/CI/runtime evidence.
- Keep the game project entirely out of scope.

---

### Task 1: Remote test lane and RED conformance test

**Files:**
- Create: `.github/workflows/test.yml`
- Create: `tests/autonomous-dev-loop-skill.test.mjs`

**Interfaces:**
- Consumes: existing `npm test` script from `package.json`.
- Produces: remote CI evidence for every branch commit and deterministic static skill-conformance assertions.

- [ ] **Step 1: Add a minimal Node CI workflow**

```yaml
name: test
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm test
```

- [ ] **Step 2: Verify the existing suite runs remotely**

Expected: workflow completes successfully before the new conformance test exists.

- [ ] **Step 3: Add a failing conformance test before the skill exists**

The test reads `skills/autonomous-dev-loop/SKILL.md`, validates Agent Skills frontmatter, automatic skill routing, builder/verifier/reviewer separation, repair-loop language, evidence freshness, capability honesty, authority gates, and explicit non-adapter status.

- [ ] **Step 4: Observe RED in GitHub Actions**

Expected: FAIL because `skills/autonomous-dev-loop/SKILL.md` does not exist.

---

### Task 2: Minimal skill implementation

**Files:**
- Create: `skills/autonomous-dev-loop/SKILL.md`

**Interfaces:**
- Consumes: current repo instructions/artifacts, connected GitHub/CI/browser capabilities, installed/accessible reusable engineering skills.
- Produces: a ChatGPT-native orchestration procedure with ORIENT → RECONCILE → ROUTE → IMPLEMENT → VERIFY → REVIEW → REPAIR/PASS behavior.

- [ ] **Step 1: Write the minimum skill that satisfies the conformance contract**

Frontmatter must contain only discovery-oriented trigger language. The body must route skills automatically, keep nested skills bounded, separate builder/verifier/reviewer roles, require current evidence, and define honest capability degradation.

- [ ] **Step 2: Observe GREEN in GitHub Actions**

Expected: `npm test` passes including `tests/autonomous-dev-loop-skill.test.mjs`.

- [ ] **Step 3: Refactor only if needed**

Reduce duplication without removing tested invariants. Re-run CI after any edit.

---

### Task 3: Repository documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: final skill status and location.
- Produces: clear discoverability and an explicit distinction between canonical UAL adapters and the ChatGPT companion skill.

- [ ] **Step 1: Document `skills/autonomous-dev-loop/` in README and AGENTS**

State that it is a UAL-aligned companion skill, not a full adapter, and that it is intended for connected GitHub/CI/runtime execution without a separate coding agent.

- [ ] **Step 2: Re-run CI**

Expected: PASS.

---

### Task 4: Independent review and synthetic pressure test

**Files:**
- Review: `skills/autonomous-dev-loop/SKILL.md`
- Review: `tests/autonomous-dev-loop-skill.test.mjs`
- Review: documentation changes

**Interfaces:**
- Consumes: final branch diff plus CI evidence.
- Produces: review findings, repairs if needed, and a final testable branch for use in a separate ChatGPT conversation.

- [ ] **Step 1: Run a fresh code-review pass against the approved spec**

Check acceptance criteria, loopholes, false capability claims, premature-completion paths, authority bypasses, and unnecessary duplication.

- [ ] **Step 2: Repair every material finding**

Any material finding routes back through CI and review.

- [ ] **Step 3: Run synthetic scenario checks**

Evaluate at least: prior agent says “done”; CI fails; no shell available; browser preview exists; code review finds a bug; generic “implement this” authorization without merge/deploy authority; context rollover risk.

- [ ] **Step 4: Record final evidence**

Report branch, final commit SHA, CI outcome, review outcome, remaining limitations, and exact instructions for testing the skill in a fresh ChatGPT chat.
