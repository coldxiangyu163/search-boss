import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import { createApp } from "../src/app.js";
import { ensureDatabase, initializeSchema, resetSchema } from "../src/db/init.js";
import { createPool } from "../src/db/pool.js";
import { importLegacyData } from "../src/services/import-service.js";
import { buildServices } from "../src/services/index.js";
import { createEventBus } from "../src/services/event-bus.js";
import { createSchedulerService } from "../src/services/scheduler-service.js";

const adminConfig = {
  host: "127.0.0.1",
  port: 5432,
  user: "coldxiangyu",
  password: "coldxiangyu",
  database: "postgres",
};

const databaseName = "search_boss_admin_test";
const fixtureRoot = fileURLToPath(new URL("./fixtures/", import.meta.url));
const agentToken = "test-agent-token";
async function makeProjectFixture() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "search-boss-api-"));
  await fs.copyFile(path.join(fixtureRoot, "legacy-candidates.json"), path.join(tempRoot, "candidates.json"));
  await fs.copyFile(path.join(fixtureRoot, "健康顾问_B0047007.md"), path.join(tempRoot, "健康顾问_B0047007.md"));
  return {
    root: tempRoot,
    jsonPath: path.join(tempRoot, "candidates.json"),
  };
}

async function setupPool({ projectRoot, jsonPath }) {
  await ensureDatabase({ adminConfig, databaseName });

  const pool = createPool({
    host: adminConfig.host,
    port: adminConfig.port,
    user: adminConfig.user,
    password: adminConfig.password,
    database: databaseName,
  });

  await resetSchema(pool);
  await initializeSchema(pool);
  await importLegacyData({
    pool,
    jsonPath,
    projectRoot,
  });

  return pool;
}

