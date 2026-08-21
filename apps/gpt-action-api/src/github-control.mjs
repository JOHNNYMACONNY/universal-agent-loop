const API = 'https://api.github.com';
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TREE_ENTRIES = 1000;
const MAX_PATH_LENGTH = 1024;
const MAX_COMMIT_MESSAGE = 300;
const MAX_PR_TITLE = 256;
const MAX_PR_BODY = 20_000;

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

function controlConfig(env) {
  const token = env.GITHUB_CONTROL_TOKEN?.trim();
  const ownerValues = String(env.GITHUB_CONTROL_OWNERS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!token || ownerValues.length === 0) return null;
  return { token, owners: new Set(ownerValues.map((value) => value.toLowerCase())) };
}

function validateRepository(value, owners) {
  if (typeof value !== 'string' || value.length > 201) return { error: result(400, { error: 'INVALID_REPOSITORY' }) };
  const match = /^([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})$/.exec(value);
  if (!match) return { error: result(400, { error: 'INVALID_REPOSITORY' }) };
  const [repository, owner, repo] = [match[0], match[1], match[2]];
  if (!owners.has(owner.toLowerCase())) return { error: result(403, { error: 'REPOSITORY_NOT_ALLOWED' }) };
  return { repository, owner, repo };
}

function validRef(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && /^[A-Za-z0-9._/-]+$/.test(value)
    && !value.startsWith('/')
    && !value.endsWith('/')
    && !value.includes('..')
    && !value.includes('@{')
    && !value.includes('\\')
    && !value.includes('//');
}

function validWorkingBranch(value) {
  return validRef(value) && value.startsWith('chatgpt/') && value.length > 'chatgpt/'.length;
}

function validPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) return false;
  if (value.startsWith('/') || value.endsWith('/') || value.includes('\\') || value.includes('\0') || value.includes('//')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment && segment !== '.' && segment !== '..');
}

function validCommitSha(value) {
  return typeof value === 'string' && /^[A-Fa-f0-9]{6,64}$/.test(value);
}

function exactCommitSha(value) {
  return typeof value === 'string' && /^[A-Fa-f0-9]{40}$/.test(value);
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function queryValue(request, name) {
  const value = request.searchParams?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return Number(value);
  return null;
}

function parseBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && !Buffer.isBuffer(body)) return { value: body };
  let text;
  if (typeof body === 'string') text = body;
  else if (Buffer.isBuffer(body)) text = body.toString('utf8');
  else return { error: result(400, { error: 'INVALID_JSON_BODY' }) };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return { value: parsed };
  } catch {
    return { error: result(400, { error: 'INVALID_JSON_BODY' }) };
  }
}

function boundedText(value, max, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') return null;
  if ((!allowEmpty && value.length === 0) || value.length > max) return null;
  return value;
}

function upstreamError(status) {
  if (status === 401 || status === 403) return result(403, { error: 'GITHUB_CONTROL_FORBIDDEN', status });
  if (status === 404) return result(404, { error: 'GITHUB_CONTROL_NOT_FOUND', status });
  if (status === 405 || status === 409) return result(409, { error: 'GITHUB_CONTROL_CONFLICT', status });
  if (status === 422) return result(422, { error: 'GITHUB_CONTROL_VALIDATION_ERROR', status });
  return result(502, { error: 'GITHUB_CONTROL_UPSTREAM_ERROR', status });
}

