# UAL Handoff Format

Version: 1.

## 1. Purpose

A handoff is the durable state that lets a fresh compatible agent resume
the loop after context rollover or session replacement, with no
conversational memory.

## 2. Location

`.agent-loop/handoffs/<yyyymmdd-hhmmss>-<slug>.md`. Markdown with YAML
frontmatter. Create only when rollover is required or requested.

## 3. Required frontmatter fields

```yaml
---
ual_handoff: 1
project: <repo or project name>
task: <one-line task summary>
lifecycle_state: <canonical state name>
destination: <accepted destination, one paragraph max>
artifacts:                  # references, never copies
  current_spec: <path|ref|null>
  current_ticket: <path|ref|null>
  current_pr: <path|ref|null>
  wayfinder_map: <path|ref|null>
completed_work: [<short strings>]
remaining_work: [<short strings>]
branch: <current branch or null>
worktree: <worktree path>
commits: [<relevant shas, newest first>]
verification: [{ command, result, at }]
known_failures: [<short strings>]
authority:
  granted: [<UAL action names>]
  withheld: [<UAL action names>]
next_valid_action: <single concrete next action>
created_at: <ISO-8601>
---
```

Body: at most one short section of context that is not derivable from
the referenced artifacts. Redact secrets and credentials. Reference
artifacts by path/URL; do not duplicate their content.

## 4. Resume rule

A resuming agent runs DISCOVER + RECONCILE, reads the newest handoff, and
classifies it under artifacts.md (K3 staleness check against git facts is
mandatory). Fresh git evidence outranks handoff content
(truth-model.md §3). Resume from the earliest unresolved or unverified
state — never restart planning automatically.

## 5. Engine behavior

`agent-loop handoff validate <file>` exits 0 when all required fields are
present and non-empty, 1 otherwise, printing JSON diagnostics.
`agent-loop handoff write` scaffolds a conforming handoff from the state
file plus explicit overrides.
