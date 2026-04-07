const test = require('node:test');
const assert = require('node:assert/strict');

const { FollowupLoopService, parseChatDecision, extractJobNameShort } = require('../src/services/followup-loop-service');

function createMockBossCliRunner({
  visibleThreads = [],
  threadStates = {},
  attachmentStates = {},
  resumeRequestStates = {},
  consentStateMap = {},
  messageResults = {},
  previewMeta = {},
  downloadResults = {},
  bindResult = { ok: true, session: { targetId: 'tab-1' } },
  inspectResult = { ok: true, currentUrl: 'https://www.zhipin.com/web/chat/index' }
} = {}) {
  const calls = [];
  let lastClickedDataId = '';
  const resumeRequestStateQueues = new Map(
    Object.entries(resumeRequestStates).map(([key, value]) => [key, Array.isArray(value) ? value.slice() : value])
  );

  return {
    calls,
    async bindTarget(opts) {
      calls.push({ command: 'bindTarget', ...opts });
      return bindResult;
    },
    async inspectTarget(opts) {
      calls.push({ command: 'inspectTarget', ...opts });
      return inspectResult;
    },
    async navigateTo(opts) {
      calls.push({ command: 'navigateTo', ...opts });
      return { ok: true, url: 'https://www.zhipin.com/web/chat/index' };
    },
    async selectChatJobFilter(opts) {
      calls.push({ command: 'selectChatJobFilter', ...opts });
      return { ok: true, selected: opts.jobName };
    },
    async selectChatUnreadFilter(opts) {
      calls.push({ command: 'selectChatUnreadFilter', ...opts });
      return { ok: true, alreadyActive: false };
    },
    async inspectVisibleChatList(opts) {
      calls.push({ command: 'inspectVisibleChatList', ...opts });
      return { ok: true, threads: visibleThreads, total: visibleThreads.length };
    },
    async clickChatRow(opts) {
      calls.push({ command: 'clickChatRow', ...opts });
      lastClickedDataId = opts.dataId || `idx-${opts.index}`;
      return { ok: true, clicked: true, name: '', dataId: opts.dataId };
    },
    async inspectChatThreadState(opts) {
      calls.push({ command: 'inspectChatThreadState', ...opts });
      return threadStates[lastClickedDataId] || { ok: true, threadOpen: true, activeUid: lastClickedDataId };
    },
    async inspectAttachmentState(opts) {
      calls.push({ command: 'inspectAttachmentState', ...opts });
      return attachmentStates[lastClickedDataId] || { ok: true, present: false, buttonEnabled: false, buttonDisabled: true };
    },
    async listMessages(opts) {
      calls.push({ command: 'listMessages', ...opts });
      return messageResults[lastClickedDataId] || { ok: true, messages: [] };
    },
    async readOpenThreadMessages(opts) {
      calls.push({ command: 'readOpenThreadMessages', ...opts });
      return messageResults[lastClickedDataId] || { ok: true, messages: [] };
    },
    async sendChatMessage(opts) {
      calls.push({ command: 'sendChatMessage', ...opts });
      return { ok: true, sent: true, verified: true };
    },
    async clickRequestResume(opts) {
      calls.push({ command: 'clickRequestResume', ...opts });
      return { ok: true, requested: true, confirmed: true };
    },
    async inspectResumeRequestState(opts) {
      calls.push({ command: 'inspectResumeRequestState', ...opts });
      const state = resumeRequestStateQueues.get(lastClickedDataId);
      if (Array.isArray(state)) {
        const next = state.length > 1 ? state.shift() : state[0];
        return next;
      }
      return state || { ok: true, found: true, enabled: true, disabled: false, hintText: '' };
    },
    async getResumePreviewMeta(opts) {
      calls.push({ command: 'getResumePreviewMeta', ...opts });
      return previewMeta[opts.runId] || { ok: true, encryptResumeId: 'resume-123' };
    },
    async resumeDownload(opts) {
      calls.push({ command: 'resumeDownload', ...opts });
      return downloadResults[opts.runId] || { ok: true, fileName: 'test.pdf', sha256: 'abc123' };
    },
    async closeResumeDetail(opts) {
      calls.push({ command: 'closeResumeDetail', ...opts });
      return { ok: true };
    },
    async bringToFront(opts) {
      calls.push({ command: 'bringToFront', ...opts });
      return { ok: true };
    },
    async inspectResumeConsentState(opts) {
      calls.push({ command: 'inspectResumeConsentState', ...opts });
      const consentStates = consentStateMap || {};
      return consentStates[lastClickedDataId] || { ok: true, consentPending: false, source: null };
    },
    async acceptResumeConsent(opts) {
      calls.push({ command: 'acceptResumeConsent', ...opts });
      return { ok: true, accepted: true, source: 'notice_bar', attachmentAppeared: true };
    }
  };
}

