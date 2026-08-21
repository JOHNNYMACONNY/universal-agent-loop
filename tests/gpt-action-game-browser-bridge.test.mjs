import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/app.mjs';

const baseEnv = {
  UAL_ACTION_API_KEY: 'action-secret',
  GITHUB_TOKEN: 'github-secret',
};

const bridgeEnv = {
  ...baseEnv,
  GAME_BROWSER_RUNTIME_BASE_URL: 'https://browser.example.test',
  GAME_BROWSER_BRIDGE_TOKEN: 'bridge-secret-value',
};

function request(path, { method = 'POST', authorization, body, host = 'preview.example.test' } = {}) {
  return {
    method,
    path,
    body,
    headers: {
      host,
      ...(authorization ? { authorization } : {}),
    },
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const expectedOperations = [
  ['/game-browser/session-start', 'startGameQaSession'],
  ['/game-browser/observe', 'observeGameQaSession'],
  ['/game-browser/input', 'sendGameQaInput'],
  ['/game-browser/read-state', 'readGameQaState'],
  ['/game-browser/reset', 'resetGameQaSession'],
  ['/game-browser/session-end', 'endGameQaSession'],
];

test('OpenAPI exposes exactly the bounded game-browser Action operations as non-consequential bearer calls', async () => {
  const response = await handleActionRequest(request('/openapi.json', { method: 'GET' }), {
    env: bridgeEnv,
    fetchImpl: async () => { throw new Error('unexpected fetch'); },
  });
  assert.equal(response.status, 200);

  for (const [path, operationId] of expectedOperations) {
    const operation = response.body.paths[path]?.post;
    assert.ok(operation, `${path} must be present`);
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
    assert.equal(operation['x-openai-isConsequential'], false);
  }

  const exposedGamePaths = Object.keys(response.body.paths).filter((path) => path.startsWith('/game-browser/'));
  assert.deepEqual(exposedGamePaths.sort(), expectedOperations.map(([path]) => path).sort());
});

test('game-browser calls require the existing Action bearer before bridge access', async () => {
  const response = await handleActionRequest(
    request('/game-browser/observe', { body: { session_id: 'session_123' } }),
    { env: bridgeEnv, fetchImpl: async () => { throw new Error('unexpected fetch'); } },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'UNAUTHORIZED' });
});

test('missing or invalid browser bridge configuration fails closed', async () => {
  const missing = await handleActionRequest(
    request('/game-browser/observe', { authorization: 'Bearer action-secret', body: { session_id: 'session_123' } }),
    { env: baseEnv, fetchImpl: async () => { throw new Error('unexpected fetch'); } },
  );
  assert.equal(missing.status, 503);
  assert.deepEqual(missing.body, { error: 'GAME_BROWSER_CONFIGURATION_ERROR' });

  const invalid = await handleActionRequest(
    request('/game-browser/observe', { authorization: 'Bearer action-secret', body: { session_id: 'session_123' } }),
    {
      env: { ...bridgeEnv, GAME_BROWSER_RUNTIME_BASE_URL: 'http://browser.example.test/path' },
      fetchImpl: async () => { throw new Error('unexpected fetch'); },
    },
  );
  assert.equal(invalid.status, 503);
  assert.deepEqual(invalid.body, { error: 'GAME_BROWSER_CONFIGURATION_ERROR' });
});

test('session start proxies only to the fixed runtime bridge path with the dedicated upstream bearer', async () => {
  let captured;
  const upstream = {
    session_id: 'session_abc',
    deployment_provenance: {
      expected_commit_sha: 'a'.repeat(40),
      deployed_commit_sha: 'a'.repeat(40),
      deployment_id: 'dpl_abc123',
      deployment_url: 'https://target.example.test',
    },
    observation: {
      session_id: 'session_abc',
      content_trust: 'UNTRUSTED_TARGET_CONTENT',
      screenshot: { base64: Buffer.from('hello').toString('base64'), path: '/tmp/frame.png' },
    },
  };
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return jsonResponse(upstream);
  };

  const response = await handleActionRequest(
    request('/game-browser/session-start', {
      authorization: 'Bearer action-secret',
      body: { expected_commit_sha: 'a'.repeat(40), viewport: { width: 1280, height: 720 } },
    }),
    { env: bridgeEnv, fetchImpl },
  );

  assert.equal(response.status, 200);
  assert.equal(captured.url, 'https://browser.example.test/internal/gpt-action/session-start');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.authorization, 'Bearer bridge-secret-value');
  assert.notEqual(captured.options.headers.authorization, 'Bearer action-secret');
  assert.deepEqual(JSON.parse(captured.options.body), {
    expected_commit_sha: 'a'.repeat(40),
    viewport: { width: 1280, height: 720 },
  });

  assert.equal(response.body.observation.screenshot.available, true);
  assert.equal(response.body.observation.screenshot.transported, false);
  assert.equal(response.body.observation.screenshot.reason, 'ACTION_IMAGE_TRANSPORT_NOT_IMPLEMENTED');
  assert.equal(response.body.observation.screenshot.bytes, 5);
  assert.equal('base64' in response.body.observation.screenshot, false);
  assert.equal(JSON.stringify(response.body).includes('/tmp/frame.png'), false);
});

test('each Action route maps to one fixed runtime bridge path and arbitrary browser paths are rejected', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse({ ok: true });
  };

  for (const [path] of expectedOperations.slice(1)) {
    const response = await handleActionRequest(
      request(path, { authorization: 'Bearer action-secret', body: { session_id: 'session_123' } }),
      { env: bridgeEnv, fetchImpl },
    );
    assert.equal(response.status, 200, path);
  }

  assert.deepEqual(calls, [
    'https://browser.example.test/internal/gpt-action/observe',
    'https://browser.example.test/internal/gpt-action/input',
    'https://browser.example.test/internal/gpt-action/read-state',
    'https://browser.example.test/internal/gpt-action/reset',
    'https://browser.example.test/internal/gpt-action/session-end',
  ]);

  const before = calls.length;
  const rejected = await handleActionRequest(
    request('/game-browser/arbitrary', { authorization: 'Bearer action-secret', body: { url: 'https://example.com' } }),
    { env: bridgeEnv, fetchImpl },
  );
  assert.equal(rejected.status, 404);
  assert.deepEqual(rejected.body, { error: 'NOT_FOUND' });
  assert.equal(calls.length, before);
});

test('bounded runtime errors may pass through but upstream secret/error bodies never leak on protocol failures', async () => {
  const stale = await handleActionRequest(
    request('/game-browser/session-start', {
      authorization: 'Bearer action-secret',
      body: { expected_commit_sha: 'b'.repeat(40) },
    }),
    {
      env: bridgeEnv,
      fetchImpl: async () => jsonResponse({ error: 'STALE_DEPLOYMENT', message: 'no exact READY deployment exists' }, 409),
    },
  );
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body, { error: 'STALE_DEPLOYMENT', message: 'no exact READY deployment exists' });

  const failed = await handleActionRequest(
    request('/game-browser/observe', { authorization: 'Bearer action-secret', body: { session_id: 'session_123' } }),
    {
      env: bridgeEnv,
      fetchImpl: async () => new Response('bridge-secret-value exploded with provider-token-123', { status: 500 }),
    },
  );
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.body, { error: 'GAME_BROWSER_UPSTREAM_ERROR', status: 500 });
  assert.equal(JSON.stringify(failed.body).includes('bridge-secret-value'), false);
  assert.equal(JSON.stringify(failed.body).includes('provider-token-123'), false);
});
