class AgentService {
  constructor({ pool, nanobotRunner = null }) {
    this.pool = pool;
    this.nanobotRunner = nanobotRunner;
  }

  async createRun({ runKey, jobKey, mode }) {
    const jobResult = await this.pool.query(
      `
        select id
        from jobs
        where job_key = $1
        limit 1
      `,
      [jobKey]
    );

    if (!jobResult.rows[0]) {
      throw new Error('job_not_found');
    }

    const runResult = await this.pool.query(
      `
        insert into sourcing_runs (run_key, job_id, mode, status)
        values ($1, $2, $3, 'pending')
        on conflict (run_key) do update
        set mode = excluded.mode,
            updated_at = now()
        returning id, run_key as "runKey", status
      `,
      [runKey, jobResult.rows[0].id, mode]
    );

    return runResult.rows[0];
  }

  async recordRunEvent({
    runId,
    attemptId,
    eventId,
    sequence,
    occurredAt,
    eventType,
    stage,
    message,
    payload = {}
  }) {
    await this.pool.query(
      `
        insert into sourcing_run_events (
          run_id,
          attempt_id,
          event_id,
          sequence,
          stage,
          event_type,
          message,
          payload,
          occurred_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (run_id, event_id) do nothing
      `,
      [runId, attemptId || null, eventId, sequence || null, stage || null, eventType, message || eventType, payload, occurredAt || new Date().toISOString()]
    );

    return { ok: true };
  }

  async completeRun({ runId, eventId, attemptId, sequence, occurredAt, payload = {} }) {
    await this.pool.query(
      `
        update sourcing_runs
        set status = 'completed',
            completed_at = $2,
            updated_at = now()
        where id = $1
      `,
      [runId, occurredAt || new Date().toISOString()]
    );

    if (eventId) {
      await this.recordRunEvent({
        runId,
        attemptId,
        eventId,
        sequence,
        occurredAt,
        eventType: 'run_completed',
        stage: 'complete',
        message: 'run completed',
        payload
      });
    }

    return {
      ok: true,
      status: 'completed'
    };
  }

  async recordAction({
    runId,
    attemptId,
    eventId,
    sequence,
    occurredAt,
    actionType,
    dedupeKey,
    bossEncryptGeekId,
    payload = {}
  }) {
    const candidateResult = await this.pool.query(
      `
        select
          jc.id,
          jc.resume_state,
          jc.last_resume_requested_at,
          jc.resume_request_count
        from job_candidates jc
        join people p on p.id = jc.person_id
        where p.boss_encrypt_geek_id = $1
        order by jc.updated_at desc
        limit 1
      `,
      [bossEncryptGeekId]
    );

    if (!candidateResult.rows[0]) {
      throw new Error('candidate_not_found');
    }

    const jobCandidate = candidateResult.rows[0];

    const actionResult = await this.pool.query(
      `
        insert into candidate_actions (job_candidate_id, action_type, dedupe_key, payload)
        values ($1, $2, $3, $4)
        on conflict (dedupe_key) do nothing
        returning id
      `,
      [jobCandidate.id, actionType, dedupeKey, payload]
    );

    if (actionResult.rows[0] && actionType === 'resume_request_sent') {
      await this.pool.query(
        `
          update job_candidates
          set lifecycle_status = 'resume_requested',
              resume_state = 'requested',
              last_resume_requested_at = $2,
              resume_request_count = resume_request_count + 1,
              last_outbound_at = $2,
              updated_at = now()
          where id = $1
        `,
        [jobCandidate.id, occurredAt]
      );
    }

    if (runId) {
      await this.pool.query(
        `
          insert into sourcing_run_events (
            run_id,
            attempt_id,
            event_id,
            sequence,
            stage,
            event_type,
            message,
            payload,
            occurred_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          on conflict (run_id, event_id) do nothing
        `,
        [
          runId,
          attemptId || null,
          eventId,
          sequence || null,
          'agent_action',
          actionType,
          actionType,
          payload,
          occurredAt || new Date().toISOString()
        ]
      );
    }

    return {
      ok: true,
      actionId: actionResult.rows[0]?.id || null,
      duplicated: !actionResult.rows[0]
    };
  }

  async getFollowupDecision(candidateId) {
    const result = await this.pool.query(
      `
        select
          id,
          lifecycle_status,
          guard_status,
          resume_state,
          last_resume_requested_at,
          last_inbound_at,
          last_outbound_at
        from job_candidates
        where id = $1
      `,
      [candidateId]
    );

    const candidate = result.rows[0];
    if (!candidate) {
      throw new Error('candidate_not_found');
    }

    if (candidate.guard_status !== 'active') {
      return {
        candidateId,
        allowed: false,
        reason: candidate.guard_status,
        cooldownRemainingMinutes: null,
        recommendedAction: 'manual_review'
      };
    }

    if (candidate.resume_state === 'downloaded' || candidate.resume_state === 'received') {
      return {
        candidateId,
        allowed: false,
        reason: 'resume_already_received',
        cooldownRemainingMinutes: null,
        recommendedAction: 'stop'
      };
    }

    if (candidate.last_resume_requested_at) {
      const cooldownEndsAt = new Date(candidate.last_resume_requested_at).getTime() + 30 * 60 * 1000;
      const remainingMs = cooldownEndsAt - Date.now();

      if (remainingMs > 0) {
        return {
          candidateId,
          allowed: false,
          reason: 'cooldown_active',
          cooldownRemainingMinutes: Math.ceil(remainingMs / 60000),
          recommendedAction: 'wait'
        };
      }
    }

    return {
      candidateId,
      allowed: true,
      reason: 'eligible',
      cooldownRemainingMinutes: 0,
      recommendedAction: 'resume_request'
    };
  }

