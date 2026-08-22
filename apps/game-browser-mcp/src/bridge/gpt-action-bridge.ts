import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import express, { type Request, type Response } from 'express';
import { z, ZodError } from 'zod';

import { asRuntimeError, RuntimeError } from '../errors.js';
import type { GameToolSurface } from '../mcp.js';

const StartSchema = z.object({
  expected_commit_sha: z.string().regex(/^[0-9a-f]{40}$/i),
  viewport: z.object({
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
  }).strict().optional(),
}).strict();

interface RegistrationRef {
  target_registration_id: string;
}

interface GameBridgeSurface extends GameToolSurface {
  latestScreenshot(input: unknown): Promise<unknown>;
}

export interface GptActionBridgeOptions {
  token?: string | undefined;
  surface?: GameBridgeSurface | undefined;
  registerForCommit?: ((expectedCommitSha: string) => Promise<RegistrationRef>) | undefined;
}

function bearerToken(value: string | undefined): string {
  if (!value) return '';
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() ?? '';
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function deriveGptActionBridgeBinding(token: string): string {
  if (!token) throw new Error('GPT Action bridge token is required to derive a principal binding');
  return createHash('sha256').update(`ual:gpt-action-game-browser-bridge:v1:${token}`, 'utf8').digest('hex');
}

const SCREENSHOT_LINK_TTL_MS = 5 * 60_000;
const MAX_SCREENSHOT_BYTES = 2_000_000;

function screenshotLinkSignature(token: string, sessionId: string, frameSha256: string, expiresAtMs: number): string {
  return createHmac('sha256', token)
    .update(`ual:game-browser-screenshot-link:v1\n${sessionId}\n${frameSha256}\n${expiresAtMs}`, 'utf8')
    .digest('hex');
}

function queryValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function errorStatus(error: RuntimeError): number {
  switch (error.code) {
    case 'AUTH_CONTEXT_UNAVAILABLE': return 401;
    case 'TARGET_BLOCKED': return 403;
    case 'SESSION_NOT_FOUND': return 404;
    case 'SESSION_EXPIRED': return 410;
    case 'PROVENANCE_MISMATCH':
    case 'STALE_DEPLOYMENT':
    case 'SESSION_RECOVERY_REQUIRED':
    case 'ACTION_REJECTED':
    case 'ACTION_STATE_UNKNOWN': return 409;
    case 'INVALID_ARGUMENT': return 400;
    case 'CAPABILITY_UNAVAILABLE': return 422;
    case 'LIMIT_EXCEEDED': return 429;
    case 'BROWSER_ERROR': return 502;
    default: return 500;
  }
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'invalid bounded game-QA input' });
    return;
  }
  const normalized = asRuntimeError(error);
  const status = errorStatus(normalized);
  const message = normalized.message.length <= 1024 ? normalized.message : normalized.message.slice(0, 1024);
  res.status(status).json({ error: normalized.code, message });
}

export function createGptActionBridgeRouter(options: GptActionBridgeOptions) {
  const router = express.Router();

  router.get('/screenshot', async (req, res) => {
    const configured = options.token?.trim();
    if (!configured || !options.surface) {
      res.status(503).json({ error: 'BRIDGE_CONFIGURATION_ERROR' });
      return;
    }

    const sessionId = queryValue(req.query.session_id);
    const frameSha256 = queryValue(req.query.frame_sha256);
    const expiresText = queryValue(req.query.expires);
    const signature = queryValue(req.query.sig);
    const expiresAtMs = Number(expiresText);
    const nowMs = Date.now();
    const expectedSignature = Number.isSafeInteger(expiresAtMs) && sessionId && /^[0-9a-f]{64}$/.test(frameSha256)
      ? screenshotLinkSignature(configured, sessionId, frameSha256, expiresAtMs)
      : '';
    const valid = /^[A-Za-z0-9_.-]{1,128}$/.test(sessionId)
      && /^[0-9a-f]{64}$/.test(frameSha256)
      && Number.isSafeInteger(expiresAtMs)
      && expiresAtMs >= nowMs
      && expiresAtMs <= nowMs + SCREENSHOT_LINK_TTL_MS
      && safeEqual(signature, expectedSignature);
    if (!valid) {
      res.status(403).json({ error: 'INVALID_SCREENSHOT_LINK' });
      return;
    }

    try {
      const value = await options.surface.latestScreenshot({ session_id: sessionId }) as {
        screenshot?: { base64?: unknown; mime_type?: unknown; bytes?: unknown };
      };
      const base64 = value?.screenshot?.base64;
      if (typeof base64 !== 'string' || value?.screenshot?.mime_type !== 'image/png') {
        throw new RuntimeError('CAPABILITY_UNAVAILABLE', 'cached screenshot unavailable');
      }
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_SCREENSHOT_BYTES) {
        throw new RuntimeError('LIMIT_EXCEEDED', 'screenshot exceeds 2 MB evidence limit');
      }
      const actualFrameSha256 = createHash('sha256').update(bytes).digest('hex');
      if (!safeEqual(actualFrameSha256, frameSha256)) {
        throw new RuntimeError('ACTION_REJECTED', 'screenshot capability no longer matches the cached frame');
      }
      res.status(200);
      res.setHeader('cache-control', 'private, no-store, max-age=0');
      res.setHeader('content-type', 'image/png');
      res.setHeader('content-length', String(bytes.byteLength));
      res.setHeader('x-content-type-options', 'nosniff');
      res.end(bytes);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.use((req, res, next) => {
    const configured = options.token?.trim();
    if (!configured || !options.surface || !options.registerForCommit) {
      res.status(503).json({ error: 'BRIDGE_CONFIGURATION_ERROR' });
      return;
    }
    const presented = bearerToken(req.header('authorization'));
    if (!safeEqual(presented, configured)) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    next();
  });

  const invoke = (method: keyof Pick<GameToolSurface, 'observe' | 'input' | 'readState' | 'reset' | 'sessionEnd'>) => async (req: Request, res: Response) => {
    try {
      const value = await options.surface![method](req.body);
      res.status(200).json(value);
    } catch (error) {
      sendError(res, error);
    }
  };

  router.post('/session-start', async (req, res) => {
    try {
      const input = StartSchema.parse(req.body);
      const registration = await options.registerForCommit!(input.expected_commit_sha);
      if (!registration?.target_registration_id) throw new RuntimeError('PROVENANCE_MISMATCH', 'server-side target registration failed');
      const value = await options.surface!.sessionStart({
        target_registration_id: registration.target_registration_id,
        expected_commit_sha: input.expected_commit_sha,
        ...(input.viewport ? { viewport: input.viewport } : {}),
      });
      res.status(200).json(value);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/observe', invoke('observe'));
  router.post('/input', invoke('input'));
  router.post('/read-state', invoke('readState'));
  router.post('/reset', invoke('reset'));
  router.post('/session-end', invoke('sessionEnd'));

  return router;
}


