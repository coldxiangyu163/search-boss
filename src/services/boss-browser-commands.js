async function getUrl({ cdpClient, targetId, urlPrefix } = {}) {
  const result = await cdpClient.evaluate({
    targetId,
    urlPrefix,
    expression: 'window.location.href'
  });

  return result?.value || '';
}

async function evaluateJson({ cdpClient, targetId, expression, urlPrefix } = {}) {
  const result = await cdpClient.evaluate({
    targetId,
    urlPrefix,
    expression
  });

  const rawValue = result?.value;

  if (typeof rawValue !== 'string') {
    throw new Error('boss_browser_json_invalid');
  }

  return JSON.parse(rawValue);
}

async function bossFetch({
  cdpClient,
  targetId,
  url,
  method = 'GET',
  body = null,
  timeoutMs = 30_000,
  urlPrefix
} = {}) {
  const payload = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildBossFetchExpression({ url, method, body, timeoutMs })
  });

  if (payload?.ok === false) {
    throw normalizeBossBrowserError(resolveBossBrowserErrorCode(payload));
  }

  return payload?.data ?? null;
}

async function clickRecommendPager({
  cdpClient,
  targetId,
  direction = 'next',
  urlPrefix
} = {}) {
  const normalizedDirection = direction === 'prev' ? 'prev' : 'next';
  const target = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildRecommendPagerTargetExpression({ direction: normalizedDirection })
  });

  if (!target?.ok) {
    throw new Error(target?.reason || 'boss_recommend_pager_not_found');
  }

  await cdpClient.dispatchMouseClick({
    targetId,
    urlPrefix,
    x: target.x,
    y: target.y
  });

  // Wait for the page to stabilize after click before returning.
  // Polls inspectRecommendState until detailOpen changes or timeout (2s).
  const clickedAt = Date.now();
  let settled = false;
  while (!settled && Date.now() - clickedAt < 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      const state = await evaluateJson({
        cdpClient,
        targetId,
        urlPrefix,
        expression: buildRecommendStateExpression()
      });
      if (state?.ok) {
        settled = true;
      }
    } catch (_) {
      // ignore transient errors during stabilization
    }
  }

  return {
    ok: true,
    direction: normalizedDirection,
    x: target.x,
    y: target.y
  };
}

async function inspectRecommendState({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const state = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildRecommendStateExpression()
  });

  if (!state?.ok) {
    throw new Error(state?.reason || 'boss_recommend_state_unavailable');
  }

  return state;
}

async function inspectRecommendDetail({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const detail = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildRecommendDetailExpression()
  });

  if (!detail?.ok) {
    throw new Error(detail?.reason || 'boss_recommend_detail_unavailable');
  }

  const hasMeaningfulDetail = Boolean(
    detail.name
    || detail.currentActionText
    || detail.hasExperienceSection
    || detail.hasEducationSection
    || (detail.detailText && detail.detailText.trim())
  );

  if (!hasMeaningfulDetail) {
    throw new Error('boss_recommend_detail_empty');
  }

  return detail;
}

async function inspectContextSnapshot({
  cdpClient,
  targetId,
  urlPrefix,
  jobId = null
} = {}) {
  const snapshot = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildContextSnapshotExpression({ jobId })
  });

  if (!snapshot?.ok) {
    throw new Error(snapshot?.reason || 'boss_context_snapshot_unavailable');
  }

  return snapshot;
}

async function openChatThread({
  cdpClient,
  targetId,
  urlPrefix,
  uid
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildOpenChatThreadExpression({ uid })
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_chat_thread_open_failed');
  }

  return result;
}

async function inspectChatThreadState({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildChatThreadStateExpression()
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_chat_thread_state_unavailable');
  }

  return result;
}

async function inspectAttachmentState({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildAttachmentStateExpression()
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_attachment_state_unavailable');
  }

  return result;
}

async function inspectResumePreviewMeta({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildResumePreviewMetaExpression()
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_resume_preview_meta_unavailable');
  }

  return result;
}

