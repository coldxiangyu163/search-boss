const test = require('node:test');
const assert = require('node:assert/strict');

const { TaskLock } = require('../src/services/task-lock');

test('TaskLock tryAcquire succeeds when idle', () => {
  const lock = new TaskLock();
  const acquired = lock.tryAcquire({ runId: 1, jobKey: 'j1', taskType: 'source' });

  assert.equal(acquired, true);
  assert.equal(lock.isBusy(), true);

  const holder = lock.getHolder();
  assert.equal(holder.runId, 1);
  assert.equal(holder.jobKey, 'j1');
  assert.equal(holder.taskType, 'source');
  assert.ok(holder.acquiredAt);
});

test('TaskLock tryAcquire fails when already held', () => {
  const lock = new TaskLock();
  lock.tryAcquire({ runId: 1, jobKey: 'j1', taskType: 'source' });

  const acquired = lock.tryAcquire({ runId: 2, jobKey: 'j2', taskType: 'followup' });

  assert.equal(acquired, false);
  assert.equal(lock.getHolder().runId, 1);
});

test('TaskLock release frees lock for the correct holder', () => {
  const lock = new TaskLock();
  lock.tryAcquire({ runId: 1, jobKey: 'j1', taskType: 'source' });

  lock.release(1);

  assert.equal(lock.isBusy(), false);
  assert.equal(lock.getHolder(), null);
});

test('TaskLock release is a no-op for a different runId', () => {
  const lock = new TaskLock();
  lock.tryAcquire({ runId: 1, jobKey: 'j1', taskType: 'source' });

  lock.release(999);

  assert.equal(lock.isBusy(), true);
  assert.equal(lock.getHolder().runId, 1);
});

test('TaskLock release is a no-op when idle', () => {
  const lock = new TaskLock();
  lock.release(1);
  assert.equal(lock.isBusy(), false);
});

test('TaskLock getHolder returns a copy, not the internal reference', () => {
  const lock = new TaskLock();
  lock.tryAcquire({ runId: 1, jobKey: 'j1', taskType: 'source' });

  const holder = lock.getHolder();
  holder.runId = 999;

  assert.equal(lock.getHolder().runId, 1);
});

test('TaskLock acquire-release-acquire cycle works', () => {
  const lock = new TaskLock();
  lock.tryAcquire({ runId: 1, jobKey: 'j1', taskType: 'source' });
  lock.release(1);

  const acquired = lock.tryAcquire({ runId: 2, jobKey: 'j2', taskType: 'followup' });
  assert.equal(acquired, true);
  assert.equal(lock.getHolder().runId, 2);
});

test('TaskLock heartbeat refreshes activity timestamp', () => {
  let now = 1_000;
  const lock = new TaskLock({ staleMs: 500, clock: () => now });
  lock.tryAcquire({ runId: 1, jobKey: 'j1', taskType: 'source' });

  now = 1_400;
  assert.equal(lock.heartbeat(1), true);

  now = 1_800;
  // 400ms since last heartbeat, below 500ms threshold
  assert.deepEqual(lock.reapStale(), []);
  assert.equal(lock.isBusy(), true);
});

test('TaskLock heartbeat returns false for unknown runId', () => {
  const lock = new TaskLock();
  lock.tryAcquire({ runId: 1, jobKey: 'j1', taskType: 'source' });
  assert.equal(lock.heartbeat(999), false);
});

test('TaskLock reapStale removes holders idle beyond TTL', () => {
  let now = 0;
  const lock = new TaskLock({ staleMs: 1_000, clock: () => now });
  lock.tryAcquire({ runId: 7, jobKey: 'j7', taskType: 'source', hrAccountId: 42 });

  now = 1_500;
  const reaped = lock.reapStale();

  assert.equal(reaped.length, 1);
  assert.equal(reaped[0].runId, 7);
  assert.equal(reaped[0].hrAccountId, 42);
  assert.ok(reaped[0].idleMs >= 1_000);
  assert.equal(lock.isBusy(42), false);
});

test('TaskLock reapStale with staleMs=0 is a no-op', () => {
  let now = 0;
  const lock = new TaskLock({ staleMs: 0, clock: () => now });
  lock.tryAcquire({ runId: 1, jobKey: 'j1', taskType: 'source' });

  now = 999_999;
  assert.deepEqual(lock.reapStale(), []);
  assert.equal(lock.isBusy(), true);
});
