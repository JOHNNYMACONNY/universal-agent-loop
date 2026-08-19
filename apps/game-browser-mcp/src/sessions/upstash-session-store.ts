import { Redis } from '@upstash/redis';

import { SessionRecordSchema, type SessionRecord } from '../contracts.js';
import { RuntimeError } from '../errors.js';
import type { SessionStore } from './session-store.js';
import type { BeginBatchInput, BeginBatchResult, CompleteBatchInput, CompleteBatchResult } from './types.js';

interface RedisLike {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: Record<string, unknown>): Promise<unknown>;
  eval(script: string, keys: string[], args: unknown[]): Promise<unknown>;
}

export const BEGIN_BATCH_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({error='SESSION_NOT_FOUND'}) end
local session = cjson.decode(raw)
local batchRaw = redis.call('GET', KEYS[2])
if batchRaw then
  local batch = cjson.decode(batchRaw)
  if batch.state == 'COMPLETE' then return cjson.encode({kind='DUPLICATE', result=batch.result}) end
  return cjson.encode({error='SESSION_RECOVERY_REQUIRED', reason='batch already accepted'})
end
if session.lifecycle ~= 'ACTIVE' then return cjson.encode({error='SESSION_RECOVERY_REQUIRED'}) end
if session.pending_batch_id ~= nil then return cjson.encode({error='SESSION_RECOVERY_REQUIRED', reason='another batch pending'}) end
local expected = tonumber(ARGV[1])
if tonumber(session.action_seq) ~= expected then return cjson.encode({error='ACTION_REJECTED', reason='expected action sequence mismatch'}) end
local actionCount = tonumber(ARGV[3]) or 1
local maxActions = tonumber(ARGV[4]) or 9007199254740991
local total = tonumber(session.total_action_count or 0)
if actionCount <= 0 or (total + actionCount) > maxActions then return cjson.encode({error='LIMIT_EXCEEDED', reason='session action budget exceeded'}) end
session.total_action_count = total + actionCount
session.pending_batch_id = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then redis.call('SET', KEYS[2], cjson.encode({state='ACCEPTED'}), 'PX', ttl) else redis.call('SET', KEYS[2], cjson.encode({state='ACCEPTED'})) end
return cjson.encode({kind='ACCEPTED', actionSeq=session.action_seq})
`;

export const COMPLETE_BATCH_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({error='SESSION_NOT_FOUND'}) end
local session = cjson.decode(raw)
local batchRaw = redis.call('GET', KEYS[2])
if not batchRaw then return cjson.encode({error='SESSION_RECOVERY_REQUIRED', reason='batch missing'}) end
local batch = cjson.decode(batchRaw)
if batch.state == 'COMPLETE' then return cjson.encode({actionSeqAfter=session.action_seq}) end
if batch.state ~= 'ACCEPTED' or session.pending_batch_id ~= ARGV[1] then return cjson.encode({error='SESSION_RECOVERY_REQUIRED', reason='ambiguous completion'}) end
session.action_seq = tonumber(session.action_seq) + 1
session.pending_batch_id = nil
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
local completed = {state='COMPLETE', result=cjson.decode(ARGV[2])}
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then redis.call('SET', KEYS[2], cjson.encode(completed), 'PX', ttl) else redis.call('SET', KEYS[2], cjson.encode(completed)) end
return cjson.encode({actionSeqAfter=session.action_seq})
`;

const NEXT_OBSERVATION_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({error='SESSION_NOT_FOUND'}) end
local session = cjson.decode(raw)
session.observation_seq = tonumber(session.observation_seq) + 1
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
return session.observation_seq
`;

const SET_LIFECYCLE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local session = cjson.decode(raw)
session.lifecycle = ARGV[1]
if ARGV[2] and ARGV[2] ~= '' then session.recovery_reason = ARGV[2] end
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
return 1
`;