function createMockAgentService() {
  const events = [];
  const messages = [];
  const actions = [];
  const attachments = [];
  const completions = [];
  const failures = [];

  return {
    events, messages, actions, attachments, completions, failures,
    candidateUpserts: [],
    async _getJobNanobotContext(jobKey) {
      return {
        jobName: '面点师傅（B0038011）',
        bossEncryptJobId: 'enc-job-1',
        city: '重庆',
        salary: '8-10K',
        jdText: '负责门店面点制作与出品。',
        customRequirement: null
      };
    },
    async upsertCandidate(payload) {
      this.candidateUpserts.push(payload);
      return { ok: true, candidateId: 100, personId: 50 };
    },
    async recordRunEvent(payload) {
      events.push(payload);
      return { ok: true };
    },
    async recordMessage(payload) {
      messages.push(payload);
      return { ok: true, messageId: messages.length };
    },
    async recordAction(payload) {
      actions.push(payload);
      return { ok: true, actionId: actions.length };
    },
    async recordAttachment(payload) {
      attachments.push(payload);
      return { ok: true, attachmentId: attachments.length };
    },
    async getFollowupDecision(candidateId) {
      return { candidateId, allowed: true, reason: 'eligible', cooldownRemainingMinutes: 0, recommendedAction: 'resume_request' };
    },
    async findLatestCandidateByGeekId() {
      return { id: 100 };
    },
    async completeRun(payload) {
      completions.push(payload);
      return { ok: true, status: 'completed' };
    },
    async failRun(payload) {
      failures.push(payload);
      return { ok: true, status: 'failed' };
    }
  };
}

function createMockLlmEvaluator(decisions = []) {
  let index = 0;
  return {
    async chat() {
      const decision = decisions[index++] || { action: 'skip', reason: 'default' };
      return JSON.stringify(decision);
    }
  };
}

test('FollowupLoopService executes correct workflow: navigate, filter job, filter unread, click row', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '张三', dataId: '123-0', index: 0, hasUnread: true }
    ],
    messageResults: {
      '123-0': {
        ok: true,
        messages: [
          { from: '张三', type: 'text', text: '你好，我对这个岗位感兴趣', time: '10:00' }
        ]
      }
    }
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'reply', replyText: '您好！欢迎了解岗位', reason: 'interested' }
  ]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 300, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.processed, 1);
  assert.equal(result.stats.replied, 1);
  assert.equal(result.stats.resumeRequested, 1);

  const commandOrder = bossCliRunner.calls.map((c) => c.command);
  assert.equal(commandOrder[0], 'bindTarget');
  assert.equal(commandOrder[1], 'bringToFront');
  assert.equal(commandOrder[2], 'navigateTo');
  assert.equal(commandOrder[3], 'selectChatJobFilter');
  assert.equal(commandOrder[4], 'selectChatUnreadFilter');
  assert.equal(commandOrder[5], 'inspectVisibleChatList');
  assert.equal(commandOrder[6], 'clickChatRow');
  assert.equal(commandOrder[7], 'inspectChatThreadState');
  assert.equal(commandOrder[8], 'inspectResumeConsentState');
  assert.equal(commandOrder[9], 'inspectAttachmentState');
  assert.equal(commandOrder[10], 'readOpenThreadMessages');

  const jobFilterCall = bossCliRunner.calls.find((c) => c.command === 'selectChatJobFilter');
  assert.equal(jobFilterCall.jobName, '面点师傅');

  const clickCall = bossCliRunner.calls.find((c) => c.command === 'clickChatRow');
  assert.equal(clickCall.dataId, '123-0');
  assert.equal(clickCall.index, 0);
});

