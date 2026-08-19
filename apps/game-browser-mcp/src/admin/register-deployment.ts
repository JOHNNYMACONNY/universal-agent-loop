import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { RuntimeError } from '../errors.js';
import type { RegistrationService } from '../provenance/registration-service.js';

const RequestSchema = z.object({
  deploymentId: z.string().regex(/^dpl_[A-Za-z0-9]+$/),
  expectedCommitSha: z.string().regex(/^[0-9a-f]{40}$/i),
}).strict();

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function constantTimeTokenEqual(actual: string | undefined, expected: string): boolean {
  return timingSafeEqual(digest(actual ?? ''), digest(expected));
}

export function createRegistrationHandler(service: RegistrationService, controlToken: string): RequestHandler {
  return async (req, res) => {
    const supplied = req.header?.('x-registration-control-token') ??
      (typeof req.headers['x-registration-control-token'] === 'string' ? req.headers['x-registration-control-token'] : undefined);
    if (!constantTimeTokenEqual(supplied, controlToken)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const parsed = RequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    try {
      const registration = await service.register(parsed.data);
      res.status(201).json(registration);
    } catch (error) {
      if (error instanceof RuntimeError) {
        res.status(error.code === 'TARGET_BLOCKED' ? 403 : 409).json({ error: error.code, message: error.message });
        return;
      }
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  };
}
