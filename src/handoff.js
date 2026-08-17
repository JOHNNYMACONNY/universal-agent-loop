// Handoff scaffold + validation (handoff.md).
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { readState } from './state.js';
import { gitFacts } from './git.js';

const REQUIRED_FIELDS = [
  'ual_handoff', 'project', 'task', 'lifecycle_state', 'destination',
  'artifacts', 'completed_work', 'remaining_work', 'branch', 'worktree',
  'commits', 'verification', 'known_failures', 'authority',
  'next_valid_action', 'created_at',
];

export function validateHandoff(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { valid: false, diagnostics: [`cannot read ${file}`] };
  }
  const { data } = parseFrontmatter(text);
  const diagnostics = [];
  for (const field of REQUIRED_FIELDS) {
    const v = data[field];
    const empty = v == null || v === '' || (Array.isArray(v) && field !== 'commits' && false);
    if (v == null || v === '') diagnostics.push(`missing or empty: ${field}`);
    else void empty;
  }
  if (data.ual_handoff !== 1) diagnostics.push('ual_handoff must be 1');
  if (data.authority && typeof data.authority === 'object') {
    if (!Array.isArray(data.authority.granted)) diagnostics.push('authority.granted must be a list');
    if (!Array.isArray(data.authority.withheld)) diagnostics.push('authority.withheld must be a list');
  } else {
    diagnostics.push('authority must contain granted/withheld lists');
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

export function scaffoldHandoff(root, overrides = {}) {
  const state = readState(root) || {};
  const git = gitFacts(root);
  const fm = {
    ual_handoff: 1,
    project: state.project || path.basename(root),
    task: state.task || '',
    lifecycle_state: state.lifecycle_state || 'DISCOVER',
    destination: overrides.destination || '',
    artifacts: {
      current_spec: (state.artifacts && state.artifacts.current_spec) || null,
      current_ticket: (state.artifacts && state.artifacts.current_ticket) || null,
      current_pr: (state.artifacts && state.artifacts.current_pr) || null,
      wayfinder_map: (state.artifacts && state.artifacts.wayfinder_map) || null,
    },
    completed_work: overrides.completed_work || [],
    remaining_work: overrides.remaining_work || [],
    branch: git.isRepo ? git.branch : null,
    worktree: root,
    commits: git.isRepo ? git.recentCommits.slice(0, 5).map((c) => c.sha) : [],
    verification: state.verification || [],
    known_failures: overrides.known_failures || [],
    authority: {
      granted: state.authority || [],
      withheld: overrides.withheld || [],
    },
    next_valid_action: overrides.next_valid_action || '',
    created_at: new Date().toISOString(),
  };
  const yaml = toYaml(fm);
  return `---\n${yaml}---\n\n## Context not derivable from artifacts\n\n(none)\n`;
}

export function writeHandoff(root, overrides = {}) {
  const dir = path.join(root, '.agent-loop', 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const slug = (overrides.slug || 'rollover').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const file = path.join(dir, `${stamp}-${slug}.md`);
  fs.writeFileSync(file, scaffoldHandoff(root, overrides));
  return file;
}

function toYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      if (v.every((item) => typeof item !== 'object' || item === null)) {
        // inline list: stays within the parser subset at any nesting level
        out += `${pad}${k}: [${v.map(yamlScalar).join(', ')}]\n`;
        continue;
      }
      out += `${pad}${k}:\n`;
      for (const item of v) out += `${pad}  - ${JSON.stringify(item)}\n`;
    } else if (typeof v === 'object' && v !== null) {
      out += `${pad}${k}:\n${toYaml(v, indent + 1)}`;
    } else {
      out += `${pad}${k}: ${yamlScalar(v)}\n`;
    }
  }
  return out;
}

function yamlScalar(v) {
  if (v == null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (/[:#\[\]{}\n]|^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
}
