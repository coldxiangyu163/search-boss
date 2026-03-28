const test = require('node:test');
const assert = require('node:assert/strict');

const { BossCdpClient, connectWebSocket } = require('../src/services/boss-cdp-client');

test('BossCdpClient listTargets loads targets from the configured CDP endpoint', async () => {
  const calls = [];
  const targets = [
    { id: 'boss-1', type: 'page', url: 'https://www.zhipin.com/web/chat/recommend', title: 'BOSS直聘' }
  ];
  const client = new BossCdpClient({
    endpoint: 'http://127.0.0.1:9333',
    requestImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => targets
      };
    }
  });

  const result = await client.listTargets();

  assert.equal(calls[0], 'http://127.0.0.1:9333/json');
  assert.deepEqual(result, targets);
});

test('BossCdpClient resolveBossTarget prefers an explicit targetId', async () => {
  const client = new BossCdpClient({
    endpoint: 'http://127.0.0.1:9222',
    requestImpl: async () => ({
      ok: true,
      json: async () => ([
        { id: 'boss-1', type: 'page', url: 'https://www.zhipin.com/web/chat/recommend', title: 'BOSS直聘' },
        { id: 'boss-2', type: 'page', url: 'https://www.zhipin.com/web/chat/index', title: 'BOSS直聘' }
      ])
    })
  });

  const target = await client.resolveBossTarget({
    targetId: 'boss-2',
    urlPrefix: 'https://www.zhipin.com/'
  });

  assert.equal(target.id, 'boss-2');
  assert.equal(target.url, 'https://www.zhipin.com/web/chat/index');
});

test('BossCdpClient resolveBossTarget prefers work pages over generic BOSS tabs', async () => {
  const client = new BossCdpClient({
    endpoint: 'http://127.0.0.1:9222',
    requestImpl: async () => ({
      ok: true,
      json: async () => ([
        { id: 'blank', type: 'page', url: 'about:blank', title: 'about:blank' },
        { id: 'tools', type: 'page', url: 'devtools://devtools/bundled/inspector.html', title: 'DevTools' },
        { id: 'other', type: 'page', url: 'https://example.com/', title: 'Example' },
        { id: 'boss-user', type: 'page', url: 'https://www.zhipin.com/web/user/?ka=bticket', title: 'BOSS直聘' },
        { id: 'boss-chat', type: 'page', url: 'https://www.zhipin.com/web/chat/index', title: 'BOSS直聘' },
        { id: 'boss-1', type: 'page', url: 'https://www.zhipin.com/web/chat/recommend?jobid=1', title: 'BOSS直聘' },
        { id: 'boss-2', type: 'worker', url: 'https://www.zhipin.com/web/chat/index', title: 'Worker' }
      ])
    })
  });

  const target = await client.resolveBossTarget({
    urlPrefix: 'https://www.zhipin.com/'
  });

  assert.equal(target.id, 'boss-1');
});

test('BossCdpClient resolveBossTarget falls back to chat workbench before user center tabs', async () => {
  const client = new BossCdpClient({
    endpoint: 'http://127.0.0.1:9222',
    requestImpl: async () => ({
      ok: true,
      json: async () => ([
        { id: 'boss-user', type: 'page', url: 'https://www.zhipin.com/web/user/?ka=bticket', title: 'BOSS直聘' },
        { id: 'boss-chat', type: 'page', url: 'https://www.zhipin.com/web/chat/index', title: 'BOSS直聘' }
      ])
    })
  });

  const target = await client.resolveBossTarget({
    urlPrefix: 'https://www.zhipin.com/'
  });

  assert.equal(target.id, 'boss-chat');
});

test('BossCdpClient resolveBossTarget rejects when no matching BOSS page target exists', async () => {
  const client = new BossCdpClient({
    endpoint: 'http://127.0.0.1:9222',
    requestImpl: async () => ({
      ok: true,
      json: async () => ([
        { id: 'blank', type: 'page', url: 'about:blank', title: 'about:blank' },
        { id: 'tools', type: 'page', url: 'devtools://devtools/bundled/inspector.html', title: 'DevTools' },
        { id: 'other', type: 'page', url: 'https://example.com/', title: 'Example' }
      ])
    })
  });

  await assert.rejects(
    () => client.resolveBossTarget({ urlPrefix: 'https://www.zhipin.com/' }),
    /boss_target_not_found/
  );
});

