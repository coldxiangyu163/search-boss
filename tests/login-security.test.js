const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');
const { AuthService } = require('../src/services/auth-service');
const { createLoginAttemptTracker } = require('../src/services/login-attempt-tracker');
const { createLoginRateLimit } = require('../src/middleware/login-rate-limit');
const { randomCaptchaCode, renderCaptchaSvg, normalizeCaptchaInput } = require('../src/services/captcha');

function createMockPool(users = []) {
  return {
    query(sql, params) {
      if (sql.includes('from users u') && sql.includes('where u.email')) {
        const email = params[0];
        const user = users.find((u) => u.email === email);
        return { rows: user ? [user] : [] };
      }
      if (sql.includes('from users u') && sql.includes('where u.id')) {
        const id = params[0];
        const user = users.find((u) => u.id === id);
        return { rows: user ? [user] : [] };
      }
      return { rows: [] };
    }
  };
}

test('captcha helper generates non-empty SVG with exact code length', () => {
  const code = randomCaptchaCode(4);
  assert.equal(code.length, 4);
  const svg = renderCaptchaSvg(code);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('</svg>'));
  assert.equal(normalizeCaptchaInput(' ' + code.toLowerCase() + ' '), code);
});

test('loginAttemptTracker locks account after maxAttempts failures', () => {
  const tracker = createLoginAttemptTracker({ maxAttempts: 3, lockoutMs: 60_000 });
  assert.equal(tracker.getStatus('a@b.com').locked, false);
  tracker.recordFailure('a@b.com');
  tracker.recordFailure('a@b.com');
  const afterThird = tracker.recordFailure('a@b.com');
  assert.equal(afterThird.locked, true);
  assert.equal(tracker.getStatus('a@b.com').locked, true);
  tracker.recordSuccess('a@b.com');
  assert.equal(tracker.getStatus('a@b.com').locked, false);
});

test('loginRateLimit blocks after max attempts per IP', async () => {
  const middleware = createLoginRateLimit({ windowMs: 60_000, max: 3 });
  let allowed = 0;
  let blocked = 0;
  const req = { ip: '1.2.3.4', headers: {}, connection: {}, socket: {} };
  const makeRes = () => ({
    status(code) { this.code = code; return this; },
    json() { blocked += 1; },
    set() { return this; }
  });
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => {
      const res = makeRes();
      middleware(req, res, () => { allowed += 1; resolve(); });
      if (res.code === 429) resolve();
    });
  }
  assert.equal(allowed, 3);
  assert.equal(blocked, 2);
});

test('POST /api/auth/login signals needCaptcha after repeated failures', async () => {
  const passwordHash = await bcrypt.hash('correct', 10);
  const users = [{
    id: 1, name: 'U', email: 'u@test.com',
    password_hash: passwordHash, role: 'hr', status: 'active',
    department_id: 1, hr_account_id: 1
  }];
  const pool = createMockPool(users);
  const tracker = createLoginAttemptTracker({ maxAttempts: 10, lockoutMs: 60_000 });
  const app = createApp({
    services: { auth: new AuthService({ pool }), dashboard: { async getSummary() { return {}; } } },
    config: { loginSecurity: { tracker, captchaFailThreshold: 2, ipMax: 100 } }
  });

  const first = await request(app).post('/api/auth/login').send({ email: 'u@test.com', password: 'bad' });
  assert.equal(first.status, 401);
  assert.equal(first.body.error, 'invalid_credentials');
  assert.equal(first.body.needCaptcha, false);

  const second = await request(app).post('/api/auth/login').send({ email: 'u@test.com', password: 'bad' });
  assert.equal(second.status, 401);
  assert.equal(second.body.needCaptcha, true);

  const third = await request(app).post('/api/auth/login').send({ email: 'u@test.com', password: 'bad' });
  assert.equal(third.body.error, 'invalid_captcha');
  assert.equal(third.body.needCaptcha, true);
});

test('POST /api/auth/login returns 423 account_locked after threshold', async () => {
  const passwordHash = await bcrypt.hash('correct', 10);
  const users = [{
    id: 1, name: 'U', email: 'lockme@test.com',
    password_hash: passwordHash, role: 'hr', status: 'active',
    department_id: 1, hr_account_id: 1
  }];
  const pool = createMockPool(users);
  const tracker = createLoginAttemptTracker({ maxAttempts: 3, lockoutMs: 60_000 });
  tracker.recordFailure('lockme@test.com');
  tracker.recordFailure('lockme@test.com');
  const app = createApp({
    services: { auth: new AuthService({ pool }), dashboard: { async getSummary() { return {}; } } },
    config: { loginSecurity: { tracker, captchaFailThreshold: 0, ipMax: 100 } }
  });

  const resp = await request(app).post('/api/auth/login').send({ email: 'lockme@test.com', password: 'bad' });
  assert.equal(resp.status, 423);
  assert.equal(resp.body.error, 'account_locked');

  const resp2 = await request(app).post('/api/auth/login').send({ email: 'lockme@test.com', password: 'correct' });
  assert.equal(resp2.status, 423);
  assert.equal(resp2.body.error, 'account_locked');
});

test('POST /api/auth/login returns 429 when IP rate limited', async () => {
  const pool = createMockPool([]);
  const app = createApp({
    services: { auth: new AuthService({ pool }), dashboard: { async getSummary() { return {}; } } },
    config: { loginSecurity: { ipMax: 2, captchaFailThreshold: 0 } }
  });

  const a = await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'x' });
  assert.equal(a.status, 401);
  const b = await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'x' });
  assert.equal(b.status, 401);
  const c = await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'x' });
  assert.equal(c.status, 429);
  assert.equal(c.body.error, 'too_many_attempts');
});

test('GET /api/auth/captcha returns an SVG image', async () => {
  const app = createApp({
    services: { auth: new AuthService({ pool: createMockPool([]) }), dashboard: { async getSummary() { return {}; } } }
  });
  const resp = await request(app).get('/api/auth/captcha').buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
  });
  assert.equal(resp.status, 200);
  assert.match(resp.headers['content-type'], /image\/svg\+xml/);
  assert.ok(String(resp.body).startsWith('<svg'));
});

test('GET /api/auth/login-status reports needCaptcha based on account attempts', async () => {
  const tracker = createLoginAttemptTracker({ maxAttempts: 10, lockoutMs: 60_000 });
  tracker.recordFailure('probe@test.com');
  tracker.recordFailure('probe@test.com');
  const app = createApp({
    services: { auth: new AuthService({ pool: createMockPool([]) }), dashboard: { async getSummary() { return {}; } } },
    config: { loginSecurity: { tracker, captchaFailThreshold: 2 } }
  });

  const resp = await request(app).get('/api/auth/login-status?email=probe@test.com');
  assert.equal(resp.status, 200);
  assert.equal(resp.body.needCaptcha, true);

  const resp2 = await request(app).get('/api/auth/login-status?email=fresh@test.com');
  assert.equal(resp2.body.needCaptcha, false);
});
