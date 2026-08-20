import { Sandbox } from '@vercel/sandbox';

import { buildSandboxNetworkPolicyForHosts } from '../security/network-policy.js';

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

const VERCEL_MIN_SNAPSHOT_EXPIRATION_MS = 24 * 60 * 60_000;

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

type SandboxProviderOperation = 'create' | 'get';

function boundedProviderText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 240);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

export function sanitizeSandboxProviderError(error: unknown, operation: SandboxProviderOperation): Error {
  const record = recordValue(error);
  const response = recordValue(record?.response);
  const status = typeof response?.status === 'number' ? response.status : undefined;
  const json = recordValue(record?.json);
  const nestedError = json?.error;
  const nestedRecord = recordValue(nestedError);

  const code = boundedProviderText(nestedRecord?.code) ?? boundedProviderText(json?.code);
  const providerMessage = boundedProviderText(nestedRecord?.message)
    ?? boundedProviderText(typeof nestedError === 'string' ? nestedError : undefined)
    ?? boundedProviderText(json?.message);

  let message = `Sandbox provider ${operation} failed`;
  if (status !== undefined) message += ` (HTTP ${status})`;
  if (code) message += ` [${code}]`;
  if (providerMessage) message += `: ${providerMessage}`;
  else if (status === undefined && error instanceof Error) {
    const fallback = boundedProviderText(error.message);
    if (fallback) message += `: ${fallback}`;
  }
  return new Error(message);
}

class SdkHandle implements SandboxHandle {
  constructor(readonly sandbox: any) {}
  get name(): string { return this.sandbox.name; }
  async runCommand(cmd: string, args: string[]): Promise<SandboxCommandResult> { return this.sandbox.runCommand(cmd, args); }
  currentSessionStatus(): string { return String(this.sandbox.currentSession()?.status ?? 'unknown'); }
  async stop(): Promise<unknown> { return this.sandbox.stop(); }
  async delete(): Promise<unknown> { return this.sandbox.delete(); }
}

export class SdkFactory implements SandboxFactory {
  async create(options: unknown): Promise<SandboxHandle> {
    try { return new SdkHandle(await Sandbox.create(options as any)); }
    catch (error) { throw sanitizeSandboxProviderError(error, 'create'); }
  }
  async get(name: string): Promise<SandboxHandle> {
    try { return new SdkHandle(await Sandbox.get({ name, resume: false } as any)); }
    catch (error) { throw sanitizeSandboxProviderError(error, 'get'); }
  }
}

interface Options {
  factory?: SandboxFactory;
  snapshotId: string;
  timeoutMs?: number;
  snapshotExpirationMs?: number;
  workerPath?: string;
}

export function sandboxName(logicalSessionId: string): string {
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
  readonly #snapshotExpirationMs: number;
  readonly #workerPath: string;

  constructor(options: Options) {
    const snapshotExpirationMs = options.snapshotExpirationMs ?? VERCEL_MIN_SNAPSHOT_EXPIRATION_MS;
    if (!Number.isFinite(snapshotExpirationMs) || snapshotExpirationMs < VERCEL_MIN_SNAPSHOT_EXPIRATION_MS) {
      throw new Error(`snapshotExpirationMs must be at least ${VERCEL_MIN_SNAPSHOT_EXPIRATION_MS} ms`);
    }

    this.#factory = options.factory ?? new SdkFactory();
    this.#snapshotId = options.snapshotId;
    this.#timeoutMs = options.timeoutMs ?? 15 * 60_000;
    this.#snapshotExpirationMs = snapshotExpirationMs;
    this.#workerPath = options.workerPath ?? '/vercel/sandbox/worker.mjs';
  }

  async #worker(handle: SandboxHandle, request: Record<string, unknown>): Promise<any> {
    const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64url');
    const result = await handle.runCommand('node', [this.#workerPath, encoded]);
    const stdout = await result.stdout();
    let parsed: any = null;
    try { parsed = stdout ? JSON.parse(stdout) : null; } catch {}
    if (result.exitCode !== 0 || !parsed?.ok) {
      const stderr = await result.stderr();
      const message = parsed?.detail ?? parsed?.error ?? (stderr || 'sandbox worker failed');
      throw new Error(String(message));
    }
    return parsed;
  }

  async start(input: BrowserStartInput): Promise<BrowserStartResult> {
    const name = sandboxName(input.logicalSessionId);
    const handle = await this.#factory.create({
      name,
      source: { type: 'snapshot', snapshotId: this.#snapshotId },
      persistent: true,
      snapshotExpiration: this.#snapshotExpirationMs,
      timeout: this.#timeoutMs,
      networkPolicy: buildSandboxNetworkPolicyForHosts(input.allowedHosts),
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
    let handle: SandboxHandle;
    try { handle = await this.#factory.get(session.sandboxId); }
    catch { return; }

    if (handle.currentSessionStatus() === 'running') {
      try { await this.#worker(handle, { type: 'end', session_id: session.logicalSessionId }); } catch {}
      try { await handle.stop(); } catch {}
    }

    try { await handle.delete(); } catch {}
  }
}
