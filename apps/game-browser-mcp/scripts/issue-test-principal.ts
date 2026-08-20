import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { issueSignedPrincipalToken } from '../src/auth/principal.js';

export function issueRemoteAcceptancePrincipal(input: {
  secret: string;
  audience: string;
  subject?: string;
  now?: Date;
  lifetimeMs?: number;
}): string {
  const now = input.now ?? new Date();
  const lifetimeMs = input.lifetimeMs ?? 30 * 60_000;
  if (!Number.isInteger(lifetimeMs) || lifetimeMs < 60_000 || lifetimeMs > 60 * 60_000) {
    throw new Error('test principal lifetime must be between 1 and 60 minutes');
  }
  return issueSignedPrincipalToken({
    subject: input.subject ?? 'github-actions-remote-acceptance',
    audience: input.audience,
    expiresAt: new Date(now.getTime() + lifetimeMs),
  }, input.secret);
}

async function main(): Promise<void> {
  const secret = process.env.OWNER_BINDING_SECRET;
  const audience = process.env.PRINCIPAL_AUDIENCE;
  if (!secret || !audience) throw new Error('OWNER_BINDING_SECRET and PRINCIPAL_AUDIENCE are required');
  const token = issueRemoteAcceptancePrincipal({ secret, audience });
  process.stdout.write(`::add-mask::${token}\n`);
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required in the live workflow');
  await appendFile(process.env.GITHUB_OUTPUT, `bearer_token=${token}\n`, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
