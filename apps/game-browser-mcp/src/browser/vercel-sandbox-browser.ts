import { Sandbox } from '@vercel/sandbox';

import type {
  AcceptedActionBatch,
  BrowserAdapter,
  BrowserBatchResult,
  BrowserHealth,
  BrowserObservation,
  BrowserSessionRef,
  BrowserStartInput,
  BrowserStartResult,
} from './browser-adapter.js';

export interface SandboxCommandResult {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

export interface SandboxHandle {
  readonly name: string;
  runCommand(cmd: string, args: string[]): Promise<SandboxCommandResult>;
  currentSessionStatus(): string;
  stop(): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface SandboxFactory {
  create(options: unknown): Promise<SandboxHandle>;
  get(name: string): Promise<SandboxHandle>;
}

class SdkHandle implements SandboxHandle {
  constructor(readonly sandbox: any) {}
  get name(): string { return this.sandbox.name; }
  async runCommand(cmd: string, args: string[]): Promise<SandboxCommandResult> { return this.sandbox.runCommand(cmd, args); }
  currentSessionStatus(): string { return String(this.sandbox.currentSession()?.status ?? 'unknown'); }
  async stop(): Promise<unknown> { return this.sandbox.stop(); }
  async delete(): Promise<unknown> { return this.sandbox.delete(); }
}

class SdkFactory implements SandboxFactory {
  async create(options: unknown): Promise<SandboxHandle> { return new SdkHandle(await Sandbox.create(options as any)); }
  async get(name: string): Promise<SandboxHandle> { return new SdkHandle(await Sandbox.get({ name } as any)); }
}

interface Options {
  factory?: SandboxFactory;
  snapshotId: string;
  timeoutMs?: number;
  workerPath?: string;
}

function sandboxName(logicalSessionId: string): string {
  const safe = logicalSessionId.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 80);
  return `gbr-${safe || 'session'}`;
}

function asObservation(value: any): BrowserObservation {
  return {
    url: String(value.url),
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(value.screenshot ? { screenshot: value.screenshot } : {}),
    ...(typeof value.accessibilitySnapshot === 'string' ? { accessibilitySnapshot: value.accessibilitySnapshot } : {}),
    ...(Array.isArray(value.consoleErrors) ? { consoleErrors: value.consoleErrors } : {}),
    ...(Array.isArray(value.failedRequests) ? { failedRequests: value.failedRequests } : {}),
    heldKeys: Array.isArray(value.heldKeys) ? value.heldKeys.map(String) : [],
    heldPointerButtons: Array.isArray(value.heldPointerButtons) ? value.heldPointerButtons.map(String) : [],
  };
}

export class VercelSandboxBrowser implements BrowserAdapter {
  readonly #factory: SandboxFactory;
  readonly #snapshotId: string;
  readonly #timeoutMs: number;
  readonly #workerPath: string;

  constructor(options: Options) {
    this.#factory = options.factory ?? new SdkFactory();
    this.#snapshotId = options.snapshotId;
    this.#timeoutMs = options.timeoutMs ?? 15 * 60_000;
    this.#workerPath = options.workerPath ?? '/vercel/sandbox/worker.mjs';
  }

  async #worker(handle: SandboxHandle, request: Record<string, unknown>): Promise<any> {
    const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64url');
    const result = await handle.runCommand('node', [this.#workerPath, encoded]);
    const stdout = await result.stdout();
    if (result.exitCode !== 0) throw new Error((await result.stderr()) || 'sandbox worker failed');
    const parsed = JSON.parse(stdout) as any;
    if (!parsed?.ok) throw new Error(String(parsed?.error ?? 'sandbox worker rejected request'));
    return parsed;
  }

  async start(input: BrowserStartInput): Promise<BrowserStartResult> {
    const name = sandboxName(input.logicalSessionId);
    const handle = await this.#factory.create({
      name,
      source: { type: 'snapshot', snapshotId: this.#snapshotId },
      persistent: false,
      timeout: this.#timeoutMs,
      networkPolicy: { mode: 'custom', allowedDomains: [...new Set(input.allowedHosts)], allowedCIDRs: [], deniedCIDRs: [] },
      tags: { service: 'game-browser-mcp' },
    });
    const payload = await this.#worker(handle, {
      type: 'start', session_id: input.logicalSessionId, target_url: input.targetUrl,
      ...(input.viewport ? { viewport: input.viewport } : {}),
    });
    const session = { logicalSessionId: input.logicalSessionId, sandboxId: handle.name };
    return { session, observation: asObservation(payload.observation) };
  }

  async health(session: BrowserSessionRef): Promise<BrowserHealth> {
    try {
      const handle = await this.#factory.get(session.sandboxId);
      if (handle.currentSessionStatus() !== 'running') return { alive: false, detail: 'sandbox VM is not running' };
      const payload = await this.#worker(handle, { type: 'health', session_id: session.logicalSessionId });
      return { alive: payload.alive === true };
    } catch (error) {
      return { alive: false, detail: error instanceof Error ? error.message : 'sandbox unavailable' };
    }
  }

  async observe(session: BrowserSessionRef): Promise<BrowserObservation> {
    const handle = await this.#factory.get(session.sandboxId);
    const payload = await this.#worker(handle, { type: 'observe', session_id: session.logicalSessionId });
    return asObservation(payload.observation);
  }

  async input(session: BrowserSessionRef, batch: AcceptedActionBatch): Promise<BrowserBatchResult> {
    const handle = await this.#factory.get(session.sandboxId);
    const payload = await this.#worker(handle, {
      type: 'input', session_id: session.logicalSessionId,
      action_batch_id: batch.actionBatchId, actions: batch.actions,
    });
    return {
      status: payload.status === 'COMPLETE' ? 'COMPLETE' : 'UNKNOWN',
      heldKeys: Array.isArray(payload.heldKeys) ? payload.heldKeys.map(String) : [],
      heldPointerButtons: Array.isArray(payload.heldPointerButtons) ? payload.heldPointerButtons.map(String) : [],
      ...(payload.summary && typeof payload.summary === 'object' ? { summary: payload.summary } : {}),
    };
  }

  async readState(session: BrowserSessionRef, path?: string): Promise<unknown> {
    const handle = await this.#factory.get(session.sandboxId);
    const payload = await this.#worker(handle, { type: 'read_state', session_id: session.logicalSessionId, ...(path ? { path } : {}) });
    return payload.value;
  }

  async reset(session: BrowserSessionRef): Promise<BrowserObservation> {
    const handle = await this.#factory.get(session.sandboxId);
    const payload = await this.#worker(handle, { type: 'reset', session_id: session.logicalSessionId });
    return asObservation(payload.observation);
  }

  async releaseHeldInput(session: BrowserSessionRef): Promise<void> {
    const handle = await this.#factory.get(session.sandboxId);
    await this.#worker(handle, { type: 'release', session_id: session.logicalSessionId });
  }

  async end(session: BrowserSessionRef): Promise<void> {
    try {
      const handle = await this.#factory.get(session.sandboxId);
      if (handle.currentSessionStatus() === 'running') await this.#worker(handle, { type: 'end', session_id: session.logicalSessionId });
      await handle.stop();
      await handle.delete();
    } catch {
      // End is idempotent. A missing/dead sandbox is already ended from the caller's perspective.
    }
  }
}
