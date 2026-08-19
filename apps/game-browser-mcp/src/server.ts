import { fileURLToPath } from 'node:url';
import express from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';

import { createGameMcpHandler, type GameToolSurface } from './mcp.js';

export interface RuntimeAppOptions {
  allowedHosts: string[];
}

const fixtureRoot = fileURLToPath(new URL('../fixtures/game/', import.meta.url));

export function createRuntimeApp(services: GameToolSurface, options: RuntimeAppOptions) {
  const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: options.allowedHosts });
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/fixture/expected-failure', (_req, res) => res.status(404).json({ error: 'EXPECTED_REMOTE_QA_NETWORK_FAILURE' }));
  app.use('/fixture', express.static(fixtureRoot, { fallthrough: false, index: 'index.html' }));

  const nodeHandler = toNodeHandler(createGameMcpHandler(services));
  app.all('/mcp', (req, res) => void nodeHandler(req, res, req.body));
  return app;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

export default app;
