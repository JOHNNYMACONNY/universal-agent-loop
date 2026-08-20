import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/app.mjs';

const env = {
  UAL_ACTION_API_KEY: 'action-secret',
  GITHUB_TOKEN: 'github-secret',
};

function request(path, { method = 'GET', authorization, host = 'preview.example.test' } = {}) {
  return {
    method,
    path,
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

test('health is public and does not expose configuration', async () => {
  const response = await handleActionRequest(request('/health'), { env, fetchImpl: async () => { throw new Error('unexpected fetch'); } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, service: 'ual-gpt-action-api' });
});

test('OpenAPI schema is public, host-bound, importable, and declares bearer auth for skill retrieval', async () => {
  const response = await handleActionRequest(request('/openapi.json'), { env, fetchImpl: async () => { throw new Error('unexpected fetch'); } });
  assert.equal(response.status, 200);
  assert.equal(response.body.openapi, '3.1.0');
  assert.deepEqual(response.body.servers, [{ url: 'https://preview.example.test' }]);
  assert.equal(response.body.components.securitySchemes.bearerAuth.type, 'http');
  assert.equal(response.body.components.securitySchemes.bearerAuth.scheme, 'bearer');
  assert.equal(typeof response.body.components.schemas, 'object');
  assert.equal(Array.isArray(response.body.components.schemas), false);
  assert.equal(response.body.components.schemas.SkillResponse.type, 'object');
  assert.deepEqual(
    response.body.paths['/skills/{name}'].get.responses['200'].content['application/json'].schema,
    { $ref: '#/components/schemas/SkillResponse' },
  );
  assert.equal(response.body.paths['/skills/{name}'].get.operationId, 'getCanonicalSkill');
  assert.deepEqual(response.body.paths['/skills/{name}'].get.security, [{ bearerAuth: [] }]);
});

test('skill retrieval fails closed without the Action bearer key', async () => {
  const response = await handleActionRequest(request('/skills/autonomous-dev-loop'), { env, fetchImpl: async () => { throw new Error('unexpected fetch'); } });
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'UNAUTHORIZED');
});

test('skill retrieval rejects invalid names before GitHub access', async () => {
  const response = await handleActionRequest(
    request('/skills/..%2Fsecret', { authorization: 'Bearer action-secret' }),
    { env, fetchImpl: async () => { throw new Error('unexpected fetch'); } },
  );
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'INVALID_SKILL_NAME');
});

test('skill retrieval reads the current canonical main-branch SKILL.md from private GitHub', async () => {
  let captured;
  const content = '---\nname: autonomous-dev-loop\n---\n\n# Current canonical skill\n';
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return jsonResponse({
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha: 'blob-sha-123',
      html_url: 'https://github.com/JOHNNYMACONNY/universal-agent-loop/blob/main/skills/autonomous-dev-loop/SKILL.md',
    });
  };

  const response = await handleActionRequest(
    request('/skills/autonomous-dev-loop', { authorization: 'Bearer action-secret' }),
    { env, fetchImpl },
  );

  assert.equal(response.status, 200);
  assert.equal(captured.url, 'https://api.github.com/repos/JOHNNYMACONNY/universal-agent-loop/contents/skills/autonomous-dev-loop/SKILL.md?ref=main');
  assert.equal(captured.options.headers.authorization, 'Bearer github-secret');
  assert.equal(captured.options.headers['x-github-api-version'], '2022-11-28');
  assert.deepEqual(response.body, {
    name: 'autonomous-dev-loop',
    repository: 'JOHNNYMACONNY/universal-agent-loop',
    ref: 'main',
    path: 'skills/autonomous-dev-loop/SKILL.md',
    blobSha: 'blob-sha-123',
    content,
    sourceUrl: 'https://github.com/JOHNNYMACONNY/universal-agent-loop/blob/main/skills/autonomous-dev-loop/SKILL.md',
  });
});

test('missing server configuration fails closed without attempting GitHub access', async () => {
  const response = await handleActionRequest(
    request('/skills/autonomous-dev-loop', { authorization: 'Bearer action-secret' }),
    { env: { UAL_ACTION_API_KEY: 'action-secret' }, fetchImpl: async () => { throw new Error('unexpected fetch'); } },
  );
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'CONFIGURATION_ERROR');
});

test('GitHub not-found maps to a bounded skill-not-found response', async () => {
  const response = await handleActionRequest(
    request('/skills/missing-skill', { authorization: 'Bearer action-secret' }),
    { env, fetchImpl: async () => jsonResponse({ message: 'Not Found' }, 404) },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'SKILL_NOT_FOUND', name: 'missing-skill' });
});

test('unexpected GitHub failures do not leak upstream bodies or credentials', async () => {
  const response = await handleActionRequest(
    request('/skills/autonomous-dev-loop', { authorization: 'Bearer action-secret' }),
    { env, fetchImpl: async () => jsonResponse({ message: 'token github-secret exploded' }, 500) },
  );
  assert.equal(response.status, 502);
  assert.deepEqual(response.body, { error: 'GITHUB_UPSTREAM_ERROR', status: 500 });
  assert.equal(JSON.stringify(response.body).includes('github-secret'), false);
});

test('non-GET methods are rejected', async () => {
  const response = await handleActionRequest(request('/health', { method: 'POST' }), { env, fetchImpl: async () => { throw new Error('unexpected fetch'); } });
  assert.equal(response.status, 405);
  assert.equal(response.body.error, 'METHOD_NOT_ALLOWED');
});
