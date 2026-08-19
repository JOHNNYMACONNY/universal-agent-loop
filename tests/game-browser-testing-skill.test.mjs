import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gameSkillPath = new URL('../skills/game-browser-testing/SKILL.md', import.meta.url);
const autonomousSkillPath = new URL('../skills/autonomous-dev-loop/SKILL.md', import.meta.url);

async function load(path) {
  return readFile(path, 'utf8');
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'SKILL.md must start with YAML frontmatter');
  return Object.fromEntries(
    match[1]
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(':');
        assert.notEqual(separator, -1, `invalid frontmatter line: ${line}`);
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^"|"$/g, '')];
      }),
  );
}

test('game browser testing skill has discovery-oriented frontmatter and bounded role', async () => {
  const markdown = await load(gameSkillPath);
  const fields = parseFrontmatter(markdown);

  assert.equal(fields.name, 'game-browser-testing');
  assert.match(fields.description, /^Use when /);
  assert.ok(fields.description.length < 500, 'description should stay concise');
  assert.doesNotMatch(fields.description, /SENSE|ACT|VERIFY|step|workflow|→/i,
    'description must describe triggers rather than summarize the workflow');
  assert.match(markdown, /bounded|one browser-testing session|one testing session/i);
  assert.match(markdown, /(?:cannot|must not|never).*outer.*(?:complete|lifecycle)|does not.*outer.*complete/i);
});

test('autonomous exploratory QA is the default while scenarios remain supported', async () => {
  const markdown = await load(gameSkillPath);

  assert.match(markdown, /autonomous.*(?:default|primary)|default.*autonomous/i);
  assert.match(markdown, /infer.*controls|discover.*controls/i);
  assert.match(markdown, /generate.*(?:test )?goals|choose.*high-value.*goals/i);
  assert.match(markdown, /scenario/i);
  assert.match(markdown, /strict scenario[- ]only|scenario[- ]only/i);
  assert.match(markdown, /(?:avoid|do not).*random|low-yield|information.*input volume/i);
});

