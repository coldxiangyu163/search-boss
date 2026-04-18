const path = require('node:path');
const crypto = require('node:crypto');

const FOLLOWUP_UNSUPPORTED_FILTER_KEYS = ['notViewed', 'notExchanged', 'school', 'jobHopFrequency', 'jobIntent'];
const ACTIVITY_RANKS = new Map([
  ['刚刚活跃', 1],
  ['今日活跃', 2],
  ['3日内活跃', 3],
  ['本周活跃', 4],
  ['本月活跃', 5]
]);
const SALARY_RANGE_PATTERN = /(\d+)\s*-\s*(\d+)\s*K/;
const SALARY_BELOW_PATTERN = /(\d+)\s*K以下/;
const SALARY_ABOVE_PATTERN = /(\d+)\s*K以上/;
const RECHAT_MAX_SCAN_DAYS = 7;
const RECHAT_CONSECUTIVE_OUTBOUND_LIMIT = 3;
const RECHAT_MAX_PER_DAY = 50;
const RECHAT_ACTIVE_HOURS_START = 9;
const RECHAT_ACTIVE_HOURS_END = 21;
const RECHAT_REQUIRED_INFO = ['resume'];
const RECHAT_REQUIRED_INFO_LOGIC = 'any';

class FollowupLoopService {
  constructor({
    bossCliRunner,
    agentService,
    llmEvaluator,
    projectRoot = path.resolve(__dirname, '..', '..'),
    maxThreads = 20,
    threadDelayMin = 2_000,
    threadDelayMax = 5_000,
    resumePreviewCloseDelayMin = 1_200,
    resumePreviewCloseDelayMax = 2_200,
    rechatMaxScanDays = RECHAT_MAX_SCAN_DAYS,
    rechatMaxPerDay = RECHAT_MAX_PER_DAY,
    rechatConsecutiveOutboundLimit = RECHAT_CONSECUTIVE_OUTBOUND_LIMIT,
    rechatActiveHoursStart = RECHAT_ACTIVE_HOURS_START,
    rechatActiveHoursEnd = RECHAT_ACTIVE_HOURS_END,
    rechatRequiredInfo = RECHAT_REQUIRED_INFO,
    rechatRequiredInfoLogic = RECHAT_REQUIRED_INFO_LOGIC,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  }) {
    this.bossCliRunner = bossCliRunner;
    this.agentService = agentService;
    this.llmEvaluator = llmEvaluator;
    this.projectRoot = projectRoot;
    this.maxThreads = maxThreads;
    this.threadDelayMin = threadDelayMin;
    this.threadDelayMax = threadDelayMax;
    this.resumePreviewCloseDelayMin = resumePreviewCloseDelayMin;
    this.resumePreviewCloseDelayMax = resumePreviewCloseDelayMax;
    this.rechatMaxScanDays = rechatMaxScanDays;
    this.rechatMaxPerDay = rechatMaxPerDay;
    this.rechatConsecutiveOutboundLimit = rechatConsecutiveOutboundLimit;
    this.rechatActiveHoursStart = rechatActiveHoursStart;
    this.rechatActiveHoursEnd = rechatActiveHoursEnd;
    this.rechatRequiredInfo = rechatRequiredInfo;
    this.rechatRequiredInfoLogic = rechatRequiredInfoLogic;
    this.sleep = sleep;
  }

