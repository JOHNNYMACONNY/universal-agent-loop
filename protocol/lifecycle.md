# UAL Lifecycle

Version: 1. Status names in this document are canonical. Adapters MUST use
these exact strings.

## 1. States

```text
DISCOVER -> RECONCILE -> CLASSIFY
CLASSIFY -> DIRECT_EXECUTE | WAYFIND | SPEC | TICKET | IMPLEMENT | VERIFY | CRITIC | REPAIR
DIRECT_EXECUTE -> VERIFY
WAYFIND -> SPEC
SPEC -> TICKET
TICKET -> IMPLEMENT
IMPLEMENT -> VERIFY
VERIFY -> CRITIC
CRITIC -> REPAIR | COMPLETE_LOCAL
REPAIR -> VERIFY
VERIFY -> REPAIR              (when verification fails)
VERIFY -> COMPLETE_LOCAL      (trivial DIRECT_EXECUTE work only)
COMPLETE_LOCAL -> PUBLISH_GATE
```

`COMPLETE_LOCAL -> PUBLISH_GATE` is valid ONLY after a new explicit
control-plane directive authorizing or requesting publication evaluation.
The worker MUST NOT perform this transition autonomously; the reference
engine refuses it unless the directive flag is explicitly supplied.

Boundary states (terminal until control plane intervenes):

```text
BLOCKED_EXTERNAL_AUTH
BLOCKED_DECISION
BLOCKED_CREDENTIAL
BLOCKED_ENVIRONMENT
BLOCKED_UNRESOLVABLE_CONFLICT
COMPLETE_LOCAL
```

Signals (annotations on any state, never states themselves):

```text
ROLLOVER_RECOMMENDED
ROLLOVER_REQUIRED
```

## 2. State ownership

2.1. The universal loop owns the lifecycle. Nested skills, subagents,
models, trackers, and harness-native commands perform bounded subtasks
inside one state. A nested skill reaching its own terminal state MUST NOT
be treated as lifecycle completion.

2.2. After any subtask ends, the loop evaluates exactly one question:
"Does authorized work remain?" If yes, advance to the next valid state.
If no, enter COMPLETE_LOCAL.

## 3. State semantics

- DISCOVER — collect implementation-truth evidence about the repository:
  git topology, instructions, existing artifacts, runtime evidence.
  Read-only.
- RECONCILE — classify every discovered durable artifact (see
  artifacts.md) and resolve conflicts before advancing.
- CLASSIFY — produce a task profile and select the entry state (section 4).
- DIRECT_EXECUTE — perform tiny, deterministic work directly.
- WAYFIND — resolve destination/architecture/product ambiguity. Terminal
  condition: no important unresolved decision remains that must be settled
  before implementation can proceed safely. Finishing a wayfinding artifact
  does NOT end the lifecycle; advance to SPEC when authority remains.
- SPEC — create or update the accepted specification only when required.
  Do not recreate a spec to normalize formatting.
- TICKET — derive bounded, independently verifiable slices from the spec,
  using the project's existing tracker convention.
- IMPLEMENT — change the repository.
- VERIFY — produce deterministic evidence (section 6, truth-model.md
  hierarchy).
- CRITIC — independent evaluation against current intent: acceptance
  criteria, missing cases, scope drift, damage to unrelated behavior,
  evidence sufficiency. Findings must connect to correctness, security,
  regressions, material maintainability, or evidence gaps. Cosmetic
  polishing loops are prohibited. CRITIC implementation hierarchy:
  1. the Matt Pocock `code-review` skill, when available (preferred
     default for substantial work);
  2. an independent fresh subagent/reviewer;
  3. a separate fresh-prompt review pass in the same harness.
  The code-review skill is a bounded capability inside the lifecycle. It
  MUST NOT own the lifecycle, terminate the loop, redefine project
  completion, bypass deterministic verification, or override authority
  gates. A passing review is evidence for the CRITIC gate only.
