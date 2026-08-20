import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { PrincipalResolver } from '../auth/principal.js';
import type { RateLimiter } from '../auth/rate-limit.js';
import type { BrowserAdapter, BrowserObservation, BrowserSessionRef } from '../browser/browser-adapter.js';
import {
  GameInputSchema,
  GameObservationSchema,
  type DeploymentProvenance,
  type GameObservation,
  type SessionLimits,
  type SessionRecord,
  type TargetRegistration,
} from '../contracts.js';
import { RuntimeError } from '../errors.js';
import type { RegistrationStore } from '../provenance/registration-store.js';
import type { DeploymentVerifier } from '../provenance/types.js';
import type { SessionStore } from '../sessions/session-store.js';
import type { DnsResolver } from '../security/url-policy.js';
import { validateRegisteredUrl } from '../security/url-policy.js';
import { UNTRUSTED_TARGET_CONTENT } from '../security/trust-boundary.js';

const StartSchema = z.object({ target_registration_id: z.string().min(1), expected_commit_sha: z.string().regex(/^[0-9a-f]{40}$/i), viewport: z.object({ width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096) }).strict().optional() }).strict();
const SessionSchema = z.object({ session_id: z.string().min(1) }).strict();
const ObserveSchema = z.object({ session_id: z.string().min(1), expected_observation_seq: z.number().int().nonnegative().optional() }).strict();
const ReadSchema = SessionSchema.extend({ path: z.string().max(512).regex(/^(?:\/(?:[^~\/]|~[01])*)*$/).optional() }).strict();
const ResetSchema = z.object({ session_id: z.string().min(1), mode: z.enum(['reload', 'target']).optional() }).strict();

export interface GameToolDependencies {
  registrations: RegistrationStore;
  sessions: SessionStore;
  browser: BrowserAdapter;
  verifier: DeploymentVerifier;
  principals: PrincipalResolver;
  resolveDns: DnsResolver;
  limits: SessionLimits;
  rateLimiter?: RateLimiter;
  rateLimits?: { sessionStarts: number; actionCalls: number; windowMs: number };
  now?: () => Date;
  sessionIdFactory?: () => string;
}

function provenance(registration: TargetRegistration): DeploymentProvenance {
  return {
    target_registration_id: registration.target_registration_id,
    repository: registration.repository,
    expected_commit_sha: registration.expected_commit_sha,
    deployed_commit_sha: registration.expected_commit_sha,
    deployment_id: registration.deployment_id,
    deployment_url: registration.deployment_url,
  };
}

function mapObservation(session: SessionRecord, registration: TargetRegistration, raw: BrowserObservation, observationSeq: number, capturedAt: string): GameObservation {
  return GameObservationSchema.parse({
    session_id: session.session_id,
    observation_seq: observationSeq,
    action_seq: session.action_seq,
    deployment_provenance: provenance(registration),
    content_trust: UNTRUSTED_TARGET_CONTENT,
    url: raw.url,
    ...(raw.title !== undefined ? { title: raw.title } : {}),
    ...(raw.screenshot !== undefined ? { screenshot: raw.screenshot } : {}),
    ...(raw.accessibilitySnapshot !== undefined ? { accessibility_snapshot: raw.accessibilitySnapshot } : {}),
    ...(raw.consoleErrors !== undefined ? { console_errors: raw.consoleErrors } : {}),
    ...(raw.failedRequests !== undefined ? { failed_requests: raw.failedRequests } : {}),
    captured_at: capturedAt,
  });
}

