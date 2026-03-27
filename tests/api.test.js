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

test('GET /api/candidates returns paginated candidate payload with filters', async () => {
  let capturedFilters = null;

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
        }
      },
      candidates: {
        async listCandidates(filters) {
          capturedFilters = filters;
          return {
            items: [
              {
                id: 101,
                name: '张三',
                job_name: 'Java后端工程师',
                lifecycle_status: 'responded'
              }
            ],
            pagination: {
              page: 2,
              pageSize: 20,
              total: 41,
              totalPages: 3
            }
          };
        }
      }
    }
  });

  const response = await request(app)
    .get('/api/candidates?page=2&pageSize=20&jobKey=java_backend&status=responded&resumeState=received&keyword=%E5%BC%A0');

  assert.equal(response.status, 200);
  assert.equal(capturedFilters.page, 2);
  assert.equal(capturedFilters.pageSize, 20);
  assert.equal(capturedFilters.jobKey, 'java_backend');
  assert.equal(capturedFilters.status, 'responded');
  assert.equal(capturedFilters.resumeState, 'received');
  assert.equal(capturedFilters.keyword, '张');
  assert.equal(response.body.items[0].id, 101);
  assert.equal(response.body.pagination.totalPages, 3);
});

test('GET /api/candidates/:candidateId returns candidate detail payload', async () => {
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
        }
      },
      candidates: {
        async listCandidates() {
          return { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } };
        },
        async getCandidateDetail(candidateId) {
          return {
            id: Number(candidateId),
            name: '李四',
            job_name: '测试工程师',
            notes: '已约电话沟通',
            messages: [
              {
                id: 1,
                direction: 'inbound',
                content_text: '方便的话发我 JD 看看',
                sent_at: '2026-03-25T10:00:00.000Z'
              }
            ],
            attachments: [
              {
                id: 9,
                file_name: 'resume.pdf',
                status: 'downloaded'
              }
            ]
          };
        }
      },
      agent: {
        async getFollowupDecision() {
          return {
            allowed: false,
            reason: 'cooldown_active',
            cooldownRemainingMinutes: 18,
            recommendedAction: 'wait'
          };
        }
      }
    }
  });

  const response = await request(app).get('/api/candidates/55');

  assert.equal(response.status, 200);
  assert.equal(response.body.item.id, 55);
  assert.equal(response.body.item.messages[0].direction, 'inbound');
  assert.equal(response.body.item.attachments[0].status, 'downloaded');
  assert.equal(response.body.item.followupDecision.reason, 'cooldown_active');
});

test('GET /api/candidates/:candidateId returns 404 when candidate detail is missing', async () => {
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
        }
      },
      candidates: {
        async listCandidates() {
          return { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } };
        },
        async getCandidateDetail() {
          return null;
        }
      }
    }
  });

  const response = await request(app).get('/api/candidates/404');

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'candidate_not_found');
});

test('GET /api/jobs/:jobKey returns job detail payload', async () => {
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
        async getJobDetail(jobKey) {
          return {
            job_key: jobKey,
            job_name: '健康顾问（B0047007）',
            city: '重庆',
            salary: '5-6K',
            status: 'open',
            jd_text: '负责客户跟进和健康产品咨询',
            custom_requirement: '优先有电销经验',
            sync_metadata: {
              bossBrandName: '百融云创',
              experienceRequirement: '经验不限'
            }
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

  const response = await request(app).get('/api/jobs/%E5%81%A5%E5%BA%B7%E9%A1%BE%E9%97%AE_B0047007');

  assert.equal(response.status, 200);
  assert.equal(response.body.item.job_key, '健康顾问_B0047007');
  assert.equal(response.body.item.jd_text, '负责客户跟进和健康产品咨询');
  assert.equal(response.body.item.custom_requirement, '优先有电销经验');
  assert.equal(response.body.item.sync_metadata.bossBrandName, '百融云创');
});

test('PATCH /api/jobs/:jobKey/custom-requirement updates custom requirement payload', async () => {
  let capturedPayload = null;

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
        async updateJobCustomRequirement(jobKey, customRequirement) {
          capturedPayload = { jobKey, customRequirement };
          return {
            job_key: jobKey,
            custom_requirement: customRequirement
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

  const response = await request(app)
    .patch('/api/jobs/%E5%81%A5%E5%BA%B7%E9%A1%BE%E9%97%AE_B0047007/custom-requirement')
    .send({ customRequirement: '必须有电话销售经验' });

  assert.equal(response.status, 200);
  assert.deepEqual(capturedPayload, {
    jobKey: '健康顾问_B0047007',
    customRequirement: '必须有电话销售经验'
  });
  assert.equal(response.body.item.custom_requirement, '必须有电话销售经验');
});

test('PATCH /api/jobs/:jobKey/custom-requirement returns 404 when job is missing', async () => {
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
        async updateJobCustomRequirement() {
          return null;
        }
      },
      candidates: {
        async listCandidates() {
          return [];
        }
      }
    }
  });

  const response = await request(app)
    .patch('/api/jobs/%E4%B8%8D%E5%AD%98%E5%9C%A8/custom-requirement')
    .send({ customRequirement: 'test' });

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'job_not_found');
});

test('GET /api/jobs/:jobKey returns 404 when job detail is missing', async () => {
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
        async getJobDetail() {
          return null;
        }
      },
      candidates: {
        async listCandidates() {
          return [];
        }
      }
    }
  });

  const response = await request(app).get('/api/jobs/%E4%B8%8D%E5%AD%98%E5%9C%A8');

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'job_not_found');
});

