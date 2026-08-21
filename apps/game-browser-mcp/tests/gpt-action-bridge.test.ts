import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';

import { StaticPrincipalResolver } from '../src/auth/principal.js';
import {
  createGptActionBridgeRouter,
  deriveGptActionBridgeBinding,
} from '../src/bridge/gpt-action-bridge.js';
import type { TargetRegistration } from '../src/contracts.js';
import type { GameToolSurface } from '../src/mcp.js';
import { MemoryRegistrationStore } from '../src/provenance/registration-store.js';
import type { DeploymentVerifier } from '../src/provenance/types.js';
import { MemorySessionStore } from '../src/sessions/session-store.js';
import { createGameToolServices } from '../src/tools/index.js';
import { FakeBrowserAdapter } from './helpers/fake-browser-adapter.js';

const TOKEN = 'dedicated-bridge-secret-value';
const SHA = 'a'.repeat(40);
const REGISTRATION: TargetRegistration = {
  target_registration_id: 'reg_bridge',
  project_id: 'project-1',
  repository: { owner: 'owner', name: 'repo' },
  expected_commit_sha: SHA,
  deployment_id: 'dpl_bridge',
  deployment_url: 'https://game.example.com',
  deployment_origin: 'https://game.example.com',
  allowed_hosts: ['game.example.com'],
  created_at: '2026-08-21T00:00:00.000Z',
  expires_at: '2026-08-21T00:15:00.000Z',
  provenance_source: 'provider_api',
};

const verifier: DeploymentVerifier = {
  async verify(input) {
    return {
      deploymentId: input.deploymentId,
      deploymentUrl: 'https://game.example.com',
      projectId: input.projectId,
      repository: { ...input.repository },
      commitSha: input.expectedCommitSha,
    };
  },
};

async function withServer(
  options: Parameters<typeof createGptActionBridgeRouter>[0],
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/internal/gpt-action', createGptActionBridgeRouter(options));
  const http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeSurface(calls: Array<{ name: string; input: unknown }>): GameToolSurface {
  const invoke = (name: string) => async (input: unknown) => {
    calls.push({ name, input });
    return { ok: true, name, input };
  };
  return {
    sessionStart: invoke('sessionStart'),
    observe: invoke('observe'),
    input: invoke('input'),
    readState: invoke('readState'),
    reset: invoke('reset'),
    sessionEnd: invoke('sessionEnd'),
  };
}

async function post(baseUrl: string, path: string, body: unknown, token = TOKEN) {
  return fetch(`${baseUrl}/internal/gpt-action${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

test('bridge binding is stable, domain-separated, and changes when the dedicated token rotates', () => {
  const first = deriveGptActionBridgeBinding(TOKEN);
  const second = deriveGptActionBridgeBinding(TOKEN);
  const rotated = deriveGptActionBridgeBinding(`${TOKEN}-rotated`);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, rotated);
  assert.equal(first.includes(TOKEN), false);
});

test('bridge fails closed when its dedicated server-side token is not configured', async () => {
  const calls: Array<{ name: string; input: unknown }> = [];
  await withServer({
    token: undefined,
    surface: fakeSurface(calls),
    registerForCommit: async () => { throw new Error('unexpected registration'); },
  }, async (baseUrl) => {
    const response = await post(baseUrl, '/observe', { session_id: 'session_1' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'BRIDGE_CONFIGURATION_ERROR' });
    assert.equal(calls.length, 0);
  });
});

test('bridge rejects missing or wrong bearer before any game service call', async () => {
  const calls: Array<{ name: string; input: unknown }> = [];
  await withServer({
    token: TOKEN,
    surface: fakeSurface(calls),
    registerForCommit: async () => { throw new Error('unexpected registration'); },
  }, async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/internal/gpt-action/observe`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: 'session_1' }),
    });
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: 'UNAUTHORIZED' });

    const wrong = await post(baseUrl, '/observe', { session_id: 'session_1' }, 'wrong-token');
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), { error: 'UNAUTHORIZED' });
    assert.equal(calls.length, 0);
  });
});

