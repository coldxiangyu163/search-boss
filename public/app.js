function createDeptAdminModalForm() {
  return {
    editId: '',
    title: '新增部门',
    name: '',
    status: 'active',
    showStatus: false
  };
}

function createUserAdminModalForm() {
  return {
    editId: '',
    title: '新增用户',
    name: '',
    email: '',
    phone: '',
    role: 'hr',
    departmentId: '',
    password: '',
    status: 'active',
    showPassword: true,
    showStatus: false
  };
}

function createHrAdminModalForm() {
  return {
    editId: '',
    title: '新增HR账号',
    name: '',
    userId: '',
    departmentId: '',
    notes: '',
    status: 'active',
    showStatus: false
  };
}

function createLimitsAdminModalForm() {
  return {
    userId: '',
    title: '配额设置',
    expiresAt: '',
    maxHrAccounts: 0
  };
}

function createBossAccountAdminModalForm() {
  return {
    editId: '',
    title: '新增BOSS账号',
    hrAccountId: '',
    bossLoginName: '',
    displayName: '',
    status: 'active',
    hrDisabled: false,
    showStatus: false
  };
}

function createBrowserInstanceAdminModalForm(nextPort = 9223) {
  return {
    editId: '',
    title: '新增浏览器实例',
    bossAccountId: '',
    instanceName: '',
    cdpEndpoint: 'http://127.0.0.1:' + nextPort,
    userDataDir: '~/.chrome-boss-profiles/<账号>',
    downloadDir: '~/.chrome-boss-downloads/<账号>',
    debugPort: String(nextPort),
    host: 'localhost',
    status: 'idle',
    bossDisabled: false,
    showStatus: false
  };
}

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
  candidateSelectionMode: 'none',
  candidateSelectionSnapshot: null,
  selectedCandidateIds: [],
  candidateBulkDownload: {
    loading: false,
    error: '',
    success: ''
  },
  candidateListLoading: false,
  candidateListError: '',
  schedules: [],
  workConfig: null,
  workConfigSaving: false,
  workConfigError: '',
  workConfigSaved: false,
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
      pace: 'standard',
      targetCount: 5,
      maxThreads: 20,
      recommendTab: 'default',
      interactionTypes: ['request_resume'],
      priority: 5,
      cooldownMinutes: 60,
      dailyMaxRuns: 0,
      enabled: true,
      showAdvanced: false,
      advancedTouched: false,
      originalRaw: null,
      originalSimpleSnapshot: ''
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
    taskType: 'sync_jobs',
    showLiveView: false,
    browserFocus: false,
    consoleTitle: '',
    standbyMessage: ''
  },
  adminModalOpenId: '',
  adminModalForms: {
    dept: createDeptAdminModalForm(),
    user: createUserAdminModalForm(),
    hr: createHrAdminModalForm(),
    limits: createLimitsAdminModalForm(),
    ba: createBossAccountAdminModalForm(),
    bi: createBrowserInstanceAdminModalForm()
  },
  jobDetailModal: {
    open: false,
    jobKey: '',
    loading: false,
    error: '',
    item: null,
    saving: false,
    savingError: '',
    savingSuccess: '',
    savingKnowledge: false,
    savingKnowledgeError: '',
    savingKnowledgeSuccess: '',
    savingFilters: false,
    savingFiltersError: '',
    savingFiltersSuccess: '',
    filtersExpanded: false,
    pendingFilters: null
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
  adminBrowserInstances: [],
  taskRuns: [],
  taskRunsPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  taskRunsFilter: { status: '', mode: '' },
  taskRunsLoading: false,
  taskRunsLoaded: false,
  taskRunDetail: { open: false, runId: null, loading: false, error: '', events: [], run: null },
  overviewPollTimer: null
};

const OVERVIEW_POLL_INTERVAL_MS = 5000;

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
  buildCandidateEvaluation,
  buildResumePreviewUrl,
  isResumeDownloadable,
  buildCandidateDownloadQuery
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

const automationScheduleUx = window.AutomationScheduleUx || {
  PACE_OPTIONS: [
    { value: 'conservative', label: '保守' },
    { value: 'standard', label: '标准' },
    { value: 'aggressive', label: '激进' },
    { value: 'custom', label: '已自定义' }
  ],
  presetToRaw({ taskType }) {
    if (taskType === 'followup') {
      return {
        priority: 5,
        cooldownMinutes: 60,
        dailyMaxRuns: 0,
        payload: {
          maxThreads: 20,
          interactionTypes: ['request_resume']
        }
      };
    }

    return {
      priority: 5,
      cooldownMinutes: 60,
      dailyMaxRuns: 0,
      payload: {
        targetCount: 5,
        recommendTab: 'default'
      }
    };
  },
  rawToPace() {
    return 'standard';
  },
  formatPaceLabel(value) {
    return { conservative: '保守', standard: '标准', aggressive: '激进', custom: '已自定义' }[value] || '标准';
  },
  sanitizePayloadByTaskType(taskType, payload = {}) {
    if (taskType === 'followup') {
      return {
        ...payload,
        maxThreads: payload.maxThreads ?? 20,
        interactionTypes: Array.isArray(payload.interactionTypes) && payload.interactionTypes.length ? payload.interactionTypes : ['request_resume']
      };
    }

    return {
      ...payload,
      targetCount: payload.targetCount ?? 5,
      recommendTab: payload.recommendTab || 'default'
    };
  },
  buildSummaryLabel({ taskType, pace, payload = {} }) {
    const paceLabel = { conservative: '保守', standard: '标准', aggressive: '激进', custom: '已自定义' }[pace] || '标准';
    if (taskType === 'followup') {
      return `${paceLabel} · 处理 ${payload.maxThreads || 20} 人`;
    }
    return `${paceLabel} · 打招呼 ${payload.targetCount || 5} 人`;
  },
  formatInteractionTypes(types) {
    const labelMap = { request_resume: '求简历', exchange_phone: '换电话', exchange_wechat: '换微信' };
    const list = Array.isArray(types) && types.length ? types : ['request_resume'];
    return list.map((item) => labelMap[item] || item).join('、');
  },
  pickNonTaskPayload(payload = {}) {
    const nextPayload = { ...payload };
    delete nextPayload.targetCount;
    delete nextPayload.recommendTab;
    delete nextPayload.maxThreads;
    delete nextPayload.interactionTypes;
    return nextPayload;
  }
};

const {
  PACE_OPTIONS,
  presetToRaw,
  rawToPace,
  formatPaceLabel,
  sanitizePayloadByTaskType,
  buildSummaryLabel,
  formatInteractionTypes: formatAutomationInteractionTypes,
  pickNonTaskPayload
} = automationScheduleUx;

const liveViewCoordinatesApi = window.LiveViewCoordinates || {
  resolveContainedImageClick({
    clientX,
    clientY,
    rectLeft,
    rectTop,
    rectWidth,
    rectHeight,
    sourceWidth,
    sourceHeight
  }) {
    const safeRectWidth = Math.max(1, Number(rectWidth) || 0);
    const safeRectHeight = Math.max(1, Number(rectHeight) || 0);
    const safeSourceWidth = Math.max(1, Number(sourceWidth) || safeRectWidth);
    const safeSourceHeight = Math.max(1, Number(sourceHeight) || safeRectHeight);

    return {
      offsetX: 0,
      offsetY: 0,
      renderedWidth: safeRectWidth,
      renderedHeight: safeRectHeight,
      pageX: ((Number(clientX) || 0) - (Number(rectLeft) || 0)) / safeRectWidth * safeSourceWidth,
      pageY: ((Number(clientY) || 0) - (Number(rectTop) || 0)) / safeRectHeight * safeSourceHeight
    };
  }
};

const {
  resolveContainedImageClick
} = liveViewCoordinatesApi;

const runtimeLogFeedApi = window.RuntimeLogFeed || {
  classifyRuntimeLogEvent(event = {}) {
    return {
      ...event,
      severity: 'info',
      label: event.eventType || '运行事件',
      stageLabel: event.stage || '运行过程',
      isHighlight: true
    };
  },
  summarizeRuntimeLogs(events = []) {
    return {
      totalCount: events.length,
      warningCount: 0,
      errorCount: 0,
      highlightCount: events.length,
      lastSignal: events[events.length - 1] || null
    };
  },
  splitRuntimeLogFeed(events = []) {
    return {
      highlights: events,
      stream: [...events].reverse()
    };
  }
};

const {
  classifyRuntimeLogEvent,
  summarizeRuntimeLogs,
  splitRuntimeLogFeed
} = runtimeLogFeedApi;

const titles = {
  command: ['运营总览', '今日招聘运营看板', '聚焦核心招聘指标、待办事项与系统运行情况。'],
  'admin-overview': ['HR 概览', '全员招聘运营看板', '查看所有 HR 的业务数据与执行状态。'],
  'admin-org': ['组织管理', '组织与权限管理', '管理部门、用户与 HR 账号。'],
  'admin-resources': ['资源管理', 'BOSS 账号与浏览器', '管理 BOSS 直聘账号绑定与 Chrome 浏览器实例配置。'],
  jobs: ['职位管理', '职位招聘执行情况', '统一查看职位需求、城市分布与当前转化效率。'],
  candidates: ['候选人管理', '候选人全流程跟进', '围绕人才状态、简历获取与入站行为进行管理。'],
  automation: ['自动化调度', '任务调度与执行监控', '关注自动化任务编排、执行节奏与系统承接能力。'],
  'task-runs': ['任务列表', '任务执行记录', '查看所有定时任务与手动任务的执行详情与状态。'],
  health: ['系统状态', '系统运行健康中心', '查看平台服务、数据库连接与自动化能力现状。']
};

function isAdmin() {
  return state.currentUser && ['system_admin', 'dept_admin'].includes(state.currentUser.role);
}

function isDeptAdmin() {
  return state.currentUser && state.currentUser.role === 'dept_admin';
}

function isSysAdmin() {
  return state.currentUser && state.currentUser.role === 'system_admin';
}

function getViewTitleEntry(view) {
  if (!isDeptAdmin()) {
    return titles[view] || titles.command;
  }
  const deptTitles = {
    'admin-overview': ['HR 概览', '部门招聘运营看板', '查看本部门 HR 的业务数据与执行状态。'],
    jobs: ['职位管理', '部门职位招聘执行情况', '统一查看本部门职位需求、城市分布与当前转化效率。'],
    candidates: ['候选人管理', '部门候选人全流程跟进', '围绕本部门人才状态、简历获取与入站行为进行管理。'],
    'task-runs': ['任务列表', '部门任务执行记录', '查看本部门定时任务与手动任务的执行详情与状态。']
  };
  return deptTitles[view] || titles[view] || titles.command;
}

function getNavItems() {
  if (isSysAdmin()) {
    return [
      { view: 'admin-org', title: '组织管理', desc: '部门、用户与 HR 账号' },
      { view: 'admin-resources', title: '资源管理', desc: 'BOSS 账号与浏览器实例' },
      { view: 'health', title: '系统状态', desc: '监控服务与运行健康度' }
    ];
  }
  if (isAdmin()) {
    return [
      { view: 'admin-overview', title: 'HR 概览', desc: '查看本部门 HR 业务数据' },
      { view: 'jobs', title: '职位管理', desc: '部门职位与转化情况' },
      { view: 'candidates', title: '候选人管理', desc: '部门候选人跟踪' },
      { view: 'task-runs', title: '任务列表', desc: '查看任务执行记录与详情' },
      { view: 'admin-org', title: 'HR 管理', desc: '管理本部门 HR 账号' },
      { view: 'health', title: '系统状态', desc: '监控服务与运行健康度' }
    ];
  }
  return [
    { view: 'command', title: '运营总览', desc: '查看核心指标与处理进度' },
    { view: 'jobs', title: '职位管理', desc: '统一管理职位与转化情况' },
    { view: 'candidates', title: '候选人管理', desc: '跟踪候选人阶段与简历状态' },
    { view: 'automation', title: '自动化调度', desc: '查看任务编排与执行情况' },
    { view: 'task-runs', title: '任务列表', desc: '查看任务执行记录与详情' },
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
      if (shouldPollOverviewView(state.view)) {
        loadData().catch(() => {});
      }
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
    } else {
      window.location.href = '/login.html';
      return;
    }
  } catch (_) {
    window.location.href = '/login.html';
    return;
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

function shouldPollOverviewView(view) {
  if (state.syncModal.open && state.syncModal.showLiveView) {
    return false;
  }
  return view === 'command' || view === 'admin-overview';
}

function manageOverviewPolling() {
  if (shouldPollOverviewView(state.view)) {
    if (!state.overviewPollTimer) {
      state.overviewPollTimer = window.setInterval(() => {
        loadData().catch(() => {});
      }, OVERVIEW_POLL_INTERVAL_MS);
    }
    return;
  }

  if (state.overviewPollTimer) {
    window.clearInterval(state.overviewPollTimer);
    state.overviewPollTimer = null;
  }
}

function getSummaryActiveRun() {
  return state.summary?.activeRun || null;
}

function normalizeRunForConsole(run) {
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    mode: run.mode,
    status: run.status,
    jobKey: run.jobKey || run.job_key || null,
    jobName: run.jobName || run.job_name || null,
    startedAt: run.startedAt || run.started_at || null,
    createdAt: run.createdAt || run.created_at || null
  };
}

async function fetchLatestActiveRunForConsole() {
  const summary = await fetchJson('/api/dashboard/summary');
  return normalizeRunForConsole(summary?.activeRun || null);
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
    },
    browser_live: {
      eyebrow: '运行控制台',
      buttonLabel: '浏览器待机',
      inlineSuccess: '已打开运行控制台',
      emptyLogMessage: '当前暂无执行日志'
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

  try {
    const [schedules, summary, jobs, candidates, workConfigResult] = await Promise.all([
      fetchJson('/api/schedules'),
      fetchJson('/api/dashboard/summary'),
      fetchJson('/api/jobs'),
      fetchCandidates(),
      fetchJson('/api/work-config').catch(() => ({ item: null }))
    ]);

    state.schedules = schedules.items;
    state.workConfig = workConfigResult.item;
    state.summary = summary;
    state.jobs = jobs.items;
    state.candidates = candidates.items;
    state.candidatePagination = candidates.pagination || {
      page: state.candidateQuery.page,
      pageSize: state.candidateQuery.pageSize,
      total: candidates.items.length,
      totalPages: candidates.items.length ? 1 : 0
    };
    resetCandidateBulkDownloadState();

    if (isAdmin()) {
      const [hrOverview, departments, users, hrAccounts, bossAccounts, browserInstances] = await Promise.all([
        fetchJson('/api/admin/dashboard/hr-overview'),
        fetchJson('/api/admin/departments').catch(() => ({ items: [] })),
        fetchJson('/api/admin/users').catch(() => ({ items: [] })),
        fetchJson('/api/admin/hr-accounts').catch(() => ({ items: [] })),
        fetchJson('/api/admin/boss-accounts').catch(() => ({ items: [] })),
        fetchJson('/api/admin/browser-instances').catch(() => ({ items: [] }))
      ]);
      state.hrOverview = hrOverview?.items || [];
      state.adminDepartments = departments?.items || [];
      state.adminUsers = users?.items || [];
      state.adminHrAccounts = hrAccounts?.items || [];
      state.adminBossAccounts = bossAccounts?.items || [];
      state.adminBrowserInstances = browserInstances?.items || [];
    }
  } catch (err) {
    console.error('[loadData] 数据加载失败:', err);
  } finally {
    state.candidateListLoading = false;
    render();
  }
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
    resetCandidateBulkDownloadState();
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
    savingError: '',
    savingSuccess: '',
    savingKnowledge: false,
    savingKnowledgeError: '',
    savingKnowledgeSuccess: '',
    savingFilters: false,
    savingFiltersError: '',
    savingFiltersSuccess: '',
    filtersExpanded: false,
    pendingFilters: null
  };
  render();

  try {
    const result = await fetchJson(`/api/jobs/${encodeURIComponent(jobKey)}`);
    if (state.jobDetailModal.jobKey !== jobKey) {
      return;
    }

    state.jobDetailModal.loading = false;
    state.jobDetailModal.item = result.item;
    state.jobDetailModal.pendingFilters = normalizeFiltersForUI(result.item.recommend_filters || {});
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
    savingError: '',
    savingSuccess: '',
    savingKnowledge: false,
    savingKnowledgeError: '',
    savingKnowledgeSuccess: '',
    savingFilters: false,
    savingFiltersError: '',
    savingFiltersSuccess: '',
    filtersExpanded: false,
    pendingFilters: null
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
  state.jobDetailModal.savingSuccess = '';
  renderPreservingModalScroll();

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
    state.jobDetailModal.savingSuccess = '保存成功';
    setTimeout(() => { state.jobDetailModal.savingSuccess = ''; renderPreservingModalScroll(); }, 2000);
  } catch (error) {
    state.jobDetailModal.savingError = error.message;
  } finally {
    state.jobDetailModal.saving = false;
    renderPreservingModalScroll();
  }
}

