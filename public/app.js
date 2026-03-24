const state = {
  jobs: [],
  selectedJobId: null,
  selectedRunId: null,
  timeline: [],
  summary: null,
  scheduledJobs: [],
  scheduledJobRuns: [],
  editingScheduledJobId: null,
};

const elements = {
  summaryGrid: document.getElementById("summary-grid"),
  jobsList: document.getElementById("jobs-list"),
  jobCount: document.getElementById("job-count"),
  selectedJobTitle: document.getElementById("selected-job-title"),
  selectedJobBadge: document.getElementById("selected-job-badge"),
  jobDetail: document.getElementById("job-detail"),
  runStatusPill: document.getElementById("run-status-pill"),
  runSummary: document.getElementById("run-summary"),
  timeline: document.getElementById("timeline"),
  candidatesBody: document.getElementById("candidates-body"),
  candidateCount: document.getElementById("candidate-count"),
  syncJobsButton: document.getElementById("sync-jobs-button"),
  refreshButton: document.getElementById("refresh-button"),
  syncStatus: document.getElementById("sync-status"),
  streamStatus: document.getElementById("stream-status"),
  scheduleCount: document.getElementById("schedule-count"),
  scheduleRunCount: document.getElementById("schedule-run-count"),
  scheduleStatus: document.getElementById("schedule-status"),
  scheduleList: document.getElementById("schedule-list"),
  scheduleRuns: document.getElementById("schedule-runs"),
  scheduleForm: document.getElementById("schedule-form"),
  scheduleReset: document.getElementById("schedule-reset"),
  scheduleName: document.getElementById("schedule-name"),
  scheduleJobType: document.getElementById("schedule-job-type"),
  scheduleCron: document.getElementById("schedule-cron"),
  scheduleJobKey: document.getElementById("schedule-job-key"),
  scheduleEnabled: document.getElementById("schedule-enabled"),
};

