import { randomUUID } from 'node:crypto';

import { TargetRegistrationSchema, type TargetRegistration } from '../contracts.js';
import type { RuntimeConfig } from '../env.js';
import { RuntimeError } from '../errors.js';
import type { RegistrationCapabilityCodec, RegistrationCapabilityPayload } from './registration-capability.js';
import type { RegistrationStore } from './registration-store.js';
import type { DeploymentVerifier } from './types.js';

export interface RegistrationInput {
  deploymentId: string;
  expectedCommitSha: string;
}

interface Options {
  verifier: DeploymentVerifier;
  trust: RuntimeConfig['trust'];
  store?: RegistrationStore;
  codec?: RegistrationCapabilityCodec;
  now?: () => Date;
  idFactory?: () => string;
  registrationTtlMs?: number;
}

function hostMatchesPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === pattern;
}

export class RegistrationService {
  readonly #verifier: DeploymentVerifier;
  readonly #store: RegistrationStore | undefined;
  readonly #codec: RegistrationCapabilityCodec | undefined;
  readonly #trust: RuntimeConfig['trust'];
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  readonly #ttlMs: number;

  constructor(options: Options) {
    if (!options.store && !options.codec) throw new Error('registration service requires store or capability codec');
    this.#verifier = options.verifier;
    this.#store = options.store;
    this.#codec = options.codec;
    this.#trust = options.trust;
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? (() => `reg_${randomUUID()}`);
    this.#ttlMs = options.registrationTtlMs ?? 15 * 60_000;
  }

  async register(input: RegistrationInput): Promise<TargetRegistration> {
    if (!this.#trust.projectId || !this.#trust.repositoryOwner || !this.#trust.repositoryName) {
      throw new RuntimeError('PROVENANCE_MISMATCH', 'server-owned project trust configuration is incomplete');
    }

    const repository = { owner: this.#trust.repositoryOwner, name: this.#trust.repositoryName };
    const verified = await this.#verifier.verify({
      deploymentId: input.deploymentId,
      expectedCommitSha: input.expectedCommitSha,
      repository,
      projectId: this.#trust.projectId,
    });

    const providerUrl = new URL(verified.deploymentUrl);
    const host = providerUrl.hostname.toLowerCase();
    if (!this.#trust.approvedDeploymentHostPatterns.some((pattern) => hostMatchesPattern(host, pattern))) {
      throw new RuntimeError('TARGET_BLOCKED', 'verified deployment host is outside project trust policy');
    }
    const entryPath = this.#trust.targetEntryPath ?? '/';
    const targetUrl = entryPath === '/'
      ? providerUrl.origin
      : new URL(entryPath, `${providerUrl.origin}/`).toString();

    const created = this.#now();
    const payload: RegistrationCapabilityPayload = {
      project_id: this.#trust.projectId,
      repository,
      expected_commit_sha: verified.commitSha,
      deployment_id: verified.deploymentId,
      deployment_url: targetUrl,
      deployment_origin: providerUrl.origin,
      allowed_hosts: [...new Set([
        host,
        ...this.#trust.approvedDependencyHosts,
        ...this.#trust.approvedRedirectHosts,
      ])],
      created_at: created.toISOString(),
      expires_at: new Date(created.getTime() + this.#ttlMs).toISOString(),
      provenance_source: 'provider_api',
    };

    if (this.#codec) return this.#codec.issue(payload);

    const registration = TargetRegistrationSchema.parse({
      target_registration_id: this.#idFactory(),
      ...payload,
    });
    await this.#store!.put(registration);
    return registration;
  }
}
