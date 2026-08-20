import test from 'node:test';
import assert from 'node:assert/strict';

import type { SessionRecord } from '../src/contracts.js';
import { RuntimeError } from '../src/errors.js';
import type { SandboxFactory, SandboxHandle } from '../src/browser/vercel-sandbox-browser.js';
import { VercelSandboxSessionStore } from '../src/sessions/vercel-sandbox-session-store.js';

const record: SessionRecord = {
  session_id: 'session_1',
  sandbox_id: 'gbr-session_1',
  target_registration_id: 'reg_1',
  target_origin: 'https://game.example.com',
  owner_binding: 'owner-binding-1234567890',
  created_at: '2026-08-19T18:00:00.000Z',
  last_seen_at: '2026-08-19T18:00:00.000Z',
  idle_expires_at: '2026-08-19T18:03:00.000Z',
  absolute_expires_at: '2026-08-19T18:15:00.000Z',
  action_seq: 0,
  observation_seq: 1,
  total_action_count: 0,
  held_keys: [],
  held_pointer_buttons: [],
  lifecycle: 'ACTIVE',
};

type Batch = { state: 'ACCEPTED' | 'COMPLETE'; result?: Record<string, unknown> };

class FakeHandle implements SandboxHandle {
  readonly name = 'gbr-session_1';
  status = 'running';
  sessionRecord: SessionRecord | null = null;
  pendingBatchId: string | null = null;
  batches = new Map<string, Batch>();

  async runCommand(_cmd: string, args: string[]) {
    const request = JSON.parse(Buffer.from(args[1]!, 'base64url').toString('utf8')) as any;
    const response = (() => {
      switch (request.type) {
        case 'session_create':
          if (this.sessionRecord) return { ok: false, error: 'STORAGE_ERROR', detail: 'session already exists' };
          this.sessionRecord = structuredClone(request.record); return { ok: true };
        case 'session_get':
          return { ok: true, record: this.sessionRecord ? structuredClone(this.sessionRecord) : null };
        case 'session_begin_batch': {
          if (!this.sessionRecord) return { ok: false, error: 'SESSION_NOT_FOUND' };
          const prior = this.batches.get(request.batch_id);
          if (prior?.state === 'COMPLETE') return { ok: true, kind: 'DUPLICATE', result: structuredClone(prior.result ?? {}) };
          if (prior || this.pendingBatchId) return { ok: false, error: 'SESSION_RECOVERY_REQUIRED' };
          if (this.sessionRecord.action_seq !== request.expected_action_seq) return { ok: false, error: 'ACTION_REJECTED' };
          if ((this.sessionRecord.total_action_count ?? 0) + request.action_count > request.max_actions_per_session) return { ok: false, error: 'LIMIT_EXCEEDED' };
          this.sessionRecord.total_action_count = (this.sessionRecord.total_action_count ?? 0) + request.action_count;
          this.pendingBatchId = request.batch_id;
          this.batches.set(request.batch_id, { state: 'ACCEPTED' });
          return { ok: true, kind: 'ACCEPTED', actionSeq: this.sessionRecord.action_seq };
        }
        case 'session_complete_batch': {
          if (!this.sessionRecord) return { ok: false, error: 'SESSION_NOT_FOUND' };
          const prior = this.batches.get(request.batch_id);
          if (prior?.state === 'COMPLETE') return { ok: true, actionSeqAfter: this.sessionRecord.action_seq };
          if (!prior || this.pendingBatchId !== request.batch_id) return { ok: false, error: 'SESSION_RECOVERY_REQUIRED' };
          this.sessionRecord.action_seq += 1;
          this.pendingBatchId = null;
          this.batches.set(request.batch_id, { state: 'COMPLETE', result: structuredClone(request.result) });
          return { ok: true, actionSeqAfter: this.sessionRecord.action_seq };
        }
        default: return { ok: true };
      }
    })();
    return { exitCode: response.ok ? 0 : 1, stdout: async () => JSON.stringify(response), stderr: async () => '' };
  }
  currentSessionStatus() { return this.status; }
  async stop() { this.status = 'stopped'; }
  async delete() { this.status = 'deleted'; }
}

class FakeFactory implements SandboxFactory {
  readonly handle = new FakeHandle();
  async create(_options: unknown) { return this.handle; }
  async get(name: string) {
    assert.equal(name, 'gbr-session_1');
    return this.handle;
  }
}

test('fresh coordinator stores reconnect to the same running sandbox ledger', async () => {
  const factory = new FakeFactory();
  await new VercelSandboxSessionStore({ factory }).create(record);
  const freshCoordinator = new VercelSandboxSessionStore({ factory });
  assert.deepEqual(await freshCoordinator.get('session_1'), record);
});

test('concurrent novel batches serialize so only one is accepted', async () => {
  const factory = new FakeFactory();
  const a = new VercelSandboxSessionStore({ factory });
  const b = new VercelSandboxSessionStore({ factory });
  await a.create(record);
  const results = await Promise.allSettled([
    a.beginBatch({ sessionId: 'session_1', batchId: 'a', expectedActionSeq: 0, actionCount: 1, maxActionsPerSession: 10 }),
    b.beginBatch({ sessionId: 'session_1', batchId: 'b', expectedActionSeq: 0, actionCount: 1, maxActionsPerSession: 10 }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected' && rejected.reason instanceof RuntimeError);
});

test('completed duplicate batch returns the recorded result without advancing again', async () => {
  const factory = new FakeFactory();
  const store = new VercelSandboxSessionStore({ factory });
  await store.create(record);
  await store.beginBatch({ sessionId: 'session_1', batchId: 'a', expectedActionSeq: 0, actionCount: 1, maxActionsPerSession: 10 });
  await store.completeBatch({ sessionId: 'session_1', batchId: 'a', result: { ok: true } });
  const duplicate = await new VercelSandboxSessionStore({ factory }).beginBatch({ sessionId: 'session_1', batchId: 'a', expectedActionSeq: 0, actionCount: 1, maxActionsPerSession: 10 });
  assert.deepEqual(duplicate, { kind: 'DUPLICATE', result: { ok: true } });
  assert.equal((await store.get('session_1'))?.action_seq, 1);
});

test('stopped persistent sandbox fails closed instead of auto-resuming filesystem state as live browser state', async () => {
  const factory = new FakeFactory();
  const store = new VercelSandboxSessionStore({ factory });
  await store.create(record);
  factory.handle.status = 'stopped';
  await assert.rejects(
    store.get('session_1'),
    (error: unknown) => error instanceof RuntimeError && error.code === 'SESSION_EXPIRED',
  );
  assert.equal(factory.handle.status, 'stopped');
});