async function saveJobEnterpriseKnowledge() {
  if (!state.jobDetailModal.item || state.jobDetailModal.savingKnowledge) {
    return;
  }

  const textarea = document.getElementById('job-enterprise-knowledge-input');
  if (!textarea) {
    return;
  }

  state.jobDetailModal.savingKnowledge = true;
  state.jobDetailModal.savingKnowledgeError = '';
  state.jobDetailModal.savingKnowledgeSuccess = '';
  renderPreservingModalScroll();

  try {
    const result = await fetchJson(
      `/api/jobs/${encodeURIComponent(state.jobDetailModal.jobKey)}/enterprise-knowledge`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          enterpriseKnowledge: textarea.value
        })
      }
    );

    state.jobDetailModal.item = result.item;
    state.jobs = state.jobs.map((job) => (
      job.job_key === result.item.job_key
        ? { ...job, enterprise_knowledge: result.item.enterprise_knowledge }
        : job
    ));
    state.jobDetailModal.savingKnowledgeSuccess = '保存成功';
    setTimeout(() => { state.jobDetailModal.savingKnowledgeSuccess = ''; renderPreservingModalScroll(); }, 2000);
  } catch (error) {
    state.jobDetailModal.savingKnowledgeError = error.message;
  } finally {
    state.jobDetailModal.savingKnowledge = false;
    renderPreservingModalScroll();
  }
}

function toggleRecommendFilters() {
  state.jobDetailModal.filtersExpanded = !state.jobDetailModal.filtersExpanded;
  if (state.jobDetailModal.filtersExpanded && !state.jobDetailModal.pendingFilters) {
    const saved = state.jobDetailModal.item?.recommend_filters || {};
    state.jobDetailModal.pendingFilters = normalizeFiltersForUI(saved);
  }
  renderPreservingModalScroll();
}

function getDefaultRecommendFilters() {
  return {
    ageMin: 16,
    ageMax: 99,
    activity: '',
    gender: '',
    notViewed: '',
    notExchanged: '',
    school: '',
    jobHopFrequency: '',
    jobIntent: [],
    degree: [],
    salary: '',
    experience: []
  };
}

const MULTI_SELECT_FILTER_KEYS = ['jobIntent', 'degree', 'experience'];
const LOW_DEGREE_VALUES = ['初中及以下', '中专/中技', '高中', '大专'];

function getRecommendFilterOptions() {
  return {
    activity: [
      { value: '', label: '不限' },
      { value: '刚刚活跃', label: '刚刚活跃' },
      { value: '今日活跃', label: '今日活跃' },
      { value: '3日内活跃', label: '3日内活跃' },
      { value: '本周活跃', label: '本周活跃' },
      { value: '本月活跃', label: '本月活跃' }
    ],
    gender: [
      { value: '', label: '不限' },
      { value: '男', label: '男' },
      { value: '女', label: '女' }
    ],
    notViewed: [
      { value: '', label: '不限' },
      { value: '近14天没有', label: '近14天没有' }
    ],
    notExchanged: [
      { value: '', label: '不限' },
      { value: '近一个月没有', label: '近一个月没有' }
    ],
    school: [
      { value: '', label: '不限' },
      { value: '985', label: '985' },
      { value: '211', label: '211' },
      { value: '双一流院校', label: '双一流院校' },
      { value: '留学', label: '留学' },
      { value: '国内外名校', label: '国内外名校' },
      { value: '公办本科', label: '公办本科' }
    ],
    jobHopFrequency: [
      { value: '', label: '不限' },
      { value: '5年少于3份', label: '5年少于3份' },
      { value: '平均每份工作大于1年', label: '平均每份工作大于1年' }
    ],
    jobIntent: [
      { value: '', label: '不限' },
      { value: '离职-随时到岗', label: '离职-随时到岗' },
      { value: '在职-暂不考虑', label: '在职-暂不考虑' },
      { value: '在职-考虑机会', label: '在职-考虑机会' },
      { value: '在职-月内到岗', label: '在职-月内到岗' }
    ],
    degree: [
      { value: '', label: '不限' },
      { value: '初中及以下', label: '初中及以下' },
      { value: '中专/中技', label: '中专/中技' },
      { value: '高中', label: '高中' },
      { value: '大专', label: '大专' },
      { value: '本科', label: '本科' },
      { value: '硕士', label: '硕士' },
      { value: '博士', label: '博士' }
    ],
    salary: [
      { value: '', label: '不限' },
      { value: '3K以下', label: '3K以下' },
      { value: '3-5K', label: '3-5K' },
      { value: '5-10K', label: '5-10K' },
      { value: '10-20K', label: '10-20K' },
      { value: '20-50K', label: '20-50K' },
      { value: '50K以上', label: '50K以上' }
    ],
    experience: [
      { value: '', label: '不限' },
      { value: '在校/应届', label: '在校/应届' },
      { value: '1年以内', label: '1年以内' },
      { value: '1-3年', label: '1-3年' },
      { value: '3-5年', label: '3-5年' },
      { value: '5-10年', label: '5-10年' },
      { value: '10年以上', label: '10年以上' }
    ]
  };
}

function isSchoolDisabled(filters) {
  const degrees = Array.isArray(filters.degree) ? filters.degree : (filters.degree ? [filters.degree] : []);
  return degrees.some((d) => LOW_DEGREE_VALUES.includes(d));
}

