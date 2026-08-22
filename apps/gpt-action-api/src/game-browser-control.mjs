import { createHmac } from 'node:crypto';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_MESSAGE = 1024;
const MAX_SCREENSHOT_BYTES = 2_000_000;
const SCREENSHOT_LINK_TTL_MS = 5 * 60_000;

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function translateSessionStart(body) {
  const {
    expectedCommitSha,
    expected_commit_sha: _legacyExpectedCommitSha,
    ...rest
  } = body;
  return { ...rest, expected_commit_sha: expectedCommitSha };
}

function translateSession(body) {
  const { sessionId, session_id: _legacySessionId, ...rest } = body;
  return { ...rest, session_id: sessionId };
}

function translateObserve(body) {
  const {
    sessionId,
    expectedObservationSeq,
    session_id: _legacySessionId,
    expected_observation_seq: _legacyObservationSeq,
    ...rest
  } = body;
  return {
    ...rest,
    session_id: sessionId,
    ...(expectedObservationSeq === undefined ? {} : { expected_observation_seq: expectedObservationSeq }),
  };
}

function translateAction(action) {
  const value = objectValue(action);
  if (!value) return action;
  const {
    durationMs,
    deltaX,
    deltaY,
    duration_ms: _legacyDurationMs,
    delta_x: _legacyDeltaX,
    delta_y: _legacyDeltaY,
    ...rest
  } = value;
  return {
    ...rest,
    ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
    ...(deltaX === undefined ? {} : { delta_x: deltaX }),
    ...(deltaY === undefined ? {} : { delta_y: deltaY }),
  };
}

function translateInput(body) {
  const {
    sessionId,
    actionBatchId,
    expectedActionSeq,
    actions,
    session_id: _legacySessionId,
    action_batch_id: _legacyBatchId,
    expected_action_seq: _legacyActionSeq,
    ...rest
  } = body;
  return {
    ...rest,
    session_id: sessionId,
    action_batch_id: actionBatchId,
    expected_action_seq: expectedActionSeq,
    actions: Array.isArray(actions) ? actions.map(translateAction) : actions,
  };
}

const ROUTES = new Map([
  ['/game-browser/session-start', { upstreamPath: '/internal/gpt-action/session-start', translate: translateSessionStart }],
  ['/game-browser/observe', { upstreamPath: '/internal/gpt-action/observe', translate: translateObserve }],
  ['/game-browser/input', { upstreamPath: '/internal/gpt-action/input', translate: translateInput }],
  ['/game-browser/read-state', { upstreamPath: '/internal/gpt-action/read-state', translate: translateSession }],
  ['/game-browser/reset', { upstreamPath: '/internal/gpt-action/reset', translate: translateSession }],
  ['/game-browser/session-end', { upstreamPath: '/internal/gpt-action/session-end', translate: translateSession }],
]);

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

function configuration(env) {
  const token = env.GAME_BROWSER_BRIDGE_TOKEN?.trim();
  const rawBaseUrl = env.GAME_BROWSER_RUNTIME_BASE_URL?.trim();
  if (!token || !rawBaseUrl) return null;
  try {
    const parsed = new URL(rawBaseUrl);
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) return null;
    return { token, origin: parsed.origin };
  } catch {
    return null;
  }
}

function parseBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && !Buffer.isBuffer(body)) {
    try {
      const encoded = JSON.stringify(body);
      if (Buffer.byteLength(encoded, 'utf8') > MAX_REQUEST_BYTES) return { error: result(413, { error: 'GAME_BROWSER_REQUEST_TOO_LARGE' }) };
      return { value: body };
    } catch {
      return { error: result(400, { error: 'INVALID_JSON_BODY' }) };
    }
  }

  let text;
  if (typeof body === 'string') text = body;
  else if (Buffer.isBuffer(body)) text = body.toString('utf8');
  else return { error: result(400, { error: 'INVALID_JSON_BODY' }) };
  if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES) return { error: result(413, { error: 'GAME_BROWSER_REQUEST_TOO_LARGE' }) };

  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return { value };
  } catch {
    return { error: result(400, { error: 'INVALID_JSON_BODY' }) };
  }
}

