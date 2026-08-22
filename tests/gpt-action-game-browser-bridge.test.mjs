import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/action-router.mjs';

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

test('OpenAPI exposes exactly the bounded game-browser Action operations as non-consequential bearer calls with a camelCase public contract', async () => {
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
  assert.deepEqual(response.body.components.schemas.GameQaSessionStartRequest.required, ['expectedCommitSha']);
  assert.equal('expectedCommitSha' in response.body.components.schemas.GameQaSessionStartRequest.properties, true);
  assert.equal('expected_commit_sha' in response.body.components.schemas.GameQaSessionStartRequest.properties, false);
  assert.deepEqual(response.body.components.schemas.GameQaSessionRequest.required, ['sessionId']);
});

test('game-browser calls require the existing Action bearer before bridge access', async () => {
  const response = await handleActionRequest(
    request('/game-browser/observe', { body: { sessionId: 'session_123' } }),
    { env: bridgeEnv, fetchImpl: async () => { throw new Error('unexpected fetch'); } },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'UNAUTHORIZED' });
});

test('missing or invalid browser bridge configuration fails closed', async () => {
  const missing = await handleActionRequest(
    request('/game-browser/observe', { authorization: 'Bearer action-secret', body: { sessionId: 'session_123' } }),
    { env: baseEnv, fetchImpl: async () => { throw new Error('unexpected fetch'); } },
  );
  assert.equal(missing.status, 503);
  assert.deepEqual(missing.body, { error: 'GAME_BROWSER_CONFIGURATION_ERROR' });

  const invalid = await handleActionRequest(
    request('/game-browser/observe', { authorization: 'Bearer action-secret', body: { sessionId: 'session_123' } }),
    {
      env: { ...bridgeEnv, GAME_BROWSER_RUNTIME_BASE_URL: 'http://browser.example.test/path' },
      fetchImpl: async () => { throw new Error('unexpected fetch'); },
    },
  );
  assert.equal(invalid.status, 503);
  assert.deepEqual(invalid.body, { error: 'GAME_BROWSER_CONFIGURATION_ERROR' });
});

test('session start translates the public camelCase contract only to the fixed runtime bridge path with the dedicated upstream bearer', async () => {
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
      body: { expectedCommitSha: 'a'.repeat(40), viewport: { width: 1280, height: 720 } },
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
  assert.equal(response.body.observation.screenshot.transported, true);
  assert.equal(response.body.observation.screenshot.mime_type, 'image/png');
  assert.equal(response.body.observation.screenshot.bytes, 5);
  assert.match(response.body.observation.screenshot.screenshot_url, /^https:\/\/browser\.example\.test\/internal\/gpt-action\/screenshot\?/);
  assert.match(response.body.observation.screenshot.expires_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal('base64' in response.body.observation.screenshot, false);
  assert.equal(JSON.stringify(response.body).includes('/tmp/frame.png'), false);
});

test('each Action route translates only its camelCase public fields to one fixed runtime bridge path', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return jsonResponse({ ok: true });
  };

  const cases = [
    ['/game-browser/observe', { sessionId: 'session_123', expectedObservationSeq: 4 }, '/internal/gpt-action/observe', { session_id: 'session_123', expected_observation_seq: 4 }],
    ['/game-browser/input', {
      sessionId: 'session_123', actionBatchId: 'batch_1', expectedActionSeq: 2,
      actions: [
        { type: 'press', key: 'Enter', durationMs: 25 },
        { type: 'scroll', deltaX: 1, deltaY: 2 },
      ],
    }, '/internal/gpt-action/input', {
      session_id: 'session_123', action_batch_id: 'batch_1', expected_action_seq: 2,
      actions: [
        { type: 'press', key: 'Enter', duration_ms: 25 },
        { type: 'scroll', delta_x: 1, delta_y: 2 },
      ],
    }],
    ['/game-browser/read-state', { sessionId: 'session_123', path: '/player' }, '/internal/gpt-action/read-state', { session_id: 'session_123', path: '/player' }],
    ['/game-browser/reset', { sessionId: 'session_123', mode: 'reload' }, '/internal/gpt-action/reset', { session_id: 'session_123', mode: 'reload' }],
    ['/game-browser/session-end', { sessionId: 'session_123' }, '/internal/gpt-action/session-end', { session_id: 'session_123' }],
  ];

  for (const [path, body] of cases) {
    const response = await handleActionRequest(
      request(path, { authorization: 'Bearer action-secret', body }),
      { env: bridgeEnv, fetchImpl },
    );
    assert.equal(response.status, 200, path);
  }

  assert.deepEqual(calls, cases.map(([, , upstreamPath, upstreamBody]) => ({
    url: `https://browser.example.test${upstreamPath}`,
    body: upstreamBody,
  })));

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
      body: { expectedCommitSha: 'b'.repeat(40) },
    }),
    {
      env: bridgeEnv,
      fetchImpl: async () => jsonResponse({ error: 'STALE_DEPLOYMENT', message: 'no exact READY deployment exists' }, 409),
    },
  );
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body, { error: 'STALE_DEPLOYMENT', message: 'no exact READY deployment exists' });

  const failed = await handleActionRequest(
    request('/game-browser/observe', { authorization: 'Bearer action-secret', body: { sessionId: 'session_123' } }),
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