function renderRecommendFiltersPanel(item) {
  const filters = normalizeFiltersForUI(state.jobDetailModal.pendingFilters || item?.recommend_filters || getDefaultRecommendFilters());
  const opts = getRecommendFilterOptions();
  const schoolDisabled = isSchoolDisabled(filters);

  function renderSingleSelectRow(label, fieldName, options, disabled) {
    const currentValue = filters[fieldName] || '';
    return `
      <div class="recommend-filter-row${disabled ? ' is-disabled' : ''}">
        <span class="recommend-filter-label">${label}</span>
        <div class="recommend-filter-options">
          ${options.map((opt) => `
            <button
              class="recommend-filter-chip ${currentValue === opt.value ? 'is-active' : ''}"
              onclick="updateRecommendFilter('${fieldName}', '${opt.value}')"
              ${disabled ? 'disabled' : ''}
            >${opt.label}</button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderMultiSelectRow(label, fieldName, options) {
    const currentValues = Array.isArray(filters[fieldName]) ? filters[fieldName] : [];
    return `
      <div class="recommend-filter-row">
        <span class="recommend-filter-label">${label}<span class="recommend-filter-multi-tag">多选</span></span>
        <div class="recommend-filter-options">
          ${options.filter((opt) => opt.value !== '').map((opt) => `
            <button
              class="recommend-filter-chip ${currentValues.includes(opt.value) ? 'is-active' : ''}"
              onclick="updateRecommendFilter('${fieldName}', '${opt.value}')"
            >${opt.label}</button>
          `).join('')}
        </div>
      </div>
    `;
  }

  const ageMin = filters.ageMin ?? 16;
  const ageMax = filters.ageMax ?? 99;
  const ageLabel = ageMax >= 99 ? `${ageMin} ~ 不限` : `${ageMin} ~ ${ageMax}`;

  return `
    <div class="recommend-filters-panel">
      <div class="recommend-filter-row">
        <span class="recommend-filter-label">年龄</span>
        <div class="recommend-filter-options" style="flex-direction:column;gap:6px">
          <div style="display:flex;align-items:center;gap:8px">
            <input type="number" min="16" max="99" value="${ageMin}" style="width:60px;padding:4px 6px;font-size:13px;border:1px solid var(--border,#e0e0e0);border-radius:4px" onchange="updateRecommendFilter('ageMin', this.value)" />
            <span>~</span>
            <input type="number" min="16" max="99" value="${ageMax}" style="width:60px;padding:4px 6px;font-size:13px;border:1px solid var(--border,#e0e0e0);border-radius:4px" onchange="updateRecommendFilter('ageMax', this.value)" />
            <span class="muted" style="font-size:12px">(${ageLabel})</span>
          </div>
        </div>
      </div>
      ${renderSingleSelectRow('活跃度', 'activity', opts.activity)}
      ${renderSingleSelectRow('性别', 'gender', opts.gender)}
      ${renderSingleSelectRow('近期没有看过', 'notViewed', opts.notViewed)}
      ${renderSingleSelectRow('是否与同事交换简历', 'notExchanged', opts.notExchanged)}
      ${renderSingleSelectRow('院校', 'school', opts.school, schoolDisabled)}
      ${renderSingleSelectRow('跳槽频率', 'jobHopFrequency', opts.jobHopFrequency)}
      ${renderMultiSelectRow('求职意向', 'jobIntent', opts.jobIntent)}
      ${renderMultiSelectRow('学历要求', 'degree', opts.degree)}
      ${renderSingleSelectRow('薪资待遇', 'salary', opts.salary)}
      ${renderMultiSelectRow('经验要求', 'experience', opts.experience)}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border,#e0e0e0)">
        <button class="button-secondary button-muted" onclick="resetRecommendFilters()">清除筛选</button>
        <button class="button-secondary" onclick="saveJobRecommendFilters()" ${state.jobDetailModal.savingFilters ? 'disabled' : ''}>${state.jobDetailModal.savingFilters ? '保存中...' : '保存筛选'}</button>
      </div>
    </div>
  `;
}

function getJobDetailModalScrollTop() {
  const modal = document.querySelector('.job-detail-modal');
  return modal ? modal.scrollTop : 0;
}

function restoreJobDetailModalScrollTop(scrollTop) {
  if (!scrollTop) return;
  const modal = document.querySelector('.job-detail-modal');
  if (modal) modal.scrollTop = scrollTop;
}

function renderPreservingModalScroll() {
  const scrollTop = getJobDetailModalScrollTop();
  render();
  restoreJobDetailModalScrollTop(scrollTop);
}

function normalizeFiltersForUI(raw) {
  const filters = { ...getDefaultRecommendFilters(), ...raw };
  for (const key of MULTI_SELECT_FILTER_KEYS) {
    if (!Array.isArray(filters[key])) {
      filters[key] = filters[key] ? [filters[key]] : [];
    }
  }
  return filters;
}

function updateRecommendFilter(field, value) {
  if (!state.jobDetailModal.pendingFilters) {
    const saved = state.jobDetailModal.item?.recommend_filters || {};
    state.jobDetailModal.pendingFilters = normalizeFiltersForUI(saved);
  }
  if (field === 'ageMin' || field === 'ageMax') {
    state.jobDetailModal.pendingFilters[field] = Math.max(16, Math.min(99, parseInt(value) || 16));
  } else if (MULTI_SELECT_FILTER_KEYS.includes(field)) {
    if (!Array.isArray(state.jobDetailModal.pendingFilters[field])) {
      state.jobDetailModal.pendingFilters[field] = state.jobDetailModal.pendingFilters[field]
        ? [state.jobDetailModal.pendingFilters[field]]
        : [];
    }
    const arr = state.jobDetailModal.pendingFilters[field];
    const idx = arr.indexOf(value);
    if (idx >= 0) {
      arr.splice(idx, 1);
    } else {
      arr.push(value);
    }
    if (field === 'degree' && isSchoolDisabled(state.jobDetailModal.pendingFilters)) {
      state.jobDetailModal.pendingFilters.school = '';
    }
  } else {
    state.jobDetailModal.pendingFilters[field] = value;
  }
  renderPreservingModalScroll();
}

function resetRecommendFilters() {
  state.jobDetailModal.pendingFilters = getDefaultRecommendFilters();
  renderPreservingModalScroll();
}

async function saveJobRecommendFilters() {
  if (!state.jobDetailModal.item || state.jobDetailModal.savingFilters) {
    return;
  }

  const filters = state.jobDetailModal.pendingFilters || getDefaultRecommendFilters();

  state.jobDetailModal.savingFilters = true;
  state.jobDetailModal.savingFiltersError = '';
  state.jobDetailModal.savingFiltersSuccess = '';
  renderPreservingModalScroll();

  try {
    const result = await fetchJson(
      `/api/jobs/${encodeURIComponent(state.jobDetailModal.jobKey)}/recommend-filters`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendFilters: filters })
      }
    );

    state.jobDetailModal.item = result.item;
    state.jobDetailModal.pendingFilters = normalizeFiltersForUI(result.item.recommend_filters || {});
    state.jobs = state.jobs.map((job) => (
      job.job_key === result.item.job_key
        ? { ...job, recommend_filters: result.item.recommend_filters }
        : job
    ));
    state.jobDetailModal.savingFiltersSuccess = '保存成功';
    setTimeout(() => { state.jobDetailModal.savingFiltersSuccess = ''; renderPreservingModalScroll(); }, 2000);
  } catch (error) {
    state.jobDetailModal.savingFiltersError = error.message;
  } finally {
    state.jobDetailModal.savingFilters = false;
    renderPreservingModalScroll();
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

async function triggerScheduleById(scheduleId, jobKey, taskType) {
  const taskMeta = getTaskMeta(taskType);
  const actionKey = `schedule:${scheduleId}`;

  state.triggeringTaskKey = actionKey;
  state.syncStatus = '';
  openSyncModal(taskType);
  render();

  try {
    const result = await fetchJson(
      `/api/schedules/${encodeURIComponent(scheduleId)}/trigger`,
      { method: 'POST' }
    );

    state.syncStatus = result.message || `${taskMeta.inlineSuccess}，职位 ${jobKey}`;
    state.syncModal.runId = result.runId;
    state.syncModal.status = result.status || 'running';
    state.syncModal.startedAt = new Date().toISOString();
    appendSyncEvent({
      eventType: 'schedule_triggered',
      stage: 'bootstrap',
      message: `${taskMeta.buttonLabel}已触发（调度 #${scheduleId}）：${jobKey}`,
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
  try {
    renderInner();
  } catch (err) {
    console.error('[render] 渲染异常:', err);
    dismissAllOverlays();
  }
}

function dismissAllOverlays() {
  if (document.fullscreenElement) return;

  const overlay = document.getElementById('sync-live-overlay');
  if (overlay) overlay.remove();

  if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll('.modal-overlay[style*="flex"], .modal-backdrop, .drawer-backdrop').forEach((el) => {
      if (el.style) {
        el.style.display = 'none';
      } else if (typeof el.remove === 'function') {
        el.remove();
      }
    });
  }

  if (state.syncModal.open) {
    closeSyncModal();
    return;
  }
  if (state.jobDetailModal.open) {
    closeJobDetailModal();
    return;
  }
  if (state.candidateDetailDrawer.open) {
    closeCandidateDetailDrawer();
    return;
  }
  if (state.scheduleModal.open) {
    closeScheduleModal();
    return;
  }
  if (state.taskRunDetail.open) {
    closeTaskRunDetail();
    return;
  }
  if (state.adminModalOpenId) {
    closeModal(state.adminModalOpenId);
    return;
  }
}

function renderInner() {
  manageOverviewPolling();
  const syncLogScrollSnapshot = getSyncLogScrollSnapshot();
  const titleEntry = getViewTitleEntry(state.view);
  const [eyebrow, title, description] = titleEntry;
  document.getElementById('page-eyebrow').textContent = eyebrow;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-description').textContent = description;

  const app = document.getElementById('app');

  if (!state.summary) {
    mountAppContent(app, '<div class="card">加载中...</div>');
    return;
  }

  if (state.view === 'admin-overview') {
    mountAppContent(app, renderAdminOverview());
    return;
  }

  if (state.view === 'admin-org') {
    mountAppContent(app, renderAdminOrg());
    return;
  }

  if (state.view === 'admin-resources') {
    mountAppContent(app, renderAdminResources());
    return;
  }

  if (state.view === 'command') {
    mountAppContent(app, renderCommandCenter());
    restoreSyncLogScroll(syncLogScrollSnapshot);
    return;
  }

  if (state.view === 'jobs') {
    mountAppContent(app, renderJobs());
    restoreSyncLogScroll(syncLogScrollSnapshot);
    return;
  }

  if (state.view === 'candidates') {
    mountAppContent(app, renderCandidates());
    restoreSyncLogScroll(syncLogScrollSnapshot);
    return;
  }

  if (state.view === 'automation') {
    mountAppContent(app, renderAutomation());
    restoreSyncLogScroll(syncLogScrollSnapshot);
    return;
  }

  if (state.view === 'task-runs') {
    if (!state.taskRunsLoaded && !state.taskRunsLoading) {
      loadTaskRuns();
    }
    mountAppContent(app, renderTaskRuns());
    return;
  }

  mountAppContent(app, renderHealth());
  restoreSyncLogScroll(syncLogScrollSnapshot);
}

function mountAppContent(app, content) {
  if (!app) {
    return;
  }

  const preserveLiveOverlay = state.syncModal.open && state.syncModal.showLiveView;
  const existingLiveOverlay = preserveLiveOverlay ? document.getElementById('sync-live-overlay') : null;

  if (existingLiveOverlay && document.fullscreenElement) {
    updateSyncLiveOverlayContent();
    return;
  }

  if (existingLiveOverlay && existingLiveOverlay.parentNode === app) {
    app.removeChild(existingLiveOverlay);
  }

  app.innerHTML = `${content}${renderNonLiveOverlays()}${preserveLiveOverlay && !existingLiveOverlay ? renderSyncLiveOverlay() : ''}`;

  if (existingLiveOverlay) {
    app.appendChild(existingLiveOverlay);
    updateSyncLiveOverlayContent();
  } else if (preserveLiveOverlay) {
    hydrateSyncLiveOverlay();
  }
}

function renderNonLiveOverlays() {
  return [
    renderSyncModal(),
    renderJobDetailModal(),
    renderCandidateDetailDrawer(),
    renderScheduleModal(),
    renderTaskRunDetailModal(),
    renderLegacyAdminModals()
  ].join('');
}

function renderLegacyAdminModals() {
  if (state.view === 'admin-org') {
    return renderAdminOrgModals();
  }

  if (state.view === 'admin-resources') {
    return renderAdminResourceModals();
  }

  return '';
}

function renderRuntimeStageStrip(stages) {
  if (!stages.length) {
    return '';
  }

  return `
    <div class="runtime-stage-strip">
      ${stages.map((item) => `
        <span class="runtime-stage-chip ${item.active ? 'is-active' : ''} ${item.done ? 'is-done' : ''}">
          ${escapeHtml(item.label)}
        </span>
      `).join('')}
    </div>
  `;
}

function openSyncModal(taskType = 'sync_jobs') {
  stopSyncPolling();
  const showLiveView = taskType === 'source' || taskType === 'followup';
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
    taskType,
    showLiveView,
    browserFocus: false,
    consoleTitle: showLiveView ? 'BOSS 直聘操作画面' : '',
    standbyMessage: ''
  };

  if (showLiveView) {
    liveView.open = true;
    liveView.instanceId = null;
    liveView.error = '';
    liveView.pageUrl = '';
    liveView.pageTitle = '';
    liveView.viewportWidth = 0;
    liveView.viewportHeight = 0;
    liveView.useHrEndpoint = true;
    startLiveViewPolling();
  }
}

function closeSyncModal() {
  stopSyncPolling();
  const hadLiveView = state.syncModal.showLiveView;
  state.syncModal.open = false;
  state.syncModal.browserFocus = false;

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }

  if (hadLiveView) {
    stopLiveViewPolling();
    if (liveView.boostTimer) {
      clearTimeout(liveView.boostTimer);
      liveView.boostTimer = null;
    }
    liveView.open = false;
    liveView.viewportWidth = 0;
    liveView.viewportHeight = 0;
    const overlay = document.getElementById('sync-live-overlay');
    if (overlay) {
      const img = overlay.querySelector('#live-view-img');
      if (img && img.src && img.src.startsWith('blob:')) {
        URL.revokeObjectURL(img.src);
      }
      overlay.remove();
    }
  }

  render();
}

function isStoppableTask() {
  const stoppable = ['source', 'followup', 'chat', 'download'];
  return stoppable.includes(state.syncModal.taskType);
}

async function stopCurrentRun() {
  if (!state.syncModal.runId) return;
  if (state.syncModal._stopping) return;
  if (!confirm('确定要停止当前任务？')) return;

  state.syncModal._stopping = true;
  document.querySelectorAll('.sync-stop-btn').forEach(btn => {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    btn.textContent = '停止中...';
  });

  try {
    const result = await fetchJson(`/api/runs/${state.syncModal.runId}/stop`, { method: 'POST' });
    if (!result.ok) {
      state.syncModal._stopping = false;
      alert(result.message || '停止失败');
      render();
      return;
    }
    appendSyncEvent({
      eventType: 'run_manually_stopped',
      stage: 'complete',
      message: '任务已手动停止',
      occurredAt: new Date().toISOString()
    });
    render();
  } catch (error) {
    state.syncModal._stopping = false;
    alert('停止失败: ' + error.message);
    render();
  }
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
  const logList = document.querySelector('#app .sync-log-list');
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
  const logList = document.querySelector('#app .sync-log-list');
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

  if (terminalStatus?.status === 'stopped') {
    state.syncModal.status = 'stopped';
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
  const activeRun = getSummaryActiveRun();
  const subtitle = activeRun
    ? `当前执行中：${formatTaskType(activeRun.mode)} · ${activeRun.jobName || activeRun.jobKey || `任务 #${activeRun.id}`} · 任务 #${activeRun.id}`
    : '进入统一运行控制台，查看浏览器画面、当前任务上下文与处理建议。';
  const statusBadge = activeRun
    ? `<span class="badge badge-warning">任务 #${activeRun.id} 执行中</span>`
    : '<span class="badge">待机中</span>';
  return `
    <section class="boss-login-card">
      <div class="card highlight-panel">
        <div class="card-header">
          <div>
            <p class="eyebrow">BOSS 账号</p>
            <h3 class="card-title">浏览器登录状态</h3>
            <p class="card-subtitle">${escapeHtml(subtitle)}</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            ${statusBadge}
            <button class="sync-inline-btn" onclick="openHrLiveView()">
              <span class="sync-inline-icon">&#128065;</span>
              <span class="sync-inline-label">${activeRun ? '查看当前任务' : '打开运行控制台'}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function openRuntimeConsole({
  instanceId = null,
  useHrEndpoint = true,
  title = '',
  standbyMessage = '',
  activeRun = null
} = {}) {
  stopSyncPolling();
  const taskType = activeRun?.mode || 'browser_live';
  const status = activeRun?.status || 'idle';
  state.syncModal = {
    open: true,
    runId: activeRun?.id || null,
    status,
    startedAt: activeRun?.startedAt || activeRun?.createdAt || null,
    error: '',
    events: [],
    progress: createSyncModalProgressState(),
    isExpanded: false,
    pollTimer: null,
    lastEventId: 0,
    taskType,
    showLiveView: true,
    browserFocus: false,
    consoleTitle: title,
    standbyMessage
  };

  liveView.open = true;
  liveView.instanceId = instanceId;
  liveView.error = '';
  liveView.pageUrl = '';
  liveView.pageTitle = '';
  liveView.viewportWidth = 0;
  liveView.viewportHeight = 0;
  liveView.useHrEndpoint = useHrEndpoint;

  render();
  startLiveViewPolling();
  if (activeRun && (status === 'running' || status === 'pending')) {
    startSyncPolling();
  }
}

async function openHrLiveView() {
  let activeRun = normalizeRunForConsole(getSummaryActiveRun());
  if (!activeRun) {
    try {
      activeRun = await fetchLatestActiveRunForConsole();
      if (activeRun && state.summary) {
        state.summary.activeRun = activeRun;
      }
    } catch (_) {}
  }

  openRuntimeConsole({
    instanceId: null,
    useHrEndpoint: true,
    title: '我的 BOSS 浏览器',
    standbyMessage: '当前暂无执行任务，可先确认页面状态；如发现异常，可直接点击画面进入人工处理。',
    activeRun
  });
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
  const deptAdmin = isDeptAdmin();
  const hrs = state.hrOverview || [];
  const { kpis, health } = state.summary;

  const totalJobs = hrs.reduce((s, h) => s + (h.job_count || 0), 0);
  const totalCandidates = hrs.reduce((s, h) => s + (h.candidate_count || 0), 0);
  const totalGreeted = hrs.reduce((s, h) => s + (h.greeted_today || 0), 0);
  const totalResumes = hrs.reduce((s, h) => s + (h.resumes_today || 0), 0);

  return `
    <section class="card-grid">
      ${metricCard('HR 人数', hrs.length, '当前活跃 HR 数')}
      ${metricCard('在招职位', totalJobs, deptAdmin ? '本部门 HR 职位合计' : '全部 HR 职位合计')}
      ${metricCard('今日打招呼', totalGreeted, deptAdmin ? '本部门 HR 合计' : '全部 HR 合计')}
      ${metricCard('今日简历', totalResumes, deptAdmin ? '本部门 HR 合计' : '全部 HR 合计')}
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
            <p class="eyebrow">${deptAdmin ? '部门数据' : '系统数据'}</p>
            <h3 class="card-title">${deptAdmin ? '部门指标' : '全局指标'}</h3>
          </div>
        </div>
        <div class="status-grid">
          <div class="status-box">
            <span class="muted">${deptAdmin ? '部门职位数' : '总职位数'}</span>
            <strong>${kpis.jobs}</strong>
          </div>
          <div class="status-box">
            <span class="muted">${deptAdmin ? '部门候选人数' : '总候选人数'}</span>
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
    stopped: ['已停止', 'badge-warning'],
    pending: ['等待中', '']
  };
  const [label, cls] = statusMap[status] || [status, ''];
  return `<span class="badge ${cls}">${modeLabel[mode] || mode || ''} ${label}</span>`;
}

function renderAdminOrg() {
  const depts = state.adminDepartments || [];
  const users = state.adminUsers || [];
  const hrAccounts = state.adminHrAccounts || [];
  const roleNames = { system_admin: '系统管理员', dept_admin: '部门管理员', hr: 'HR' };
  const deptOptions = depts.filter((d) => d.status === 'active').map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
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
              <td>${d.id}</td><td>${d.name || ''}</td>
              <td><span class="badge ${d.status === 'active' ? 'badge-success' : 'badge-danger'}">${d.status === 'active' ? '启用' : '停用'}</span></td>
              <td>
                <button class="btn-sm" onclick="editDept(${d.id}, '${(d.name || '').replace(/'/g, "\\'")}', '${d.status || 'active'}')">编辑</button>
                <button class="btn-sm btn-danger" onclick="deleteDept(${d.id}, '${(d.name || '').replace(/'/g, "\\'")}')">删除</button>
              </td>
            </tr>`).join('')}
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
            ${sys ? '<p class="card-subtitle">部门管理员可直接在此设置配额与有效期。</p>' : ''}
          </div>
          ${sys ? '<button class="button-primary" onclick="showModal(\'user-modal\')">新增用户</button>' : ''}
        </div>
        <table class="data-table">
          <thead><tr><th>ID</th><th>姓名</th><th>邮箱</th><th>角色</th><th>部门</th><th>状态</th>${sys ? '<th>有效期</th><th>HR配额</th><th>操作</th>' : ''}</tr></thead>
          <tbody>
            ${users.length === 0 ? `<tr><td colspan="${sys ? 9 : 6}" style="text-align:center;color:var(--text-muted,#999)">暂无用户</td></tr>` : ''}
            ${users.map((u) => {
              const isDeptAdmin = u.role === 'dept_admin';
              const hrCount = isDeptAdmin ? hrAccounts.filter((h) => String(h.department_id) === String(u.department_id)).length : 0;
              const expired = isDeptAdmin && u.expires_at && new Date(u.expires_at) < new Date();
              const expiryText = isDeptAdmin ? (u.expires_at ? new Date(u.expires_at).toLocaleDateString() : '永久') : '-';
              const expiryClass = isDeptAdmin ? (expired ? 'badge-danger' : 'badge-success') : '';
              const quotaText = isDeptAdmin ? `${hrCount}/${u.max_hr_accounts || '不限'}` : '-';
              return `<tr>
              <td>${u.id}</td><td>${u.name}</td><td>${u.email || '-'}</td>
              <td>${roleNames[u.role] || u.role}</td><td>${u.department_name || '-'}</td>
              <td><span class="badge ${u.status === 'active' ? 'badge-success' : 'badge-danger'}">${u.status === 'active' ? '启用' : '停用'}</span></td>
              ${sys ? `<td>${expiryClass ? `<span class="badge ${expiryClass}">${expiryText}</span>` : expiryText}</td>
              <td>${quotaText}</td>
              <td>
                <button class="btn-sm" onclick='editUser(${JSON.stringify(u).replace(/'/g, "&#39;")})'>编辑</button>
                ${isDeptAdmin ? `<button class="btn-sm" onclick='showLimitsModal(${JSON.stringify({ id: u.id, name: u.name, expires_at: u.expires_at, max_hr_accounts: u.max_hr_accounts }).replace(/'/g, "&#39;")})'>配额</button>` : ''}
                <button class="btn-sm" onclick="resetPassword(${u.id}, '${u.name.replace(/'/g, "\\'")}')">重置密码</button>
                <button class="btn-sm btn-danger" onclick="deleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')">删除</button>
              </td>` : ''}
            </tr>`;
            }).join('')}
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

  `;

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
                  <button class="btn-sm" onclick="openLiveView(${bi.id})">运行控制台</button>
                  <button class="btn-sm btn-danger" onclick="deleteBrowserInstance(${bi.id})">删除</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>

  `;
}

function renderAdminResources() {
  const hrAccounts = state.adminHrAccounts || [];
  const bossAccounts = state.adminBossAccounts || [];
  const browserInstances = state.adminBrowserInstances || [];
  const hrOptions = hrAccounts.filter((h) => h.status === 'active').map((h) => `<option value="${h.id}">${h.name}</option>`).join('');
  const baOptions = bossAccounts.filter((b) => b.status === 'active').map((b) => `<option value="${b.id}">${b.display_name || b.boss_login_name || 'BOSS#' + b.id}</option>`).join('');

  return renderSysAdminBossAndBrowser(bossAccounts, browserInstances, hrOptions, baOptions);
}

function renderLegacyModalShell(id, content) {
  return `
    <div id="${id}" class="modal-overlay" style="display:${state.adminModalOpenId === id ? 'flex' : 'none'}" onclick="if(event.target===this)closeModal('${id}')">
      <div class="modal-content">
        ${content}
      </div>
    </div>
  `;
}

function renderAdminModalTitle(id, title) {
  return `<h3 id="${id}">${escapeHtml(title)}</h3>`;
}

function renderAdminModalActions(modalId) {
  return `
    <div class="modal-actions">
      <button type="button" class="button-secondary" onclick="closeModal('${modalId}')">取消</button>
      <button type="submit" class="button-primary">确定</button>
    </div>
  `;
}

function renderAdminTextInput({
  label,
  id,
  value = '',
  modalKey,
  field,
  type = 'text',
  placeholder = '',
  required = false,
  minlength = '',
  disabled = false
} = {}) {
  return `
    <div class="form-group">
      <label>${label}</label>
      <input
        type="${type}"
        id="${id}"
        ${required ? 'required' : ''}
        ${minlength ? `minlength="${minlength}"` : ''}
        ${disabled ? 'disabled' : ''}
        placeholder="${escapeHtml(placeholder)}"
        value="${escapeHtml(value)}"
        oninput="updateAdminModalField('${modalKey}', '${field}', this.value)"
      >
    </div>
  `;
}

function renderAdminSelect({
  label,
  id,
  value = '',
  modalKey,
  field,
  optionsHtml = '',
  required = false,
  disabled = false,
  changeHandler = '',
  extraAttrs = ''
} = {}) {
  const onchange = changeHandler || `updateAdminModalField('${modalKey}', '${field}', this.value)`;
  return `
    <div class="form-group">
      <label>${label}</label>
      <select
        id="${id}"
        ${required ? 'required' : ''}
        ${disabled ? 'disabled' : ''}
        ${extraAttrs}
        onchange="${onchange}"
      >${optionsHtml}</select>
    </div>
  `;
}

function getNextBrowserInstancePort() {
  const usedPorts = (state.adminBrowserInstances || []).map((b) => b.debug_port || 0);
  return Math.max(9222, ...usedPorts) + 1;
}

function updateAdminModalForm(modalKey, updates = {}) {
  state.adminModalForms[modalKey] = {
    ...state.adminModalForms[modalKey],
    ...updates
  };
}

function updateAdminModalField(modalKey, field, value) {
  if (!state.adminModalForms[modalKey]) {
    return;
  }
  state.adminModalForms[modalKey][field] = value;
}

function openExistingAdminModal(id) {
  state.adminModalOpenId = id;
  render();
}