test('POST /api/jobs/sync triggers job sync run payload', async () => {
  let syncPayload = null;

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
        async triggerSync() {
          syncPayload = true;
          return {
            ok: true,
            runId: 12,
            runKey: 'sync_jobs:all:2026-03-24T12:00:00.000Z',
            status: 'running',
            message: '职位同步任务已触发'
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
  assert.equal(syncPayload, true);
  assert.equal(response.body.runId, 12);
  assert.equal(response.body.status, 'running');
});

test('POST /api/jobs/sync returns 503 when nanobot daily limit is reached', async () => {
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
        async triggerSync() {
          throw new Error('nanobot_daily_limit_reached');
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

  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'nanobot_daily_limit_reached');
});

test('GET /api/runs/:runId/events returns run events payload', async () => {
  let capturedRunId = null;
  let capturedAfterId = null;

  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      scheduler: { async listSchedules() { return []; }, async upsertSchedule() { return {}; } },
      agent: {
        async listRunEvents(runId, { afterId }) {
          capturedRunId = runId;
          capturedAfterId = afterId;
          return {
            items: [
              { id: 11, event_type: 'job_sync_requested', message: 'job sync requested' }
            ]
          };
        }
      }
    }
  });

  const response = await request(app).get('/api/runs/33/events?afterId=10');

  assert.equal(response.status, 200);
  assert.equal(capturedRunId, '33');
  assert.equal(capturedAfterId, 10);
  assert.equal(response.body.items[0].id, 11);
});

test('POST /api/agent/jobs/batch upserts jobs through agent API', async () => {
  let capturedPayload = null;

  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: {
        async listJobs() { return []; },
        async upsertJobsBatch(payload) {
          capturedPayload = payload;
          return { ok: true, syncedCount: payload.jobs.length };
        }
      },
      candidates: { async listCandidates() { return []; } }
    },
    config: {
      agentToken: 'search-boss-local-agent'
    }
  });

  const response = await request(app)
    .post('/api/agent/jobs/batch?token=search-boss-local-agent')
    .send({
      runId: 12,
      eventId: 'job-sync:1',
      sequence: 1,
      occurredAt: '2026-03-24T12:00:00.000Z',
      jobs: [
        {
          jobKey: '健康顾问_B0047007',
          encryptJobId: 'enc-1',
          jobName: '健康顾问（B0047007）',
          salary: '5-6K',
          city: '重庆',
          status: 'open'
        }
      ]
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.syncedCount, 1);
  assert.equal(capturedPayload.runId, 12);
  assert.equal(capturedPayload.jobs[0].jobKey, '健康顾问_B0047007');
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

test('POST /api/agent/runs/:runId/candidates upserts candidate through agent API', async () => {
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
        async recordRunEvent() { return { ok: true }; },
        async upsertCandidate(payload) {
          capturedPayload = payload;
          return { ok: true, candidateId: 99, personId: 41 };
        }
      }
    },
    config: { agentToken: 'search-boss-local-agent' }
  });

  const response = await request(app)
    .post('/api/agent/runs/1/candidates?token=search-boss-local-agent')
    .send({
      eventId: 'candidate-observed:1:geek-1',
      sequence: 3,
      occurredAt: '2026-03-25T12:00:00.000Z',
      jobKey: '健康顾问_B0047007',
      bossEncryptGeekId: 'geek-1',
      name: '张三',
      city: '重庆',
      education: '本科',
      experience: '3-5年',
      school: '重庆大学',
      status: 'greeted',
      metadata: {
        expectId: 'exp-1'
      }
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.candidateId, 99);
  assert.equal(capturedPayload.runId, '1');
  assert.equal(capturedPayload.jobKey, '健康顾问_B0047007');
  assert.equal(capturedPayload.bossEncryptGeekId, 'geek-1');
  assert.equal(capturedPayload.status, 'greeted');
});

test('POST /api/agent/runs/:runId/import-events imports event batch through agent API', async () => {
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
        async recordRunEvent() { return { ok: true }; },
        async importRunEvents(payload) {
          capturedPayload = payload;
          return {
            ok: true,
            receivedCount: 2,
            importedCount: 2,
            projectedCount: 1,
            duplicateCount: 0,
            acknowledgedCount: 2,
            allEventsAccountedFor: true
          };
        }
      }
    },
    config: { agentToken: 'search-boss-local-agent' }
  });

  const response = await request(app)
    .post('/api/agent/runs/38/import-events?token=search-boss-local-agent')
    .send({
      attemptId: 'attempt-2',
      sourceFile: 'runs/2026-03-25/source/38/events.jsonl',
      events: [
        {
          eventId: 'candidate-observed:38:geek-1',
          eventType: 'candidate_observed',
          sequence: 10,
          occurredAt: '2026-03-25T07:05:00.000Z'
        },
        {
          eventId: 'greet:38:geek-1',
          eventType: 'greet_sent',
          sequence: 11,
          occurredAt: '2026-03-25T07:06:00.000Z'
        }
      ]
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.importedCount, 2);
  assert.equal(response.body.receivedCount, 2);
  assert.equal(response.body.allEventsAccountedFor, true);
  assert.equal(capturedPayload.runId, '38');
  assert.equal(capturedPayload.sourceFile, 'runs/2026-03-25/source/38/events.jsonl');
  assert.equal(capturedPayload.events.length, 2);
});

test('POST /api/agent/runs/:runId/import-events accepts job sync payload objects without wrapping events', async () => {
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
        async recordRunEvent() { return { ok: true }; },
        async importRunEvents(payload) {
          capturedPayload = payload;
          return {
            ok: true,
            receivedCount: 1,
            importedCount: 1,
            projectedCount: 0,
            duplicateCount: 0,
            acknowledgedCount: 1,
            allEventsAccountedFor: true
          };
        }
      }
    },
    config: { agentToken: 'search-boss-local-agent' }
  });

  const response = await request(app)
    .post('/api/agent/runs/131/import-events?token=search-boss-local-agent')
    .send({
      runId: '131',
      eventId: 'job-sync:131:1774568043895',
      sequence: 1,
      occurredAt: '2026-03-26T23:34:03.895Z',
      jobs: [
        {
          jobKey: '面点师傅_B0038011',
          encryptJobId: 'enc-1',
          jobName: '面点师傅（B0038011）'
        }
      ]
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.importedCount, 1);
  assert.equal(capturedPayload.runId, '131');
  assert.equal(capturedPayload.events.length, 1);
  assert.equal(capturedPayload.events[0].eventType, 'jobs_batch_synced');
  assert.equal(capturedPayload.events[0].eventId, 'job-sync:131:1774568043895');
  assert.equal(capturedPayload.events[0].payload.jobs[0].jobKey, '面点师傅_B0038011');
});

