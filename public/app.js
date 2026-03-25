const state = {
  view: 'command',
  summary: null,
  jobs: [],
  candidates: [],
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
    item: null
  }
};

const {
  formatJobStatus,
  getJobStatusBadgeClass,
  isJobActionEnabled
} = window.JobUiHelpers;

const {
  captureSyncLogScrollSnapshot,
  resolveSyncLogScrollTop
} = window.SyncLogScroll;

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
  const [schedules, summary, jobs, candidates] = await Promise.all([
    fetchJson('/api/schedules'),
    fetchJson('/api/dashboard/summary'),
    fetchJson('/api/jobs'),
    fetchJson('/api/candidates')
  ]);

  state.schedules = schedules.items;
  state.summary = summary;
  state.jobs = jobs.items;
  state.candidates = candidates.items;
  render();
}

async function openJobDetailModal(jobKey) {
  state.jobDetailModal = {
    open: true,
    jobKey,
    loading: true,
    error: '',
    item: null
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
    item: null
  };
  render();
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
    const result = await fetchJson(`/api/runs/${state.syncModal.runId}/events?afterId=${state.syncModal.lastEventId}`);
    for (const event of result.items || []) {
      state.syncModal.lastEventId = Math.max(state.syncModal.lastEventId, event.id || 0);
      appendSyncEvent(event);
      applySyncEventStatus(event);
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
  if (event.eventType === 'run_completed') {
    state.syncModal.status = 'completed';
    stopSyncPolling();
    loadData().catch(() => {});
    return;
  }

  if (/failed|error/i.test(event.eventType) || /失败|error/i.test(event.message || '')) {
    state.syncModal.status = 'failed';
    state.syncModal.error = event.message || state.syncModal.error;
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
  return `
    <section class="table-card">
      <div class="card-header">
        <div>
          <p class="eyebrow">候选人管理</p>
          <h3 class="card-title">候选人工作台</h3>
          <p class="card-subtitle">查看候选人所处阶段、简历状态与最近互动记录。</p>
        </div>
        <span class="badge">共 ${state.candidates.length} 人</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>姓名</th>
            <th>职位</th>
            <th>阶段</th>
            <th>简历状态</th>
            <th>索简历次数</th>
            <th>最近入站</th>
            <th>简历路径</th>
          </tr>
        </thead>
        <tbody>
          ${state.candidates.map((candidate) => `
            <tr>
              <td>${candidate.name}<div class="muted">${candidate.boss_encrypt_geek_id}</div></td>
              <td>${candidate.job_name}</td>
              <td>${candidate.lifecycle_status}</td>
              <td>${candidate.resume_state}</td>
              <td>${candidate.resume_request_count}</td>
              <td>${candidate.last_inbound_at || '-'}</td>
              <td>${candidate.resume_path || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
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
  const events = state.syncModal.events;
  const hasRequested = events.some((event) => ['job_sync_requested', 'schedule_triggered'].includes(event.eventType));
  const hasNanobot = events.some((event) => event.eventType === 'nanobot_stream');
  const hasCompleted = state.syncModal.status === 'completed';
  const hasFailed = state.syncModal.status === 'failed';

  return [
    {
      label: '创建执行任务',
      desc: hasRequested ? '已生成 run 并开始跟踪。' : '正在创建任务...',
      active: !hasRequested,
      done: hasRequested
    },
    {
      label: '启动小聘AGENT',
      desc: hasNanobot
        ? '已接收到小聘AGENT实时输出。'
        : (hasCompleted || hasFailed ? '任务已结束，本次未采集到实时流式日志。' : '等待小聘AGENT输出...'),
      active: hasRequested && !hasNanobot && !hasCompleted && !hasFailed,
      done: hasNanobot || hasCompleted || hasFailed
    },
    {
      label: hasFailed ? '执行异常' : '完成执行',
      desc: hasFailed ? (state.syncModal.error || '任务执行出现异常。') : (hasCompleted ? '任务已执行完成。' : '等待最终结果...'),
      active: !hasCompleted && !hasFailed && hasNanobot,
      done: hasCompleted || hasFailed
    }
  ];
}
