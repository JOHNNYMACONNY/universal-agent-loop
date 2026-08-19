import test from 'node:test';
import assert from 'node:assert/strict';

import type { SessionRecord, TargetRegistration } from '../src/contracts.js';
import { StaticPrincipalResolver } from '../src/auth/principal.js';
import { RuntimeError } from '../src/errors.js';
import { MemoryRegistrationStore } from '../src/provenance/registration-store.js';
import type { DeploymentVerifier } from '../src/provenance/types.js';
import { MemorySessionStore } from '../src/sessions/session-store.js';
import { createGameToolServices } from '../src/tools/index.js';
import { FakeBrowserAdapter } from './helpers/fake-browser-adapter.js';

const SHA = 'a'.repeat(40);
const REG: TargetRegistration = {
  target_registration_id: 'reg_1', project_id: 'project-1', repository: { owner: 'owner', name: 'repo' },
  expected_commit_sha: SHA, deployment_id: 'dpl_1', deployment_url: 'https://game.example.com',
  deployment_origin: 'https://game.example.com', allowed_hosts: ['game.example.com'],
  created_at: '2026-08-19T00:00:00.000Z', expires_at: '2026-08-19T01:00:00.000Z', provenance_source: 'provider_api',
};
const verifier: DeploymentVerifier = { async verify() { return { deploymentId: 'dpl_1', deploymentUrl: 'https://game.example.com', projectId: 'project-1', repository: REG.repository, commitSha: SHA }; } };

async function setup(options: { now?: () => Date; maxActionsPerSession?: number; browser?: FakeBrowserAdapter } = {}) {
  const registrations = new MemoryRegistrationStore();
  await registrations.put(REG);
  const sessions = new MemorySessionStore();
  const browser = options.browser ?? new FakeBrowserAdapter();
  const services = createGameToolServices({
    registrations, sessions, browser, verifier,
    principals: new StaticPrincipalResolver('principal-binding-123456'),
    resolveDns: async () => [{ address: '93.184.216.34', family: 4 }],
    now: options.now ?? (() => new Date('2026-08-19T00:01:00.000Z')),
    sessionIdFactory: () => 'session_1',
    limits: {
      maxSessionLifetimeMs: 15 * 60_000, maxIdleMs: 3 * 60_000,
      maxActionsPerInput: 20, maxActionsPerSession: options.maxActionsPerSession ?? 500,
      maxSingleWaitMs: 10_000, maxRelativePointerDelta: 2000,
    },
  });
  return { registrations, sessions, browser, services };
}

test('successful activity touches last_seen_at and extends idle expiry without exceeding absolute expiry', async () => {
  let current = new Date('2026-08-19T00:01:00.000Z');
  const { services, sessions } = await setup({ now: () => current });
  await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  const before = (await sessions.get('session_1'))!;
  current = new Date('2026-08-19T00:02:30.000Z');
  await services.observe({ session_id: 'session_1' });
  const after = (await sessions.get('session_1'))!;
  assert.equal(after.last_seen_at, current.toISOString());
  assert.ok(new Date(after.idle_expires_at) > new Date(before.idle_expires_at));
  assert.ok(new Date(after.idle_expires_at) <= new Date(after.absolute_expires_at));
});

test('idle expiry fails closed and best-effort ends the remote browser', async () => {
  let current = new Date('2026-08-19T00:01:00.000Z');
  const { services, sessions, browser } = await setup({ now: () => current });
  const started = await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  current = new Date('2026-08-19T00:04:01.000Z');
  await assert.rejects(services.observe({ session_id: started.session_id }), (error: unknown) => error instanceof RuntimeError && error.code === 'SESSION_EXPIRED');
  assert.equal((await sessions.get(started.session_id))?.lifecycle, 'ENDING');
  assert.equal((browser as any).endCalls, 1);
});

