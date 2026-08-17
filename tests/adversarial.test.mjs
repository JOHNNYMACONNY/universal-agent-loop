// Adversarial failure modes from the UAL v1 directive. Each test asserts
// the engine makes the failure mode impossible or visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { scan } from '../src/scan.js';
import { resolveEntry, isValidTransition } from '../src/lifecycle.js';
import { checkAuthority, PUBLIC_IRREVERSIBLE, ACTIONS } from '../src/authority.js';
import { initState, transition, readState } from '../src/state.js';
import { writeHandoff } from '../src/handoff.js';
import { mkRepo, write, commit, head, spec, ticket, wayfinderMap, handoffDoc, installFakeGh, pr } from './helpers.mjs';

function entryFor(root, taskProfile, env) {
  if (env) Object.assign(process.env, env);
  try {
    const evidence = scan(root);
    return {
      entry: resolveEntry(
        { ...evidence.summary, prs: evidence.prs, state: evidence.state, git: evidence.git },
        taskProfile,
      ),
      evidence,
    };
  } finally {
    if (env) for (const k of Object.keys(env)) delete process.env[k];
  }
}

// A1: agent creates duplicate spec — entry resolver must never route to
// SPEC when an accepted spec already exists.
test('A1: accepted spec exists -> entry is never SPEC', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-build-x.md', ticket({ status: 'open', boxes: [[false, 'do it']] }));
  commit(root, 'planned');
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.notEqual(entry.state, 'SPEC');
});

// A2: agent trusts stale handoff over git — handoff with a recorded head
// that no longer matches must classify STALE.
test('A2: handoff contradicting git state -> STALE', (t) => {
  const root = mkRepo(t);
  const oldHead = head(root);
  write(root, 'src/x.js', 'export let x = 1;\n');
  commit(root, 'move head forward');
  assert.notEqual(head(root), oldHead);
  write(root, '.agent-loop/handoffs/20260101-000000-old.md', handoffDoc({ head: oldHead, branch: 'main' }));
  const evidence = scan(root);
  const ho = evidence.summary.handoffs[0];
  assert.equal(ho.class, 'STALE');
});

// A3: ticket completion treated as project completion — one open ticket
// remains, so entry must not be COMPLETE_LOCAL.
test('A3: one ticket done, another open -> not COMPLETE_LOCAL', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-a.md', ticket({ title: 'a', status: 'done', boxes: [[true, 'a']], verification: ['npm test: pass'] }));
  write(root, 'tickets/2-b.md', ticket({ title: 'b', status: 'open', boxes: [[false, 'b']] }));
  commit(root, 'one done, one open');
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'IMPLEMENT');
  assert.notEqual(entry.state, 'COMPLETE_LOCAL');
});

// A4: push without authority — every irreversible/public action fails
// closed when absent from grants.
test('A4: irreversible/public actions fail closed', () => {
  for (const action of PUBLIC_IRREVERSIBLE) {
    const r = checkAuthority([action], ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT']);
    assert.equal(r.results[0].decision, 'deny', `${action} must deny without explicit grant`);
  }
  const ok = checkAuthority(['PUSH'], ['READ', 'PUSH']);
  assert.equal(ok.allGranted, true);
  const unknown = checkAuthority(['RM_RF_EVERYTHING'], ACTIONS);
  assert.equal(unknown.results[0].decision, 'deny');
});

// A5: agent resets unrelated dirty files — the engine exposes no mutation
// surface at all, and read-only commands leave the tree untouched.
test('A5: engine has no repo-mutating command; dirty files survive all reads', (t) => {
  const root = mkRepo(t);
  write(root, 'precious.txt', 'do not lose me\n');
  execFileSync('git', ['-C', root, 'add', 'precious.txt']); // partially staged
  const before = execFileSync('git', ['-C', root, 'status', '--porcelain=v1'], { encoding: 'utf8' });
  scan(root);
  scan(root);
  entryFor(root, { scope: 'trivial', clarity: 'clear' });
  const after = execFileSync('git', ['-C', root, 'status', '--porcelain=v1'], { encoding: 'utf8' });
  assert.equal(after, before);
  assert.match(after, /precious\.txt/);
});

// A6: nested skill finished != lifecycle finished — a resolved wayfinder
// map must advance to SPEC, never to COMPLETE_LOCAL.
test('A6: resolved map advances to SPEC, not completion', (t) => {
  const root = mkRepo(t);
  write(root, 'wayfinder/map.md', wayfinderMap({ status: 'resolved' }));
  commit(root, 'map done');
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'ambiguous' });
  assert.equal(entry.state, 'SPEC');
  assert.equal(entry.rule, 'R2');
  assert.notEqual(entry.state, 'COMPLETE_LOCAL');
});