const UPDATE_HELD_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local session = cjson.decode(raw)
session.held_keys = cjson.decode(ARGV[1])
session.held_pointer_buttons = cjson.decode(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
return 1
`;

const TOUCH_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({error='SESSION_NOT_FOUND'}) end
local session = cjson.decode(raw)
local nowMs = tonumber(ARGV[1])
local maxIdle = tonumber(ARGV[2])
local absoluteMs = tonumber(ARGV[3])
local idleMs = math.min(absoluteMs, nowMs + maxIdle)
session.last_seen_at = ARGV[4]
session.idle_expires_at = ARGV[5]
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
return cjson.encode(session)
`;

const RESET_RECOVERY_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local session = cjson.decode(raw)
session.lifecycle = 'ACTIVE'
session.pending_batch_id = nil
session.recovery_reason = nil
session.held_keys = {}
session.held_pointer_buttons = {}
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
return 1
`;

function decodeResult<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

function throwIfError(value: unknown): void {
  const decoded = decodeResult<Record<string, unknown>>(value);
  if (decoded && typeof decoded === 'object' && typeof decoded.error === 'string') {
    throw new RuntimeError(decoded.error as any, String(decoded.reason ?? decoded.error));
  }
}

export class UpstashSessionStore implements SessionStore {
  readonly #redis: RedisLike;

  constructor(redis: RedisLike = Redis.fromEnv() as unknown as RedisLike) { this.#redis = redis; }
  #sessionKey(id: string): string { return `gbr:session:${id}`; }
  #batchKey(sessionId: string, batchId: string): string { return `gbr:batch:${sessionId}:${batchId}`; }

  async create(record: SessionRecord): Promise<void> {
    const ttl = Math.max(1, new Date(record.absolute_expires_at).getTime() - Date.now());
    const result = await this.#redis.set(this.#sessionKey(record.session_id), record, { nx: true, px: ttl });
    if (result === null) throw new RuntimeError('STORAGE_ERROR', 'session already exists');
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.#redis.get(this.#sessionKey(sessionId));
    if (raw === null) return null;
    const parsed = SessionRecordSchema.safeParse(raw);
    if (!parsed.success) throw new RuntimeError('STORAGE_ERROR', 'malformed session record');
    return parsed.data;
  }

  async beginBatch(input: BeginBatchInput): Promise<BeginBatchResult> {
    const value = await this.#redis.eval(BEGIN_BATCH_LUA,
      [this.#sessionKey(input.sessionId), this.#batchKey(input.sessionId, input.batchId)],
      [input.expectedActionSeq, input.batchId, input.actionCount ?? 1, input.maxActionsPerSession ?? Number.MAX_SAFE_INTEGER]);
    throwIfError(value);
    return decodeResult<BeginBatchResult>(value);
  }

  async completeBatch(input: CompleteBatchInput): Promise<CompleteBatchResult> {
    const value = await this.#redis.eval(COMPLETE_BATCH_LUA,
      [this.#sessionKey(input.sessionId), this.#batchKey(input.sessionId, input.batchId)],
      [input.batchId, JSON.stringify(input.result)]);
    throwIfError(value);
    return decodeResult<CompleteBatchResult>(value);
  }

  async updateHeldInput(sessionId: string, heldKeys: string[], heldPointerButtons: string[]): Promise<void> {
    const result = await this.#redis.eval(UPDATE_HELD_LUA, [this.#sessionKey(sessionId)], [JSON.stringify(heldKeys), JSON.stringify(heldPointerButtons)]);
    if (Number(result) === 0) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
  }

  async touch(sessionId: string, at: Date, maxIdleMs: number): Promise<SessionRecord> {
    const current = await this.get(sessionId);
    if (!current) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
    const absoluteMs = new Date(current.absolute_expires_at).getTime();
    const idle = new Date(Math.min(absoluteMs, at.getTime() + maxIdleMs));
    const value = await this.#redis.eval(TOUCH_LUA, [this.#sessionKey(sessionId)], [at.getTime(), maxIdleMs, absoluteMs, at.toISOString(), idle.toISOString()]);
    throwIfError(value);
    const parsed = SessionRecordSchema.safeParse(decodeResult<unknown>(value));
    if (!parsed.success) throw new RuntimeError('STORAGE_ERROR', 'malformed touched session record');
    return parsed.data;
  }

  async resetRecovery(sessionId: string): Promise<void> {
    const result = await this.#redis.eval(RESET_RECOVERY_LUA, [this.#sessionKey(sessionId)], []);
    if (Number(result) === 0) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
  }

  async markRecoveryRequired(sessionId: string, reason: string): Promise<void> {
    const result = await this.#redis.eval(SET_LIFECYCLE_LUA, [this.#sessionKey(sessionId)], ['RECOVERY_REQUIRED', reason]);
    if (Number(result) === 0) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
  }

  async nextObservation(sessionId: string): Promise<number> {
    const result = await this.#redis.eval(NEXT_OBSERVATION_LUA, [this.#sessionKey(sessionId)], []);
    throwIfError(result);
    return Number(result);
  }

  async end(sessionId: string): Promise<void> {
    await this.#redis.eval(SET_LIFECYCLE_LUA, [this.#sessionKey(sessionId)], ['ENDING', '']);
  }
}