test('per-session action budget counts individual actions atomically and rejects before browser input', async () => {
  const { services, browser, sessions } = await setup({ maxActionsPerSession: 3 });
  await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  await services.input({
    session_id: 'session_1', action_batch_id: 'b1', expected_action_seq: 0,
    actions: [{ type: 'press', key: 'Enter' }, { type: 'press', key: 'Enter' }],
  });
  await services.input({
    session_id: 'session_1', action_batch_id: 'b2', expected_action_seq: 1,
    actions: [{ type: 'press', key: 'Enter' }],
  });
  await assert.rejects(services.input({
    session_id: 'session_1', action_batch_id: 'b3', expected_action_seq: 2,
    actions: [{ type: 'press', key: 'Enter' }],
  }), (error: unknown) => error instanceof RuntimeError && error.code === 'LIMIT_EXCEEDED');
  assert.equal(browser.inputCalls, 2);
  assert.equal((await sessions.get('session_1'))?.total_action_count, 3);
});

test('reset deliberately recovers a live RECOVERY_REQUIRED session while preserving monotonic sequences', async () => {
  const browser = new FakeBrowserAdapter({ ambiguousBatchIds: ['ambiguous'] });
  const { services, sessions } = await setup({ browser });
  await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  await assert.rejects(services.input({
    session_id: 'session_1', action_batch_id: 'ambiguous', expected_action_seq: 0,
    actions: [{ type: 'key_down', key: 'ArrowUp' }],
  }), /recovery/i);
  const before = (await sessions.get('session_1'))!;
  assert.equal(before.lifecycle, 'RECOVERY_REQUIRED');
  const reset = await services.reset({ session_id: 'session_1', mode: 'target' });
  const after = (await sessions.get('session_1'))!;
  assert.equal(after.lifecycle, 'ACTIVE');
  assert.equal(after.action_seq, before.action_seq);
  assert.ok(reset.observation_seq > before.observation_seq);
  await services.input({ session_id: 'session_1', action_batch_id: 'fresh', expected_action_seq: after.action_seq, actions: [{ type: 'press', key: 'Enter' }] });
});

test('session end is idempotent and is allowed from RECOVERY_REQUIRED without resurrecting browser state', async () => {
  const { services, sessions, browser } = await setup();
  await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  await sessions.markRecoveryRequired('session_1', 'test');
  const first = await services.sessionEnd({ session_id: 'session_1' });
  const second = await services.sessionEnd({ session_id: 'session_1' });
  assert.deepEqual(first, { session_id: 'session_1', ended: true });
  assert.deepEqual(second, { session_id: 'session_1', ended: true });
  assert.equal((await sessions.get('session_1'))?.lifecycle, 'ENDING');
  assert.equal((browser as any).endCalls, 1);
});

test('memory session store action reservation does not double-count completed duplicate batches', async () => {
  const store = new MemorySessionStore();
  const record: SessionRecord = {
    session_id: 's', sandbox_id: 'sbx', target_registration_id: 'r', target_origin: 'https://game.example.com',
    owner_binding: 'principal-binding-123456', created_at: '2026-08-19T00:00:00.000Z', last_seen_at: '2026-08-19T00:00:00.000Z',
    idle_expires_at: '2026-08-19T00:03:00.000Z', absolute_expires_at: '2026-08-19T00:15:00.000Z', action_seq: 0,
    observation_seq: 0, total_action_count: 0, held_keys: [], held_pointer_buttons: [], lifecycle: 'ACTIVE',
  };
  await store.create(record);
  await store.beginBatch({ sessionId: 's', batchId: 'b', expectedActionSeq: 0, actionCount: 2, maxActionsPerSession: 3 });
  await store.completeBatch({ sessionId: 's', batchId: 'b', result: { execution_status: 'COMPLETE' } });
  const duplicate = await store.beginBatch({ sessionId: 's', batchId: 'b', expectedActionSeq: 0, actionCount: 2, maxActionsPerSession: 3 });
  assert.equal(duplicate.kind, 'DUPLICATE');
  assert.equal((await store.get('s'))?.total_action_count, 2);
});