// A7: silent architecture change — two accepted specs on the same topic
// without supersedure must surface as CONFLICTING and block.
test('A7: conflicting accepted specs -> BLOCKED_UNRESOLVABLE_CONFLICT', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-a.md', spec({ topic: 'storage', status: 'accepted', extra: 'id: spec-a\n' }));
  write(root, 'docs/spec-b.md', spec({ topic: 'storage', status: 'accepted', extra: 'id: spec-b\n' }));
  commit(root, 'conflicting specs');
  const { entry, evidence } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'BLOCKED_UNRESOLVABLE_CONFLICT');
  assert.ok(evidence.summary.specs.every((s) => s.class === 'CONFLICTING'));
});

// A8: wayfinder for a trivial typo — trivial+clear must not enter WAYFIND.
test('A8: trivial typo -> DIRECT_EXECUTE, never WAYFIND', (t) => {
  const root = mkRepo(t);
  const { entry } = entryFor(root, { scope: 'trivial', clarity: 'clear', summary: 'fix typo in README' });
  assert.equal(entry.state, 'DIRECT_EXECUTE');
});

// A9: skipping wayfinder for a major ambiguous architecture request.
test('A9: major ambiguous architecture request -> WAYFIND', (t) => {
  const root = mkRepo(t);
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'ambiguous', summary: 'rebuild the storage layer, not sure how' });
  assert.equal(entry.state, 'WAYFIND');
});

// A10: self-report as proof — ticket claims done with no evidence anywhere
// must classify UNVERIFIED and route to VERIFY, not COMPLETE_LOCAL.
test('A10: done-without-evidence -> UNVERIFIED + VERIFY', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-a.md', ticket({ title: 'a', status: 'done', boxes: [[true, 'a']] })); // no verification
  commit(root, 'claims done');
  const { entry, evidence } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(evidence.summary.tickets[0].class, 'UNVERIFIED');
  assert.equal(entry.state, 'VERIFY');
});

