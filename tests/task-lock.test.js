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
