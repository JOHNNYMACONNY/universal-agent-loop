import { z } from 'zod';
import { GameActionSchema } from '../contracts.js';

const SessionSchema = z.string().min(1).max(128);
const PathSchema = z.string().max(512).regex(/^(?:\/(?:[^~\/]|~[01])*)*$/, 'JSON pointer path required');

export const SandboxWorkerRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('health'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('start'), session_id: SessionSchema, target_url: z.string().url(), viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().optional() }).strict(),
  z.object({ type: z.literal('observe'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('input'), session_id: SessionSchema, action_batch_id: z.string().min(1).max(128), actions: z.array(GameActionSchema).min(1).max(20) }).strict(),
  z.object({ type: z.literal('read_state'), session_id: SessionSchema, path: PathSchema.optional() }).strict(),
  z.object({ type: z.literal('reset'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('release'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('end'), session_id: SessionSchema }).strict(),
]);
export type SandboxWorkerRequest = z.infer<typeof SandboxWorkerRequestSchema>;
