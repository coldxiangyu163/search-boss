class SourceLoopService {
  constructor({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount = 5,
    maxSkips = 30,
    candidateDelayMin = 2_000,
    candidateDelayMax = 5_000
  }) {
    this.bossCliRunner = bossCliRunner;
    this.agentService = agentService;
    this.llmEvaluator = llmEvaluator;
    this.targetCount = targetCount;
    this.maxSkips = maxSkips;
    this.candidateDelayMin = candidateDelayMin;
    this.candidateDelayMax = candidateDelayMax;
  }

  async run({ runId, jobKey }) {
    const stats = {
      greeted: 0,
      skipped: 0,
      alreadyChatting: 0,
      errors: 0,
      totalEvaluated: 0
    };

    const jobContext = await this.agentService._getJobNanobotContext(jobKey);
    const jobRequirement = buildJobRequirementText(jobContext);
    const customRequirement = jobContext.customRequirement || null;

    await this.#recordEvent(runId, {
      eventId: `source-loop-start:${runId}`,
      eventType: 'source_loop_started',
      stage: 'source_loop',
      message: 'deterministic source loop started',
      payload: { targetCount: this.targetCount, jobKey, mode: 'deterministic' }
    });

    // Phase 1: Bind browser target
    let bindResult;
    try {
      bindResult = await this.bossCliRunner.bindTarget({
        runId,
        mode: 'source',
        jobKey,
        jobId: jobContext.bossEncryptJobId || null
      });
    } catch (error) {
      await this.#failRun(runId, `browser_bind_failed:${error.message}`, stats);
      return { ok: false, stats, reason: 'browser_bind_failed' };
    }

    await this.#recordEvent(runId, {
      eventId: `source-loop-bound:${runId}`,
      eventType: 'phase_changed',
      stage: 'source_loop',
      message: 'target bound for source loop',
      payload: {
        phase: 'target_bound',
        targetId: bindResult?.session?.targetId || null
      }
    });

    // Phase 1b: Bring tab to front to prevent Chrome background throttling
    try {
      await this.bossCliRunner.bringToFront({ runId });
    } catch (error) {
      // Non-fatal
    }

    // Phase 1c: Navigate to recommend page if not already there
    try {
      const targetInfo = await this.bossCliRunner.inspectTarget({ runId });
      const currentUrl = targetInfo?.currentUrl || '';
      if (!currentUrl.includes('/web/chat/recommend')) {
        await this.bossCliRunner.navigateTo({ runId, url: 'https://www.zhipin.com/web/chat/recommend' });
      }
    } catch (error) {
      // Non-fatal: proceed and let inspectRecommendState detect the problem
    }

    // Phase 2: Wait for recommend iframe to load (poll up to 10s)
    const stateDeadline = Date.now() + 10_000;
    let iframeReady = false;
    while (Date.now() < stateDeadline) {
      try {
        const state = await this.bossCliRunner.inspectRecommendState({ runId });
        if (state?.ok) { iframeReady = true; break; }
      } catch (error) {
        // retry
      }
      await new Promise((r) => setTimeout(r, 1_500));
    }
    if (!iframeReady) {
      await this.#failRun(runId, 'recommend_state_failed:iframe_not_loaded_after_polling', stats);
      return { ok: false, stats, reason: 'recommend_state_unavailable' };
    }

    // Phase 2b: Select the correct job in recommend page
    try {
      const selectResult = await this.bossCliRunner.selectRecommendJob({ runId, jobName: jobContext.jobName });
      if (!selectResult.alreadySelected) {
        await new Promise((r) => setTimeout(r, 3_000));
      }
    } catch (error) {
      await this.#failRun(runId, `recommend_job_select_failed:${error.message}`, stats);
      return { ok: false, stats, reason: 'recommend_job_select_failed' };
    }

    // Phase 3: Read candidate list and evaluate each via LLM, greet through popup
    let listResult;
    try {
      listResult = await this.bossCliRunner.inspectRecommendList({ runId, limit: this.targetCount + this.maxSkips });
    } catch (error) {
      await this.#failRun(runId, `recommend_list_failed:${error.message}`, stats);
      return { ok: false, stats, reason: 'recommend_list_unavailable' };
    }

    const candidates = listResult.candidates || [];
    if (!candidates.length) {
      await this.#failRun(runId, 'recommend_list_empty', stats);
      return { ok: false, stats, reason: 'recommend_list_empty' };
    }

    for (const candidate of candidates) {
      if (stats.greeted >= this.targetCount) break;
      if ((stats.skipped + stats.alreadyChatting + stats.errors) >= this.maxSkips) break;

      if (stats.totalEvaluated > 0) {
        const delayMs = this.candidateDelayMin + Math.random() * (this.candidateDelayMax - this.candidateDelayMin);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      await this.#processCandidate({
        runId,
        jobKey,
        jobRequirement,
        customRequirement,
        candidate,
        stats
      });

      stats.totalEvaluated += 1;

      await this.#recordEvent(runId, {
        eventId: `source-loop-checkpoint:${runId}:${stats.totalEvaluated}`,
        eventType: 'source_checkpoint',
        stage: 'source_loop',
        message: `checkpoint after candidate ${stats.totalEvaluated}`,
        payload: { ...stats }
      });
    }

    // Phase 4: Complete run
    const summary = {
      targetCount: this.targetCount,
      achievedCount: stats.greeted,
      ...stats
    };

    if (stats.greeted < this.targetCount) {
      const nonGreeted = stats.skipped + stats.alreadyChatting + stats.errors;
      summary.reason = nonGreeted >= this.maxSkips
        ? 'max_skips_reached'
        : 'candidate_pool_exhausted';
    }

    await this.#recordEvent(runId, {
      eventId: `source-loop-done:${runId}`,
      eventType: 'source_loop_completed',
      stage: 'source_loop',
      message: 'deterministic source loop finished',
      payload: summary
    });

    await this.agentService.completeRun({
      runId,
      payload: summary
    });

    return { ok: true, stats: summary };
  }

  async #processCandidate({ runId, jobKey, jobRequirement, customRequirement, candidate, stats }) {
    const bossEncryptGeekId = candidate.geekId;
    const candidateText = candidate.text || '';
    const candidateName = candidateText.replace(/^\d+-\d+K\s*/, '').split(/\s/)[0] || '';

    if (!bossEncryptGeekId) {
      stats.errors += 1;
      return;
    }

    await this.#recordEvent(runId, {
      eventId: `source-loop-card-read:${runId}:${bossEncryptGeekId}`,
      eventType: 'candidate_detail_read',
      stage: 'source_loop',
      message: `read card: ${candidateName}`,
      payload: {
        bossEncryptGeekId,
        candidateName,
        cardTextLength: candidateText.length,
        alreadyChatting: candidate.alreadyChatting || false
      }
    });

    // Already chatting detection from button text
    if (candidate.alreadyChatting) {
      stats.alreadyChatting += 1;
      await this.#recordEvent(runId, {
        eventId: `source-loop-already:${runId}:${bossEncryptGeekId}`,
        eventType: 'candidate_already_chatting',
        stage: 'source_loop',
        message: `already chatting: ${candidateName}`,
        payload: { bossEncryptGeekId, candidateName }
      });
      return;
    }

    // DB dedup
    try {
      const existing = await this.agentService.findLatestCandidateByGeekId(bossEncryptGeekId);
      if (existing && existing.lifecycleStatus && existing.lifecycleStatus !== 'discovered') {
        stats.alreadyChatting += 1;
        await this.#recordEvent(runId, {
          eventId: `source-loop-dedup:${runId}:${bossEncryptGeekId}`,
          eventType: 'candidate_already_chatting',
          stage: 'source_loop',
          message: `db dedup: ${candidateName} already ${existing.lifecycleStatus}`,
          payload: { bossEncryptGeekId, candidateName, status: existing.lifecycleStatus }
        });
        return;
      }
    } catch (error) {
      // Non-fatal
    }

    // LLM evaluation with card text
    let decision;
    try {
      decision = await this.llmEvaluator.evaluateCandidate({
        jobRequirement,
        candidateDetail: { name: candidateName, detailText: candidateText },
        customRequirement
      });
    } catch (error) {
      stats.errors += 1;
      decision = { action: 'skip', tier: 'C', reason: `llm_error:${error.message}`, facts: {} };
    }

    // Record LLM analysis in event log
    await this.#recordEvent(runId, {
      eventId: `source-loop-llm:${runId}:${bossEncryptGeekId}`,
      eventType: 'candidate_evaluated',
      stage: 'source_loop',
      message: `LLM ${decision.action}: ${candidateName} [${decision.tier}] ${decision.reason}`,
      payload: {
        bossEncryptGeekId,
        candidateName,
        action: decision.action,
        tier: decision.tier,
        reason: decision.reason,
        facts: decision.facts,
        cardTextPreview: candidateText.slice(0, 500)
      }
    });

    // Write candidate record
    try {
      await this.agentService.upsertCandidate({
        runId,
        eventId: `source-loop-candidate:${runId}:${bossEncryptGeekId}`,
        occurredAt: new Date().toISOString(),
        jobKey,
        bossEncryptGeekId,
        name: candidateName,
        status: decision.action === 'greet' ? 'greeted' : 'discovered',
        metadata: {
          decision: decision.action,
          priority: decision.tier,
          facts: decision.facts,
          reasoning: decision.reason,
          evaluationMode: 'list_popup_loop'
        }
      });
    } catch (error) {
      // Non-fatal
    }

    // Execute greet (via popup) or skip
    if (decision.action === 'greet') {
      const greetResult = await this.#executeGreetViaPopup({
        runId,
        jobKey,
        bossEncryptGeekId,
        candidateName,
        candidate,
        stats
      });

      if (greetResult.greeted) {
        stats.greeted += 1;
      } else if (greetResult.alreadyChatting) {
        stats.alreadyChatting += 1;
      } else {
        stats.errors += 1;
      }
    } else {
      stats.skipped += 1;
      await this.#recordEvent(runId, {
        eventId: `source-loop-skip:${runId}:${bossEncryptGeekId}`,
        eventType: 'candidate_skipped',
        stage: 'source_loop',
        message: `skipped: ${decision.reason}`,
        payload: { bossEncryptGeekId, candidateName, tier: decision.tier, reason: decision.reason }
      });
    }
  }

  async #executeGreetViaPopup({ runId, jobKey, bossEncryptGeekId, candidateName, candidate, stats }) {
    // Try coordinate click on the card's greet button first (list mode)
    if (candidate?.greetX && candidate?.greetY) {
      try {
        await this.bossCliRunner.clickRecommendGreetByCoords({
          runId,
          x: candidate.greetX,
          y: candidate.greetY
        });
      } catch (error) {
        await this.#recordEvent(runId, {
          eventId: `source-loop-greet-error:${runId}:${bossEncryptGeekId}`,
          eventType: 'source_loop_error',
          stage: 'source_loop',
          message: `greet click failed: ${error.message}`,
          payload: { error: error.message, bossEncryptGeekId }
        });
        return { greeted: false, alreadyChatting: false };
      }
    } else {
      await this.#recordEvent(runId, {
        eventId: `source-loop-greet-error:${runId}:${bossEncryptGeekId}`,
        eventType: 'source_loop_error',
        stage: 'source_loop',
        message: 'no greet button coordinates',
        payload: { bossEncryptGeekId }
      });
      return { greeted: false, alreadyChatting: false };
    }

    // Record greet action
    const dedupeKey = `greet:${jobKey}:${bossEncryptGeekId}`;
    try {
      await this.agentService.recordAction({
        runId,
        eventId: `source-loop-greet:${runId}:${bossEncryptGeekId}`,
        occurredAt: new Date().toISOString(),
        actionType: 'greet_sent',
        dedupeKey,
        jobKey,
        bossEncryptGeekId,
        payload: { candidateName, source: 'list_popup_loop' }
      });
    } catch (error) {
      // Non-fatal
    }

    await this.#recordEvent(runId, {
      eventId: `source-loop-greeted:${runId}:${bossEncryptGeekId}`,
      eventType: 'greet_sent',
      stage: 'source_loop',
      message: `greeted: ${candidateName}`,
      payload: { bossEncryptGeekId, candidateName, dedupeKey }
    });

    return { greeted: true, alreadyChatting: false };
  }

  async #failRun(runId, message, stats) {
    await this.#recordEvent(runId, {
      eventId: `source-loop-fail:${runId}`,
      eventType: 'source_loop_failed',
      stage: 'source_loop',
      message,
      payload: { ...stats }
    });

    await this.agentService.failRun({
      runId,
      message,
      payload: {
        targetCount: this.targetCount,
        achievedCount: stats.greeted,
        ...stats
      }
    });
  }

  async #recordEvent(runId, { eventId, eventType, stage, message, payload }) {
    try {
      await this.agentService.recordRunEvent({
        runId,
        eventId,
        occurredAt: new Date().toISOString(),
        eventType,
        stage,
        message,
        payload
      });
    } catch (error) {
      // Event recording failure is non-fatal
    }
  }
}

function buildJobRequirementText(jobContext) {
  const parts = [];

  if (jobContext.jobName) {
    parts.push(`岗位名称：${jobContext.jobName}`);
  }
  if (jobContext.city) {
    parts.push(`工作城市：${jobContext.city}`);
  }
  if (jobContext.salary) {
    parts.push(`薪资范围：${jobContext.salary}`);
  }
  if (jobContext.jdText) {
    parts.push(`岗位描述：${jobContext.jdText.slice(0, 500)}`);
  }
  if (jobContext.customRequirement) {
    parts.push(`特殊要求：${jobContext.customRequirement}`);
  }

  return parts.join('\n') || '(无岗位信息)';
}

module.exports = {
  SourceLoopService
};
