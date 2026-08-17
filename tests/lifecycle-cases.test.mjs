// The 10 required repository-state cases from the UAL v1 directive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { scan } from '../src/scan.js';
import { resolveEntry } from '../src/lifecycle.js';
import { initState, recordVerification, recordCritic, transition } from '../src/state.js';
import { writeHandoff, validateHandoff } from '../src/handoff.js';
import { checkAuthority } from '../src/authority.js';
import { mkRepo, write, commit, spec, ticket, wayfinderMap, installFakeGh, pr } from './helpers.mjs';

function entryFor(root, taskProfile, env) {
  if (env) Object.assign(process.env, env);
  try {
    const evidence = scan(root);
    return {
      entry: resolveEntry(
        { ...evidence.summary, prs: evidence.prs, state: evidence.state, git: evidence.git, fingerprint: evidence.fingerprint },
        taskProfile,
      ),
      evidence,
    };
  } finally {
    if (env) for (const k of Object.keys(env)) delete process.env[k];
  }
}

// Case 1 — new unclear project: no map/spec/tickets, vague substantial request.
test('case 1: new unclear project -> WAYFIND', (t) => {
  const root = mkRepo(t);
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'ambiguous' });
  assert.equal(entry.state, 'WAYFIND');
  assert.equal(entry.rule, 'C2');
});

// Case 2 — existing accepted spec + open ticket: reuse, -> IMPLEMENT.
test('case 2: accepted spec + open ticket -> IMPLEMENT, artifacts reused', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-build-x.md', ticket({ status: 'open', boxes: [[false, 'implement x']] }));
  commit(root, 'add spec and ticket');
  const { entry, evidence } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'IMPLEMENT');
  assert.equal(evidence.summary.specs[0].class, 'CURRENT');
  assert.equal(evidence.summary.specs.length, 1); // no duplicate spec needed
});

// Case 3 — partially implemented ticket: resume earliest unresolved state.
test('case 3: partial ticket -> IMPLEMENT (resume, not restart)', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-build-x.md', ticket({ status: 'in-progress', boxes: [[true, 'scaffold'], [false, 'core logic']] }));
  write(root, 'src/x.js', 'export const x = 1;\n');
  commit(root, 'spec, ticket, partial impl');
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'IMPLEMENT');
  assert.equal(entry.rule, 'R4');
});

// Case 4 — existing PR with failing tests -> VERIFY/REPAIR, never new spec.
test('case 4: PR with failing checks -> REPAIR (not SPEC)', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-build-x.md', ticket({ status: 'done', boxes: [[true, 'implement x']], verification: ['npm test: pass'] }));
  commit(root, 'work done');
  const gh = installFakeGh(t, [pr({ number: 7, conclusion: 'FAILURE' })]);
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'clear' }, gh.env);
  assert.equal(entry.state, 'REPAIR');
  assert.notEqual(entry.state, 'SPEC');
});

// Case 5 — conflicting old spec and newer accepted spec: old SUPERSEDED.
test('case 5: old spec superseded by newer accepted spec', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-old.md', spec({ topic: 'feature-x', status: 'accepted', extra: 'id: spec-old\n' }));
  write(root, 'docs/spec-new.md', spec({ topic: 'feature-x', status: 'accepted', supersedes: ['spec-old'], extra: 'id: spec-new\n' }));
  commit(root, 'specs');
  const { evidence } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  const old = evidence.summary.specs.find((s) => s.path.includes('old'));
  const neu = evidence.summary.specs.find((s) => s.path.includes('new'));
  assert.equal(old.class, 'SUPERSEDED');
  assert.equal(neu.class, 'CURRENT');
});

// Case 6 — dirty tree with unrelated work: preserved, reported, never touched.
test('case 6: dirty unrelated work is reported and preserved', (t) => {
  const root = mkRepo(t);
  write(root, 'unrelated.txt', 'user work in progress\n');
  const statusBefore = execFileSync('git', ['-C', root, 'status', '--porcelain=v1'], { encoding: 'utf8' });
  const evidence = scan(root);
  assert.equal(evidence.git.dirty, true);
  assert.ok(evidence.git.untracked.includes('unrelated.txt'));
  const statusAfter = execFileSync('git', ['-C', root, 'status', '--porcelain=v1'], { encoding: 'utf8' });
  assert.equal(statusAfter, statusBefore); // scan must not mutate the tree
});

// Case 7a — substantial ticketed work, verification pass, NO critic pass
// -> CRITIC (completion is not reachable without the critic gate).
test('case 7a: verified substantial work without critic -> CRITIC', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-build-x.md', ticket({ status: 'done', boxes: [[true, 'implement x']], verification: ['npm test: pass'] }));
  commit(root, 'done');
  initState(root, { project: 'fixture', task: 'x', authority: ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT'] });
  recordVerification(root, 'npm test', 'pass');
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'CRITIC');
  assert.notEqual(entry.state, 'COMPLETE_LOCAL');
});

