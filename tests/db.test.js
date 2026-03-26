const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const { ensureDatabaseSchema } = require('../src/db/init');

const targetDatabase = process.env.DATABASE_URL || 'postgresql://coldxiangyu:coldxiangyu@127.0.0.1:5432/search_boss_ops_20260324';

test('database schema includes job custom requirement column', async () => {
  const schema = fs.readFileSync(
    path.join(__dirname, '../src/db/schema.sql'),
    'utf8'
  );

  assert.match(schema, /custom_requirement text/);
});

test('database bootstrap creates required tables', async () => {
  const client = new Client({ connectionString: targetDatabase });
  await client.connect();

  try {
    await ensureDatabaseSchema(client);
    const result = await client.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'jobs',
          'people',
          'job_candidates',
          'candidate_messages',
          'candidate_actions',
          'candidate_attachments',
          'daily_job_stats',
          'scheduled_jobs',
          'scheduled_job_runs',
          'sourcing_runs',
          'sourcing_run_events'
        )
      order by table_name
    `);

    assert.deepEqual(
      result.rows.map((row) => row.table_name),
      [
        'candidate_actions',
        'candidate_attachments',
        'candidate_messages',
        'daily_job_stats',
        'job_candidates',
        'jobs',
        'people',
        'scheduled_job_runs',
        'scheduled_jobs',
        'sourcing_run_events',
        'sourcing_runs'
      ]
    );
  } finally {
    await client.end();
  }
});

test('database bootstrap creates agent callback indexes', async () => {
  const client = new Client({ connectionString: targetDatabase });
  await client.connect();

  try {
    await ensureDatabaseSchema(client);
    const result = await client.query(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'candidate_attachments_boss_attachment_id_unique',
          'candidate_attachments_sha256_unique'
        )
      order by indexname
    `);

    assert.deepEqual(
      result.rows.map((row) => row.indexname),
      [
        'candidate_attachments_boss_attachment_id_unique',
        'candidate_attachments_sha256_unique'
      ]
    );
  } finally {
    await client.end();
  }
});
