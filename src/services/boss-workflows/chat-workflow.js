function ensureChatShellReady({ currentUrl = '', snapshotText = '' } = {}) {
  if (!String(currentUrl).includes('/web/chat/index')) {
    throw new Error('chat_shell_not_ready');
  }

  const text = String(snapshotText);
  if (!text.includes('沟通') || !text.includes('全部职位')) {
    throw new Error('chat_shell_not_ready');
  }

  return { ok: true };
}

function ensureUnreadFilterReady({ snapshotText = '' } = {}) {
  const text = String(snapshotText);

  if (!text.includes('全部职位') || !text.includes('未读')) {
    throw new Error('chat_unread_filter_not_ready');
  }

  return { ok: true };
}

function readChatThreads({ threads = [], unreadOnly = false } = {}) {
  const normalized = Array.isArray(threads)
    ? threads.map((thread) => ({
      name: thread.name || '',
      lastMessage: thread.lastMessage || '',
      unreadCount: Number(thread.unreadCount || 0),
      encryptUid: thread.encryptUid || ''
    }))
    : [];

  return unreadOnly
    ? normalized.filter((thread) => thread.unreadCount > 0)
    : normalized;
}

function readCurrentThreadMessages({ messages = [], uid } = {}) {
  const typeMap = new Map([
    [1, 'text'],
    [2, 'image'],
    [3, 'greeting'],
    [4, 'resume'],
    [5, 'system']
  ]);

  return Array.isArray(messages)
    ? messages.map((message) => ({
      from: message?.from?.uid === uid
        ? (message?.from?.name || '')
        : 'me',
      type: typeMap.get(message.type) || `other:${message.type}`,
      text: message.text || message.body?.text || '',
      time: message.time || ''
    }))
    : [];
}

module.exports = {
  ensureChatShellReady,
  ensureUnreadFilterReady,
  readChatThreads,
  readCurrentThreadMessages
};
