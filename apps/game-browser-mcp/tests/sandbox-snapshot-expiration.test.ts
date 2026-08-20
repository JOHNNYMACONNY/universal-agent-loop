import test from 'node:test';
import assert from 'node:assert/strict';

import { VercelSandboxBrowser, type SandboxFactory, type SandboxHandle } from '../src/browser/vercel-sandbox-browser.js';

const VERCEL_MIN_SNAPSHOT_EXPIRATION_MS = 24 * 60 * 60_000;

class ExpirationHandle implements SandboxHandle {
  readonly name = 'gbr-expiration-test';
  async runCommand() {
    return {
      exitCode: 0,
      stdout: async () => JSON.stringify({
        ok: true,
        observation: { url: 'https://game.example.com', heldKeys: [], heldPointerButtons: [] },
      }),
      stderr: async () => '',
    };
  }
  currentSessionStatus() { return 'running'; }
  async stop() {}
  async delete() {}
}

class ExpirationFactory implements SandboxFactory {
  readonly handle = new ExpirationHandle();
  createOptions: any;
  async create(options: unknown) { this.createOptions = options; return this.handle; }
  async get() { return this.handle; }
}

test('default persistent snapshot expiration meets Vercel provider minimum', async () => {
  const factory = new ExpirationFactory();
  const browser = new VercelSandboxBrowser({ factory, snapshotId: 'snap_1' });

  await browser.start({
    logicalSessionId: 'session_1',
    targetUrl: 'https://game.example.com',
    allowedHosts: ['game.example.com'],
  });

  assert.equal(factory.createOptions.snapshotExpiration, VERCEL_MIN_SNAPSHOT_EXPIRATION_MS);
});

test('positive snapshot expiration below one day fails before a provider request', () => {
  const factory = new ExpirationFactory();

  assert.throws(
    () => new VercelSandboxBrowser({ factory, snapshotId: 'snap_1', snapshotExpirationMs: 60 * 60_000 }),
    /snapshotExpirationMs must be at least 86400000 ms/,
  );
  assert.equal(factory.createOptions, undefined);
});
