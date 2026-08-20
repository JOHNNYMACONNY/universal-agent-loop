import type { TargetRegistration } from '../contracts.js';
import { RuntimeError } from '../errors.js';

export interface RegistrationStore {
  put(registration: TargetRegistration): Promise<void>;
  get(id: string): Promise<TargetRegistration | null>;
}

export class MemoryRegistrationStore implements RegistrationStore {
  readonly #records = new Map<string, TargetRegistration>();

  async put(registration: TargetRegistration): Promise<void> {
    const existing = this.#records.get(registration.target_registration_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(registration)) {
      throw new RuntimeError('STORAGE_ERROR', 'registration overwrite rejected');
    }
    this.#records.set(registration.target_registration_id, structuredClone(registration));
  }

  async get(id: string): Promise<TargetRegistration | null> {
    const value = this.#records.get(id);
    return value ? structuredClone(value) : null;
  }
}
