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

module.exports = {
  getUrl,
  evaluateJson,
  bossFetch,
  clickRecommendPager,
  inspectRecommendState,
  inspectRecommendDetail
};
