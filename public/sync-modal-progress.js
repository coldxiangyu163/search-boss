function createSyncModalProgress() {
  return {
    hasRequested: false,
    hasNanobotOutput: false
  };
}

function updateSyncModalProgress(progress, event = {}) {
  const nextProgress = progress || createSyncModalProgress();
  const eventType = event.eventType || '';

  return {
    hasRequested:
      nextProgress.hasRequested || ['job_sync_requested', 'schedule_triggered'].includes(eventType),
    hasNanobotOutput:
      nextProgress.hasNanobotOutput || eventType === 'nanobot_stream'
  };
}

function resolveSyncTerminalStatus(event = {}) {
  const eventType = String(event.eventType || '').trim();

  if (eventType === 'run_completed') {
    return {
      status: 'completed',
      error: ''
    };
  }

  if (['run_failed', 'sync_failed'].includes(eventType)) {
    return {
      status: 'failed',
      error: event.message || ''
    };
  }

  return null;
}

function resolveSyncTerminalStatusFromRun(run = {}) {
  const status = String(run.status || '').trim();

  if (status === 'completed') {
    return {
      status: 'completed',
      error: ''
    };
  }

  if (status === 'failed') {
    return {
      status: 'failed',
      error: run.error || ''
    };
  }

  return null;
}

function buildSyncStages({ runId, status, error, progress }) {
  const resolvedProgress = progress || createSyncModalProgress();
  const hasRequested = Boolean(runId) || resolvedProgress.hasRequested;
  const hasNanobot = resolvedProgress.hasNanobotOutput;
  const hasCompleted = status === 'completed';
  const hasFailed = status === 'failed';

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
      desc: hasFailed ? (error || '任务执行出现异常。') : (hasCompleted ? '任务已执行完成。' : '等待最终结果...'),
      active: !hasCompleted && !hasFailed && hasNanobot,
      done: hasCompleted || hasFailed
    }
  ];
}

if (typeof window !== 'undefined') {
  window.SyncModalProgress = {
    createSyncModalProgress,
    updateSyncModalProgress,
    resolveSyncTerminalStatus,
    resolveSyncTerminalStatusFromRun,
    buildSyncStages
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createSyncModalProgress,
    updateSyncModalProgress,
    resolveSyncTerminalStatus,
    resolveSyncTerminalStatusFromRun,
    buildSyncStages
  };
}