async function startServer({ pool, nanobotRunner, projectRoot, useRealScheduler = false }) {
  const eventBus = createEventBus();
  const services = buildServices({
    pool,
    eventBus,
    nanobotRunner,
    projectRoot,
    agentToken,
  });

  let schedulerService;
  if (useRealScheduler) {
    schedulerService = createSchedulerService({
      pool,
      eventBus,
      pollInterval: 250,
      onExecuteScheduledJob: (payload) => services.executeScheduledJob(payload),
    });
    services.setSchedulerService(schedulerService);
    await schedulerService.start();
  } else {
    schedulerService = {
      async reload() {},
      async enqueueNow() {},
      async stop() {},
    };
    services.setSchedulerService(schedulerService);
  }

  const app = createApp({ services });
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    services,
    close: async () => {
      await schedulerService.stop();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function waitFor(assertion, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await assertion();
    if (result) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for condition");
}

test("dashboard summary and jobs API return imported data", async () => {
  const fixture = await makeProjectFixture();
  const pool = await setupPool({ projectRoot: fixture.root, jsonPath: fixture.jsonPath });
  const nanobotRunner = {
    async runJobSync() {
      return { exitCode: 0 };
    },
  };

  const server = await startServer({
    pool,
    nanobotRunner,
    projectRoot: fixture.root,
  });

  try {
    const summaryResponse = await fetch(`${server.baseUrl}/api/dashboard/summary`);
    const summary = await summaryResponse.json();

    assert.equal(summaryResponse.status, 200);
    assert.equal(summary.totalJobs, 1);
    assert.equal(summary.totalCandidates, 1);
    assert.equal(summary.todayGreetings, 3);

    const jobsResponse = await fetch(`${server.baseUrl}/api/jobs`);
    const jobs = await jobsResponse.json();

    assert.equal(jobsResponse.status, 200);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].jobName, "健康顾问（B0047007）");
    assert.equal(jobs[0].candidateCount, 1);
  } finally {
    await server.close();
    await pool.end();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("BOSS sync API triggers nanobot and writes jobs via Agent API", async () => {
  const fixture = await makeProjectFixture();
  const pool = await setupPool({ projectRoot: fixture.root, jsonPath: fixture.jsonPath });
  let serverBaseUrl;
  const nanobotRunner = {
    async runJobSync({ onStdout }) {
      onStdout?.("开始同步岗位");

      await fetch(`${serverBaseUrl}/api/agent/jobs/batch?token=${agentToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobs: [{
            jobKey: "客服_B0099001",
            encryptJobId: "job_encrypt_new",
            jobName: "客服（B0099001）",
            salary: "8-10K",
            city: "上海",
            status: "open",
          }],
        }),
      });

      onStdout?.("岗位同步完成");
      return { exitCode: 0 };
    },
  };

  const server = await startServer({
    pool,
    nanobotRunner,
    projectRoot: fixture.root,
  });
  serverBaseUrl = server.baseUrl;

  try {
    const response = await fetch(`${server.baseUrl}/api/boss/jobs/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.jobsImported, 2);

    const jobsResponse = await fetch(`${server.baseUrl}/api/jobs`);
    const jobs = await jobsResponse.json();

    assert.equal(jobs.length, 2);
    assert.ok(jobs.some((j) => j.jobName === "客服（B0099001）"));
  } finally {
    await server.close();
    await pool.end();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("sourcing run API executes nanobot and persists stepwise DB updates from Agent API", async () => {
  const fixture = await makeProjectFixture();
  const pool = await setupPool({ projectRoot: fixture.root, jsonPath: fixture.jsonPath });
  let serverBaseUrl;
  const nanobotRunner = {
    async runSourcing({ runId, onStdout }) {
      onStdout?.("开始第 1 页寻源");
      onStdout?.("已向候选人 新增候选人 打招呼");

      await fetch(`${serverBaseUrl}/api/agent/runs/${runId}/candidates?token=${agentToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bossEncryptGeekId: "boss_candidate_002",
          name: "新增候选人",
          education: "本科",
          experience: "5年",
          expectedSalary: "6-8K",
          city: "重庆",
          age: "29岁",
          school: "重庆大学",
          position: "健康顾问",
          greetedAt: "2026-03-24T12:00:00+08:00",
          status: "greeted",
        }),
      });

      await fetch(`${serverBaseUrl}/api/agent/runs/${runId}/complete?token=${agentToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagesProcessed: 1, candidatesSeen: 1, candidatesMatched: 1, greetingsSent: 1 }),
      });

      onStdout?.("寻源完成");
      return { exitCode: 0 };
    },
  };

  const server = await startServer({
    pool,
    nanobotRunner,
    projectRoot: fixture.root,
  });
  serverBaseUrl = server.baseUrl;

  try {
    const jobsResult = await pool.query("SELECT id FROM jobs ORDER BY id LIMIT 1");
    const jobId = jobsResult.rows[0].id;

    const response = await fetch(`${server.baseUrl}/api/jobs/${jobId}/sourcing-runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxPages: 1, autoGreet: true }),
    });

    const payload = await response.json();
    assert.equal(response.status, 202);
    assert.equal(payload.status, "running");

    const completedRun = await waitFor(async () => {
      const runResponse = await fetch(`${server.baseUrl}/api/sourcing-runs/${payload.id}`);
      const run = await runResponse.json();
      return run.status === "completed" ? run : null;
    });

    assert.equal(completedRun.pagesProcessed, 1);
    assert.equal(completedRun.candidatesSeen, 1);
    assert.equal(completedRun.candidatesMatched, 1);
    assert.equal(completedRun.greetingsSent, 1);

    const candidatesResponse = await fetch(`${server.baseUrl}/api/jobs/${jobId}/candidates`);
    const candidates = await candidatesResponse.json();

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].name, "新增候选人");

    const eventsResponse = await fetch(`${server.baseUrl}/api/sourcing-runs/${payload.id}/events`);
    const events = await eventsResponse.json();

    assert.ok(events.length >= 3);
    assert.equal(events[0].eventType, "run_started");
    assert.equal(events[1].eventType, "agent_output");

    const streamResponse = await fetch(`${server.baseUrl}/api/stream`);
    assert.equal(streamResponse.status, 200);
    assert.match(streamResponse.headers.get("content-type"), /^text\/event-stream/);
    streamResponse.body.cancel();
  } finally {
    await server.close();
    await pool.end();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("sourcing run stays DB-only and fails if agent never completes through Agent API", async () => {
  const fixture = await makeProjectFixture();
  const pool = await setupPool({ projectRoot: fixture.root, jsonPath: fixture.jsonPath });
  const nanobotRunner = {
    async runSourcing({ onStdout }) {
      onStdout?.("开始第 1 页寻源");
      onStdout?.("未调用完成接口，直接退出");
      return { exitCode: 0 };
    },
  };

  const server = await startServer({
    pool,
    nanobotRunner,
    projectRoot: fixture.root,
  });

  try {
    const jobsResult = await pool.query("SELECT id FROM jobs ORDER BY id LIMIT 1");
    const jobId = jobsResult.rows[0].id;

    const response = await fetch(`${server.baseUrl}/api/jobs/${jobId}/sourcing-runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxPages: 1, autoGreet: true }),
    });

    const payload = await response.json();
    assert.equal(response.status, 202);

    const failedRun = await waitFor(async () => {
      const runResponse = await fetch(`${server.baseUrl}/api/sourcing-runs/${payload.id}`);
      const run = await runResponse.json();
      return run.status === "failed" ? run : null;
    });

    assert.match(failedRun.errorMessage, /did not call \/complete or \/fail/i);

    const candidateCount = await pool.query("SELECT COUNT(*)::int AS count FROM candidates");
    assert.equal(candidateCount.rows[0].count, 1);

    const eventsResponse = await fetch(`${server.baseUrl}/api/sourcing-runs/${payload.id}/events`);
    const events = await eventsResponse.json();
    assert.equal(events.at(-1).eventType, "run_failed");
    assert.match(events.at(-1).message, /did not call \/complete or \/fail/i);
  } finally {
    await server.close();
    await pool.end();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("agent APIs upsert jobs and candidate progress without duplicate resume downloads", async () => {
  const fixture = await makeProjectFixture();
  const pool = await setupPool({ projectRoot: fixture.root, jsonPath: fixture.jsonPath });
  const nanobotRunner = {
    async runJobSync() {
      return { exitCode: 0 };
    },
    async runSourcing() {
      return { exitCode: 0 };
    },
  };

  const server = await startServer({
    pool,
    nanobotRunner,
    projectRoot: fixture.root,
  });

  try {
    const jobsResponse = await fetch(`${server.baseUrl}/api/agent/jobs/batch?token=${agentToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobs: [
          {
            jobKey: "客服_B0099001",
            encryptJobId: "job_encrypt_new",
            jobName: "客服（B0099001）",
            salary: "8-10K",
            city: "上海",
            status: "open",
          },
        ],
      }),
    });

    assert.equal(jobsResponse.status, 200);
    const jobsPayload = await jobsResponse.json();
    assert.equal(jobsPayload.jobsImported, 1);

    const jobsResult = await pool.query("SELECT id FROM jobs WHERE job_key = '健康顾问_B0047007' LIMIT 1");
    const jobId = jobsResult.rows[0].id;

    const runInsert = await pool.query(
      `
        INSERT INTO sourcing_runs (job_id, status, mode, max_pages, auto_greet, started_at, updated_at)
        VALUES ($1, 'running', 'source', 2, true, NOW(), NOW())
        RETURNING *
      `,
      [jobId],
    );
    const run = runInsert.rows[0];

    const eventResponse = await fetch(`${server.baseUrl}/api/agent/runs/${run.id}/events?token=${agentToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "page_fetch_started",
        stage: "fetch_candidates",
        message: "开始抓取第 1 页",
        progressPercent: 10,
      }),
    });
    assert.equal(eventResponse.status, 200);

    const candidatePayload = {
      bossEncryptGeekId: "candidate-live-001",
      name: "实时候选人",
      education: "本科",
      experience: "4年",
      expectedSalary: "6-8K",
      city: "重庆",
      age: "28岁",
      school: "重庆大学",
      position: "健康顾问",
      status: "greeted",
      greetedAt: "2026-03-24T15:00:00+08:00",
      lastMessageAt: "2026-03-24T15:10:00+08:00",
      notes: "已发送简历",
      resumeDownloaded: true,
      resumePath: "resumes/健康顾问_B0047007/实时候选人.pdf",
      metadata: { source: "agent" },
    };

    const candidateResponse1 = await fetch(`${server.baseUrl}/api/agent/runs/${run.id}/candidates?token=${agentToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(candidatePayload),
    });
    assert.equal(candidateResponse1.status, 200);

    const candidateResponse2 = await fetch(`${server.baseUrl}/api/agent/runs/${run.id}/candidates?token=${agentToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(candidatePayload),
    });
    assert.equal(candidateResponse2.status, 200);

    const progressResponse = await fetch(`${server.baseUrl}/api/agent/runs/${run.id}/progress?token=${agentToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pagesProcessed: 1,
        candidatesSeen: 1,
        candidatesMatched: 1,
        greetingsSent: 1,
      }),
    });
    assert.equal(progressResponse.status, 200);

    const completeResponse = await fetch(`${server.baseUrl}/api/agent/runs/${run.id}/complete?token=${agentToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pagesProcessed: 1,
        candidatesSeen: 1,
        candidatesMatched: 1,
        greetingsSent: 1,
        message: "任务结束",
      }),
    });
    assert.equal(completeResponse.status, 200);

    const candidateRows = await pool.query("SELECT * FROM candidates WHERE boss_encrypt_geek_id = 'candidate-live-001'");
    assert.equal(candidateRows.rowCount, 1);
    assert.equal(candidateRows.rows[0].resume_downloaded, true);
    assert.equal(candidateRows.rows[0].resume_path, "resumes/健康顾问_B0047007/实时候选人.pdf");

    const candidateStateResponse = await fetch(`${server.baseUrl}/api/agent/jobs/%E5%81%A5%E5%BA%B7%E9%A1%BE%E9%97%AE_B0047007/candidates/candidate-live-001?token=${agentToken}`);
    assert.equal(candidateStateResponse.status, 200);
    const candidateState = await candidateStateResponse.json();
    assert.equal(candidateState.resumeDownloaded, true);

    const dailyStats = await pool.query(
      `
        SELECT
          SUM(greetings_sent)::int AS greetings_sent,
          SUM(responses_received)::int AS responses_received,
          SUM(resumes_downloaded)::int AS resumes_downloaded
        FROM daily_job_stats
        WHERE job_id = $1
      `,
      [jobId],
    );
    assert.equal(dailyStats.rows[0].greetings_sent, 4);
    assert.equal(dailyStats.rows[0].responses_received, 2);
    assert.equal(dailyStats.rows[0].resumes_downloaded, 1);

    const completedRun = await waitFor(async () => {
      const runStateResponse = await fetch(`${server.baseUrl}/api/sourcing-runs/${run.id}`);
      const runState = await runStateResponse.json();
      return runState.status === "completed" ? runState : null;
    });
    assert.equal(completedRun.greetingsSent, 1);
  } finally {
    await server.close();
    await pool.end();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("scheduled job APIs create jobs and Graphile Worker can execute run-now followup tasks", async () => {
  const fixture = await makeProjectFixture();
  const pool = await setupPool({ projectRoot: fixture.root, jsonPath: fixture.jsonPath });
  const nanobotRunner = {
    async runJobSync() {
      return { exitCode: 0 };
    },
    async runSourcing() {
      return { exitCode: 0 };
    },
    async runFollowup({ jobKey, runId, onStdout }) {
      onStdout?.(`开始跟进 ${jobKey}`);
      await pool.query(
        `
          UPDATE sourcing_runs
          SET
            status = 'completed',
            pages_processed = 0,
            candidates_seen = 0,
            candidates_matched = 0,
            greetings_sent = 0,
            ended_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
        `,
        [runId],
      );
      return { exitCode: 0 };
    },
  };

  const server = await startServer({
    pool,
    nanobotRunner,
    projectRoot: fixture.root,
    useRealScheduler: true,
  });

  try {
    const createResponse = await fetch(`${server.baseUrl}/api/scheduled-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "健康顾问定时跟进",
        jobType: "followup",
        cronExpression: "*/15 * * * *",
        payload: {
          jobKey: "健康顾问_B0047007",
        },
        isEnabled: true,
      }),
    });
    assert.equal(createResponse.status, 201);
    const scheduledJob = await createResponse.json();
    assert.equal(scheduledJob.jobType, "followup");

    const listResponse = await fetch(`${server.baseUrl}/api/scheduled-jobs`);
    const scheduledJobs = await listResponse.json();
    assert.equal(scheduledJobs.length, 1);
    assert.equal(scheduledJobs[0].name, "健康顾问定时跟进");

    const runNowResponse = await fetch(`${server.baseUrl}/api/scheduled-jobs/${scheduledJob.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(runNowResponse.status, 202);

    const scheduledRuns = await waitFor(async () => {
      const response = await fetch(`${server.baseUrl}/api/scheduled-job-runs?scheduledJobId=${scheduledJob.id}`);
      const runs = await response.json();
      return runs.find((run) => run.status === "completed") ? runs : null;
    }, 5000);

    assert.equal(scheduledRuns[0].status, "completed");
    assert.equal(scheduledRuns[0].triggerType, "manual");

    const updatedJobsResponse = await fetch(`${server.baseUrl}/api/scheduled-jobs`);
    const updatedJobs = await updatedJobsResponse.json();
    assert.equal(updatedJobs[0].lastRunStatus, "completed");

    const sourcingRunsResponse = await fetch(`${server.baseUrl}/api/sourcing-runs/${scheduledRuns[0].sourcingRunId}`);
    const sourcingRun = await sourcingRunsResponse.json();
    assert.equal(sourcingRun.status, "completed");
    assert.equal(sourcingRun.mode, "followup");
  } finally {
    await server.close();
    await pool.end();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("scheduled job API rejects invalid cron expressions without persisting the job", async () => {
  const fixture = await makeProjectFixture();
  const pool = await setupPool({ projectRoot: fixture.root, jsonPath: fixture.jsonPath });
  const nanobotRunner = {
    async runJobSync() {
      return { exitCode: 0 };
    },
    async runSourcing() {
      return { exitCode: 0 };
    },
    async runFollowup() {
      return { exitCode: 0 };
    },
  };

  const server = await startServer({
    pool,
    nanobotRunner,
    projectRoot: fixture.root,
    useRealScheduler: true,
  });

  try {
    const createResponse = await fetch(`${server.baseUrl}/api/scheduled-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "非法任务",
        jobType: "followup",
        cronExpression: "not-a-cron",
        payload: {
          jobKey: "健康顾问_B0047007",
        },
        isEnabled: true,
      }),
    });

    const payload = await createResponse.json();
    assert.equal(createResponse.status, 400);
    assert.match(payload.error, /Invalid cron expression/);

    const listResponse = await fetch(`${server.baseUrl}/api/scheduled-jobs`);
    const scheduledJobs = await listResponse.json();
    assert.equal(scheduledJobs.length, 0);
  } finally {
    await server.close();
    await pool.end();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
