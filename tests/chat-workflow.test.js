const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureChatShellReady,
  ensureUnreadFilterReady,
  readChatThreads,
  readCurrentThreadMessages
} = require('../src/services/boss-workflows/chat-workflow');

test('ensureChatShellReady accepts chat index shell anchors', () => {
  const result = ensureChatShellReady({
    currentUrl: 'https://www.zhipin.com/web/chat/index',
    snapshotText: '沟通 全部职位 未读'
  });

  assert.equal(result.ok, true);
});

test('ensureUnreadFilterReady requires unread filter anchors', () => {
  assert.throws(
    () => ensureUnreadFilterReady({ snapshotText: '沟通 全部职位' }),
    /chat_unread_filter_not_ready/
  );

  const result = ensureUnreadFilterReady({
    snapshotText: '沟通 全部职位 全部 未读'
  });

  assert.equal(result.ok, true);
});

test('readChatThreads filters unread rows when requested', () => {
  const threads = readChatThreads({
    unreadOnly: true,
    threads: [
      { name: '张三', lastMessage: '你好', unreadCount: 1, encryptUid: 'enc-1' },
      { name: '李四', lastMessage: '收到', unreadCount: 0, encryptUid: 'enc-2' }
    ]
  });

  assert.equal(threads.length, 1);
  assert.equal(threads[0].name, '张三');
});

test('readCurrentThreadMessages normalizes message direction by uid', () => {
  const messages = readCurrentThreadMessages({
    uid: 1001,
    messages: [
      { type: 1, text: '你好', time: '10:00', from: { uid: 1001, name: '张三' } },
      { type: 1, text: '你好呀', time: '10:01', from: { uid: 9999, name: '我' } }
    ]
  });

  assert.equal(messages[0].from, '张三');
  assert.equal(messages[1].from, 'me');
  assert.equal(messages[0].type, 'text');
});
