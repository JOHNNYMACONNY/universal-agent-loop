---
name: game-browser-testing
description: Use when ChatGPT needs to test a public or deployed browser game through available browser-control tools, especially for autonomous exploratory QA, gameplay verification, or scenario regression checks.
---

# Game Browser Testing

Bounded browser-QA companion skill. It owns one browser-testing session, returns evidence/findings to its caller, and must not declare the outer development lifecycle complete.

## Scope and invariants

- V1 targets public/deployed browser games. Do not claim localhost, private LAN, private Mac, or local-build access unless the active harness actually exposes it.
- Autonomous exploratory QA is the default. Explicit scenarios or acceptance criteria add priority and constraints; use strict scenario-only execution only when the caller explicitly requests it.
- Discover actual browser capabilities before testing. Useful capabilities include open/navigate URL, screenshot/visual frame, keyboard, mouse/pointer, DOM/accessibility snapshot, JavaScript evaluation, console/runtime errors, failed request/network inspection, and reset/reload/close.
- Never invent an unavailable capability or fabricate browser evidence. If required coverage depends on a missing capability, return a concrete capability blocker/limitation.
- This skill is evidence-producing only. It does not edit repositories, merge, deploy, publish, buy anything, change billing, enter credentials without explicit authority, or perform destructive external actions.

## Session loop

### 1. Baseline

Open the project-associated public/deployed game URL. Record the initial visible state, loading behavior, screenshot when available, and console/runtime/network failures when available.

For canvas/WebGL games, treat DOM/accessibility data as surrounding UI evidence only. Do not assume the DOM represents game-world state rendered inside a canvas; rely more heavily on vision/screenshots, trusted input, runtime signals, and optional instrumentation.

### 2. Choose high-value goals

Infer likely controls from visible instructions, common conventions, accessibility/DOM hints, and observed response to bounded probes. Generate a small set of high-value test goals appropriate to the game instead of waiting for the caller to enumerate every action.

Prioritize startup/loading, primary movement/control loop, obvious interactions, state transitions, collision/boundary behavior, repeated actions likely to expose state bugs, correlated console/network failures, and severe visible performance regressions.

Avoid endless random input. Maximize information, not input volume; abandon low-yield exploration and move to another goal.

### 3. Sense → Act → Verify

For every material interaction:

```text
SENSE  observe visible/runtime state
ACT    perform one intentional input or bounded action sequence
VERIFY observe an independent resulting signal
```

A successful input/tool call is not verification. Verify through an independent signal such as changed visual state, changed URL/state, instrumentation value, console/network outcome, or another reproducible effect.

Use keyboard and mouse/pointer input as appropriate. Re-sense after meaningful state changes rather than chaining blind interactions.

### 4. Scenario mode

When explicit scenarios or acceptance criteria exist, execute them first or alongside autonomous goals. Explicit scenarios do not disable lightweight exploratory QA unless strict scenario-only behavior was requested.

If a scenario cannot be completed, distinguish a product defect from a capability limitation and capture the strongest available evidence for that distinction.

### 5. Optional instrumentation

If present, `window.__GAME_TEST__` or an equivalent game-provided bridge may strengthen objective verification. Treat instrumentation as optional and read-only/non-destructive by default.

Useful read-oriented state includes player position, current vehicle, health/status, mission/objective state, collision counters, FPS/performance metrics, and scene/level identifiers.

Black-box/visual verification remains primary for user-visible acceptance criteria; instrumentation must not replace visual evidence of what the player actually sees. Destructive or privileged debug methods require explicit authority from the caller.

### 6. Reproduce before escalating

When a defect is suspected, try to reproduce it with the smallest practical input sequence and corroborate it with another signal when available. Do not label speculative visual oddities as confirmed defects.

## Findings contract

For each material finding, return:

- `severity`: blocker | high | medium | low
- `title`: concise defect summary
- `reproduction`: minimal steps/input sequence
- `expected`: requirement/design expectation when inferable
- `observed`: what actually happened
- `evidence`: screenshot/frame, runtime/console/network signal, instrumentation value, or reproducible state transition
- `confidence`: confirmed | likely | uncertain

State evidence/coverage limitations explicitly.

## Session completion

Return session PASS only when the reachable relevant surface loaded sufficiently, required scenarios were exercised when provided, autonomous exploration covered the highest-value reachable interactions, and no known material finding remains unreproduced inside the session.

Session PASS is evidence for the caller, not outer-loop completion or lifecycle completion.

## Safety and authority

Stay on the project-associated public/deployed target and necessary project-owned redirects. Do not authenticate into unrelated services, use stored personal sessions, enter credentials without explicit authority, purchase items, trigger billing, perform destructive actions, or interact with unrelated third-party sites discovered during exploration.

Never merge, deploy, or publish from this skill. Return findings/evidence to the caller so the outer orchestrator decides REPAIR, VERIFY, REVIEW, or any separately authorized external action.
