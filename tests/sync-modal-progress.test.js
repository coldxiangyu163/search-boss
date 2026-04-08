const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  createSyncModalProgress,
  updateSyncModalProgress,
  resolveSyncTerminalStatus,
  resolveSyncTerminalStatusFromRun,
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

test('resolveSyncTerminalStatus ignores recoverable nanobot stream messages that mention errors', () => {
  assert.equal(
    resolveSyncTerminalStatus({
      eventType: 'nanobot_stream',
      message: 'run-candidate 首次回写返回 Local API error，准备重试'
    }),
    null
  );
});

test('resolveSyncTerminalStatus only marks explicit terminal failures as failed', () => {
  assert.deepEqual(
    resolveSyncTerminalStatus({
      eventType: 'run_failed',
      message: '回写失败'
    }),
    {
      status: 'failed',
      error: '回写失败'
    }
  );

  assert.deepEqual(
    resolveSyncTerminalStatus({
      eventType: 'run_completed',
      message: '已完成'
    }),
    {
      status: 'completed',
      error: ''
    }
  );
});

test('resolveSyncTerminalStatus recognizes stopped events', () => {
  assert.deepEqual(
    resolveSyncTerminalStatus({
      eventType: 'run_stopped',
      message: '已手动停止'
    }),
    {
      status: 'stopped',
      error: ''
    }
  );
});

test('resolveSyncTerminalStatusFromRun recognizes stopped run state', () => {
  assert.deepEqual(
    resolveSyncTerminalStatusFromRun({
      status: 'stopped'
    }),
    {
      status: 'stopped',
      error: ''
    }
  );
});

test('buildSyncStages renders stopped label when status is stopped', () => {
  const stages = buildSyncStages({
    runId: 1,
    status: 'stopped',
    error: '',
    progress: createSyncModalProgress()
  });

  const lastStage = stages[stages.length - 1];
  assert.equal(lastStage.label, '已手动停止');
  assert.equal(lastStage.done, true);
  assert.match(lastStage.desc, /手动停止/);
});

test('resolveSyncTerminalStatusFromRun treats persisted run state as terminal fallback', () => {
  assert.deepEqual(
    resolveSyncTerminalStatusFromRun({
      status: 'completed'
    }),
    {
      status: 'completed',
      error: ''
    }
  );

  assert.deepEqual(
    resolveSyncTerminalStatusFromRun({
      status: 'failed'
    }),
    {
      status: 'failed',
      error: ''
    }
  );

  assert.equal(
    resolveSyncTerminalStatusFromRun({
      status: 'running'
    }),
    null
  );
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

test('openHrLiveView binds current active run instead of standby view', () => {
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
        buildCandidateTimeline: noop,
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: noop,
        resolveSyncLogScrollTop: noop
      },
      setInterval: noop,
      clearInterval: noop,
      location: { href: '' }
    },
    document: {
      addEventListener: noop,
      getElementById: noop,
      querySelector: noop,
      body: { appendChild: noop }
    },
    fetch: noop,
    module: undefined,
    console
  });

  vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
  vm.runInContext(appScript, context, { filename: 'app.js' });
  vm.runInContext(`
    render = () => {};
    startLiveViewPolling = () => {};
    stopSyncPolling = () => {};
    startSyncPollingCalled = false;
    startSyncPolling = () => { startSyncPollingCalled = true; };
    state.currentUser = { hrAccountId: 7 };
    state.summary = {
      activeRun: {
        id: 42,
        mode: 'source',
        status: 'running',
        jobKey: 'job-42',
        jobName: '测试职位',
        startedAt: '2026-04-08T10:00:00.000Z'
      }
    };
    openHrLiveView();
  `, context);

  const result = vm.runInContext(`({
    runId: state.syncModal.runId,
    status: state.syncModal.status,
    taskType: state.syncModal.taskType,
    isStandby: isRuntimeConsoleStandby(),
    label: getRuntimeConsoleTaskLabel(),
    startSyncPollingCalled
  })`, context);

  assert.equal(result.runId, 42);
  assert.equal(result.status, 'running');
  assert.equal(result.taskType, 'source');
  assert.equal(result.isStandby, false);
  assert.equal(result.label, '寻源打招呼');
  assert.equal(result.startSyncPollingCalled, true);
});

