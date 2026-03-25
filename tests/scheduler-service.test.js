const test = require('node:test');
const assert = require('node:assert/strict');

const { SchedulerService } = require('../src/services/scheduler-service');

test('SchedulerService triggerJobTask returns immediately and completes manual task asynchronously', async () => {
  const queryCalls = [];
  const nanobotCalls = [];
  const recordedEvents = [];
  const completedRuns = [];
  let releaseNanobot = null;
  let completeRunResolve = null;
  const completeRunDone = new Promise((resolve) => {
    completeRunResolve = resolve;
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
    async completeRun(payload) {
      completedRuns.push(payload);
      completeRunResolve();
      return { ok: true, status: 'completed' };
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
  assert.equal(completedRuns.length, 0);

  releaseNanobot();
  await completeRunDone;

  assert.equal(completedRuns[0].payload.scheduledJobId, null);
});
