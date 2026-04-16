const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const {
  getUrl,
  evaluateJson,
  bossFetch,
  clickRecommendPager,
  clickRecommendGreet,
  clickRecommendGreetByCoords,
  inspectRecommendState,
  inspectRecommendDetail,
  openChatThread,
  inspectChatThreadState,
  inspectAttachmentState,
  inspectResumeConsentState,
  inspectResumeRequestState,
  acceptResumeConsent,
  sendChatMessage,
  inspectResumePreviewMeta,
  downloadResumeAttachment,
  closeResumeDetail
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

test('clickRecommendGreet returns quota exhausted when top-level entitlement dialog appears after click', async () => {
  const dispatchCalls = [];
  const evaluateResponses = [
    {
      type: 'string',
      value: JSON.stringify({
        ok: true,
        x: 280,
        y: 320,
        buttonText: '打招呼',
        alreadyChatting: false
      })
    },
    {
      type: 'string',
      value: JSON.stringify({
        ok: true,
        blocked: false
      })
    },
    {
      type: 'string',
      value: JSON.stringify({
        ok: true,
        blocked: true,
        reason: 'boss_chat_quota_exhausted',
        dialogText: '今日沟通权益数已达上限，需付费购买'
      })
    }
  ];

  const cdpClient = {
    evaluate: async () => evaluateResponses.shift(),
    dispatchMouseClick: async (payload) => {
      dispatchCalls.push(payload);
    }
  };

  const result = await clickRecommendGreet({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(dispatchCalls.length, 1);
  assert.equal(result.greeted, false);
  assert.equal(result.quotaExhausted, true);
  assert.equal(result.reason, 'boss_chat_quota_exhausted');
  assert.match(result.resultText, /今日沟通权益数已达上限/);
});

test('clickRecommendGreet no longer reports success when post-click state stays pending', async () => {
  const dispatchCalls = [];
  const evaluateResponses = [
    {
      type: 'string',
      value: JSON.stringify({
        ok: true,
        x: 280,
        y: 320,
        buttonText: '打招呼',
        alreadyChatting: false
      })
    },
    {
      type: 'string',
      value: JSON.stringify({
        ok: true,
        blocked: false
      })
    }
  ];

  for (let index = 0; index < 30; index += 1) {
    evaluateResponses.push({
      type: 'string',
      value: JSON.stringify({
        ok: true,
        blocked: false
      })
    });
    evaluateResponses.push({
      type: 'string',
      value: JSON.stringify({
        ok: false,
        reason: 'boss_recommend_greet_result_pending'
      })
    });
  }

  const cdpClient = {
    evaluate: async () => evaluateResponses.shift(),
    dispatchMouseClick: async (payload) => {
      dispatchCalls.push(payload);
    }
  };

  const result = await clickRecommendGreet({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(dispatchCalls.length, 1);
  assert.equal(result.greeted, false);
  assert.equal(result.quotaExhausted, false);
  assert.equal(result.reason, 'boss_recommend_greet_result_pending');
});

test('clickRecommendGreetByCoords moves the mouse before dispatching the click', async () => {
  const originalSetTimeout = global.setTimeout;
  const calls = [];
  global.setTimeout = (fn) => {
    fn();
    return 0;
  };

  try {
    const cdpClient = {
      sendCommand: async (payload) => {
        calls.push({ type: 'move', payload });
        return null;
      },
      dispatchMouseClick: async (payload) => {
        calls.push({ type: 'click', payload });
      },
      evaluate: async () => ({
        type: 'string',
        value: JSON.stringify({
          resultText: '已打招呼',
          alreadyChatting: false
        })
      })
    };

    const result = await clickRecommendGreetByCoords({
      cdpClient,
      targetId: 'target-1',
      x: 280,
      y: 320
    });

    assert.equal(result.ok, true);
    assert.ok(calls.some((call) => call.type === 'move'));
    assert.equal(calls.at(-1).type, 'click');
    assert.equal(calls.at(-1).payload.x, 280);
    assert.equal(calls.at(-1).payload.y, 320);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
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

test('sendChatMessage uses native insert text and verifies the outbound message appears', async () => {
  const evaluateResponses = [
    { ok: true, messages: [{ from: 'other', text: '您好', time: '10:00', type: 'text' }], total: 1 },
    { ok: true, tagName: 'DIV' },
    { ok: true, editorTextLength: 4, submitActive: true, submitVisible: true },
    { clicked: true },
    { ok: true, len: 0, submitActive: false },
    {
      ok: true,
      messages: [
        { from: 'other', text: '您好', time: '10:00', type: 'text' },
        { from: 'me', text: '测试消息', time: '10:01', type: 'text' }
      ],
      total: 2
    }
  ];
  const cdpClient = {
    inserted: [],
    evaluate: async () => ({
      type: 'string',
      value: JSON.stringify(evaluateResponses.shift())
    }),
    dispatchInsertText: async ({ text }) => {
      cdpClient.inserted.push(text);
    },
    dispatchKeyDown: async () => {
      throw new Error('should not use enter fallback');
    }
  };

  const result = await sendChatMessage({
    cdpClient,
    targetId: 'target-1',
    text: '测试消息'
  });

  assert.equal(result.ok, true);
  assert.equal(result.sent, true);
  assert.equal(result.verified, true);
  assert.equal(result.method, 'button_click');
  assert.deepEqual(cdpClient.inserted, ['测', '试', '消', '息']);
});

test('inspectResumeRequestState reads disabled hint from the request button area', async () => {
  const cdpClient = {
    evaluate: async () => ({
      type: 'string',
      value: JSON.stringify({
        ok: true,
        found: true,
        enabled: false,
        disabled: true,
        hintText: '双方回复后可用'
      })
    })
  };

  const result = await inspectResumeRequestState({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.enabled, false);
  assert.equal(result.disabled, true);
  assert.equal(result.hintText, '双方回复后可用');
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

test('openChatThread can match a row by visible text hints when uid attributes are absent', async () => {
  const row = createFakeNode({
    className: 'geek-item',
    textContent: '13:50 谢小洪 面点师傅（B0038011） [送达]你好，请问你最近在看机会吗？',
    attributes: {
      'data-id': '124264786-0'
    }
  });
  const document = createFakeDocument({
    querySelectorAllMap: {
      '.geek-item, .user-item, .dialog-item, .chat-item': [row]
    }
  });
  const cdpClient = createVmCdpClient({ document });

  const result = await openChatThread({
    cdpClient,
    targetId: 'target-1',
    uid: 'enc-uid-1',
    friendName: '谢小洪',
    jobName: '面点师傅（B0038011）'
  });

  assert.equal(result.opened, true);
  assert.equal(row.clicked, true);
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

test('inspectAttachmentState ignores broad wrapper text when no concrete pdf filename is present', async () => {
  const wrapper = createFakeNode({
    tagName: 'DIV',
    textContent: '谢小洪 今日活跃 46岁 10年以上 在线简历 附件简历 求简历 换电话 换微信 约面试 不合适 发送',
    className: 'wrap-v2'
  });
  const threadPane = createFakeNode({
    innerText: wrapper.textContent,
    querySelectorAllMap: {
      'button, a, span, div': [wrapper],
      'a, div, span': [wrapper]
    }
  });
  const document = createFakeDocument({
    querySelectorMap: {
      '.chat-conversation, .conversation-box, .chat-message-list, .conversation-message': threadPane
    }
  });
  const cdpClient = createVmCdpClient({ document });

  const result = await inspectAttachmentState({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.present, false);
  assert.equal(result.fileName, '');
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

test('downloadResumeAttachment returns browser-authenticated PDF bytes and metadata', async () => {
  const calls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      calls.push(payload);
      return {
        type: 'string',
        value: JSON.stringify({
          ok: true,
          fileName: '曾艳简历.pdf',
          mimeType: 'application/pdf',
          fileSize: 3,
          base64: 'QUJD',
          sourceUrl: 'https://www.zhipin.com/wflow/zpgeek/download/preview4boss/foo'
        })
      };
    }
  };

  const result = await downloadResumeAttachment({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.fileName, '曾艳简历.pdf');
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(result.base64, 'QUJD');
  assert.match(calls[0].expression, /preview4boss/);
  assert.match(calls[0].expression, /arrayBuffer/);
  assert.match(calls[0].expression, /attachment-iframe|card-btn/);
});

test('downloadResumeAttachment waits for preview viewer readiness before fetching PDF', async () => {
  let viewerReady = false;
  let sleepCount = 0;
  let fetchCount = 0;

  const iframeDocument = {
    get readyState() {
      return viewerReady ? 'complete' : 'loading';
    },
    body: {
      get innerText() {
        return viewerReady ? 'PDF viewer ready' : '';
      }
    },
    querySelector(selector) {
      if (!viewerReady) {
        return null;
      }
      if (selector === 'embed[type="application/pdf"], object[type="application/pdf"], canvas, .pdfViewer, #viewer, #app, [class*="viewer"]') {
        return { tagName: 'CANVAS' };
      }
      return null;
    }
  };

  const cdpClient = createResumePreviewDownloadCdpClient({
    iframeDocument,
    onSleep() {
      sleepCount += 1;
      if (sleepCount >= 2) {
        viewerReady = true;
      }
    },
    fetchImpl: async () => {
      fetchCount += 1;
      if (!viewerReady) {
        return { ok: false, status: 425 };
      }
      return createFetchResponse({ bodyText: 'ABC' });
    }
  });

  const result = await downloadResumeAttachment({
    cdpClient,
    targetId: 'target-1',
    timeoutMs: 2_000
  });

  assert.equal(result.fileName, '候选人简历.pdf');
  assert.equal(result.base64, 'QUJD');
  assert.equal(fetchCount, 1);
  assert.equal(viewerReady, true);
});

test('downloadResumeAttachment fails when preview viewer never becomes ready', async () => {
  const iframeDocument = {
    readyState: 'loading',
    body: {
      innerText: ''
    },
    querySelector() {
      return null;
    }
  };

  const cdpClient = createResumePreviewDownloadCdpClient({
    iframeDocument,
    fetchImpl: async () => createFetchResponse({ bodyText: 'ABC' })
  });

  await assert.rejects(
    () => downloadResumeAttachment({
      cdpClient,
      targetId: 'target-1',
      timeoutMs: 1_000
    }),
    /boss_resume_preview_not_ready/
  );
});

test('closeResumeDetail closes resume preview iframe via evaluate', async () => {
  const calls = [];
  const cdpClient = {
    evaluate: async (payload) => {
      calls.push(payload);
      return {
        type: 'string',
        value: JSON.stringify({
          ok: true,
          closed: true,
          method: 'close_button'
        })
      };
    }
  };

  const result = await closeResumeDetail({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.closed, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].expression, /attachment-iframe|preview4boss|dialog-wrap/);
});

test('inspectResumeConsentState detects pending consent from notice bar', async () => {
  const acceptLink = createFakeNode({
    tagName: 'A',
    className: 'btn',
    textContent: '同意',
    attributes: {}
  });
  const noticeBar = createFakeNode({
    className: 'notice-list notice-blue-list',
    textContent: '对方想发送附件简历给您，您是否同意 拒绝 同意',
    querySelectorMap: {
      'a.btn': acceptLink
    }
  });
  const threadPane = createFakeNode({
    className: 'chat-conversation',
    querySelectorMap: {
      '.notice-list': noticeBar
    },
    querySelectorAllMap: {
      '.message-card-wrap.boss-green': []
    }
  });
  const document = createFakeDocument({
    querySelectorMap: {
      '.chat-conversation, .conversation-box, .chat-message-list, .conversation-message': threadPane
    }
  });
  const cdpClient = createVmCdpClient({ document });

  const result = await inspectResumeConsentState({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.consentPending, true);
  assert.equal(result.source, 'notice_bar');
});

test('inspectResumeConsentState returns false when no consent card is present', async () => {
  const threadPane = createFakeNode({
    className: 'chat-conversation',
    querySelectorMap: {
      '.notice-list': null
    },
    querySelectorAllMap: {
      '.message-card-wrap.boss-green': []
    }
  });
  const document = createFakeDocument({
    querySelectorMap: {
      '.chat-conversation, .conversation-box, .chat-message-list, .conversation-message': threadPane
    }
  });
  const cdpClient = createVmCdpClient({ document });

  const result = await inspectResumeConsentState({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.consentPending, false);
  assert.equal(result.source, null);
});

test('acceptResumeConsent clicks accept and polls for attachment', async () => {
  let callCount = 0;
  const cdpClient = {
    evaluate: async (payload) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          type: 'string',
          value: JSON.stringify({
            ok: true,
            found: true,
            source: 'notice_bar',
            x: 948,
            y: 553
          })
        };
      }
      return {
        type: 'string',
        value: JSON.stringify({
          ok: true,
          present: true,
          buttonEnabled: true,
          fileName: '陶洪简历.pdf'
        })
      };
    },
    dispatchMouseClick: async () => {}
  };

  const result = await acceptResumeConsent({
    cdpClient,
    targetId: 'target-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.accepted, true);
  assert.equal(result.source, 'notice_bar');
  assert.equal(result.attachmentAppeared, true);
});

function createVmCdpClient({ document, window = {} }) {
  return {
    evaluate: async (payload) => {
      const context = vm.createContext({
        window: {
          location: { href: 'https://www.zhipin.com/web/chat/index' },
          ...window
        },
        document,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Set,
        Map,
        decodeURIComponent,
        encodeURIComponent
      });
      return {
        type: 'string',
        value: vm.runInContext(payload.expression, context)
      };
    }
  };
}

function createResumePreviewDownloadCdpClient({ iframeDocument, fetchImpl, onSleep }) {
  let previewOpen = false;
  const button = createFakeNode({
    tagName: 'BUTTON',
    className: 'card-btn',
    textContent: '点击预览附件简历'
  });
  button.click = () => {
    previewOpen = true;
  };
  const fileNameNode = createFakeNode({
    className: 'message-card-top-title-wrap',
    textContent: '候选人简历.pdf'
  });
  const card = createFakeNode({
    className: 'message-card-wrap',
    textContent: '候选人简历.pdf 点击预览附件简历',
    querySelectorMap: {
      '.card-btn, .message-card-buttons .card-btn': button,
      '.message-card-top-title-wrap, .message-card-top-content, .message-card-top-wrap': fileNameNode
    }
  });
  const threadPane = createFakeNode({
    className: 'chat-conversation',
    querySelectorAllMap: {
      '.message-card-wrap, .message-item .message-card-wrap': [card]
    }
  });
  const iframe = {
    className: 'attachment-box attachment-iframe',
    dataset: {},
    getAttribute(name) {
      if (name === 'src') {
        return 'https://www.zhipin.com/wflow/zpgeek/download/preview4boss?url='
          + encodeURIComponent('https://www.zhipin.com/wflow/zpgeek/download/file/resume.pdf');
      }
      return null;
    },
    get contentDocument() {
      return iframeDocument;
    },
    get contentWindow() {
      return { document: iframeDocument };
    }
  };
  const document = {
    querySelector(selector) {
      if (selector === '.chat-conversation, .conversation-box, .chat-message-list, .conversation-message') {
        return threadPane;
      }
      if (selector === 'iframe.attachment-box.attachment-iframe, iframe[src*="preview4boss"], iframe[src*="pdf-viewer-b"]') {
        return previewOpen ? iframe : null;
      }
      return null;
    }
  };

  return createAsyncVmCdpClient({ document, fetchImpl, onSleep });
}

function createAsyncVmCdpClient({ document, window = {}, fetchImpl, onSleep }) {
  return {
    evaluate: async (payload) => {
      const context = vm.createContext({
        window: {
          location: { href: 'https://www.zhipin.com/web/chat/index', origin: 'https://www.zhipin.com' },
          ...window
        },
        document,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Set,
        Map,
        Promise,
        URL,
        Uint8Array,
        Date,
        decodeURIComponent,
        encodeURIComponent,
        fetch: fetchImpl,
        btoa(value) {
          return Buffer.from(value, 'binary').toString('base64');
        },
        setTimeout(fn) {
          if (typeof onSleep === 'function') {
            onSleep();
          }
          fn();
          return 1;
        },
        clearTimeout() {}
      });
      return {
        type: 'string',
        value: await vm.runInContext(payload.expression, context)
      };
    }
  };
}

function createFetchResponse({ bodyText = '', status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name || '').toLowerCase()] || null;
      }
    },
    async arrayBuffer() {
      return Uint8Array.from(Buffer.from(bodyText)).buffer;
    }
  };
}

function createFakeDocument({ querySelectorMap = {}, querySelectorAllMap = {} } = {}) {
  return {
    title: 'BOSS直聘',
    body: {
      innerText: ''
    },
    querySelector(selector) {
      return querySelectorMap[selector] || null;
    },
    querySelectorAll(selector) {
      return querySelectorAllMap[selector] || [];
    }
  };
}

function createFakeNode({
  tagName = 'DIV',
  textContent = '',
  innerText,
  className = '',
  attributes = {},
  dataset = {},
  disabled = false,
  offsetWidth = 100,
  offsetHeight = 30,
  querySelectorMap = {},
  querySelectorAllMap = {}
} = {}) {
  return {
    tagName,
    textContent,
    innerText: innerText === undefined ? textContent : innerText,
    className,
    dataset,
    disabled,
    offsetWidth,
    offsetHeight,
    clicked: false,
    click() {
      this.clicked = true;
      this.className = `${this.className} active`.trim();
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    getAttributeNames() {
      return Object.keys(attributes);
    },
    querySelector(selector) {
      return querySelectorMap[selector] || null;
    },
    querySelectorAll(selector) {
      return querySelectorAllMap[selector] || [];
    },
    classList: {
      contains(name) {
        return className.split(/\s+/).includes(name);
      }
    }
  };
}
