import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/app.mjs';

const env = {
  UAL_ACTION_API_KEY: 'action-secret',
  GITHUB_TOKEN: 'skill-read-secret',
  GITHUB_CONTROL_TOKEN: 'control-secret',
  GITHUB_CONTROL_OWNERS: 'JOHNNYMACONNY',
};

function request(path, {
  method = 'GET',
  authorization = 'Bearer action-secret',
  host = 'preview.example.test',
  searchParams = {},
  body,
} = {}) {
  return {
    method,
    path,
    searchParams,
    body,
    headers: {
      host,
      ...(authorization ? { authorization } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function queueFetch(responses, captures = []) {
  return async (url, options = {}) => {
    captures.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return typeof next === 'function' ? next(url, options) : next;
  };
}

test('OpenAPI exposes the bounded GitHub control plane with autonomous implementation and consequential publication', async () => {
  const response = await handleActionRequest(request('/openapi.json', { authorization: undefined }), {
    env,
    fetchImpl: async () => { throw new Error('unexpected fetch'); },
  });

  assert.equal(response.status, 200);
  const paths = response.body.paths;
  assert.equal(paths['/github/repository'].get.operationId, 'getRepositoryState');
  assert.equal(paths['/github/file'].get.operationId, 'getRepositoryFile');
  assert.equal(paths['/github/tree'].get.operationId, 'getRepositoryTree');
  assert.equal(paths['/github/pull-request'].get.operationId, 'getPullRequestState');
  assert.equal(paths['/github/workflow-runs'].get.operationId, 'getWorkflowRuns');
  assert.equal(paths['/github/branch'].post.operationId, 'createWorkingBranch');
  assert.equal(paths['/github/file'].put.operationId, 'writeRepositoryFile');
  assert.equal(paths['/github/draft-pull-request'].post.operationId, 'createDraftPullRequest');
  assert.equal(paths['/github/branch'].post['x-openai-isConsequential'], false);
  assert.equal(paths['/github/file'].put['x-openai-isConsequential'], false);
  assert.equal(paths['/github/draft-pull-request'].post['x-openai-isConsequential'], true);
  for (const operation of [
    paths['/github/repository'].get,
    paths['/github/file'].get,
    paths['/github/tree'].get,
    paths['/github/pull-request'].get,
    paths['/github/workflow-runs'].get,
    paths['/github/branch'].post,
    paths['/github/file'].put,
    paths['/github/draft-pull-request'].post,
  ]) {
    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  }
  for (const forbidden of ['/github/merge', '/github/delete', '/github/proxy', '/github/workflow-dispatch', '/github/secrets']) {
    assert.equal(Object.hasOwn(paths, forbidden), false);
  }
});

test('control plane fails closed without its dedicated GitHub token', async () => {
  const response = await handleActionRequest(
    request('/github/repository', { searchParams: { repository: 'JOHNNYMACONNY/universal-agent-loop' } }),
    {
      env: { ...env, GITHUB_CONTROL_TOKEN: '' },
      fetchImpl: async () => { throw new Error('unexpected fetch'); },
    },
  );
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'CONTROL_CONFIGURATION_ERROR');
});

test('owner allowlist rejects an out-of-bound repository before GitHub access', async () => {
  const response = await handleActionRequest(
    request('/github/repository', { searchParams: { repository: 'someone-else/repo' } }),
    { env, fetchImpl: async () => { throw new Error('unexpected fetch'); } },
  );
  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'REPOSITORY_NOT_ALLOWED');
});

test('repository state returns a bounded projection', async () => {
  const captures = [];
  const fetchImpl = queueFetch([jsonResponse({
    full_name: 'JOHNNYMACONNY/universal-agent-loop',
    private: true,
    default_branch: 'main',
    archived: false,
    disabled: false,
    visibility: 'private',
    permissions: { admin: true, push: true, pull: true },
    html_url: 'https://github.com/JOHNNYMACONNY/universal-agent-loop',
    secret_noise: 'do-not-return',
  })], captures);

  const response = await handleActionRequest(
    request('/github/repository', { searchParams: { repository: 'JOHNNYMACONNY/universal-agent-loop' } }),
    { env, fetchImpl },
  );

  assert.equal(response.status, 200);
  assert.equal(captures[0].url, 'https://api.github.com/repos/JOHNNYMACONNY/universal-agent-loop');
  assert.equal(captures[0].options.headers.authorization, 'Bearer control-secret');
  assert.deepEqual(response.body, {
    repository: 'JOHNNYMACONNY/universal-agent-loop',
    private: true,
    defaultBranch: 'main',
    archived: false,
    disabled: false,
    visibility: 'private',
    permissions: { admin: true, push: true, pull: true },
    url: 'https://github.com/JOHNNYMACONNY/universal-agent-loop',
  });
});

test('file read decodes bounded UTF-8 content at the requested ref', async () => {
  const captures = [];
  const content = 'export const answer = 42;\n';
  const fetchImpl = queueFetch([jsonResponse({
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(content).toString('base64'),
    sha: 'blob-123',
    path: 'src/example.js',
    html_url: 'https://github.com/JOHNNYMACONNY/universal-agent-loop/blob/feature/src/example.js',
  })], captures);

  const response = await handleActionRequest(
    request('/github/file', {
      searchParams: {
        repository: 'JOHNNYMACONNY/universal-agent-loop',
        path: 'src/example.js',
        ref: 'chatgpt/feature',
      },
    }),
    { env, fetchImpl },
  );

  assert.equal(response.status, 200);
  assert.match(captures[0].url, /\/contents\/src\/example\.js\?ref=chatgpt%2Ffeature$/);
  assert.deepEqual(response.body, {
    repository: 'JOHNNYMACONNY/universal-agent-loop',
    ref: 'chatgpt/feature',
    path: 'src/example.js',
    blobSha: 'blob-123',
    content,
    sourceUrl: 'https://github.com/JOHNNYMACONNY/universal-agent-loop/blob/feature/src/example.js',
  });
});

test('file read rejects traversal before GitHub access', async () => {
  const response = await handleActionRequest(
    request('/github/file', {
      searchParams: { repository: 'JOHNNYMACONNY/universal-agent-loop', path: '../secret', ref: 'main' },
    }),
    { env, fetchImpl: async () => { throw new Error('unexpected fetch'); } },
  );
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'INVALID_REPOSITORY_PATH');
});

test('recursive tree is projected and locally bounded to 1000 entries', async () => {
  const tree = Array.from({ length: 1002 }, (_, index) => ({
    path: `src/file-${index}.js`,
    type: 'blob',
    mode: '100644',
    sha: `sha-${index}`,
    size: index,
    url: `https://api.github.com/noise/${index}`,
  }));
  const fetchImpl = queueFetch([jsonResponse({ sha: 'tree-root', truncated: false, tree })]);

  const response = await handleActionRequest(
    request('/github/tree', { searchParams: { repository: 'JOHNNYMACONNY/universal-agent-loop', ref: 'main' } }),
    { env, fetchImpl },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.entries.length, 1000);
  assert.equal(response.body.limitReached, true);
  assert.deepEqual(response.body.entries[0], {
    path: 'src/file-0.js', type: 'blob', mode: '100644', sha: 'sha-0', size: 0,
  });
});

test('pull request state returns refs and review-relevant status only', async () => {
  const fetchImpl = queueFetch([jsonResponse({
    number: 12,
    state: 'open',
    draft: true,
    merged: false,
    mergeable: true,
    mergeable_state: 'clean',
    title: 'Feature',
    body: 'Body',
    html_url: 'https://github.com/JOHNNYMACONNY/universal-agent-loop/pull/12',
    head: { ref: 'chatgpt/feature', sha: 'head-sha' },
    base: { ref: 'main', sha: 'base-sha' },
  })]);
  const response = await handleActionRequest(
    request('/github/pull-request', { searchParams: { repository: 'JOHNNYMACONNY/universal-agent-loop', number: '12' } }),
    { env, fetchImpl },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    repository: 'JOHNNYMACONNY/universal-agent-loop',
    number: 12,
    state: 'open',
    draft: true,
    merged: false,
    mergeable: true,
    mergeableState: 'clean',
    title: 'Feature',
    body: 'Body',
    head: { ref: 'chatgpt/feature', sha: 'head-sha' },
    base: { ref: 'main', sha: 'base-sha' },
    url: 'https://github.com/JOHNNYMACONNY/universal-agent-loop/pull/12',
  });
});

