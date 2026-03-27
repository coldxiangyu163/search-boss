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

test('boss-resume-ingest skill documents runtime placeholders instead of machine-specific paths', () => {
  assert.doesNotMatch(bossResumeIngestSkill, /\/Users\/coldxiangyu/);
  assert.match(bossResumeIngestSkill, /NANOBOT_RUNTIME_FILE/);
  assert.match(bossResumeIngestSkill, /RESUME_LEDGER_FILE/);
});

