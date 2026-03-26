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

    const jobId = jobResult.rows[0]?.id;
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
          bossEncryptGeekId,
          payload: event.payload || {}
        });
      }

      return true;
    }

    if (isMessageImportEvent(event)) {
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
        bossEncryptGeekId,
        payload: event.payload || {}
      });
      return true;
    }

    if (isAttachmentImportEvent(event)) {
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

    const jobContext = await this.#getJobNanobotContext(jobKey);
    const message = mode === 'followup'
      ? `/boss-sourcing --job "${jobKey}" --followup --run-id "${runId}"`
      : [
        `/boss-sourcing --job "${jobKey}" --source --run-id "${runId}"`,
        buildCustomRequirementPrompt(jobContext.customRequirement),
        '执行寻源打招呼时，按浏览器当前状态推进，不要按预设流程脑补。硬规则：只有看到工作经历/教育经历等详情区块，才算进入候选人详情；点击“不合适/提交”不等于详情已关闭；只有确认详情区块消失且推荐列表重新可见，才允许进入下一个候选人；每一步动作后都要先校验页面状态，不满足就先重新 snapshot / wait_for / recover；不要在刚找到 1 到 2 个 A 候选人后提前结束，summary 统计必须从本轮 events.jsonl 实算。'
      ].join('\n');
    return this.#runNanobotWithStreaming({ runId, message });
  }

  async runNanobotForJobSync({ runId }) {
    if (!this.nanobotRunner) {
      throw new Error('nanobot_runner_not_configured');
    }

    const message = [
      `/boss-sourcing --sync --run-id "${runId}"`,
      '只执行岗位同步：采集职位列表和职位详情，并调用 /api/agent/jobs/batch 回写本地后台。禁止进入推荐牛人、打招呼、聊天跟进、下载简历。'
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
