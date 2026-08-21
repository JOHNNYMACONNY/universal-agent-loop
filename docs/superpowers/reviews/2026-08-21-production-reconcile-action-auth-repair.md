# Production Reconciler Action-Auth Repair

Date: 2026-08-21

## Incident

The first merged `production-runtime-reconcile` run successfully repaired the browser Production configuration, deployed exact `main` commit `c073f37e52ab18128edee77265cfe788667cd027`, returned stable `/healthz` 200, registered the exact deployment, and advanced through provider-backed remote gameplay acceptance. It then reached the Action bridge smoke and `POST /game-browser/session-start` returned HTTP 401.

Because the bridge smoke is sequenced after `npm run test:remote`, reaching the smoke proves the provider-backed gameplay gate completed successfully. The failure is isolated to the reconciler's attempt to recover the protected Production `UAL_ACTION_API_KEY` from Vercel's project-environment listing and copy it into GitHub workflow state.

## Repair

Keep `UAL_ACTION_API_KEY` read-only and stop recovering/copying its value through the REST listing. Use Vercel CLI's documented `vercel env run --environment production -- ...` mechanism, scoped to the Action project, to execute the bounded bridge smoke with the actual Production environment injected only into that subprocess.

This preserves the existing Action authentication boundary, adds no secondary bearer, and avoids persisting the protected Action key into `$GITHUB_ENV`.

## Acceptance

- root contract tests require bridge smoke to use `vercel env run` and forbid `PRODUCTION_ACTION_KEY` workflow-state export;
- existing protected Action credentials remain read-only;
- exact-head CI must pass;
- fresh Standards and Spec reviews must pass before merge;
- post-merge reconciliation must complete the Action `session-start -> observe -> session-end` smoke against exact current `main`.
