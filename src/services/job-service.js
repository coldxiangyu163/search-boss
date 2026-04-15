class JobService {
  constructor({ pool, agentService }) {
    this.pool = pool;
    this.agentService = agentService;
  }

  async listJobs({ hrAccountId, departmentId, includeHrName } = {}) {
    const values = [];
    let whereClause = '';
    if (hrAccountId) {
      values.push(hrAccountId);
      whereClause = `where j.hr_account_id = $${values.length}`;
    } else if (departmentId) {
      values.push(departmentId);
      whereClause = `where j.hr_account_id in (select id from hr_accounts where department_id = $${values.length})`;
    }

    const hrJoin = includeHrName ? 'left join hr_accounts ha on ha.id = j.hr_account_id' : '';
    const hrSelect = includeHrName ? ', ha.name as hr_name' : '';

    const result = await this.pool.query(`
      select
        j.id,
        j.job_key,
        j.job_name,
        j.city,
        j.salary,
        j.status,
          coalesce(j.custom_requirement, null) as custom_requirement,
          coalesce(j.enterprise_knowledge, null) as enterprise_knowledge,
          j.recommend_filters,
        j.last_synced_at,
        count(jc.id)::int as candidate_count,
        count(*) filter (where jc.lifecycle_status = 'greeted')::int as greeted_count,
        count(*) filter (where jc.lifecycle_status in ('responded', 'resume_requested', 'resume_received', 'resume_downloaded'))::int as responded_count,
        count(*) filter (where jc.resume_state = 'downloaded')::int as resume_downloaded_count
        ${hrSelect}
      from jobs j
      left join job_candidates jc on jc.job_id = j.id
      ${hrJoin}
      ${whereClause}
      group by j.id ${includeHrName ? ', ha.name' : ''}
      order by j.updated_at desc, j.id desc
    `, values);

    return result.rows;
  }

  async getJobDetail(jobKey) {
    const result = await this.pool.query(
      `
        select
          j.id,
          j.job_key,
          j.boss_encrypt_job_id,
          j.job_name,
          j.city,
          j.salary,
          j.status,
          j.jd_text,
          coalesce(j.custom_requirement, null) as custom_requirement,
          coalesce(j.enterprise_knowledge, null) as enterprise_knowledge,
          j.recommend_filters,
          j.sync_metadata,
          j.last_synced_at,
          count(jc.id)::int as candidate_count,
          count(*) filter (where jc.lifecycle_status = 'greeted')::int as greeted_count,
          count(*) filter (where jc.lifecycle_status in ('responded', 'resume_requested', 'resume_received', 'resume_downloaded'))::int as responded_count,
          count(*) filter (where jc.resume_state = 'downloaded')::int as resume_downloaded_count
        from jobs j
        left join job_candidates jc on jc.job_id = j.id
        where j.job_key = $1
        group by j.id
        limit 1
      `,
      [jobKey]
    );

    return result.rows[0] || null;
  }

  async upsertJobsBatch({ runId, eventId, sequence, occurredAt, jobs = [], hrAccountId }) {
    const syncedAt = occurredAt || new Date().toISOString();

    let resolvedHrAccountId = hrAccountId || null;
    if (!resolvedHrAccountId && runId) {
      resolvedHrAccountId = await this._resolveHrAccountIdFromRun(runId);
    }

    for (const job of jobs) {
      const metadata = job.metadata || {};
      const resolvedJobKey = resolveJobKey(job);
      await this.pool.query(
        `
          insert into jobs (
            job_key,
            boss_encrypt_job_id,
            job_name,
            city,
            salary,
            status,
            source,
            jd_text,
            sync_metadata,
            last_synced_at,
            hr_account_id
          )
          values ($1, $2, $3, $4, $5, $6, 'boss', $7, coalesce($8, '{}'::jsonb), $9, $10)
          on conflict (boss_encrypt_job_id) do update
          set boss_encrypt_job_id = excluded.boss_encrypt_job_id,
              job_key = excluded.job_key,
              job_name = excluded.job_name,
              city = excluded.city,
              salary = excluded.salary,
              status = excluded.status,
              source = excluded.source,
              jd_text = excluded.jd_text,
              sync_metadata = excluded.sync_metadata,
              last_synced_at = excluded.last_synced_at,
              hr_account_id = case
                when jobs.hr_account_id is null then excluded.hr_account_id
                when exists (select 1 from hr_accounts where id = jobs.hr_account_id and status = 'active') then jobs.hr_account_id
                else excluded.hr_account_id
              end,
              updated_at = now()
          returning id
        `,
        [
          resolvedJobKey,
          job.encryptJobId || job.bossEncryptJobId || null,
          job.jobName,
          job.city || null,
          job.salary || null,
          job.status || 'open',
          job.jdText || job.jd_text || null,
          metadata,
          syncedAt,
          resolvedHrAccountId || null
        ]
      );
    }

    if (runId && this.agentService) {
      await this.agentService.recordRunEvent({
        runId,
        eventId: eventId || `jobs-batch:${runId}:${syncedAt}`,
        sequence,
        occurredAt: syncedAt,
        eventType: 'jobs_batch_synced',
        stage: 'sync',
        message: `synced ${jobs.length} jobs to local database`,
        payload: { syncedCount: jobs.length }
      });
    }

    return {
      ok: true,
      syncedCount: jobs.length,
      syncedAt
    };
  }

  async updateJobCustomRequirement(jobKey, customRequirement) {
    const normalizedRequirement = normalizeCustomRequirement(customRequirement);
    const result = await this.pool.query(
      `
        update jobs
        set custom_requirement = $2,
            updated_at = now()
        where job_key = $1
        returning
          id,
          job_key,
          boss_encrypt_job_id,
          job_name,
          city,
          salary,
          status,
          jd_text,
          custom_requirement,
          enterprise_knowledge,
          sync_metadata,
          last_synced_at
      `,
      [jobKey, normalizedRequirement]
    );

    return result.rows[0] || null;
  }

  async updateJobRecommendFilters(jobKey, recommendFilters) {
    const normalized = recommendFilters && typeof recommendFilters === 'object'
      ? recommendFilters
      : null;
    const result = await this.pool.query(
      `
        update jobs
        set recommend_filters = $2,
            updated_at = now()
        where job_key = $1
        returning
          id,
          job_key,
          boss_encrypt_job_id,
          job_name,
          city,
          salary,
          status,
          jd_text,
          custom_requirement,
          enterprise_knowledge,
          recommend_filters,
          sync_metadata,
          last_synced_at
      `,
      [jobKey, normalized ? JSON.stringify(normalized) : null]
    );

    return result.rows[0] || null;
  }

  async updateJobEnterpriseKnowledge(jobKey, enterpriseKnowledge) {
    const normalized = normalizeCustomRequirement(enterpriseKnowledge);
    const result = await this.pool.query(
      `
        update jobs
        set enterprise_knowledge = $2,
            updated_at = now()
        where job_key = $1
        returning
          id,
          job_key,
          boss_encrypt_job_id,
          job_name,
          city,
          salary,
          status,
          jd_text,
          custom_requirement,
          enterprise_knowledge,
          sync_metadata,
          last_synced_at
      `,
      [jobKey, normalized]
    );

    return result.rows[0] || null;
  }

  async triggerSync({ hrAccountId } = {}) {
    if (!this.agentService) {
      throw new Error('agent_service_not_configured');
    }

    return {
      ok: true,
      ...(await this.#startSyncRun({ hrAccountId }))
    };
  }

  async #startSyncRun({ hrAccountId } = {}) {
    const timestamp = new Date().toISOString();
    const runKey = `sync_jobs:__all__:${timestamp}`;
    const jobKey = await this.#resolveSyncAnchorJobKey();
    const run = await this.agentService.createRun({
      runKey,
      jobKey,
      mode: 'sync_jobs',
      hrAccountId
    });

    await this.agentService.recordRunEvent({
      runId: run.id,
      eventId: `job-sync:start:${run.id}`,
      occurredAt: timestamp,
      eventType: 'job_sync_requested',
      stage: 'bootstrap',
      message: 'job sync requested',
      payload: { scope: 'all_jobs' }
    });

    await this.pool.query(
      `
        update sourcing_runs
        set status = 'running',
            started_at = $2,
            updated_at = now()
        where id = $1
      `,
      [run.id, timestamp]
    );

    this.#executeSyncRun({ runId: run.id }).catch((err) => {
      console.error(`[job-service] executeSyncRun failed for run ${run.id}:`, err);
    });

    return {
      runId: run.id,
      runKey: run.runKey,
      status: 'running',
      message: '职位同步任务已触发'
    };
  }

  async #executeSyncRun({ runId }) {
    try {
      const syncResult = await this.agentService.runNanobotForJobSync({ runId });
      const runStatus = await this.agentService.getRunStatus?.(runId);
      if (isTerminalRunStatus(runStatus)) {
        return;
      }
      const hasPersistedJobs = await this.#hasJobsBatchSynced(runId);
      if (!hasPersistedJobs) {
        const fromOutput = detectJobsBatchSyncedFromOutput(syncResult);
        if (fromOutput) {
          console.warn(`[job-service] run ${runId}: no persisted jobs_batch_synced event found, but stdout suggests sync occurred — treating as success (unreliable)`);
        } else {
          throw new Error('job_sync_not_persisted');
        }
      }
      await this.agentService.completeRun({
        runId,
        eventId: `job-sync:complete:${runId}`,
        occurredAt: new Date().toISOString(),
        payload: { scope: 'all_jobs' }
      });
    } catch (error) {
      try {
        const runStatus = await this.agentService.getRunStatus?.(runId);
        if (isTerminalRunStatus(runStatus)) {
          return;
        }
        await this.agentService.failRun({
          runId,
          eventId: `job-sync:failed:${runId}`,
          occurredAt: new Date().toISOString(),
          message: error.message,
          payload: { scope: 'all_jobs' }
        });
      } catch (failError) {
        console.error('job sync failure recording failed', failError);
      }
    }
  }

  async #hasJobsBatchSynced(runId) {
    const result = await this.pool.query(
      `
        select id
        from sourcing_run_events
        where run_id = $1
          and event_type = 'jobs_batch_synced'
        order by id desc
        limit 1
      `,
      [runId]
    );

    return Boolean(result.rows[0]);
  }

  async #resolveSyncAnchorJobKey() {
    const result = await this.pool.query(
      `
        select job_key
        from jobs
        order by updated_at desc, id desc
        limit 1
      `
    );

    return result.rows[0]?.job_key || null;
  }

  async _resolveHrAccountIdFromRun(runId) {
    if (!runId) return null;
    try {
      const result = await this.pool.query(
        'select hr_account_id from sourcing_runs where id = $1 limit 1',
        [runId]
      );
      if (result.rows[0]?.hr_account_id) return result.rows[0].hr_account_id;
      const fallback = await this.pool.query(
        'select id from hr_accounts where status = $1 order by id limit 1',
        ['active']
      );
      return fallback.rows[0]?.id || null;
    } catch (_) {
      return null;
    }
  }
}

function detectJobsBatchSyncedFromOutput(syncResult) {
  const combinedOutput = [syncResult?.stdout, syncResult?.stderr]
    .filter(Boolean)
    .join('\n');

  if (!combinedOutput) {
    return false;
  }

  return /jobs_batch_synced/.test(combinedOutput);
}

function isTerminalRunStatus(status) {
  return status === 'completed' || status === 'failed';
}

function resolveJobKey(job) {
  const jobName = String(job.jobName || '').trim();
  const rawJobKey = String(job.jobKey || '').trim();
  const encryptJobId = String(job.encryptJobId || job.bossEncryptJobId || '').trim();

  if (!encryptJobId) {
    throw new Error('boss_encrypt_job_id_missing');
  }

  if (rawJobKey) {
    return rawJobKey;
  }

  if (!jobName) {
    throw new Error('job_identity_incomplete');
  }

  return `${jobName}_${encryptJobId.slice(0, 8)}`;
}

module.exports = {
  JobService
};

function normalizeCustomRequirement(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}
