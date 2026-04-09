class SchedulerService {
  constructor({ pool, agentService, sourceLoopService = null, followupLoopService = null, taskLock = null, browserInstanceManager = null }) {
    this.pool = pool;
    this.agentService = agentService;
    this.sourceLoopService = sourceLoopService;
    this.followupLoopService = followupLoopService;
    this.taskLock = taskLock;
    this.browserInstanceManager = browserInstanceManager;
    this._tickTimer = null;
    this._abortControllers = new Map();
  }

  async listSchedules({ hrAccountId } = {}) {
    const values = [];
    let whereClause = '';
    if (hrAccountId) {
      values.push(hrAccountId);
      whereClause = `where hr_account_id = $${values.length}`;
    }

    const result = await this.pool.query(`
      select
        id,
        job_key,
        task_type,
        cron_expression,
        enabled,
        payload,
        last_run_at,
        updated_at,
        hr_account_id
      from scheduled_jobs
      ${whereClause}
      order by updated_at desc, id desc
    `, values);

    return result.rows;
  }

  async upsertSchedule({ jobKey, taskType, cronExpression, payload = {}, enabled = true, hrAccountId }) {
    const result = await this.pool.query(
      `
        insert into scheduled_jobs (
          job_key,
          task_type,
          cron_expression,
          payload,
          enabled,
          hr_account_id
        )
        values ($1, $2, $3, $4, $5, $6)
        on conflict (job_key, task_type, coalesce(hr_account_id, 0)) do update
        set cron_expression = excluded.cron_expression,
            payload = excluded.payload,
            enabled = excluded.enabled,
            updated_at = now()
        returning *
      `,
      [jobKey, taskType, cronExpression, payload, enabled, hrAccountId || null]
    );

    return result.rows[0];
  }

  async deleteSchedule(id) {
    const result = await this.pool.query(
      `delete from scheduled_jobs where id = $1 returning *`,
      [id]
    );

    if (!result.rows[0]) {
      throw new Error('schedule_not_found');
    }

    return result.rows[0];
  }

  async toggleSchedule(id, enabled) {
    const result = await this.pool.query(
      `update scheduled_jobs set enabled = $2, updated_at = now() where id = $1 returning *`,
      [id, enabled]
    );

    if (!result.rows[0]) {
      throw new Error('schedule_not_found');
    }

    return result.rows[0];
  }

  startTicker() {
    if (this._tickTimer) return;
    this._tickTimer = setInterval(() => this.#tick(), 60_000);
    this.#tick();
  }

  stopTicker() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  async #tick() {
    try {
      const schedules = await this.listSchedules();
      const now = new Date();

      for (const schedule of schedules) {
        if (!schedule.enabled) continue;

        const hrAccountId = schedule.hr_account_id || null;
        if (this.taskLock?.isBusy(hrAccountId)) {
          const holder = this.taskLock.getHolder(hrAccountId);
          console.log(`[scheduler] schedule ${schedule.id} skipped: lock held by run ${holder?.runId} (${holder?.jobKey}/${holder?.taskType}) for hr_account ${hrAccountId || 'global'}`);
          continue;
        }

        if (this.#shouldRunNow(schedule, now)) {
          try {
            await this.triggerSchedule(schedule.id);
          } catch (triggerError) {
            if (triggerError.message === 'task_already_running') continue;
            console.error(`[scheduler] trigger failed for schedule ${schedule.id} (${schedule.job_key}/${schedule.task_type}):`, triggerError);
          }
        }
      }
    } catch (tickError) {
      console.error('[scheduler] tick failed:', tickError);
    }
  }

  #shouldRunNow(schedule, now) {
    const payload = schedule.payload || {};
    const hasTimeRanges = payload.timeRanges && payload.timeRanges.length > 0;
    const hasPayloadInterval = payload.intervalMinutes && payload.intervalMinutes > 0;

    const cron = schedule.cron_expression;
    if (cron && cron.trim() && !hasTimeRanges && !hasPayloadInterval) {
      if (!matchesCronExpression(cron, now)) return false;
      if (schedule.last_run_at) {
        const elapsedMs = now.getTime() - new Date(schedule.last_run_at).getTime();
        if (elapsedMs < 59_000) return false;
      }
      return true;
    }

    const intervalMinutes = payload.intervalMinutes ?? 0;

    if (!intervalMinutes || intervalMinutes <= 0) return false;

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    const timeRanges = payload.timeRanges && payload.timeRanges.length
      ? payload.timeRanges
      : [{ startHour: payload.startHour ?? 0, startMinute: payload.startMinute ?? 0, endHour: 23, endMinute: 59 }];

    let inRange = false;
    for (const range of timeRanges) {
      const rangeStart = (range.startHour ?? 0) * 60 + (range.startMinute ?? 0);
      const rangeEnd = (range.endHour ?? 23) * 60 + (range.endMinute ?? 59);
      if (currentTotalMinutes >= rangeStart && currentTotalMinutes <= rangeEnd) {
        const minutesSinceRangeStart = currentTotalMinutes - rangeStart;
        if (minutesSinceRangeStart % intervalMinutes === 0) {
          inRange = true;
          break;
        }
      }
    }

    if (!inRange) return false;

    if (schedule.last_run_at) {
      const lastRun = new Date(schedule.last_run_at);
      const elapsedMs = now.getTime() - lastRun.getTime();
      if (elapsedMs < (intervalMinutes - 1) * 60_000) return false;
    }

    return true;
  }

  async stopRun(runId) {
    const ac = this._abortControllers.get(runId);
    if (!ac) {
      return { ok: false, reason: 'no_active_task', message: '未找到正在执行的任务' };
    }
    ac.abort();
    return { ok: true, runId, message: '已发送停止信号，任务将在当前步骤完成后停止' };
  }

  async triggerSchedule(id) {
    const schedule = await this.#findScheduleById(id);
    return this.#startJobTask({
      jobKey: schedule.job_key,
      taskType: schedule.task_type,
      schedule
    });
  }

  async triggerScheduleByJobTask(jobKey, taskType) {
    const schedule = await this.#findScheduleByJobTask(jobKey, taskType);
    return this.#startJobTask({
      jobKey: schedule.job_key,
      taskType: schedule.task_type,
      schedule
    });
  }

  async triggerJobTask(jobKey, taskType, { hrAccountId } = {}) {
    const schedule = await this.#findScheduleByJobTask(jobKey, taskType, { required: false });

    return this.#startJobTask({
      jobKey,
      taskType,
      schedule,
      hrAccountId
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

  async #startJobTask({ jobKey, taskType, schedule = null, hrAccountId }) {
    const scheduledJobId = schedule?.id || null;
    const resolvedHrAccountId = hrAccountId || schedule?.hr_account_id || null;
    const startedAt = new Date().toISOString();
    const run = await this.agentService.createRun({
      runKey: `${taskType}:${jobKey}:${Date.now()}`,
      jobKey,
      mode: taskType,
      hrAccountId: resolvedHrAccountId
    });

    if (this.taskLock && !this.taskLock.tryAcquire({ runId: run.id, jobKey, taskType, hrAccountId: resolvedHrAccountId })) {
      const holder = this.taskLock.getHolder(resolvedHrAccountId);
      const err = new Error('task_already_running');
      err.holder = holder;
      throw err;
    }

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

    const abortController = new AbortController();
    this._abortControllers.set(Number(run.id), abortController);

    this.#executeJobTask({
      runId: run.id,
      jobKey,
      taskType,
      scheduledJobId,
      scheduledRunId,
      schedule,
      signal: abortController.signal
    }).catch((err) => {
      console.error(`[scheduler] executeJobTask failed for run ${run.id} (${jobKey}/${taskType}):`, err);
    });

    return {
      ok: true,
      scheduledRunId,
      runId: run.id,
      status: 'running',
      taskType,
      jobKey,
      message: `${jobKey} 的 ${taskType} 任务已触发`
    };
  }

  async #executeJobTask({ runId, jobKey, taskType, scheduledJobId = null, scheduledRunId = null, schedule = null, signal = null }) {
    const schedulePayload = schedule?.payload || {};
    let resolvedInstance = null;
    try {
      let runnerOverride = null;
      if (this.browserInstanceManager) {
        const run = await this.pool.query('select hr_account_id from sourcing_runs where id = $1', [runId]);
        const hrAccountId = run.rows[0]?.hr_account_id;
        if (hrAccountId) {
          const { runner, instanceId } = await this.browserInstanceManager.acquireRunner({ hrAccountId, runId });
          runnerOverride = runner;
          resolvedInstance = instanceId;
          if (instanceId) {
            await this.pool.query(
              'update sourcing_runs set browser_instance_id = $2, updated_at = now() where id = $1',
              [runId, instanceId]
            );
          }
        }
      }

      if (taskType === 'source' && this.sourceLoopService) {
        const overrides = {};
        if (schedulePayload.targetCount) overrides.targetCount = schedulePayload.targetCount;
        if (schedulePayload.recommendTab) overrides.recommendTab = schedulePayload.recommendTab;
        if (runnerOverride) overrides.bossCliRunner = runnerOverride;
        const loopResult = await this.sourceLoopService.run({ runId, jobKey, signal, ...overrides });
        if (loopResult?.reason === 'manually_stopped') {
          await this.#finalizeStoppedScheduledRun({ schedule, scheduledRunId });
        } else {
          await this.#finalizeScheduledRun({ schedule, scheduledRunId, scheduledJobId });
        }
        return;
      }

      if ((taskType === 'followup' || taskType === 'chat' || taskType === 'download') && this.followupLoopService) {
        const overrides = {};
        if (schedulePayload.maxThreads) overrides.maxThreads = schedulePayload.maxThreads;
        if (Array.isArray(schedulePayload.interactionTypes) && schedulePayload.interactionTypes.length > 0) {
          overrides.interactionTypes = schedulePayload.interactionTypes;
        }
        if (runnerOverride) overrides.bossCliRunner = runnerOverride;
        const loopResult = await this.followupLoopService.run({ runId, jobKey, mode: taskType, signal, ...overrides });
        if (loopResult?.reason === 'manually_stopped') {
          await this.#finalizeStoppedScheduledRun({ schedule, scheduledRunId });
        } else {
          await this.#finalizeScheduledRun({ schedule, scheduledRunId, scheduledJobId });
        }
        return;
      }

      await this.agentService.runNanobotForSchedule({
        runId,
        jobKey,
        mode: taskType
      });

      const runStatus = await this.agentService.getRunStatus(runId);

      if (runStatus === 'failed') {
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

        return;
      }

      if (runStatus !== 'completed') {
        const latestPhaseEvent = typeof this.agentService.getLatestPhaseEvent === 'function'
          ? await this.agentService.getLatestPhaseEvent(runId)
          : null;
        const hasSubstantiveWork = typeof this.agentService.runHasSubstantiveEvents === 'function'
          ? await this.agentService.runHasSubstantiveEvents(runId)
          : false;
        const hasResumeIngestHandoff = typeof this.agentService.runHasResumeIngestHandoff === 'function'
          ? await this.agentService.runHasResumeIngestHandoff(runId)
          : false;

        await this.agentService.recordRunEvent({
          runId,
          eventId: `agent-exit-classified:${runId}`,
          occurredAt: new Date().toISOString(),
          eventType: 'agent_exit_classified',
          stage: 'scheduler',
          message: 'agent exit classified after non-terminal nanobot exit',
          payload: {
            classification: classifyAgentExit(latestPhaseEvent),
            hasSubstantiveWork,
            hasResumeIngestHandoff,
            latestPhaseEvent
          }
        });

        if (hasSubstantiveWork || hasResumeIngestHandoff) {
          await this.agentService.completeRun({ runId });
        } else {
          await this.agentService.failRun({
            runId,
            message: 'run_not_terminal_after_nanobot_exit'
          });
        }
        return;
      }

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
    } catch (error) {
      await this.agentService.failReplacementRunsForRunId({
        runId,
        occurredAt: new Date().toISOString(),
        message: error.message
      });

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
        runId,
        eventId: `schedule-failed:${scheduledRunId || `manual:${runId}`}`,
        occurredAt: new Date().toISOString(),
        message: error.message,
        payload: {
          scheduledJobId,
          taskType,
          jobKey
        }
      });
    } finally {
      this._abortControllers.delete(Number(runId));
      if (resolvedInstance && this.browserInstanceManager) {
        await this.browserInstanceManager.releaseInstance(resolvedInstance).catch(() => {});
      }
      this.taskLock?.release(runId);
    }
  }

  async #finalizeStoppedScheduledRun({ schedule, scheduledRunId }) {
    if (!schedule) {
      return;
    }

    if (scheduledRunId) {
      await this.pool.query(
        `
          update scheduled_job_runs
          set status = 'stopped',
              finished_at = now()
          where id = $1
        `,
        [scheduledRunId]
      );
    }

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

  async #finalizeScheduledRun({ schedule, scheduledRunId }) {
    if (!schedule) {
      return;
    }

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
}

