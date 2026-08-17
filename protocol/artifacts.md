# UAL Artifact and Reconciliation Contract

Version: 1. This contract governs durable project artifacts: how the loop
discovers them, classifies them, and reuses them.

## 1. Principle

Reconciliation-first: before creating any new planning artifact, inspect
existing project state. Existing artifacts MUST be reused and reconciled,
never recreated merely because the loop started. Do not duplicate existing
artifacts into `.agent-loop/`; store references.

## 2. Artifact types

| type          | examples |
|---------------|----------|
| instructions  | AGENTS.md, CLAUDE.md, .opencode/agent files, README contrib sections |
| wayfinder_map | issue/file labelled wayfinder map; local markdown tracker equivalent |
| spec          | accepted or draft specification documents |
| ticket        | GitHub issue, repo-local ticket file, task list, implementation plan |
| plan          | design docs, implementation plans |
| pr            | open pull/merge request |
| handoff       | rollover handoff documents |
| state         | `.agent-loop/state.json` |

Adapters MUST NOT require a specific folder layout. Discovery is by
convention patterns plus content inspection.

## 3. Classifications

Every durable artifact is classified into exactly one of:

```text
CURRENT       consistent with git facts and explicit status; authoritative
PARTIAL       begun, not finished (in-progress status, unchecked items)
STALE         content references no longer match repository facts
SUPERSEDED    replaced by another artifact via explicit supersedure
CONFLICTING   contradicts another artifact of equal authority, unresolved
UNVERIFIED    completion/verification claims without recorded evidence
```

Do not classify by timestamp alone. Authority derives from content,
explicit acceptance, and current implementation evidence.

## 4. Classification rules (deterministic, ordered; first match wins)

- K1. Explicit `status: superseded`, or another artifact declares
  `supersedes: <this>` -> SUPERSEDED.
- K2. Two artifacts of the same type both claim current authority
  (accepted/current) with contradictory content and no supersedure link
  -> both CONFLICTING. Enter BLOCKED_UNRESOLVABLE_CONFLICT only if the
  agent cannot resolve from evidence (truth-model precedence).
- K3. Referential mismatch with git facts: recorded HEAD/branch differs
  from actual, or referenced files no longer exist -> STALE.
- K4. Incomplete markers: `status: in-progress`, unchecked checklist
  items, open PR with unfinished work -> PARTIAL.
- K5. Claims of completion or verification with no recorded evidence
  (no test run, no CI result, no runtime check) -> UNVERIFIED.
- K6. Otherwise -> CURRENT.

A SUPERSEDED or STALE artifact is never an authority source, but MUST be
preserved as history. History is never rewritten to make intent and
implementation appear consistent.

## 5. Reconciliation outcomes per artifact pair

- existing unresolved wayfinder map -> resume WAYFIND (lifecycle R1).
- resolved map + no spec -> validate freshness, then SPEC (R2).
- accepted spec + tickets -> validate alignment, execute next eligible
  ticket (R4).
- partially implemented ticket -> inspect actual git/test state; resume
  at earliest unresolved state (R4/R5).
- existing PR -> reconcile PR against ticket/spec; verify/critic/repair
  (R5/R6). Never spawn a new spec for an in-flight PR.
- conflicting artifacts -> reconcile before advancing (K2).

## 6. `.agent-loop/` state directory

Optional. Create only when durable state is required (non-trivial work,
rollover risk, multi-session effort). Contents:

```text
.agent-loop/
    state.json          lifecycle state, authority grants, artifact refs
    handoffs/           rollover handoffs (see handoff.md)
    evidence/           optional captured verification output
```

`state.json` stores references to canonical artifacts, never copies:

```json
{
  "version": 1,
  "project": "repo-or-project-name",
  "task": "one-line task summary",
  "lifecycle_state": "IMPLEMENT",
  "authority": ["READ", "LOCAL_EDIT", "LOCAL_TEST", "LOCAL_COMMIT"],
  "artifacts": {
    "current_spec": "docs/design/payment-system.md",
    "current_ticket": "github:#318",
    "current_pr": "github:#327"
  },
  "verification": [{ "command": "npm test", "result": "pass", "fingerprint": "<sha256>", "head": "<sha>", "at": "..." }],
  "critic": { "result": "pass", "method": "code-review", "fingerprint": "<sha256>", "head": "<sha>", "verification_index": 0, "at": "..." },
  "history": [{ "state": "DISCOVER", "at": "...", "note": "..." }]
}
```

`verification` entries and the `critic` record carry a `fingerprint`
anchor — the deterministic implementation fingerprint from
protocol/lifecycle.md (HEAD + staged + unstaged + relevant untracked
content, `.agent-loop/` and ignored files excluded; null outside a repo).
Evidence whose fingerprint differs from the repository's current
fingerprint is stale. The critic record additionally carries
`verification_index` — the index into `verification` of the evidence the
critic reviewed — so re-verification also stales a critic pass. `head`
remains as diagnostic metadata only.

If no durable repo-local state is required, do not create the directory.
