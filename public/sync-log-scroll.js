(function attachSyncLogScroll(globalScope) {
  const SNAP_TO_BOTTOM_THRESHOLD = 24;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getMaxScrollTop(clientHeight, scrollHeight) {
    return Math.max(0, scrollHeight - clientHeight);
  }

  function captureSyncLogScrollSnapshot(metrics) {
    if (!metrics) {
      return null;
    }

    const scrollTop = Number(metrics.scrollTop || 0);
    const clientHeight = Number(metrics.clientHeight || 0);
    const scrollHeight = Number(metrics.scrollHeight || 0);
    const maxScrollTop = getMaxScrollTop(clientHeight, scrollHeight);
    const distanceFromBottom = Math.max(0, scrollHeight - clientHeight - scrollTop);

    return {
      scrollTop: clamp(scrollTop, 0, maxScrollTop),
      clientHeight,
      scrollHeight,
      distanceFromBottom,
      pinnedToBottom: distanceFromBottom <= SNAP_TO_BOTTOM_THRESHOLD
    };
  }

  function resolveSyncLogScrollTop({ previousSnapshot, nextClientHeight, nextScrollHeight }) {
    const maxScrollTop = getMaxScrollTop(nextClientHeight, nextScrollHeight);

    if (!previousSnapshot || previousSnapshot.pinnedToBottom) {
      return maxScrollTop;
    }

    const scrollDelta = nextScrollHeight - Number(previousSnapshot.scrollHeight || 0);
    return clamp(Number(previousSnapshot.scrollTop || 0) + scrollDelta, 0, maxScrollTop);
  }

  const api = {
    SNAP_TO_BOTTOM_THRESHOLD,
    captureSyncLogScrollSnapshot,
    resolveSyncLogScrollTop
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.SyncLogScroll = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
