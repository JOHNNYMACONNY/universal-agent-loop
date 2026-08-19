import { createHmac, timingSafeEqual } from 'node:crypto';
import { RuntimeError } from '../errors.js';

export interface Principal {
  binding: string;
}

export interface PrincipalResolver {
  resolve(context?: unknown): Promise<Principal>;
}

export class StaticPrincipalResolver implements PrincipalResolver {
  constructor(private readonly binding: string) {}
  async resolve(): Promise<Principal> {
    if (this.binding.length < 16) throw new RuntimeError('AUTH_CONTEXT_UNAVAILABLE', 'stable principal binding unavailable');
    return { binding: this.binding };
  }
}

interface SignedPrincipalPayload {
  sub: string;
  aud: string;
  exp: number;
  v: 1;
}

interface SignedResolverOptions {
  secret: string;
  audience: string;
  now?: () => Date;
}

function hmacBase64url(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('base64url');
}

function hmacHex(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function issueSignedPrincipalToken(
  input: { subject: string; audience: string; expiresAt: Date },
  secret: string,
): string {
  if (secret.length < 24) throw new Error('principal signing secret must be at least 24 characters');
  if (!input.subject || !input.audience || !Number.isFinite(input.expiresAt.getTime())) throw new Error('invalid principal token fields');
  const payload: SignedPrincipalPayload = {
    sub: input.subject,
    aud: input.audience,
    exp: Math.floor(input.expiresAt.getTime() / 1000),
    v: 1,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${hmacBase64url(encoded, secret)}`;
}

export class SignedBearerPrincipalResolver implements PrincipalResolver {
  readonly #secret: string;
  readonly #audience: string;
  readonly #now: () => Date;

  constructor(options: SignedResolverOptions) {
    if (options.secret.length < 24) throw new Error('principal signing secret must be at least 24 characters');
    if (!options.audience) throw new Error('principal audience is required');
    this.#secret = options.secret;
    this.#audience = options.audience;
    this.#now = options.now ?? (() => new Date());
  }

  async resolve(context?: unknown): Promise<Principal> {
    const authorization = context && typeof context === 'object' && 'authorization' in context
      ? (context as { authorization?: unknown }).authorization
      : undefined;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      throw new RuntimeError('AUTH_CONTEXT_UNAVAILABLE', 'Bearer authentication is required');
    }
    const token = authorization.slice('Bearer '.length).trim();
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra !== undefined || !constantTimeStringEqual(signature, hmacBase64url(encoded, this.#secret))) {
      throw new RuntimeError('AUTH_CONTEXT_UNAVAILABLE', 'invalid principal token signature');
    }

    let payload: SignedPrincipalPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedPrincipalPayload;
    } catch {
      throw new RuntimeError('AUTH_CONTEXT_UNAVAILABLE', 'invalid principal token payload');
    }
    if (payload.v !== 1 || typeof payload.sub !== 'string' || !payload.sub) throw new RuntimeError('AUTH_CONTEXT_UNAVAILABLE', 'invalid principal subject');
    if (payload.aud !== this.#audience) throw new RuntimeError('AUTH_CONTEXT_UNAVAILABLE', 'principal token audience mismatch');
    if (!Number.isInteger(payload.exp) || payload.exp <= Math.floor(this.#now().getTime() / 1000)) throw new RuntimeError('AUTH_CONTEXT_UNAVAILABLE', 'principal token expired');

    return { binding: hmacHex(`${payload.aud}:${payload.sub}`, this.#secret) };
  }
}
