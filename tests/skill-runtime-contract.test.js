const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const skillRoot = path.resolve(__dirname, '..', '.nanobot-boss', 'workspace', 'skills');
const bossSourcingSkill = fs.readFileSync(path.join(skillRoot, 'boss-sourcing', 'SKILL.md'), 'utf8');
const runtimeContract = fs.readFileSync(path.join(skillRoot, 'boss-sourcing', 'references', 'runtime-contract.md'), 'utf8');
const bossSourceGreetSkill = fs.readFileSync(path.join(skillRoot, 'boss-source-greet', 'SKILL.md'), 'utf8');
const bossSourceBrowserStates = fs.readFileSync(path.join(skillRoot, 'boss-source-greet', 'references', 'browser-states.md'), 'utf8');
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

test('boss-source-greet references document direct-render detail anchors and forbid utility-icon recovery', () => {
  assert.match(bossSourceBrowserStates, /工作经历/);
  assert.match(bossSourceBrowserStates, /教育经历/);
  assert.match(bossSourceBrowserStates, /resume-detail-wrap/);
  assert.match(bossSourceBrowserStates, /jobid=null.*weak negative evidence|weak negative evidence.*jobid=null/i);
  assert.match(bossSourceBrowserStates, /收藏.*分享.*共享|收藏\s*\/\s*分享\s*\/\s*共享/);
  assert.match(bossSourceBrowserStates, /不合适.*提交.*detail has closed|不合适.*提交.*详情已关闭/i);
  assert.match(bossSourceBrowserStates, /recommend-next-candidate/);
});

test('boss-chat-followup skill documents attachment-state decisions', () => {
  assert.match(bossChatFollowupSkill, /grey\/disabled/);
  assert.match(bossChatFollowupSkill, /enabled attachment button or visible PDF card means resume already sent/i);
  assert.match(bossChatFollowupSkill, /boss-resume-ingest/);
  assert.match(bossChatFollowupSkill, /chat-open-thread/);
  assert.match(bossChatFollowupSkill, /chat-thread-state/);
  assert.match(bossChatFollowupSkill, /attachment-state/);
  assert.match(bossChatFollowupSkill, /attachment.*not.*run-fail|do not run-fail solely because.*attachment/i);
});

test('boss-chat-followup skill requires draining unread queue before completion', () => {
  assert.match(bossChatFollowupSkill, /process unread rows in order/i);
  assert.match(bossChatFollowupSkill, /continue until the current unread queue.*empty|current unread queue.*drained|drain the unread queue/i);
  assert.match(bossChatFollowupSkill, /do not stop after one thread|do not finish after a single thread|single processed thread/i);
  assert.match(bossChatFollowupSkill, /cannot stop after judgment|do not stop after mere judgment|must not exit after mere judgment|判定后不能直接退出/i);
  assert.match(bossChatFollowupSkill, /resume-download --run-id|同一父 run 内直接完成下载|download evidence/i);
});

test('boss-resume-ingest skill documents runtime placeholders instead of machine-specific paths', () => {
  assert.doesNotMatch(bossResumeIngestSkill, /\/Users\/coldxiangyu/);
  assert.match(bossResumeIngestSkill, /NANOBOT_RUNTIME_FILE/);
  assert.match(bossResumeIngestSkill, /RESUME_LEDGER_FILE/);
  assert.match(bossResumeIngestSkill, /candidateId.*missing/i);
  assert.match(bossResumeIngestSkill, /list-candidates --job-key "\$JOB_KEY"/);
  assert.match(bossResumeIngestSkill, /resume-preview-meta --run-id "\$RUN_ID"/);
  assert.match(bossResumeIngestSkill, /resume-download --run-id "\$RUN_ID" --output-path/);
  assert.match(bossResumeIngestSkill, /disabled.*请求附件简历|尚未获得对方完整简历/i);
  assert.match(bossResumeIngestSkill, /do not write attachment discovered.*disabled|disabled request-only state.*not.*attachment discovered/i);
});

test('boss-resume-ingest skill forbids startup rediscovery scans when handoff context exists', () => {
  assert.match(bossResumeIngestSkill, /do not ignore `BOSS_CONTEXT_FILE`/i);
  assert.match(bossResumeIngestSkill, /do not .*list_dir.*project root|do not .*list_dir.*resumes/i);
  assert.match(bossResumeIngestSkill, /do not .*find.*resumes|do not .*rg.*resumes|do not .*rglob.*resumes/i);
  assert.match(bossResumeIngestSkill, /do not switch to another visible thread/i);
});
