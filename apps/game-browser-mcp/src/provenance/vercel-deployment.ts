import { RuntimeError } from '../errors.js';
import type { DeploymentVerifier, VerifiedDeployment } from './types.js';

interface VerifierOptions {
  token: string;
  teamId?: string;
  fetchImpl?: typeof fetch;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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
    const gitSource = record(body.gitSource);
    const meta = record(body.meta);

    const commitSha = text(gitSource.sha) ?? text(meta.githubCommitSha);
    const org = text(gitSource.org) ?? text(meta.githubCommitOrg) ?? text(meta.githubOrg);
    const repo = text(gitSource.repo) ?? text(meta.githubCommitRepo) ?? text(meta.githubRepo);
    const gitType = text(gitSource.type) ?? 'github';

    if (deploymentId !== input.deploymentId || !deploymentHost || projectId !== input.projectId) {
      throw new RuntimeError('PROVENANCE_MISMATCH', 'deployment identity or project does not match');
    }
    if (readyState !== 'READY') {
      throw new RuntimeError('STALE_DEPLOYMENT', `deployment is not READY (${readyState ?? 'unknown'})`);
    }
    if (gitType !== 'github' || commitSha !== input.expectedCommitSha || org !== input.repository.owner || repo !== input.repository.name) {
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
      commitSha,
    };
  }
}
