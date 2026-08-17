// Finding 4 regressions: evidence freshness must follow the implementation
// fingerprint (HEAD + staged diff + unstaged diff + relevant untracked
// files), not HEAD alone. Protocol-owned .agent-loop writes excluded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { scan } from '../src/scan.js';
import { resolveEntry } from '../src/lifecycle.js';
import { initState, recordVerification, recordCritic, readState } from '../src/state.js';
import { implementationFingerprint } from '../src/git.js';
import { mkRepo, write, commit, ticket } from './helpers.mjs';

function entryFor(root, taskProfile) {
  const evidence = scan(root);
  return resolveEntry(
    { ...evidence.summary, prs: evidence.prs, state: evidence.state, git: evidence.git, fingerprint: evidence.fingerprint },
    taskProfile,
  );
}

// Fixture: substantial ticketed work, fully verified + critic-passed.
function verifiedRepo(t) {
  const root = mkRepo(t);
  write(root, 'tickets/1-a.md', ticket({ title: 'a', status: 'done', boxes: [[true, 'a']], verification: ['npm test: pass'] }));
  write(root, 'src/impl.js', 'export const a = 1;\n');
  commit(root, 'implementation done');
  initState(root, { project: 'p', task: 't', authority: ['READ', 'LOCAL_EDIT', 'LOCAL_TEST', 'LOCAL_COMMIT'] });
  recordVerification(root, 'npm test', 'pass');
  recordCritic(root, { result: 'pass', method: 'code-review' });
  assert.equal(entryFor(root, { scope: 'substantial', clarity: 'clear' }).state, 'COMPLETE_LOCAL');
  return root;
}

test('F4-1: tracked unstaged mutation without commit stales evidence', (t) => {
  const root = verifiedRepo(t);
  write(root, 'src/impl.js', 'export const a = 2; // changed after review\n');
  const entry = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'VERIFY');
  assert.notEqual(entry.state, 'COMPLETE_LOCAL');
});

test('F4-2: staged mutation without commit stales evidence', (t) => {
  const root = verifiedRepo(t);
  write(root, 'src/impl.js', 'export const a = 3;\n');
  execFileSync('git', ['-C', root, 'add', 'src/impl.js']);
  const entry = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'VERIFY');
});

test('F4-3: new relevant untracked implementation file stales evidence', (t) => {
  const root = verifiedRepo(t);
  write(root, 'src/new-module.js', 'export const b = 1;\n'); // untracked, not committed
  const entry = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'VERIFY');
});

test('F4-4: unchanged worktree keeps evidence current', (t) => {
  const root = verifiedRepo(t);
  const entry = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'COMPLETE_LOCAL');
  // fingerprint is stable across repeated reads
  assert.equal(implementationFingerprint(root), implementationFingerprint(root));
});

test('F4-5: commit after evidence stales evidence (as before)', (t) => {
  const root = verifiedRepo(t);
  write(root, 'src/impl.js', 'export const a = 4;\n');
  commit(root, 'new commit after evidence');
  const entry = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'VERIFY');
});

test('F4-6: after mutation, fresh verification requires fresh critic', (t) => {
  const root = verifiedRepo(t);
  write(root, 'src/impl.js', 'export const a = 5;\n');
  // re-verify at the mutated fingerprint; critic still anchored to the old one
  recordVerification(root, 'npm test', 'pass');
  const entry = entryFor(root, { scope: 'substantial', clarity: 'clear' });
  assert.equal(entry.state, 'CRITIC');
  assert.notEqual(entry.state, 'COMPLETE_LOCAL');
  // a fresh critic pass at the current fingerprint restores completion
  recordCritic(root, { result: 'pass', method: 'code-review' });
  assert.equal(entryFor(root, { scope: 'substantial', clarity: 'clear' }).state, 'COMPLETE_LOCAL');
});

test('F4-7: .agent-loop state writes never invalidate evidence (tracked or not)', (t) => {
  const root = verifiedRepo(t); // .agent-loop/state.json exists, untracked
  const fpBefore = implementationFingerprint(root);
  recordVerification(root, 'npm test', 'pass'); // writes state.json
  assert.equal(implementationFingerprint(root), fpBefore);

  // even when .agent-loop is COMMITTED (tracked), state writes stay invisible
  execFileSync('git', ['-C', root, 'add', '.agent-loop']);
  commit(root, 'track durable state');
  const fpTracked = implementationFingerprint(root);
  recordVerification(root, 'npm test', 'pass');
  assert.equal(implementationFingerprint(root), fpTracked);
  assert.equal(readState(root).verification.length >= 2, true);
});

test('F4-8: git-ignored files do not affect the fingerprint', (t) => {
  const root = verifiedRepo(t);
  write(root, '.gitignore', 'coverage/\n');
  commit(root, 'ignore coverage');
  recordVerification(root, 'npm test', 'pass');
  recordCritic(root, { result: 'pass', method: 'code-review' });
  assert.equal(entryFor(root, { scope: 'substantial', clarity: 'clear' }).state, 'COMPLETE_LOCAL');
  write(root, 'coverage/lcov.info', 'TN:\n'); // ignored generated output
  assert.equal(entryFor(root, { scope: 'substantial', clarity: 'clear' }).state, 'COMPLETE_LOCAL');
});
