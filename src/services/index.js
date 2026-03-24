import { parseCronItems } from "graphile-worker";

function normalizeJobRecord(row) {
  return {
    id: Number(row.id),
    jobKey: row.job_key,
    bossEncryptJobId: row.boss_encrypt_job_id,
    jobName: row.job_name,
    city: row.city,
    salary: row.salary,
    minDegree: row.min_degree,
    status: row.status,
    source: row.source,
    jdPath: row.jd_path,
    lastSyncedAt: row.last_synced_at,
    candidateCount: Number(row.candidate_count || 0),
    latestRunStatus: row.latest_run_status || null,
    latestRunId: row.latest_run_id ? Number(row.latest_run_id) : null,
  };
}

function normalizeCandidateRecord(row) {
  return {
    id: Number(row.id),
    jobId: Number(row.job_id),
    bossEncryptGeekId: row.boss_encrypt_geek_id,
    name: row.name,
    education: row.education,
    experience: row.experience,
    expectedSalary: row.expected_salary,
    city: row.city,
    age: row.age,
    school: row.school,
    position: row.position,
    status: row.status,
    greetedAt: row.greeted_at,
    lastMessageAt: row.last_message_at,
    resumeDownloaded: row.resume_downloaded,
    resumePath: row.resume_path,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function normalizeRunRecord(row) {
  return {
    id: Number(row.id),
    jobId: Number(row.job_id),
    status: row.status,
    mode: row.mode,
    maxPages: row.max_pages,
    autoGreet: row.auto_greet,
    pagesProcessed: row.pages_processed,
    candidatesSeen: row.candidates_seen,
    candidatesMatched: row.candidates_matched,
    greetingsSent: row.greetings_sent,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

function normalizeEventRecord(row) {
  return {
    id: Number(row.id),
    runId: Number(row.run_id),
    eventType: row.event_type,
    stage: row.stage,
    message: row.message,
    progressPercent: row.progress_percent === null ? null : Number(row.progress_percent),
    payload: row.payload,
    createdAt: row.created_at,
  };
}

function normalizeScheduledJobRecord(row) {
  return {
    id: Number(row.id),
    name: row.name,
    jobType: row.job_type,
    cronExpression: row.cron_expression,
    payload: row.payload,
    isEnabled: row.is_enabled,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunId: row.last_run_id ? Number(row.last_run_id) : null,
  };
}

function normalizeScheduledJobRunRecord(row) {
  return {
    id: Number(row.id),
    scheduledJobId: Number(row.scheduled_job_id),
    triggerType: row.trigger_type,
    status: row.status,
    summary: row.summary,
    errorMessage: row.error_message,
    payload: row.payload,
    sourcingRunId: row.sourcing_run_id ? Number(row.sourcing_run_id) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createRunEvent({ pool, eventBus, runId, eventType, stage, message, progressPercent = null, payload = {} }) {
  const result = await pool.query(
    `
      INSERT INTO sourcing_run_events (run_id, event_type, stage, message, progress_percent, payload)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING *
    `,
    [runId, eventType, stage, message, progressPercent, JSON.stringify(payload)],
  );

  const event = normalizeEventRecord(result.rows[0]);
  eventBus.emit({
    channel: "run_event",
    ...event,
  });
  return event;
}

function buildUnauthorizedError() {
  const error = new Error("Unauthorized agent request");
  error.statusCode = 401;
  return error;
}

function buildBadRequestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateCronExpression(cronExpression) {
  try {
    parseCronItems([
      {
        task: "execute-scheduled-job",
        match: cronExpression,
        payload: { scheduledJobId: 0, triggerType: "schedule" },
      },
    ]);
  } catch (error) {
    throw buildBadRequestError(`Invalid cron expression: ${error.message}`);
  }
}

function validateScheduledJobInput({ name, jobType, cronExpression, payload = {} }) {
  if (!name || typeof name !== "string" || !name.trim()) {
    throw buildBadRequestError("Scheduled job name is required");
  }

  if (!["sync_jobs", "followup"].includes(jobType)) {
    throw buildBadRequestError("Unsupported scheduled job type");
  }

  if (!cronExpression || typeof cronExpression !== "string" || !cronExpression.trim()) {
    throw buildBadRequestError("Cron expression is required");
  }

  const normalizedPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  validateCronExpression(cronExpression.trim());

  if (jobType === "followup" && (!normalizedPayload.jobKey || typeof normalizedPayload.jobKey !== "string" || !normalizedPayload.jobKey.trim())) {
    throw buildBadRequestError("Followup scheduled jobs require payload.jobKey");
  }

  return {
    name: name.trim(),
    jobType,
    cronExpression: cronExpression.trim(),
    payload: jobType === "followup"
      ? { jobKey: normalizedPayload.jobKey.trim() }
      : normalizedPayload,
  };
}

function assertAgentToken(expectedToken, providedToken) {
  if (!expectedToken || providedToken !== expectedToken) {
    throw buildUnauthorizedError();
  }
}

async function getRunWithJob(pool, runId) {
  const result = await pool.query(
    `
      SELECT
        sourcing_runs.*,
        jobs.job_key,
        jobs.job_name
      FROM sourcing_runs
      JOIN jobs ON jobs.id = sourcing_runs.job_id
      WHERE sourcing_runs.id = $1
    `,
    [runId],
  );

  if (result.rowCount === 0) {
    const error = new Error("Run not found");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}

async function upsertBossJob(pool, job) {
  const result = await pool.query(
    `
      INSERT INTO jobs (
        job_key,
        boss_encrypt_job_id,
        job_name,
        city,
        salary,
        status,
        source,
        last_synced_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'boss-skill', NOW(), NOW())
      ON CONFLICT (job_key)
      DO UPDATE SET
        boss_encrypt_job_id = EXCLUDED.boss_encrypt_job_id,
        job_name = EXCLUDED.job_name,
        city = EXCLUDED.city,
        salary = EXCLUDED.salary,
        status = EXCLUDED.status,
        source = 'boss-skill',
        last_synced_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `,
    [job.jobKey, job.encryptJobId || null, job.jobName, job.city || null, job.salary || null, job.status || "open"],
  );

  return result.rows[0];
}

async function applyDailyStatsDelta({ pool, jobId, greetingsDelta = 0, responsesDelta = 0, resumesDelta = 0, seenDelta = 0, matchedDelta = 0 }) {
  await pool.query(
    `
      INSERT INTO daily_job_stats (
        job_id,
        stat_date,
        greetings_sent,
        responses_received,
        resumes_downloaded,
        candidates_seen,
        candidates_matched,
        updated_at
      )
      VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (job_id, stat_date)
      DO UPDATE SET
        greetings_sent = daily_job_stats.greetings_sent + EXCLUDED.greetings_sent,
        responses_received = daily_job_stats.responses_received + EXCLUDED.responses_received,
        resumes_downloaded = daily_job_stats.resumes_downloaded + EXCLUDED.resumes_downloaded,
        candidates_seen = daily_job_stats.candidates_seen + EXCLUDED.candidates_seen,
        candidates_matched = daily_job_stats.candidates_matched + EXCLUDED.candidates_matched,
        updated_at = NOW()
    `,
    [jobId, greetingsDelta, responsesDelta, resumesDelta, seenDelta, matchedDelta],
  );
}


async function insertScheduledJobRun({ pool, scheduledJobId, triggerType, payload = {} }) {
  const result = await pool.query(
    `
      INSERT INTO scheduled_job_runs (
        scheduled_job_id,
        trigger_type,
        status,
        payload,
        started_at,
        updated_at
      )
      VALUES ($1, $2, 'running', $3::jsonb, NOW(), NOW())
      RETURNING *
    `,
    [scheduledJobId, triggerType, JSON.stringify(payload)],
  );
  return result.rows[0];
}

async function updateScheduledJobRun({ pool, scheduledJobRunId, status, summary = null, errorMessage = null, sourcingRunId = null }) {
  const result = await pool.query(
    `
      UPDATE scheduled_job_runs
      SET
        status = $2,
        summary = COALESCE($3, summary),
        error_message = COALESCE($4, error_message),
        sourcing_run_id = COALESCE($5, sourcing_run_id),
        finished_at = CASE WHEN $2 IN ('completed', 'failed') THEN NOW() ELSE finished_at END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [scheduledJobRunId, status, summary, errorMessage, sourcingRunId],
  );
  return result.rows[0];
}

async function runSourcingFlow({
  pool,
  eventBus,
  nanobotRunner,
  dataFilePath,
  projectRoot,
  runId,
  job,
  maxPages,
  autoGreet,
}) {

  try {
    await createRunEvent({
      pool,
      eventBus,
      runId,
      eventType: "run_started",
      stage: "bootstrap",
      message: `开始执行岗位 ${job.jobName} 的寻源任务`,
      progressPercent: 0,
      payload: {
        jobId: job.id,
        maxPages,
        autoGreet,
      },
    });

    const session = `source-job-${job.id}-run-${runId}`;
    const runnerResult = await nanobotRunner.runSourcing({
      job,
      runId,
      maxPages,
      autoGreet,
      projectRoot,
      dataFilePath,
      session,
      onStdout: async (line) => {
        await createRunEvent({
          pool,
          eventBus,
          runId,
          eventType: "agent_output",
          stage: "agent_stdout",
          message: line,
        });
      },
      onStderr: async (line) => {
        await createRunEvent({
          pool,
          eventBus,
          runId,
          eventType: "agent_error_output",
          stage: "agent_stderr",
          message: line,
        });
      },
    });

    if (runnerResult.exitCode !== 0) {
      throw new Error(runnerResult.stderr || runnerResult.stdout || `nanobot exited with code ${runnerResult.exitCode}`);
    }

    // Agent is expected to call /complete or /fail via the Agent API.
    // Check if agent already completed the run; if not, mark it complete as fallback.
    const currentRunResult = await pool.query("SELECT status, pages_processed, candidates_seen, candidates_matched, greetings_sent FROM sourcing_runs WHERE id = $1", [runId]);
    const currentRun = currentRunResult.rows[0];

    if (currentRun?.status === "completed" || currentRun?.status === "failed") {
      return;
    }

    // Fallback: agent exited without calling /complete — mark as completed with whatever stats were recorded
    const pagesProcessed = currentRun?.pages_processed || maxPages;
    const candidatesSeen = Number(currentRun?.candidates_seen || 0);
    const candidatesMatched = Number(currentRun?.candidates_matched || 0);
    const greetingsSent = Number(currentRun?.greetings_sent || 0);

    await pool.query(
      `
        UPDATE sourcing_runs
        SET
          status = 'completed',
          pages_processed = $2,
          candidates_seen = $3,
          candidates_matched = $4,
          greetings_sent = $5,
          ended_at = NOW(),
          updated_at = NOW()
        WHERE id = $1 AND status = 'running'
      `,
      [runId, pagesProcessed, candidatesSeen, candidatesMatched, greetingsSent],
    );

    await createRunEvent({
      pool,
      eventBus,
      runId,
      eventType: "run_completed",
      stage: "completed",
      message: `寻源任务完成，共抓取 ${candidatesSeen} 人，命中 ${candidatesMatched} 人，打招呼 ${greetingsSent} 人`,
      progressPercent: 100,
      payload: {
        pagesProcessed,
        candidatesSeen,
        candidatesMatched,
        greetingsSent,
      },
    });
  } catch (error) {
    await pool.query(
      `
        UPDATE sourcing_runs
        SET
          status = 'failed',
          error_message = $2,
          ended_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [runId, error.message],
    );

    await createRunEvent({
      pool,
      eventBus,
      runId,
      eventType: "run_failed",
      stage: "failed",
      message: error.message,
      progressPercent: null,
      payload: {
        error: error.message,
      },
    });
  }
}

export function buildServices({
  pool,
  eventBus,
  nanobotRunner,
  importLegacyDataFn,
  dataFilePath,
  projectRoot,
  agentToken,
  agentApiBaseUrl,
}) {
  const streamSubscriptions = new Map();
  let schedulerService = null;

  function requireScheduler() {
    if (!schedulerService) {
      const error = new Error("Scheduler service is not configured");
      error.statusCode = 503;
      throw error;
    }
    return schedulerService;
  }

  return {
    setSchedulerService(nextSchedulerService) {
      schedulerService = nextSchedulerService;
    },

    async getDashboardSummary() {
      const totalsResult = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM jobs) AS total_jobs,
          (SELECT COUNT(*) FROM candidates) AS total_candidates
      `);

      const dailyStatsResult = await pool.query(`
        WITH latest_date AS (
          SELECT MAX(stat_date) AS stat_date
          FROM daily_job_stats
        )
        SELECT
          COALESCE(SUM(greetings_sent), 0) AS today_greetings,
          COALESCE(SUM(responses_received), 0) AS today_responses,
          COALESCE(SUM(resumes_downloaded), 0) AS today_resumes,
          latest_date.stat_date
        FROM daily_job_stats
        CROSS JOIN latest_date
        WHERE daily_job_stats.stat_date = latest_date.stat_date
        GROUP BY latest_date.stat_date
      `);

      return {
        totalJobs: Number(totalsResult.rows[0].total_jobs || 0),
        totalCandidates: Number(totalsResult.rows[0].total_candidates || 0),
        todayGreetings: Number(dailyStatsResult.rows[0]?.today_greetings || 0),
        todayResponses: Number(dailyStatsResult.rows[0]?.today_responses || 0),
        todayResumes: Number(dailyStatsResult.rows[0]?.today_resumes || 0),
        statsDate: dailyStatsResult.rows[0]?.stat_date
          ? [
              dailyStatsResult.rows[0].stat_date.getFullYear(),
              String(dailyStatsResult.rows[0].stat_date.getMonth() + 1).padStart(2, "0"),
              String(dailyStatsResult.rows[0].stat_date.getDate()).padStart(2, "0"),
            ].join("-")
          : null,
      };
    },

    async listJobs() {
      const result = await pool.query(`
        SELECT
          jobs.*,
          COUNT(candidates.id) AS candidate_count,
          latest_run.id AS latest_run_id,
          latest_run.status AS latest_run_status
        FROM jobs
        LEFT JOIN candidates ON candidates.job_id = jobs.id
        LEFT JOIN LATERAL (
          SELECT id, status
          FROM sourcing_runs
          WHERE job_id = jobs.id
          ORDER BY created_at DESC
          LIMIT 1
        ) AS latest_run ON TRUE
        GROUP BY jobs.id, latest_run.id, latest_run.status
        ORDER BY jobs.id ASC
      `);

      return result.rows.map(normalizeJobRecord);
    },

    async listJobCandidates(jobId) {
      const result = await pool.query(
        `
          SELECT *
          FROM candidates
          WHERE job_id = $1
          ORDER BY greeted_at DESC NULLS LAST, created_at DESC
        `,
        [jobId],
      );

      return result.rows.map(normalizeCandidateRecord);
    },

    async syncBossJobs() {
      const result = await nanobotRunner.runJobSync({
        projectRoot,
        dataFilePath,
        session: `sync-jobs-${Date.now()}`,
      });

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || `nanobot exited with code ${result.exitCode}`);
      }

      const importSummary = await importLegacyDataFn({
        pool,
        jsonPath: dataFilePath,
        projectRoot,
      });

      eventBus.emit({
        channel: "boss_jobs_synced",
        ...importSummary,
      });

      return importSummary;
    },

    async agentUpsertJobs({ token, jobs }) {
      assertAgentToken(agentToken, token);

      for (const job of jobs) {
        await upsertBossJob(pool, job);
      }

      const summary = { jobsImported: jobs.length };
      eventBus.emit({
        channel: "boss_jobs_synced",
        ...summary,
      });
      return summary;
    },

    async agentGetCandidateState({ token, jobKey, bossEncryptGeekId }) {
      assertAgentToken(agentToken, token);

      const result = await pool.query(
        `
          SELECT candidates.*
          FROM candidates
          JOIN jobs ON jobs.id = candidates.job_id
          WHERE jobs.job_key = $1 AND candidates.boss_encrypt_geek_id = $2
          LIMIT 1
        `,
        [jobKey, bossEncryptGeekId],
      );

      if (result.rowCount === 0) {
        return null;
      }

      return normalizeCandidateRecord(result.rows[0]);
    },

    async startSourcingRun({ jobId, maxPages = 3, autoGreet = true }) {
      const jobResult = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
      if (jobResult.rowCount === 0) {
        const error = new Error("Job not found");
        error.statusCode = 404;
        throw error;
      }

      const runResult = await pool.query(
        `
          INSERT INTO sourcing_runs (job_id, status, mode, cookie_source, max_pages, auto_greet, started_at, updated_at)
          VALUES ($1, 'running', 'source', 'manual', $2, $3, NOW(), NOW())
          RETURNING *
        `,
        [jobId, maxPages, autoGreet],
      );

      const run = normalizeRunRecord(runResult.rows[0]);
      const job = normalizeJobRecord({
        ...jobResult.rows[0],
        candidate_count: 0,
      });

      void runSourcingFlow({
        pool,
        eventBus,
        nanobotRunner,
        dataFilePath,
        projectRoot,
        runId: run.id,
        job,
        maxPages,
        autoGreet,
      });

      return run;
    },

    async agentLogRunEvent({ token, runId, eventType, stage, message, progressPercent = null, payload = {} }) {
      assertAgentToken(agentToken, token);
      return await createRunEvent({
        pool,
        eventBus,
        runId,
        eventType: eventType || "agent_output",
        stage: stage || "agent",
        message,
        progressPercent,
        payload,
      });
    },

    async agentUpdateRunProgress({
      token,
      runId,
      pagesProcessed = 0,
      candidatesSeen = 0,
      candidatesMatched = 0,
      greetingsSent = 0,
    }) {
      assertAgentToken(agentToken, token);

      const result = await pool.query(
        `
          UPDATE sourcing_runs
          SET
            pages_processed = $2,
            candidates_seen = $3,
            candidates_matched = $4,
            greetings_sent = $5,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [runId, pagesProcessed, candidatesSeen, candidatesMatched, greetingsSent],
      );

      if (result.rowCount === 0) {
        const error = new Error("Run not found");
        error.statusCode = 404;
        throw error;
      }

      return normalizeRunRecord(result.rows[0]);
    },

    async agentUpsertCandidate({ token, runId, candidate }) {
      assertAgentToken(agentToken, token);

      const run = await getRunWithJob(pool, runId);
      if (run.status !== "running") {
        const error = new Error(`Cannot write candidate to a ${run.status} run`);
        error.statusCode = 409;
        throw error;
      }
      const existing = await pool.query(
        `
          SELECT *
          FROM candidates
          WHERE job_id = $1 AND boss_encrypt_geek_id = $2
        `,
        [run.job_id, candidate.bossEncryptGeekId],
      );

      const previous = existing.rows[0] || null;
      const result = await pool.query(
        `
          INSERT INTO candidates (
            job_id,
            boss_encrypt_geek_id,
            name,
            education,
            experience,
            expected_salary,
            city,
            age,
            school,
            position,
            status,
            greeted_at,
            last_message_at,
            resume_downloaded,
            resume_path,
            notes,
            metadata,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, NOW())
          ON CONFLICT (job_id, boss_encrypt_geek_id)
          DO UPDATE SET
            name = EXCLUDED.name,
            education = COALESCE(EXCLUDED.education, candidates.education),
            experience = COALESCE(EXCLUDED.experience, candidates.experience),
            expected_salary = COALESCE(EXCLUDED.expected_salary, candidates.expected_salary),
            city = COALESCE(EXCLUDED.city, candidates.city),
            age = COALESCE(EXCLUDED.age, candidates.age),
            school = COALESCE(EXCLUDED.school, candidates.school),
            position = COALESCE(EXCLUDED.position, candidates.position),
            status = EXCLUDED.status,
            greeted_at = COALESCE(EXCLUDED.greeted_at, candidates.greeted_at),
            last_message_at = COALESCE(EXCLUDED.last_message_at, candidates.last_message_at),
            resume_downloaded = EXCLUDED.resume_downloaded,
            resume_path = COALESCE(EXCLUDED.resume_path, candidates.resume_path),
            notes = COALESCE(NULLIF(EXCLUDED.notes, ''), candidates.notes),
            metadata = candidates.metadata || EXCLUDED.metadata,
            updated_at = NOW()
          RETURNING *
        `,
        [
          run.job_id,
          candidate.bossEncryptGeekId,
          candidate.name,
          candidate.education || null,
          candidate.experience || null,
          candidate.expectedSalary || null,
          candidate.city || null,
          candidate.age || null,
          candidate.school || null,
          candidate.position || null,
          candidate.status || "discovered",
          candidate.greetedAt || null,
          candidate.lastMessageAt || null,
          Boolean(candidate.resumeDownloaded),
          candidate.resumePath || null,
          candidate.notes || "",
          JSON.stringify(candidate.metadata || {}),
        ],
      );

      const current = result.rows[0];
      const seenDelta = previous ? 0 : 1;
      const matchedStatuses = new Set(["matched", "greeted", "responded", "resume_received", "resume_downloaded"]);
      const responseStatuses = new Set(["responded", "resume_received", "resume_downloaded"]);
      const matchedDelta = !previous && matchedStatuses.has(current.status) ? 1 : 0;
      const greetingsDelta = previous?.greeted_at || !current.greeted_at ? 0 : 1;
      const responsesDelta = previous?.last_message_at || !current.last_message_at ? 0 : 1;
      const resumesDelta = previous?.resume_downloaded || !current.resume_downloaded ? 0 : 1;

      await applyDailyStatsDelta({
        pool,
        jobId: run.job_id,
        greetingsDelta,
        responsesDelta: responsesDelta || (!previous && responseStatuses.has(current.status) ? 1 : 0),
        resumesDelta,
        seenDelta,
        matchedDelta,
      });

      await createRunEvent({
        pool,
        eventBus,
        runId,
        eventType: "candidate_upserted",
        stage: "candidate_sync",
        message: `候选人 ${current.name} 已写入数据库`,
        payload: {
          candidateId: current.boss_encrypt_geek_id,
          status: current.status,
          resumeDownloaded: current.resume_downloaded,
        },
      });

      return normalizeCandidateRecord(current);
    },

    async agentCompleteRun({
      token,
      runId,
      pagesProcessed = 0,
      candidatesSeen = 0,
      candidatesMatched = 0,
      greetingsSent = 0,
      message,
    }) {
      assertAgentToken(agentToken, token);

      const result = await pool.query(
        `
          UPDATE sourcing_runs
          SET
            status = 'completed',
            pages_processed = $2,
            candidates_seen = $3,
            candidates_matched = $4,
            greetings_sent = $5,
            ended_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [runId, pagesProcessed, candidatesSeen, candidatesMatched, greetingsSent],
      );

      if (result.rowCount === 0) {
        const error = new Error("Run not found");
        error.statusCode = 404;
        throw error;
      }

      await createRunEvent({
        pool,
        eventBus,
        runId,
        eventType: "run_completed",
        stage: "completed",
        message: message || `寻源任务完成，共抓取 ${candidatesSeen} 人，命中 ${candidatesMatched} 人，打招呼 ${greetingsSent} 人`,
        progressPercent: 100,
        payload: {
          pagesProcessed,
          candidatesSeen,
          candidatesMatched,
          greetingsSent,
        },
      });

      return normalizeRunRecord(result.rows[0]);
    },

    async agentFailRun({ token, runId, message }) {
      assertAgentToken(agentToken, token);

      const result = await pool.query(
        `
          UPDATE sourcing_runs
          SET
            status = 'failed',
            error_message = $2,
            ended_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [runId, message || "Agent reported failure"],
      );

      if (result.rowCount === 0) {
        const error = new Error("Run not found");
        error.statusCode = 404;
        throw error;
      }

      await createRunEvent({
        pool,
        eventBus,
        runId,
        eventType: "run_failed",
        stage: "failed",
        message: message || "Agent reported failure",
      });

      return normalizeRunRecord(result.rows[0]);
    },

    async getSourcingRun(runId) {
      const result = await pool.query("SELECT * FROM sourcing_runs WHERE id = $1", [runId]);
      if (result.rowCount === 0) {
        return null;
      }
      return normalizeRunRecord(result.rows[0]);
    },

    async listRunEvents(runId) {
      const result = await pool.query(
        `
          SELECT *
          FROM sourcing_run_events
          WHERE run_id = $1
          ORDER BY id ASC
        `,
        [runId],
      );

      return result.rows.map(normalizeEventRecord);
    },

    async listScheduledJobs() {
      const result = await pool.query(
        `
          SELECT
            scheduled_jobs.*,
            latest_run.id AS last_run_id
          FROM scheduled_jobs
          LEFT JOIN LATERAL (
            SELECT id
            FROM scheduled_job_runs
            WHERE scheduled_job_id = scheduled_jobs.id
            ORDER BY created_at DESC
            LIMIT 1
          ) AS latest_run ON TRUE
          ORDER BY scheduled_jobs.id ASC
        `,
      );

      return result.rows.map(normalizeScheduledJobRecord);
    },

    async listScheduledJobRuns(scheduledJobId = null) {
      const result = await pool.query(
        `
          SELECT *
          FROM scheduled_job_runs
          WHERE ($1::bigint IS NULL OR scheduled_job_id = $1)
          ORDER BY created_at DESC
          LIMIT 50
        `,
        [scheduledJobId],
      );

      return result.rows.map(normalizeScheduledJobRunRecord);
    },

    async createScheduledJob({ name, jobType, cronExpression, payload = {}, isEnabled = true }) {
      const validated = validateScheduledJobInput({ name, jobType, cronExpression, payload });
      const result = await pool.query(
        `
          INSERT INTO scheduled_jobs (
            name,
            job_type,
            cron_expression,
            payload,
            is_enabled,
            updated_at
          )
          VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
          RETURNING *
        `,
        [validated.name, validated.jobType, validated.cronExpression, JSON.stringify(validated.payload), isEnabled],
      );

      await requireScheduler().reload();
      return normalizeScheduledJobRecord(result.rows[0]);
    },

    async updateScheduledJob(id, patch) {
      const currentResult = await pool.query("SELECT * FROM scheduled_jobs WHERE id = $1", [id]);
      if (currentResult.rowCount === 0) {
        const error = new Error("Scheduled job not found");
        error.statusCode = 404;
        throw error;
      }

      const current = currentResult.rows[0];
      const validated = validateScheduledJobInput({
        name: patch.name ?? current.name,
        jobType: patch.jobType ?? current.job_type,
        cronExpression: patch.cronExpression ?? current.cron_expression,
        payload: patch.payload ?? current.payload,
      });
      const result = await pool.query(
        `
          UPDATE scheduled_jobs
          SET
            name = $2,
            job_type = $3,
            cron_expression = $4,
            payload = $5::jsonb,
            is_enabled = $6,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          id,
          validated.name,
          validated.jobType,
          validated.cronExpression,
          JSON.stringify(validated.payload),
          patch.isEnabled ?? current.is_enabled,
        ],
      );

      await requireScheduler().reload();
      return normalizeScheduledJobRecord(result.rows[0]);
    },

    async deleteScheduledJob(id) {
      const result = await pool.query("DELETE FROM scheduled_jobs WHERE id = $1 RETURNING *", [id]);
      if (result.rowCount === 0) {
        const error = new Error("Scheduled job not found");
        error.statusCode = 404;
        throw error;
      }

      await requireScheduler().reload();
      return { deleted: true };
    },

    async runScheduledJobNow(id) {
      const exists = await pool.query("SELECT id FROM scheduled_jobs WHERE id = $1", [id]);
      if (exists.rowCount === 0) {
        const error = new Error("Scheduled job not found");
        error.statusCode = 404;
        throw error;
      }

      await requireScheduler().enqueueNow(id);
      return { queued: true };
    },

    async executeScheduledJob({ scheduledJobId, triggerType = "schedule" }) {
      const jobResult = await pool.query("SELECT * FROM scheduled_jobs WHERE id = $1", [scheduledJobId]);
      if (jobResult.rowCount === 0) {
        return;
      }

      const scheduledJob = jobResult.rows[0];
      if (!scheduledJob.is_enabled && triggerType === "schedule") {
        return;
      }

      const scheduledRun = await insertScheduledJobRun({
        pool,
        scheduledJobId,
        triggerType,
        payload: scheduledJob.payload,
      });

      let summary = "";
      let errorMessage = null;
      let status = "completed";
      let sourcingRunId = null;

      try {
        if (scheduledJob.job_type === "sync_jobs") {
          const runnerResult = await nanobotRunner.runJobSync({
            projectRoot,
            dataFilePath,
            session: `scheduled-sync-${scheduledJobId}-${scheduledRun.id}`,
          });

          if (runnerResult.exitCode !== 0) {
            throw new Error(runnerResult.stderr || runnerResult.stdout || `nanobot exited with code ${runnerResult.exitCode}`);
          }

          const importSummary = await importLegacyDataFn({
            pool,
            jsonPath: dataFilePath,
            projectRoot,
          });
          summary = `岗位 ${importSummary.jobsImported} 条，候选人 ${importSummary.candidatesImported} 条`;
        } else if (scheduledJob.job_type === "followup") {
          const payload = scheduledJob.payload || {};
          const jobKey = payload.jobKey;

          const jobLookup = await pool.query("SELECT * FROM jobs WHERE job_key = $1", [jobKey]);
          if (jobLookup.rowCount === 0) {
            throw new Error(`Job ${jobKey} not found`);
          }

          const sourcingRunResult = await pool.query(
            `
              INSERT INTO sourcing_runs (job_id, status, mode, max_pages, auto_greet, started_at, updated_at)
              VALUES ($1, 'running', 'followup', 0, false, NOW(), NOW())
              RETURNING *
            `,
            [jobLookup.rows[0].id],
          );
          sourcingRunId = Number(sourcingRunResult.rows[0].id);

          const runnerResult = await nanobotRunner.runFollowup({
            jobKey,
            jobName: jobLookup.rows[0].job_name,
            runId: sourcingRunId,
            projectRoot,
            dataFilePath,
            session: `scheduled-followup-${scheduledJobId}-${scheduledRun.id}`,
          });

          if (runnerResult.exitCode !== 0) {
            throw new Error(runnerResult.stderr || runnerResult.stdout || `nanobot exited with code ${runnerResult.exitCode}`);
          }

          const runState = await pool.query("SELECT * FROM sourcing_runs WHERE id = $1", [sourcingRunId]);
          if (runState.rowCount > 0 && runState.rows[0].status === "running") {
            await pool.query(
              `
                UPDATE sourcing_runs
                SET status = 'completed', ended_at = NOW(), updated_at = NOW()
                WHERE id = $1
              `,
              [sourcingRunId],
            );
          }
          summary = `岗位 ${jobKey} 定时跟进执行完成`;
        } else {
          throw new Error(`Unsupported scheduled job type: ${scheduledJob.job_type}`);
        }
      } catch (error) {
        status = "failed";
        errorMessage = error.message;
        summary = error.message;
      }

      await updateScheduledJobRun({
        pool,
        scheduledJobRunId: scheduledRun.id,
        status,
        summary,
        errorMessage,
        sourcingRunId,
      });

      await pool.query(
        `
          UPDATE scheduled_jobs
          SET
            last_run_at = NOW(),
            last_run_status = $2,
            last_error = $3,
            updated_at = NOW()
          WHERE id = $1
        `,
        [scheduledJobId, status, errorMessage],
      );

      eventBus.emit({
        channel: "scheduled_job_run",
        scheduledJobId,
        scheduledJobRunId: Number(scheduledRun.id),
        status,
        summary,
        errorMessage,
      });
    },

    openStream(response) {
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders?.();
      response.write(`event: connected\ndata: ${JSON.stringify({ status: "ok" })}\n\n`);

      const unsubscribe = eventBus.subscribe((event) => {
        response.write(`event: ${event.channel || "message"}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        response.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
      }, 15000);

      streamSubscriptions.set(response, () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },

    closeStream(response) {
      const dispose = streamSubscriptions.get(response);
      if (dispose) {
        dispose();
        streamSubscriptions.delete(response);
      }
    },
  };
}