function encodeTranslatedBody(value) {
  try {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_REQUEST_BYTES) return { error: result(413, { error: 'GAME_BROWSER_REQUEST_TOO_LARGE' }) };
    return { encoded };
  } catch {
    return { error: result(400, { error: 'INVALID_JSON_BODY' }) };
  }
}

function screenshotLinkSignature(token, sessionId, expiresAtMs) {
  return createHmac('sha256', token)
    .update(`ual:game-browser-screenshot-link:v1\n${sessionId}\n${expiresAtMs}`, 'utf8')
    .digest('hex');
}

function responseSessionId(value) {
  const root = objectValue(value);
  const observation = objectValue(root?.observation);
  const candidate = typeof root?.session_id === 'string' ? root.session_id : observation?.session_id;
  return typeof candidate === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(candidate) ? candidate : undefined;
}

function screenshotDescriptor(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const base64 = typeof value.base64 === 'string' ? value.base64 : undefined;
  let bytes;
  if (base64 !== undefined) {
    try { bytes = Buffer.from(base64, 'base64').byteLength; } catch { bytes = 0; }
  }
  if (!base64 || !context.sessionId || !bytes || bytes > MAX_SCREENSHOT_BYTES) {
    return {
      available: true,
      transported: false,
      reason: bytes && bytes > MAX_SCREENSHOT_BYTES ? 'SCREENSHOT_TOO_LARGE' : 'SCREENSHOT_LINK_UNAVAILABLE',
      ...(bytes === undefined ? {} : { bytes }),
    };
  }

  const expiresAtMs = context.nowMs + SCREENSHOT_LINK_TTL_MS;
  const params = new URLSearchParams({
    session_id: context.sessionId,
    expires: String(expiresAtMs),
    sig: screenshotLinkSignature(context.config.token, context.sessionId, expiresAtMs),
  });
  return {
    available: true,
    transported: true,
    mime_type: 'image/png',
    content_trust: 'UNTRUSTED_TARGET_CONTENT',
    bytes,
    screenshot_url: `${context.config.origin}/internal/gpt-action/screenshot?${params.toString()}`,
    expires_at: new Date(expiresAtMs).toISOString(),
  };
}

function projectEvidence(value, context) {
  if (Array.isArray(value)) return value.map((child) => projectEvidence(child, context));
  if (!value || typeof value !== 'object') return value;
  const projected = {};
  for (const [key, child] of Object.entries(value)) {
    projected[key] = key === 'screenshot' ? screenshotDescriptor(child, context) : projectEvidence(child, context);
  }
  return projected;
}

function boundedRuntimeError(status, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.error !== 'string' || body.error.length > 128) return null;
  const projected = { error: body.error };
  if (typeof body.message === 'string' && body.message.length <= MAX_ERROR_MESSAGE) projected.message = body.message;
  if (Number.isFinite(body.retryAfterMs) && body.retryAfterMs >= 0) projected.retryAfterMs = body.retryAfterMs;
  return result(status, projected);
}