// Case 7b — current verification + current critic pass -> COMPLETE_LOCAL;
// PUSH still denied without grant.
test('case 7b: verified + current critic pass -> COMPLETE_LOCAL; PUSH denied', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-build-x.md', ticket({ status: 'done', boxes: [[true, 'implement x']], verification: ['npm test: pass'] }));
  commit(root, 'done');
  initState(root, { project: 'fixture', task: 'x', authority: ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT'] });
  recordVerification(root, 'npm test', 'pass');
  recordCritic(root, { result: 'pass', method: 'code-review' });
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'COMPLETE_LOCAL');
  const gate = checkAuthority(['PUSH'], ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT']);
  assert.equal(gate.allGranted, false);
  assert.equal(gate.results[0].decision, 'deny');
});

// Case 7c — implementation changed AFTER a critic pass: stale critic must
// never bless new code. New commit -> VERIFY (verification also stale);
// after re-verifying, stale critic -> CRITIC, still not COMPLETE_LOCAL.
test('case 7c: implementation change after critic pass invalidates completion', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-build-x.md', ticket({ status: 'done', boxes: [[true, 'implement x']], verification: ['npm test: pass'] }));
  commit(root, 'done');
  initState(root, { project: 'fixture', task: 'x', authority: ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT'] });
  recordVerification(root, 'npm test', 'pass');
  recordCritic(root, { result: 'pass', method: 'code-review' });
  assert.equal(entryFor(root, { scope: 'substantial', clarity: 'clear' }).entry.state, 'COMPLETE_LOCAL');

  // implementation changes after the critic pass
  write(root, 'src/late-change.js', 'export const late = 1;\n');
  commit(root, 'late change after critic');
  assert.equal(entryFor(root, { scope: 'substantial', clarity: 'clear' }).entry.state, 'VERIFY');

  // re-verify at the new head; critic is still anchored to the old head
  // and the old verification index -> CRITIC, not completion.
  recordVerification(root, 'npm test', 'pass');
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'CRITIC');
  assert.notEqual(entry.state, 'COMPLETE_LOCAL');
});

// Case 7d — trivial DIRECT_EXECUTE work completes after verification
// without a mandatory CRITIC pass.
test('case 7d: trivial work completes after verification without critic', (t) => {
  const root = mkRepo(t);
  initState(root, { project: 'fixture', task: 'fix typo', authority: ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT'] });
  write(root, 'README.md', '# fixture (typo fixed)\n');
  commit(root, 'fix typo');
  recordVerification(root, 'git diff --check', 'pass');
  const { entry } = entryFor(root, { scope: 'trivial', clarity: 'clear', summary: 'fix one typo' });
  assert.equal(entry.state, 'COMPLETE_LOCAL');
  assert.equal(entry.rule, 'R8');
});

// Case 8 — context rollover: fresh agent resumes from durable state.
test('case 8: rollover handoff lets a fresh session resume', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-build-x.md', ticket({ status: 'in-progress', boxes: [[true, 'a'], [false, 'b']] }));
  commit(root, 'partial');
  initState(root, { project: 'fixture', task: 'x', authority: ['READ', 'LOCAL_EDIT', 'LOCAL_TEST'] });
  transition(root, 'RECONCILE');
  transition(root, 'CLASSIFY');
  transition(root, 'IMPLEMENT');
  const file = writeHandoff(root, {
    slug: 'rollover',
    destination: 'ship feature x per accepted spec',
    completed_work: ['scaffold'],
    remaining_work: ['core logic'],
    next_valid_action: 'implement core logic in tickets/1-build-x.md',
    withheld: ['PUSH', 'CREATE_PR'],
  });
  commit(root, 'durable state');
  // "fresh agent": re-reads from disk only
  const v = validateHandoff(file);
  assert.equal(v.valid, true, v.diagnostics.join('; '));
  const { entry, evidence } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'IMPLEMENT'); // resumed, not restarted
  assert.equal(evidence.state.lifecycle_state, 'IMPLEMENT');
  assert.ok(evidence.summary.handoffs.length >= 1);
});

// Case 9 — unresolved wayfinder map -> resume WAYFIND.
test('case 9: unresolved wayfinder map -> WAYFIND', (t) => {
  const root = mkRepo(t);
  write(root, 'wayfinder/map.md', wayfinderMap({ status: 'active', unresolved: ['storage-engine', 'api-shape'] }));
  commit(root, 'map');
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'ambiguous' });
  assert.equal(entry.state, 'WAYFIND');
  assert.equal(entry.rule, 'R1');
});

// Case 10 — resolved wayfinder + spec + tickets: do NOT restart wayfinder.
test('case 10: resolved map + spec + tickets -> IMPLEMENT', (t) => {
  const root = mkRepo(t);
  write(root, 'wayfinder/map.md', wayfinderMap({ status: 'resolved', unresolved: [] }));
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-build-x.md', ticket({ status: 'open', boxes: [[false, 'implement x']] }));
  commit(root, 'planned');
  const { entry } = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'IMPLEMENT');
  assert.notEqual(entry.state, 'WAYFIND');
});
