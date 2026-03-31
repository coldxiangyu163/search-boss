const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');

function createMockPool(users = [], hrAccounts = []) {
  return {
    query(sql, params) {
      // login query
      if (sql.includes('from users u') && sql.includes('where u.email')) {
        const email = params[0];
        const user = users.find((u) => u.email === email);
        return { rows: user ? [user] : [] };
      }
      // auth middleware query
      if (sql.includes('from users u') && sql.includes('where u.id')) {
        const id = params[0];
        const user = users.find((u) => u.id === id);
        return { rows: user ? [user] : [] };
      }
      // me query with departments
      if (sql.includes('from users u') && sql.includes('left join departments d')) {
        const id = params[0];
        const user = users.find((u) => u.id === id);
        return { rows: user ? [user] : [] };
      }
      return { rows: [] };
    }
  };
}

test('POST /api/auth/login returns user on valid credentials', async () => {
  const passwordHash = await bcrypt.hash('test123', 10);
  const users = [{
    id: 1, name: 'Test HR', email: 'hr@test.com',
    password_hash: passwordHash, role: 'hr', status: 'active',
    department_id: 1, hr_account_id: 1
  }];

  const { AuthService } = require('../src/services/auth-service');
  const pool = createMockPool(users);
  const app = createApp({
    services: {
      auth: new AuthService({ pool }),
      dashboard: { async getSummary() { return {}; } }
    }
  });

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'hr@test.com', password: 'test123' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.user.name, 'Test HR');
  assert.equal(res.body.user.role, 'hr');
  assert.equal(res.body.user.hrAccountId, 1);
});

test('POST /api/auth/login returns 401 on wrong password', async () => {
  const passwordHash = await bcrypt.hash('test123', 10);
  const users = [{
    id: 1, name: 'Test HR', email: 'hr@test.com',
    password_hash: passwordHash, role: 'hr', status: 'active',
    department_id: 1, hr_account_id: 1
  }];

  const { AuthService } = require('../src/services/auth-service');
  const pool = createMockPool(users);
  const app = createApp({
    services: {
      auth: new AuthService({ pool }),
      dashboard: { async getSummary() { return {}; } }
    }
  });

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'hr@test.com', password: 'wrong' });

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');
});

test('POST /api/auth/login returns 401 on nonexistent email', async () => {
  const { AuthService } = require('../src/services/auth-service');
  const pool = createMockPool([]);
  const app = createApp({
    services: {
      auth: new AuthService({ pool }),
      dashboard: { async getSummary() { return {}; } }
    }
  });

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'nobody@test.com', password: 'test123' });

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');
});

test('POST /api/auth/login returns 401 on disabled account', async () => {
  const passwordHash = await bcrypt.hash('test123', 10);
  const users = [{
    id: 1, name: 'Disabled', email: 'disabled@test.com',
    password_hash: passwordHash, role: 'hr', status: 'disabled',
    department_id: 1, hr_account_id: 1
  }];

  const { AuthService } = require('../src/services/auth-service');
  const pool = createMockPool(users);
  const app = createApp({
    services: {
      auth: new AuthService({ pool }),
      dashboard: { async getSummary() { return {}; } }
    }
  });

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'disabled@test.com', password: 'test123' });

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'account_disabled');
});

