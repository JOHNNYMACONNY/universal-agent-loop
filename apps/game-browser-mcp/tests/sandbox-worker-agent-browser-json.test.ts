import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('../sandbox/worker.mjs', import.meta.url));

function runWorker(root: string, bin: string, request: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(request)).toString('base64url');
  return spawnSync(process.execPath, [worker, encoded], {
    env: { ...process.env, GBR_ROOT: root, PATH: `${bin}:${process.env.PATH ?? ''}` },
    encoding: 'utf8',
    timeout: 5_000,
  });
}

function fakeAgentBrowser(bin: string) {
  const path = join(bin, 'agent-browser');
  writeFileSync(path, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
const json = (data) => process.stdout.write(JSON.stringify({ success: true, data }));
const commandIndex = args.indexOf('--json') + 1;
const command = args[commandIndex];
const rest = args.slice(commandIndex + 1);
if (process.env.GBR_ROOT) appendFileSync(process.env.GBR_ROOT + '/agent-browser.log', [command, ...rest].join(' ') + '\\n');
if (command === 'open') json({ url: rest[0], title: 'Fixture' });
else if (command === 'get' && rest[0] === 'url') json({ url: 'https://game.example.com/fixture/' });
else if (command === 'get' && rest[0] === 'title') json({ title: 'Fixture Title' });
else if (command === 'snapshot') json({ snapshot: '- canvas "Game"' });
else if (command === 'console') json({ messages: [{ type: 'error', text: 'fixture console error' }] });
else if (command === 'errors') json({ errors: [{ message: 'fixture page error' }] });
else if (command === 'network' && rest[0] === 'requests') json({ requests: [{ url: 'https://game.example.com/fixture/expected-failure', status: 404 }] });
else if (command === 'eval') json({ result: { score: 7, player: { x: 12 } } });
else json({ ok: true });
`);
  chmodSync(path, 0o755);
}

test('sandbox worker unwraps agent-browser 0.34 JSON data envelopes for observation and read_state', () => {
  const base = mkdtempSync(join(tmpdir(), 'gbr-agent-json-'));
  const root = join(base, 'state');
  const bin = join(base, 'bin');
  // mkdir via a harmless Node helper so the fake binary directory exists before writeFileSync.
  const mkdir = spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(bin)},{recursive:true})`]);
  assert.equal(mkdir.status, 0);
  fakeAgentBrowser(bin);

  const session = 'session_agent_json';
  const start = runWorker(root, bin, {
    type: 'start',
    session_id: session,
    target_url: 'https://game.example.com/fixture/',
  });
  assert.equal(start.status, 0, start.stderr || start.stdout);
  const started = JSON.parse(start.stdout);
  assert.equal(started.ok, true);
  assert.equal(started.observation.url, 'https://game.example.com/fixture/');
  assert.equal(started.observation.title, 'Fixture Title');
  assert.equal(started.observation.accessibilitySnapshot, '- canvas "Game"');
  assert.deepEqual(started.observation.consoleErrors, [
    { type: 'error', text: 'fixture console error' },
    { message: 'fixture page error' },
  ]);
  assert.deepEqual(started.observation.failedRequests, [
    { url: 'https://game.example.com/fixture/expected-failure', status: 404 },
  ]);

  const read = runWorker(root, bin, { type: 'read_state', session_id: session, path: '/score' });
  assert.equal(read.status, 0, read.stderr || read.stdout);
  assert.deepEqual(JSON.parse(read.stdout), { ok: true, value: { score: 7, player: { x: 12 } } });
});

test('reset reloads the target without duplicating heavyweight observation capture', () => {
  const base = mkdtempSync(join(tmpdir(), 'gbr-reset-bounded-'));
  const root = join(base, 'state');
  const bin = join(base, 'bin');
  const mkdir = spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(bin)},{recursive:true})`]);
  assert.equal(mkdir.status, 0);
  fakeAgentBrowser(bin);

  const session = 'session_reset_bounded';
  const start = runWorker(root, bin, {
    type: 'start',
    session_id: session,
    target_url: 'https://game.example.com/fixture/',
  });
  assert.equal(start.status, 0, start.stderr || start.stdout);

  const logPath = join(root, 'agent-browser.log');
  writeFileSync(logPath, '');
  const reset = runWorker(root, bin, { type: 'reset', session_id: session });
  assert.equal(reset.status, 0, reset.stderr || reset.stdout);
  const result = JSON.parse(reset.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.observation.url, 'https://game.example.com/fixture/');

  const calls = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  assert.deepEqual(calls, [
    'open https://game.example.com/fixture/',
    'get url',
  ]);
  assert.deepEqual(result.observation.heldKeys, []);
  assert.deepEqual(result.observation.heldPointerButtons, []);
});
