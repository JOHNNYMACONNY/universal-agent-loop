# Game Browser Testing Skill — Design

Date: 2026-08-19
Status: implemented and review-reconciled

## Goal

Add a reusable `game-browser-testing` companion skill that lets ChatGPT autonomously test public/deployed browser games through whatever browser-control capability the current ChatGPT environment exposes, while remaining compatible with the existing UAL-aligned `autonomous-dev-loop` skill.

The tester should behave primarily as an autonomous exploratory QA agent, with scenario-driven checks available as an override/addition. It must produce evidence strong enough to feed the outer development loop's VERIFY/REVIEW gates and route material defects back to REPAIR.

## Scope

V1 targets public/deployed browser games only. It does not require access to localhost, private LANs, a user's Mac, credentials, or private browser profiles.

This repository contains the skill contract, conformance tests, and integration routing. The actual remote browser/MCP/plugin runtime remains a separate deployable component because UAL intentionally has no runtime dependencies and should not own browser infrastructure.

## Architecture

`game-browser-testing` is a bounded reusable capability, not a lifecycle owner.

```text
Autonomous Dev Loop
  -> IMPLEMENT
  -> VERIFY
       -> game-browser-testing (when interactive game/browser verification is relevant)
  -> REVIEW
       -> game-browser-testing evidence may inform review
  -> PASS | REPAIR | verification blocker
```

The game tester owns only one browser-testing session. It returns evidence and findings to the caller. It never declares the outer implementation complete, merges code, deploys, or changes repository state by itself.

## Operating Modes

### Autonomous exploratory mode — default

Given a public game URL, the tester should:

1. Establish a baseline: load state, screenshot, visible UI, console/runtime/network condition where available.
2. Infer likely controls from visible instructions, common conventions, accessibility/DOM hints, or game behavior.
3. Generate a small set of high-value test goals appropriate to the observed game.
4. Play/interact using the available browser tool.
5. After meaningful actions, sense again and verify the resulting state.
6. Stress important interactions rather than performing random input indefinitely.
7. Reproduce suspected defects before reporting them when practical.
8. Return concise findings with supporting evidence and confidence.

Stop when the highest-value reachable goals have been exercised, a required capability blocks meaningful progress, or the caller/harness budget is exhausted.

### Scenario-driven mode — optional

When the caller provides explicit scenarios or acceptance criteria, execute those scenarios in addition to autonomous exploration. Explicit scenarios constrain priority but do not disable lightweight exploratory checks unless the caller requests strict scenario-only execution.

When scenarios can contaminate each other's state, reset/reload to a known baseline between them when that capability exists.

## Browser Capability Contract

The skill is runtime-agnostic. It must discover which browser operations are actually available and degrade honestly.

Useful capabilities include:

- open/navigate to a public URL;
- capture screenshot or visual frame;
- keyboard input;
- mouse/pointer input;
- DOM/accessibility snapshot where meaningful;
- JavaScript evaluation where permitted;
- console/runtime error inspection;
- failed request/network inspection;
- session reset/reload/close.

The skill must not invent unavailable operations. If required coverage depends on a missing capability, return `BLOCKED_CAPABILITY` naming the missing capability and affected coverage rather than claiming coverage.

## Sense → Act → Verify

Every material interaction should follow this shape:

```text
SENSE
  observe visible/runtime state
ACT
  perform one intentional input or bounded action sequence
VERIFY
  observe an independent resulting signal
```

A successful input call alone is not verification. Prefer independent evidence such as changed visual state, URL/state change, instrumentation state, console/network outcome, or another observable effect.

## Canvas/WebGL Games

For canvas/WebGL games, DOM semantics may be weak or absent. The tester should rely more heavily on screenshots/vision, trusted keyboard/mouse input, runtime errors, performance symptoms, and optional game instrumentation.

It must not assume a DOM snapshot represents game-world state when the relevant content is rendered inside a canvas.

## Optional Game Instrumentation

V1 supports but does not require a game-provided test bridge such as:

```js
window.__GAME_TEST__
```

If present, the tester may read non-destructive objective state such as:

