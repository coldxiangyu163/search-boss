class CandidateService {
  constructor({ pool }) {
    this.pool = pool;
  }

  async listCandidates({ jobKey, status, resumeState, keyword, page = 1, pageSize = 20 } = {}) {
    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    const offset = (normalizedPage - 1) * normalizedPageSize;
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

    if (resumeState) {
      values.push(resumeState);
      conditions.push(`jc.resume_state = $${values.length}`);
    }

    if (keyword) {
      values.push(`%${keyword.trim()}%`);
      conditions.push(`(
        coalesce(p.name, '') ilike $${values.length}
        or p.boss_encrypt_geek_id ilike $${values.length}
        or coalesce(j.job_name, '') ilike $${values.length}
      )`);
    }

    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';

    const countResult = await this.pool.query(
      `
        select count(*)::int as total
        from job_candidates jc
        join jobs j on j.id = jc.job_id
        join people p on p.id = jc.person_id
        ${whereClause}
      `,
      values
    );

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
          jc.notes,
          coalesce(jc.last_inbound_at, jc.last_outbound_at, jc.updated_at) as last_activity_at
        from job_candidates jc
        join jobs j on j.id = jc.job_id
        join people p on p.id = jc.person_id
        ${whereClause}
        order by coalesce(jc.last_inbound_at, jc.last_outbound_at, jc.updated_at) desc, jc.id desc
        limit $${values.length + 1}
        offset $${values.length + 2}
      `,
      [...values, normalizedPageSize, offset]
    );

    const total = countResult.rows[0]?.total || 0;

    return {
      items: result.rows,
      pagination: {
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total,
        totalPages: total ? Math.ceil(total / normalizedPageSize) : 0
      }
    };
  }

  async getCandidateDetail(candidateId) {
    const candidateResult = await this.pool.query(
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
          p.profile_metadata,
          jc.lifecycle_status,
          jc.guard_status,
          jc.resume_state,
          jc.resume_request_count,
          jc.last_resume_requested_at,
          jc.last_inbound_at,
          jc.last_outbound_at,
          jc.resume_received_at,
          jc.resume_downloaded_at,
          jc.resume_path,
          jc.next_followup_after,
          jc.notes,
          jc.workflow_metadata
        from job_candidates jc
        join jobs j on j.id = jc.job_id
        join people p on p.id = jc.person_id
        where jc.id = $1
        limit 1
      `,
      [candidateId]
    );

    const item = candidateResult.rows[0];
    if (!item) {
      return null;
    }

    const [messagesResult, actionsResult, attachmentsResult, relatedJobsResult] = await Promise.all([
      this.pool.query(
        `
          select
            id,
            direction,
            message_type,
            content_text,
            sent_at
          from candidate_messages
          where job_candidate_id = $1
          order by sent_at desc nulls last, id desc
        `,
        [candidateId]
      ),
      this.pool.query(
        `
          select
            id,
            action_type,
            payload,
            created_at
          from candidate_actions
          where job_candidate_id = $1
          order by created_at desc, id desc
        `,
        [candidateId]
      ),
      this.pool.query(
        `
          select
            id,
            file_name,
            mime_type,
            file_size,
            sha256,
            stored_path,
            status,
            downloaded_at,
            created_at
          from candidate_attachments
          where job_candidate_id = $1
          order by created_at desc, id desc
        `,
        [candidateId]
      ),
      this.pool.query(
        `
          select
            other.id,
            jobs.job_key,
            jobs.job_name,
            other.lifecycle_status,
            other.resume_state,
            other.updated_at
          from job_candidates current_candidate
          join job_candidates other on other.person_id = current_candidate.person_id and other.id <> current_candidate.id
          join jobs on jobs.id = other.job_id
          where current_candidate.id = $1
          order by other.updated_at desc, other.id desc
        `,
        [candidateId]
      )
    ]);

    return {
      ...item,
      messages: messagesResult.rows,
      actions: actionsResult.rows,
      attachments: attachmentsResult.rows,
      relatedJobs: relatedJobsResult.rows
    };
  }
}

module.exports = {
  CandidateService
};