function escapeHtml(value) {
  return String(value ?? "—")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function renderSummary() {
  const summary = state.summary || {
    totalJobs: 0,
    totalCandidates: 0,
    todayGreetings: 0,
    todayResponses: 0,
    todayResumes: 0,
    statsDate: null,
  };

  const cards = [
    { label: "岗位数", value: summary.totalJobs, meta: "已接入的可管理岗位" },
    { label: "候选人数", value: summary.totalCandidates, meta: "数据库内累计沉淀" },
    { label: "最近招呼数", value: summary.todayGreetings, meta: `统计日期 ${summary.statsDate || "—"}` },
    { label: "简历下载", value: summary.todayResumes, meta: `回复 ${summary.todayResponses || 0} 人` },
  ];

  elements.summaryGrid.innerHTML = cards.map((card) => `
    <article class="summary-card">
      <div class="summary-label">${escapeHtml(card.label)}</div>
      <div class="summary-value">${escapeHtml(card.value)}</div>
      <div class="summary-meta">${escapeHtml(card.meta)}</div>
    </article>
  `).join("");
}

function renderJobs() {
  elements.jobCount.textContent = `${state.jobs.length} jobs`;

  if (state.jobs.length === 0) {
    elements.jobsList.innerHTML = `<div class="empty-state">还没有岗位数据。确认 Chrome 和 nanobot 环境正常后，点击“同步岗位”。</div>`;
    return;
  }

  elements.jobsList.innerHTML = state.jobs.map((job) => `
    <article class="job-card ${job.id === state.selectedJobId ? "active" : ""}" data-job-id="${job.id}">
      <div class="job-title-row">
        <div>
          <h4>${escapeHtml(job.jobName)}</h4>
          <div class="job-subline">${escapeHtml(job.jobKey)}</div>
        </div>
        <span class="status-pill ${escapeHtml(job.latestRunStatus || "neutral")}">${escapeHtml(job.latestRunStatus || "未运行")}</span>
      </div>
      <div class="chip-row">
        <span class="chip">${escapeHtml(job.city || "未配置城市")}</span>
        <span class="chip">${escapeHtml(job.salary || "未配置薪资")}</span>
        <span class="chip">${escapeHtml(job.minDegree || "未配置学历")}</span>
        <span class="chip">${escapeHtml(job.candidateCount)} 位候选人</span>
      </div>
    </article>
  `).join("");

  elements.jobsList.querySelectorAll("[data-job-id]").forEach((node) => {
    node.addEventListener("click", () => {
      selectJob(Number(node.dataset.jobId));
    });
  });
}

function renderJobDetail(job) {
  if (!job) {
    elements.selectedJobTitle.textContent = "尚未选择岗位";
    elements.selectedJobBadge.className = "status-pill neutral";
    elements.selectedJobBadge.textContent = "待选择";
    elements.jobDetail.className = "job-detail empty-state";
    elements.jobDetail.textContent = "请选择左侧岗位，查看筛选条件、启动寻源、并监控执行过程。";
    return;
  }

  elements.selectedJobTitle.textContent = job.jobName;
  elements.selectedJobBadge.className = `status-pill ${job.latestRunStatus || "neutral"}`;
  elements.selectedJobBadge.textContent = job.latestRunStatus || "未运行";
  elements.jobDetail.className = "job-detail";
  elements.jobDetail.innerHTML = `
    <section class="detail-grid">
      <div class="detail-topline">
        <div>
          <p class="section-kicker">岗位档案</p>
          <h3>${escapeHtml(job.jobName)}</h3>
        </div>
        <span class="mono-badge">ID ${escapeHtml(job.id)}</span>
      </div>
      <div class="detail-meta-grid">
        <div class="detail-meta"><strong>岗位 Key</strong><span>${escapeHtml(job.jobKey)}</span></div>
        <div class="detail-meta"><strong>工作城市</strong><span>${escapeHtml(job.city || "未配置")}</span></div>
        <div class="detail-meta"><strong>最低学历</strong><span>${escapeHtml(job.minDegree || "未配置")}</span></div>
        <div class="detail-meta"><strong>候选人数</strong><span>${escapeHtml(job.candidateCount)}</span></div>
      </div>
    </section>

    <section class="detail-grid">
      <div class="section-head">
        <span class="section-kicker">启动寻源</span>
        <h2>执行参数</h2>
      </div>
      <form id="run-form" class="form-grid">
        <label>
          <span class="field-label">最大页数</span>
          <input class="form-input" name="maxPages" type="number" min="1" max="20" value="3">
        </label>
        <label>
          <span class="field-label">自动打招呼</span>
          <select class="form-select" name="autoGreet">
            <option value="true">开启</option>
            <option value="false">关闭</option>
          </select>
        </label>
        <button class="button primary" type="submit">开始寻源</button>
      </form>
      <p class="muted-copy">当前会调用本机 nanobot 去执行 `boss-sourcing` skill；过程输出会流式写入时间线，完成后再把最新数据快照导入数据库。</p>
    </section>
  `;

  elements.jobDetail.querySelector("#run-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await startSourcing(job.id, {
      maxPages: Number(formData.get("maxPages") || 3),
      autoGreet: formData.get("autoGreet") === "true",
    });
  });
}

function renderRunSummary(run) {
  if (!run) {
    elements.runStatusPill.className = "status-pill neutral";
    elements.runStatusPill.textContent = "空闲";
    elements.runSummary.className = "run-summary empty-state";
    elements.runSummary.textContent = "发起寻源后，这里会逐步刷新任务进度。";
    return;
  }

  elements.runStatusPill.className = `status-pill ${run.status || "neutral"}`;
  elements.runStatusPill.textContent = run.status;
  elements.runSummary.className = "run-summary";
  elements.runSummary.innerHTML = `
    <div class="run-summary-grid">
      <div class="run-summary-card"><strong>任务 ID</strong><span>${escapeHtml(run.id)}</span></div>
      <div class="run-summary-card"><strong>已抓取页数</strong><span>${escapeHtml(run.pagesProcessed)}</span></div>
      <div class="run-summary-card"><strong>命中候选人</strong><span>${escapeHtml(run.candidatesMatched)}</span></div>
      <div class="run-summary-card"><strong>已打招呼</strong><span>${escapeHtml(run.greetingsSent)}</span></div>
    </div>
    <div class="muted-copy">开始时间 ${escapeHtml(formatDateTime(run.startedAt))}，结束时间 ${escapeHtml(formatDateTime(run.endedAt))}</div>
  `;
}

