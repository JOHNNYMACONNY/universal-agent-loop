# UAL Authority Model

Version: 1.

## 1. Actions

Authorities are separate permissions. None is inferred from another.

```text
READ                        read repository and environment
LOCAL_EDIT                  modify files in the working tree
LOCAL_TEST                  run tests/builds/tools locally
LOCAL_COMMIT                create local commits
BRANCH_CREATE               create local branches
WORKTREE_CREATE             create local worktrees
PUSH                        push to a remote
CREATE_PR                   open a pull/merge request
UPDATE_PR                   push to or edit an existing PR
MERGE                       merge a PR or branch into a shared branch
DEPLOY                      deploy to any shared environment
PRODUCTION_MUTATION         mutate production data/infra
EXTERNAL_PUBLICATION        publish packages, posts, releases
SECRET_OR_CREDENTIAL_ACTION read/use/create secrets or credentials
```

## 2. Rules

- A1. Authorization to implement locally does NOT authorize push, PR,
  merge, deploy, or production mutation.
- A2. Fail closed when authority is genuinely unknown for irreversible or
  public actions: PUSH, CREATE_PR, UPDATE_PR, MERGE, DEPLOY,
  PRODUCTION_MUTATION, EXTERNAL_PUBLICATION, SECRET_OR_CREDENTIAL_ACTION.
- A3. Do NOT fail closed for ordinary local read/test/edit actions when
  the surrounding task clearly authorizes implementation.
- A4. Record the granted set explicitly (state file `authority` field or
  session record). An action not in the granted set is denied.
- A5. Reaching PUBLISH_GATE with missing authority yields
  BLOCKED_EXTERNAL_AUTH with an enumeration of the exact actions
  requested, never a silent skip.
- A6. Denied actions are reported, not retried with euphemisms.
- A7. Verification and critic evidence never expands the authority set.
  A passing review is evidence for the CRITIC gate, not a grant of push,
  merge, or publication rights.

## 3. Engine behavior

`agent-loop authority check <ACTION...>` exits 0 when every listed action
is granted, 1 otherwise, printing a JSON decision per action:
`{ "action": "PUSH", "decision": "deny", "reason": "not in granted set" }`.

Grants come from `--grants` or the state file. Absent grants for the
irreversible/public set are always `deny`.
