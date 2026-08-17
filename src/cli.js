// agent-loop CLI. Hand-rolled arg parsing; no dependencies.
import { detectCapabilities } from './capabilities.js';
import { scan } from './scan.js';
import { resolveEntry } from './lifecycle.js';
import { checkAuthority } from './authority.js';
import { readState, initState, transition, recordVerification, recordCritic } from './state.js';
import { validateHandoff, writeHandoff } from './handoff.js';

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args.flags[key] = true;
      else { args.flags[key] = next; i += 1; }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function out(obj, text) {
  if (text) process.stdout.write(`${text}\n`);
  else process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

const USAGE = `agent-loop — Universal Agent Loop reference engine

usage: agent-loop <command> [options]

commands:
  capabilities [--probe] [--harness '{"subagents":true}']
  scan [--root DIR] [--no-prs]
  plan --task-profile '{"scope":"trivial|substantial","clarity":"clear|ambiguous"}' [--root DIR]
  state get [--root DIR]
  state init --project P --task T [--authority READ,LOCAL_EDIT,...] [--root DIR]
  state transition <STATE> [--note "..."] [--control-plane-directive] [--root DIR]
  state record-verification --command "npm test" --result pass|fail [--root DIR]
  state record-critic --result pass|fail [--method code-review|subagent|fresh-prompt] [--root DIR]
  authority check <ACTION...> [--grants READ,PUSH,...] [--root DIR]
  handoff write [--slug name] [--root DIR]
  handoff validate <file>
`;

export async function main(argv = process.argv.slice(2)) {
  const { _: pos, flags } = parseArgs(argv);
  const [cmd, sub, ...rest] = pos;
  const root = flags.root || process.cwd();

  if (!cmd || cmd === 'help' || cmd === '--help') {
    out(null, USAGE);
    return cmd ? 0 : 2;
  }

  switch (cmd) {
    case 'capabilities': {
      const harness = flags.harness ? JSON.parse(flags.harness) : {};
      out(await detectCapabilities(root, { probe: !!flags.probe, harness }));
      return 0;
    }

    case 'scan': {
      out(scan(root, { includePrs: flags.prs !== false && !flags['no-prs'] }));
      return 0;
    }

    case 'plan': {
      if (!flags['task-profile']) {
        out(null, 'plan requires --task-profile \'{"scope":"...","clarity":"..."}\'');
        return 2;
      }
      const taskProfile = JSON.parse(flags['task-profile']);
      const evidence = scan(root);
      const entry = resolveEntry(
        { ...evidence.summary, prs: evidence.prs, state: evidence.state, git: evidence.git, fingerprint: evidence.fingerprint },
        taskProfile,
      );
      out({
        entry,
        taskProfile,
        reconciled: {
          maps: evidence.summary.maps.map(slim),
          specs: evidence.summary.specs.map(slim),
          tickets: evidence.summary.tickets.map(slim),
          prs: evidence.prs.map((p) => ({ number: p.number, title: p.title, checks: p.checks })),
          prsUnavailable: evidence.prsUnavailable,
        },
        git: evidence.git.isRepo
          ? { branch: evidence.git.branch, head: evidence.git.head, dirty: evidence.git.dirty, detached: evidence.git.detached }
          : { isRepo: false },
        state: evidence.state,
      });
      return 0;
    }

    case 'state': {
      if (sub === 'get') {
        const s = readState(root);
        if (!s) { out(null, 'no state file'); return 1; }
        out(s);
        return 0;
      }
      if (sub === 'init') {
        const authority = (flags.authority || '').split(',').map((s) => s.trim()).filter(Boolean);
        const r = initState(root, {
          project: flags.project || root.split('/').pop(),
          task: flags.task || '',
          authority,
        });
        out({ created: r.created, state: r.state });
        return 0;
      }
      if (sub === 'transition') {
        const to = rest[0];
        if (!to) { out(null, 'state transition requires a target state'); return 2; }
        const r = transition(root, to, flags.note || '', {
          controlPlaneDirective: !!flags['control-plane-directive'],
        });
        if (!r.ok) { out(null, r.error); return 1; }
        out(r.state);
        return 0;
      }
      if (sub === 'record-verification') {
        if (!flags.command || !flags.result) { out(null, 'requires --command and --result'); return 2; }
        const r = recordVerification(root, flags.command, flags.result);
        if (!r.ok) { out(null, r.error); return 1; }
        out({ ok: true });
        return 0;
      }
      if (sub === 'record-critic') {
        if (!flags.result) { out(null, 'requires --result pass|fail [--method code-review|subagent|fresh-prompt]'); return 2; }
        const r = recordCritic(root, { result: flags.result, method: flags.method });
        if (!r.ok) { out(null, r.error); return 1; }
        out({ ok: true, critic: r.critic });
        return 0;
      }
      out(null, USAGE);
      return 2;
    }

    case 'authority': {
      if (sub !== 'check' || rest.length === 0) {
        out(null, 'usage: agent-loop authority check <ACTION...> [--grants a,b,c]');
        return 2;
      }
      let grants = flags.grants ? flags.grants.split(',').map((s) => s.trim()) : null;
      if (!grants) {
        const s = readState(root);
        grants = (s && s.authority) || [];
      }
      const r = checkAuthority(rest, grants);
      out(r);
      return r.allGranted ? 0 : 1;
    }

    case 'handoff': {
      if (sub === 'write') {
        const file = writeHandoff(root, { slug: flags.slug });
        out({ file });
        return 0;
      }
      if (sub === 'validate') {
        const file = rest[0];
        if (!file) { out(null, 'handoff validate requires a file'); return 2; }
        const r = validateHandoff(file);
        out(r);
        return r.valid ? 0 : 1;
      }
      out(null, USAGE);
      return 2;
    }

    default:
      out(null, `unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

function slim(a) {
  return {
    path: a.path, type: a.type, status: a.status, class: a.class,
    classReason: a.classReason, unchecked: a.unchecked, unresolved: a.unresolved,
  };
}
