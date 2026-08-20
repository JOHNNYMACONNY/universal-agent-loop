import { z } from 'zod';
import { AllowedKeySchema, GameActionSchema, PointerButtonSchema, SessionRecordSchema } from '../contracts.js';

const SessionSchema = z.string().min(1).max(128);
const BatchSchema = z.string().min(1).max(128);
const PathSchema = z.string().max(512).regex(/^(?:\/(?:[^~\/]|~[01])*)*$/, 'JSON pointer path required');

export const SandboxWorkerRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('health'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('start'), session_id: SessionSchema, target_url: z.string().url(), viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().optional() }).strict(),
  z.object({ type: z.literal('observe'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('input'), session_id: SessionSchema, action_batch_id: BatchSchema, actions: z.array(GameActionSchema).min(1).max(20) }).strict(),
  z.object({ type: z.literal('read_state'), session_id: SessionSchema, path: PathSchema.optional() }).strict(),
  z.object({ type: z.literal('reset'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('release'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('end'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('session_create'), session_id: SessionSchema, record: SessionRecordSchema }).strict(),
  z.object({ type: z.literal('session_get'), session_id: SessionSchema }).strict(),
  z.object({
    type: z.literal('session_begin_batch'), session_id: SessionSchema, batch_id: BatchSchema,
    expected_action_seq: z.number().int().nonnegative(), action_count: z.number().int().positive(),
    max_actions_per_session: z.number().int().positive(),
  }).strict(),
  z.object({ type: z.literal('session_complete_batch'), session_id: SessionSchema, batch_id: BatchSchema, result: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ type: z.literal('session_update_held'), session_id: SessionSchema, held_keys: z.array(AllowedKeySchema), held_pointer_buttons: z.array(PointerButtonSchema) }).strict(),
  z.object({ type: z.literal('session_touch'), session_id: SessionSchema, at: z.string().datetime({ offset: true }), max_idle_ms: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('session_reset_recovery'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('session_mark_recovery'), session_id: SessionSchema, reason: z.string().min(1).max(4096) }).strict(),
  z.object({ type: z.literal('session_next_observation'), session_id: SessionSchema }).strict(),
  z.object({ type: z.literal('session_end'), session_id: SessionSchema }).strict(),
]);
export type SandboxWorkerRequest = z.infer<typeof SandboxWorkerRequestSchema>;
