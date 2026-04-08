const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyRuntimeLogEvent,
  summarizeRuntimeLogs,
  splitRuntimeLogFeed
} = require('../public/runtime-log-feed');

test('classifyRuntimeLogEvent maps warnings and failures to operator-friendly severity/labels', () => {
  const warning = classifyRuntimeLogEvent({
    eventType: 'source_loop_warning',
    stage: 'source_loop',
    message: '推荐筛选失败，已回退默认列表',
    occurredAt: '2026-04-08T03:00:00Z'
  });
  const failure = classifyRuntimeLogEvent({
    eventType: 'run_failed',
    stage: 'complete',
    message: '任务执行失败',
    occurredAt: '2026-04-08T03:01:00Z'
  });

  assert.equal(warning.severity, 'warning');
  assert.equal(warning.label, '运行预警');
  assert.equal(warning.stageLabel, '寻源流程');
  assert.equal(failure.severity, 'error');
  assert.equal(failure.label, '任务失败');
});

test('summarizeRuntimeLogs counts important signals for collapsed state', () => {
  const summary = summarizeRuntimeLogs([
    { eventType: 'schedule_triggered', stage: 'bootstrap', message: '已触发', occurredAt: '2026-04-08T03:00:00Z' },
    { eventType: 'nanobot_stream', stage: 'nanobot', message: '读取候选人卡片', occurredAt: '2026-04-08T03:00:05Z' },
    { eventType: 'source_loop_warning', stage: 'source_loop', message: '筛选失败', occurredAt: '2026-04-08T03:00:10Z' },
    { eventType: 'run_failed', stage: 'complete', message: '任务执行失败', occurredAt: '2026-04-08T03:00:20Z' }
  ]);

  assert.equal(summary.totalCount, 4);
  assert.equal(summary.warningCount, 1);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.lastSignal.label, '任务失败');
});

test('splitRuntimeLogFeed separates key milestones from noisy stream events', () => {
  const feed = splitRuntimeLogFeed([
    { eventType: 'schedule_triggered', stage: 'bootstrap', message: '已触发', occurredAt: '2026-04-08T03:00:00Z' },
    { eventType: 'nanobot_stream', stage: 'nanobot', message: '读取候选人卡片', occurredAt: '2026-04-08T03:00:05Z' },
    { eventType: 'candidate_upserted', stage: 'source_loop', message: '已记录候选人', occurredAt: '2026-04-08T03:00:07Z' },
    { eventType: 'source_loop_warning', stage: 'source_loop', message: '筛选失败', occurredAt: '2026-04-08T03:00:10Z' }
  ]);

  assert.equal(feed.highlights.length, 3);
  assert.equal(feed.highlights[0].label, '运行预警');
  assert.equal(feed.stream.length, 4);
  assert.equal(feed.stream[0].message, '筛选失败');
  assert.equal(feed.stream[3].message, '已触发');
});