function matchesCronExpression(cronExpression, date) {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return matchesCronField(minute, date.getMinutes())
    && matchesCronField(hour, date.getHours())
    && matchesCronField(dayOfMonth, date.getDate())
    && matchesCronField(month, date.getMonth() + 1)
    && matchesCronField(dayOfWeek, date.getDay());
}

function matchesCronField(field, value) {
  if (field === '*') return true;

  if (field.includes(',')) {
    return field.split(',').some((part) => matchesCronField(part.trim(), value));
  }

  if (field.includes('/')) {
    const [range, step] = field.split('/');
    const stepNum = parseInt(step, 10);
    if (isNaN(stepNum) || stepNum <= 0) return false;
    if (range === '*') return value % stepNum === 0;
    const start = parseInt(range, 10);
    return value >= start && (value - start) % stepNum === 0;
  }

  if (field.includes('-')) {
    const [from, to] = field.split('-').map(Number);
    return value >= from && value <= to;
  }

  return parseInt(field, 10) === value;
}

function classifyAgentExit(latestPhaseEvent) {
  const phase = latestPhaseEvent?.payload?.phase || latestPhaseEvent?.eventType || '';

  if (!phase) {
    return 'agent_exit_before_bootstrap';
  }

  if (phase === 'target_bound') {
    return 'agent_exit_after_target_bound';
  }

  if (phase === 'context_snapshot_captured' || latestPhaseEvent?.eventType === 'context_snapshot_captured') {
    return 'agent_exit_after_context_snapshot';
  }

  return `agent_exit_after_${String(phase)}`;
}

module.exports = {
  SchedulerService,
  matchesCronExpression
};
