import { timingSafeEqual } from 'node:crypto';

import { handleGithubControlRequest } from './github-control.mjs';

const REPOSITORY = 'JOHNNYMACONNY/universal-agent-loop';
const CANONICAL_REF = 'main';
const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_SKILL_BYTES = 512 * 1024;

function result(status, body, headers = {}) {
  return {
    status,
    body,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  };
}

function methodNotAllowed(allow) {
  return result(405, { error: 'METHOD_NOT_ALLOWED' }, { allow });
}

function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function safeEqual(left, right) {
  const a = Buffer.from(left ?? '', 'utf8');
  const b = Buffer.from(right ?? '', 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function bearerToken(authorization) {
  if (typeof authorization !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1] ?? '';
}

function baseUrl(request, env) {
  const explicit = env.ACTION_BASE_URL?.trim();
  if (explicit) {
    try {
      const parsed = new URL(explicit);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash) {
        return parsed.origin;
      }
    } catch {
      // Fall through to the validated request host.
    }
  }

  const host = String(readHeader(request.headers, 'host') ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host)) return 'https://invalid.local';
  return `https://${host}`;
}

function bearerSecurity() {
  return [{ bearerAuth: [] }];
}

function repositoryParameter() {
  return {
    name: 'repository',
    in: 'query',
    required: true,
    description: 'Target GitHub repository in owner/repo form. The owner must be server-allowlisted.',
    schema: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$' },
  };
}

function jsonResponse(schemaRef, description = 'Success.') {
  return {
    description,
    content: { 'application/json': { schema: { $ref: schemaRef } } },
  };
}

function protectedErrors() {
  return {
    '400': { description: 'Invalid Action input.' },
    '401': { description: 'Missing or invalid Action bearer key.' },
    '403': { description: 'Repository boundary or GitHub permission denied.' },
    '404': { description: 'Requested GitHub resource not found.' },
    '409': { description: 'GitHub conflict or stale review/merge state.' },
    '413': { description: 'Local request or file size limit exceeded.' },
    '422': { description: 'GitHub validation conflict.' },
    '502': { description: 'GitHub upstream failed or returned an invalid response.' },
    '503': { description: 'Required server configuration is incomplete.' },
  };
}