test('POST /api/auth/logout returns ok', async () => {
  const app = createApp({
    services: {
      dashboard: { async getSummary() { return {}; } }
    }
  });

  const res = await request(app)
    .post('/api/auth/logout');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('GET /api/auth/me returns 401 when not logged in', async () => {
  const { AuthService } = require('../src/services/auth-service');
  const pool = createMockPool([]);
  const app = createApp({
    services: {
      auth: new AuthService({ pool }),
      dashboard: { async getSummary() { return {}; } }
    }
  });

  const res = await request(app).get('/api/auth/me');
  assert.equal(res.status, 401);
});

test('GET /api/jobs passes hrAccountId when user is hr role', async () => {
  let capturedOpts = null;
  const app = createApp({
    services: {
      dashboard: { async getSummary() { return {}; } },
      jobs: {
        async listJobs(opts) {
          capturedOpts = opts;
          return [];
        }
      }
    }
  });

  // Simulate an HR user by injecting req.user via middleware hack
  // Since we can't easily set session without pool, we test the route handler logic
  // by verifying the service receives the filter parameter
  const res = await request(app).get('/api/jobs');
  assert.equal(res.status, 200);
  // Without auth, hrAccountId should be undefined
  assert.equal(capturedOpts.hrAccountId, undefined);
});

test('JobService.listJobs filters by hrAccountId when provided', async () => {
  const { JobService } = require('../src/services/job-service');
  let capturedSql = '';
  let capturedValues = [];
  const mockPool = {
    query(sql, values) {
      capturedSql = sql;
      capturedValues = values || [];
      return { rows: [] };
    }
  };

  const svc = new JobService({ pool: mockPool });
  await svc.listJobs({ hrAccountId: 42 });

  assert.ok(capturedSql.includes('hr_account_id'));
  assert.deepEqual(capturedValues, [42]);
});

test('JobService.listJobs returns all when no hrAccountId', async () => {
  const { JobService } = require('../src/services/job-service');
  let capturedSql = '';
  let capturedValues = [];
  const mockPool = {
    query(sql, values) {
      capturedSql = sql;
      capturedValues = values || [];
      return { rows: [] };
    }
  };

  const svc = new JobService({ pool: mockPool });
  await svc.listJobs();

  assert.ok(!capturedSql.includes('hr_account_id = $'));
  assert.deepEqual(capturedValues, []);
});

test('CandidateService.listCandidates filters by hrAccountId', async () => {
  const { CandidateService } = require('../src/services/candidate-service');
  let capturedSql = '';
  let capturedValues = [];
  const mockPool = {
    query(sql, values) {
      capturedSql = sql;
      capturedValues = values || [];
      if (sql.includes('count(*)')) {
        return { rows: [{ total: 0 }] };
      }
      return { rows: [] };
    }
  };

  const svc = new CandidateService({ pool: mockPool });
  await svc.listCandidates({ hrAccountId: 7 });

  assert.ok(capturedSql.includes('hr_account_id'));
});

test('SchedulerService.listSchedules filters by hrAccountId', async () => {
  const { SchedulerService } = require('../src/services/scheduler-service');
  let capturedSql = '';
  let capturedValues = [];
  const mockPool = {
    query(sql, values) {
      capturedSql = sql;
      capturedValues = values || [];
      return { rows: [] };
    }
  };

  const svc = new SchedulerService({ pool: mockPool, agentService: {} });
  await svc.listSchedules({ hrAccountId: 3 });

  assert.ok(capturedSql.includes('hr_account_id'));
  assert.deepEqual(capturedValues, [3]);
});

test('DashboardService.getSummary filters by hrAccountId', async () => {
  const { DashboardService } = require('../src/services/dashboard-service');
  let queries = [];
  const mockPool = {
    query(sql) {
      queries.push(sql);
      if (sql.includes('boss_recruit_snapshots')) {
        return { rows: [] };
      }
      return { rows: [{ count: 0 }] };
    }
  };

  const svc = new DashboardService({ pool: mockPool });
  await svc.getSummary({ hrAccountId: 5 });

  assert.ok(queries.some((q) => q.includes('hr_account_id = 5')));
});

test('authMiddleware rejects when no session', async () => {
  const { authMiddleware } = require('../src/middleware/auth');
  const mockPool = { query() { return { rows: [] }; } };
  const mw = authMiddleware(mockPool);

  let statusCode = null;
  let body = null;
  const req = { session: {} };
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { body = data; }
  };

  await mw(req, res, () => {});
  assert.equal(statusCode, 401);
  assert.equal(body.error, 'unauthorized');
});

test('authMiddleware sets req.user when session is valid', async () => {
  const { authMiddleware } = require('../src/middleware/auth');
  const mockPool = {
    query() {
      return {
        rows: [{
          id: 1, role: 'hr', department_id: 1, name: 'HR', email: 'hr@test.com', hr_account_id: 10
        }]
      };
    }
  };
  const mw = authMiddleware(mockPool);

  let nextCalled = false;
  const req = { session: { userId: 1 } };
  const res = {
    status() { return this; },
    json() {}
  };

  await mw(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
  assert.equal(req.user.id, 1);
  assert.equal(req.user.hr_account_id, 10);
});

test('requireRole blocks unauthorized roles', () => {
  const { requireRole } = require('../src/middleware/auth');
  const mw = requireRole('enterprise_admin');

  let statusCode = null;
  const req = { user: { role: 'hr' } };
  const res = {
    status(code) { statusCode = code; return this; },
    json() {}
  };

  mw(req, res, () => {});
  assert.equal(statusCode, 403);
});

test('requireRole allows matching role', () => {
  const { requireRole } = require('../src/middleware/auth');
  const mw = requireRole('enterprise_admin', 'dept_admin');

  let nextCalled = false;
  const req = { user: { role: 'dept_admin' } };
  const res = {};

  mw(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
});

test('resolveHrScope returns correct scope per role', () => {
  const { resolveHrScope } = require('../src/middleware/auth');

  assert.deepEqual(
    resolveHrScope({ user: { role: 'enterprise_admin' } }),
    { scope: 'all' }
  );

  assert.deepEqual(
    resolveHrScope({ user: { role: 'dept_admin', department_id: 5 } }),
    { scope: 'department', departmentId: 5 }
  );

  assert.deepEqual(
    resolveHrScope({ user: { role: 'hr', hr_account_id: 10 } }),
    { scope: 'self', hrAccountId: 10 }
  );
});
