const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { exportExecutionData } = require('../src/services/execution-export-service');
const { executeCli } = require('../scripts/export-job-execution-data');

test('exportExecutionData exports normalized execution data for one job', async () => {
  const queryCalls = [];
  let released = false;
  const client = {
    async query(sql, params) {
      queryCalls.push({ sql, params });

      if (sql.includes('from jobs')) {
        return {
          rows: [
            {
              job_key: '健康顾问_B0047007',
              boss_encrypt_job_id: 'enc-job-1',
              job_name: '健康顾问（B0047007）',
              city: '上海',
              salary: '15k-25k',
              status: 'open',
              source: 'boss',
              jd_text: '岗位描述',
              custom_requirement: '只看医疗销售经验',
              sync_metadata: { channel: 'boss' },
              last_synced_at: '2026-03-27T09:00:00.000Z',
              created_at: '2026-03-26T09:00:00.000Z',
              updated_at: '2026-03-27T09:10:00.000Z'
            }
          ]
        };
      }

      if (sql.includes('from sourcing_runs sr')) {
        return {
          rows: [
            {
              run_key: 'followup:健康顾问_B0047007:1711526400000',
              job_key: '健康顾问_B0047007',
              mode: 'followup',
              status: 'completed',
              attempt_count: 1,
              started_at: '2026-03-27T10:00:00.000Z',
              completed_at: '2026-03-27T10:05:00.000Z',
              created_at: '2026-03-27T10:00:00.000Z',
              updated_at: '2026-03-27T10:05:00.000Z'
            }
          ]
        };
      }

      if (sql.includes('from sourcing_run_events sre')) {
        return {
          rows: [
            {
              run_key: 'followup:健康顾问_B0047007:1711526400000',
              attempt_id: 'attempt-1',
              event_id: 'followup:1:sent',
              sequence: 1,
              stage: 'followup',
              event_type: 'message_sent',
              message: '已发送跟进消息',
              payload: { candidateId: 11 },
              occurred_at: '2026-03-27T10:01:00.000Z',
              created_at: '2026-03-27T10:01:00.000Z'
            }
          ]
        };
      }

      if (sql.includes('from scheduled_jobs')) {
        return {
          rows: [
            {
              job_key: '健康顾问_B0047007',
              task_type: 'followup',
              cron_expression: '0 10 * * *',
              enabled: true,
              payload: { batchSize: 20 },
              last_run_at: '2026-03-27T10:00:00.000Z',
              created_at: '2026-03-26T11:00:00.000Z',
              updated_at: '2026-03-27T10:05:00.000Z'
            }
          ]
        };
      }

      if (sql.includes('from scheduled_job_runs sjr')) {
        return {
          rows: [
            {
              job_key: '健康顾问_B0047007',
              task_type: 'followup',
              run_key: 'followup:健康顾问_B0047007:1711526400000',
              status: 'completed',
              started_at: '2026-03-27T10:00:00.000Z',
              finished_at: '2026-03-27T10:05:00.000Z',
              created_at: '2026-03-27T09:59:59.000Z'
            }
          ]
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {
      released = true;
    }
  };

  const pool = {
    async connect() {
      return client;
    }
  };

  const result = await exportExecutionData({
    pool,
    jobKey: '健康顾问_B0047007',
    exportedAt: '2026-03-27T12:00:00.000Z'
  });

  assert.equal(released, true);
  assert.equal(result.exportedAt, '2026-03-27T12:00:00.000Z');
  assert.deepEqual(result.filter, { jobKey: '健康顾问_B0047007' });
  assert.equal(result.jobs[0].job_key, '健康顾问_B0047007');
  assert.equal(result.sourcingRuns[0].run_key, 'followup:健康顾问_B0047007:1711526400000');
  assert.equal(result.sourcingRunEvents[0].run_key, 'followup:健康顾问_B0047007:1711526400000');
  assert.equal(result.scheduledJobRuns[0].task_type, 'followup');
  assert.deepEqual(
    queryCalls.map((call) => call.params),
    [
      ['健康顾问_B0047007'],
      ['健康顾问_B0047007'],
      ['健康顾问_B0047007'],
      ['健康顾问_B0047007'],
      ['健康顾问_B0047007']
    ]
  );
});

test('export job execution cli writes JSON export file', async () => {
  const stdoutChunks = [];
  const stderrChunks = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-job-execution-'));
  const outputFile = path.join(tempDir, 'job-execution.json');

  const result = await executeCli(
    ['--job', '健康顾问_B0047007', '--output', outputFile],
    {
      env: {
        DATABASE_URL: 'postgresql://example/search_boss',
        AGENT_TOKEN: 'token',
        NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
      },
      stdout: { write(chunk) { stdoutChunks.push(String(chunk)); } },
      stderr: { write(chunk) { stderrChunks.push(String(chunk)); } },
      exportExecutionDataImpl: async () => ({
        exportedAt: '2026-03-27T12:00:00.000Z',
        filter: { jobKey: '健康顾问_B0047007' },
        jobs: [{ job_key: '健康顾问_B0047007' }],
        sourcingRuns: [{ run_key: 'run-1' }],
        sourcingRunEvents: [{ event_id: 'event-1' }],
        scheduledJobs: [{ task_type: 'followup' }],
        scheduledJobRuns: [{ status: 'completed' }]
      })
    }
  );

  const exported = JSON.parse(await fs.readFile(outputFile, 'utf8'));

  assert.equal(result.exitCode, 0);
  assert.equal(stderrChunks.length, 0);
  assert.equal(exported.jobs[0].job_key, '健康顾问_B0047007');
  assert.match(stdoutChunks.join(''), /job-execution\.json/);
  assert.match(stdoutChunks.join(''), /"sourcingRuns": 1/);
});
