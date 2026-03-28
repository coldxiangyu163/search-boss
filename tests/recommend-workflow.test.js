const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureRecommendShellReady,
  ensureRecommendIframeReady,
  readRecommendCards
} = require('../src/services/boss-workflows/recommend-workflow');

test('ensureRecommendShellReady accepts recommend shell url and anchors', () => {
  const result = ensureRecommendShellReady({
    currentUrl: 'https://www.zhipin.com/web/chat/recommend?jobid=enc-job-1',
    snapshotText: 'BOSS直聘 推荐牛人 职位管理'
  });

  assert.equal(result.ok, true);
});

test('ensureRecommendIframeReady requires iframe business anchors', () => {
  assert.throws(
    () => ensureRecommendIframeReady({ snapshotText: 'BOSS直聘 推荐牛人 职位管理' }),
    /recommend_iframe_not_ready/
  );

  const result = ensureRecommendIframeReady({
    snapshotText: '推荐 最新 筛选 重庆 打招呼'
  });

  assert.equal(result.ok, true);
});

test('readRecommendCards normalizes cards and filters by job id', () => {
  const cards = readRecommendCards({
    jobId: 'enc-job-1',
    limit: 1,
    cards: [
      {
        name: '张三',
        jobName: '健康顾问',
        labels: ['活跃', '本科'],
        encryptUid: 'enc-uid-1',
        encryptJobId: 'enc-job-1'
      },
      {
        name: '李四',
        jobName: '销售',
        labels: ['专科'],
        encryptUid: 'enc-uid-2',
        encryptJobId: 'enc-job-2'
      }
    ]
  });

  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, '张三');
  assert.equal(cards[0].labels, '活跃, 本科');
});