function renderTimeline() {
  if (state.timeline.length === 0) {
    elements.timeline.innerHTML = `<div class="empty-state">还没有任务事件。</div>`;
    return;
  }

  elements.timeline.innerHTML = state.timeline.slice().reverse().map((event) => `
    <article class="timeline-item">
      <div class="timeline-main">
        <div>
          <div class="timeline-title">${escapeHtml(event.message)}</div>
          <div class="timeline-meta">${escapeHtml(formatDateTime(event.createdAt))}</div>
        </div>
        <div class="timeline-stage">${escapeHtml(event.stage)}</div>
      </div>
      <div class="timeline-progress"><span style="width:${Math.max(0, Math.min(100, Number(event.progressPercent ?? 0)))}%"></span></div>
    </article>
  `).join("");
}

function renderCandidates(candidates) {
  elements.candidateCount.textContent = `${candidates.length} candidates`;
  if (candidates.length === 0) {
    elements.candidatesBody.innerHTML = `<tr><td colspan="7" class="empty-state">此岗位还没有候选人数据。</td></tr>`;
    return;
  }

  elements.candidatesBody.innerHTML = candidates.map((candidate) => `
    <tr>
      <td>${escapeHtml(candidate.name)}</td>
      <td>${escapeHtml(candidate.education || "—")}</td>
      <td>${escapeHtml(candidate.experience || "—")}</td>
      <td>${escapeHtml(candidate.city || "—")}</td>
      <td>${escapeHtml(candidate.position || "—")}</td>
      <td><span class="candidate-status">${escapeHtml(candidate.status)}</span></td>
      <td>${escapeHtml(formatDateTime(candidate.greetedAt))}</td>
    </tr>
  `).join("");
}

function renderScheduledJobs() {
  elements.scheduleCount.textContent = `${state.scheduledJobs.length} schedules`;

  if (state.scheduledJobs.length === 0) {
    elements.scheduleList.innerHTML = `<div class="empty-state">还没有定时任务。可以先建一个岗位同步或简历跟进任务。</div>`;
    return;
  }

  elements.scheduleList.innerHTML = state.scheduledJobs.map((job) => `
    <article class="job-card ${job.id === state.editingScheduledJobId ? "active" : ""}" data-schedule-id="${job.id}">
      <div class="job-title-row">
        <div>
          <h4>${escapeHtml(job.name)}</h4>
          <div class="job-subline">${escapeHtml(job.jobType)} · ${escapeHtml(job.cronExpression)}</div>
        </div>
        <span class="status-pill ${job.lastRunStatus || (job.isEnabled ? "running" : "neutral")}">${escapeHtml(job.isEnabled ? "启用中" : "已停用")}</span>
      </div>
      <div class="chip-row">
        <span class="chip">${escapeHtml(job.payload?.jobKey || "全局任务")}</span>
        <span class="chip">${escapeHtml(job.lastRunStatus || "未执行")}</span>
        <span class="chip">${escapeHtml(formatDateTime(job.lastRunAt))}</span>
      </div>
      <div class="schedule-card-actions">
        <button class="button ghost small" type="button" data-action="edit" data-schedule-id="${job.id}">编辑</button>
        <button class="button ghost small" type="button" data-action="toggle" data-schedule-id="${job.id}">${job.isEnabled ? "停用" : "启用"}</button>
        <button class="button primary small" type="button" data-action="run" data-schedule-id="${job.id}">立即执行</button>
        <button class="button ghost small danger" type="button" data-action="delete" data-schedule-id="${job.id}">删除</button>
      </div>
    </article>
  `).join("");

  elements.scheduleList.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.scheduleId);
      const action = button.dataset.action;
      const job = state.scheduledJobs.find((item) => item.id === id);
      if (!job) return;

      if (action === "edit") {
        fillScheduleForm(job);
      } else if (action === "toggle") {
        try {
          await request(`/api/scheduled-jobs/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isEnabled: !job.isEnabled }),
          });
          elements.scheduleStatus.textContent = `任务 ${job.name} 已${job.isEnabled ? "停用" : "启用"}。`;
          await refreshScheduledJobs();
        } catch (error) {
          elements.scheduleStatus.textContent = error.message;
        }
      } else if (action === "run") {
        try {
          elements.scheduleStatus.textContent = `已提交任务 ${job.name} 的立即执行。`;
          await request(`/api/scheduled-jobs/${id}/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          await refreshScheduledJobRuns();
        } catch (error) {
          elements.scheduleStatus.textContent = error.message;
        }
      } else if (action === "delete") {
        if (!window.confirm(`确认删除定时任务“${job.name}”吗？`)) {
          return;
        }

        try {
          await request(`/api/scheduled-jobs/${id}`, {
            method: "DELETE",
          });
          if (state.editingScheduledJobId === id) {
            resetScheduleForm();
          }
          elements.scheduleStatus.textContent = `任务 ${job.name} 已删除。`;
          await refreshScheduledJobs();
          await refreshScheduledJobRuns();
        } catch (error) {
          elements.scheduleStatus.textContent = error.message;
        }
      }
    });
  });
}