// A11: state loss after rollover — durable state survives "session
// replacement" (fresh reads from disk) and handoff validates.
test('A11: state survives session replacement', (t) => {
  const root = mkRepo(t);
  write(root, 'tickets/1-a.md', ticket({ title: 'a', status: 'in-progress', boxes: [[true, 'a'], [false, 'b']] }));
  commit(root, 'partial');
  initState(root, { project: 'fixture', task: 'build x', authority: ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT'] });
  transition(root, 'RECONCILE');
  transition(root, 'CLASSIFY');
  transition(root, 'IMPLEMENT');
  const handoffFile = writeHandoff(root, { slug: 'session-replace' });
  commit(root, 'persist');
  // simulated fresh session: only disk state
  const state = readState(root);
  assert.equal(state.lifecycle_state, 'IMPLEMENT');
  assert.deepEqual(state.authority, ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT']);
  assert.ok(handoffFile.includes('.agent-loop/handoffs/'));
  // illegal transition is refused, protecting the record
  const bad = transition(root, 'PUBLISH_GATE');
  assert.equal(bad.ok, false);
});

// Finding 2 regression: completed implementation + CURRENT verification
// result of fail -> REPAIR, never VERIFY. Missing result -> VERIFY.
test('F2: current verification failure -> REPAIR; missing -> VERIFY', async (t) => {
  const { initState, recordVerification } = await import('../src/state.js');
  const root = mkRepo(t);
  write(root, 'tickets/1-a.md', ticket({ title: 'a', status: 'done', boxes: [[true, 'a']], verification: ['npm test: pass'] }));
  commit(root, 'claimed done');
  initState(root, { project: 'p', task: 't', authority: ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT'] });

  // missing verification result -> VERIFY
  let r = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(r.entry.state, 'VERIFY');

  // current verification failure -> REPAIR
  recordVerification(root, 'npm test', 'fail');
  r = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(r.entry.state, 'REPAIR');
  assert.notEqual(r.entry.state, 'VERIFY');
});

// Finding 1 regression: an autonomous worker must NOT leave
// COMPLETE_LOCAL on its own. COMPLETE_LOCAL -> PUBLISH_GATE is valid only
// with an explicit control-plane directive.
test('F1: COMPLETE_LOCAL is a boundary; PUBLISH_GATE needs control-plane directive', async (t) => {
  const { initState, transition, recordVerification, recordCritic, readState } = await import('../src/state.js');
  const root = mkRepo(t);
  write(root, 'tickets/1-a.md', ticket({ title: 'a', status: 'done', boxes: [[true, 'a']], verification: ['npm test: pass'] }));
  commit(root, 'done');
  initState(root, { project: 'p', task: 't', authority: ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT', 'PUSH'] });
  recordVerification(root, 'npm test', 'pass');
  recordCritic(root, { result: 'pass', method: 'code-review' });

  // Resolver reaches COMPLETE_LOCAL and must never emit PUBLISH_GATE.
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'COMPLETE_LOCAL');

  // Walk the lifecycle to COMPLETE_LOCAL legitimately.
  for (const s of ['RECONCILE', 'CLASSIFY', 'IMPLEMENT', 'VERIFY', 'CRITIC']) {
    assert.equal(transition(root, s).ok, true, `transition to ${s}`);
  }
  assert.equal(transition(root, 'COMPLETE_LOCAL').ok, true);

  // Autonomous advance is refused, even with PUSH in the granted set.
  const auto = transition(root, 'PUBLISH_GATE');
  assert.equal(auto.ok, false);
  assert.equal(readState(root).lifecycle_state, 'COMPLETE_LOCAL');

  // Explicit control-plane directive permits the transition.
  const directed = transition(root, 'PUBLISH_GATE', 'control plane authorized publication evaluation', { controlPlaneDirective: true });
  assert.equal(directed.ok, true);
  assert.equal(readState(root).lifecycle_state, 'PUBLISH_GATE');
});

// Invalid lifecycle transitions are rejected by the state store.
test('transitions enforce lifecycle edges', (t) => {
  assert.equal(isValidTransition('DISCOVER', 'RECONCILE'), true);
  assert.equal(isValidTransition('DISCOVER', 'IMPLEMENT'), false);
  assert.equal(isValidTransition('IMPLEMENT', 'SPEC'), false);
  assert.equal(isValidTransition('VERIFY', 'COMPLETE_LOCAL'), true); // trivial path
  assert.equal(isValidTransition('CLASSIFY', 'BLOCKED_DECISION'), true);
  assert.equal(isValidTransition('TICKET', 'COMPLETE_LOCAL'), false);
});

// Green PR without critic pass routes to CRITIC.
test('green PR, no critic pass -> CRITIC', (t) => {
  const root = mkRepo(t);
  write(root, 'tickets/1-a.md', ticket({ title: 'a', status: 'done', boxes: [[true, 'a']], verification: ['npm test: pass'] }));
  commit(root, 'done');
  const gh = installFakeGh(t, [pr({ number: 3, conclusion: 'SUCCESS' })]);
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'clear' }, gh.env);
  assert.equal(entry.state, 'CRITIC');
});
