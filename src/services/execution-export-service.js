async function exportExecutionData({
  pool,
  jobKey = null,
  exportedAt = new Date().toISOString()
}) {
  const client = await pool.connect();

  try {
    const jobsResult = await client.query(
      `
        select
          job_key,
          boss_encrypt_job_id,
          job_name,
          city,
          salary,
          status,
          source,
          jd_text,
          custom_requirement,
          sync_metadata,
          last_synced_at,
          created_at,
          updated_at
        from jobs
        where ($1::text is null or job_key = $1)
        order by job_key
      `,
      [jobKey]
    );
    const runsResult = await client.query(
      `
        select
          sr.run_key,
          j.job_key,
          sr.mode,
          sr.status,
          sr.attempt_count,
          sr.started_at,
          sr.completed_at,
          sr.created_at,
          sr.updated_at
        from sourcing_runs sr
        left join jobs j on j.id = sr.job_id
        where ($1::text is null or j.job_key = $1)
        order by sr.id
      `,
      [jobKey]
    );
    const eventsResult = await client.query(
      `
        select
          sr.run_key,
          sre.attempt_id,
          sre.event_id,
          sre.sequence,
          sre.stage,
          sre.event_type,
          sre.message,
          sre.payload,
          sre.occurred_at,
          sre.created_at
        from sourcing_run_events sre
        join sourcing_runs sr on sr.id = sre.run_id
        left join jobs j on j.id = sr.job_id
        where ($1::text is null or j.job_key = $1)
        order by sre.id
      `,
      [jobKey]
    );
    const schedulesResult = await client.query(
      `
        select
          job_key,
          task_type,
          cron_expression,
          enabled,
          payload,
          last_run_at,
          created_at,
          updated_at
        from scheduled_jobs
        where ($1::text is null or job_key = $1)
        order by job_key, task_type
      `,
      [jobKey]
    );
    const scheduledRunsResult = await client.query(
      `
        select
          sj.job_key,
          sj.task_type,
          sr.run_key,
          sjr.status,
          sjr.started_at,
          sjr.finished_at,
          sjr.created_at
        from scheduled_job_runs sjr
        join scheduled_jobs sj on sj.id = sjr.scheduled_job_id
        left join sourcing_runs sr on sr.id = sjr.run_id
        where ($1::text is null or sj.job_key = $1)
        order by sjr.id
      `,
      [jobKey]
    );

    return {
      exportedAt,
      filter: {
        jobKey
      },
      jobs: jobsResult.rows,
      sourcingRuns: runsResult.rows,
      sourcingRunEvents: eventsResult.rows,
      scheduledJobs: schedulesResult.rows,
      scheduledJobRuns: scheduledRunsResult.rows
    };
  } finally {
    client.release();
  }
}

module.exports = {
  exportExecutionData
};