test('FollowupLoopService passes job city context to LLM and forbids placeholder replies', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '张三', dataId: '123-0', index: 0, hasUnread: true }
    ],
    messageResults: {
      '123-0': {
        ok: true,
        messages: [
          { from: '张三', type: 'text', text: '这个岗位在哪上班？', time: '10:00' }
        ]
      }
    }
  });

  const agentService = createMockAgentService();
  const prompts = [];
  const llmEvaluator = {
    async chat(payload) {
      prompts.push(payload);
      return JSON.stringify({ action: 'skip', reason: 'captured' });
    }
  };

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  await service.run({ runId: 3001, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(prompts.length, 1);
  assert.match(prompts[0].userPrompt, /工作地点：重庆/);
  assert.match(prompts[0].userPrompt, /薪资范围：8-10K/);
  assert.match(prompts[0].userPrompt, /岗位说明：负责门店面点制作与出品。/);
  assert.match(prompts[0].userPrompt, /禁止输出`\[工作地点\]`、`\[薪资\]`这类占位符/);
});

test('FollowupLoopService resets chat page again after finishing processed threads', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '张三', dataId: '123-0', index: 0, hasUnread: true }
    ],
    messageResults: {
      '123-0': {
        ok: true,
        messages: [
          { from: '张三', type: 'text', text: '你好，我对这个岗位感兴趣', time: '10:00' }
        ]
      }
    }
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'reply', replyText: '您好！欢迎了解岗位', reason: 'interested' }
  ]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  await service.run({ runId: 3002, jobKey: '面点师傅（B0038011）_8eca6cad' });

  const navCalls = bossCliRunner.calls.filter((c) => c.command === 'navigateTo');
  assert.equal(navCalls.length, 2);
  assert.equal(navCalls[0].url, 'https://www.zhipin.com/web/chat/index');
  assert.equal(navCalls[1].url, 'https://www.zhipin.com/web/chat/index');
});

test('FollowupLoopService navigates to chat page when not already there', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [],
    inspectResult: { ok: true, currentUrl: 'https://www.zhipin.com/web/chat/recommend?jobid=123' }
  });

  const agentService = createMockAgentService();
  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator: createMockLlmEvaluator(),
    threadDelayMin: 0, threadDelayMax: 0
  });

  await service.run({ runId: 301, jobKey: '面点师傅（B0038011）_8eca6cad' });

  const navCall = bossCliRunner.calls.find((c) => c.command === 'navigateTo');
  assert.ok(navCall);
  assert.equal(navCall.url, 'https://www.zhipin.com/web/chat/index');
});

test('FollowupLoopService always refreshes chat initial url even when already on chat page', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [],
    inspectResult: { ok: true, currentUrl: 'https://www.zhipin.com/web/chat/index' }
  });

  const agentService = createMockAgentService();
  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator: createMockLlmEvaluator(),
    threadDelayMin: 0, threadDelayMax: 0
  });

  await service.run({ runId: 302, jobKey: '面点师傅（B0038011）_8eca6cad' });

  const navCall = bossCliRunner.calls.find((c) => c.command === 'navigateTo');
  assert.ok(navCall);
  assert.equal(navCall.url, 'https://www.zhipin.com/web/chat/index');
});

test('FollowupLoopService downloads resume when attachment present in followup mode', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '李四', dataId: '456-0', index: 0, hasUnread: true }
    ],
    attachmentStates: {
      '456-0': { ok: true, present: true, buttonEnabled: true, fileName: '李四.pdf' }
    }
  });

  const agentService = createMockAgentService();
  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator: createMockLlmEvaluator(),
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 303, jobKey: '面点师傅（B0038011）_8eca6cad', mode: 'followup' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.attachmentFound, 1);
  assert.equal(result.stats.resumeDownloaded, 1);

  const dlCalls = bossCliRunner.calls.filter((c) => c.command === 'getResumePreviewMeta' || c.command === 'resumeDownload');
  assert.equal(dlCalls.length, 2);

  assert.equal(agentService.attachments.length, 2);
  assert.equal(agentService.attachments[0].status, 'discovered');
  assert.equal(agentService.attachments[1].status, 'downloaded');

  assert.equal(agentService.actions.length, 1);
  assert.equal(agentService.actions[0].actionType, 'resume_downloaded');

  const closeCalls = bossCliRunner.calls.filter((c) => c.command === 'closeResumeDetail');
  assert.equal(closeCalls.length, 1, 'should close resume detail page after download');
});

