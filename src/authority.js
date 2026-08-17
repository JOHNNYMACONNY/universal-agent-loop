// Authority model (authority.md). Fail closed on unknown/irreversible.
export const ACTIONS = [
  'READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT', 'BRANCH_CREATE',
  'WORKTREE_CREATE', 'PUSH', 'CREATE_PR', 'UPDATE_PR', 'MERGE', 'DEPLOY',
  'PRODUCTION_MUTATION', 'EXTERNAL_PUBLICATION', 'SECRET_OR_CREDENTIAL_ACTION',
];

export const PUBLIC_IRREVERSIBLE = [
  'PUSH', 'CREATE_PR', 'UPDATE_PR', 'MERGE', 'DEPLOY', 'PRODUCTION_MUTATION',
  'EXTERNAL_PUBLICATION', 'SECRET_OR_CREDENTIAL_ACTION',
];

// Safe local defaults when the task clearly authorizes implementation.
export const LOCAL_DEFAULTS = ['READ', 'LOCAL_EDIT', 'LOCAL_TEST'];

export function checkAuthority(requested, grants) {
  const granted = new Set((grants || []).map((g) => g.toUpperCase()));
  const results = requested.map((raw) => {
    const action = raw.toUpperCase();
    if (!ACTIONS.includes(action)) {
      return { action: raw, decision: 'deny', reason: 'unknown action' };
    }
    if (granted.has(action)) {
      return { action, decision: 'allow', reason: 'granted' };
    }
    const reason = PUBLIC_IRREVERSIBLE.includes(action)
      ? 'not in granted set (irreversible/public actions fail closed)'
      : 'not in granted set';
    return { action, decision: 'deny', reason };
  });
  return { allGranted: results.every((r) => r.decision === 'allow'), results };
}
