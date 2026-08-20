import test from 'node:test';
import assert from 'node:assert/strict';

import type { SessionRecord } from '../src/contracts.js';
import { MemorySessionStore } from '../src/sessions/session-store.js';

const SESSION: SessionRecord = {
  session_id: 'session_1', sandbox_id: 'sbx_1', target_registration_id: 'reg_1',
  target_origin: 'https://game.example.com', owner_binding: 'owner-binding-hash-1234',
  created_at: '2026-08-19T00:00:00.000Z', last_seen_at: '2026-08-19T00:00:00.000Z',
  idle_expires_at: '2026-08-19T00:03:00.000Z', absolute_expires_at: '2026-08-19T00:15:00.000Z',
  action_seq: 0, observation_seq: 0, held_keys: [], held_pointer_buttons: [], lifecycle: 'ACTIVE',
};

test('memory store creates, clones, observes monotonically, and ends', async () => {
  const store = new MemorySessionStore();
  await store.create(SESSION);
  const first = await store.get(SESSION.session_id);
  assert.deepEqual(first, SESSION);
  assert.equal(await store.nextObservation(SESSION.session_id), 1);
  assert.equal(await store.nextObservation(SESSION.session_id), 2);
  await store.end(SESSION.session_id);
  assert.equal((await store.get(SESSION.session_id))?.lifecycle, 'ENDING');
});

test('stale sequence is rejected and concurrent novel batches cannot both win', async () => {
  const store = new MemorySessionStore();
  await store.create(SESSION);
  await assert.rejects(store.beginBatch({ sessionId: SESSION.session_id, batchId: 'stale', expectedActionSeq: 2 }), /sequence/i);
  const [a, b] = await Promise.allSettled([
    store.beginBatch({ sessionId: SESSION.session_id, batchId: 'a', expectedActionSeq: 0 }),
    store.beginBatch({ sessionId: SESSION.session_id, batchId: 'b', expectedActionSeq: 0 }),
  ]);
  assert.equal([a, b].filter((result) => result.status === 'fulfilled').length, 1);
});

test('completed duplicate batch returns recorded result and never increments twice', async () => {
  const store = new MemorySessionStore();
  await store.create(SESSION);
  const begin = await store.beginBatch({ sessionId: SESSION.session_id, batchId: 'batch_1', expectedActionSeq: 0 });
  assert.equal(begin.kind, 'ACCEPTED');
  const result = { execution_status: 'COMPLETE', action_seq_after: 1, marker: 'once' };
  await store.completeBatch({ sessionId: SESSION.session_id, batchId: 'batch_1', result });
  const duplicate = await store.beginBatch({ sessionId: SESSION.session_id, batchId: 'batch_1', expectedActionSeq: 0 });
  assert.equal(duplicate.kind, 'DUPLICATE');
  if (duplicate.kind === 'DUPLICATE') assert.deepEqual(duplicate.result, result);
  assert.equal((await store.get(SESSION.session_id))?.action_seq, 1);
});

test('recovery-required lifecycle blocks new batches', async () => {
  const store = new MemorySessionStore();
  await store.create(SESSION);
  await store.markRecoveryRequired(SESSION.session_id, 'ambiguous');
  await assert.rejects(store.beginBatch({ sessionId: SESSION.session_id, batchId: 'b', expectedActionSeq: 0 }), /recovery/i);
});
