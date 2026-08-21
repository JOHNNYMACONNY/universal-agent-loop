import assert from 'node:assert/strict';
import test from 'node:test';

import { RuntimeError } from '../src/errors.js';
import { VercelDeploymentVerifier } from '../src/provenance/vercel-deployment.js';

const SHA = 'a'.repeat(40);
const REPOSITORY = { owner: 'owner', name: 'repo' };
const PROJECT_ID = 'prj_target';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'dpl_candidate',
    state: 'READY',
    projectId: PROJECT_ID,
    url: 'target-candidate.vercel.app',
    meta: {
      githubCommitSha: SHA,
      githubCommitOrg: REPOSITORY.owner,
      githubCommitRepo: REPOSITORY.name,
    },
    ...overrides,
  };
}

test('exact-commit discovery lists only the configured project, selects a READY exact Git match, then re-verifies the immutable deployment', async () => {
  const calls: Array<{ url: URL; method: string }> = [];
  const verifier = new VercelDeploymentVerifier({
    token: 'vercel-secret',
    teamId: 'team_1',
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method ?? 'GET');
      calls.push({ url, method });
      assert.equal(init?.headers && 'authorization' in init.headers ? init.headers.authorization : undefined, 'Bearer vercel-secret');
      if (url.pathname === '/v6/deployments') {
        return jsonResponse({ deployments: [
          deployment({ uid: 'dpl_wrong_repo', meta: { githubCommitSha: SHA, githubCommitOrg: 'other', githubCommitRepo: 'repo' } }),
          deployment({ uid: 'dpl_building', state: 'BUILDING' }),
          deployment({ uid: 'dpl_exact' }),
        ] });
      }
      if (url.pathname === '/v13/deployments/dpl_exact') {
        return jsonResponse({
          id: 'dpl_exact',
          projectId: PROJECT_ID,
          readyState: 'READY',
          url: 'target-exact.vercel.app',
          meta: {
            githubCommitSha: SHA,
            githubCommitOrg: REPOSITORY.owner,
            githubCommitRepo: REPOSITORY.name,
          },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  const resolved = await verifier.findReadyForCommit({
    expectedCommitSha: SHA,
    repository: REPOSITORY,
    projectId: PROJECT_ID,
  });

  assert.equal(resolved.deploymentId, 'dpl_exact');
  assert.equal(resolved.commitSha, SHA);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url.pathname, '/v6/deployments');
  assert.equal(calls[0]?.url.searchParams.get('projectId'), PROJECT_ID);
  assert.equal(calls[0]?.url.searchParams.get('limit'), '20');
  assert.equal(calls[0]?.url.searchParams.get('teamId'), 'team_1');
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[1]?.url.pathname, '/v13/deployments/dpl_exact');
  assert.equal(calls.every((call) => call.method === 'GET'), true);
});

test('discovery inspects at most 20 returned candidates and fails stale when no bounded exact READY match exists', async () => {
  const tooLate = Array.from({ length: 21 }, (_, index) => deployment({
    uid: `dpl_${index}`,
    meta: index === 20
      ? { githubCommitSha: SHA, githubCommitOrg: REPOSITORY.owner, githubCommitRepo: REPOSITORY.name }
      : { githubCommitSha: 'b'.repeat(40), githubCommitOrg: REPOSITORY.owner, githubCommitRepo: REPOSITORY.name },
  }));

  const verifier = new VercelDeploymentVerifier({
    token: 'vercel-secret',
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/v6/deployments');
      return jsonResponse({ deployments: tooLate });
    },
  });

  await assert.rejects(
    verifier.findReadyForCommit({ expectedCommitSha: SHA, repository: REPOSITORY, projectId: PROJECT_ID }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'STALE_DEPLOYMENT',
  );
});

test('discovery rejects malformed commits before provider access', async () => {
  let called = false;
  const verifier = new VercelDeploymentVerifier({
    token: 'vercel-secret',
    fetchImpl: async () => { called = true; throw new Error('unexpected provider access'); },
  });

  await assert.rejects(
    verifier.findReadyForCommit({ expectedCommitSha: 'main', repository: REPOSITORY, projectId: PROJECT_ID }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'PROVENANCE_MISMATCH',
  );
  assert.equal(called, false);
});