test('FollowupLoopService closes resume detail page when download result is incomplete', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '钱七', dataId: '777-0', index: 0, hasUnread: true }
    ],
    attachmentStates: {
      '777-0': { ok: true, present: true, buttonEnabled: true, fileName: '钱七.pdf' }
    }
  });
  // Override resumeDownload to return incomplete result (missing fileName)
  bossCliRunner.resumeDownload = async (opts) => {
    bossCliRunner.calls.push({ command: 'resumeDownload', ...opts });
    return { ok: true, fileName: '' };
  };

  const agentService = createMockAgentService();
  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator: createMockLlmEvaluator(),
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 350, jobKey: '面点师傅（B0038011）_8eca6cad', mode: 'followup' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.attachmentFound, 1);
  assert.equal(result.stats.resumeDownloaded, 0, 'incomplete download should not count as downloaded');
  assert.equal(result.stats.errors, 1);

  const closeCalls = bossCliRunner.calls.filter((c) => c.command === 'closeResumeDetail');
  assert.equal(closeCalls.length, 1, 'should close resume detail page even on incomplete download');
});

test('FollowupLoopService closes resume detail page when download throws error', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '孙八', dataId: '888-0', index: 0, hasUnread: true }
    ],
    attachmentStates: {
      '888-0': { ok: true, present: true, buttonEnabled: true, fileName: '孙八.pdf' }
    }
  });
  bossCliRunner.resumeDownload = async (opts) => {
    bossCliRunner.calls.push({ command: 'resumeDownload', ...opts });
    throw new Error('network_timeout');
  };

  const agentService = createMockAgentService();
  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator: createMockLlmEvaluator(),
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 351, jobKey: '面点师傅（B0038011）_8eca6cad', mode: 'followup' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.resumeDownloaded, 0);
  assert.equal(result.stats.errors, 1);

  const closeCalls = bossCliRunner.calls.filter((c) => c.command === 'closeResumeDetail');
  assert.equal(closeCalls.length, 1, 'should close resume detail page even on download error');
});

test('FollowupLoopService requests resume when LLM decides and followup-decision allows', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '王五', dataId: '789-0', index: 0, hasUnread: true }
    ],
    messageResults: {
      '789-0': {
        ok: true,
        messages: [
          { from: 'me', type: 'text', text: '您好，有兴趣的话可以发份简历', time: '09:00' },
          { from: '王五', type: 'text', text: '可以的，怎么发？', time: '10:00' }
        ]
      }
    }
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'request_resume', reason: 'candidate willing' }
  ]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 304, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.resumeRequested, 1);

  const reqCall = bossCliRunner.calls.find((c) => c.command === 'clickRequestResume');
  assert.ok(reqCall);

  assert.equal(agentService.actions[0].actionType, 'resume_request_sent');
});

test('FollowupLoopService does not record reply or request resume when send is unverified', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '王五', dataId: '789-0', index: 0, hasUnread: true }
    ],
    messageResults: {
      '789-0': {
        ok: true,
        messages: [
          { from: 'me', type: 'text', text: '您好，有兴趣的话可以发份简历', time: '09:00' },
          { from: '王五', type: 'text', text: '可以的，怎么发？', time: '10:00' }
        ]
      }
    }
  });
  bossCliRunner.sendChatMessage = async (opts) => {
    bossCliRunner.calls.push({ command: 'sendChatMessage', ...opts });
    return { ok: true, sent: true, verified: false, method: 'button_click_unverified' };
  };

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'request_resume', replyText: '您好，方便发一份简历吗？', reason: 'candidate willing' }
  ]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 352, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.replied, 0);
  assert.equal(result.stats.resumeRequested, 0);
  assert.equal(result.stats.errors, 1);
  assert.equal(agentService.messages.filter((item) => item.direction === 'outbound').length, 0);
  assert.equal(agentService.actions.length, 0);
  assert.equal(bossCliRunner.calls.some((c) => c.command === 'clickRequestResume'), false);
});

test('FollowupLoopService does not record resume request when confirm dialog never appears', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '王五', dataId: '789-0', index: 0, hasUnread: true }
    ],
    messageResults: {
      '789-0': {
        ok: true,
        messages: [
          { from: '王五', type: 'text', text: '可以的，怎么发？', time: '10:00' }
        ]
      }
    }
  });
  bossCliRunner.clickRequestResume = async (opts) => {
    bossCliRunner.calls.push({ command: 'clickRequestResume', ...opts });
    return { ok: true, requested: false, confirmed: false };
  };

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'request_resume', reason: 'candidate willing' }
  ]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 353, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.resumeRequested, 0);
  assert.equal(result.stats.errors, 1);
  assert.equal(agentService.actions.length, 0);
});

