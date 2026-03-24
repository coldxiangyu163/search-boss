class CandidateService {
  constructor({ pool }) {
    this.pool = pool;
  }

  async listCandidates({ jobKey, status }) {
    const values = [];
    const conditions = [];

    if (jobKey) {
      values.push(jobKey);
      conditions.push(`j.job_key = $${values.length}`);
    }

    if (status) {
      values.push(status);
      conditions.push(`jc.lifecycle_status = $${values.length}`);
    }

    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';

    const result = await this.pool.query(
      `
        select
          jc.id,
          j.job_key,
          j.job_name,
          p.boss_encrypt_geek_id,
          p.name,
          p.city,
          p.education,
          p.experience,
          p.school,
          jc.lifecycle_status,
          jc.guard_status,
          jc.resume_state,
          jc.resume_request_count,
          jc.id as candidate_id,
          jc.last_resume_requested_at,
          jc.last_inbound_at,
          jc.last_outbound_at,
          jc.resume_path,
          jc.notes
        from job_candidates jc
        join jobs j on j.id = jc.job_id
        join people p on p.id = jc.person_id
        ${whereClause}
        order by coalesce(jc.last_inbound_at, jc.updated_at) desc, jc.id desc
      `,
      values
    );

    return result.rows;
  }
}

module.exports = {
  CandidateService
};
