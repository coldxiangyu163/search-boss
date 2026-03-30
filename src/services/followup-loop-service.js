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

  async run({ runId, jobKey, mode = 'followup', maxThreads: overrideMaxThreads } = {}) {
    const effectiveMaxThreads = overrideMaxThreads || this.maxThreads;
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
      await this.bossCliRunner.bindTarget({
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
      await this.bossCliRunner.bringToFront({ runId });
    } catch (error) {
      // Non-fatal
    }

    // Phase 2: Always reset to chat initial URL to clear stale thread state
    try {
      await this.bossCliRunner.navigateTo({
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
      await this.bossCliRunner.selectChatJobFilter({ runId, jobName: jobNameShort });

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
      await this.bossCliRunner.selectChatUnreadFilter({ runId });

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
      const listResult = await this.bossCliRunner.inspectVisibleChatList({
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
      await this.#resetChatPageAfterCompletion({ runId });
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
      const thread = threads[i];
      if (stats.processed >= effectiveMaxThreads) {
        break;
      }

      // Random delay between threads to avoid detection
      if (i > 0) {
        const delayMs = this.threadDelayMin + Math.random() * (this.threadDelayMax - this.threadDelayMin);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      await this.#processOneThread({
        runId,
        jobKey,
        jobContext,
        thread,
        mode,
        stats
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

    // Phase 7: Complete
    const summary = { ...stats };

    await this.#recordEvent(runId, {
      eventId: `followup-loop-done:${runId}`,
      eventType: 'followup_loop_completed',
      stage: 'followup_loop',
      message: 'deterministic followup loop finished',
      payload: summary
    });

    await this.#resetChatPageAfterCompletion({ runId });
    await this.agentService.completeRun({ runId, payload: summary });

    return { ok: true, stats: summary };
  }

  async #processOneThread({ runId, jobKey, jobContext, thread, mode, stats }) {
    const threadId = thread.dataId || `idx-${thread.index}`;

    // Step 1: Click the row in the left-side chat list
    try {
      await this.bossCliRunner.clickChatRow({
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
      threadState = await this.bossCliRunner.inspectChatThreadState({ runId });
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
    await this.#handleResumeConsentIfNeeded({ runId, encryptUid, candidateName: thread.name, stats });

    // Step 3: Check attachment state
    let attachmentState;
    try {
      attachmentState = await this.bossCliRunner.inspectAttachmentState({ runId });
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
          stats
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
      const msgResult = await this.bossCliRunner.readOpenThreadMessages({ runId });
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

    // Step 10a: Send reply if LLM provided one
    if (decision.replyText) {
      await this.#executeSendMessage({
        runId, jobKey, encryptUid,
        candidateName: thread.name, candidateId,
        text: decision.replyText, stats
      });
    }

    // Step 10b: Always request resume after replying if not yet received
    if (attachmentState.buttonDisabled) {
      await this.#executeResumeRequest({
        runId, jobKey, encryptUid,
        candidateName: thread.name, candidateId, stats
      });
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
      `## 候选人：${candidateName}`,
      '',
      '## 最近对话',
      recentMessages,
      '',
      '## 判断要求',
      `可选动作：${actions.join(', ')}`,
      '- reply：需要回复候选人（附带 replyText，简洁专业）',
      canRequestResume ? '- request_resume：候选人态度积极且已有实质沟通，可以索要简历' : '',
      '- skip：不需要回复（对方只是已读、表情、或无实质内容）',
      '- 只能使用上面明确提供的岗位信息；如果缺少地点、薪资、班次等信息，就不要写。',
      '- 禁止输出`[工作地点]`、`[薪资]`这类占位符，也不要自行脑补未提供的信息。',
      '',
      '返回纯 JSON：{"action":"reply"|"request_resume"|"skip","replyText":"回复内容(仅reply时需要)","reason":"简要原因"}'
    ].filter(Boolean).join('\n');

    const raw = await this.llmEvaluator.chat({ systemPrompt, userPrompt });
    return parseChatDecision(raw);
  }

  async #handleResumeConsentIfNeeded({ runId, encryptUid, candidateName, stats }) {
    let consentState;
    try {
      consentState = await this.bossCliRunner.inspectResumeConsentState({ runId });
    } catch (error) {
      return;
    }

    if (!consentState?.consentPending) {
      return;
    }

    try {
      const result = await this.bossCliRunner.acceptResumeConsent({ runId });
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
    } catch (error) {
      await this.#recordEvent(runId, {
        eventId: `followup-loop-consent-error:${runId}:${encryptUid}`,
        eventType: 'followup_loop_warning',
        stage: 'followup_loop',
        message: `resume consent accept failed: ${error.message}`,
        payload: { error: error.message, encryptUid, candidateName }
      });
    }
  }

  async #executeResumeDownload({ runId, jobKey, encryptUid, candidateName, candidateId, stats }) {

    // Step 1: Get preview metadata
    let previewMeta;
    try {
      previewMeta = await this.bossCliRunner.getResumePreviewMeta({ runId });
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
      downloadResult = await this.bossCliRunner.resumeDownload({ runId, outputPath });
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
      await this.#closeResumeDetailSafe(runId, encryptUid);
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
      await this.#closeResumeDetailSafe(runId, encryptUid);
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
    await this.#closeResumeDetailSafe(runId, encryptUid);
  }

  async #executeSendMessage({ runId, jobKey, encryptUid, candidateName, candidateId, text, stats }) {
    try {
      await this.bossCliRunner.sendChatMessage({ runId, text });
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
    } catch (error) {
      stats.errors += 1;
    }
  }

  async #executeResumeRequest({ runId, jobKey, encryptUid, candidateName, candidateId, stats }) {
    try {
      const resumeResult = await this.bossCliRunner.clickRequestResume({ runId });
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
    }
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

  async #closeResumeDetailSafe(runId, encryptUid) {
    try {
      await this.bossCliRunner.closeResumeDetail({ runId });
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

  async #resetChatPageAfterCompletion({ runId }) {
    try {
      await this.bossCliRunner.navigateTo({
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
