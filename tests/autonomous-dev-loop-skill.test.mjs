import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const skillPath = new URL('../skills/autonomous-dev-loop/SKILL.md', import.meta.url);

async function loadSkill() {
  return readFile(skillPath, 'utf8');
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'SKILL.md must start with YAML frontmatter');
  const fields = Object.fromEntries(
    match[1]
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(':');
        assert.notEqual(separator, -1, `invalid frontmatter line: ${line}`);
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^"|"$/g, '')];
      }),
  );
  return fields;
}

test('skill exists with discovery-oriented Agent Skills frontmatter', async () => {
  const markdown = await loadSkill();
  const fields = parseFrontmatter(markdown);

  assert.equal(fields.name, 'autonomous-dev-loop');
  assert.match(fields.description, /^Use when /);
  assert.ok(fields.description.length < 500, 'description should stay concise');
  assert.doesNotMatch(fields.description, /ORIENT|RECONCILE|VERIFY|step|workflow|→/i,
    'description must describe triggers, not summarize the workflow');
});

test('skill is explicit about being a ChatGPT companion rather than a full UAL adapter', async () => {
  const markdown = await loadSkill();

  assert.match(markdown, /companion skill/i);
  assert.match(markdown, /not (?:a )?full UAL adapter/i);
  assert.match(markdown, /protocol\/.*source of truth|canonical UAL/i);
});

test('skill automatically routes reusable engineering skills without user prompting', async () => {
  const markdown = await loadSkill();

  assert.match(markdown, /automatically (?:select|route|load|choose)/i);
  assert.match(markdown, /do not wait .*user.*(?:name|request|invoke).*skill/i);
  for (const skill of ['to-spec', 'wayfinder', 'to-tickets', 'tdd', 'implement', 'diagnosing-bugs', 'research', 'code-review', 'resolving-merge-conflicts']) {
    assert.match(markdown, new RegExp(`\\b${skill}\\b`, 'i'), `missing routing guidance for ${skill}`);
  }
  assert.match(markdown, /nested skills?.*(?:bounded|subtask)/i);
});

test('fresh ChatGPT sessions can load Matt skills without vendoring them', async () => {
  const markdown = await loadSkill();

  assert.match(markdown, /mattpocock\/skills/i);
  assert.match(markdown, /(?:native|installed).*skill/i);
  assert.match(markdown, /(?:fetch|read|load).*SKILL\.md/i);
  assert.match(markdown, /(?:do not|never).*(?:copy|vendor|cached).*skill/i);
});

test('nested skill inputs are resolved from repository evidence when possible', async () => {
  const markdown = await loadSkill();

  assert.match(markdown, /fixed point|merge-base/i);
  assert.match(markdown, /spec (?:path|source)|accepted spec/i);
  assert.match(markdown, /do not ask the user.*(?:already|available|discoverable).*(?:repo|repository)/i);
  assert.match(markdown, /harness-specific|harness assumptions/i);
});

test('ChatGPT remains the implementation plane unless delegation is explicitly requested', async () => {
  const markdown = await loadSkill();

  assert.match(markdown, /ChatGPT.*(?:builder|implementation plane)/i);
  assert.match(markdown, /(?:do not|must not).*delegat.*(?:Codex|OpenCode|Antigravity|separate coding agent)/i);
  assert.match(markdown, /explicitly asks|explicit request/i);
});

test('builder verifier and reviewer are distinct and failures re-enter repair', async () => {
  const markdown = await loadSkill();

  assert.match(markdown, /builder/i);
  assert.match(markdown, /verif(?:y|ier|ication)/i);
  assert.match(markdown, /review(?:er)?/i);
  assert.match(markdown, /REPAIR[\s\S]{0,500}VERIFY[\s\S]{0,500}REVIEW/i,
    'repair must return through verification and review');
  assert.match(markdown, /implementer.*(?:cannot|must not).*(?:waive|override|dismiss).*review/i);
  assert.match(markdown, /(?:subagent.*unavailable|no subagents)[^\n]*(?:fresh|separate).*review/i,
    'same-session fallback must still create a fresh reviewer pass');
});

test('completion requires fresh observed evidence rather than self-report', async () => {
  const markdown = await loadSkill();

  assert.match(markdown, /self[- ]report(?:ed)?[^\n]*(?:weak|not sufficient|never sufficient)/i);
  assert.match(markdown, /(?:commit SHA|repository state|final repository state)/i);
  assert.match(markdown, /(?:change|edit|new commit)[^\n]*(?:stale|invalidates)/i);
  assert.match(markdown, /runtime|deployed behavior/i);
  assert.match(markdown, /CI|deterministic tests/i);
});

test('skill degrades honestly when local execution capabilities are absent', async () => {
  const markdown = await loadSkill();

  assert.match(markdown, /no (?:local )?shell|shell.*unavailable|without.*shell/i);
  assert.match(markdown, /do not (?:claim|pretend|fabricate)/i);
  assert.match(markdown, /GitHub|repository read/i);
  assert.match(markdown, /CI visibility|CI/i);
  assert.match(markdown, /browser|runtime URL|deployment URL/i);
  assert.match(markdown, /BLOCKED|external blocker|missing required capability/i);
});

test('generic implementation authority never implies publication or high-impact authority', async () => {
  const markdown = await loadSkill();

  assert.match(markdown, /working branch|non-default branch/i);
  assert.match(markdown, /(?:do not|must not).*(?:open|create|update).*PR.*(?:explicit|authority|authorization)/i);
  assert.match(markdown, /(?:do not|must not).*merge.*(?:explicit|authority|authorization)/i);
  assert.match(markdown, /(?:do not|must not).*deploy.*(?:explicit|authority|authorization)/i);
  assert.match(markdown, /secret|credential/i);
  assert.match(markdown, /destructive|production mutation/i);
});

test('skill has explicit stop conditions and rollover distinction', async () => {
  const markdown = await loadSkill();

  assert.match(markdown, /PASS/i);
  assert.match(markdown, /genuine external blocker|external blocker/i);
  assert.match(markdown, /ROLLOVER_RECOMMENDED/);
  assert.match(markdown, /ROLLOVER_REQUIRED/);
  assert.match(markdown, /do not stop because.*(?:attempt|skill|commit|test|review)/i);
});
