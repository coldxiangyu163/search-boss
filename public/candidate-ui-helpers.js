(function initCandidateUiHelpers(globalScope) {
  const lifecycleLabels = {
    discovered: '待处理',
    greeted: '已打招呼',
    responded: '已回复',
    resume_requested: '已索简历',
    resume_received: '已收到简历',
    resume_downloaded: '简历已下载'
  };

  const resumeStateLabels = {
    not_requested: '未索取',
    requested: '已索取',
    received: '已收到',
    downloaded: '已下载'
  };

  const guardStatusLabels = {
    active: '正常跟进',
    manual_hold: '人工接管',
    do_not_contact: '停止联系',
    job_closed: '岗位关闭'
  };

  function formatLifecycleStatus(value) {
    return lifecycleLabels[value] || value || '-';
  }

  function formatResumeState(value) {
    return resumeStateLabels[value] || value || '-';
  }

  function formatGuardStatus(value) {
    return guardStatusLabels[value] || value || '-';
  }

  function getLifecycleBadgeClass(value) {
    const map = {
      responded: 'badge badge-success',
      resume_received: 'badge badge-success',
      resume_downloaded: 'badge badge-success',
      greeted: 'badge',
      resume_requested: 'badge badge-warning'
    };

    return map[value] || 'badge badge-neutral';
  }

  function getResumeBadgeClass(value) {
    const map = {
      downloaded: 'badge badge-success',
      received: 'badge badge-success',
      requested: 'badge badge-warning'
    };

    return map[value] || 'badge badge-neutral';
  }

  function getGuardBadgeClass(value) {
    const map = {
      active: 'badge badge-success',
      manual_hold: 'badge badge-warning',
      do_not_contact: 'badge badge-neutral',
      job_closed: 'badge badge-neutral'
    };

    return map[value] || 'badge badge-neutral';
  }

  function buildCandidateTimeline(detail = {}) {
    const events = [];

    for (const attachment of detail.attachments || []) {
      events.push({
        type: 'attachment',
        title: attachment.status === 'downloaded' ? '简历已下载' : '收到简历附件',
        description: attachment.file_name || attachment.stored_path || '未命名附件',
        occurredAt: attachment.downloaded_at || attachment.created_at || null
      });
    }

    for (const message of detail.messages || []) {
      events.push({
        type: 'message',
        title: message.direction === 'inbound' ? '候选人回复' : '发送消息',
        description: message.content_text || (message.message_type === 'text' ? '文本消息' : '非文本消息'),
        occurredAt: message.sent_at || null
      });
    }

    for (const action of detail.actions || []) {
      events.push({
        type: 'action',
        title: formatActionTitle(action.action_type),
        description: formatActionDescription(action.payload),
        occurredAt: action.created_at || null
      });
    }

    return events
      .filter((item) => item.occurredAt)
      .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  }

  function buildResumePreviewUrl(value) {
    if (typeof value !== 'string') {
      return '';
    }

    const normalizedValue = value.trim().replace(/\\/g, '/');
    if (!normalizedValue || !normalizedValue.startsWith('resumes/')) {
      return '';
    }

    if (normalizedValue.includes('..')) {
      return '';
    }

    return `/api/resume-preview?path=${encodeURIComponent(normalizedValue)}`;
  }

  function isResumeDownloadable(candidate = {}) {
    const candidates = [
      candidate.resume_path,
      ...(Array.isArray(candidate.attachments)
        ? candidate.attachments.map((attachment) => attachment?.stored_path)
        : [])
    ];

    return candidates.some((value) => Boolean(buildResumePreviewUrl(value)));
  }

  function buildCandidateDownloadQuery(query = {}) {
    return {
      ...query,
      resumeState: 'downloaded',
      page: 1
    };
  }

  function formatActionTitle(actionType) {
    const labels = {
      resume_request_sent: '已发送索简历消息',
      greet_sent: '已发送招呼',
      manual_takeover: '转人工处理',
      followup_sent: '已发送跟进消息'
    };

    return labels[actionType] || actionType || '操作记录';
  }

  function formatActionDescription(payload = {}) {
    if (!payload || typeof payload !== 'object') {
      return '系统已记录该动作。';
    }

    if (payload.templateType) {
      return `模板类型：${payload.templateType}`;
    }

    const firstEntry = Object.entries(payload).find(([, value]) => value !== null && value !== undefined && value !== '');
    if (!firstEntry) {
      return '系统已记录该动作。';
    }

    return `${firstEntry[0]}：${String(firstEntry[1])}`;
  }

  const api = {
    formatLifecycleStatus,
    formatResumeState,
    formatGuardStatus,
    getLifecycleBadgeClass,
    getResumeBadgeClass,
    getGuardBadgeClass,
    buildCandidateTimeline,
    buildResumePreviewUrl,
    isResumeDownloadable,
    buildCandidateDownloadQuery
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.CandidateUiHelpers = api;
}(typeof window !== 'undefined' ? window : globalThis));
