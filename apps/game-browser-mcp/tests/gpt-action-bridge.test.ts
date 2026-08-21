import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';

import {
  createGptActionBridgeRouter,
  deriveGptActionBridgeBinding,
} from '../src/bridge/gpt-action-bridge.js';
import type { GameToolSurface } from '../src/mcp.js';

const TOKEN = 'dedicated-bridge-secret-value';
const SHA = 'a'.repeat(40);

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
