import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = fileURLToPath(new URL('../sandbox/worker.mjs', import.meta.url));

test('sandbox worker reclaims an orphaned persistent lock instead of wedging the session forever', () => {
  const root = mkdtempSync(join(tmpdir(), 'gbr-lock-'));
  const session = 'session_lock';
  const ledger = {
    session,
    targetUrl: 'https://game.example.com',
    viewport: { width: 1280, height: 720 },
    pointerX: 640, pointerY: 360,
    heldKeys: [], heldPointerButtons: [], browserBatches: {}, browserRecoveryRequired: false,
    ended: false, sessionRecord: null, coordinatorBatches: {}, pendingBatchId: null, recoveryReason: null,
  };
  writeFileSync(join(root, `${session}.json`), JSON.stringify(ledger));
  const lock = join(root, `${session}.lock`);
  mkdirSync(lock);
  const old = new Date(Date.now() - 10_000);
  utimesSync(lock, old, old); // simulate a worker that died before/while recording lock ownership

  const request = Buffer.from(JSON.stringify({ type: 'session_get', session_id: session })).toString('base64url');
  const result = spawnSync(process.execPath, [worker, request], {
    env: { ...process.env, GBR_ROOT: root },
    encoding: 'utf8',
    timeout: 2_000,
  });

  assert.equal(result.signal, null, `worker remained wedged on stale lock: ${result.signal ?? ''}`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, record: null });
});
