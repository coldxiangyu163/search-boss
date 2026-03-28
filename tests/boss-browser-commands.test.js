const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getUrl,
  evaluateJson,
  bossFetch
} = require('../src/services/boss-browser-commands');

test('getUrl reads the current URL from the bound target', async () => {
  const calls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      calls.push(payload);
      return {
        type: 'string',
        value: 'https://www.zhipin.com/web/chat/recommend?jobid=1'
      };
    }
  };

  const url = await getUrl({ cdpClient, targetId: 'target-1' });

  assert.equal(url, 'https://www.zhipin.com/web/chat/recommend?jobid=1');
  assert.equal(calls[0].targetId, 'target-1');
  assert.match(calls[0].expression, /window\.location\.href/);
});

test('evaluateJson parses JSON returned from Runtime.evaluate', async () => {
  const cdpClient = {
    evaluate: async () => ({
      type: 'string',
      value: '{"ok":true,"count":2}'
    })
  };

  const result = await evaluateJson({
    cdpClient,
    targetId: 'target-1',
    expression: 'JSON.stringify({ ok: true, count: 2 })'
  });

  assert.deepEqual(result, { ok: true, count: 2 });
});

test('bossFetch returns the structured browser payload on success', async () => {
  const calls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      calls.push(payload);
      return {
        type: 'string',
        value: JSON.stringify({
          ok: true,
          status: 200,
          data: {
            code: 0,
            zpData: {
              list: [{ geekId: 'g-1' }]
            }
          }
        })
      };
    }
  };

  const result = await bossFetch({
    cdpClient,
    targetId: 'target-1',
    url: 'https://www.zhipin.com/wapi/zpgeek/search/geeks.json',
    method: 'POST',
    body: { page: 1 },
    timeoutMs: 2000
  });

  assert.equal(result.code, 0);
  assert.equal(result.zpData.list[0].geekId, 'g-1');
  assert.equal(calls[0].targetId, 'target-1');
  assert.match(calls[0].expression, /credentials:\s*'include'/);
  assert.match(calls[0].expression, /AbortController/);
});

test('bossFetch normalizes auth expired errors', async () => {
  const cdpClient = {
    evaluate: async () => ({
      type: 'string',
      value: JSON.stringify({
        ok: false,
        error: 'AUTH_EXPIRED'
      })
    })
  };

  await assert.rejects(
    () => bossFetch({
      cdpClient,
      targetId: 'target-1',
      url: 'https://www.zhipin.com/wapi/zpchat/friend/getList.json'
    }),
    /boss_api_auth_expired/
  );
});

test('bossFetch normalizes auth expired responses returned by fetch', async () => {
  const cdpClient = {
    evaluate: async () => ({
      type: 'string',
      value: JSON.stringify({
        ok: false,
        status: 401,
        data: {
          code: 401,
          message: '登录失效，请重新登录'
        }
      })
    })
  };

  await assert.rejects(
    () => bossFetch({
      cdpClient,
      targetId: 'target-1',
      url: 'https://www.zhipin.com/wapi/zpchat/friend/getList.json'
    }),
    /boss_api_auth_expired/
  );
});

test('bossFetch normalizes timeout errors', async () => {
  const cdpClient = {
    evaluate: async () => ({
      type: 'string',
      value: JSON.stringify({
        ok: false,
        error: 'TIMEOUT'
      })
    })
  };

  await assert.rejects(
    () => bossFetch({
      cdpClient,
      targetId: 'target-1',
      url: 'https://www.zhipin.com/wapi/zpchat/friend/getList.json'
    }),
    /boss_api_timeout/
  );
});
