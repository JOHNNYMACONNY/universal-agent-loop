import test from 'node:test';
import assert from 'node:assert/strict';

import { RuntimeError } from '../src/errors.js';
import { SignedBearerPrincipalResolver, issueSignedPrincipalToken } from '../src/auth/principal.js';
import { MemoryRateLimiter } from '../src/auth/rate-limit.js';

const SECRET = 'test-owner-binding-secret-at-least-thirty-two';
const NOW = new Date('2026-08-19T00:00:00.000Z');

test('signed principal resolver verifies subject, audience, expiry, and signature', async () => {
  const token = issueSignedPrincipalToken({
    subject: 'test-user', audience: 'game-browser-mcp', expiresAt: new Date(NOW.getTime() + 60_000),
  }, SECRET);
  const resolver = new SignedBearerPrincipalResolver({ secret: SECRET, audience: 'game-browser-mcp', now: () => NOW });
  const principal = await resolver.resolve({ authorization: `Bearer ${token}` });
  assert.match(principal.binding, /^[0-9a-f]{64}$/);
  await assert.rejects(
    resolver.resolve({ authorization: `Bearer ${token.slice(0, -1)}x` }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'AUTH_CONTEXT_UNAVAILABLE',
  );
});

test('signed principal resolver rejects wrong audience and expired tokens', async () => {
  const resolver = new SignedBearerPrincipalResolver({ secret: SECRET, audience: 'game-browser-mcp', now: () => NOW });
  const wrongAudience = issueSignedPrincipalToken({ subject: 'test-user', audience: 'other', expiresAt: new Date(NOW.getTime() + 60_000) }, SECRET);
  const expired = issueSignedPrincipalToken({ subject: 'test-user', audience: 'game-browser-mcp', expiresAt: new Date(NOW.getTime() - 1) }, SECRET);
  await assert.rejects(resolver.resolve({ authorization: `Bearer ${wrongAudience}` }), /audience/i);
  await assert.rejects(resolver.resolve({ authorization: `Bearer ${expired}` }), /expired/i);
});

test('memory rate limiter blocks after the configured count within a window', async () => {
  const limiter = new MemoryRateLimiter(() => NOW.getTime());
  assert.equal((await limiter.consume({ key: 'test:start', limit: 2, windowMs: 60_000 })).allowed, true);
  assert.equal((await limiter.consume({ key: 'test:start', limit: 2, windowMs: 60_000 })).allowed, true);
  const blocked = await limiter.consume({ key: 'test:start', limit: 2, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});
