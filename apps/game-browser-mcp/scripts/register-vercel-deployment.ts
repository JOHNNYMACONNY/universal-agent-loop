import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export interface RegisterRemoteDeploymentInput {
  runtimeBaseUrl: string;
  deploymentId: string;
  commitSha: string;
  controlToken: string;
  fetchImpl?: typeof fetch;
}

export interface RegisteredRemoteDeployment {
  targetRegistrationId: string;
  deploymentId: string;
  expectedCommitSha: string;
  deploymentUrl: string;
}

function validateRuntimeBaseUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('runtime base URL must use HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('runtime base URL must not contain credentials, query, or fragment');
  return url;
}

export async function registerRemoteDeployment(input: RegisterRemoteDeploymentInput): Promise<RegisteredRemoteDeployment> {
  const runtime = validateRuntimeBaseUrl(input.runtimeBaseUrl);
  if (!/^dpl_[A-Za-z0-9]+$/.test(input.deploymentId)) throw new Error('deployment ID must be an immutable dpl_ identifier');
  if (!/^[0-9a-f]{40}$/i.test(input.commitSha)) throw new Error('commit SHA must be exactly 40 hexadecimal characters');
  if (!input.controlToken) throw new Error('registration control token is required');

  const endpoint = new URL('/internal/registrations', runtime.origin);
  const response = await (input.fetchImpl ?? fetch)(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-registration-control-token': input.controlToken,
    },
    body: JSON.stringify({ deploymentId: input.deploymentId, expectedCommitSha: input.commitSha }),
  });

  let body: any = {};
  try { body = await response.json(); } catch {}
  if (response.status !== 201) {
    throw new Error(`registration failed (${response.status}): ${String(body?.error ?? 'unknown error')}`);
  }

  if (
    typeof body.target_registration_id !== 'string' || !body.target_registration_id ||
    body.deployment_id !== input.deploymentId ||
    body.expected_commit_sha !== input.commitSha ||
    typeof body.deployment_url !== 'string'
  ) {
    throw new Error('registration response provenance mismatch');
  }

  return {
    targetRegistrationId: body.target_registration_id,
    deploymentId: body.deployment_id,
    expectedCommitSha: body.expected_commit_sha,
    deploymentUrl: body.deployment_url,
  };
}

async function main(): Promise<void> {
  const runtimeBaseUrl = process.env.REMOTE_RUNTIME_BASE_URL;
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
  const commitSha = process.env.EXPECTED_COMMIT_SHA ?? process.env.GITHUB_SHA;
  const controlToken = process.env.REGISTRATION_CONTROL_TOKEN;
  if (!runtimeBaseUrl || !deploymentId || !commitSha || !controlToken) {
    throw new Error('REMOTE_RUNTIME_BASE_URL, VERCEL_DEPLOYMENT_ID, EXPECTED_COMMIT_SHA/GITHUB_SHA, and REGISTRATION_CONTROL_TOKEN are required');
  }
  const result = await registerRemoteDeployment({ runtimeBaseUrl, deploymentId, commitSha, controlToken });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `target_registration_id=${result.targetRegistrationId}\n`, 'utf8');
    await appendFile(process.env.GITHUB_OUTPUT, `deployment_id=${result.deploymentId}\n`, 'utf8');
    await appendFile(process.env.GITHUB_OUTPUT, `deployment_url=${result.deploymentUrl}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({ ok: true, targetRegistrationId: result.targetRegistrationId, deploymentId: result.deploymentId, commit: result.expectedCommitSha })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
