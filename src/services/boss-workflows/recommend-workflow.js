function ensureRecommendShellReady({ currentUrl = '', snapshotText = '' } = {}) {
  if (!String(currentUrl).includes('/web/chat/recommend')) {
    throw new Error('recommend_shell_not_ready');
  }

  const text = String(snapshotText);
  if (!text.includes('推荐')) {
    throw new Error('recommend_shell_not_ready');
  }

  return { ok: true };
}

function ensureRecommendIframeReady({ snapshotText = '' } = {}) {
  const text = String(snapshotText);
  const requiredAnchors = ['推荐', '最新', '筛选'];

  if (!requiredAnchors.every((anchor) => text.includes(anchor))) {
    throw new Error('recommend_iframe_not_ready');
  }

  return { ok: true };
}

function readRecommendCards({ cards = [], jobId = '', limit = 20 } = {}) {
  const normalized = Array.isArray(cards)
    ? cards
      .filter((card) => !jobId || card.encryptJobId === jobId)
      .map((card) => ({
        name: card.name || '',
        jobName: card.jobName || '',
        labels: Array.isArray(card.labels) ? card.labels.join(', ') : String(card.labels || ''),
        encryptUid: card.encryptUid || '',
        encryptJobId: card.encryptJobId || ''
      }))
    : [];

  return normalized.slice(0, Number(limit || 20));
}

module.exports = {
  ensureRecommendShellReady,
  ensureRecommendIframeReady,
  readRecommendCards
};
