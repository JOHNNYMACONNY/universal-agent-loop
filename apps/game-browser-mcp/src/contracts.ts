import { z } from 'zod';

const ShaSchema = z.string().regex(/^[0-9a-f]{40}$/i, 'expected a 40-character git SHA');
const HttpsUrlSchema = z.string().url().refine((value) => new URL(value).protocol === 'https:', 'HTTPS URL required');
const HostSchema = z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/i, 'invalid hostname');

export const RepositoryRefSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
}).strict();
export type RepositoryRef = z.infer<typeof RepositoryRefSchema>;

export const DeploymentProvenanceSchema = z.object({
  target_registration_id: z.string().min(1),
  repository: RepositoryRefSchema,
  expected_commit_sha: ShaSchema,
  deployed_commit_sha: ShaSchema,
  deployment_id: z.string().min(1),
  deployment_url: HttpsUrlSchema,
}).strict();
export type DeploymentProvenance = z.infer<typeof DeploymentProvenanceSchema>;

export const TargetRegistrationSchema = z.object({
  target_registration_id: z.string().min(1),
  project_id: z.string().min(1),
  repository: RepositoryRefSchema,
  expected_commit_sha: ShaSchema,
  deployment_id: z.string().min(1),
  deployment_url: HttpsUrlSchema,
  deployment_origin: HttpsUrlSchema,
  allowed_hosts: z.array(HostSchema).min(1),
  created_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  provenance_source: z.enum(['provider_api', 'signed_provider_event', 'trusted_ci']),
}).strict().superRefine((value, ctx) => {
  if (new URL(value.deployment_url).origin !== value.deployment_origin) {
    ctx.addIssue({ code: 'custom', path: ['deployment_origin'], message: 'origin must match deployment_url' });
  }
  if (new Date(value.expires_at).getTime() <= new Date(value.created_at).getTime()) {
    ctx.addIssue({ code: 'custom', path: ['expires_at'], message: 'expires_at must be after created_at' });
  }
});
export type TargetRegistration = z.infer<typeof TargetRegistrationSchema>;

export const PointerButtonSchema = z.enum(['left', 'middle', 'right']);
export const AllowedKeySchema = z.enum([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'w', 'a', 's', 'd', 'W', 'A', 'S', 'D',
  ' ', 'Enter', 'Escape', 'Shift', 'Control',
  'e', 'E', 'f', 'F', 'q', 'Q', 'r', 'R',
]);

export const GameActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('key_down'), key: AllowedKeySchema }).strict(),
  z.object({ type: z.literal('key_up'), key: AllowedKeySchema }).strict(),
  z.object({ type: z.literal('press'), key: AllowedKeySchema, duration_ms: z.number().int().min(1).max(10_000).optional() }).strict(),
  z.object({ type: z.literal('pointer_move'), x: z.number().finite(), y: z.number().finite() }).strict(),
  z.object({ type: z.literal('pointer_move_relative'), delta_x: z.number().finite(), delta_y: z.number().finite() }).strict(),
  z.object({ type: z.literal('pointer_down'), button: PointerButtonSchema.optional() }).strict(),
  z.object({ type: z.literal('pointer_up'), button: PointerButtonSchema.optional() }).strict(),
  z.object({ type: z.literal('click'), x: z.number().finite(), y: z.number().finite(), button: PointerButtonSchema.optional() }).strict(),
  z.object({ type: z.literal('scroll'), delta_x: z.number().finite().optional(), delta_y: z.number().finite() }).strict(),
  z.object({ type: z.literal('wait'), duration_ms: z.number().int().min(1).max(10_000) }).strict(),
]);
export type GameAction = z.infer<typeof GameActionSchema>;

export const GameInputSchema = z.object({
  session_id: z.string().min(1),
  action_batch_id: z.string().min(1).max(128),
  expected_action_seq: z.number().int().nonnegative(),
  actions: z.array(GameActionSchema).min(1).max(20),
}).strict();
export type GameInput = z.infer<typeof GameInputSchema>;

export const GameObservationSchema = z.object({
  session_id: z.string().min(1),
  observation_seq: z.number().int().nonnegative(),
  action_seq: z.number().int().nonnegative(),
  deployment_provenance: DeploymentProvenanceSchema,
  content_trust: z.literal('UNTRUSTED_TARGET_CONTENT'),
  url: HttpsUrlSchema,
  title: z.string().max(4096).optional(),
  screenshot: z.unknown().optional(),
  accessibility_snapshot: z.string().max(250_000).optional(),
  console_errors: z.array(z.unknown()).max(500).optional(),
  failed_requests: z.array(z.unknown()).max(500).optional(),
  captured_at: z.string().datetime({ offset: true }),
}).strict();
export type GameObservation = z.infer<typeof GameObservationSchema>;

export const SessionRecordSchema = z.object({
  session_id: z.string().min(1),
  sandbox_id: z.string().min(1),
  target_registration_id: z.string().min(1),
  target_origin: HttpsUrlSchema,
  owner_binding: z.string().min(16),
  created_at: z.string().datetime({ offset: true }),
  last_seen_at: z.string().datetime({ offset: true }),
  idle_expires_at: z.string().datetime({ offset: true }),
  absolute_expires_at: z.string().datetime({ offset: true }),
  action_seq: z.number().int().nonnegative(),
  observation_seq: z.number().int().nonnegative(),
  held_keys: z.array(AllowedKeySchema),
  held_pointer_buttons: z.array(PointerButtonSchema),
  lifecycle: z.enum(['ACTIVE', 'RECOVERY_REQUIRED', 'ENDING']),
}).strict();
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

export const SessionLimitsSchema = z.object({
  maxSessionLifetimeMs: z.number().int().positive(),
  maxIdleMs: z.number().int().positive(),
  maxActionsPerInput: z.number().int().positive(),
  maxActionsPerSession: z.number().int().positive(),
  maxSingleWaitMs: z.number().int().positive(),
  maxRelativePointerDelta: z.number().positive(),
}).strict();
export type SessionLimits = z.infer<typeof SessionLimitsSchema>;

export const RuntimeErrorCodeSchema = z.enum([
  'INVALID_ARGUMENT', 'AUTH_CONTEXT_UNAVAILABLE', 'SESSION_NOT_FOUND',
  'SESSION_EXPIRED', 'SESSION_RECOVERY_REQUIRED', 'TARGET_BLOCKED',
  'PROVENANCE_MISMATCH', 'STALE_DEPLOYMENT', 'CAPABILITY_UNAVAILABLE',
  'ACTION_REJECTED', 'ACTION_STATE_UNKNOWN', 'BROWSER_ERROR', 'LIMIT_EXCEEDED',
  'STORAGE_ERROR', 'INTERNAL_ERROR',
]);
export type RuntimeErrorCode = z.infer<typeof RuntimeErrorCodeSchema>;
