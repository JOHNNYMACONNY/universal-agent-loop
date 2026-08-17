// Canonical lifecycle: states, transitions, entry resolution (lifecycle.md).
export const STATES = [
  'DISCOVER', 'RECONCILE', 'CLASSIFY', 'DIRECT_EXECUTE', 'WAYFIND', 'SPEC',
  'TICKET', 'IMPLEMENT', 'VERIFY', 'CRITIC', 'REPAIR', 'COMPLETE_LOCAL',
  'PUBLISH_GATE',
];

export const BOUNDARY_STATES = [
  'BLOCKED_EXTERNAL_AUTH', 'BLOCKED_DECISION', 'BLOCKED_CREDENTIAL',
  'BLOCKED_ENVIRONMENT', 'BLOCKED_UNRESOLVABLE_CONFLICT', 'COMPLETE_LOCAL',
];

export const SIGNALS = ['ROLLOVER_RECOMMENDED', 'ROLLOVER_REQUIRED'];

// Valid transitions. Any state may enter a BLOCKED_* boundary state.
const EDGES = {
  DISCOVER: ['RECONCILE'],
  RECONCILE: ['CLASSIFY'],
  CLASSIFY: ['DIRECT_EXECUTE', 'WAYFIND', 'SPEC', 'TICKET', 'IMPLEMENT', 'VERIFY', 'CRITIC', 'REPAIR'],
  DIRECT_EXECUTE: ['VERIFY'],
  WAYFIND: ['SPEC'],
  SPEC: ['TICKET'],
  TICKET: ['IMPLEMENT'],
  IMPLEMENT: ['VERIFY'],
  // VERIFY -> COMPLETE_LOCAL permitted for trivial DIRECT_EXECUTE work.
  VERIFY: ['CRITIC', 'REPAIR', 'COMPLETE_LOCAL'],
  CRITIC: ['REPAIR', 'COMPLETE_LOCAL'],
  REPAIR: ['VERIFY'],
  COMPLETE_LOCAL: ['PUBLISH_GATE'],
  PUBLISH_GATE: [],
};

export function isValidTransition(from, to) {
  if (to === 'COMPLETE_LOCAL') {
    // completion is reachable only from VERIFY, CRITIC, or PUBLISH_GATE
    return ['VERIFY', 'CRITIC', 'PUBLISH_GATE'].includes(from);
  }
  if (BOUNDARY_STATES.includes(to)) return true; // any state may enter a BLOCKED_* boundary
  return (EDGES[from] || []).includes(to);
}

