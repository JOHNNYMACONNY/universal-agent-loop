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

/** Hermetic/test limiter. Production coarse abuse limiting is configured at the Vercel edge/WAF layer. */
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
