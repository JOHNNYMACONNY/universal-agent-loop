import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionRuntimeApp, createRuntimeApp } from '../src/server.js';

const services = {
  sessionStart: async () => ({}), observe: async () => ({}), input: async () => ({}),
  readState: async () => ({}), reset: async () => ({}), sessionEnd: async () => ({}),
};

const BASE_ENV = {
  VERCEL_API_TOKEN: 'vercel-token', TARGET_PROJECT_ID: 'project-1', TARGET_REPOSITORY_OWNER: 'owner',
  TARGET_REPOSITORY_NAME: 'repo', TARGET_ENTRY_PATH: '/fixture/', APPROVED_DEPLOYMENT_HOST_PATTERNS: '*.vercel.app',
  APPROVED_DEPENDENCY_HOSTS: '', APPROVED_REDIRECT_HOSTS: '', AGENT_BROWSER_SNAPSHOT_ID: 'snap_1',
  REGISTRATION_CONTROL_TOKEN: 'registration-control-secret-123',
  REGISTRATION_CAPABILITY_SECRET: 'registration-capability-secret-with-adequate-length',
  OWNER_BINDING_SECRET: 'owner-binding-secret-with-adequate-length',
  PRINCIPAL_AUDIENCE: 'game-browser-mcp', RUNTIME_ALLOWED_HOSTS: '127.0.0.1,localhost',
};

test('MCP HTTP surface rejects oversized JSON before tool execution', async () => {
  const app = createRuntimeApp(services, { allowedHosts: ['127.0.0.1', 'localhost'] });
  const http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'game_observe', arguments: { session_id: 's', padding: 'x'.repeat(70_000) } } }),
    });
    assert.equal(response.status, 413);
  } finally {
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  }
});

test('production composition rejects invalid rate-limit configuration at startup', () => {
  const invalidCases = [
    ['SESSION_STARTS_PER_MINUTE', '0'],
    ['ACTION_CALLS_PER_MINUTE', '-1'],
    ['ACTION_CALLS_PER_MINUTE', 'NaN'],
  ] as const;

  for (const [name, value] of invalidCases) {
    assert.throws(() => createProductionRuntimeApp({ ...BASE_ENV, [name]: value }), new RegExp(name));
  }
});
