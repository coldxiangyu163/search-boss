function randomDelay(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let _lastMouseX = 400 + Math.random() * 200;
let _lastMouseY = 300 + Math.random() * 200;

async function humanMouseMove({ cdpClient, targetId, urlPrefix, toX, toY }) {
  const fromX = _lastMouseX;
  const fromY = _lastMouseY;
  const dist = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
  const steps = Math.max(5, Math.min(25, Math.floor(dist / 30)));
  const cp1x = fromX + (toX - fromX) * (0.2 + Math.random() * 0.3);
  const cp1y = fromY + (toY - fromY) * (0.1 + Math.random() * 0.2) + (Math.random() - 0.5) * 40;
  const cp2x = fromX + (toX - fromX) * (0.5 + Math.random() * 0.3);
  const cp2y = fromY + (toY - fromY) * (0.7 + Math.random() * 0.2) + (Math.random() - 0.5) * 30;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const it = 1 - t;
    const x = it * it * it * fromX + 3 * it * it * t * cp1x + 3 * it * t * t * cp2x + t * t * t * toX;
    const y = it * it * it * fromY + 3 * it * it * t * cp1y + 3 * it * t * t * cp2y + t * t * t * toY;

    try {
      await cdpClient.sendCommand({
        targetId,
        urlPrefix,
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) }
      });
    } catch (_) {
      // non-fatal
    }
    await new Promise((r) => setTimeout(r, 8 + Math.random() * 16));
  }

  _lastMouseX = toX;
  _lastMouseY = toY;
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

  await humanMouseMove({ cdpClient, targetId, urlPrefix, toX: result.x, toY: result.y });
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

  await humanMouseMove({ cdpClient, targetId, urlPrefix, toX: result.x, toY: result.y });
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

  await humanMouseMove({ cdpClient, targetId, urlPrefix, toX: target.x, toY: target.y });
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
    const headers = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': window.location.href,
      'Accept': 'application/json, text/plain, */*'
    };

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

    const isViewerReady = (iframe) => {
      if (!iframe) {
        return false;
      }

      const loadedAttr = iframe.getAttribute ? iframe.getAttribute('data-loaded') : '';
      if (loadedAttr === 'true' || iframe.dataset?.loaded === 'true') {
        return true;
      }

      try {
        const frameDoc = iframe.contentDocument || iframe.contentWindow?.document || null;
        if (!frameDoc) {
          return false;
        }

        if (String(frameDoc.readyState || '').toLowerCase() !== 'complete') {
          return false;
        }

        const viewerRoot = frameDoc.querySelector(
          'embed[type="application/pdf"], object[type="application/pdf"], canvas, .pdfViewer, #viewer, #app, [class*="viewer"]'
        );
        const viewerText = normalizeText(frameDoc.body?.innerText || '');
        return Boolean(viewerRoot || viewerText);
      } catch (_) {
        return false;
      }
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
        viewerReady: isViewerReady(iframe),
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

        const deadline = Date.now() + ${timeoutMs};
        let readyPolls = state.viewerReady ? 1 : 0;
        while (Date.now() < deadline) {
          if (state.hasPreview && state.downloadUrl && readyPolls >= 2) {
            break;
          }
          await sleep(250);
          state = findPreviewState();
          readyPolls = state.viewerReady ? readyPolls + 1 : 0;
        }

        if (!state.hasPreview || !state.downloadUrl) {
          return JSON.stringify({ ok: false, reason: 'boss_resume_preview_url_unavailable' });
        }

        if (readyPolls < 2) {
          return JSON.stringify({ ok: false, reason: 'boss_resume_preview_not_ready' });
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

  const preClickQuotaState = await inspectRecommendQuotaState({
    cdpClient,
    targetId,
    urlPrefix
  });

  if (preClickQuotaState?.blocked) {
    return {
      ok: false,
      greeted: false,
      resultText: preClickQuotaState.dialogText || '',
      alreadyChatting: false,
      quotaExhausted: true,
      reason: preClickQuotaState.reason || 'boss_chat_quota_exhausted'
    };
  }

  await humanMouseMove({ cdpClient, targetId, urlPrefix, toX: target.x, toY: target.y });
  await cdpClient.dispatchMouseClick({
    targetId,
    urlPrefix,
    x: target.x,
    y: target.y
  });

  const clickedAt = Date.now();
  let settled = false;
  let pendingReason = 'boss_recommend_greet_result_pending';
  while (!settled && Date.now() - clickedAt < 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const quotaState = await inspectRecommendQuotaState({
        cdpClient,
        targetId,
        urlPrefix
      });
      if (quotaState?.blocked) {
        return {
          ok: false,
          greeted: false,
          resultText: quotaState.dialogText || '',
          alreadyChatting: false,
          quotaExhausted: true,
          reason: quotaState.reason || 'boss_chat_quota_exhausted'
        };
      }

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
      pendingReason = state?.reason || pendingReason;
    } catch (_) {
      // ignore transient errors during stabilization
    }
  }

  const finalQuotaState = await inspectRecommendQuotaState({
    cdpClient,
    targetId,
    urlPrefix
  });

  if (finalQuotaState?.blocked) {
    return {
      ok: false,
      greeted: false,
      resultText: finalQuotaState.dialogText || '',
      alreadyChatting: false,
      quotaExhausted: true,
      reason: finalQuotaState.reason || 'boss_chat_quota_exhausted'
    };
  }

  return {
    ok: false,
    greeted: false,
    resultText: '',
    alreadyChatting: false,
    quotaExhausted: false,
    reason: pendingReason
  };
}

async function inspectRecommendQuotaState({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildRecommendQuotaStateExpression()
  });

  if (!result?.ok) {
    return { ok: false, blocked: false, reason: result?.reason || 'boss_recommend_quota_state_unavailable' };
  }

  return result;
}

