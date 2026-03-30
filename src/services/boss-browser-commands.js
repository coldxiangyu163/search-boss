function randomDelay(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function realClick({ cdpClient, targetId, urlPrefix, selector, selectorAll, index = 0 }) {
  const findExpr = selectorAll
    ? `(() => {
        const els = Array.from(document.querySelectorAll(${JSON.stringify(selectorAll)}));
        const el = els.filter(e => e.offsetWidth > 0 && e.offsetHeight > 0)[${index}];
        if (!el) return JSON.stringify({ found: false });
        const rect = el.getBoundingClientRect();
        return JSON.stringify({ found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      })()`
    : `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el || el.offsetWidth === 0) return JSON.stringify({ found: false });
        const rect = el.getBoundingClientRect();
        return JSON.stringify({ found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      })()`;

  const result = await evaluateJson({ cdpClient, targetId, urlPrefix, expression: findExpr });
  if (!result?.found) {
    throw new Error('boss_element_not_found_for_click');
  }

  await cdpClient.dispatchMouseClick({ targetId, urlPrefix, x: result.x, y: result.y });
  return { clicked: true, x: result.x, y: result.y };
}

async function realClickByText({ cdpClient, targetId, urlPrefix, text, tag = '*', extraFilter = '' }) {
  const expression = `(() => {
    const els = Array.from(document.querySelectorAll(${JSON.stringify(tag)}));
    const el = els.find(e => {
      const t = (e.textContent || '').replace(/\\s+/g, '').trim();
      return t === ${JSON.stringify(text)} && e.offsetWidth > 0 && e.offsetHeight > 0 ${extraFilter};
    });
    if (!el) return JSON.stringify({ found: false });
    const rect = el.getBoundingClientRect();
    return JSON.stringify({ found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  })()`;

  const result = await evaluateJson({ cdpClient, targetId, urlPrefix, expression });
  if (!result?.found) {
    throw new Error(`boss_text_element_not_found:${text}`);
  }

  await cdpClient.dispatchMouseClick({ targetId, urlPrefix, x: result.x, y: result.y });
  return { clicked: true, x: result.x, y: result.y };
}

async function bringToFront({ cdpClient, targetId, urlPrefix } = {}) {
  await cdpClient.bringToFront({ targetId, urlPrefix });
  return { ok: true };
}

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
  uid,
  friendName,
  jobName,
  lastTime,
  lastMessage
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildOpenChatThreadExpression({ uid, friendName, jobName, lastTime, lastMessage })
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

async function downloadResumeAttachment({
  cdpClient,
  targetId,
  urlPrefix,
  timeoutMs = 8_000
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildResumeDownloadExpression({ timeoutMs })
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_resume_download_unavailable');
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
    // Look for greet/action button inside detailWrap first, then fallback to detail panel button
    let currentActionText = Array.from(detailWrap.querySelectorAll('button, a, .btn, .btn-v2'))
      .map((node) => (node.textContent || '').trim())
      .find((t) => t === '立即沟通' || t === '打招呼' || t === '继续沟通') || null;
    if (!currentActionText) {
      const panelBtn = Array.from(recDoc.querySelectorAll('button.btn-greet, .btn-v2.btn-greet, .btn-sure-v2'))
        .find((btn) => !btn.closest('.candidate-card-wrap, .card-inner'));
      currentActionText = panelBtn ? (panelBtn.textContent || '').trim() : null;
    }

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
      const activeChatItem = document.querySelector('.geek-item.selected, .geek-item.active, .user-item.active, .dialog-item.active, .chat-item.active');
      const activeThread = activeChatItem
        ? {
          name: (activeChatItem.querySelector('.geek-name, .name')?.textContent || '').trim(),
          jobName: (activeChatItem.querySelector('.source-job, .job-name')?.textContent || '').trim(),
          lastTime: (activeChatItem.querySelector('.time, .time-shadow')?.textContent || '').trim()
        }
        : null;
      // Extract real encryptUid from Vue component data (chat page DOM attrs are empty)
      let chatVueEncryptUid = '';
      if (activeChatItem) {
        const wrap = (activeChatItem.closest ? activeChatItem.closest('.geek-item-wrap') : null) || activeChatItem;
        const vue = wrap.__vue__ || activeChatItem.__vue__;
        chatVueEncryptUid = vue?.$props?.source?.encryptUid || vue?.$data?.source?.encryptUid || '';
      }
      // Fallback: extract from conversation panel Vue components
      if (!chatVueEncryptUid && shell === 'chat') {
        const convPanel = document.querySelector('.chat-conversation');
        if (convPanel) {
          const walkForUid = (el) => {
            if (el.__vue__) {
              const v = el.__vue__;
              const d = v.$data?.currentData || v.$data?.geek || v.$props?.geek;
              if (d?.encryptUid) return d.encryptUid;
            }
            for (const child of el.children || []) {
              const found = walkForUid(child);
              if (found) return found;
            }
            return '';
          };
          chatVueEncryptUid = walkForUid(convPanel);
        }
      }
      const domEncryptUid = activeChatItem?.getAttribute('data-uid') || activeChatItem?.getAttribute('data-encrypt-uid') || '';
      const domActiveUid = domEncryptUid || activeChatItem?.dataset?.uid || activeChatItem?.dataset?.encryptUid || '';
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
          bossEncryptGeekId: geekIdNode?.getAttribute('encrypt-geek-id') || chatVueEncryptUid || '',
          name: (nameNode?.textContent || '').trim(),
          inDetail: Boolean(detailWrap),
          detailText
        },
        thread: {
          encryptUid: chatVueEncryptUid || domEncryptUid || '',
          activeUid: chatVueEncryptUid || domActiveUid || '',
          isUnread: Boolean(activeChatItem?.querySelector('.unread, .unread-count, [class*="unread"]')),
          activeThread
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

function buildOpenChatThreadExpression({ uid, friendName, jobName, lastTime, lastMessage }) {
  return `(() => {
    try {
      const targetUid = ${JSON.stringify(uid || '')};
      const targetName = ${JSON.stringify(friendName || '')};
      const targetJobName = ${JSON.stringify(jobName || '')};
      const targetLastTime = ${JSON.stringify(lastTime || '')};
      const targetLastMessage = ${JSON.stringify(lastMessage || '')};
      const rows = Array.from(document.querySelectorAll('.geek-item, .user-item, .dialog-item, .chat-item'));
      const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      let row = rows.find((node) => {
        const domValue = node.getAttribute('data-uid')
          || node.getAttribute('data-encrypt-uid')
          || node.dataset?.uid
          || node.dataset?.encryptUid
          || '';
        if (domValue === targetUid) return true;
        // Check Vue component data for real encryptUid
        const wrap = (node.closest ? node.closest('.geek-item-wrap') : null) || node;
        const vue = wrap.__vue__ || node.__vue__;
        const vueUid = vue?.$props?.source?.encryptUid || vue?.$data?.source?.encryptUid || '';
        return vueUid && vueUid === targetUid;
      });

      if (!row && (targetName || targetJobName || targetLastTime || targetLastMessage)) {
        let bestScore = 0;
        for (const candidate of rows) {
          const text = normalizeText(candidate.textContent);
          let score = 0;
          if (targetName && text.includes(targetName)) score += 4;
          if (targetJobName && text.includes(targetJobName)) score += 3;
          if (targetLastTime && text.includes(targetLastTime)) score += 2;
          if (targetLastMessage && text.includes(targetLastMessage)) score += 1;
          if (score > bestScore) {
            bestScore = score;
            row = candidate;
          }
        }

        if (bestScore < 4) {
          row = null;
        }
      }

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

      // Extract real encryptUid from Vue component data (DOM attributes are empty on chat page)
      let vueEncryptUid = '';
      if (active) {
        const wrap = (active.closest ? active.closest('.geek-item-wrap') : null) || active;
        const vue = wrap.__vue__ || active.__vue__;
        vueEncryptUid = vue?.$props?.source?.encryptUid || vue?.$data?.source?.encryptUid || '';
      }
      // Fallback: extract from slide-content or message-list Vue component in the conversation panel
      if (!vueEncryptUid && threadPane) {
        const walkForEncryptUid = (el) => {
          if (el.__vue__) {
            const v = el.__vue__;
            const d = v.$data?.currentData || v.$data?.geek || v.$props?.geek;
            if (d?.encryptUid) return d.encryptUid;
          }
          for (const child of el.children || []) {
            const found = walkForEncryptUid(child);
            if (found) return found;
          }
          return '';
        };
        vueEncryptUid = walkForEncryptUid(threadPane);
      }

      const domUid = active?.getAttribute('data-uid') || active?.getAttribute('data-encrypt-uid') || active?.dataset?.uid || active?.dataset?.encryptUid || '';
      const fallbackId = active?.getAttribute('data-id') || active?.id?.replace(/^_/, '') || '';

      return JSON.stringify({
        ok: true,
        threadOpen: Boolean(active) && Boolean(threadPane),
        activeUid: vueEncryptUid || domUid || fallbackId,
        encryptUid: vueEncryptUid || domUid || '',
        threadId: fallbackId,
        activeThread: active ? {
          name: (active.querySelector('.geek-name, .name')?.textContent || '').trim(),
          jobName: (active.querySelector('.source-job, .job-name')?.textContent || '').trim(),
          lastTime: (active.querySelector('.time, .time-shadow')?.textContent || '').trim()
        } : null,
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

      // 1. Look for the specific resume-btn-file element (most reliable)
      const fileBtnByClass = threadPane
        ? threadPane.querySelector('.resume-btn-file, a.resume-btn-file, div.resume-btn-file')
        : null;

      // 2. Fallback: look for small leaf nodes with exact "附件简历" text
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const leafAttBtn = !fileBtnByClass && threadPane
        ? Array.from(threadPane.querySelectorAll('button, a, span, div'))
          .find((node) => {
            const t = normalizeText(node.textContent);
            return /^(附件简历|查看附件简历|预览附件简历)$/.test(t)
              && node.children.length <= 2
              && node.offsetWidth > 0;
          })
        : null;

      const attachmentButton = fileBtnByClass || leafAttBtn;

      // 3. Check for PDF card in messages (attachment already sent by candidate)
      const attachmentCardText = threadPane
        ? Array.from(threadPane.querySelectorAll('.message-card-wrap, .message-item a, .message-item div, .message-item span'))
          .map((node) => normalizeText(node.textContent))
          .find((text) => /[^\\s]+\\.pdf\\b/i.test(text) && text.length <= 160)
        : '';
      const fileNameMatch = String(attachmentCardText || '').match(/([^\\s]+\\.pdf)\\b/i);
      const fileName = fileNameMatch ? fileNameMatch[1] : '';

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
        present: Boolean(attachmentCardText) || (Boolean(attachmentButton) && !disabled),
        buttonEnabled: Boolean(attachmentButton) && !disabled,
        buttonDisabled: Boolean(attachmentButton) && disabled,
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

function buildResumeDownloadExpression({ timeoutMs }) {
  return `(() => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const toBase64 = (bytes) => {
      let binary = '';
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }
      return btoa(binary);
    };

    const findPreviewState = () => {
      const threadPane = document.querySelector('.chat-conversation, .conversation-box, .chat-message-list, .conversation-message');
      const cards = threadPane
        ? Array.from(threadPane.querySelectorAll('.message-card-wrap, .message-item .message-card-wrap'))
        : [];
      const card = cards.find((node) => /\\.(pdf|docx?|doc)\\b/i.test(normalizeText(node.textContent)));
      const button = card ? card.querySelector('.card-btn, .message-card-buttons .card-btn') : null;
      const fileNameNode = card ? card.querySelector('.message-card-top-title-wrap, .message-card-top-content, .message-card-top-wrap') : null;
      const iframe = document.querySelector('iframe.attachment-box.attachment-iframe, iframe[src*="preview4boss"], iframe[src*="pdf-viewer-b"]');
      const viewerSrc = iframe?.getAttribute('src') || '';
      const absoluteViewerUrl = viewerSrc ? new URL(viewerSrc, window.location.origin) : null;
      const nestedUrl = absoluteViewerUrl?.searchParams?.get('url') || '';
      return {
        fileName: normalizeText(fileNameNode?.textContent || '').replace(/点击预览附件简历$/,'').trim(),
        viewerUrl: absoluteViewerUrl ? absoluteViewerUrl.toString() : '',
        downloadUrl: nestedUrl ? new URL(nestedUrl, window.location.origin).toString() : '',
        hasPreview: Boolean(iframe),
        button
      };
    };

    return (async () => {
      try {
        let state = findPreviewState();
        if (!state.hasPreview) {
          if (!state.button) {
            return JSON.stringify({ ok: false, reason: 'boss_resume_preview_button_not_found' });
          }
          state.button.click();
          const deadline = Date.now() + ${timeoutMs};
          while (Date.now() < deadline) {
            await sleep(250);
            state = findPreviewState();
            if (state.hasPreview) break;
          }
        }

        if (!state.hasPreview || !state.downloadUrl) {
          return JSON.stringify({ ok: false, reason: 'boss_resume_preview_url_unavailable' });
        }

        const response = await fetch(state.downloadUrl, { credentials: 'include' });
        if (!response.ok) {
          return JSON.stringify({ ok: false, reason: 'boss_resume_download_failed:' + response.status });
        }

        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        return JSON.stringify({
          ok: true,
          fileName: state.fileName || 'resume.pdf',
          mimeType: response.headers.get('content-type') || 'application/pdf',
          fileSize: bytes.byteLength,
          sourceUrl: state.downloadUrl,
          base64: toBase64(bytes)
        });
      } catch (err) {
        return JSON.stringify({ ok: false, reason: 'boss_resume_download_error:' + (err && err.message || String(err)) });
      }
    })();
  })()`;
}

async function clickRecommendGreet({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const target = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildRecommendGreetTargetExpression()
  });

  if (!target?.ok) {
    throw new Error(target?.reason || 'boss_recommend_greet_not_found');
  }

  // If button already says "继续沟通", candidate was already greeted — skip without clicking
  if (target.alreadyChatting) {
    return {
      ok: true,
      greeted: false,
      resultText: target.buttonText || '继续沟通',
      alreadyChatting: true
    };
  }

  await cdpClient.dispatchMouseClick({
    targetId,
    urlPrefix,
    x: target.x,
    y: target.y
  });

  const clickedAt = Date.now();
  let settled = false;
  while (!settled && Date.now() - clickedAt < 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const state = await evaluateJson({
        cdpClient,
        targetId,
        urlPrefix,
        expression: buildRecommendGreetResultExpression()
      });
      if (state?.ok) {
        settled = true;
        return {
          ok: true,
          greeted: true,
          resultText: state.resultText || '',
          alreadyChatting: state.alreadyChatting || false
        };
      }
    } catch (_) {
      // ignore transient errors during stabilization
    }
  }

  return {
    ok: true,
    greeted: true,
    resultText: '',
    alreadyChatting: false
  };
}

function buildRecommendGreetTargetExpression() {
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

      // Search inside detailWrap first, then fallback to detail-panel greet button outside detailWrap
      let buttons = Array.from(detailWrap.querySelectorAll('button, a, .btn, .btn-v2'));
      let greetBtn = buttons.find((btn) => {
        const text = (btn.textContent || '').replace(/\\s+/g, '').trim();
        return text === '立即沟通' || text === '打招呼' || text === '继续沟通';
      });

      // Fallback: look for the detail panel greet button (btn-sure-v2/btn-greet) that is NOT inside a card
      if (!greetBtn) {
        const allBtns = Array.from(recDoc.querySelectorAll('button.btn-greet, .btn-v2.btn-greet, .btn-sure-v2'));
        greetBtn = allBtns.find((btn) => {
          const text = (btn.textContent || '').replace(/\\s+/g, '').trim();
          const inCard = btn.closest('.candidate-card-wrap, .card-inner');
          return !inCard && (text === '立即沟通' || text === '打招呼' || text === '继续沟通');
        });
      }

      if (!greetBtn) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_greet_button_not_found' });
      }

      const style = recDoc.defaultView.getComputedStyle(greetBtn);
      const frameRect = recFrame.getBoundingClientRect();
      const btnRect = greetBtn.getBoundingClientRect();
      const visible = style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0
        && btnRect.width > 0
        && btnRect.height > 0;

      if (!visible) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_greet_button_not_visible' });
      }

      const disabled = greetBtn.disabled
        || greetBtn.getAttribute('aria-disabled') === 'true'
        || greetBtn.classList.contains('disabled');

      if (disabled) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_greet_button_disabled' });
      }

      const text = (greetBtn.textContent || '').replace(/\\s+/g, '').trim();

      return JSON.stringify({
        ok: true,
        x: frameRect.left + btnRect.left + btnRect.width / 2,
        y: frameRect.top + btnRect.top + btnRect.height / 2,
        buttonText: text,
        alreadyChatting: text === '继续沟通'
      });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_greet_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

function buildRecommendGreetResultExpression() {
  return `(() => {
    try {
      const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
      const recDoc = recFrame?.contentDocument;
      if (!recFrame || !recDoc) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
      }

      const detailWrap = recDoc.querySelector('.resume-detail-wrap');
      if (!detailWrap) {
        return JSON.stringify({ ok: true, resultText: 'detail_closed_after_greet', alreadyChatting: false });
      }

      const buttons = Array.from(detailWrap.querySelectorAll('button, a, .btn, .btn-v2'));
      const postGreetBtn = buttons.find((btn) => {
        const text = (btn.textContent || '').replace(/\\s+/g, '').trim();
        return text === '继续沟通' || text === '已沟通';
      });

      if (postGreetBtn) {
        return JSON.stringify({ ok: true, resultText: (postGreetBtn.textContent || '').trim(), alreadyChatting: true });
      }

      return JSON.stringify({ ok: false, reason: 'boss_recommend_greet_result_pending' });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_greet_result_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function selectChatJobFilter({
  cdpClient,
  targetId,
  urlPrefix,
  jobName
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildSelectChatJobFilterExpression({ jobName })
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_chat_job_filter_failed');
  }

  await randomDelay(2_000, 3_000);
  return result;
}

function buildSelectChatJobFilterExpression({ jobName }) {
  return `(() => {
    try {
      const chatTopJob = document.querySelector('.chat-top-job');
      if (!chatTopJob) {
        return JSON.stringify({ ok: false, reason: 'boss_chat_job_dropdown_not_found' });
      }

      const label = chatTopJob.querySelector('.ui-dropmenu-label');
      if (label) label.click();

      const targetJobName = ${JSON.stringify(jobName || '')};
      const items = Array.from(chatTopJob.querySelectorAll('.ui-dropmenu-list li'));
      const match = items.find((li) => {
        const text = (li.textContent || '').replace(/\\s+/g, ' ').trim();
        return targetJobName && text.includes(targetJobName);
      });

      if (!match) {
        return JSON.stringify({ ok: false, reason: 'boss_chat_job_not_in_filter', available: items.map(li => (li.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60)) });
      }

      match.click();
      return JSON.stringify({ ok: true, selected: (match.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_chat_job_filter_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function selectChatUnreadFilter({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildSelectChatUnreadFilterExpression()
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_chat_unread_filter_failed');
  }

  await randomDelay(1_500, 2_500);
  return result;
}

function buildSelectChatUnreadFilterExpression() {
  return `(() => {
    try {
      const filterLeft = document.querySelector('.chat-message-filter-left');
      if (!filterLeft) {
        return JSON.stringify({ ok: false, reason: 'boss_chat_filter_area_not_found' });
      }

      const spans = Array.from(filterLeft.querySelectorAll('span'));
      const unreadSpan = spans.find((s) => (s.textContent || '').trim() === '未读');
      if (!unreadSpan) {
        return JSON.stringify({ ok: false, reason: 'boss_chat_unread_tab_not_found' });
      }

      if (unreadSpan.classList.contains('active')) {
        return JSON.stringify({ ok: true, alreadyActive: true });
      }

      unreadSpan.click();
      return JSON.stringify({ ok: true, alreadyActive: false });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_chat_unread_filter_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function inspectVisibleChatList({
  cdpClient,
  targetId,
  urlPrefix,
  limit = 30
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildInspectVisibleChatListExpression({ limit })
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_chat_visible_list_failed');
  }

  return result;
}

function buildInspectVisibleChatListExpression({ limit }) {
  return `(() => {
    try {
      const rows = Array.from(document.querySelectorAll('.geek-item'));
      const visible = rows.filter((r) => r.offsetHeight > 0).slice(0, ${limit});
      const threads = visible.map((row, index) => {
        const nameEl = row.querySelector('.geek-name, .name');
        const jobEl = row.querySelector('.source-job, .job-name');
        const timeEl = row.querySelector('.time, .time-shadow');
        const msgEl = row.querySelector('.last-msg, .message, .msg');
        const unreadEl = row.querySelector('.unread, .unread-count, [class*="unread"]');
        const domUid = row.getAttribute('data-uid') || row.getAttribute('data-encrypt-uid') || row.dataset?.uid || row.dataset?.encryptUid || '';
        const dataId = row.getAttribute('data-id') || row.id || '';
        // Extract real encryptUid from Vue component data
        let vueEncryptUid = '';
        const wrap = (row.closest ? row.closest('.geek-item-wrap') : null) || row;
        const vue = wrap.__vue__ || row.__vue__;
        vueEncryptUid = vue?.$props?.source?.encryptUid || vue?.$data?.source?.encryptUid || '';
        return {
          index,
          dataId,
          name: (nameEl?.textContent || '').trim(),
          jobName: (jobEl?.textContent || '').trim(),
          lastTime: (timeEl?.textContent || '').trim(),
          lastMessage: (msgEl?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
          encryptUid: vueEncryptUid || domUid,
          hasUnread: Boolean(unreadEl && unreadEl.offsetWidth > 0)
        };
      });
      return JSON.stringify({ ok: true, threads, total: visible.length });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_chat_list_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function clickChatRow({
  cdpClient,
  targetId,
  urlPrefix,
  index,
  dataId
} = {}) {
  // Step 1: Find the row element and get its coordinates
  const locateExpr = `(() => {
    try {
      const rows = Array.from(document.querySelectorAll('.geek-item')).filter((r) => r.offsetHeight > 0);
      let target = null;
      const targetDataId = ${JSON.stringify(dataId || '')};
      const targetIndex = ${Number.isFinite(index) ? index : -1};

      if (targetDataId) {
        target = rows.find((r) => (r.getAttribute('data-id') || r.id || '') === targetDataId);
      }
      if (!target && targetIndex >= 0 && targetIndex < rows.length) {
        target = rows[targetIndex];
      }
      if (!target) {
        return JSON.stringify({ ok: false, reason: 'boss_chat_row_not_found' });
      }

      const rect = target.getBoundingClientRect();
      const nameEl = target.querySelector('.geek-name, .name');
      return JSON.stringify({
        ok: true,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        name: (nameEl?.textContent || '').trim(),
        dataId: target.getAttribute('data-id') || ''
      });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_chat_row_click_error:' + (err && err.message || String(err)) });
    }
  })()`;

  const result = await evaluateJson({ cdpClient, targetId, urlPrefix, expression: locateExpr });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_chat_row_click_failed');
  }

  // Step 2: Real mouse click at the row's coordinates
  await cdpClient.dispatchMouseClick({ targetId, urlPrefix, x: result.x, y: result.y });

  await randomDelay(2_000, 3_000);
  return { ok: true, clicked: true, name: result.name, dataId: result.dataId };
}

async function navigateTo({
  cdpClient,
  targetId,
  urlPrefix,
  url
} = {}) {
  if (!url) {
    throw new Error('boss_navigate_url_required');
  }

  await cdpClient.sendCommand({
    targetId,
    urlPrefix,
    method: 'Page.navigate',
    params: { url }
  });

  // Wait for page to stabilize
  await randomDelay(2_500, 3_500);

  const currentUrl = await getUrl({ cdpClient, targetId, urlPrefix });

  return {
    ok: true,
    url: currentUrl
  };
}

async function sendChatMessage({
  cdpClient,
  targetId,
  urlPrefix,
  text
} = {}) {
  if (!text || typeof text !== 'string') {
    throw new Error('boss_chat_message_text_required');
  }

  // Step 1: Focus editor and insert text via execCommand
  const inputResult = await evaluateJson({
    cdpClient, targetId, urlPrefix,
    expression: `(() => {
      const selectors = [
        '.boss-chat-editor-input[contenteditable="true"]',
        '.boss-chat-editor-input',
        '.chat-editor [contenteditable="true"]',
        '[contenteditable="true"]',
      ];
      let editor = null;
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { editor = el; break; }
      }
      if (!editor) return JSON.stringify({ ok: false, reason: 'boss_chat_editor_not_found' });
      editor.focus();
      editor.textContent = '';
      document.execCommand('insertText', false, ${JSON.stringify(text)});
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return JSON.stringify({ ok: true });
    })()`
  });

  if (!inputResult?.ok) {
    throw new Error(inputResult?.reason || 'boss_chat_editor_not_found');
  }

  await randomDelay(500, 1_000);

  // Step 2: Real mouse click on send button
  try {
    await realClick({ cdpClient, targetId, urlPrefix, selector: '.conversation-editor .submit, .submit-content .submit' });
  } catch (e) {
    await realClickByText({ cdpClient, targetId, urlPrefix, text: '发送' });
  }

  await randomDelay(1_000, 2_000);
  return { ok: true, sent: true, textLength: text.length };
}

async function clickRequestResume({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  // Phase 1: Wait for "求简历" button to become enabled (up to 8 seconds)
  let waitedMs = 0;
  for (let i = 0; i < 16; i++) {
    const state = await evaluateJson({
      cdpClient, targetId, urlPrefix,
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button, a, span, div')).find(n => {
          const t = (n.textContent || '').replace(/\\s+/g, '').trim();
          return t === '求简历' && n.offsetWidth > 0;
        });
        if (!btn) return JSON.stringify({ found: false });
        const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('disabled');
        return JSON.stringify({ found: true, disabled });
      })()`
    });

    if (state?.found && !state?.disabled) break;
    if (!state?.found) {
      throw new Error('boss_chat_request_resume_button_not_found');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    waitedMs += 500;
  }

  // Phase 2: Real mouse click on "求简历"
  try {
    await realClickByText({ cdpClient, targetId, urlPrefix, text: '求简历' });
  } catch (error) {
    throw new Error('boss_chat_request_resume_button_disabled');
  }

  // Phase 3: Wait for exchange-tooltip confirm dialog and real-click "确定" (up to 5 seconds)
  let confirmed = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const dialogState = await evaluateJson({
      cdpClient, targetId, urlPrefix,
      expression: `(() => {
        // BOSS uses .exchange-tooltip for resume/phone/wechat confirm popups
        const tooltip = document.querySelector('.exchange-tooltip');
        if (!tooltip || tooltip.offsetWidth === 0) return JSON.stringify({ found: false });
        const confirmBtn = tooltip.querySelector('.boss-btn-primary');
        if (!confirmBtn || confirmBtn.offsetWidth === 0) return JSON.stringify({ found: false });
        const rect = confirmBtn.getBoundingClientRect();
        return JSON.stringify({ found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      })()`
    });

    if (dialogState?.found) {
      await cdpClient.dispatchMouseClick({
        targetId, urlPrefix,
        x: dialogState.x, y: dialogState.y
      });
      confirmed = true;
      break;
    }
  }

  await randomDelay(1_500, 2_500);
  return { ok: true, requested: true, confirmed, waitedMs };
}

async function readOpenThreadMessages({
  cdpClient,
  targetId,
  urlPrefix,
  limit = 20
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildReadOpenThreadMessagesExpression({ limit })
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_chat_read_messages_failed');
  }

  return result;
}

function buildReadOpenThreadMessagesExpression({ limit }) {
  return `(() => {
    try {
      const msgList = document.querySelector('.chat-message-list, .conversation-message, .message-list');
      if (!msgList) {
        return JSON.stringify({ ok: false, reason: 'boss_chat_message_list_not_found' });
      }

      const items = Array.from(msgList.querySelectorAll('.item-myself, .item-friend'));
      const messages = items.slice(-${limit}).map((item) => {
        const isSelf = item.classList.contains('item-myself');
        const textSpan = item.querySelector('.text span');
        const textDiv = item.querySelector('.text');
        const text = (textSpan?.textContent || '').replace(/\\s+/g, ' ').trim()
          || (textDiv?.textContent || '').replace(/(送达|已读|未读)/g, '').replace(/\\s+/g, ' ').trim();
        const parentItem = item.closest('.message-item') || item;
        const timeEl = parentItem.querySelector('.message-time .time, .time');
        const time = (timeEl?.textContent || '').trim();
        return {
          from: isSelf ? 'me' : 'other',
          text,
          time,
          type: 'text'
        };
      }).filter((m) => m.text.length > 0);

      return JSON.stringify({
        ok: true,
        messages,
        total: messages.length
      });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_chat_read_messages_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function inspectRecommendList({
  cdpClient,
  targetId,
  urlPrefix,
  limit = 10
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildInspectRecommendListExpression({ limit })
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_recommend_list_unavailable');
  }

  return result;
}

function buildInspectRecommendListExpression({ limit = 10 }) {
  return `(() => {
    try {
      const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
      const recDoc = recFrame?.contentDocument;
      if (!recFrame || !recDoc) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
      }

      const wraps = recDoc.querySelectorAll('.candidate-card-wrap');
      if (!wraps.length) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_no_cards' });
      }

      const frameRect = recFrame.getBoundingClientRect();
      const candidates = [];
      const maxItems = Math.min(wraps.length, ${Number(limit)});

      for (let i = 0; i < maxItems; i++) {
        const wrap = wraps[i];
        const inner = wrap.querySelector('.card-inner[data-geekid], .card-inner[data-geek]');
        const geekId = inner?.getAttribute('data-geekid') || inner?.getAttribute('data-geek') || '';
        const text = (wrap.innerText || '').replace(/\\s+/g, ' ').trim();

        // Find greet button in the full wrap (not just card-inner)
        const greetBtn = wrap.querySelector('button.btn-greet, .btn-greet, .button-chat .btn-doc');
        const greetBtnText = greetBtn ? (greetBtn.textContent || '').trim() : '';
        const alreadyChatting = greetBtnText === '继续沟通';
        const hasGreetBtn = Boolean(greetBtn);

        // Compute greet button coordinates for real click
        let greetX = 0, greetY = 0;
        if (greetBtn) {
          const btnRect = greetBtn.getBoundingClientRect();
          greetX = Math.round(frameRect.left + btnRect.left + btnRect.width / 2);
          greetY = Math.round(frameRect.top + btnRect.top + btnRect.height / 2);
        }

        // Compute card center coordinates for clicking to open detail popup
        const wrapRect = wrap.getBoundingClientRect();
        const cardX = Math.round(frameRect.left + wrapRect.left + wrapRect.width / 3);
        const cardY = Math.round(frameRect.top + wrapRect.top + wrapRect.height / 2);

        candidates.push({
          index: i,
          geekId,
          text: text.slice(0, 1500),
          alreadyChatting,
          hasGreetBtn,
          greetBtnText,
          greetX,
          greetY,
          cardX,
          cardY
        });
      }

      return JSON.stringify({ ok: true, total: wraps.length, candidates });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_list_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function clickRecommendGreetByCoords({
  cdpClient,
  targetId,
  urlPrefix,
  x,
  y
} = {}) {
  await cdpClient.dispatchMouseClick({ targetId, urlPrefix, x, y });
  await randomDelay(2_000, 3_000);

  // Check for confirmation dialog or result
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildRecommendGreetResultExpression()
  });

  return {
    ok: true,
    greeted: true,
    resultText: result?.resultText || '',
    alreadyChatting: result?.alreadyChatting || false
  };
}

async function scrollRecommendCardIntoView({
  cdpClient,
  targetId,
  urlPrefix,
  cardIndex
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: `(() => {
      try {
        const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
        const recDoc = recFrame?.contentDocument;
        if (!recFrame || !recDoc) return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
        const wraps = recDoc.querySelectorAll('.candidate-card-wrap');
        const wrap = wraps[${Number(cardIndex)}];
        if (!wrap) return JSON.stringify({ ok: false, reason: 'boss_recommend_card_not_found' });
        wrap.scrollIntoView({ block: 'center', behavior: 'instant' });
        const frameRect = recFrame.getBoundingClientRect();
        const rect = wrap.getBoundingClientRect();
        return JSON.stringify({
          ok: true,
          cardX: Math.round(frameRect.left + rect.left + rect.width / 3),
          cardY: Math.round(frameRect.top + rect.top + rect.height / 2)
        });
      } catch (err) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_scroll_error:' + (err && err.message || String(err)) });
      }
    })()`
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_recommend_scroll_failed');
  }

  await randomDelay(300, 600);
  return result;
}

async function switchRecommendToLatest({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const target = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: `(() => {
      try {
        const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
        const recDoc = recFrame?.contentDocument;
        if (!recFrame || !recDoc) return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
        const tabs = Array.from(recDoc.querySelectorAll('.tab-item'));
        const latestTab = tabs.find(t => (t.textContent || '').trim() === '最新');
        if (!latestTab) return JSON.stringify({ ok: false, reason: 'boss_recommend_latest_tab_not_found' });
        if (latestTab.classList.contains('curr')) return JSON.stringify({ ok: true, alreadyActive: true });
        const frameRect = recFrame.getBoundingClientRect();
        const rect = latestTab.getBoundingClientRect();
        return JSON.stringify({
          ok: true,
          alreadyActive: false,
          x: frameRect.left + rect.left + rect.width / 2,
          y: frameRect.top + rect.top + rect.height / 2
        });
      } catch (err) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_latest_tab_error:' + (err && err.message || String(err)) });
      }
    })()`
  });

  if (!target?.ok) {
    throw new Error(target?.reason || 'boss_recommend_latest_tab_failed');
  }

  if (target.alreadyActive) {
    return { ok: true, alreadyActive: true };
  }

  await cdpClient.dispatchMouseClick({ targetId, urlPrefix, x: target.x, y: target.y });
  await randomDelay(2_000, 3_000);
  return { ok: true, alreadyActive: false };
}

async function clickAtCoords({
  cdpClient,
  targetId,
  urlPrefix,
  x,
  y
} = {}) {
  await cdpClient.dispatchMouseClick({ targetId, urlPrefix, x, y });
  await randomDelay(1_000, 2_000);
  return { ok: true, x, y };
}

async function closeRecommendPopup({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const target = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: `(() => {
      try {
        const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
        const recDoc = recFrame?.contentDocument;
        if (!recFrame || !recDoc) return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
        const closeBtn = recDoc.querySelector('.boss-popup__close');
        if (!closeBtn) return JSON.stringify({ ok: false, reason: 'boss_recommend_popup_close_not_found' });
        const frameRect = recFrame.getBoundingClientRect();
        const rect = closeBtn.getBoundingClientRect();
        return JSON.stringify({
          ok: true,
          x: frameRect.left + rect.left + rect.width / 2,
          y: frameRect.top + rect.top + rect.height / 2
        });
      } catch (err) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_popup_close_error:' + (err && err.message || String(err)) });
      }
    })()`
  });

  if (!target?.ok) {
    return { ok: true, closed: false, reason: target?.reason || 'no_popup' };
  }

  await cdpClient.dispatchMouseClick({ targetId, urlPrefix, x: target.x, y: target.y });
  await randomDelay(500, 1_000);
  return { ok: true, closed: true };
}

async function switchRecommendToGridView({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildSwitchRecommendViewExpression()
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_recommend_view_switch_failed');
  }

  if (!result.alreadyGrid) {
    await randomDelay(2_000, 3_000);
  }

  return result;
}

function buildSwitchRecommendViewExpression() {
  return `(() => {
    try {
      const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
      const recDoc = recFrame?.contentDocument;
      if (!recFrame || !recDoc) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
      }

      // Already in grid/card mode if detail-wrap exists
      const detailWrap = recDoc.querySelector('.resume-detail-wrap');
      if (detailWrap) {
        return JSON.stringify({ ok: true, alreadyGrid: true });
      }

      // .mode-switcher-wrap has two .mode-item spans: first is card/grid, second (curr) is list
      const modeItems = recDoc.querySelectorAll('.mode-switcher-wrap .mode-item');
      if (modeItems.length >= 2) {
        const gridBtn = modeItems[0];
        if (!gridBtn.classList.contains('curr')) {
          gridBtn.click();
          return JSON.stringify({ ok: true, alreadyGrid: false, method: 'mode-switcher' });
        }
        return JSON.stringify({ ok: true, alreadyGrid: true });
      }

      return JSON.stringify({ ok: false, reason: 'boss_recommend_grid_toggle_not_found' });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_view_switch_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function selectRecommendJob({
  cdpClient,
  targetId,
  urlPrefix,
  jobName
} = {}) {
  if (!jobName) {
    throw new Error('boss_recommend_job_name_required');
  }

  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildSelectRecommendJobExpression({ jobName })
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_recommend_job_select_failed');
  }

  await randomDelay(2_000, 3_000);

  return result;
}

function buildSelectRecommendJobExpression({ jobName }) {
  return `(() => {
    try {
      const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
      const recDoc = recFrame?.contentDocument;
      if (!recFrame || !recDoc) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
      }

      const items = recDoc.querySelectorAll('.job-list .job-item');
      if (!items.length) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_no_job_items' });
      }

      const keyword = ${JSON.stringify(jobName)};
      let target = null;
      const available = [];
      for (const item of items) {
        const text = (item.textContent || '').replace(/\\s+/g, ' ').trim();
        available.push(text.slice(0, 80));
        if (text.includes(keyword)) {
          target = item;
        }
      }

      if (!target) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_job_not_found', available });
      }

      if (target.classList.contains('curr')) {
        return JSON.stringify({ ok: true, alreadySelected: true, selected: (target.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) });
      }

      target.click();
      return JSON.stringify({ ok: true, alreadySelected: false, selected: (target.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_job_select_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function clickFirstRecommendCard({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildClickFirstRecommendCardExpression()
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_recommend_first_card_click_failed');
  }

  // Use real mouse click at the computed absolute coordinates
  if (result.x && result.y) {
    await cdpClient.dispatchMouseClick({
      targetId,
      urlPrefix,
      x: result.x,
      y: result.y
    });
  }

  await randomDelay(1_500, 2_500);

  return result;
}

function buildClickFirstRecommendCardExpression() {
  return `(() => {
    try {
      const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
      const recDoc = recFrame?.contentDocument;
      if (!recFrame || !recDoc) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_frame_unavailable' });
      }

      const cards = recDoc.querySelectorAll('.card-inner, .geek-card, .candidate-card-wrap, [class*="geek-card"]');
      if (!cards.length) {
        return JSON.stringify({ ok: false, reason: 'boss_recommend_no_cards' });
      }

      const frameRect = recFrame.getBoundingClientRect();

      // Find first card that is visible within the iframe viewport
      let targetCard = null;
      for (const card of cards) {
        const cr = card.getBoundingClientRect();
        if (cr.top >= 0 && cr.bottom <= frameRect.height && cr.height > 0) {
          targetCard = card;
          break;
        }
      }
      if (!targetCard) {
        targetCard = cards[0];
      }

      const cardRect = targetCard.getBoundingClientRect();
      const absX = Math.round(frameRect.left + cardRect.left + cardRect.width / 2);
      const absY = Math.round(frameRect.top + cardRect.top + cardRect.height / 2);

      return JSON.stringify({
        ok: true,
        x: absX,
        y: absY,
        cardText: (targetCard.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100)
      });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_first_card_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function scrapeRecruitData({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const currentUrl = await getUrl({ cdpClient, targetId, urlPrefix });
  const isRecruitPage = currentUrl.includes('/web/chat/data-recruit');

  if (!isRecruitPage) {
    await navigateTo({ cdpClient, targetId, urlPrefix, url: 'https://www.zhipin.com/web/chat/data-recruit' });
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildScrapeRecruitDataExpression()
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_recruit_data_scrape_failed');
  }

  if (!isRecruitPage) {
    await navigateTo({ cdpClient, targetId, urlPrefix, url: currentUrl });
  }

  return result;
}

function buildScrapeRecruitDataExpression() {
  return `(() => {
    try {
      const iframe = document.querySelector('iframe[src*="data-center"], iframe[src*="report"]');
      const doc = iframe?.contentDocument;
      if (!iframe || !doc) {
        return JSON.stringify({ ok: false, reason: 'boss_recruit_iframe_not_found' });
      }

      const cards = doc.querySelectorAll('.today-num');
      if (!cards.length) {
        return JSON.stringify({ ok: false, reason: 'boss_recruit_data_cards_not_found' });
      }

      const metrics = {};
      const metricKeyMap = {
        '我看过': 'viewed',
        '看过我': 'viewedMe',
        '我打招呼': 'greeted',
        '牛人新招呼': 'newGreetings',
        '我沟通': 'chatted',
        '收获简历': 'resumesReceived',
        '交换电话微信': 'contactExchanged',
        '接受面试': 'interviewAccepted'
      };

      cards.forEach(el => {
        const card = el.closest('[class*="data-card"]') || el.closest('[class*="card-item"]') || el.parentElement?.parentElement;
        const h4 = card ? card.querySelector('h4.name') : null;
        const title = h4 ? (h4.childNodes[0]?.textContent || '').trim() : '';
        const value = parseInt(el.textContent.trim(), 10) || 0;

        const trendEl = card ? card.querySelector('.trend-data') : null;
        const trendText = trendEl ? trendEl.textContent.replace(/\\s+/g, ' ').trim() : '';
        const trendMatch = trendText.match(/([+-])\\s*(\\d+)/);
        const delta = trendMatch ? parseInt(trendMatch[1] + trendMatch[2], 10) : 0;

        const key = metricKeyMap[title];
        if (key) {
          metrics[key] = { value, delta };
        }
      });

      const quotaPatterns = (doc.body?.innerText || '').match(/(\\d+)\\s*\\/\\s*(\\d+)/g) || [];
      const quotas = quotaPatterns.map(p => {
        const m = p.match(/(\\d+)\\s*\\/\\s*(\\d+)/);
        return m ? { used: parseInt(m[1], 10), total: parseInt(m[2], 10) } : null;
      }).filter(Boolean);

      return JSON.stringify({
        ok: true,
        metrics,
        quotas: {
          view: quotas[0] || null,
          chat: quotas[1] || null
        },
        scrapedAt: new Date().toISOString()
      });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recruit_data_scrape_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function closeResumeDetail({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildCloseResumeDetailExpression()
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_close_resume_detail_failed');
  }

  return result;
}

function buildCloseResumeDetailExpression() {
  return `(() => {
    try {
      const iframe = document.querySelector('iframe.attachment-box.attachment-iframe, iframe[src*="preview4boss"], iframe[src*="pdf-viewer-b"]');
      if (!iframe) {
        return JSON.stringify({ ok: true, closed: false, reason: 'no_preview_open' });
      }

      const activeDialog = document.querySelector('.dialog-wrap.active');
      if (activeDialog) {
        const closeBtn = activeDialog.querySelector('.boss-popup__close, .icon-close, .iboss-close');
        if (closeBtn) {
          closeBtn.click();
          return JSON.stringify({ ok: true, closed: true, method: 'active_dialog_close' });
        }
      }

      const overlay = iframe.closest('.dialog-wrap, .dialog-container, .dialog-resume-full');
      if (overlay) {
        const closeBtn = overlay.querySelector('.boss-popup__close, .icon-close, .iboss-close');
        if (closeBtn) {
          closeBtn.click();
          return JSON.stringify({ ok: true, closed: true, method: 'overlay_close' });
        }
      }

      iframe.remove();
      if (overlay) {
        overlay.remove();
      }
      return JSON.stringify({ ok: true, closed: true, method: 'dom_removal' });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_close_resume_detail_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

module.exports = {
  getUrl,
  evaluateJson,
  bossFetch,
  selectChatJobFilter,
  selectChatUnreadFilter,
  inspectVisibleChatList,
  clickChatRow,
  navigateTo,
  clickRecommendPager,
  clickRecommendGreet,
  inspectRecommendState,
  inspectRecommendDetail,
  inspectContextSnapshot,
  openChatThread,
  inspectChatThreadState,
  inspectAttachmentState,
  inspectResumePreviewMeta,
  downloadResumeAttachment,
  bringToFront,
  realClick,
  realClickByText,
  sendChatMessage,
  clickRequestResume,
  readOpenThreadMessages,
  selectRecommendJob,
  clickFirstRecommendCard,
  switchRecommendToGridView,
  inspectRecommendList,
  clickRecommendGreetByCoords,
  closeRecommendPopup,
  clickAtCoords,
  switchRecommendToLatest,
  scrollRecommendCardIntoView,
  closeResumeDetail,
  scrapeRecruitData,
};
