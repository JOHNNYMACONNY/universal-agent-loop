import test from 'node:test';
import assert from 'node:assert/strict';

import type { TargetRegistration } from '../src/contracts.js';
import { RuntimeError } from '../src/errors.js';
import { StaticPrincipalResolver } from '../src/auth/principal.js';
import { MemoryRegistrationStore } from '../src/provenance/registration-store.js';
import type { DeploymentVerifier } from '../src/provenance/types.js';
import { MemorySessionStore } from '../src/sessions/session-store.js';
import { createGameToolServices } from '../src/tools/index.js';
import { FakeBrowserAdapter } from './helpers/fake-browser-adapter.js';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const REG: TargetRegistration = {
  target_registration_id: 'reg_1', project_id: 'project-1', repository: { owner: 'owner', name: 'repo' },
  expected_commit_sha: SHA, deployment_id: 'dpl_1', deployment_url: 'https://game.example.com',
  deployment_origin: 'https://game.example.com', allowed_hosts: ['game.example.com'],
  created_at: '2026-08-19T00:00:00.000Z', expires_at: '2026-08-19T00:15:00.000Z', provenance_source: 'provider_api',
};

const verifier: DeploymentVerifier = {
  async verify(input) {
    if (input.expectedCommitSha !== SHA) throw new RuntimeError('PROVENANCE_MISMATCH', 'sha mismatch');
    return { deploymentId: 'dpl_1', deploymentUrl: 'https://game.example.com', projectId: 'project-1', repository: { owner: 'owner', name: 'repo' }, commitSha: SHA };
  },
};

async function setup(options: { browser?: FakeBrowserAdapter; principal?: string } = {}) {
  const registrations = new MemoryRegistrationStore();
  await registrations.put(REG);
  const sessions = new MemorySessionStore();
  const browser = options.browser ?? new FakeBrowserAdapter({ state: { player: { x: 1, y: 2 } } });
  const services = createGameToolServices({
    registrations, sessions, browser, verifier,
    principals: new StaticPrincipalResolver(options.principal ?? 'principal-binding-123456'),
    resolveDns: async () => [{ address: '93.184.216.34', family: 4 }],
    now: () => new Date('2026-08-19T00:01:00.000Z'),
    sessionIdFactory: () => 'session_1',
    limits: { maxSessionLifetimeMs: 900_000, maxIdleMs: 180_000, maxActionsPerInput: 20, maxActionsPerSession: 500, maxSingleWaitMs: 10_000, maxRelativePointerDelta: 2000 },
  });
  return { services, registrations, sessions, browser };
}

test('session start binds exact commit provenance and persists only after browser start', async () => {
  const { services, sessions } = await setup();
  const result = await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  assert.equal(result.session_id, 'session_1');
  assert.equal(result.deployment_provenance.expected_commit_sha, SHA);
  assert.equal(result.observation.content_trust, 'UNTRUSTED_TARGET_CONTENT');
  assert.equal((await sessions.get('session_1'))?.owner_binding, 'principal-binding-123456');
});

test('latest screenshot returns cached untrusted evidence without advancing action or observation sequence', async () => {
  const { services, sessions } = await setup();
  await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  const before = await sessions.get('session_1');
  const result = await services.latestScreenshot({ session_id: 'session_1' });
  const after = await sessions.get('session_1');

  assert.equal(result.content_trust, 'UNTRUSTED_TARGET_CONTENT');
  assert.equal(result.screenshot.mime_type, 'image/png');
  assert.equal(result.screenshot.base64, 'ZmFrZQ==');
  assert.equal(result.screenshot.bytes, 4);
  assert.equal(after?.action_seq, before?.action_seq);
  assert.equal(after?.observation_seq, before?.observation_seq);
});

test('start rejects stale commit and expired registration before browser work', async () => {
  const { services, browser } = await setup();
  await assert.rejects(
    services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: OTHER_SHA }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'PROVENANCE_MISMATCH',
  );
  assert.equal((browser as any).startCalls ?? 0, 0);
});