function buildRecommendQuotaStateExpression() {
  return `(() => {
    try {
      const keywordPattern = /今日沟通权益数已达上限|沟通权益数已达上限|需付费购买/;
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) !== 0
          && rect.width > 0
          && rect.height > 0;
      };

      const selectors = [
        '.dialog-wrap.active',
        '.boss-dialog__wrapper',
        '.business-block-wrap',
        '.boss-popup__wrapper',
        '.dialog-container'
      ];

      const candidates = selectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .filter((el, index, arr) => arr.indexOf(el) === index);

      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
        if (text && keywordPattern.test(text)) {
          return JSON.stringify({
            ok: true,
            blocked: true,
            reason: 'boss_chat_quota_exhausted',
            dialogText: text.slice(0, 200)
          });
        }
      }

      return JSON.stringify({ ok: true, blocked: false });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_recommend_quota_state_error:' + (err && err.message || String(err)) });
    }
  })()`;
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

  // Step 2: Human-like mouse move then click at the row's coordinates
  await humanMouseMove({ cdpClient, targetId, urlPrefix, toX: result.x, toY: result.y });
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

  let beforeMessages = [];
  try {
    const beforeState = await readOpenThreadMessages({
      cdpClient,
      targetId,
      urlPrefix,
      limit: 20
    });
    beforeMessages = Array.isArray(beforeState?.messages) ? beforeState.messages : [];
  } catch (_) {
    // best-effort verification only
  }

  // Step 1: Focus editor and select existing content before inserting native text events
  const insertResult = await evaluateJson({
    cdpClient, targetId, urlPrefix,
    expression: `(() => {
      const selectors = [
        '.boss-chat-editor-input[contenteditable="true"]',
        '.boss-chat-editor-input',
        '.chat-editor [contenteditable="true"]',
        '.chat-input [contenteditable="true"]',
        '.message-editor [contenteditable="true"]',
        '.chat-conversation [contenteditable="true"]',
        '[contenteditable="true"]',
        'textarea',
      ];
      let editor = null;
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { editor = el; break; }
      }
      if (!editor) return JSON.stringify({ ok: false, reason: 'boss_chat_editor_not_found' });
      editor.focus();
      if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
        if (typeof editor.select === 'function') {
          editor.select();
        }
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return JSON.stringify({ ok: true, tagName: editor.tagName });
    })()`
  });

  if (!insertResult?.ok) {
    throw new Error(insertResult?.reason || 'boss_chat_editor_not_found');
  }

  if (typeof cdpClient.dispatchInsertText === 'function') {
    for (let ci = 0; ci < text.length; ci++) {
      await cdpClient.dispatchInsertText({ targetId, urlPrefix, text: text[ci] });
      const charDelay = 80 + Math.random() * 120;
      await new Promise((resolve) => setTimeout(resolve, charDelay));
      if (ci > 0 && ci % (4 + Math.floor(Math.random() * 4)) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));
      }
    }
  } else {
    const fallbackInsert = await evaluateJson({
      cdpClient, targetId, urlPrefix,
      expression: `(() => {
        const editor = document.querySelector('.boss-chat-editor-input[contenteditable="true"], .boss-chat-editor-input, .chat-editor [contenteditable="true"], .chat-input [contenteditable="true"], .message-editor [contenteditable="true"], .chat-conversation [contenteditable="true"], [contenteditable="true"], textarea');
        if (!editor) return JSON.stringify({ ok: false, reason: 'boss_chat_editor_not_found' });
        if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
          editor.value = ${JSON.stringify(text)};
        } else {
          editor.textContent = '';
          document.execCommand('insertText', false, ${JSON.stringify(text)});
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return JSON.stringify({ ok: true });
      })()`
    });
    if (!fallbackInsert?.ok) {
      throw new Error(fallbackInsert?.reason || 'boss_chat_editor_insert_failed');
    }
  }

  let composerState = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    composerState = await evaluateJson({
      cdpClient, targetId, urlPrefix,
      expression: `(() => {
        const editor = document.querySelector('.boss-chat-editor-input[contenteditable="true"], .boss-chat-editor-input, .chat-editor [contenteditable="true"], .chat-input [contenteditable="true"], .message-editor [contenteditable="true"], .chat-conversation [contenteditable="true"], [contenteditable="true"], textarea');
        const btn = document.querySelector('.conversation-editor .submit')
                 || document.querySelector('.submit-content .submit')
                 || document.querySelector('.conversation-operate .submit');
        if (!editor) return JSON.stringify({ ok: false, reason: 'boss_chat_editor_not_found' });
        const editorText = editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT'
          ? (editor.value || '')
          : (editor.textContent || '');
        return JSON.stringify({
          ok: true,
          editorTextLength: editorText.length,
          submitActive: Boolean(btn && btn.classList.contains('active')),
          submitVisible: Boolean(btn && btn.offsetParent !== null)
        });
      })()`
    });

    if (composerState?.ok && composerState.editorTextLength > 0) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (!composerState?.ok || composerState.editorTextLength === 0) {
    throw new Error('boss_chat_message_insert_failed');
  }

  await randomDelay(300, 700);

  // Step 2: Send via click on send button (more reliable than Enter key)
  let sent = false;
  let method = 'all_methods_failed';
  try {
    const clickResult = await evaluateJson({
      cdpClient, targetId, urlPrefix,
      expression: `(() => {
        const btn = document.querySelector('.conversation-editor .submit')
                 || document.querySelector('.submit-content .submit')
                 || document.querySelector('.conversation-operate .submit');
        if (btn && btn.offsetParent !== null && btn.classList.contains('active')) {
          btn.click();
          return JSON.stringify({ clicked: true });
        }
        return JSON.stringify({ clicked: false });
      })()`
    });
    if (clickResult?.clicked) {
      sent = true;
      method = 'button_click';
    }
  } catch (_) {
    // button click failed, will try fallback
  }

  // Step 2b: Fallback — real mouse click on send button
  if (!sent) {
    try {
      await realClick({ cdpClient, targetId, urlPrefix, selector: '.conversation-editor .submit, .submit-content .submit, .conversation-operate .submit' });
      sent = true;
      method = 'real_click';
    } catch (_) {
      // real click also failed
    }
  }

  // Step 2c: Fallback — click by text "发送"
  if (!sent) {
    try {
      await realClickByText({ cdpClient, targetId, urlPrefix, text: '发送' });
      sent = true;
      method = 'text_click';
    } catch (_) {
      // text click also failed
    }
  }

  // Step 3: Last resort — Enter key
  if (!sent) {
    try {
      await cdpClient.dispatchKeyDown({ targetId, urlPrefix, key: 'Enter', code: 'Enter', keyCode: 13, type: 'rawKeyDown' });
      await cdpClient.dispatchKeyDown({ targetId, urlPrefix, key: 'Enter', code: 'Enter', keyCode: 13, type: 'char', text: '\n' });
      await cdpClient.dispatchKeyDown({ targetId, urlPrefix, key: 'Enter', code: 'Enter', keyCode: 13, type: 'keyUp' });
      sent = true;
      method = 'enter_key';
    } catch (_) {
      // Enter key dispatch failed
    }
  }

  if (!sent) {
    return { ok: true, sent: false, verified: false, textLength: text.length, method };
  }

  await randomDelay(600, 1_200);

  let editorCleared = false;
  let messageAppeared = false;

  for (let attempt = 0; attempt < 12; attempt++) {
    const postCheck = await evaluateJson({
      cdpClient, targetId, urlPrefix,
      expression: `(() => {
        const editor = document.querySelector('.boss-chat-editor-input[contenteditable="true"], .boss-chat-editor-input, .chat-editor [contenteditable="true"], .chat-input [contenteditable="true"], .message-editor [contenteditable="true"], .chat-conversation [contenteditable="true"], [contenteditable="true"], textarea');
        const btn = document.querySelector('.conversation-editor .submit')
                 || document.querySelector('.submit-content .submit')
                 || document.querySelector('.conversation-operate .submit');
        if (!editor) return JSON.stringify({ ok: false, reason: 'boss_chat_editor_not_found' });
        const editorText = editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT'
          ? (editor.value || '')
          : (editor.textContent || '');
        return JSON.stringify({
          ok: true,
          len: editorText.length,
          submitActive: Boolean(btn && btn.classList.contains('active'))
        });
      })()`
    });

    editorCleared = postCheck?.ok && postCheck?.len === 0 && postCheck?.submitActive === false;

    try {
      const afterState = await readOpenThreadMessages({
        cdpClient,
        targetId,
        urlPrefix,
        limit: 20
      });
      const afterMessages = Array.isArray(afterState?.messages) ? afterState.messages : [];
      messageAppeared = didOpenThreadSendMessage({
        beforeMessages,
        afterMessages,
        text
      });
    } catch (_) {
      // best-effort verification only
    }

    if (messageAppeared) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return {
    ok: true,
    sent: true,
    verified: messageAppeared,
    editorCleared,
    textLength: text.length,
    method: messageAppeared ? method : `${method}_unverified`
  };
}

