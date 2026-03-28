const state = {
  view: 'command',
  summary: null,
  jobs: [],
  candidates: [],
  candidateQuery: {
    jobKey: '',
    status: '',
    resumeState: '',
    keyword: '',
    page: 1,
    pageSize: 20
  },
  candidatePagination: {
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0
  },
  candidateListLoading: false,
  candidateListError: '',
  schedules: [],
  syncStatus: '',
  triggeringTaskKey: '',
  syncModal: {
    open: false,
    runId: null,
    status: 'idle',
    startedAt: null,
    error: '',
    events: [],
    progress: {
      hasRequested: false,
      hasNanobotOutput: false
    },
    isExpanded: true,
    pollTimer: null,
    lastEventId: 0,
    taskType: 'sync_jobs'
  },
  jobDetailModal: {
    open: false,
    jobKey: '',
    loading: false,
    error: '',
    item: null,
    saving: false,
    savingError: ''
  },
  candidateDetailDrawer: {
    open: false,
    candidateId: null,
    loading: false,
    error: '',
    item: null
  }
};

const {
  formatJobStatus,
  getJobStatusBadgeClass,
  isJobActionEnabled
} = window.JobUiHelpers;

const {
  formatLifecycleStatus,
  formatResumeState,
  formatGuardStatus,
  getLifecycleBadgeClass,
  getResumeBadgeClass,
  getGuardBadgeClass,
  buildCandidateTimeline
} = window.CandidateUiHelpers;

const {
  captureSyncLogScrollSnapshot,
  resolveSyncLogScrollTop
} = window.SyncLogScroll;

const {
  createSyncModalProgress: createSyncModalProgressState,
  updateSyncModalProgress: updateSyncModalProgressState,
  resolveSyncTerminalStatus: resolveSyncTerminalStatusForEvent,
  resolveSyncTerminalStatusFromRun: resolveSyncTerminalStatusFromRunSnapshot,
  buildSyncStages: buildSyncTimelineStages
} = window.SyncModalProgress;

const titles = {
  command: ['运营总览', '今日招聘运营看板', '聚焦核心招聘指标、待办事项与系统运行情况。'],
  jobs: ['职位管理', '职位招聘执行情况', '统一查看职位需求、城市分布与当前转化效率。'],
  candidates: ['候选人管理', '候选人全流程跟进', '围绕人才状态、简历获取与入站行为进行管理。'],
  automation: ['自动化调度', '任务调度与执行监控', '关注自动化任务编排、执行节奏与系统承接能力。'],
  health: ['系统状态', '系统运行健康中心', '查看平台服务、数据库连接与自动化能力现状。']
};

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadData();
});

function getTaskMeta(taskType) {
  const taskMeta = {
    sync_jobs: {
      eyebrow: '职位同步',
      buttonLabel: '同步职位',
      inlineSuccess: '已触发职位同步',
      emptyLogMessage: '等待职位同步输出...'
    },
    source: {
      eyebrow: '寻源打招呼',
      buttonLabel: '寻源打招呼',
      inlineSuccess: '已手动触发寻源打招呼',
      emptyLogMessage: '等待寻源打招呼任务输出...'
    },
    followup: {
      eyebrow: '主动沟通拉简历',
      buttonLabel: '主动沟通拉简历',
      inlineSuccess: '已手动触发主动沟通拉简历',
      emptyLogMessage: '等待主动沟通拉简历任务输出...'
    }
  };

  return taskMeta[taskType] || {
    eyebrow: '任务执行',
    buttonLabel: '执行任务',
    inlineSuccess: '已触发任务执行',
    emptyLogMessage: '等待任务输出...'
  };
}

function getTaskActionKey(jobKey, taskType) {
  return `${jobKey}:${taskType}`;
}

function hasSchedule(jobKey, taskType) {
  return state.schedules.some((schedule) => schedule.job_key === jobKey && schedule.task_type === taskType);
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('is-active'));
      button.classList.add('is-active');
      render();
    });
  });

  document.getElementById('refresh-button').addEventListener('click', () => loadData());
}

async function loadData() {
  state.candidateListLoading = true;
  state.candidateListError = '';
  render();

  const [schedules, summary, jobs, candidates] = await Promise.all([
    fetchJson('/api/schedules'),
    fetchJson('/api/dashboard/summary'),
    fetchJson('/api/jobs'),
    fetchCandidates()
  ]);

  state.schedules = schedules.items;
  state.summary = summary;
  state.jobs = jobs.items;
  state.candidates = candidates.items;
  state.candidatePagination = candidates.pagination || {
    page: state.candidateQuery.page,
    pageSize: state.candidateQuery.pageSize,
    total: candidates.items.length,
    totalPages: candidates.items.length ? 1 : 0
  };
  state.candidateListLoading = false;
  render();
}

async function fetchCandidates() {
  const searchParams = new URLSearchParams();
  const entries = {
    jobKey: state.candidateQuery.jobKey,
    status: state.candidateQuery.status,
    resumeState: state.candidateQuery.resumeState,
    keyword: state.candidateQuery.keyword.trim(),
    page: String(state.candidateQuery.page),
    pageSize: String(state.candidateQuery.pageSize)
  };

  for (const [key, value] of Object.entries(entries)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  return fetchJson(`/api/candidates?${searchParams.toString()}`);
}

async function loadCandidates() {
  state.candidateListLoading = true;
  state.candidateListError = '';
  render();

  try {
    const result = await fetchCandidates();
    state.candidates = result.items || [];
    state.candidatePagination = result.pagination || {
      page: state.candidateQuery.page,
      pageSize: state.candidateQuery.pageSize,
      total: state.candidates.length,
      totalPages: state.candidates.length ? 1 : 0
    };
  } catch (error) {
    state.candidateListError = error.message;
  } finally {
    state.candidateListLoading = false;
    render();
  }
}

async function openJobDetailModal(jobKey) {
  state.jobDetailModal = {
    open: true,
    jobKey,
    loading: true,
    error: '',
    item: null,
    saving: false,
    savingError: ''
  };
  render();

  try {
    const result = await fetchJson(`/api/jobs/${encodeURIComponent(jobKey)}`);
    if (state.jobDetailModal.jobKey !== jobKey) {
      return;
    }

    state.jobDetailModal.loading = false;
    state.jobDetailModal.item = result.item;
    render();
  } catch (error) {
    if (state.jobDetailModal.jobKey !== jobKey) {
      return;
    }

    state.jobDetailModal.loading = false;
    state.jobDetailModal.error = error.message;
    render();
  }
}

function closeJobDetailModal() {
  state.jobDetailModal = {
    open: false,
    jobKey: '',
    loading: false,
    error: '',
    item: null,
    saving: false,
    savingError: ''
  };
  render();
}

async function saveJobCustomRequirement() {
  if (!state.jobDetailModal.item || state.jobDetailModal.saving) {
    return;
  }

  const textarea = document.getElementById('job-custom-requirement-input');
  if (!textarea) {
    return;
  }

  state.jobDetailModal.saving = true;
  state.jobDetailModal.savingError = '';
  render();

  try {
    const result = await fetchJson(
      `/api/jobs/${encodeURIComponent(state.jobDetailModal.jobKey)}/custom-requirement`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          customRequirement: textarea.value
        })
      }
    );

    state.jobDetailModal.item = result.item;
    state.jobs = state.jobs.map((job) => (
      job.job_key === result.item.job_key
        ? { ...job, custom_requirement: result.item.custom_requirement }
        : job
    ));
  } catch (error) {
    state.jobDetailModal.savingError = error.message;
  } finally {
    state.jobDetailModal.saving = false;
    render();
  }
}

