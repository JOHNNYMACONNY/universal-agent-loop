import test from 'node:test';
import assert from 'node:assert/strict';

import type { TargetRegistration } from '../src/contracts.js';
import { MemoryRateLimiter } from '../src/auth/rate-limit.js';
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
  created_at: '2026-08-19T00:00:00.000Z', expires_at: '2026-08-19T00:15:00.000Z', provenance_source: 'provider_api',
};
const verifier: DeploymentVerifier = { async verify() { return { deploymentId: 'dpl_1', deploymentUrl: 'https://game.example.com', projectId: 'project-1', repository: REG.repository, commitSha: SHA }; } };

async function setup() {
  const registrations = new MemoryRegistrationStore();
  await registrations.put(REG);
  const browser = new FakeBrowserAdapter();
  let n = 0;
  const services = createGameToolServices({
    registrations,
    sessions: new MemorySessionStore(),
    browser,
    verifier,
    principals: new StaticPrincipalResolver('principal-binding-123456'),
    resolveDns: async () => [{ address: '93.184.216.34', family: 4 }],
    limits: { maxSessionLifetimeMs: 900_000, maxIdleMs: 180_000, maxActionsPerInput: 20, maxActionsPerSession: 500, maxSingleWaitMs: 10_000, maxRelativePointerDelta: 2000 },
    rateLimiter: new MemoryRateLimiter(() => 0),
    rateLimits: { sessionStarts: 1, actionCalls: 1, windowMs: 60_000 },
    now: () => new Date('2026-08-19T00:01:00.000Z'),
    sessionIdFactory: () => `session_${++n}`,
  });
  return { services, browser };
}

test('session-start limit rejects before creating a second browser sandbox', async () => {
  const { services, browser } = await setup();
  await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  await assert.rejects(
    services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'LIMIT_EXCEEDED',
  );
  assert.equal(browser.startCalls, 1);
});

test('action-call limit rejects before a second browser input', async () => {
  const { services, browser } = await setup();
  const started = await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  await services.input({ session_id: started.session_id, action_batch_id: 'b1', expected_action_seq: 0, actions: [{ type: 'press', key: 'Enter' }] });
  await assert.rejects(
    services.input({ session_id: started.session_id, action_batch_id: 'b2', expected_action_seq: 1, actions: [{ type: 'press', key: 'Enter' }] }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'LIMIT_EXCEEDED',
  );
  assert.equal(browser.inputCalls, 1);
});
