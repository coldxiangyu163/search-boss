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

  app.post('/api/jobs/sync', async (_req, res, next) => {
    try {
      const result = await services.jobs.triggerSync();
      res.json(result);
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
      const items = await services.candidates.listCandidates({
        jobKey: req.query.jobKey,
        status: req.query.status
      });
      res.json({ items });
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

module.exports = {
  createApp
};