async function clickRequestResume({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  // Phase 1: Wait for "求简历" button to become enabled (up to 8 seconds)
  let waitedMs = 0;
  let buttonReady = false;
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

    if (state?.found && !state?.disabled) {
      buttonReady = true;
      break;
    }
    if (!state?.found) {
      throw new Error('boss_chat_request_resume_button_not_found');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    waitedMs += 500;
  }

  if (!buttonReady) {
    throw new Error('boss_chat_request_resume_button_disabled');
  }

  // Phase 2: Real mouse click on "求简历"
  try {
    await realClickByText({ cdpClient, targetId, urlPrefix, text: '求简历' });
  } catch (error) {
    throw new Error('boss_chat_request_resume_button_disabled');
  }

  // Phase 3: Wait for visible exchange-tooltip confirm dialog and real-click "确定" (up to 5 seconds)
  // Multiple .exchange-tooltip elements exist (one per action button); only the active one is visible
  let confirmed = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const dialogState = await evaluateJson({
      cdpClient, targetId, urlPrefix,
      expression: `(() => {
        const tooltips = document.querySelectorAll('.exchange-tooltip');
        const tooltip = Array.from(tooltips).find(t => t.offsetWidth > 0 && t.offsetHeight > 0);
        if (!tooltip) return JSON.stringify({ found: false });
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
  return { ok: true, requested: confirmed, confirmed, waitedMs };
}

async function clickExchangeAction({
  cdpClient,
  targetId,
  urlPrefix,
  actionText = '求简历'
} = {}) {
  const errorPrefix = `boss_chat_exchange_${actionText}`;

  // Phase 1: Wait for button to become enabled (up to 15 seconds)
  let waitedMs = 0;
  let buttonReady = false;
  for (let i = 0; i < 30; i++) {
    const escapedText = actionText.replace(/'/g, "\\'");
    const state = await evaluateJson({
      cdpClient, targetId, urlPrefix,
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button, a, span, div')).find(n => {
          const t = (n.textContent || '').replace(/\\s+/g, '').trim();
          return t === '${escapedText}' && n.offsetWidth > 0;
        });
        if (!btn) return JSON.stringify({ found: false });
        const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('disabled');
        return JSON.stringify({ found: true, disabled });
      })()`
    });

    if (state?.found && !state?.disabled) {
      buttonReady = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    waitedMs += 500;
  }

  if (!buttonReady) {
    throw new Error(`${errorPrefix}_button_not_ready`);
  }

  // Phase 2: Real mouse click on the button
  try {
    await realClickByText({ cdpClient, targetId, urlPrefix, text: actionText });
  } catch (error) {
    throw new Error(`${errorPrefix}_button_disabled`);
  }

  // Phase 3: Wait for visible exchange-tooltip confirm dialog and real-click "确定" (up to 5 seconds)
  // Multiple .exchange-tooltip elements exist (one per action button); only the active one is visible
  let confirmed = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const dialogState = await evaluateJson({
      cdpClient, targetId, urlPrefix,
      expression: `(() => {
        const tooltips = document.querySelectorAll('.exchange-tooltip');
        const tooltip = Array.from(tooltips).find(t => t.offsetWidth > 0 && t.offsetHeight > 0);
        if (!tooltip) return JSON.stringify({ found: false });
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
  return { ok: true, actionText, requested: confirmed, confirmed, waitedMs };
}

async function inspectResumeRequestState({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildInspectResumeRequestStateExpression()
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_chat_request_resume_state_failed');
  }

  return result;
}

function buildInspectResumeRequestStateExpression() {
  return `(() => {
    try {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const btn = Array.from(document.querySelectorAll('button, a, span, div')).find((node) => {
        const text = normalize(node.textContent || '');
        return text === '求简历' && node.offsetWidth > 0;
      });
      if (!btn) {
        return JSON.stringify({ ok: false, reason: 'boss_chat_request_resume_button_not_found' });
      }

      const disabled = Boolean(
        btn.disabled
        || btn.getAttribute('aria-disabled') === 'true'
        || btn.classList.contains('disabled')
      );
      const container = btn.closest('.operate-icon-item, .operate-exchange-left, .conversation-operate') || btn.parentElement || btn;
      const surroundingText = normalize(container.textContent || '');
      const hintText = normalize(
        surroundingText
          .replace(/求简历/g, '')
          .replace(/^[：:]/, '')
      );

      return JSON.stringify({
        ok: true,
        found: true,
        enabled: !disabled,
        disabled,
        className: btn.className || '',
        hintText,
        surroundingText
      });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_chat_request_resume_state_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

function normalizeChatMessageText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function didOpenThreadSendMessage({ beforeMessages = [], afterMessages = [], text }) {
  const expected = normalizeChatMessageText(text);
  if (!expected || !Array.isArray(afterMessages) || afterMessages.length === 0) {
    return false;
  }

  const beforeMatches = beforeMessages.filter((message) =>
    message?.from === 'me' && normalizeChatMessageText(message?.text) === expected
  ).length;
  const afterMatches = afterMessages.filter((message) =>
    message?.from === 'me' && normalizeChatMessageText(message?.text) === expected
  ).length;

  return afterMatches > beforeMatches;
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
        const keyNodes = [item, parentItem];
        const keyAttrs = ['data-mid', 'data-message-id', 'data-msgid', 'data-id', 'data-key'];
        let domKey = '';
        for (const node of keyNodes) {
          if (!node || domKey) continue;
          for (const attr of keyAttrs) {
            const value = node.getAttribute && node.getAttribute(attr);
            if (value) {
              domKey = String(value).trim();
              break;
            }
          }
        }
        return {
          from: isSelf ? 'me' : 'other',
          text,
          time,
          type: 'text',
          domKey
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

        // Extract structured fields from DOM
        const nameEl = wrap.querySelector('.name-wrap .name');
        const name = nameEl ? (nameEl.textContent || '').trim() : '';
        const salaryEl = wrap.querySelector('.salary-wrap span');
        const salary = salaryEl ? (salaryEl.textContent || '').trim() : '';
        const expectContent = wrap.querySelector('.expect-wrap .content');
        const expectSpans = expectContent ? expectContent.querySelectorAll('span') : [];
        const city = expectSpans.length ? (expectSpans[0].textContent || '').trim() : '';
        const baseInfoEl = wrap.querySelector('.base-info');
        const baseText = baseInfoEl ? (baseInfoEl.textContent || '').trim() : '';
        const eduMatch = baseText.match(/(本科|大专|硕士|博士)/);
        const education = eduMatch ? eduMatch[1] : '';
        const expMatch = baseText.match(/(\\d+年(?:以上)?)/);
        const experience = expMatch ? expMatch[1] : '';

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
          name,
          salary,
          city,
          education,
          experience,
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
  await humanMouseMove({ cdpClient, targetId, urlPrefix, toX: x, toY: y });
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
        wrap.scrollIntoView({ block: 'center', behavior: 'auto' });
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

  await randomDelay(500, 1000);
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
  await humanMouseMove({ cdpClient, targetId, urlPrefix, toX: x, toY: y });
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

async function inspectResumeConsentState({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildResumeConsentStateExpression()
  });

  if (!result?.ok) {
    throw new Error(result?.reason || 'boss_resume_consent_state_unavailable');
  }

  return result;
}

function buildResumeConsentStateExpression() {
  return `(() => {
    try {
      const threadPane = document.querySelector('.chat-conversation, .conversation-box, .chat-message-list, .conversation-message');
      if (!threadPane) {
        return JSON.stringify({ ok: true, consentPending: false, source: null });
      }

      // 1. Check the bottom notice bar (sticky, most reliable)
      const noticeBar = threadPane.querySelector('.notice-list');
      if (noticeBar && noticeBar.offsetWidth > 0) {
        const barText = (noticeBar.textContent || '').replace(/\\s+/g, ' ').trim();
        if (barText.includes('发送附件简历') && barText.includes('同意')) {
          const acceptLink = noticeBar.querySelector('a.btn');
          if (acceptLink && acceptLink.offsetWidth > 0) {
            return JSON.stringify({ ok: true, consentPending: true, source: 'notice_bar' });
          }
        }
      }

      // 2. Check in-message consent cards
      const cards = threadPane.querySelectorAll('.message-card-wrap.boss-green');
      for (const card of cards) {
        const text = (card.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text.includes('发送附件简历') && text.includes('同意')) {
          const acceptBtn = Array.from(card.querySelectorAll('.card-btn'))
            .find((btn) => (btn.textContent || '').trim() === '同意' && btn.offsetWidth > 0);
          if (acceptBtn) {
            return JSON.stringify({ ok: true, consentPending: true, source: 'message_card' });
          }
        }
      }

      return JSON.stringify({ ok: true, consentPending: false, source: null });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_resume_consent_state_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function acceptResumeConsent({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  // Step 1: Locate the accept button coordinates
  const target = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: buildAcceptResumeConsentTargetExpression()
  });

  if (!target?.ok || !target?.found) {
    throw new Error(target?.reason || 'boss_resume_consent_accept_button_not_found');
  }

  // Step 2: Real mouse click on the accept button
  await cdpClient.dispatchMouseClick({
    targetId,
    urlPrefix,
    x: target.x,
    y: target.y
  });

  // Step 3: Wait for PDF card to appear (poll up to 3 times, 1s apart)
  let attachmentAppeared = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    try {
      const state = await inspectAttachmentState({ cdpClient, targetId, urlPrefix });
      if (state?.present) {
        attachmentAppeared = true;
        break;
      }
    } catch (_) {
      // ignore transient errors during stabilization
    }
  }

  return {
    ok: true,
    accepted: true,
    source: target.source,
    attachmentAppeared
  };
}

function buildAcceptResumeConsentTargetExpression() {
  return `(() => {
    try {
      const threadPane = document.querySelector('.chat-conversation, .conversation-box, .chat-message-list, .conversation-message');
      if (!threadPane) {
        return JSON.stringify({ ok: true, found: false, reason: 'no_thread_pane' });
      }

      // 1. Prefer the bottom notice bar accept button (fixed position, always visible)
      const noticeBar = threadPane.querySelector('.notice-list');
      if (noticeBar && noticeBar.offsetWidth > 0) {
        const barText = (noticeBar.textContent || '').replace(/\\s+/g, ' ').trim();
        if (barText.includes('发送附件简历') && barText.includes('同意')) {
          const acceptLink = noticeBar.querySelector('a.btn');
          if (acceptLink && acceptLink.offsetWidth > 0) {
            const rect = acceptLink.getBoundingClientRect();
            return JSON.stringify({
              ok: true,
              found: true,
              source: 'notice_bar',
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2
            });
          }
        }
      }

      // 2. Fallback to in-message card accept button
      const cards = threadPane.querySelectorAll('.message-card-wrap.boss-green');
      for (const card of cards) {
        const text = (card.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text.includes('发送附件简历') && text.includes('同意')) {
          const acceptBtn = Array.from(card.querySelectorAll('.card-btn'))
            .find((btn) => (btn.textContent || '').trim() === '同意' && btn.offsetWidth > 0);
          if (acceptBtn) {
            const rect = acceptBtn.getBoundingClientRect();
            return JSON.stringify({
              ok: true,
              found: true,
              source: 'message_card',
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2
            });
          }
        }
      }

      return JSON.stringify({ ok: true, found: false, reason: 'no_consent_accept_button' });
    } catch (err) {
      return JSON.stringify({ ok: false, reason: 'boss_resume_consent_target_error:' + (err && err.message || String(err)) });
    }
  })()`;
}

async function setupResumeCanvasCapture({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: `(() => {
      try {
        var fr = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
        if (!fr || !fr.contentDocument) return JSON.stringify({ ok: false, reason: 'no_outer_iframe' });
        var fwin = fr.contentWindow;
        function injectFillText(iframe) {
          try {
            iframe.style.height = '1600px';
            iframe.style.minHeight = '1600px';
            var fw = iframe.contentWindow;
            if (!fw) return false;
            if (fw.__fillTextInjected) return true;
            fw.__fillTextCaptures = [];
            fw.__fillTextInjected = true;
            var orig = fw.CanvasRenderingContext2D.prototype.fillText;
            fw.CanvasRenderingContext2D.prototype.fillText = function(text, x, y) {
              if (text && String(text).trim())
                fw.__fillTextCaptures.push({ t: String(text), x: Math.round(x), y: Math.round(y) });
              return orig.apply(this, arguments);
            };
            return true;
          } catch (e) { return false; }
        }
        var existing = [].slice.call(fr.contentDocument.querySelectorAll('iframe'));
        var injected = existing.filter(function(f) { return injectFillText(f); }).length;
        if (fwin.__fillTextObserver) fwin.__fillTextObserver.disconnect();
        var obs = new fwin.MutationObserver(function(mutations) {
          mutations.forEach(function(m) {
            m.addedNodes.forEach(function(node) {
              if (!node || node.nodeType !== 1) return;
              if (node.tagName === 'IFRAME') {
                injectFillText(node);
                node.addEventListener('load', function() { injectFillText(node); });
              }
              var frames = node.querySelectorAll ? [].slice.call(node.querySelectorAll('iframe')) : [];
              frames.forEach(function(f) { injectFillText(f); f.addEventListener('load', function() { injectFillText(f); }); });
            });
          });
        });
        obs.observe(fr.contentDocument.body, { childList: true, subtree: true });
        fwin.__fillTextObserver = obs;
        return JSON.stringify({ ok: true, injected: injected, total: existing.length });
      } catch (err) {
        return JSON.stringify({ ok: false, reason: 'setup_canvas_error:' + (err && err.message || String(err)) });
      }
    })()`
  });

  return { ok: true, ...result };
}

async function resetResumeCanvasCapture({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const result = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: `(() => {
      try {
        var fr = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
        if (!fr || !fr.contentDocument) return JSON.stringify({ ok: true, reset: 0 });
        var frames = [].slice.call(fr.contentDocument.querySelectorAll('iframe'));
        var n = 0;
        frames.forEach(function(f) {
          try { if (f.contentWindow.__fillTextInjected) { f.contentWindow.__fillTextCaptures = []; n++; } } catch(e) {}
        });
        return JSON.stringify({ ok: true, reset: n });
      } catch (err) {
        return JSON.stringify({ ok: true, reset: 0 });
      }
    })()`
  });

  return { ok: true, ...result };
}

const SCROLL_STEP = 500;
const MAX_SCROLL_STEPS = 48;
const MAX_EMPTY_STREAK = 3;

async function scrollAndReadResumeDetail({
  cdpClient,
  targetId,
  urlPrefix
} = {}) {
  const readCapturesExpr = `(function(){
    var fr = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
    if (!fr || !fr.contentDocument) return JSON.stringify({ n: 0, text: '' });
    var frames = [].slice.call(fr.contentDocument.querySelectorAll('iframe'));
    var bestCaps = null, bestCount = 0;
    frames.forEach(function(f) {
      try {
        var fw = f.contentWindow; var caps = fw.__fillTextCaptures;
        if (!caps || !caps.length) return;
        var c = f.contentDocument.querySelector('canvas');
        if (!c || c.width <= 300) return;
        if (caps.length > bestCount) { bestCount = caps.length; bestCaps = caps; }
      } catch(e) {}
    });
    if (!bestCaps) return JSON.stringify({ n: 0, text: '' });
    var seen = {}, dedup = [];
    bestCaps.forEach(function(it) { var k = it.t + '|' + it.x + '|' + it.y; if (!seen[k]) { seen[k] = true; dedup.push(it); } });
    var lines = {};
    dedup.forEach(function(it) { var yk = Math.round(it.y / 8) * 8; if (!lines[yk]) lines[yk] = []; lines[yk].push(it); });
    var text = Object.keys(lines).sort(function(a,b) { return a - b; }).map(function(yk) {
      return lines[yk].sort(function(a,b) { return a.x - b.x; }).map(function(it) { return it.t; }).join('');
    }).join('\\n');
    return JSON.stringify({ n: bestCount, text: text });
  })()`;

  const scrollProbeExpr = `(function(){
    var fr = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
    if (!fr || !fr.contentDocument) return JSON.stringify({ err: 'no-iframe', mode: 'virtual', maxScroll: 2400, iframeIndex: 0 });
    var doc = fr.contentDocument;
    var win = fr.contentWindow;
    var best = null;
    function considerOuter(sel) {
      var el = doc.querySelector(sel);
      if (!el) return;
      var sh = el.scrollHeight | 0, ch = el.clientHeight | 0;
      if (sh > ch + 30) {
        var ms = sh - ch;
        if (!best || ms > best.maxScroll) best = { mode: 'outer', selector: sel, maxScroll: ms };
      }
    }
    var outerSels = ['.resume-detail-wrap', '.resume-center-side', '.resume-middle-wrap', '.boss-dialog__body', '.boss-popup__content', '.lib-standard-resume', '.resume-layout-wrap'];
    for (var i = 0; i < outerSels.length; i++) considerOuter(outerSels[i]);
    var frames = [].slice.call(doc.querySelectorAll('iframe'));
    var maxCanvasH = 0, bestCanvasFi = 0;
    for (var fi = 0; fi < frames.length; fi++) {
      try {
        var fd = frames[fi].contentDocument;
        if (!fd) continue;
        var cv = fd.querySelector('canvas');
        if (cv && cv.height >= maxCanvasH) { maxCanvasH = cv.height; bestCanvasFi = fi; }
        var de = fd.documentElement, bd = fd.body;
        if (de) {
          var sh = de.scrollHeight | 0, ch = de.clientHeight | 0;
          if (sh > ch + 30) {
            var ms = sh - ch;
            if (!best || ms > best.maxScroll) best = { mode: 'inner_doc', iframeIndex: fi, maxScroll: ms };
          }
        }
        if (bd && bd !== de) {
          var sh2 = bd.scrollHeight | 0, ch2 = bd.clientHeight | 0;
          if (sh2 > ch2 + 30) {
            var ms2 = sh2 - ch2;
            if (!best || ms2 > best.maxScroll) best = { mode: 'inner_doc', iframeIndex: fi, maxScroll: ms2 };
          }
        }
        var idw = fd.querySelector('.resume-detail-wrap');
        if (idw) {
          var sh3 = idw.scrollHeight | 0, ch3 = idw.clientHeight | 0;
          if (sh3 > ch3 + 30) {
            var ms3 = sh3 - ch3;
            if (!best || ms3 > best.maxScroll) best = { mode: 'inner_detail', iframeIndex: fi, maxScroll: ms3 };
          }
        }
      } catch(e) {}
    }
    if (!best) {
      var virt = Math.max(maxCanvasH + 400, 2400, 1600);
      return JSON.stringify({ mode: 'virtual', maxScroll: virt, iframeIndex: bestCanvasFi, maxCanvasH: maxCanvasH, fallback: true });
    }
    return JSON.stringify(best);
  })()`;

  function buildScrollApplyExpr(pos, specs) {
    const payload = JSON.stringify({
      mode: specs.mode,
      selector: specs.selector || '',
      iframeIndex: specs.iframeIndex || 0
    });
    return `(function(){
      var pos = ${pos};
      var specs = ${payload};
      var fr = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
      if (!fr || !fr.contentDocument) return;
      var doc = fr.contentDocument;
      if (specs.mode === 'outer' && specs.selector) {
        var el = doc.querySelector(specs.selector);
        if (el) el.scrollTop = pos;
        return;
      }
      var frames = [].slice.call(doc.querySelectorAll('iframe'));
      var ix = specs.iframeIndex | 0;
      var f = frames[ix];
      if (!f || !f.contentDocument) return;
      var fd = f.contentDocument;
      if (specs.mode === 'inner_detail') {
        var dw = fd.querySelector('.resume-detail-wrap');
        if (dw) dw.scrollTop = pos;
        return;
      }
      if (specs.mode === 'inner_doc' || specs.mode === 'virtual') {
        var r = fd.documentElement || fd.body;
        if (r) r.scrollTop = pos;
      }
    })()`;
  }

  const resetCapturesExpr = `(function(){
    var fr = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
    if (!fr || !fr.contentDocument) return;
    [].slice.call(fr.contentDocument.querySelectorAll('iframe')).forEach(function(f) {
      try { if (f.contentWindow.__fillTextInjected) f.contentWindow.__fillTextCaptures = []; } catch(e) {}
    });
  })()`;

  // Phase 1: Wait for canvas first render (up to 4s)
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await evaluateJson({ cdpClient, targetId, urlPrefix, expression: readCapturesExpr });
      if (r.n > 50) break;
    } catch (_) {}
  }

  // Phase 2: Probe scrollable container
  let specs = { mode: 'virtual', maxScroll: 2400, iframeIndex: 0 };
  try {
    const parsed = await evaluateJson({ cdpClient, targetId, urlPrefix, expression: scrollProbeExpr });
    if (!parsed.err && typeof parsed.maxScroll === 'number') {
      specs = parsed;
    }
  } catch (_) {}

  const maxScrollRange = Math.max(0, specs.maxScroll);
  let maxPos = maxScrollRange + SCROLL_STEP;
  if (Math.ceil(maxPos / SCROLL_STEP) + 1 > MAX_SCROLL_STEPS) {
    maxPos = MAX_SCROLL_STEPS * SCROLL_STEP;
  }

  // Phase 3: Scroll through each segment, collect canvas captures
  const segments = [];
  let consecutiveEmpty = 0;
  let stepIndex = 0;

  for (let pos = 0; pos <= maxPos && stepIndex < MAX_SCROLL_STEPS; pos += SCROLL_STEP, stepIndex++) {
    // Reset captures for this segment
    try {
      await evaluateJson({ cdpClient, targetId, urlPrefix, expression: resetCapturesExpr });
    } catch (_) {}

    // Scroll to position
    try {
      await evaluateJson({ cdpClient, targetId, urlPrefix, expression: buildScrollApplyExpr(pos, specs) });
    } catch (_) {}

    // Wait for rendering to stabilize
    let prev = 0;
    let stable = 0;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        const r = await evaluateJson({ cdpClient, targetId, urlPrefix, expression: readCapturesExpr });
        if (r.n > 0 && r.n === prev) {
          stable++;
          if (stable >= 2) break;
        } else {
          stable = 0;
        }
        prev = r.n;
      } catch (_) {}
    }

    // Read current segment text
    try {
      const r = await evaluateJson({ cdpClient, targetId, urlPrefix, expression: readCapturesExpr });
      if (r.n > 0) {
        segments.push(r.text);
        consecutiveEmpty = 0;
      } else {
        consecutiveEmpty++;
        if (consecutiveEmpty >= MAX_EMPTY_STREAK) break;
      }
    } catch (_) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= MAX_EMPTY_STREAK) break;
    }
  }

  // Phase 4: If canvas capture failed, fallback to DOM innerText
  if (segments.length === 0) {
    const fallbackExpr = `(function(){
      var fr = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
      if (!fr || !fr.contentDocument) return JSON.stringify({ ok: false });
      var sels = ['.resume-right-side', '.resume-simple-box', '.resume-detail-wrap', '.boss-popup__wrapper'];
      for (var i = 0; i < sels.length; i++) {
        var el = fr.contentDocument.querySelector(sels[i]);
        if (el) { var t = (el.innerText || '').trim(); if (t.length > 50) return JSON.stringify({ ok: true, text: t.substring(0, 10000) }); }
      }
      return JSON.stringify({ ok: false });
    })()`;

    try {
      const fb = await evaluateJson({ cdpClient, targetId, urlPrefix, expression: fallbackExpr });
      if (fb?.ok && fb.text) {
        return { ok: true, mode: 'dom_fallback', fullText: fb.text, segments: 1, textLength: fb.text.length };
      }
    } catch (_) {}

    return { ok: true, mode: 'empty', fullText: '', segments: 0, textLength: 0 };
  }

  // Phase 5: Deduplicate lines across segments
  const allLines = [];
  const seenLines = new Set();
  for (const seg of segments) {
    for (const line of seg.split('\n')) {
      const key = line.trim();
      if (key && !seenLines.has(key)) {
        seenLines.add(key);
        allLines.push(line);
      }
    }
  }

  const fullText = allLines.join('\n');
  return { ok: true, mode: 'canvas', fullText, segments: segments.length, textLength: fullText.length };
}

async function applyRecommendFilters({
  cdpClient,
  targetId,
  urlPrefix,
  filters = {}
} = {}) {
  const hasNonDefaultFilter = Object.entries(filters).some(([key, val]) => {
    if (key === 'ageMin') return val && Number(val) > 16;
    if (key === 'ageMax') return val && Number(val) < 99;
    if (Array.isArray(val)) return val.length > 0;
    return val && val !== '';
  });

  if (!hasNonDefaultFilter) {
    return { ok: true, applied: false, reason: 'all_defaults' };
  }

  // Step 1: Open the filter panel by clicking .filter-label
  const openResult = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: `(() => {
      try {
        const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
        const recDoc = recFrame?.contentDocument;
        if (!recFrame || !recDoc) return JSON.stringify({ ok: false, reason: 'frame_unavailable' });
        const label = recDoc.querySelector('.filter-label');
        if (!label || label.offsetWidth === 0) return JSON.stringify({ ok: false, reason: 'filter_label_not_found' });
        const frameRect = recFrame.getBoundingClientRect();
        const lblRect = label.getBoundingClientRect();
        return JSON.stringify({ ok: true, x: frameRect.left + lblRect.left + lblRect.width / 2, y: frameRect.top + lblRect.top + lblRect.height / 2 });
      } catch (err) { return JSON.stringify({ ok: false, reason: err.message }); }
    })()`
  });

  if (!openResult?.ok) {
    throw new Error(openResult?.reason || 'recommend_filter_panel_open_failed');
  }

  await cdpClient.dispatchMouseClick({ targetId, urlPrefix, x: openResult.x, y: openResult.y });
  await randomDelay(800, 1200);

  // Verify filter panel is now expanded (has .filter-item rows)
  const panelCheck = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: `(() => {
      const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
      const recDoc = recFrame?.contentDocument;
      const items = recDoc?.querySelectorAll('.filter-item');
      return JSON.stringify({ ok: true, itemCount: items ? items.length : 0 });
    })()`
  });

  if (!panelCheck?.itemCount) {
    throw new Error('recommend_filter_panel_not_expanded');
  }

  // Step 2: Click each configured filter option via .filter-item .option matching
  const applied = [];
  const filterMap = {
    school: '院校',
    activity: '活跃度',
    notViewed: '近期没有看过',
    notExchanged: '是否与同事交换简历',
    gender: '性别',
    jobHopFrequency: '跳槽频率',
    degree: '学历要求',
    experience: '经验要求',
    jobIntent: '求职意向',
    salary: '薪资待遇'
  };

  for (const [filterKey, filterLabel] of Object.entries(filterMap)) {
    const filterValue = filters[filterKey];
    const values = Array.isArray(filterValue)
      ? filterValue.filter((v) => v && v !== '' && v !== '不限')
      : (filterValue && filterValue !== '' && filterValue !== '不限') ? [filterValue] : [];
    if (values.length === 0) continue;

    for (const singleValue of values) {
      // scrollIntoView is called inside the expression; wait for scroll to settle
      const clickResult = await evaluateJson({
        cdpClient,
        targetId,
        urlPrefix,
        expression: buildClickFilterItemOptionExpr(filterLabel, singleValue)
      });
      await randomDelay(300, 500);

      if (clickResult?.ok && clickResult?.found) {
        await cdpClient.dispatchMouseClick({ targetId, urlPrefix, x: clickResult.x, y: clickResult.y });
        applied.push({ key: filterKey, label: filterLabel, value: singleValue });
        await randomDelay(1200, 2500);
      }
    }
  }

  // Step 3: Click "确定" button (.btn with text 确定 inside filter panel)
  const confirmResult = await evaluateJson({
    cdpClient,
    targetId,
    urlPrefix,
    expression: `(() => {
      try {
        const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
        const recDoc = recFrame?.contentDocument;
        if (!recFrame || !recDoc) return JSON.stringify({ ok: false, reason: 'frame_unavailable' });
        const panel = recDoc.querySelector('.fl.recommend-filter.op-filter') || recDoc.querySelector('.recommend-filter');
        if (!panel) return JSON.stringify({ ok: false, found: false, reason: 'panel_gone' });
        const btns = Array.from(panel.querySelectorAll('.btn'));
        const confirm = btns.find(b => (b.textContent || '').trim() === '确定' && b.offsetWidth > 0);
        if (!confirm) return JSON.stringify({ ok: false, found: false, reason: 'confirm_btn_not_found' });
        confirm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const frameRect = recFrame.getBoundingClientRect();
        const btnRect = confirm.getBoundingClientRect();
        return JSON.stringify({ ok: true, found: true, x: frameRect.left + btnRect.left + btnRect.width / 2, y: frameRect.top + btnRect.top + btnRect.height / 2 });
      } catch (err) { return JSON.stringify({ ok: false, reason: err.message }); }
    })()`
  });

  // Wait for scrollIntoView to settle before clicking confirm
  await randomDelay(300, 500);

  if (confirmResult?.ok && confirmResult?.found) {
    await cdpClient.dispatchMouseClick({ targetId, urlPrefix, x: confirmResult.x, y: confirmResult.y });
    // Wait for candidate list to refresh after filter apply
    await randomDelay(2500, 4000);
  }

  return { ok: true, applied: true, filters: applied };
}

function buildClickFilterItemOptionExpr(filterLabel, optionText) {
  const safeLabel = JSON.stringify(filterLabel);
  const safeOption = JSON.stringify(optionText.replace(/\s+/g, ''));
  return `(() => {
    try {
      const recFrame = document.querySelector('iframe[name="recommendFrame"], iframe[src*="/web/frame/recommend/"]');
      const recDoc = recFrame?.contentDocument;
      if (!recFrame || !recDoc) return JSON.stringify({ ok: false, reason: 'frame_unavailable' });
      const rows = Array.from(recDoc.querySelectorAll('.filter-item'));
      const row = rows.find(r => {
        const nameEl = r.querySelector('.name');
        if (!nameEl) return false;
        return (nameEl.textContent || '').trim().includes(${safeLabel});
      });
      if (!row) return JSON.stringify({ ok: false, found: false, reason: 'row_not_found:' + ${safeLabel} });
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const options = Array.from(row.querySelectorAll('.option'));
      const target = options.find(o => (o.textContent || '').replace(/\\s+/g, '').trim() === ${safeOption} && o.offsetWidth > 0);
      if (!target) return JSON.stringify({ ok: false, found: false, reason: 'option_not_found:' + ${safeOption} });
      const frameRect = recFrame.getBoundingClientRect();
      const optRect = target.getBoundingClientRect();
      return JSON.stringify({ ok: true, found: true, x: frameRect.left + optRect.left + optRect.width / 2, y: frameRect.top + optRect.top + optRect.height / 2 });
    } catch (err) { return JSON.stringify({ ok: false, reason: err.message }); }
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
  inspectResumeConsentState,
  acceptResumeConsent,
  inspectResumePreviewMeta,
  downloadResumeAttachment,
  bringToFront,
  realClick,
  realClickByText,
  sendChatMessage,
  clickRequestResume,
  clickExchangeAction,
  inspectResumeRequestState,
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
  setupResumeCanvasCapture,
  resetResumeCanvasCapture,
  scrollAndReadResumeDetail,
  applyRecommendFilters,
  humanMouseMove,
};
