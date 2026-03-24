class SchedulerService {
  constructor({ pool, agentService }) {
    this.pool = pool;
    this.agentService = agentService;
  }

  async listSchedules() {
    const result = await this.pool.query(`
      select
        id,
        job_key,
        task_type,
        cron_expression,
        enabled,
        payload,
        last_run_at,
        updated_at
      from scheduled_jobs
      order by updated_at desc, id desc
    `);

    return result.rows;
  }

  async upsertSchedule({ jobKey, taskType, cronExpression, payload = {}, enabled = true }) {
    const result = await this.pool.query(
      `
        insert into scheduled_jobs (
          job_key,
          task_type,
          cron_expression,
          payload,
          enabled
        )
        values ($1, $2, $3, $4, $5)
        on conflict (job_key, task_type) do update
        set cron_expression = excluded.cron_expression,
            payload = excluded.payload,
            enabled = excluded.enabled,
            updated_at = now()
        returning *
      `,
      [jobKey, taskType, cronExpression, payload, enabled]
    );

    return result.rows[0];
  }

  async triggerSchedule(id) {
    const scheduleResult = await this.pool.query(
      `
        select *
        from scheduled_jobs
        where id = $1
        limit 1
      `,
      [id]
    );

    const schedule = scheduleResult.rows[0];
    if (!schedule) {
      throw new Error('schedule_not_found');
    }

    const run = await this.agentService.createRun({
      runKey: `${schedule.task_type}:${schedule.job_key}:${Date.now()}`,
      jobKey: schedule.job_key,
      mode: schedule.task_type
    });

    const scheduledRunResult = await this.pool.query(
      `
        insert into scheduled_job_runs (
          scheduled_job_id,
          run_id,
          status,
          started_at
        )
        values ($1, $2, 'running', now())
        returning id
      `,
      [schedule.id, run.id]
    );

    try {
      await this.agentService.runNanobotForSchedule({
        jobKey: schedule.job_key,
        mode: schedule.task_type
      });

      await this.pool.query(
        `
          update scheduled_job_runs
          set status = 'completed',
              finished_at = now()
          where id = $1
        `,
        [scheduledRunResult.rows[0].id]
      );

      await this.pool.query(
        `
          update scheduled_jobs
          set last_run_at = now(),
              updated_at = now()
          where id = $1
        `,
        [schedule.id]
      );

      await this.agentService.completeRun({
        runId: run.id,
        eventId: `schedule-complete:${scheduledRunResult.rows[0].id}`,
        occurredAt: new Date().toISOString()
      });
    } catch (error) {
      await this.pool.query(
        `
          update scheduled_job_runs
          set status = 'failed',
              finished_at = now()
          where id = $1
        `,
        [scheduledRunResult.rows[0].id]
      );

      throw error;
    }

    return {
      ok: true,
      scheduledRunId: scheduledRunResult.rows[0].id,
      runId: run.id
    };
  }
}

module.exports = {
  SchedulerService
};