- REPAIR — fix CRITIC/VERIFY findings, then re-enter VERIFY.
- COMPLETE_LOCAL — all authorized local work is complete and verified.
  Does not imply pushed, merged, deployed, released, or published.
  COMPLETE_LOCAL is a boundary state: the worker MUST NOT advance from it
  automatically. The transition COMPLETE_LOCAL -> PUBLISH_GATE is valid
  only after a new explicit control-plane directive authorizing or
  requesting publication evaluation.
- PUBLISH_GATE — enumerate remaining unauthorized resulting states
  (push, PR, merge, deploy, ...) and request explicit authority. Fail
  closed.

## 4. Entry resolution (CLASSIFY)

Inputs: (a) reconciliation result, (b) task profile
`{ scope: trivial|substantial, clarity: clear|ambiguous }` supplied by the
agent. Resolution is deterministic. Resume rules R1–R6 run first, in
order; the first match wins. If none match, classification rules C1–C4
run, in order.

Resume rules:

- R1. Wayfinder map with unresolved decisions -> WAYFIND.
- R2. Resolved wayfinder map, no accepted spec -> SPEC.
- R3. Accepted spec, no open tickets -> TICKET.
- R4. Open ticket without complete implementation evidence -> IMPLEMENT.
- R5. Implementation evidenced but unverified, or PR with failing checks
  -> VERIFY (enter REPAIR directly when failure evidence is already
  recorded and current). A current recorded verification failure is
  distinct from missing evidence: failure -> REPAIR, missing -> VERIFY.
- R6. Implementation complete and verified, but no current critic pass
  -> CRITIC. A current recorded critic failure -> REPAIR.
- R7. Substantial/ticketed work is COMPLETE_LOCAL only when BOTH current
  verification pass and current critic pass exist.
- R8. Trivial DIRECT_EXECUTE work may complete after verification without
  a mandatory CRITIC pass. Do not invoke heavyweight review for tiny
  deterministic edits.

Evidence freshness is anchored to an implementation fingerprint, not
timestamps and not HEAD alone. In a git repository the fingerprint is a
deterministic hash of: HEAD, the staged tracked diff, the unstaged
tracked diff, and relevant untracked files (path + content hash).
`.agent-loop/` (protocol-owned ephemeral state) is always excluded — even
when tracked — so recording evidence never invalidates itself. Ignored
files are excluded per git semantics. Verification records carry
`fingerprint`; critic records carry `fingerprint` plus the index of the
verification evidence reviewed. Evidence is current only when its
recorded fingerprint equals the repository's current fingerprint: any
implementation mutation — committed, staged, unstaged, or a new relevant
untracked file — stales prior evidence, and re-verification stales a
prior critic pass. Outside a git repository, anchors cannot be disproved
and evidence is accepted at face value. HEAD remains as diagnostic
metadata but is never the sole freshness identity.

Classification rules:

- C1. scope=trivial AND clarity=clear -> DIRECT_EXECUTE.
- C2. scope=substantial AND clarity=ambiguous -> WAYFIND.
- C3. Accepted spec exists with an eligible open ticket -> IMPLEMENT.
- C4. scope=substantial AND clarity=clear, no accepted spec -> SPEC.

Never restart automatically from planning when resumable state exists.
Resume from the earliest unresolved or unverified state.

## 5. Autonomy

Once execution authority exists, continue authorized work without
pausing. Do not stop because a ticket, commit, subagent return, single
test pass, single critic pass, plan creation, skill completion,
checkpoint, or context rollover occurred. Stop only at a boundary state
(section 1) or COMPLETE_LOCAL.

Ordinary implementation uncertainty is not BLOCKED_DECISION. Investigate
first. Escalate only genuine boundaries: missing authority, missing
decision that changes destination/architecture/scope/security/acceptance,
missing credentials, broken environment, unresolvable artifact conflict.

## 6. Context rollover

Rollover is a lifecycle mechanism, not a task failure.

- ROLLOVER_RECOMMENDED: a fresh context would improve reliability;
  current authority remains valid. Do NOT stop authorized work solely for
  this signal.
- ROLLOVER_REQUIRED: continued execution creates concrete continuity or
  correctness risk. Before rollover, persist a durable handoff
  (handoff.md) sufficient for a compatible agent to resume with no
  conversational memory. The loop MUST survive harness/session
  replacement.
