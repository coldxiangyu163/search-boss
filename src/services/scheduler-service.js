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
    const schedule = await this.#findScheduleById(id);
    return this.#executeSchedule(schedule);
  }

  async triggerScheduleByJobTask(jobKey, taskType) {
    const schedule = await this.#findScheduleByJobTask(jobKey, taskType);
    return this.#executeSchedule(schedule);
  }

  async triggerJobTask(jobKey, taskType) {
    const schedule = await this.#findScheduleByJobTask(jobKey, taskType, { required: false });

    if (schedule) {
      return this.#executeSchedule(schedule);
    }

    return this.#executeJobTask({
      jobKey,
      taskType,
      scheduledJobId: null
    });
  }

  async #findScheduleById(id) {
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

    return schedule;
  }

  async #findScheduleByJobTask(jobKey, taskType, { required = true } = {}) {
    const scheduleResult = await this.pool.query(
      `
        select *
        from scheduled_jobs
        where job_key = $1
          and task_type = $2
        limit 1
      `,
      [jobKey, taskType]
    );

    const schedule = scheduleResult.rows[0];
    if (!schedule && required) {
      throw new Error('schedule_not_found');
    }

    return schedule;
  }

  async #executeSchedule(schedule) {
    return this.#executeJobTask({
      jobKey: schedule.job_key,
      taskType: schedule.task_type,
      scheduledJobId: schedule.id,
      schedule
    });
  }

  async #executeJobTask({ jobKey, taskType, scheduledJobId = null, schedule = null }) {
    const startedAt = new Date().toISOString();
    const run = await this.agentService.createRun({
      runKey: `${taskType}:${jobKey}:${Date.now()}`,
      jobKey,
      mode: taskType
    });

    await this.pool.query(
      `
        update sourcing_runs
        set status = 'running',
            started_at = $2,
            updated_at = now()
        where id = $1
      `,
      [run.id, startedAt]
    );

    await this.agentService.recordRunEvent({
      runId: run.id,
      eventId: `schedule-start:${scheduledJobId || 'manual'}:${run.id}`,
      occurredAt: startedAt,
      eventType: 'schedule_triggered',
      stage: 'bootstrap',
      message: `${taskType} triggered for ${jobKey}`,
      payload: {
        scheduledJobId,
        taskType,
        jobKey
      }
    });

    const scheduledRunId = schedule
      ? (await this.pool.query(
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
      )).rows[0].id
      : null;

    try {
      await this.agentService.runNanobotForSchedule({
        jobKey,
        mode: taskType
      });

      if (schedule) {
        await this.pool.query(
          `
            update scheduled_job_runs
            set status = 'completed',
                finished_at = now()
            where id = $1
          `,
          [scheduledRunId]
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
      }

      await this.agentService.completeRun({
        runId: run.id,
        eventId: `schedule-complete:${scheduledRunId || `manual:${run.id}`}`,
        occurredAt: new Date().toISOString(),
        payload: {
          scheduledJobId,
          taskType,
          jobKey
        }
      });
    } catch (error) {
      if (schedule) {
        await this.pool.query(
          `
            update scheduled_job_runs
            set status = 'failed',
                finished_at = now()
            where id = $1
          `,
          [scheduledRunId]
        );
      }

      await this.agentService.failRun({
        runId: run.id,
        eventId: `schedule-failed:${scheduledRunId || `manual:${run.id}`}`,
        occurredAt: new Date().toISOString(),
        message: error.message,
        payload: {
          scheduledJobId,
          taskType,
          jobKey
        }
      });

      throw error;
    }

    return {
      ok: true,
      scheduledRunId,
      runId: run.id,
      status: 'completed',
      taskType,
      jobKey,
      message: `${jobKey} 的 ${taskType} 任务已执行完成`
    };
  }
}

module.exports = {
  SchedulerService
};
