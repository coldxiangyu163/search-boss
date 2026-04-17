const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PACE_OPTIONS,
  presetToRaw,
  rawToPace,
  sanitizePayloadByTaskType,
  buildSummaryLabel
} = require('../public/automation-schedule-ux');

test('automation schedule presets expose the expected pace options', () => {
  assert.deepEqual(
    PACE_OPTIONS.map((item) => item.value),
    ['conservative', 'standard', 'aggressive', 'custom']
  );
});

test('automation schedule helpers map source standard preset to existing defaults', () => {
  assert.deepEqual(
    presetToRaw({ taskType: 'source', pace: 'standard' }),
    {
      priority: 5,
      cooldownMinutes: 60,
      dailyMaxRuns: 0,
      payload: {
        targetCount: 5,
        recommendTab: 'default'
      }
    }
  );
});

test('automation schedule helpers detect custom raw source schedules', () => {
  assert.equal(
    rawToPace({
      taskType: 'source',
      priority: 5,
      cooldownMinutes: 45,
      dailyMaxRuns: 0,
      payload: {
        targetCount: 5,
        recommendTab: 'default'
      }
    }),
    'custom'
  );
});

test('automation schedule helpers strip irrelevant payload keys by task type', () => {
  assert.deepEqual(
    sanitizePayloadByTaskType('source', {
      targetCount: 8,
      recommendTab: 'latest',
      maxThreads: 40,
      interactionTypes: ['request_resume']
    }),
    {
      targetCount: 8,
      recommendTab: 'latest'
    }
  );

  assert.deepEqual(
    sanitizePayloadByTaskType('followup', {
      targetCount: 8,
      recommendTab: 'latest',
      maxThreads: 12,
      interactionTypes: ['request_resume', 'exchange_wechat']
    }),
    {
      maxThreads: 12,
      interactionTypes: ['request_resume', 'exchange_wechat'],
      rechatMaxScanDays: 7,
      rechatConsecutiveOutboundLimit: 3
    }
  );

  assert.deepEqual(
    sanitizePayloadByTaskType('followup', {
      maxThreads: 15,
      interactionTypes: ['request_resume'],
      rechatMaxScanDays: 10,
      rechatConsecutiveOutboundLimit: 5
    }),
    {
      maxThreads: 15,
      interactionTypes: ['request_resume'],
      rechatMaxScanDays: 10,
      rechatConsecutiveOutboundLimit: 5
    }
  );
});

test('automation schedule helpers build compact summary labels for list display', () => {
  assert.equal(
    buildSummaryLabel({
      taskType: 'source',
      pace: 'aggressive',
      payload: {
        targetCount: 10,
        recommendTab: 'latest'
      }
    }),
    '激进 · 打招呼 10 人 · 最新推荐'
  );

  assert.equal(
    buildSummaryLabel({
      taskType: 'followup',
      pace: 'standard',
      payload: {
        maxThreads: 20,
        interactionTypes: ['request_resume', 'exchange_phone']
      }
    }),
    '标准 · 处理 20 人 · 求简历、换电话'
  );
});
