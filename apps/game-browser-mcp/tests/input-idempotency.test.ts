import test from 'node:test';
import assert from 'node:assert/strict';

import type { SessionRecord } from '../src/contracts.js';
import { BEGIN_BATCH_LUA, COMPLETE_BATCH_LUA, UpstashSessionStore } from '../src/sessions/upstash-session-store.js';

const SESSION: SessionRecord = {
  session_id: 'session_redis', sandbox_id: 'sbx', target_registration_id: 'reg', target_origin: 'https://game.example.com',
  owner_binding: 'owner-binding-hash-1234', created_at: '2026-08-19T00:00:00.000Z', last_seen_at: '2026-08-19T00:00:00.000Z',
  idle_expires_at: '2026-08-19T00:03:00.000Z', absolute_expires_at: '2026-08-19T00:15:00.000Z', action_seq: 0,
  observation_seq: 0, held_keys: [], held_pointer_buttons: [], lifecycle: 'ACTIVE',
};

test('atomic scripts check lifecycle, sequence, and duplicate state before mutation', () => {
  assert.match(BEGIN_BATCH_LUA, /RECOVERY_REQUIRED/);
  assert.match(BEGIN_BATCH_LUA, /expected/);
  assert.match(BEGIN_BATCH_LUA, /batch/);
  assert.match(COMPLETE_BATCH_LUA, /action_seq/);
  assert.match(COMPLETE_BATCH_LUA, /COMPLETE/);
});

test('Upstash adapter sends session and batch keys through one EVAL operation', async () => {
  const evalCalls: Array<{ script: string; keys: string[]; args: unknown[] }> = [];
  const redis = {
    async set() { return 'OK'; },
    async get() { return SESSION; },
    async eval(script: string, keys: string[], args: unknown[]) {
      evalCalls.push({ script, keys, args });
      if (script === BEGIN_BATCH_LUA) return JSON.stringify({ kind: 'ACCEPTED', actionSeq: 0 });
      return JSON.stringify({ actionSeqAfter: 1 });
    },
  };
  const store = new UpstashSessionStore(redis as any);
  const begin = await store.beginBatch({ sessionId: SESSION.session_id, batchId: 'batch_1', expectedActionSeq: 0 });
  assert.equal(begin.kind, 'ACCEPTED');
  await store.completeBatch({ sessionId: SESSION.session_id, batchId: 'batch_1', result: { execution_status: 'COMPLETE' } });
  assert.deepEqual(evalCalls[0]?.keys, ['gbr:session:session_redis', 'gbr:batch:session_redis:batch_1']);
  assert.deepEqual(evalCalls[1]?.keys, ['gbr:session:session_redis', 'gbr:batch:session_redis:batch_1']);
});
