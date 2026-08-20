import { RuntimeErrorCodeSchema, SessionRecordSchema, type SessionRecord } from '../contracts.js';
import { RuntimeError } from '../errors.js';
import { SdkFactory, sandboxName, type SandboxFactory, type SandboxHandle } from '../browser/vercel-sandbox-browser.js';
import type { SessionStore } from './session-store.js';
import type { BeginBatchInput, BeginBatchResult, CompleteBatchInput, CompleteBatchResult } from './types.js';

interface Options {
  factory?: SandboxFactory;
  workerPath?: string;
}

export class VercelSandboxSessionStore implements SessionStore {
  readonly #factory: SandboxFactory;
  readonly #workerPath: string;

  constructor(options: Options = {}) {
    this.#factory = options.factory ?? new SdkFactory();
    this.#workerPath = options.workerPath ?? '/vercel/sandbox/worker.mjs';
  }

  async #handle(sessionId: string): Promise<SandboxHandle> {
    let handle: SandboxHandle;
    try { handle = await this.#factory.get(sandboxName(sessionId)); }
    catch { throw new RuntimeError('SESSION_EXPIRED', 'persistent sandbox is unavailable'); }
    if (handle.currentSessionStatus() !== 'running') {
      throw new RuntimeError('SESSION_EXPIRED', 'sandbox VM is not running; filesystem persistence is not browser continuity');
    }
    return handle;
  }

  async #worker(sessionId: string, request: Record<string, unknown>): Promise<any> {
    const handle = await this.#handle(sessionId);
    const encoded = Buffer.from(JSON.stringify({ ...request, session_id: sessionId }), 'utf8').toString('base64url');
    const result = await handle.runCommand('node', [this.#workerPath, encoded]);
    const stdout = await result.stdout();
    let parsed: any = null;
    try { parsed = stdout ? JSON.parse(stdout) : null; } catch {}
    if (result.exitCode !== 0 || !parsed?.ok) {
      const code = RuntimeErrorCodeSchema.safeParse(parsed?.error);
      if (code.success) throw new RuntimeError(code.data, String(parsed?.detail ?? parsed?.error));
      const stderr = await result.stderr();
      const message = parsed?.detail ?? parsed?.error ?? (stderr || 'sandbox session worker failed');
      throw new RuntimeError('STORAGE_ERROR', String(message));
    }
    return parsed;
  }

  async create(record: SessionRecord): Promise<void> {
    const parsed = SessionRecordSchema.parse(record);
    if (parsed.sandbox_id !== sandboxName(parsed.session_id)) {
      throw new RuntimeError('STORAGE_ERROR', 'session sandbox binding does not match deterministic sandbox name');
    }
    await this.#worker(parsed.session_id, { type: 'session_create', record: parsed });
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const payload = await this.#worker(sessionId, { type: 'session_get' });
    if (payload.record === null) return null;
    const parsed = SessionRecordSchema.safeParse(payload.record);
    if (!parsed.success) throw new RuntimeError('STORAGE_ERROR', 'malformed sandbox session record');
    return parsed.data;
  }

  async beginBatch(input: BeginBatchInput): Promise<BeginBatchResult> {
    const payload = await this.#worker(input.sessionId, {
      type: 'session_begin_batch',
      batch_id: input.batchId,
      expected_action_seq: input.expectedActionSeq,
      action_count: input.actionCount ?? 1,
      max_actions_per_session: input.maxActionsPerSession ?? Number.MAX_SAFE_INTEGER,
    });
    if (payload.kind === 'DUPLICATE') return { kind: 'DUPLICATE', result: payload.result ?? {} };
    return { kind: 'ACCEPTED', actionSeq: Number(payload.actionSeq) };
  }

  async completeBatch(input: CompleteBatchInput): Promise<CompleteBatchResult> {
    const payload = await this.#worker(input.sessionId, {
      type: 'session_complete_batch', batch_id: input.batchId, result: input.result,
    });
    return { actionSeqAfter: Number(payload.actionSeqAfter) };
  }

  async updateHeldInput(sessionId: string, heldKeys: string[], heldPointerButtons: string[]): Promise<void> {
    await this.#worker(sessionId, { type: 'session_update_held', held_keys: heldKeys, held_pointer_buttons: heldPointerButtons });
  }

  async touch(sessionId: string, at: Date, maxIdleMs: number): Promise<SessionRecord> {
    const payload = await this.#worker(sessionId, { type: 'session_touch', at: at.toISOString(), max_idle_ms: maxIdleMs });
    const parsed = SessionRecordSchema.safeParse(payload.record);
    if (!parsed.success) throw new RuntimeError('STORAGE_ERROR', 'malformed touched sandbox session record');
    return parsed.data;
  }

  async resetRecovery(sessionId: string): Promise<void> {
    await this.#worker(sessionId, { type: 'session_reset_recovery' });
  }

  async markRecoveryRequired(sessionId: string, reason: string): Promise<void> {
    await this.#worker(sessionId, { type: 'session_mark_recovery', reason });
  }

  async nextObservation(sessionId: string): Promise<number> {
    const payload = await this.#worker(sessionId, { type: 'session_next_observation' });
    return Number(payload.observationSeq);
  }

  async end(sessionId: string): Promise<void> {
    await this.#worker(sessionId, { type: 'session_end' });
  }
}
