const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getUrl,
  evaluateJson,
  bossFetch,
  clickRecommendPager,
  inspectRecommendState,
  inspectRecommendDetail,
  openChatThread,
  inspectChatThreadState,
  inspectAttachmentState,
  inspectResumePreviewMeta
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

test('clickRecommendPager dispatches a real mouse click at the detected pager center', async () => {
  const cdpCalls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      cdpCalls.push(payload);
      return {
        type: 'string',
        value: JSON.stringify({
          ok: true,
          x: 321.5,
          y: 456.25
        })
      };
    },
    dispatchMouseClick: async (payload) => {
      cdpCalls.push({ dispatch: payload });
    }
  };

  const result = await clickRecommendPager({
    cdpClient,
    targetId: 'target-1',
    direction: 'next'
  });

  assert.equal(result.ok, true);
  assert.equal(result.direction, 'next');
  assert.equal(cdpCalls[0].targetId, 'target-1');
  assert.match(cdpCalls[0].expression, /turn-btn\.next/);
  assert.deepEqual(cdpCalls[1], {
    dispatch: {
      targetId: 'target-1',
      urlPrefix: undefined,
      x: 321.5,
      y: 456.25
    }
  });
});

test('clickRecommendPager fails when the pager is not actionable', async () => {
  const cdpClient = {
    evaluate: async () => ({
      type: 'string',
      value: JSON.stringify({
        ok: false,
        reason: 'boss_recommend_pager_not_visible'
      })
    }),
    dispatchMouseClick: async () => {
      throw new Error('should not dispatch');
    }
  };

  await assert.rejects(
    () => clickRecommendPager({
      cdpClient,
      targetId: 'target-1',
      direction: 'next'
    }),
    /boss_recommend_pager_not_visible/
  );
});

test('inspectRecommendState returns detail and similar-candidate signals from recommend frame', async () => {
  const cdpCalls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      cdpCalls.push(payload);
      return {
        type: 'string',
        value: JSON.stringify({
          ok: true,
          detailOpen: true,
          nextVisible: true,
          prevVisible: true,
          similarCandidatesVisible: true,
          currentActionText: '继续沟通'
        })
      };
    }
  };

  const result = await inspectRecommendState({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.detailOpen, true);
  assert.equal(result.nextVisible, true);
  assert.equal(result.similarCandidatesVisible, true);
  assert.equal(result.currentActionText, '继续沟通');
  assert.equal(cdpCalls[0].targetId, 'target-1');
  assert.match(cdpCalls[0].expression, /resume-detail-wrap/);
  assert.match(cdpCalls[0].expression, /turn-btn\.next/);
});

test('inspectRecommendDetail returns current detail summary from nested resume iframe', async () => {
  const cdpCalls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      cdpCalls.push(payload);
      return {
        type: 'string',
        value: JSON.stringify({
          ok: true,
          bossEncryptGeekId: '85ba23b5c93cef231nZ609q8GVdX',
          name: '王庭',
          currentActionText: '继续沟通',
          hasExperienceSection: true,
          hasEducationSection: true,
          detailText: '王庭 31岁 9年 本科 美睿医疗 营养师/健康管理师 四川旅游学院 食品质量与安全'
        })
      };
    }
  };

  const result = await inspectRecommendDetail({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.bossEncryptGeekId, '85ba23b5c93cef231nZ609q8GVdX');
  assert.equal(result.name, '王庭');
  assert.equal(result.currentActionText, '继续沟通');
  assert.equal(result.hasExperienceSection, true);
  assert.equal(result.hasEducationSection, true);
  assert.match(cdpCalls[0].expression, /c-resume/);
  assert.match(cdpCalls[0].expression, /encrypt-geek-id/);
  assert.match(cdpCalls[0].expression, /btn-continue|font-hightlight/);
});

test('inspectRecommendDetail fails when the detail iframe payload is structurally empty', async () => {
  const cdpClient = {
    evaluate: async () => ({
      type: 'string',
      value: JSON.stringify({
        ok: true,
        name: null,
        currentActionText: null,
        hasExperienceSection: false,
        hasEducationSection: false,
        detailText: ''
      })
    })
  };

  await assert.rejects(
    () => inspectRecommendDetail({
      cdpClient,
      targetId: 'target-1'
    }),
    /boss_recommend_detail_empty/
  );
});

test('openChatThread uses a stable chat row selector instead of generic data-uid nodes', async () => {
  const calls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      calls.push(payload);
      return {
        type: 'string',
        value: JSON.stringify({ ok: true, uid: 'enc-uid-1', opened: true })
      };
    }
  };

  const result = await openChatThread({
    cdpClient,
    targetId: 'target-1',
    uid: 'enc-uid-1'
  });

  assert.equal(result.opened, true);
  assert.match(calls[0].expression, /\.geek-item/);
  assert.doesNotMatch(calls[0].expression, /document\\.querySelectorAll\\('\\[data-uid\\], \\[data-encrypt-uid\\]'\\)/);
});

test('inspectChatThreadState reads active thread state from chat shell anchors', async () => {
  const calls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      calls.push(payload);
      return {
        type: 'string',
        value: JSON.stringify({
          ok: true,
          threadOpen: true,
          activeUid: 'enc-uid-2',
          attachmentPresent: false
        })
      };
    }
  };

  const result = await inspectChatThreadState({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.threadOpen, true);
  assert.equal(result.activeUid, 'enc-uid-2');
  assert.match(calls[0].expression, /\.geek-item\.selected/);
  assert.match(calls[0].expression, /chat-conversation|conversation-box/);
});

test('inspectAttachmentState scopes attachment detection to the active right pane', async () => {
  const calls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      calls.push(payload);
      return {
        type: 'string',
        value: JSON.stringify({
          ok: true,
          present: true,
          buttonEnabled: true,
          fileName: '曾艳简历.pdf'
        })
      };
    }
  };

  const result = await inspectAttachmentState({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.present, true);
  assert.equal(result.fileName, '曾艳简历.pdf');
  assert.match(calls[0].expression, /chat-conversation|conversation-box/);
  assert.match(calls[0].expression, /threadPane\.querySelectorAll/);
});

test('inspectResumePreviewMeta returns preview identifiers from live runtime state', async () => {
  const calls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      calls.push(payload);
      return {
        type: 'string',
        value: JSON.stringify({
          ok: true,
          canPreview: true,
          encryptGeekId: 'geek-1',
          encryptResumeId: 'resume-1',
          encryptAuthorityId: 'authority-1',
          previewType: 1
        })
      };
    }
  };

  const result = await inspectResumePreviewMeta({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.encryptGeekId, 'geek-1');
  assert.equal(result.encryptResumeId, 'resume-1');
  assert.equal(result.encryptAuthorityId, 'authority-1');
  assert.equal(result.previewType, 1);
  assert.match(calls[0].expression, /encryptAuthorityId/);
  assert.match(calls[0].expression, /resume-btn-file/);
});
