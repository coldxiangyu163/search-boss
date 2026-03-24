class JobService {
  constructor({ pool }) {
    this.pool = pool;
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

  async syncJobsFromSource() {
    const result = await this.pool.query(`
      update jobs
      set last_synced_at = now(),
          updated_at = now()
      where source = 'boss'
      returning id
    `);

    return {
      syncedCount: result.rowCount,
      syncedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  JobService
};
