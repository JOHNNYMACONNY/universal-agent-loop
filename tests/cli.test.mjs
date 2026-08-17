// CLI end-to-end: the adapter talks to the engine only through this surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkRepo, write, commit, spec, ticket } from './helpers.mjs';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agent-loop.js');

function run(args, { root, env = {} } = {}) {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() };
  }
}

test('cli: capabilities emits json', () => {
  const r = run(['capabilities']);
  assert.equal(r.code, 0);
  const caps = JSON.parse(r.stdout);
  assert.equal(caps.shell, true);
  assert.equal(caps.git, true);
});

test('cli: plan resolves entry from an arbitrary repo', (t) => {
  const root = mkRepo(t);
  write(root, 'docs/spec-feature-x.md', spec({}));
  write(root, 'tickets/1-build-x.md', ticket({ status: 'open', boxes: [[false, 'x']] }));
  commit(root, 'planned');
  const r = run(['plan', '--task-profile', '{"scope":"substantial","clarity":"clear"}'], { root });
  assert.equal(r.code, 0);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.entry.state, 'IMPLEMENT');
  assert.equal(plan.reconciled.specs[0].class, 'CURRENT');
});

test('cli: authority check exit codes enforce fail-closed', (t) => {
  const root = mkRepo(t);
  const deny = run(['authority', 'check', 'PUSH', '--grants', 'READ,LOCAL_EDIT'], { root });
  assert.equal(deny.code, 1);
  assert.match(deny.stdout, /"decision": "deny"/);
  const allow = run(['authority', 'check', 'LOCAL_EDIT', '--grants', 'READ,LOCAL_EDIT'], { root });
  assert.equal(allow.code, 0);
});

test('cli: state init/transition/record round-trip', (t) => {
  const root = mkRepo(t);
  let r = run(['state', 'init', '--project', 'p', '--task', 't', '--authority', 'READ,LOCAL_EDIT,LOCAL_TEST,LOCAL_COMMIT'], { root });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).created, true);
  r = run(['state', 'transition', 'RECONCILE'], { root });
  assert.equal(r.code, 0);
  r = run(['state', 'transition', 'IMPLEMENT'], { root }); // illegal from RECONCILE
  assert.equal(r.code, 1);
  r = run(['state', 'get'], { root });
  assert.equal(JSON.parse(r.stdout).lifecycle_state, 'RECONCILE');
});

test('cli: handoff write + validate round-trip', (t) => {
  const root = mkRepo(t);
  run(['state', 'init', '--project', 'p', '--task', 't'], { root });
  const w = run(['handoff', 'write', '--slug', 'check'], { root });
  assert.equal(w.code, 0);
  const file = JSON.parse(w.stdout).file;
  const v = run(['handoff', 'validate', file], { root });
  assert.equal(v.code, 1); // destination/next_valid_action empty by default
  assert.match(v.stdout, /missing or empty/);
});

test('cli: scan never requires a git repo', (t) => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ual-plain-'));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  write(plain, 'notes.md', '# no frontmatter\n');
  const r = run(['scan'], { root: plain });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).git.isRepo, false);
});
