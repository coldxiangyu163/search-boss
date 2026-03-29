const test = require('node:test');
const assert = require('node:assert/strict');

const { SchedulerService } = require('../src/services/scheduler-service');

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
