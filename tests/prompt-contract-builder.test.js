const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSchedulePrompt, buildSyncPrompt } = require('../src/services/prompt-contract-builder');

test('buildSchedulePrompt renders source prompt with existing source contracts', () => {
  const prompt = buildSchedulePrompt({
    mode: 'source',
    runId: '41',
    jobKey: '健康顾问_B0047007',
    jobContext: {
      customRequirement: '优先电销经验',
      jobName: '健康顾问（B0047007）',
      bossEncryptJobId: 'abc123'
    },
    deterministicContextPrompt: 'Deterministic browser context: current BOSS tab already bound.'
  });

  assert.match(prompt, /boss-sourcing --job "健康顾问_B0047007" --source --run-id "41"/);
  assert.match(prompt, /Deterministic browser context/);
  assert.match(prompt, /岗位定制要求：优先电销经验/);
  assert.match(prompt, /run-candidate 必须直接写顶层/);
  assert.match(prompt, /targetCount=5/);
});

test('buildSchedulePrompt renders followup prompt with handoff and terminal rules', () => {
  const prompt = buildSchedulePrompt({
    mode: 'followup',
    runId: '91',
    jobKey: 'job-key-1',
    jobContext: {},
    deterministicContextPrompt: 'CTX'
  });

  assert.match(prompt, /boss-sourcing --job "job-key-1" --followup --run-id "91"/);
  assert.match(prompt, /CTX/);
  assert.match(prompt, /boss-resume-ingest --run-id "91"/);
  assert.match(prompt, /run-attachment/);
  assert.match(prompt, /run-complete 或 run-fail/);
});

test('buildSyncPrompt renders sync-only restrictions and write contract', () => {
  const prompt = buildSyncPrompt({ runId: '77' });

  assert.match(prompt, /boss-sourcing --sync --run-id "77"/);
  assert.match(prompt, /只执行岗位同步/);
  assert.match(prompt, /jobs-batch 直接写 jobs 数组/);
  assert.match(prompt, /run-complete 或 run-fail/);
});