// Entry resolution. `reconciled` is the summary produced by scan().
// `taskProfile` = { scope: trivial|substantial, clarity: clear|ambiguous }.
// Returns { state, rule, rationale }.
export function resolveEntry(reconciled, taskProfile = {}) {
  const { maps = [], specs = [], tickets = [], prs = [], state: stateFile } = reconciled;
  const scope = taskProfile.scope || null;
  const clarity = taskProfile.clarity || null;

  const live = (a) => a.class !== 'SUPERSEDED' && a.class !== 'STALE';
  const activeMaps = maps.filter((m) => live(m) && m.unresolved.length > 0);
  const resolvedMaps = maps.filter((m) => live(m) && m.unresolved.length === 0
    && (m.status === 'resolved' || m.status === 'current' || m.class === 'CURRENT'));
  const acceptedSpecs = specs.filter((s) => live(s) && s.status === 'accepted');
  const conflicting = [...maps, ...specs, ...tickets].filter((a) => a.class === 'CONFLICTING');
  const openTickets = tickets.filter((t) => live(t) && !['done', 'complete', 'completed', 'closed'].includes(t.status));
  const partialTickets = openTickets.filter((t) => t.class === 'PARTIAL');
  const ticketComplete = (t) => ['done', 'complete', 'completed', 'closed'].includes(t.status)
    || (t.checked > 0 && t.unchecked === 0);
  const completeTickets = tickets.filter((t) => live(t) && ticketComplete(t));

  const latestVerification = stateFile && Array.isArray(stateFile.verification) && stateFile.verification.length
    ? stateFile.verification[stateFile.verification.length - 1]
    : null;
  const critic = (stateFile && stateFile.critic) || null;
  const gitHead = reconciled.git && reconciled.git.isRepo ? reconciled.git.head : null;

  // Freshness anchoring (lifecycle.md): evidence recorded against a HEAD
  // that no longer matches is stale. In a git repo, a missing anchor can
  // never bless current implementation. Without git, anchors cannot be
  // disproved, so evidence is accepted at face value.
  const anchorCurrent = (rec) => {
    if (!rec) return false;
    if (!gitHead) return true;
    return rec.head === gitHead;
  };
  const ciVerified = prs.length > 0 && prs.every((p) => p.checks === 'passing');
  const verifiedCurrent = ciVerified
    || !!(latestVerification && latestVerification.result === 'pass' && anchorCurrent(latestVerification));
  const verificationFailed = !!(latestVerification && latestVerification.result === 'fail' && anchorCurrent(latestVerification));
  const criticCurrent = !!(critic && critic.result === 'pass'
    && anchorCurrent(critic)
    && stateFile && Array.isArray(stateFile.verification)
    && critic.verification_index === stateFile.verification.length - 1);
  const criticFailed = !!(critic && critic.result === 'fail' && anchorCurrent(critic));

  // Unresolvable conflict beats everything.
  if (conflicting.length >= 2) {
    return {
      state: 'BLOCKED_UNRESOLVABLE_CONFLICT',
      rule: 'K2',
      rationale: `conflicting artifacts: ${conflicting.map((a) => a.path).join(', ')}`,
    };
  }

  // R1: unresolved wayfinder decisions.
  if (activeMaps.length) {
    return { state: 'WAYFIND', rule: 'R1', rationale: `map ${activeMaps[0].path} has unresolved decisions: ${activeMaps[0].unresolved.join(', ')}` };
  }

  // R2: resolved map, no accepted spec.
  if (resolvedMaps.length && acceptedSpecs.length === 0) {
    return { state: 'SPEC', rule: 'R2', rationale: `map ${resolvedMaps[0].path} resolved; no accepted spec` };
  }

  // R3: accepted spec, no open tickets.
  if (acceptedSpecs.length && openTickets.length === 0 && completeTickets.length === 0) {
    return { state: 'TICKET', rule: 'R3', rationale: `accepted spec ${acceptedSpecs[0].path}; no tickets yet` };
  }

  // R5a: open PR with failing checks -> REPAIR (failure evidence is current).
  const failingPr = prs.find((p) => p.checks === 'failing');
  if (failingPr) {
    return { state: 'REPAIR', rule: 'R5', rationale: `PR #${failingPr.number} has failing checks` };
  }

  // PR checks pending/unknown -> VERIFY (evidence not yet available).
  const pendingPr = prs.find((p) => p.checks !== 'passing');
  if (pendingPr) {
    return { state: 'VERIFY', rule: 'R5', rationale: `PR #${pendingPr.number} checks pending or unavailable` };
  }

  // R4: open/partial ticket work remains -> IMPLEMENT. Earliest unresolved
  // state wins over verifying already-claimed-complete work (R5 below).
  if (partialTickets.length) {
    return { state: 'IMPLEMENT', rule: 'R4', rationale: `partial ticket ${partialTickets[0].path}` };
  }
  if (openTickets.length && acceptedSpecs.length) {
    return { state: 'IMPLEMENT', rule: 'C3', rationale: `accepted spec with eligible ticket ${openTickets[0].path}` };
  }

  // R5c: a CURRENT recorded verification failure wins over generic
  // unverified handling: fail -> REPAIR. (Finding 2.)
  if (verificationFailed) {
    return { state: 'REPAIR', rule: 'R5', rationale: 'current verification evidence recorded as fail' };
  }

  // R6c: a current CRITIC failure -> REPAIR (findings feed the repair loop).
  if (criticFailed) {
    return { state: 'REPAIR', rule: 'R6', rationale: 'current critic pass recorded as fail' };
  }

  // Completion evaluation for substantial/ticketed work (Finding 3):
  //   implementation complete + current verification + no critic  -> CRITIC
  //   + current critic pass                                        -> COMPLETE_LOCAL
  const workItemsExist = tickets.length > 0 || prs.length > 0;
  const prsDone = prs.every((p) => p.checks === 'passing');
  if (workItemsExist && openTickets.length === 0 && prsDone) {
    if (!verifiedCurrent) {
      return { state: 'VERIFY', rule: 'R5', rationale: 'implementation claimed complete; current verification evidence missing' };
    }
    if (!criticCurrent) {
      return { state: 'CRITIC', rule: 'R6', rationale: 'verification current; critic pass missing or stale' };
    }
    return { state: 'COMPLETE_LOCAL', rule: 'R7', rationale: 'tickets done; verification and critic pass are current' };
  }

  // R8: trivial DIRECT_EXECUTE work may complete after verification
  // without a mandatory CRITIC pass.
  if (tickets.length === 0 && prs.length === 0 && scope === 'trivial' && verifiedCurrent) {
    return { state: 'COMPLETE_LOCAL', rule: 'R8', rationale: 'trivial work verified; CRITIC not required' };
  }

  // Classification of fresh work.
  if (scope === 'trivial' && clarity === 'clear') {
    return { state: 'DIRECT_EXECUTE', rule: 'C1', rationale: 'trivial, clear task' };
  }
  if (scope === 'substantial' && clarity === 'ambiguous') {
    return { state: 'WAYFIND', rule: 'C2', rationale: 'substantial, ambiguous task' };
  }
  if (scope === 'substantial' && clarity === 'clear' && acceptedSpecs.length === 0) {
    return { state: 'SPEC', rule: 'C4', rationale: 'substantial clear task without accepted spec' };
  }
  if (scope === 'trivial' && clarity === 'ambiguous') {
    return { state: 'CLASSIFY', rule: 'C0', rationale: 'trivial but ambiguous: clarify scope before executing' };
  }
  return { state: 'SPEC', rule: 'C4-default', rationale: 'defaulting to SPEC for unresolved substantial work' };
}
