import { fileURLToPath } from 'node:url';
import express, { type RequestHandler } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { Redis } from '@upstash/redis';

import { SignedBearerPrincipalResolver } from './auth/principal.js';
import { RedisRateLimiter } from './auth/rate-limit.js';
import { VercelSandboxBrowser } from './browser/vercel-sandbox-browser.js';
import { loadRuntimeConfig } from './env.js';
import { createGameMcpHandler, type GameToolSurface } from './mcp.js';
import { createRegistrationHandler } from './admin/register-deployment.js';
import { RegistrationService } from './provenance/registration-service.js';
import { UpstashRegistrationStore } from './provenance/upstash-registration-store.js';
import { VercelDeploymentVerifier } from './provenance/vercel-deployment.js';
import { UpstashSessionStore } from './sessions/upstash-session-store.js';
import { createGameToolServices } from './tools/index.js';

export interface RuntimeAppOptions {
  allowedHosts: string[];
  registrationHandler?: RequestHandler;
}

export type GameToolSurfaceFactory = (authorization: string | undefined) => GameToolSurface;

const fixtureRoot = fileURLToPath(new URL('../fixtures/game/', import.meta.url));

export const PRODUCTION_ENVIRONMENT_NAMES = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
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

export function createProductionRuntimeApp(env: Record<string, string | undefined> = process.env) {
  const redisUrl = required(env, 'UPSTASH_REDIS_REST_URL');
  const redisToken = required(env, 'UPSTASH_REDIS_REST_TOKEN');
  const vercelToken = required(env, 'VERCEL_API_TOKEN');
  const snapshotId = required(env, 'AGENT_BROWSER_SNAPSHOT_ID');
  const registrationControlToken = required(env, 'REGISTRATION_CONTROL_TOKEN');
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

  const redis = new Redis({ url: redisUrl, token: redisToken });
  const sessions = new UpstashSessionStore(redis as any);
  const registrations = new UpstashRegistrationStore(redis as any);
  const rateLimiter = new RedisRateLimiter(redis as any);
  const verifier = new VercelDeploymentVerifier({ token: vercelToken, ...(env.VERCEL_TEAM_ID?.trim() ? { teamId: env.VERCEL_TEAM_ID.trim() } : {}) });
  const browser = new VercelSandboxBrowser({ snapshotId });
  const bearerResolver = new SignedBearerPrincipalResolver({ secret: ownerBindingSecret, audience: principalAudience });
  const registrationService = new RegistrationService({ verifier, store: registrations, trust: config.trust });
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
    rateLimiter,
    rateLimits: {
      sessionStarts: Number(env.SESSION_STARTS_PER_MINUTE ?? 6),
      actionCalls: Number(env.ACTION_CALLS_PER_MINUTE ?? 120),
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