  async recordMessage({
    runId,
    attemptId,
    eventId,
    sequence,
    occurredAt,
    bossEncryptGeekId,
    bossMessageId,
    direction,
    messageType,
    contentText,
    rawPayload = {}
  }) {
    const candidate = await this.findLatestCandidateByGeekId(bossEncryptGeekId);
    if (!candidate) {
      throw new Error('candidate_not_found');
    }

    const result = await this.pool.query(
      `
        insert into candidate_messages (
          job_candidate_id,
          boss_message_id,
          direction,
          message_type,
          content_text,
          sent_at,
          raw_payload
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (job_candidate_id, boss_message_id) do nothing
        returning id
      `,
      [
        candidate.id,
        bossMessageId,
        direction,
        messageType || 'text',
        contentText || null,
        occurredAt || new Date().toISOString(),
        rawPayload
      ]
    );

    if (direction === 'inbound') {
      await this.pool.query(
        `
          update job_candidates
          set lifecycle_status = case
                when lifecycle_status in ('resume_received', 'resume_downloaded') then lifecycle_status
                else 'responded'
              end,
              last_inbound_at = $2,
              updated_at = now()
          where id = $1
        `,
        [candidate.id, occurredAt || new Date().toISOString()]
      );
    }

    await this.insertRunEvent({
      runId,
      attemptId,
      eventId,
      sequence,
      eventType: 'message_recorded',
      payload: {
        bossMessageId,
        direction
      },
      occurredAt
    });

    return {
      ok: true,
      messageId: result.rows[0]?.id || null,
      duplicated: !result.rows[0]
    };
  }

  async recordAttachment({
    runId,
    attemptId,
    eventId,
    sequence,
    occurredAt,
    bossEncryptGeekId,
    bossAttachmentId,
    fileName,
    mimeType,
    fileSize,
    sha256,
    storedPath,
    status
  }) {
    const candidate = await this.findLatestCandidateByGeekId(bossEncryptGeekId);
    if (!candidate) {
      throw new Error('candidate_not_found');
    }

    const result = await this.pool.query(
      `
        insert into candidate_attachments (
          job_candidate_id,
          boss_attachment_id,
          file_name,
          mime_type,
          file_size,
          sha256,
          stored_path,
          status,
          downloaded_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, case when $8 = 'downloaded' then $9 else null end)
        on conflict do nothing
        returning id
      `,
      [
        candidate.id,
        bossAttachmentId || null,
        fileName || null,
        mimeType || null,
        fileSize || null,
        sha256 || null,
        storedPath || null,
        status || 'discovered',
        occurredAt || new Date().toISOString()
      ]
    );

    if (status === 'downloaded') {
      await this.pool.query(
        `
          update job_candidates
          set lifecycle_status = 'resume_downloaded',
              resume_state = 'downloaded',
              resume_downloaded_at = $2,
              resume_path = coalesce($3, resume_path),
              updated_at = now()
          where id = $1
        `,
        [candidate.id, occurredAt || new Date().toISOString(), storedPath || null]
      );
    } else {
      await this.pool.query(
        `
          update job_candidates
          set lifecycle_status = case
                when lifecycle_status = 'resume_downloaded' then lifecycle_status
                else 'resume_received'
              end,
              resume_state = case
                when resume_state = 'downloaded' then resume_state
                else 'received'
              end,
              resume_received_at = coalesce(resume_received_at, $2),
              updated_at = now()
          where id = $1
        `,
        [candidate.id, occurredAt || new Date().toISOString()]
      );
    }

    await this.insertRunEvent({
      runId,
      attemptId,
      eventId,
      sequence,
      eventType: 'attachment_recorded',
      payload: {
        bossAttachmentId,
        status
      },
      occurredAt
    });

    return {
      ok: true,
      attachmentId: result.rows[0]?.id || null,
      alreadyProcessed: !result.rows[0]
    };
  }

  async findLatestCandidateByGeekId(bossEncryptGeekId) {
    const result = await this.pool.query(
      `
        select jc.id
        from job_candidates jc
        join people p on p.id = jc.person_id
        where p.boss_encrypt_geek_id = $1
        order by jc.updated_at desc
        limit 1
      `,
      [bossEncryptGeekId]
    );

    return result.rows[0] || null;
  }

  async insertRunEvent({ runId, attemptId, eventId, sequence, eventType, payload, occurredAt }) {
    if (!runId || !eventId) {
      return;
    }

    await this.pool.query(
      `
        insert into sourcing_run_events (
          run_id,
          attempt_id,
          event_id,
          sequence,
          stage,
          event_type,
          message,
          payload,
          occurred_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (run_id, event_id) do nothing
      `,
      [
        runId,
        attemptId || null,
        eventId,
        sequence || null,
        'agent_callback',
        eventType,
        eventType,
        payload || {},
        occurredAt || new Date().toISOString()
      ]
    );
  }

  async runNanobotForSchedule({ jobKey, mode }) {
    if (!this.nanobotRunner) {
      throw new Error('nanobot_runner_not_configured');
    }

    const modeFlag = mode === 'followup' ? '--followup' : '--source';
    const message = `/boss-sourcing --job "${jobKey}" ${modeFlag}`;
    return this.nanobotRunner.run({ message });
  }

  async runNanobotForJobSync({ runId }) {
    if (!this.nanobotRunner) {
      throw new Error('nanobot_runner_not_configured');
    }

    const message = `/boss-sourcing --sync-jobs --run-id "${runId}"`;
    return this.nanobotRunner.run({ message });
  }
}

module.exports = {
  AgentService
};
