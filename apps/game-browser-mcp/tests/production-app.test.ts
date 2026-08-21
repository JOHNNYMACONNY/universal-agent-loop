import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createProductionRuntimeApp, PRODUCTION_ENVIRONMENT_NAMES } from '../src/server.js';

const SHA = 'a'.repeat(40);
const ENV = {
  VERCEL_API_TOKEN: 'vercel-token',
  TARGET_PROJECT_ID: 'project-1',
  TARGET_REPOSITORY_OWNER: 'owner',
  TARGET_REPOSITORY_NAME: 'repo',
  TARGET_ENTRY_PATH: '/fixture/',
  APPROVED_DEPLOYMENT_HOST_PATTERNS: '*.vercel.app',
  APPROVED_DEPENDENCY_HOSTS: '',
  APPROVED_REDIRECT_HOSTS: '',
  AGENT_BROWSER_SNAPSHOT_ID: 'snap_1',
  REGISTRATION_CONTROL_TOKEN: 'registration-control-secret-123',
  REGISTRATION_CAPABILITY_SECRET: 'registration-capability-secret-with-adequate-length',
  OWNER_BINDING_SECRET: 'owner-binding-secret-with-adequate-length',
  PRINCIPAL_AUDIENCE: 'game-browser-mcp',
  RUNTIME_ALLOWED_HOSTS: '127.0.0.1,localhost',
};

function getWithHost(port: number, hostHeader: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/healthz',
      method: 'GET',
      headers: { host: hostHeader },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('production composition is Vercel-only and declares every required secret/config category', () => {
  const declared = new Set<string>(PRODUCTION_ENVIRONMENT_NAMES);
  assert.equal(declared.has('UPSTASH_REDIS_REST_URL'), false);
  assert.equal(declared.has('UPSTASH_REDIS_REST_TOKEN'), false);
  for (const name of [
    'VERCEL_API_TOKEN', 'TARGET_PROJECT_ID', 'TARGET_REPOSITORY_OWNER', 'TARGET_REPOSITORY_NAME', 'TARGET_ENTRY_PATH',
    'APPROVED_DEPLOYMENT_HOST_PATTERNS', 'AGENT_BROWSER_SNAPSHOT_ID',
    'REGISTRATION_CONTROL_TOKEN', 'REGISTRATION_CAPABILITY_SECRET', 'OWNER_BINDING_SECRET', 'PRINCIPAL_AUDIENCE',
  ]) assert.ok(declared.has(name), `${name} missing from environment contract`);
});

test('production composition fails closed when required environment is missing', () => {
  assert.throws(() => createProductionRuntimeApp({}), /VERCEL_API_TOKEN|configuration/i);
});

test('production accepts the Vercel stable project URL without an extra managed host variable', async () => {
  const app = createProductionRuntimeApp({
    ...ENV,
    RUNTIME_ALLOWED_HOSTS: '',
    VERCEL_URL: 'ual-game-browser-immutable.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'ual-game-browser-mcp.vercel.app',
  });
  const http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  try {
    const stable = await getWithHost(address.port, 'ual-game-browser-mcp.vercel.app');
    assert.equal(stable.status, 200);
    assert.deepEqual(JSON.parse(stable.body), { ok: true });

    const immutable = await getWithHost(address.port, 'ual-game-browser-immutable.vercel.app');
    assert.equal(immutable.status, 200);
    assert.deepEqual(JSON.parse(immutable.body), { ok: true });
  } finally {
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  }
});

test('production app starts without Redis and protects internal registration without control token', async () => {
  const app = createProductionRuntimeApp(ENV);
  const http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    const fixture = await fetch(`${base}/fixture/`);
    assert.equal(fixture.status, 200);
    assert.match(await fixture.text(), /Remote QA Canvas Fixture/);
    const registration = await fetch(`${base}/internal/registrations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deploymentId: 'dpl_1', expectedCommitSha: SHA }),
    });
    assert.equal(registration.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  }
});

test('production MCP resolves bearer identity per HTTP request and fails closed when absent', async () => {
  const app = createProductionRuntimeApp(ENV);
  const http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  const client = new Client({ name: 'production-auth-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
    const result = await client.callTool({
      name: 'game_session_start',
      arguments: { target_registration_id: 'reg_missing', expected_commit_sha: SHA },
    });
    assert.equal(result.isError, true);
    const text = result.content?.[0]?.type === 'text' ? result.content[0].text : '';
    assert.match(text, /AUTH_CONTEXT_UNAVAILABLE/);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  }
});