- player position;
- current vehicle;
- health/status;
- mission/objective state;
- collision counters;
- FPS/performance metrics;
- loaded scene/level identifiers.

Black-box observation remains primary for player-visible behavior. Instrumentation strengthens verification but must not replace visual/runtime checks when the acceptance criterion is user-visible.

The tester must not invoke destructive or privileged debug methods unless explicitly authorized by the caller.

## Exploration Policy

Autonomous testing should maximize information, not input volume.

Prioritize:

1. startup/loading failures;
2. primary movement/control loop;
3. obvious interactive affordances;
4. state transitions (menus, vehicles, missions, pause/resume, restart);
5. collision/boundary behavior;
6. repeated actions likely to expose state bugs;
7. console/runtime/network errors correlated with gameplay;
8. visible regressions or severe performance degradation.

Avoid endless random input. Stop a line of exploration when it is clearly low-yield and move to another test goal.

## Findings Contract

Each finding includes:

- `severity`: blocker | high | medium | low;
- `material`: true | false;
- concise title;
- reproduction steps/input sequence;
- expected behavior when inferable from requirements or visible design;
- observed behavior;
- evidence: screenshot/frame reference, console/runtime/network signal, instrumentation value, or reproducible state transition;
- `confidence`: confirmed | likely | uncertain.

Materiality is distinct from severity. A finding is material when it affects acceptance criteria, correctness, gameplay progression, stability/performance, security/privacy, or materially degrades the user-visible experience. Cosmetic preference/polish that does not affect those concerns is non-material and cannot force a repair loop by itself.

Do not report speculative visual oddities as confirmed defects without reproduction or corroborating evidence.

## Session Result Contract

Every session returns one top-level `status`:

```text
PASS | FINDINGS | BLOCKED_CAPABILITY
```

- `PASS`: required scenarios were exercised when provided, autonomous exploration covered the highest-value reachable interactions, and there are no `material: true` findings. Non-material findings may accompany PASS if clearly labeled.
- `FINDINGS`: at least one confirmed or likely `material: true` finding exists. Reproducing a material defect strengthens the finding; it does not permit PASS.
- `BLOCKED_CAPABILITY`: a missing required browser capability prevents meaningful required coverage; the missing capability and affected goals/scenarios are named.

Evidence/coverage limitations are stated explicitly. A browser session PASS is evidence for the caller. It is not outer-loop completion.

## Integration with `autonomous-dev-loop`

The autonomous dev loop should route to `game-browser-testing` when all are true:

- a public/deployed game or interactive browser build is available;
- the change or acceptance criteria are materially interactive/visual/gameplay-related;
- browser control is available.

If the skill is not natively installed but exists in the project repository, the autonomous loop should load the repository-local `skills/game-browser-testing/SKILL.md` rather than incorrectly looking for it in the Matt Pocock engineering-skills repository.

The outer loop interprets game-QA status deterministically:

- PASS -> runtime evidence only; continue normal VERIFY/REVIEW gates;
- FINDINGS with material findings -> REPAIR, followed by fresh VERIFY and REVIEW;
- BLOCKED_CAPABILITY -> verification blocker/limitation; never treat as PASS.

A code change stales previous game-browser evidence just like other runtime evidence.

The outer loop must not block non-game work merely because this optional skill is unavailable. If interactive game verification is required and no browser-control capability exists, it should report the specific verification limitation/blocker.

## Safety and Authority

V1 only targets public/deployed URLs supplied by the task/repository context or otherwise clearly associated with the project under test.

The tester must not:

- authenticate into unrelated services;
- use stored personal browser sessions;
- enter credentials without explicit authority;
- purchase items or trigger billing;
- perform destructive external mutations;
- publish/merge/deploy;
- interact with unrelated third-party sites discovered during testing except as necessary to observe project-owned redirects and only within the caller's authority.

## Files

Implementation scope:

```text
skills/game-browser-testing/SKILL.md
tests/game-browser-testing-skill.test.mjs
skills/autonomous-dev-loop/SKILL.md
README.md
AGENTS.md
docs/superpowers/plans/2026-08-19-game-browser-testing.md
```

No canonical `protocol/` change is required for v1.