function openApiSchema(request, env) {
  const security = bearerSecurity();
  const errors = protectedErrors();
  return {
    openapi: '3.1.0',
    info: {
      title: 'Universal Agent Loop Control Plane',
      version: '0.3.0',
      description: 'Private GPT Action for loading canonical Universal Agent Loop skills and performing bounded GitHub repository control-plane operations.',
    },
    servers: [{ url: baseUrl(request, env) }],
    paths: {
      '/health': {
        get: {
          operationId: 'getActionHealth',
          summary: 'Check whether the GPT Action service is reachable.',
          responses: { '200': { description: 'Service is reachable.' } },
        },
      },
      '/skills/{name}': {
        get: {
          operationId: 'getCanonicalSkill',
          summary: 'Retrieve a canonical Universal Agent Loop SKILL.md from the main branch.',
          description: 'Use this before starting or resuming work so the GPT follows the current canonical workflow rather than a cached copy.',
          security,
          parameters: [
            {
              name: 'name',
              in: 'path',
              required: true,
              description: 'Canonical skill directory name, for example autonomous-dev-loop or game-browser-testing.',
              schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
            },
          ],
          responses: {
            '200': jsonResponse('#/components/schemas/SkillResponse', 'Current canonical skill.'),
            '400': { description: 'Invalid skill name.' },
            '401': { description: 'Missing or invalid Action bearer key.' },
            '404': { description: 'Canonical skill does not exist.' },
            '502': { description: 'GitHub upstream failed.' },
            '503': { description: 'Server configuration is incomplete.' },
          },
        },
      },
      '/github/repository': {
        get: {
          operationId: 'getRepositoryState',
          summary: 'Inspect bounded repository metadata and the default branch.',
          security,
          parameters: [repositoryParameter()],
          responses: { '200': jsonResponse('#/components/schemas/RepositoryState'), ...errors },
        },
      },
      '/github/file': {
        get: {
          operationId: 'getRepositoryFile',
          summary: 'Read one UTF-8 repository file at a ref.',
          security,
          parameters: [
            repositoryParameter(),
            { name: 'path', in: 'query', required: true, schema: { type: 'string', maxLength: 1024 } },
            { name: 'ref', in: 'query', required: false, schema: { type: 'string', maxLength: 200 } },
          ],
          responses: { '200': jsonResponse('#/components/schemas/RepositoryFile'), ...errors },
        },
        put: {
          operationId: 'writeRepositoryFile',
          summary: 'Create or update one UTF-8 file on a guarded chatgpt/ working branch.',
          description: 'Never writes the repository default branch. Requires a chatgpt/ branch.',
          security,
          'x-openai-isConsequential': false,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WriteRepositoryFileRequest' } } },
          },
          responses: { '200': jsonResponse('#/components/schemas/RepositoryFileWrite'), '201': jsonResponse('#/components/schemas/RepositoryFileWrite'), ...errors },
        },
      },
      '/github/tree': {
        get: {
          operationId: 'getRepositoryTree',
          summary: 'Read a bounded recursive repository tree at a ref.',
          security,
          parameters: [repositoryParameter(), { name: 'ref', in: 'query', required: false, schema: { type: 'string', maxLength: 200 } }],
          responses: { '200': jsonResponse('#/components/schemas/RepositoryTree'), ...errors },
        },
      },
      '/github/pull-request': {
        get: {
          operationId: 'getPullRequestState',
          summary: 'Inspect one pull request and its head/base state.',
          security,
          parameters: [repositoryParameter(), { name: 'number', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } }],
          responses: { '200': jsonResponse('#/components/schemas/PullRequestState'), ...errors },
        },
        post: {
          operationId: 'createPullRequest',
          summary: 'Create a normal pull request from a guarded chatgpt/ branch to the default branch.',
          description: 'PR creation is part of the autonomous development loop; code review still gates merge.',
          security,
          'x-openai-isConsequential': false,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatePullRequestRequest' } } },
          },
          responses: { '201': jsonResponse('#/components/schemas/PullRequestState'), ...errors },
        },
      },
      '/github/workflow-runs': {
        get: {
          operationId: 'getWorkflowRuns',
          summary: 'Inspect up to 20 recent GitHub Actions workflow runs.',
          security,
          parameters: [
            repositoryParameter(),
            { name: 'branch', in: 'query', required: false, schema: { type: 'string', maxLength: 200 } },
            { name: 'headSha', in: 'query', required: false, schema: { type: 'string', pattern: '^[A-Fa-f0-9]{6,64}$' } },
          ],
          responses: { '200': jsonResponse('#/components/schemas/WorkflowRuns'), ...errors },
        },
      },
      '/github/branch': {
        post: {
          operationId: 'createWorkingBranch',
          summary: 'Create a new guarded chatgpt/ working branch.',
          security,
          'x-openai-isConsequential': false,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateWorkingBranchRequest' } } },
          },
          responses: { '201': jsonResponse('#/components/schemas/WorkingBranch'), ...errors },
        },
      },
      '/github/draft-pull-request': {
        post: {
          operationId: 'createDraftPullRequest',
          summary: 'Create a backward-compatible draft pull request from a guarded chatgpt/ branch.',
          description: 'Compatibility endpoint. The autonomous loop prefers createPullRequest; this endpoint always forces draft=true.',
          security,
          'x-openai-isConsequential': true,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateDraftPullRequestRequest' } } },
          },
          responses: { '201': jsonResponse('#/components/schemas/PullRequestState'), ...errors },
        },
      },
      '/github/merge-pull-request': {
        post: {
          operationId: 'mergePullRequest',
          summary: 'Merge the exact pull-request head that passed the autonomous code-review gate.',
          description: 'Requires reviewedHeadSha. The server rejects stale heads, drafts, closed PRs, non-chatgpt heads, and non-default bases.',
          security,
          'x-openai-isConsequential': false,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MergePullRequestRequest' } } },
          },
          responses: { '200': jsonResponse('#/components/schemas/PullRequestMerge'), ...errors },
        },
      },
    },
    components: {
      schemas: {
        SkillResponse: {
          type: 'object',
          required: ['name', 'repository', 'ref', 'path', 'blobSha', 'content', 'sourceUrl'],
          properties: {
            name: { type: 'string' },
            repository: { type: 'string' },
            ref: { type: 'string' },
            path: { type: 'string' },
            blobSha: { type: 'string' },
            content: { type: 'string' },
            sourceUrl: { type: 'string', format: 'uri' },
          },
          additionalProperties: false,
        },
        RepositoryState: {
          type: 'object',
          required: ['repository', 'private', 'defaultBranch', 'archived', 'disabled'],
          properties: {
            repository: { type: 'string' }, private: { type: 'boolean' }, defaultBranch: { type: 'string' },
            archived: { type: 'boolean' }, disabled: { type: 'boolean' }, visibility: { type: 'string' },
            permissions: { type: 'object', additionalProperties: { type: 'boolean' } }, url: { type: 'string' },
          },
          additionalProperties: false,
        },
        RepositoryFile: {
          type: 'object',
          required: ['repository', 'ref', 'path', 'blobSha', 'content'],
          properties: {
            repository: { type: 'string' }, ref: { type: 'string' }, path: { type: 'string' }, blobSha: { type: 'string' },
            content: { type: 'string' }, sourceUrl: { type: 'string' },
          },
          additionalProperties: false,
        },
        TreeEntry: {
          type: 'object',
          required: ['path', 'type', 'mode', 'sha'],
          properties: { path: { type: 'string' }, type: { type: 'string' }, mode: { type: 'string' }, sha: { type: 'string' }, size: { type: 'integer' } },
          additionalProperties: false,
        },
        RepositoryTree: {
          type: 'object',
          required: ['repository', 'ref', 'treeSha', 'truncated', 'limitReached', 'entries'],
          properties: {
            repository: { type: 'string' }, ref: { type: 'string' }, treeSha: { type: 'string' }, truncated: { type: 'boolean' },
            limitReached: { type: 'boolean' }, entries: { type: 'array', maxItems: 1000, items: { $ref: '#/components/schemas/TreeEntry' } },
          },
          additionalProperties: false,
        },
        RefState: {
          type: 'object',
          properties: { ref: { type: 'string' }, sha: { type: 'string' } },
          additionalProperties: false,
        },
        PullRequestState: {
          type: 'object',
          required: ['repository', 'number', 'state', 'draft', 'merged', 'head', 'base'],
          properties: {
            repository: { type: 'string' }, number: { type: 'integer' }, state: { type: 'string' }, draft: { type: 'boolean' }, merged: { type: 'boolean' },
            mergeable: { type: ['boolean', 'null'] }, mergeableState: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
            head: { $ref: '#/components/schemas/RefState' }, base: { $ref: '#/components/schemas/RefState' }, url: { type: 'string' },
          },
          additionalProperties: false,
        },
        WorkflowRun: {
          type: 'object',
          required: ['id', 'name', 'event', 'status', 'headSha', 'runNumber'],
          properties: {
            id: { type: 'integer' }, name: { type: 'string' }, event: { type: 'string' }, status: { type: 'string' }, conclusion: { type: ['string', 'null'] },
            headBranch: { type: ['string', 'null'] }, headSha: { type: 'string' }, url: { type: 'string' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' }, runNumber: { type: 'integer' },
          },
          additionalProperties: false,
        },
        WorkflowRuns: {
          type: 'object',
          required: ['repository', 'runs'],
          properties: { repository: { type: 'string' }, runs: { type: 'array', maxItems: 20, items: { $ref: '#/components/schemas/WorkflowRun' } } },
          additionalProperties: false,
        },
        CreateWorkingBranchRequest: {
          type: 'object',
          required: ['repository', 'branch'],
          properties: { repository: { type: 'string' }, branch: { type: 'string', pattern: '^chatgpt/.+' }, fromRef: { type: 'string' } },
          additionalProperties: false,
        },
        WorkingBranch: {
          type: 'object',
          required: ['repository', 'branch', 'sha'],
          properties: { repository: { type: 'string' }, branch: { type: 'string' }, sha: { type: 'string' } },
          additionalProperties: false,
        },
        WriteRepositoryFileRequest: {
          type: 'object',
          required: ['repository', 'path', 'branch', 'message', 'content'],
          properties: {
            repository: { type: 'string' }, path: { type: 'string', maxLength: 1024 }, branch: { type: 'string', pattern: '^chatgpt/.+' },
            message: { type: 'string', maxLength: 300 }, content: { type: 'string' }, sha: { type: 'string' },
          },
          additionalProperties: false,
        },
        RepositoryFileWrite: {
          type: 'object',
          required: ['repository', 'branch', 'path', 'contentSha', 'commitSha'],
          properties: {
            repository: { type: 'string' }, branch: { type: 'string' }, path: { type: 'string' }, contentSha: { type: 'string' }, commitSha: { type: 'string' },
            contentUrl: { type: 'string' }, commitUrl: { type: 'string' },
          },
          additionalProperties: false,
        },
        CreatePullRequestRequest: {
          type: 'object',
          required: ['repository', 'head', 'title'],
          properties: {
            repository: { type: 'string' }, head: { type: 'string', pattern: '^chatgpt/.+' }, base: { type: 'string' },
            title: { type: 'string', maxLength: 256 }, body: { type: 'string', maxLength: 20000 },
          },
          additionalProperties: false,
        },
        CreateDraftPullRequestRequest: {
          type: 'object',
          required: ['repository', 'head', 'title'],
          properties: {
            repository: { type: 'string' }, head: { type: 'string', pattern: '^chatgpt/.+' }, base: { type: 'string' },
            title: { type: 'string', maxLength: 256 }, body: { type: 'string', maxLength: 20000 },
          },
          additionalProperties: false,
        },
        MergePullRequestRequest: {
          type: 'object',
          required: ['repository', 'number', 'reviewedHeadSha'],
          properties: {
            repository: { type: 'string' },
            number: { type: 'integer', minimum: 1 },
            reviewedHeadSha: { type: 'string', pattern: '^[A-Fa-f0-9]{6,64}$' },
          },
          additionalProperties: false,
        },
        PullRequestMerge: {
          type: 'object',
          required: ['repository', 'number', 'reviewedHeadSha', 'mergeMethod', 'merged', 'mergeSha'],
          properties: {
            repository: { type: 'string' },
            number: { type: 'integer' },
            reviewedHeadSha: { type: 'string' },
            mergeMethod: { type: 'string', enum: ['merge', 'squash', 'rebase'] },
            merged: { type: 'boolean' },
            mergeSha: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
  };
}

function configurationError() {
  return result(503, { error: 'CONFIGURATION_ERROR' });
}

async function fetchCanonicalSkill(name, env, fetchImpl) {
  const githubToken = env.GITHUB_TOKEN?.trim();
  if (!githubToken) return configurationError();

  const path = `skills/${name}/SKILL.md`;
  const url = `https://api.github.com/repos/${REPOSITORY}/contents/${path}?ref=${CANONICAL_REF}`;
  let upstream;
  try {
    upstream = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${githubToken}`,
        'user-agent': 'ual-gpt-action-api',
        'x-github-api-version': '2022-11-28',
      },
    });
  } catch {
    return result(502, { error: 'GITHUB_UPSTREAM_ERROR', status: 0 });
  }

  if (upstream.status === 404) return result(404, { error: 'SKILL_NOT_FOUND', name });
  if (upstream.status !== 200) return result(502, { error: 'GITHUB_UPSTREAM_ERROR', status: upstream.status });

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return result(502, { error: 'GITHUB_UPSTREAM_ERROR', status: upstream.status });
  }

  if (payload?.type !== 'file' || payload?.encoding !== 'base64' || typeof payload?.content !== 'string' || typeof payload?.sha !== 'string') {
    return result(502, { error: 'GITHUB_UPSTREAM_INVALID_RESPONSE' });
  }

  const bytes = Buffer.from(payload.content.replace(/\s/g, ''), 'base64');
  if (bytes.byteLength > MAX_SKILL_BYTES) return result(502, { error: 'SKILL_TOO_LARGE' });
  const content = bytes.toString('utf8');
  const sourceUrl = typeof payload.html_url === 'string'
    ? payload.html_url
    : `https://github.com/${REPOSITORY}/blob/${CANONICAL_REF}/${path}`;

  return result(200, {
    name,
    repository: REPOSITORY,
    ref: CANONICAL_REF,
    path,
    blobSha: payload.sha,
    content,
    sourceUrl,
  });
}

function authenticate(request, env) {
  const actionKey = env.UAL_ACTION_API_KEY?.trim();
  if (!actionKey) return configurationError();
  const presented = bearerToken(readHeader(request.headers, 'authorization'));
  if (!safeEqual(presented, actionKey)) return result(401, { error: 'UNAUTHORIZED' }, { 'www-authenticate': 'Bearer' });
  return null;
}

export async function handleActionRequest(request, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const method = String(request.method ?? 'GET').toUpperCase();
  const path = String(request.path ?? '/');

  if (path === '/health') {
    if (method !== 'GET') return methodNotAllowed('GET');
    return result(200, { ok: true, service: 'ual-gpt-action-api' });
  }
  if (path === '/openapi.json') {
    if (method !== 'GET') return methodNotAllowed('GET');
    return result(200, openApiSchema(request, env));
  }

  const authError = authenticate(request, env);
  if (authError) return authError;

  if (path.startsWith('/github/')) return handleGithubControlRequest(request, { env, fetchImpl });

  const match = /^\/skills\/(.+)$/.exec(path);
  if (!match) return result(404, { error: 'NOT_FOUND' });
  if (method !== 'GET') return methodNotAllowed('GET');

  let name;
  try {
    name = decodeURIComponent(match[1]);
  } catch {
    return result(400, { error: 'INVALID_SKILL_NAME' });
  }
  if (!SKILL_NAME.test(name)) return result(400, { error: 'INVALID_SKILL_NAME' });

  return fetchCanonicalSkill(name, env, fetchImpl);
}
