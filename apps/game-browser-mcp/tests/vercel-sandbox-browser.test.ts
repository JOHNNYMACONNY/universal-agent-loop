import test from 'node:test';
import assert from 'node:assert/strict';

import { VercelSandboxBrowser, type SandboxFactory, type SandboxHandle } from '../src/browser/vercel-sandbox-browser.js';
import { PRIVATE_RESERVED_CIDRS } from '../src/security/network-policy.js';

class FakeHandle implements SandboxHandle {
  readonly name = 'gbr-session_1';
  status: string = 'running';
  calls: Array<{ cmd: string; args: string[] }> = [];
  async runCommand(cmd: string, args: string[]) {
    this.calls.push({ cmd, args });
    const request = JSON.parse(Buffer.from(args[1]!, 'base64url').toString('utf8')) as { type: string };
    const payload = request.type === 'health'
      ? { ok: true, alive: true }
      : request.type === 'start' || request.type === 'observe' || request.type === 'reset'
        ? { ok: true, observation: { url: 'https://game.example.com', heldKeys: [], heldPointerButtons: [] } }
        : request.type === 'input'
          ? { ok: true, status: 'COMPLETE', heldKeys: [], heldPointerButtons: [] }
          : request.type === 'read_state'
            ? { ok: true, value: { score: 1 } }
            : { ok: true };
    return { exitCode: 0, stdout: async () => JSON.stringify(payload), stderr: async () => '' };
  }
  currentSessionStatus() { return this.status; }
  async stop() { this.status = 'stopped'; }
  async delete() { this.status = 'deleted'; }
}

class FakeFactory implements SandboxFactory {
  readonly handle = new FakeHandle();
  createOptions: any;
  getCalls = 0;
  async create(options: unknown) { this.createOptions = options; return this.handle; }
  async get(_name: string) { this.getCalls += 1; return this.handle; }
}

test('start creates non-persistent snapshot sandbox with exact-domain/private-CIDR network policy and fixed worker command', async () => {
  const factory = new FakeFactory();
  const browser = new VercelSandboxBrowser({ factory, snapshotId: 'snap_1', timeoutMs: 900_000 });
  const result = await browser.start({
    logicalSessionId: 'session_1', targetUrl: 'https://game.example.com',
    allowedHosts: ['game.example.com', 'cdn.example.com'], viewport: { width: 1280, height: 720 },
  });
  assert.equal(result.session.sandboxId, 'gbr-session_1');
  assert.equal(factory.createOptions.name, 'gbr-session_1');
  assert.deepEqual(factory.createOptions.source, { type: 'snapshot', snapshotId: 'snap_1' });
  assert.equal(factory.createOptions.persistent, false);
  assert.deepEqual(factory.createOptions.networkPolicy.allowedDomains, ['game.example.com', 'cdn.example.com']);
  assert.deepEqual(factory.createOptions.networkPolicy.allowedCIDRs, []);
  assert.deepEqual(factory.createOptions.networkPolicy.deniedCIDRs, [...PRIVATE_RESERVED_CIDRS]);
  assert.equal(factory.handle.calls[0]?.cmd, 'node');
  assert.equal(factory.handle.calls[0]?.args[0], '/vercel/sandbox/worker.mjs');
  assert.equal(factory.handle.calls.some((call) => call.cmd === 'sh' || call.args.includes('-c')), false);
});

test('health checks current VM status without resuming a stopped sandbox by running commands', async () => {
  const factory = new FakeFactory();
  const browser = new VercelSandboxBrowser({ factory, snapshotId: 'snap_1' });
  const session = { logicalSessionId: 'session_1', sandboxId: 'gbr-session_1' };
  factory.handle.status = 'stopped';
  const health = await browser.health(session);
  assert.equal(health.alive, false);
  assert.equal(factory.handle.calls.length, 0);
});

test('input is encoded as data to the fixed worker, never shell syntax', async () => {
  const factory = new FakeFactory();
  const browser = new VercelSandboxBrowser({ factory, snapshotId: 'snap_1' });
  await browser.input({ logicalSessionId: 'session_1', sandboxId: 'gbr-session_1' }, {
    actionBatchId: 'b; rm -rf /',
    actions: [{ type: 'press', key: 'Enter' }],
  });
  const call = factory.handle.calls.at(-1)!;
  assert.equal(call.cmd, 'node');
  assert.equal(call.args.length, 2);
  const decoded = JSON.parse(Buffer.from(call.args[1]!, 'base64url').toString('utf8'));
  assert.equal(decoded.action_batch_id, 'b; rm -rf /');
});

test('readState uses closed worker operation rather than exposing eval on adapter', async () => {
  const factory = new FakeFactory();
  const browser = new VercelSandboxBrowser({ factory, snapshotId: 'snap_1' });
  assert.deepEqual(await browser.readState({ logicalSessionId: 'session_1', sandboxId: 'gbr-session_1' }, '/score'), { score: 1 });
  const decoded = JSON.parse(Buffer.from(factory.handle.calls.at(-1)!.args[1]!, 'base64url').toString('utf8'));
  assert.deepEqual(decoded, { type: 'read_state', session_id: 'session_1', path: '/score' });
});
