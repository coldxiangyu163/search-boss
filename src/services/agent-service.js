const path = require('node:path');
const { buildSchedulePrompt, buildSyncPrompt } = require('./prompt-contract-builder');
const { DeterministicContextService } = require('./deterministic-context-service');
const { DeterministicJobSyncService } = require('./deterministic-job-sync-service');
const { NanobotExecutionService } = require('./nanobot-execution-service');

class AgentService {
  constructor({ pool, nanobotRunner = null, bossCliRunner = null, bossContextStore = null, jobService = null, runOrchestrator = null, deterministicContextService = null, browserInstanceManager = null }) {
    this.pool = pool;
    this.nanobotRunner = nanobotRunner;
    this.bossCliRunner = bossCliRunner;
    this.bossContextStore = bossContextStore;
    this.jobService = jobService;
    this.runOrchestrator = runOrchestrator;
    this.browserInstanceManager = browserInstanceManager;
    this.deterministicContextService = deterministicContextService || new DeterministicContextService({
      bossCliRunner: this.bossCliRunner,
      bossContextStore: this.bossContextStore,
      getJobContext: (jobKey) => this._getJobNanobotContext(jobKey),
      recordRunEvent: (payload) => this.recordRunEvent(payload)
    });
    this.deterministicJobSyncService = new DeterministicJobSyncService({
      bossCliRunner: this.bossCliRunner,
      upsertJobsBatch: (payload) => this.jobService.upsertJobsBatch(payload),
      recordRunEvent: (payload) => this.recordRunEvent(payload)
    });
    this.nanobotExecutionService = new NanobotExecutionService({
      nanobotRunner: this.nanobotRunner,
      recordRunEvent: (payload) => this.recordRunEvent(payload)
    });
  }

  async _resolveRunnerForRun(runId) {
    if (!this.browserInstanceManager) {
      return { runner: this.bossCliRunner, instanceId: null };
    }
    const run = await this.pool.query('select hr_account_id from sourcing_runs where id = $1', [runId]);
    const hrAccountId = run.rows[0]?.hr_account_id;
    return this.browserInstanceManager.acquireRunner({ hrAccountId });
  }

  async createRun({ runKey, jobKey, mode, hrAccountId }) {
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

    const resolvedHrAccountId = hrAccountId || await this._resolveDefaultHrAccountId();

    const runResult = await this.pool.query(
      `
        insert into sourcing_runs (run_key, job_id, mode, status, hr_account_id)
        values ($1, $2, $3, 'pending', $4)
        on conflict (run_key) do update
        set mode = excluded.mode,
            hr_account_id = case
              when sourcing_runs.hr_account_id is null then excluded.hr_account_id
              when exists (select 1 from hr_accounts where id = sourcing_runs.hr_account_id and status = 'active') then sourcing_runs.hr_account_id
              else excluded.hr_account_id
            end,
            updated_at = now()
        returning id, run_key as "runKey", status
      `,
      [runKey, jobId, mode, resolvedHrAccountId]
    );

    return runResult.rows[0];
  }

  async _resolveDefaultHrAccountId() {
    const result = await this.pool.query(
      'select id from hr_accounts where status = $1 order by id limit 1',
      ['active']
    );
    return result.rows[0]?.id || null;
  }

