(function attachJobUiHelpers(globalScope) {
  function normalizeJobStatus(status) {
    return String(status || '').trim().toLowerCase();
  }

  function formatJobStatus(status) {
    const normalized = normalizeJobStatus(status);
    const statusMap = {
      open: '招聘中',
      active: '招聘中',
      recruiting: '招聘中',
      publishing: '招聘中',
      online: '招聘中',
      '开放中': '招聘中',
      '招聘中': '招聘中',
      closed: '已关闭',
      offline: '已下线',
      paused: '已暂停',
      inactive: '已暂停',
      '待开放': '已暂停',
      '已关闭': '已关闭',
      '已下线': '已下线',
      '已暂停': '已暂停'
    };

    return statusMap[normalized] || status || '-';
  }

  function getJobStatusBadgeClass(status) {
    const normalized = normalizeJobStatus(status);

    if (['open', 'active', 'recruiting', 'publishing', 'online', '开放中', '招聘中'].includes(normalized)) {
      return 'badge badge-success';
    }

    if (['paused', 'inactive', '待开放', '已暂停'].includes(normalized)) {
      return 'badge badge-warning';
    }

    return 'badge badge-neutral';
  }

  function isJobActionEnabled(status) {
    const normalized = normalizeJobStatus(status);
    return ['open', 'active', 'recruiting', 'publishing', 'online', '开放中', '招聘中'].includes(normalized);
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
