const path = require('node:path');

class FollowupLoopService {
  constructor({
    bossCliRunner,
    agentService,
    llmEvaluator,
    projectRoot = path.resolve(__dirname, '..', '..'),
    maxThreads = 20,
    threadDelayMin = 2_000,
    threadDelayMax = 5_000
  }) {
    this.bossCliRunner = bossCliRunner;
    this.agentService = agentService;
    this.llmEvaluator = llmEvaluator;
    this.projectRoot = projectRoot;
    this.maxThreads = maxThreads;
    this.threadDelayMin = threadDelayMin;
    this.threadDelayMax = threadDelayMax;
  }

  async run({ runId, jobKey, mode = 'followup', maxThreads: overrideMaxThreads, interactionTypes, bossCliRunner: runnerOverride, signal } = {}) {
    const runner = runnerOverride || this.bossCliRunner;
    const effectiveMaxThreads = overrideMaxThreads || this.maxThreads;
    const effectiveInteractionTypes = Array.isArray(interactionTypes) && interactionTypes.length > 0
      ? interactionTypes
      : ['request_resume'];
    return this.#runImpl({ runId, jobKey, mode, effectiveMaxThreads, effectiveInteractionTypes, runner, signal });
  }

  async #runImpl({ runId, jobKey, mode, effectiveMaxThreads, effectiveInteractionTypes, runner, signal }) {
    const stats = {
      processed: 0,
      replied: 0,
      resumeRequested: 0,
      consentAccepted: 0,
      attachmentFound: 0,
      resumeDownloaded: 0,
      skipped: 0,
      errors: 0
    };

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
        url: 'https://www.zhipin.com/web/chat/index'
      });
    } catch (error) {
      await this.#failRun(runId, `chat_page_navigation_failed:${error.message}`, stats);
      return { ok: false, stats, reason: 'chat_page_unavailable' };
    }

    // Phase 3: Select job filter
    try {
      const jobNameShort = extractJobNameShort(jobContext.jobName);
      await runner.selectChatJobFilter({ runId, jobName: jobNameShort });

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

    // Phase 5: Read visible unread list from DOM
    let threads;
    try {
      const listResult = await runner.inspectVisibleChatList({
        runId,
        limit: effectiveMaxThreads
      });
      threads = Array.isArray(listResult?.threads) ? listResult.threads : [];
    } catch (error) {
      await this.#failRun(runId, `visible_list_failed:${error.message}`, stats);
      return { ok: false, stats, reason: 'visible_list_unavailable' };
    }

    if (threads.length === 0) {
      await this.#recordEvent(runId, {
        eventId: `followup-loop-empty:${runId}`,
        eventType: 'followup_loop_empty',
        stage: 'followup_loop',
        message: 'no unread threads visible',
        payload: { jobKey }
      });
      await this.#resetChatPageAfterCompletion({ runId, runner });
      await this.agentService.completeRun({
        runId,
        payload: { ...stats, reason: 'no_unread_threads' }
      });
      return { ok: true, stats };
    }

    await this.#recordEvent(runId, {
      eventId: `followup-loop-threads:${runId}`,
      eventType: 'followup_loop_threads_found',
      stage: 'followup_loop',
      message: `found ${threads.length} visible threads`,
      payload: { threadCount: threads.length, threads: threads.map((t) => ({ name: t.name, dataId: t.dataId, index: t.index })) }
    });

    // Phase 6: Process each thread with anti-risk delays
    for (let i = 0; i < threads.length; i++) {
      if (signal?.aborted) break;
      const thread = threads[i];
      if (stats.processed >= effectiveMaxThreads) {
        break;
      }

      // Random delay between threads to avoid detection
      if (i > 0) {
        const delayMs = this.threadDelayMin + Math.random() * (this.threadDelayMax - this.threadDelayMin);
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        // Random longer idle every 3-5 threads to mimic human browsing rhythm
        if (this.threadDelayMin > 0 && i % (3 + Math.floor(Math.random() * 3)) === 0) {
          const idleMs = 8_000 + Math.random() * 15_000;
          await new Promise((resolve) => setTimeout(resolve, idleMs));
        }
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

    // Phase 7: Complete
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

  async #processOneThread({ runId, jobKey, jobContext, thread, mode, interactionTypes, stats, runner }) {
    const threadId = thread.dataId || `idx-${thread.index}`;

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
    let threadState;
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

    const encryptUid = threadState.encryptUid || threadState.activeUid || threadId;

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
        status: 'in_conversation',
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
      const msgResult = await runner.readOpenThreadMessages({ runId });
      messages = Array.isArray(msgResult?.messages) ? msgResult.messages : [];
    } catch (error) {
      stats.errors += 1;
      return;
    }

    if (messages.length === 0) {
      stats.skipped += 1;
      return;
    }

    // Step 6: Check if last message is from candidate (inbound)
    const lastMessage = messages[messages.length - 1];
    const lastMessageFromCandidate = lastMessage && lastMessage.from !== 'me';

    if (!lastMessageFromCandidate) {
      stats.skipped += 1;
      return;
    }

    // Step 7: Record inbound message
    await this.#recordInboundMessage({
      runId,
      jobKey,
      encryptUid,
      candidateId,
      message: lastMessage
    });

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
      '- 只能使用上面明确提供的岗位信息；如果缺少地点、薪资、班次等信息，就不要写。',
      '- 禁止输出`[工作地点]`、`[薪资]`这类占位符，也不要自行脑补未提供的信息。',
      '',
      '返回纯 JSON：{"action":"reply"|"request_resume"|"skip","replyText":"回复内容(reply 和 request_resume 时需要)","reason":"简要原因"}'
    ].filter(Boolean).join('\n');

    const raw = await this.llmEvaluator.chat({ systemPrompt, userPrompt });
    return parseChatDecision(raw);
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

  async #recordInboundMessage({ runId, jobKey, encryptUid, candidateId, message }) {
    if (!message) {
      return;
    }

    try {
      await this.agentService.recordMessage({
        runId,
        candidateId,
        eventId: `followup-loop-inbound:${runId}:${encryptUid}:${message.time || Date.now()}`,
        occurredAt: new Date().toISOString(),
        jobKey,
        bossEncryptGeekId: encryptUid,
        bossMessageId: `auto:${runId}:inbound:${message.time || new Date().toISOString()}`,
        direction: 'inbound',
        messageType: message.type || 'text',
        contentText: message.text || ''
      });
    } catch (error) {
      // Non-fatal
    }
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

  async #resetChatPageAfterCompletion({ runId, runner }) {
    try {
      await runner.navigateTo({
        runId,
        url: 'https://www.zhipin.com/web/chat/index'
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

function parseChatDecision(raw) {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const decision = JSON.parse(cleaned);
    const action = String(decision.action || '').toLowerCase();

    if (!['reply', 'request_resume', 'skip'].includes(action)) {
      return { action: 'skip', replyText: '', reason: 'invalid_action' };
    }

    return {
      action,
      replyText: String(decision.replyText || ''),
      reason: String(decision.reason || '')
    };
  } catch (error) {
    return { action: 'skip', replyText: '', reason: `parse_failed:${error.message}` };
  }
}

module.exports = {
  FollowupLoopService,
  parseChatDecision,
  extractJobNameShort
};