test('POST /api/agent/runs/:runId/import-events accepts raw event arrays', async () => {
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
        async recordRunEvent() { return { ok: true }; },
        async importRunEvents(payload) {
          capturedPayload = payload;
          return {
            ok: true,
            receivedCount: 1,
            importedCount: 1,
            projectedCount: 1,
            duplicateCount: 0,
            acknowledgedCount: 1,
            allEventsAccountedFor: true
          };
        }
      }
    },
    config: { agentToken: 'search-boss-local-agent' }
  });

  const response = await request(app)
    .post('/api/agent/runs/41/import-events?token=search-boss-local-agent')
    .send([
      {
        eventId: 'greet:41:geek-1',
        eventType: 'greet_sent',
        sequence: 9,
        occurredAt: '2026-03-25T08:44:00.000Z'
      }
    ]);

  assert.equal(response.status, 200);
  assert.equal(response.body.importedCount, 1);
  assert.equal(response.body.receivedCount, 1);
  assert.equal(response.body.allEventsAccountedFor, true);
  assert.equal(capturedPayload.runId, '41');
  assert.equal(Array.isArray(capturedPayload.events), true);
  assert.equal(capturedPayload.events.length, 1);
  assert.equal(capturedPayload.events[0].eventId, 'greet:41:geek-1');
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

