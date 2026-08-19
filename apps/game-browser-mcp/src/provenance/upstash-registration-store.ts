import { Redis } from '@upstash/redis';

import { TargetRegistrationSchema, type TargetRegistration } from '../contracts.js';
import { RuntimeError } from '../errors.js';
import type { RegistrationStore } from './registration-store.js';

interface RedisLike {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: Record<string, unknown>): Promise<unknown>;
}

export class UpstashRegistrationStore implements RegistrationStore {
  readonly #redis: RedisLike;
  readonly #now: () => Date;

  constructor(redis: RedisLike = Redis.fromEnv() as unknown as RedisLike, now: () => Date = () => new Date()) {
    this.#redis = redis;
    this.#now = now;
  }

  #key(id: string): string { return `gbr:registration:${id}`; }

  async put(registration: TargetRegistration): Promise<void> {
    const parsed = TargetRegistrationSchema.parse(registration);
    const ttl = Math.max(1, new Date(parsed.expires_at).getTime() - this.#now().getTime() + 30_000);
    const result = await this.#redis.set(this.#key(parsed.target_registration_id), parsed, { nx: true, px: ttl });
    if (result !== null) return;
    const existing = await this.get(parsed.target_registration_id);
    if (existing && JSON.stringify(existing) === JSON.stringify(parsed)) return;
    throw new RuntimeError('STORAGE_ERROR', 'registration overwrite rejected');
  }

  async get(id: string): Promise<TargetRegistration | null> {
    const raw = await this.#redis.get(this.#key(id));
    if (raw === null) return null;
    const parsed = TargetRegistrationSchema.safeParse(raw);
    if (!parsed.success) throw new RuntimeError('STORAGE_ERROR', 'malformed stored target registration');
    return parsed.data;
  }
}
