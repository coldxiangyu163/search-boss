const test = require('node:test');
const assert = require('node:assert/strict');

const { SchedulerService, isInWorkWindow } = require('../src/services/scheduler-service');
const { TaskLock } = require('../src/services/task-lock');
const { reloadConfig } = require('../src/config');

test('SchedulerService listSchedules selects hr_account_id for downstream lock scoping', async () => {
  let capturedSql = '';

  const pool = {
    async query(sql) {
      capturedSql = sql;
      return { rows: [] };
    }
  };

  const scheduler = new SchedulerService({ pool, agentService: {} });
  await scheduler.listSchedules();

  assert.match(
    capturedSql,
    /select[\s\S]*last_run_at,\s*updated_at,\s*hr_account_id[\s\S]*from scheduled_jobs/i
  );
});

test('SchedulerService triggerJobTask returns immediately and respects explicit terminal run state', async () => {
  const queryCalls = [];
  const nanobotCalls = [];
  const recordedEvents = [];
  let releaseNanobot = null;
  let terminalStatusResolve = null;
  const terminalStatusDone = new Promise((resolve) => {
    terminalStatusResolve = resolve;
  });
  let runSequence = 40;

  const pool = {
    async query(sql, params = []) {
      queryCalls.push({ sql, params });

      if (sql.includes('from scheduled_jobs') && sql.includes('job_key = $1')) {
        return { rows: [] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('insert into scheduled_job_runs')) {
        throw new Error('scheduled_job_runs should not be written for ad-hoc manual task');
      }

      if (sql.includes('update scheduled_jobs')) {
        throw new Error('scheduled_jobs should not be updated for ad-hoc manual task');
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const agentService = {
    async createRun(payload) {
      runSequence += 1;
      return { id: runSequence, runKey: payload.runKey, status: 'pending' };
    },
    async recordRunEvent(payload) {
      recordedEvents.push(payload);
      return { ok: true };
    },
    async runNanobotForSchedule(payload) {
      nanobotCalls.push(payload);
      await new Promise((resolve) => {
        releaseNanobot = resolve;
      });
      return { ok: true };
    },
    async getRunStatus() {
      terminalStatusResolve();
      return 'completed';
    },
    async completeRun() {
      throw new Error('completeRun should not be called when skill already marked run terminal');
    },
    async failRun() {
      throw new Error('failRun should not be called on success');
    }
  };

  const scheduler = new SchedulerService({ pool, agentService });
  const result = await scheduler.triggerJobTask('健康顾问_B0047007', 'followup');

  assert.equal(result.ok, true);
  assert.equal(result.runId, 41);
  assert.equal(result.scheduledRunId, null);
  assert.equal(result.status, 'running');
  assert.equal(result.taskType, 'followup');
  assert.equal(result.jobKey, '健康顾问_B0047007');
  assert.equal(nanobotCalls.length, 1);
  assert.deepEqual(nanobotCalls[0], {
    runId: 41,
    jobKey: '健康顾问_B0047007',
    mode: 'followup'
  });
  assert.equal(recordedEvents[0].eventType, 'schedule_triggered');
  assert.equal(recordedEvents[0].payload.scheduledJobId, null);

  releaseNanobot();
  await terminalStatusDone;
});

test('SchedulerService triggerJobTask fails manual task when nanobot exits without terminal run state', async () => {
  const queryCalls = [];
  const recordedEvents = [];
  const failedRuns = [];
  const replacementRunFailures = [];
  let releaseNanobot = null;
  let failRunResolve = null;
  const failRunDone = new Promise((resolve) => {
    failRunResolve = resolve;
  });
  let runSequence = 50;

  const pool = {
    async query(sql, params = []) {
      queryCalls.push({ sql, params });

      if (sql.includes('from scheduled_jobs') && sql.includes('job_key = $1')) {
        return { rows: [] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const agentService = {
    async createRun(payload) {
      runSequence += 1;
      return { id: runSequence, runKey: payload.runKey, status: 'pending' };
    },
    async recordRunEvent(payload) {
      recordedEvents.push(payload);
      return { ok: true };
    },
    async runNanobotForSchedule() {
      await new Promise((resolve) => {
        releaseNanobot = resolve;
      });
      return { ok: true };
    },
    async getRunStatus() {
      return 'running';
    },
    async getLatestPhaseEvent() {
      return null;
    },
    async runHasSubstantiveEvents() {
      return false;
    },
    async failReplacementRunsForRunId(payload) {
      replacementRunFailures.push(payload);
      return { ok: true, failedRunIds: [52] };
    },
    async completeRun() {
      throw new Error('completeRun should not be called without explicit terminal run state');
    },
    async failRun(payload) {
      failedRuns.push(payload);
      failRunResolve();
      return { ok: true, status: 'failed' };
    }
  };

  const scheduler = new SchedulerService({ pool, agentService });
  const result = await scheduler.triggerJobTask('健康顾问_B0047007', 'followup');

  assert.equal(result.ok, true);
  assert.equal(result.runId, 51);
  assert.equal(recordedEvents[0].eventType, 'schedule_triggered');

  releaseNanobot();
  await failRunDone;

  assert.equal(failedRuns.length, 1);
  const classificationEvent = recordedEvents.find((event) => event.eventType === 'agent_exit_classified');
  assert.equal(classificationEvent.payload.classification, 'agent_exit_before_bootstrap');
  assert.equal(failedRuns[0].runId, 51);
  assert.equal(failedRuns[0].message, 'run_not_terminal_after_nanobot_exit');
});

test('SchedulerService records classified agent exit before failing non-terminal run', async () => {
  const recordedEvents = [];
  const failedRuns = [];
  let releaseNanobot = null;
  let failRunResolve = null;
  const failRunDone = new Promise((resolve) => {
    failRunResolve = resolve;
  });

  const pool = {
    async query(sql) {
      if (sql.includes('from scheduled_jobs') && sql.includes('job_key = $1')) {
        return { rows: [] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const agentService = {
    async createRun(payload) {
      return { id: 61, runKey: payload.runKey, status: 'pending' };
    },
    async recordRunEvent(payload) {
      recordedEvents.push(payload);
      return { ok: true };
    },
    async runNanobotForSchedule() {
      await new Promise((resolve) => {
        releaseNanobot = resolve;
      });
      return { ok: true };
    },
    async getRunStatus() {
      return 'running';
    },
    async getLatestPhaseEvent() {
      return {
        eventType: 'phase_changed',
        payload: {
          phase: 'target_bound'
        }
      };
    },
    async runHasSubstantiveEvents() {
      return false;
    },
    async failReplacementRunsForRunId() {
      return { ok: true, failedRunIds: [] };
    },
    async completeRun() {
      throw new Error('completeRun should not be called');
    },
    async failRun(payload) {
      failedRuns.push(payload);
      failRunResolve();
      return { ok: true, status: 'failed' };
    }
  };

  const scheduler = new SchedulerService({ pool, agentService });
  await scheduler.triggerJobTask('健康顾问_B0047007', 'followup');

  releaseNanobot();
  await failRunDone;

  const classificationEvent = recordedEvents.find((event) => event.eventType === 'agent_exit_classified');
  assert.equal(classificationEvent.payload.classification, 'agent_exit_after_target_bound');
  assert.equal(failedRuns[0].message, 'run_not_terminal_after_nanobot_exit');
});

test('SchedulerService completes parent run when nanobot exits after explicit resume-ingest handoff', async () => {
  const recordedEvents = [];
  const completedRuns = [];
  let releaseNanobot = null;
  let completeRunResolve = null;
  const completeRunDone = new Promise((resolve) => {
    completeRunResolve = resolve;
  });

  const pool = {
    async query(sql) {
      if (sql.includes('from scheduled_jobs') && sql.includes('job_key = $1')) {
        return { rows: [] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const agentService = {
    async createRun(payload) {
      return { id: 71, runKey: payload.runKey, status: 'pending' };
    },
    async recordRunEvent(payload) {
      recordedEvents.push(payload);
      return { ok: true };
    },
    async runNanobotForSchedule() {
      await new Promise((resolve) => {
        releaseNanobot = resolve;
      });
      return { ok: true };
    },
    async getRunStatus() {
      return 'running';
    },
    async getLatestPhaseEvent() {
      return {
        eventType: 'context_snapshot_captured',
        payload: {
          phase: 'context_snapshot_captured'
        }
      };
    },
    async runHasSubstantiveEvents() {
      return false;
    },
    async runHasResumeIngestHandoff() {
      return true;
    },
    async failReplacementRunsForRunId() {
      return { ok: true, failedRunIds: [] };
    },
    async completeRun(payload) {
      completedRuns.push(payload);
      completeRunResolve();
      return { ok: true, status: 'completed' };
    },
    async failRun() {
      throw new Error('failRun should not be called after explicit handoff');
    }
  };

  const scheduler = new SchedulerService({ pool, agentService });
  await scheduler.triggerJobTask('健康顾问_B0047007', 'download');

  releaseNanobot();
  await completeRunDone;

  const classificationEvent = recordedEvents.find((event) => event.eventType === 'agent_exit_classified');
  assert.equal(classificationEvent.payload.classification, 'agent_exit_after_context_snapshot');
  assert.equal(classificationEvent.payload.hasSubstantiveWork, false);
  assert.equal(classificationEvent.payload.hasResumeIngestHandoff, true);
  assert.deepEqual(completedRuns, [{ runId: 71 }]);
});

test('SchedulerService rejects trigger when task lock is held', async () => {
  const taskLock = new TaskLock();
  taskLock.tryAcquire({ runId: 99, jobKey: 'other_job', taskType: 'source' });
  let runSequence = 80;

  const pool = {
    async query(sql) {
      if (sql.includes('from scheduled_jobs') && sql.includes('job_key = $1')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const agentService = {
    async createRun(payload) {
      runSequence += 1;
      return { id: runSequence, runKey: payload.runKey, status: 'pending' };
    }
  };

  const scheduler = new SchedulerService({ pool, agentService, taskLock });

  await assert.rejects(
    () => scheduler.triggerJobTask('健康顾问_B0047007', 'followup'),
    (err) => {
      assert.equal(err.message, 'task_already_running');
      assert.equal(err.holder.runId, 99);
      assert.equal(err.holder.jobKey, 'other_job');
      return true;
    }
  );

  assert.equal(taskLock.getHolder().runId, 99);
});

test('SchedulerService ticker still triggers another HR account when one HR lock is held', async () => {
  const taskLock = new TaskLock();
  const now = new Date();
  const duePayload = {
    intervalMinutes: 1,
    timeRanges: [{
      startHour: now.getHours(),
      startMinute: now.getMinutes(),
      endHour: now.getHours(),
      endMinute: now.getMinutes()
    }]
  };
  const triggeredScheduleIds = [];

  taskLock.tryAcquire({ runId: 99, jobKey: 'locked_job', taskType: 'source', hrAccountId: 1 });

  const scheduler = new SchedulerService({
    pool: { async query() { return { rows: [] }; } },
    agentService: {},
    taskLock
  });

  scheduler.listSchedules = async () => ([
    { id: 11, job_key: 'job-a', task_type: 'source', enabled: true, payload: duePayload, hr_account_id: 1, last_run_at: null },
    { id: 12, job_key: 'job-b', task_type: 'source', enabled: true, payload: duePayload, hr_account_id: 2, last_run_at: null }
  ]);
  scheduler.triggerSchedule = async (id) => {
    triggeredScheduleIds.push(id);
    return { ok: true };
  };

  scheduler.startTicker();
  await new Promise((resolve) => setTimeout(resolve, 20));
  scheduler.stopTicker();

  assert.deepEqual(triggeredScheduleIds, [12]);
});

test('SchedulerService ticker skips schedules outside explicitly configured work hours', async () => {
  const originalStart = process.env.WORK_HOURS_START;
  const originalEnd = process.env.WORK_HOURS_END;
  const currentHour = new Date().getHours();
  const nextStart = currentHour < 22 ? currentHour + 1 : 0;
  const nextEnd = currentHour < 21 ? currentHour + 2 : 1;
  const triggeredScheduleIds = [];

  process.env.WORK_HOURS_START = String(nextStart);
  process.env.WORK_HOURS_END = String(nextEnd);
  reloadConfig();

  try {
    const scheduler = new SchedulerService({
      pool: { async query() { return { rows: [] }; } },
      agentService: {}
    });

    scheduler.listSchedules = async () => ([
      { id: 11, job_key: 'job-a', task_type: 'source', enabled: true, payload: {}, hr_account_id: null, last_run_at: null }
    ]);
    scheduler.triggerSchedule = async (id) => {
      triggeredScheduleIds.push(id);
      return { ok: true };
    };

    scheduler.startTicker();
    await new Promise((resolve) => setTimeout(resolve, 20));
    scheduler.stopTicker();

    assert.deepEqual(triggeredScheduleIds, []);
  } finally {
    if (originalStart === undefined) {
      delete process.env.WORK_HOURS_START;
    } else {
      process.env.WORK_HOURS_START = originalStart;
    }

    if (originalEnd === undefined) {
      delete process.env.WORK_HOURS_END;
    } else {
      process.env.WORK_HOURS_END = originalEnd;
    }

    reloadConfig();
  }
});

test('SchedulerService releases task lock after execution completes', async () => {
  const taskLock = new TaskLock();
  let releaseNanobot = null;
  let completeResolve = null;
  const completeDone = new Promise((resolve) => {
    completeResolve = resolve;
  });

  const pool = {
    async query(sql) {
      if (sql.includes('from scheduled_jobs') && sql.includes('job_key = $1')) {
        return { rows: [] };
      }
      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const agentService = {
    async createRun(payload) {
      return { id: 90, runKey: payload.runKey, status: 'pending' };
    },
    async recordRunEvent() {
      return { ok: true };
    },
    async runNanobotForSchedule() {
      await new Promise((resolve) => {
        releaseNanobot = resolve;
      });
      return { ok: true };
    },
    async getRunStatus() {
      return 'completed';
    },
    async completeRun() {
      throw new Error('should not be called');
    },
    async failRun() {
      throw new Error('should not be called');
    }
  };

  const scheduler = new SchedulerService({ pool, agentService, taskLock });
  const result = await scheduler.triggerJobTask('健康顾问_B0047007', 'followup');

  assert.equal(result.ok, true);
  assert.equal(taskLock.isBusy(), true);
  assert.equal(taskLock.getHolder().runId, 90);

  // Override getRunStatus to resolve completeDone after lock release check
  agentService.getRunStatus = async () => {
    setTimeout(() => completeResolve(), 0);
    return 'completed';
  };

  releaseNanobot();
  await completeDone;
  // Give the finally block a tick to execute
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(taskLock.isBusy(), false);
});

test('SchedulerService stopRun aborts running task and finalizes scheduled run', async () => {
  const taskLock = new TaskLock();
  const queryCalls = [];
  let sourceLoopResolve = null;
  let sourceLoopSignal = null;

  const pool = {
    async query(sql, params = []) {
      queryCalls.push({ sql, params });

      if (sql.includes('from scheduled_jobs') && sql.includes('id = $1')) {
        return { rows: [{ id: 10, job_key: '测试岗位', task_type: 'source', payload: { targetCount: 3 }, hr_account_id: null }] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('insert into scheduled_job_runs')) {
        return { rows: [{ id: 20 }] };
      }

      if (sql.includes('update scheduled_job_runs')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('update scheduled_jobs')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('from sourcing_runs') && sql.includes('hr_account_id')) {
        return { rows: [{ hr_account_id: null }] };
      }

      return { rows: [] };
    }
  };

  const agentService = {
    async createRun(payload) {
      return { id: 100, runKey: payload.runKey, status: 'pending' };
    },
    async recordRunEvent() {
      return { ok: true };
    }
  };

  const sourceLoopService = {
    async run({ signal }) {
      sourceLoopSignal = signal;
      return new Promise((resolve) => {
        sourceLoopResolve = resolve;
      });
    }
  };

  const scheduler = new SchedulerService({ pool, agentService, sourceLoopService, taskLock });
  const result = await scheduler.triggerSchedule(10);

  assert.equal(result.ok, true);
  assert.equal(result.runId, 100);

  // Wait for the async loop to start
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(sourceLoopSignal, 'signal should be passed to source loop');
  assert.equal(sourceLoopSignal.aborted, false);

  // Stop the run
  const stopResult = await scheduler.stopRun(100);
  assert.equal(stopResult.ok, true);
  assert.equal(sourceLoopSignal.aborted, true);

  // Simulate the source loop responding to the abort
  sourceLoopResolve({ ok: false, stats: { greeted: 1 }, reason: 'manually_stopped' });
  await new Promise((r) => setTimeout(r, 50));

  // Verify scheduled_job_runs was marked as stopped
  const stoppedQuery = queryCalls.find((c) => c.sql.includes('update scheduled_job_runs') && c.sql.includes("'stopped'"));
  assert.ok(stoppedQuery, 'should update scheduled_job_runs status to stopped');

  // Verify scheduled_jobs.last_run_at was updated
  const lastRunAtQuery = queryCalls.find((c) => c.sql.includes('update scheduled_jobs') && c.sql.includes('last_run_at'));
  assert.ok(lastRunAtQuery, 'should update scheduled_jobs last_run_at');

  // Verify lock was released
  assert.equal(taskLock.isBusy(), false);
});

test('SchedulerService stopRun returns error for unknown runId', async () => {
  const scheduler = new SchedulerService({ pool: { async query() { return { rows: [] }; } }, agentService: {} });
  const result = await scheduler.stopRun(999);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_active_task');
});

test('SchedulerService releases task lock after execution fails', async () => {
  const taskLock = new TaskLock();
  let failResolve = null;
  const failDone = new Promise((resolve) => {
    failResolve = resolve;
  });

  const pool = {
    async query(sql) {
      if (sql.includes('from scheduled_jobs') && sql.includes('job_key = $1')) {
        return { rows: [] };
      }
      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const agentService = {
    async createRun(payload) {
      return { id: 91, runKey: payload.runKey, status: 'pending' };
    },
    async recordRunEvent() {
      return { ok: true };
    },
    async runNanobotForSchedule() {
      throw new Error('nanobot_crashed');
    },
    async failReplacementRunsForRunId() {
      return { ok: true, failedRunIds: [] };
    },
    async failRun() {
      failResolve();
      return { ok: true, status: 'failed' };
    }
  };

  const scheduler = new SchedulerService({ pool, agentService, taskLock });
  await scheduler.triggerJobTask('健康顾问_B0047007', 'followup');

  await failDone;
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(taskLock.isBusy(), false);
});

test('isInWorkWindow returns true when current time is inside a window', () => {
  const now = new Date();
  const currentHour = now.getHours();
  const windows = [{ start: `${String(currentHour).padStart(2, '0')}:00`, end: `${String(currentHour).padStart(2, '0')}:59` }];
  assert.equal(isInWorkWindow(windows, now), true);
});

test('isInWorkWindow returns false when current time is outside all windows', () => {
  const now = new Date();
  now.setHours(3, 0, 0, 0);
  const windows = [{ start: '09:00', end: '18:00' }];
  assert.equal(isInWorkWindow(windows, now), false);
});

test('isInWorkWindow returns true for empty windows (no restrictions)', () => {
  assert.equal(isInWorkWindow([], new Date()), true);
  assert.equal(isInWorkWindow(null, new Date()), true);
});

test('SchedulerService queue mode picks highest priority task with cooldown elapsed', async () => {
  const taskLock = new TaskLock();
  const now = new Date();
  const triggeredScheduleIds = [];

  const scheduler = new SchedulerService({
    pool: {
      async query(sql) {
        if (sql.includes('hr_account_work_config')) {
          return { rows: [{ hr_account_id: 1, work_windows: [{ start: '00:00', end: '23:59' }], enabled: true, queue_mode: 'priority' }] };
        }
        if (sql.includes('from scheduled_jobs')) {
          return { rows: [] };
        }
        if (sql.includes('from sourcing_runs') && sql.includes('current_date')) {
          return { rows: [{ count: '0' }] };
        }
        return { rows: [] };
      }
    },
    agentService: {},
    taskLock
  });

  scheduler.listSchedules = async () => ([
    { id: 1, job_key: 'job-a', task_type: 'source', enabled: true, payload: {}, hr_account_id: 1, last_run_at: null, priority: 3, cooldown_minutes: 60, daily_max_runs: 0 },
    { id: 2, job_key: 'job-a', task_type: 'followup', enabled: true, payload: {}, hr_account_id: 1, last_run_at: null, priority: 5, cooldown_minutes: 60, daily_max_runs: 0 },
    { id: 3, job_key: 'job-b', task_type: 'source', enabled: true, payload: {}, hr_account_id: 1, last_run_at: null, priority: 1, cooldown_minutes: 60, daily_max_runs: 0 }
  ]);
  scheduler.triggerSchedule = async (id) => {
    triggeredScheduleIds.push(id);
    return { ok: true };
  };

  scheduler.startTicker();
  await new Promise((resolve) => setTimeout(resolve, 20));
  scheduler.stopTicker();

  assert.deepEqual(triggeredScheduleIds, [3]);
});

test('SchedulerService queue mode skips tasks within cooldown period', async () => {
  const taskLock = new TaskLock();
  const now = new Date();
  const triggeredScheduleIds = [];

  const scheduler = new SchedulerService({
    pool: {
      async query(sql) {
        if (sql.includes('hr_account_work_config')) {
          return { rows: [{ hr_account_id: 1, work_windows: [{ start: '00:00', end: '23:59' }], enabled: true, queue_mode: 'priority' }] };
        }
        if (sql.includes('from scheduled_jobs')) {
          return { rows: [] };
        }
        if (sql.includes('from sourcing_runs') && sql.includes('current_date')) {
          return { rows: [{ count: '0' }] };
        }
        return { rows: [] };
      }
    },
    agentService: {},
    taskLock
  });

  const recentTime = new Date(now.getTime() - 10 * 60_000).toISOString();

  scheduler.listSchedules = async () => ([
    { id: 1, job_key: 'job-a', task_type: 'source', enabled: true, payload: {}, hr_account_id: 1, last_run_at: recentTime, priority: 1, cooldown_minutes: 60, daily_max_runs: 0 },
    { id: 2, job_key: 'job-b', task_type: 'source', enabled: true, payload: {}, hr_account_id: 1, last_run_at: null, priority: 5, cooldown_minutes: 60, daily_max_runs: 0 }
  ]);
  scheduler.triggerSchedule = async (id) => {
    triggeredScheduleIds.push(id);
    return { ok: true };
  };

  scheduler.startTicker();
  await new Promise((resolve) => setTimeout(resolve, 20));
  scheduler.stopTicker();

  assert.deepEqual(triggeredScheduleIds, [2]);
});

test('SchedulerService upsertSchedule persists priority and cooldown fields', async () => {
  let insertedParams = null;

  const pool = {
    async query(sql, params) {
      insertedParams = params;
      return { rows: [{ id: 1, job_key: 'test-job', task_type: 'source', priority: 2, cooldown_minutes: 30, daily_max_runs: 5 }] };
    }
  };

  const scheduler = new SchedulerService({ pool, agentService: {} });
  const result = await scheduler.upsertSchedule({
    jobKey: 'test-job',
    taskType: 'source',
    cronExpression: '',
    payload: {},
    enabled: true,
    hrAccountId: 1,
    priority: 2,
    cooldownMinutes: 30,
    dailyMaxRuns: 5
  });

  assert.equal(insertedParams[6], 2);
  assert.equal(insertedParams[7], 30);
  assert.equal(insertedParams[8], 5);
  assert.equal(result.priority, 2);
});
