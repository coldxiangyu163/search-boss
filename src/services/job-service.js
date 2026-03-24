class JobService {
  constructor({ pool, agentService }) {
    this.pool = pool;
    this.agentService = agentService;
  }

  async listJobs() {
    const result = await this.pool.query(`
      select
        j.id,
        j.job_key,
        j.job_name,
        j.city,
        j.salary,
        j.status,
        j.last_synced_at,
        count(jc.id)::int as candidate_count,
        count(*) filter (where jc.lifecycle_status = 'greeted')::int as greeted_count,
        count(*) filter (where jc.lifecycle_status in ('responded', 'resume_requested', 'resume_received', 'resume_downloaded'))::int as responded_count,
        count(*) filter (where jc.resume_state = 'downloaded')::int as resume_downloaded_count
      from jobs j
      left join job_candidates jc on jc.job_id = j.id
      group by j.id
      order by j.updated_at desc, j.id desc
    `);

    return result.rows;
  }

  async triggerSync() {
    if (!this.agentService) {
      throw new Error('agent_service_not_configured');
    }

    return {
      ok: true,
      ...(await this.#startSyncRun())
    };
  }

  async #startSyncRun() {
    const timestamp = new Date().toISOString();
    const runKey = `sync_jobs:__all__:${timestamp}`;
    const jobKey = await this.#resolveSyncAnchorJobKey();
    const run = await this.agentService.createRun({
      runKey,
      jobKey,
      mode: 'sync_jobs'
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

    await this.agentService.runNanobotForJobSync({ runId: run.id });

    return {
      runId: run.id,
      runKey: run.runKey,
      status: 'running',
      message: '职位同步任务已触发'
    };
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

    if (!result.rows[0]) {
      throw new Error('job_not_found');
    }

    return result.rows[0].job_key;
  }
}

module.exports = {
  JobService
};