test('session start derives a short-lived exact deployment registration server-side before calling the existing game service', async () => {
  const calls: Array<{ name: string; input: unknown }> = [];
  const registrations: string[] = [];
  await withServer({
    token: TOKEN,
    surface: fakeSurface(calls),
    registerForCommit: async (expectedCommitSha) => {
      registrations.push(expectedCommitSha);
      return { target_registration_id: 'rgc1.server-owned-registration' };
    },
  }, async (baseUrl) => {
    const response = await post(baseUrl, '/session-start', {
      expected_commit_sha: SHA,
      viewport: { width: 1280, height: 720 },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(registrations, [SHA]);
    assert.deepEqual(calls, [{
      name: 'sessionStart',
      input: {
        target_registration_id: 'rgc1.server-owned-registration',
        expected_commit_sha: SHA,
        viewport: { width: 1280, height: 720 },
      },
    }]);
  });
});

test('stable bridge principal owns the real persisted game session across separate HTTP requests', async () => {
  const registrations = new MemoryRegistrationStore();
  await registrations.put(REGISTRATION);
  const sessions = new MemorySessionStore();
  const browser = new FakeBrowserAdapter();
  const binding = deriveGptActionBridgeBinding(TOKEN);
  const surface = createGameToolServices({
    registrations,
    sessions,
    browser,
    verifier,
    principals: new StaticPrincipalResolver(binding),
    resolveDns: async () => [{ address: '93.184.216.34', family: 4 }],
    now: () => new Date('2026-08-21T00:01:00.000Z'),
    sessionIdFactory: () => 'session_bridge',
    limits: {
      maxSessionLifetimeMs: 900_000,
      maxIdleMs: 180_000,
      maxActionsPerInput: 20,
      maxActionsPerSession: 500,
      maxSingleWaitMs: 10_000,
      maxRelativePointerDelta: 2000,
    },
  });

  await withServer({
    token: TOKEN,
    surface,
    registerForCommit: async (expectedCommitSha) => {
      assert.equal(expectedCommitSha, SHA);
      return { target_registration_id: REGISTRATION.target_registration_id };
    },
  }, async (baseUrl) => {
    const started = await post(baseUrl, '/session-start', { expected_commit_sha: SHA });
    assert.equal(started.status, 200);
    const startedBody = await started.json() as { session_id: string };
    assert.equal(startedBody.session_id, 'session_bridge');
    assert.equal((await sessions.get('session_bridge'))?.owner_binding, binding);

    const observed = await post(baseUrl, '/observe', { session_id: startedBody.session_id });
    assert.equal(observed.status, 200);
    const observedBody = await observed.json() as { session_id: string; content_trust: string };
    assert.equal(observedBody.session_id, 'session_bridge');
    assert.equal(observedBody.content_trust, 'UNTRUSTED_TARGET_CONTENT');
    assert.equal((await sessions.get('session_bridge'))?.owner_binding, binding);
  });
});

test('bridge exposes only the six fixed game-QA routes and forwards no arbitrary operation or URL', async () => {
  const calls: Array<{ name: string; input: unknown }> = [];
  await withServer({
    token: TOKEN,
    surface: fakeSurface(calls),
    registerForCommit: async () => ({ target_registration_id: 'rgc1.registration' }),
  }, async (baseUrl) => {
    for (const [path, name] of [
      ['/observe', 'observe'],
      ['/input', 'input'],
      ['/read-state', 'readState'],
      ['/reset', 'reset'],
      ['/session-end', 'sessionEnd'],
    ] as const) {
      const body = { session_id: 'session_1' };
      const response = await post(baseUrl, path, body);
      assert.equal(response.status, 200, path);
      assert.equal((await response.json() as { name: string }).name, name);
    }

    const before = calls.length;
    const arbitrary = await post(baseUrl, '/navigate', { url: 'https://example.com', operation: 'shell' });
    assert.equal(arbitrary.status, 404);
    assert.equal(calls.length, before);
  });
});