function renderScheduledJobRuns() {
  elements.scheduleRunCount.textContent = `${state.scheduledJobRuns.length} runs`;

  if (state.scheduledJobRuns.length === 0) {
    elements.scheduleRuns.innerHTML = `<div class="empty-state">还没有调度执行记录。</div>`;
    return;
  }

  elements.scheduleRuns.innerHTML = state.scheduledJobRuns.map((run) => `
    <article class="timeline-item">
      <div class="timeline-main">
        <div>
          <div class="timeline-title">${escapeHtml(run.status)} · ${escapeHtml(run.triggerType)}</div>
          <div class="timeline-meta">${escapeHtml(formatDateTime(run.startedAt || run.createdAt))}</div>
        </div>
        <div class="timeline-stage">${escapeHtml(run.scheduledJobId)}</div>
      </div>
      <div class="timeline-meta">${escapeHtml(run.summary || run.errorMessage || "等待 worker 处理")}</div>
    </article>
  `).join("");
}

function resetScheduleForm() {
  state.editingScheduledJobId = null;
  elements.scheduleName.value = "";
  elements.scheduleJobType.value = "sync_jobs";
  elements.scheduleCron.value = "0 9 * * *";
  elements.scheduleJobKey.value = "";
  elements.scheduleEnabled.checked = true;
  syncScheduleTypeState();
}

function fillScheduleForm(job) {
  state.editingScheduledJobId = job.id;
  elements.scheduleName.value = job.name;
  elements.scheduleJobType.value = job.jobType;
  elements.scheduleCron.value = job.cronExpression;
  elements.scheduleJobKey.value = job.payload?.jobKey || "";
  elements.scheduleEnabled.checked = job.isEnabled;
  syncScheduleTypeState();
}

function syncScheduleTypeState() {
  const requiresJobKey = elements.scheduleJobType.value === "followup";
  elements.scheduleJobKey.disabled = !requiresJobKey;
  elements.scheduleJobKey.placeholder = requiresJobKey ? "跟进任务必须指定岗位 Key" : "岗位同步任务无需填写";
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error || response.statusText);
  }
  return response.json();
}

async function refreshSummary() {
  state.summary = await request("/api/dashboard/summary");
  renderSummary();
}

async function refreshScheduledJobs() {
  state.scheduledJobs = await request("/api/scheduled-jobs");
  renderScheduledJobs();
}

async function refreshScheduledJobRuns() {
  state.scheduledJobRuns = await request("/api/scheduled-job-runs");
  renderScheduledJobRuns();
}

async function refreshJobs() {
  state.jobs = await request("/api/jobs");
  if (!state.selectedJobId && state.jobs[0]) {
    state.selectedJobId = state.jobs[0].id;
  }
  if (state.selectedJobId && !state.jobs.find((job) => job.id === state.selectedJobId)) {
    state.selectedJobId = state.jobs[0]?.id ?? null;
  }
  renderJobs();
  await selectJob(state.selectedJobId, { silentIfMissing: true });
}

async function selectJob(jobId, options = {}) {
  state.selectedJobId = jobId;
  const job = state.jobs.find((item) => item.id === jobId);
  renderJobs();
  renderJobDetail(job || null);

  if (!job) {
    if (!options.silentIfMissing) {
      renderCandidates([]);
      renderRunSummary(null);
      state.timeline = [];
      renderTimeline();
    }
    return;
  }

  const candidates = await request(`/api/jobs/${jobId}/candidates`);
  renderCandidates(candidates);

  if (job.latestRunId) {
    state.selectedRunId = job.latestRunId;
    await refreshRun(job.latestRunId);
  } else {
    state.selectedRunId = null;
    state.timeline = [];
    renderTimeline();
    renderRunSummary(null);
  }
}

