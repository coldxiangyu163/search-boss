const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { BossSessionStore } = require('../src/services/boss-session-store');

test('BossSessionStore bindTarget writes a run-scoped session file', async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boss-session-store-'));
  const store = new BossSessionStore({ sessionDir });

  const session = await store.bindTarget('92', {
    targetId: 'TARGET_123',
    tabUrl: 'https://www.zhipin.com/web/chat/recommend?jobid=1',
    jobKey: '健康顾问_B0047007',
    jobId: 'job-1',
    mode: 'source'
  });

  assert.equal(session.runId, '92');
  assert.equal(session.targetId, 'TARGET_123');
  assert.equal(session.epoch, 0);
  assert.equal(session.lastOwner, 'boss-cli');

  const savedContent = JSON.parse(
    await fs.readFile(path.join(sessionDir, 'boss-session-92.json'), 'utf8')
  );

  assert.equal(savedContent.targetId, 'TARGET_123');
});

test('BossSessionStore loadSession returns the saved session state', async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boss-session-store-'));
  const store = new BossSessionStore({ sessionDir });

  await store.saveSession('105', {
    runId: '105',
    targetId: 'TARGET_105',
    tabUrl: 'https://www.zhipin.com/web/chat/index',
    epoch: 3,
    lastOwner: 'chrome-devtools'
  });

  const session = await store.loadSession('105');

  assert.equal(session.targetId, 'TARGET_105');
  assert.equal(session.epoch, 3);
  assert.equal(session.lastOwner, 'chrome-devtools');
});

test('BossSessionStore bumpEpoch increments epoch and updates owner', async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boss-session-store-'));
  const store = new BossSessionStore({ sessionDir });

  await store.bindTarget('41', {
    targetId: 'TARGET_41',
    tabUrl: 'https://www.zhipin.com/web/chat/index',
    mode: 'chat'
  });

  const session = await store.bumpEpoch('41', 'chrome-devtools');

  assert.equal(session.epoch, 1);
  assert.equal(session.lastOwner, 'chrome-devtools');
});

test('BossSessionStore assertEpoch accepts the expected epoch', async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boss-session-store-'));
  const store = new BossSessionStore({ sessionDir });

  await store.saveSession('11', {
    runId: '11',
    targetId: 'TARGET_11',
    epoch: 7,
    lastOwner: 'boss-cli'
  });

  const session = await store.assertEpoch('11', 7);

  assert.equal(session.epoch, 7);
});

test('BossSessionStore assertEpoch rejects a mismatched expected epoch', async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boss-session-store-'));
  const store = new BossSessionStore({ sessionDir });

  await store.saveSession('12', {
    runId: '12',
    targetId: 'TARGET_12',
    epoch: 5,
    lastOwner: 'boss-cli'
  });

  await assert.rejects(
    () => store.assertEpoch('12', 4),
    /boss_session_epoch_mismatch/
  );
});
