class BootstrapService {
  constructor({ targetPool, sourcePool }) {
    this.targetPool = targetPool;
    this.sourcePool = sourcePool;
  }

  async syncFromSource() {
    const sourceClient = await this.sourcePool.connect();
    const targetClient = await this.targetPool.connect();

    try {
      await targetClient.query('begin');

      const jobsResult = await sourceClient.query(`
        select
          id,
          job_key,
          boss_encrypt_job_id,
          job_name,
          city,
          salary,
          status,
          source,
          jd_markdown as jd_text,
          sourcing_config as metadata,
          updated_at
        from jobs
        order by id
      `);

      const jobIdMap = new Map();

      for (const row of jobsResult.rows) {
        const upsertedJob = await targetClient.query(
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
              last_synced_at
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, '{}'::jsonb), now())
            on conflict (job_key) do update
            set boss_encrypt_job_id = excluded.boss_encrypt_job_id,
                job_name = excluded.job_name,
                city = excluded.city,
                salary = excluded.salary,
                status = excluded.status,
                source = excluded.source,
                jd_text = excluded.jd_text,
                sync_metadata = excluded.sync_metadata,
                last_synced_at = excluded.last_synced_at,
                updated_at = now()
            returning id
          `,
          [
            row.job_key,
            row.boss_encrypt_job_id,
            row.job_name,
            row.city,
            row.salary,
            row.status || 'open',
            row.source || 'boss',
            row.jd_text,
            row.metadata || {},
          ]
        );

        jobIdMap.set(row.id, upsertedJob.rows[0].id);
      }

      const candidatesResult = await sourceClient.query(`
        select
          c.*,
          j.job_key
        from candidates c
        join jobs j on j.id = c.job_id
        order by c.id
      `);

      const personIdMap = new Map();

      for (const row of candidatesResult.rows) {
        let personId = personIdMap.get(row.boss_encrypt_geek_id);

        if (!personId) {
          const personResult = await targetClient.query(
            `
              insert into people (
                boss_encrypt_geek_id,
                name,
                city,
                education,
                experience,
                school,
                profile_metadata
              )
              values ($1, $2, $3, $4, $5, $6, coalesce($7, '{}'::jsonb))
              on conflict (boss_encrypt_geek_id) do update
              set name = excluded.name,
                  city = excluded.city,
                  education = excluded.education,
                  experience = excluded.experience,
                  school = excluded.school,
                  profile_metadata = excluded.profile_metadata,
                  updated_at = now()
              returning id
            `,
            [
              row.boss_encrypt_geek_id,
              row.name,
              row.city,
              row.education,
              row.experience,
              row.school,
              row.metadata || {}
            ]
          );

          personId = personResult.rows[0].id;
          personIdMap.set(row.boss_encrypt_geek_id, personId);
        }

        await targetClient.query(
          `
            insert into job_candidates (
              job_id,
              person_id,
              lifecycle_status,
              resume_state,
              resume_path,
              resume_downloaded_at,
              last_outbound_at,
              last_inbound_at,
              notes,
              workflow_metadata
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, '{}'::jsonb))
            on conflict (job_id, person_id) do update
            set lifecycle_status = excluded.lifecycle_status,
                resume_state = excluded.resume_state,
                resume_path = excluded.resume_path,
                resume_downloaded_at = excluded.resume_downloaded_at,
                last_outbound_at = excluded.last_outbound_at,
                last_inbound_at = excluded.last_inbound_at,
                notes = excluded.notes,
                workflow_metadata = excluded.workflow_metadata,
                updated_at = now()
          `,
          [
            jobIdMap.get(row.job_id),
            personId,
            mapLifecycleStatus(row.status),
            row.resume_downloaded ? 'downloaded' : row.resume_path ? 'received' : 'not_requested',
            row.resume_path,
            row.resume_downloaded ? row.updated_at : null,
            row.greeted_at,
            row.last_message_at,
            row.notes,
            row.metadata || {}
          ]
        );
      }

      const statsResult = await sourceClient.query(`
        select
          j.job_key,
          d.stat_date,
          d.greetings_sent,
          d.responses_received,
          0 as resume_requested_count,
          d.resumes_downloaded as resume_received_count
        from daily_job_stats d
        join jobs j on j.id = d.job_id
      `);

      for (const row of statsResult.rows) {
        await targetClient.query(
          `
            insert into daily_job_stats (
              job_id,
              stat_date,
              greeted_count,
              responded_count,
              resume_requested_count,
              resume_received_count
            )
            values ($1, $2, $3, $4, $5, $6)
            on conflict (job_id, stat_date) do update
            set greeted_count = excluded.greeted_count,
                responded_count = excluded.responded_count,
                resume_requested_count = excluded.resume_requested_count,
                resume_received_count = excluded.resume_received_count,
                updated_at = now()
          `,
          [
            jobIdMap.get(findSourceJobIdByKey(jobsResult.rows, row.job_key)),
            row.stat_date,
            row.greeted_count || 0,
            row.responded_count || 0,
            row.resume_requested_count || 0,
            row.resume_received_count || 0
          ]
        );
      }

      await targetClient.query('commit');

      return {
        jobs: jobsResult.rowCount,
        candidates: candidatesResult.rowCount,
        stats: statsResult.rowCount
      };
    } catch (error) {
      await targetClient.query('rollback');
      throw error;
    } finally {
      sourceClient.release();
      targetClient.release();
    }
  }
}

function findSourceJobIdByKey(jobs, jobKey) {
  const match = jobs.find((job) => job.job_key === jobKey);
  return match?.id;
}

function mapLifecycleStatus(status) {
  const mapping = {
    greeted: 'greeted',
    responded: 'responded',
    resume_received: 'resume_received',
    resume_downloaded: 'resume_downloaded',
    rejected: 'rejected'
  };

  return mapping[status] || 'discovered';
}

module.exports = {
  BootstrapService
};
