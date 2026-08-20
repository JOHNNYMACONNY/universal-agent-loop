import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeSandboxProviderError } from '../src/browser/vercel-sandbox-browser.js';

test('sandbox provider errors surface only bounded status/code/message diagnostics', () => {
  const error = {
    response: { status: 400 },
    json: {
      error: { code: 'invalid_network_policy', message: 'deniedCIDRs contains an unsupported range', token: 'nested-secret' },
      token: 'top-level-secret',
    },
  };

  const sanitized = sanitizeSandboxProviderError(error, 'create');
  assert.equal(
    sanitized.message,
    'Sandbox provider create failed (HTTP 400) [invalid_network_policy]: deniedCIDRs contains an unsupported range',
  );
  assert.equal(sanitized.message.includes('nested-secret'), false);
  assert.equal(sanitized.message.includes('top-level-secret'), false);
});

test('sandbox provider errors support top-level primitive diagnostics without dumping arbitrary JSON', () => {
  const error = {
    response: { status: 400 },
    json: { code: 'bad_request', message: 'invalid request', credential: 'must-not-leak' },
  };

  const sanitized = sanitizeSandboxProviderError(error, 'create');
  assert.equal(sanitized.message, 'Sandbox provider create failed (HTTP 400) [bad_request]: invalid request');
  assert.equal(sanitized.message.includes('must-not-leak'), false);
});

test('sandbox provider diagnostics fall back to status and bounded error text', () => {
  const statusOnly = sanitizeSandboxProviderError({ response: { status: 400 }, json: { credential: 'must-not-leak' } }, 'create');
  assert.equal(statusOnly.message, 'Sandbox provider create failed (HTTP 400)');

  const ordinary = sanitizeSandboxProviderError(new Error('ordinary failure'), 'create');
  assert.equal(ordinary.message, 'Sandbox provider create failed: ordinary failure');
});