test('workflow runs are filtered and bounded', async () => {
  const captures = [];
  const fetchImpl = queueFetch([jsonResponse({ workflow_runs: [{
    id: 9,
    name: 'test',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'chatgpt/feature',
    head_sha: 'abc123',
    html_url: 'https://github.com/actions/runs/9',
    created_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-08-20T00:01:00Z',
    run_number: 4,
  }] })], captures);
  const response = await handleActionRequest(
    request('/github/workflow-runs', {
      searchParams: {
        repository: 'JOHNNYMACONNY/universal-agent-loop', branch: 'chatgpt/feature', headSha: 'abc123',
      },
    }),
    { env, fetchImpl },
  );
  assert.equal(response.status, 200);
  assert.match(captures[0].url, /per_page=20/);
  assert.match(captures[0].url, /branch=chatgpt%2Ffeature/);
  assert.match(captures[0].url, /head_sha=abc123/);
  assert.deepEqual(response.body.runs[0], {
    id: 9, name: 'test', event: 'push', status: 'completed', conclusion: 'success',
    headBranch: 'chatgpt/feature', headSha: 'abc123', url: 'https://github.com/actions/runs/9',
    createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-20T00:01:00Z', runNumber: 4,
  });
});

test('create branch resolves source ref and only creates chatgpt branches', async () => {
  const captures = [];
  const fetchImpl = queueFetch([
    jsonResponse({ full_name: 'JOHNNYMACONNY/universal-agent-loop', default_branch: 'main' }),
    jsonResponse({ object: { type: 'commit', sha: 'source-sha' } }),
    jsonResponse({ ref: 'refs/heads/chatgpt/feature', object: { sha: 'source-sha' } }, 201),
  ], captures);
  const response = await handleActionRequest(
    request('/github/branch', {
      method: 'POST',
      body: { repository: 'JOHNNYMACONNY/universal-agent-loop', branch: 'chatgpt/feature', fromRef: 'main' },
    }),
    { env, fetchImpl },
  );
  assert.equal(response.status, 201);
  assert.equal(captures[2].options.method, 'POST');
  assert.deepEqual(JSON.parse(captures[2].options.body), { ref: 'refs/heads/chatgpt/feature', sha: 'source-sha' });
  assert.deepEqual(response.body, {
    repository: 'JOHNNYMACONNY/universal-agent-loop', branch: 'chatgpt/feature', sha: 'source-sha',
  });
});

