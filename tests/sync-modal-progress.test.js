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
        buildCandidateTimeline: noop,
        buildCandidateEvaluation: noop
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
        buildCandidateEvaluation: noop,
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
        buildCandidateEvaluation: noop,
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
        buildCandidateEvaluation: noop,
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
        buildCandidateEvaluation: noop,
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

test('manageOverviewPolling pauses realtime refresh while runtime console live overlay is open', () => {
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
        buildCandidateEvaluation: noop,
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: noop,
        resolveSyncLogScrollTop: noop
      },
      location: { href: '' },
      setInterval() {
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
    state.overviewPollTimer = 99;
    state.syncModal.open = true;
    state.syncModal.showLiveView = true;
    manageOverviewPolling();
  `, context);

  const result = vm.runInContext(`({
    timer: state.overviewPollTimer,
    clearedIntervalId: window.__clearedIntervalId
  })`, context);

  assert.equal(result.timer, null);
  assert.equal(result.clearedIntervalId, 99);
});

test('render mounts runtime console overlay inside app content instead of appending to body', () => {
  const helperScript = fs.readFileSync(
    path.join(__dirname, '../public/sync-modal-progress.js'),
    'utf8'
  );
  const appScript = fs.readFileSync(
    path.join(__dirname, '../public/app.js'),
    'utf8'
  );

  const noop = () => {};
  const nodes = {
    'page-eyebrow': { textContent: '' },
    'page-title': { textContent: '' },
    'page-description': { textContent: '' },
    app: { innerHTML: '' }
  };
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
        buildCandidateEvaluation: noop,
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: () => null,
        resolveSyncLogScrollTop: () => 0
      },
      location: { href: '' },
      setInterval: noop,
      clearInterval: noop
    },
    document: {
      addEventListener: noop,
      fullscreenElement: null,
      exitFullscreen: () => Promise.resolve(),
      getElementById(id) {
        return nodes[id] || null;
      },
      querySelector() {
        return null;
      },
      body: {
        appendChild() {
          this.__appendCount = (this.__appendCount || 0) + 1;
        }
      }
    },
    fetch: noop,
    module: undefined,
    console
  });

  vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
  vm.runInContext(appScript, context, { filename: 'app.js' });
  vm.runInContext(`
    state.summary = { activeRun: null };
    state.view = 'command';
    state.syncModal = {
      open: true,
      runId: null,
      status: 'idle',
      startedAt: null,
      error: '',
      events: [],
      progress: createSyncModalProgressState(),
      isExpanded: false,
      pollTimer: null,
      lastEventId: 0,
      taskType: 'browser_live',
      showLiveView: true,
      browserFocus: false,
      consoleTitle: '我的 BOSS 浏览器',
      standbyMessage: '待机中'
    };
    renderCommandCenter = () => '<section>command</section>';
    manageOverviewPolling = () => {};
    render();
  `, context);

  assert.equal(context.document.body.__appendCount || 0, 0);
  assert.match(nodes.app.innerHTML, /sync-live-overlay/);
});

test('render mounts state-driven modal backdrops from root content shell instead of page-local renderers', () => {
  const helperScript = fs.readFileSync(
    path.join(__dirname, '../public/sync-modal-progress.js'),
    'utf8'
  );
  const appScript = fs.readFileSync(
    path.join(__dirname, '../public/app.js'),
    'utf8'
  );

  const noop = () => {};
  const nodes = {
    'page-eyebrow': { textContent: '' },
    'page-title': { textContent: '' },
    'page-description': { textContent: '' },
    app: { innerHTML: '' }
  };
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
        buildCandidateTimeline: () => [],
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: () => null,
        resolveSyncLogScrollTop: () => 0
      },
      location: { href: '' },
      setInterval: noop,
      clearInterval: noop
    },
    document: {
      addEventListener: noop,
      getElementById(id) {
        return nodes[id] || null;
      },
      querySelector() {
        return null;
      },
      body: { appendChild: noop }
    },
    fetch: noop,
    module: undefined,
    console
  });

  vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
  vm.runInContext(appScript, context, { filename: 'app.js' });
  vm.runInContext(`
    state.summary = { activeRun: null };
    state.view = 'automation';
    state.scheduleModal.open = true;
    state.scheduleModal.mode = 'create';
    state.scheduleModal.form = {
      jobKey: '',
      taskType: 'source',
      timeRanges: [{ startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 }],
      intervalMinutes: 60,
      targetCount: 5,
      maxThreads: 20,
      recommendTab: 'default',
      interactionTypes: ['request_resume'],
      priority: 5,
      cooldownMinutes: 60,
      dailyMaxRuns: 0
    };
    renderAutomation = () => '<section>automation</section>';
    manageOverviewPolling = () => {};
    render();
  `, context);

  const html = nodes.app.innerHTML;
  const backdropCount = (html.match(/class=\"modal-backdrop\"/g) || []).length;
  assert.equal(backdropCount, 1);
  assert.match(html, /schedule-modal/);
});

test('render mounts legacy admin modals from root content shell and preserves open state across rerender', () => {
  const helperScript = fs.readFileSync(
    path.join(__dirname, '../public/sync-modal-progress.js'),
    'utf8'
  );
  const appScript = fs.readFileSync(
    path.join(__dirname, '../public/app.js'),
    'utf8'
  );

  const noop = () => {};
  const nodes = {
    'page-eyebrow': { textContent: '' },
    'page-title': { textContent: '' },
    'page-description': { textContent: '' },
    app: { innerHTML: '' }
  };
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
        buildCandidateTimeline: () => [],
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: () => null,
        resolveSyncLogScrollTop: () => 0
      },
      location: { href: '' },
      setInterval: noop,
      clearInterval: noop
    },
    document: {
      addEventListener: noop,
      getElementById(id) {
        return nodes[id] || null;
      },
      querySelector() {
        return null;
      },
      body: { appendChild: noop }
    },
    fetch: noop,
    module: undefined,
    console
  });

  vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
  vm.runInContext(appScript, context, { filename: 'app.js' });
  vm.runInContext(`
    state.summary = { activeRun: null };
    state.view = 'admin-org';
    state.currentUser = { role: 'dept_admin' };
    state.adminDepartments = [];
    state.adminUsers = [];
    state.adminHrAccounts = [];
    state.adminModalOpenId = 'hr-modal';
    renderAdminOrg = () => '<section>admin-org</section>';
    manageOverviewPolling = () => {};
    render();
  `, context);

  assert.match(nodes.app.innerHTML, /id="hr-modal"/);
  assert.match(nodes.app.innerHTML, /id="hr-modal" class="modal-overlay" style="display:flex"/);
});

test('showModal initializes admin modal state without depending on existing form DOM values', () => {
  const helperScript = fs.readFileSync(
    path.join(__dirname, '../public/sync-modal-progress.js'),
    'utf8'
  );
  const appScript = fs.readFileSync(
    path.join(__dirname, '../public/app.js'),
    'utf8'
  );

  const noop = () => {};
  const nodes = {
    'page-eyebrow': { textContent: '' },
    'page-title': { textContent: '' },
    'page-description': { textContent: '' },
    app: { innerHTML: '' },
    'dept-modal': { style: {} }
  };
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
        buildCandidateTimeline: () => [],
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: () => null,
        resolveSyncLogScrollTop: () => 0
      },
      location: { href: '' },
      setInterval: noop,
      clearInterval: noop
    },
    document: {
      addEventListener: noop,
      getElementById(id) {
        return nodes[id] || null;
      },
      querySelector() {
        return null;
      },
      body: { appendChild: noop }
    },
    fetch: noop,
    module: undefined,
    console
  });

  vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
  vm.runInContext(appScript, context, { filename: 'app.js' });
  vm.runInContext(`
    state.summary = { activeRun: null };
    state.view = 'admin-org';
    state.currentUser = { role: 'system_admin' };
    state.adminDepartments = [];
    state.adminUsers = [];
    state.adminHrAccounts = [];
    state.adminModalForms.dept = {
      editId: 'old',
      title: '旧标题',
      name: '旧部门',
      status: 'inactive',
      showStatus: true
    };
    manageOverviewPolling = () => {};
    showModal('dept-modal');
  `, context);

  const result = vm.runInContext(`({
    openId: state.adminModalOpenId,
    form: state.adminModalForms.dept,
    html: document.getElementById('app').innerHTML
  })`, context);

  assert.equal(result.openId, 'dept-modal');
  assert.equal(result.form.editId, '');
  assert.equal(result.form.title, '新增部门');
  assert.equal(result.form.name, '');
  assert.equal(result.form.status, 'active');
  assert.equal(result.form.showStatus, false);
  assert.match(result.html, /id="dept-modal" class="modal-overlay" style="display:flex"/);
});

test('admin modal form values are rebuilt from state on rerender', () => {
  const helperScript = fs.readFileSync(
    path.join(__dirname, '../public/sync-modal-progress.js'),
    'utf8'
  );
  const appScript = fs.readFileSync(
    path.join(__dirname, '../public/app.js'),
    'utf8'
  );

  const noop = () => {};
  const nodes = {
    'page-eyebrow': { textContent: '' },
    'page-title': { textContent: '' },
    'page-description': { textContent: '' },
    app: { innerHTML: '' }
  };
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
        buildCandidateTimeline: () => [],
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: () => null,
        resolveSyncLogScrollTop: () => 0
      },
      location: { href: '' },
      setInterval: noop,
      clearInterval: noop
    },
    document: {
      addEventListener: noop,
      getElementById(id) {
        return nodes[id] || null;
      },
      querySelector() {
        return null;
      },
      body: { appendChild: noop }
    },
    fetch: noop,
    module: undefined,
    console
  });

  vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
  vm.runInContext(appScript, context, { filename: 'app.js' });
  vm.runInContext(`
    state.summary = { activeRun: null };
    state.view = 'admin-org';
    state.currentUser = { role: 'system_admin' };
    state.adminDepartments = [{ id: 11, name: '销售', status: 'active' }];
    state.adminUsers = [];
    state.adminHrAccounts = [];
    state.adminModalOpenId = 'user-modal';
    state.adminModalForms.user = {
      editId: '7',
      title: '编辑用户',
      name: '张三',
      email: 'zhangsan@test.com',
      phone: '13800138000',
      role: 'enterprise_admin',
      departmentId: '11',
      password: '',
      status: 'inactive',
      showPassword: false,
      showStatus: true
    };
    renderAdminOrg = () => '<section>admin-org</section>';
    manageOverviewPolling = () => {};
    render();
  `, context);

  const html = nodes.app.innerHTML;
  assert.match(html, /id="user-modal" class="modal-overlay" style="display:flex"/);
  assert.match(html, /id="user-name"[^>]*value="张三"/);
  assert.match(html, /id="user-email"[^>]*value="zhangsan@test\.com"/);
  assert.match(html, /id="user-phone"[^>]*value="13800138000"/);
  assert.match(html, /<option value="enterprise_admin" selected>/);
  assert.match(html, /<option value="11" selected>/);
  assert.match(html, /<option value="inactive" selected>/);
});

test('runtime console logs render as single terminal stream without summary chips or split sections', () => {
  const helperScript = fs.readFileSync(
    path.join(__dirname, '../public/sync-modal-progress.js'),
    'utf8'
  );
  const appScript = fs.readFileSync(
    path.join(__dirname, '../public/app.js'),
    'utf8'
  );

  const noop = () => {};
  const nodes = {
    'page-eyebrow': { textContent: '' },
    'page-title': { textContent: '' },
    'page-description': { textContent: '' },
    app: { innerHTML: '' }
  };
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
        buildCandidateTimeline: () => [],
        buildResumePreviewUrl: noop
      },
      SyncLogScroll: {
        captureSyncLogScrollSnapshot: () => null,
        resolveSyncLogScrollTop: () => 0
      },
      RuntimeLogFeed: {
        classifyRuntimeLogEvent(event) {
          return {
            ...event,
            severity: event.severity || 'info',
            label: event.label || event.eventType || '运行事件',
            stageLabel: event.stageLabel || event.stage || '运行过程'
          };
        },
        summarizeRuntimeLogs(events) {
          return {
            totalCount: events.length,
            warningCount: 0,
            errorCount: 0,
            highlightCount: events.length,
            lastSignal: events[events.length - 1] || null
          };
        },
        splitRuntimeLogFeed(events) {
          return {
            highlights: events,
            stream: [...events].reverse()
          };
        }
      },
      location: { href: '' },
      setInterval: noop,
      clearInterval: noop
    },
    document: {
      addEventListener: noop,
      getElementById(id) {
        return nodes[id] || null;
      },
      querySelector() {
        return null;
      },
      body: { appendChild: noop }
    },
    fetch: noop,
    module: undefined,
    console
  });

  vm.runInContext(helperScript, context, { filename: 'sync-modal-progress.js' });
  vm.runInContext(appScript, context, { filename: 'app.js' });
  vm.runInContext(`
    state.summary = { activeRun: null };
    state.view = 'command';
    state.syncModal = {
      open: true,
      runId: 88,
      status: 'running',
      startedAt: '2026-04-08T11:00:00.000Z',
      error: '',
      events: [
        { occurredAt: '2026-04-08T11:00:01.000Z', eventType: 'schedule_triggered', stage: 'bootstrap', message: '已触发任务' },
        { occurredAt: '2026-04-08T11:00:03.000Z', eventType: 'nanobot_stream', stage: 'execute', message: '正在打开推荐列表' }
      ],
      progress: createSyncModalProgressState(),
      isExpanded: true,
      pollTimer: null,
      lastEventId: 0,
      taskType: 'source',
      showLiveView: true,
      browserFocus: false,
      consoleTitle: '我的 BOSS 浏览器',
      standbyMessage: ''
    };
    manageOverviewPolling = () => {};
    renderCommandCenter = () => '<section>command</section>';
    render();
  `, context);

  const html = nodes.app.innerHTML;
  assert.match(html, /runtime-terminal/);
  assert.match(html, /runtime-terminal-line/);
  assert.doesNotMatch(html, /runtime-log-summary/);
  assert.doesNotMatch(html, /runtime-log-sections/);
  assert.doesNotMatch(html, /关键节点/);
  assert.doesNotMatch(html, /runtime-console-panel--hero/);
  assert.doesNotMatch(html, /runtime-console-metrics/);
  assert.doesNotMatch(html, /runtime-stage-strip/);
  assert.doesNotMatch(html, /runtime-terminal-stage/);
  assert.match(html, /\[NANOBOT_STREAM\]/);
  assert.match(html, /正在打开推荐列表/);
  assert.doesNotMatch(html, /sync-log-toggle/);
  assert.ok(html.indexOf('[SCHEDULE_TRIGGERED]') < html.indexOf('[NANOBOT_STREAM]'));
});