test('skill requires sense act verify with independent evidence', async () => {
  const markdown = await load(gameSkillPath);

  assert.match(markdown, /SENSE[\s\S]{0,300}ACT[\s\S]{0,300}VERIFY/i);
  assert.match(markdown, /(?:input|action).*success[^\n]*(?:not|isn't|is not).*verif|successful.*(?:input|tool).*not.*verif/i);
  assert.match(markdown, /screenshot|visual frame|visual state/i);
  assert.match(markdown, /keyboard/i);
  assert.match(markdown, /mouse|pointer/i);
  assert.match(markdown, /console|runtime error/i);
  assert.match(markdown, /network|failed request/i);
});

test('canvas and WebGL guidance does not confuse DOM with game-world state', async () => {
  const markdown = await load(gameSkillPath);

  assert.match(markdown, /canvas/i);
  assert.match(markdown, /WebGL/i);
  assert.match(markdown, /(?:must not|do not|never).*DOM.*(?:game-world|game world|state)|DOM.*(?:not|isn't).*game-world/i);
  assert.match(markdown, /vision|screenshot/i);
});

test('optional game instrumentation strengthens but does not replace black-box verification', async () => {
  const markdown = await load(gameSkillPath);

  assert.match(markdown, /window\.__GAME_TEST__/);
  assert.match(markdown, /optional|if present/i);
  assert.match(markdown, /read-only|read oriented|non-destructive/i);
  assert.match(markdown, /(?:must not|does not|cannot).*replace.*(?:visual|black-box)|(?:visual|black-box).*remain.*primary/i);
  assert.match(markdown, /destructive.*explicit.*authority|explicit.*authority.*destructive/i);
});

test('findings expose materiality separately from severity', async () => {
  const markdown = await load(gameSkillPath);

  for (const field of ['severity', 'material', 'reproduction', 'expected', 'observed', 'evidence', 'confidence']) {
    assert.match(markdown, new RegExp(`\\b${field}\\b`, 'i'), `missing finding field: ${field}`);
  }
  assert.match(markdown, /blocker.*high.*medium.*low|blocker \| high \| medium \| low/i);
  assert.match(markdown, /confirmed.*likely.*uncertain|confirmed \| likely \| uncertain/i);
  assert.match(markdown, /material[^\n]*(?:acceptance|correctness|progression|stability|performance|security|privacy|user-visible)/i);
  assert.match(markdown, /(?:cosmetic|preference)[^\n]*(?:not material|non-material)|(?:not material|non-material)[^\n]*(?:cosmetic|preference)/i);
  assert.match(markdown, /(?:reproduce|reproduction).*suspected|suspected.*reproduce/i);
  assert.match(markdown, /speculative|uncertain/i);
});

test('session result has deterministic PASS FINDINGS and capability-blocked outcomes', async () => {
  const markdown = await load(gameSkillPath);

  assert.match(markdown, /status/i);
  assert.match(markdown, /PASS.*FINDINGS.*BLOCKED_CAPABILITY|PASS \| FINDINGS \| BLOCKED_CAPABILITY/i);
  assert.match(markdown, /(?:PASS|pass)[^\n]*(?:no|zero)[^\n]*(?:material finding|material: true)|(?:no|zero)[^\n]*(?:material finding|material: true)[^\n]*(?:PASS|pass)/i);
  assert.match(markdown, /FINDINGS[^\n]*(?:material finding|material: true)|(?:material finding|material: true)[^\n]*FINDINGS/i);
  assert.match(markdown, /BLOCKED_CAPABILITY[^\n]*(?:missing|required|capability)|(?:missing|required).*capability[^\n]*BLOCKED_CAPABILITY/i);
  assert.match(markdown, /limitations|coverage limitation|evidence limitation/i);
  assert.match(markdown, /(?:PASS|session).*(?:evidence for|returns.*caller)|evidence.*caller/i);
  assert.match(markdown, /(?:not|never).*outer.*completion|not.*lifecycle completion/i);
});

test('v1 scope and authority stay constrained to public deployed game testing', async () => {
  const markdown = await load(gameSkillPath);

  assert.match(markdown, /public\/deployed|public.*deployed/i);
  assert.match(markdown, /localhost|private LAN|local build/i);
  assert.match(markdown, /credential/i);
  assert.match(markdown, /billing|purchase/i);
  assert.match(markdown, /destructive/i);
  assert.match(markdown, /(?:must not|do not|never).*(?:merge|deploy|publish)/i);
  assert.match(markdown, /unrelated.*(?:site|third-party)|third-party.*unrelated/i);
});

test('skill discovers actual browser capabilities and degrades honestly', async () => {
  const markdown = await load(gameSkillPath);

  assert.match(markdown, /discover|available capabilities|capability/i);
  assert.match(markdown, /navigate|open.*URL/i);
  assert.match(markdown, /JavaScript|JS evaluation/i);
  assert.match(markdown, /reset|reload|close/i);
  assert.match(markdown, /(?:do not|never).*invent|missing capability|capability blocker|BLOCKED_CAPABILITY/i);
});

test('autonomous dev loop loads repo-owned game skill and handles its statuses deterministically', async () => {
  const markdown = await load(autonomousSkillPath);

  assert.match(markdown, /game-browser-testing/i);
  assert.match(markdown, /(?:repo|repository)[- ]local.*(?:skill|SKILL\.md)|skills\/game-browser-testing\/SKILL\.md/i);
  assert.match(markdown, /(?:interactive|game).*browser.*(?:verify|verification)|browser.*game.*verification/i);
  assert.match(markdown, /do not wait .*user.*(?:name|request|invoke).*skill/i);
  assert.match(markdown, /FINDINGS[^\n]*(?:material|REPAIR)|material[^\n]*FINDINGS[^\n]*REPAIR/i);
  assert.match(markdown, /BLOCKED_CAPABILITY[^\n]*(?:blocker|limitation|BLOCKED)/i);
  assert.match(markdown, /REPAIR[\s\S]{0,300}VERIFY[\s\S]{0,300}REVIEW/i);
  assert.match(markdown, /(?:change|edit|commit)[^\n]*(?:(?:browser|runtime|evidence)[^\n]*(?:stale|invalidates)|(?:stale|invalidates)[^\n]*(?:browser|runtime|evidence))/i);
  assert.match(markdown, /browser-control.*(?:missing|unavailable)|no browser-control/i);
});