test('create branch rejects non-chatgpt names before GitHub access', async () => {
  const response = await handleActionRequest(
    request('/github/branch', {
      method: 'POST',
      body: { repository: 'JOHNNYMACONNY/universal-agent-loop', branch: 'main', fromRef: 'main' },
    }),
    { env, fetchImpl: async () => { throw new Error('unexpected fetch'); } },
  );
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'INVALID_WORKING_BRANCH');
});

test('file write encodes UTF-8 and sends optional current blob sha on a chatgpt branch', async () => {
  const captures = [];
  const fetchImpl = queueFetch([
    jsonResponse({ full_name: 'JOHNNYMACONNY/universal-agent-loop', default_branch: 'main' }),
    jsonResponse({
      content: { sha: 'new-blob', path: 'src/file.js', html_url: 'https://github.com/blob' },
      commit: { sha: 'commit-sha', html_url: 'https://github.com/commit' },
    }),
  ], captures);
  const response = await handleActionRequest(
    request('/github/file', {
      method: 'PUT',
      body: {
        repository: 'JOHNNYMACONNY/universal-agent-loop',
        path: 'src/file.js',
        branch: 'chatgpt/feature',
        message: 'feat: update file',
        content: 'hello\n',
        sha: 'old-blob',
      },
    }),
    { env, fetchImpl },
  );
  assert.equal(response.status, 200);
  const payload = JSON.parse(captures[1].options.body);
  assert.equal(payload.branch, 'chatgpt/feature');
  assert.equal(payload.message, 'feat: update file');
  assert.equal(payload.sha, 'old-blob');
  assert.equal(Buffer.from(payload.content, 'base64').toString('utf8'), 'hello\n');
  assert.deepEqual(response.body, {
    repository: 'JOHNNYMACONNY/universal-agent-loop',
    branch: 'chatgpt/feature',
    path: 'src/file.js',
    contentSha: 'new-blob',
    commitSha: 'commit-sha',
    contentUrl: 'https://github.com/blob',
    commitUrl: 'https://github.com/commit',
  });
});

