const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SNAP_TO_BOTTOM_THRESHOLD,
  captureSyncLogScrollSnapshot,
  resolveSyncLogScrollTop
} = require('../public/sync-log-scroll');

test('captureSyncLogScrollSnapshot marks list near bottom as pinned', () => {
  const snapshot = captureSyncLogScrollSnapshot({
    scrollTop: 620,
    clientHeight: 280,
    scrollHeight: 920
  });

  assert.equal(snapshot.pinnedToBottom, true);
  assert.equal(snapshot.scrollTop, 620);
  assert.equal(snapshot.clientHeight, 280);
  assert.equal(snapshot.scrollHeight, 920);
});

test('captureSyncLogScrollSnapshot preserves off-bottom position', () => {
  const snapshot = captureSyncLogScrollSnapshot({
    scrollTop: 120,
    clientHeight: 280,
    scrollHeight: 920
  });

  assert.equal(snapshot.pinnedToBottom, false);
  assert.equal(snapshot.distanceFromBottom, 520);
});

test('resolveSyncLogScrollTop snaps to latest log when previously pinned', () => {
  const scrollTop = resolveSyncLogScrollTop({
    previousSnapshot: {
      pinnedToBottom: true,
      scrollTop: 620,
      clientHeight: 280,
      scrollHeight: 920
    },
    nextClientHeight: 280,
    nextScrollHeight: 1160
  });

  assert.equal(scrollTop, 880);
});

test('resolveSyncLogScrollTop keeps relative viewport when user is reading history', () => {
  const scrollTop = resolveSyncLogScrollTop({
    previousSnapshot: {
      pinnedToBottom: false,
      scrollTop: 120,
      clientHeight: 280,
      scrollHeight: 920
    },
    nextClientHeight: 280,
    nextScrollHeight: 1160
  });

  assert.equal(scrollTop, 360);
});

test('resolveSyncLogScrollTop falls back to bottom for first render', () => {
  const scrollTop = resolveSyncLogScrollTop({
    previousSnapshot: null,
    nextClientHeight: 280,
    nextScrollHeight: 920
  });

  assert.equal(scrollTop, 640);
});

test('SNAP_TO_BOTTOM_THRESHOLD leaves a small tolerance for floating point noise', () => {
  const snapshot = captureSyncLogScrollSnapshot({
    scrollTop: 920 - 280 - SNAP_TO_BOTTOM_THRESHOLD + 1,
    clientHeight: 280,
    scrollHeight: 920
  });

  assert.equal(snapshot.pinnedToBottom, true);
});
