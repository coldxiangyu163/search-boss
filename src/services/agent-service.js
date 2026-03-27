const path = require('node:path');

class AgentService {
  constructor({ pool, nanobotRunner = null }) {
    this.pool = pool;
    this.nanobotRunner = nanobotRunner;
  }

  async createRun({ runKey, jobKey, mode }) {
    let jobId = null;

    if (jobKey) {
      const jobResult = await this.pool.query(
        `
          select id
          from jobs
          where job_key = $1
          limit 1
        `,
        [jobKey]
      );

      jobId = jobResult.rows[0]?.id || null;
    }

    if (!jobId && mode !== 'sync_jobs') {
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
      [runKey, jobId, mode]
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
    const result = await this.pool.query(
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

    return { ok: true, duplicated: result.rowCount === 0 };
  }

  async importRunEvents({ runId, attemptId, sourceFile, events = [] }) {
    const importEvents = Array.isArray(events) ? events : [];
    const receivedCount = importEvents.length;
    let importedCount = 0;
    let projectedCount = 0;
    let duplicateCount = 0;
    const items = [];

    for (const rawEvent of importEvents) {
      const event = normalizeImportedEvent(rawEvent, { attemptId, sourceFile });
      const recordResult = await this.recordRunEvent({
        runId,
        attemptId: event.attemptId || attemptId || null,
        eventId: event.eventId,
        sequence: event.sequence || null,
        occurredAt: event.occurredAt || new Date().toISOString(),
        eventType: event.eventType,
        stage: event.stage || 'import',
        message: event.message || event.eventType,
        payload: {
          ...event.payload,
          importSourceFile: sourceFile || null
        }
      });

      if (recordResult.duplicated) {
        duplicateCount += 1;
        items.push({
          eventId: event.eventId,
          duplicated: true,
          projected: false
        });
        continue;
      }

      importedCount += 1;
      const projected = await this.projectImportedEvent({
        runId,
        attemptId: event.attemptId || attemptId || null,
        event
      });

      if (projected) {
        projectedCount += 1;
      }

      items.push({
        eventId: event.eventId,
        duplicated: false,
        projected
      });
    }

    const acknowledgedCount = importedCount + duplicateCount;

    return {
      ok: true,
      sourceFile: sourceFile || null,
      receivedCount,
      importedCount,
      projectedCount,
      duplicateCount,
      acknowledgedCount,
      allEventsAccountedFor: acknowledgedCount === receivedCount,
      items
    };
  }

  async upsertCandidate({
    runId,
    attemptId,
    eventId,
    sequence,
    occurredAt,
    jobKey,
    bossEncryptGeekId,
    name,
    city,
    education,
    experience,
    school,
    status,
    metadata = {}
  }) {
    if (!bossEncryptGeekId) {
      throw new Error('boss_encrypt_geek_id_missing');
    }

    const personResult = await this.pool.query(
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
        values ($1, $2, $3, $4, $5, $6, $7)
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
      [bossEncryptGeekId, name || null, city || null, education || null, experience || null, school || null, metadata]
    );

    const personId = personResult.rows[0]?.id;
    if (!personId) {
      throw new Error('person_upsert_failed');
    }

    const jobResult = await this.pool.query(
      `
        select id
        from jobs
        where job_key = $1
        limit 1
      `,
      [jobKey]
    );

    let jobId = jobResult.rows[0]?.id;
    if (!jobId && runId) {
      const runJobResult = await this.pool.query(
        `
          select job_id
          from sourcing_runs
          where id = $1
          limit 1
        `,
        [runId]
      );
      jobId = runJobResult.rows[0]?.job_id || null;
    }

    if (!jobId) {
      throw new Error('job_not_found');
    }

    const lifecycleStatus = normalizeCandidateStatus(status);
    const candidateResult = await this.pool.query(
      `
        insert into job_candidates (
          job_id,
          person_id,
          lifecycle_status,
          source_run_id,
          last_outbound_at,
          workflow_metadata
        )
        values ($1, $2, $3, $4, case when $3 = 'greeted' then $5::timestamptz else null end, $6)
        on conflict (job_id, person_id) do update
        set lifecycle_status = case
              when job_candidates.lifecycle_status in ('resume_received', 'resume_downloaded') then job_candidates.lifecycle_status
              else excluded.lifecycle_status
            end,
            source_run_id = coalesce(job_candidates.source_run_id, excluded.source_run_id),
            last_outbound_at = case
              when excluded.lifecycle_status = 'greeted' then coalesce(job_candidates.last_outbound_at, $5::timestamptz)
              else job_candidates.last_outbound_at
            end,
            workflow_metadata = excluded.workflow_metadata,
            updated_at = now()
        returning id
      `,
      [jobId, personId, lifecycleStatus, runId || null, occurredAt || new Date().toISOString(), metadata]
    );

    await this.insertRunEvent({
      runId,
      attemptId,
      eventId,
      sequence,
      eventType: 'candidate_upserted',
      payload: {
        jobKey,
        bossEncryptGeekId,
        status: lifecycleStatus
      },
      occurredAt
    });

    return {
      ok: true,
      personId,
      candidateId: candidateResult.rows[0]?.id || null
    };
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

  async failRun({ runId, eventId, attemptId, sequence, occurredAt, message, payload = {} }) {
    await this.pool.query(
      `
        update sourcing_runs
        set status = 'failed',
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
        eventType: 'run_failed',
        stage: 'complete',
        message: message || 'run failed',
        payload
      });
    }

    return {
      ok: true,
      status: 'failed'
    };
  }

  async recordAction({
    runId,
    candidateId,
    attemptId,
    eventId,
    sequence,
    occurredAt,
    actionType,
    dedupeKey,
    jobKey,
    bossEncryptGeekId,
    payload = {}
  }) {
    const jobCandidate = await this.resolveJobCandidateForWrite({
      candidateId,
      bossEncryptGeekId,
      jobKey
    });

    if (!jobCandidate) {
      throw new Error('candidate_not_found');
    }

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
    candidateId,
    attemptId,
    eventId,
    sequence,
    occurredAt,
    jobKey,
    bossEncryptGeekId,
    bossMessageId,
    direction,
    messageType,
    contentText,
    rawPayload = {}
  }) {
    const candidate = await this.resolveJobCandidateForWrite({
      candidateId,
      bossEncryptGeekId,
      jobKey
    });
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
    candidateId,
    attemptId,
    eventId,
    sequence,
    occurredAt,
    jobKey,
    bossEncryptGeekId,
    bossAttachmentId,
    fileName,
    mimeType,
    fileSize,
    sha256,
    storedPath,
    status
  }) {
    const candidate = await this.resolveJobCandidateForWrite({
      candidateId,
      bossEncryptGeekId,
      jobKey
    });
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

  async projectImportedEvent({ runId, attemptId, event }) {
    if (isProjectedCandidateImportEvent(event)) {
      const jobKey = getImportedField(event, 'jobKey');
      const bossEncryptGeekId = getImportedField(event, 'bossEncryptGeekId');
      if (!jobKey || !bossEncryptGeekId) {
        return false;
      }

      await this.upsertCandidate({
        runId,
        attemptId,
        eventId: event.eventId,
        sequence: event.sequence || null,
        occurredAt: event.occurredAt,
        jobKey,
        bossEncryptGeekId,
        name: getImportedField(event, 'name'),
        city: getImportedField(event, 'city'),
        education: getImportedField(event, 'education'),
        experience: getImportedField(event, 'experience'),
        school: getImportedField(event, 'school'),
        status: resolveImportedCandidateStatus(event),
        metadata: collectImportedCandidateMetadata(event)
      });

      if (isGreetImportEvent(event)) {
        await this.recordAction({
          runId,
          attemptId,
          eventId: event.eventId,
          sequence: event.sequence || null,
          occurredAt: event.occurredAt,
          actionType: 'greet_sent',
          dedupeKey: getImportedField(event, 'dedupeKey') || `greet:${jobKey}:${bossEncryptGeekId}`,
          jobKey,
          bossEncryptGeekId,
          payload: event.payload || {}
        });
      }

      return true;
    }

    if (isMessageImportEvent(event)) {
      const jobKey = getImportedField(event, 'jobKey');
      const bossEncryptGeekId = getImportedField(event, 'bossEncryptGeekId');
      const bossMessageId = getImportedField(event, 'bossMessageId');
      if (!bossEncryptGeekId || !bossMessageId) {
        return false;
      }

      await this.recordMessage({
        runId,
        attemptId,
        eventId: event.eventId,
        sequence: event.sequence || null,
        occurredAt: event.occurredAt,
        jobKey,
        bossEncryptGeekId,
        bossMessageId,
        direction: getImportedField(event, 'direction') || 'inbound',
        messageType: getImportedField(event, 'messageType') || 'text',
        contentText: getImportedField(event, 'contentText') || null,
        rawPayload: event.payload || {}
      });
      return true;
    }

    if (isResumeRequestImportEvent(event)) {
      const jobKey = getImportedField(event, 'jobKey');
      const bossEncryptGeekId = getImportedField(event, 'bossEncryptGeekId');
      if (!bossEncryptGeekId) {
        return false;
      }

      await this.recordAction({
        runId,
        attemptId,
        eventId: event.eventId,
        sequence: event.sequence || null,
        occurredAt: event.occurredAt,
        actionType: 'resume_request_sent',
        dedupeKey: getImportedField(event, 'dedupeKey') || `resume-request:${runId}:${bossEncryptGeekId}`,
        jobKey,
        bossEncryptGeekId,
        payload: event.payload || {}
      });
      return true;
    }

    if (isAttachmentImportEvent(event)) {
      const jobKey = getImportedField(event, 'jobKey');
      const bossEncryptGeekId = getImportedField(event, 'bossEncryptGeekId');
      if (!bossEncryptGeekId) {
        return false;
      }

      await this.recordAttachment({
        runId,
        attemptId,
        eventId: event.eventId,
        sequence: event.sequence || null,
        occurredAt: event.occurredAt,
        jobKey,
        bossEncryptGeekId,
        bossAttachmentId: getImportedField(event, 'bossAttachmentId') || null,
        fileName: getImportedField(event, 'fileName') || null,
        mimeType: getImportedField(event, 'mimeType') || null,
        fileSize: getImportedField(event, 'fileSize') || null,
        sha256: getImportedField(event, 'sha256') || null,
        storedPath: getImportedField(event, 'storedPath') || null,
        status: resolveImportedAttachmentStatus(event)
      });
      return true;
    }

    return false;
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

  async resolveJobCandidateForWrite({ candidateId, bossEncryptGeekId, jobKey }) {
    if (candidateId) {
      const result = await this.pool.query(
        `
          select
            id,
            resume_state,
            last_resume_requested_at,
            resume_request_count
          from job_candidates
          where id = $1
          limit 1
        `,
        [candidateId]
      );

      return result.rows[0] || null;
    }

    if (!bossEncryptGeekId) {
      throw new Error('candidate_identifier_missing');
    }

    if (!jobKey) {
      throw new Error('job_key_required_for_geek_lookup');
    }

    if (bossEncryptGeekId && jobKey) {
      const result = await this.pool.query(
        `
          select
            jc.id,
            jc.resume_state,
            jc.last_resume_requested_at,
            jc.resume_request_count
          from job_candidates jc
          join people p on p.id = jc.person_id
          join jobs j on j.id = jc.job_id
          where p.boss_encrypt_geek_id = $1
            and j.job_key = $2
          order by jc.updated_at desc
          limit 1
        `,
        [bossEncryptGeekId, jobKey]
      );

      return result.rows[0] || null;
    }
  }

  async getRunStatus(runId) {
    const result = await this.pool.query(
      `
        select status
        from sourcing_runs
        where id = $1
        limit 1
      `,
      [runId]
    );

    return result.rows[0]?.status || null;
  }

  async failReplacementRunsForRunId({ runId, occurredAt, message = 'replacement_run_created' }) {
    const result = await this.pool.query(
      `
        with origin as (
          select job_id, mode
          from sourcing_runs
          where id = $1
          limit 1
        )
        select sr.id
        from sourcing_runs sr
        join origin o
          on sr.job_id is not distinct from o.job_id
         and sr.mode = o.mode
        where sr.run_key = $2
          and sr.id <> $1
          and sr.status not in ('completed', 'failed')
        order by sr.id asc
      `,
      [runId, String(runId)]
    );

    const failedRunIds = [];
    for (const row of result.rows) {
      await this.failRun({
        runId: row.id,
        eventId: `replacement-run-failed:${runId}:${row.id}`,
        occurredAt,
        message,
        payload: {
          replacementForRunId: runId
        }
      });
      failedRunIds.push(row.id);
    }

    return {
      ok: true,
      failedRunIds
    };
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

  async listRunEvents(runId, { afterId = 0, limit = 100 } = {}) {
    const result = await this.pool.query(
      `
        select
          id,
          run_id as "runId",
          attempt_id as "attemptId",
          event_id as "eventId",
          sequence,
          stage,
          event_type as "eventType",
          message,
          payload,
          occurred_at as "occurredAt"
        from sourcing_run_events
        where run_id = $1
          and id > $2
        order by id asc
        limit $3
      `,
      [runId, afterId, limit]
    );

    return {
      items: result.rows
    };
  }

  async runNanobotForSchedule({ runId, jobKey, mode }) {
    if (!this.nanobotRunner) {
      throw new Error('nanobot_runner_not_configured');
    }

    let message = null;

    if (mode === 'followup') {
      message = [
        `/boss-sourcing --job "${jobKey}" --followup --run-id "${runId}"`,
        buildProjectRootPrompt(),
        buildExactJobKeyPrompt(jobKey),
        buildRunContractPrompt(runId)
      ].join('\n');
    } else if (mode === 'chat') {
      message = [
        `/boss-sourcing --job "${jobKey}" --chat --run-id "${runId}"`,
        buildProjectRootPrompt(),
        buildExactJobKeyPrompt(jobKey),
        buildRunContractPrompt(runId)
      ].join('\n');
    } else if (mode === 'download') {
      message = [
        `/boss-sourcing --job "${jobKey}" --download --run-id "${runId}"`,
        buildProjectRootPrompt(),
        buildExactJobKeyPrompt(jobKey),
        buildRunContractPrompt(runId)
      ].join('\n');
    } else if (mode === 'status') {
      message = [
        `/boss-sourcing --status --job "${jobKey}" --run-id "${runId}"`,
        buildProjectRootPrompt(),
        buildExactJobKeyPrompt(jobKey),
        buildRunContractPrompt(runId)
      ].join('\n');
    } else {
      const jobContext = await this.#getJobNanobotContext(jobKey);
      message = [
        `/boss-sourcing --job "${jobKey}" --source --run-id "${runId}"`,
        buildProjectRootPrompt(),
        buildExactJobKeyPrompt(jobKey),
        buildCustomRequirementPrompt(jobContext.customRequirement),
        buildRunContractPrompt(runId),
        buildSourceRecoveryPrompt(jobContext),
        '执行寻源打招呼时，按浏览器当前状态推进，不要按预设流程脑补。硬规则：只有看到工作经历/教育经历等详情区块，才算进入候选人详情；点击“不合适/提交”不等于详情已关闭；只有确认详情区块消失且推荐列表重新可见，才允许进入下一个候选人；每一步动作后都要先校验页面状态，不满足就先重新 snapshot / wait_for / recover；不要在刚找到 1 到 2 个 A 候选人后提前结束，summary 统计必须从本轮 events.jsonl 实算。'
      ].join('\n');
    }

    return this.#runNanobotWithStreaming({ runId, message });
  }

  async runNanobotForJobSync({ runId }) {
    if (!this.nanobotRunner) {
      throw new Error('nanobot_runner_not_configured');
    }

    const message = [
      `/boss-sourcing --sync --run-id "${runId}"`,
      buildProjectRootPrompt(),
      '只执行岗位同步：采集职位列表和职位详情，并调用 /api/agent/jobs/batch 回写本地后台。禁止进入推荐牛人、打招呼、聊天跟进、下载简历。',
      '稳定性优先：以职位列表接口和当前页面可稳定读取的数据为准；如果详情接口中的 job 或 jdText 为空，允许保留空 jdText，并把原始详情放进 metadata/detailRaw，禁止为了补齐 JD 再打开编辑页、提取 HttpOnly cookie、写临时抓取脚本、复用浏览器 cookie 发起 Node 请求，或绕过 agent-callback-cli.js / 本地网络护栏。',
      buildRunContractPrompt(runId)
    ].join('\n');
    return this.#runNanobotWithStreaming({ runId, message });
  }

  #runNanobotWithStreaming({ runId, message }) {
    if (!runId) {
      return this.nanobotRunner.run({ message });
    }

    let sequence = 1000;
    const emitStreamEvent = async (line, stream) => {
      const sanitized = sanitizeNanobotLog(line);
      if (!sanitized) {
        return;
      }

      await this.recordRunEvent({
        runId,
        eventId: `nanobot_stream:${stream}:${sequence}`,
        sequence,
        occurredAt: new Date().toISOString(),
        eventType: 'nanobot_stream',
        stage: 'nanobot',
        message: sanitized,
        payload: { stream }
      });
      sequence += 1;
    };

    return this.nanobotRunner.run({
      message,
      onStdoutLine: (line) => emitStreamEvent(line, 'stdout'),
      onStderrLine: (line) => emitStreamEvent(line, 'stderr')
    });
  }

  async #getJobNanobotContext(jobKey) {
    const result = await this.pool.query(
      `
        select
          job_name,
          boss_encrypt_job_id,
          custom_requirement
        from jobs
        where job_key = $1
        limit 1
      `,
      [jobKey]
    );

    if (!result.rows[0]) {
      throw new Error('job_not_found');
    }

    return {
      jobName: result.rows[0].job_name || '',
      bossEncryptJobId: result.rows[0].boss_encrypt_job_id || '',
      customRequirement: normalizeJobRequirement(result.rows[0].custom_requirement)
    };
  }
}

function sanitizeNanobotLog(line) {
  if (!line) {
    return '';
  }

  const trimmed = String(line).trim();
  if (!trimmed) {
    return '';
  }

  return trimmed
    .replace(/\/Users\/[^\s"]+/g, '[path]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[redacted]');
}

function buildCustomRequirementPrompt(customRequirement) {
  if (!customRequirement) {
    return '如数据库中没有额外岗位定制要求，仅按 BOSS 职位信息正常执行寻源。';
  }

  return [
    '执行寻源匹配时，除 BOSS 职位信息外，还必须叠加本地数据库维护的岗位定制要求；该要求不会同步回 BOSS，但会影响候选人筛选与判断。',
    `岗位定制要求：${customRequirement}`
  ].join('\n');
}

function buildProjectRootPrompt() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const cliPath = path.join(projectRoot, 'scripts', 'agent-callback-cli.js');

  return `本次运行只使用当前项目目录：PROJECT_ROOT="${projectRoot}"；回写 CLI="${cliPath}"。不要猜测或探测其它历史路径。`;
}

function buildExactJobKeyPrompt(jobKey) {
  return `本次任务的唯一后端岗位标识是 JOB_KEY="${jobKey}"。禁止根据 jobName、encryptJobId、页面标题或短 id 重新拼接、改写或替换 jobKey；如果页面恢复后落到其他岗位，必须先切回该 JOB_KEY 对应岗位再继续。`;
}

function buildSourceRecoveryPrompt({ jobName, bossEncryptJobId }) {
  const normalizedJobName = String(jobName || '').trim();
  const recommendUrl = bossEncryptJobId
    ? `https://www.zhipin.com/web/chat/recommend?jobid=${bossEncryptJobId}`
    : '';

  if (recommendUrl && normalizedJobName) {
    return `岗位恢复规则：如果当前页面落到其他岗位，优先通过页面可见的岗位切换 UI 切回目标岗位；若 UI 恢复失败，允许直接导航到目标推荐页 "${recommendUrl}" 并确认标题回到“${normalizedJobName}”。禁止使用 evaluate_script 或注入脚本直接修改 iframe.src、history、location 或其它页面状态来强行纠偏。`;
  }

  if (recommendUrl) {
    return `岗位恢复规则：如果当前页面落到其他岗位，优先通过页面可见的岗位切换 UI 切回目标岗位；若 UI 恢复失败，允许直接导航到目标推荐页 "${recommendUrl}"。禁止使用 evaluate_script 或注入脚本直接修改 iframe.src、history、location 或其它页面状态来强行纠偏。`;
  }

  return '岗位恢复规则：如果当前页面落到其他岗位，优先通过页面可见的岗位切换 UI 切回目标岗位；若 UI 恢复失败，只允许使用显式导航重新打开目标推荐页。禁止使用 evaluate_script 或注入脚本直接修改 iframe.src、history、location 或其它页面状态来强行纠偏。';
}

function buildRunContractPrompt(runId) {
  return [
    `运行契约：必须复用调用方提供的 RUN_ID=${runId}；禁止创建 replacement run，禁止调用 createRun 或 /api/agent/runs。`,
    `所有写操作必须使用 agent-callback-cli.js 并显式传入 --run-id "${runId}"。`,
    '结束前必须显式调用 run-complete 或 run-fail；不要输出“如果你继续”之类等待确认的阶段性总结。遇到阻塞时先继续 recover，确实无法完成再 run-fail。'
  ].join('');
}

function normalizeJobRequirement(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function normalizeCandidateStatus(status) {
  if (status === 'greeted') {
    return 'greeted';
  }

  return 'discovered';
}

function normalizeImportedEvent(rawEvent, { attemptId, sourceFile }) {
  const event = rawEvent && typeof rawEvent === 'object' ? rawEvent : {};
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const eventId = String(event.eventId || '').trim();
  const eventType = String(event.eventType || '').trim();

  if (!eventId) {
    throw new Error('import_event_id_missing');
  }

  if (!eventType) {
    throw new Error('import_event_type_missing');
  }

  return {
    ...event,
    attemptId: event.attemptId || attemptId || null,
    payload: payload,
    sourceFile: sourceFile || null,
    eventId,
    eventType
  };
}

function getImportedField(event, key) {
  if (event[key] !== undefined) {
    return event[key];
  }

  if (event.payload && event.payload[key] !== undefined) {
    return event.payload[key];
  }

  return null;
}

function collectImportedCandidateMetadata(event) {
  const metadata = {
    ...(event.payload?.metadata && typeof event.payload.metadata === 'object' ? event.payload.metadata : {}),
    ...(event.metadata && typeof event.metadata === 'object' ? event.metadata : {})
  };

  for (const key of [
    'expectId',
    'lid',
    'securityId',
    'isFriend',
    'position',
    'expectedSalary',
    'matchTier',
    'matchReasons',
    'redFlags',
    'resumeHighlights',
    'recentCompanies',
    'jobStability'
  ]) {
    const value = getImportedField(event, key);
    if (value !== null && value !== undefined) {
      metadata[key] = value;
    }
  }

  return metadata;
}

function isCandidateImportEvent(event) {
  return [
    'candidate_observed',
    'candidate_scored',
    'candidate_matched',
    'candidate_filtered_out',
    'candidate_greeted',
    'greet_sent'
  ].includes(event.eventType);
}

function isProjectedCandidateImportEvent(event) {
  return isGreetImportEvent(event);
}

function isGreetImportEvent(event) {
  return event.eventType === 'greet_sent' || event.eventType === 'candidate_greeted';
}

function isMessageImportEvent(event) {
  return event.eventType === 'message_recorded' || Boolean(getImportedField(event, 'bossMessageId'));
}

function isResumeRequestImportEvent(event) {
  return event.eventType === 'resume_request_sent';
}

function isAttachmentImportEvent(event) {
  return [
    'attachment_recorded',
    'resume_received',
    'resume_downloaded'
  ].includes(event.eventType) || Boolean(getImportedField(event, 'bossAttachmentId')) || Boolean(getImportedField(event, 'storedPath'));
}

function resolveImportedCandidateStatus(event) {
  const explicitStatus = getImportedField(event, 'status') || getImportedField(event, 'candidateStatus');
  if (explicitStatus) {
    return explicitStatus;
  }

  return isGreetImportEvent(event) ? 'greeted' : 'discovered';
}

function resolveImportedAttachmentStatus(event) {
  const explicitStatus = getImportedField(event, 'status');
  if (explicitStatus) {
    return explicitStatus;
  }

  return event.eventType === 'resume_downloaded' ? 'downloaded' : 'discovered';
}

module.exports = {
  AgentService
};