  async run({
    runId,
    jobKey,
    mode = 'followup',
    maxThreads: overrideMaxThreads,
    interactionTypes,
    rechatMaxScanDays: overrideRechatMaxScanDays,
    rechatConsecutiveOutboundLimit: overrideRechatConsecutiveOutboundLimit,
    bossCliRunner: runnerOverride,
    signal,
    heartbeat
  } = {}) {
    const runner = runnerOverride || this.bossCliRunner;
    const effectiveMaxThreads = overrideMaxThreads || this.maxThreads;
    const effectiveInteractionTypes = Array.isArray(interactionTypes) && interactionTypes.length > 0
      ? interactionTypes
      : ['request_resume'];
    const effectiveRechatMaxScanDays = Number.isFinite(Number(overrideRechatMaxScanDays)) && Number(overrideRechatMaxScanDays) > 0
      ? Math.round(Number(overrideRechatMaxScanDays))
      : this.rechatMaxScanDays;
    const effectiveRechatConsecutiveOutboundLimit = Number.isFinite(Number(overrideRechatConsecutiveOutboundLimit)) && Number(overrideRechatConsecutiveOutboundLimit) > 0
      ? Math.round(Number(overrideRechatConsecutiveOutboundLimit))
      : this.rechatConsecutiveOutboundLimit;
    return this.#runImpl({
      runId,
      jobKey,
      mode,
      effectiveMaxThreads,
      effectiveInteractionTypes,
      effectiveRechatMaxScanDays,
      effectiveRechatConsecutiveOutboundLimit,
      runner,
      signal,
      heartbeat
    });
  }

  async #runImpl({ runId, jobKey, mode, effectiveMaxThreads, effectiveInteractionTypes, effectiveRechatMaxScanDays, effectiveRechatConsecutiveOutboundLimit, runner, signal, heartbeat }) {
    const safeHeartbeat = () => {
      if (typeof heartbeat !== 'function') return;
      try { heartbeat(); } catch (_) { /* non-fatal */ }
    };
    const stats = {
      processed: 0,
      replied: 0,
      resumeRequested: 0,
      consentAccepted: 0,
      attachmentFound: 0,
      resumeDownloaded: 0,
      messagesSynced: 0,
      rechatSent: 0,
      skipped: 0,
      errors: 0
    };

    // Pre-check: active hours
    if (!isWithinActiveHours(this.rechatActiveHoursStart, this.rechatActiveHoursEnd)) {
      await this.agentService.completeRun({
        runId,
        payload: { ...stats, reason: 'outside_active_hours' }
      });
      return { ok: true, stats, reason: 'outside_active_hours' };
    }

    const jobContext = await this.agentService._getJobNanobotContext(jobKey);

    await this.#recordEvent(runId, {
      eventId: `followup-loop-start:${runId}`,
      eventType: 'followup_loop_started',
      stage: 'followup_loop',
      message: 'deterministic followup loop started',
      payload: { mode, jobKey, maxThreads: effectiveMaxThreads }
    });

    // Phase 1: Bind browser target (prefer chat page)
    try {
      await runner.bindTarget({
        runId,
        mode,
        jobKey,
        jobId: jobContext.bossEncryptJobId || null
      });
    } catch (error) {
      await this.#failRun(runId, `browser_bind_failed:${error.message}`, stats);
      return { ok: false, stats, reason: 'browser_bind_failed' };
    }

    await this.#recordEvent(runId, {
      eventId: `followup-loop-bound:${runId}`,
      eventType: 'phase_changed',
      stage: 'followup_loop',
      message: 'target bound for followup loop',
      payload: { phase: 'target_bound' }
    });

    // Phase 1b: Bring tab to front to prevent Chrome background throttling
    try {
      await runner.bringToFront({ runId });
    } catch (error) {
      // Non-fatal
    }

    // Phase 2: Always reset to chat initial URL to clear stale thread state
    try {
      await runner.navigateTo({
        runId,
        url: 'https://www.zhipin.com/web/chat/index',
        force: true
      });
    } catch (error) {
      await this.#failRun(runId, `chat_page_navigation_failed:${error.message}`, stats);
      return { ok: false, stats, reason: 'chat_page_unavailable' };
    }

    // Phase 3: Select job filter (with page refresh retry)
    try {
      const jobNameShort = extractJobNameShort(jobContext.jobName);
      let jobFilterOk = false;
      let lastFilterError;

      try {
        await runner.selectChatJobFilter({ runId, jobName: jobNameShort });
        jobFilterOk = true;
      } catch (err) {
        lastFilterError = err;
      }

      if (!jobFilterOk) {
        await this.#recordEvent(runId, {
          eventId: `followup-loop-job-filter-retry:${runId}`,
          eventType: 'followup_loop_warning',
          stage: 'followup_loop',
          message: `job filter failed (${lastFilterError.message}), refreshing page and retrying`,
          payload: { firstError: lastFilterError.message }
        });

        await runner.navigateTo({
          runId,
          url: 'https://www.zhipin.com/web/chat/index',
          force: true
        });
        await this.sleep(3_000);

        await runner.selectChatJobFilter({ runId, jobName: jobNameShort });
      }

      await this.#recordEvent(runId, {
        eventId: `followup-loop-job-filtered:${runId}`,
        eventType: 'followup_loop_job_filtered',
        stage: 'followup_loop',
        message: `job filter set to ${jobNameShort}`,
        payload: { jobName: jobNameShort }
      });
    } catch (error) {
      await this.#failRun(runId, `job_filter_failed:${error.message}`, stats);
      return { ok: false, stats, reason: 'job_filter_failed' };
    }

    // Phase 4: Select unread filter
    try {
      await runner.selectChatUnreadFilter({ runId });

      await this.#recordEvent(runId, {
        eventId: `followup-loop-unread-filtered:${runId}`,
        eventType: 'followup_loop_unread_filtered',
        stage: 'followup_loop',
        message: 'unread filter activated',
        payload: {}
      });
    } catch (error) {
      // Non-fatal: proceed with visible list even if unread filter fails
      await this.#recordEvent(runId, {
        eventId: `followup-loop-unread-filter-warn:${runId}`,
        eventType: 'followup_loop_warning',
        stage: 'followup_loop',
        message: `unread filter failed: ${error.message}`,
        payload: { error: error.message }
      });
    }

    // Phase 5: Build stable processing queue from Vue dataSources (full list, not just visible DOM)
    // This avoids desync caused by the virtual scroll list reordering after each interaction.
    const processedUids = new Set();
    let sawAnyThread = false;

    // Phase 5a: Snapshot the full thread list from Vue dataSources for stable traversal order.
    // The list is sorted by lastTs desc at the time of snapshot. We freeze this order so that
    // thread reordering during processing does not cause us to revisit the same candidate.
    let fullThreadQueue = [];
    try {
      const dsResult = await runner.inspectFullChatDataSources({ runId });
      if (dsResult?.ok && Array.isArray(dsResult.threads)) {
        fullThreadQueue = dsResult.threads.filter((t) => t.encryptUid);
      }
    } catch (_) {
      // Non-fatal: fall back to DOM-only visible list below
    }

    // Phase 5b: If dataSources unavailable, fall back to visible list
    if (fullThreadQueue.length === 0) {
      try {
        const listResult = await runner.inspectVisibleChatList({
          runId,
          limit: effectiveMaxThreads
        });
        const threads = Array.isArray(listResult?.threads) ? listResult.threads : [];
        fullThreadQueue = threads.map((t) => ({
          index: t.index,
          encryptUid: t.encryptUid || '',
          name: t.name || '',
          dataId: t.dataId || '',
          unreadCount: t.hasUnread ? 1 : 0
        }));
      } catch (error) {
        await this.#failRun(runId, `visible_list_failed:${error.message}`, stats);
        return { ok: false, stats, reason: 'visible_list_unavailable' };
      }
    }

    if (fullThreadQueue.length === 0) {
      await this.#recordEvent(runId, {
        eventId: `followup-loop-empty:${runId}`,
        eventType: 'followup_loop_empty',
        stage: 'followup_loop',
        message: 'no unread threads visible',
        payload: { jobKey }
      });

      if (mode === 'followup') {
        await this.#runRechatPhase({
          runId, jobKey, jobContext, mode,
          effectiveMaxThreads, effectiveInteractionTypes,
          effectiveRechatMaxScanDays, effectiveRechatConsecutiveOutboundLimit,
          runner, signal, stats,
          processedUids,
          heartbeat
        });
      }

      await this.#resetChatPageAfterCompletion({ runId, runner });
      await this.agentService.completeRun({
        runId,
        payload: { ...stats, reason: fullThreadQueue.length === 0 ? 'no_unread_threads' : 'followup_complete' }
      });
      return { ok: true, stats };
    }

    sawAnyThread = true;
    await this.#recordEvent(runId, {
      eventId: `followup-loop-threads:${runId}`,
      eventType: 'followup_loop_threads_found',
      stage: 'followup_loop',
      message: `found ${fullThreadQueue.length} threads in queue`,
      payload: {
        threadCount: fullThreadQueue.length,
        threads: fullThreadQueue.slice(0, 30).map((t) => ({ name: t.name, encryptUid: t.encryptUid, index: t.index }))
      }
    });

    // Phase 6: Process threads sequentially from the frozen queue
    for (const queuedThread of fullThreadQueue) {
      if (signal?.aborted) break;
      if (stats.processed >= effectiveMaxThreads) break;

      safeHeartbeat();

      const threadUid = queuedThread.encryptUid || buildVisibleThreadKey(queuedThread);
      if (!threadUid || processedUids.has(threadUid)) continue;

      // Random delay between threads to avoid detection
      if (stats.processed > 0) {
        const delayMs = this.threadDelayMin + Math.random() * (this.threadDelayMax - this.threadDelayMin);
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        // Random longer idle every 3-5 threads to mimic human browsing rhythm
        if (this.threadDelayMin > 0 && stats.processed % (3 + Math.floor(Math.random() * 3)) === 0) {
          const idleMs = 8_000 + Math.random() * 15_000;
          await new Promise((resolve) => setTimeout(resolve, idleMs));
        }
      }

      // Scroll the virtual list to bring this thread into the rendered range before clicking.
      // After each interaction the list reorders, so we must re-locate the thread by UID.
      if (queuedThread.encryptUid && typeof runner.scrollChatListToUid === 'function') {
        try {
          await runner.scrollChatListToUid({ runId, encryptUid: queuedThread.encryptUid });
          await this.sleep(800);
        } catch (_) {
          // scroll failed — the row may already be visible, continue to click attempt
        }
      }

      // Re-read the visible DOM list to find the row's current index (it may have moved)
      let thread;
      try {
        const listResult = await runner.inspectVisibleChatList({
          runId,
          limit: 50
        });
        const visibleThreads = Array.isArray(listResult?.threads) ? listResult.threads : [];
        thread = queuedThread.encryptUid
          ? visibleThreads.find((t) => t.encryptUid === queuedThread.encryptUid)
          : visibleThreads.find((t) => buildVisibleThreadKey(t) === threadUid);
      } catch (_) {
        // visible list read failed
      }

      if (!thread) {
        // Thread not in rendered DOM — it may have been removed from list after filter change
        stats.skipped += 1;
        processedUids.add(threadUid);
        continue;
      }

      // Merge name from queue if DOM didn't have it
      if (!thread.name && queuedThread.name) {
        thread.name = queuedThread.name;
      }

      await this.#processOneThread({
        runId,
        jobKey,
        jobContext,
        thread,
        mode,
        interactionTypes: effectiveInteractionTypes,
        stats,
        runner
      });

      processedUids.add(threadUid);
      stats.processed += 1;

      await this.#recordEvent(runId, {
        eventId: `followup-loop-checkpoint:${runId}:${stats.processed}`,
        eventType: 'followup_checkpoint',
        stage: 'followup_loop',
        message: `checkpoint after thread ${stats.processed}`,
        payload: { ...stats, lastThread: thread.name }
      });
    }

    // Handle manual stop
    if (signal?.aborted) {
      await this.#resetChatPageAfterCompletion({ runId, runner });

      const stoppedSummary = { ...stats, reason: 'manually_stopped' };

      await this.#recordEvent(runId, {
        eventId: `followup-loop-stopped:${runId}`,
        eventType: 'followup_loop_stopped',
        stage: 'followup_loop',
        message: '跟进任务已手动停止',
        payload: stoppedSummary
      });

      const stopFn = this.agentService.stopRun || this.agentService.failRun;
      await stopFn.call(this.agentService, {
        runId,
        message: 'manually_stopped',
        payload: stoppedSummary
      });

      return { ok: false, stats: stoppedSummary, reason: 'manually_stopped' };
    }

    // Phase 7: Re-chat phase (after processing unread threads)
    if (mode === 'followup' && !signal?.aborted) {
      await this.#runRechatPhase({
        runId, jobKey, jobContext, mode,
        effectiveMaxThreads, effectiveInteractionTypes,
        effectiveRechatMaxScanDays, effectiveRechatConsecutiveOutboundLimit,
        runner, signal, stats,
        processedUids,
        heartbeat
      });
    }

    // Phase 8: Complete
    const summary = { ...stats };

    await this.#recordEvent(runId, {
      eventId: `followup-loop-done:${runId}`,
      eventType: 'followup_loop_completed',
      stage: 'followup_loop',
      message: 'deterministic followup loop finished',
      payload: summary
    });

    await this.#resetChatPageAfterCompletion({ runId, runner });
    await this.agentService.completeRun({ runId, payload: summary });

    return { ok: true, stats: summary };
  }

  async #processOneThread({ runId, jobKey, jobContext, thread, mode, interactionTypes, stats, runner, rechat = false }) {
    const threadId = thread.dataId || `idx-${thread.index}`;
    const expectedUid = thread.encryptUid || '';

    // Step 1: Click the row in the left-side chat list
    try {
      await runner.clickChatRow({
        runId,
        index: thread.index,
        dataId: thread.dataId
      });
    } catch (error) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-click-error:${runId}:${threadId}`,
        eventType: 'followup_loop_error',
        stage: 'followup_loop',
        message: `row click failed: ${error.message}`,
        payload: { error: error.message, threadId, candidateName: thread.name }
      });
      return;
    }

    // Step 2: Read the encryptUid from the active thread state (right panel)
    // Retry up to 3 times to ensure the right panel has switched to the correct thread
    let threadState;
    const maxRetries = expectedUid ? 3 : 1;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        threadState = await runner.inspectChatThreadState({ runId });
      } catch (error) {
        stats.errors += 1;
        return;
      }

      if (!threadState.threadOpen) {
        stats.errors += 1;
        return;
      }

      const currentUid = threadState.encryptUid || threadState.activeUid || '';
      if (!expectedUid || currentUid === expectedUid) {
        break;
      }

      // Right panel hasn't switched yet — wait and retry
      if (attempt < maxRetries - 1) {
        await this.sleep(1500);
      }
    }

    const encryptUid = threadState.encryptUid || threadState.activeUid || threadId;

    // Verify the right panel matches the expected candidate
    if (expectedUid && encryptUid !== expectedUid) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-uid-mismatch:${runId}:${threadId}`,
        eventType: 'followup_loop_warning',
        stage: 'followup_loop',
        message: `thread switch mismatch: expected ${expectedUid} but got ${encryptUid}, skipping to avoid data cross-contamination`,
        payload: { expectedUid, actualUid: encryptUid, candidateName: thread.name }
      });
      return;
    }

    // Step 2b: Upsert candidate record
    let candidateId = null;
    try {
      const upsertResult = await this.agentService.upsertCandidate({
        runId,
        eventId: `followup-loop-candidate:${runId}:${encryptUid}`,
        occurredAt: new Date().toISOString(),
        jobKey,
        bossEncryptGeekId: encryptUid,
        name: thread.name || threadState.activeName || null,
        status: 'greeted',
        metadata: { source: 'deterministic_followup_loop' }
      });
      candidateId = upsertResult?.candidateId || null;
    } catch (error) {
      // Non-fatal: try lookup as fallback
      candidateId = await this.#resolveCandidateId({ encryptUid });
    }

    // Step 2c: Check and accept resume consent if pending
    const consentResult = await this.#handleResumeConsentIfNeeded({ runId, encryptUid, candidateName: thread.name, stats, runner });

    // Step 3: Check attachment state (after consent handling so newly appeared attachments are detected)
    let attachmentState;
    try {
      attachmentState = await runner.inspectAttachmentState({ runId });
    } catch (error) {
      attachmentState = { present: false, buttonEnabled: false, fileName: '' };
    }

    // Step 4: Branch on attachment state
    if (attachmentState.present && attachmentState.buttonEnabled) {
      stats.attachmentFound += 1;

      if (mode === 'download' || mode === 'followup') {
        await this.#executeResumeDownload({
          runId,
          jobKey,
          encryptUid,
          candidateName: thread.name,
          candidateId,
          stats,
          runner
        });
      } else {
        await this.#recordEvent(runId, {
          eventId: `followup-loop-attachment-noted:${runId}:${threadId}`,
          eventType: 'attachment_discovered',
          stage: 'followup_loop',
          message: `attachment found for ${thread.name} (chat mode, noted only)`,
          payload: { encryptUid, candidateName: thread.name }
        });
      }
      return;
    }

    // Step 5: No attachment — read visible messages from the open right panel
    let messages;
    try {
      const msgResult = await runner.readOpenThreadMessages({ runId, limit: 50 });
      messages = Array.isArray(msgResult?.messages) ? msgResult.messages : [];
    } catch (error) {
      stats.errors += 1;
      return;
    }

    if (messages.length === 0) {
      stats.skipped += 1;
      return;
    }

    // Step 5b: Sync all visible messages to DB
    const synced = await this.#syncAllThreadMessages({
      runId,
      jobKey,
      encryptUid,
      candidateId,
      candidateName: thread.name,
      messages
    });
    stats.messagesSynced += synced;

    // Step 6: Check message direction eligibility
    if (rechat) {
      // Re-chat mode: skip if last N messages are all outbound with no reply
      const limit = this.rechatConsecutiveOutboundLimit;
      if (hasConsecutiveUnrepliedMessages(messages, limit)) {
        stats.skipped += 1;
        await this.#recordEvent(runId, {
          eventId: `rechat-consecutive-skip:${runId}:${encryptUid}`,
          eventType: 'rechat_consecutive_skip',
          stage: 'rechat',
          message: `skipped ${thread.name}: ${limit} consecutive outbound messages without reply`,
          payload: { encryptUid, candidateName: thread.name, threshold: limit }
        });
        return;
      }
    } else {
      // Normal followup: skip if last message is not from candidate
      const lastMessage = messages[messages.length - 1];
      const lastMessageFromCandidate = lastMessage && lastMessage.from !== 'me';

      if (!lastMessageFromCandidate) {
        stats.skipped += 1;
        return;
      }
    }

    let resumePanel = null;
    try {
      const panelResult = await runner.getResumePanel({ runId, uid: encryptUid });
      resumePanel = panelResult?.resume || panelResult || null;
    } catch (error) {
      resumePanel = null;
    }

    const resumeProfile = buildResumePanelProfile({ resumePanel, fallbackName: thread.name });
    if (resumePanel || resumeProfile) {
      candidateId = await this.#persistFollowupCandidateProfile({
        runId,
        jobKey,
        encryptUid,
        candidateName: thread.name,
        candidateId,
        status: 'greeted',
        resumePanel,
        resumeProfile
      }) || candidateId;
    }

    const filterGate = evaluateRecommendFilters(jobContext.recommendFilters, resumePanel);
    if (filterGate.definitiveMismatch) {
      candidateId = await this.#persistFollowupCandidateProfile({
        runId,
        jobKey,
        encryptUid,
        candidateName: thread.name,
        candidateId,
        status: 'greeted',
        resumePanel,
        resumeProfile,
        filterGate,
      followupDecision: {
        action: 'skip',
        reason: filterGate.reasons.join(', '),
        requirementEvidence: filterGate.reasons,
        source: 'recommend_filters'
      }
    }) || candidateId;
      stats.skipped += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-filter-skip:${runId}:${threadId}`,
        eventType: 'followup_filter_skipped',
        stage: 'followup_loop',
        message: `filter mismatch skipped: ${filterGate.reasons.join(', ')}`,
        payload: {
          encryptUid,
          candidateName: thread.name,
          reasons: filterGate.reasons,
          unsupportedFilters: filterGate.unsupportedFilters,
          profile: buildFilterProfileEvidence(resumePanel)
        }
      });
      await this.#recordEvent(runId, {
        eventId: `followup-loop-filter-eval:${runId}:${threadId}`,
        eventType: 'candidate_evaluated',
        stage: 'followup_loop',
        message: buildLlmEvaluationMessage({
          action: 'skip',
          candidateName: thread.name,
          reason: filterGate.reasons.join(', '),
          requirementEvidence: filterGate.reasons
        }),
        payload: {
          encryptUid,
          candidateName: thread.name,
          action: 'skip',
          reason: filterGate.reasons.join(', '),
          replyText: '',
          requirementEvidence: filterGate.reasons,
          source: 'recommend_filters',
          profile: resumeProfile,
          unsupportedFilters: filterGate.unsupportedFilters
        }
      });
      return;
    }

    // Step 8: Check followup-decision from backend
    let followupDecision = null;
    if (candidateId) {
      try {
        followupDecision = await this.agentService.getFollowupDecision(candidateId);
      } catch (error) {
        // Non-fatal
      }
    }

    const canRequestResume = followupDecision?.allowed === true
      && followupDecision?.recommendedAction === 'resume_request'
      && !attachmentState.present;

    // Step 9: LLM decides what to do
    let decision;
    try {
      const recentMessages = messages.slice(-10).map((m) =>
        `${m.from === 'me' ? '我' : thread.name || '对方'}：${m.text}`
      ).join('\n');

      decision = await this.#decideChatReply({
        jobContext,
        candidateName: thread.name,
        recentMessages,
        canRequestResume
      });
    } catch (error) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-llm-error:${runId}:${threadId}`,
        eventType: 'followup_loop_error',
        stage: 'followup_loop',
        message: `llm decision failed: ${error.message}`,
        payload: { error: error.message, encryptUid, threadId }
      });
      return;
    }

    candidateId = await this.#persistFollowupCandidateProfile({
      runId,
      jobKey,
      encryptUid,
      candidateName: thread.name,
      candidateId,
      status: 'greeted',
      resumePanel,
      resumeProfile,
      filterGate,
      followupDecision: {
        action: decision.action,
        reason: decision.reason,
        replyText: decision.replyText,
        requirementEvidence: decision.requirementEvidence,
        source: 'llm'
      }
    }) || candidateId;

    await this.#recordEvent(runId, {
      eventId: `followup-loop-llm:${runId}:${threadId}`,
      eventType: 'candidate_evaluated',
      stage: 'followup_loop',
      message: buildLlmEvaluationMessage({
        action: decision.action,
        candidateName: thread.name,
        reason: decision.reason,
        requirementEvidence: decision.requirementEvidence
      }),
      payload: {
        encryptUid,
        candidateName: thread.name,
        action: decision.action,
        reason: decision.reason,
        replyText: decision.replyText || '',
        requirementEvidence: decision.requirementEvidence,
        profile: resumeProfile,
        unsupportedFilters: filterGate.unsupportedFilters
      }
    });

    // Step 10: Execute decision
    if (decision.action === 'skip') {
      stats.skipped += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-skip:${runId}:${threadId}`,
        eventType: 'candidate_skipped',
        stage: 'followup_loop',
        message: `skipped: ${decision.reason}`,
        payload: { encryptUid, candidateName: thread.name, reason: decision.reason }
      });
      return;
    }

    // Step 10a: Handle request_resume action (execute all configured interaction types)
    if (decision.action === 'request_resume') {
      const hasResumeRequest = interactionTypes.includes('request_resume');
      if (hasResumeRequest) {
        await this.#requestResumeWhenReady({
          runId,
          jobKey,
          encryptUid,
          candidateName: thread.name,
          candidateId,
          replyText: decision.replyText,
          allowWarmupReply: true,
          stats,
          runner
        });
      } else if (decision.replyText) {
        await this.#executeSendMessage({
          runId, jobKey, encryptUid,
          candidateName: thread.name, candidateId,
          text: decision.replyText, stats, runner
        });
      }
      const extraTypes = interactionTypes.filter((t) => t !== 'request_resume');
      for (let ei = 0; ei < extraTypes.length; ei++) {
        const actionGap = this.threadDelayMin + Math.random() * (this.threadDelayMax - this.threadDelayMin);
        await new Promise((resolve) => setTimeout(resolve, actionGap));
        await this.#executeExchangeAction({
          runId, jobKey, encryptUid,
          candidateName: thread.name, candidateId,
          actionType: extraTypes[ei], stats, runner
        });
      }
      return;
    }

    // Step 10b: Send reply
    let replySent = true;
    if (decision.replyText) {
      replySent = await this.#executeSendMessage({
        runId, jobKey, encryptUid,
        candidateName: thread.name, candidateId,
        text: decision.replyText, stats, runner
      });
    }

    // Step 10c: Execute configured interaction types after reply
    if (replySent && !attachmentState.present) {
      const hasResumeRequest = interactionTypes.includes('request_resume');
      if (hasResumeRequest && canRequestResume) {
        await this.#requestResumeWhenReady({
          runId,
          jobKey,
          encryptUid,
          candidateName: thread.name,
          candidateId,
          replyText: '',
          allowWarmupReply: !decision.replyText,
          stats,
          runner
        });
      }
      const extraTypes = interactionTypes.filter((t) => t !== 'request_resume');
      for (let ei = 0; ei < extraTypes.length; ei++) {
        const actionGap = this.threadDelayMin + Math.random() * (this.threadDelayMax - this.threadDelayMin);
        await new Promise((resolve) => setTimeout(resolve, actionGap));
        await this.#executeExchangeAction({
          runId, jobKey, encryptUid,
          candidateName: thread.name, candidateId,
          actionType: extraTypes[ei], stats, runner
        });
      }
    }
  }

  async #runRechatPhase({ runId, jobKey, jobContext, mode, effectiveMaxThreads, effectiveInteractionTypes, effectiveRechatMaxScanDays, effectiveRechatConsecutiveOutboundLimit, runner, signal, stats, processedUids, heartbeat }) {
    const safeHeartbeat = () => {
      if (typeof heartbeat !== 'function') return;
      try { heartbeat(); } catch (_) { /* non-fatal */ }
    };
    const rechatMaxScanDays = effectiveRechatMaxScanDays || this.rechatMaxScanDays;
    const rechatConsecutiveOutboundLimit = effectiveRechatConsecutiveOutboundLimit || this.rechatConsecutiveOutboundLimit;
    // Phase R1: Switch to "全部" filter
    try {
      await runner.selectChatAllFilter({ runId });
      await this.#recordEvent(runId, {
        eventId: `rechat-started:${runId}`,
        eventType: 'rechat_phase_started',
        stage: 'rechat',
        message: 'switched to all filter for re-chat phase',
        payload: { jobKey, maxScanDays: rechatMaxScanDays, maxPerDay: this.rechatMaxPerDay, consecutiveOutboundLimit: rechatConsecutiveOutboundLimit }
      });
    } catch (error) {
      await this.#recordEvent(runId, {
        eventId: `rechat-all-filter-failed:${runId}`,
        eventType: 'rechat_warning',
        stage: 'rechat',
        message: `switch to all filter failed: ${error.message}`,
        payload: { error: error.message }
      });
      return;
    }

    // Phase R2: Build re-chat queue by scrolling through the visible list
    const rechatQueue = [];
    const seenUids = new Set(processedUids);
    const maxScrollAttempts = 30;
    let scrollAttempt = 0;
    let foundPastWindow = false;
    let noNewThreadsStreak = 0;

    while (scrollAttempt < maxScrollAttempts && !foundPastWindow && !signal?.aborted) {
      let threads = [];
      try {
        const listResult = await runner.inspectVisibleChatList({ runId, limit: 50 });
        threads = Array.isArray(listResult?.threads) ? listResult.threads : [];
      } catch (error) {
        break;
      }

      let newThreadsFound = 0;
      for (const thread of threads) {
        const uid = thread.encryptUid || buildVisibleThreadKey(thread);
        if (!uid || seenUids.has(uid)) continue;
        seenUids.add(uid);
        newThreadsFound += 1;

        const daysAgo = parseLastTimeDaysAgo(thread.lastTime);

        if (daysAgo === 0) {
          continue;
        }

        if (daysAgo >= 1 && daysAgo <= rechatMaxScanDays) {
          rechatQueue.push(thread);
          continue;
        }

        if (daysAgo > rechatMaxScanDays) {
          foundPastWindow = true;
          break;
        }
      }

      if (foundPastWindow) break;

      if (newThreadsFound === 0) {
        noNewThreadsStreak += 1;
        if (noNewThreadsStreak >= 3) break;
      } else {
        noNewThreadsStreak = 0;
      }

      try {
        await runner.scrollChatList({ runId });
        await this.sleep(1000);
      } catch (error) {
        break;
      }

      scrollAttempt += 1;
    }

    if (rechatQueue.length === 0) {
      await this.#recordEvent(runId, {
        eventId: `rechat-empty:${runId}`,
        eventType: 'rechat_empty',
        stage: 'rechat',
        message: 'no candidates in re-chat time window',
        payload: { jobKey, windowDays: `1-${rechatMaxScanDays}` }
      });
      return;
    }

    await this.#recordEvent(runId, {
      eventId: `rechat-queue-built:${runId}`,
      eventType: 'rechat_queue_built',
      stage: 'rechat',
      message: `found ${rechatQueue.length} candidates for re-chat`,
      payload: {
        count: rechatQueue.length,
        candidates: rechatQueue.slice(0, 30).map((t) => ({ name: t.name, lastTime: t.lastTime, encryptUid: t.encryptUid }))
      }
    });

    // Phase R3: Process each candidate in the re-chat queue
    let rechatProcessed = 0;
    for (const queuedThread of rechatQueue) {
      if (signal?.aborted) break;

      safeHeartbeat();

      // Per-run processing limit (shared with unread phase)
      if (stats.processed >= effectiveMaxThreads) {
        await this.#recordEvent(runId, {
          eventId: `rechat-max-threads:${runId}`,
          eventType: 'rechat_max_threads_reached',
          stage: 'rechat',
          message: `per-run processing limit reached (${effectiveMaxThreads})`,
          payload: { processed: stats.processed, limit: effectiveMaxThreads }
        });
        break;
      }

      // Daily limit check
      if (stats.rechatSent >= this.rechatMaxPerDay) {
        await this.#recordEvent(runId, {
          eventId: `rechat-daily-limit:${runId}`,
          eventType: 'rechat_daily_limit_reached',
          stage: 'rechat',
          message: `daily re-chat limit reached (${this.rechatMaxPerDay})`,
          payload: { rechatSent: stats.rechatSent, limit: this.rechatMaxPerDay }
        });
        break;
      }

      // Random delay between threads
      if (rechatProcessed > 0) {
        const delayMs = this.threadDelayMin + Math.random() * (this.threadDelayMax - this.threadDelayMin);
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        if (this.threadDelayMin > 0 && rechatProcessed % (3 + Math.floor(Math.random() * 3)) === 0) {
          const idleMs = 8_000 + Math.random() * 15_000;
          await new Promise((resolve) => setTimeout(resolve, idleMs));
        }
      }

      if (queuedThread.encryptUid && typeof runner.scrollChatListToUid === 'function') {
        try {
          await runner.scrollChatListToUid({ runId, encryptUid: queuedThread.encryptUid });
          await this.sleep(800);
        } catch (_) {
          // scroll failed — the row may already be visible
        }
      }

      let thread;
      try {
        const listResult = await runner.inspectVisibleChatList({ runId, limit: 50 });
        const visibleThreads = Array.isArray(listResult?.threads) ? listResult.threads : [];
        thread = queuedThread.encryptUid
          ? visibleThreads.find((t) => t.encryptUid === queuedThread.encryptUid)
          : visibleThreads.find((t) => buildVisibleThreadKey(t) === buildVisibleThreadKey(queuedThread));
      } catch (_) {
        // visible list read failed
      }

      if (!thread) {
        stats.skipped += 1;
        continue;
      }

      if (!thread.name && queuedThread.name) {
        thread.name = queuedThread.name;
      }

      const sent = await this.#processRechatThread({
        runId,
        jobKey,
        jobContext,
        thread,
        mode,
        interactionTypes: effectiveInteractionTypes,
        rechatConsecutiveOutboundLimit,
        stats,
        runner
      });

      if (sent) {
        stats.rechatSent += 1;
        rechatProcessed += 1;
        stats.processed += 1;
      }

      processedUids.add(queuedThread.encryptUid || buildVisibleThreadKey(queuedThread));

      await this.#recordEvent(runId, {
        eventId: `rechat-checkpoint:${runId}:${rechatProcessed}`,
        eventType: 'rechat_checkpoint',
        stage: 'rechat',
        message: `re-chat checkpoint after thread ${rechatProcessed}/${rechatQueue.length}`,
        payload: { ...stats, lastThread: thread.name, rechatProcessed }
      });
    }

    await this.#recordEvent(runId, {
      eventId: `rechat-done:${runId}`,
      eventType: 'rechat_phase_completed',
      stage: 'rechat',
      message: `re-chat phase completed: ${rechatProcessed}/${rechatQueue.length} processed, ${stats.rechatSent} messages sent`,
      payload: { rechatProcessed, rechatTotal: rechatQueue.length, rechatSent: stats.rechatSent }
    });
  }

  async #processRechatThread({ runId, jobKey, jobContext, thread, mode, interactionTypes, rechatConsecutiveOutboundLimit, stats, runner }) {
    const threadId = thread.dataId || `idx-${thread.index}`;
    const expectedUid = thread.encryptUid || '';
    const effectiveConsecutiveLimit = Number.isFinite(Number(rechatConsecutiveOutboundLimit)) && Number(rechatConsecutiveOutboundLimit) > 0
      ? Math.round(Number(rechatConsecutiveOutboundLimit))
      : this.rechatConsecutiveOutboundLimit;

    // Step 1: Click the row
    try {
      await runner.clickChatRow({ runId, index: thread.index, dataId: thread.dataId });
    } catch (error) {
      stats.errors += 1;
      return false;
    }

    // Step 2: Verify thread state
    let threadState;
    const maxRetries = expectedUid ? 3 : 1;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        threadState = await runner.inspectChatThreadState({ runId });
      } catch (error) {
        stats.errors += 1;
        return false;
      }
      if (!threadState.threadOpen) { stats.errors += 1; return false; }
      const currentUid = threadState.encryptUid || threadState.activeUid || '';
      if (!expectedUid || currentUid === expectedUid) break;
      if (attempt < maxRetries - 1) await this.sleep(1500);
    }

    const encryptUid = threadState.encryptUid || threadState.activeUid || threadId;
    if (expectedUid && encryptUid !== expectedUid) {
      stats.errors += 1;
      return false;
    }

    // Step 3: Check required info collection status
    const collectedInfo = await this.#inspectRequiredInfoState({ runId, runner });
    if (isRequiredInfoCollected(collectedInfo, this.rechatRequiredInfo, this.rechatRequiredInfoLogic)) {
      let resumeDownloadStatus = 'no_resume_on_page';

      if (collectedInfo.resume) {
        let alreadyDownloaded = false;
        try {
          alreadyDownloaded = await this.agentService.hasDownloadedAttachment(encryptUid, jobKey);
        } catch (_) {
          // Non-fatal: default to not downloaded
        }

        if (alreadyDownloaded) {
          resumeDownloadStatus = 'already_downloaded';
        } else {
          resumeDownloadStatus = 'not_downloaded';

          await this.#recordEvent(runId, {
            eventId: `rechat-resume-check:${runId}:${encryptUid}`,
            eventType: 'rechat_resume_not_downloaded',
            stage: 'rechat',
            message: `${thread.name}: resume visible but not downloaded, attempting download`,
            payload: { encryptUid, candidateName: thread.name }
          });

          let candidateId = null;
          try {
            const upsertResult = await this.agentService.upsertCandidate({
              runId,
              eventId: `rechat-candidate:${runId}:${encryptUid}`,
              occurredAt: new Date().toISOString(),
              jobKey,
              bossEncryptGeekId: encryptUid,
              name: thread.name || threadState.activeName || null,
              status: 'greeted',
              metadata: { source: 'rechat_loop' }
            });
            candidateId = upsertResult?.candidateId || null;
          } catch (error) {
            candidateId = await this.#resolveCandidateId({ encryptUid });
          }

          // Accept resume consent if pending (mirrors #processOneThread Step 2c)
          await this.#handleResumeConsentIfNeeded({ runId, encryptUid, candidateName: thread.name, stats, runner });

          // Re-check attachment state after consent handling
          let attachmentState;
          try {
            attachmentState = await runner.inspectAttachmentState({ runId });
          } catch (error) {
            attachmentState = { present: false, buttonEnabled: false };
          }

          if (attachmentState.present && attachmentState.buttonEnabled) {
            await this.#executeResumeDownload({
              runId,
              jobKey,
              encryptUid,
              candidateName: thread.name,
              candidateId,
              stats,
              runner
            });
            resumeDownloadStatus = 'download_attempted';
          } else {
            resumeDownloadStatus = 'attachment_not_ready';
            await this.#recordEvent(runId, {
              eventId: `rechat-resume-not-ready:${runId}:${encryptUid}`,
              eventType: 'rechat_resume_attachment_not_ready',
              stage: 'rechat',
              message: `${thread.name}: resume not downloadable (present=${attachmentState.present}, enabled=${attachmentState.buttonEnabled})`,
              payload: { encryptUid, candidateName: thread.name, attachmentState }
            });
          }
        }
      }

      stats.skipped += 1;
      await this.#recordEvent(runId, {
        eventId: `rechat-info-collected:${runId}:${encryptUid}`,
        eventType: 'rechat_info_collected_skip',
        stage: 'rechat',
        message: `skipped ${thread.name}: required info already collected (resume: ${resumeDownloadStatus})`,
        payload: { encryptUid, candidateName: thread.name, collectedInfo, resumeDownloadStatus }
      });
      return false;
    }

    // Step 4: Read resume panel and check job requirement filters
    let resumePanel = null;
    try {
      const panelResult = await runner.getResumePanel({ runId, uid: encryptUid });
      resumePanel = panelResult?.resume || panelResult || null;
    } catch (error) {
      resumePanel = null;
    }

    const filterGate = evaluateRecommendFilters(jobContext.recommendFilters, resumePanel);
    if (filterGate.definitiveMismatch) {
      stats.skipped += 1;
      await this.#recordEvent(runId, {
        eventId: `rechat-filter-skip:${runId}:${encryptUid}`,
        eventType: 'rechat_filter_skipped',
        stage: 'rechat',
        message: `skipped ${thread.name}: filter mismatch: ${filterGate.reasons.join(', ')}`,
        payload: {
          encryptUid,
          candidateName: thread.name,
          reasons: filterGate.reasons,
          unsupportedFilters: filterGate.unsupportedFilters,
          profile: buildFilterProfileEvidence(resumePanel)
        }
      });
      return false;
    }

    // Step 5: Read messages and check consecutive outbound
    let messages;
    try {
      const msgResult = await runner.readOpenThreadMessages({ runId, limit: 50 });
      messages = Array.isArray(msgResult?.messages) ? msgResult.messages : [];
    } catch (error) {
      stats.errors += 1;
      return false;
    }

    if (messages.length === 0) {
      stats.skipped += 1;
      return false;
    }

    // Sync messages to DB
    let candidateId = null;
    try {
      const upsertResult = await this.agentService.upsertCandidate({
        runId,
        eventId: `rechat-candidate:${runId}:${encryptUid}`,
        occurredAt: new Date().toISOString(),
        jobKey,
        bossEncryptGeekId: encryptUid,
        name: thread.name || threadState.activeName || null,
        status: 'greeted',
        metadata: { source: 'rechat_loop' }
      });
      candidateId = upsertResult?.candidateId || null;
    } catch (error) {
      candidateId = await this.#resolveCandidateId({ encryptUid });
    }

    const synced = await this.#syncAllThreadMessages({
      runId, jobKey, encryptUid, candidateId,
      candidateName: thread.name, messages
    });
    stats.messagesSynced += synced;

    // Count consecutive outbound messages
    const consecutiveOutbound = countConsecutiveOutbound(messages);
    if (consecutiveOutbound >= effectiveConsecutiveLimit) {
      stats.skipped += 1;
      await this.#recordEvent(runId, {
        eventId: `rechat-consecutive-skip:${runId}:${encryptUid}`,
        eventType: 'rechat_consecutive_skip',
        stage: 'rechat',
        message: `skipped ${thread.name}: ${consecutiveOutbound} consecutive outbound messages without reply`,
        payload: { encryptUid, candidateName: thread.name, consecutiveOutbound, threshold: effectiveConsecutiveLimit }
      });
      return false;
    }

    // Step 6: Determine last message read status
    const lastOutboundMsg = findLastOutboundMessage(messages);
    const lastReadStatus = lastOutboundMsg?.readStatus || '';

    // Step 7: Determine missing required info for prompt context
    const missingInfo = getMissingRequiredInfo(collectedInfo, this.rechatRequiredInfo);

    // Step 8: Generate re-chat message via LLM
    let decision;
    try {
      decision = await this.#decideRechatReply({
        jobContext,
        candidateName: thread.name,
        recentMessages: messages.slice(-10).map((m) =>
          `${m.from === 'me' ? '我' : thread.name || '对方'}：${m.text}`
        ).join('\n'),
        consecutiveOutbound,
        lastReadStatus,
        missingInfo
      });
    } catch (error) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `rechat-llm-error:${runId}:${encryptUid}`,
        eventType: 'rechat_error',
        stage: 'rechat',
        message: `rechat llm decision failed: ${error.message}`,
        payload: { error: error.message, encryptUid }
      });
      return false;
    }

    await this.#recordEvent(runId, {
      eventId: `rechat-llm:${runId}:${encryptUid}`,
      eventType: 'candidate_evaluated',
      stage: 'rechat',
      message: `rechat LLM ${decision.action}: ${thread.name} ${decision.reason}`,
      payload: {
        encryptUid, candidateName: thread.name,
        action: decision.action, reason: decision.reason,
        replyText: decision.replyText || '',
        consecutiveOutbound, lastReadStatus, missingInfo
      }
    });

    if (decision.action === 'skip' || !decision.replyText) {
      stats.skipped += 1;
      return false;
    }

    // Step 8: Send the re-chat message
    const sent = await this.#executeSendMessage({
      runId, jobKey, encryptUid,
      candidateName: thread.name, candidateId,
      text: decision.replyText, stats, runner
    });

    // Step 9: Execute configured interaction types after rechat reply
    if (sent) {
      const hasResumeRequest = interactionTypes.includes('request_resume');
      if (hasResumeRequest && !collectedInfo.resume) {
        await this.#requestResumeWhenReady({
          runId,
          jobKey,
          encryptUid,
          candidateName: thread.name,
          candidateId,
          replyText: '',
          allowWarmupReply: false,
          stats,
          runner
        });
      }
      const extraTypes = interactionTypes.filter((t) => t !== 'request_resume');
      for (let ei = 0; ei < extraTypes.length; ei++) {
        const actionType = extraTypes[ei];
        const alreadyCollected =
          (actionType === 'exchange_phone' && collectedInfo.phone) ||
          (actionType === 'exchange_wechat' && collectedInfo.wechat);
        if (alreadyCollected) continue;

        const actionGap = this.threadDelayMin + Math.random() * (this.threadDelayMax - this.threadDelayMin);
        await this.sleep(actionGap);
        await this.#executeExchangeAction({
          runId, jobKey, encryptUid,
          candidateName: thread.name, candidateId,
          actionType, stats, runner
        });
      }
    }

    return sent;
  }

  async #inspectRequiredInfoState({ runId, runner }) {
    const result = { resume: false, phone: false, wechat: false };

    try {
      const attachmentState = await runner.inspectAttachmentState({ runId });
      result.resume = Boolean(attachmentState?.present && attachmentState?.buttonEnabled);
    } catch (_) {
      // Non-fatal
    }

    try {
      const exchangeState = await runner.inspectContactExchangeState({ runId });
      result.phone = Boolean(exchangeState?.phone?.collected);
      result.wechat = Boolean(exchangeState?.wechat?.collected);
    } catch (_) {
      // Non-fatal
    }

    return result;
  }

  async #decideChatReply({ jobContext, candidateName, recentMessages, canRequestResume }) {
    const systemPrompt = [
      '你是一个招聘顾问，正在跟进候选人的聊天回复。',
      '根据对话上下文决定下一步动作。只输出纯 JSON，不要添加任何解释文字。'
    ].join('\n');

    const actions = ['reply', 'skip'];
    if (canRequestResume) {
      actions.push('request_resume');
    }

    const userPrompt = [
      `## 岗位：${jobContext.jobName || '未知'}`,
      jobContext.city ? `工作地点：${jobContext.city}` : '',
      jobContext.salary ? `薪资范围：${jobContext.salary}` : '',
      jobContext.jdText ? `岗位说明：${String(jobContext.jdText).slice(0, 200)}` : '',
      jobContext.customRequirement ? `## 岗位附加要求（内部参考）\n${jobContext.customRequirement}` : '',
      jobContext.enterpriseKnowledge ? `## 企业知识库\n${jobContext.enterpriseKnowledge}` : '',
      `## 候选人：${candidateName}`,
      '',
      '## 最近对话',
      recentMessages,
      '',
      '## 判断要求',
      `可选动作：${actions.join(', ')}`,
      '- reply：需要回复候选人（附带 replyText，简洁专业）',
      canRequestResume ? '- request_resume：候选人态度积极且已有实质沟通，可以索要简历；如果选择这个动作，replyText 也必须提供，先发一条自然回复再索要简历' : '',
      '- skip：不需要回复（对方只是已读、表情、或无实质内容）',
      '- 回复必须使用 BOSS直聘聊天口吻，像真人招聘顾问即时沟通，不要写成正式邮件、分析报告或客服话术。',
      '- 优先短句、口语化、自然推进沟通，避免过度包装和空泛赞美。',
      '- 避免“从您的表达来看”“匹配度”“沟通意愿较强”“初步评估”“综合判断”等 AI/书面分析腔。',
      '- 除非候选人明确追问，不要上来重复“岗位还在招聘中”“感谢关注”等模板化开场。',
      '- 只能使用上面明确提供的岗位信息；如果缺少地点、薪资、班次等信息，就不要写。',
      '- 岗位附加要求仅用于内部判断回复策略，不要机械复述给候选人。',
      '- 若附加要求属于内部筛选口径或不适合直接对外表达，回复时要转化为自然、合规的话术，或避免直接提及。',
      '- 必须明确说明依据了哪些岗位要求、附加条件或候选人画像信号做出该决定。',
      '- requirementEvidence 需要用 1-3 条短句列出关键依据，例如经验、活跃度、附加要求、沟通意愿等。',
      '- 禁止输出`[工作地点]`、`[薪资]`这类占位符，也不要自行脑补未提供的信息。',
      '',
      '返回纯 JSON：{"action":"reply"|"request_resume"|"skip","replyText":"回复内容(reply 和 request_resume 时需要)","reason":"简要原因","requirementEvidence":["依据1","依据2"]}'
    ].filter(Boolean).join('\n');

    const raw = await this.llmEvaluator.chat({ systemPrompt, userPrompt });
    return parseChatDecision(raw);
  }

  async #decideRechatReply({ jobContext, candidateName, recentMessages, consecutiveOutbound, lastReadStatus, missingInfo }) {
    const systemPrompt = [
      '你是一个招聘顾问，正在对沉默的候选人进行复聊。',
      '根据复聊策略生成一条复聊消息。只输出纯 JSON，不要添加任何解释文字。'
    ].join('\n');

    const roundNumber = consecutiveOutbound + 1;
    const missingInfoText = missingInfo.length > 0
      ? `当前缺失信息：${missingInfo.map((i) => ({ resume: '简历', phone: '手机号', wechat: '微信' }[i] || i)).join('、')}`
      : '所有目标信息均已收集';

    const readStatusGuide = lastReadStatus === '已读'
      ? '候选人已读但未回复：换一个角度介绍岗位亮点，重新吸引兴趣。'
      : '候选人尚未阅读消息（送达未读）：简短提醒，把消息"顶上去"即可。';

    const userPrompt = [
      `## 岗位：${jobContext.jobName || '未知'}`,
      jobContext.city ? `工作地点：${jobContext.city}` : '',
      jobContext.salary ? `薪资范围：${jobContext.salary}` : '',
      jobContext.jdText ? `岗位说明：${String(jobContext.jdText).slice(0, 200)}` : '',
      jobContext.customRequirement ? `## 岗位附加要求（内部参考）\n${jobContext.customRequirement}` : '',
      jobContext.enterpriseKnowledge ? `## 企业知识库\n${jobContext.enterpriseKnowledge}` : '',
      `## 候选人：${candidateName}`,
      '',
      '## 最近对话',
      recentMessages,
      '',
      '## 复聊上下文',
      `当前是第 ${roundNumber} 次复聊（已连续发送 ${consecutiveOutbound} 条未获回复）`,
      `最后一条消息状态：${lastReadStatus || '未知'}`,
      missingInfoText,
      '',
      '## 复聊策略',
      readStatusGuide,
      roundNumber === 1
        ? '第1次复聊：可适当补充岗位亮点或换角度切入。'
        : '第2次复聊：降低门槛，直接邀请候选人提供缺失信息或简单回复。',
      missingInfo.length > 0 ? `引导方向：优先引导候选人提供${missingInfo.includes('resume') ? '简历' : missingInfo.map((i) => ({ phone: '电话', wechat: '微信' }[i] || i)).join('或')}。` : '',
      '',
      '## 要求',
      '- 使用 BOSS直聘聊天口吻，像真人招聘顾问即时沟通。',
      '- 优先短句、口语化。',
      '- 避免 AI/书面分析腔和模板化开场。',
      '- 只能使用上面明确提供的岗位信息，不要脑补。',
      '- 禁止输出 `[工作地点]`、`[薪资]` 等占位符。',
      '- 岗位附加要求仅用于内部判断，不要机械复述给候选人。',
      '- action 为 reply 时必须提供 replyText。',
      '- action 为 skip 仅在认为继续复聊完全不合适时使用。',
      '',
      '返回纯 JSON：{"action":"reply"|"skip","replyText":"复聊消息内容","reason":"简要原因"}'
    ].filter(Boolean).join('\n');

    const raw = await this.llmEvaluator.chat({ systemPrompt, userPrompt });
    return parseChatDecision(raw);
  }

  async #persistFollowupCandidateProfile({
    runId,
    jobKey,
    encryptUid,
    candidateName,
    candidateId,
    status,
    resumePanel,
    resumeProfile,
    filterGate = null,
    followupDecision = null
  }) {
    try {
      const existing = candidateId && this.agentService.getCandidatePersistence
        ? await this.agentService.getCandidatePersistence(candidateId)
        : null;
      const upsertResult = await this.agentService.upsertCandidate({
        runId,
        eventId: `followup-loop-candidate-profile:${runId}:${encryptUid}`,
        occurredAt: new Date().toISOString(),
        jobKey,
        bossEncryptGeekId: encryptUid,
        name: resumeProfile?.name || candidateName || null,
        city: resumeProfile?.city || null,
        education: resumeProfile?.degree || null,
        experience: resumeProfile?.experience || null,
        school: resumeProfile?.school || null,
        status: status || 'greeted',
        metadata: buildFollowupCandidateMetadata({
          existing,
          resumePanel,
          resumeProfile,
          filterGate,
          followupDecision
        })
      });
      return upsertResult?.candidateId || candidateId || null;
    } catch (error) {
      return candidateId || null;
    }
  }

  async #handleResumeConsentIfNeeded({ runId, encryptUid, candidateName, stats, runner }) {
    let consentState;
    try {
      consentState = await runner.inspectResumeConsentState({ runId });
    } catch (error) {
      return { accepted: false };
    }

    if (!consentState?.consentPending) {
      return { accepted: false };
    }

    try {
      const result = await runner.acceptResumeConsent({ runId });
      stats.consentAccepted += 1;

      await this.#recordEvent(runId, {
        eventId: `followup-loop-consent-accepted:${runId}:${encryptUid}`,
        eventType: 'resume_consent_accepted',
        stage: 'followup_loop',
        message: `accepted resume consent from ${candidateName}`,
        payload: {
          encryptUid,
          candidateName,
          source: consentState.source,
          attachmentAppeared: result?.attachmentAppeared || false
        }
      });

      return { accepted: true, attachmentAppeared: result?.attachmentAppeared || false };
    } catch (error) {
      await this.#recordEvent(runId, {
        eventId: `followup-loop-consent-error:${runId}:${encryptUid}`,
        eventType: 'followup_loop_warning',
        stage: 'followup_loop',
        message: `resume consent accept failed: ${error.message}`,
        payload: { error: error.message, encryptUid, candidateName }
      });
      return { accepted: false };
    }
  }

  async #executeResumeDownload({ runId, jobKey, encryptUid, candidateName, candidateId, stats, runner }) {

    // Step 1: Get preview metadata
    let previewMeta;
    try {
      previewMeta = await runner.getResumePreviewMeta({ runId });
    } catch (error) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-preview-error:${runId}:${encryptUid}`,
        eventType: 'followup_loop_error',
        stage: 'followup_loop',
        message: `resume preview meta failed: ${error.message}`,
        payload: { error: error.message, encryptUid }
      });
      return;
    }

    const bossAttachmentId = previewMeta?.encryptResumeId || previewMeta?.encryptGeekId || null;

    // Step 2: Record attachment discovered
    try {
      await this.agentService.recordAttachment({
        runId,
        candidateId,
        eventId: `followup-loop-att-discovered:${runId}:${encryptUid}`,
        occurredAt: new Date().toISOString(),
        jobKey,
        bossEncryptGeekId: encryptUid,
        bossAttachmentId,
        status: 'discovered'
      });
    } catch (error) {
      // Non-fatal
    }

    // Step 3: Download the PDF
    const fileName = `${candidateName}_${encryptUid}.pdf`;
    const outputPath = path.join(this.projectRoot, 'resumes', jobKey, fileName);
    let downloadResult;
    try {
      downloadResult = await runner.resumeDownload({ runId, outputPath });
    } catch (error) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-download-error:${runId}:${encryptUid}`,
        eventType: 'followup_loop_error',
        stage: 'followup_loop',
        message: `resume download failed: ${error.message}`,
        payload: { error: error.message, encryptUid }
      });
      // Close resume detail page even on download failure
      await this.#closeResumeDetailSafe(runId, encryptUid, runner);
      return;
    }

    // Step 4: Verify download completion
    if (!downloadResult?.ok || !downloadResult?.fileName) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-download-incomplete:${runId}:${encryptUid}`,
        eventType: 'followup_loop_error',
        stage: 'followup_loop',
        message: `resume download incomplete for ${candidateName}`,
        payload: { encryptUid, downloadResult }
      });
      await this.#closeResumeDetailSafe(runId, encryptUid, runner);
      return;
    }

    // Step 5: Record attachment downloaded
    try {
      await this.agentService.recordAttachment({
        runId,
        candidateId,
        eventId: `followup-loop-att-downloaded:${runId}:${encryptUid}`,
        occurredAt: new Date().toISOString(),
        jobKey,
        bossEncryptGeekId: encryptUid,
        bossAttachmentId,
        fileName: downloadResult?.fileName || fileName,
        sha256: downloadResult?.sha256 || null,
        storedPath: `resumes/${jobKey}/${fileName}`,
        status: 'downloaded'
      });
    } catch (error) {
      // Non-fatal
    }

    // Step 6: Record resume_downloaded action
    try {
      await this.agentService.recordAction({
        runId,
        candidateId,
        eventId: `followup-loop-resume-dl:${runId}:${encryptUid}`,
        occurredAt: new Date().toISOString(),
        actionType: 'resume_downloaded',
        dedupeKey: `resume-download:${candidateId || encryptUid}:${bossAttachmentId || runId}`,
        jobKey,
        bossEncryptGeekId: encryptUid,
        payload: { storedPath: `resumes/${jobKey}/${fileName}`, source: 'deterministic_loop' }
      });
    } catch (error) {
      // Non-fatal
    }

    stats.resumeDownloaded += 1;

    await this.#recordEvent(runId, {
      eventId: `followup-loop-downloaded:${runId}:${encryptUid}`,
      eventType: 'resume_downloaded',
      stage: 'followup_loop',
      message: `resume downloaded for ${candidateName}`,
      payload: {
        encryptUid,
        candidateName,
        storedPath: `resumes/${jobKey}/${fileName}`,
        sha256: downloadResult?.sha256 || null
      }
    });

    // Step 7: Close resume detail page after successful download
    await this.#waitBeforeClosingResumePreview();
    await this.#closeResumeDetailSafe(runId, encryptUid, runner);
  }

  async #executeSendMessage({ runId, jobKey, encryptUid, candidateName, candidateId, text, stats, runner }) {
    try {
      const sendResult = await runner.sendChatMessage({ runId, text });
      if (!sendResult?.sent || sendResult?.verified !== true) {
        throw new Error(sendResult?.method || 'boss_chat_send_unverified');
      }

      stats.replied += 1;

      await this.agentService.recordMessage({
        runId,
        candidateId,
        eventId: `followup-loop-reply:${runId}:${encryptUid}`,
        occurredAt: new Date().toISOString(),
        jobKey,
        bossEncryptGeekId: encryptUid,
        bossMessageId: `auto:${runId}:outbound:${new Date().toISOString()}`,
        direction: 'outbound',
        messageType: 'text',
        contentText: text
      });
      return true;
    } catch (error) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-send-error:${runId}:${encryptUid}`,
        eventType: 'followup_loop_warning',
        stage: 'followup_loop',
        message: `reply send failed for ${candidateName}: ${error.message}`,
        payload: { encryptUid, candidateName, error: error.message }
      });
      return false;
    }
  }

  async #executeResumeRequest({ runId, jobKey, encryptUid, candidateName, candidateId, stats, runner }) {
    try {
      const resumeResult = await runner.clickRequestResume({ runId });
      if (!resumeResult?.requested || resumeResult?.confirmed !== true) {
        throw new Error('boss_chat_request_resume_unconfirmed');
      }

      const confirmed = resumeResult?.confirmed === true;
      stats.resumeRequested += 1;

      await this.agentService.recordAction({
        runId,
        candidateId,
        eventId: `followup-loop-resume-req:${runId}:${encryptUid}`,
        occurredAt: new Date().toISOString(),
        actionType: 'resume_request_sent',
        dedupeKey: `resume-request:${runId}:${encryptUid}`,
        jobKey,
        bossEncryptGeekId: encryptUid,
        payload: { candidateName, confirmed, source: 'deterministic_loop' }
      });

      await this.#recordEvent(runId, {
        eventId: `followup-loop-resume-requested:${runId}:${encryptUid}`,
        eventType: 'resume_request_sent',
        stage: 'followup_loop',
        message: `resume requested from ${candidateName} (confirmed=${confirmed})`,
        payload: { encryptUid, candidateName, confirmed }
      });
    } catch (error) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-resume-request-error:${runId}:${encryptUid}`,
        eventType: 'followup_loop_warning',
        stage: 'followup_loop',
        message: `resume request failed for ${candidateName}: ${error.message}`,
        payload: { encryptUid, candidateName, error: error.message }
      });
    }
  }

  async #executeExchangeAction({ runId, jobKey, encryptUid, candidateName, candidateId, actionType, stats, runner }) {
    const actionTextMap = {
      exchange_phone: '换电话',
      exchange_wechat: '换微信'
    };
    const actionText = actionTextMap[actionType];
    if (!actionText) return;

    try {
      const result = await runner.clickExchangeAction({ runId, actionText });
      if (!result?.confirmed) {
        throw new Error(`boss_chat_exchange_${actionType}_unconfirmed`);
      }

      await this.agentService.recordAction({
        runId,
        candidateId,
        eventId: `followup-loop-exchange-${actionType}:${runId}:${encryptUid}`,
        occurredAt: new Date().toISOString(),
        actionType: `${actionType}_sent`,
        dedupeKey: `${actionType}:${runId}:${encryptUid}`,
        jobKey,
        bossEncryptGeekId: encryptUid,
        payload: { candidateName, actionType, confirmed: true, source: 'deterministic_loop' }
      });

      await this.#recordEvent(runId, {
        eventId: `followup-loop-exchange-done:${runId}:${encryptUid}:${actionType}`,
        eventType: `${actionType}_sent`,
        stage: 'followup_loop',
        message: `${actionText} sent to ${candidateName}`,
        payload: { encryptUid, candidateName, actionType }
      });
    } catch (error) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-exchange-error:${runId}:${encryptUid}:${actionType}`,
        eventType: 'followup_loop_warning',
        stage: 'followup_loop',
        message: `${actionText} failed for ${candidateName}: ${error.message}`,
        payload: { encryptUid, candidateName, actionType, error: error.message }
      });
    }
  }

  async #requestResumeWhenReady({
    runId,
    jobKey,
    encryptUid,
    candidateName,
    candidateId,
    replyText,
    allowWarmupReply,
    stats,
    runner
  }) {
    let textToSend = replyText || '';
    const initialState = await this.#inspectResumeRequestStateSafe({ runId, runner });

    if (!textToSend && allowWarmupReply && initialState?.disabled) {
      textToSend = this.#buildResumeRequestWarmupReply();
    }

    if (textToSend) {
      const replySent = await this.#executeSendMessage({
        runId,
        jobKey,
        encryptUid,
        candidateName,
        candidateId,
        text: textToSend,
        stats,
        runner
      });
      if (!replySent) {
        return false;
      }
    }

    const readyState = await this.#waitForResumeRequestEnabled({
      runId,
      runner,
      initialState: textToSend ? null : initialState
    });

    if (!readyState?.enabled) {
      stats.errors += 1;
      await this.#recordEvent(runId, {
        eventId: `followup-loop-resume-request-blocked:${runId}:${encryptUid}`,
        eventType: 'followup_loop_warning',
        stage: 'followup_loop',
        message: `resume request blocked for ${candidateName}: ${readyState?.hintText || readyState?.reason || 'button_not_enabled'}`,
        payload: {
          encryptUid,
          candidateName,
          state: readyState || null
        }
      });
      return false;
    }

    await this.#executeResumeRequest({
      runId,
      jobKey,
      encryptUid,
      candidateName,
      candidateId,
      stats,
      runner
    });
    return true;
  }

  async #inspectResumeRequestStateSafe({ runId, runner }) {
    try {
      return await runner.inspectResumeRequestState({ runId });
    } catch (error) {
      return { ok: false, enabled: false, disabled: false, reason: error.message };
    }
  }

  async #waitForResumeRequestEnabled({ runId, runner, initialState = null, attempts = 20, intervalMs = 500 }) {
    let state = initialState;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!state || attempt > 0) {
        state = await this.#inspectResumeRequestStateSafe({ runId, runner });
      }

      if (state?.enabled) {
        return state;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return state;
  }

  #buildResumeRequestWarmupReply() {
    return '您好，方便的话也可以发我一份简历，我进一步看下。';
  }

  async #syncAllThreadMessages({ runId, jobKey, encryptUid, candidateId, candidateName, messages }) {
    if (!messages || messages.length === 0) return 0;

    let synced = 0;
    const duplicateCounters = new Map();
    const syncedAt = new Date();

    for (let index = 0; index < messages.length; index += 1) {
      const msg = messages[index];
      if (!msg.text) continue;
      const direction = msg.from === 'me' ? 'outbound' : 'inbound';
      const stableId = buildThreadMessageStableId({
        encryptUid,
        direction,
        msg,
        duplicateCounters
      });

      try {
        const result = await this.agentService.recordMessage({
          runId,
          candidateId,
          eventId: `followup-sync:${runId}:${stableId}`,
          occurredAt: buildThreadMessageOccurredAt({
            syncedAt,
            index,
            total: messages.length
          }),
          jobKey,
          bossEncryptGeekId: encryptUid,
          bossMessageId: stableId,
          direction,
          messageType: msg.type || 'text',
          contentText: msg.text,
          rawPayload: {
            source: 'followup_visible_thread_sync',
            displayTimeText: msg.time || '',
            domKey: msg.domKey || null,
            visibleIndex: index
          },
          skipCandidateStateUpdate: true
        });

        if (!result?.duplicated) {
          synced += 1;
        }
      } catch (error) {
        // Non-fatal: ON CONFLICT DO NOTHING handles duplicates
      }
    }

    if (synced > 0) {
      await this.#recordEvent(runId, {
        eventId: `followup-sync-done:${runId}:${encryptUid}`,
        eventType: 'messages_synced',
        stage: 'followup_loop',
        message: `synced ${synced}/${messages.length} messages for ${candidateName || encryptUid}`,
        payload: { encryptUid, candidateName, synced, total: messages.length }
      });
    }

    return synced;
  }

  async #resolveCandidateId({ encryptUid }) {
    try {
      const candidate = await this.agentService.findLatestCandidateByGeekId(encryptUid);
      return candidate?.id || null;
    } catch (error) {
      return null;
    }
  }

  async #failRun(runId, message, stats) {
    await this.#recordEvent(runId, {
      eventId: `followup-loop-fail:${runId}`,
      eventType: 'followup_loop_failed',
      stage: 'followup_loop',
      message,
      payload: { ...stats }
    });

    await this.agentService.failRun({ runId, message, payload: { ...stats } });
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
      // Non-fatal
    }
  }

  async #closeResumeDetailSafe(runId, encryptUid, runner) {
    try {
      await runner.closeResumeDetail({ runId });
    } catch (error) {
      await this.#recordEvent(runId, {
        eventId: `followup-loop-close-detail-warn:${runId}:${encryptUid}`,
        eventType: 'followup_loop_warning',
        stage: 'followup_loop',
        message: `close resume detail failed: ${error.message}`,
        payload: { error: error.message, encryptUid }
      });
    }
  }

  async #waitBeforeClosingResumePreview() {
    if (this.resumePreviewCloseDelayMax <= 0) {
      return;
    }

    const minDelay = Math.max(0, this.resumePreviewCloseDelayMin);
    const maxDelay = Math.max(minDelay, this.resumePreviewCloseDelayMax);
    const dwellMs = minDelay + Math.random() * (maxDelay - minDelay);
    if (dwellMs <= 0) {
      return;
    }

    await this.sleep(dwellMs);
  }

  async #resetChatPageAfterCompletion({ runId, runner }) {
    try {
      await runner.navigateTo({
        runId,
        url: 'https://www.zhipin.com/web/chat/index',
        force: true
      });
    } catch (error) {
      await this.#recordEvent(runId, {
        eventId: `followup-loop-reset-warn:${runId}`,
        eventType: 'followup_loop_warning',
        stage: 'followup_loop',
        message: `final chat reset failed: ${error.message}`,
        payload: { error: error.message }
      });
    }
  }
}

