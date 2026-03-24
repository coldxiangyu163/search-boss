import { makeWorkerUtils, parseCronItems, run, runMigrations } from "graphile-worker";

function makeCronItems(rows) {
  return parseCronItems(
    rows.map((row) => ({
      task: "execute-scheduled-job",
      match: row.cron_expression,
      payload: {
        scheduledJobId: Number(row.id),
        triggerType: "schedule",
      },
    })),
  );
}

export function createSchedulerService({
  pool,
  pollInterval = 1000,
  eventBus,
  onExecuteScheduledJob,
}) {
  let runner = null;
  let workerUtils = null;

  async function getEnabledJobs() {
    const result = await pool.query(
      `
        SELECT id, cron_expression
        FROM scheduled_jobs
        WHERE is_enabled = TRUE
        ORDER BY id ASC
      `,
    );
    return result.rows;
  }

  async function ensureWorkerUtils() {
    if (!workerUtils) {
      workerUtils = await makeWorkerUtils({ pgPool: pool });
    }
    return workerUtils;
  }

  async function startRunner() {
    const enabledJobs = await getEnabledJobs();
    const parsedCronItems = makeCronItems(enabledJobs);

    runner = await run({
      pgPool: pool,
      pollInterval,
      noHandleSignals: true,
      taskList: {
        "execute-scheduled-job": async (payload) => {
          await onExecuteScheduledJob(payload);
        },
      },
      parsedCronItems,
    });
  }

  return {
    async start() {
      await runMigrations({ pgPool: pool });
      await ensureWorkerUtils();
      await startRunner();
    },

    async stop() {
      if (runner) {
        await runner.stop();
        runner = null;
      }

      if (workerUtils) {
        await workerUtils.release();
        workerUtils = null;
      }
    },

    async reload() {
      if (runner) {
        await runner.stop();
        runner = null;
      }
      await ensureWorkerUtils();
      await startRunner();
      eventBus?.emit({
        channel: "scheduler_reloaded",
        reloadedAt: new Date().toISOString(),
      });
    },

    async enqueueNow(scheduledJobId) {
      const utils = await ensureWorkerUtils();
      return utils.addJob("execute-scheduled-job", {
        scheduledJobId,
        triggerType: "manual",
      });
    },
  };
}
