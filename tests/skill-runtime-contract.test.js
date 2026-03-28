const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const skillRoot = path.resolve(__dirname, '..', '.nanobot-boss', 'workspace', 'skills');
const bossSourcingSkill = fs.readFileSync(path.join(skillRoot, 'boss-sourcing', 'SKILL.md'), 'utf8');
const runtimeContract = fs.readFileSync(path.join(skillRoot, 'boss-sourcing', 'references', 'runtime-contract.md'), 'utf8');
const bossSourceGreetSkill = fs.readFileSync(path.join(skillRoot, 'boss-source-greet', 'SKILL.md'), 'utf8');
const bossChatFollowupSkill = fs.readFileSync(path.join(skillRoot, 'boss-chat-followup', 'SKILL.md'), 'utf8');
const bossResumeIngestSkill = fs.readFileSync(path.join(skillRoot, 'boss-resume-ingest', 'SKILL.md'), 'utf8');

test('boss-sourcing router documents split execution skills', () => {
  assert.match(bossSourcingSkill, /boss-source-greet/);
  assert.match(bossSourcingSkill, /boss-chat-followup/);
  assert.match(bossSourcingSkill, /boss-resume-ingest/);
});

test('shared runtime contract documents runtime placeholders instead of machine-specific paths', () => {
  assert.doesNotMatch(runtimeContract, /\/Users\/coldxiangyu/);
  assert.match(runtimeContract, /NANOBOT_RUNTIME_FILE/);
  assert.match(runtimeContract, /SEARCH_BOSS_API_BASE/);
  assert.match(runtimeContract, /SEARCH_BOSS_AGENT_TOKEN/);
});

test('shared runtime contract forbids repo introspection and documents file-backed bootstrap writes', () => {
  assert.match(runtimeContract, /AGENTS\.md/);
  assert.match(runtimeContract, /tests\/\*/);
  assert.match(runtimeContract, /--help/);
  assert.match(runtimeContract, /dashboard-summary/);
  assert.match(runtimeContract, /run-event --run-id "\$RUN_ID" --file/);
  assert.match(runtimeContract, /does not provide a standalone `bootstrap` command/);
});

test('shared runtime contract forbids recursive reference rediscovery and requires file-backed terminal callbacks', () => {
  assert.match(runtimeContract, /find.*rg.*python.*rglob/i);
  assert.match(runtimeContract, /run-fail\.json/);
  assert.match(runtimeContract, /jobid=null/i);
});

test('boss-source-greet skill documents source callback identifier requirements', () => {
  assert.match(bossSourceGreetSkill, /bossEncryptGeekId/);
  assert.match(bossSourceGreetSkill, /run-action\(greet_sent\)/);
  assert.match(bossSourceGreetSkill, /5 new greetings|5 个|5 new successful/i);
  assert.match(bossSourceGreetSkill, /unknown-\*/i);
  assert.match(bossSourceGreetSkill, /run-complete/i);
});

test('boss-chat-followup skill documents attachment-state decisions', () => {
  assert.match(bossChatFollowupSkill, /grey\/disabled/);
  assert.match(bossChatFollowupSkill, /enabled attachment button or visible PDF card means resume already sent/i);
  assert.match(bossChatFollowupSkill, /boss-resume-ingest/);
});

test('boss-resume-ingest skill documents runtime placeholders instead of machine-specific paths', () => {
  assert.doesNotMatch(bossResumeIngestSkill, /\/Users\/coldxiangyu/);
  assert.match(bossResumeIngestSkill, /NANOBOT_RUNTIME_FILE/);
  assert.match(bossResumeIngestSkill, /RESUME_LEDGER_FILE/);
});