test('FollowupLoopService sends a warmup reply before requesting resume when button is disabled', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '郭建敏', dataId: '31758964-0', index: 0, hasUnread: true }
    ],
    resumeRequestStates: {
      '31758964-0': [
        { ok: true, found: true, enabled: false, disabled: true, hintText: '双方回复后可用' },
        { ok: true, found: true, enabled: true, disabled: false, hintText: '' }
      ]
    },
    messageResults: {
      '31758964-0': {
        ok: true,
        messages: [
          { from: '郭建敏', type: 'text', text: '您好！希望您可以看一下我的资料，期待能有更深入地沟通！非常感谢！', time: '10:00' }
        ]
      }
    }
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'request_resume', reason: 'candidate willing' }
  ]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 354, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.replied, 1);
  assert.equal(result.stats.resumeRequested, 1);

  const sendCall = bossCliRunner.calls.find((c) => c.command === 'sendChatMessage');
  assert.equal(sendCall.text, '您好，方便的话也可以发我一份简历，我进一步看下。');
  assert.equal(bossCliRunner.calls.some((c) => c.command === 'clickRequestResume'), true);
});

test('FollowupLoopService skips threads where last message is from self', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '赵六', dataId: '101-0', index: 0, hasUnread: true }
    ],
    messageResults: {
      '101-0': {
        ok: true,
        messages: [
          { from: 'me', type: 'text', text: '你好', time: '10:00' }
        ]
      }
    }
  });

  const agentService = createMockAgentService();
  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator: createMockLlmEvaluator(),
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 305, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.stats.skipped, 1);
  assert.equal(result.stats.replied, 0);
});

test('FollowupLoopService completes when no unread threads visible', async () => {
  const bossCliRunner = createMockBossCliRunner({ visibleThreads: [] });
  const agentService = createMockAgentService();

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator: createMockLlmEvaluator(),
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 306, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.processed, 0);
  assert.equal(agentService.completions.length, 1);
  assert.equal(agentService.completions[0].payload.reason, 'no_unread_threads');

  const navCalls = bossCliRunner.calls.filter((c) => c.command === 'navigateTo');
  assert.equal(navCalls.length, 2);
  assert.equal(navCalls[0].url, 'https://www.zhipin.com/web/chat/index');
  assert.equal(navCalls[1].url, 'https://www.zhipin.com/web/chat/index');
});

test('FollowupLoopService fails when browser bind fails', async () => {
  const bossCliRunner = createMockBossCliRunner();
  bossCliRunner.bindTarget = async () => { throw new Error('boss_target_not_found'); };

  const agentService = createMockAgentService();
  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator: createMockLlmEvaluator(),
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 307, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, false);
  assert.equal(agentService.failures.length, 1);
});

test('FollowupLoopService fails when job filter fails', async () => {
  const bossCliRunner = createMockBossCliRunner();
  bossCliRunner.selectChatJobFilter = async () => { throw new Error('boss_chat_job_not_in_filter'); };

  const agentService = createMockAgentService();
  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator: createMockLlmEvaluator(),
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 308, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'job_filter_failed');
});

test('FollowupLoopService continues on LLM failure with error count', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '候选人A', dataId: 'a-0', index: 0, hasUnread: true },
      { name: '候选人B', dataId: 'b-0', index: 1, hasUnread: true }
    ],
    messageResults: {
      'a-0': { ok: true, messages: [{ from: '候选人A', type: 'text', text: '有兴趣', time: '10:00' }] },
      'b-0': { ok: true, messages: [{ from: '候选人B', type: 'text', text: '想了解', time: '09:00' }] }
    }
  });

  const agentService = createMockAgentService();
  let callCount = 0;
  const llmEvaluator = {
    async chat() {
      callCount += 1;
      if (callCount === 1) throw new Error('llm_timeout');
      return JSON.stringify({ action: 'reply', replyText: '您好', reason: 'respond' });
    }
  };

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 309, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.processed, 2);
  assert.equal(result.stats.errors, 1);
  assert.equal(result.stats.replied, 1);
});

