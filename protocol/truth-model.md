# UAL Truth Model

Version: 1.

## 1. Two truths

- **Implementation truth** — what currently exists. Strong evidence:
  runtime/deployed behavior, current git state, committed source, tests,
  CI results, browser/runtime verification, external provider state.
- **Intent truth** — what should exist. Strong evidence: accepted current
  specification, resolved current wayfinder decisions, explicit current
  user/directive requirements, accepted design, authorized issues.

Keep them separate. Never rewrite history to make them appear consistent.

## 2. Conflict rule

A mismatch is not automatically resolved in favor of either side.

```text
spec says A; runtime does B  =>  CONFLICT
```

until reconciliation proves the implementation wrong or the intent
changed. Surface the conflict; do not silently pick a side.

## 3. Evidence precedence — what currently exists

```text
runtime / deployed behavior
> current git state
> tests and deterministic evidence
> self-reported agent status
```

An agent saying "done" is weak evidence.

## 4. Evidence precedence — what should exist

```text
explicit current user/directive
> accepted current specification
> resolved current wayfinder decisions
> current ticket
> handoff
> old conversation summary
```

Fresh direct evidence outranks stale summaries. A handoff that
contradicts current git state loses on "what exists" and is classified
STALE (artifacts.md K3).

## 5. Verification hierarchy

Prefer, in order:

1. real executable/runtime evidence
2. deterministic tests
3. static/tooling validation
4. accepted acceptance criteria review
5. independent critical review
6. builder self-assessment

VERIFY MUST produce evidence from the highest available tier and record
the command and result in durable state when a state file exists.
