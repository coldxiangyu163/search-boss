const express = require('express');

function createApp({ services = {}, config = {} } = {}) {
  const app = express();

  app.use(express.json());
  app.use(express.static('public'));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/dashboard/summary', async (_req, res, next) => {
    try {
      const summary = await services.dashboard.getSummary();
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/jobs', async (_req, res, next) => {
    try {
      const items = await services.jobs.listJobs();
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/jobs/:jobKey', async (req, res, next) => {
    try {
      const item = await services.jobs.getJobDetail(req.params.jobKey);
      if (!item) {
        res.status(404).json({
          error: 'job_not_found',
          message: '未找到对应职位。'
        });
        return;
      }

      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/sync', async (_req, res, next) => {
    try {
      const result = await services.jobs.triggerSync();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/jobs/:jobKey/custom-requirement', async (req, res, next) => {
    try {
      const item = await services.jobs.updateJobCustomRequirement(
        req.params.jobKey,
        req.body?.customRequirement
      );

      if (!item) {
        res.status(404).json({
          error: 'job_not_found',
          message: '未找到对应职位。'
        });
        return;
      }

      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/agent/jobs/batch', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const result = await services.jobs.upsertJobsBatch(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs/:runId/events', async (req, res, next) => {
    try {
      const result = await services.agent.listRunEvents(req.params.runId, {
        afterId: Number(req.query.afterId || 0)
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/candidates', async (req, res, next) => {
    try {
      const result = await services.candidates.listCandidates({
        jobKey: req.query.jobKey,
        status: req.query.status,
        resumeState: req.query.resumeState,
        keyword: req.query.keyword,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined
      });

      if (Array.isArray(result)) {
        res.json({
          items: result,
          pagination: {
            page: 1,
            pageSize: result.length,
            total: result.length,
            totalPages: result.length ? 1 : 0
          }
        });
        return;
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/candidates/:candidateId', async (req, res, next) => {
    try {
      const item = await services.candidates.getCandidateDetail(req.params.candidateId);
      if (!item) {
        res.status(404).json({
          error: 'candidate_not_found',
          message: '未找到对应候选人。'
        });
        return;
      }

      if (services.agent?.getFollowupDecision) {
        item.followupDecision = await services.agent.getFollowupDecision(req.params.candidateId);
      }

      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/schedules', async (_req, res, next) => {
    try {
      const items = await services.scheduler.listSchedules();
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/schedules', async (req, res, next) => {
    try {
      const item = await services.scheduler.upsertSchedule(req.body);
      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/schedules/:id/trigger', async (req, res, next) => {
    try {
      const result = await services.scheduler.triggerSchedule(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/:jobKey/tasks/:taskType/trigger', async (req, res, next) => {
    try {
      const result = await services.scheduler.triggerJobTask(
        req.params.jobKey,
        req.params.taskType
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/agent/runs/:runId/actions', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const result = await services.agent.recordAction({
        runId: req.params.runId,
        ...req.body
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/agent/runs', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const result = await services.agent.createRun(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/agent/runs/:runId/events', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const result = await services.agent.recordRunEvent({
        runId: req.params.runId,
        ...req.body
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/agent/runs/:runId/candidates', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const result = await services.agent.upsertCandidate({
        runId: req.params.runId,
        ...req.body
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/agent/runs/:runId/import-events', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const importPayload = normalizeImportEventsPayload(req.body, req.params.runId);

      const result = await services.agent.importRunEvents(importPayload);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/agent/runs/:runId/complete', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const result = await services.agent.completeRun({
        runId: req.params.runId,
        ...req.body
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/agent/runs/:runId/fail', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const result = await services.agent.failRun({
        runId: req.params.runId,
        ...req.body
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/agent/candidates/:candidateId/followup-decision', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const result = await services.agent.getFollowupDecision(req.params.candidateId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/agent/runs/:runId/messages', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const result = await services.agent.recordMessage({
        runId: req.params.runId,
        ...req.body
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/agent/runs/:runId/attachments', async (req, res, next) => {
    try {
      if (req.query.token !== config.agentToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const result = await services.agent.recordAttachment({
        runId: req.params.runId,
        ...req.body
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    if (error.message === 'candidate_identifier_missing') {
      res.status(400).json({
        error: 'candidate_identifier_missing',
        message: '候选人写入缺少 candidateId 或 bossEncryptGeekId。'
      });
      return;
    }

    if (error.message === 'job_key_required_for_geek_lookup') {
      res.status(400).json({
        error: 'job_key_required_for_geek_lookup',
        message: '按 bossEncryptGeekId 写入消息、动作或附件时必须同时提供 jobKey。'
      });
      return;
    }

    if (error.message === 'nanobot_daily_limit_reached') {
      res.status(503).json({
        error: 'nanobot_daily_limit_reached',
        message: '小聘AGENT 当日额度已用尽，未实际触发职位同步。'
      });
      return;
    }

    if (error.message === 'nanobot_provider_error') {
      res.status(502).json({
        error: 'nanobot_provider_error',
        message: '小聘AGENT 调用上游模型失败，未实际触发职位同步。'
      });
      return;
    }

    if (error.message === 'schedule_not_found') {
      res.status(404).json({
        error: 'schedule_not_found',
        message: '未找到对应的自动化任务配置。'
      });
      return;
    }

    res.status(500).json({
      error: error.message
    });
  });

  return app;
}


function normalizeImportEventsPayload(body, fallbackRunId) {
  if (Array.isArray(body)) {
    return {
      runId: fallbackRunId,
      events: body
    };
  }

  const payload = body && typeof body === 'object' ? body : {};
  if (Array.isArray(payload.events)) {
    return {
      runId: fallbackRunId,
      ...payload,
      events: payload.events
    };
  }

  if (payload.eventId && Array.isArray(payload.jobs)) {
    return {
      runId: fallbackRunId,
      attemptId: payload.attemptId,
      sourceFile: payload.sourceFile,
      events: [
        {
          eventId: payload.eventId,
          eventType: payload.eventType || 'jobs_batch_synced',
          sequence: payload.sequence,
          occurredAt: payload.occurredAt,
          payload
        }
      ]
    };
  }

  return {
    runId: fallbackRunId,
    ...payload,
    events: []
  };
}

module.exports = {
  createApp
};
