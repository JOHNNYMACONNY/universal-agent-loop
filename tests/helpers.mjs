// Test fixture helpers: build temporary git repos with UAL artifacts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function mkRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ual-test-'));
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'UAL Test']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'ual-test@example.invalid']);
  write(root, 'README.md', '# fixture\n');
  commit(root, 'init');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

export function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

export function commit(root, message, { add = ['-A'] } = {}) {
  execFileSync('git', ['-C', root, 'add', ...add]);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', message]);
}

export function head(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

export function gitStatus(root) {
  return execFileSync('git', ['-C', root, 'status', '--porcelain=v1'], { encoding: 'utf8' }).trim();
}

// ---- artifact templates -------------------------------------------------

export function spec({ topic = 'feature-x', status = 'accepted', supersedes = [], extra = '' }) {
  const sup = supersedes.length ? `supersedes: [${supersedes.join(', ')}]\n` : '';
  return `---\nual_type: spec\nstatus: ${status}\ntopic: ${topic}\n${sup}${extra}---\n\n# Spec: ${topic}\n\nBehavior, constraints, interfaces, acceptance criteria.\n`;
}

export function ticket({ title = 't1', status = 'open', boxes = [], verification = null }) {
  const ver = verification ? `verification: [${verification.join(', ')}]\n` : '';
  const body = boxes.map(([done, label]) => `- [${done ? 'x' : ' '}] ${label}`).join('\n');
  return `---\nual_type: ticket\nstatus: ${status}\n${ver}---\n\n# Ticket: ${title}\n\n${body}\n`;
}

export function wayfinderMap({ status = 'active', unresolved = [] } = {}) {
  const un = unresolved.length ? `unresolved:\n${unresolved.map((u) => `  - ${u}`).join('\n')}\n` : 'unresolved: []\n';
  return `---\nual_type: wayfinder_map\nstatus: ${status}\n${un}---\n\n# Wayfinder map\n`;
}

export function handoffDoc({ head: h = null, branch = 'main' } = {}) {
  return `---\nual_handoff: 1\nproject: fixture\ntask: demo\nlifecycle_state: IMPLEMENT\ndestination: ship feature x\nhead: ${h || 'null'}\nbranch: ${branch}\nartifacts:\n  current_spec: docs/spec-feature-x.md\n  current_ticket: tickets/1-t1.md\ncompleted_work:\n  - scaffold\nremaining_work:\n  - implement core\nworktree: /tmp\ncommits: []\nverification: []\nknown_failures: []\nauthority:\n  granted: [READ, LOCAL_EDIT, LOCAL_TEST]\n  withheld: [PUSH]\nnext_valid_action: implement core\ncreated_at: 2026-01-01T00:00:00Z\n---\n\nhandoff body\n`;
}

// Fake gh CLI: prints FAKE_GH_PRS json for `pr list`, succeeds for auth.
export function installFakeGh(t, prs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ual-gh-'));
  const script = path.join(dir, 'fake-gh.js');
  fs.writeFileSync(script, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'auth') process.exit(0);
if (args[0] === 'pr') { process.stdout.write(process.env.FAKE_GH_PRS || '[]'); process.exit(0); }
process.exit(1);
`);
  fs.chmodSync(script, 0o755);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { env: { AGENT_LOOP_GH: script, FAKE_GH_PRS: JSON.stringify(prs) } };
}

export function pr({ number = 1, conclusion = 'SUCCESS', status = 'COMPLETED' }) {
  return {
    number,
    title: `PR ${number}`,
    headRefName: `pr-${number}`,
    url: `https://example.invalid/pr/${number}`,
    statusCheckRollup: [{ status, conclusion }],
  };
}
