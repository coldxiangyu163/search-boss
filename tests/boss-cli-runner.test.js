const test = require('node:test');
const assert = require('node:assert/strict');

const { BossCliRunner } = require('../src/services/boss-cli-runner');

test('BossCliRunner bindTarget returns parsed JSON payload from executeCli', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv, options) => {
      calls.push({ argv, options });
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          session: {
            runId: '42',
            targetId: 'boss-1'
          }
        })
      };
    },
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    }
  });

  const payload = await runner.bindTarget({ runId: 42 });

  assert.equal(calls[0].argv[0], 'target');
  assert.equal(calls[0].argv[1], 'bind');
  assert.equal(calls[0].argv[3], '42');
  assert.equal(payload.session.targetId, 'boss-1');
});

test('BossCliRunner bindTarget forwards run-scoped metadata to the CLI', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          session: {
            runId: '42',
            targetId: 'boss-1',
            jobKey: '面点师傅（B0038011）_8eca6cad',
            jobId: 'enc-job-1',
            mode: 'download'
          }
        })
      };
    }
  });

  await runner.bindTarget({
    runId: 42,
    mode: 'download',
    jobKey: '面点师傅（B0038011）_8eca6cad',
    jobId: 'enc-job-1'
  });

  assert.deepEqual(calls[0], [
    'target',
    'bind',
    '--run-id',
    '42',
    '--prefer-chat',
    '--mode',
    'download',
    '--job-key',
    '面点师傅（B0038011）_8eca6cad',
    '--job-id',
    'enc-job-1'
  ]);
});

test('BossCliRunner listRecommendations forwards limit and parses result', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          candidates: [{ name: '张三' }]
        })
      };
    },
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    }
  });

  const payload = await runner.listRecommendations({ runId: 42, limit: 3 });

  assert.deepEqual(calls[0], ['recommend', '--run-id', '42', '--limit', '3']);
  assert.equal(payload.candidates[0].name, '张三');
});

test('BossCliRunner listJobs parses structured job list result', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          jobs: [{ jobName: '健康顾问（B0047007）', encryptJobId: 'enc-job-1' }]
        })
      };
    },
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    }
  });

  const payload = await runner.listJobs({ runId: 42 });

  assert.deepEqual(calls[0], ['joblist', '--run-id', '42']);
  assert.equal(payload.jobs[0].encryptJobId, 'enc-job-1');
});

test('BossCliRunner throws when executeCli exits non-zero', async () => {
  const runner = new BossCliRunner({
    executeCliImpl: async () => ({
      exitCode: 1,
      stderr: 'boss_target_not_found'
    }),
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    }
  });

  await assert.rejects(
    () => runner.bindTarget({ runId: 42 }),
    /boss_target_not_found/
  );
});

test('BossCliRunner getJobDetail forwards job id and parses result', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          job: { name: '健康顾问' }
        })
      };
    },
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    }
  });

  const payload = await runner.getJobDetail({ runId: 42, jobId: 'enc-job-1' });

  assert.deepEqual(calls[0], ['job-detail', '--run-id', '42', '--job-id', 'enc-job-1']);
  assert.equal(payload.job.name, '健康顾问');
});

test('BossCliRunner getResumePanel forwards uid and parses result', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          resume: { name: '谢东林' }
        })
      };
    },
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    }
  });

  const payload = await runner.getResumePanel({ runId: 42, uid: 'enc-uid-1' });

  assert.deepEqual(calls[0], ['resume-panel', '--run-id', '42', '--uid', 'enc-uid-1']);
  assert.equal(payload.resume.name, '谢东林');
});

test('BossCliRunner getContextSnapshot forwards optional job id and parses result', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          page: { shell: 'recommend' },
          job: { encryptJobId: 'enc-job-1', matchesRunJob: true }
        })
      };
    },
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    }
  });

  const payload = await runner.getContextSnapshot({ runId: 42, jobId: 'enc-job-1' });

  assert.deepEqual(calls[0], ['context-snapshot', '--run-id', '42', '--job-id', 'enc-job-1']);
  assert.equal(payload.page.shell, 'recommend');
  assert.equal(payload.job.matchesRunJob, true);
});

test('BossCliRunner recommendNextCandidate forwards command and parses result', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, direction: 'next' })
      };
    }
  });

  const payload = await runner.recommendNextCandidate({ runId: 42 });

  assert.deepEqual(calls[0], ['recommend-next-candidate', '--run-id', '42']);
  assert.equal(payload.direction, 'next');
});

test('BossCliRunner openChatThread forwards uid and parses result', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, opened: true })
      };
    }
  });

  const payload = await runner.openChatThread({ runId: 42, uid: 'enc-uid-1' });

  assert.deepEqual(calls[0], ['chat-open-thread', '--run-id', '42', '--uid', 'enc-uid-1']);
  assert.equal(payload.opened, true);
});

test('BossCliRunner inspectChatThreadState forwards run id and parses result', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, threadOpen: true })
      };
    }
  });

  const payload = await runner.inspectChatThreadState({ runId: 42 });

  assert.deepEqual(calls[0], ['chat-thread-state', '--run-id', '42']);
  assert.equal(payload.threadOpen, true);
});

test('BossCliRunner inspectAttachmentState forwards run id and parses result', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, present: true })
      };
    }
  });

  const payload = await runner.inspectAttachmentState({ runId: 42 });

  assert.deepEqual(calls[0], ['attachment-state', '--run-id', '42']);
  assert.equal(payload.present, true);
});

test('BossCliRunner getResumePreviewMeta forwards run id and parses result', async () => {
  const calls = [];
  const runner = new BossCliRunner({
    executeCliImpl: async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          canPreview: true,
          encryptAuthorityId: 'authority-1'
        })
      };
    }
  });

  const payload = await runner.getResumePreviewMeta({ runId: 42 });

  assert.deepEqual(calls[0], ['resume-preview-meta', '--run-id', '42']);
  assert.equal(payload.encryptAuthorityId, 'authority-1');
});
