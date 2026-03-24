import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export async function ensureDatabase({ adminConfig, databaseName }) {
  const client = new Client({
    host: adminConfig.host,
    port: Number(adminConfig.port || 5432),
    user: adminConfig.user,
    password: adminConfig.password,
    database: adminConfig.database || "postgres",
  });

  await client.connect();

  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (result.rowCount === 0) {
      try {
        await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      } catch (error) {
        if (error.code !== "42P04" && error.code !== "23505") {
          throw error;
        }
      }
    }
  } finally {
    await client.end();
  }
}

export async function initializeSchema(pool) {
  const schemaSql = await fs.readFile(schemaPath, "utf8");
  await pool.query(schemaSql);
  await pool.query(`
    UPDATE sourcing_runs
    SET status = 'failed',
        error_message = 'timeout: recovered on restart',
        ended_at = NOW(),
        updated_at = NOW()
    WHERE status = 'running'
      AND started_at < NOW() - INTERVAL '30 minutes'
  `);
}

export async function resetSchema(pool) {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}
