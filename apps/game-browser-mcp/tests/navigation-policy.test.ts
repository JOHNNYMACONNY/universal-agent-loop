import test from 'node:test';
import assert from 'node:assert/strict';

import type { BrowserStartInput, BrowserStartResult, BrowserSessionRef } from '../src/browser/browser-adapter.js';
import type { TargetRegistration } from '../src/contracts.js';
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
  expected_commit_sha: SHA, deployment_id: 'dpl_1', deployment_url: 'https://game.example.com/fixture/',
  deployment_origin: 'https://game.example.com', allowed_hosts: ['game.example.com', 'cdn.example.com'],
  created_at: '2026-08-19T00:00:00.000Z', expires_at: '2026-08-19T00:15:00.000Z', provenance_source: 'provider_api',
};
const verifier: DeploymentVerifier = { async verify() { return { deploymentId: 'dpl_1', deploymentUrl: 'https://game.example.com', projectId: 'project-1', repository: REG.repository, commitSha: SHA }; } };

async function servicesFor(browser: FakeBrowserAdapter) {
  const registrations = new MemoryRegistrationStore();
  await registrations.put(REG);
  return createGameToolServices({
    registrations, sessions: new MemorySessionStore(), browser, verifier,
    principals: new StaticPrincipalResolver('principal-binding-123456'),
    resolveDns: async (host) => host === 'evil.example.com'
      ? [{ address: '10.0.0.5', family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }],
    now: () => new Date('2026-08-19T00:01:00.000Z'), sessionIdFactory: () => 'session_1',
    limits: { maxSessionLifetimeMs: 900_000, maxIdleMs: 180_000, maxActionsPerInput: 20, maxActionsPerSession: 500, maxSingleWaitMs: 10_000, maxRelativePointerDelta: 2000 },
  });
}

class StartRedirectBrowser extends FakeBrowserAdapter {
  override async start(input: BrowserStartInput): Promise<BrowserStartResult> {
    const result = await super.start(input);
    result.observation.url = 'https://evil.example.com/injected';
    return result;
  }
}

class LaterRedirectBrowser extends FakeBrowserAdapter {
  override async observe(session: BrowserSessionRef) {
    const result = await super.observe(session);
    result.url = 'https://evil.example.com/injected';
    return result;
  }
}

test('session start rejects and tears down a browser that reports an unregistered redirect', async () => {
  const browser = new StartRedirectBrowser();
  const services = await servicesFor(browser);
  await assert.rejects(
    services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'TARGET_BLOCKED',
  );
  assert.equal(browser.endCalls, 1);
});

test('later navigation outside registered hosts is treated as a policy breach and ends the session', async () => {
  const browser = new LaterRedirectBrowser();
  const services = await servicesFor(browser);
  const started = await services.sessionStart({ target_registration_id: 'reg_1', expected_commit_sha: SHA });
  await assert.rejects(
    services.observe({ session_id: started.session_id }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'TARGET_BLOCKED',
  );
  assert.equal(browser.endCalls, 1);
});
