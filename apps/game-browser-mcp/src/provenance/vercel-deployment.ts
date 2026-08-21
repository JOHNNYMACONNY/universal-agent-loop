import { RuntimeError } from '../errors.js';
import type { RepositoryRef } from '../contracts.js';
import type { DeploymentVerifier, VerifiedDeployment } from './types.js';

interface VerifierOptions {
  token: string;
  teamId?: string;
  fetchImpl?: typeof fetch;
}

interface FindReadyInput {
  expectedCommitSha: string;
  repository: RepositoryRef;
  projectId: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function gitIdentity(value: Record<string, unknown>) {
  const gitSource = record(value.gitSource);
  const meta = record(value.meta);
  return {
    commitSha: text(gitSource.sha) ?? text(meta.githubCommitSha),
    org: text(gitSource.org) ?? text(meta.githubCommitOrg) ?? text(meta.githubOrg),
    repo: text(gitSource.repo) ?? text(meta.githubCommitRepo) ?? text(meta.githubRepo),
    gitType: text(gitSource.type) ?? 'github',
  };
}

export class VercelDeploymentVerifier implements DeploymentVerifier {
  readonly #token: string;
  readonly #teamId: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: VerifierOptions) {
    this.#token = options.token;
    this.#teamId = options.teamId;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async findReadyForCommit(input: FindReadyInput): Promise<VerifiedDeployment> {
    if (!/^[0-9a-f]{40}$/i.test(input.expectedCommitSha) || !input.projectId || !input.repository.owner || !input.repository.name) {
      throw new RuntimeError('PROVENANCE_MISMATCH', 'exact commit/project/repository identity is required for deployment discovery');
    }

    const url = new URL('https://api.vercel.com/v6/deployments');
    url.searchParams.set('projectId', input.projectId);
    url.searchParams.set('limit', '20');
    if (this.#teamId) url.searchParams.set('teamId', this.#teamId);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.#token}`, accept: 'application/json' },
      });
    } catch {
      throw new RuntimeError('PROVENANCE_MISMATCH', 'provider deployment discovery failed');
    }
    if (!response.ok) {
      if (response.status === 404) throw new RuntimeError('STALE_DEPLOYMENT', 'configured provider project has no deployment history');
      throw new RuntimeError('PROVENANCE_MISMATCH', `provider deployment discovery failed with ${response.status}`);
    }

    let payload: Record<string, unknown>;
    try { payload = record(await response.json()); }
    catch { throw new RuntimeError('PROVENANCE_MISMATCH', 'provider deployment discovery returned invalid JSON'); }
    const deployments = Array.isArray(payload.deployments) ? payload.deployments.slice(0, 20) : [];

    for (const value of deployments) {
      const candidate = record(value);
      const deploymentId = text(candidate.id) ?? text(candidate.uid);
      const readyState = text(candidate.readyState) ?? text(candidate.state) ?? text(candidate.status);
      const candidateProjectId = text(candidate.projectId);
      const git = gitIdentity(candidate);
      if (
        !deploymentId
        || !/^dpl_[A-Za-z0-9]+$/.test(deploymentId)
        || readyState !== 'READY'
        || (candidateProjectId !== undefined && candidateProjectId !== input.projectId)
        || git.gitType !== 'github'
        || git.commitSha !== input.expectedCommitSha
        || git.org !== input.repository.owner
        || git.repo !== input.repository.name
      ) continue;

      try {
        return await this.verify({
          deploymentId,
          expectedCommitSha: input.expectedCommitSha,
          repository: input.repository,
          projectId: input.projectId,
        });
      } catch (error) {
        if (error instanceof RuntimeError && (error.code === 'STALE_DEPLOYMENT' || error.code === 'PROVENANCE_MISMATCH')) continue;
        throw error;
      }
    }

    throw new RuntimeError('STALE_DEPLOYMENT', 'no exact READY deployment exists for the requested commit');
  }

  async verify(input: Parameters<DeploymentVerifier['verify']>[0]): Promise<VerifiedDeployment> {
    if (!/^dpl_[A-Za-z0-9]+$/.test(input.deploymentId)) {
      throw new RuntimeError('PROVENANCE_MISMATCH', 'only immutable deployment IDs may be verified');
    }

    const url = new URL(`https://api.vercel.com/v13/deployments/${encodeURIComponent(input.deploymentId)}`);
    url.searchParams.set('withGitRepoInfo', 'true');
    if (this.#teamId) url.searchParams.set('teamId', this.#teamId);

    const response = await this.#fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.#token}`, accept: 'application/json' },
    });
    if (!response.ok) {
      if (response.status === 404) throw new RuntimeError('STALE_DEPLOYMENT', 'deployment not found');
      throw new RuntimeError('PROVENANCE_MISMATCH', `provider verification failed with ${response.status}`);
    }

    const body = record(await response.json());
    const deploymentId = text(body.id) ?? text(body.uid);
    const deploymentHost = text(body.url);
    const projectId = text(body.projectId);
    const readyState = text(body.readyState) ?? text(body.state) ?? text(body.status);
    const git = gitIdentity(body);

    if (deploymentId !== input.deploymentId || !deploymentHost || projectId !== input.projectId) {
      throw new RuntimeError('PROVENANCE_MISMATCH', 'deployment identity or project does not match');
    }
    if (readyState !== 'READY') {
      throw new RuntimeError('STALE_DEPLOYMENT', `deployment is not READY (${readyState ?? 'unknown'})`);
    }
    if (git.gitType !== 'github' || git.commitSha !== input.expectedCommitSha || git.org !== input.repository.owner || git.repo !== input.repository.name) {
      throw new RuntimeError('PROVENANCE_MISMATCH', 'git deployment provenance does not match expected repository and commit');
    }

    const canonicalUrl = deploymentHost.startsWith('https://') ? deploymentHost : `https://${deploymentHost}`;
    const parsed = new URL(canonicalUrl);
    if (parsed.protocol !== 'https:') throw new RuntimeError('PROVENANCE_MISMATCH', 'deployment URL must be HTTPS');

    return {
      deploymentId,
      deploymentUrl: parsed.toString().replace(/\/$/, ''),
      projectId,
      repository: { ...input.repository },
      commitSha: git.commitSha,
    };
  }
}
