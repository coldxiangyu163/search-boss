const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  executeCli
} = require('../scripts/agent-callback-cli');

test('agent callback cli jobs-batch posts payload file to agent jobs batch endpoint', async () => {
  const calls = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-callback-cli-'));
  const payloadFile = path.join(tempDir, 'jobs.json');

  await fs.writeFile(payloadFile, JSON.stringify({
    jobs: [
      {
        jobKey: '健康顾问_B0047007',
        encryptJobId: 'enc-1',
        jobName: '健康顾问（B0047007）'
      }
    ]
  }));

  const result = await executeCli(
    ['jobs-batch', '--run-id', '132', '--file', payloadFile, '--api-base', 'http://127.0.0.1:3000', '--token', 'search-boss-local-agent'],
    {
      requestImpl: async (request) => {
        calls.push(request);
        return {
          status: 200,
          json: async () => ({ ok: true, syncedCount: 1 })
        };
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:3000/api/agent/jobs/batch?token=search-boss-local-agent');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.runId, '132');
  assert.equal(calls[0].body.jobs[0].jobKey, '健康顾问_B0047007');
});

test('agent callback cli run-import-events posts payload file to run import events endpoint', async () => {
  const calls = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-callback-cli-'));
  const payloadFile = path.join(tempDir, 'import.json');

  await fs.writeFile(payloadFile, JSON.stringify({
    attemptId: 'attempt-1',
    events: [
      {
        eventId: 'greet:41:geek-1',
        eventType: 'greet_sent'
      }
    ]
  }));

  const result = await executeCli(
    ['run-import-events', '--run-id', '41', '--file', payloadFile],
    {
      requestImpl: async (request) => {
        calls.push(request);
        return {
          status: 200,
          json: async () => ({ ok: true, importedCount: 1 })
        };
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, 'http://127.0.0.1:3000/api/agent/runs/41/import-events?token=search-boss-local-agent');
  assert.equal(calls[0].body.attemptId, 'attempt-1');
  assert.equal(calls[0].body.events.length, 1);
});

test('agent callback cli run-fail posts payload file to run fail endpoint', async () => {
  const calls = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-callback-cli-'));
  const payloadFile = path.join(tempDir, 'fail.json');

  await fs.writeFile(payloadFile, JSON.stringify({
    eventId: 'run-failed:41:attempt-1',
    message: 'resume callback not persisted'
  }));

  const result = await executeCli(
    ['run-fail', '--run-id', '41', '--file', payloadFile],
    {
      requestImpl: async (request) => {
        calls.push(request);
        return {
          status: 200,
          json: async () => ({ ok: true, status: 'failed' })
        };
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, 'http://127.0.0.1:3000/api/agent/runs/41/fail?token=search-boss-local-agent');
  assert.equal(calls[0].body.runId, '41');
  assert.equal(calls[0].body.message, 'resume callback not persisted');
});

test('agent callback cli dashboard-summary gets local dashboard summary endpoint', async () => {
  const calls = [];

  const result = await executeCli(
    ['dashboard-summary'],
    {
      requestImpl: async (request) => {
        calls.push(request);
        return {
          status: 200,
          json: async () => ({ kpis: { jobs: 2 }, queues: { resumePipeline: 1 }, health: { api: 'ok' } })
        };
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, 'http://127.0.0.1:3000/api/dashboard/summary');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);
});

test('agent callback cli fails fast on missing required args', async () => {
  const result = await executeCli(['run-complete'], {
    requestImpl: async () => {
      throw new Error('should_not_request');
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Missing required argument: --run-id/);
});