function extractJobNameShort(fullJobName) {
  if (!fullJobName) {
    return '';
  }

  const match = fullJobName.match(/^([^（(]+)/);
  return match ? match[1].trim() : fullJobName.trim();
}

function contentHash(text) {
  return crypto.createHash('md5').update(text || '').digest('hex').slice(0, 12);
}

function buildThreadMessageStableId({ encryptUid, direction, msg, duplicateCounters }) {
  const domKey = typeof msg?.domKey === 'string' ? msg.domKey.trim() : '';
  if (domKey) {
    return `thread:${encryptUid}:${direction}:dom:${contentHash(domKey)}`;
  }

  // Do NOT include msg.time — it is a relative display string ("刚刚", "1分钟前")
  // that changes between reads, causing duplicate DB entries.
  const signature = `${direction}:${contentHash(msg?.text || '')}`;
  const nextCount = (duplicateCounters.get(signature) || 0) + 1;
  duplicateCounters.set(signature, nextCount);
  return `thread:${encryptUid}:${signature}:${nextCount}`;
}

function buildThreadMessageOccurredAt({ syncedAt, index, total }) {
  const baseTime = syncedAt instanceof Date ? syncedAt.getTime() : Date.now();
  const remaining = Math.max(total - index, 1);
  return new Date(baseTime - remaining * 1000).toISOString();
}

function buildVisibleThreadKey(thread) {
  if (!thread || typeof thread !== 'object') {
    return '';
  }
  if (thread.encryptUid) {
    return `uid:${thread.encryptUid}`;
  }
  if (thread.dataId) {
    return `data:${thread.dataId}`;
  }
  if (thread.name) {
    return `name:${thread.name}`;
  }
  return `idx:${thread.index ?? ''}`;
}

function buildFilterProfileEvidence(resumePanel) {
  if (!resumePanel || typeof resumePanel !== 'object') {
    return null;
  }

  return {
    name: normalizeString(resumePanel.name),
    gender: normalizeString(resumePanel.gender),
    city: extractExpectedCity(resumePanel.expect),
    age: normalizeString(resumePanel.age),
    experience: normalizeString(resumePanel.experience),
    degree: normalizeString(resumePanel.degree),
    activeTime: normalizeString(resumePanel.activeTime),
    expect: normalizeString(resumePanel.expect),
    school: extractSchoolName(resumePanel.education),
    jobChatting: normalizeString(resumePanel.jobChatting)
  };
}

function buildResumePanelProfile({ resumePanel, fallbackName, fallbackCity }) {
  if (!resumePanel || typeof resumePanel !== 'object') {
    return fallbackName || fallbackCity
      ? {
        name: normalizeString(fallbackName),
        city: normalizeString(fallbackCity)
      }
      : null;
  }

  const profile = buildFilterProfileEvidence(resumePanel) || {};
  return {
    ...profile,
    name: profile.name || normalizeString(fallbackName),
    city: profile.city || normalizeString(fallbackCity)
  };
}

function buildFollowupCandidateMetadata({ existing, resumePanel, resumeProfile, filterGate, followupDecision }) {
  const metadata = deepMergeObjects(
    {},
    existing?.profileMetadata,
    existing?.workflowMetadata,
    { source: 'deterministic_followup_loop' }
  );

  if (resumeProfile) {
    metadata.profile = resumeProfile;
  }

  if (resumePanel && typeof resumePanel === 'object') {
    metadata.resumePanel = {
      name: normalizeString(resumePanel.name),
      gender: normalizeString(resumePanel.gender),
      age: normalizeString(resumePanel.age),
      experience: normalizeString(resumePanel.experience),
      degree: normalizeString(resumePanel.degree),
      activeTime: normalizeString(resumePanel.activeTime),
      workHistory: Array.isArray(resumePanel.workHistory) ? resumePanel.workHistory.slice(0, 10) : [],
      education: Array.isArray(resumePanel.education) ? resumePanel.education.slice(0, 10) : [],
      jobChatting: normalizeString(resumePanel.jobChatting),
      expect: normalizeString(resumePanel.expect),
      resumeReadAt: new Date().toISOString()
    };
  }

  if (filterGate) {
    metadata.filterGate = {
      definitiveMismatch: Boolean(filterGate.definitiveMismatch),
      reasons: Array.isArray(filterGate.reasons) ? filterGate.reasons : [],
      unsupportedFilters: Array.isArray(filterGate.unsupportedFilters) ? filterGate.unsupportedFilters : []
    };
  }

  if (followupDecision) {
    metadata.followupDecision = followupDecision;
  }

  return metadata;
}

function evaluateRecommendFilters(filters, resumePanel) {
  if (!filters || typeof filters !== 'object') {
    return { definitiveMismatch: false, reasons: [], unsupportedFilters: [] };
  }

  const reasons = [];
  const unsupportedFilters = [];
  const profile = buildFilterProfileEvidence(resumePanel);

  if (!profile) {
    return { definitiveMismatch: false, reasons, unsupportedFilters };
  }

  const genderFilter = normalizeString(filters.gender);
  if (genderFilter && profile.gender && profile.gender !== genderFilter) {
    reasons.push('gender_mismatch');
  }

  const age = parseAge(profile.age);
  const ageMin = Number(filters.ageMin);
  const ageMax = Number(filters.ageMax);
  if (Number.isFinite(age) && Number.isFinite(ageMin) && ageMin > 16 && age < ageMin) {
    reasons.push('age_min_mismatch');
  }
  if (Number.isFinite(age) && Number.isFinite(ageMax) && ageMax < 99 && age > ageMax) {
    reasons.push('age_max_mismatch');
  }

  const degreeFilters = normalizeFilterArray(filters.degree);
  if (degreeFilters.length > 0 && profile.degree && !degreeFilters.includes(profile.degree)) {
    reasons.push('degree_mismatch');
  }

  const experienceFilters = normalizeFilterArray(filters.experience);
  if (experienceFilters.length > 0 && profile.experience && !experienceFilters.includes(profile.experience)) {
    reasons.push('experience_mismatch');
  }

  const activityFilter = normalizeString(filters.activity);
  if (activityFilter && profile.activeTime && !matchesActivityFilter(profile.activeTime, activityFilter)) {
    reasons.push('activity_mismatch');
  }

  const salaryFilter = normalizeString(filters.salary);
  if (salaryFilter && profile.expect && !matchesSalaryFilter(profile.expect, salaryFilter)) {
    reasons.push('salary_mismatch');
  }

  for (const key of FOLLOWUP_UNSUPPORTED_FILTER_KEYS) {
    if (hasMeaningfulFilterValue(filters[key])) {
      unsupportedFilters.push(key);
    }
  }

  return {
    definitiveMismatch: reasons.length > 0,
    reasons,
    unsupportedFilters
  };
}

function normalizeFilterArray(value) {
  return Array.isArray(value)
    ? value.map(normalizeString).filter(Boolean).filter((item) => item !== '不限')
    : [];
}

function hasMeaningfulFilterValue(value) {
  if (Array.isArray(value)) {
    return value.some((item) => normalizeString(item) && normalizeString(item) !== '不限');
  }

  return Boolean(normalizeString(value) && normalizeString(value) !== '不限');
}

function normalizeString(value) {
  return String(value || '').trim();
}

function parseAge(text) {
  const match = normalizeString(text).match(/(\d{2})岁/);
  return match ? Number(match[1]) : Number.NaN;
}

function matchesActivityFilter(activeTime, filterValue) {
  const actualRank = ACTIVITY_RANKS.get(normalizeString(activeTime));
  const filterRank = ACTIVITY_RANKS.get(normalizeString(filterValue));
  if (!actualRank || !filterRank) {
    return true;
  }
  return actualRank <= filterRank;
}

function matchesSalaryFilter(expectText, filterValue) {
  const actual = parseSalaryRange(expectText);
  const filter = parseSalaryRange(filterValue);
  if (!actual || !filter) {
    return true;
  }

  return actual.min <= filter.max && actual.max >= filter.min;
}

function parseSalaryRange(text) {
  const normalized = normalizeString(text).toUpperCase();
  if (!normalized) {
    return null;
  }

  const rangeMatch = normalized.match(SALARY_RANGE_PATTERN);
  if (rangeMatch) {
    const [, min, max] = rangeMatch;
    return { min: Number(min), max: Number(max) };
  }

  const belowMatch = normalized.match(SALARY_BELOW_PATTERN);
  if (belowMatch) {
    const [, max] = belowMatch;
    return { min: 0, max: Number(max) };
  }

  const aboveMatch = normalized.match(SALARY_ABOVE_PATTERN);
  if (aboveMatch) {
    const [, min] = aboveMatch;
    return { min: Number(min), max: Number.MAX_SAFE_INTEGER };
  }

  return null;
}

function extractExpectedCity(expectText) {
  const normalized = normalizeString(expectText);
  if (!normalized) {
    return '';
  }

  return normalized.split(/\s+/)[0] || '';
}

function extractSchoolName(educationItems) {
  const items = Array.isArray(educationItems) ? educationItems : [];
  for (const item of items) {
    const normalized = normalizeString(item);
    if (!normalized) {
      continue;
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (/\d{4}-\d{4}|\d{4}-至今|\d{4}/.test(token)) {
        continue;
      }
      if (['博士', '硕士', '本科', '大专', '高中', '中专', '中技', '初中'].includes(token)) {
        continue;
      }
      return token;
    }
  }

  return '';
}

function deepMergeObjects(...values) {
  const result = {};

  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }

    for (const [key, fieldValue] of Object.entries(value)) {
      if (Array.isArray(fieldValue)) {
        result[key] = fieldValue.slice();
        continue;
      }

      if (fieldValue && typeof fieldValue === 'object') {
        result[key] = deepMergeObjects(result[key], fieldValue);
        continue;
      }

      result[key] = fieldValue;
    }
  }

  return result;
}