  async _resolveHrAccountIdFromRun(runId) {
    if (!runId) return null;
    const result = await this.pool.query(
      'select hr_account_id from sourcing_runs where id = $1 limit 1',
      [runId]
    );
    return result.rows[0]?.hr_account_id || await this._resolveDefaultHrAccountId();
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
    const runHrAccountId = runId ? await this._resolveHrAccountIdFromRun(runId) : null;
    const candidateResult = await this.pool.query(
      `
        insert into job_candidates (
          job_id,
          person_id,
          lifecycle_status,
          source_run_id,
          last_outbound_at,
          workflow_metadata,
          hr_account_id
        )
        values ($1, $2, $3, $4, case when $3 = 'greeted' then $5::timestamptz else null end, $6, $7)
        on conflict (job_id, person_id) do update
        set lifecycle_status = case
              when array_position(
                array['discovered','greeted','in_conversation','responded','resume_requested','resume_received','resume_downloaded'],
                excluded.lifecycle_status
              ) > array_position(
                array['discovered','greeted','in_conversation','responded','resume_requested','resume_received','resume_downloaded'],
                job_candidates.lifecycle_status
              ) then excluded.lifecycle_status
              else job_candidates.lifecycle_status
            end,
            source_run_id = coalesce(job_candidates.source_run_id, excluded.source_run_id),
            last_outbound_at = case
              when excluded.lifecycle_status = 'greeted' then coalesce(job_candidates.last_outbound_at, $5::timestamptz)
              else job_candidates.last_outbound_at
            end,
            workflow_metadata = excluded.workflow_metadata,
            hr_account_id = case
              when job_candidates.hr_account_id is null then excluded.hr_account_id
              when exists (select 1 from hr_accounts where id = job_candidates.hr_account_id and status = 'active') then job_candidates.hr_account_id
              else excluded.hr_account_id
            end,
            updated_at = now()
        returning id
      `,
      [jobId, personId, lifecycleStatus, runId || null, occurredAt || new Date().toISOString(), metadata, runHrAccountId]
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

  async stopRun({ runId, eventId, attemptId, sequence, occurredAt, message, payload = {} }) {
    const resolvedOccurredAt = occurredAt || new Date().toISOString();
    const resolvedEventId = eventId || `run-stop:${runId}:${resolvedOccurredAt}`;

    await this.pool.query(
      `
        update sourcing_runs
        set status = 'stopped',
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
      eventType: 'run_stopped',
      stage: 'complete',
      message: message || 'run stopped',
      payload
    });

    return {
      ok: true,
      status: 'stopped'
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

    const attachmentParams = [
      candidate.id,
      bossAttachmentId || null,
      fileName || null,
      mimeType || null,
      fileSize || null,
      sha256 || null,
      storedPath || null,
      status || 'discovered',
      occurredAt || new Date().toISOString()
    ];

    let result;
    if (bossAttachmentId) {
      result = await this.pool.query(
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
          on conflict (boss_attachment_id) where boss_attachment_id is not null
          do update set
            file_name = coalesce(excluded.file_name, candidate_attachments.file_name),
            mime_type = coalesce(excluded.mime_type, candidate_attachments.mime_type),
            file_size = coalesce(excluded.file_size, candidate_attachments.file_size),
            sha256 = coalesce(excluded.sha256, candidate_attachments.sha256),
            stored_path = coalesce(excluded.stored_path, candidate_attachments.stored_path),
            status = case
              when excluded.status = 'downloaded' then 'downloaded'
              else candidate_attachments.status
            end,
            downloaded_at = case
              when excluded.status = 'downloaded' then coalesce(excluded.downloaded_at, candidate_attachments.downloaded_at)
              else candidate_attachments.downloaded_at
            end
          returning id
        `,
        attachmentParams
      );
    } else if (sha256) {
      result = await this.pool.query(
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
          on conflict (sha256) where sha256 is not null
          do update set
            file_name = coalesce(excluded.file_name, candidate_attachments.file_name),
            mime_type = coalesce(excluded.mime_type, candidate_attachments.mime_type),
            file_size = coalesce(excluded.file_size, candidate_attachments.file_size),
            boss_attachment_id = coalesce(excluded.boss_attachment_id, candidate_attachments.boss_attachment_id),
            stored_path = coalesce(excluded.stored_path, candidate_attachments.stored_path),
            status = case
              when excluded.status = 'downloaded' then 'downloaded'
              else candidate_attachments.status
            end,
            downloaded_at = case
              when excluded.status = 'downloaded' then coalesce(excluded.downloaded_at, candidate_attachments.downloaded_at)
              else candidate_attachments.downloaded_at
            end
          returning id
        `,
        attachmentParams
      );
    } else {
      result = await this.pool.query(
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
        attachmentParams
      );
    }

    if (status === 'downloaded') {
      await this.pool.query(
        `
          update job_candidates
          set lifecycle_status = 'resume_downloaded',
              resume_state = 'downloaded',
              resume_downloaded_at = $2,
              resume_path = coalesce($3, resume_path),
              last_inbound_at = $2,
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

  async findLatestCandidateByGeekId(bossEncryptGeekId, jobKey) {
    if (jobKey) {
      const result = await this.pool.query(
        `
          select jc.id, jc.lifecycle_status as "lifecycleStatus"
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

    const result = await this.pool.query(
      `
        select jc.id, jc.lifecycle_status as "lifecycleStatus"
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

  async runHasResumeIngestHandoff(runId) {
    const result = await this.pool.query(
      `
        select 1
        from sourcing_run_events
        where run_id = $1
          and event_type = 'nanobot_stream'
          and (
            (
              message like '%boss-resume-ingest%'
              and (
                message like '%--run-id%'
                or message like '%RUN_ID=%'
              )
            )
            or (
              message like '%Spawned subagent%'
              and message like '%boss-resume-ingest-%'
            )
          )
        limit 1
      `,
      [runId]
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

  async listRuns({ hrAccountId, departmentId, status, mode, page = 1, pageSize = 20 } = {}) {
    const conditions = [];
    const values = [];

    if (hrAccountId) {
      values.push(hrAccountId);
      conditions.push(`sr.hr_account_id = $${values.length}`);
    } else if (departmentId) {
      values.push(departmentId);
      conditions.push(`ha.department_id = $${values.length}`);
    }
    if (status) {
      values.push(status);
      conditions.push(`sr.status = $${values.length}`);
    }
    if (mode) {
      values.push(mode);
      conditions.push(`sr.mode = $${values.length}`);
    }

    const whereClause = conditions.length ? 'where ' + conditions.join(' and ') : '';
    const offset = (page - 1) * pageSize;

    const countResult = await this.pool.query(`
      select count(*)::int as total
      from sourcing_runs sr
      left join hr_accounts ha on ha.id = sr.hr_account_id
      ${whereClause}
    `, values);

    const total = countResult.rows[0]?.total || 0;

    const queryValues = [...values, pageSize, offset];
    const result = await this.pool.query(`
      select
        sr.id,
        sr.run_key,
        sr.mode,
        sr.status,
        sr.attempt_count,
        sr.started_at,
        sr.completed_at,
        sr.created_at,
        sr.hr_account_id,
        j.job_key,
        j.job_name,
        ha.name as hr_name,
        sjr.scheduled_job_id,
        sj.cron_expression,
        (select count(*)::int from sourcing_run_events where run_id = sr.id) as event_count,
        (select count(*)::int from job_candidates where source_run_id = sr.id) as candidate_count
      from sourcing_runs sr
      left join jobs j on j.id = sr.job_id
      left join hr_accounts ha on ha.id = sr.hr_account_id
      left join scheduled_job_runs sjr on sjr.run_id = sr.id
      left join scheduled_jobs sj on sj.id = sjr.scheduled_job_id
      ${whereClause}
      order by sr.created_at desc
      limit $${queryValues.length - 1} offset $${queryValues.length}
    `, queryValues);

    return {
      items: result.rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };
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
    if (this.runOrchestrator?.runSchedule) {
      return this.runOrchestrator.runSchedule({ runId, jobKey, mode });
    }

    if (!this.nanobotRunner) {
      throw new Error('nanobot_runner_not_configured');
    }

    const deterministicContextPrompt = await this._buildDeterministicContextPrompt({
      runId,
      jobKey,
      mode
    });
    const needsJobContext = mode === 'source' || mode === 'followup' || mode === 'chat';
    const jobContext = needsJobContext ? await this._getJobNanobotContext(jobKey) : {};
    const message = buildSchedulePrompt({
      mode,
      runId,
      jobKey,
      jobContext,
      deterministicContextPrompt
    });

    return this._runNanobotWithStreaming({ runId, message });
  }

  async runNanobotForJobSync({ runId }) {
    if (this.runOrchestrator?.runJobSync) {
      return this.runOrchestrator.runJobSync({ runId });
    }

    const { runner, instanceId } = await this._resolveRunnerForRun(runId);
    const hasRunner = runner || this.bossCliRunner;

    if (hasRunner && this.jobService) {
      try {
        if (instanceId) {
          await this.browserInstanceManager.markInstanceBusy(instanceId, runId);
        }
        const result = await this._runDeterministicJobSync({ runId, bossCliRunner: runner || this.bossCliRunner });
        return result;
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
      } finally {
        if (instanceId) {
          await this.browserInstanceManager.releaseInstance(instanceId).catch(() => {});
        }
      }
    }

    if (!this.nanobotRunner) {
      throw new Error('nanobot_runner_not_configured');
    }

    const message = buildSyncPrompt({ runId });
    return this._runNanobotWithStreaming({ runId, message });
  }

  async _runDeterministicJobSync({ runId, bossCliRunner }) {
    const runner = bossCliRunner || this.bossCliRunner;
    const syncService = new DeterministicJobSyncService({
      bossCliRunner: runner,
      upsertJobsBatch: (payload) => this.jobService.upsertJobsBatch(payload),
      recordRunEvent: (payload) => this.recordRunEvent(payload)
    });
    return syncService.run({ runId });
  }


  _runNanobotWithStreaming({ runId, message }) {
    return this.nanobotExecutionService.run({ runId, message });
  }


  async _getJobNanobotContext(jobKey) {
    const result = await this.pool.query(
      `
        select
          job_name,
          boss_encrypt_job_id,
          city,
          salary,
          jd_text,
          custom_requirement,
          enterprise_knowledge,
          recommend_filters
        from jobs
        where job_key = $1
        limit 1
      `,
      [jobKey]
    );

    if (!result.rows[0]) {
      throw new Error('job_not_found');
    }

    const row = result.rows[0];
    return {
      jobName: row.job_name || '',
      bossEncryptJobId: row.boss_encrypt_job_id || '',
      city: row.city || '',
      salary: row.salary || '',
      jdText: row.jd_text || '',
      customRequirement: normalizeJobRequirement(row.custom_requirement),
      enterpriseKnowledge: normalizeJobRequirement(row.enterprise_knowledge),
      recommendFilters: row.recommend_filters || null
    };
  }

  async _buildDeterministicContextPrompt({ runId, jobKey, mode }) {
    if (this.deterministicContextService?.buildPrompt) {
      return this.deterministicContextService.buildPrompt({ runId, jobKey, mode });
    }

    if (!this.bossCliRunner || !runId) {
      return '';
    }

    return '';
  }


}

function normalizeJobRequirement(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

const VALID_LIFECYCLE_STATUSES = [
  'discovered',
  'greeted',
  'in_conversation',
  'responded',
  'resume_requested',
  'resume_received',
  'resume_downloaded'
];

function normalizeCandidateStatus(status) {
  if (VALID_LIFECYCLE_STATUSES.includes(status)) {
    return status;
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