test('FollowupLoopService records checkpoint events per thread', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: 'A', dataId: 'd1', index: 0, hasUnread: true },
      { name: 'B', dataId: 'd2', index: 1, hasUnread: true }
    ],
    messageResults: {
      'd1': { ok: true, messages: [{ from: 'A', type: 'text', text: '好', time: '1' }] },
      'd2': { ok: true, messages: [{ from: 'B', type: 'text', text: '好', time: '2' }] }
    }
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'skip', reason: 'ack' },
    { action: 'skip', reason: 'ack' }
  ]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  await service.run({ runId: 310, jobKey: '面点师傅（B0038011）_8eca6cad' });

  const checkpoints = agentService.events.filter((e) => e.eventType === 'followup_checkpoint');
  assert.equal(checkpoints.length, 2);
});

test('FollowupLoopService in chat mode notes attachments but does not download', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '候选人C', dataId: 'c-0', index: 0, hasUnread: true }
    ],
    attachmentStates: {
      'c-0': { ok: true, present: true, buttonEnabled: true }
    }
  });

  const agentService = createMockAgentService();
  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator: createMockLlmEvaluator(),
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 311, jobKey: '面点师傅（B0038011）_8eca6cad', mode: 'chat' });

  assert.equal(result.stats.attachmentFound, 1);
  assert.equal(result.stats.resumeDownloaded, 0);

  const dlCalls = bossCliRunner.calls.filter((c) => c.command === 'resumeDownload');
  assert.equal(dlCalls.length, 0);
});

test('FollowupLoopService calls upsertCandidate for each processed thread', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '候选人X', dataId: 'x-0', index: 0, hasUnread: true },
      { name: '候选人Y', dataId: 'y-0', index: 1, hasUnread: true }
    ],
    messageResults: {
      'x-0': { ok: true, messages: [{ from: '候选人X', type: 'text', text: '你好', time: '1' }] },
      'y-0': { ok: true, messages: [{ from: '候选人Y', type: 'text', text: '有兴趣', time: '2' }] }
    }
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'skip', reason: 'ack' },
    { action: 'skip', reason: 'ack' }
  ]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  await service.run({ runId: 312, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(agentService.candidateUpserts.length, 2);
  assert.equal(agentService.candidateUpserts[0].name, '候选人X');
  assert.equal(agentService.candidateUpserts[0].bossEncryptGeekId, 'x-0');
  assert.equal(agentService.candidateUpserts[0].status, 'in_conversation');
  assert.equal(agentService.candidateUpserts[1].name, '候选人Y');
});

test('FollowupLoopService falls back to findLatestCandidateByGeekId when upsert fails', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '候选人Z', dataId: 'z-0', index: 0, hasUnread: true }
    ],
    messageResults: {
      'z-0': { ok: true, messages: [{ from: '候选人Z', type: 'text', text: '好的', time: '1' }] }
    }
  });

  const agentService = createMockAgentService();
  agentService.upsertCandidate = async () => { throw new Error('job_not_found'); };

  const llmEvaluator = createMockLlmEvaluator([
    { action: 'reply', replyText: '您好', reason: 'respond' }
  ]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 313, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.replied, 1);
});

test('FollowupLoopService accepts resume consent before checking attachment state', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '陶洪', dataId: '541-0', index: 0, hasUnread: true }
    ],
    consentStateMap: {
      '541-0': { ok: true, consentPending: true, source: 'notice_bar' }
    },
    attachmentStates: {
      '541-0': { ok: true, present: true, buttonEnabled: true, fileName: '陶洪简历.pdf' }
    }
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 314, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.consentAccepted, 1);
  assert.equal(result.stats.attachmentFound, 1);
  assert.equal(result.stats.resumeDownloaded, 1);

  const consentCalls = bossCliRunner.calls.filter((c) => c.command === 'acceptResumeConsent');
  assert.equal(consentCalls.length, 1, 'should call acceptResumeConsent');

  const attachmentCalls = bossCliRunner.calls.filter((c) => c.command === 'inspectAttachmentState');
  assert.equal(attachmentCalls.length, 1, 'should check attachment state after consent');

  const consentEvents = agentService.events.filter((e) => e.eventType === 'resume_consent_accepted');
  assert.equal(consentEvents.length, 1);
  assert.equal(consentEvents[0].payload.source, 'notice_bar');
});

