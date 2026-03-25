const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatJobStatus,
  getJobStatusBadgeClass,
  isJobActionEnabled
} = require('../public/job-ui-helpers');

test('job UI helpers mark recruiting jobs as enabled with success badge', () => {
  assert.equal(formatJobStatus('open'), '招聘中');
  assert.equal(formatJobStatus('active'), '招聘中');
  assert.equal(getJobStatusBadgeClass('open'), 'badge badge-success');
  assert.equal(isJobActionEnabled('open'), true);
  assert.equal(isJobActionEnabled('active'), true);
});

test('job UI helpers disable actions for non-recruiting jobs', () => {
  assert.equal(formatJobStatus('closed'), '已关闭');
  assert.equal(formatJobStatus('paused'), '已暂停');
  assert.equal(formatJobStatus('offline'), '已下线');
  assert.equal(getJobStatusBadgeClass('closed'), 'badge badge-neutral');
  assert.equal(getJobStatusBadgeClass('paused'), 'badge badge-warning');
  assert.equal(isJobActionEnabled('closed'), false);
  assert.equal(isJobActionEnabled('paused'), false);
  assert.equal(isJobActionEnabled('offline'), false);
});
