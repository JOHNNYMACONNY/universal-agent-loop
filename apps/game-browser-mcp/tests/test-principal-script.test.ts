import test from 'node:test';
import assert from 'node:assert/strict';

import { SignedBearerPrincipalResolver } from '../src/auth/principal.js';
import { issueRemoteAcceptancePrincipal } from '../scripts/issue-test-principal.js';

const SECRET = 'owner-binding-secret-with-adequate-length';
const NOW = new Date('2026-08-19T00:00:00.000Z');

test('live acceptance principal is short-lived and accepted by the production verifier contract', async () => {
  const token = issueRemoteAcceptancePrincipal({ secret: SECRET, audience: 'game-browser-mcp', now: NOW, lifetimeMs: 30 * 60_000 });
  const resolver = new SignedBearerPrincipalResolver({ secret: SECRET, audience: 'game-browser-mcp', now: () => new Date(NOW.getTime() + 1_000) });
  const principal = await resolver.resolve({ authorization: `Bearer ${token}` });
  assert.match(principal.binding, /^[0-9a-f]{64}$/);
});

test('live acceptance principal lifetime is bounded to one hour', () => {
  assert.throws(() => issueRemoteAcceptancePrincipal({ secret: SECRET, audience: 'game-browser-mcp', now: NOW, lifetimeMs: 60 * 60_000 + 1 }), /between 1 and 60 minutes/);
});