async function refreshRun(runId) {
  const [run, events] = await Promise.all([
    request(`/api/sourcing-runs/${runId}`),
    request(`/api/sourcing-runs/${runId}/events`),
  ]);
  renderRunSummary(run);
  state.timeline = events;
  renderTimeline();
}

async function syncJobs() {
  elements.syncStatus.textContent = "正在同步岗位...";
  try {
    const payload = await request("/api/boss/jobs/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    elements.syncStatus.textContent = `同步完成，已导入岗位 ${payload.jobsImported} 条、候选人 ${payload.candidatesImported} 条。`;
    await refreshSummary();
    await refreshJobs();
  } catch (error) {
    elements.syncStatus.textContent = error.message;
  }
}

async function startSourcing(jobId, options) {
  elements.syncStatus.textContent = `岗位 ${jobId} 寻源任务已提交。`;
  const run = await request(`/api/jobs/${jobId}/sourcing-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      maxPages: options.maxPages,
      autoGreet: options.autoGreet,
    }),
  });

  state.selectedRunId = run.id;
  renderRunSummary(run);
  state.timeline = [];
  renderTimeline();
  await refreshJobs();
}

function connectStream() {
  const stream = new EventSource("/api/stream");

  stream.addEventListener("connected", () => {
    elements.streamStatus.textContent = "SSE 已连接";
  });

  stream.addEventListener("heartbeat", () => {
    elements.streamStatus.textContent = "SSE 连接稳定";
  });

  stream.addEventListener("run_event", async (event) => {
    const payload = JSON.parse(event.data);
    elements.streamStatus.textContent = `收到任务事件 ${payload.eventType}`;

    if (state.selectedRunId && payload.runId === state.selectedRunId) {
      state.timeline.push(payload);
      renderTimeline();
      await refreshRun(state.selectedRunId);
    }

    await refreshSummary();
    await refreshJobs();
  });

  stream.addEventListener("boss_jobs_synced", async () => {
    elements.streamStatus.textContent = "岗位同步事件已接收";
    await refreshSummary();
    await refreshJobs();
  });

  stream.addEventListener("scheduled_job_run", async () => {
    elements.streamStatus.textContent = "收到定时任务执行更新";
    await refreshScheduledJobs();
    await refreshScheduledJobRuns();
  });

  stream.addEventListener("scheduler_reloaded", async () => {
    elements.streamStatus.textContent = "定时调度已重载";
    await refreshScheduledJobs();
  });

  stream.onerror = () => {
    elements.streamStatus.textContent = "SSE 已断开，正在等待浏览器自动重连";
  };
}

elements.syncJobsButton.addEventListener("click", syncJobs);
elements.refreshButton.addEventListener("click", async () => {
  await refreshSummary();
  await refreshJobs();
  await refreshScheduledJobs();
  await refreshScheduledJobRuns();
});

elements.scheduleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    name: elements.scheduleName.value.trim(),
    jobType: elements.scheduleJobType.value,
    cronExpression: elements.scheduleCron.value.trim(),
    payload: elements.scheduleJobType.value === "followup" && elements.scheduleJobKey.value.trim()
      ? { jobKey: elements.scheduleJobKey.value.trim() }
      : {},
    isEnabled: elements.scheduleEnabled.checked,
  };

  if (!payload.name || !payload.cronExpression) {
    elements.scheduleStatus.textContent = "任务名称和 cron 表达式必填。";
    return;
  }

  if (payload.jobType === "followup" && !payload.payload.jobKey) {
    elements.scheduleStatus.textContent = "简历跟进任务必须指定岗位 Key。";
    return;
  }

  try {
    if (state.editingScheduledJobId) {
      await request(`/api/scheduled-jobs/${state.editingScheduledJobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      elements.scheduleStatus.textContent = "定时任务已更新。";
    } else {
      await request("/api/scheduled-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      elements.scheduleStatus.textContent = "定时任务已创建。";
    }

    resetScheduleForm();
    await refreshScheduledJobs();
    await refreshScheduledJobRuns();
  } catch (error) {
    elements.scheduleStatus.textContent = error.message;
  }
});

elements.scheduleReset.addEventListener("click", () => {
  resetScheduleForm();
  elements.scheduleStatus.textContent = "已切换到新建模式。";
});

elements.scheduleJobType.addEventListener("change", syncScheduleTypeState);

await refreshSummary();
await refreshJobs();
await refreshScheduledJobs();
await refreshScheduledJobRuns();
resetScheduleForm();
connectStream();