test('BossCdpClient evaluate sends Runtime.evaluate through the target websocket', async () => {
  const sentMessages = [];
  const client = new BossCdpClient({
    endpoint: 'http://127.0.0.1:9222',
    requestImpl: async () => ({
      ok: true,
      json: async () => ([
        {
          id: 'boss-1',
          type: 'page',
          url: 'https://www.zhipin.com/web/chat/recommend',
          title: 'BOSS直聘',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/boss-1'
        }
      ])
    }),
    connectImpl: async (url) => {
      assert.equal(url, 'ws://127.0.0.1:9222/devtools/page/boss-1');

      return {
        async send(message) {
          sentMessages.push(JSON.parse(message));
        },
        async waitForMessage() {
          return JSON.stringify({
            id: sentMessages[0].id,
            result: {
              result: {
                type: 'string',
                value: 'ok'
              }
            }
          });
        },
        async close() {}
      };
    }
  });

  const result = await client.evaluate({
    targetId: 'boss-1',
    expression: 'document.title'
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].method, 'Runtime.evaluate');
  assert.equal(sentMessages[0].params.expression, 'document.title');
  assert.equal(result.type, 'string');
  assert.equal(result.value, 'ok');
});

test('BossCdpClient evaluate uses small monotonic message ids', async () => {
  const sentMessages = [];
  const client = new BossCdpClient({
    endpoint: 'http://127.0.0.1:9222',
    requestImpl: async () => ({
      ok: true,
      json: async () => ([
        {
          id: 'boss-1',
          type: 'page',
          url: 'https://www.zhipin.com/web/chat/recommend',
          title: 'BOSS直聘',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/boss-1'
        }
      ])
    }),
    connectImpl: async () => ({
      async send(message) {
        sentMessages.push(JSON.parse(message));
      },
      async waitForMessage() {
        const current = sentMessages[sentMessages.length - 1];
        return JSON.stringify({
          id: current.id,
          result: {
            result: {
              type: 'string',
              value: 'ok'
            }
          }
        });
      },
      async close() {}
    })
  });

  await client.evaluate({ targetId: 'boss-1', expression: 'document.title' });
  await client.evaluate({ targetId: 'boss-1', expression: 'document.location.href' });

  assert.equal(sentMessages[0].id, 1);
  assert.equal(sentMessages[1].id, 2);
});

test('BossCdpClient dispatchMouseClick emits moved, pressed, and released events', async () => {
  const sentMessages = [];
  const replies = [];
  const client = new BossCdpClient({
    endpoint: 'http://127.0.0.1:9222',
    requestImpl: async () => ({
      ok: true,
      json: async () => ([
        {
          id: 'boss-1',
          type: 'page',
          url: 'https://www.zhipin.com/web/chat/recommend',
          title: 'BOSS直聘',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/boss-1'
        }
      ])
    }),
    connectImpl: async () => ({
      async send(message) {
        const parsed = JSON.parse(message);
        sentMessages.push(parsed);
        replies.push(JSON.stringify({
          id: parsed.id,
          result: {}
        }));
      },
      async waitForMessage() {
        return replies.shift();
      },
      async close() {}
    })
  });

  await client.dispatchMouseClick({
    targetId: 'boss-1',
    x: 100,
    y: 200
  });

  assert.equal(sentMessages.length, 3);
  assert.equal(sentMessages[0].method, 'Input.dispatchMouseEvent');
  assert.equal(sentMessages[0].params.type, 'mouseMoved');
  assert.equal(sentMessages[1].params.type, 'mousePressed');
  assert.equal(sentMessages[2].params.type, 'mouseReleased');
  assert.equal(sentMessages[2].params.x, 100);
  assert.equal(sentMessages[2].params.y, 200);
});

test('connectWebSocket queues messages that arrive before waitForMessage is called', async () => {
  const originalWebSocket = global.WebSocket;

  class FakeWebSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;

      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatchEvent(new Event('open'));
        this.#dispatchMessage('{"id":999,"method":"Runtime.executionContextCreated"}');
        this.#dispatchMessage('{"id":1,"result":{"result":{"type":"string","value":"ok"}}}');
      });
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatchEvent(new Event('close'));
    }

    #dispatchMessage(data) {
      const event = new Event('message');
      Object.defineProperty(event, 'data', { value: data });
      this.dispatchEvent(event);
    }
  }

  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2;
  FakeWebSocket.CLOSED = 3;

  global.WebSocket = FakeWebSocket;

  try {
    const connection = await connectWebSocket('ws://127.0.0.1:9222/devtools/page/boss-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const first = await connection.waitForMessage();
    const second = await connection.waitForMessage();

    assert.equal(first, '{"id":999,"method":"Runtime.executionContextCreated"}');
    assert.equal(second, '{"id":1,"result":{"result":{"type":"string","value":"ok"}}}');
  } finally {
    global.WebSocket = originalWebSocket;
  }
});
