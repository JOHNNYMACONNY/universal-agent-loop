import { timingSafeEqual } from 'node:crypto';

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

function openApiSchema(request, env) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Universal Agent Loop Canonical Skills',
      version: '0.1.0',
      description: 'Private read-only GPT Action for retrieving the current canonical Universal Agent Loop skill definitions from GitHub.',
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
          security: [{ bearerAuth: [] }],
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
            '200': {
              description: 'Current canonical skill.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SkillResponse' },
                },
              },
            },
            '400': { description: 'Invalid skill name.' },
            '401': { description: 'Missing or invalid Action bearer key.' },
            '404': { description: 'Canonical skill does not exist.' },
            '502': { description: 'GitHub upstream failed.' },
            '503': { description: 'Server configuration is incomplete.' },
          },
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

export async function handleActionRequest(request, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (String(request.method ?? 'GET').toUpperCase() !== 'GET') {
    return result(405, { error: 'METHOD_NOT_ALLOWED' }, { allow: 'GET' });
  }

  const path = String(request.path ?? '/');
  if (path === '/health') return result(200, { ok: true, service: 'ual-gpt-action-api' });
  if (path === '/openapi.json') return result(200, openApiSchema(request, env));

  const match = /^\/skills\/(.+)$/.exec(path);
  if (!match) return result(404, { error: 'NOT_FOUND' });

  let name;
  try {
    name = decodeURIComponent(match[1]);
  } catch {
    return result(400, { error: 'INVALID_SKILL_NAME' });
  }
  if (!SKILL_NAME.test(name)) return result(400, { error: 'INVALID_SKILL_NAME' });

  const actionKey = env.UAL_ACTION_API_KEY?.trim();
  if (!actionKey) return configurationError();
  const presented = bearerToken(readHeader(request.headers, 'authorization'));
  if (!safeEqual(presented, actionKey)) return result(401, { error: 'UNAUTHORIZED' }, { 'www-authenticate': 'Bearer' });

  return fetchCanonicalSkill(name, env, fetchImpl);
}
