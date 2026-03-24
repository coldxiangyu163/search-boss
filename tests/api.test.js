const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');

test('GET /api/dashboard/summary returns dashboard payload', async () => {
  const app = createApp({
    services: {
      dashboard: {
        async getSummary() {
          return {
            kpis: {
              greetedToday: 9
            },
            queues: {
              followup: 5
            },
            health: {
              api: 'ok'
            }
          };
        }
      }
    }
  });

  const response = await request(app).get('/api/dashboard/summary');

  assert.equal(response.status, 200);
  assert.equal(response.body.kpis.greetedToday, 9);
  assert.equal(response.body.queues.followup, 5);
  assert.equal(response.body.health.api, 'ok');
});

test('GET /api/jobs returns job list payload', async () => {
  const app = createApp({
    services: {
      dashboard: {
        async getSummary() {
          return { kpis: {}, queues: {}, health: {} };
        }
      },
      jobs: {
        async listJobs() {
          return [{ job_key: '健康顾问_B0047007', candidate_count: 25 }];
        }
      },
      candidates: {
        async listCandidates() {
          return [];
        }
      }
    }
  });

  const response = await request(app).get('/api/jobs');

  assert.equal(response.status, 200);
  assert.equal(response.body.items[0].job_key, '健康顾问_B0047007');
});

test('POST /api/jobs/sync returns sync result payload', async () => {
  let syncTriggered = false;

  const app = createApp({
    services: {
      dashboard: {
        async getSummary() {
          return { kpis: {}, queues: {}, health: {} };
        }
      },
      jobs: {
        async listJobs() {
          return [];
        },
        async syncJobsFromSource() {
          syncTriggered = true;
          return {
            syncedCount: 3,
            syncedAt: '2026-03-24T12:00:00.000Z'
          };
        }
      },
      candidates: {
        async listCandidates() {
          return [];
        }
      }
    }
  });

  const response = await request(app).post('/api/jobs/sync');

  assert.equal(response.status, 200);
  assert.equal(syncTriggered, true);
  assert.equal(response.body.syncedCount, 3);
});

test('POST /api/agent/runs/:runId/actions records action through agent API', async () => {
  let capturedPayload = null;

  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      agent: {
        async recordAction(payload) {
          capturedPayload = payload;
          return { ok: true, actionId: 9 };
        }
      }
    },
    config: {
      agentToken: 'search-boss-local-agent'
    }
  });

  const response = await request(app)
    .post('/api/agent/runs/12/actions?token=search-boss-local-agent')
    .send({
      attemptId: 'attempt-1',
      eventId: 'resume-request:1:bucket',
      sequence: 3,
      occurredAt: '2026-03-24T12:00:00.000Z',
      actionType: 'resume_request_sent',
      dedupeKey: 'resume-request:1:bucket',
      bossEncryptGeekId: 'geek-1',
      payload: { templateType: 'resume_request' }
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(capturedPayload.runId, '12');
  assert.equal(capturedPayload.actionType, 'resume_request_sent');
});

test('GET /api/agent/candidates/:candidateId/followup-decision returns cooldown decision', async () => {
  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      agent: {
        async getFollowupDecision(candidateId) {
          return {
            candidateId,
            allowed: false,
            reason: 'cooldown_active',
            cooldownRemainingMinutes: 30,
            recommendedAction: 'wait'
          };
        }
      }
    },
    config: {
      agentToken: 'search-boss-local-agent'
    }
  });

  const response = await request(app)
    .get('/api/agent/candidates/88/followup-decision?token=search-boss-local-agent');

  assert.equal(response.status, 200);
  assert.equal(response.body.allowed, false);
  assert.equal(response.body.reason, 'cooldown_active');
});

test('POST /api/agent/runs/:runId/messages records message through agent API', async () => {
  let capturedPayload = null;

  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      agent: {
        async recordAction() { return { ok: true }; },
        async getFollowupDecision() { return { allowed: true }; },
        async recordMessage(payload) {
          capturedPayload = payload;
          return { ok: true, messageId: 7 };
        }
      }
    },
    config: {
      agentToken: 'search-boss-local-agent'
    }
  });

  const response = await request(app)
    .post('/api/agent/runs/12/messages?token=search-boss-local-agent')
    .send({
      attemptId: 'attempt-1',
      eventId: 'message:m1',
      sequence: 4,
      occurredAt: '2026-03-24T12:05:00.000Z',
      bossEncryptGeekId: 'geek-1',
      bossMessageId: 'm1',
      direction: 'inbound',
      messageType: 'text',
      contentText: '你好，我对职位感兴趣'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(capturedPayload.runId, '12');
  assert.equal(capturedPayload.bossMessageId, 'm1');
});

test('POST /api/agent/runs/:runId/attachments records attachment through agent API', async () => {
  let capturedPayload = null;

  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      agent: {
        async recordAction() { return { ok: true }; },
        async getFollowupDecision() { return { allowed: true }; },
        async recordMessage() { return { ok: true }; },
        async recordAttachment(payload) {
          capturedPayload = payload;
          return { ok: true, attachmentId: 5, alreadyProcessed: false };
        }
      }
    },
    config: {
      agentToken: 'search-boss-local-agent'
    }
  });

  const response = await request(app)
    .post('/api/agent/runs/12/attachments?token=search-boss-local-agent')
    .send({
      attemptId: 'attempt-1',
      eventId: 'attachment:a1',
      sequence: 5,
      occurredAt: '2026-03-24T12:10:00.000Z',
      bossEncryptGeekId: 'geek-1',
      bossAttachmentId: 'a1',
      fileName: 'resume.pdf',
      status: 'discovered'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(capturedPayload.bossAttachmentId, 'a1');
});

