const path = require('node:path');

class AgentService {
  constructor({ pool, nanobotRunner = null, bossCliRunner = null, bossContextStore = null, jobService = null }) {
    this.pool = pool;
    this.nanobotRunner = nanobotRunner;
    this.bossCliRunner = bossCliRunner;
    this.bossContextStore = bossContextStore;
    this.jobService = jobService;
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
    const resolvedOccurredAt = occurredAt || new Date().toISOString();
    const resolvedEventId = eventId || `${eventType}:${runId || 'no-run'}:${resolvedOccurredAt}`;
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
      [
        runId,
        attemptId || null,
        resolvedEventId,
        sequence || null,
        stage || null,
        eventType,
        message || eventType,
        payload,
        resolvedOccurredAt
      ]
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
    const resolvedOccurredAt = occurredAt || new Date().toISOString();
    const resolvedEventId = eventId || `run-complete:${runId}:${resolvedOccurredAt}`;

    await this.pool.query(
      `
        update sourcing_runs
        set status = 'completed',
            completed_at = $2,
            updated_at = now()
        where id = $1
      `,
      [runId, resolvedOccurredAt]
    );

    await this.recordRunEvent({
      runId,
      attemptId,
      eventId: resolvedEventId,
      sequence,
      occurredAt: resolvedOccurredAt,
      eventType: 'run_completed',
      stage: 'complete',
      message: 'run completed',
      payload
    });

    return {
      ok: true,
      status: 'completed'
    };
  }

