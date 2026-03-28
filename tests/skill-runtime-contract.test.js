const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const bossSourcingSkill = fs.readFileSync(
  '/Users/coldxiangyu/.nanobot-boss/workspace/skills/boss-sourcing/SKILL.md',
  'utf8'
);
const bossResumeIngestSkill = fs.readFileSync(
  '/Users/coldxiangyu/.nanobot-boss/workspace/skills/boss-resume-ingest/SKILL.md',
  'utf8'
);

test('boss-sourcing skill documents runtime placeholders instead of machine-specific paths', () => {
  assert.doesNotMatch(bossSourcingSkill, /\/Users\/coldxiangyu/);
  assert.match(bossSourcingSkill, /NANOBOT_RUNTIME_FILE/);
  assert.match(bossSourcingSkill, /SEARCH_BOSS_API_BASE/);
  assert.match(bossSourcingSkill, /SEARCH_BOSS_AGENT_TOKEN/);
});

test('boss-sourcing skill forbids repo introspection and CLI probing during bootstrap', () => {
  assert.match(bossSourcingSkill, /AGENTS\.md/);
  assert.match(bossSourcingSkill, /tests\/\*/);
  assert.match(bossSourcingSkill, /--help/);
  assert.match(bossSourcingSkill, /dashboard-summary/);
});

test('boss-sourcing skill forbids recursive reference discovery and requires file-backed terminal callbacks', () => {
  assert.match(bossSourcingSkill, /find.*rg.*python.*rglob/i);
  assert.match(bossSourcingSkill, /run-fail\.json/);
  assert.match(bossSourcingSkill, /jobid=null/i);
});

test('boss-sourcing skill documents source callback identifier requirements', () => {
  assert.match(bossSourcingSkill, /bossEncryptGeekId/);
  assert.match(bossSourcingSkill, /candidate\.displayName/);
  assert.match(bossSourcingSkill, /5 new successful greetings|5 new successful greeting|5 个/i);
});

test('boss-resume-ingest skill documents runtime placeholders instead of machine-specific paths', () => {
  assert.doesNotMatch(bossResumeIngestSkill, /\/Users\/coldxiangyu/);
  assert.match(bossResumeIngestSkill, /NANOBOT_RUNTIME_FILE/);
  assert.match(bossResumeIngestSkill, /RESUME_LEDGER_FILE/);
});