function resolveBossBrowserErrorCode(payload) {
  if (payload?.error) {
    return payload.error;
  }

  if (isAuthExpiredPayload(payload)) {
    return 'AUTH_EXPIRED';
  }

  return null;
}

function isAuthExpiredPayload(payload) {
  const status = Number(payload?.status || 0);
  const data = payload?.data;
  const bodyCode = Number(data?.code || 0);
  const bodyMessage = String(data?.message || data?.msg || '');

  if (status === 401 || status === 403) {
    return true;
  }

  if (bodyCode === 401 || bodyCode === 403) {
    return true;
  }

  return /login|登录|expired/i.test(bodyMessage);
}

function buildBossFetchExpression({ url, method, body, timeoutMs }) {
  const serializedUrl = JSON.stringify(url);
  const serializedMethod = JSON.stringify(method);
  const serializedBody = body === null ? 'null' : JSON.stringify(JSON.stringify(body));

  return `(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${timeoutMs});
    const headers = { 'Content-Type': 'application/json' };

    return fetch(${serializedUrl}, {
      method: ${serializedMethod},
      credentials: 'include',
      headers,
      body: ${serializedBody},
      signal: controller.signal
    })
      .then(async (response) => {
        clearTimeout(timer);
        const data = await response.json();
        return JSON.stringify({
          ok: response.ok,
          status: response.status,
          data
        });
      })
      .catch((error) => {
        clearTimeout(timer);
        if (error && error.name === 'AbortError') {
          return JSON.stringify({ ok: false, error: 'TIMEOUT' });
        }

        const message = String(error && error.message ? error.message : error || '');
        if (/login|登录|401|expired/i.test(message)) {
          return JSON.stringify({ ok: false, error: 'AUTH_EXPIRED' });
        }

        return JSON.stringify({ ok: false, error: message || 'UNKNOWN' });
      });
  })()`;
}

function normalizeBossBrowserError(errorCode) {
  if (errorCode === 'AUTH_EXPIRED') {
    return new Error('boss_api_auth_expired');
  }

  if (errorCode === 'TIMEOUT') {
    return new Error('boss_api_timeout');
  }

  return new Error(`boss_api_request_failed:${errorCode || 'unknown'}`);
}

