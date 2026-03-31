const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const { authMiddleware, requireRole, resolveHrScope, isSystemAdmin, isAdminRole } = require('./middleware/auth');

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
                   u.expires_at, u.max_hr_accounts,
                   ha.id as hr_account_id
            from users u
            left join hr_accounts ha on ha.user_id = u.id and ha.status = 'active'
            where u.id = $1 and u.status = 'active'
          `, [userId]);
          const user = result.rows[0];
          if (user) {
            if (user.expires_at && new Date(user.expires_at) < new Date()) {
              req.session.destroy(() => {});
            } else {
              req.user = user;
            }
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
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const departmentId = isSystemAdmin(req.user) ? undefined : req.user.department_id;
      const items = await services.dashboard.getHrOverview({ departmentId });
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/browser/screenshot', async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const hrAccountId = req.user.hr_account_id || req.user.hrAccountId;
      if (!hrAccountId) {
        return res.status(400).json({ error: 'no_hr_account', message: '当前用户未绑定 HR 账号' });
      }
      const bi = await pool?.query(`
        select bi.id, bi.cdp_endpoint
        from browser_instances bi
        join boss_accounts ba on ba.id = bi.boss_account_id
        where ba.hr_account_id = $1
          and ba.status = 'active'
          and bi.status in ('idle', 'busy')
        order by bi.last_seen_at desc nulls last
        limit 1
      `, [hrAccountId]);
      if (!bi.rows[0]) {
        return res.status(404).json({ error: 'no_browser_instance', message: '未找到可用的浏览器实例' });
      }
      const endpoint = bi.rows[0].cdp_endpoint;
      const { BossCdpClient } = require('./services/boss-cdp-client');
      const client = new BossCdpClient({ endpoint });
      try {
        const includeViewport = req.query.viewport === '1';
        const result = await client.captureAnyScreenshot({ format: 'jpeg', quality: 60, includeViewport });
        const buffer = Buffer.from(result.data, 'base64');
        const headers = {
          'Content-Type': 'image/jpeg',
          'Content-Length': buffer.length,
          'Cache-Control': 'no-store',
          'X-Page-Url': encodeURIComponent(result.url || ''),
          'X-Page-Title': encodeURIComponent(result.title || '')
        };
        if (result.viewport) {
          headers['X-Viewport-Width'] = String(result.viewport.width || 0);
          headers['X-Viewport-Height'] = String(result.viewport.height || 0);
        }
        res.set(headers);
        res.send(buffer);
      } catch (err) {
        res.status(502).json({ error: 'screenshot_failed', message: err.message });
      }
    } catch (error) { next(error); }
  });

  app.post('/api/browser/click', async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const hrAccountId = req.user.hr_account_id || req.user.hrAccountId;
      if (!hrAccountId) {
        return res.status(400).json({ error: 'no_hr_account', message: '当前用户未绑定 HR 账号' });
      }
      const { x, y } = req.body;
      if (x === undefined || y === undefined) {
        return res.status(400).json({ error: 'missing_coordinates' });
      }
      const bi = await pool?.query(`
        select bi.id, bi.cdp_endpoint
        from browser_instances bi
        join boss_accounts ba on ba.id = bi.boss_account_id
        where ba.hr_account_id = $1
          and ba.status = 'active'
          and bi.status in ('idle', 'busy')
        order by bi.last_seen_at desc nulls last
        limit 1
      `, [hrAccountId]);
      if (!bi.rows[0]) {
        return res.status(404).json({ error: 'no_browser_instance', message: '未找到可用的浏览器实例' });
      }
      const { BossCdpClient } = require('./services/boss-cdp-client');
      const client = new BossCdpClient({ endpoint: bi.rows[0].cdp_endpoint });
      const result = await client.clickOnAnyPage({ x, y });
      res.json(result);
    } catch (error) { next(error); }
  });

  app.get('/api/jobs', async (req, res, next) => {
    try {
      const admin = req.user && isAdminRole(req.user);
      const hrAccountId = req.user?.role === 'hr' ? req.user.hr_account_id : undefined;
      const items = await services.jobs.listJobs({ hrAccountId, includeHrName: admin });
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

  app.post('/api/jobs/sync', async (req, res, next) => {
    try {
      const result = await services.jobs.triggerSync({ hrAccountId: req.user?.hr_account_id });
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
      const admin = req.user && isAdminRole(req.user);
      const hrAccountId = req.user?.role === 'hr' ? req.user.hr_account_id : undefined;
      const result = await services.candidates.listCandidates({
        jobKey: req.query.jobKey,
        status: req.query.status,
        resumeState: req.query.resumeState,
        keyword: req.query.keyword,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
        hrAccountId,
        includeHrName: admin
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
      const item = await services.scheduler.upsertSchedule({
        ...req.body,
        hrAccountId: req.user?.hr_account_id
      });
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
        req.params.taskType,
        { hrAccountId: req.user?.hr_account_id }
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
      if (!req.user || !isAdminRole(req.user)) {
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
      if (!req.user || !isSystemAdmin(req.user)) {
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

  app.patch('/api/admin/departments/:id', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { name, status } = req.body;
      const result = await pool?.query(`
        update departments
        set name = coalesce($2, name),
            status = coalesce($3, status),
            updated_at = now()
        where id = $1
        returning *
      `, [req.params.id, name, status]);
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'department_not_found' });
      }
      res.json({ item: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/admin/departments/:id', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const hasUsers = await pool?.query(
        'select count(*) from users where department_id = $1', [req.params.id]
      );
      if (parseInt(hasUsers.rows[0].count) > 0) {
        return res.status(400).json({ error: 'department_has_users', message: '该部门下还有用户，无法删除，请先移除或转移该部门下的所有用户' });
      }
      const hasHr = await pool?.query(
        'select count(*) from hr_accounts where department_id = $1', [req.params.id]
      );
      if (parseInt(hasHr.rows[0].count) > 0) {
        return res.status(400).json({ error: 'department_has_hr_accounts', message: '该部门下还有HR账号，无法删除，请先移除或转移该部门下的HR账号' });
      }
      await pool?.query('delete from departments where id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/users', async (req, res, next) => {
    try {
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      let query = `
        select u.id, u.name, u.email, u.phone, u.role, u.department_id,
               u.status, u.expires_at, u.max_hr_accounts,
               d.name as department_name
        from users u
        left join departments d on d.id = u.department_id
      `;
      const values = [];
      if (!isSystemAdmin(req.user)) {
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
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (!isSystemAdmin(req.user)) {
        if (['system_admin', 'enterprise_admin'].includes(req.body.role)) {
          return res.status(403).json({ error: 'forbidden', message: '无权创建该角色的用户' });
        }
        if (req.body.departmentId && String(req.body.departmentId) !== String(req.user.department_id)) {
          return res.status(403).json({ error: 'forbidden', message: '只能在自己的部门下创建用户' });
        }
        if (!req.body.departmentId) {
          req.body.departmentId = req.user.department_id;
        }
      }
      const user = await services.auth.createUser(req.body);
      res.json({ item: user });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/admin/users/:id', async (req, res, next) => {
    try {
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (!isSystemAdmin(req.user)) {
        const target = await pool?.query('select department_id, role from users where id = $1', [req.params.id]);
        if (!target?.rows[0] || String(target.rows[0].department_id) !== String(req.user.department_id)) {
          return res.status(403).json({ error: 'forbidden', message: '只能编辑自己部门的用户' });
        }
        if (['system_admin', 'enterprise_admin'].includes(target.rows[0].role)) {
          return res.status(403).json({ error: 'forbidden', message: '无权编辑该角色的用户' });
        }
      }
      const { name, email, phone, role, departmentId, status } = req.body;
      if (!isSystemAdmin(req.user) && role && ['system_admin', 'enterprise_admin'].includes(role)) {
        return res.status(403).json({ error: 'forbidden', message: '无权设置该角色' });
      }
      const fields = ['name', 'email', 'phone', 'role', 'department_id', 'status'];
      const vals = [name, email, phone, role, departmentId, status];
      const setClauses = fields.map((f, i) => `${f} = coalesce($${i + 2}, ${f})`).join(', ');
      const result = await pool?.query(`
        update users
        set ${setClauses}, updated_at = now()
        where id = $1
        returning id, name, email, phone, role, department_id, status, expires_at, max_hr_accounts
      `, [req.params.id, ...vals]);
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'user_not_found' });
      }
      res.json({ item: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/admin/users/:id/limits', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { expiresAt, maxHrAccounts } = req.body;
      const result = await pool?.query(`
        update users
        set expires_at = $2,
            max_hr_accounts = coalesce($3, max_hr_accounts),
            updated_at = now()
        where id = $1
        returning id, name, email, role, department_id, status, expires_at, max_hr_accounts
      `, [req.params.id, expiresAt || null, maxHrAccounts]);
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'user_not_found' });
      }
      res.json({ item: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/users/:id/reset-password', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { password } = req.body;
      if (!password || password.length < 6) {
        return res.status(400).json({ error: 'password_too_short', message: '密码不能少于6位' });
      }
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash(password, 10);
      await pool?.query('update users set password_hash = $2, updated_at = now() where id = $1', [req.params.id, hash]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/admin/users/:id', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (String(req.params.id) === String(req.user.id)) {
        return res.status(400).json({ error: 'cannot_delete_self', message: '不能删除自己的账号' });
      }
      const hasHr = await pool?.query(
        'select count(*) from hr_accounts where user_id = $1', [req.params.id]
      );
      if (parseInt(hasHr.rows[0].count) > 0) {
        return res.status(400).json({ error: 'user_has_hr_account', message: '该用户关联了HR账号，请先解除关联' });
      }
      const isManager = await pool?.query(
        'select count(*) from hr_accounts where manager_user_id = $1', [req.params.id]
      );
      if (parseInt(isManager.rows[0].count) > 0) {
        return res.status(400).json({ error: 'user_is_hr_manager', message: '该用户是其他HR账号的管理者，请先变更管理者' });
      }
      await pool?.query('delete from users where id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/hr-accounts', async (req, res, next) => {
    try {
      if (!req.user || !isAdminRole(req.user)) {
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
      if (!isSystemAdmin(req.user)) {
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
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { userId, departmentId, managerUserId, name, notes } = req.body;
      if (!isSystemAdmin(req.user)) {
        const deptId = departmentId || req.user.department_id;
        if (String(deptId) !== String(req.user.department_id)) {
          return res.status(403).json({ error: 'forbidden', message: '只能在自己的部门下创建HR账号' });
        }
        if (req.user.max_hr_accounts > 0) {
          const countResult = await pool?.query(
            'select count(*) from hr_accounts where department_id = $1',
            [req.user.department_id]
          );
          if (parseInt(countResult.rows[0].count) >= req.user.max_hr_accounts) {
            return res.status(400).json({
              error: 'hr_account_limit_reached',
              message: `HR账号数量已达上限（${req.user.max_hr_accounts}个），请联系系统管理员`
            });
          }
        }
      }
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
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (!isSystemAdmin(req.user)) {
        const ha = await pool?.query('select department_id from hr_accounts where id = $1', [req.params.id]);
        if (!ha?.rows[0] || String(ha.rows[0].department_id) !== String(req.user.department_id)) {
          return res.status(403).json({ error: 'forbidden', message: '只能编辑自己部门的HR账号' });
        }
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

  app.delete('/api/admin/hr-accounts/:id', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const hasBoss = await pool?.query(
        'select count(*) from boss_accounts where hr_account_id = $1', [req.params.id]
      );
      if (parseInt(hasBoss.rows[0].count) > 0) {
        return res.status(400).json({ error: 'hr_account_has_boss_accounts', message: '该HR账号下还有BOSS账号，请先删除关联的BOSS账号' });
      }
      const hasJobs = await pool?.query(
        'select count(*) from jobs where hr_account_id = $1', [req.params.id]
      );
      if (parseInt(hasJobs.rows[0].count) > 0) {
        return res.status(400).json({ error: 'hr_account_has_jobs', message: '该HR账号下还有职位数据，无法删除' });
      }
      const hasRuns = await pool?.query(
        'select count(*) from sourcing_runs where hr_account_id = $1', [req.params.id]
      );
      if (parseInt(hasRuns.rows[0].count) > 0) {
        return res.status(400).json({ error: 'hr_account_has_runs', message: '该HR账号下还有执行记录，无法删除' });
      }
      const hasCandidates = await pool?.query(
        'select count(*) from job_candidates where hr_account_id = $1', [req.params.id]
      );
      if (parseInt(hasCandidates.rows[0].count) > 0) {
        return res.status(400).json({ error: 'hr_account_has_candidates', message: '该HR账号下还有候选人数据，无法删除' });
      }
      const hasSchedules = await pool?.query(
        'select count(*) from scheduled_jobs where hr_account_id = $1', [req.params.id]
      );
      if (parseInt(hasSchedules.rows[0].count) > 0) {
        return res.status(400).json({ error: 'hr_account_has_schedules', message: '该HR账号下还有调度任务，无法删除' });
      }
      await pool?.query('delete from hr_accounts where id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // --- BOSS accounts ---
  app.get('/api/admin/boss-accounts', async (req, res, next) => {
    try {
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const result = await pool?.query(`
        select ba.*, ha.name as hr_account_name
        from boss_accounts ba
        left join hr_accounts ha on ha.id = ba.hr_account_id
        order by ba.id
      `) || { rows: [] };
      res.json({ items: result.rows });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/boss-accounts', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { hrAccountId, bossLoginName, displayName } = req.body;
      const result = await pool?.query(`
        insert into boss_accounts (hr_account_id, boss_login_name, display_name)
        values ($1, $2, $3) returning *
      `, [hrAccountId, bossLoginName || null, displayName || null]);
      res.json({ item: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.patch('/api/admin/boss-accounts/:id', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { bossLoginName, displayName, status } = req.body;
      const result = await pool?.query(`
        update boss_accounts
        set boss_login_name = coalesce($2, boss_login_name),
            display_name = coalesce($3, display_name),
            status = coalesce($4, status),
            updated_at = now()
        where id = $1 returning *
      `, [req.params.id, bossLoginName, displayName, status]);
      if (!result.rows[0]) return res.status(404).json({ error: 'not_found' });
      res.json({ item: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.delete('/api/admin/boss-accounts/:id', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const hasBi = await pool?.query('select count(*) from browser_instances where boss_account_id = $1', [req.params.id]);
      if (parseInt(hasBi.rows[0].count) > 0) {
        return res.status(400).json({ error: 'has_browser_instances', message: '该BOSS账号下还有浏览器实例，请先删除' });
      }
      await pool?.query('delete from boss_accounts where id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  // --- Browser instances ---
  app.get('/api/admin/browser-instances', async (req, res, next) => {
    try {
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const result = await pool?.query(`
        select bi.*, ba.boss_login_name, ba.display_name as boss_display_name,
               ba.hr_account_id, ha.name as hr_account_name
        from browser_instances bi
        left join boss_accounts ba on ba.id = bi.boss_account_id
        left join hr_accounts ha on ha.id = ba.hr_account_id
        order by bi.id
      `) || { rows: [] };
      res.json({ items: result.rows });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/browser-instances', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { bossAccountId, instanceName, cdpEndpoint, userDataDir, downloadDir, debugPort, host } = req.body;
      if (!cdpEndpoint || !userDataDir || !downloadDir) {
        return res.status(400).json({ error: 'missing_fields', message: 'cdpEndpoint, userDataDir, downloadDir 必填' });
      }
      const result = await pool?.query(`
        insert into browser_instances (boss_account_id, instance_name, cdp_endpoint, user_data_dir, download_dir, debug_port, host)
        values ($1, $2, $3, $4, $5, $6, $7) returning *
      `, [bossAccountId, instanceName || null, cdpEndpoint, userDataDir, downloadDir, debugPort || null, host || 'localhost']);
      res.json({ item: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.patch('/api/admin/browser-instances/:id', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { instanceName, cdpEndpoint, userDataDir, downloadDir, debugPort, host, status } = req.body;
      const result = await pool?.query(`
        update browser_instances
        set instance_name = coalesce($2, instance_name),
            cdp_endpoint = coalesce($3, cdp_endpoint),
            user_data_dir = coalesce($4, user_data_dir),
            download_dir = coalesce($5, download_dir),
            debug_port = coalesce($6, debug_port),
            host = coalesce($7, host),
            status = coalesce($8, status),
            updated_at = now()
        where id = $1 returning *
      `, [req.params.id, instanceName, cdpEndpoint, userDataDir, downloadDir, debugPort, host, status]);
      if (!result.rows[0]) return res.status(404).json({ error: 'not_found' });
      res.json({ item: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.delete('/api/admin/browser-instances/:id', async (req, res, next) => {
    try {
      if (!req.user || !isSystemAdmin(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const hasRuns = await pool?.query(
        'select count(*) from sourcing_runs where browser_instance_id = $1', [req.params.id]
      );
      if (parseInt(hasRuns.rows[0].count) > 0) {
        return res.status(400).json({ error: 'browser_instance_has_runs', message: '该浏览器实例还有关联的执行记录，无法删除' });
      }
      await pool?.query('delete from browser_instances where id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/browser-instances/:id/screenshot', async (req, res, next) => {
    try {
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const bi = await pool?.query('select * from browser_instances where id = $1', [req.params.id]);
      if (!bi.rows[0]) return res.status(404).json({ error: 'not_found' });
      const endpoint = bi.rows[0].cdp_endpoint;
      const { BossCdpClient } = require('./services/boss-cdp-client');
      const client = new BossCdpClient({ endpoint });
      try {
        const includeViewport = req.query.viewport === '1';
        const result = await client.captureAnyScreenshot({ format: 'jpeg', quality: 60, includeViewport });
        const buffer = Buffer.from(result.data, 'base64');
        const headers = {
          'Content-Type': 'image/jpeg',
          'Content-Length': buffer.length,
          'Cache-Control': 'no-store',
          'X-Page-Url': encodeURIComponent(result.url || ''),
          'X-Page-Title': encodeURIComponent(result.title || '')
        };
        if (result.viewport) {
          headers['X-Viewport-Width'] = String(result.viewport.width || 0);
          headers['X-Viewport-Height'] = String(result.viewport.height || 0);
        }
        res.set(headers);
        res.send(buffer);
      } catch (err) {
        res.status(502).json({ error: 'screenshot_failed', message: err.message });
      }
    } catch (error) { next(error); }
  });

  app.post('/api/admin/browser-instances/:id/click', async (req, res, next) => {
    try {
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { x, y } = req.body;
      if (x === undefined || y === undefined) {
        return res.status(400).json({ error: 'missing_coordinates' });
      }
      const bi = await pool?.query('select * from browser_instances where id = $1', [req.params.id]);
      if (!bi.rows[0]) return res.status(404).json({ error: 'not_found' });
      const { BossCdpClient } = require('./services/boss-cdp-client');
      const client = new BossCdpClient({ endpoint: bi.rows[0].cdp_endpoint });
      const result = await client.clickOnAnyPage({ x, y });
      res.json(result);
    } catch (error) { next(error); }
  });

  app.post('/api/admin/browser-instances/:id/check', async (req, res, next) => {
    try {
      if (!req.user || !isAdminRole(req.user)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const bi = await pool?.query('select * from browser_instances where id = $1', [req.params.id]);
      if (!bi.rows[0]) return res.status(404).json({ error: 'not_found' });
      const endpoint = bi.rows[0].cdp_endpoint;
      try {
        const resp = await fetch(`${endpoint}/json/version`);
        const data = await resp.json();
        await pool?.query('update browser_instances set last_seen_at = now(), status = $2 where id = $1', [req.params.id, 'idle']);
        res.json({ ok: true, browser: data.Browser || 'unknown', status: 'online' });
      } catch {
        await pool?.query("update browser_instances set status = 'offline' where id = $1", [req.params.id]);
        res.json({ ok: false, status: 'offline', message: '无法连接到浏览器 CDP: ' + endpoint });
      }
    } catch (error) { next(error); }
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
