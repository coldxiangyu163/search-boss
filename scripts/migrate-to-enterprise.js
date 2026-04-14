#!/usr/bin/env node
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { loadConfig } = require('../src/config');
const { ensureDatabaseSchema } = require('../src/db/init');

async function main() {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();

  try {
    await ensureDatabaseSchema(client);
    console.log('[migrate] schema applied');

    await client.query('begin');

    // Create default department
    const deptResult = await client.query(`
      insert into departments (name)
      values ('默认部门')
      on conflict do nothing
      returning id
    `);
    let deptId = deptResult.rows[0]?.id;
    if (!deptId) {
      const existing = await client.query("select id from departments where name = '默认部门' limit 1");
      deptId = existing.rows[0]?.id;
    }
    console.log(`[migrate] department id: ${deptId}`);

    const legacyAdminResult = await client.query(`
      update users
      set role = 'dept_admin',
          updated_at = now()
      where role = 'enterprise_admin'
    `);
    console.log(`[migrate] migrated legacy enterprise_admin users: ${legacyAdminResult.rowCount}`);

    // Create default admin
    const adminHash = await bcrypt.hash('admin123', 10);
    const adminResult = await client.query(`
      insert into users (department_id, name, email, password_hash, role)
      values ($1, '默认管理员', 'admin@company.com', $2, 'system_admin')
      on conflict (email) do nothing
      returning id
    `, [deptId, adminHash]);
    let adminId = adminResult.rows[0]?.id;
    if (!adminId) {
      const existing = await client.query("select id from users where email = 'admin@company.com' limit 1");
      adminId = existing.rows[0]?.id;
    }
    console.log(`[migrate] admin user id: ${adminId}`);

    // Create default HR user
    const hrHash = await bcrypt.hash('hr123456', 10);
    const hrUserResult = await client.query(`
      insert into users (department_id, name, email, password_hash, role)
      values ($1, '默认HR', 'hr@company.com', $2, 'hr')
      on conflict (email) do nothing
      returning id
    `, [deptId, hrHash]);
    let hrUserId = hrUserResult.rows[0]?.id;
    if (!hrUserId) {
      const existing = await client.query("select id from users where email = 'hr@company.com' limit 1");
      hrUserId = existing.rows[0]?.id;
    }
    console.log(`[migrate] hr user id: ${hrUserId}`);

    // Create default HR account
    const hrAccountResult = await client.query(`
      insert into hr_accounts (user_id, department_id, manager_user_id, name)
      select $1, $2, $3, '默认HR'
      where not exists (select 1 from hr_accounts where user_id = $1)
      returning id
    `, [hrUserId, deptId, adminId]);
    let hrAccountId = hrAccountResult.rows[0]?.id;
    if (!hrAccountId) {
      const existing = await client.query("select id from hr_accounts where user_id = $1 limit 1", [hrUserId]);
      hrAccountId = existing.rows[0]?.id;
    }
    console.log(`[migrate] hr account id: ${hrAccountId}`);

    // Associate existing data
    const updates = await Promise.all([
      client.query('update jobs set hr_account_id = $1 where hr_account_id is null', [hrAccountId]),
      client.query('update sourcing_runs set hr_account_id = $1 where hr_account_id is null', [hrAccountId]),
      client.query('update job_candidates set hr_account_id = $1 where hr_account_id is null', [hrAccountId]),
      client.query('update scheduled_jobs set hr_account_id = $1 where hr_account_id is null', [hrAccountId])
    ]);

    console.log(`[migrate] updated rows: jobs=${updates[0].rowCount}, runs=${updates[1].rowCount}, candidates=${updates[2].rowCount}, schedules=${updates[3].rowCount}`);

    await client.query('commit');
    console.log('[migrate] done');
  } catch (err) {
    await client.query('rollback');
    console.error('[migrate] failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