function buildRecommendPagerTargetExpression({ direction }) {
  const selector = `.turn-btn.${direction}`;

  return `(() => {
    try {
    const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
    const recDoc = recFrame?.contentDocument;
    if (!recFrame || !recDoc) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
    }

    const detailWrap = recDoc.querySelector('.resume-detail-wrap');
    if (!detailWrap) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_detail_not_open' });
    }

    const pager = recDoc.querySelector(${JSON.stringify(selector)});
    if (!pager) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_pager_not_found' });
    }

    const style = recDoc.defaultView.getComputedStyle(pager);
    const frameRect = recFrame.getBoundingClientRect();
    const pagerRect = pager.getBoundingClientRect();
    const visible = style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) !== 0
      && pagerRect.width > 0
      && pagerRect.height > 0;

    if (!visible) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_pager_not_visible' });
    }

    return JSON.stringify({
      ok: true,
      x: frameRect.left + pagerRect.left + pagerRect.width / 2,
      y: frameRect.top + pagerRect.top + pagerRect.height / 2
    });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_pager_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

function buildRecommendStateExpression() {
  return `(() => {
    try {
    const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
    const recDoc = recFrame?.contentDocument;
    if (!recFrame || !recDoc) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
    }

    const detailWrap = recDoc.querySelector('.resume-detail-wrap');
    const nextPager = recDoc.querySelector('.turn-btn.next');
    const prevPager = recDoc.querySelector('.turn-btn.prev');
    const detailAction = detailWrap
      ? Array.from(detailWrap.querySelectorAll('button, a, .btn, .btn-v2'))
        .map((node) => (node.textContent || '').trim())
        .find(Boolean) || null
      : null;
    const bodyText = (recDoc.body?.innerText || '').replace(/\\s+/g, ' ').trim();
    const similarCandidatesVisible = bodyText.includes('为你推荐') && bodyText.includes('相似');

    return JSON.stringify({
      ok: true,
      detailOpen: Boolean(detailWrap),
      nextVisible: isVisible(recDoc, nextPager),
      prevVisible: isVisible(recDoc, prevPager),
      similarCandidatesVisible,
      currentActionText: detailAction
    });

    function isVisible(doc, node) {
      if (!node) {
        return false;
      }

      const style = doc.defaultView.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0
        && rect.width > 0
        && rect.height > 0;
    }
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_state_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

function buildRecommendDetailExpression() {
  return `(() => {
    try {
    const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
    const recDoc = recFrame?.contentDocument;
    if (!recFrame || !recDoc) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
    }

    const detailWrap = recDoc.querySelector('.resume-detail-wrap');
    if (!detailWrap) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_detail_not_open' });
    }

    const detailFrame = detailWrap.querySelector('iframe[src*="/web/frame/c-resume/"]');
    const detailDoc = detailFrame?.contentDocument || null;
    const detailRoot = detailDoc?.body || detailWrap;
    const detailText = (detailRoot?.innerText || '').replace(/\\s+/g, ' ').trim();
    const directIdNode = detailWrap.querySelector('[encrypt-geek-id]');
    const detailFrameSrc = detailFrame?.getAttribute('src') || '';
    const identityHints = collectIdentityHints({
      detailSrc: detailFrameSrc,
      directId: directIdNode?.getAttribute('encrypt-geek-id') || ''
    });
    const detailName = findFirstText(detailRoot, [
      '.resume-name',
      '.geek-name',
      '.base-name',
      '[class*="geek-name"]',
      '[class*="resume-name"]',
      'h1',
      'h2'
    ]);
    const selectedCardName = resolveSelectedCardName(recDoc);
    const currentActionText = Array.from(recDoc.querySelectorAll('.resume-detail-wrap button, .resume-detail-wrap a, .resume-detail-wrap .btn, .resume-detail-wrap .btn-v2'))
      .map((node) => (node.textContent || '').trim())
      .find(Boolean) || null;

    return JSON.stringify({
      ok: true,
      bossEncryptGeekId: identityHints[0] || null,
      name: detailName || selectedCardName,
      detailFrameSrc,
      identityHints,
      selectedCardName,
      currentActionText,
      hasExperienceSection: detailText.includes('工作经历'),
      hasEducationSection: detailText.includes('教育经历'),
      detailText: detailText.slice(0, 2000)
    });

    function findFirstText(root, selectors) {
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        const text = (node?.textContent || '').trim();
        if (text) {
          return text;
        }
      }

      return null;
    }

    function resolveSelectedCardName(doc) {
      const highlighted = doc.querySelector('.similar-geek-wrap .title .font-hightlight, .similar-geek-wrap .title .font-highlight');
      const highlightedText = (highlighted?.textContent || '').trim();
      if (highlightedText) {
        return highlightedText;
      }

      const continueButton = Array.from(doc.querySelectorAll('.card-list .btn, .card-list .btn-v2, .card-list button, .card-list a'))
        .find((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim() === '继续沟通');
      if (!continueButton) {
        return null;
      }

      const card = continueButton.closest('.candidate-card-wrap, .geek-card-small, .geek-card, .card-inner');
      if (!card) {
        return null;
      }

      return findFirstText(card, [
        '.row.name-wrap .name',
        '.name',
        '[class*="name"]'
      ]);
    }

    function collectIdentityHints({ detailSrc, directId }) {
      const hints = [];
      if (directId) {
        hints.push(directId);
      }
      const patterns = [
        /encryptGeekId=([^&#]+)/ig,
        /geekId=([^&#]+)/ig,
        /gid=([^&#]+)/ig,
        /resumeid=([^&#]+)/ig
      ];

      for (const pattern of patterns) {
        for (const match of detailSrc.matchAll(pattern)) {
          if (match[1]) {
            hints.push(match[1]);
          }
        }
      }

      return [...new Set(hints)];
    }
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_detail_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

function buildContextSnapshotExpression({ jobId = null } = {}) {
  return `(() => {
    try {
      const currentUrl = window.location.href || '';
      const title = document.title || '';
      const shell = currentUrl.includes('/web/chat/recommend')
        ? 'recommend'
        : currentUrl.includes('/web/chat/index')
          ? 'chat'
          : 'other';
      const expectedJobId = ${JSON.stringify(jobId || '')};
      const jobIdMatch = currentUrl.match(/[?&]jobid=([^&#]+)/i);
      const pageJobId = jobIdMatch ? decodeURIComponent(jobIdMatch[1]) : '';
      const recommendFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
      const recommendDoc = recommendFrame?.contentDocument || null;
      const detailWrap = recommendDoc?.querySelector('.resume-detail-wrap') || null;
      const detailText = (detailWrap?.innerText || '').replace(/\\s+/g, ' ').trim();
      const geekIdNode = detailWrap?.querySelector('[encrypt-geek-id]') || null;
      const nameNode = detailWrap?.querySelector('.resume-name, .geek-name, .base-name, h1, h2') || null;
      const activeChatItem = document.querySelector('.user-item.active, .dialog-item.active, .chat-item.active');
      const attachmentButton = Array.from(document.querySelectorAll('button, a, span, div'))
        .find((node) => /附件简历|附件|PDF/i.test((node.textContent || '').trim()));
      const attachmentCard = Array.from(document.querySelectorAll('a, div, span'))
        .find((node) => /\\.pdf\\b/i.test((node.textContent || '').trim()));
      const attachmentVisible = Boolean(attachmentCard || attachmentButton);
      const attachmentDisabled = Boolean(
        attachmentButton
        && (
          attachmentButton.disabled
          || attachmentButton.getAttribute('aria-disabled') === 'true'
          || attachmentButton.classList.contains('disabled')
        )
      );

      return JSON.stringify({
        ok: true,
        page: {
          url: currentUrl,
          title,
          shell
        },
        job: {
          encryptJobId: pageJobId || '',
          jobName: '',
          matchesRunJob: expectedJobId ? pageJobId === expectedJobId : null
        },
        candidate: {
          bossEncryptGeekId: geekIdNode?.getAttribute('encrypt-geek-id') || '',
          name: (nameNode?.textContent || '').trim(),
          inDetail: Boolean(detailWrap),
          detailText
        },
        thread: {
          encryptUid: activeChatItem?.getAttribute('data-uid') || activeChatItem?.getAttribute('data-encrypt-uid') || '',
          isUnread: Boolean(activeChatItem?.querySelector('.unread, .unread-count, [class*="unread"]'))
        },
        attachment: {
          present: attachmentVisible,
          buttonEnabled: Boolean(attachmentButton) && !attachmentDisabled
        }
      });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_context_snapshot_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

function buildOpenChatThreadExpression({ uid }) {
  return `(() => {
    try {
      const targetUid = ${JSON.stringify(uid || '')};
      const rows = Array.from(document.querySelectorAll('.geek-item, .user-item, .dialog-item, .chat-item'));
      const row = rows.find((node) => {
        const value = node.getAttribute('data-uid')
          || node.getAttribute('data-encrypt-uid')
          || node.dataset?.uid
          || node.dataset?.encryptUid
          || '';
        return value === targetUid;
      });

      if (!row) {
        return JSON.stringify({ ok: false, reason: 'boss_chat_thread_not_found' });
      }

      row.click();

      return JSON.stringify({
        ok: true,
        uid: targetUid,
        opened: true
      });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_chat_thread_open_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

function buildChatThreadStateExpression() {
  return `(() => {
    try {
      const active = document.querySelector('.geek-item.selected, .geek-item.active, .user-item.active, .dialog-item.active, .chat-item.active');
      const threadPane = document.querySelector('.chat-conversation, .conversation-box, .chat-message-list, .conversation-message');
      const threadText = (threadPane?.innerText || '').replace(/\\s+/g, ' ').trim();
      const attachmentButton = threadPane
        ? Array.from(threadPane.querySelectorAll('button, a, span, div'))
          .find((node) => /附件简历|附件|PDF/i.test((node.textContent || '').trim()))
        : null;

      return JSON.stringify({
        ok: true,
        threadOpen: Boolean(active) && Boolean(threadPane),
        activeUid: active?.getAttribute('data-uid') || active?.getAttribute('data-encrypt-uid') || active?.dataset?.uid || active?.dataset?.encryptUid || '',
        attachmentPresent: Boolean(attachmentButton),
        threadText: threadText.slice(0, 500)
      });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_chat_thread_state_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

function buildAttachmentStateExpression() {
  return `(() => {
    try {
      const threadPane = document.querySelector('.chat-conversation, .conversation-box, .chat-message-list, .conversation-message');
      const attachmentButton = threadPane
        ? Array.from(threadPane.querySelectorAll('button, a, span, div'))
          .find((node) => /附件简历|附件|PDF/i.test((node.textContent || '').trim()))
        : null;
      const attachmentCard = threadPane
        ? Array.from(threadPane.querySelectorAll('a, div, span'))
          .find((node) => /\\.pdf\\b/i.test((node.textContent || '').trim()))
        : null;
      const fileName = (attachmentCard?.textContent || attachmentButton?.textContent || '').trim();
      const disabled = Boolean(
        attachmentButton
        && (
          attachmentButton.disabled
          || attachmentButton.getAttribute('aria-disabled') === 'true'
          || attachmentButton.classList.contains('disabled')
        )
      );

      return JSON.stringify({
        ok: true,
        present: Boolean(attachmentCard || attachmentButton),
        buttonEnabled: Boolean(attachmentButton) && !disabled,
        fileName
      });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_attachment_state_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

function buildResumePreviewMetaExpression() {
  return `(() => {
    try {
      const output = {
        ok: true,
        canPreview: false,
        encryptGeekId: '',
        encryptResumeId: '',
        encryptAuthorityId: '',
        previewType: null
      };

      const candidates = [];
      const pushCandidate = (value) => {
        if (!value || typeof value !== 'object') return;
        candidates.push(value);
      };

      pushCandidate(window.__INITIAL_STATE__);
      pushCandidate(window.__NEXT_DATA__);
      pushCandidate(window.iBossRoot);
      pushCandidate(window.Chat);
      pushCandidate(window.chatInfo);
      pushCandidate(window.geekCard);

      const seen = new Set();
      const queue = candidates.slice();
      while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || seen.has(current)) {
          continue;
        }
        seen.add(current);

        if (!output.encryptAuthorityId && typeof current.encryptAuthorityId === 'string') {
          output.encryptAuthorityId = current.encryptAuthorityId;
        }
        if (!output.encryptResumeId && typeof current.encryptResumeId === 'string') {
          output.encryptResumeId = current.encryptResumeId;
        }
        if (!output.encryptGeekId && typeof current.encryptGeekId === 'string') {
          output.encryptGeekId = current.encryptGeekId;
        }
        if (!output.encryptGeekId && typeof current.geekId === 'string') {
          output.encryptGeekId = current.geekId;
        }
        if (output.previewType == null && Number.isFinite(Number(current.previewType))) {
          output.previewType = Number(current.previewType);
        }
        if (!output.canPreview && current.isCanPreview === true) {
          output.canPreview = true;
        }

        for (const value of Object.values(current)) {
          if (value && typeof value === 'object' && !seen.has(value)) {
            queue.push(value);
          }
        }
      }

      const attachmentButton = Array.from(document.querySelectorAll('button, a, span, div'))
        .find((node) => (node.className || '').toString().includes('resume-btn-file') || /附件简历|附件|PDF/i.test((node.textContent || '').trim()));

      output.buttonClassName = attachmentButton?.className || '';
      return JSON.stringify(output);
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_resume_preview_meta_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

module.exports = {
  getUrl,
  evaluateJson,
  bossFetch,
  clickRecommendPager,
  inspectRecommendState,
  inspectRecommendDetail,
  inspectContextSnapshot,
  openChatThread,
  inspectChatThreadState,
  inspectAttachmentState,
  inspectResumePreviewMeta,
};