export function createGameToolServices(deps: GameToolDependencies) {
  const now = deps.now ?? (() => new Date());
  const sessionIdFactory = deps.sessionIdFactory ?? (() => `session_${randomUUID()}`);
  const rateLimits = deps.rateLimits ?? { sessionStarts: 6, actionCalls: 120, windowMs: 60_000 };

  async function principalBinding(): Promise<string> {
    const principal = await deps.principals.resolve();
    if (!principal.binding || principal.binding.length < 16) throw new RuntimeError('AUTH_CONTEXT_UNAVAILABLE', 'stable principal binding unavailable');
    return principal.binding;
  }

  async function enforceRate(key: string, limit: number): Promise<void> {
    if (!deps.rateLimiter) return;
    const result = await deps.rateLimiter.consume({ key, limit, windowMs: rateLimits.windowMs });
    if (!result.allowed) throw new RuntimeError('LIMIT_EXCEEDED', 'rate limit exceeded', { retryAfterMs: result.retryAfterMs });
  }

  async function registration(id: string): Promise<TargetRegistration> {
    const value = await deps.registrations.get(id);
    if (!value) throw new RuntimeError('PROVENANCE_MISMATCH', 'target registration not found');
    if (new Date(value.expires_at).getTime() <= now().getTime()) throw new RuntimeError('STALE_DEPLOYMENT', 'target registration expired');
    return value;
  }

  async function ownedRecord(id: string): Promise<{ session: SessionRecord; ref: BrowserSessionRef }> {
    const binding = await principalBinding();
    const session = await deps.sessions.get(id);
    if (!session) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
    if (session.owner_binding !== binding) throw new RuntimeError('AUTH_CONTEXT_UNAVAILABLE', 'session ownership mismatch');
    return { session, ref: { logicalSessionId: session.session_id, sandboxId: session.sandbox_id } };
  }

  async function cleanup(record: SessionRecord, ref: BrowserSessionRef): Promise<void> {
    try { await deps.sessions.end(record.session_id); } catch {}
    try { await deps.browser.releaseHeldInput(ref); } catch {}
    try { await deps.sessions.updateHeldInput(record.session_id, [], []); } catch {}
    try { await deps.browser.end(ref); } catch {}
  }

  async function usableSession(id: string, allowRecovery = false): Promise<{ session: SessionRecord; registration: TargetRegistration; ref: BrowserSessionRef }> {
    const owned = await ownedRecord(id);
    const time = now();
    const expired = new Date(owned.session.absolute_expires_at).getTime() <= time.getTime()
      || new Date(owned.session.idle_expires_at).getTime() <= time.getTime();
    if (expired) {
      await cleanup(owned.session, owned.ref);
      throw new RuntimeError('SESSION_EXPIRED', 'session idle/absolute lifetime expired');
    }
    if (owned.session.lifecycle === 'ENDING') throw new RuntimeError('SESSION_RECOVERY_REQUIRED', 'session is ending');
    if (owned.session.lifecycle === 'RECOVERY_REQUIRED' && !allowRecovery) throw new RuntimeError('SESSION_RECOVERY_REQUIRED', 'session requires deliberate reset or end');
    const reg = await registration(owned.session.target_registration_id);
    const touched = await deps.sessions.touch(id, time, deps.limits.maxIdleMs);
    return { session: touched, registration: reg, ref: owned.ref };
  }

  async function validateObservedUrl(url: string, registration: TargetRegistration): Promise<void> {
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { throw new RuntimeError('TARGET_BLOCKED', 'browser reported an invalid URL'); }
    await validateRegisteredUrl(parsed, registration, deps.resolveDns);
  }

  async function requireLive(ref: BrowserSessionRef, sessionId: string): Promise<void> {
    const health = await deps.browser.health(ref);
    if (!health.alive) {
      try { await deps.sessions.markRecoveryRequired(sessionId, 'browser process lost'); } catch {}
      throw new RuntimeError('SESSION_EXPIRED', health.detail ?? 'browser process lost');
    }
  }

  async function sessionStart(rawInput: unknown) {
    const input = StartSchema.parse(rawInput);
    const binding = await principalBinding();
    const reg = await registration(input.target_registration_id);
    await enforceRate(`${binding}:${reg.project_id}:session-start`, rateLimits.sessionStarts);
    if (reg.expected_commit_sha !== input.expected_commit_sha) throw new RuntimeError('PROVENANCE_MISMATCH', 'expected commit does not match registration');
    const verified = await deps.verifier.verify({ deploymentId: reg.deployment_id, expectedCommitSha: input.expected_commit_sha, repository: reg.repository, projectId: reg.project_id });
    if (verified.deploymentId !== reg.deployment_id || new URL(verified.deploymentUrl).origin !== reg.deployment_origin || verified.commitSha !== reg.expected_commit_sha) throw new RuntimeError('PROVENANCE_MISMATCH', 'provider deployment no longer matches registration');
    await validateRegisteredUrl(new URL(reg.deployment_url), reg, deps.resolveDns);

    const sessionId = sessionIdFactory();
    const startedAt = now();
    const started = await deps.browser.start({ logicalSessionId: sessionId, targetUrl: reg.deployment_url, allowedHosts: reg.allowed_hosts, ...(input.viewport ? { viewport: input.viewport } : {}) });
    try { await validateObservedUrl(started.observation.url, reg); }
    catch (error) { try { await deps.browser.end(started.session); } catch {} throw error; }
    const absoluteExpiry = new Date(Math.min(startedAt.getTime() + deps.limits.maxSessionLifetimeMs, new Date(reg.expires_at).getTime()));
    const idleExpiry = new Date(Math.min(startedAt.getTime() + deps.limits.maxIdleMs, absoluteExpiry.getTime()));
    const record: SessionRecord = {
      session_id: sessionId,
      sandbox_id: started.session.sandboxId,
      target_registration_id: reg.target_registration_id,
      target_origin: reg.deployment_origin,
      owner_binding: binding,
      created_at: startedAt.toISOString(),
      last_seen_at: startedAt.toISOString(),
      idle_expires_at: idleExpiry.toISOString(),
      absolute_expires_at: absoluteExpiry.toISOString(),
      action_seq: 0,
      observation_seq: 1,
      total_action_count: 0,
      held_keys: started.observation.heldKeys as SessionRecord['held_keys'],
      held_pointer_buttons: started.observation.heldPointerButtons as SessionRecord['held_pointer_buttons'],
      lifecycle: 'ACTIVE',
    };
    try { await deps.sessions.create(record); } catch (error) { try { await deps.browser.end(started.session); } catch {} throw error; }
    return {
      session_id: sessionId,
      target_origin: reg.deployment_origin,
      deployment_provenance: provenance(reg),
      observation: mapObservation(record, reg, started.observation, 1, startedAt.toISOString()),
      limits: deps.limits,
    };
  }

  async function observe(rawInput: unknown) {
    const input = ObserveSchema.parse(rawInput);
    const owned = await usableSession(input.session_id);
    if (input.expected_observation_seq !== undefined && input.expected_observation_seq !== owned.session.observation_seq) throw new RuntimeError('ACTION_REJECTED', 'observation sequence mismatch');
    await requireLive(owned.ref, owned.session.session_id);
    const raw = await deps.browser.observe(owned.ref);
    try { await validateObservedUrl(raw.url, owned.registration); }
    catch (error) { await cleanup(owned.session, owned.ref); throw error; }
    await deps.sessions.updateHeldInput(owned.session.session_id, raw.heldKeys, raw.heldPointerButtons);
    const seq = await deps.sessions.nextObservation(owned.session.session_id);
    const refreshed = (await deps.sessions.get(owned.session.session_id)) ?? owned.session;
    return mapObservation(refreshed, owned.registration, raw, seq, now().toISOString());
  }

  async function input(rawInput: unknown) {
    const parsed = GameInputSchema.parse(rawInput);
    if (parsed.actions.length > deps.limits.maxActionsPerInput) throw new RuntimeError('LIMIT_EXCEEDED', 'too many actions in batch');
    for (const action of parsed.actions) {
      if (action.type === 'wait' && action.duration_ms > deps.limits.maxSingleWaitMs) throw new RuntimeError('LIMIT_EXCEEDED', 'wait exceeds limit');
      if (action.type === 'press' && action.duration_ms !== undefined && action.duration_ms > deps.limits.maxSingleWaitMs) throw new RuntimeError('LIMIT_EXCEEDED', 'press duration exceeds limit');
      if (action.type === 'pointer_move_relative' && (Math.abs(action.delta_x) > deps.limits.maxRelativePointerDelta || Math.abs(action.delta_y) > deps.limits.maxRelativePointerDelta)) throw new RuntimeError('LIMIT_EXCEEDED', 'relative pointer delta exceeds limit');
    }
    const owned = await usableSession(parsed.session_id);
    await enforceRate(`${owned.session.owner_binding}:${owned.registration.project_id}:action`, rateLimits.actionCalls);
    await requireLive(owned.ref, owned.session.session_id);
    const begun = await deps.sessions.beginBatch({
      sessionId: parsed.session_id,
      batchId: parsed.action_batch_id,
      expectedActionSeq: parsed.expected_action_seq,
      actionCount: parsed.actions.length,
      maxActionsPerSession: deps.limits.maxActionsPerSession,
    });
    if (begun.kind === 'DUPLICATE') return { ...begun.result, duplicate: true };

    let browserResult;
    try {
      browserResult = await deps.browser.input(owned.ref, { actionBatchId: parsed.action_batch_id, actions: parsed.actions });
    } catch (error) {
      await deps.sessions.markRecoveryRequired(parsed.session_id, 'browser input threw before completion could be proven');
      try { await deps.browser.releaseHeldInput(owned.ref); } catch {}
      throw new RuntimeError('SESSION_RECOVERY_REQUIRED', error instanceof Error ? error.message : 'browser input failure');
    }
    await deps.sessions.updateHeldInput(parsed.session_id, browserResult.heldKeys, browserResult.heldPointerButtons);
    if (browserResult.status !== 'COMPLETE') {
      await deps.sessions.markRecoveryRequired(parsed.session_id, 'browser action state unknown');
      try { await deps.browser.releaseHeldInput(owned.ref); await deps.sessions.updateHeldInput(parsed.session_id, [], []); } catch {}
      throw new RuntimeError('SESSION_RECOVERY_REQUIRED', 'browser action state unknown');
    }

    const result: Record<string, unknown> = {
      session_id: parsed.session_id,
      action_batch_id: parsed.action_batch_id,
      action_seq_before: begun.actionSeq,
      action_seq_after: begun.actionSeq + 1,
      observation_seq: owned.session.observation_seq,
      duplicate: false,
      execution_status: 'COMPLETE',
      ...(browserResult.summary ? { post_action_summary: browserResult.summary } : {}),
    };
    try { await deps.sessions.completeBatch({ sessionId: parsed.session_id, batchId: parsed.action_batch_id, result }); }
    catch (error) {
      await deps.sessions.markRecoveryRequired(parsed.session_id, 'browser completed but durable completion write failed');
      try { await deps.browser.releaseHeldInput(owned.ref); await deps.sessions.updateHeldInput(parsed.session_id, [], []); } catch {}
      throw new RuntimeError('SESSION_RECOVERY_REQUIRED', error instanceof Error ? error.message : 'durable completion failed');
    }
    return result;
  }

  async function readState(rawInput: unknown) {
    const input = ReadSchema.parse(rawInput);
    const owned = await usableSession(input.session_id);
    await requireLive(owned.ref, owned.session.session_id);
    const value = await deps.browser.readState(owned.ref, input.path);
    return { session_id: input.session_id, deployment_provenance: provenance(owned.registration), content_trust: UNTRUSTED_TARGET_CONTENT, value };
  }

  async function reset(rawInput: unknown) {
    const input = ResetSchema.parse(rawInput);
    const owned = await usableSession(input.session_id, true);
    await requireLive(owned.ref, owned.session.session_id);
    try { await deps.browser.releaseHeldInput(owned.ref); } catch {}
    const raw = await deps.browser.reset(owned.ref);
    try { await validateObservedUrl(raw.url, owned.registration); }
    catch (error) { await cleanup(owned.session, owned.ref); throw error; }
    await deps.sessions.resetRecovery(input.session_id);
    await deps.sessions.updateHeldInput(input.session_id, raw.heldKeys, raw.heldPointerButtons);
    const touched = await deps.sessions.touch(input.session_id, now(), deps.limits.maxIdleMs);
    const seq = await deps.sessions.nextObservation(input.session_id);
    const refreshed = (await deps.sessions.get(input.session_id)) ?? touched;
    return mapObservation(refreshed, owned.registration, raw, seq, now().toISOString());
  }

  async function sessionEnd(rawInput: unknown) {
    const input = SessionSchema.parse(rawInput);
    const owned = await ownedRecord(input.session_id);
    if (owned.session.lifecycle === 'ENDING') return { session_id: input.session_id, ended: true };
    await deps.sessions.end(input.session_id);
    try { await deps.browser.releaseHeldInput(owned.ref); } catch {}
    try { await deps.sessions.updateHeldInput(input.session_id, [], []); } catch {}
    try { await deps.browser.end(owned.ref); } catch {}
    return { session_id: input.session_id, ended: true };
  }

  async function debugSession(sessionId: string) {
    const value = await deps.sessions.get(sessionId);
    if (!value) throw new RuntimeError('SESSION_NOT_FOUND', 'session not found');
    return value;
  }

  return { sessionStart, observe, input, readState, reset, sessionEnd, debugSession };
}
