import { Redis } from '@upstash/redis';

export interface RateLimitInput {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  consume(input: RateLimitInput): Promise<RateLimitResult>;
}

interface MemoryEntry { count: number; expiresAt: number }

export class MemoryRateLimiter implements RateLimiter {
  readonly #entries = new Map<string, MemoryEntry>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  async consume(input: RateLimitInput): Promise<RateLimitResult> {
    const current = this.#entries.get(input.key);
    const time = this.now();
    const entry = !current || current.expiresAt <= time
      ? { count: 0, expiresAt: time + input.windowMs }
      : current;
    entry.count += 1;
    this.#entries.set(input.key, entry);
    return { allowed: entry.count <= input.limit, count: entry.count, retryAfterMs: Math.max(0, entry.expiresAt - time) };
  }
}

export const RATE_LIMIT_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
local ttl = redis.call('PTTL', KEYS[1])
return cjson.encode({allowed=(count <= tonumber(ARGV[1])), count=count, retryAfterMs=math.max(ttl, 0)})
`;

interface RedisLike {
  eval(script: string, keys: string[], args: unknown[]): Promise<unknown>;
}

export class RedisRateLimiter implements RateLimiter {
  readonly #redis: RedisLike;
  constructor(redis: RedisLike = Redis.fromEnv() as unknown as RedisLike) { this.#redis = redis; }

  async consume(input: RateLimitInput): Promise<RateLimitResult> {
    if (!Number.isInteger(input.limit) || input.limit <= 0 || !Number.isInteger(input.windowMs) || input.windowMs <= 0) {
      throw new Error('rate limit and window must be positive integers');
    }
    const value = await this.#redis.eval(RATE_LIMIT_LUA, [`gbr:rate:${input.key}`], [input.limit, input.windowMs]);
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid rate limit response');
    return {
      allowed: (parsed as any).allowed === true,
      count: Number((parsed as any).count),
      retryAfterMs: Number((parsed as any).retryAfterMs),
    };
  }
}