function parseChatDecision(raw) {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const decision = JSON.parse(cleaned);
    const action = String(decision.action || '').toLowerCase();

    if (!['reply', 'request_resume', 'skip'].includes(action)) {
      return { action: 'skip', replyText: '', reason: 'invalid_action', requirementEvidence: [] };
    }

    return {
      action,
      replyText: String(decision.replyText || ''),
      reason: String(decision.reason || ''),
      requirementEvidence: normalizeRequirementEvidence(decision.requirementEvidence)
    };
  } catch (error) {
    return { action: 'skip', replyText: '', reason: `parse_failed:${error.message}`, requirementEvidence: [] };
  }
}

function normalizeRequirementEvidence(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .slice(0, 3);
}

function parseLastTimeDaysAgo(lastTimeText) {
  const text = normalizeString(lastTimeText);
  if (!text) return -1;

  // Time like "21:26" or "12:03" = today
  if (/^\d{1,2}:\d{2}$/.test(text)) return 0;

  // "昨天" = yesterday
  if (text === '昨天') return 1;

  // "MM月DD日" format like "04月13日"
  const dateMatch = text.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1], 10);
    const day = parseInt(dateMatch[2], 10);
    const now = new Date();
    const year = now.getFullYear();
    const targetDate = new Date(year, month - 1, day);
    const today = new Date(year, now.getMonth(), now.getDate());
    const diffMs = today.getTime() - targetDate.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    // Handle year boundary: if target date is in the future, it was last year
    return diffDays >= 0 ? diffDays : diffDays + 365;
  }

  return -1;
}

