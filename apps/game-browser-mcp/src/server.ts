import { fileURLToPath } from 'node:url';
import express, { type RequestHandler } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';

import { SignedBearerPrincipalResolver } from './auth/principal.js';
import { VercelSandboxBrowser } from './browser/vercel-sandbox-browser.js';
import { loadRuntimeConfig } from './env.js';
import { createGameMcpHandler, type GameToolSurface } from './mcp.js';
import { createRegistrationHandler } from './admin/register-deployment.js';
import { CapabilityRegistrationStore, RegistrationCapabilityCodec } from './provenance/registration-capability.js';
import { RegistrationService } from './provenance/registration-service.js';
import { VercelDeploymentVerifier } from './provenance/vercel-deployment.js';
import { VercelSandboxSessionStore } from './sessions/vercel-sandbox-session-store.js';
import { createGameToolServices } from './tools/index.js';

export interface RuntimeAppOptions {
  allowedHosts: string[];
  registrationHandler?: RequestHandler;
}

export type GameToolSurfaceFactory = (authorization: string | undefined) => GameToolSurface;

const fixtureRoot = fileURLToPath(new URL('../fixtures/game/', import.meta.url));

export const PRODUCTION_ENVIRONMENT_NAMES = [
  'VERCEL_API_TOKEN',
  'VERCEL_TEAM_ID',
  'TARGET_PROJECT_ID',
  'TARGET_REPOSITORY_OWNER',
  'TARGET_REPOSITORY_NAME',
  'TARGET_ENTRY_PATH',
  'APPROVED_DEPLOYMENT_HOST_PATTERNS',
  'APPROVED_DEPENDENCY_HOSTS',
  'APPROVED_REDIRECT_HOSTS',
  'AGENT_BROWSER_SNAPSHOT_ID',
  'REGISTRATION_CONTROL_TOKEN',
  'REGISTRATION_CAPABILITY_SECRET',
  'OWNER_BINDING_SECRET',
  'PRINCIPAL_AUDIENCE',
  'RUNTIME_ALLOWED_HOSTS',
] as const;

function isFactory(value: GameToolSurface | GameToolSurfaceFactory): value is GameToolSurfaceFactory {
  return typeof value === 'function';
}

export function createRuntimeApp(services: GameToolSurface | GameToolSurfaceFactory, options: RuntimeAppOptions) {
  const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: options.allowedHosts, jsonLimit: '64kb' });
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/fixture/expected-failure', (_req, res) => res.status(404).json({ error: 'EXPECTED_REMOTE_QA_NETWORK_FAILURE' }));
  app.use('/fixture', express.static(fixtureRoot, { fallthrough: false, index: 'index.html' }));
  if (options.registrationHandler) app.post('/internal/registrations', options.registrationHandler);

  app.all('/mcp', (req, res) => {
    const surface = isFactory(services) ? services(req.header('authorization')) : services;
    const nodeHandler = toNodeHandler(createGameMcpHandler(surface));
    void nodeHandler(req, res, req.body);
  });
  return app;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`production configuration missing ${name}`);
  return value;
}

function optionalHostList(raw: string | undefined): string[] {
  return raw?.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
}

function positiveRateLimit(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function createProductionRuntimeApp(env: Record<string, string | undefined> = process.env) {
  const vercelToken = required(env, 'VERCEL_API_TOKEN');
  const snapshotId = required(env, 'AGENT_BROWSER_SNAPSHOT_ID');
  const registrationControlToken = required(env, 'REGISTRATION_CONTROL_TOKEN');
  const registrationCapabilitySecret = required(env, 'REGISTRATION_CAPABILITY_SECRET');
  const ownerBindingSecret = required(env, 'OWNER_BINDING_SECRET');
  const principalAudience = required(env, 'PRINCIPAL_AUDIENCE');
  for (const name of ['TARGET_PROJECT_ID', 'TARGET_REPOSITORY_OWNER', 'TARGET_REPOSITORY_NAME', 'TARGET_ENTRY_PATH', 'APPROVED_DEPLOYMENT_HOST_PATTERNS']) required(env, name);

  const config = loadRuntimeConfig(env);
  if (config.trust.approvedDeploymentHostPatterns.length === 0) throw new Error('production configuration requires APPROVED_DEPLOYMENT_HOST_PATTERNS');

  const runtimeAllowedHosts = [
    ...optionalHostList(env.RUNTIME_ALLOWED_HOSTS),
    ...(env.VERCEL_URL ? [env.VERCEL_URL.toLowerCase()] : []),
  ];
  if (runtimeAllowedHosts.length === 0) throw new Error('production configuration requires RUNTIME_ALLOWED_HOSTS or VERCEL_URL');

  // Retain strict parsing for compatibility while coarse production rate limiting moves to Vercel WAF.
  const sessionStartsPerMinute = positiveRateLimit(env, 'SESSION_STARTS_PER_MINUTE', 6);
  const actionCallsPerMinute = positiveRateLimit(env, 'ACTION_CALLS_PER_MINUTE', 120);

  const codec = new RegistrationCapabilityCodec({ secret: registrationCapabilitySecret });
  const registrations = new CapabilityRegistrationStore(codec);
  const sessions = new VercelSandboxSessionStore();
  const verifier = new VercelDeploymentVerifier({
    token: vercelToken,
    ...(env.VERCEL_TEAM_ID?.trim() ? { teamId: env.VERCEL_TEAM_ID.trim() } : {}),
  });
  const browser = new VercelSandboxBrowser({ snapshotId });
  const bearerResolver = new SignedBearerPrincipalResolver({ secret: ownerBindingSecret, audience: principalAudience });
  const registrationService = new RegistrationService({ verifier, codec, trust: config.trust });
  const registrationHandler = createRegistrationHandler(registrationService, registrationControlToken);

  const servicesFactory: GameToolSurfaceFactory = (authorization) => createGameToolServices({
    registrations,
    sessions,
    browser,
    verifier,
    principals: { resolve: () => bearerResolver.resolve({ authorization }) },
    resolveDns: async (hostname) => {
      const { lookup } = await import('node:dns/promises');
      const answers = await lookup(hostname, { all: true, verbatim: true });
      return answers.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
    },
    limits: config.limits,
    // Coarse production rate limiting is configured at Vercel/WAF. These values remain
    // available to injected/test limiters but production does not depend on a shared DB.
    rateLimits: {
      sessionStarts: sessionStartsPerMinute,
      actionCalls: actionCallsPerMinute,
      windowMs: 60_000,
    },
  });

  return createRuntimeApp(servicesFactory, { allowedHosts: [...new Set(runtimeAllowedHosts)], registrationHandler });
}

let cachedProductionApp: ReturnType<typeof createProductionRuntimeApp> | undefined;
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  try {
    cachedProductionApp ??= createProductionRuntimeApp(process.env);
    cachedProductionApp(req, res, next);
  } catch (error) {
    res.status(503).json({ error: 'CONFIGURATION_ERROR', message: error instanceof Error ? error.message : 'runtime configuration unavailable' });
  }
});

export default app;