test('FollowupLoopService skips consent when not pending', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '张三', dataId: '123-0', index: 0, hasUnread: true }
    ],
    messageResults: {
      '123-0': { ok: true, messages: [{ from: '张三', type: 'text', text: '在的', time: '1' }] }
    }
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'skip', reason: 'ack' }
  ]);

  const service = new FollowupLoopService({
    bossCliRunner, agentService, llmEvaluator,
    threadDelayMin: 0, threadDelayMax: 0
  });

  const result = await service.run({ runId: 315, jobKey: '面点师傅（B0038011）_8eca6cad' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.consentAccepted, 0);

  const consentCheckCalls = bossCliRunner.calls.filter((c) => c.command === 'inspectResumeConsentState');
  assert.equal(consentCheckCalls.length, 1, 'should still check consent state');

  const acceptCalls = bossCliRunner.calls.filter((c) => c.command === 'acceptResumeConsent');
  assert.equal(acceptCalls.length, 0, 'should not call acceptResumeConsent when not pending');
});

test('parseChatDecision parses valid reply', () => {
  const result = parseChatDecision('{"action":"reply","replyText":"您好！","reason":"interested"}');
  assert.equal(result.action, 'reply');
  assert.equal(result.replyText, '您好！');
});

test('parseChatDecision parses request_resume', () => {
  const result = parseChatDecision('{"action":"request_resume","reason":"ready"}');
  assert.equal(result.action, 'request_resume');
});

test('parseChatDecision defaults to skip on bad JSON', () => {
  const result = parseChatDecision('not json');
  assert.equal(result.action, 'skip');
  assert.match(result.reason, /parse_failed/);
});

test('parseChatDecision strips markdown code fences', () => {
  const result = parseChatDecision('```json\n{"action":"reply","replyText":"hi","reason":"ok"}\n```');
  assert.equal(result.action, 'reply');
});

test('extractJobNameShort extracts name before parentheses', () => {
  assert.equal(extractJobNameShort('面点师傅（B0038011）'), '面点师傅');
  assert.equal(extractJobNameShort('健康顾问（B0047007）'), '健康顾问');
  assert.equal(extractJobNameShort('销售专员'), '销售专员');
  assert.equal(extractJobNameShort(''), '');
});

test('FollowupLoopService stops early when signal is aborted', async () => {
  const bossCliRunner = createMockBossCliRunner({
    visibleThreads: [
      { name: '张三', dataId: '123-0', index: 0, hasUnread: true },
      { name: '李四', dataId: '123-1', index: 1, hasUnread: true },
      { name: '王五', dataId: '123-2', index: 2, hasUnread: true }
    ],
    messageResults: {
      '123-0': { ok: true, messages: [{ from: '张三', type: 'text', text: '你好', time: '10:00' }] },
      '123-1': { ok: true, messages: [{ from: '李四', type: 'text', text: '你好', time: '10:01' }] },
      '123-2': { ok: true, messages: [{ from: '王五', type: 'text', text: '你好', time: '10:02' }] }
    }
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'reply', replyText: '您好', reason: 'greeting' },
    { action: 'reply', replyText: '您好', reason: 'greeting' },
    { action: 'reply', replyText: '您好', reason: 'greeting' }
  ]);

  const ac = new AbortController();
  const origRecordRunEvent = agentService.recordRunEvent.bind(agentService);
  let checkpointCount = 0;
  agentService.recordRunEvent = async (payload) => {
    const result = await origRecordRunEvent(payload);
    if (payload.eventType === 'followup_checkpoint') {
      checkpointCount += 1;
      if (checkpointCount >= 1) ac.abort();
    }
    return result;
  };

  const stopCalls = [];
  agentService.stopRun = async (payload) => {
    stopCalls.push(payload);
    return { ok: true, status: 'stopped' };
  };

  const service = new FollowupLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    maxThreads: 10,
    threadDelayMin: 0,
    threadDelayMax: 0
  });

  const result = await service.run({ runId: 300, jobKey: 'test-job', signal: ac.signal });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'manually_stopped');
  assert.equal(stopCalls.length, 1);
  assert.equal(stopCalls[0].message, 'manually_stopped');
  assert.equal(agentService.failures.length, 0, 'should not call failRun');

  const stoppedEvent = agentService.events.find((e) => e.eventType === 'followup_loop_stopped');
  assert.ok(stoppedEvent, 'should record followup_loop_stopped event');
});