function renderAdminOrgModals() {
  const depts = state.adminDepartments || [];
  const users = state.adminUsers || [];
  const deptOptions = depts.filter((d) => d.status === 'active').map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
  const sys = isSysAdmin();
  const deptForm = state.adminModalForms.dept;
  const userForm = state.adminModalForms.user;
  const hrForm = state.adminModalForms.hr;
  const limitsForm = state.adminModalForms.limits;
  const modalHtml = [];

  if (sys) {
    modalHtml.push(renderLegacyModalShell('dept-modal', `
      ${renderAdminModalTitle('dept-modal-title', deptForm.title)}
      <form onsubmit="return submitDept(event)">
        <input type="hidden" id="dept-edit-id" value="${escapeHtml(deptForm.editId)}">
        ${renderAdminTextInput({ label: '部门名称', id: 'dept-name', required: true, placeholder: '请输入部门名称', value: deptForm.name, modalKey: 'dept', field: 'name' })}
        <div class="form-group" id="dept-status-group" style="display:${deptForm.showStatus ? '' : 'none'}">
          <label>状态</label>
          <select id="dept-status" onchange="updateAdminModalField('dept', 'status', this.value)"><option value="active" ${deptForm.status === 'active' ? 'selected' : ''}>启用</option><option value="inactive" ${deptForm.status === 'inactive' ? 'selected' : ''}>停用</option></select>
        </div>
        ${renderAdminModalActions('dept-modal')}
      </form>
    `));

    modalHtml.push(renderLegacyModalShell('user-modal', `
      ${renderAdminModalTitle('user-modal-title', userForm.title)}
      <form onsubmit="return submitUser(event)">
        <input type="hidden" id="user-edit-id" value="${escapeHtml(userForm.editId)}">
        ${renderAdminTextInput({ label: '姓名', id: 'user-name', required: true, placeholder: '请输入姓名', value: userForm.name, modalKey: 'user', field: 'name' })}
        ${renderAdminTextInput({ label: '邮箱', id: 'user-email', type: 'email', required: true, placeholder: '请输入邮箱', value: userForm.email, modalKey: 'user', field: 'email' })}
        ${renderAdminTextInput({ label: '手机号', id: 'user-phone', placeholder: '选填', value: userForm.phone, modalKey: 'user', field: 'phone' })}
        ${renderAdminSelect({
          label: '角色',
          id: 'user-role',
          value: userForm.role,
          modalKey: 'user',
          field: 'role',
          optionsHtml: `<option value="hr" ${userForm.role === 'hr' ? 'selected' : ''}>HR</option><option value="dept_admin" ${userForm.role === 'dept_admin' ? 'selected' : ''}>部门管理员</option>`
        })}
        ${renderAdminSelect({
          label: '所属部门',
          id: 'user-dept',
          value: userForm.departmentId,
          modalKey: 'user',
          field: 'departmentId',
          optionsHtml: `<option value="">不分配</option>${depts.filter((d) => d.status === 'active').map((d) => `<option value="${d.id}" ${String(userForm.departmentId) === String(d.id) ? 'selected' : ''}>${d.name}</option>`).join('')}`
        })}
        <div class="form-group" id="user-password-group" style="display:${userForm.showPassword ? '' : 'none'}"><label>密码</label><input type="password" id="user-password" placeholder="至少6位" minlength="6" value="${escapeHtml(userForm.password)}" oninput="updateAdminModalField('user', 'password', this.value)"></div>
        <div class="form-group" id="user-status-group" style="display:${userForm.showStatus ? '' : 'none'}">
          <label>状态</label>
          <select id="user-status" onchange="updateAdminModalField('user', 'status', this.value)"><option value="active" ${userForm.status === 'active' ? 'selected' : ''}>启用</option><option value="inactive" ${userForm.status === 'inactive' ? 'selected' : ''}>停用</option></select>
        </div>
        ${renderAdminModalActions('user-modal')}
      </form>
    `));
  }

  modalHtml.push(renderLegacyModalShell('hr-modal', `
    ${renderAdminModalTitle('hr-modal-title', hrForm.title)}
    <form onsubmit="return submitHrAccount(event)">
      <input type="hidden" id="hr-edit-id" value="${escapeHtml(hrForm.editId)}">
      ${renderAdminTextInput({ label: 'HR 名称', id: 'hr-name', required: true, placeholder: '请输入HR名称', value: hrForm.name, modalKey: 'hr', field: 'name' })}
      ${renderAdminSelect({
        label: '关联用户',
        id: 'hr-user-id',
        value: hrForm.userId,
        modalKey: 'hr',
        field: 'userId',
        required: true,
        optionsHtml: `<option value="">请选择用户</option>${users.filter((u) => u.role === 'hr' && u.status === 'active').map((u) => `<option value="${u.id}" ${String(hrForm.userId) === String(u.id) ? 'selected' : ''}>${u.name} (${u.email})</option>`).join('')}`
      })}
      ${renderAdminSelect({
        label: '所属部门',
        id: 'hr-dept',
        value: hrForm.departmentId,
        modalKey: 'hr',
        field: 'departmentId',
        optionsHtml: `<option value="">不分配</option>${depts.filter((d) => d.status === 'active').map((d) => `<option value="${d.id}" ${String(hrForm.departmentId) === String(d.id) ? 'selected' : ''}>${d.name}</option>`).join('')}`
      })}
      ${renderAdminTextInput({ label: '备注', id: 'hr-notes', placeholder: '选填', value: hrForm.notes, modalKey: 'hr', field: 'notes' })}
      <div class="form-group" id="hr-status-group" style="display:${hrForm.showStatus ? '' : 'none'}">
        <label>状态</label>
        <select id="hr-status" onchange="updateAdminModalField('hr', 'status', this.value)"><option value="active" ${hrForm.status === 'active' ? 'selected' : ''}>启用</option><option value="inactive" ${hrForm.status === 'inactive' ? 'selected' : ''}>停用</option></select>
      </div>
      ${renderAdminModalActions('hr-modal')}
    </form>
  `));

  modalHtml.push(renderLegacyModalShell('limits-modal', `
    ${renderAdminModalTitle('limits-modal-title', limitsForm.title)}
    <form onsubmit="return submitLimits(event)">
      <input type="hidden" id="limits-user-id" value="${escapeHtml(limitsForm.userId)}">
      ${renderAdminTextInput({ label: '有效期', id: 'limits-expires-at', type: 'date', value: limitsForm.expiresAt, modalKey: 'limits', field: 'expiresAt' })}
      <div class="form-group"><label>HR 账号上限（0 表示不限）</label><input type="number" id="limits-max-hr" min="0" value="${escapeHtml(limitsForm.maxHrAccounts)}" oninput="updateAdminModalField('limits', 'maxHrAccounts', Number(this.value) || 0)"></div>
      ${renderAdminModalActions('limits-modal')}
    </form>
  `));

  return modalHtml.join('');
}

function renderAdminResourceModals() {
  const hrAccounts = state.adminHrAccounts || [];
  const bossAccounts = state.adminBossAccounts || [];
  const baForm = state.adminModalForms.ba;
  const biForm = state.adminModalForms.bi;

  return [
    renderLegacyModalShell('ba-modal', `
      ${renderAdminModalTitle('ba-modal-title', baForm.title)}
      <form onsubmit="return submitBossAccount(event)">
        <input type="hidden" id="ba-edit-id" value="${escapeHtml(baForm.editId)}">
        ${renderAdminSelect({
          label: '关联HR账号',
          id: 'ba-hr',
          value: baForm.hrAccountId,
          modalKey: 'ba',
          field: 'hrAccountId',
          required: true,
          disabled: baForm.hrDisabled,
          optionsHtml: `<option value="">请选择</option>${hrAccounts.filter((h) => h.status === 'active').map((h) => `<option value="${h.id}" ${String(baForm.hrAccountId) === String(h.id) ? 'selected' : ''}>${h.name}</option>`).join('')}`
        })}
        ${renderAdminTextInput({ label: 'BOSS 登录名', id: 'ba-login', placeholder: 'BOSS直聘登录账号', value: baForm.bossLoginName, modalKey: 'ba', field: 'bossLoginName' })}
        ${renderAdminTextInput({ label: '显示名称', id: 'ba-display', placeholder: '便于识别的名称', value: baForm.displayName, modalKey: 'ba', field: 'displayName' })}
        <div class="form-group" id="ba-status-group" style="display:${baForm.showStatus ? '' : 'none'}">
          <label>状态</label>
          <select id="ba-status" onchange="updateAdminModalField('ba', 'status', this.value)"><option value="active" ${baForm.status === 'active' ? 'selected' : ''}>启用</option><option value="inactive" ${baForm.status === 'inactive' ? 'selected' : ''}>停用</option></select>
        </div>
        ${renderAdminModalActions('ba-modal')}
      </form>
    `),
    renderLegacyModalShell('bi-modal', `
      ${renderAdminModalTitle('bi-modal-title', biForm.title)}
      <form onsubmit="return submitBrowserInstance(event)">
        <input type="hidden" id="bi-edit-id" value="${escapeHtml(biForm.editId)}">
        ${renderAdminSelect({
          label: '关联BOSS账号',
          id: 'bi-ba',
          value: biForm.bossAccountId,
          modalKey: 'bi',
          field: 'bossAccountId',
          required: true,
          disabled: biForm.bossDisabled,
          changeHandler: `onBiAccountChange(this.value)`,
          optionsHtml: bossAccounts.filter((b) => b.status === 'active').length
            ? '<option value=\"\">请选择</option>' + bossAccounts.filter((b) => b.status === 'active').map((b) => `<option value="${b.id}" ${String(biForm.bossAccountId) === String(b.id) ? 'selected' : ''}>${b.display_name || b.boss_login_name || 'BOSS#' + b.id}</option>`).join('')
            : '<option value=\"\">无可用账号</option>'
        })}
        ${renderAdminTextInput({ label: '实例名称', id: 'bi-name', placeholder: '如：Chrome-HR1', value: biForm.instanceName, modalKey: 'bi', field: 'instanceName' })}
        ${renderAdminTextInput({ label: 'CDP 端点', id: 'bi-cdp', required: true, placeholder: 'http://127.0.0.1:9222', value: biForm.cdpEndpoint, modalKey: 'bi', field: 'cdpEndpoint' })}
        ${renderAdminTextInput({ label: '用户数据目录', id: 'bi-userdata', required: true, placeholder: '/path/to/chrome-profile', value: biForm.userDataDir, modalKey: 'bi', field: 'userDataDir' })}
        ${renderAdminTextInput({ label: '下载目录', id: 'bi-download', required: true, placeholder: '/path/to/downloads', value: biForm.downloadDir, modalKey: 'bi', field: 'downloadDir' })}
        ${renderAdminTextInput({ label: '调试端口', id: 'bi-port', type: 'number', placeholder: '9222', value: biForm.debugPort, modalKey: 'bi', field: 'debugPort' })}
        ${renderAdminTextInput({ label: '主机', id: 'bi-host', placeholder: 'localhost', value: biForm.host, modalKey: 'bi', field: 'host' })}
        <div class="form-group" id="bi-status-group" style="display:${biForm.showStatus ? '' : 'none'}">
          <label>状态</label>
          <select id="bi-status" onchange="updateAdminModalField('bi', 'status', this.value)"><option value="idle" ${biForm.status === 'idle' ? 'selected' : ''}>空闲</option><option value="offline" ${biForm.status === 'offline' ? 'selected' : ''}>离线</option></select>
        </div>
        ${renderAdminModalActions('bi-modal')}
      </form>
    `)
  ].join('');
}

function showLimitsModal(u) {
  updateAdminModalForm('limits', {
    userId: String(u.id),
    title: '配额设置 - ' + u.name,
    expiresAt: u.expires_at ? u.expires_at.split('T')[0] : '',
    maxHrAccounts: u.max_hr_accounts || 0
  });
  openExistingAdminModal('limits-modal');
}

async function submitLimits(e) {
  e.preventDefault();
  const { userId, expiresAt, maxHrAccounts } = state.adminModalForms.limits;
  try {
    await fetchJson('/api/admin/users/' + userId + '/limits', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresAt: expiresAt || null, maxHrAccounts: Number(maxHrAccounts) || 0 })
    });
    closeModal('limits-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function showModal(id) {
  if (id === 'dept-modal') {
    updateAdminModalForm('dept', createDeptAdminModalForm());
  }
  if (id === 'user-modal') {
    updateAdminModalForm('user', createUserAdminModalForm());
  }
  if (id === 'hr-modal') {
    updateAdminModalForm('hr', createHrAdminModalForm());
  }
  if (id === 'limits-modal') {
    updateAdminModalForm('limits', createLimitsAdminModalForm());
  }
  if (id === 'ba-modal') {
    updateAdminModalForm('ba', createBossAccountAdminModalForm());
  }
  if (id === 'bi-modal') {
    updateAdminModalForm('bi', createBrowserInstanceAdminModalForm(getNextBrowserInstancePort()));
  }
  openExistingAdminModal(id);
}

function closeModal(id) {
  if (!id || state.adminModalOpenId === id) {
    state.adminModalOpenId = '';
    render();
  }
}

async function submitDept(e) {
  e.preventDefault();
  const { editId: id, name, status } = state.adminModalForms.dept;
  const safeName = name.trim();
  if (!safeName) return false;
  try {
    if (id) {
      await fetchJson('/api/admin/departments/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: safeName, status })
      });
    } else {
      await fetchJson('/api/admin/departments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: safeName })
      });
    }
    closeModal('dept-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function editDept(id, name, status) {
  updateAdminModalForm('dept', {
    editId: String(id),
    title: '编辑部门',
    name,
    status: status || 'active',
    showStatus: true
  });
  openExistingAdminModal('dept-modal');
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
  const {
    editId: id,
    name,
    email,
    phone,
    role,
    departmentId,
    password,
    status
  } = state.adminModalForms.user;
  const safeName = name.trim();
  const safeEmail = email.trim();
  const safePhone = phone.trim();
  if (!safeName || !safeEmail) return false;
  try {
    if (id) {
      await fetchJson('/api/admin/users/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: safeName, email: safeEmail, phone: safePhone || null, role, departmentId: departmentId || null, status })
      });
    } else {
      if (!password || password.length < 6) { alert('密码不能少于6位'); return false; }
      await fetchJson('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: safeName, email: safeEmail, phone: safePhone || null, password, role, departmentId: departmentId || null })
      });
    }
    closeModal('user-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function editUser(u) {
  updateAdminModalForm('user', {
    editId: String(u.id),
    title: '编辑用户',
    name: u.name || '',
    email: u.email || '',
    phone: u.phone || '',
    role: u.role || 'hr',
    departmentId: u.department_id || '',
    password: '',
    status: u.status || 'active',
    showPassword: false,
    showStatus: true
  });
  openExistingAdminModal('user-modal');
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
  const { editId: id, name, userId, departmentId, notes, status } = state.adminModalForms.hr;
  const safeName = name.trim();
  const safeNotes = notes.trim();
  if (!safeName || !userId) return false;
  try {
    if (id) {
      await fetchJson('/api/admin/hr-accounts/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: safeName, status, notes: safeNotes || null })
      });
    } else {
      await fetchJson('/api/admin/hr-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, departmentId: departmentId || null, name: safeName, notes: safeNotes || null })
      });
    }
    closeModal('hr-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function editHrAccount(h) {
  updateAdminModalForm('hr', {
    editId: String(h.id),
    title: '编辑HR账号',
    name: h.name || '',
    userId: h.user_id || '',
    departmentId: h.department_id || '',
    notes: h.notes || '',
    status: h.status || 'active',
    showStatus: true
  });
  openExistingAdminModal('hr-modal');
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
  const { editId: id, hrAccountId, bossLoginName, displayName, status } = state.adminModalForms.ba;
  const safeBossLoginName = bossLoginName.trim();
  const safeDisplayName = displayName.trim();
  try {
    if (id) {
      await fetchJson('/api/admin/boss-accounts/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bossLoginName: safeBossLoginName, displayName: safeDisplayName, status })
      });
    } else {
      await fetchJson('/api/admin/boss-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hrAccountId, bossLoginName: safeBossLoginName, displayName: safeDisplayName })
      });
    }
    closeModal('ba-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function editBossAccount(b) {
  updateAdminModalForm('ba', {
    editId: String(b.id),
    title: '编辑BOSS账号',
    hrAccountId: b.hr_account_id || '',
    bossLoginName: b.boss_login_name || '',
    displayName: b.display_name || '',
    status: b.status || 'active',
    hrDisabled: true,
    showStatus: true
  });
  openExistingAdminModal('ba-modal');
}

async function deleteBossAccount(id) {
  if (!confirm('确定删除该BOSS账号？')) return;
  try {
    await fetchJson('/api/admin/boss-accounts/' + id, { method: 'DELETE' });
    await loadData();
  } catch (err) { alert(err.message); }
}

function onBiAccountChange(baId) {
  if (state.adminModalForms.bi.editId) return;
  const ba = (state.adminBossAccounts || []).find((b) => String(b.id) === String(baId));
  updateAdminModalField('bi', 'bossAccountId', baId || '');
  if (!ba) {
    render();
    return;
  }
  const label = ba.display_name || ba.boss_login_name || '';
  const key = (ba.boss_login_name || '').replace(/^boss_/, '') || 'account' + ba.id;
  const port = state.adminModalForms.bi.debugPort || '9222';
  updateAdminModalForm('bi', {
    bossAccountId: baId || '',
    instanceName: 'Chrome-' + label.replace(/BOSS$/, '').trim(),
    userDataDir: '~/.chrome-boss-profiles/' + key,
    downloadDir: '~/.chrome-boss-downloads/' + key,
    cdpEndpoint: 'http://127.0.0.1:' + port
  });
  render();
}