test('duplicate completed batch returns stored result without second browser input', async () => {
  const { services, browser } = await setup();
  await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  const input = { session_id: 'session_1', action_batch_id: 'batch_1', expected_action_seq: 0, actions: [{ type: 'press' as const, key: 'Enter' as const }] };
  const first = await services.input(input);
  const second = await services.input(input);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.action_seq_after, 1);
  assert.equal(second.action_seq_after, 1);
  assert.equal((browser as any).inputCalls, 1);
});

test('stale expected action sequence fails before browser input', async () => {
  const { services, browser } = await setup();
  await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  await assert.rejects(
    services.input({ session_id: 'session_1', action_batch_id: 'stale', expected_action_seq: 2, actions: [{ type: 'press', key: 'Enter' }] }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'ACTION_REJECTED',
  );
  assert.equal((browser as any).inputCalls, 0);
});

test('ambiguous browser execution marks session recovery-required and releases held input', async () => {
  const browser = new FakeBrowserAdapter({ ambiguousBatchIds: ['ambiguous'] });
  const { services, sessions } = await setup({ browser });
  await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  await assert.rejects(
    services.input({ session_id: 'session_1', action_batch_id: 'ambiguous', expected_action_seq: 0, actions: [{ type: 'key_down', key: 'ArrowUp' }] }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'SESSION_RECOVERY_REQUIRED',
  );
  assert.equal((await sessions.get('session_1'))?.lifecycle, 'RECOVERY_REQUIRED');
  assert.equal((browser as any).releaseCalls, 1);
});

test('ownership mismatch rejects observe/input/screenshot/read/reset/end', async () => {
  const first = await setup({ principal: 'principal-binding-123456' });
  await first.services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  const attacker = createGameToolServices({
    registrations: first.registrations, sessions: first.sessions, browser: first.browser, verifier,
    principals: new StaticPrincipalResolver('different-principal-654321'),
    resolveDns: async () => [{ address: '93.184.216.34', family: 4 }],
    now: () => new Date('2026-08-19T00:01:00.000Z'),
    limits: { maxSessionLifetimeMs: 900_000, maxIdleMs: 180_000, maxActionsPerInput: 20, maxActionsPerSession: 500, maxSingleWaitMs: 10_000, maxRelativePointerDelta: 2000 },
  });
  for (const call of [
    () => attacker.observe({ session_id: 'session_1' }),
    () => attacker.input({ session_id: 'session_1', action_batch_id: 'b', expected_action_seq: 0, actions: [{ type: 'press' as const, key: 'Enter' as const }] }),
    () => attacker.latestScreenshot({ session_id: 'session_1' }),
    () => attacker.readState({ session_id: 'session_1' }),
    () => attacker.reset({ session_id: 'session_1' }),
    () => attacker.sessionEnd({ session_id: 'session_1' }),
  ]) await assert.rejects(call, (error: unknown) => error instanceof RuntimeError && error.code === 'AUTH_CONTEXT_UNAVAILABLE');
});

test('browser loss becomes SESSION_EXPIRED rather than successful observation', async () => {
  const { services, browser } = await setup();
  const started = await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  browser.loseSession({ logicalSessionId: started.session_id, sandboxId: (await services.debugSession(started.session_id)).sandbox_id });
  await assert.rejects(services.observe({ session_id: started.session_id }), (error: unknown) => error instanceof RuntimeError && error.code === 'SESSION_EXPIRED');
});

test('read state is explicitly marked untrusted and reset/end release held input', async () => {
  const { services, browser } = await setup();
  await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  const state = await services.readState({ session_id: 'session_1', path: '/player' });
  assert.equal(state.content_trust, 'UNTRUSTED_TARGET_CONTENT');
  assert.deepEqual(state.value, { x: 1, y: 2 });
  await services.input({ session_id: 'session_1', action_batch_id: 'held', expected_action_seq: 0, actions: [{ type: 'key_down', key: 'ArrowLeft' }] });
  await services.reset({ session_id: 'session_1' });
  await services.sessionEnd({ session_id: 'session_1' });
  assert.ok((browser as any).releaseCalls >= 2);
});
