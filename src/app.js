const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const { authMiddleware, requireRole, resolveHrScope } = require('./middleware/auth');

const REPO_ROOT = path.resolve(__dirname, '..');
const RESUMES_ROOT = path.join(REPO_ROOT, 'resumes');

function createApp({ services = {}, config = {}, pool = null } = {}) {
  const app = express();

  app.use(express.json());

  if (pool) {
    app.use(session({
      store: new PgStore({ pool, createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET || 'search-boss-dev-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
      }
    }));
  }

  if (pool) {
    app.use(async (req, _res, next) => {
      const userId = req.session?.userId;
      if (userId) {
        try {
          const result = await pool.query(`
            select u.id, u.role, u.department_id, u.name, u.email,
                   ha.id as hr_account_id
            from users u
            left join hr_accounts ha on ha.user_id = u.id and ha.status = 'active'
            where u.id = $1 and u.status = 'active'
          `, [userId]);
          if (result.rows[0]) {
            req.user = result.rows[0];
          }
        } catch (_) {}
      }
      next();
    });
  }

  app.use(express.static('public'));

  // --- Auth routes (no auth required) ---
  app.post('/api/auth/login', async (req, res, next) => {
    try {
      if (!services.auth) {
        return res.status(501).json({ error: 'auth_not_configured' });
      }

      const result = await services.auth.login(req.body);
      if (!result.ok) {
        return res.status(401).json({ error: result.error });
      }

      if (req.session) {
        req.session.userId = result.user.id;
      }

      res.json({ ok: true, user: result.user });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.session) {
      req.session.destroy(() => {
        res.json({ ok: true });
      });
    } else {
      res.json({ ok: true });
    }
  });

  app.get('/api/auth/me', async (req, res, next) => {
    try {
      if (!services.auth) {
        return res.status(501).json({ error: 'auth_not_configured' });
      }

      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'unauthorized' });
      }

      const user = await services.auth.getMe(userId);
      if (!user) {
        return res.status(401).json({ error: 'user_not_found' });
      }

      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/dashboard/summary', async (req, res, next) => {
    try {
      const hrAccountId = req.user?.role === 'hr' ? req.user.hr_account_id : undefined;
      const summary = await services.dashboard.getSummary({ hrAccountId });
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/dashboard/sync-recruit-data', async (req, res, next) => {
    try {
      const result = await services.dashboard.syncRecruitData(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/dashboard/hr-overview', async (req, res, next) => {
    try {
      if (!req.user || !['enterprise_admin', 'dept_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const departmentId = req.user.role === 'dept_admin' ? req.user.department_id : undefined;
      const items = await services.dashboard.getHrOverview({ departmentId });
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/jobs', async (req, res, next) => {
    try {
      const isAdmin = req.user && ['enterprise_admin', 'dept_admin'].includes(req.user.role);
      const hrAccountId = req.user?.role === 'hr' ? req.user.hr_account_id : undefined;
      const items = await services.jobs.listJobs({ hrAccountId, includeHrName: isAdmin });
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

  app.get('/api/runs/:runId', async (req, res, next) => {
    try {
      const item = await services.agent.getRun(req.params.runId);
      if (!item) {
        res.status(404).json({
          error: 'run_not_found',
          message: '未找到对应执行任务。'
        });
        return;
      }

      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/candidates', async (req, res, next) => {
    try {
      const isAdmin = req.user && ['enterprise_admin', 'dept_admin'].includes(req.user.role);
      const hrAccountId = req.user?.role === 'hr' ? req.user.hr_account_id : undefined;
      const result = await services.candidates.listCandidates({
        jobKey: req.query.jobKey,
        status: req.query.status,
        resumeState: req.query.resumeState,
        keyword: req.query.keyword,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
        hrAccountId,
        includeHrName: isAdmin
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

  app.get('/api/resume-preview', async (req, res, next) => {
    try {
      const resumePath = resolveResumePreviewPath(req.query.path);
      if (!resumePath) {
        res.status(400).json({
          error: 'invalid_resume_path',
          message: '简历路径不合法。'
        });
        return;
      }

      await fs.access(resumePath);
      res.type(path.extname(resumePath));
      res.set('Content-Disposition', 'inline');
      createReadStream(resumePath)
        .on('error', next)
        .pipe(res);
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.status(404).json({
          error: 'resume_not_found',
          message: '未找到对应简历文件。'
        });
        return;
      }

      next(error);
    }
  });

  app.get('/api/task-lock', (_req, res) => {
    const holder = services.taskLock?.getHolder() || null;
    res.json({ busy: holder !== null, holder });
  });

  app.get('/api/schedules', async (req, res, next) => {
    try {
      const hrAccountId = req.user?.role === 'hr' ? req.user.hr_account_id : undefined;
      const items = await services.scheduler.listSchedules({ hrAccountId });
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

  app.delete('/api/schedules/:id', async (req, res, next) => {
    try {
      const item = await services.scheduler.deleteSchedule(req.params.id);
      res.json({ ok: true, item });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/schedules/:id/toggle', async (req, res, next) => {
    try {
      const item = await services.scheduler.toggleSchedule(req.params.id, req.body.enabled);
      res.json({ item });
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

      const payload = normalizeRunEventPayload(req.body, req.params.runId);
      const result = await services.agent.recordRunEvent({
        runId: req.params.runId,
        ...payload
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
        ...normalizeTerminalPayload(req.body)
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
        ...normalizeTerminalPayload(req.body)
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

  // --- Admin routes (require auth + admin role) ---
  app.get('/api/admin/departments', async (req, res, next) => {
    try {
      if (!req.user || !['enterprise_admin', 'dept_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const result = await pool?.query('select * from departments order by id') || { rows: [] };
      res.json({ items: result.rows });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/departments', async (req, res, next) => {
    try {
      if (!req.user || req.user.role !== 'enterprise_admin') {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { name } = req.body;
      const result = await pool?.query(
        'insert into departments (name) values ($1) returning *',
        [name]
      );
      res.json({ item: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/users', async (req, res, next) => {
    try {
      if (!req.user || !['enterprise_admin', 'dept_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      let query = `
        select u.id, u.name, u.email, u.phone, u.role, u.department_id,
               u.status, d.name as department_name
        from users u
        left join departments d on d.id = u.department_id
      `;
      const values = [];
      if (req.user.role === 'dept_admin') {
        values.push(req.user.department_id);
        query += ` where u.department_id = $1`;
      }
      query += ' order by u.id';
      const result = await pool?.query(query, values) || { rows: [] };
      res.json({ items: result.rows });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/users', async (req, res, next) => {
    try {
      if (!req.user || !['enterprise_admin', 'dept_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const user = await services.auth.createUser(req.body);
      res.json({ item: user });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/hr-accounts', async (req, res, next) => {
    try {
      if (!req.user || !['enterprise_admin', 'dept_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      let query = `
        select ha.id, ha.name, ha.status, ha.notes,
               ha.user_id, ha.department_id, ha.manager_user_id,
               u.name as user_name, u.email as user_email,
               d.name as department_name
        from hr_accounts ha
        join users u on u.id = ha.user_id
        left join departments d on d.id = ha.department_id
      `;
      const values = [];
      if (req.user.role === 'dept_admin') {
        values.push(req.user.department_id);
        query += ` where ha.department_id = $1`;
      }
      query += ' order by ha.id';
      const result = await pool?.query(query, values) || { rows: [] };
      res.json({ items: result.rows });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/hr-accounts', async (req, res, next) => {
    try {
      if (!req.user || !['enterprise_admin', 'dept_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { userId, departmentId, managerUserId, name, notes } = req.body;
      const result = await pool?.query(`
        insert into hr_accounts (user_id, department_id, manager_user_id, name, notes)
        values ($1, $2, $3, $4, $5)
        returning *
      `, [userId, departmentId || null, managerUserId || null, name, notes || null]);
      res.json({ item: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/admin/hr-accounts/:id', async (req, res, next) => {
    try {
      if (!req.user || !['enterprise_admin', 'dept_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { name, status, notes, managerUserId } = req.body;
      const result = await pool?.query(`
        update hr_accounts
        set name = coalesce($2, name),
            status = coalesce($3, status),
            notes = coalesce($4, notes),
            manager_user_id = coalesce($5, manager_user_id),
            updated_at = now()
        where id = $1
        returning *
      `, [req.params.id, name, status, notes, managerUserId]);
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'hr_account_not_found' });
      }
      res.json({ item: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    if (error.message === 'boss_encrypt_geek_id_missing') {
      res.status(400).json({
        error: 'boss_encrypt_geek_id_missing',
        message: '候选人写入缺少 bossEncryptGeekId。'
      });
      return;
    }

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

    if (error.message === 'task_already_running') {
      res.status(409).json({
        error: 'task_already_running',
        message: '当前已有任务在执行，请等待完成后再试。',
        holder: error.holder || null
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

function normalizeRunEventPayload(body, fallbackRunId) {
  const payload = body && typeof body === 'object' ? body : {};

  if (payload.eventId || payload.eventType) {
    return payload;
  }

  if (payload.type !== 'bootstrap') {
    return payload;
  }

  const occurredAt = payload.occurredAt || payload.timestamp || new Date().toISOString();
  const runId = payload.runId || fallbackRunId;

  return {
    attemptId: payload.attemptId || null,
    eventId: `bootstrap:${runId}:${occurredAt}`,
    sequence: payload.sequence || null,
    occurredAt,
    eventType: 'agent_bootstrap',
    stage: 'bootstrap',
    message: payload.message || 'agent bootstrap',
    payload: {
      type: payload.type,
      stage: payload.stage || null,
      mode: payload.mode || null,
      timestamp: payload.timestamp || null
    }
  };
}

function normalizeTerminalPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }

  if (body.payload !== undefined) {
    return body;
  }

  const {
    eventId,
    attemptId,
    sequence,
    occurredAt,
    message,
    ...legacyPayload
  } = body;

  if (Object.keys(legacyPayload).length === 0) {
    return body;
  }

  return {
    eventId,
    attemptId,
    sequence,
    occurredAt,
    message,
    payload: legacyPayload
  };
}

function resolveResumePreviewPath(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalizedValue = value.trim().replace(/\\/g, '/');
  if (!normalizedValue || !normalizedValue.startsWith('resumes/')) {
    return '';
  }

  const resolvedPath = path.resolve(REPO_ROOT, normalizedValue);
  const relativeToResumes = path.relative(RESUMES_ROOT, resolvedPath);
  if (!relativeToResumes || relativeToResumes.startsWith('..') || path.isAbsolute(relativeToResumes)) {
    return '';
  }

  return resolvedPath;
}

module.exports = {
  createApp
};