async function submitBrowserInstance(e) {
  e.preventDefault();
  const {
    editId: id,
    bossAccountId,
    instanceName,
    cdpEndpoint,
    userDataDir,
    downloadDir,
    debugPort,
    host,
    status
  } = state.adminModalForms.bi;
  const safeInstanceName = instanceName.trim();
  const safeCdpEndpoint = cdpEndpoint.trim();
  const safeUserDataDir = userDataDir.trim();
  const safeDownloadDir = downloadDir.trim();
  const safeHost = host.trim() || 'localhost';
  try {
    if (id) {
      await fetchJson('/api/admin/browser-instances/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName: safeInstanceName, cdpEndpoint: safeCdpEndpoint, userDataDir: safeUserDataDir, downloadDir: safeDownloadDir, debugPort: debugPort || null, host: safeHost, status })
      });
    } else {
      await fetchJson('/api/admin/browser-instances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bossAccountId, instanceName: safeInstanceName, cdpEndpoint: safeCdpEndpoint, userDataDir: safeUserDataDir, downloadDir: safeDownloadDir, debugPort: debugPort || null, host: safeHost })
      });
    }
    closeModal('bi-modal');
    await loadData();
  } catch (err) { alert(err.message); }
  return false;
}

function editBrowserInstance(bi) {
  updateAdminModalForm('bi', {
    editId: String(bi.id),
    title: '编辑浏览器实例',
    bossAccountId: bi.boss_account_id || '',
    instanceName: bi.instance_name || '',
    cdpEndpoint: bi.cdp_endpoint || '',
    userDataDir: bi.user_data_dir || '',
    downloadDir: bi.download_dir || '',
    debugPort: bi.debug_port || '',
    host: bi.host || 'localhost',
    status: bi.status || 'idle',
    bossDisabled: true,
    showStatus: true
  });
  openExistingAdminModal('bi-modal');
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
  openRuntimeConsole({
    instanceId,
    useHrEndpoint: false,
    title: `实例 #${instanceId}`,
    standbyMessage: '当前实例暂无绑定执行任务，可先检查登录状态与页面稳定性。'
  });
}

async function restartLiveViewBrowser() {
  const btn = document.getElementById('live-view-restart-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '重启中...';
  }
  stopLiveViewPolling();
  try {
    const url = liveView.useHrEndpoint
      ? '/api/browser/restart'
      : `/api/admin/browser-instances/${liveView.instanceId}/restart`;
    const resp = await fetchJson(url, { method: 'POST' });
    if (resp.error) {
      alert(resp.message || '重启失败');
    } else {
      liveView.error = '';
      liveView.viewportWidth = 0;
      liveView.viewportHeight = 0;
    }
  } catch (err) {
    alert('重启失败: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '重启浏览器';
    }
    if (liveView.open) {
      startLiveViewPolling();
    }
  }
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
  const pageUrlEl = document.getElementById('runtime-console-page-url');
  const noteEl = document.getElementById('runtime-console-browser-note');

  if (statusEl) {
    if (liveView.error) {
      statusEl.innerHTML = `<span class="live-view-error">${escapeHtml(liveView.error)}</span>`;
    } else {
      const title = liveView.pageTitle || '正在同步浏览器画面...';
      statusEl.innerHTML = `<span class="live-view-info">${escapeHtml(title)}</span>`;
    }
  }

  if (pageUrlEl) {
    pageUrlEl.textContent = liveView.pageUrl || '等待页面地址...';
  }

  if (noteEl) {
    noteEl.textContent = getRuntimeConsoleRecommendation();
  }
}

async function handleLiveViewClick(event) {
  const img = event.target;
  const rect = img.getBoundingClientRect();
  const targetWidth = liveView.viewportWidth || img.naturalWidth;
  const targetHeight = liveView.viewportHeight || img.naturalHeight;
  const clickPoint = resolveContainedImageClick({
    clientX: event.clientX,
    clientY: event.clientY,
    rectLeft: rect.left,
    rectTop: rect.top,
    rectWidth: rect.width,
    rectHeight: rect.height,
    sourceWidth: targetWidth,
    sourceHeight: targetHeight
  });
  const ratioX = event.clientX - rect.left;
  const ratioY = event.clientY - rect.top;
  const pageX = clickPoint.pageX;
  const pageY = clickPoint.pageY;

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
  const deptAdmin = isDeptAdmin();
  return `
    <section class="table-card">
      <div class="card-header">
        <div>
          <p class="eyebrow">职位管理</p>
          <h3 class="card-title">职位列表</h3>
          <p class="card-subtitle">${admin ? (deptAdmin ? '本部门职位概览，按 HR 查看候选人规模与转化数据。' : '全局职位概览，按 HR 查看候选人规模与转化数据。') : '按职位查看候选人规模与关键转化数据。'}</p>
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
            ${admin ? '' : '<th>操作</th>'}
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
  const hasAnySchedule = hasSchedule(job.job_key, 'source') || hasSchedule(job.job_key, 'followup');

  return `
    <div class="table-actions">
      <button
        class="button-secondary button-compact"
        onclick='openJobDetailModal(${JSON.stringify(job.job_key)})'
        title="查看职位详情"
      >
        查看详情
      </button>
      ${hasAnySchedule
        ? '<span class="badge badge-success" title="已配置调度任务，前往自动化调度页执行">已配置调度</span>'
        : '<span class="badge badge-warning" title="请到自动化调度页添加定时任务">未配置调度</span>'
      }
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
  const downloadMode = isCandidateDownloadMode();

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
          ${downloadMode
            ? `<button class="button-secondary" onclick="exitCandidateDownloadMode()">退出下载模式</button>`
            : `<button class="button-secondary" onclick="enterCandidateDownloadMode()">下载简历</button>`}
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
            <select onchange="updateCandidateFilter('resumeState', this.value)" ${downloadMode ? 'disabled' : ''}>
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
      ${downloadMode ? renderCandidateBulkActions() : ''}
      ${state.candidateListLoading ? '<div class="empty-state">正在加载候选人列表...</div>' : renderCandidateTable()}
      ${renderCandidatePagination()}
    </section>
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

function isCandidateDownloadMode() {
  return state.candidateSelectionMode === 'download';
}

function resetCandidateBulkDownloadState() {
  state.selectedCandidateIds = [];
  state.candidateBulkDownload = {
    loading: false,
    error: '',
    success: ''
  };
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
    resumeState: isCandidateDownloadMode() ? 'downloaded' : '',
    keyword: '',
    page: 1
  };
  loadCandidates();
}

async function enterCandidateDownloadMode() {
  if (isCandidateDownloadMode()) {
    return;
  }

  state.candidateSelectionMode = 'download';
  state.candidateSelectionSnapshot = { ...state.candidateQuery };
  state.candidateQuery = buildCandidateDownloadQuery(state.candidateQuery);
  resetCandidateBulkDownloadState();
  await loadCandidates();
}

async function exitCandidateDownloadMode() {
  const snapshot = state.candidateSelectionSnapshot;
  state.candidateSelectionMode = 'none';
  state.candidateSelectionSnapshot = null;
  resetCandidateBulkDownloadState();

  if (snapshot) {
    state.candidateQuery = { ...snapshot };
    await loadCandidates();
    return;
  }

  render();
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
  const activeFilters = isCandidateDownloadMode() ? ['下载模式'] : [];

  if (jobKey) {
    const job = state.jobs.find((item) => item.job_key === jobKey);
    activeFilters.push(job?.job_name || jobKey);
  }

  if (status) {
    activeFilters.push(formatLifecycleStatus(status));
  }

  if (resumeState && !(isCandidateDownloadMode() && resumeState === 'downloaded')) {
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

function renderCandidateBulkActions() {
  const selectedCount = state.selectedCandidateIds.length;
  const visibleCandidateIds = state.candidates
    .filter((candidate) => isResumeDownloadable(candidate))
    .map((candidate) => candidate.id);
  const allVisibleSelected = visibleCandidateIds.length > 0
    && visibleCandidateIds.every((candidateId) => state.selectedCandidateIds.includes(candidateId));
  const { loading, error, success } = state.candidateBulkDownload;

  return `
    <div class="candidate-bulk-toolbar">
      <label class="checkbox-label candidate-bulk-checkbox">
        <input
          type="checkbox"
          ${allVisibleSelected ? 'checked' : ''}
          ${!visibleCandidateIds.length ? 'disabled' : ''}
          onchange="toggleCandidatePageSelection(this.checked)"
        />
        全选本页${visibleCandidateIds.length ? `（${visibleCandidateIds.length}）` : ''}
      </label>
      <div class="muted">
        ${selectedCount
          ? `当前已自动筛选“已下载简历”，已选 ${selectedCount} 位候选人。`
          : '当前列表已自动筛选为“已下载简历”，勾选后即可批量下载。'}
      </div>
      <div class="table-actions">
        <button
          class="button-secondary button-compact"
          onclick="clearCandidateSelection()"
          ${selectedCount || loading ? '' : 'disabled'}
        >
          清空选择
        </button>
        <button
          class="button-secondary button-compact"
          onclick="downloadSelectedCandidateResumes()"
          ${selectedCount && !loading ? '' : 'disabled'}
        >
          ${loading ? '打包中...' : '批量下载简历'}
        </button>
      </div>
    </div>
    ${error ? `<div class="inline-status inline-status-error">${escapeHtml(error)}</div>` : ''}
    ${!error && success ? `<div class="inline-status inline-status-success">${escapeHtml(success)}</div>` : ''}
  `;
}

function renderCandidateTable() {
  if (!state.candidates.length) {
    return '<div class="empty-state">当前筛选条件下没有候选人，建议切换岗位或放宽筛选条件。</div>';
  }

  const admin = isAdmin();
  const downloadMode = isCandidateDownloadMode();
  const selectableCandidates = state.candidates.filter((candidate) => isResumeDownloadable(candidate));
  const allVisibleSelected = selectableCandidates.length > 0
    && selectableCandidates.every((candidate) => state.selectedCandidateIds.includes(candidate.id));
  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            ${downloadMode ? `
              <th class="candidate-select-column">
                <input
                  type="checkbox"
                  ${allVisibleSelected ? 'checked' : ''}
                  ${selectableCandidates.length ? '' : 'disabled'}
                  onchange="toggleCandidatePageSelection(this.checked)"
                />
              </th>
            ` : ''}
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
              ${downloadMode ? `
                <td class="candidate-select-column" onclick="event.stopPropagation()">
                  <input
                    type="checkbox"
                    ${state.selectedCandidateIds.includes(candidate.id) ? 'checked' : ''}
                    ${isResumeDownloadable(candidate) ? '' : 'disabled'}
                    onclick="event.stopPropagation()"
                    onchange="toggleCandidateSelection(${JSON.stringify(candidate.id)}, this.checked)"
                  />
                </td>
              ` : ''}
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

function toggleCandidateSelection(candidateId, checked) {
  if (!isCandidateDownloadMode()) {
    return;
  }

  const candidate = state.candidates.find((item) => item.id === candidateId);
  if (checked && candidate && !isResumeDownloadable(candidate)) {
    return;
  }

  const selectedCandidateIds = new Set(state.selectedCandidateIds);
  if (checked) {
    selectedCandidateIds.add(candidateId);
  } else {
    selectedCandidateIds.delete(candidateId);
  }

  state.selectedCandidateIds = Array.from(selectedCandidateIds);
  state.candidateBulkDownload.error = '';
  state.candidateBulkDownload.success = '';
  render();
}

function toggleCandidatePageSelection(checked) {
  if (!isCandidateDownloadMode()) {
    return;
  }

  const selectedCandidateIds = new Set(state.selectedCandidateIds);

  for (const candidate of state.candidates) {
    if (!isResumeDownloadable(candidate)) {
      continue;
    }
    if (checked) {
      selectedCandidateIds.add(candidate.id);
    } else {
      selectedCandidateIds.delete(candidate.id);
    }
  }

  state.selectedCandidateIds = Array.from(selectedCandidateIds);
  state.candidateBulkDownload.error = '';
  state.candidateBulkDownload.success = '';
  render();
}

function clearCandidateSelection() {
  state.selectedCandidateIds = [];
  state.candidateBulkDownload.error = '';
  state.candidateBulkDownload.success = '';
  render();
}

async function downloadSelectedCandidateResumes() {
  if (!isCandidateDownloadMode() || !state.selectedCandidateIds.length || state.candidateBulkDownload.loading) {
    return;
  }

  state.candidateBulkDownload.loading = true;
  state.candidateBulkDownload.error = '';
  state.candidateBulkDownload.success = '';
  render();

  try {
    const response = await fetch('/api/candidates/bulk-resume-download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        candidateIds: state.selectedCandidateIds
      })
    });

    if (!response.ok) {
      let message = '批量下载简历失败';
      try {
        const payload = await response.json();
        message = payload.message || payload.error || message;
      } catch (_) {}
      throw new Error(message);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const bundleCount = Number(response.headers.get('X-Resume-Bundle-Count') || '0');
    const skippedCount = Number(response.headers.get('X-Resume-Bundle-Skipped') || '0');

    link.href = objectUrl;
    link.download = parseDownloadFileName(response.headers.get('Content-Disposition')) || 'candidate-resumes.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);

    state.selectedCandidateIds = [];
    state.candidateBulkDownload.success = skippedCount > 0
      ? `已打包下载 ${bundleCount} 份简历，跳过 ${skippedCount} 位暂无落盘简历的候选人。`
      : `已打包下载 ${bundleCount} 份简历。`;
  } catch (error) {
    state.candidateBulkDownload.error = error.message;
  } finally {
    state.candidateBulkDownload.loading = false;
    render();
  }
}

function parseDownloadFileName(disposition) {
  if (!disposition) {
    return '';
  }

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (_) {}
  }

  const fallbackMatch = disposition.match(/filename="([^"]+)"/i);
  return fallbackMatch ? fallbackMatch[1] : '';
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
            ${renderLlmEvaluationSection(item)}
            ${renderFullResumeSection(item)}
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

function renderLlmEvaluationSection(item) {
  const evaluation = buildCandidateEvaluation(item);
  if (!evaluation) return '';

  const decisionColor = evaluation.action === 'skip' ? '#dc2626' : '#16a34a';
  const tierColors = { A: '#16a34a', B: '#2563eb', C: '#d97706' };
  const tierColor = tierColors[evaluation.priority] || '#6b7280';
  const facts = evaluation.facts || {};
  const factsHtml = Object.keys(facts).length > 0
    ? Object.entries(facts).map(([k, v]) =>
        `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #f1f5f9;">
          <span style="min-width:80px;color:#64748b;font-size:12px;">${escapeHtml(k)}</span>
          <span style="font-size:13px;color:#334155;">${escapeHtml(String(v))}</span>
        </div>`
      ).join('')
    : '<span style="color:#94a3b8;font-size:13px;">无</span>';
  const evidenceHtml = Array.isArray(evaluation.requirementEvidence) && evaluation.requirementEvidence.length
    ? `<ul style="margin:0;padding-left:18px;color:#334155;font-size:13px;line-height:1.8;">
        ${evaluation.requirementEvidence.map((itemText) => `<li>${escapeHtml(itemText)}</li>`).join('')}
      </ul>`
    : '<span style="color:#94a3b8;font-size:13px;">无</span>';
  const unsupportedFiltersHtml = Array.isArray(evaluation.unsupportedFilters) && evaluation.unsupportedFilters.length
    ? `<p style="margin-top:8px;color:#b45309;font-size:12px;">未生效筛选：${escapeHtml(evaluation.unsupportedFilters.join('、'))}</p>`
    : '';

  return `
    <section class="candidate-detail-section">
      <div class="card-header">
        <div>
          <p class="eyebrow">模型评估</p>
          <h4 class="card-title job-detail-section-title">LLM 判断依据</h4>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:12px;">
        <span style="display:inline-flex;align-items:center;padding:4px 12px;border-radius:6px;font-size:13px;font-weight:600;color:#fff;background:${decisionColor};">${escapeHtml(evaluation.label)}</span>
        ${evaluation.kind === 'source' ? `<span style="display:inline-flex;align-items:center;padding:4px 12px;border-radius:6px;font-size:13px;font-weight:600;color:#fff;background:${tierColor};">优先级 ${escapeHtml(evaluation.priority)}</span>` : ''}
        ${evaluation.kind === 'followup' ? `<span class="badge badge-neutral">来源 ${escapeHtml(evaluation.source || 'llm')}</span>` : ''}
      </div>
      <div style="margin-bottom:12px;">
        <p style="font-size:12px;color:#64748b;margin-bottom:4px;">判断理由</p>
        <p style="font-size:13px;line-height:1.6;color:#334155;background:#f8f9fa;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;">${escapeHtml(evaluation.reason)}</p>
      </div>
      <div style="margin-bottom:12px;">
        <p style="font-size:12px;color:#64748b;margin-bottom:4px;">评估依据</p>
        <div style="background:#f8f9fa;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;">
          ${evidenceHtml}
          ${unsupportedFiltersHtml}
        </div>
      </div>
      ${evaluation.kind === 'source' ? `
        <div>
          <p style="font-size:12px;color:#64748b;margin-bottom:4px;">关键信息</p>
          <div style="background:#f8f9fa;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;">
            ${factsHtml}
          </div>
        </div>
      ` : ''}
    </section>
  `;
}