test('GET /api/schedules returns scheduled jobs payload', async () => {
  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      agent: {
        async recordAction() { return { ok: true }; },
        async getFollowupDecision() { return { allowed: true }; },
        async recordMessage() { return { ok: true }; },
        async recordAttachment() { return { ok: true }; }
      },
      scheduler: {
        async listSchedules() {
          return [{ job_key: '健康顾问_B0047007', task_type: 'followup', cron_expression: '*/15 * * * *' }];
        }
      }
    },
    config: {
      agentToken: 'search-boss-local-agent'
    }
  });

  const response = await request(app).get('/api/schedules');

  assert.equal(response.status, 200);
  assert.equal(response.body.items[0].task_type, 'followup');
});

test('POST /api/schedules upserts schedule payload', async () => {
  let capturedPayload = null;

  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      agent: {
        async recordAction() { return { ok: true }; },
        async getFollowupDecision() { return { allowed: true }; },
        async recordMessage() { return { ok: true }; },
        async recordAttachment() { return { ok: true }; }
      },
      scheduler: {
        async listSchedules() { return []; },
        async upsertSchedule(payload) {
          capturedPayload = payload;
          return { id: 1, ...payload };
        }
      }
    },
    config: {
      agentToken: 'search-boss-local-agent'
    }
  });

  const response = await request(app)
    .post('/api/schedules')
    .send({
      jobKey: '健康顾问_B0047007',
      taskType: 'followup',
      cronExpression: '*/15 * * * *',
      enabled: true,
      payload: { mode: 'followup' }
    });

  assert.equal(response.status, 200);
  assert.equal(capturedPayload.taskType, 'followup');
  assert.equal(response.body.item.jobKey, '健康顾问_B0047007');
});

test('POST /api/agent/runs creates a sourcing run', async () => {
  let capturedPayload = null;

  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      scheduler: { async listSchedules() { return []; }, async upsertSchedule() { return {}; } },
      agent: {
        async recordAction() { return { ok: true }; },
        async getFollowupDecision() { return { allowed: true }; },
        async recordMessage() { return { ok: true }; },
        async recordAttachment() { return { ok: true }; },
        async createRun(payload) {
          capturedPayload = payload;
          return { id: 21, runKey: payload.runKey, status: 'pending' };
        }
      }
    },
    config: { agentToken: 'search-boss-local-agent' }
  });

  const response = await request(app)
    .post('/api/agent/runs?token=search-boss-local-agent')
    .send({
      runKey: 'followup:健康顾问_B0047007:1',
      jobKey: '健康顾问_B0047007',
      mode: 'followup'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.id, 21);
  assert.equal(capturedPayload.mode, 'followup');
});

test('POST /api/agent/runs/:runId/events records run event', async () => {
  let capturedPayload = null;

  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      scheduler: { async listSchedules() { return []; }, async upsertSchedule() { return {}; } },
      agent: {
        async recordAction() { return { ok: true }; },
        async getFollowupDecision() { return { allowed: true }; },
        async recordMessage() { return { ok: true }; },
        async recordAttachment() { return { ok: true }; },
        async createRun() { return { id: 1 }; },
        async recordRunEvent(payload) {
          capturedPayload = payload;
          return { ok: true };
        }
      }
    },
    config: { agentToken: 'search-boss-local-agent' }
  });

  const response = await request(app)
    .post('/api/agent/runs/1/events?token=search-boss-local-agent')
    .send({
      attemptId: 'attempt-1',
      eventId: 'bootstrap:1:attempt-1',
      sequence: 1,
      occurredAt: '2026-03-24T12:20:00.000Z',
      eventType: 'agent_bootstrap',
      stage: 'bootstrap',
      message: 'start'
    });

  assert.equal(response.status, 200);
  assert.equal(capturedPayload.runId, '1');
  assert.equal(capturedPayload.eventType, 'agent_bootstrap');
});

test('POST /api/agent/runs/:runId/complete marks run completed', async () => {
  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      scheduler: { async listSchedules() { return []; }, async upsertSchedule() { return {}; } },
      agent: {
        async recordAction() { return { ok: true }; },
        async getFollowupDecision() { return { allowed: true }; },
        async recordMessage() { return { ok: true }; },
        async recordAttachment() { return { ok: true }; },
        async createRun() { return { id: 1 }; },
        async recordRunEvent() { return { ok: true }; },
        async completeRun() { return { ok: true, status: 'completed' }; }
      }
    },
    config: { agentToken: 'search-boss-local-agent' }
  });

  const response = await request(app)
    .post('/api/agent/runs/1/complete?token=search-boss-local-agent')
    .send({
      attemptId: 'attempt-1',
      eventId: 'run-complete:1:attempt-1',
      sequence: 9,
      occurredAt: '2026-03-24T12:30:00.000Z'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'completed');
});

test('POST /api/schedules/:id/trigger executes schedule', async () => {
  let capturedScheduleId = null;

  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      scheduler: {
        async listSchedules() { return []; },
        async upsertSchedule() { return {}; },
        async triggerSchedule(id) {
          capturedScheduleId = id;
          return { ok: true, scheduledRunId: 5 };
        }
      },
      agent: {
        async recordAction() { return { ok: true }; },
        async getFollowupDecision() { return { allowed: true }; },
        async recordMessage() { return { ok: true }; },
        async recordAttachment() { return { ok: true }; },
        async createRun() { return { id: 1 }; },
        async recordRunEvent() { return { ok: true }; },
        async completeRun() { return { ok: true, status: 'completed' }; }
      }
    },
    config: { agentToken: 'search-boss-local-agent' }
  });

  const response = await request(app).post('/api/schedules/1/trigger');

  assert.equal(response.status, 200);
  assert.equal(capturedScheduleId, '1');
  assert.equal(response.body.scheduledRunId, 5);
});