async function syncJobs() {
  const button = document.querySelector('.jobs-header-actions .button-secondary');
  const previousText = button.textContent;
  const taskMeta = getTaskMeta('sync_jobs');

  button.disabled = true;
  button.textContent = '同步中...';
  state.syncStatus = '';
  openSyncModal('sync_jobs');
  render();

  try {
    const result = await fetchJson('/api/jobs/sync', { method: 'POST' });
    state.syncStatus = result.message || `${taskMeta.inlineSuccess}，任务 ${result.runId}`;
    state.syncModal.runId = result.runId;
    state.syncModal.status = result.status || 'running';
    state.syncModal.startedAt = new Date().toISOString();
    appendSyncEvent({
      eventType: 'job_sync_requested',
      stage: 'bootstrap',
      message: state.syncStatus,
      occurredAt: state.syncModal.startedAt
    });
    startSyncPolling();
    await loadData();
  } catch (error) {
    state.syncStatus = `同步失败：${error.message}`;
    state.syncModal.status = 'failed';
    state.syncModal.error = error.message;
    appendSyncEvent({
      eventType: 'sync_failed',
      stage: 'complete',
      message: state.syncStatus,
      occurredAt: new Date().toISOString()
    });
    render();
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

async function triggerJobTask(jobKey, taskType) {
  const taskMeta = getTaskMeta(taskType);
  const actionKey = getTaskActionKey(jobKey, taskType);

  state.triggeringTaskKey = actionKey;
  state.syncStatus = '';
  openSyncModal(taskType);
  render();

  try {
    const result = await fetchJson(
      `/api/jobs/${encodeURIComponent(jobKey)}/tasks/${encodeURIComponent(taskType)}/trigger`,
      { method: 'POST' }
    );

    state.syncStatus = result.message || `${taskMeta.inlineSuccess}，职位 ${jobKey}`;
    state.syncModal.runId = result.runId;
    state.syncModal.status = result.status || 'running';
    state.syncModal.startedAt = new Date().toISOString();
    appendSyncEvent({
      eventType: 'schedule_triggered',
      stage: 'bootstrap',
      message: `${taskMeta.buttonLabel}已触发：${jobKey}`,
      occurredAt: state.syncModal.startedAt
    });
    startSyncPolling();
    await loadData();
  } catch (error) {
    state.syncStatus = `${taskMeta.buttonLabel}失败：${error.message}`;
    state.syncModal.status = 'failed';
    state.syncModal.error = error.message;
    appendSyncEvent({
      eventType: 'run_failed',
      stage: 'complete',
      message: state.syncStatus,
      occurredAt: new Date().toISOString()
    });
    render();
  } finally {
    state.triggeringTaskKey = '';
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function render() {
  const syncLogScrollSnapshot = getSyncLogScrollSnapshot();
  const [eyebrow, title, description] = titles[state.view];
  document.getElementById('page-eyebrow').textContent = eyebrow;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-description').textContent = description;

  const app = document.getElementById('app');

  if (!state.summary) {
    app.innerHTML = '<div class="card">加载中...</div>';
    return;
  }

  if (state.view === 'command') {
    app.innerHTML = renderCommandCenter();
    restoreSyncLogScroll(syncLogScrollSnapshot);
    return;
  }

  if (state.view === 'jobs') {
    app.innerHTML = renderJobs();
    restoreSyncLogScroll(syncLogScrollSnapshot);
    return;
  }

  if (state.view === 'candidates') {
    app.innerHTML = renderCandidates();
    restoreSyncLogScroll(syncLogScrollSnapshot);
    return;
  }

  if (state.view === 'automation') {
    app.innerHTML = renderAutomation();
    restoreSyncLogScroll(syncLogScrollSnapshot);
    return;
  }

  app.innerHTML = renderHealth();
  restoreSyncLogScroll(syncLogScrollSnapshot);
}

function openSyncModal(taskType = 'sync_jobs') {
  stopSyncPolling();
  state.syncModal = {
    open: true,
    runId: null,
    status: 'starting',
    startedAt: new Date().toISOString(),
    error: '',
    events: [],
    progress: createSyncModalProgressState(),
    isExpanded: true,
    pollTimer: null,
    lastEventId: 0,
    taskType
  };
}

function closeSyncModal() {
  stopSyncPolling();
  state.syncModal.open = false;
  render();
}

function toggleSyncLogPanel() {
  state.syncModal.isExpanded = !state.syncModal.isExpanded;
  render();
}

function appendSyncEvent(event) {
  state.syncModal.events = [...state.syncModal.events, event].slice(-100);
  state.syncModal.progress = updateSyncModalProgressState(state.syncModal.progress, event);
}

function getSyncLogScrollSnapshot() {
  const logList = document.querySelector('.sync-log-list');
  if (!logList) {
    return null;
  }

  return captureSyncLogScrollSnapshot({
    scrollTop: logList.scrollTop,
    clientHeight: logList.clientHeight,
    scrollHeight: logList.scrollHeight
  });
}

function restoreSyncLogScroll(previousSnapshot) {
  const logList = document.querySelector('.sync-log-list');
  if (!logList) {
    return;
  }

  logList.scrollTop = resolveSyncLogScrollTop({
    previousSnapshot,
    nextClientHeight: logList.clientHeight,
    nextScrollHeight: logList.scrollHeight
  });
}

function startSyncPolling() {
  stopSyncPolling();
  if (!state.syncModal.runId) {
    render();
    return;
  }

  pollSyncEvents();
  state.syncModal.pollTimer = window.setInterval(pollSyncEvents, 1500);
}

function stopSyncPolling() {
  if (state.syncModal.pollTimer) {
    window.clearInterval(state.syncModal.pollTimer);
    state.syncModal.pollTimer = null;
  }
}

async function pollSyncEvents() {
  if (!state.syncModal.runId) {
    return;
  }

  try {
    const [eventsResult, runResult] = await Promise.allSettled([
      fetchJson(`/api/runs/${state.syncModal.runId}/events?afterId=${state.syncModal.lastEventId}`),
      fetchJson(`/api/runs/${state.syncModal.runId}`)
    ]);

    if (eventsResult.status === 'fulfilled') {
      for (const event of eventsResult.value.items || []) {
        state.syncModal.lastEventId = Math.max(state.syncModal.lastEventId, event.id || 0);
        appendSyncEvent(event);
        applySyncEventStatus(event);
      }
    }

    if (runResult.status === 'fulfilled') {
      applySyncRunSnapshotStatus(runResult.value.item);
    }

    if (eventsResult.status === 'rejected' && runResult.status === 'rejected') {
      throw eventsResult.reason || runResult.reason || new Error('sync_poll_failed');
    }

    render();
  } catch (error) {
    state.syncModal.error = error.message;
    state.syncModal.status = 'failed';
    stopSyncPolling();
    render();
  }
}

function applySyncEventStatus(event) {
  const terminalStatus = resolveSyncTerminalStatusForEvent(event);

  applySyncTerminalStatus(terminalStatus);
}

function applySyncRunSnapshotStatus(run) {
  const terminalStatus = resolveSyncTerminalStatusFromRunSnapshot(run);
  applySyncTerminalStatus(terminalStatus);
}

function applySyncTerminalStatus(terminalStatus) {
  if (terminalStatus?.status === 'completed') {
    state.syncModal.status = 'completed';
    stopSyncPolling();
    loadData().catch(() => {});
    return;
  }

  if (terminalStatus?.status === 'failed') {
    state.syncModal.status = 'failed';
    state.syncModal.error = terminalStatus.error || state.syncModal.error;
    stopSyncPolling();
    return;
  }

  state.syncModal.status = 'running';
}

function renderCommandCenter() {
  const { kpis, queues, health } = state.summary;
  const conversionRate = kpis.greetedToday ? `${Math.round((kpis.repliedToday / kpis.greetedToday) * 100)}%` : '0%';

  return `
    <section class="card-grid">
      ${metricCard('在招职位数', kpis.jobs, '当前系统内持续跟进的职位总量')}
      ${metricCard('人才池规模', kpis.candidates, '已进入管理范围的候选人总数')}
      ${metricCard('今日主动沟通', kpis.greetedToday, '今日已发起的招呼与触达次数')}
      ${metricCard('今日有效回复', kpis.repliedToday, `当前沟通回复转化率 ${conversionRate}`)}
    </section>
    <section class="overview-grid">
      <div class="data-stack">
        <div class="card highlight-panel">
          <div class="card-header">
            <div>
              <p class="eyebrow">核心推进</p>
              <h3 class="card-title">简历推进漏斗</h3>
              <p class="card-subtitle">以今日动作与待处理量为核心，快速识别推进压力。</p>
            </div>
            <span class="badge">进度概览</span>
          </div>
          <div class="status-grid">
            <div class="status-box">
              <span class="muted">今日索取简历</span>
              <strong>${kpis.resumeRequestedToday}</strong>
            </div>
            <div class="status-box">
              <span class="muted">今日收到简历</span>
              <strong>${kpis.resumeReceivedToday}</strong>
            </div>
            <div class="status-box">
              <span class="muted">待处理队列</span>
              <strong>${queues.resumePipeline}</strong>
            </div>
            <div class="status-box">
              <span class="muted">沟通回复率</span>
              <strong>${conversionRate}</strong>
            </div>
          </div>
        </div>
        <div class="table-card">
          <div class="card-header">
            <div>
              <p class="eyebrow">运营建议</p>
              <h3 class="card-title">今日重点关注</h3>
            </div>
            <span class="badge badge-warning">需跟进</span>
          </div>
          <div class="list">
            <div class="list-item">
              <div>
                <p class="list-title">优先处理简历流转中的候选人</p>
                <p class="list-desc">当前有 ${queues.resumePipeline} 位候选人处于简历推进阶段，建议优先跟进。</p>
              </div>
              <span class="badge">重点</span>
            </div>
            <div class="list-item">
              <div>
                <p class="list-title">关注今日沟通到回复的转化表现</p>
                <p class="list-desc">主动沟通 ${kpis.greetedToday} 次，已收到 ${kpis.repliedToday} 次回复。</p>
              </div>
              <span class="badge">分析</span>
            </div>
            <div class="list-item">
              <div>
                <p class="list-title">强化简历获取动作</p>
                <p class="list-desc">今日已索取 ${kpis.resumeRequestedToday} 份简历，收到 ${kpis.resumeReceivedToday} 份。</p>
              </div>
              <span class="badge">推进</span>
            </div>
          </div>
        </div>
      </div>
      <div class="data-stack">
        <div class="table-card">
          <div class="card-header">
            <div>
              <p class="eyebrow">系统状态</p>
              <h3 class="card-title">服务健康度</h3>
            </div>
            <span class="badge badge-success">稳定</span>
          </div>
          <div class="list">
            <div class="list-item">
              <div>
                <p class="list-title">接口服务</p>
                <p class="list-desc">当前接口链路状态正常。</p>
              </div>
              <span class="badge badge-success">${health.api}</span>
            </div>
            <div class="list-item">
              <div>
                <p class="list-title">数据库连接</p>
                <p class="list-desc">核心数据读写服务可用。</p>
              </div>
              <span class="badge badge-success">${health.database}</span>
            </div>
          </div>
        </div>
        <div class="table-card">
          <div class="card-header">
            <div>
              <p class="eyebrow">管理视角</p>
              <h3 class="card-title">运营概览摘要</h3>
            </div>
          </div>
          <p class="card-subtitle">当前平台已覆盖职位、候选人、调度与执行闭环，适合作为招聘运营统一入口。</p>
        </div>
      </div>
    </section>
  `;
}

function renderJobs() {
  return `
    <section class="table-card">
      <div class="card-header">
        <div>
          <p class="eyebrow">职位管理</p>
          <h3 class="card-title">职位列表</h3>
          <p class="card-subtitle">按职位查看候选人规模与关键转化数据。</p>
        </div>
        <div class="jobs-header-actions">
          <span class="badge">共 ${state.jobs.length} 个职位</span>
          <button class="button-secondary" onclick="syncJobs()">同步职位</button>
        </div>
      </div>
      ${state.syncStatus ? `<div class="inline-status">${state.syncStatus}</div>` : ''}
      <table>
        <thead>
          <tr>
            <th>职位</th>
            <th>城市</th>
            <th>薪资</th>
            <th>状态</th>
            <th>候选人</th>
            <th>已打招呼</th>
            <th>已回复</th>
            <th>已下载简历</th>
            <th>手动触发</th>
          </tr>
        </thead>
        <tbody>
          ${state.jobs.map((job) => `
            <tr>
              <td>${job.job_name}<div class="muted">${job.job_key}</div></td>
              <td>${job.city || '-'}</td>
              <td>${job.salary || '-'}</td>
              <td><span class="${getJobStatusBadgeClass(job.status)}">${formatJobStatus(job.status)}</span></td>
              <td>${job.candidate_count}</td>
              <td>${job.greeted_count}</td>
              <td>${job.responded_count}</td>
              <td>${job.resume_downloaded_count}</td>
              <td>${renderJobActions(job)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
    ${renderSyncModal()}
    ${renderJobDetailModal()}
  `;
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  });
}

function renderJobActions(job) {
  const actionEnabled = isJobActionEnabled(job.status);
  const disabledHint = '仅招聘中的职位支持寻源和拉取简历';

  return `
    <div class="table-actions">
      <button
        class="button-secondary button-compact"
        onclick='openJobDetailModal(${JSON.stringify(job.job_key)})'
        title="查看职位详情"
      >
        查看详情
      </button>
      ${renderTaskTriggerButton(job.job_key, 'source', {
        enabled: actionEnabled,
        hint: actionEnabled
          ? (hasSchedule(job.job_key, 'source') ? '已配置定时任务，也支持手动触发' : '未配置定时任务，当前按手动执行处理')
          : disabledHint
      })}
      ${renderTaskTriggerButton(job.job_key, 'followup', {
        enabled: actionEnabled,
        hint: actionEnabled
          ? (hasSchedule(job.job_key, 'followup') ? '已配置定时任务，也支持手动触发' : '未配置定时任务，当前按手动执行处理')
          : disabledHint
      })}
    </div>
  `;
}

function renderTaskTriggerButton(jobKey, taskType, { enabled = true, compact = false, hint = '' } = {}) {
  const taskMeta = getTaskMeta(taskType);
  const actionKey = getTaskActionKey(jobKey, taskType);
  const isLoading = state.triggeringTaskKey === actionKey;
  const classes = ['button-secondary'];

  if (compact) {
    classes.push('button-compact');
  }

  return `
    <button
      class="${classes.join(' ')}"
      onclick='triggerJobTask(${JSON.stringify(jobKey)}, ${JSON.stringify(taskType)})'
      ${!enabled || isLoading ? 'disabled' : ''}
      title="${enabled ? (hint || `手动执行${taskMeta.buttonLabel}`) : `未配置${taskMeta.buttonLabel}定时任务`}"
    >
      ${isLoading ? '执行中...' : taskMeta.buttonLabel}
    </button>
  `;
}

function renderCandidates() {
  const page = state.candidatePagination.page || state.candidateQuery.page;
  const totalPages = state.candidatePagination.totalPages || 0;

  return `
    <section class="table-card">
      <div class="card-header">
        <div>
          <p class="eyebrow">候选人管理</p>
          <h3 class="card-title">候选人工作台</h3>
          <p class="card-subtitle">支持按岗位和流程状态筛选，保留当前列表上下文查看详情。</p>
        </div>
        <div class="jobs-header-actions">
          <span class="badge">共 ${state.candidatePagination.total} 人</span>
          <span class="status-chip">第 ${page} / ${Math.max(totalPages, 1)} 页</span>
        </div>
      </div>
      <div class="candidate-filter-bar">
        <div class="candidate-filter-grid">
          <label class="form-field">
            <span class="form-label">岗位</span>
            <select onchange="updateCandidateFilter('jobKey', this.value)">
              <option value="">全部岗位</option>
              ${state.jobs.map((job) => `
                <option value="${escapeHtml(job.job_key)}" ${state.candidateQuery.jobKey === job.job_key ? 'selected' : ''}>
                  ${escapeHtml(job.job_name)}
                </option>
              `).join('')}
            </select>
          </label>
          <label class="form-field">
            <span class="form-label">流程阶段</span>
            <select onchange="updateCandidateFilter('status', this.value)">
              ${renderCandidateSelectOptions(getLifecycleOptions(), state.candidateQuery.status)}
            </select>
          </label>
          <label class="form-field">
            <span class="form-label">简历状态</span>
            <select onchange="updateCandidateFilter('resumeState', this.value)">
              ${renderCandidateSelectOptions(getResumeStateOptions(), state.candidateQuery.resumeState)}
            </select>
          </label>
          <label class="form-field">
            <span class="form-label">关键词</span>
            <input
              type="text"
              placeholder="姓名 / Geek ID / 岗位"
              value="${escapeHtml(state.candidateQuery.keyword)}"
              oninput="updateCandidateFilter('keyword', this.value)"
              onkeydown="handleCandidateKeywordKeydown(event)"
            />
          </label>
        </div>
        <div class="candidate-filter-actions">
          <button class="button-secondary" onclick="applyCandidateFilters()">查询</button>
          <button class="button-secondary button-muted" onclick="resetCandidateFilters()">重置</button>
        </div>
      </div>
      ${state.candidateListError ? `<div class="inline-status inline-status-error">${escapeHtml(state.candidateListError)}</div>` : ''}
      ${renderCandidateListSummary()}
      ${state.candidateListLoading ? '<div class="empty-state">正在加载候选人列表...</div>' : renderCandidateTable()}
      ${renderCandidatePagination()}
    </section>
    ${renderCandidateDetailDrawer()}
  `;
}

function renderCandidateSelectOptions(options, currentValue) {
  return options.map((option) => `
    <option value="${escapeHtml(option.value)}" ${currentValue === option.value ? 'selected' : ''}>
      ${escapeHtml(option.label)}
    </option>
  `).join('');
}

function getLifecycleOptions() {
  return [
    { value: '', label: '全部阶段' },
    { value: 'discovered', label: formatLifecycleStatus('discovered') },
    { value: 'greeted', label: formatLifecycleStatus('greeted') },
    { value: 'responded', label: formatLifecycleStatus('responded') },
    { value: 'resume_requested', label: formatLifecycleStatus('resume_requested') },
    { value: 'resume_received', label: formatLifecycleStatus('resume_received') },
    { value: 'resume_downloaded', label: formatLifecycleStatus('resume_downloaded') }
  ];
}

function getResumeStateOptions() {
  return [
    { value: '', label: '全部简历状态' },
    { value: 'not_requested', label: formatResumeState('not_requested') },
    { value: 'requested', label: formatResumeState('requested') },
    { value: 'received', label: formatResumeState('received') },
    { value: 'downloaded', label: formatResumeState('downloaded') }
  ];
}

function updateCandidateFilter(field, value) {
  state.candidateQuery[field] = value;
}

function handleCandidateKeywordKeydown(event) {
  if (event.key === 'Enter') {
    applyCandidateFilters();
  }
}

function applyCandidateFilters() {
  state.candidateQuery.page = 1;
  loadCandidates();
}

function resetCandidateFilters() {
  state.candidateQuery = {
    ...state.candidateQuery,
    jobKey: '',
    status: '',
    resumeState: '',
    keyword: '',
    page: 1
  };
  loadCandidates();
}

function goToCandidatePage(page) {
  const totalPages = state.candidatePagination.totalPages || 1;
  const nextPage = Math.min(Math.max(page, 1), totalPages);
  if (nextPage === state.candidateQuery.page) {
    return;
  }

  state.candidateQuery.page = nextPage;
  loadCandidates();
}

function changeCandidatePageSize(pageSize) {
  const nextPageSize = Number(pageSize) || 20;
  if (nextPageSize === state.candidateQuery.pageSize) {
    return;
  }

  state.candidateQuery.pageSize = nextPageSize;
  state.candidateQuery.page = 1;
  loadCandidates();
}

function renderCandidateListSummary() {
  const { jobKey, status, resumeState, keyword } = state.candidateQuery;
  const activeFilters = [];

  if (jobKey) {
    const job = state.jobs.find((item) => item.job_key === jobKey);
    activeFilters.push(job?.job_name || jobKey);
  }

  if (status) {
    activeFilters.push(formatLifecycleStatus(status));
  }

  if (resumeState) {
    activeFilters.push(formatResumeState(resumeState));
  }

  if (keyword.trim()) {
    activeFilters.push(`关键词: ${keyword.trim()}`);
  }

  return `
    <div class="candidate-summary-row">
      <div class="muted">
        当前显示 ${state.candidates.length} / ${state.candidatePagination.total} 位候选人
      </div>
      <div class="candidate-chip-row">
        ${(activeFilters.length ? activeFilters : ['全部候选人']).map((label) => `
          <span class="badge badge-neutral">${escapeHtml(label)}</span>
        `).join('')}
      </div>
    </div>
  `;
}

function renderCandidateTable() {
  if (!state.candidates.length) {
    return '<div class="empty-state">当前筛选条件下没有候选人，建议切换岗位或放宽筛选条件。</div>';
  }

  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>候选人</th>
            <th>当前岗位</th>
            <th>流程阶段</th>
            <th>简历状态</th>
            <th>最近互动</th>
            <th>索简历次数</th>
            <th>风险标记</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${state.candidates.map((candidate) => `
            <tr class="table-row-action" onclick='openCandidateDetailDrawer(${JSON.stringify(candidate.id)})'>
              <td>
                ${escapeHtml(candidate.name || '-')}
                <div class="muted">${escapeHtml(candidate.boss_encrypt_geek_id || '-')}</div>
              </td>
              <td>${escapeHtml(candidate.job_name || '-')}</td>
              <td>
                <span class="${getLifecycleBadgeClass(candidate.lifecycle_status)}">
                  ${escapeHtml(formatLifecycleStatus(candidate.lifecycle_status))}
                </span>
              </td>
              <td>
                <span class="${getResumeBadgeClass(candidate.resume_state)}">
                  ${escapeHtml(formatResumeState(candidate.resume_state))}
                </span>
              </td>
              <td>${formatDateTime(candidate.last_activity_at || candidate.last_inbound_at || candidate.last_outbound_at)}</td>
              <td>${candidate.resume_request_count ?? 0}</td>
              <td>
                <span class="${getGuardBadgeClass(candidate.guard_status)}">
                  ${escapeHtml(formatGuardStatus(candidate.guard_status))}
                </span>
              </td>
              <td>
                <button
                  class="button-secondary button-compact"
                  onclick='event.stopPropagation(); openCandidateDetailDrawer(${JSON.stringify(candidate.id)})'
                >
                  查看详情
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderCandidatePagination() {
  const { page, pageSize, total, totalPages } = state.candidatePagination;
  const safeTotalPages = Math.max(totalPages, 1);
  const pageNumbers = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(safeTotalPages, page + 2);

  for (let current = start; current <= end; current += 1) {
    pageNumbers.push(current);
  }

  return `
    <div class="candidate-pagination">
      <div class="muted">共 ${total} 条记录，每页展示</div>
      <select class="pagination-select" onchange="changeCandidatePageSize(this.value)">
        ${[20, 50, 100].map((size) => `
          <option value="${size}" ${pageSize === size ? 'selected' : ''}>${size}</option>
        `).join('')}
      </select>
      <div class="candidate-page-actions">
        <button class="button-secondary button-compact" onclick="goToCandidatePage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>
          上一页
        </button>
        ${pageNumbers.map((pageNumber) => `
          <button
            class="button-secondary button-compact ${pageNumber === page ? 'is-current-page' : ''}"
            onclick="goToCandidatePage(${pageNumber})"
          >
            ${pageNumber}
          </button>
        `).join('')}
        <button class="button-secondary button-compact" onclick="goToCandidatePage(${page + 1})" ${page >= safeTotalPages ? 'disabled' : ''}>
          下一页
        </button>
      </div>
    </div>
  `;
}

async function openCandidateDetailDrawer(candidateId) {
  state.candidateDetailDrawer = {
    open: true,
    candidateId,
    loading: true,
    error: '',
    item: null
  };
  render();

  try {
    const result = await fetchJson(`/api/candidates/${encodeURIComponent(candidateId)}`);
    if (state.candidateDetailDrawer.candidateId !== candidateId) {
      return;
    }

    state.candidateDetailDrawer.loading = false;
    state.candidateDetailDrawer.item = result.item;
    render();
  } catch (error) {
    if (state.candidateDetailDrawer.candidateId !== candidateId) {
      return;
    }

    state.candidateDetailDrawer.loading = false;
    state.candidateDetailDrawer.error = error.message;
    render();
  }
}

function closeCandidateDetailDrawer() {
  state.candidateDetailDrawer = {
    open: false,
    candidateId: null,
    loading: false,
    error: '',
    item: null
  };
  render();
}

function renderCandidateDetailDrawer() {
  if (!state.candidateDetailDrawer.open) {
    return '';
  }

  const item = state.candidateDetailDrawer.item;
  const timeline = item ? buildCandidateTimeline(item) : [];

  return `
    <div class="drawer-backdrop" onclick="closeCandidateDetailDrawer()">
      <aside class="candidate-drawer" onclick="event.stopPropagation()">
        <div class="card-header">
          <div>
            <p class="eyebrow">候选人详情</p>
            <h3 class="card-title">${escapeHtml(item?.name || '候选人')}</h3>
            <p class="card-subtitle">
              ${item ? `${escapeHtml(item.job_name || '-')} · ${escapeHtml(item.boss_encrypt_geek_id || '-')}` : '正在加载候选人详情'}
            </p>
          </div>
          <button class="button-secondary" onclick="closeCandidateDetailDrawer()">关闭</button>
        </div>
        ${state.candidateDetailDrawer.loading ? '<div class="empty-state">正在加载候选人详情...</div>' : ''}
        ${state.candidateDetailDrawer.error ? `<div class="inline-status inline-status-error">${escapeHtml(state.candidateDetailDrawer.error)}</div>` : ''}
        ${item ? `
          <div class="candidate-detail-sections">
            <section class="candidate-detail-section">
              <div class="candidate-detail-grid">
                <div class="status-box">
                  <span class="muted">流程阶段</span>
                  <strong>${escapeHtml(formatLifecycleStatus(item.lifecycle_status))}</strong>
                </div>
                <div class="status-box">
                  <span class="muted">简历状态</span>
                  <strong>${escapeHtml(formatResumeState(item.resume_state))}</strong>
                </div>
                <div class="status-box">
                  <span class="muted">跟进状态</span>
                  <strong>${escapeHtml(formatGuardStatus(item.guard_status))}</strong>
                </div>
                <div class="status-box">
                  <span class="muted">索简历次数</span>
                  <strong>${item.resume_request_count ?? 0}</strong>
                </div>
                <div class="status-box">
                  <span class="muted">最近索简历时间</span>
                  <strong>${formatDateTime(item.last_resume_requested_at)}</strong>
                </div>
                <div class="status-box">
                  <span class="muted">候选人最近回复</span>
                  <strong>${formatDateTime(item.last_inbound_at)}</strong>
                </div>
              </div>
            </section>
            <section class="candidate-detail-section">
              <div class="card-header">
                <div>
                  <p class="eyebrow">基础信息</p>
                  <h4 class="card-title job-detail-section-title">候选人画像</h4>
                </div>
              </div>
              <div class="candidate-facts-grid">
                ${renderCandidateFact('城市', item.city)}
                ${renderCandidateFact('学历', item.education)}
                ${renderCandidateFact('经验', item.experience)}
                ${renderCandidateFact('学校', item.school)}
                ${renderCandidateFact('简历路径', item.resume_path)}
                ${renderCandidateFact('备注', item.notes)}
              </div>
            </section>
            <section class="candidate-detail-section">
              <div class="card-header">
                <div>
                  <p class="eyebrow">跟进建议</p>
                  <h4 class="card-title job-detail-section-title">下一步动作</h4>
                </div>
              </div>
              <div class="candidate-followup-box">
                <div class="status-box">
                  <span class="muted">是否允许继续触达</span>
                  <strong>${item.followupDecision?.allowed ? '允许' : '暂不允许'}</strong>
                </div>
                <div class="status-box">
                  <span class="muted">原因</span>
                  <strong>${escapeHtml(item.followupDecision?.reason || '未提供')}</strong>
                </div>
                <div class="status-box">
                  <span class="muted">建议动作</span>
                  <strong>${escapeHtml(item.followupDecision?.recommendedAction || 'manual_review')}</strong>
                </div>
                <div class="status-box">
                  <span class="muted">剩余冷却</span>
                  <strong>${item.followupDecision?.cooldownRemainingMinutes ?? 0} 分钟</strong>
                </div>
              </div>
            </section>
            <section class="candidate-detail-section">
              <div class="card-header">
                <div>
                  <p class="eyebrow">互动时间线</p>
                  <h4 class="card-title job-detail-section-title">最近动态</h4>
                </div>
              </div>
              ${timeline.length ? `
                <div class="candidate-timeline">
                  ${timeline.map((event) => `
                    <div class="candidate-timeline-item">
                      <div class="candidate-timeline-dot"></div>
                      <div>
                        <div class="list-title">${escapeHtml(event.title)}</div>
                        <div class="list-desc">${escapeHtml(event.description || '系统已记录该事件。')}</div>
                      </div>
                      <div class="muted">${formatDateTime(event.occurredAt)}</div>
                    </div>
                  `).join('')}
                </div>
              ` : '<div class="empty-state">当前没有可展示的互动记录。</div>'}
            </section>
            <section class="candidate-detail-section">
              <div class="card-header">
                <div>
                  <p class="eyebrow">附件与关联岗位</p>
                  <h4 class="card-title job-detail-section-title">简历与历史轨迹</h4>
                </div>
              </div>
              <div class="candidate-detail-stack">
                ${renderAttachmentList(item.attachments)}
                ${renderRelatedJobs(item.relatedJobs)}
              </div>
            </section>
          </div>
        ` : ''}
      </aside>
    </div>
  `;
}

function renderCandidateFact(label, value) {
  return `
    <div class="job-meta-item">
      <span class="muted">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || '-')}</strong>
    </div>
  `;
}

function renderAttachmentList(attachments = []) {
  if (!attachments.length) {
    return '<div class="empty-state">尚未收到或下载简历附件。</div>';
  }

  return `
    <div class="candidate-sublist">
      ${attachments.map((attachment) => `
        <div class="list-item">
          <div>
            <p class="list-title">${escapeHtml(attachment.file_name || '未命名附件')}</p>
            <p class="list-desc">${escapeHtml(attachment.stored_path || '尚未落盘')} · ${escapeHtml(formatResumeState(attachment.status === 'downloaded' ? 'downloaded' : 'received'))}</p>
          </div>
          <span class="badge ${attachment.status === 'downloaded' ? 'badge-success' : 'badge-warning'}">
            ${escapeHtml(attachment.status || '-')}
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRelatedJobs(relatedJobs = []) {
  if (!relatedJobs.length) {
    return '<div class="empty-state">当前未发现该候选人的跨岗位记录。</div>';
  }

  return `
    <div class="candidate-sublist">
      ${relatedJobs.map((job) => `
        <div class="list-item">
          <div>
            <p class="list-title">${escapeHtml(job.job_name || job.job_key)}</p>
            <p class="list-desc">${escapeHtml(job.job_key || '-')}</p>
          </div>
          <div class="candidate-related-badges">
            <span class="${getLifecycleBadgeClass(job.lifecycle_status)}">${escapeHtml(formatLifecycleStatus(job.lifecycle_status))}</span>
            <span class="${getResumeBadgeClass(job.resume_state)}">${escapeHtml(formatResumeState(job.resume_state))}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAutomation() {
  return `
    <section class="table-card">
      <div class="card-header">
        <div>
          <p class="eyebrow">自动化调度</p>
          <h3 class="card-title">任务调度配置</h3>
          <p class="card-subtitle">统一查看任务编排、定时规则与最新执行记录。</p>
        </div>
        <span class="badge">${state.schedules.length} 个调度任务</span>
      </div>
      ${state.schedules.length ? `
        <table>
          <thead>
            <tr>
              <th>职位</th>
              <th>任务</th>
              <th>执行规则</th>
              <th>是否启用</th>
              <th>最近执行</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${state.schedules.map((schedule) => `
              <tr>
                <td>${schedule.job_key}</td>
                <td>${schedule.task_type}</td>
                <td>${schedule.cron_expression}</td>
                <td>${schedule.enabled ? '已启用' : '未启用'}</td>
                <td>${schedule.last_run_at || '-'}</td>
                <td>${renderTaskTriggerButton(schedule.job_key, schedule.task_type, { compact: true })}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<div class="empty-state">当前暂无调度任务，可在后续接入自动化规则后统一配置。</div>'}
    </section>
    <section class="card">
      <div class="card-header">
        <div>
          <p class="eyebrow">执行闭环</p>
          <h3 class="card-title">自动化能力现状</h3>
        </div>
        <span class="badge badge-success">已打通基础链路</span>
      </div>
      <p class="card-subtitle">当前已支持创建执行记录、写入事件、完成回写；下一步可将定时触发器绑定到实际机器人执行流程。</p>
    </section>
  `;
}

function renderHealth() {
  return `
    <section class="split">
      <div class="card">
        <div class="card-header">
          <div>
            <p class="eyebrow">系统状态</p>
            <h3 class="card-title">基础服务健康检查</h3>
          </div>
          <span class="badge badge-success">运行正常</span>
        </div>
        <div class="list">
          <div class="list-item">
            <div>
              <p class="list-title">接口服务</p>
              <p class="list-desc">负责页面数据读取与写入接口。</p>
            </div>
            <span class="badge badge-success">正常</span>
          </div>
          <div class="list-item">
            <div>
              <p class="list-title">数据库</p>
              <p class="list-desc">支持职位、候选人、调度等核心数据存储。</p>
            </div>
            <span class="badge badge-success">正常</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div>
            <p class="eyebrow">能力规划</p>
            <h3 class="card-title">后续增强方向</h3>
          </div>
        </div>
        <div class="list">
          <div class="list-item">
            <div>
              <p class="list-title">机器人执行接入</p>
              <p class="list-desc">补充小聘AGENT实际执行与反馈回流。</p>
            </div>
          </div>
          <div class="list-item">
            <div>
              <p class="list-title">实时状态推送</p>
              <p class="list-desc">通过实时信号提升任务执行过程可见性。</p>
            </div>
          </div>
          <div class="list-item">
            <div>
              <p class="list-title">异常预警</p>
              <p class="list-desc">对任务失败、连接异常等事件进行告警。</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function metricCard(label, value, footnote) {
  return `
    <article class="card metric-card">
      <p class="metric-label">${label}</p>
      <div class="metric">${value ?? 0}</div>
      <div class="metric-footnote">${footnote || ''}</div>
    </article>
  `;
}

function renderJobDetailModal() {
  if (!state.jobDetailModal.open) {
    return '';
  }

  const item = state.jobDetailModal.item;
  const metadataEntries = item ? getJobMetadataEntries(item.sync_metadata) : [];

  return `
    <div class="modal-backdrop" onclick="closeJobDetailModal()">
      <section class="sync-modal job-detail-modal" onclick="event.stopPropagation()">
        <div class="card-header">
          <div>
            <p class="eyebrow">职位详情</p>
            <h3 class="card-title">${escapeHtml(item?.job_name || state.jobDetailModal.jobKey)}</h3>
            <p class="card-subtitle">${item ? `${escapeHtml(item.job_key)} · ${escapeHtml(formatJobStatus(item.status))}` : '正在加载职位详情'}</p>
          </div>
          <button class="button-secondary" onclick="closeJobDetailModal()">关闭</button>
        </div>
        ${state.jobDetailModal.loading ? '<div class="empty-state">正在加载职位详情...</div>' : ''}
        ${state.jobDetailModal.error ? `<div class="inline-status inline-status-error">${state.jobDetailModal.error}</div>` : ''}
        ${item ? `
          <div class="job-detail-grid">
            <div class="status-box">
              <span class="muted">职位编号</span>
              <strong>${escapeHtml(item.job_key)}</strong>
            </div>
            <div class="status-box">
              <span class="muted">BOSS 职位 ID</span>
              <strong>${escapeHtml(item.boss_encrypt_job_id || '-')}</strong>
            </div>
            <div class="status-box">
              <span class="muted">城市</span>
              <strong>${escapeHtml(item.city || '-')}</strong>
            </div>
            <div class="status-box">
              <span class="muted">薪资</span>
              <strong>${escapeHtml(item.salary || '-')}</strong>
            </div>
            <div class="status-box">
              <span class="muted">候选人总数</span>
              <strong>${item.candidate_count ?? 0}</strong>
            </div>
            <div class="status-box">
              <span class="muted">最后同步时间</span>
              <strong>${formatDateTime(item.last_synced_at)}</strong>
            </div>
          </div>
          <div class="job-detail-sections">
            <section class="job-detail-section">
              <div class="card-header">
                <div>
                  <p class="eyebrow">岗位定制要求</p>
                  <h4 class="card-title job-detail-section-title">本地寻源附加条件</h4>
                </div>
                <button
                  class="button-secondary"
                  onclick="saveJobCustomRequirement()"
                  ${state.jobDetailModal.saving ? 'disabled' : ''}
                >
                  ${state.jobDetailModal.saving ? '保存中...' : '保存要求'}
                </button>
              </div>
              <p class="card-subtitle job-detail-tip">该内容仅保存在本地，不会被 BOSS 职位同步覆盖，寻源调用 nanobot 时会一并带上。</p>
              ${state.jobDetailModal.savingError ? `<div class="inline-status inline-status-error">${escapeHtml(state.jobDetailModal.savingError)}</div>` : ''}
              <textarea
                id="job-custom-requirement-input"
                class="job-detail-textarea"
                placeholder="例如：必须有电销经验；近两年有保险/健康行业背景；优先重庆本地可立即到岗。"
              >${escapeHtml(item.custom_requirement || '')}</textarea>
            </section>
            <section class="job-detail-section">
              <div class="card-header">
                <div>
                  <p class="eyebrow">职位描述</p>
                  <h4 class="card-title job-detail-section-title">JD / 职位说明</h4>
                </div>
              </div>
              <div class="job-detail-jd">${escapeHtml(item.jd_text || '当前尚未同步职位描述。')}</div>
            </section>
            <section class="job-detail-section">
              <div class="card-header">
                <div>
                  <p class="eyebrow">同步字段</p>
                  <h4 class="card-title job-detail-section-title">BOSS 页面已保存信息</h4>
                </div>
              </div>
              ${metadataEntries.length ? `
                <div class="job-meta-grid">
                  ${metadataEntries.map((entry) => `
                    <div class="job-meta-item">
                      <span class="muted">${entry.label}</span>
                      <strong>${escapeHtml(entry.value)}</strong>
                    </div>
                  `).join('')}
                </div>
              ` : '<div class="empty-state">当前没有额外的职位详情字段。</div>'}
            </section>
          </div>
        ` : ''}
      </section>
    </div>
  `;
}

function getJobMetadataEntries(metadata = {}) {
  return Object.entries(metadata || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({
      label: formatMetadataLabel(key),
      value: typeof value === 'string' ? value : JSON.stringify(value)
    }));
}

function formatMetadataLabel(key) {
  const labels = {
    bossBrandName: '招聘主体',
    brandName: '招聘主体',
    experienceRequirement: '经验要求',
    degreeRequirement: '学历要求',
    recruiterName: '招聘方',
    bossJobType: '职位类型',
    bossDepartment: '所属部门',
    address: '工作地点',
    keywords: '关键词',
    welfareTags: '福利标签'
  };

  return labels[key] || key;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderSyncModal() {
  if (!state.syncModal.open) {
    return '';
  }

  const taskMeta = getTaskMeta(state.syncModal.taskType);

  const statusMap = {
    starting: '准备启动',
    running: '执行中',
    completed: '执行完成',
    failed: '执行失败',
    idle: '待开始'
  };

  return `
    <div class="modal-backdrop" onclick="closeSyncModal()">
      <section class="sync-modal" onclick="event.stopPropagation()">
        <div class="card-header">
          <div>
            <p class="eyebrow">${taskMeta.eyebrow}</p>
            <h3 class="card-title">小聘AGENT 执行过程</h3>
            <p class="card-subtitle">任务 ${state.syncModal.runId || '-'} · ${statusMap[state.syncModal.status] || '处理中'}</p>
          </div>
          <button class="button-secondary" onclick="closeSyncModal()">关闭</button>
        </div>
        <div class="sync-summary-grid">
          <div class="status-box">
            <span class="muted">开始时间</span>
            <strong>${formatDateTime(state.syncModal.startedAt)}</strong>
          </div>
          <div class="status-box">
            <span class="muted">当前状态</span>
            <strong>${statusMap[state.syncModal.status] || '处理中'}</strong>
          </div>
        </div>
        ${state.syncModal.error ? `<div class="inline-status inline-status-error">${state.syncModal.error}</div>` : ''}
        <div class="sync-timeline">
          ${buildSyncStages().map((item) => `
            <div class="sync-timeline-item ${item.active ? 'is-active' : ''} ${item.done ? 'is-done' : ''}">
              <div class="sync-timeline-dot"></div>
              <div>
                <div class="list-title">${item.label}</div>
                <div class="list-desc">${item.desc}</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="sync-log-panel">
          <button class="sync-log-toggle" onclick="toggleSyncLogPanel()">
            ${state.syncModal.isExpanded ? '收起详细日志' : '展开详细日志'}
          </button>
          ${state.syncModal.isExpanded ? `
            <div class="sync-log-list">
              ${(state.syncModal.events.length ? state.syncModal.events : [{ message: taskMeta.emptyLogMessage, occurredAt: state.syncModal.startedAt }]).map((event) => `
                <div class="sync-log-item">
                  <span class="sync-log-time">${formatDateTime(event.occurredAt)}</span>
                  <span>${event.message || event.eventType}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </section>
    </div>
  `;
}

function buildSyncStages() {
  return buildSyncTimelineStages({
    runId: state.syncModal.runId,
    status: state.syncModal.status,
    error: state.syncModal.error,
    progress: state.syncModal.progress
  });
}