export async function handleGameBrowserControlRequest(request, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const method = String(request.method ?? 'POST').toUpperCase();
  const path = String(request.path ?? '/');
  const route = ROUTES.get(path);
  if (!route) return result(404, { error: 'NOT_FOUND' });
  if (method !== 'POST') return result(405, { error: 'METHOD_NOT_ALLOWED' }, { allow: 'POST' });

  const config = configuration(env);
  if (!config) return result(503, { error: 'GAME_BROWSER_CONFIGURATION_ERROR' });

  const parsed = parseBody(request.body);
  if (parsed.error) return parsed.error;
  const translated = route.translate(parsed.value);
  const encoded = encodeTranslatedBody(translated);
  if (encoded.error) return encoded.error;

  let upstream;
  try {
    upstream = await fetchImpl(`${config.origin}${route.upstreamPath}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        'user-agent': 'ual-gpt-action-api',
      },
      body: encoded.encoded,
    });
  } catch {
    return result(502, { error: 'GAME_BROWSER_UPSTREAM_ERROR', status: 0 });
  }

  const contentLength = Number(upstream.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPSTREAM_BYTES) {
    return result(502, { error: 'GAME_BROWSER_UPSTREAM_TOO_LARGE', status: upstream.status });
  }

  let text;
  try { text = await upstream.text(); }
  catch { return result(502, { error: 'GAME_BROWSER_UPSTREAM_ERROR', status: upstream.status }); }
  if (Buffer.byteLength(text, 'utf8') > MAX_UPSTREAM_BYTES) return result(502, { error: 'GAME_BROWSER_UPSTREAM_TOO_LARGE', status: upstream.status });

  let payload;
  try { payload = JSON.parse(text); }
  catch { return result(502, { error: 'GAME_BROWSER_UPSTREAM_ERROR', status: upstream.status }); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return result(502, { error: 'GAME_BROWSER_UPSTREAM_ERROR', status: upstream.status });

  if (!upstream.ok) {
    if (upstream.status === 401 || (upstream.status >= 500 && upstream.status !== 503)) {
      return result(502, { error: 'GAME_BROWSER_UPSTREAM_ERROR', status: upstream.status });
    }
    return boundedRuntimeError(upstream.status, payload)
      ?? result(502, { error: 'GAME_BROWSER_UPSTREAM_ERROR', status: upstream.status });
  }

  return result(upstream.status, projectEvidence(payload, {
    config,
    sessionId: responseSessionId(payload),
    nowMs: Date.now(),
  }));
}

function actionOperation(operationId, summary, schemaRef, security) {
  return {
    post: {
      operationId,
      summary,
      security,
      'x-openai-isConsequential': false,
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: schemaRef } } },
      },
      responses: {
        '200': { description: 'Bounded game-browser runtime result.', content: { 'application/json': { schema: { $ref: '#/components/schemas/GameQaResult' } } } },
        '400': { description: 'Invalid bounded game-QA input.' },
        '401': { description: 'Missing or invalid Action bearer key.' },
        '404': { description: 'Game-browser session/resource not found.' },
        '409': { description: 'Stale deployment or session/action sequencing conflict.' },
        '413': { description: 'Action request exceeds the bridge size limit.' },
        '422': { description: 'Bounded game-QA validation failure.' },
        '429': { description: 'Game-browser runtime rate or action limit reached.' },
        '502': { description: 'Game-browser runtime is unavailable or returned an invalid response.' },
        '503': { description: 'Game-browser bridge/runtime configuration is incomplete.' },
      },
    },
  };
}

export function gameBrowserOpenApiPaths(security) {
  return {
    '/game-browser/session-start': actionOperation('startGameQaSession', 'Start bounded QA against the exact configured-project deployment for a Git commit.', '#/components/schemas/GameQaSessionStartRequest', security),
    '/game-browser/observe': actionOperation('observeGameQaSession', 'Observe the existing bounded remote game-QA session.', '#/components/schemas/GameQaObserveRequest', security),
    '/game-browser/input': actionOperation('sendGameQaInput', 'Send a bounded idempotent gameplay input batch to the existing session.', '#/components/schemas/GameQaInputRequest', security),
    '/game-browser/read-state': actionOperation('readGameQaState', 'Read bounded JSON-compatible game instrumentation state.', '#/components/schemas/GameQaReadStateRequest', security),
    '/game-browser/reset': actionOperation('resetGameQaSession', 'Reset only the registered game target for the existing session.', '#/components/schemas/GameQaResetRequest', security),
    '/game-browser/session-end': actionOperation('endGameQaSession', 'Release input and end the isolated remote game-QA session.', '#/components/schemas/GameQaSessionRequest', security),
  };
}

const sessionId = { type: 'string', minLength: 1, maxLength: 128 };
const commitSha = { type: 'string', pattern: '^[0-9A-Fa-f]{40}$' };
const nonnegativeInteger = { type: 'integer', minimum: 0 };
const pointerButton = { type: 'string', enum: ['left', 'middle', 'right'] };
const allowedKey = {
  type: 'string',
  enum: [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'w', 'a', 's', 'd', 'W', 'A', 'S', 'D',
    ' ', 'Enter', 'Escape', 'Shift', 'Control',
    'e', 'E', 'f', 'F', 'q', 'Q', 'r', 'R',
  ],
};

const actionVariants = [
  { type: 'object', required: ['type', 'key'], properties: { type: { type: 'string', enum: ['key_down'] }, key: allowedKey }, additionalProperties: false },
  { type: 'object', required: ['type', 'key'], properties: { type: { type: 'string', enum: ['key_up'] }, key: allowedKey }, additionalProperties: false },
  { type: 'object', required: ['type', 'key'], properties: { type: { type: 'string', enum: ['press'] }, key: allowedKey, durationMs: { type: 'integer', minimum: 1, maximum: 10000 } }, additionalProperties: false },
  { type: 'object', required: ['type', 'x', 'y'], properties: { type: { type: 'string', enum: ['pointer_move'] }, x: { type: 'number' }, y: { type: 'number' } }, additionalProperties: false },
  { type: 'object', required: ['type', 'deltaX', 'deltaY'], properties: { type: { type: 'string', enum: ['pointer_move_relative'] }, deltaX: { type: 'number' }, deltaY: { type: 'number' } }, additionalProperties: false },
  { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['pointer_down'] }, button: pointerButton }, additionalProperties: false },
  { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['pointer_up'] }, button: pointerButton }, additionalProperties: false },
  { type: 'object', required: ['type', 'x', 'y'], properties: { type: { type: 'string', enum: ['click'] }, x: { type: 'number' }, y: { type: 'number' }, button: pointerButton }, additionalProperties: false },
  { type: 'object', required: ['type', 'deltaY'], properties: { type: { type: 'string', enum: ['scroll'] }, deltaX: { type: 'number' }, deltaY: { type: 'number' } }, additionalProperties: false },
  { type: 'object', required: ['type', 'durationMs'], properties: { type: { type: 'string', enum: ['wait'] }, durationMs: { type: 'integer', minimum: 1, maximum: 10000 } }, additionalProperties: false },
];

export const gameBrowserOpenApiSchemas = {
  GameQaSessionStartRequest: {
    type: 'object',
    required: ['expectedCommitSha'],
    properties: {
      expectedCommitSha: commitSha,
      viewport: {
        type: 'object',
        required: ['width', 'height'],
        properties: { width: { type: 'integer', minimum: 1, maximum: 4096 }, height: { type: 'integer', minimum: 1, maximum: 4096 } },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  GameQaSessionRequest: {
    type: 'object', required: ['sessionId'], properties: { sessionId }, additionalProperties: false,
  },
  GameQaObserveRequest: {
    type: 'object', required: ['sessionId'], properties: { sessionId, expectedObservationSeq: nonnegativeInteger }, additionalProperties: false,
  },
  GameQaInputRequest: {
    type: 'object',
    required: ['sessionId', 'actionBatchId', 'expectedActionSeq', 'actions'],
    properties: {
      sessionId,
      actionBatchId: { type: 'string', minLength: 1, maxLength: 128 },
      expectedActionSeq: nonnegativeInteger,
      actions: { type: 'array', minItems: 1, maxItems: 20, items: { oneOf: actionVariants } },
    },
    additionalProperties: false,
  },
  GameQaReadStateRequest: {
    type: 'object', required: ['sessionId'], properties: { sessionId, path: { type: 'string', maxLength: 512 } }, additionalProperties: false,
  },
  GameQaResetRequest: {
    type: 'object', required: ['sessionId'], properties: { sessionId, mode: { type: 'string', enum: ['reload', 'target'] } }, additionalProperties: false,
  },
  GameQaResult: { type: 'object', additionalProperties: true },
};

