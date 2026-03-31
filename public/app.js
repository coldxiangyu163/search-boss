const state = {
  currentUser: null,
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
  scheduleModal: {
    open: false,
    mode: 'create',
    scheduleId: null,
    saving: false,
    error: '',
    form: {
      jobKey: '',
      taskType: 'source',
      startHour: 9,
      startMinute: 0,
      intervalMinutes: 60,
      targetCount: 5,
      maxThreads: 20
    }
  },
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
  },
  hrOverview: [],
  adminDepartments: [],
  adminUsers: [],
  adminHrAccounts: [],
  adminBossAccounts: [],
  adminBrowserInstances: []
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
  buildCandidateTimeline,
  buildResumePreviewUrl
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
  'admin-overview': ['HR 概览', '全员招聘运营看板', '查看所有 HR 的业务数据与执行状态。'],
  'admin-org': ['组织管理', '组织与权限管理', '管理部门、用户、HR 账号与企业管理员配额。'],
  jobs: ['职位管理', '职位招聘执行情况', '统一查看职位需求、城市分布与当前转化效率。'],
  candidates: ['候选人管理', '候选人全流程跟进', '围绕人才状态、简历获取与入站行为进行管理。'],
  automation: ['自动化调度', '任务调度与执行监控', '关注自动化任务编排、执行节奏与系统承接能力。'],
  health: ['系统状态', '系统运行健康中心', '查看平台服务、数据库连接与自动化能力现状。']
};

function isAdmin() {
  return state.currentUser && ['system_admin', 'enterprise_admin', 'dept_admin'].includes(state.currentUser.role);
}

function isSysAdmin() {
  return state.currentUser && state.currentUser.role === 'system_admin';
}

function getNavItems() {
  if (isSysAdmin()) {
    return [
      { view: 'admin-org', title: '组织管理', desc: '部门、用户与 HR 账号' },
      { view: 'health', title: '系统状态', desc: '监控服务与运行健康度' }
    ];
  }
  if (isAdmin()) {
    return [
      { view: 'admin-overview', title: 'HR 概览', desc: '查看本部门 HR 业务数据' },
      { view: 'jobs', title: '职位管理', desc: '部门职位与转化情况' },
      { view: 'candidates', title: '候选人管理', desc: '部门候选人跟踪' },
      { view: 'admin-org', title: 'HR 管理', desc: '管理本部门 HR 账号' },
      { view: 'health', title: '系统状态', desc: '监控服务与运行健康度' }
    ];
  }
  return [
    { view: 'command', title: '运营总览', desc: '查看核心指标与处理进度' },
    { view: 'jobs', title: '职位管理', desc: '统一管理职位与转化情况' },
    { view: 'candidates', title: '候选人管理', desc: '跟踪候选人阶段与简历状态' },
    { view: 'automation', title: '自动化调度', desc: '查看任务编排与执行情况' },
    { view: 'health', title: '系统状态', desc: '监控服务与运行健康度' }
  ];
}

function renderSidebarNav() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  const items = getNavItems();
  const defaultView = items[0].view;
  if (!items.some((i) => i.view === state.view)) {
    state.view = defaultView;
  }
  nav.innerHTML = items.map((item) => `
    <button class="nav-item ${state.view === item.view ? 'is-active' : ''}" data-view="${item.view}">
      <span class="nav-item-title">${item.title}</span>
      <span class="nav-item-desc">${item.desc}</span>
    </button>
  `).join('');
  nav.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      renderSidebarNav();
      render();
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      state.currentUser = data.user;
      if (isAdmin()) {
        state.view = 'admin-overview';
      }
      renderUserInfo();
    }
  } catch (_) {
    // auth not configured, proceed without login
  }
  renderSidebarNav();
  bindEvents();
  loadData();
});

function renderUserInfo() {
  const topbarActions = document.querySelector('.topbar-actions');
  if (!topbarActions || !state.currentUser) return;

  let userEl = document.getElementById('user-info');
  if (!userEl) {
    userEl = document.createElement('div');
    userEl.id = 'user-info';
    userEl.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:12px;font-size:13px;';
    topbarActions.appendChild(userEl);
  }

  const roleNames = {
    system_admin: '系统管理员',
    enterprise_admin: '企业管理员',
    dept_admin: '部门管理员',
    hr: 'HR'
  };
  const roleName = roleNames[state.currentUser.role] || state.currentUser.role;
  const expiryInfo = state.currentUser.expiresAt
    ? ` | 有效期至 ${new Date(state.currentUser.expiresAt).toLocaleDateString()}`
    : '';
  userEl.innerHTML = `
    <span style="color:var(--text-secondary,#666)">${state.currentUser.name} (${roleName}${expiryInfo})</span>
    <button onclick="handleLogout()" style="font-size:12px;padding:4px 8px;cursor:pointer;">退出</button>
  `;
}

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

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
}

