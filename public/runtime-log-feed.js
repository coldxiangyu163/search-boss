(function attachRuntimeLogFeed(globalScope) {
  const stageLabels = {
    bootstrap: '任务启动',
    nanobot: '执行输出',
    scheduler: '调度控制',
    sync: '职位同步',
    complete: '完成结果',
    source_loop: '寻源流程',
    followup_loop: '跟进流程',
    deterministic_bootstrap: '上下文准备',
    deterministic_sync: '确定性同步'
  };

  const eventLabels = {
    schedule_triggered: '任务已触发',
    job_sync_requested: '同步已发起',
    nanobot_stream: '实时输出',
    candidate_upserted: '候选人已记录',
    greet_sent: '已发送招呼',
    message_recorded: '消息已写入',
    resume_downloaded: '简历已下载',
    resume_request_sent: '已发送索简历',
    attachment_discovered: '发现附件',
    phase_changed: '阶段切换',
    run_completed: '任务完成',
    run_failed: '任务失败',
    run_stopped: '任务已停止',
    run_manually_stopped: '人工停止',
    source_loop_warning: '运行预警',
    followup_loop_warning: '运行预警',
    source_loop_error: '流程异常',
    followup_loop_error: '流程异常',
    source_loop_failed: '寻源失败',
    followup_loop_failed: '跟进失败',
    source_checkpoint: '寻源检查点',
    followup_checkpoint: '跟进检查点',
    context_snapshot_captured: '已捕获上下文',
    boss_cli_command_started: '命令开始执行',
    boss_cli_command_succeeded: '命令执行成功',
    boss_cli_command_failed: '命令执行失败',
    agent_exit_classified: '执行结果判定'
  };

  function normalize(value) {
    return String(value || '').trim();
  }

  function classifySeverity(eventType = '', message = '') {
    const type = normalize(eventType);
    const text = normalize(message);

    if (type.includes('failed') || type.includes('error') || /^run_failed$/.test(type)) {
      return 'error';
    }

    if (type.includes('warning') || /警告|异常|失败/.test(text)) {
      return 'warning';
    }

    if (['run_completed', 'greet_sent', 'resume_downloaded', 'resume_request_sent', 'candidate_upserted'].includes(type)) {
      return 'success';
    }

    if (['run_stopped', 'run_manually_stopped'].includes(type)) {
      return 'neutral';
    }

    return 'info';
  }

  function isHighlightEvent(eventType = '', severity = 'info') {
    const type = normalize(eventType);
    return severity === 'error'
      || severity === 'warning'
      || ['run_completed', 'run_stopped', 'run_manually_stopped', 'schedule_triggered', 'job_sync_requested', 'phase_changed', 'candidate_upserted', 'greet_sent', 'resume_downloaded', 'resume_request_sent'].includes(type);
  }

  function classifyRuntimeLogEvent(event = {}) {
    const eventType = normalize(event.eventType);
    const message = normalize(event.message) || eventType || '运行事件';
    const severity = classifySeverity(eventType, message);

    return {
      ...event,
      eventType,
      message,
      severity,
      label: eventLabels[eventType] || (severity === 'warning' ? '运行预警' : (severity === 'error' ? '运行异常' : '运行事件')),
      stageLabel: stageLabels[normalize(event.stage)] || normalize(event.stage) || '运行过程',
      isHighlight: isHighlightEvent(eventType, severity)
    };
  }

  function sortByOccurredAtDesc(left, right) {
    return new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime();
  }

  function summarizeRuntimeLogs(events = []) {
    const normalized = events.map(classifyRuntimeLogEvent).sort(sortByOccurredAtDesc);
    const warningCount = normalized.filter((item) => item.severity === 'warning').length;
    const errorCount = normalized.filter((item) => item.severity === 'error').length;
    const highlightCount = normalized.filter((item) => item.isHighlight).length;
    const lastSignal = normalized.find((item) => item.isHighlight) || normalized[0] || null;

    return {
      totalCount: normalized.length,
      warningCount,
      errorCount,
      highlightCount,
      lastSignal
    };
  }

  function splitRuntimeLogFeed(events = []) {
    const stream = events.map(classifyRuntimeLogEvent).sort(sortByOccurredAtDesc);
    const highlights = stream.filter((item) => item.isHighlight);

    return {
      highlights,
      stream
    };
  }

  const api = {
    classifyRuntimeLogEvent,
    summarizeRuntimeLogs,
    splitRuntimeLogFeed
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.RuntimeLogFeed = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