function renderFullResumeSection(item) {
  const meta = item.profile_metadata || {};
  const text = meta.fullResumeText;
  if (!text) return '';

  const readAt = meta.resumeReadAt ? formatDateTime(meta.resumeReadAt) : '';
  const mode = meta.evaluationMode || '';
  const subtitle = [
    readAt ? `采集于 ${readAt}` : '',
    mode === 'full_resume_detail' ? '来源：详情页滚动采集' : ''
  ].filter(Boolean).join(' · ');

  return `
    <section class="candidate-detail-section">
      <div class="card-header">
        <div>
          <p class="eyebrow">简历全文</p>
          <h4 class="card-title job-detail-section-title">完整简历内容</h4>
          ${subtitle ? `<p class="card-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        </div>
      </div>
      <div class="candidate-resume-text">
        <pre style="white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.6;max-height:500px;overflow-y:auto;padding:12px;background:#f8f9fa;border-radius:8px;border:1px solid #e2e8f0;">${escapeHtml(text)}</pre>
      </div>
    </section>
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

function renderWorkConfigPanel() {
  const wc = state.workConfig;
  const windows = wc?.work_windows || [{ start: '09:00', end: '18:00' }];

  const windowRows = windows.map((w, idx) => `
    <div class="wc-chip">
      <input class="wc-chip-time" type="time" value="${w.start || '09:00'}" onchange="updateWorkWindow(${idx}, 'start', this.value)" />
      <span class="wc-chip-sep">-</span>
      <input class="wc-chip-time" type="time" value="${w.end || '18:00'}" onchange="updateWorkWindow(${idx}, 'end', this.value)" />
      ${windows.length > 1 ? `<button type="button" class="wc-chip-del" onclick="removeWorkWindow(${idx})" title="删除">✕</button>` : ''}
    </div>
  `).join('');

  return `
    <div class="wc-bar">
      <span class="wc-bar-label">工作时间</span>
      <span class="wc-bar-sep"></span>
      <div class="wc-windows">${windowRows}</div>
      <button type="button" class="wc-add-btn" onclick="addWorkWindow()">+ 时段</button>
      <button class="wc-save-btn" onclick="saveWorkConfig()" ${state.workConfigSaving ? 'disabled' : ''}>
        ${state.workConfigSaving ? '保存中...' : '保存'}
      </button>
      ${state.workConfigSaved ? '<span class="wc-saved-tip">✓ 已保存</span>' : ''}
      ${state.workConfigError ? `<span class="wc-error-tip">${escapeHtml(state.workConfigError)}</span>` : ''}
    </div>
  `;
}

function buildScheduleRawSnapshot({ taskType, priority, cooldownMinutes, dailyMaxRuns, payload = {} }) {
  return {
    priority: Number(priority) || 5,
    cooldownMinutes: Number(cooldownMinutes) || 60,
    dailyMaxRuns: Number.isFinite(Number(dailyMaxRuns)) ? Number(dailyMaxRuns) : 0,
    payload: sanitizePayloadByTaskType(taskType, payload)
  };
}

function buildScheduleModalSimpleSnapshot(form = {}) {
  return JSON.stringify({
    jobKey: form.jobKey || '',
    taskType: form.taskType || 'source',
    pace: form.pace || 'standard',
    targetCount: form.targetCount ?? 5,
    maxThreads: form.maxThreads ?? 20,
    recommendTab: form.recommendTab || 'default',
    interactionTypes: Array.isArray(form.interactionTypes) ? form.interactionTypes : ['request_resume']
  });
}

function createScheduleModalForm(taskType = 'source') {
  const preset = presetToRaw({ taskType, pace: 'standard' });
  const payload = preset.payload || {};
  return {
    jobKey: '',
    taskType,
    pace: 'standard',
    targetCount: payload.targetCount ?? 5,
    maxThreads: payload.maxThreads ?? 20,
    recommendTab: payload.recommendTab || 'default',
    interactionTypes: Array.isArray(payload.interactionTypes) && payload.interactionTypes.length
      ? payload.interactionTypes
      : ['request_resume'],
    priority: preset.priority ?? 5,
    cooldownMinutes: preset.cooldownMinutes ?? 60,
    dailyMaxRuns: preset.dailyMaxRuns ?? 0,
    enabled: true,
    showAdvanced: false,
    advancedTouched: false,
    originalRaw: null,
    originalSimpleSnapshot: ''
  };
}

function buildScheduleSummary(schedule) {
  const raw = buildScheduleRawSnapshot({
    taskType: schedule.task_type,
    priority: schedule.priority,
    cooldownMinutes: schedule.cooldown_minutes,
    dailyMaxRuns: schedule.daily_max_runs,
    payload: schedule.payload || {}
  });
  const pace = rawToPace({
    taskType: schedule.task_type,
    priority: raw.priority,
    cooldownMinutes: raw.cooldownMinutes,
    dailyMaxRuns: raw.dailyMaxRuns
  });
  return buildSummaryLabel({
    taskType: schedule.task_type,
    pace,
    payload: raw.payload
  });
}

function renderAutomation() {
  return `
    ${renderWorkConfigPanel()}
    <section class="table-card">
      <div class="card-header">
        <div>
          <p class="eyebrow">自动化助手</p>
          <h3 class="card-title">按岗位开启自动化</h3>
          <p class="card-subtitle">只需要设置节奏、数量和交互方式，系统会自动安排执行。</p>
        </div>
        <div class="jobs-header-actions">
          <span class="badge">${state.schedules.length} 个自动化</span>
          <button class="button-secondary" onclick="openScheduleModal('create')">开启自动化</button>
        </div>
      </div>
      ${state.schedules.length ? `
        <table>
          <thead>
            <tr>
              <th>职位</th>
              <th>任务类型</th>
              <th>当前设置</th>
              <th>状态</th>
              <th>最近执行</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${state.schedules.map((schedule) => {
              const jobName = getJobNameByKey(schedule.job_key);
              const summary = buildScheduleSummary(schedule);

              return `
                <tr>
                  <td>${escapeHtml(jobName)}<div class="muted">${escapeHtml(schedule.job_key)}</div></td>
                  <td>${escapeHtml(formatTaskType(schedule.task_type))}</td>
                  <td>${escapeHtml(summary)}</td>
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
                        onclick='triggerScheduleById(${schedule.id}, ${JSON.stringify(schedule.job_key)}, ${JSON.stringify(schedule.task_type)})'
                        ${state.triggeringTaskKey === 'schedule:' + schedule.id ? 'disabled' : ''}
                        title="使用该调度配置的参数立即执行一次"
                      >
                        ${state.triggeringTaskKey === 'schedule:' + schedule.id ? '执行中...' : '立即执行'}
                      </button>
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
                        title="删除该任务"
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
      ` : '<div class="empty-state">当前暂无自动化，点击「开启自动化」创建。</div>'}
    </section>
  `;
}

function renderScheduleModal() {
  if (!state.scheduleModal.open) return '';

  const { mode, form, saving, error } = state.scheduleModal;
  const isView = mode === 'view';
  const isCreate = mode === 'create';
  const openJobs = state.jobs.filter((job) => job.status === 'open');
  const isSource = form.taskType === 'source';
  const titleMap = { create: '开启自动化', edit: '编辑自动化', view: '自动化详情' };

  const basicSection = `
    <div class="sm-section">
      <div class="sm-section-title">基本信息</div>
      <div class="sm-row">
        <label class="sm-field">
          <span class="sm-label">岗位</span>
          ${isCreate ? `
            <select class="sm-input" onchange="updateScheduleModalForm('jobKey', this.value)">
              <option value="">请选择岗位</option>
              ${openJobs.map((job) => `
                <option value="${escapeHtml(job.job_key)}" ${form.jobKey === job.job_key ? 'selected' : ''}>
                  ${escapeHtml(job.job_name)} (${escapeHtml(job.city || '-')})
                </option>
              `).join('')}
            </select>
          ` : `<div class="sm-value">${escapeHtml(getJobNameByKey(form.jobKey) || form.jobKey || '-')}</div>`}
        </label>
        <label class="sm-field">
          <span class="sm-label">任务类型</span>
          ${isCreate ? `
            <select class="sm-input" onchange="handleTaskTypeChange(this.value)">
              <option value="source" ${form.taskType === 'source' ? 'selected' : ''}>寻源打招呼</option>
              <option value="followup" ${form.taskType === 'followup' ? 'selected' : ''}>主动沟通拉简历</option>
            </select>
          ` : `<div class="sm-value">${escapeHtml(formatTaskType(form.taskType))}</div>`}
        </label>
      </div>
    </div>
  `;

  const paceSection = `
    <div class="sm-section">
      <div class="sm-section-title">执行节奏</div>
      ${isView ? `
        <div class="sm-value">${escapeHtml(formatPaceLabel(form.pace || 'standard'))}</div>
      ` : `
        <div class="segment-control">
          ${PACE_OPTIONS.filter((option) => option.value !== 'custom').map((option) => `
            <input type="radio" name="schedulePace" id="pace-${option.value}" value="${option.value}"
              ${form.pace === option.value ? 'checked' : ''}
              onchange="applySchedulePacePreset('${option.value}')"
            /><label for="pace-${option.value}">${escapeHtml(option.label)}</label>
          `).join('')}
        </div>
        ${form.pace === 'custom' ? '<span class="sm-hint">当前高级设置已自定义。</span>' : '<span class="sm-hint">系统将根据节奏自动安排内部执行频率。</span>'}
      `}
    </div>
  `;

  let paramsSection = '';
  if (isSource) {
    paramsSection = `
      <div class="sm-section">
        <div class="sm-section-title">执行设置</div>
        <div class="sm-row">
          <label class="sm-field">
            <span class="sm-label">单次打招呼人数</span>
            ${isView ? `<div class="sm-value">${form.targetCount || '-'} 人</div>` : `
              <div class="sm-input-group">
                <input class="sm-input" type="number" min="1" max="50" value="${form.targetCount}"
                  onchange="updateScheduleModalForm('targetCount', Number(this.value))" />
                <span class="sm-input-suffix">人</span>
              </div>
            `}
          </label>
          <div class="sm-field">
            <span class="sm-label">推荐列表模式</span>
            ${isView ? `<div class="sm-value">${(form.recommendTab || 'default') === 'default' ? '默认推荐' : '最新推荐'}</div>` : `
              <div class="segment-control">
                <input type="radio" name="recommendTab" id="rt-default" value="default"
                  ${(form.recommendTab || 'default') === 'default' ? 'checked' : ''}
                  onchange="updateScheduleModalForm('recommendTab', 'default')"
                /><label for="rt-default">默认推荐</label>
                <input type="radio" name="recommendTab" id="rt-latest" value="latest"
                  ${form.recommendTab === 'latest' ? 'checked' : ''}
                  onchange="updateScheduleModalForm('recommendTab', 'latest')"
                /><label for="rt-latest">最新推荐</label>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  } else {
    paramsSection = `
      <div class="sm-section">
        <div class="sm-section-title">执行设置</div>
        <div class="sm-row">
          <label class="sm-field">
            <span class="sm-label">单次处理人数</span>
            ${isView ? `<div class="sm-value">${form.maxThreads || '-'} 个</div>` : `
              <div class="sm-input-group">
                <input class="sm-input" type="number" min="1" max="100" value="${form.maxThreads}"
                  onchange="updateScheduleModalForm('maxThreads', Number(this.value))" />
                <span class="sm-input-suffix">个</span>
              </div>
            `}
          </label>
        </div>
        ${form.taskType === 'followup' ? `
        <div class="sm-field" style="margin-top:10px">
          <span class="sm-label">交互方式</span>
          ${isView ? `<div class="sm-value">${formatAutomationInteractionTypes(form.interactionTypes)}</div>` : `
            <div class="checkbox-group" style="margin-top:6px">
              <label class="checkbox-label"><input type="checkbox" ${(form.interactionTypes || []).includes('request_resume') ? 'checked' : ''} onchange="toggleInteractionType('request_resume', this.checked)" /> 求简历</label>
              <label class="checkbox-label"><input type="checkbox" ${(form.interactionTypes || []).includes('exchange_phone') ? 'checked' : ''} onchange="toggleInteractionType('exchange_phone', this.checked)" /> 换电话</label>
              <label class="checkbox-label"><input type="checkbox" ${(form.interactionTypes || []).includes('exchange_wechat') ? 'checked' : ''} onchange="toggleInteractionType('exchange_wechat', this.checked)" /> 换微信</label>
            </div>
          `}
        </div>
        ` : ''}
      </div>
    `;
  }

  const advancedSection = form.showAdvanced ? `
    <div class="sm-section">
      <div class="sm-section-title">高级设置</div>
      <div class="sm-row sm-row-3">
        <label class="sm-field">
          <span class="sm-label">优先级</span>
          ${isView ? `<div class="sm-value">P${form.priority ?? 5}</div>` : `
            <input class="sm-input" type="number" min="1" max="99" value="${form.priority ?? 5}"
              onchange="updateScheduleAdvancedField('priority', Number(this.value))" />
          `}
        </label>
        <label class="sm-field">
          <span class="sm-label">冷却时间</span>
          ${isView ? `<div class="sm-value">${form.cooldownMinutes ?? 60} 分钟</div>` : `
            <div class="sm-input-group">
              <input class="sm-input" type="number" min="5" max="1440" value="${form.cooldownMinutes ?? 60}"
                onchange="updateScheduleAdvancedField('cooldownMinutes', Number(this.value))" />
              <span class="sm-input-suffix">分钟</span>
            </div>
          `}
        </label>
        <label class="sm-field">
          <span class="sm-label">每日执行次数上限</span>
          ${isView ? `<div class="sm-value">${form.dailyMaxRuns || '不限'}</div>` : `
            <input class="sm-input" type="number" min="0" max="100" value="${form.dailyMaxRuns ?? 0}"
              onchange="updateScheduleAdvancedField('dailyMaxRuns', Number(this.value))" />
          `}
        </label>
      </div>
    </div>
  ` : '';

  return `
    <div class="modal-backdrop" onclick="closeScheduleModal()">
      <section class="sync-modal schedule-modal" onclick="event.stopPropagation()">
        <div class="sm-header">
          <h3 class="sm-title">${titleMap[mode]}</h3>
          <div class="sm-header-actions">
            ${isView ? `<button class="button-secondary button-compact" onclick="switchScheduleModalToEdit()">编辑</button>` : ''}
            <button class="button-secondary button-compact button-muted" onclick="closeScheduleModal()">关闭</button>
          </div>
        </div>
        ${error ? `<div class="inline-status inline-status-error">${escapeHtml(error)}</div>` : ''}
        <div class="sm-body">
          ${basicSection}
          ${paceSection}
          ${paramsSection}
          ${advancedSection}
          <button class="button-secondary button-compact" onclick="toggleScheduleAdvancedSettings()">
            ${form.showAdvanced ? '收起高级设置' : '查看高级设置'}
          </button>
        </div>
        ${!isView ? `
          <div class="sm-footer">
            <button class="sm-btn-primary" onclick="submitScheduleModal()" ${saving ? 'disabled' : ''}>
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
      form: createScheduleModalForm('source')
    };
  } else {
    const schedule = state.schedules.find((s) => String(s.id) === String(scheduleId));
    if (!schedule) return;
    const raw = buildScheduleRawSnapshot({
      taskType: schedule.task_type,
      priority: schedule.priority,
      cooldownMinutes: schedule.cooldown_minutes,
      dailyMaxRuns: schedule.daily_max_runs,
      payload: schedule.payload || {}
    });
    const pace = rawToPace({
      taskType: schedule.task_type,
      priority: raw.priority,
      cooldownMinutes: raw.cooldownMinutes,
      dailyMaxRuns: raw.dailyMaxRuns
    });
    const payload = raw.payload || {};
    const form = createScheduleModalForm(schedule.task_type);
    form.jobKey = schedule.job_key;
    form.pace = pace;
    form.targetCount = payload.targetCount ?? form.targetCount;
    form.maxThreads = payload.maxThreads ?? form.maxThreads;
    form.recommendTab = payload.recommendTab || form.recommendTab;
    form.interactionTypes = Array.isArray(payload.interactionTypes) && payload.interactionTypes.length
      ? payload.interactionTypes
      : form.interactionTypes;
    form.priority = raw.priority;
    form.cooldownMinutes = raw.cooldownMinutes;
    form.dailyMaxRuns = raw.dailyMaxRuns;
    form.enabled = schedule.enabled !== false;
    form.originalRaw = {
      priority: raw.priority,
      cooldownMinutes: raw.cooldownMinutes,
      dailyMaxRuns: raw.dailyMaxRuns,
      payload: { ...(schedule.payload || {}) }
    };
    form.originalSimpleSnapshot = buildScheduleModalSimpleSnapshot(form);
    state.scheduleModal = {
      open: true,
      mode,
      scheduleId,
      saving: false,
      error: '',
      form
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
    form: createScheduleModalForm('source')
  };
  render();
}

function switchScheduleModalToEdit() {
  state.scheduleModal.mode = 'edit';
  render();
}

function updateScheduleModalForm(field, value) {
  state.scheduleModal.form[field] = value;
  render();
}

function updateScheduleAdvancedField(field, value) {
  state.scheduleModal.form[field] = value;
  state.scheduleModal.form.advancedTouched = true;
  state.scheduleModal.form.pace = rawToPace({
    taskType: state.scheduleModal.form.taskType,
    priority: state.scheduleModal.form.priority,
    cooldownMinutes: state.scheduleModal.form.cooldownMinutes,
    dailyMaxRuns: state.scheduleModal.form.dailyMaxRuns
  });
  render();
}

function applySchedulePacePreset(pace) {
  const preset = presetToRaw({ taskType: state.scheduleModal.form.taskType, pace });
  const payload = preset.payload || {};
  state.scheduleModal.form.pace = pace;
  state.scheduleModal.form.priority = preset.priority ?? 5;
  state.scheduleModal.form.cooldownMinutes = preset.cooldownMinutes ?? 60;
  state.scheduleModal.form.dailyMaxRuns = preset.dailyMaxRuns ?? 0;
  if (state.scheduleModal.form.taskType === 'source') {
    state.scheduleModal.form.targetCount = payload.targetCount ?? state.scheduleModal.form.targetCount;
    state.scheduleModal.form.recommendTab = payload.recommendTab || state.scheduleModal.form.recommendTab;
  } else {
    state.scheduleModal.form.maxThreads = payload.maxThreads ?? state.scheduleModal.form.maxThreads;
    state.scheduleModal.form.interactionTypes = Array.isArray(payload.interactionTypes) && payload.interactionTypes.length
      ? [...payload.interactionTypes]
      : state.scheduleModal.form.interactionTypes;
  }
  state.scheduleModal.form.advancedTouched = false;
  render();
}

function toggleScheduleAdvancedSettings() {
  state.scheduleModal.form.showAdvanced = !state.scheduleModal.form.showAdvanced;
  render();
}

function handleTaskTypeChange(value) {
  const nextForm = createScheduleModalForm(value);
  nextForm.jobKey = state.scheduleModal.form.jobKey;
  nextForm.enabled = state.scheduleModal.form.enabled !== false;
  state.scheduleModal.form = {
    ...nextForm,
    showAdvanced: state.scheduleModal.form.showAdvanced
  };
  render();
}

function toggleInteractionType(type, checked) {
  const types = state.scheduleModal.form.interactionTypes || [];
  if (checked && !types.includes(type)) {
    types.push(type);
  } else if (!checked) {
    const idx = types.indexOf(type);
    if (idx !== -1) types.splice(idx, 1);
  }
  state.scheduleModal.form.interactionTypes = types;
  render();
}

function formatInteractionTypes(types) {
  return formatAutomationInteractionTypes(types);
}

function handleTimeRangeChange(idx, type, timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const ranges = state.scheduleModal.form.timeRanges;
  if (!ranges[idx]) return;
  if (type === 'start') {
    ranges[idx].startHour = hours || 0;
    ranges[idx].startMinute = minutes || 0;
  } else {
    ranges[idx].endHour = hours || 0;
    ranges[idx].endMinute = minutes || 0;
  }
}

function addTimeRange() {
  state.scheduleModal.form.timeRanges.push({ startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 });
  render();
}

function removeTimeRange(idx) {
  state.scheduleModal.form.timeRanges.splice(idx, 1);
  render();
}

function formatPayloadTimeRanges(payload) {
  const ranges = payload.timeRanges;
  if (ranges && ranges.length) {
    return ranges.map((r) =>
      `${escapeHtml(formatScheduleTime(r.startHour, r.startMinute))}~${escapeHtml(formatScheduleTime(r.endHour, r.endMinute))}`
    ).join('<br>');
  }
  const startTime = formatScheduleTime(payload.startHour, payload.startMinute);
  return escapeHtml(startTime);
}

// --- Work config functions ---

function updateWorkWindow(idx, field, value) {
  if (!state.workConfig) {
    state.workConfig = { work_windows: [{ start: '09:00', end: '18:00' }], enabled: true, queue_mode: 'priority' };
  }
  const windows = state.workConfig.work_windows || [{ start: '09:00', end: '18:00' }];
  if (windows[idx]) {
    windows[idx][field] = value;
  }
  state.workConfig.work_windows = windows;
  render();
}

function addWorkWindow() {
  if (!state.workConfig) {
    state.workConfig = { work_windows: [{ start: '09:00', end: '18:00' }], enabled: true, queue_mode: 'priority' };
  }
  const windows = state.workConfig.work_windows || [];
  windows.push({ start: '14:00', end: '18:00' });
  state.workConfig.work_windows = windows;
  render();
}

function removeWorkWindow(idx) {
  if (!state.workConfig) return;
  const windows = state.workConfig.work_windows || [];
  windows.splice(idx, 1);
  state.workConfig.work_windows = windows;
  render();
}

async function saveWorkConfig() {
  state.workConfigSaving = true;
  state.workConfigError = '';
  state.workConfigSaved = false;
  render();
  try {
    const wc = state.workConfig || {};
    const result = await fetchJson('/api/work-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workWindows: wc.work_windows || [{ start: '09:00', end: '18:00' }],
        queueMode: wc.queue_mode || 'priority',
        enabled: wc.enabled !== false
      })
    });
    state.workConfig = result.item;
    state.workConfigSaved = true;
    setTimeout(() => { state.workConfigSaved = false; render(); }, 2500);
  } catch (error) {
    state.workConfigError = `保存失败：${error.message}`;
  } finally {
    state.workConfigSaving = false;
    render();
  }
}

async function submitScheduleModal() {
  const { mode, form } = state.scheduleModal;

  if (!form.jobKey) {
    state.scheduleModal.error = '请选择一个岗位。';
    render();
    return;
  }

  state.scheduleModal.saving = true;
  state.scheduleModal.error = '';
  render();

  try {
    const preservedPayload = mode === 'create'
      ? {}
      : pickNonTaskPayload(form.originalRaw?.payload || {});
    const raw = buildScheduleRawSnapshot({
      taskType: form.taskType,
      priority: form.priority,
      cooldownMinutes: form.cooldownMinutes,
      dailyMaxRuns: form.dailyMaxRuns,
      payload: {
        ...preservedPayload,
        ...(form.taskType === 'source'
          ? {
              targetCount: form.targetCount,
              recommendTab: form.recommendTab || 'default'
            }
          : {
              maxThreads: form.maxThreads,
              interactionTypes: form.interactionTypes
            })
      }
    });
    const shouldPreserveOriginal = mode !== 'create'
      && !form.advancedTouched
      && form.originalRaw
      && buildScheduleModalSimpleSnapshot(form) === form.originalSimpleSnapshot;
    const finalRaw = shouldPreserveOriginal
      ? form.originalRaw
      : raw;
    await fetchJson('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobKey: form.jobKey,
        taskType: form.taskType,
        cronExpression: '',
        enabled: form.enabled !== false,
        pace: form.pace,
        payload: finalRaw.payload,
        priority: finalRaw.priority,
        cooldownMinutes: finalRaw.cooldownMinutes,
        dailyMaxRuns: finalRaw.dailyMaxRuns
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

async function loadTaskRuns(page) {
  state.taskRunsLoading = true;
  render();
  try {
    const p = page || state.taskRunsPagination.page;
    const params = new URLSearchParams({
      page: p,
      pageSize: state.taskRunsPagination.pageSize
    });
    if (state.taskRunsFilter.status) params.set('status', state.taskRunsFilter.status);
    if (state.taskRunsFilter.mode) params.set('mode', state.taskRunsFilter.mode);
    const data = await fetchJson('/api/runs?' + params.toString());
    state.taskRuns = data.items;
    state.taskRunsPagination = data.pagination;
  } catch (err) {
    state.taskRuns = [];
  } finally {
    state.taskRunsLoading = false;
    state.taskRunsLoaded = true;
    render();
  }
}

function changeTaskRunsPage(page) {
  state.taskRunsPagination.page = page;
  loadTaskRuns(page);
}

function changeTaskRunsFilter(field, value) {
  state.taskRunsFilter[field] = value;
  state.taskRunsPagination.page = 1;
  loadTaskRuns(1);
}

async function openTaskRunDetail(runId) {
  state.taskRunDetail = { open: true, runId, loading: true, error: '', events: [], run: null };
  render();
  try {
    const [runData, eventsData] = await Promise.allSettled([
      fetchJson('/api/runs/' + runId),
      fetchJson('/api/runs/' + runId + '/events')
    ]);

    if (runData.status === 'fulfilled') {
      state.taskRunDetail.run = runData.value.item;
    } else {
      state.taskRunDetail.error = runData.reason?.message || '加载任务详情失败，请稍后重试。';
    }

    if (eventsData.status === 'fulfilled') {
      state.taskRunDetail.events = eventsData.value.items || [];
    } else {
      state.taskRunDetail.error = state.taskRunDetail.error || eventsData.reason?.message || '加载执行事件失败，请稍后重试。';
      state.taskRunDetail.events = [];
    }
  } finally {
    state.taskRunDetail.loading = false;
    render();
  }
}

function closeTaskRunDetail() {
  state.taskRunDetail = { open: false, runId: null, loading: false, error: '', events: [], run: null };
  render();
}

function formatDuration(startedAt, completedAt) {
  if (!startedAt) return '-';
  const start = new Date(startedAt);
  const end = completedAt ? new Date(completedAt) : new Date();
  const diff = Math.floor((end - start) / 1000);
  if (diff < 60) return diff + ' 秒';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分 ' + (diff % 60) + ' 秒';
  return Math.floor(diff / 3600) + ' 时 ' + Math.floor((diff % 3600) / 60) + ' 分';
}

function renderTaskRunStatusBadge(status) {
  const map = {
    running: ['执行中', 'badge-warning'],
    completed: ['已完成', 'badge-success'],
    failed: ['失败', 'badge-danger'],
    stopped: ['已停止', 'badge-warning'],
    pending: ['等待中', ''],
    queued: ['排队中', '']
  };
  const [label, cls] = map[status] || [status, ''];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderTaskRunTriggerBadge(scheduledJobId) {
  if (scheduledJobId) {
    return '<span class="badge">定时触发</span>';
  }
  return '<span class="badge badge-info">手动触发</span>';
}

function renderTaskRuns() {
  const deptAdmin = isDeptAdmin();
  const runs = state.taskRuns || [];
  const { page, totalPages, total } = state.taskRunsPagination;

  const statusOptions = [
    { value: '', label: '全部状态' },
    { value: 'running', label: '执行中' },
    { value: 'completed', label: '已完成' },
    { value: 'failed', label: '失败' },
    { value: 'stopped', label: '已停止' },
    { value: 'pending', label: '等待中' }
  ];

  const modeOptions = [
    { value: '', label: '全部类型' },
    { value: 'source', label: '寻源打招呼' },
    { value: 'followup', label: '主动沟通拉简历' },
    { value: 'chat', label: '主动沟通' },
    { value: 'download', label: '简历下载' },
    { value: 'sync_jobs', label: '职位同步' }
  ];

  const paginationHtml = totalPages > 1 ? `
    <div class="pagination">
      <button class="button-secondary button-compact" ${page <= 1 ? 'disabled' : ''} onclick="changeTaskRunsPage(${page - 1})">上一页</button>
      <span class="pagination-info">第 ${page} / ${totalPages} 页，共 ${total} 条</span>
      <button class="button-secondary button-compact" ${page >= totalPages ? 'disabled' : ''} onclick="changeTaskRunsPage(${page + 1})">下一页</button>
    </div>
  ` : (total > 0 ? `<div class="pagination"><span class="pagination-info">共 ${total} 条记录</span></div>` : '');

  return `
    <section class="table-card">
      <div class="card-header">
        <div>
          <p class="eyebrow">执行记录</p>
          <h3 class="card-title">任务执行列表</h3>
          <p class="card-subtitle">${deptAdmin ? '查看本部门定时任务与手动任务的执行记录、状态与结果。' : '查看所有定时任务与手动任务的执行记录、状态与结果。'}</p>
        </div>
        <div class="jobs-header-actions">
          <select onchange="changeTaskRunsFilter('status', this.value)" style="margin-right:8px">
            ${statusOptions.map(o => `<option value="${o.value}" ${state.taskRunsFilter.status === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
          <select onchange="changeTaskRunsFilter('mode', this.value)" style="margin-right:8px">
            ${modeOptions.map(o => `<option value="${o.value}" ${state.taskRunsFilter.mode === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
          <button class="button-secondary" onclick="loadTaskRuns()">刷新</button>
        </div>
      </div>
      ${state.taskRunsLoading ? '<div class="empty-state">加载中...</div>' : ''}
      ${!state.taskRunsLoading && runs.length === 0 ? '<div class="empty-state">暂无任务执行记录。</div>' : ''}
      ${!state.taskRunsLoading && runs.length > 0 ? `
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>职位</th>
              <th>任务类型</th>
              <th>触发方式</th>
              <th>状态</th>
              <th>候选人数</th>
              <th>事件数</th>
              <th>开始时间</th>
              <th>耗时</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${runs.map(run => `
              <tr>
                <td>${run.id}</td>
                <td>${escapeHtml(run.job_name || run.job_key || '-')}</td>
                <td>${escapeHtml(formatTaskType(run.mode))}</td>
                <td>${renderTaskRunTriggerBadge(run.scheduled_job_id)}</td>
                <td>${renderTaskRunStatusBadge(run.status)}</td>
                <td>${run.candidate_count || 0}</td>
                <td>${run.event_count || 0}</td>
                <td>${formatDateTime(run.started_at || run.created_at)}</td>
                <td>${formatDuration(run.started_at, run.completed_at)}</td>
                <td>
                  <button class="button-secondary button-compact" onclick="openTaskRunDetail(${run.id})">详情</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${paginationHtml}
      ` : ''}
    </section>
  `;
}

function renderTaskRunDetailModal() {
  if (!state.taskRunDetail.open) return '';

  const { run, events, loading, error } = state.taskRunDetail;

  const eventsHtml = loading
    ? '<div class="empty-state">加载中...</div>'
    : error
      ? `<div class="empty-state">${escapeHtml(error)}</div>`
    : events.length === 0
      ? '<div class="empty-state">暂无执行事件。</div>'
      : `
        <div class="task-run-events-list">
          <table class="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>阶段</th>
                <th>类型</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              ${events.map(evt => `
                <tr>
                  <td style="white-space:nowrap">${formatDateTime(evt.occurredAt)}</td>
                  <td>${escapeHtml(evt.stage || '-')}</td>
                  <td><span class="badge">${escapeHtml(evt.eventType || '-')}</span></td>
                  <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(evt.message || '-')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

  const runInfo = run ? `
    <div class="schedule-form-grid" style="margin-bottom:16px">
      <div class="form-field">
        <span class="form-label">任务 ID</span>
        <div class="schedule-view-value">${run.id || state.taskRunDetail.runId}</div>
      </div>
      <div class="form-field">
        <span class="form-label">任务类型</span>
        <div class="schedule-view-value">${escapeHtml(formatTaskType(run.mode))}</div>
      </div>
      <div class="form-field">
        <span class="form-label">状态</span>
        <div class="schedule-view-value">${renderTaskRunStatusBadge(run.status)}</div>
      </div>
      <div class="form-field">
        <span class="form-label">尝试次数</span>
        <div class="schedule-view-value">${run.attemptCount || 0}</div>
      </div>
      <div class="form-field">
        <span class="form-label">开始时间</span>
        <div class="schedule-view-value">${formatDateTime(run.startedAt)}</div>
      </div>
      <div class="form-field">
        <span class="form-label">完成时间</span>
        <div class="schedule-view-value">${formatDateTime(run.completedAt)}</div>
      </div>
      <div class="form-field">
        <span class="form-label">耗时</span>
        <div class="schedule-view-value">${formatDuration(run.startedAt, run.completedAt)}</div>
      </div>
      <div class="form-field">
        <span class="form-label">创建时间</span>
        <div class="schedule-view-value">${formatDateTime(run.createdAt)}</div>
      </div>
    </div>
  ` : '';

  return `
    <div class="modal-backdrop" onclick="closeTaskRunDetail()">
      <section class="sync-modal schedule-modal" onclick="event.stopPropagation()" style="max-width:900px;max-height:85vh;overflow-y:auto">
        <div class="card-header">
          <div>
            <p class="eyebrow">执行详情</p>
            <h3 class="card-title">任务 #${state.taskRunDetail.runId} 执行记录</h3>
          </div>
          <button class="button-secondary button-muted" onclick="closeTaskRunDetail()">关闭</button>
        </div>
        ${runInfo}
        <div>
          <h4 style="margin:0 0 8px 0;font-size:14px;color:var(--text-secondary,#666)">执行事件 (${events.length})</h4>
          ${eventsHtml}
        </div>
      </section>
    </div>
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
              <p class="card-subtitle job-detail-tip">该内容仅保存在本地，不会被 BOSS 职位同步覆盖；寻源与 followup 沟通时都会作为内部参考带上。</p>
              ${state.jobDetailModal.savingError ? `<div class="inline-status inline-status-error">${escapeHtml(state.jobDetailModal.savingError)}</div>` : ''}
              ${state.jobDetailModal.savingSuccess ? `<div class="inline-status inline-status-success">${escapeHtml(state.jobDetailModal.savingSuccess)}</div>` : ''}
              <textarea
                id="job-custom-requirement-input"
                class="job-detail-textarea"
                placeholder="例如：必须有电销经验；近两年有保险/健康行业背景；优先重庆本地可立即到岗。"
              >${escapeHtml(item.custom_requirement || '')}</textarea>
            </section>
            <section class="job-detail-section">
              <div class="card-header">
                <div>
                  <p class="eyebrow">企业信息参考</p>
                  <h4 class="card-title job-detail-section-title">企业知识库</h4>
                </div>
                <button
                  class="button-secondary"
                  onclick="saveJobEnterpriseKnowledge()"
                  ${state.jobDetailModal.savingKnowledge ? 'disabled' : ''}
                >
                  ${state.jobDetailModal.savingKnowledge ? '保存中...' : '保存知识库'}
                </button>
              </div>
              <p class="card-subtitle job-detail-tip">企业相关信息（如公司介绍、福利政策、工作环境等），大模型回答候选人问题时会作为参考依据。</p>
              ${state.jobDetailModal.savingKnowledgeError ? `<div class="inline-status inline-status-error">${escapeHtml(state.jobDetailModal.savingKnowledgeError)}</div>` : ''}
              ${state.jobDetailModal.savingKnowledgeSuccess ? `<div class="inline-status inline-status-success">${escapeHtml(state.jobDetailModal.savingKnowledgeSuccess)}</div>` : ''}
              <textarea
                id="job-enterprise-knowledge-input"
                class="job-detail-textarea"
                placeholder="例如：公司成立于2014年，是国内领先的AI科技公司；五险一金、带薪年假15天；办公地点在重庆江北区；双休、弹性工作制。"
              >${escapeHtml(item.enterprise_knowledge || '')}</textarea>
            </section>
            <section class="job-detail-section">
              <div class="card-header" style="cursor:pointer" onclick="toggleRecommendFilters()">
                <div>
                  <p class="eyebrow">BOSS 推荐筛选</p>
                  <h4 class="card-title job-detail-section-title">推荐牛人筛选条件</h4>
                </div>
                <span style="font-size:12px;color:var(--text-muted,#999)">${state.jobDetailModal.filtersExpanded ? '▲ 收起' : '▼ 展开'}</span>
              </div>
              <p class="card-subtitle job-detail-tip">与 BOSS 直聘推荐牛人页面筛选一致，寻源时自动应用到推荐页面。</p>
              ${state.jobDetailModal.savingFiltersError ? `<div class="inline-status inline-status-error">${escapeHtml(state.jobDetailModal.savingFiltersError)}</div>` : ''}
              ${state.jobDetailModal.savingFiltersSuccess ? `<div class="inline-status inline-status-success">${escapeHtml(state.jobDetailModal.savingFiltersSuccess)}</div>` : ''}
              ${state.jobDetailModal.filtersExpanded ? renderRecommendFiltersPanel(item) : ''}
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

  if (state.syncModal.showLiveView) {
    return '';
  }

  const taskMeta = getTaskMeta(state.syncModal.taskType);

  const statusMap = {
    starting: '准备启动',
    running: '执行中',
    completed: '执行完成',
    failed: '执行失败',
    stopped: '已手动停止',
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
          <div style="display:flex;gap:8px;align-items:center">
            ${isStoppableTask() && !state.syncModal._stopping && (state.syncModal.status === 'running' || state.syncModal.status === 'starting') ? '<button class="button-secondary button-danger sync-stop-btn" onclick="stopCurrentRun()">停止任务</button>' : ''}
            ${isStoppableTask() && state.syncModal._stopping && (state.syncModal.status === 'running' || state.syncModal.status === 'starting') ? '<button class="button-secondary button-danger sync-stop-btn" disabled style="opacity:0.5;cursor:not-allowed">停止中...</button>' : ''}
            <button class="button-secondary" onclick="closeSyncModal()">关闭</button>
          </div>
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

function getSyncStatusLabel() {
  const statusMap = {
    starting: '准备启动',
    running: '执行中',
    completed: '执行完成',
    failed: '执行失败',
    stopped: '已手动停止',
    idle: '待开始'
  };
  return statusMap[state.syncModal.status] || '处理中';
}

function isRuntimeConsoleStandby() {
  return state.syncModal.taskType === 'browser_live' && !state.syncModal.runId;
}

function getRuntimeConsoleTitle() {
  if (state.syncModal.consoleTitle) {
    return state.syncModal.consoleTitle;
  }
  return liveView.useHrEndpoint ? '我的 BOSS 浏览器' : `实例 #${liveView.instanceId}`;
}

function getRuntimeConsoleTaskLabel() {
  if (isRuntimeConsoleStandby()) {
    return '当前暂无执行任务';
  }

  return getTaskMeta(state.syncModal.taskType).buttonLabel;
}

function getRuntimeConsoleStageLabel() {
  if (isRuntimeConsoleStandby()) {
    return '待机观察';
  }

  const stages = buildSyncStages();
  const activeStage = stages.find((item) => item.active);
  if (activeStage) {
    return activeStage.label;
  }

  const completedStage = [...stages].reverse().find((item) => item.done);
  return completedStage ? `${completedStage.label}（已完成）` : '准备启动';
}

function getRuntimeConsoleLatestEvent() {
  if (state.syncModal.events.length) {
    return state.syncModal.events[state.syncModal.events.length - 1];
  }

  if (isRuntimeConsoleStandby()) {
    return {
      occurredAt: null,
      message: state.syncModal.standbyMessage || '当前为待机视图，任务触发后会在这里显示运行上下文。'
    };
  }

  return {
    occurredAt: state.syncModal.startedAt,
    message: getTaskMeta(state.syncModal.taskType).emptyLogMessage
  };
}

function renderRuntimeTerminalRows(rows) {
  if (!rows.length) {
    return '<div class="runtime-terminal-empty">当前没有更多日志，后续运行节点会在这里出现。</div>';
  }

  return rows.map((event) => `<div class="runtime-terminal-line severity-${escapeHtml(event.severity || 'info')}"><span class="runtime-terminal-time">[${escapeHtml(formatDateTime(event.occurredAt))}]</span><span class="runtime-terminal-label">[${escapeHtml(formatTerminalToken(event.eventType || event.label || 'log'))}]</span><span class="runtime-terminal-message">${escapeHtml(event.message || event.eventType || '无详细说明')}</span></div>`).join('');
}

function formatTerminalToken(value) {
  return String(value || 'info')
    .trim()
    .replace(/\s+/g, '_')
    .toUpperCase();
}

function getRuntimeConsoleRecommendation() {
  if (liveView.error) {
    return '浏览器状态异常，建议先确认页面是否卡住，再决定是否重启浏览器。';
  }

  if (isRuntimeConsoleStandby()) {
    return state.syncModal.standbyMessage || '当前暂无执行任务，可先确认页面状态与登录状态。';
  }

  if (state.syncModal.status === 'failed') {
    return '任务已异常结束，建议先查看页面停留位置，再决定是否重新执行。';
  }

  if (state.syncModal.status === 'stopped') {
    return '任务已停止。若仍需人工处理，可继续点击页面；处理完成后请重新触发任务。';
  }

  if (state.syncModal.status === 'completed') {
    return '任务已完成。建议快速复核页面状态，确认无需进一步人工处理。';
  }

  if (isStoppableTask()) {
    return '如页面异常，可直接点击画面人工处理；确认流程无法继续时再停止任务。';
  }

  return '当前任务进行中，请结合阶段信息与页面状态判断是否需要干预。';
}

function getRuntimeConsoleStatusClass() {
  const classMap = {
    starting: 'is-pending',
    running: 'is-running',
    completed: 'is-completed',
    failed: 'is-failed',
    stopped: 'is-failed',
    idle: 'is-idle'
  };

  return classMap[state.syncModal.status] || 'is-pending';
}

function toggleRuntimeConsoleBrowserFocus() {
  const browserPanel = document.querySelector('#runtime-console-shell .runtime-console-browser');
  if (!browserPanel) {
    return;
  }

  if (!document.fullscreenElement && typeof browserPanel.requestFullscreen === 'function') {
    browserPanel.requestFullscreen().catch(() => {
      state.syncModal.browserFocus = !state.syncModal.browserFocus;
      updateSyncLiveOverlayContent();
    });
    return;
  }

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {
      state.syncModal.browserFocus = false;
      updateSyncLiveOverlayContent();
    });
    return;
  }

  state.syncModal.browserFocus = !state.syncModal.browserFocus;
  updateSyncLiveOverlayContent();
}

document.addEventListener('fullscreenchange', () => {
  const browserPanel = document.querySelector('#runtime-console-shell .runtime-console-browser');
  state.syncModal.browserFocus = Boolean(browserPanel && document.fullscreenElement === browserPanel);
  if (document.getElementById('sync-live-overlay')) {
    updateSyncLiveOverlayContent();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.syncModal.open) { closeSyncModal(); return; }
  if (state.jobDetailModal.open) { closeJobDetailModal(); return; }
  if (state.candidateDetailDrawer.open) { closeCandidateDetailDrawer(); return; }
  if (state.scheduleModal.open) { closeScheduleModal(); return; }
  if (state.taskRunDetail.open) { closeTaskRunDetail(); return; }
  if (state.adminModalOpenId) { closeModal(state.adminModalOpenId); return; }
  const visibleOverlay = document.querySelector('.modal-overlay[style*="flex"]');
  if (visibleOverlay) { visibleOverlay.style.display = 'none'; return; }
  const visibleBackdrop = document.querySelector('.modal-backdrop, .drawer-backdrop');
  if (visibleBackdrop) {
    if (visibleBackdrop.style) {
      visibleBackdrop.style.display = 'none';
    } else if (typeof visibleBackdrop.remove === 'function') {
      visibleBackdrop.remove();
    }
    return;
  }
  const stuckOverlay = document.getElementById('sync-live-overlay');
  if (stuckOverlay) { stuckOverlay.remove(); }
});

function renderSyncLiveOverlay() {
  if (!state.syncModal.open || !state.syncModal.showLiveView) {
    return '';
  }

  return `
    <div id="sync-live-overlay" class="modal-overlay" style="display:flex" onclick="if (event.target === this) closeSyncModal()">
    <div class="runtime-console ${state.syncModal.browserFocus ? 'is-browser-focus' : ''}" id="runtime-console-shell" onclick="event.stopPropagation()">
      <div class="runtime-console-browser">
        <div class="runtime-console-browser-header">
          <div class="runtime-console-browser-copy">
            <p class="eyebrow">${isRuntimeConsoleStandby() ? '浏览器待机视图' : '运行控制台'}</p>
            <h3 class="card-title">${escapeHtml(getRuntimeConsoleTitle())}</h3>
            <div id="live-view-status" class="live-view-status">
              <span class="live-view-info">连接中...</span>
            </div>
          </div>
          <div class="runtime-console-toolbar">
            <span class="runtime-console-status-pill ${getRuntimeConsoleStatusClass()}" id="runtime-console-mode-badge">${escapeHtml(getSyncStatusLabel())}</span>
            <button class="button-secondary" id="runtime-console-focus-btn" onclick="toggleRuntimeConsoleBrowserFocus()">${state.syncModal.browserFocus ? '退出全屏' : '浏览器全屏'}</button>
          </div>
        </div>
        <div class="runtime-console-browser-body">
          <div class="live-view-img-wrapper runtime-console-browser-frame">
            <img id="live-view-img" class="live-view-img" alt="浏览器画面加载中..." style="cursor:crosshair" />
            <div id="live-view-click-indicator" class="live-view-click-indicator"></div>
          </div>
        </div>
        <div class="runtime-console-browser-footer">
          <div class="runtime-console-browser-meta">
            <span class="live-view-hint" id="runtime-console-browser-note">如页面异常，可直接点击画面人工处理；详细日志可按需展开。</span>
            <span class="runtime-console-page-url" id="runtime-console-page-url">等待页面地址...</span>
          </div>
          <div class="runtime-console-browser-actions">
            <button class="button-secondary btn-sm" id="live-view-restart-btn" onclick="restartLiveViewBrowser()">重启浏览器</button>
            <button class="button-secondary btn-sm" onclick="closeSyncModal()">关闭</button>
          </div>
        </div>
      </div>
      <aside class="runtime-console-sidebar" id="runtime-console-sidebar">
          ${renderSyncLiveLogsContent()}
      </aside>
    </div>
    </div>
  `;
}

function hydrateSyncLiveOverlay() {
  const img = document.getElementById('live-view-img');
  if (img && !img.__liveViewClickBound) {
    img.addEventListener('click', handleLiveViewClick);
    img.__liveViewClickBound = true;
  }
  updateLiveViewStatus();
}

function updateSyncLiveOverlayContent() {
  const shell = document.getElementById('runtime-console-shell');
  if (shell) {
    shell.className = `runtime-console ${state.syncModal.browserFocus ? 'is-browser-focus' : ''}`;
  }

  const modeBadge = document.getElementById('runtime-console-mode-badge');
  if (modeBadge) {
    modeBadge.className = `runtime-console-status-pill ${getRuntimeConsoleStatusClass()}`;
    modeBadge.textContent = getSyncStatusLabel();
  }

  const focusBtn = document.getElementById('runtime-console-focus-btn');
  if (focusBtn) {
    focusBtn.textContent = state.syncModal.browserFocus ? '退出全屏' : '浏览器全屏';
  }

  const sidebar = document.getElementById('runtime-console-sidebar');
  if (!sidebar) return;

  sidebar.innerHTML = renderSyncLiveLogsContent();

  const newLogList = sidebar.querySelector('.sync-log-list');
  if (newLogList) {
    newLogList.scrollTop = Math.max(0, newLogList.scrollHeight - newLogList.clientHeight);
  }
}

function renderSyncLiveLogsContent() {
  const taskMeta = getTaskMeta(state.syncModal.taskType);
  const latestEvent = getRuntimeConsoleLatestEvent();
  const isStandby = isRuntimeConsoleStandby();
  const runningState = state.syncModal.status === 'running' || state.syncModal.status === 'starting';
  const logs = state.syncModal.events.length
    ? state.syncModal.events
    : [{
        message: latestEvent.message || taskMeta.emptyLogMessage,
        occurredAt: latestEvent.occurredAt || state.syncModal.startedAt
      }];
  const classifiedLogs = logs.map((event) => classifyRuntimeLogEvent(event));
  const logSummary = summarizeRuntimeLogs(classifiedLogs);
  const logFeed = splitRuntimeLogFeed(classifiedLogs);
  const terminalRows = [...logFeed.stream].reverse();
  const terminalTitle = isStandby
    ? '浏览器待机'
    : `${getRuntimeConsoleTaskLabel()} · 任务 ${state.syncModal.runId || '-'} · ${getSyncStatusLabel()}`;

  return `
    <div class="runtime-console-rail-stack">
      ${state.syncModal.error ? `<div class="inline-status inline-status-error">${escapeHtml(state.syncModal.error)}</div>` : ''}
      <section class="runtime-console-panel runtime-console-panel--logs">
        <div class="runtime-console-panel-head runtime-console-panel-head--logs">
          <div>
            <p class="eyebrow">${isStandby ? '待机输出' : taskMeta.eyebrow}</p>
            <h4 class="card-title">终端日志</h4>
            <p class="card-subtitle runtime-terminal-subtitle">${escapeHtml(terminalTitle)}</p>
          </div>
          <div class="runtime-terminal-actions">
            ${isStoppableTask() && !state.syncModal._stopping && runningState ? '<button class="button-secondary button-danger sync-stop-btn" id="sync-live-stop-btn" onclick="stopCurrentRun()">停止任务</button>' : ''}
            ${isStoppableTask() && state.syncModal._stopping && runningState ? '<button class="button-secondary button-danger sync-stop-btn" id="sync-live-stop-btn" disabled style="opacity:0.5;cursor:not-allowed">停止中...</button>' : ''}
          </div>
        </div>
        <div class="runtime-terminal-meta">
          <span class="runtime-terminal-meta-item">records=${logSummary.totalCount}</span>
          <span class="runtime-terminal-meta-item">status=${escapeHtml(getSyncStatusLabel())}</span>
          ${latestEvent.occurredAt ? `<span class="runtime-terminal-meta-item">last=${escapeHtml(formatDateTime(latestEvent.occurredAt))}</span>` : ''}
          ${logSummary.warningCount ? `<span class="runtime-terminal-meta-item">warn=${logSummary.warningCount}</span>` : ''}
          ${logSummary.errorCount ? `<span class="runtime-terminal-meta-item">error=${logSummary.errorCount}</span>` : ''}
        </div>
        <div class="sync-log-list runtime-terminal">
          ${renderRuntimeTerminalRows(terminalRows)}
        </div>
      </section>
    </div>
  `;
}
