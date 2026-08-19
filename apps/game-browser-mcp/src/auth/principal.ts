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
