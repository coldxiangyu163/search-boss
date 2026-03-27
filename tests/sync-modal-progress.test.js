const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  createSyncModalProgress,
  updateSyncModalProgress,
  buildSyncStages
} = require('../public/sync-modal-progress');

test('buildSyncStages keeps request stage done after bootstrap event scrolls out of the visible log window', () => {
  let progress = createSyncModalProgress();
  progress = updateSyncModalProgress(progress, { eventType: 'schedule_triggered' });

  for (let index = 0; index < 150; index += 1) {
    progress = updateSyncModalProgress(progress, {
      eventType: index === 0 ? 'nanobot_stream' : 'candidate_upserted'
    });
  }

  const stages = buildSyncStages({
    runId: 140,
    status: 'running',
    error: '',
    progress
  });

  assert.equal(stages[0].label, '创建执行任务');
  assert.equal(stages[0].done, true);
  assert.equal(stages[0].active, false);
  assert.equal(stages[0].desc, '已生成 run 并开始跟踪。');
  assert.equal(stages[1].done, true);
});

test('sync modal helper and app scripts can load together in a browser context', () => {
  const helperScript = fs.readFileSync(
    path.join(__dirname, '../public/sync-modal-progress.js'),
    'utf8'
  );
  const appScript = fs.readFileSync(
    path.join(__dirname, '../public/app.js'),
    'utf8'
  );

  const noop = () => {};
  const context = vm.createContext({
    window: {
      JobUiHelpers: {
        formatJobStatus: noop,
        getJobStatusBadgeClass: noop,
        isJobActionEnabled: noop
      },
      CandidateUiHelpers: {
        formatLifecycleStatus: noop,
        formatResumeState: noop,
        formatGuardStatus: noop,
        getLifecycleBadgeClass: noop,
        getResumeBadgeClass: noop,
        getGuardBadgeClass: noop,
        buildCandidateTimeline: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: noop,
        resolveSyncLogScrollTop: noop
      }
    },
    document: {
      addEventListener: noop
    },
    module: undefined,
    console
  });

  assert.doesNotThrow(() => {
    vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
    vm.runInContext(appScript, context, { filename: 'app.js' });
  });
});
