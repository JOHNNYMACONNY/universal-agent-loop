# UAL Harness Adapter Contract

Version: 1.

An adapter binds the canonical protocol to one harness (OpenCode, Codex,
Antigravity, ...). Adapters are thin: they implement this contract and
delegate protocol semantics to the canonical documents and the reference
engine. The adapter is never the canonical source of truth.

## 1. Required behavior

An adapter MUST:

1. Locate and load the canonical protocol (installed copy or referenced
   checkout; record which).
2. At task start, run DISCOVER: capabilities detection, repository scan,
   repo-local instruction loading.
3. Run RECONCILE over discovered artifacts per artifacts.md, using the
   engine for deterministic classification.
4. Resolve the lifecycle entry via the engine (`plan`), supplying the
   task profile as explicit agent judgment.
5. Invoke harness-native or reusable skills as bounded subtasks within
   states. Never let a nested skill terminate the lifecycle.
6. Enforce authority per authority.md, using `authority check` before
   every irreversible/public action.
7. Persist durable state (state.json, handoffs) when required, per
   artifacts.md §6 and handoff.md.
8. Perform VERIFY using the highest available evidence tier
   (truth-model.md §5) and record results.
9. Run CRITIC as an evaluation distinct from the builder pass, using the
   hierarchy from lifecycle.md §3: Matt Pocock `code-review` skill when
   available, else an independent subagent, else a fresh-prompt pass.
   Record the outcome via `state record-critic` so freshness anchoring
   applies. Substantial work MUST NOT reach COMPLETE_LOCAL without a
   current critic pass.
10. Return a concise factual report (section 3) at meaningful checkpoints.

## 2. Degeneration rules

- No git -> report BLOCKED_ENVIRONMENT for git-dependent flows; read-only
  states may still run.
- No github_read -> reconcile from repo-local artifacts only; note the
  degradation in the report.
- No subagents -> run CRITIC as a separate fresh-prompt pass in the same
  session.
- No skills system -> inline the equivalent steps from the canonical
  documents.

## 3. Checkpoint report format

```text
STATE:
PROJECT:
CURRENT_LIFECYCLE_STATE:

DISCOVERED:
- ...
RECONCILED:
- ...
CHANGED:
- ...
REUSED_EXISTING_ARTIFACTS:
- ...
VERIFICATION:
- command/result
GIT:
- repo / branch / HEAD / worktree status
AUTHORITY:
- used / remaining restrictions
RISKS_OR_CONFLICTS:
- none | details
NEXT_VALID_ACTION:
- ...
```

Concise and factual. Never paste large logs; a result plus relevant
failing lines is sufficient.

## 4. OpenCode adapter

Lives in `adapters/opencode/`. Installation copies the skill into the
global OpenCode skills directory (`~/.agents/skills/<name>/SKILL.md`,
the agent-compatible location also read by other harnesses) and writes a
small pointer file recording the canonical protocol home. It MUST NOT
modify `opencode.json` or any pre-existing skill.
