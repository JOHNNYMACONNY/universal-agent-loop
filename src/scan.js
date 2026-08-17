// DISCOVER + RECONCILE orchestration: repository evidence report.
import { gitFacts, ghOpenPrs, implementationFingerprint } from './git.js';
import { discoverArtifacts, classifyArtifacts, attachRoots } from './artifacts.js';

export function scan(root, { includePrs = true } = {}) {
  const git = gitFacts(root);
  const fingerprint = git.isRepo ? implementationFingerprint(root) : null;
  const { artifacts, state } = discoverArtifacts(root);
  attachRoots(artifacts, root);
  const prs = includePrs && git.isRepo ? ghOpenPrs(root) : null;
  classifyArtifacts(artifacts, git, state);

  const byType = (t) => artifacts.filter((a) => a.type === t);
  return {
    root,
    at: new Date().toISOString(),
    git,
    fingerprint,
    prs: prs || [],
    prsUnavailable: prs === null,
    artifacts,
    state,
    summary: {
      instructions: byType('instructions'),
      maps: byType('wayfinder_map'),
      specs: byType('spec'),
      tickets: byType('ticket'),
      plans: byType('plan'),
      handoffs: byType('handoff'),
    },
  };
}