  async failRun({ runId, eventId, attemptId, sequence, occurredAt, message, payload = {} }) {
    const resolvedOccurredAt = occurredAt || new Date().toISOString();
    const resolvedEventId = eventId || `run-fail:${runId}:${resolvedOccurredAt}`;

    await this.pool.query(
      `
        update sourcing_runs
        set status = 'failed',
            completed_at = $2,
            updated_at = now()
        where id = $1
      `,
      [runId, resolvedOccurredAt]
    );

    await this.recordRunEvent({
      runId,
      attemptId,
      eventId: resolvedEventId,
      sequence,
      occurredAt: resolvedOccurredAt,
      eventType: 'run_failed',
      stage: 'complete',
      message: message || 'run failed',
      payload
    });

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
    const resolvedOccurredAt = occurredAt || new Date().toISOString();
    const resolvedEventId = eventId || `${actionType}:${runId || 'no-run'}:${resolvedOccurredAt}`;
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
        [jobCandidate.id, resolvedOccurredAt]
      );
    }

    if (actionResult.rows[0] && actionType === 'greet_sent') {
      await this.pool.query(
        `
          update job_candidates
          set lifecycle_status = case
                when lifecycle_status in ('responded', 'resume_requested', 'resume_received', 'resume_downloaded') then lifecycle_status
                else 'greeted'
              end,
              last_outbound_at = $2,
              updated_at = now()
          where id = $1
        `,
        [jobCandidate.id, resolvedOccurredAt]
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
          resolvedEventId,
          sequence || null,
          'agent_action',
          actionType,
          actionType,
          payload,
          resolvedOccurredAt
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

    const resolvedBossMessageId = bossMessageId
      || `auto:${runId || 'no-run'}:${direction || 'unknown'}:${occurredAt || new Date().toISOString()}:${candidate.id}`;

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
        resolvedBossMessageId,
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
        bossMessageId: resolvedBossMessageId,
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
        values ($1, $2, $3, $4, $5, $6, $7, $8, case when $8 = 'downloaded' then $9::timestamptz else null end)
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

  async runHasSubstantiveEvents(runId) {
    const substantiveTypes = [
      'greet_sent', 'resume_downloaded', 'resume_request_sent',
      'run_message', 'run_action', 'attachment_recorded'
    ];
    const result = await this.pool.query(
      `
        select 1
        from sourcing_run_events
        where run_id = $1
          and event_type = any($2)
        limit 1
      `,
      [runId, substantiveTypes]
    );
    return result.rows.length > 0;
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

  async getRun(runId) {
    const result = await this.pool.query(
      `
        select
          id,
          run_key as "runKey",
          mode,
          status,
          attempt_count as "attemptCount",
          started_at as "startedAt",
          completed_at as "completedAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from sourcing_runs
        where id = $1
        limit 1
      `,
      [runId]
    );

    return result.rows[0] || null;
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

  async getLatestPhaseEvent(runId) {
    const result = await this.pool.query(
      `
        select
          id,
          event_type as "eventType",
          payload,
          occurred_at as "occurredAt"
        from sourcing_run_events
        where run_id = $1
          and event_type in ('phase_changed', 'context_snapshot_captured')
        order by id desc
        limit 1
      `,
      [runId]
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

    const deterministicContextPrompt = await this.#buildDeterministicContextPrompt({
      runId,
      jobKey,
      mode
    });
    let message = null;

    if (mode === 'followup') {
      message = [
        `/boss-sourcing --job "${jobKey}" --followup --run-id "${runId}"`,
        deterministicContextPrompt,
        buildProjectRootPrompt(),
        buildExactJobKeyPrompt(jobKey),
        buildChatWriteContractPrompt(),
        buildRunContractPrompt(runId),
        buildNoRepoIntrospectionPrompt(),
        buildBootstrapSequencePrompt(mode),
        buildCliUsagePrompt(mode),
        buildChatQueueGoalPrompt(mode),
        buildAttachmentHandoffPrompt(runId),
        buildFailureEvidencePrompt(),
        buildCompletionPrompt()
      ].filter(Boolean).join('\n');
    } else if (mode === 'chat') {
      message = [
        `/boss-sourcing --job "${jobKey}" --chat --run-id "${runId}"`,
        deterministicContextPrompt,
        buildProjectRootPrompt(),
        buildExactJobKeyPrompt(jobKey),
        buildChatWriteContractPrompt(),
        buildRunContractPrompt(runId),
        buildNoRepoIntrospectionPrompt(),
        buildBootstrapSequencePrompt(mode),
        buildCliUsagePrompt(mode),
        buildChatQueueGoalPrompt(mode),
        buildAttachmentHandoffPrompt(runId),
        buildFailureEvidencePrompt(),
        buildCompletionPrompt()
      ].filter(Boolean).join('\n');
    } else if (mode === 'download') {
      message = [
        `/boss-sourcing --job "${jobKey}" --download --run-id "${runId}"`,
        deterministicContextPrompt,
        buildProjectRootPrompt(),
        buildExactJobKeyPrompt(jobKey),
        buildDownloadWriteContractPrompt(),
        buildRunContractPrompt(runId),
        buildNoRepoIntrospectionPrompt(),
        buildBootstrapSequencePrompt(mode),
        buildCliUsagePrompt(mode),
        buildAttachmentHandoffPrompt(runId),
        buildFailureEvidencePrompt(),
        buildCompletionPrompt()
      ].filter(Boolean).join('\n');
    } else if (mode === 'status') {
      message = [
        `/boss-sourcing --status --job "${jobKey}" --run-id "${runId}"`,
        buildProjectRootPrompt(),
        buildExactJobKeyPrompt(jobKey),
        buildRunContractPrompt(runId),
        buildNoRepoIntrospectionPrompt(),
        buildBootstrapSequencePrompt(mode),
        buildCliUsagePrompt(mode),
        buildFailureEvidencePrompt(),
        buildCompletionPrompt()
      ].join('\n');
    } else {
      const jobContext = await this.#getJobNanobotContext(jobKey);
      message = [
        `/boss-sourcing --job "${jobKey}" --source --run-id "${runId}"`,
        deterministicContextPrompt,
        buildProjectRootPrompt(),
        buildExactJobKeyPrompt(jobKey),
        buildCustomRequirementPrompt(jobContext.customRequirement),
        buildSourceWriteContractPrompt(),
        buildRunContractPrompt(runId),
        buildNoRepoIntrospectionPrompt(),
        buildBootstrapSequencePrompt(mode),
        buildCliUsagePrompt(mode),
        buildFailureEvidencePrompt(),
        buildCompletionPrompt(),
        buildSourceRecoveryPrompt(jobContext),
        buildTerminalFailPrompt(),
        buildSourceQuotaPrompt(),
        buildSourceStateGuardPrompt()
      ].filter(Boolean).join('\n');
    }

    return this.#runNanobotWithStreaming({ runId, message });
  }

  async runNanobotForJobSync({ runId }) {
    if (this.bossCliRunner && this.jobService) {
      try {
        return await this.#runDeterministicJobSync({ runId });
      } catch (error) {
        if (!this.nanobotRunner) {
          throw error;
        }

        await this.recordRunEvent({
          runId,
          eventId: `boss-cli-sync-fallback:${runId}`,
          occurredAt: new Date().toISOString(),
          eventType: 'boss_cli_fallback_to_nanobot',
          stage: 'deterministic_sync',
          message: 'boss cli sync fallback to nanobot',
          payload: { reason: error.message }
        });
      }
    }

    if (!this.nanobotRunner) {
      throw new Error('nanobot_runner_not_configured');
    }

    const message = [
      `/boss-sourcing --sync --run-id "${runId}"`,
      buildProjectRootPrompt(),
      '只执行岗位同步：采集职位列表和职位详情，并调用 /api/agent/jobs/batch 回写本地后台。禁止进入推荐牛人、打招呼、聊天跟进、下载简历。',
      '稳定性优先：以职位列表接口和当前页面可稳定读取的数据为准；如果详情接口中的 job 或 jdText 为空，允许保留空 jdText，并把原始详情放进 metadata/detailRaw，禁止为了补齐 JD 再打开编辑页、提取 HttpOnly cookie、写临时抓取脚本、复用浏览器 cookie 发起 Node 请求，或绕过 agent-callback-cli.js / 本地网络护栏。',
      buildSyncWriteContractPrompt(),
      buildRunContractPrompt(runId),
      buildNoRepoIntrospectionPrompt(),
      buildBootstrapSequencePrompt('sync'),
      buildCliUsagePrompt(),
      buildFailureEvidencePrompt(),
      buildCompletionPrompt()
    ].join('\n');
    return this.#runNanobotWithStreaming({ runId, message });
  }

  async #runDeterministicJobSync({ runId }) {
    await this.recordRunEvent({
      runId,
      eventId: `boss-cli-bind-started:${runId}:sync`,
      occurredAt: new Date().toISOString(),
      eventType: 'boss_cli_bind_started',
      stage: 'deterministic_sync',
      message: 'boss cli bind started',
      payload: { mode: 'sync_jobs' }
    });

    const bindResult = await this.bossCliRunner.bindTarget({ runId });

    await this.recordRunEvent({
      runId,
      eventId: `boss-cli-bind-succeeded:${runId}:sync`,
      occurredAt: new Date().toISOString(),
      eventType: 'boss_cli_command_succeeded',
      stage: 'deterministic_sync',
      message: 'boss cli bind succeeded',
      payload: {
        mode: 'sync_jobs',
        command: 'target bind',
        targetId: bindResult?.session?.targetId || null
      }
    });

    await this.recordRunEvent({
      runId,
      eventId: `boss-cli-command-started:${runId}:sync:joblist`,
      occurredAt: new Date().toISOString(),
      eventType: 'boss_cli_command_started',
      stage: 'deterministic_sync',
      message: 'boss cli joblist started',
      payload: { mode: 'sync_jobs', command: 'joblist' }
    });

    const jobListResult = await this.bossCliRunner.listJobs({ runId });
    const rawJobs = Array.isArray(jobListResult?.jobs) ? jobListResult.jobs : [];
    const jobs = [];

    for (const job of rawJobs) {
      let detailJob = null;

      if (job.encryptJobId) {
        try {
          detailJob = (await this.bossCliRunner.getJobDetail({
            runId,
            jobId: job.encryptJobId
          }))?.job || null;
        } catch (error) {
          detailJob = null;
        }
      }

      jobs.push({
        encryptJobId: job.encryptJobId || '',
        jobName: detailJob?.name || job.jobName || '',
        city: detailJob?.city || job.city || '',
        salary: detailJob?.salary || job.salary || '',
        status: normalizeSyncJobStatus(job.status),
        jdText: detailJob?.description || '',
        metadata: {
          syncSource: 'boss_cli',
          detailRaw: detailJob
        }
      });
    }

    await this.recordRunEvent({
      runId,
      eventId: `boss-cli-command-succeeded:${runId}:sync:joblist`,
      occurredAt: new Date().toISOString(),
      eventType: 'boss_cli_command_succeeded',
      stage: 'deterministic_sync',
      message: 'boss cli joblist succeeded',
      payload: {
        mode: 'sync_jobs',
        command: 'joblist',
        itemCount: jobs.length
      }
    });

    const syncedAt = new Date().toISOString();
    const result = await this.jobService.upsertJobsBatch({
      runId,
      eventId: `boss-cli-jobs-batch:${runId}:${syncedAt}`,
      occurredAt: syncedAt,
      jobs
    });

    return {
      ok: true,
      deterministic: true,
      stdout: JSON.stringify({
        eventType: 'jobs_batch_synced',
        syncedCount: result.syncedCount
      }),
      ...result
    };
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

  async #buildDeterministicContextPrompt({ runId, jobKey, mode }) {
    if (!this.bossCliRunner || !runId) {
      return '';
    }

    const needsJobContext = mode === 'source' || mode === 'followup' || mode === 'chat' || mode === 'download';
    const jobContext = needsJobContext
      ? await this.#getJobNanobotContext(jobKey)
      : null;
    let bindResult = null;
    try {
      bindResult = await this.bossCliRunner.bindTarget({
        runId,
        mode,
        jobKey,
        jobId: jobContext?.bossEncryptJobId || null
      });
      await this.recordRunEvent({
        runId,
        eventId: `phase:${runId}:target_bound`,
        occurredAt: new Date().toISOString(),
        eventType: 'phase_changed',
        stage: 'deterministic_bootstrap',
        message: 'target bound',
        payload: {
          phase: 'target_bound',
          mode,
          jobKey,
          targetId: bindResult?.session?.targetId || null
        }
      });
    } catch (error) {
      await this.recordRunEvent({
        runId,
        eventId: `boss-cli-bind-failed:${runId}:${mode}`,
        occurredAt: new Date().toISOString(),
        eventType: 'boss_cli_command_failed',
        stage: 'deterministic_bootstrap',
        message: error.message,
        payload: { mode, jobKey, command: 'target bind' }
      });
    }

    let contextFilePath = null;
    let contextSnapshot = null;

    if (bindResult && this.bossCliRunner.getContextSnapshot) {
      try {
        contextSnapshot = await this.bossCliRunner.getContextSnapshot({
          runId,
          jobId: jobContext?.bossEncryptJobId || null
        });

        if (this.bossContextStore) {
          const saved = await this.bossContextStore.saveContext(runId, {
            mode,
            jobKey,
            targetId: bindResult?.session?.targetId || null,
            pageState: contextSnapshot?.page?.shell || 'unknown',
            page: contextSnapshot?.page || {},
            job: contextSnapshot?.job || {},
            candidate: contextSnapshot?.candidate || {},
            thread: contextSnapshot?.thread || {},
            attachment: contextSnapshot?.attachment || {},
            suggestedCommands: buildSuggestedCommands(mode),
            checkpoints: {
              targetBound: true,
              contextSnapshotCaptured: true
            }
          });
          contextFilePath = saved.filePath;
        }

        await this.recordRunEvent({
          runId,
          eventId: `context-snapshot:${runId}:${mode}`,
          occurredAt: new Date().toISOString(),
          eventType: 'context_snapshot_captured',
          stage: 'deterministic_bootstrap',
          message: 'context snapshot captured',
          payload: {
            phase: contextSnapshot?.page?.shell || 'unknown',
            mode,
            jobKey,
            contextFilePath,
            snapshot: contextSnapshot
          }
        });
      } catch (error) {
        await this.recordRunEvent({
          runId,
          eventId: `boss-cli-context-snapshot-failed:${runId}:${mode}`,
          occurredAt: new Date().toISOString(),
          eventType: 'boss_cli_command_failed',
          stage: 'deterministic_bootstrap',
          message: error.message,
          payload: { mode, jobKey, command: 'context-snapshot' }
        });
      }
    }

    if (contextSnapshot) {
      await this.recordRunEvent({
        runId,
        eventId: `boss-cli-context-ready:${runId}:${mode}`,
        occurredAt: new Date().toISOString(),
        eventType: 'boss_cli_command_succeeded',
        stage: 'deterministic_bootstrap',
        message: 'boss cli deterministic context ready',
        payload: {
          mode,
          jobKey,
          command: 'context-snapshot',
          targetId: bindResult?.session?.targetId || null
        }
      });

      return buildDeterministicContextPrompt({
        mode,
        bindResult,
        contextSnapshot,
        contextFilePath
      });
    }

    return '';
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
  const recoveryTail = '如果当前落在错误岗位的候选人详情里，先安全退出详情：只能使用页面上明确可见的返回/关闭控件，或在 fresh snapshot 证明详情仍开着时尝试一次 Escape；点击“不合适/提交”不等于详情已关闭。只有确认工作经历/教育经历等详情区块已经消失，且推荐列表重新可见后，才允许切换岗位或进入下一个候选人。恢复过程中禁止点击收藏、分享、共享、举报等无关工具图标，也不要把无文案小图标猜成返回入口。';

  if (recommendUrl && normalizedJobName) {
    return `岗位恢复规则：如果当前不在推荐牛人壳层，先通过页面可见导航进入推荐牛人；进入推荐牛人后，只允许通过页面可见的岗位切换 UI 切回目标岗位并确认标题回到“${normalizedJobName}”。若外层 recommend URL 已是目标岗位，但页面标题或可见岗位名仍指向其他岗位，只能视为未恢复成功，必须继续 wait_for / snapshot / job-list recover，再做一次最终复核。` +
      '如果 iframe src 暂时还是 jobid=null，但可见岗位条、当前详情和候选人信息都已稳定指向目标岗位，这只是弱负信号，不能单独作为 run-fail 依据；只有当 jobid=null 与可见岗位漂移/缺失同时成立时，才算未恢复成功。' +
      `禁止使用 Page.navigate、evaluate_script(...click())、或注入脚本直接修改 iframe.src、history、location、class 等页面状态来强行纠偏。${recoveryTail}`;
  }

  if (recommendUrl) {
    return '岗位恢复规则：如果当前不在推荐牛人壳层，先通过页面可见导航进入推荐牛人；进入推荐牛人后，只允许通过页面可见的岗位切换 UI 切回目标岗位。若外层 recommend URL 已是目标岗位，但页面标题或可见岗位名仍指向其他岗位，只能视为未恢复成功，必须继续 wait_for / snapshot / job-list recover，再做一次最终复核。' +
      '如果 iframe src 暂时还是 jobid=null，但可见岗位条、当前详情和候选人信息都已稳定指向目标岗位，这只是弱负信号，不能单独作为 run-fail 依据；只有当 jobid=null 与可见岗位漂移/缺失同时成立时，才算未恢复成功。' +
      `禁止使用 Page.navigate、evaluate_script(...click())、或注入脚本直接修改 iframe.src、history、location、class 等页面状态来强行纠偏。${recoveryTail}`;
  }

  return '岗位恢复规则：如果当前不在推荐牛人壳层，先通过页面可见导航进入推荐牛人；进入推荐牛人后，只允许通过页面可见的岗位切换 UI 切回目标岗位。若外层 recommend URL 已是目标岗位，但页面标题或可见岗位名仍指向其他岗位，只能视为未恢复成功，必须继续 wait_for / snapshot / job-list recover，再做一次最终复核。' +
    '如果 iframe src 暂时还是 jobid=null，但可见岗位条、当前详情和候选人信息都已稳定指向目标岗位，这只是弱负信号，不能单独作为 run-fail 依据；只有当 jobid=null 与可见岗位漂移/缺失同时成立时，才算未恢复成功。' +
    `禁止使用 Page.navigate、evaluate_script(...click())、或注入脚本直接修改 iframe.src、history、location、class 等页面状态来强行纠偏。${recoveryTail}`;
}

function buildRunContractPrompt(runId) {
  return [
    `运行契约：必须复用调用方提供的 RUN_ID=${runId}；禁止创建 replacement run，禁止调用 createRun 或 /api/agent/runs。`,
    `所有写操作必须使用 agent-callback-cli.js 并显式传入 --run-id "${runId}"。`
  ].join('');
}

function buildNoRepoIntrospectionPrompt() {
  return '调用方已经显式给定 PROJECT_ROOT、RUN_ID 和回写 CLI；不要再 list_dir 项目根目录，也不要读取 AGENTS.md、tests/*、旧 tmp/run-*.json、历史失败文件或历史 session 来推断契约。';
}

function buildBootstrapSequencePrompt(mode = '') {
  if (mode === 'source') {
    return '固定启动顺序：先读 boss-sourcing SKILL 做路由；source 只继续读 boss-source-greet SKILL、boss-sourcing/references/runtime-contract.md、boss-source-greet/references/browser-states.md。不要再读 chat/followup 的页面 reference，也不要用 find、rg、python、rglob 重新定位这些固定路径。';
  }

  if (mode === 'chat' || mode === 'followup' || mode === 'download') {
    return '固定启动顺序：先读 boss-sourcing SKILL 做路由；chat/followup/download 只继续读 boss-chat-followup SKILL、boss-sourcing/references/runtime-contract.md、boss-chat-followup/references/browser-states.md。不要再读 source 的页面 reference，也不要用 find、rg、python、rglob 重新定位这些固定路径。';
  }

  return '固定启动顺序：先读 boss-sourcing SKILL；run-scoped 流程只额外读取 boss-sourcing/references/runtime-contract.md。引用路径已固定时，禁止再用 find、rg、python、rglob 或其它目录扫描去重新定位这些 reference。';
}

function buildCliUsagePrompt(mode = '') {
  if (mode === 'chat' || mode === 'followup') {
    return 'CLI 规则：回写只使用 node "$PROJECT_ROOT/scripts/agent-callback-cli.js" 的既有命令；禁止执行 --help、裸命令探测，或通过源码/测试反推参数。先 mkdir -p tmp sessions，再执行 dashboard-summary 验证后台。bootstrap 回写必须使用 run-event --file，禁止调用不存在的 bootstrap 子命令。聊天模式只允许使用 chat 相关 CLI：必要时用 node "$PROJECT_ROOT/scripts/boss-cli.js" chatlist --run-id "$RUN_ID" 读取当前职位聊天列表，用 chat-open-thread --run-id "$RUN_ID" --uid "$BOSS_ENCRYPT_UID" 打开指定线程，用 chat-thread-state --run-id "$RUN_ID" 验证当前线程状态，用 chatmsg --run-id "$RUN_ID" --uid "$BOSS_ENCRYPT_UID" 读取当前线程消息，用 attachment-state --run-id "$RUN_ID" 或 resume-panel --run-id "$RUN_ID" 读取附件按钮/附件卡片状态；需要恢复附件预览参数时，使用 resume-preview-meta --run-id "$RUN_ID"；禁止调用 recommend-state、recommend-detail、recommend-pager，禁止把推荐页锚点用于沟通线程判断。';
  }

  if (mode === 'download') {
    return 'CLI 规则：回写只使用 node "$PROJECT_ROOT/scripts/agent-callback-cli.js" 的既有命令；禁止执行 --help、裸命令探测，或通过源码/测试反推参数。先 mkdir -p tmp sessions，再执行 dashboard-summary 验证后台。bootstrap 回写必须使用 run-event --file，禁止调用不存在的 bootstrap 子命令。下载/补扫模式只允许使用 chat 相关 CLI：必要时用 node "$PROJECT_ROOT/scripts/boss-cli.js" chatlist --run-id "$RUN_ID" 读取当前职位聊天列表，用 chat-open-thread --run-id "$RUN_ID" --uid "$BOSS_ENCRYPT_UID" 打开指定线程，用 chat-thread-state --run-id "$RUN_ID" 验证当前线程状态，用 chatmsg --run-id "$RUN_ID" --uid "$BOSS_ENCRYPT_UID" 读取当前线程消息，用 attachment-state --run-id "$RUN_ID" 或 resume-panel --run-id "$RUN_ID" 读取附件按钮/附件卡片状态；需要恢复附件预览参数时，使用 resume-preview-meta --run-id "$RUN_ID"；禁止调用 recommend-state、recommend-detail、recommend-pager，禁止把推荐页锚点用于沟通线程判断。';
  }

  return 'CLI 规则：回写只使用 node "$PROJECT_ROOT/scripts/agent-callback-cli.js" 的既有命令；禁止执行 --help、裸命令探测，或通过源码/测试反推参数。先 mkdir -p tmp sessions，再执行 dashboard-summary 验证后台。bootstrap 回写必须使用 run-event --file，禁止调用不存在的 bootstrap 子命令。推荐详情推进优先使用确定性 CLI：先用 node "$PROJECT_ROOT/scripts/boss-cli.js" recommend-state --run-id "$RUN_ID" 读取 detailOpen/nextVisible/similarCandidatesVisible；若需要轻量读取当前详情候选人的姓名/履历摘要，使用 node "$PROJECT_ROOT/scripts/boss-cli.js" recommend-detail --run-id "$RUN_ID"；进入下一位候选人时优先使用 node "$PROJECT_ROOT/scripts/boss-cli.js" recommend-next-candidate --run-id "$RUN_ID"。仅当必须显式翻上一页或回退时，才使用 recommend-pager --direction next|prev；它会发送真实鼠标事件，不是 DOM click。';
}

function buildChatQueueGoalPrompt(mode = '') {
  if (mode !== 'chat' && mode !== 'followup') {
    return '';
  }

  return '执行目标：当前 run 必须持续处理 JOB_KEY 对应职位下的未读线程，直到当前未读队列被清空，或页面证据证明出现不可恢复阻塞。处理完单个线程后的回复、求简历、附件 handoff 都不构成完成条件；只要未读里还有下一条，就必须回到未读列表继续，不得打一条就 run-complete。';
}

function buildFailureEvidencePrompt() {
  return '失败判定：只有在本次 run 内完成后台探活、bootstrap 回写，并亲自尝试 Chrome/MCP 读取（至少 list_pages，必要时再 new_page）之后，才允许 run-fail；禁止复用旧失败文件或历史结论直接终止。';
}

function buildCompletionPrompt() {
  return '结束前必须显式调用 run-complete 或 run-fail；不要输出“如果你继续”之类等待确认的阶段性总结。遇到阻塞时先继续 recover，确实无法完成再 run-fail。';
}

function buildTerminalFailPrompt() {
  return 'run-fail 规则：run-fail 一律先写 tmp/run-fail.json 再执行 --file；禁止尝试内联 --message。只有在当前页面证据连续证明目标岗位无法恢复后，才允许终止 source run。';
}

function buildSyncWriteContractPrompt() {
  return '回写格式固定：bootstrap 先写 run-event；jobs-batch 直接写 jobs 数组，不要为确认 payload 再读取 job-service.js 或 tests/api.test.js。每个 job 至少包含 { jobKey, encryptJobId, jobName, city, salary, status, jdText?, metadata? }。';
}

function buildSourceWriteContractPrompt() {
  return '回写格式固定：run-candidate 必须直接写顶层 { jobKey, bossEncryptGeekId, name, status, city?, education?, experience?, school?, metadata? }；其中 metadata 承载 decision/priority/facts/reasoning。run-action(greet_sent) 必须直接写顶层 { actionType, jobKey, bossEncryptGeekId, dedupeKey, payload }；不要写 candidate.displayName 这类嵌套自定义结构，也不要读取 tests/api.test.js 或 src/services/*.js 反推字段。';
}

function buildSourceQuotaPrompt() {
  return '执行目标：单次 source run 默认目标是成功打招呼 5 人。已沟通/继续沟通的不计入新增完成数；不要因为刚完成 1 人或当前一屏候选人偏弱就提前 run-complete，而是继续滚动、翻页、换批次筛选，直到本轮新增 greet_sent 达到 5 人，或已被当前页面证据证明暂无更多合格候选人，或出现明确阻塞。若最终少于 5 人就结束，run-complete summary 必须显式写出 targetCount=5、achievedCount 和不足原因。';
}

function buildSourceStateGuardPrompt() {
  return '执行寻源打招呼时，只允许真实可见 UI 交互推进页面；禁止 Page.navigate、mcp_chrome-devtools_navigate_page 的 url/reload、evaluate_script(...click())、以及脚本改 iframe/location/history/class。只有看到工作经历/教育经历等详情区块，才算进入候选人详情；直渲染的 `.resume-detail-wrap` 加详情区块也算 detail open，不要求一定有嵌套 iframe。只有确认详情区块消失且推荐列表重新可见，才算回到列表态；点击“不合适/提交”不等于详情已关闭。greet_sent 后或列表/详情发生重排后，旧 uid 一律作废，下一次点击前必须 fresh snapshot。低于 quota 时，若页面出现相似牛人/推荐区，不得直接把它当 blocker；必须先用 recommend-state 重新确认 detailOpen 与 nextVisible。翻到下一位候选人时优先用 recommend-next-candidate，不要默认依赖 verbose snapshot 或 reload；翻页后再用 recommend-detail 轻量确认新候选人的姓名/履历摘要。若新候选人的详情未被重新证明，禁止退化成列表按钮直接打招呼。错误岗位恢复时，禁止把收藏、分享、共享、举报等无关图标当作返回入口。未达到 targetCount=5 时，不得仅因“当前页偏慢/候选人偏少”而 run-complete；summary 必须从本轮 events.jsonl 实算。';
}

function buildChatWriteContractPrompt() {
  return '回写格式固定：消息用 run-message；再次索简历前先 followup-decision；动作用 run-action；附件用 run-attachment；每次回写都显式携带 attemptId、eventId、sequence、jobKey。';
}

function buildDownloadWriteContractPrompt() {
  return '回写格式固定：附件发现/下载都用 run-attachment，下载完成后再写 run-action(resume_downloaded)；优先补偿 pending/failed callback，避免盲目重下。';
}

function buildAttachmentHandoffPrompt(runId) {
  return `附件 handoff 模板：若当前线程已确认存在附件或预览，必须立即切换到 boss-resume-ingest，这本身不是 run-fail 理由。调用 boss-resume-ingest 时必须复用同一个 RUN_ID、JOB_KEY 和 BOSS_CONTEXT_FILE。模板固定为：/boss-resume-ingest --run-id "${runId}"；JOB_KEY="$JOB_KEY"；BOSS_CONTEXT_FILE="$PROJECT_ROOT/tmp/boss-context-${runId}.json"；bossEncryptGeekId="$BOSS_ENCRYPT_GEEK_ID"；candidateId="$CANDIDATE_ID"；candidateName="$CANDIDATE_NAME"；并明确说明当前线程里的附件是已可见、已预览还是仅由 deterministic context 提示。若 candidateId 缺失，先用 list-candidates --job-key "$JOB_KEY" 解析身份，再进入 ingest；只有 ingest handoff 自身出现不可恢复证据时，才允许 run-fail。禁止创建 replacement run，禁止让 sub-skill 在已有 context file 时重新猜岗位、线程或候选人。`;
}

function buildSuggestedCommands(mode = '') {
  if (mode === 'source') {
    return [
      'recommend-state',
      'recommend-detail',
      'recommend-next-candidate'
    ];
  }

  if (mode === 'chat' || mode === 'followup') {
    return [
      'chatlist',
      'chat-open-thread',
      'chat-thread-state',
      'chatmsg',
      'attachment-state',
      'resume-preview-meta'
    ];
  }

  if (mode === 'download') {
    return [
      'chatlist',
      'chat-open-thread',
      'chat-thread-state',
      'attachment-state',
      'resume-panel'
    ];
  }

  return [];
}

function buildDeterministicContextPrompt({
  mode,
  bindResult,
  contextSnapshot,
  jobDetailResult,
  commandResult,
  threadResult,
  contextFilePath
}) {
  const lines = [
    'Deterministic browser context: current BOSS tab already bound.',
    `Bound targetId=${bindResult?.session?.targetId || 'unknown'} url=${bindResult?.session?.tabUrl || 'unknown'}`
  ];

  if (contextFilePath) {
    lines.push(`Deterministic context file: ${contextFilePath}`);
    lines.push('Read this context file before deciding whether the current UI matches the expected queue, job, or thread.');
  }

  if (contextSnapshot) {
    lines.push(
      `Context snapshot: shell=${contextSnapshot.page?.shell || 'unknown'} title=${contextSnapshot.page?.title || ''} url=${contextSnapshot.page?.url || ''}`
    );
    lines.push(
      `Context snapshot facts: jobId=${contextSnapshot.job?.encryptJobId || ''} match=${String(contextSnapshot.job?.matchesRunJob)} candidate=${contextSnapshot.candidate?.name || ''} geekId=${contextSnapshot.candidate?.bossEncryptGeekId || ''} attachmentPresent=${String(contextSnapshot.attachment?.present)}`
    );
  }

  const suggestedCommands = buildSuggestedCommands(mode);
  if (suggestedCommands.length > 0) {
    lines.push('Suggested command order:');
    for (const [index, command] of suggestedCommands.entries()) {
      lines.push(`${index + 1}. ${command}`);
    }
  }

  if (mode === 'source') {
    if (jobDetailResult?.job) {
      const job = jobDetailResult.job;
      lines.push('Pre-read job detail:');
      lines.push(
        `${job.name || ''} | ${job.salary || ''} | ${job.city || ''} | ${job.experience || ''} | ${job.degree || ''}`.trim()
      );
      if (job.description) {
        lines.push(`JD: ${String(job.description).slice(0, 200)}`);
      }
    }

    const candidates = Array.isArray(commandResult?.candidates)
      ? commandResult.candidates.slice(0, 5)
      : [];

    if (candidates.length === 0) {
      lines.push('Pre-read recommend list is empty. Treat this as a hint only and verify against current UI before failing the run.');
      return lines.join('\n');
    }

    lines.push('Pre-read recommend candidates:');
    for (const candidate of candidates) {
      lines.push(`- ${candidate.name || 'unknown'} | ${candidate.jobName || ''} | ${candidate.labels || ''} | uid=${candidate.encryptUid || ''}`);
    }
    lines.push('Use these structured facts as a starting point, but re-check the visible UI state before any click or write action.');
    return lines.join('\n');
  }

  const chats = Array.isArray(commandResult?.chats) ? commandResult.chats.slice(0, 5) : [];
  if (chats.length === 0) {
    lines.push('Pre-read chat list is empty. Verify current UI before deciding the queue is exhausted.');
    return lines.join('\n');
  }

  lines.push('Pre-read chat queue:');
  for (const chat of chats) {
    lines.push(`- ${chat.name || 'unknown'} | ${chat.jobName || ''} | ${chat.lastMessage || ''} | uid=${chat.encryptUid || ''}`);
  }
  if (Array.isArray(threadResult?.messages) && threadResult.messages.length > 0) {
    lines.push('Pre-read latest thread:');
    for (const message of threadResult.messages.slice(0, 5)) {
      lines.push(`[${message.time || ''}] ${message.from || 'unknown'}: ${message.text || ''}`);
    }
  }
  if (mode === 'download') {
    lines.push('Use these structured facts as a starting point, but re-check the visible UI state before attachment discovery, download, or callback writes.');
    return lines.join('\n');
  }

  lines.push('Use these structured facts as a starting point, but re-check the visible UI state before sending messages or requesting resumes.');
  return lines.join('\n');
}

function normalizeJobRequirement(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function normalizeSyncJobStatus(status) {
  if (!status) {
    return 'open';
  }

  const normalized = String(status).trim().toLowerCase();
  return normalized === 'online' ? 'open' : normalized;
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