async function githubJson(url, { token, fetchImpl, method = 'GET', body, expected = [200] }) {
  let upstream;
  try {
    upstream = await fetchImpl(url, {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'ual-gpt-action-api',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { error: result(502, { error: 'GITHUB_CONTROL_UPSTREAM_ERROR', status: 0 }) };
  }
  if (!expected.includes(upstream.status)) return { error: upstreamError(upstream.status) };
  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return { error: result(502, { error: 'GITHUB_CONTROL_UPSTREAM_ERROR', status: upstream.status }) };
  }
  return { payload, status: upstream.status };
}

function repositoryProjection(repository, payload) {
  return {
    repository,
    private: Boolean(payload.private),
    defaultBranch: payload.default_branch,
    archived: Boolean(payload.archived),
    disabled: Boolean(payload.disabled),
    visibility: payload.visibility,
    permissions: payload.permissions,
    url: payload.html_url,
  };
}

function pullProjection(repository, payload) {
  return {
    repository,
    number: payload.number,
    state: payload.state,
    draft: Boolean(payload.draft),
    merged: Boolean(payload.merged),
    mergeable: payload.mergeable,
    mergeableState: payload.mergeable_state,
    title: payload.title,
    body: payload.body ?? '',
    head: { ref: payload.head?.ref, sha: payload.head?.sha },
    base: { ref: payload.base?.ref, sha: payload.base?.sha },
    url: payload.html_url,
  };
}

function legacyDraftPullProjection(repository, payload) {
  return {
    repository,
    number: payload.number,
    state: payload.state,
    draft: Boolean(payload.draft),
    head: { ref: payload.head?.ref, sha: payload.head?.sha },
    base: { ref: payload.base?.ref, sha: payload.base?.sha },
    url: payload.html_url,
  };
}

function chooseMergeMethod(repository) {
  if (repository.allow_squash_merge) return 'squash';
  if (repository.allow_merge_commit) return 'merge';
  if (repository.allow_rebase_merge) return 'rebase';
  return null;
}

async function fetchRepository(repositoryInfo, context) {
  const response = await githubJson(`${API}/repos/${repositoryInfo.owner}/${repositoryInfo.repo}`, context);
  if (response.error) return response;
  if (typeof response.payload?.default_branch !== 'string' || typeof response.payload?.full_name !== 'string') {
    return { error: result(502, { error: 'GITHUB_CONTROL_INVALID_RESPONSE' }) };
  }
  if (response.payload.full_name.toLowerCase() !== repositoryInfo.repository.toLowerCase()) {
    return { error: result(403, { error: 'REPOSITORY_NOT_ALLOWED' }) };
  }
  return response;
}

function prepare(request, env) {
  const config = controlConfig(env);
  if (!config) return { error: result(503, { error: 'CONTROL_CONFIGURATION_ERROR' }) };
  const repositoryInfo = validateRepository(queryValue(request, 'repository'), config.owners);
  if (repositoryInfo.error) return repositoryInfo;
  return { config, repositoryInfo };
}

function prepareBodyRepository(body, env) {
  const config = controlConfig(env);
  if (!config) return { error: result(503, { error: 'CONTROL_CONFIGURATION_ERROR' }) };
  const repositoryInfo = validateRepository(body.repository, config.owners);
  if (repositoryInfo.error) return repositoryInfo;
  return { config, repositoryInfo };
}

async function getRepositoryState(request, env, fetchImpl) {
  const prepared = prepare(request, env);
  if (prepared.error) return prepared.error;
  const response = await fetchRepository(prepared.repositoryInfo, { token: prepared.config.token, fetchImpl });
  if (response.error) return response.error;
  return result(200, repositoryProjection(prepared.repositoryInfo.repository, response.payload));
}

async function getRepositoryFile(request, env, fetchImpl) {
  const prepared = prepare(request, env);
  if (prepared.error) return prepared.error;
  const path = queryValue(request, 'path');
  if (!validPath(path)) return result(400, { error: 'INVALID_REPOSITORY_PATH' });
  let ref = queryValue(request, 'ref');
  if (ref !== undefined && !validRef(ref)) return result(400, { error: 'INVALID_REF' });
  if (ref === undefined) {
    const repository = await fetchRepository(prepared.repositoryInfo, { token: prepared.config.token, fetchImpl });
    if (repository.error) return repository.error;
    ref = repository.payload.default_branch;
  }
  const url = `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;
  const response = await githubJson(url, { token: prepared.config.token, fetchImpl });
  if (response.error) return response.error;
  const payload = response.payload;
  if (payload?.type !== 'file' || payload?.encoding !== 'base64' || typeof payload.content !== 'string' || typeof payload.sha !== 'string') {
    return result(502, { error: 'GITHUB_CONTROL_INVALID_RESPONSE' });
  }
  const bytes = Buffer.from(payload.content.replace(/\s/g, ''), 'base64');
  if (bytes.byteLength > MAX_FILE_BYTES) return result(413, { error: 'FILE_TOO_LARGE' });
  return result(200, {
    repository: prepared.repositoryInfo.repository,
    ref,
    path,
    blobSha: payload.sha,
    content: bytes.toString('utf8'),
    sourceUrl: payload.html_url,
  });
}

async function getRepositoryTree(request, env, fetchImpl) {
  const prepared = prepare(request, env);
  if (prepared.error) return prepared.error;
  let ref = queryValue(request, 'ref');
  if (ref !== undefined && !validRef(ref)) return result(400, { error: 'INVALID_REF' });
  if (ref === undefined) {
    const repository = await fetchRepository(prepared.repositoryInfo, { token: prepared.config.token, fetchImpl });
    if (repository.error) return repository.error;
    ref = repository.payload.default_branch;
  }
  const response = await githubJson(
    `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/git/trees/${encodePath(ref)}?recursive=1`,
    { token: prepared.config.token, fetchImpl },
  );
  if (response.error) return response.error;
  if (!Array.isArray(response.payload?.tree) || typeof response.payload?.sha !== 'string') {
    return result(502, { error: 'GITHUB_CONTROL_INVALID_RESPONSE' });
  }
  const entries = response.payload.tree.slice(0, MAX_TREE_ENTRIES).map((entry) => ({
    path: entry.path,
    type: entry.type,
    mode: entry.mode,
    sha: entry.sha,
    ...(Number.isFinite(entry.size) ? { size: entry.size } : {}),
  }));
  return result(200, {
    repository: prepared.repositoryInfo.repository,
    ref,
    treeSha: response.payload.sha,
    truncated: Boolean(response.payload.truncated),
    limitReached: response.payload.tree.length > MAX_TREE_ENTRIES,
    entries,
  });
}

async function getPullRequestState(request, env, fetchImpl) {
  const prepared = prepare(request, env);
  if (prepared.error) return prepared.error;
  const number = parsePositiveInteger(queryValue(request, 'number'));
  if (!number) return result(400, { error: 'INVALID_PULL_REQUEST_NUMBER' });
  const response = await githubJson(
    `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/pulls/${number}`,
    { token: prepared.config.token, fetchImpl },
  );
  if (response.error) return response.error;
  return result(200, pullProjection(prepared.repositoryInfo.repository, response.payload));
}

async function getWorkflowRuns(request, env, fetchImpl) {
  const prepared = prepare(request, env);
  if (prepared.error) return prepared.error;
  const branch = queryValue(request, 'branch');
  const headSha = queryValue(request, 'headSha');
  if (branch !== undefined && !validRef(branch)) return result(400, { error: 'INVALID_REF' });
  if (headSha !== undefined && !validCommitSha(headSha)) return result(400, { error: 'INVALID_HEAD_SHA' });
  const query = new URLSearchParams({ per_page: '20' });
  if (branch !== undefined) query.set('branch', branch);
  if (headSha !== undefined) query.set('head_sha', headSha);
  const response = await githubJson(
    `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/actions/runs?${query.toString()}`,
    { token: prepared.config.token, fetchImpl },
  );
  if (response.error) return response.error;
  if (!Array.isArray(response.payload?.workflow_runs)) return result(502, { error: 'GITHUB_CONTROL_INVALID_RESPONSE' });
  return result(200, {
    repository: prepared.repositoryInfo.repository,
    runs: response.payload.workflow_runs.slice(0, 20).map((run) => ({
      id: run.id,
      name: run.name,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      headBranch: run.head_branch,
      headSha: run.head_sha,
      url: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      runNumber: run.run_number,
    })),
  });
}

async function createWorkingBranch(request, env, fetchImpl) {
  const parsed = parseBody(request.body);
  if (parsed.error) return parsed.error;
  const body = parsed.value;
  if (!validWorkingBranch(body.branch)) return result(400, { error: 'INVALID_WORKING_BRANCH' });
  if (body.fromRef !== undefined && !validRef(body.fromRef)) return result(400, { error: 'INVALID_REF' });
  const prepared = prepareBodyRepository(body, env);
  if (prepared.error) return prepared.error;
  const context = { token: prepared.config.token, fetchImpl };
  const repository = await fetchRepository(prepared.repositoryInfo, context);
  if (repository.error) return repository.error;
  if (body.branch === repository.payload.default_branch) return result(400, { error: 'INVALID_WORKING_BRANCH' });
  const fromRef = body.fromRef ?? repository.payload.default_branch;
  const source = exactCommitSha(fromRef)
    ? await githubJson(
      `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/git/commits/${fromRef}`,
      context,
    )
    : await githubJson(
      `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/git/ref/heads/${encodePath(fromRef)}`,
      context,
    );
  if (source.error) return source.error;
  const sourceSha = exactCommitSha(fromRef) ? source.payload?.sha : source.payload?.object?.sha;
  if (typeof sourceSha !== 'string') return result(502, { error: 'GITHUB_CONTROL_INVALID_RESPONSE' });
  const created = await githubJson(
    `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/git/refs`,
    { ...context, method: 'POST', body: { ref: `refs/heads/${body.branch}`, sha: sourceSha }, expected: [201] },
  );
  if (created.error) return created.error;
  return result(201, { repository: prepared.repositoryInfo.repository, branch: body.branch, sha: created.payload?.object?.sha ?? sourceSha });
}

async function writeRepositoryFile(request, env, fetchImpl) {
  const parsed = parseBody(request.body);
  if (parsed.error) return parsed.error;
  const body = parsed.value;
  if (!validPath(body.path)) return result(400, { error: 'INVALID_REPOSITORY_PATH' });
  if (!validRef(body.branch)) return result(400, { error: 'INVALID_WORKING_BRANCH' });
  const message = boundedText(body.message, MAX_COMMIT_MESSAGE);
  if (message === null) return result(400, { error: 'INVALID_COMMIT_MESSAGE' });
  if (typeof body.content !== 'string') return result(400, { error: 'INVALID_FILE_CONTENT' });
  if (Buffer.byteLength(body.content, 'utf8') > MAX_FILE_BYTES) return result(413, { error: 'FILE_TOO_LARGE' });
  if (body.sha !== undefined && (typeof body.sha !== 'string' || body.sha.length > 100 || body.sha.length === 0)) {
    return result(400, { error: 'INVALID_BLOB_SHA' });
  }
  const prepared = prepareBodyRepository(body, env);
  if (prepared.error) return prepared.error;
  const context = { token: prepared.config.token, fetchImpl };
  const repository = await fetchRepository(prepared.repositoryInfo, context);
  if (repository.error) return repository.error;
  if (!validWorkingBranch(body.branch) || body.branch === repository.payload.default_branch) {
    return result(400, { error: 'INVALID_WORKING_BRANCH' });
  }
  const payload = {
    message,
    content: Buffer.from(body.content, 'utf8').toString('base64'),
    branch: body.branch,
    ...(body.sha === undefined ? {} : { sha: body.sha }),
  };
  const written = await githubJson(
    `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/contents/${encodePath(body.path)}`,
    { ...context, method: 'PUT', body: payload, expected: [200, 201] },
  );
  if (written.error) return written.error;
  return result(written.status, {
    repository: prepared.repositoryInfo.repository,
    branch: body.branch,
    path: body.path,
    contentSha: written.payload?.content?.sha,
    commitSha: written.payload?.commit?.sha,
    contentUrl: written.payload?.content?.html_url,
    commitUrl: written.payload?.commit?.html_url,
  });
}

async function createPullRequest(request, env, fetchImpl) {
  const parsed = parseBody(request.body);
  if (parsed.error) return parsed.error;
  const body = parsed.value;
  if (!validWorkingBranch(body.head)) return result(400, { error: 'INVALID_WORKING_BRANCH' });
  if (body.base !== undefined && !validRef(body.base)) return result(400, { error: 'INVALID_REF' });
  const title = boundedText(body.title, MAX_PR_TITLE);
  const pullBody = boundedText(body.body ?? '', MAX_PR_BODY, { allowEmpty: true });
  if (title === null) return result(400, { error: 'INVALID_PULL_REQUEST_TITLE' });
  if (pullBody === null) return result(400, { error: 'INVALID_PULL_REQUEST_BODY' });
  const prepared = prepareBodyRepository(body, env);
  if (prepared.error) return prepared.error;
  const context = { token: prepared.config.token, fetchImpl };
  const repository = await fetchRepository(prepared.repositoryInfo, context);
  if (repository.error) return repository.error;
  const base = body.base ?? repository.payload.default_branch;
  if (base !== repository.payload.default_branch || body.head === base) {
    return result(400, { error: 'INVALID_PULL_REQUEST_REFS' });
  }
  const created = await githubJson(
    `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/pulls`,
    { ...context, method: 'POST', body: { title, body: pullBody, head: body.head, base, draft: false }, expected: [201] },
  );
  if (created.error) return created.error;
  return result(201, pullProjection(prepared.repositoryInfo.repository, created.payload));
}

async function createDraftPullRequest(request, env, fetchImpl) {
  const parsed = parseBody(request.body);
  if (parsed.error) return parsed.error;
  const body = parsed.value;
  if (!validWorkingBranch(body.head)) return result(400, { error: 'INVALID_WORKING_BRANCH' });
  if (body.base !== undefined && !validRef(body.base)) return result(400, { error: 'INVALID_REF' });
  const title = boundedText(body.title, MAX_PR_TITLE);
  const pullBody = boundedText(body.body ?? '', MAX_PR_BODY, { allowEmpty: true });
  if (title === null) return result(400, { error: 'INVALID_PULL_REQUEST_TITLE' });
  if (pullBody === null) return result(400, { error: 'INVALID_PULL_REQUEST_BODY' });
  const prepared = prepareBodyRepository(body, env);
  if (prepared.error) return prepared.error;
  const context = { token: prepared.config.token, fetchImpl };
  const repository = await fetchRepository(prepared.repositoryInfo, context);
  if (repository.error) return repository.error;
  const base = body.base ?? repository.payload.default_branch;
  if (base !== repository.payload.default_branch || body.head === base) {
    return result(400, { error: 'INVALID_PULL_REQUEST_REFS' });
  }
  const created = await githubJson(
    `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/pulls`,
    { ...context, method: 'POST', body: { title, body: pullBody, head: body.head, base, draft: true }, expected: [201] },
  );
  if (created.error) return created.error;
  return result(201, legacyDraftPullProjection(prepared.repositoryInfo.repository, created.payload));
}

async function mergePullRequest(request, env, fetchImpl) {
  const parsed = parseBody(request.body);
  if (parsed.error) return parsed.error;
  const body = parsed.value;
  const number = parsePositiveInteger(body.number);
  if (!number) return result(400, { error: 'INVALID_PULL_REQUEST_NUMBER' });
  if (!validCommitSha(body.reviewedHeadSha)) return result(400, { error: 'INVALID_REVIEWED_HEAD_SHA' });

  const prepared = prepareBodyRepository(body, env);
  if (prepared.error) return prepared.error;
  const context = { token: prepared.config.token, fetchImpl };
  const repository = await fetchRepository(prepared.repositoryInfo, context);
  if (repository.error) return repository.error;
  const pull = await githubJson(
    `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/pulls/${number}`,
    context,
  );
  if (pull.error) return pull.error;

  const payload = pull.payload;
  if (payload?.head?.sha !== body.reviewedHeadSha) return result(409, { error: 'STALE_REVIEW_HEAD' });
  if (
    payload?.state !== 'open'
    || Boolean(payload?.draft)
    || Boolean(payload?.merged)
    || !validWorkingBranch(payload?.head?.ref)
    || payload?.base?.ref !== repository.payload.default_branch
  ) {
    return result(409, { error: 'PULL_REQUEST_NOT_READY' });
  }

  const mergeMethod = chooseMergeMethod(repository.payload);
  if (!mergeMethod) return result(409, { error: 'MERGE_METHOD_UNAVAILABLE' });
  const merged = await githubJson(
    `${API}/repos/${prepared.repositoryInfo.owner}/${prepared.repositoryInfo.repo}/pulls/${number}/merge`,
    {
      ...context,
      method: 'PUT',
      body: { sha: body.reviewedHeadSha, merge_method: mergeMethod },
      expected: [200],
    },
  );
  if (merged.error) return merged.error;
  if (!merged.payload?.merged || typeof merged.payload?.sha !== 'string') return result(409, { error: 'MERGE_REJECTED' });

  return result(200, {
    repository: prepared.repositoryInfo.repository,
    number,
    reviewedHeadSha: body.reviewedHeadSha,
    mergeMethod,
    merged: true,
    mergeSha: merged.payload.sha,
  });
}

function methodNotAllowed(allow) {
  return result(405, { error: 'METHOD_NOT_ALLOWED' }, { allow });
}

export async function handleGithubControlRequest(request, { env, fetchImpl }) {
  const method = String(request.method ?? 'GET').toUpperCase();
  switch (request.path) {
    case '/github/repository':
      if (method !== 'GET') return methodNotAllowed('GET');
      return getRepositoryState(request, env, fetchImpl);
    case '/github/file':
      if (method === 'GET') return getRepositoryFile(request, env, fetchImpl);
      if (method === 'PUT') return writeRepositoryFile(request, env, fetchImpl);
      return methodNotAllowed('GET, PUT');
    case '/github/tree':
      if (method !== 'GET') return methodNotAllowed('GET');
      return getRepositoryTree(request, env, fetchImpl);
    case '/github/pull-request':
      if (method === 'GET') return getPullRequestState(request, env, fetchImpl);
      if (method === 'POST') return createPullRequest(request, env, fetchImpl);
      return methodNotAllowed('GET, POST');
    case '/github/workflow-runs':
      if (method !== 'GET') return methodNotAllowed('GET');
      return getWorkflowRuns(request, env, fetchImpl);
    case '/github/branch':
      if (method !== 'POST') return methodNotAllowed('POST');
      return createWorkingBranch(request, env, fetchImpl);
    case '/github/draft-pull-request':
      if (method !== 'POST') return methodNotAllowed('POST');
      return createDraftPullRequest(request, env, fetchImpl);
    case '/github/merge-pull-request':
      if (method !== 'POST') return methodNotAllowed('POST');
      return mergePullRequest(request, env, fetchImpl);
    default:
      return result(404, { error: 'NOT_FOUND' });
  }
}
