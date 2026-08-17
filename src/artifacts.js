// Artifact discovery and reconciliation classification (artifacts.md K1-K6).
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, countCheckboxes } from './frontmatter.js';

const IGNORE_DIRS = new Set(['node_modules', '.git', '.agent-loop', 'dist', 'build']);
const SCAN_DIRS = ['', 'docs', 'specs', 'design', 'tickets', 'tasks', 'plans', 'wayfinder', '.agent-loop/handoffs'];
const MAX_FILES = 200;

// Heuristics match path SEGMENTS, not substrings, to avoid false
// positives like ROADMAP.md matching "map". Frontmatter ual_type wins.
const TYPE_PATTERNS = [
  [/wayfinder/i, 'wayfinder_map'],
  [/(^|[\/_-])map\.md$/i, 'wayfinder_map'],
  [/(^|[\/_-])spec(s)?([\/_.-]|$)/i, 'spec'],
  [/(^|[\/_-])(ticket|tickets|task|tasks)([\/_.-]|$)/i, 'ticket'],
  [/(^|[\/_-])(plan|plans|design)([\/_.-]|$)/i, 'plan'],
  [/handoff/i, 'handoff'],
];

export function discoverArtifacts(root) {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    walk(abs, 2, files);
    if (files.length >= MAX_FILES) break;
  }
  const artifacts = [];
  const seen = new Set();
  for (const file of files.slice(0, MAX_FILES)) {
    const rel = path.relative(root, file);
    if (seen.has(rel)) continue;
    seen.add(rel);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const { data: fm, body } = parseFrontmatter(text);
    const base = path.basename(file);
    if (['AGENTS.md', 'CLAUDE.md'].includes(base)) {
      artifacts.push(mk({ type: 'instructions', path: rel, fm, body }));
      continue;
    }
    const type = fm.ual_type || heuristicType(rel, fm);
    if (!type) continue;
    artifacts.push(mk({ type, path: rel, fm, body }));
  }
  const state = readStateFile(root);
  return { artifacts, state };
}

function walk(dir, depth, out) {
  if (depth < 0 || out.length >= MAX_FILES) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    if (e.name.startsWith('.') && e.name !== '.agent-loop') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) walk(full, depth - 1, out);
    } else if (/\.(md|markdown|txt)$/i.test(e.name)) {
      out.push(full);
    }
  }
}

function heuristicType(rel, fm) {
  if (fm.type && ['spec', 'ticket', 'plan', 'wayfinder_map', 'handoff'].includes(fm.type)) return fm.type;
  for (const [re, type] of TYPE_PATTERNS) {
    if (re.test(rel)) return type;
  }
  return null;
}

function mk({ type, path: rel, fm, body }) {
  const { checked, unchecked } = countCheckboxes(body);
  return {
    id: fm.id || rel,
    type,
    path: rel,
    status: (fm.status || 'current').toString(),
    topic: fm.topic || null,
    supersedes: asList(fm.supersedes),
    unresolved: asList(fm.unresolved),
    refFiles: asList(fm.files || (fm.refs && fm.refs.files)),
    recordedHead: fm.head || null,
    recordedBranch: fm.branch || null,
    verification: asList(fm.verification),
    checked,
    unchecked,
    class: null, // filled by classifyArtifacts
    classReason: null,
  };
}

function asList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

function readStateFile(root) {
  const p = path.join(root, '.agent-loop', 'state.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// K1-K6, ordered; first match wins. See protocol/artifacts.md section 4.
export function classifyArtifacts(artifacts, git, state) {
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const supersededIds = new Set();
  for (const a of artifacts) {
    for (const target of a.supersedes) supersededIds.add(target);
  }
  for (const a of artifacts) {
    // K1 superseded
    if (a.status === 'superseded' || supersededIds.has(a.id) || supersededIds.has(a.path)) {
      set(a, 'SUPERSEDED', 'K1: explicit supersedure');
      continue;
    }
    // K2 conflicting: same type+topic, both claim current authority, no supersedure
    const rivals = artifacts.filter(
      (b) => b !== a && b.type === a.type && b.topic && b.topic === a.topic
        && claimsAuthority(b) && claimsAuthority(a)
        && !b.supersedes.includes(a.id) && !a.supersedes.includes(b.id),
    );
    if (rivals.length && claimsAuthority(a)) {
      set(a, 'CONFLICTING', `K2: conflicts with ${rivals.map((r) => r.path).join(', ')}`);
      continue;
    }
    // K3 stale: recorded git facts mismatch, or referenced files missing
    if (git && git.isRepo) {
      if (a.recordedHead && git.head && a.recordedHead !== git.head) {
        set(a, 'STALE', `K3: recorded head ${a.recordedHead} != ${git.head}`);
        continue;
      }
      if (a.recordedBranch && git.branch && a.recordedBranch !== git.branch) {
        set(a, 'STALE', `K3: recorded branch ${a.recordedBranch} != ${git.branch}`);
        continue;
      }
    }
    const missing = a.refFiles.filter((f) => !fs.existsSync(path.join(a.__root || '', f)));
    if (a.refFiles.length && missing.length === a.refFiles.length) {
      set(a, 'STALE', `K3: referenced files missing: ${missing.join(', ')}`);
      continue;
    }
    // K4 partial
    if (['in-progress', 'draft', 'active', 'open-partial'].includes(a.status) || a.unchecked > 0) {
      set(a, 'PARTIAL', `K4: status=${a.status}, unchecked=${a.unchecked}`);
      continue;
    }
    // K5 unverified: claims done/verified without evidence
    if (['done', 'complete', 'completed', 'verified'].includes(a.status)) {
      const stateEvidence = state && Array.isArray(state.verification) && state.verification.length > 0;
      if (!a.verification.length && !stateEvidence) {
        set(a, 'UNVERIFIED', 'K5: completion claimed without recorded evidence');
        continue;
      }
    }
    // K6
    set(a, 'CURRENT', 'K6: consistent');
  }
  return artifacts;
}

function claimsAuthority(a) {
  return ['accepted', 'current'].includes(a.status);
}

function set(a, cls, reason) {
  a.class = cls;
  a.classReason = reason;
}

export function attachRoots(artifacts, root) {
  for (const a of artifacts) a.__root = root;
  return artifacts;
}