test('POST /api/agent/runs/:runId/fail marks run failed', async () => {
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
        async recordRunEvent() { return { ok: true }; },
        async completeRun() { return { ok: true, status: 'completed' }; },
        async failRun(payload) {
          capturedPayload = payload;
          return { ok: true, status: 'failed' };
        }
      }
    },
    config: { agentToken: 'search-boss-local-agent' }
  });

  const response = await request(app)
    .post('/api/agent/runs/1/fail?token=search-boss-local-agent')
    .send({
      attemptId: 'attempt-1',
      eventId: 'run-fail:1:attempt-1',
      sequence: 9,
      occurredAt: '2026-03-24T12:30:00.000Z',
      message: 'resume callback not persisted'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'failed');
  assert.equal(capturedPayload.runId, '1');
  assert.equal(capturedPayload.message, 'resume callback not persisted');
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

test('POST /api/jobs/:jobKey/tasks/:taskType/trigger executes schedule by job and task type', async () => {
  let capturedJobKey = null;
  let capturedTaskType = null;

  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      scheduler: {
        async listSchedules() { return []; },
        async upsertSchedule() { return {}; },
        async triggerJobTask(jobKey, taskType) {
          capturedJobKey = jobKey;
          capturedTaskType = taskType;
          return { ok: true, scheduledRunId: 8, runId: 21 };
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

  const response = await request(app).post('/api/jobs/%E5%81%A5%E5%BA%B7%E9%A1%BE%E9%97%AE_B0047007/tasks/followup/trigger');

  assert.equal(response.status, 200);
  assert.equal(capturedJobKey, '健康顾问_B0047007');
  assert.equal(capturedTaskType, 'followup');
  assert.equal(response.body.runId, 21);
});

test('JobService triggerSync creates sync run and calls nanobot', async () => {
  const queryCalls = [];
  const nanobotCalls = [];
  const pool = {
    async query(sql, params = []) {
      queryCalls.push({ sql, params });

      if (sql.includes('select job_key') && sql.includes('limit 1')) {
        return { rows: [{ job_key: '健康顾问_B0047007' }] };
      }

      if (sql.includes('from jobs') && sql.includes('job_key = $1')) {
        return { rows: [{ id: 8 }] };
      }

      if (sql.includes('insert into sourcing_runs')) {
        return { rows: [{ id: 33, runKey: params[0], status: 'pending' }] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('insert into sourcing_run_events')) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const { AgentService } = require('../src/services/agent-service');
  const { JobService } = require('../src/services/job-service');

  const agentService = new AgentService({
    pool,
    nanobotRunner: {
      async run(payload) {
        nanobotCalls.push(payload);
        return { ok: true, stdout: 'synced' };
      }
    }
  });

  const service = new JobService({ pool, agentService });

  const result = await service.triggerSync();

  assert.equal(result.ok, true);
  assert.equal(result.runId, 33);
  assert.equal(result.status, 'running');
  assert.match(result.runKey, /^sync_jobs:__all__:/);
  assert.equal(nanobotCalls.length, 1);
  assert.equal(
    nanobotCalls[0].message,
    '/boss-sourcing --sync --run-id "33"\n只执行岗位同步：采集职位列表和职位详情，并调用 /api/agent/jobs/batch 回写本地后台。禁止进入推荐牛人、打招呼、聊天跟进、下载简历。'
  );
});

test('JobService upsertJobsBatch writes agent synced jobs into jobs table and records sync event', async () => {
  const queryCalls = [];
  const recordedEvents = [];
  const pool = {
    async query(sql, params = []) {
      queryCalls.push({ sql, params });
      return { rows: [{ id: 9 }], rowCount: 1 };
    }
  };

  const { JobService } = require('../src/services/job-service');
  const service = new JobService({
    pool,
    agentService: {
      async recordRunEvent(payload) {
        recordedEvents.push(payload);
        return { ok: true };
      }
    }
  });

  const result = await service.upsertJobsBatch({
    runId: 33,
    occurredAt: '2026-03-24T12:00:00.000Z',
    jobs: [
      {
        jobKey: '健康顾问_B0047007',
        encryptJobId: 'enc-1',
        jobName: '健康顾问（B0047007）',
        salary: '5-6K',
        city: '重庆',
        status: 'open',
        jdText: '负责客户跟进和健康产品咨询',
        metadata: {
          bossBrandName: '百融云创',
          experienceRequirement: '经验不限'
        }
      },
      {
        jobKey: '销售顾问_B0099001',
        encryptJobId: 'enc-2',
        jobName: '销售顾问（B0099001）',
        salary: '8-10K',
        city: '上海',
        status: 'open'
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.syncedCount, 2);
  assert.equal(queryCalls.length, 2);
  assert.match(queryCalls[0].sql, /insert into jobs/i);
  assert.deepEqual(queryCalls[0].params.slice(0, 7), [
    '健康顾问_B0047007',
    'enc-1',
    '健康顾问（B0047007）',
    '重庆',
    '5-6K',
    'open',
    '负责客户跟进和健康产品咨询'
  ]);
  assert.deepEqual(queryCalls[0].params[7], {
    bossBrandName: '百融云创',
    experienceRequirement: '经验不限'
  });
  assert.equal(recordedEvents.length, 1);
  assert.equal(recordedEvents[0].runId, 33);
  assert.equal(recordedEvents[0].eventType, 'jobs_batch_synced');
});

test('JobService upsertJobsBatch uses boss encrypt job id uniqueness when jobKey is missing', async () => {
  const queryCalls = [];
  const pool = {
    async query(sql, params = []) {
      queryCalls.push({ sql, params });
      return { rows: [{ id: 13 }], rowCount: 1 };
    }
  };

  const { JobService } = require('../src/services/job-service');
  const service = new JobService({ pool });

  await service.upsertJobsBatch({
    occurredAt: '2026-03-25T05:02:00.000Z',
    jobs: [
      {
        encryptJobId: '0207b7bb2f6d36180nVy39-9F1FV',
        jobName: '销售专员',
        city: '重庆',
        metadata: {
          bossBrandName: '北京好还科技有限公司',
          address: '重庆两江新区渝兴广场 B1 栋 19 楼 3 号房'
        }
      }
    ]
  });

  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0].sql, /boss_encrypt_job_id/i);
  assert.deepEqual(queryCalls[0].params.slice(0, 4), [
    '销售专员_0207b7bb',
    '0207b7bb2f6d36180nVy39-9F1FV',
    '销售专员',
    '重庆'
  ]);
  assert.equal(queryCalls[0].params[7].bossBrandName, '北京好还科技有限公司');
});

test('JobService upsertJobsBatch rejects write when boss encrypt job id is missing', async () => {
  const pool = {
    async query() {
      throw new Error('should_not_write');
    }
  };

  const { JobService } = require('../src/services/job-service');
  const service = new JobService({ pool });

  await assert.rejects(
    () =>
      service.upsertJobsBatch({
        jobs: [
          {
            jobName: '销售专员',
            city: '重庆',
            metadata: {
              bossBrandName: '北京好还科技有限公司'
            }
          }
        ]
      }),
    /boss_encrypt_job_id_missing/
  );
});

test('JobService getJobDetail returns detail row for one job', async () => {
  const queryCalls = [];
  const pool = {
    async query(sql, params = []) {
      queryCalls.push({ sql, params });
      return {
        rows: [
          {
            id: 1,
            job_key: '健康顾问_B0047007',
            job_name: '健康顾问（B0047007）',
            city: '重庆',
            salary: '5-6K',
            status: 'open',
            jd_text: '负责客户跟进和健康产品咨询',
            sync_metadata: { bossBrandName: '百融云创' },
            last_synced_at: '2026-03-25T12:00:00.000Z',
            candidate_count: 4,
            greeted_count: 2,
            responded_count: 1,
            resume_downloaded_count: 1
          }
        ]
      };
    }
  };

  const { JobService } = require('../src/services/job-service');
  const service = new JobService({ pool, agentService: null });

  const item = await service.getJobDetail('健康顾问_B0047007');

  assert.equal(item.job_key, '健康顾问_B0047007');
  assert.equal(item.jd_text, '负责客户跟进和健康产品咨询');
  assert.equal(item.sync_metadata.bossBrandName, '百融云创');
  assert.equal(queryCalls[0].params[0], '健康顾问_B0047007');
});

test('JobService triggerSync returns immediately and completes run asynchronously', async () => {
  const events = [];
  let releaseNanobot = null;
  let completeRunResolve = null;
  let jobsBatchSynced = false;
  const completeRunDone = new Promise((resolve) => {
    completeRunResolve = resolve;
  });
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('select job_key') && sql.includes('limit 1')) {
        return { rows: [{ job_key: '健康顾问_B0047007' }] };
      }

      if (sql.includes('from jobs') && sql.includes('job_key = $1')) {
        return { rows: [{ id: 8 }] };
      }

      if (sql.includes('insert into sourcing_runs')) {
        return { rows: [{ id: 33, runKey: params[0], status: 'pending' }] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('insert into sourcing_run_events')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from sourcing_run_events") && sql.includes("event_type = 'jobs_batch_synced'")) {
        return { rows: jobsBatchSynced ? [{ id: 1 }] : [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const { AgentService } = require('../src/services/agent-service');
  const { JobService } = require('../src/services/job-service');

  const agentService = new AgentService({
    pool,
    nanobotRunner: {
      async run() {
        await new Promise((resolve) => {
          releaseNanobot = resolve;
        });
        return { ok: true, stdout: 'synced' };
      }
    }
  });

  const originalRecordRunEvent = agentService.recordRunEvent.bind(agentService);
  agentService.recordRunEvent = async (payload) => {
    events.push(payload);
    return originalRecordRunEvent(payload);
  };
  const originalCompleteRun = agentService.completeRun.bind(agentService);
  agentService.completeRun = async (payload) => {
    const result = await originalCompleteRun(payload);
    completeRunResolve(result);
    return result;
  };

  const service = new JobService({ pool, agentService });

  const result = await service.triggerSync();

  assert.equal(result.status, 'running');
  assert.equal(events.some((event) => event.eventType === 'run_completed'), false);
  jobsBatchSynced = true;
  releaseNanobot();
  await completeRunDone;
  assert.equal(events.some((event) => event.eventType === 'run_completed'), true);
});

test('JobService triggerSync marks run failed when nanobot exits without jobs batch sync event', async () => {
  const events = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('select job_key') && sql.includes('limit 1')) {
        return { rows: [{ job_key: '健康顾问_B0047007' }] };
      }

      if (sql.includes('from jobs') && sql.includes('job_key = $1')) {
        return { rows: [{ id: 8 }] };
      }

      if (sql.includes('insert into sourcing_runs')) {
        return { rows: [{ id: 33, runKey: params[0], status: 'pending' }] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('insert into sourcing_run_events')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from sourcing_run_events") && sql.includes("event_type = 'jobs_batch_synced'")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const { AgentService } = require('../src/services/agent-service');
  const { JobService } = require('../src/services/job-service');

  const agentService = new AgentService({
    pool,
    nanobotRunner: {
      async run() {
        return { ok: true, stdout: 'synced' };
      }
    }
  });

  const originalRecordRunEvent = agentService.recordRunEvent.bind(agentService);
  agentService.recordRunEvent = async (payload) => {
    events.push(payload);
    return originalRecordRunEvent(payload);
  };

  const service = new JobService({ pool, agentService });

  const result = await service.triggerSync();

  assert.equal(result.status, 'running');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.some((event) => event.eventType === 'run_failed'), true);
  assert.equal(events.some((event) => event.message === 'job_sync_not_persisted'), true);
});

test('JobService triggerSync treats nanobot stdout jobs_batch_synced marker as persisted sync', async () => {
  const events = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('select job_key') && sql.includes('limit 1')) {
        return { rows: [{ job_key: '健康顾问_B0047007' }] };
      }

      if (sql.includes('from jobs') && sql.includes('job_key = $1')) {
        return { rows: [{ id: 8 }] };
      }

      if (sql.includes('insert into sourcing_runs')) {
        return { rows: [{ id: 33, runKey: params[0], status: 'pending' }] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('insert into sourcing_run_events')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from sourcing_run_events") && sql.includes("event_type = 'jobs_batch_synced'")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const { AgentService } = require('../src/services/agent-service');
  const { JobService } = require('../src/services/job-service');

  const agentService = new AgentService({
    pool,
    nanobotRunner: {
      async run({ onStdoutLine }) {
        onStdoutLine?.('{"eventType":"jobs_batch_synced","syncedCount":4}');
        return { ok: true, stdout: '{"eventType":"jobs_batch_synced","syncedCount":4}' };
      }
    }
  });

  const originalRecordRunEvent = agentService.recordRunEvent.bind(agentService);
  agentService.recordRunEvent = async (payload) => {
    events.push(payload);
    return originalRecordRunEvent(payload);
  };

  const service = new JobService({ pool, agentService });

  const result = await service.triggerSync();

  assert.equal(result.status, 'running');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.some((event) => event.eventType === 'run_completed'), true);
  assert.equal(events.some((event) => event.message === 'job_sync_not_persisted'), false);
});

test('JobService triggerSync marks run failed when nanobot fails asynchronously', async () => {
  const events = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('select job_key') && sql.includes('limit 1')) {
        return { rows: [{ job_key: '健康顾问_B0047007' }] };
      }

      if (sql.includes('from jobs') && sql.includes('job_key = $1')) {
        return { rows: [{ id: 8 }] };
      }

      if (sql.includes('insert into sourcing_runs')) {
        return { rows: [{ id: 33, runKey: params[0], status: 'pending' }] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('insert into sourcing_run_events')) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const { AgentService } = require('../src/services/agent-service');
  const { JobService } = require('../src/services/job-service');

  const agentService = new AgentService({
    pool,
    nanobotRunner: {
      async run() {
        throw new Error('nanobot_provider_error');
      }
    }
  });

  const originalRecordRunEvent = agentService.recordRunEvent.bind(agentService);
  agentService.recordRunEvent = async (payload) => {
    events.push(payload);
    return originalRecordRunEvent(payload);
  };

  const service = new JobService({ pool, agentService });

  const result = await service.triggerSync();

  assert.equal(result.status, 'running');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.some((event) => event.eventType === 'run_failed'), true);
});

test('JobService triggerSync records stream events from nanobot output', async () => {
  const events = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('select job_key') && sql.includes('limit 1')) {
        return { rows: [{ job_key: '健康顾问_B0047007' }] };
      }

      if (sql.includes('from jobs') && sql.includes('job_key = $1')) {
        return { rows: [{ id: 8 }] };
      }

      if (sql.includes('insert into sourcing_runs')) {
        return { rows: [{ id: 33, runKey: params[0], status: 'pending' }] };
      }

      if (sql.includes('update sourcing_runs')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('insert into sourcing_run_events')) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const { AgentService } = require('../src/services/agent-service');
  const { JobService } = require('../src/services/job-service');

  const agentService = new AgentService({
    pool,
    nanobotRunner: {
      async run({ onStdoutLine, onStderrLine }) {
        onStdoutLine?.('Starting sync');
        onStderrLine?.('Warning line');
        return { ok: true, stdout: 'done' };
      }
    }
  });

  const originalRecordRunEvent = agentService.recordRunEvent.bind(agentService);
  agentService.recordRunEvent = async (payload) => {
    events.push(payload);
    return originalRecordRunEvent(payload);
  };

  const service = new JobService({ pool, agentService });

  await service.triggerSync();

  const streamedMessages = events
    .filter((event) => event.eventType === 'nanobot_stream')
    .map((event) => event.message);

  assert.deepEqual(streamedMessages, ['Starting sync', 'Warning line']);
});

test('AgentService runNanobotForSchedule records stream events from nanobot output', async () => {
  const events = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('from jobs') && sql.includes('custom_requirement')) {
        return { rows: [{ custom_requirement: '优先有电销经验' }], rowCount: 1 };
      }

      if (sql.includes('insert into sourcing_run_events')) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const { AgentService } = require('../src/services/agent-service');

  const agentService = new AgentService({
    pool,
    nanobotRunner: {
      async run({ onStdoutLine, onStderrLine }) {
        onStdoutLine?.('Starting followup');
        onStderrLine?.('Minor warning');
        return { ok: true, stdout: 'done' };
      }
    }
  });

  const originalRecordRunEvent = agentService.recordRunEvent.bind(agentService);
  agentService.recordRunEvent = async (payload) => {
    events.push(payload);
    return originalRecordRunEvent(payload);
  };

  await agentService.runNanobotForSchedule({
    runId: 88,
    jobKey: '健康顾问_B0047007',
    mode: 'followup'
  });

  const streamedMessages = events
    .filter((event) => event.eventType === 'nanobot_stream')
    .map((event) => event.message);

  assert.deepEqual(streamedMessages, ['Starting followup', 'Minor warning']);
});

test('AgentService runNanobotForSchedule sends source workflow guardrails in message', async () => {
  const { AgentService } = require('../src/services/agent-service');
  let capturedMessage = null;

  const agentService = new AgentService({
    pool: {
      async query(sql) {
        if (sql.includes('from jobs') && sql.includes('custom_requirement')) {
          return { rows: [{ custom_requirement: null }], rowCount: 1 };
        }

        throw new Error('recordRunEvent should not be called without runId');
      }
    },
    nanobotRunner: {
      async run({ message }) {
        capturedMessage = message;
        return { ok: true, stdout: 'done' };
      }
    }
  });

  await agentService.runNanobotForSchedule({
    runId: 88,
    jobKey: '健康顾问_B0047007',
    mode: 'source'
  });

  assert.equal(
    capturedMessage,
    [
      '/boss-sourcing --job "健康顾问_B0047007" --source --run-id "88"',
      '如数据库中没有额外岗位定制要求，仅按 BOSS 职位信息正常执行寻源。',
      '执行寻源打招呼时，按浏览器当前状态推进，不要按预设流程脑补。硬规则：只有看到工作经历/教育经历等详情区块，才算进入候选人详情；点击“不合适/提交”不等于详情已关闭；只有确认详情区块消失且推荐列表重新可见，才允许进入下一个候选人；每一步动作后都要先校验页面状态，不满足就先重新 snapshot / wait_for / recover；不要在刚找到 1 到 2 个 A 候选人后提前结束，summary 统计必须从本轮 events.jsonl 实算。'
    ].join('\n')
  );
});

test('AgentService runNanobotForSchedule includes run id for followup mode', async () => {
  const { AgentService } = require('../src/services/agent-service');
  let capturedMessage = null;

  const agentService = new AgentService({
    pool: {
      async query(sql) {
        if (sql.includes('from jobs') && sql.includes('custom_requirement')) {
          return { rows: [{ custom_requirement: '必须有电话销售经验' }], rowCount: 1 };
        }

        throw new Error('recordRunEvent should not be called without runId');
      }
    },
    nanobotRunner: {
      async run({ message }) {
        capturedMessage = message;
        return { ok: true, stdout: 'done' };
      }
    }
  });

  await agentService.runNanobotForSchedule({
    runId: 91,
    jobKey: '健康顾问_B0047007',
    mode: 'followup'
  });

  assert.equal(
    capturedMessage,
    '/boss-sourcing --job "健康顾问_B0047007" --followup --run-id "91"'
  );
});

test('AgentService runNanobotForSchedule maps chat mode to chat workflow message', async () => {
  const { AgentService } = require('../src/services/agent-service');
  let capturedMessage = null;

  const agentService = new AgentService({
    pool: {
      async query(sql) {
        if (sql.includes('from jobs') && sql.includes('custom_requirement')) {
          return { rows: [{ custom_requirement: '必须有电话销售经验' }], rowCount: 1 };
        }

        throw new Error('recordRunEvent should not be called without runId');
      }
    },
    nanobotRunner: {
      async run({ message }) {
        capturedMessage = message;
        return { ok: true, stdout: 'done' };
      }
    }
  });

  await agentService.runNanobotForSchedule({
    runId: 92,
    jobKey: '健康顾问_B0047007',
    mode: 'chat'
  });

  assert.equal(
    capturedMessage,
    '/boss-sourcing --job "健康顾问_B0047007" --chat --run-id "92"'
  );
});

test('AgentService runNanobotForSchedule maps download mode to download workflow message', async () => {
  const { AgentService } = require('../src/services/agent-service');
  let capturedMessage = null;

  const agentService = new AgentService({
    pool: {
      async query(sql) {
        if (sql.includes('from jobs') && sql.includes('custom_requirement')) {
          return { rows: [{ custom_requirement: '必须有电话销售经验' }], rowCount: 1 };
        }

        throw new Error('recordRunEvent should not be called without runId');
      }
    },
    nanobotRunner: {
      async run({ message }) {
        capturedMessage = message;
        return { ok: true, stdout: 'done' };
      }
    }
  });

  await agentService.runNanobotForSchedule({
    runId: 93,
    jobKey: '健康顾问_B0047007',
    mode: 'download'
  });

  assert.equal(
    capturedMessage,
    '/boss-sourcing --job "健康顾问_B0047007" --download --run-id "93"'
  );
});

test('AgentService runNanobotForSchedule maps status mode to status workflow message', async () => {
  const { AgentService } = require('../src/services/agent-service');
  let capturedMessage = null;

  const agentService = new AgentService({
    pool: {
      async query(sql) {
        if (sql.includes('from jobs') && sql.includes('custom_requirement')) {
          return { rows: [{ custom_requirement: '必须有电话销售经验' }], rowCount: 1 };
        }

        throw new Error('recordRunEvent should not be called without runId');
      }
    },
    nanobotRunner: {
      async run({ message }) {
        capturedMessage = message;
        return { ok: true, stdout: 'done' };
      }
    }
  });

  await agentService.runNanobotForSchedule({
    runId: 94,
    jobKey: '健康顾问_B0047007',
    mode: 'status'
  });

  assert.equal(
    capturedMessage,
    '/boss-sourcing --status --job "健康顾问_B0047007" --run-id "94"'
  );
});

test('AgentService runNanobotForSchedule includes custom requirement in source mode message', async () => {
  const { AgentService } = require('../src/services/agent-service');
  let capturedMessage = null;

  const agentService = new AgentService({
    pool: {
      async query(sql) {
        if (sql.includes('from jobs') && sql.includes('custom_requirement')) {
          return { rows: [{ custom_requirement: '必须有电话销售经验' }], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    nanobotRunner: {
      async run({ message }) {
        capturedMessage = message;
        return { ok: true, stdout: 'done' };
      }
    }
  });

  await agentService.runNanobotForSchedule({
    runId: 99,
    jobKey: '健康顾问_B0047007',
    mode: 'source'
  });

  assert.equal(
    capturedMessage,
    [
      '/boss-sourcing --job "健康顾问_B0047007" --source --run-id "99"',
      '执行寻源匹配时，除 BOSS 职位信息外，还必须叠加本地数据库维护的岗位定制要求；该要求不会同步回 BOSS，但会影响候选人筛选与判断。',
      '岗位定制要求：必须有电话销售经验',
      '执行寻源打招呼时，按浏览器当前状态推进，不要按预设流程脑补。硬规则：只有看到工作经历/教育经历等详情区块，才算进入候选人详情；点击“不合适/提交”不等于详情已关闭；只有确认详情区块消失且推荐列表重新可见，才允许进入下一个候选人；每一步动作后都要先校验页面状态，不满足就先重新 snapshot / wait_for / recover；不要在刚找到 1 到 2 个 A 候选人后提前结束，summary 统计必须从本轮 events.jsonl 实算。'
    ].join('\n')
  );
});

test('AgentService recordAction scopes candidate lookup by jobKey when candidateId is absent', async () => {
  const queryCalls = [];
  const { AgentService } = require('../src/services/agent-service');

  const agentService = new AgentService({
    pool: {
      async query(sql, params = []) {
        queryCalls.push({ sql, params });

        if (sql.includes('join people p on p.id = jc.person_id') && sql.includes('join jobs j on j.id = jc.job_id')) {
          return {
            rows: [{
              id: 66,
              resume_state: 'not_requested',
              last_resume_requested_at: null,
              resume_request_count: 0
            }],
            rowCount: 1
          };
        }

        if (sql.includes('insert into candidate_actions')) {
          return { rows: [{ id: 91 }], rowCount: 1 };
        }

        if (sql.includes('update job_candidates')) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('insert into sourcing_run_events')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  const result = await agentService.recordAction({
    runId: 12,
    eventId: 'resume-request:12:1',
    occurredAt: '2026-03-25T08:00:00.000Z',
    actionType: 'resume_request_sent',
    dedupeKey: 'resume-request:12:1',
    jobKey: '健康顾问_B0047007',
    bossEncryptGeekId: 'geek-1',
    payload: { templateType: 'resume_request' }
  });

  assert.equal(result.ok, true);
  const lookupQuery = queryCalls.find(({ sql }) =>
    sql.includes('join people p on p.id = jc.person_id') &&
    sql.includes('join jobs j on j.id = jc.job_id')
  );
  assert.ok(lookupQuery);
  assert.deepEqual(lookupQuery.params, ['geek-1', '健康顾问_B0047007']);
});

test('AgentService recordMessage uses explicit candidateId when provided', async () => {
  const queryCalls = [];
  const { AgentService } = require('../src/services/agent-service');

  const agentService = new AgentService({
    pool: {
      async query(sql, params = []) {
        queryCalls.push({ sql, params });

        if (sql.includes('from job_candidates') && sql.includes('where id = $1')) {
          return {
            rows: [{
              id: 88,
              resume_state: 'not_requested',
              last_resume_requested_at: null,
              resume_request_count: 0
            }],
            rowCount: 1
          };
        }

        if (sql.includes('select jc.id') && sql.includes('join people p on p.id = jc.person_id')) {
          throw new Error('ambiguous geek lookup should not run when candidateId is provided');
        }

        if (sql.includes('insert into candidate_messages')) {
          return { rows: [{ id: 5 }], rowCount: 1 };
        }

        if (sql.includes('update job_candidates')) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('insert into sourcing_run_events')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  const result = await agentService.recordMessage({
    runId: 12,
    candidateId: 88,
    eventId: 'message:m1',
    occurredAt: '2026-03-25T08:05:00.000Z',
    bossEncryptGeekId: 'geek-1',
    bossMessageId: 'm1',
    direction: 'inbound',
    messageType: 'text',
    contentText: '我对岗位感兴趣'
  });

  assert.equal(result.ok, true);
  const insertQuery = queryCalls.find(({ sql }) => sql.includes('insert into candidate_messages'));
  assert.equal(insertQuery.params[0], 88);
});

test('AgentService recordMessage requires jobKey when candidateId is absent', async () => {
  const { AgentService } = require('../src/services/agent-service');

  const agentService = new AgentService({
    pool: {
      async query() {
        throw new Error('db query should not run for underspecified candidate write');
      }
    }
  });

  await assert.rejects(
    () => agentService.recordMessage({
      runId: 12,
      eventId: 'message:m2',
      occurredAt: '2026-03-25T08:06:00.000Z',
      bossEncryptGeekId: 'geek-1',
      bossMessageId: 'm2',
      direction: 'inbound',
      messageType: 'text',
      contentText: '请问薪资多少'
    }),
    /job_key_required_for_geek_lookup/
  );
});

test('POST /api/agent/runs/:runId/messages rejects geek-only writes without jobKey', async () => {
  const app = createApp({
    services: {
      dashboard: { async getSummary() { return { kpis: {}, queues: {}, health: {} }; } },
      jobs: { async listJobs() { return []; } },
      candidates: { async listCandidates() { return []; } },
      scheduler: { async listSchedules() { return []; }, async upsertSchedule() { return {}; } },
      agent: {
        async recordAction() { return { ok: true }; },
        async getFollowupDecision() { return { allowed: true }; },
        async recordMessage() { throw new Error('job_key_required_for_geek_lookup'); },
        async recordAttachment() { return { ok: true }; },
        async createRun() { return { id: 1 }; },
        async recordRunEvent() { return { ok: true }; },
        async completeRun() { return { ok: true, status: 'completed' }; },
        async failRun() { return { ok: true, status: 'failed' }; }
      }
    },
    config: { agentToken: 'search-boss-local-agent' }
  });

  const response = await request(app)
    .post('/api/agent/runs/12/messages?token=search-boss-local-agent')
    .send({
      eventId: 'message:m2',
      bossEncryptGeekId: 'geek-1',
      bossMessageId: 'm2',
      direction: 'inbound',
      messageType: 'text',
      contentText: '请问薪资多少'
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'job_key_required_for_geek_lookup');
});

test('AgentService upsertCandidate records candidate_upserted event after database write', async () => {
  const queryCalls = [];
  const { AgentService } = require('../src/services/agent-service');

  const agentService = new AgentService({
    pool: {
      async query(sql, params = []) {
        queryCalls.push({ sql, params });

        if (sql.includes('insert into people')) {
          return { rows: [{ id: 12 }], rowCount: 1 };
        }

        if (sql.includes('select id') && sql.includes('from jobs')) {
          return { rows: [{ id: 8 }], rowCount: 1 };
        }

        if (sql.includes('insert into job_candidates')) {
          return { rows: [{ id: 55 }], rowCount: 1 };
        }

        if (sql.includes('insert into sourcing_run_events')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  const result = await agentService.upsertCandidate({
    runId: 38,
    eventId: 'candidate-upsert:38:面点师傅_B0038011:geek-1',
    occurredAt: '2026-03-25T07:06:00.000Z',
    jobKey: '面点师傅_B0038011',
    bossEncryptGeekId: 'geek-1',
    name: '谢东林',
    city: '重庆',
    education: '大专',
    experience: '5-10年',
    school: '重庆工商大学',
    status: 'greeted',
    metadata: { matchTier: 'A' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.personId, 12);
  assert.equal(result.candidateId, 55);
  assert.ok(
    queryCalls.some(({ sql, params }) =>
      sql.includes('insert into sourcing_run_events') &&
      params[0] === 38 &&
      params[5] === 'candidate_upserted'
    )
  );
  const candidateUpsertSql = queryCalls.find(({ sql }) => sql.includes('insert into job_candidates'))?.sql || '';
  assert.match(candidateUpsertSql, /\$5::timestamptz/);
});

test('AgentService importRunEvents records raw events and projects non-duplicate items', async () => {
  const { AgentService } = require('../src/services/agent-service');
  const agentService = new AgentService({ pool: { async query() { throw new Error('unexpected db query'); } } });

  const recordedEvents = [];
  const candidateCalls = [];
  const actionCalls = [];
  const messageCalls = [];
  const attachmentCalls = [];

  agentService.recordRunEvent = async (payload) => {
    recordedEvents.push(payload);
    return { ok: true, duplicated: payload.eventId === 'duplicate:event' };
  };
  agentService.upsertCandidate = async (payload) => {
    candidateCalls.push(payload);
    return { ok: true, candidateId: 101, personId: 202 };
  };
  agentService.recordAction = async (payload) => {
    actionCalls.push(payload);
    return { ok: true, actionId: 1, duplicated: false };
  };
  agentService.recordMessage = async (payload) => {
    messageCalls.push(payload);
    return { ok: true, messageId: 3, duplicated: false };
  };
  agentService.recordAttachment = async (payload) => {
    attachmentCalls.push(payload);
    return { ok: true, attachmentId: 5, alreadyProcessed: false };
  };

  const result = await agentService.importRunEvents({
    runId: 38,
    attemptId: 'attempt-2',
    sourceFile: 'runs/2026-03-25/source/38/events.jsonl',
    events: [
      {
        eventId: 'candidate-observed:38:geek-1',
        eventType: 'candidate_observed',
        sequence: 10,
        occurredAt: '2026-03-25T07:05:00.000Z',
        jobKey: '面点师傅_B0038011',
        bossEncryptGeekId: 'geek-1',
        name: '谢东林',
        city: '重庆',
        education: '大专',
        experience: '5-10年',
        school: '重庆工商大学'
      },
      {
        eventId: 'greet:38:geek-1',
        eventType: 'greet_sent',
        sequence: 11,
        occurredAt: '2026-03-25T07:06:00.000Z',
        payload: {
          jobKey: '面点师傅_B0038011',
          bossEncryptGeekId: 'geek-1',
          name: '谢东林',
          city: '重庆',
          education: '大专',
          experience: '5-10年',
          school: '重庆工商大学',
          matchTier: 'A'
        }
      },
      {
        eventId: 'message:38:m1',
        eventType: 'message_recorded',
        sequence: 12,
        occurredAt: '2026-03-25T07:07:00.000Z',
        payload: {
          bossEncryptGeekId: 'geek-1',
          bossMessageId: 'm1',
          direction: 'inbound',
          messageType: 'text',
          contentText: '我对岗位感兴趣'
        }
      },
      {
        eventId: 'attachment:38:a1',
        eventType: 'resume_downloaded',
        sequence: 13,
        occurredAt: '2026-03-25T07:08:00.000Z',
        payload: {
          bossEncryptGeekId: 'geek-1',
          bossAttachmentId: 'a1',
          fileName: 'resume.pdf',
          storedPath: 'resumes/面点师傅_B0038011/谢东林_geek-1.pdf'
        }
      },
      {
        eventId: 'duplicate:event',
        eventType: 'candidate_observed',
        sequence: 14,
        occurredAt: '2026-03-25T07:09:00.000Z',
        payload: {
          jobKey: '面点师傅_B0038011',
          bossEncryptGeekId: 'geek-2'
        }
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.receivedCount, 5);
  assert.equal(result.importedCount, 4);
  assert.equal(result.projectedCount, 3);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.acknowledgedCount, 5);
  assert.equal(result.allEventsAccountedFor, true);
  assert.equal(recordedEvents.length, 5);
  assert.equal(recordedEvents[0].payload.importSourceFile, 'runs/2026-03-25/source/38/events.jsonl');
  assert.equal(candidateCalls.length, 1);
  assert.equal(candidateCalls[0].status, 'greeted');
  assert.equal(actionCalls.length, 1);
  assert.equal(actionCalls[0].actionType, 'greet_sent');
  assert.equal(actionCalls[0].dedupeKey, 'greet:面点师傅_B0038011:geek-1');
  assert.equal(messageCalls.length, 1);
  assert.equal(messageCalls[0].bossMessageId, 'm1');
  assert.equal(attachmentCalls.length, 1);
  assert.equal(attachmentCalls[0].status, 'downloaded');
});
