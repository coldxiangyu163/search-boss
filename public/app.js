const state = {
  view: 'command',
  summary: null,
  jobs: [],
  candidates: [],
  schedules: [],
  syncStatus: ''
};

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

async function syncJobs() {
  const button = document.querySelector('.jobs-header-actions .button-secondary');
  const previousText = button.textContent;

  button.disabled = true;
  button.textContent = '同步中...';
  state.syncStatus = '';
  render();

  try {
    const result = await fetchJson('/api/jobs/sync', { method: 'POST' });
    state.syncStatus = result.message || `已触发职位同步，任务 ${result.runId}`;
    await loadData();
  } catch (error) {
    state.syncStatus = `同步失败：${error.message}`;
    render();
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function render() {
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
    return;
  }

  if (state.view === 'jobs') {
    app.innerHTML = renderJobs();
    return;
  }

  if (state.view === 'candidates') {
    app.innerHTML = renderCandidates();
    return;
  }

  if (state.view === 'automation') {
    app.innerHTML = renderAutomation();
    return;
  }

  app.innerHTML = renderHealth();
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
            <th>候选人</th>
            <th>已打招呼</th>
            <th>已回复</th>
            <th>已下载简历</th>
          </tr>
        </thead>
        <tbody>
          ${state.jobs.map((job) => `
            <tr>
              <td>${job.job_name}<div class="muted">${job.job_key}</div></td>
              <td>${job.city || '-'}</td>
              <td>${job.salary || '-'}</td>
              <td>${job.candidate_count}</td>
              <td>${job.greeted_count}</td>
              <td>${job.responded_count}</td>
              <td>${job.resume_downloaded_count}</td>
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
              <p class="list-desc">补充 nanobot 实际执行与反馈回流。</p>
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
