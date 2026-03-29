class SourceLoopService {
  constructor({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount = 5,
    maxSkips = 30
  }) {
    this.bossCliRunner = bossCliRunner;
    this.agentService = agentService;
    this.llmEvaluator = llmEvaluator;
    this.targetCount = targetCount;
    this.maxSkips = maxSkips;
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

    // Phase 2: Verify recommend state
    let state;
    try {
      state = await this.bossCliRunner.inspectRecommendState({ runId });
    } catch (error) {
      await this.#failRun(runId, `recommend_state_failed:${error.message}`, stats);
      return { ok: false, stats, reason: 'recommend_state_unavailable' };
    }

    if (!state.detailOpen) {
      await this.#failRun(runId, 'recommend_detail_not_open_at_start', stats);
      return { ok: false, stats, reason: 'recommend_detail_not_open' };
    }

    // Phase 3: Main loop
    while (stats.greeted < this.targetCount && stats.skipped < this.maxSkips) {
      const loopResult = await this.#processOneCandidate({
        runId,
        jobKey,
        jobRequirement,
        customRequirement,
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

      if (loopResult.exhausted) {
        break;
      }

      // Move to next candidate if not exhausted
      if (stats.greeted < this.targetCount) {
        const advanced = await this.#advanceToNext(runId);
        if (!advanced) {
          break;
        }
      }
    }

    // Phase 4: Complete run
    const summary = {
      targetCount: this.targetCount,
      achievedCount: stats.greeted,
      ...stats
    };

    if (stats.greeted < this.targetCount) {
      summary.reason = stats.skipped >= this.maxSkips
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

  async #processOneCandidate({ runId, jobKey, jobRequirement, customRequirement, stats }) {
    // Step 1: Read current candidate detail
    let detail;
    try {
      detail = await this.bossCliRunner.inspectRecommendDetail({ runId });
    } catch (error) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `source-loop-detail-error:${runId}:${stats.totalEvaluated}`,
        eventType: 'source_loop_error',
        stage: 'source_loop',
        message: `detail read failed: ${error.message}`,
        payload: { error: error.message }
      });
      return { exhausted: false };
    }

    const bossEncryptGeekId = detail.bossEncryptGeekId
      || (detail.identityHints && detail.identityHints[0])
      || null;
    const candidateName = detail.name || detail.selectedCardName || '';

    if (!bossEncryptGeekId) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `source-loop-no-id:${runId}:${stats.totalEvaluated}`,
        eventType: 'source_loop_error',
        stage: 'source_loop',
        message: 'candidate identity unresolvable',
        payload: { candidateName }
      });
      return { exhausted: false };
    }

    // Step 2: LLM evaluation
    let decision;
    try {
      decision = await this.llmEvaluator.evaluateCandidate({
        jobRequirement,
        candidateDetail: {
          name: candidateName,
          detailText: detail.detailText || ''
        },
        customRequirement
      });
    } catch (error) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `source-loop-eval-error:${runId}:${stats.totalEvaluated}`,
        eventType: 'source_loop_error',
        stage: 'source_loop',
        message: `llm evaluation failed: ${error.message}`,
        payload: { error: error.message, bossEncryptGeekId }
      });
      // Default to skip on LLM failure
      decision = { action: 'skip', tier: 'C', reason: `llm_error:${error.message}`, facts: {} };
    }

    // Step 3: Write candidate record regardless of decision
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
          evaluationMode: 'deterministic_loop'
        }
      });
    } catch (error) {
      // Non-fatal: continue even if candidate write fails
      await this.#recordEvent(runId, {
        eventId: `source-loop-candidate-write-error:${runId}:${stats.totalEvaluated}`,
        eventType: 'source_loop_error',
        stage: 'source_loop',
        message: `candidate write failed: ${error.message}`,
        payload: { error: error.message, bossEncryptGeekId }
      });
    }

    // Step 4: Execute greet or skip
    if (decision.action === 'greet') {
      const greetResult = await this.#executeGreet({
        runId,
        jobKey,
        bossEncryptGeekId,
        candidateName,
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
        payload: {
          bossEncryptGeekId,
          candidateName,
          tier: decision.tier,
          reason: decision.reason
        }
      });
    }

    return { exhausted: false };
  }

  async #executeGreet({ runId, jobKey, bossEncryptGeekId, candidateName, stats }) {
    let greetResult;
    try {
      greetResult = await this.bossCliRunner.clickRecommendGreet({ runId });
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

    if (greetResult.alreadyChatting) {
      await this.#recordEvent(runId, {
        eventId: `source-loop-already-chatting:${runId}:${bossEncryptGeekId}`,
        eventType: 'candidate_already_chatting',
        stage: 'source_loop',
        message: `already chatting: ${candidateName}`,
        payload: { bossEncryptGeekId, candidateName }
      });
      return { greeted: false, alreadyChatting: true };
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
        payload: {
          candidateName,
          source: 'deterministic_loop'
        }
      });
    } catch (error) {
      await this.#recordEvent(runId, {
        eventId: `source-loop-greet-write-error:${runId}:${bossEncryptGeekId}`,
        eventType: 'source_loop_error',
        stage: 'source_loop',
        message: `greet action write failed: ${error.message}`,
        payload: { error: error.message, bossEncryptGeekId }
      });
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

  async #advanceToNext(runId) {
    // Check if next button is available
    let state;
    try {
      state = await this.bossCliRunner.inspectRecommendState({ runId });
    } catch (error) {
      return false;
    }

    if (!state.nextVisible) {
      return false;
    }

    try {
      await this.bossCliRunner.recommendNextCandidate({ runId });
    } catch (error) {
      return false;
    }

    // Verify detail reopened after advance
    try {
      const newState = await this.bossCliRunner.inspectRecommendState({ runId });
      return newState.detailOpen;
    } catch (error) {
      return false;
    }
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

  return parts.join('\n') || '(无岗位信息)';
}

module.exports = {
  SourceLoopService
};
