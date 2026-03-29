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

test('agent callback cli list-candidates forwards paging and keyword query params', async () => {
  const calls = [];

  const result = await executeCli(
    [
      'list-candidates',
      '--job-key', '面点师傅（B0038011）_8eca6cad',
      '--page', '2',
      '--page-size', '50',
      '--keyword', '邱发明'
    ],
    {
      requestImpl: async (request) => {
        calls.push(request);
        return {
          status: 200,
          json: async () => ({ items: [], pageInfo: { page: 2, pageSize: 50, total: 0 } })
        };
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(
    calls[0].url,
    'http://127.0.0.1:3000/api/candidates?jobKey=%E9%9D%A2%E7%82%B9%E5%B8%88%E5%82%85%EF%BC%88B0038011%EF%BC%89_8eca6cad&page=2&pageSize=50&keyword=%E9%82%B1%E5%8F%91%E6%98%8E&token=search-boss-local-agent'
  );
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

test('agent callback cli reads api base and token from env when flags are omitted', async () => {
  const calls = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-callback-cli-'));
  const payloadFile = path.join(tempDir, 'complete.json');

  await fs.writeFile(payloadFile, JSON.stringify({
    eventId: 'run-complete:41:attempt-1',
    summary: 'done'
  }));

  const result = await executeCli(['run-complete', '--run-id', '41', '--file', payloadFile], {
    env: {
      SEARCH_BOSS_API_BASE: 'http://windows-host:3000',
      SEARCH_BOSS_AGENT_TOKEN: 'windows-agent-token'
    },
    requestImpl: async (request) => {
      calls.push(request);
      return {
        status: 200,
        json: async () => ({ ok: true, status: 'completed' })
      };
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(
    calls[0].url,
    'http://windows-host:3000/api/agent/runs/41/complete?token=windows-agent-token'
  );
});

test('agent callback cli reads api base and token from .env file when process env is empty', async () => {
  const calls = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-callback-cli-'));
  const payloadFile = path.join(tempDir, 'complete.json');
  const envFilePath = path.join(tempDir, '.env');

  await fs.writeFile(payloadFile, JSON.stringify({
    eventId: 'run-complete:88:attempt-1',
    summary: 'done'
  }));
  await fs.writeFile(
    envFilePath,
    [
      'SEARCH_BOSS_API_BASE=http://macos-local:3011',
      'SEARCH_BOSS_AGENT_TOKEN=macos-local-agent'
    ].join('\n')
  );

  const result = await executeCli(['run-complete', '--run-id', '88', '--file', payloadFile], {
    env: {},
    envFilePath,
    requestImpl: async (request) => {
      calls.push(request);
      return {
        status: 200,
        json: async () => ({ ok: true, status: 'completed' })
      };
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(
    calls[0].url,
    'http://macos-local:3011/api/agent/runs/88/complete?token=macos-local-agent'
  );
});

test('agent callback cli run-message normalizes legacy message payload fields before posting', async () => {
  const calls = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-callback-cli-'));
  const payloadFile = path.join(tempDir, 'message.json');

  await fs.writeFile(payloadFile, JSON.stringify({
    jobKey: '面点师傅（B0038011）_8eca6cad',
    bossEncryptGeekId: 'geek-1',
    candidateId: '214',
    direction: 'inbound',
    messageType: 'text',
    content: '我对岗位感兴趣',
    sentAt: '2026-03-29T11:09:00+08:00'
  }));

  const result = await executeCli(['run-message', '--run-id', '234', '--file', payloadFile], {
    requestImpl: async (request) => {
      calls.push(request);
      return {
        status: 200,
        json: async () => ({ ok: true, messageId: '23', duplicated: false })
      };
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.runId, '234');
  assert.equal(calls[0].body.contentText, '我对岗位感兴趣');
  assert.equal(calls[0].body.occurredAt, '2026-03-29T11:09:00+08:00');
  assert.match(String(calls[0].body.bossMessageId), /^auto:234:inbound:2026-03-29T11:09:00\+08:00/);
  assert.equal(calls[0].body.content, undefined);
  assert.equal(calls[0].body.sentAt, undefined);
});

test('agent callback cli surfaces Local API error payload details', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-callback-cli-'));
  const payloadFile = path.join(tempDir, 'candidate.json');

  await fs.writeFile(payloadFile, JSON.stringify({
    jobKey: '面点师傅_B0038011',
    name: '某某'
  }));

  const result = await executeCli(['run-candidate', '--run-id', '163', '--file', payloadFile], {
    requestImpl: async () => ({
      ok: false,
      status: 400,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({
        error: 'boss_encrypt_geek_id_missing',
        message: '候选人写入缺少 bossEncryptGeekId。'
      }),
      text: async () => JSON.stringify({
        error: 'boss_encrypt_geek_id_missing',
        message: '候选人写入缺少 bossEncryptGeekId。'
      })
    })
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /400/);
  assert.match(result.stderr, /bossEncryptGeekId/);
});
