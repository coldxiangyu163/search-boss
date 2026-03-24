import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ensureDatabase, initializeSchema, resetSchema } from "../src/db/init.js";
import { createPool } from "../src/db/pool.js";
import { importLegacyData } from "../src/services/import-service.js";

const adminConfig = {
  host: "127.0.0.1",
  port: 5432,
  user: "coldxiangyu",
  password: "coldxiangyu",
  database: "postgres",
};

const databaseName = "search_boss_admin_test";
const fixtureRoot = fileURLToPath(new URL("./fixtures/", import.meta.url));
const legacyJsonPath = path.join(fixtureRoot, "legacy-candidates.json");

async function withTestPool(callback) {
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

  try {
    await callback(pool);
  } finally {
    await pool.end();
  }
}

test("database bootstrap creates required tables", async () => {
  await withTestPool(async (pool) => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tableNames = result.rows.map((row) => row.table_name);

    assert.deepEqual(
      tableNames,
      [
        "candidates",
        "daily_job_stats",
        "jobs",
        "scheduled_job_runs",
        "scheduled_jobs",
        "sourcing_run_events",
        "sourcing_runs",
      ],
    );
  });
});

test("legacy JSON import loads jobs, candidates, and daily stats", async () => {
  await withTestPool(async (pool) => {
    const summary = await importLegacyData({
      pool,
      jsonPath: legacyJsonPath,
      projectRoot: fixtureRoot,
    });

    assert.equal(summary.jobsImported, 1);
    assert.equal(summary.candidatesImported, 1);
    assert.equal(summary.dailyStatsImported, 1);

    const jobs = await pool.query("SELECT job_name, city, min_degree, jd_path FROM jobs");
    assert.equal(jobs.rowCount, 1);
    assert.equal(jobs.rows[0].job_name, "健康顾问（B0047007）");
    assert.equal(jobs.rows[0].city, "重庆");
    assert.equal(jobs.rows[0].min_degree, "大专");
    assert.equal(jobs.rows[0].jd_path, "健康顾问_B0047007.md");

    const candidates = await pool.query("SELECT name, status, city FROM candidates");
    assert.equal(candidates.rowCount, 1);
    assert.equal(candidates.rows[0].name, "测试候选人");
    assert.equal(candidates.rows[0].status, "greeted");
    assert.equal(candidates.rows[0].city, "重庆");

    const dailyStats = await pool.query("SELECT stat_date, greetings_sent FROM daily_job_stats");
    assert.equal(dailyStats.rowCount, 1);
    const statDate = dailyStats.rows[0].stat_date;
    const localDate = [
      statDate.getFullYear(),
      String(statDate.getMonth() + 1).padStart(2, "0"),
      String(statDate.getDate()).padStart(2, "0"),
    ].join("-");
    assert.equal(localDate, "2026-03-24");
    assert.equal(dailyStats.rows[0].greetings_sent, 3);
  });
});
