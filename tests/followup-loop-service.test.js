const test = require('node:test');
const assert = require('node:assert/strict');

const { FollowupLoopService, parseChatDecision, extractJobNameShort } = require('../src/services/followup-loop-service');

function createMockBossCliRunner({
  visibleThreads = [],
  threadStates = {},
  attachmentStates = {},
  messageResults = {},
  previewMeta = {},
  downloadResults = {},
  bindResult = { ok: true, session: { targetId: 'tab-1' } },
  inspectResult = { ok: true, currentUrl: 'https://www.zhipin.com/web/chat/index' }
} = {}) {
  const calls = [];
  let lastClickedDataId = '';

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
      return { ok: true, sent: true };
    },
    async clickRequestResume(opts) {
      calls.push({ command: 'clickRequestResume', ...opts });
      return { ok: true, requested: true };
    },
    async getResumePreviewMeta(opts) {
      calls.push({ command: 'getResumePreviewMeta', ...opts });
      return previewMeta[opts.runId] || { ok: true, encryptResumeId: 'resume-123' };
    },
    async resumeDownload(opts) {
      calls.push({ command: 'resumeDownload', ...opts });
      return downloadResults[opts.runId] || { ok: true, fileName: 'test.pdf', sha256: 'abc123' };
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
      return { jobName: '面点师傅（B0038011）', bossEncryptJobId: 'enc-job-1', customRequirement: null };
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
  assert.equal(commandOrder[1], 'navigateTo');
  assert.equal(commandOrder[2], 'selectChatJobFilter');
  assert.equal(commandOrder[3], 'selectChatUnreadFilter');
  assert.equal(commandOrder[4], 'inspectVisibleChatList');
  assert.equal(commandOrder[5], 'clickChatRow');
  assert.equal(commandOrder[6], 'inspectChatThreadState');
  assert.equal(commandOrder[7], 'inspectAttachmentState');
  assert.equal(commandOrder[8], 'readOpenThreadMessages');

  const jobFilterCall = bossCliRunner.calls.find((c) => c.command === 'selectChatJobFilter');
  assert.equal(jobFilterCall.jobName, '面点师傅');

  const clickCall = bossCliRunner.calls.find((c) => c.command === 'clickChatRow');
  assert.equal(clickCall.dataId, '123-0');
  assert.equal(clickCall.index, 0);
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