function hasConsecutiveUnrepliedMessages(messages, threshold = 3) {
  if (!Array.isArray(messages) || messages.length === 0) return false;

  let consecutiveOutbound = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].from === 'me') {
      consecutiveOutbound += 1;
    } else {
      break;
    }
  }

  return consecutiveOutbound >= threshold;
}

function buildLlmEvaluationMessage({ action, candidateName, reason, requirementEvidence }) {
  const evidence = Array.isArray(requirementEvidence) ? requirementEvidence.filter(Boolean) : [];
  const basisText = evidence.length > 0 ? ` 依据: ${evidence.join('；')}` : '';
  return `LLM ${action}: ${candidateName} ${reason}${basisText}`.trim();
}

function countConsecutiveOutbound(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].from === 'me') {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function findLastOutboundMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].from === 'me') return messages[i];
  }
  return null;
}

function isWithinActiveHours(startHour, endHour) {
  const now = new Date();
  const hour = now.getHours();
  return hour >= startHour && hour < endHour;
}

function isRequiredInfoCollected(collectedInfo, requiredInfo, logic) {
  if (!Array.isArray(requiredInfo) || requiredInfo.length === 0) return false;
  if (logic === 'all') {
    return requiredInfo.every((key) => Boolean(collectedInfo[key]));
  }
  return requiredInfo.some((key) => Boolean(collectedInfo[key]));
}

function getMissingRequiredInfo(collectedInfo, requiredInfo) {
  if (!Array.isArray(requiredInfo)) return [];
  return requiredInfo.filter((key) => !collectedInfo[key]);
}

module.exports = {
  FollowupLoopService,
  parseChatDecision,
  extractJobNameShort,
  parseLastTimeDaysAgo,
  hasConsecutiveUnrepliedMessages,
  countConsecutiveOutbound,
  findLastOutboundMessage,
  isWithinActiveHours,
  isRequiredInfoCollected,
  getMissingRequiredInfo
};
