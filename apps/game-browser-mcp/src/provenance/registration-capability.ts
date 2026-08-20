import { createHmac, timingSafeEqual } from 'node:crypto';

import { TargetRegistrationSchema, type TargetRegistration } from '../contracts.js';
import { RuntimeError } from '../errors.js';
import type { RegistrationStore } from './registration-store.js';

export type RegistrationCapabilityPayload = Omit<TargetRegistration, 'target_registration_id'>;

interface Options {
  secret: string;
  now?: () => Date;
}

function normalizedPayload(payload: RegistrationCapabilityPayload): RegistrationCapabilityPayload {
  const parsed = TargetRegistrationSchema.parse({ target_registration_id: 'capability', ...payload });
  const { target_registration_id: _id, ...rest } = parsed;
  return rest;
}

export class RegistrationCapabilityCodec {
  readonly #secret: string;
  readonly #now: () => Date;

  constructor(options: Options) {
    if (options.secret.length < 32) throw new Error('registration capability secret must be at least 32 characters');
    this.#secret = options.secret;
    this.#now = options.now ?? (() => new Date());
  }

  #signature(body: string): Buffer {
    return createHmac('sha256', this.#secret).update(`rgc1.${body}`).digest();
  }

  issue(payload: RegistrationCapabilityPayload): TargetRegistration {
    const normalized = normalizedPayload(payload);
    const body = Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url');
    const signature = this.#signature(body).toString('base64url');
    const token = `rgc1.${body}.${signature}`;
    return TargetRegistrationSchema.parse({ target_registration_id: token, ...normalized });
  }

  verify(capability: string): TargetRegistration {
    const parts = capability.split('.');
    if (parts.length !== 3 || parts[0] !== 'rgc1' || !parts[1] || !parts[2]) {
      throw new RuntimeError('PROVENANCE_MISMATCH', 'invalid registration capability');
    }
    const body = parts[1];
    let supplied: Buffer;
    try { supplied = Buffer.from(parts[2], 'base64url'); }
    catch { throw new RuntimeError('PROVENANCE_MISMATCH', 'invalid registration capability signature'); }
    const expected = this.#signature(body);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new RuntimeError('PROVENANCE_MISMATCH', 'registration capability signature mismatch');
    }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
    catch { throw new RuntimeError('PROVENANCE_MISMATCH', 'invalid registration capability payload'); }
    let payload: RegistrationCapabilityPayload;
    try { payload = normalizedPayload(raw as RegistrationCapabilityPayload); }
    catch { throw new RuntimeError('PROVENANCE_MISMATCH', 'invalid registration capability payload'); }
    const registration = TargetRegistrationSchema.parse({ target_registration_id: capability, ...payload });
    if (new Date(registration.expires_at).getTime() <= this.#now().getTime()) {
      throw new RuntimeError('STALE_DEPLOYMENT', 'target registration capability expired');
    }
    return registration;
  }
}

export class CapabilityRegistrationStore implements RegistrationStore {
  constructor(private readonly codec: RegistrationCapabilityCodec) {}

  async put(registration: TargetRegistration): Promise<void> {
    const verified = this.codec.verify(registration.target_registration_id);
    if (JSON.stringify(verified) !== JSON.stringify(registration)) {
      throw new RuntimeError('STORAGE_ERROR', 'registration capability payload mismatch');
    }
  }

  async get(id: string): Promise<TargetRegistration | null> {
    return this.codec.verify(id);
  }
}
