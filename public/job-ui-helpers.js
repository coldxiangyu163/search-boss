(function attachJobUiHelpers(globalScope) {
  function normalizeJobStatus(status) {
    return String(status || '').trim().toLowerCase();
  }

  function formatJobStatus(status) {
    const normalized = normalizeJobStatus(status);
    const statusMap = {
      open: '招聘中',
      active: '招聘中',
      closed: '已关闭',
      offline: '已下线',
      paused: '已暂停'
    };

    return statusMap[normalized] || status || '-';
  }

  function getJobStatusBadgeClass(status) {
    const normalized = normalizeJobStatus(status);

    if (normalized === 'open' || normalized === 'active') {
      return 'badge badge-success';
    }

    if (normalized === 'paused') {
      return 'badge badge-warning';
    }

    return 'badge badge-neutral';
  }

  function isJobActionEnabled(status) {
    const normalized = normalizeJobStatus(status);
    return normalized === 'open' || normalized === 'active';
  }

  const api = {
    formatJobStatus,
    getJobStatusBadgeClass,
    isJobActionEnabled
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.JobUiHelpers = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