test('file write rejects the repository default branch before mutation', async () => {
  const captures = [];
  const fetchImpl = queueFetch([
    jsonResponse({ full_name: 'JOHNNYMACONNY/universal-agent-loop', default_branch: 'main' }),
  ], captures);
  const response = await handleActionRequest(
    request('/github/file', {
      method: 'PUT',
      body: {
        repository: 'JOHNNYMACONNY/universal-agent-loop', path: 'src/file.js', branch: 'main',
        message: 'bad', content: 'no',
      },
    }),
    { env, fetchImpl },
  );
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'INVALID_WORKING_BRANCH');
  assert.equal(captures.length, 1);
});

test('file write rejects content over 512 KiB before mutation', async () => {
  const response = await handleActionRequest(
    request('/github/file', {
      method: 'PUT',
      body: {
        repository: 'JOHNNYMACONNY/universal-agent-loop', path: 'src/file.js', branch: 'chatgpt/feature',
        message: 'big', content: 'x'.repeat(512 * 1024 + 1),
      },
    }),
    { env, fetchImpl: async () => { throw new Error('unexpected fetch'); } },
  );
  assert.equal(response.status, 413);
  assert.equal(response.body.error, 'FILE_TOO_LARGE');
});

test('draft pull request is always forced draft and uses the default base when omitted', async () => {
  const captures = [];
  const fetchImpl = queueFetch([
    jsonResponse({ full_name: 'JOHNNYMACONNY/universal-agent-loop', default_branch: 'main' }),
    jsonResponse({
      number: 21, state: 'open', draft: true, html_url: 'https://github.com/pull/21',
      head: { ref: 'chatgpt/feature', sha: 'head-sha' }, base: { ref: 'main', sha: 'base-sha' },
    }, 201),
  ], captures);
  const response = await handleActionRequest(
    request('/github/draft-pull-request', {
      method: 'POST',
      body: {
        repository: 'JOHNNYMACONNY/universal-agent-loop', head: 'chatgpt/feature',
        title: 'Feature', body: 'Description', draft: false,
      },
    }),
    { env, fetchImpl },
  );
  assert.equal(response.status, 201);
  assert.deepEqual(JSON.parse(captures[1].options.body), {
    title: 'Feature', body: 'Description', head: 'chatgpt/feature', base: 'main', draft: true,
  });
  assert.deepEqual(response.body, {
    repository: 'JOHNNYMACONNY/universal-agent-loop', number: 21, state: 'open', draft: true,
    head: { ref: 'chatgpt/feature', sha: 'head-sha' }, base: { ref: 'main', sha: 'base-sha' },
    url: 'https://github.com/pull/21',
  });
});

test('unexpected GitHub control failures never reflect upstream body or credentials', async () => {
  const response = await handleActionRequest(
    request('/github/repository', { searchParams: { repository: 'JOHNNYMACONNY/universal-agent-loop' } }),
    { env, fetchImpl: async () => jsonResponse({ message: 'control-secret leaked upstream detail' }, 500) },
  );
  assert.equal(response.status, 502);
  assert.deepEqual(response.body, { error: 'GITHUB_CONTROL_UPSTREAM_ERROR', status: 500 });
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes('control-secret'), false);
  assert.equal(serialized.includes('leaked upstream detail'), false);
});
