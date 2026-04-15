(function initAutomationScheduleUx(globalScope) {
  const TASK_SPECIFIC_KEYS = ['targetCount', 'recommendTab', 'maxThreads', 'interactionTypes'];

  const PACE_OPTIONS = [
    { value: 'conservative', label: '保守' },
    { value: 'standard', label: '标准' },
    { value: 'aggressive', label: '激进' },
    { value: 'custom', label: '已自定义' }
  ];

  const PRESET_CONFIG = {
    source: {
      conservative: {
        priority: 7,
        cooldownMinutes: 180,
        dailyMaxRuns: 3,
        payload: {
          targetCount: 3,
          recommendTab: 'default'
        }
      },
      standard: {
        priority: 5,
        cooldownMinutes: 60,
        dailyMaxRuns: 0,
        payload: {
          targetCount: 5,
          recommendTab: 'default'
        }
      },
      aggressive: {
        priority: 3,
        cooldownMinutes: 20,
        dailyMaxRuns: 0,
        payload: {
          targetCount: 10,
          recommendTab: 'latest'
        }
      }
    },
    followup: {
      conservative: {
        priority: 7,
        cooldownMinutes: 180,
        dailyMaxRuns: 3,
        payload: {
          maxThreads: 10,
          interactionTypes: ['request_resume']
        }
      },
      standard: {
        priority: 5,
        cooldownMinutes: 60,
        dailyMaxRuns: 0,
        payload: {
          maxThreads: 20,
          interactionTypes: ['request_resume']
        }
      },
      aggressive: {
        priority: 3,
        cooldownMinutes: 20,
        dailyMaxRuns: 0,
        payload: {
          maxThreads: 30,
          interactionTypes: ['request_resume', 'exchange_phone', 'exchange_wechat']
        }
      }
    }
  };

  function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizePositiveInt(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
  }

  function normalizeNonNegativeInt(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
  }

  function sanitizeInteractionTypes(value) {
    const allowed = ['request_resume', 'exchange_phone', 'exchange_wechat'];
    const list = Array.isArray(value)
      ? value.filter((item, index) => allowed.includes(item) && value.indexOf(item) === index)
      : [];
    return list.length ? list : ['request_resume'];
  }

  function getPresetConfig(taskType, pace = 'standard') {
    const taskPresets = PRESET_CONFIG[taskType] || PRESET_CONFIG.source;
    return taskPresets[pace] || taskPresets.standard;
  }

  function sanitizePayloadByTaskType(taskType, payload = {}) {
    const sourcePayload = payload && typeof payload === 'object' ? { ...payload } : {};

    if (taskType === 'source') {
      delete sourcePayload.maxThreads;
      delete sourcePayload.interactionTypes;
      sourcePayload.targetCount = normalizePositiveInt(sourcePayload.targetCount, 5);
      sourcePayload.recommendTab = sourcePayload.recommendTab === 'latest' ? 'latest' : 'default';
      return sourcePayload;
    }

    delete sourcePayload.targetCount;
    delete sourcePayload.recommendTab;
    sourcePayload.maxThreads = normalizePositiveInt(sourcePayload.maxThreads, 20);
    sourcePayload.interactionTypes = sanitizeInteractionTypes(sourcePayload.interactionTypes);
    return sourcePayload;
  }

  function presetToRaw({ taskType, pace = 'standard' }) {
    return cloneValue(getPresetConfig(taskType, pace));
  }

  function rawToPace({ taskType, priority, cooldownMinutes, dailyMaxRuns }) {
    const taskPresets = PRESET_CONFIG[taskType] || PRESET_CONFIG.source;
    const normalized = {
      priority: normalizePositiveInt(priority, 5),
      cooldownMinutes: normalizePositiveInt(cooldownMinutes, 60),
      dailyMaxRuns: normalizeNonNegativeInt(dailyMaxRuns, 0)
    };

    for (const pace of ['conservative', 'standard', 'aggressive']) {
      const preset = taskPresets[pace];
      if (
        normalized.priority === preset.priority
        && normalized.cooldownMinutes === preset.cooldownMinutes
        && normalized.dailyMaxRuns === preset.dailyMaxRuns
      ) {
        return pace;
      }
    }

    return 'custom';
  }

  function formatPaceLabel(pace) {
    return PACE_OPTIONS.find((item) => item.value === pace)?.label || '标准';
  }

  function formatInteractionTypes(types) {
    const labelMap = {
      request_resume: '求简历',
      exchange_phone: '换电话',
      exchange_wechat: '换微信'
    };
    return sanitizeInteractionTypes(types).map((item) => labelMap[item] || item).join('、');
  }

  function buildSummaryLabel({ taskType, pace, payload = {} }) {
    const label = formatPaceLabel(pace);
    const normalizedPayload = sanitizePayloadByTaskType(taskType, payload);

    if (taskType === 'source') {
      return `${label} · 打招呼 ${normalizedPayload.targetCount} 人 · ${normalizedPayload.recommendTab === 'latest' ? '最新推荐' : '默认推荐'}`;
    }

    return `${label} · 处理 ${normalizedPayload.maxThreads} 人 · ${formatInteractionTypes(normalizedPayload.interactionTypes)}`;
  }

  function pickNonTaskPayload(payload = {}) {
    const cleanPayload = payload && typeof payload === 'object' ? { ...payload } : {};
    for (const key of TASK_SPECIFIC_KEYS) {
      delete cleanPayload[key];
    }
    return cleanPayload;
  }

  const api = {
    PACE_OPTIONS,
    presetToRaw,
    rawToPace,
    formatPaceLabel,
    sanitizePayloadByTaskType,
    buildSummaryLabel,
    formatInteractionTypes,
    pickNonTaskPayload
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.AutomationScheduleUx = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
