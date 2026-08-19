# Game Browser Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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

### Task 1: RED conformance tests for the new skill

**Files:**
- Create: `tests/game-browser-testing-skill.test.mjs`

**Interfaces:**
- Consumes: `skills/game-browser-testing/SKILL.md` and `skills/autonomous-dev-loop/SKILL.md` as text contracts.
- Produces: deterministic assertions for autonomous QA behavior, capability honesty, evidence, safety, and outer-loop integration.

- [ ] **Step 1: Create a test that requires Agent Skills frontmatter and bounded-companion language**

Assert `name: game-browser-testing`, discovery-oriented description, and explicit language that the skill is bounded and cannot complete the outer lifecycle.

- [ ] **Step 2: Add tests for autonomous-first and scenario-driven modes**

Assert default autonomous exploration, inferred controls/goals, explicit scenarios as an augmentation/override, and anti-random-exploration language.

- [ ] **Step 3: Add tests for sense → act → verify and canvas/WebGL behavior**

Assert independent verification after actions, screenshots/visual evidence, keyboard/mouse support, and no assumption that DOM represents canvas game-world state.

- [ ] **Step 4: Add tests for optional `window.__GAME_TEST__` instrumentation**

Assert instrumentation is optional, read-oriented/non-destructive by default, and cannot replace visual verification for user-visible acceptance criteria.

- [ ] **Step 5: Add tests for findings/completion/safety contracts**

Assert severity, reproduction, observed/expected evidence, confidence, explicit limitations, public/deployed URL scope, and authority restrictions.

- [ ] **Step 6: Add integration assertions against `autonomous-dev-loop`**

Assert it routes interactive browser/game verification to `game-browser-testing` when applicable and routes material findings back to REPAIR → VERIFY → REVIEW.

- [ ] **Step 7: Run `npm test` and observe RED**

Expected: FAIL because `skills/game-browser-testing/SKILL.md` does not yet exist and the autonomous loop lacks the new routing language.

Execution note: when the active ChatGPT harness cannot observe push-triggered GitHub Actions or execute a local shell, record that RED could not be witnessed rather than fabricating it; preserve test-first file ordering.

---

### Task 2: Implement the bounded `game-browser-testing` skill

**Files:**
- Create: `skills/game-browser-testing/SKILL.md`

**Interfaces:**
- Consumes: public/deployed game URL, optional scenarios/acceptance criteria, actual browser capabilities exposed by the harness.
- Produces: a browser QA session result containing explored goals, evidence, material findings, limitations, and PASS/finding status for the caller.

- [ ] **Step 1: Add discovery-oriented frontmatter and bounded-role invariants**

Keep frontmatter concise. State that the skill performs one browser-testing session and returns evidence to its caller.

- [ ] **Step 2: Implement capability discovery and honest degradation guidance**

Require checking available navigation, screenshots, input, DOM/accessibility, JavaScript, console/network, and reset/close capabilities before claiming coverage.

- [ ] **Step 3: Implement autonomous exploratory mode as the default**

Require baseline observation, control inference, generation of a small set of high-value goals, bounded intentional interaction, reproduction of suspected defects, and avoidance of endless random input.

- [ ] **Step 4: Implement scenario mode and sense → act → verify**

Explicit caller scenarios receive priority while light exploration remains enabled unless strict scenario-only behavior is requested. A tool saying an input succeeded is not verification.

- [ ] **Step 5: Add canvas/WebGL and optional instrumentation guidance**

Prefer vision/input/runtime evidence for canvas games. Allow read-only use of `window.__GAME_TEST__` when present; destructive debug operations require explicit authority.

- [ ] **Step 6: Add findings, completion, and safety contracts**

Define severity/confidence/reproduction/evidence fields and public/deployed-only safety restrictions.

- [ ] **Step 7: Run `npm test` and observe GREEN**

Expected: new skill tests still fail only on autonomous-loop integration until Task 3; all skill-local assertions pass.

---

### Task 3: Integrate with `autonomous-dev-loop`

**Files:**
- Modify: `skills/autonomous-dev-loop/SKILL.md`

**Interfaces:**
- Consumes: availability of public game/interactive build and browser-control capability.
- Produces: automatic routing into `game-browser-testing` during VERIFY/REVIEW and repair routing for material findings.

- [ ] **Step 1: Add `game-browser-testing` to automatic skill routing**

Route interactive game/browser verification to the skill when relevant and available; do not require the user to request it.

- [ ] **Step 2: Define finding freshness and repair behavior**

State that material game-browser findings force REPAIR and that any implementation mutation stales prior browser evidence.

- [ ] **Step 3: Preserve capability honesty**

If interactive verification is required but no browser-control capability exists, report the limitation/blocker rather than claiming runtime coverage.

- [ ] **Step 4: Run `npm test` and observe GREEN**

Expected: all conformance tests pass.

---

### Task 4: Documentation and repository reconciliation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: final skill architecture.
- Produces: discoverable documentation explaining the skill boundary and external browser-runtime separation.

- [ ] **Step 1: Document `skills/game-browser-testing/` in README**

Describe autonomous exploratory QA, optional scenarios/instrumentation, integration with the ChatGPT autonomous loop, and the fact that a callable browser runtime is still required.

- [ ] **Step 2: Document the directory/rules in AGENTS**

Add the skill to layout and reinforce that browser infrastructure must not be embedded into canonical protocol/reference-engine code.

- [ ] **Step 3: Run the full test suite**

Expected: PASS.

---

### Task 5: Independent review → repair loop

**Files:**
- Review: `skills/game-browser-testing/SKILL.md`
- Review: `skills/autonomous-dev-loop/SKILL.md`
- Review: `tests/game-browser-testing-skill.test.mjs`
- Review: documentation/spec/plan consistency

**Interfaces:**
- Consumes: final branch diff.
- Produces: zero unresolved material findings or a documented external verification limitation.

- [ ] **Step 1: Run a fresh review against the design**

Check autonomy, boundedness, false capability claims, evidence quality, scenario behavior, canvas handling, instrumentation safety, publication/deployment authority, and integration with repair/freshness rules.

- [ ] **Step 2: Repair every material finding**

For each finding: add/adjust a failing conformance assertion first where practical, then make the smallest skill/doc correction.

- [ ] **Step 3: Re-review after repairs**

Repeat until no material findings remain. Avoid cosmetic churn after the material gate is clean.

- [ ] **Step 4: Record final evidence honestly**

Report branch/head, changed files, review outcome, and whether test execution was directly observed. Do not claim CI/local test results that the active harness could not inspect.
