import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/app.mjs';

const env = {
  UAL_ACTION_API_KEY: 'action-secret',
  GITHUB_TOKEN: 'skill-read-secret',
  GITHUB_CONTROL_TOKEN: 'control-secret',
  GITHUB_CONTROL_OWNERS: 'JOHNNYMACONNY',
};

const HEAD_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OLD_HEAD_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NEW_HEAD_SHA = 'cccccccccccccccccccccccccccccccccccccccc';
const MERGE_SHA = 'dddddddddddddddddddddddddddddddddddddddd';

function request(path, { method = 'GET', authorization = 'Bearer action-secret', searchParams = {}, body } = {}) {
  return {
    method,
    path,
    searchParams,
    body,
    headers: {
      host: 'preview.example.test',
      ...(authorization ? { authorization } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function queueFetch(responses, captures = []) {
  return async (url, options = {}) => {
    captures.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return typeof next === 'function' ? next(url, options) : next;
  };
}

function repositoryPayload() {
  return {
    full_name: 'JOHNNYMACONNY/universal-agent-loop',
    default_branch: 'main',
    allow_squash_merge: true,
    allow_merge_commit: true,
    allow_rebase_merge: true,
  };
}

test('OpenAPI exposes autonomous PR creation and reviewed merge without per-call confirmation', async () => {
  const response = await handleActionRequest(request('/openapi.json', { authorization: undefined }), {
    env,
    fetchImpl: async () => { throw new Error('unexpected fetch'); },
  });

  assert.equal(response.status, 200);
  const paths = response.body.paths;
  assert.equal(paths['/github/pull-request'].post.operationId, 'createPullRequest');
  assert.equal(paths['/github/pull-request'].post['x-openai-isConsequential'], false);
  assert.equal(paths['/github/merge-pull-request'].post.operationId, 'mergePullRequest');
  assert.equal(paths['/github/merge-pull-request'].post['x-openai-isConsequential'], false);
  assert.equal(paths['/github/draft-pull-request'].post.operationId, 'createDraftPullRequest');
  assert.equal(paths['/github/draft-pull-request'].post['x-openai-isConsequential'], true);
  assert.equal(
    paths['/github/draft-pull-request'].post.responses['201'].content['application/json'].schema.$ref,
    '#/components/schemas/LegacyDraftPullRequest',
  );
  assert.deepEqual(
    response.body.components.schemas.LegacyDraftPullRequest.required,
    ['repository', 'number', 'state', 'draft', 'head', 'base'],
  );
});

test('PR creation publishes a normal PR from chatgpt branch to repository default branch', async () => {
  const captures = [];
  const fetchImpl = queueFetch([
    jsonResponse(repositoryPayload()),
    jsonResponse({
      number: 21,
      state: 'open',
      draft: false,
      html_url: 'https://github.com/JOHNNYMACONNY/universal-agent-loop/pull/21',
      head: { ref: 'chatgpt/feature', sha: HEAD_SHA },
      base: { ref: 'main', sha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
    }, 201),
  ], captures);

  const response = await handleActionRequest(request('/github/pull-request', {
    method: 'POST',
    body: {
      repository: 'JOHNNYMACONNY/universal-agent-loop',
      head: 'chatgpt/feature',
      title: 'Feature',
      body: 'Description',
    },
  }), { env, fetchImpl });

  assert.equal(response.status, 201);
  assert.equal(captures[1].url, 'https://api.github.com/repos/JOHNNYMACONNY/universal-agent-loop/pulls');
  assert.deepEqual(JSON.parse(captures[1].options.body), {
    title: 'Feature', body: 'Description', head: 'chatgpt/feature', base: 'main', draft: false,
  });
  assert.equal(response.body.draft, false);
});

test('merge requires the exact reviewed PR head and merges that head autonomously', async () => {
  const captures = [];
  const fetchImpl = queueFetch([
    jsonResponse(repositoryPayload()),
    jsonResponse({
      number: 21,
      state: 'open',
      draft: false,
      merged: false,
      head: { ref: 'chatgpt/feature', sha: HEAD_SHA },
      base: { ref: 'main', sha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
    }),
    jsonResponse({ sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' }),
  ], captures);

  const response = await handleActionRequest(request('/github/merge-pull-request', {
    method: 'POST',
    body: {
      repository: 'JOHNNYMACONNY/universal-agent-loop',
      number: 21,
      reviewedHeadSha: HEAD_SHA,
    },
  }), { env, fetchImpl });

  assert.equal(response.status, 200);
  assert.equal(captures[2].url, 'https://api.github.com/repos/JOHNNYMACONNY/universal-agent-loop/pulls/21/merge');
  assert.equal(captures[2].options.method, 'PUT');
  assert.deepEqual(JSON.parse(captures[2].options.body), { sha: HEAD_SHA, merge_method: 'squash' });
  assert.deepEqual(response.body, {
    repository: 'JOHNNYMACONNY/universal-agent-loop',
    number: 21,
    reviewedHeadSha: HEAD_SHA,
    mergeMethod: 'squash',
    merged: true,
    mergeSha: MERGE_SHA,
  });
});

test('merge fails closed when the PR head moved after review', async () => {
  const captures = [];
  const fetchImpl = queueFetch([
    jsonResponse(repositoryPayload()),
    jsonResponse({
      number: 21,
      state: 'open',
      draft: false,
      merged: false,
      head: { ref: 'chatgpt/feature', sha: NEW_HEAD_SHA },
      base: { ref: 'main', sha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
    }),
  ], captures);

  const response = await handleActionRequest(request('/github/merge-pull-request', {
    method: 'POST',
    body: {
      repository: 'JOHNNYMACONNY/universal-agent-loop',
      number: 21,
      reviewedHeadSha: OLD_HEAD_SHA,
    },
  }), { env, fetchImpl });

  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'STALE_REVIEW_HEAD');
  assert.equal(captures.length, 2, 'must not call merge endpoint after reviewed head becomes stale');
});

test('merge refuses draft, closed, non-chatgpt, or non-default-base pull requests', async () => {
  const variants = [
    { state: 'open', draft: true, head: { ref: 'chatgpt/feature', sha: HEAD_SHA }, base: { ref: 'main' } },
    { state: 'closed', draft: false, head: { ref: 'chatgpt/feature', sha: HEAD_SHA }, base: { ref: 'main' } },
    { state: 'open', draft: false, head: { ref: 'feature', sha: HEAD_SHA }, base: { ref: 'main' } },
    { state: 'open', draft: false, head: { ref: 'chatgpt/feature', sha: HEAD_SHA }, base: { ref: 'release' } },
  ];

  for (const pull of variants) {
    const captures = [];
    const response = await handleActionRequest(request('/github/merge-pull-request', {
      method: 'POST',
      body: { repository: 'JOHNNYMACONNY/universal-agent-loop', number: 21, reviewedHeadSha: HEAD_SHA },
    }), {
      env,
      fetchImpl: queueFetch([jsonResponse(repositoryPayload()), jsonResponse({ number: 21, merged: false, ...pull })], captures),
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'PULL_REQUEST_NOT_READY');
    assert.equal(captures.length, 2);
  }
});
