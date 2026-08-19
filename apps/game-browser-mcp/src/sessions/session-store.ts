import type { SessionRecord } from '../contracts.js';
import { RuntimeError } from '../errors.js';
import type { BeginBatchInput, BeginBatchResult, CompleteBatchInput, CompleteBatchResult } from './types.js';

export interface SessionStore {
  create(record: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  beginBatch(input: BeginBatchInput): Promise<BeginBatchResult>;
  completeBatch(input: CompleteBatchInput): Promise<CompleteBatchResult>;
  updateHeldInput(sessionId: string, heldKeys: string[], heldPointerButtons: string[]): Promise<void>;
  markRecoveryRequired(sessionId: string, reason: string): Promise<void>;
  nextObservation(sessionId: string): Promise<number>;
  end(sessionId: string): Promise<void>;
}

type Internal = { record: SessionRecord; pendingBatchId?: string; recoveryReason?: string };
type Batch = { state: 'ACCEPTED' | 'COMPLETE'; result?: Record<string, unknown> };

export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, Internal>();
  readonly #batches = new Map<string, Batch>();

  #batchKey(sessionId: string, batchId: string): string { return `${sessionId}:${batchId}`; }

  async create(record: SessionRecord): Promise<void> {
    if (this.#sessions.has(record.session_id)) throw new RuntimeError('STORAGE_ERROR', 'session already exists');
    this.#sessions.set(record.session_id, { record: structuredClone(record) });
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const entry = this.#sessions.get(sessionId);
    return entry ? structuredClone(entry.record) : null;
  }

  async beginBatch(input: BeginBatchInput): Promise<BeginBatchResult> {
    const entry = this.#sessions.get(input.sessionId);
    if (!entry) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
    const key = this.#batchKey(input.sessionId, input.batchId);
    const existing = this.#batches.get(key);
    if (existing?.state === 'COMPLETE') return { kind: 'DUPLICATE', result: structuredClone(existing.result ?? {}) };
    if (existing || entry.pendingBatchId) throw new RuntimeError('SESSION_RECOVERY_REQUIRED', 'another batch is in flight');
    if (entry.record.lifecycle !== 'ACTIVE') throw new RuntimeError('SESSION_RECOVERY_REQUIRED', 'session is recovery-required or ending');
    if (entry.record.action_seq !== input.expectedActionSeq) throw new RuntimeError('ACTION_REJECTED', 'action sequence mismatch');
    entry.pendingBatchId = input.batchId;
    this.#batches.set(key, { state: 'ACCEPTED' });
    return { kind: 'ACCEPTED', actionSeq: entry.record.action_seq };
  }

  async completeBatch(input: CompleteBatchInput): Promise<CompleteBatchResult> {
    const entry = this.#sessions.get(input.sessionId);
    if (!entry) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
    const key = this.#batchKey(input.sessionId, input.batchId);
    const batch = this.#batches.get(key);
    if (batch?.state === 'COMPLETE') return { actionSeqAfter: entry.record.action_seq };
    if (!batch || entry.pendingBatchId !== input.batchId) throw new RuntimeError('SESSION_RECOVERY_REQUIRED', 'batch completion state is ambiguous');
    entry.record.action_seq += 1;
    delete entry.pendingBatchId;
    this.#batches.set(key, { state: 'COMPLETE', result: structuredClone(input.result) });
    return { actionSeqAfter: entry.record.action_seq };
  }

  async updateHeldInput(sessionId: string, heldKeys: string[], heldPointerButtons: string[]): Promise<void> {
    const entry = this.#sessions.get(sessionId);
    if (!entry) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
    entry.record.held_keys = heldKeys as SessionRecord['held_keys'];
    entry.record.held_pointer_buttons = heldPointerButtons as SessionRecord['held_pointer_buttons'];
  }

  async markRecoveryRequired(sessionId: string, reason: string): Promise<void> {
    const entry = this.#sessions.get(sessionId);
    if (!entry) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
    entry.record.lifecycle = 'RECOVERY_REQUIRED';
    entry.recoveryReason = reason;
  }

  async nextObservation(sessionId: string): Promise<number> {
    const entry = this.#sessions.get(sessionId);
    if (!entry) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
    entry.record.observation_seq += 1;
    return entry.record.observation_seq;
  }

  async end(sessionId: string): Promise<void> {
    const entry = this.#sessions.get(sessionId);
    if (!entry) return;
    entry.record.lifecycle = 'ENDING';
  }
}
