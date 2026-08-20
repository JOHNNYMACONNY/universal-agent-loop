import test from 'node:test';
import assert from 'node:assert/strict';

import { RuntimeError } from '../src/errors.js';
import { RegistrationCapabilityCodec } from '../src/provenance/registration-capability.js';

const now = new Date('2026-08-19T18:00:00.000Z');
const payload = {
  project_id: 'project-1',
  repository: { owner: 'owner', name: 'repo' },
  expected_commit_sha: 'a'.repeat(40),
  deployment_id: 'dpl_1',
  deployment_url: 'https://game.example.com/fixture/',
  deployment_origin: 'https://game.example.com',
  allowed_hosts: ['game.example.com'],
  created_at: now.toISOString(),
  expires_at: new Date(now.getTime() + 60_000).toISOString(),
  provenance_source: 'provider_api' as const,
};

const secret = 'registration-capability-secret-with-adequate-length';

test('signed registration capability round-trips the trusted registration payload', () => {
  const codec = new RegistrationCapabilityCodec({ secret, now: () => now });
  const issued = codec.issue(payload);
  assert.match(issued.target_registration_id, /^rgc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(codec.verify(issued.target_registration_id), issued);
});

test('registration capability rejects payload and signature tampering', () => {
  const codec = new RegistrationCapabilityCodec({ secret, now: () => now });
  const issued = codec.issue(payload);
  const [version, body, signature] = issued.target_registration_id.split('.');
  const tamperedBody = `${body!.slice(0, -1)}${body!.endsWith('A') ? 'B' : 'A'}`;
  for (const token of [
    `${version}.${tamperedBody}.${signature}`,
    `${version}.${body}.${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`,
  ]) {
    assert.throws(
      () => codec.verify(token),
      (error: unknown) => error instanceof RuntimeError && error.code === 'PROVENANCE_MISMATCH',
    );
  }
});

test('registration capability expires fail-closed', () => {
  const issuer = new RegistrationCapabilityCodec({ secret, now: () => now });
  const issued = issuer.issue(payload);
  const verifier = new RegistrationCapabilityCodec({ secret, now: () => new Date(now.getTime() + 120_000) });
  assert.throws(
    () => verifier.verify(issued.target_registration_id),
    (error: unknown) => error instanceof RuntimeError && error.code === 'STALE_DEPLOYMENT',
  );
});