async function loadData() {
  state.candidateListLoading = true;
  state.candidateListError = '';
  render();

  const fetches = [
    fetchJson('/api/schedules'),
    fetchJson('/api/dashboard/summary'),
    fetchJson('/api/jobs'),
    fetchCandidates()
  ];

  if (isAdmin()) {
    fetches.push(fetchJson('/api/admin/dashboard/hr-overview'));
    fetches.push(fetchJson('/api/admin/departments').catch(() => ({ items: [] })));
    fetches.push(fetchJson('/api/admin/users').catch(() => ({ items: [] })));
    fetches.push(fetchJson('/api/admin/hr-accounts').catch(() => ({ items: [] })));
    fetches.push(fetchJson('/api/admin/boss-accounts').catch(() => ({ items: [] })));
    fetches.push(fetchJson('/api/admin/browser-instances').catch(() => ({ items: [] })));
  }

  const results = await Promise.all(fetches);
  const [schedules, summary, jobs, candidates] = results;

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

  if (isAdmin()) {
    state.hrOverview = results[4]?.items || [];
    state.adminDepartments = results[5]?.items || [];
    state.adminUsers = results[6]?.items || [];
    state.adminHrAccounts = results[7]?.items || [];
    state.adminBossAccounts = results[8]?.items || [];
    state.adminBrowserInstances = results[9]?.items || [];
  }

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

async function syncRecruitData() {
  const button = document.getElementById('sync-recruit-btn');
  if (!button) {
    return;
  }

  const label = button.querySelector('.sync-inline-label');
  button.disabled = true;
  if (label) label.textContent = '同步中...';

  try {
    await fetchJson('/api/dashboard/sync-recruit-data', { method: 'POST' });
    await loadData();
  } catch (error) {
    state.syncStatus = `BOSS数据同步失败：${error.message}`;
    render();
  } finally {
    button.disabled = false;
    if (label) label.textContent = '同步数据';
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
  const titleEntry = titles[state.view] || titles['command'];
  const [eyebrow, title, description] = titleEntry;
  document.getElementById('page-eyebrow').textContent = eyebrow;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-description').textContent = description;

  const app = document.getElementById('app');

  if (!state.summary) {
    app.innerHTML = '<div class="card">加载中...</div>';
    return;
  }

  if (state.view === 'admin-overview') {
    app.innerHTML = renderAdminOverview();
    return;
  }

  if (state.view === 'admin-org') {
    app.innerHTML = renderAdminOrg();
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

function renderBossLoginCard() {
  if (!state.currentUser || !state.currentUser.hrAccountId) return '';
  return `
    <section class="boss-login-card">
      <div class="card highlight-panel">
        <div class="card-header">
          <div>
            <p class="eyebrow">BOSS 账号</p>
            <h3 class="card-title">浏览器登录状态</h3>
            <p class="card-subtitle">查看当前 BOSS 直聘账号的浏览器画面，扫码登录或确认在线状态。</p>
          </div>
          <button class="sync-inline-btn" onclick="openHrLiveView()">
            <span class="sync-inline-icon">&#128065;</span>
            <span class="sync-inline-label">查看浏览器画面</span>
          </button>
        </div>
      </div>
    </section>
  `;
}

function openHrLiveView() {
  liveView.open = true;
  liveView.instanceId = null;
  liveView.error = '';
  liveView.pageUrl = '';
  liveView.pageTitle = '';
  liveView.useHrEndpoint = true;
  renderLiveViewModal();
  startLiveViewPolling();
}

function renderCommandCenter() {
  const { kpis, queues, health, bossRecruitData } = state.summary;
  const boss = bossRecruitData || {};
  const hasRecruitData = Boolean(bossRecruitData);

  return `
    ${renderBossLoginCard()}
    <section class="card-grid">
      ${metricCard('我看过', boss.viewed?.value ?? '-', boss.viewed ? `较昨日 ${formatDelta(boss.viewed.delta)}` : 'BOSS 数据未同步')}
      ${metricCard('看过我', boss.viewedMe?.value ?? '-', boss.viewedMe ? `较昨日 ${formatDelta(boss.viewedMe.delta)}` : 'BOSS 数据未同步')}
      ${metricCard('我打招呼', boss.greeted?.value ?? '-', boss.greeted ? `较昨日 ${formatDelta(boss.greeted.delta)}` : 'BOSS 数据未同步')}
      ${metricCard('牛人新招呼', boss.newGreetings?.value ?? '-', boss.newGreetings ? `较昨日 ${formatDelta(boss.newGreetings.delta)}` : 'BOSS 数据未同步')}
    </section>
    <section class="overview-grid">
      <div class="data-stack">
        <div class="card highlight-panel">
          <div class="card-header">
            <div>
              <p class="eyebrow">BOSS 招聘数据中心</p>
              <h3 class="card-title">今日核心指标</h3>
              <p class="card-subtitle">${hasRecruitData ? `数据来源：BOSS 直聘，采集于 ${formatDateTime(boss.scrapedAt)}` : '尚未同步 BOSS 招聘数据，点击右侧按钮获取。'}</p>
            </div>
            <button class="sync-inline-btn" id="sync-recruit-btn" onclick="syncRecruitData()">
              <span class="sync-inline-icon">&#8635;</span>
              <span class="sync-inline-label">同步数据</span>
            </button>
          </div>
          <div class="status-grid">
            <div class="status-box">
              <span class="muted">我沟通</span>
              <strong>${boss.chatted?.value ?? '-'}</strong>
              ${boss.chatted ? `<span class="muted">${formatDelta(boss.chatted.delta)}</span>` : ''}
            </div>
            <div class="status-box">
              <span class="muted">收获简历</span>
              <strong>${boss.resumesReceived?.value ?? '-'}</strong>
              ${boss.resumesReceived ? `<span class="muted">${formatDelta(boss.resumesReceived.delta)}</span>` : ''}
            </div>
            <div class="status-box">
              <span class="muted">交换电话微信</span>
              <strong>${boss.contactExchanged?.value ?? '-'}</strong>
              ${boss.contactExchanged ? `<span class="muted">${formatDelta(boss.contactExchanged.delta)}</span>` : ''}
            </div>
            <div class="status-box">
              <span class="muted">接受面试</span>
              <strong>${boss.interviewAccepted?.value ?? '-'}</strong>
              ${boss.interviewAccepted ? `<span class="muted">${formatDelta(boss.interviewAccepted.delta)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="card highlight-panel">
          <div class="card-header">
            <div>
              <p class="eyebrow">系统数据</p>
              <h3 class="card-title">内部管理指标</h3>
            </div>
            <span class="badge">实时</span>
          </div>
          <div class="status-grid">
            <div class="status-box">
              <span class="muted">在招职位数</span>
              <strong>${kpis.jobs}</strong>
            </div>
            <div class="status-box">
              <span class="muted">人才池规模</span>
              <strong>${kpis.candidates}</strong>
            </div>
            <div class="status-box">
              <span class="muted">待处理队列</span>
              <strong>${queues.resumePipeline}</strong>
            </div>
            <div class="status-box">
              <span class="muted">权益余量</span>
              <strong>${boss.quotas?.chat ? `${boss.quotas.chat.used}/${boss.quotas.chat.total}` : '-'}</strong>
            </div>
          </div>
        </div>
      </div>
      <div class="data-stack">
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
                <p class="list-title">关注今日招呼与沟通转化</p>
                <p class="list-desc">今日打招呼 ${boss.greeted?.value ?? '-'} 次，沟通 ${boss.chatted?.value ?? '-'} 人，收获简历 ${boss.resumesReceived?.value ?? '-'} 份。</p>
              </div>
              <span class="badge">分析</span>
            </div>
            <div class="list-item">
              <div>
                <p class="list-title">权益使用情况</p>
                <p class="list-desc">${boss.quotas?.view ? `查看权益 ${boss.quotas.view.used}/${boss.quotas.view.total}，沟通权益 ${boss.quotas.chat.used}/${boss.quotas.chat.total}` : '权益数据未同步。'}</p>
              </div>
              <span class="badge">资源</span>
            </div>
          </div>
        </div>
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
      </div>
    </section>
  `;
}

function formatDelta(delta) {
  if (delta === undefined || delta === null) {
    return '';
  }

  return delta >= 0 ? `+${delta}` : `${delta}`;
}

function renderAdminOverview() {
  const hrs = state.hrOverview || [];
  const { kpis, health } = state.summary;

  const totalJobs = hrs.reduce((s, h) => s + (h.job_count || 0), 0);
  const totalCandidates = hrs.reduce((s, h) => s + (h.candidate_count || 0), 0);
  const totalGreeted = hrs.reduce((s, h) => s + (h.greeted_today || 0), 0);
  const totalResumes = hrs.reduce((s, h) => s + (h.resumes_today || 0), 0);

  return `
    <section class="card-grid">
      ${metricCard('HR 人数', hrs.length, '当前活跃 HR 数')}
      ${metricCard('在招职位', totalJobs, '全部 HR 职位合计')}
      ${metricCard('今日打招呼', totalGreeted, '全部 HR 合计')}
      ${metricCard('今日简历', totalResumes, '全部 HR 合计')}
    </section>
    <section>
      <div class="table-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">HR 运营数据</p>
            <h3 class="card-title">HR 概览表</h3>
          </div>
          <span class="badge">实时</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>HR</th>
              <th>BOSS 账号</th>
              <th>浏览器状态</th>
              <th>岗位数</th>
              <th>候选人数</th>
              <th>今日招呼</th>
              <th>今日跟进</th>
              <th>今日简历</th>
              <th>最近任务</th>
            </tr>
          </thead>
          <tbody>
            ${hrs.length === 0 ? '<tr><td colspan="9" style="text-align:center;color:var(--text-muted,#999)">暂无 HR 数据</td></tr>' : ''}
            ${hrs.map((hr) => `
              <tr>
                <td><strong>${hr.hr_name || '-'}</strong></td>
                <td>${hr.boss_account_name || '<span style="color:var(--text-muted,#999)">未绑定</span>'}</td>
                <td>${renderBrowserBadge(hr.browser_status)}</td>
                <td>${hr.job_count || 0}</td>
                <td>${hr.candidate_count || 0}</td>
                <td>${hr.greeted_today || 0}</td>
                <td>${hr.followup_today || 0}</td>
                <td>${hr.resumes_today || 0}</td>
                <td>${renderRunStatusBadge(hr.last_run_status, hr.last_run_mode)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
    <section class="overview-grid" style="margin-top:16px">
      <div class="table-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">系统数据</p>
            <h3 class="card-title">全局指标</h3>
          </div>
        </div>
        <div class="status-grid">
          <div class="status-box">
            <span class="muted">总职位数</span>
            <strong>${kpis.jobs}</strong>
          </div>
          <div class="status-box">
            <span class="muted">总候选人数</span>
            <strong>${kpis.candidates}</strong>
          </div>
        </div>
      </div>
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
    </section>
  `;
}

function renderBrowserBadge(status) {
  if (!status) return '<span class="badge">未配置</span>';
  const map = {
    idle: ['空闲', 'badge-success'],
    busy: ['执行中', 'badge-warning'],
    disabled: ['已禁用', ''],
    error: ['异常', 'badge-danger']
  };
  const [label, cls] = map[status] || [status, ''];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderRunStatusBadge(status, mode) {
  if (!status) return '<span style="color:var(--text-muted,#999)">无</span>';
  const modeLabel = { source: '寻源', followup: '跟进', chat: '沟通', download: '下载', sync_jobs: '同步', status: '状态' };
  const statusMap = {
    running: ['执行中', 'badge-warning'],
    completed: ['已完成', 'badge-success'],
    failed: ['失败', 'badge-danger'],
    pending: ['等待中', '']
  };
  const [label, cls] = statusMap[status] || [status, ''];
  return `<span class="badge ${cls}">${modeLabel[mode] || mode || ''} ${label}</span>`;
}

function renderAdminOrg() {
  const depts = state.adminDepartments || [];
  const users = state.adminUsers || [];
  const hrAccounts = state.adminHrAccounts || [];
  const bossAccounts = state.adminBossAccounts || [];
  const browserInstances = state.adminBrowserInstances || [];
  const roleNames = { system_admin: '系统管理员', enterprise_admin: '企业管理员', dept_admin: '部门管理员', hr: 'HR' };
  const deptOptions = depts.filter((d) => d.status === 'active').map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
  const hrOptions = hrAccounts.filter((h) => h.status === 'active').map((h) => `<option value="${h.id}">${h.name}</option>`).join('');
  const baOptions = bossAccounts.filter((b) => b.status === 'active').map((b) => `<option value="${b.id}">${b.display_name || b.boss_login_name || 'BOSS#' + b.id}</option>`).join('');
  const sys = isSysAdmin();

  let html = '';

  if (sys) {
    html += `
    <section>
      <div class="table-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">组织架构</p>
            <h3 class="card-title">部门列表</h3>
          </div>
          <button class="button-primary" onclick="showModal('dept-modal')">新增部门</button>
        </div>
        <table class="data-table">
          <thead><tr><th>ID</th><th>名称</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${depts.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted,#999)">暂无部门</td></tr>' : ''}
            ${depts.map((d) => `<tr>
              <td>${d.id}</td><td>${d.name}</td>
              <td><span class="badge ${d.status === 'active' ? 'badge-success' : 'badge-danger'}">${d.status === 'active' ? '启用' : '停用'}</span></td>
              <td>
                <button class="btn-sm" onclick="editDept(${d.id}, '${d.name.replace(/'/g, "\\'")}', '${d.status || 'active'}')">编辑</button>
                <button class="btn-sm btn-danger" onclick="deleteDept(${d.id}, '${d.name.replace(/'/g, "\\'")}')">删除</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`;

    const enterpriseAdmins = users.filter((u) => u.role === 'enterprise_admin');
    html += `
    <section style="margin-top:16px">
      <div class="table-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">企业管理</p>
            <h3 class="card-title">企业管理员</h3>
            <p class="card-subtitle">设置每个企业管理员的有效期和可添加的 HR 账号数量上限。</p>
          </div>
        </div>
        <table class="data-table">
          <thead><tr><th>ID</th><th>姓名</th><th>邮箱</th><th>部门</th><th>状态</th><th>有效期</th><th>HR上限</th><th>已用HR数</th><th>操作</th></tr></thead>
          <tbody>
            ${enterpriseAdmins.length === 0 ? '<tr><td colspan="9" style="text-align:center;color:var(--text-muted,#999)">暂无企业管理员</td></tr>' : ''}
            ${enterpriseAdmins.map((u) => {
              const hrCount = hrAccounts.filter((h) => String(h.department_id) === String(u.department_id)).length;
              const expired = u.expires_at && new Date(u.expires_at) < new Date();
              const expiryText = u.expires_at ? new Date(u.expires_at).toLocaleDateString() : '永久';
              const expiryClass = expired ? 'badge-danger' : 'badge-success';
              return `<tr>
                <td>${u.id}</td><td>${u.name}</td><td>${u.email || '-'}</td>
                <td>${u.department_name || '-'}</td>
                <td><span class="badge ${u.status === 'active' ? 'badge-success' : 'badge-danger'}">${u.status === 'active' ? '启用' : '停用'}</span></td>
                <td><span class="badge ${expiryClass}">${expiryText}</span></td>
                <td>${u.max_hr_accounts || '不限'}</td>
                <td>${hrCount}</td>
                <td>
                  <button class="btn-sm" onclick='showLimitsModal(${JSON.stringify({ id: u.id, name: u.name, expires_at: u.expires_at, max_hr_accounts: u.max_hr_accounts }).replace(/'/g, "&#39;")})'>配额设置</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>`;
  }

  html += `
    <section style="margin-top:16px">
      <div class="table-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">人员管理</p>
            <h3 class="card-title">系统用户</h3>
          </div>
          ${sys ? '<button class="button-primary" onclick="showModal(\'user-modal\')">新增用户</button>' : ''}
        </div>
        <table class="data-table">
          <thead><tr><th>ID</th><th>姓名</th><th>邮箱</th><th>角色</th><th>部门</th><th>状态</th>${sys ? '<th>操作</th>' : ''}</tr></thead>
          <tbody>
            ${users.length === 0 ? `<tr><td colspan="${sys ? 7 : 6}" style="text-align:center;color:var(--text-muted,#999)">暂无用户</td></tr>` : ''}
            ${users.map((u) => `<tr>
              <td>${u.id}</td><td>${u.name}</td><td>${u.email || '-'}</td>
              <td>${roleNames[u.role] || u.role}</td><td>${u.department_name || '-'}</td>
              <td><span class="badge ${u.status === 'active' ? 'badge-success' : 'badge-danger'}">${u.status === 'active' ? '启用' : '停用'}</span></td>
              ${sys ? `<td>
                <button class="btn-sm" onclick='editUser(${JSON.stringify(u).replace(/'/g, "&#39;")})'>编辑</button>
                <button class="btn-sm" onclick="resetPassword(${u.id}, '${u.name.replace(/'/g, "\\'")}')">重置密码</button>
                <button class="btn-sm btn-danger" onclick="deleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')">删除</button>
              </td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>
    <section style="margin-top:16px">
      <div class="table-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">HR 账号</p>
            <h3 class="card-title">HR 业务账号</h3>
            <p class="card-subtitle">HR 账号关联系统用户，用于数据隔离与权限管理。</p>
          </div>
          <button class="button-primary" onclick="showModal('hr-modal')">新增HR账号</button>
        </div>
        <table class="data-table">
          <thead><tr><th>ID</th><th>HR 名称</th><th>登录账号</th><th>部门</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${hrAccounts.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted,#999)">暂无 HR 账号</td></tr>' : ''}
            ${hrAccounts.map((h) => `<tr>
              <td>${h.id}</td><td>${h.name}</td><td>${h.user_email || '-'}</td><td>${h.department_name || '-'}</td>
              <td><span class="badge ${h.status === 'active' ? 'badge-success' : 'badge-danger'}">${h.status === 'active' ? '启用' : '停用'}</span></td>
              <td>
                <button class="btn-sm" onclick='editHrAccount(${JSON.stringify(h).replace(/'/g, "&#39;")})'>编辑</button>
                ${sys ? `<button class="btn-sm btn-danger" onclick="deleteHrAccount(${h.id}, '${h.name.replace(/'/g, "\\'")}')">删除</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>

    ${sys ? `<div id="dept-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('dept-modal')">
      <div class="modal-content">
        <h3 id="dept-modal-title">新增部门</h3>
        <form onsubmit="return submitDept(event)">
          <input type="hidden" id="dept-edit-id" value="">
          <div class="form-group">
            <label>部门名称</label>
            <input type="text" id="dept-name" required placeholder="请输入部门名称">
          </div>
          <div class="form-group" id="dept-status-group" style="display:none">
            <label>状态</label>
            <select id="dept-status"><option value="active">启用</option><option value="inactive">停用</option></select>
          </div>
          <div class="modal-actions">
            <button type="button" class="button-secondary" onclick="closeModal('dept-modal')">取消</button>
            <button type="submit" class="button-primary">确定</button>
          </div>
        </form>
      </div>
    </div>` : ''}

    ${sys ? `<div id="user-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('user-modal')">
      <div class="modal-content">
        <h3 id="user-modal-title">新增用户</h3>
        <form onsubmit="return submitUser(event)">
          <input type="hidden" id="user-edit-id" value="">
          <div class="form-group"><label>姓名</label><input type="text" id="user-name" required placeholder="请输入姓名"></div>
          <div class="form-group"><label>邮箱</label><input type="email" id="user-email" required placeholder="请输入邮箱"></div>
          <div class="form-group"><label>手机号</label><input type="text" id="user-phone" placeholder="选填"></div>
          <div class="form-group">
            <label>角色</label>
            <select id="user-role"><option value="hr">HR</option><option value="dept_admin">部门管理员</option><option value="enterprise_admin">企业管理员</option></select>
          </div>
          <div class="form-group"><label>所属部门</label><select id="user-dept"><option value="">不分配</option>${deptOptions}</select></div>
          <div class="form-group" id="user-password-group"><label>密码</label><input type="password" id="user-password" placeholder="至少6位" minlength="6"></div>
          <div class="form-group" id="user-status-group" style="display:none">
            <label>状态</label>
            <select id="user-status"><option value="active">启用</option><option value="inactive">停用</option></select>
          </div>
          <div class="modal-actions">
            <button type="button" class="button-secondary" onclick="closeModal('user-modal')">取消</button>
            <button type="submit" class="button-primary">确定</button>
          </div>
        </form>
      </div>
    </div>` : ''}

    <div id="hr-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('hr-modal')">
      <div class="modal-content">
        <h3 id="hr-modal-title">新增HR账号</h3>
        <form onsubmit="return submitHrAccount(event)">
          <input type="hidden" id="hr-edit-id" value="">
          <div class="form-group"><label>HR 名称</label><input type="text" id="hr-name" required placeholder="请输入HR名称"></div>
          <div class="form-group">
            <label>关联用户</label>
            <select id="hr-user-id" required>
              <option value="">请选择用户</option>
              ${users.filter((u) => u.role === 'hr' && u.status === 'active').map((u) => `<option value="${u.id}">${u.name} (${u.email})</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>所属部门</label><select id="hr-dept"><option value="">不分配</option>${deptOptions}</select></div>
          <div class="form-group"><label>备注</label><input type="text" id="hr-notes" placeholder="选填"></div>
          <div class="form-group" id="hr-status-group" style="display:none">
            <label>状态</label>
            <select id="hr-status"><option value="active">启用</option><option value="inactive">停用</option></select>
          </div>
          <div class="modal-actions">
            <button type="button" class="button-secondary" onclick="closeModal('hr-modal')">取消</button>
            <button type="submit" class="button-primary">确定</button>
          </div>
        </form>
      </div>
    </div>

    <div id="limits-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('limits-modal')">
      <div class="modal-content">
        <h3 id="limits-modal-title">配额设置</h3>
        <form onsubmit="return submitLimits(event)">
          <input type="hidden" id="limits-user-id" value="">
          <div class="form-group"><label>有效期</label><input type="date" id="limits-expires-at"></div>
          <div class="form-group"><label>HR 账号上限（0 表示不限）</label><input type="number" id="limits-max-hr" min="0" value="0"></div>
          <div class="modal-actions">
            <button type="button" class="button-secondary" onclick="closeModal('limits-modal')">取消</button>
            <button type="submit" class="button-primary">确定</button>
          </div>
        </form>
      </div>
    </div>
  `;

  if (sys) {
    html += renderSysAdminBossAndBrowser(bossAccounts, browserInstances, hrOptions, baOptions);
  }

  return html;
}

function renderSysAdminBossAndBrowser(bossAccounts, browserInstances, hrOptions, baOptions) {
  return `
    <section style="margin-top:16px">
      <div class="table-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">BOSS 账号</p>
            <h3 class="card-title">BOSS 直聘账号</h3>
            <p class="card-subtitle">每个 HR 账号对应一个 BOSS 直聘登录账号。</p>
          </div>
          <button class="button-primary" onclick="showModal('ba-modal')">新增BOSS账号</button>
        </div>
        <table class="data-table">
          <thead><tr><th>ID</th><th>BOSS 登录名</th><th>显示名</th><th>关联 HR</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${bossAccounts.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted,#999)">暂无 BOSS 账号</td></tr>' : ''}
            ${bossAccounts.map((b) => `<tr>
              <td>${b.id}</td><td>${b.boss_login_name || '-'}</td><td>${b.display_name || '-'}</td>
              <td>${b.hr_account_name || '-'}</td>
              <td><span class="badge ${b.status === 'active' ? 'badge-success' : 'badge-danger'}">${b.status === 'active' ? '启用' : '停用'}</span></td>
              <td>
                <button class="btn-sm" onclick='editBossAccount(${JSON.stringify(b).replace(/'/g, "&#39;")})'>编辑</button>
                <button class="btn-sm btn-danger" onclick="deleteBossAccount(${b.id})">删除</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>
    <section style="margin-top:16px">
      <div class="table-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">浏览器实例</p>
            <h3 class="card-title">Chrome 浏览器实例</h3>
            <p class="card-subtitle">每个 BOSS 账号绑定独立的 Chrome 实例，通过 CDP 端口控制。</p>
          </div>
          <button class="button-primary" onclick="showModal('bi-modal')">新增浏览器实例</button>
        </div>
        <table class="data-table">
          <thead><tr><th>ID</th><th>名称</th><th>CDP 端点</th><th>BOSS 账号</th><th>HR</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${browserInstances.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted,#999)">暂无浏览器实例</td></tr>' : ''}
            ${browserInstances.map((bi) => {
              const statusCls = { idle: 'badge-success', busy: 'badge-warning', offline: 'badge-danger' }[bi.status] || '';
              const statusText = { idle: '空闲', busy: '忙碌', offline: '离线' }[bi.status] || bi.status;
              return `<tr>
                <td>${bi.id}</td><td>${bi.instance_name || '-'}</td>
                <td><code style="font-size:12px">${bi.cdp_endpoint}</code></td>
                <td>${bi.boss_display_name || bi.boss_login_name || '-'}</td>
                <td>${bi.hr_account_name || '-'}</td>
                <td><span class="badge ${statusCls}">${statusText}</span></td>
                <td>
                  <button class="btn-sm" onclick='editBrowserInstance(${JSON.stringify(bi).replace(/'/g, "&#39;")})'>编辑</button>
                  <button class="btn-sm" onclick="checkBrowserInstance(${bi.id})">检测</button>
                  <button class="btn-sm" onclick="openLiveView(${bi.id})">实时画面</button>
                  <button class="btn-sm btn-danger" onclick="deleteBrowserInstance(${bi.id})">删除</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <div id="ba-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('ba-modal')">
      <div class="modal-content">
        <h3 id="ba-modal-title">新增BOSS账号</h3>
        <form onsubmit="return submitBossAccount(event)">
          <input type="hidden" id="ba-edit-id" value="">
          <div class="form-group"><label>关联HR账号</label><select id="ba-hr" required><option value="">请选择</option>${hrOptions}</select></div>
          <div class="form-group"><label>BOSS 登录名</label><input type="text" id="ba-login" placeholder="BOSS直聘登录账号"></div>
          <div class="form-group"><label>显示名称</label><input type="text" id="ba-display" placeholder="便于识别的名称"></div>
          <div class="form-group" id="ba-status-group" style="display:none">
            <label>状态</label>
            <select id="ba-status"><option value="active">启用</option><option value="inactive">停用</option></select>
          </div>
          <div class="modal-actions">
            <button type="button" class="button-secondary" onclick="closeModal('ba-modal')">取消</button>
            <button type="submit" class="button-primary">确定</button>
          </div>
        </form>
      </div>
    </div>

    <div id="bi-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('bi-modal')">
      <div class="modal-content">
        <h3 id="bi-modal-title">新增浏览器实例</h3>
        <form onsubmit="return submitBrowserInstance(event)">
          <input type="hidden" id="bi-edit-id" value="">
          <div class="form-group"><label>关联BOSS账号</label><select id="bi-ba" required><option value="">请选择</option>${baOptions}</select></div>
          <div class="form-group"><label>实例名称</label><input type="text" id="bi-name" placeholder="如：Chrome-HR1"></div>
          <div class="form-group"><label>CDP 端点</label><input type="text" id="bi-cdp" required placeholder="http://127.0.0.1:9222"></div>
          <div class="form-group"><label>用户数据目录</label><input type="text" id="bi-userdata" required placeholder="/path/to/chrome-profile"></div>
          <div class="form-group"><label>下载目录</label><input type="text" id="bi-download" required placeholder="/path/to/downloads"></div>
          <div class="form-group"><label>调试端口</label><input type="number" id="bi-port" placeholder="9222"></div>
          <div class="form-group"><label>主机</label><input type="text" id="bi-host" placeholder="localhost" value="localhost"></div>
          <div class="form-group" id="bi-status-group" style="display:none">
            <label>状态</label>
            <select id="bi-status"><option value="idle">空闲</option><option value="offline">离线</option></select>
          </div>
          <div class="modal-actions">
            <button type="button" class="button-secondary" onclick="closeModal('bi-modal')">取消</button>
            <button type="submit" class="button-primary">确定</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function showLimitsModal(u) {
  document.getElementById('limits-modal-title').textContent = '配额设置 - ' + u.name;
  document.getElementById('limits-user-id').value = u.id;
  document.getElementById('limits-expires-at').value = u.expires_at ? u.expires_at.split('T')[0] : '';
  document.getElementById('limits-max-hr').value = u.max_hr_accounts || 0;
  document.getElementById('limits-modal').style.display = 'flex';
}

async function submitLimits(e) {
  e.preventDefault();
  const userId = document.getElementById('limits-user-id').value;
  const expiresAt = document.getElementById('limits-expires-at').value || null;
  const maxHrAccounts = parseInt(document.getElementById('limits-max-hr').value) || 0;
  try {
    await fetchJson('/api/admin/users/' + userId + '/limits', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresAt, maxHrAccounts })
    });
    closeModal('limits-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (id === 'dept-modal' && !document.getElementById('dept-edit-id').value) {
    document.getElementById('dept-modal-title').textContent = '新增部门';
    document.getElementById('dept-edit-id').value = '';
    document.getElementById('dept-name').value = '';
    document.getElementById('dept-status-group').style.display = 'none';
  }
  if (id === 'user-modal' && !document.getElementById('user-edit-id').value) {
    document.getElementById('user-modal-title').textContent = '新增用户';
    document.getElementById('user-edit-id').value = '';
    document.getElementById('user-name').value = '';
    document.getElementById('user-email').value = '';
    document.getElementById('user-phone').value = '';
    document.getElementById('user-role').value = 'hr';
    document.getElementById('user-dept').value = '';
    document.getElementById('user-password').value = '';
    document.getElementById('user-password-group').style.display = '';
    document.getElementById('user-status-group').style.display = 'none';
  }
  if (id === 'hr-modal' && !document.getElementById('hr-edit-id').value) {
    document.getElementById('hr-modal-title').textContent = '新增HR账号';
    document.getElementById('hr-edit-id').value = '';
    document.getElementById('hr-name').value = '';
    document.getElementById('hr-user-id').value = '';
    document.getElementById('hr-dept').value = '';
    document.getElementById('hr-notes').value = '';
    document.getElementById('hr-status-group').style.display = 'none';
  }
  if (id === 'ba-modal' && !document.getElementById('ba-edit-id').value) {
    document.getElementById('ba-modal-title').textContent = '新增BOSS账号';
    document.getElementById('ba-edit-id').value = '';
    document.getElementById('ba-hr').value = '';
    document.getElementById('ba-hr').disabled = false;
    document.getElementById('ba-login').value = '';
    document.getElementById('ba-display').value = '';
    document.getElementById('ba-status-group').style.display = 'none';
  }
  if (id === 'bi-modal' && !document.getElementById('bi-edit-id').value) {
    document.getElementById('bi-modal-title').textContent = '新增浏览器实例';
    document.getElementById('bi-edit-id').value = '';
    document.getElementById('bi-ba').value = '';
    document.getElementById('bi-ba').disabled = false;
    document.getElementById('bi-name').value = '';
    document.getElementById('bi-cdp').value = '';
    document.getElementById('bi-userdata').value = '';
    document.getElementById('bi-download').value = '';
    document.getElementById('bi-port').value = '';
    document.getElementById('bi-host').value = 'localhost';
    document.getElementById('bi-status-group').style.display = 'none';
  }
  modal.style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

async function submitDept(e) {
  e.preventDefault();
  const id = document.getElementById('dept-edit-id').value;
  const name = document.getElementById('dept-name').value.trim();
  const status = document.getElementById('dept-status').value;
  if (!name) return false;
  try {
    if (id) {
      await fetchJson('/api/admin/departments/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, status })
      });
    } else {
      await fetchJson('/api/admin/departments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
    }
    closeModal('dept-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function editDept(id, name, status) {
  document.getElementById('dept-modal-title').textContent = '编辑部门';
  document.getElementById('dept-edit-id').value = id;
  document.getElementById('dept-name').value = name;
  document.getElementById('dept-status').value = status;
  document.getElementById('dept-status-group').style.display = '';
  showModal('dept-modal');
}

async function deleteDept(id, name) {
  if (!confirm('确定删除部门「' + name + '」？')) return;
  try {
    await fetchJson('/api/admin/departments/' + id, { method: 'DELETE' });
    await loadData();
  } catch (err) { alert(err.message); }
}

async function submitUser(e) {
  e.preventDefault();
  const id = document.getElementById('user-edit-id').value;
  const name = document.getElementById('user-name').value.trim();
  const email = document.getElementById('user-email').value.trim();
  const phone = document.getElementById('user-phone').value.trim();
  const role = document.getElementById('user-role').value;
  const departmentId = document.getElementById('user-dept').value || null;
  const password = document.getElementById('user-password').value;
  const status = document.getElementById('user-status').value;
  if (!name || !email) return false;
  try {
    if (id) {
      await fetchJson('/api/admin/users/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone: phone || null, role, departmentId, status })
      });
    } else {
      if (!password || password.length < 6) { alert('密码不能少于6位'); return false; }
      await fetchJson('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone: phone || null, password, role, departmentId })
      });
    }
    closeModal('user-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function editUser(u) {
  document.getElementById('user-modal-title').textContent = '编辑用户';
  document.getElementById('user-edit-id').value = u.id;
  document.getElementById('user-name').value = u.name;
  document.getElementById('user-email').value = u.email || '';
  document.getElementById('user-phone').value = u.phone || '';
  document.getElementById('user-role').value = u.role;
  document.getElementById('user-dept').value = u.department_id || '';
  document.getElementById('user-password-group').style.display = 'none';
  document.getElementById('user-status-group').style.display = '';
  document.getElementById('user-status').value = u.status || 'active';
  showModal('user-modal');
}

async function resetPassword(userId, name) {
  const pw = prompt('请输入「' + name + '」的新密码（至少6位）：');
  if (!pw) return;
  if (pw.length < 6) { alert('密码不能少于6位'); return; }
  try {
    await fetchJson('/api/admin/users/' + userId + '/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    alert('密码已重置');
  } catch (err) { alert(err.message); }
}

async function deleteUser(id, name) {
  if (!confirm('确定删除用户「' + name + '」？')) return;
  try {
    await fetchJson('/api/admin/users/' + id, { method: 'DELETE' });
    await loadData();
  } catch (err) { alert(err.message); }
}

async function submitHrAccount(e) {
  e.preventDefault();
  const id = document.getElementById('hr-edit-id').value;
  const name = document.getElementById('hr-name').value.trim();
  const userId = document.getElementById('hr-user-id').value;
  const departmentId = document.getElementById('hr-dept').value || null;
  const notes = document.getElementById('hr-notes').value.trim();
  const status = document.getElementById('hr-status').value;
  if (!name || !userId) return false;
  try {
    if (id) {
      await fetchJson('/api/admin/hr-accounts/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, status, notes: notes || null })
      });
    } else {
      await fetchJson('/api/admin/hr-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, departmentId, name, notes: notes || null })
      });
    }
    closeModal('hr-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function editHrAccount(h) {
  document.getElementById('hr-modal-title').textContent = '编辑HR账号';
  document.getElementById('hr-edit-id').value = h.id;
  document.getElementById('hr-name').value = h.name;
  document.getElementById('hr-user-id').value = h.user_id || '';
  document.getElementById('hr-dept').value = h.department_id || '';
  document.getElementById('hr-notes').value = h.notes || '';
  document.getElementById('hr-status-group').style.display = '';
  document.getElementById('hr-status').value = h.status || 'active';
  showModal('hr-modal');
}

async function deleteHrAccount(id, name) {
  if (!confirm('确定删除HR账号「' + name + '」？')) return;
  try {
    await fetchJson('/api/admin/hr-accounts/' + id, { method: 'DELETE' });
    await loadData();
  } catch (err) { alert(err.message); }
}

async function submitBossAccount(e) {
  e.preventDefault();
  const id = document.getElementById('ba-edit-id').value;
  const hrAccountId = document.getElementById('ba-hr').value;
  const bossLoginName = document.getElementById('ba-login').value.trim();
  const displayName = document.getElementById('ba-display').value.trim();
  const status = document.getElementById('ba-status').value;
  try {
    if (id) {
      await fetchJson('/api/admin/boss-accounts/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bossLoginName, displayName, status })
      });
    } else {
      await fetchJson('/api/admin/boss-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hrAccountId, bossLoginName, displayName })
      });
    }
    closeModal('ba-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function editBossAccount(b) {
  document.getElementById('ba-modal-title').textContent = '编辑BOSS账号';
  document.getElementById('ba-edit-id').value = b.id;
  document.getElementById('ba-hr').value = b.hr_account_id || '';
  document.getElementById('ba-hr').disabled = true;
  document.getElementById('ba-login').value = b.boss_login_name || '';
  document.getElementById('ba-display').value = b.display_name || '';
  document.getElementById('ba-status-group').style.display = '';
  document.getElementById('ba-status').value = b.status || 'active';
  showModal('ba-modal');
}

async function deleteBossAccount(id) {
  if (!confirm('确定删除该BOSS账号？')) return;
  try {
    await fetchJson('/api/admin/boss-accounts/' + id, { method: 'DELETE' });
    await loadData();
  } catch (err) { alert(err.message); }
}

async function submitBrowserInstance(e) {
  e.preventDefault();
  const id = document.getElementById('bi-edit-id').value;
  const bossAccountId = document.getElementById('bi-ba').value;
  const instanceName = document.getElementById('bi-name').value.trim();
  const cdpEndpoint = document.getElementById('bi-cdp').value.trim();
  const userDataDir = document.getElementById('bi-userdata').value.trim();
  const downloadDir = document.getElementById('bi-download').value.trim();
  const debugPort = document.getElementById('bi-port').value || null;
  const host = document.getElementById('bi-host').value.trim() || 'localhost';
  const status = document.getElementById('bi-status').value;
  try {
    if (id) {
      await fetchJson('/api/admin/browser-instances/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName, cdpEndpoint, userDataDir, downloadDir, debugPort, host, status })
      });
    } else {
      await fetchJson('/api/admin/browser-instances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bossAccountId, instanceName, cdpEndpoint, userDataDir, downloadDir, debugPort, host })
      });
    }
    closeModal('bi-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function editBrowserInstance(bi) {
  document.getElementById('bi-modal-title').textContent = '编辑浏览器实例';
  document.getElementById('bi-edit-id').value = bi.id;
  document.getElementById('bi-ba').value = bi.boss_account_id || '';
  document.getElementById('bi-ba').disabled = true;
  document.getElementById('bi-name').value = bi.instance_name || '';
  document.getElementById('bi-cdp').value = bi.cdp_endpoint || '';
  document.getElementById('bi-userdata').value = bi.user_data_dir || '';
  document.getElementById('bi-download').value = bi.download_dir || '';
  document.getElementById('bi-port').value = bi.debug_port || '';
  document.getElementById('bi-host').value = bi.host || 'localhost';
  document.getElementById('bi-status-group').style.display = '';
  document.getElementById('bi-status').value = bi.status || 'idle';
  showModal('bi-modal');
}

async function checkBrowserInstance(id) {
  try {
    const result = await fetchJson('/api/admin/browser-instances/' + id + '/check', { method: 'POST' });
    if (result.ok) {
      alert('浏览器在线: ' + result.browser);
    } else {
      alert('浏览器离线: ' + result.message);
    }
    await loadData();
  } catch (err) { alert(err.message); }
}

async function deleteBrowserInstance(id) {
  if (!confirm('确定删除该浏览器实例？')) return;
  try {
    await fetchJson('/api/admin/browser-instances/' + id, { method: 'DELETE' });
    await loadData();
  } catch (err) { alert(err.message); }
}

const liveView = {
  open: false,
  instanceId: null,
  timer: null,
  boostTimer: null,
  pollInterval: 800,
  fetching: false,
  error: '',
  pageUrl: '',
  pageTitle: '',
  viewportWidth: 0,
  viewportHeight: 0,
  useHrEndpoint: false
};

function openLiveView(instanceId) {
  liveView.open = true;
  liveView.instanceId = instanceId;
  liveView.error = '';
  liveView.pageUrl = '';
  liveView.pageTitle = '';
  liveView.viewportWidth = 0;
  liveView.viewportHeight = 0;
  liveView.useHrEndpoint = false;
  renderLiveViewModal();
  startLiveViewPolling();
}

function closeLiveView() {
  stopLiveViewPolling();
  if (liveView.boostTimer) {
    clearTimeout(liveView.boostTimer);
    liveView.boostTimer = null;
  }
  liveView.open = false;
  liveView.instanceId = null;
  liveView.error = '';
  liveView.viewportWidth = 0;
  liveView.viewportHeight = 0;
  const modal = document.getElementById('live-view-modal');
  if (modal) modal.remove();
}

function startLiveViewPolling(intervalMs) {
  stopLiveViewPolling();
  liveView.pollInterval = intervalMs || 800;
  refreshLiveView();
  liveView.timer = window.setInterval(refreshLiveView, liveView.pollInterval);
}

function stopLiveViewPolling() {
  if (liveView.timer) {
    window.clearInterval(liveView.timer);
    liveView.timer = null;
  }
}

function boostLiveViewPolling() {
  if (!liveView.open) return;
  startLiveViewPolling(400);
  if (liveView.boostTimer) clearTimeout(liveView.boostTimer);
  liveView.boostTimer = setTimeout(() => {
    if (liveView.open) startLiveViewPolling(800);
    liveView.boostTimer = null;
  }, 3000);
}

async function refreshLiveView() {
  if (!liveView.open || (!liveView.instanceId && !liveView.useHrEndpoint)) return;
  if (liveView.fetching) return;
  const img = document.getElementById('live-view-img');
  if (!img) return;

  liveView.fetching = true;
  try {
    const needViewport = !liveView.viewportWidth;
    const base = liveView.useHrEndpoint
      ? '/api/browser/screenshot'
      : `/api/admin/browser-instances/${liveView.instanceId}/screenshot`;
    const screenshotUrl = needViewport ? base + '?viewport=1' : base;
    const response = await fetch(screenshotUrl);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      liveView.error = data.message || '截图失败';
      updateLiveViewStatus();
      return;
    }
    liveView.error = '';
    liveView.pageUrl = decodeURIComponent(response.headers.get('X-Page-Url') || '');
    liveView.pageTitle = decodeURIComponent(response.headers.get('X-Page-Title') || '');
    const vw = Number(response.headers.get('X-Viewport-Width'));
    const vh = Number(response.headers.get('X-Viewport-Height'));
    if (vw && vh) {
      liveView.viewportWidth = vw;
      liveView.viewportHeight = vh;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const oldSrc = img.src;
    img.src = url;
    if (oldSrc && oldSrc.startsWith('blob:')) {
      URL.revokeObjectURL(oldSrc);
    }
    updateLiveViewStatus();
  } catch (err) {
    liveView.error = '网络错误: ' + err.message;
    updateLiveViewStatus();
  } finally {
    liveView.fetching = false;
  }
}

function updateLiveViewStatus() {
  const statusEl = document.getElementById('live-view-status');
  if (!statusEl) return;
  if (liveView.error) {
    statusEl.innerHTML = `<span class="live-view-error">${escapeHtml(liveView.error)}</span>`;
  } else {
    const title = liveView.pageTitle || '加载中...';
    statusEl.innerHTML = `<span class="live-view-info">${escapeHtml(title)}</span>`;
  }
}

function renderLiveViewModal() {
  let modal = document.getElementById('live-view-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'live-view-modal';
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  modal.onclick = (e) => { if (e.target === modal) closeLiveView(); };
  const modalTitle = liveView.useHrEndpoint ? '我的 BOSS 浏览器' : `实例 #${liveView.instanceId}`;
  modal.innerHTML = `
    <div class="live-view-container">
      <div class="live-view-header">
        <div>
          <p class="eyebrow">浏览器实时画面</p>
          <h3 class="card-title">${modalTitle}</h3>
          <div id="live-view-status" class="live-view-status">
            <span class="live-view-info">连接中...</span>
          </div>
        </div>
        <div class="live-view-actions">
          <span class="live-view-dot"></span>
          <button class="button-secondary" onclick="closeLiveView()">关闭</button>
        </div>
      </div>
      <div class="live-view-body" id="live-view-body">
        <div class="live-view-img-wrapper">
          <img id="live-view-img" class="live-view-img" alt="浏览器画面加载中..." />
          <div id="live-view-click-indicator" class="live-view-click-indicator"></div>
        </div>
      </div>
      <div class="live-view-footer">
        <span class="live-view-hint">点击画面可操作远程浏览器</span>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const img = document.getElementById('live-view-img');
  if (img) {
    img.style.cursor = 'crosshair';
    img.addEventListener('click', handleLiveViewClick);
  }
}

async function handleLiveViewClick(event) {
  const img = event.target;
  const rect = img.getBoundingClientRect();
  const ratioX = event.clientX - rect.left;
  const ratioY = event.clientY - rect.top;

  const targetWidth = liveView.viewportWidth || img.naturalWidth;
  const targetHeight = liveView.viewportHeight || img.naturalHeight;
  const pageX = (ratioX / rect.width) * targetWidth;
  const pageY = (ratioY / rect.height) * targetHeight;

  showClickIndicator(ratioX, ratioY);

  const clickUrl = liveView.useHrEndpoint
    ? '/api/browser/click'
    : `/api/admin/browser-instances/${liveView.instanceId}/click`;

  try {
    await fetch(clickUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: Math.round(pageX), y: Math.round(pageY) })
    });
    refreshLiveView();
    boostLiveViewPolling();
  } catch (err) {
    console.error('click failed:', err);
  }
}

function showClickIndicator(x, y) {
  const indicator = document.getElementById('live-view-click-indicator');
  if (!indicator) return;
  indicator.style.left = x + 'px';
  indicator.style.top = y + 'px';
  indicator.classList.remove('is-active');
  void indicator.offsetWidth;
  indicator.classList.add('is-active');
}

function renderJobs() {
  const admin = isAdmin();
  return `
    <section class="table-card">
      <div class="card-header">
        <div>
          <p class="eyebrow">职位管理</p>
          <h3 class="card-title">职位列表</h3>
          <p class="card-subtitle">${admin ? '全局职位概览，按 HR 查看候选人规模与转化数据。' : '按职位查看候选人规模与关键转化数据。'}</p>
        </div>
        <div class="jobs-header-actions">
          <span class="badge">共 ${state.jobs.length} 个职位</span>
          ${admin ? '' : '<button class="button-secondary" onclick="syncJobs()">同步职位</button>'}
        </div>
      </div>
      ${state.syncStatus ? `<div class="inline-status">${state.syncStatus}</div>` : ''}
      <table>
        <thead>
          <tr>
            <th>职位</th>
            ${admin ? '<th>所属 HR</th>' : ''}
            <th>城市</th>
            <th>薪资</th>
            <th>状态</th>
            <th>候选人</th>
            <th>已打招呼</th>
            <th>已回复</th>
            <th>已下载简历</th>
            ${admin ? '' : '<th>手动触发</th>'}
          </tr>
        </thead>
        <tbody>
          ${state.jobs.map((job) => `
            <tr>
              <td>${job.job_name}<div class="muted">${job.job_key}</div></td>
              ${admin ? `<td>${job.hr_name || '<span style="color:var(--text-muted,#999)">未分配</span>'}</td>` : ''}
              <td>${job.city || '-'}</td>
              <td>${job.salary || '-'}</td>
              <td><span class="${getJobStatusBadgeClass(job.status)}">${formatJobStatus(job.status)}</span></td>
              <td>${job.candidate_count}</td>
              <td>${job.greeted_count}</td>
              <td>${job.responded_count}</td>
              <td>${job.resume_downloaded_count}</td>
              ${admin ? '' : `<td>${renderJobActions(job)}</td>`}
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

  const admin = isAdmin();
  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>候选人</th>
            ${admin ? '<th>所属 HR</th>' : ''}
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
              ${admin ? `<td>${escapeHtml(candidate.hr_name || '未分配')}</td>` : ''}
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
                ${renderCandidateFact('简历路径', item.resume_path, { href: buildResumePreviewUrl(item.resume_path) })}
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

function renderCandidateFact(label, value, options = {}) {
  const content = options.href
    ? `<a href="${escapeHtml(options.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value || '-')}</a>`
    : escapeHtml(value || '-');

  return `
    <div class="job-meta-item">
      <span class="muted">${escapeHtml(label)}</span>
      <strong>${content}</strong>
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
            <p class="list-desc">
              ${renderResumePreviewLink(attachment.stored_path)}
              ${attachment.stored_path ? ' · ' : ''}
              ${escapeHtml(formatResumeState(attachment.status === 'downloaded' ? 'downloaded' : 'received'))}
            </p>
          </div>
          <span class="badge ${attachment.status === 'downloaded' ? 'badge-success' : 'badge-warning'}">
            ${escapeHtml(attachment.status || '-')}
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderResumePreviewLink(value) {
  const href = buildResumePreviewUrl(value);

  if (!href) {
    return escapeHtml(value || '尚未落盘');
  }

  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`;
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
          <p class="card-subtitle">为招聘中的岗位配置定时执行规则，系统将按设定节奏自动触发任务。</p>
        </div>
        <div class="jobs-header-actions">
          <span class="badge">${state.schedules.length} 个调度任务</span>
          <button class="button-secondary" onclick="openScheduleModal('create')">添加定时任务</button>
        </div>
      </div>
      ${state.schedules.length ? `
        <table>
          <thead>
            <tr>
              <th>职位</th>
              <th>任务类型</th>
              <th>开始时间</th>
              <th>执行间隔</th>
              <th>寻源人数</th>
              <th>回复线程数</th>
              <th>状态</th>
              <th>最近执行</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${state.schedules.map((schedule) => {
              const payload = schedule.payload || {};
              const startTime = formatScheduleTime(payload.startHour, payload.startMinute);
              const interval = payload.intervalMinutes ? `每 ${payload.intervalMinutes} 分钟` : '-';
              const jobName = getJobNameByKey(schedule.job_key);
              return `
                <tr>
                  <td>${escapeHtml(jobName)}<div class="muted">${escapeHtml(schedule.job_key)}</div></td>
                  <td>${escapeHtml(formatTaskType(schedule.task_type))}</td>
                  <td>${escapeHtml(startTime)}</td>
                  <td>${escapeHtml(interval)}</td>
                  <td>${payload.targetCount || '-'}</td>
                  <td>${payload.maxThreads || '-'}</td>
                  <td>
                    <button
                      class="badge ${schedule.enabled ? 'badge-success' : 'badge-warning'}"
                      style="cursor:pointer;border:none;"
                      onclick='toggleScheduleEnabled(${schedule.id}, ${!schedule.enabled})'
                      title="点击${schedule.enabled ? '禁用' : '启用'}"
                    >
                      ${schedule.enabled ? '已启用' : '已禁用'}
                    </button>
                  </td>
                  <td>${formatDateTime(schedule.last_run_at)}</td>
                  <td>
                    <div class="table-actions">
                      <button
                        class="button-secondary button-compact"
                        onclick='openScheduleModal("view", ${schedule.id})'
                        title="查看详情"
                      >
                        查看
                      </button>
                      <button
                        class="button-secondary button-compact"
                        onclick='openScheduleModal("edit", ${schedule.id})'
                        title="编辑任务"
                      >
                        编辑
                      </button>
                      <button
                        class="button-secondary button-compact button-danger"
                        onclick='deleteSchedule(${schedule.id})'
                        title="删除该定时任务"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      ` : '<div class="empty-state">当前暂无调度任务，点击「添加定时任务」创建。</div>'}
    </section>
    ${renderScheduleModal()}
    ${renderSyncModal()}
  `;
}

function renderScheduleModal() {
  if (!state.scheduleModal.open) return '';

  const { mode, form, saving, error } = state.scheduleModal;
  const isView = mode === 'view';
  const isCreate = mode === 'create';
  const openJobs = state.jobs.filter((job) => job.status === 'open');

  const titleMap = {
    create: '添加定时任务',
    edit: '编辑定时任务',
    view: '查看定时任务'
  };

  const eyebrowMap = {
    create: '新建调度',
    edit: '编辑调度',
    view: '调度详情'
  };

  return `
    <div class="modal-backdrop" onclick="closeScheduleModal()">
      <section class="sync-modal schedule-modal" onclick="event.stopPropagation()">
        <div class="card-header">
          <div>
            <p class="eyebrow">${eyebrowMap[mode]}</p>
            <h3 class="card-title">${titleMap[mode]}</h3>
            <p class="card-subtitle">${isView ? '当前定时任务的配置详情。' : '配置岗位、执行时间与执行参数。'}</p>
          </div>
          <div class="schedule-modal-header-actions">
            ${isView ? `
              <button class="button-secondary" onclick="switchScheduleModalToEdit()">编辑</button>
            ` : ''}
            <button class="button-secondary button-muted" onclick="closeScheduleModal()">关闭</button>
          </div>
        </div>
        ${error ? `<div class="inline-status inline-status-error">${escapeHtml(error)}</div>` : ''}
        <div class="schedule-form-grid">
          <label class="form-field">
            <span class="form-label">选择岗位</span>
            ${isCreate ? `
              <select onchange="updateScheduleModalForm('jobKey', this.value)">
                <option value="">请选择岗位</option>
                ${openJobs.map((job) => `
                  <option value="${escapeHtml(job.job_key)}" ${form.jobKey === job.job_key ? 'selected' : ''}>
                    ${escapeHtml(job.job_name)} (${escapeHtml(job.city || '-')})
                  </option>
                `).join('')}
              </select>
            ` : `
              <div class="schedule-view-value">${escapeHtml(getJobNameByKey(form.jobKey) || form.jobKey || '-')}</div>
            `}
          </label>
          <label class="form-field">
            <span class="form-label">任务类型</span>
            ${isCreate ? `
              <select onchange="updateScheduleModalForm('taskType', this.value)">
                <option value="source" ${form.taskType === 'source' ? 'selected' : ''}>寻源打招呼</option>
                <option value="followup" ${form.taskType === 'followup' ? 'selected' : ''}>主动沟通拉简历</option>
              </select>
            ` : `
              <div class="schedule-view-value">${escapeHtml(formatTaskType(form.taskType))}</div>
            `}
          </label>
          <label class="form-field">
            <span class="form-label">开始执行时间</span>
            ${isView ? `
              <div class="schedule-view-value">${escapeHtml(formatScheduleTime(form.startHour, form.startMinute))}</div>
            ` : `
              <input
                type="time"
                value="${padTime(form.startHour)}:${padTime(form.startMinute)}"
                onchange="handleScheduleModalTimeChange(this.value)"
              />
            `}
          </label>
          <label class="form-field">
            <span class="form-label">执行间隔（分钟）</span>
            ${isView ? `
              <div class="schedule-view-value">${form.intervalMinutes || '-'}</div>
            ` : `
              <input
                type="number"
                min="10"
                max="1440"
                value="${form.intervalMinutes}"
                onchange="updateScheduleModalForm('intervalMinutes', Number(this.value))"
              />
            `}
          </label>
          <label class="form-field">
            <span class="form-label">单次寻源人数</span>
            ${isView ? `
              <div class="schedule-view-value">${form.targetCount || '-'}</div>
            ` : `
              <input
                type="number"
                min="1"
                max="50"
                value="${form.targetCount}"
                onchange="updateScheduleModalForm('targetCount', Number(this.value))"
              />
            `}
          </label>
          <label class="form-field">
            <span class="form-label">单次回复线程数</span>
            ${isView ? `
              <div class="schedule-view-value">${form.maxThreads || '-'}</div>
            ` : `
              <input
                type="number"
                min="1"
                max="100"
                value="${form.maxThreads}"
                onchange="updateScheduleModalForm('maxThreads', Number(this.value))"
              />
            `}
          </label>
        </div>
        ${!isView ? `
          <div class="schedule-form-actions">
            <button class="button-secondary" onclick="submitScheduleModal()" ${saving ? 'disabled' : ''}>
              ${saving ? '保存中...' : '保存'}
            </button>
            <button class="button-secondary button-muted" onclick="closeScheduleModal()">取消</button>
          </div>
        ` : ''}
      </section>
    </div>
  `;
}

function formatScheduleTime(hour, minute) {
  if (hour === undefined || hour === null) return '-';
  return `${padTime(hour)}:${padTime(minute || 0)}`;
}

function padTime(value) {
  return String(value ?? 0).padStart(2, '0');
}

function formatTaskType(taskType) {
  const map = {
    source: '寻源打招呼',
    followup: '主动沟通拉简历',
    chat: '主动沟通',
    download: '简历下载',
    sync_jobs: '职位同步'
  };
  return map[taskType] || taskType;
}

function getJobNameByKey(jobKey) {
  const job = state.jobs.find((j) => j.job_key === jobKey);
  return job?.job_name || jobKey;
}

function openScheduleModal(mode, scheduleId) {
  if (mode === 'create') {
    state.scheduleModal = {
      open: true,
      mode: 'create',
      scheduleId: null,
      saving: false,
      error: '',
      form: {
        jobKey: '',
        taskType: 'source',
        startHour: 9,
        startMinute: 0,
        intervalMinutes: 60,
        targetCount: 5,
        maxThreads: 20
      }
    };
  } else {
    const schedule = state.schedules.find((s) => String(s.id) === String(scheduleId));
    if (!schedule) return;
    const payload = schedule.payload || {};
    state.scheduleModal = {
      open: true,
      mode,
      scheduleId,
      saving: false,
      error: '',
      form: {
        jobKey: schedule.job_key,
        taskType: schedule.task_type,
        startHour: payload.startHour ?? 0,
        startMinute: payload.startMinute ?? 0,
        intervalMinutes: payload.intervalMinutes ?? 60,
        targetCount: payload.targetCount ?? 5,
        maxThreads: payload.maxThreads ?? 20
      }
    };
  }
  render();
}

function closeScheduleModal() {
  state.scheduleModal = {
    open: false,
    mode: 'create',
    scheduleId: null,
    saving: false,
    error: '',
    form: {
      jobKey: '',
      taskType: 'source',
      startHour: 9,
      startMinute: 0,
      intervalMinutes: 60,
      targetCount: 5,
      maxThreads: 20
    }
  };
  render();
}

function switchScheduleModalToEdit() {
  state.scheduleModal.mode = 'edit';
  render();
}

function updateScheduleModalForm(field, value) {
  state.scheduleModal.form[field] = value;
}

function handleScheduleModalTimeChange(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  state.scheduleModal.form.startHour = hours || 0;
  state.scheduleModal.form.startMinute = minutes || 0;
}

async function submitScheduleModal() {
  const { mode, form, scheduleId } = state.scheduleModal;

  if (!form.jobKey) {
    state.scheduleModal.error = '请选择一个岗位。';
    render();
    return;
  }

  if (!form.intervalMinutes || form.intervalMinutes < 10) {
    state.scheduleModal.error = '执行间隔不能小于 10 分钟。';
    render();
    return;
  }

  state.scheduleModal.saving = true;
  state.scheduleModal.error = '';
  render();

  try {
    const cronDesc = `每天 ${padTime(form.startHour)}:${padTime(form.startMinute)} 起，每 ${form.intervalMinutes} 分钟`;
    await fetchJson('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobKey: form.jobKey,
        taskType: form.taskType,
        cronExpression: cronDesc,
        enabled: true,
        payload: {
          startHour: form.startHour,
          startMinute: form.startMinute,
          intervalMinutes: form.intervalMinutes,
          targetCount: form.targetCount,
          maxThreads: form.maxThreads
        }
      })
    });

    closeScheduleModal();
    await loadData();
  } catch (error) {
    state.scheduleModal.error = `保存失败：${error.message}`;
  } finally {
    state.scheduleModal.saving = false;
    render();
  }
}

async function toggleScheduleEnabled(id, enabled) {
  try {
    await fetchJson(`/api/schedules/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    await loadData();
  } catch (error) {
    alert(`切换失败：${error.message}`);
  }
}

async function deleteSchedule(id) {
  if (!confirm('确认删除该定时任务？')) return;

  try {
    await fetchJson(`/api/schedules/${id}`, { method: 'DELETE' });
    await loadData();
  } catch (error) {
    alert(`删除失败：${error.message}`);
  }
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