test('openHrLiveView refreshes dashboard summary to get latest active run when summary cache is stale', async () => {
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
        buildCandidateTimeline: noop,
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: noop,
        resolveSyncLogScrollTop: noop
      },
      setInterval: noop,
      clearInterval: noop,
      location: { href: '' }
    },
    document: {
      addEventListener: noop,
      getElementById: noop,
      querySelector: noop,
      body: { appendChild: noop }
    },
    fetch: async (url) => {
      if (String(url) === '/api/dashboard/summary') {
        return {
          ok: true,
          json: async () => ({
            activeRun: {
              id: 77,
              mode: 'followup',
              status: 'running',
              jobKey: 'job-77',
              jobName: '销售顾问',
              startedAt: '2026-04-08T11:00:00.000Z',
              createdAt: '2026-04-08T10:59:00.000Z'
            }
          })
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    module: undefined,
    console
  });

  vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
  vm.runInContext(appScript, context, { filename: 'app.js' });
  vm.runInContext(`
    render = () => {};
    startLiveViewPolling = () => {};
    stopSyncPolling = () => {};
    startSyncPollingCalled = false;
    startSyncPolling = () => { startSyncPollingCalled = true; };
    state.currentUser = { hrAccountId: 7 };
    state.summary = { activeRun: null };
  `, context);

  await vm.runInContext('openHrLiveView()', context);

  const result = vm.runInContext(`({
    runId: state.syncModal.runId,
    status: state.syncModal.status,
    taskType: state.syncModal.taskType,
    label: getRuntimeConsoleTaskLabel(),
    startSyncPollingCalled
  })`, context);

  assert.equal(result.runId, 77);
  assert.equal(result.status, 'running');
  assert.equal(result.taskType, 'followup');
  assert.equal(result.label, '主动沟通拉简历');
  assert.equal(result.startSyncPollingCalled, true);
});

test('openHrLiveView stays in standby when refreshed dashboard summary has no active run', async () => {
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
        buildCandidateTimeline: noop,
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: noop,
        resolveSyncLogScrollTop: noop
      },
      setInterval: noop,
      clearInterval: noop,
      location: { href: '' }
    },
    document: {
      addEventListener: noop,
      getElementById: noop,
      querySelector: noop,
      body: { appendChild: noop }
    },
    fetch: async (url) => {
      if (String(url) === '/api/dashboard/summary') {
        return {
          ok: true,
          json: async () => ({ activeRun: null })
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    module: undefined,
    console
  });

  vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
  vm.runInContext(appScript, context, { filename: 'app.js' });
  vm.runInContext(`
    render = () => {};
    startLiveViewPolling = () => {};
    stopSyncPolling = () => {};
    startSyncPollingCalled = false;
    startSyncPolling = () => { startSyncPollingCalled = true; };
    state.currentUser = { hrAccountId: 7 };
    state.summary = { activeRun: null };
  `, context);

  await vm.runInContext('openHrLiveView()', context);

  const result = vm.runInContext(`({
    runId: state.syncModal.runId,
    status: state.syncModal.status,
    taskType: state.syncModal.taskType,
    isStandby: isRuntimeConsoleStandby(),
    startSyncPollingCalled
  })`, context);

  assert.equal(result.runId, null);
  assert.equal(result.status, 'idle');
  assert.equal(result.taskType, 'browser_live');
  assert.equal(result.isStandby, true);
  assert.equal(result.startSyncPollingCalled, false);
});

test('manageOverviewPolling starts realtime refresh on overview views only', () => {
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
        buildCandidateTimeline: noop,
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: noop,
        resolveSyncLogScrollTop: noop
      },
      location: { href: '' },
      setInterval(callback, ms) {
        this.__lastIntervalMs = ms;
        this.__lastIntervalCallbackType = typeof callback;
        return 99;
      },
      clearInterval(id) {
        this.__clearedIntervalId = id;
      }
    },
    document: {
      addEventListener: noop,
      getElementById: noop,
      querySelector: noop
    },
    fetch: noop,
    module: undefined,
    console
  });

  vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
  vm.runInContext(appScript, context, { filename: 'app.js' });
  vm.runInContext(`
    state.view = 'command';
    manageOverviewPolling();
  `, context);

  const started = vm.runInContext(`({
    timer: state.overviewPollTimer,
    intervalMs: window.__lastIntervalMs,
    callbackType: window.__lastIntervalCallbackType
  })`, context);

  vm.runInContext(`
    state.view = 'jobs';
    manageOverviewPolling();
  `, context);

  const stopped = vm.runInContext(`({
    timer: state.overviewPollTimer,
    clearedIntervalId: window.__clearedIntervalId
  })`, context);

  assert.equal(started.timer, 99);
  assert.equal(started.intervalMs, 5000);
  assert.equal(started.callbackType, 'function');
  assert.equal(stopped.timer, null);
  assert.equal(stopped.clearedIntervalId, 99);
});
