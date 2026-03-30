const test = require('node:test');
const assert = require('node:assert/strict');

const { SourceLoopService } = require('../src/services/source-loop-service');

function createMockBossCliRunner({
  listResult = { ok: true, total: 0, candidates: [] },
  stateSequence = [],
  greetResults = [],
  bindResult = { ok: true, session: { targetId: 'tab-1' } }
} = {}) {
  let stateIndex = 0;
  let greetIndex = 0;
  const calls = [];

  return {
    calls,
    async bindTarget(opts) {
      calls.push({ command: 'bindTarget', ...opts });
      return bindResult;
    },
    async bringToFront(opts) {
      calls.push({ command: 'bringToFront', ...opts });
      return { ok: true };
    },
    async inspectTarget(opts) {
      calls.push({ command: 'inspectTarget', ...opts });
      return { ok: true, currentUrl: 'https://www.zhipin.com/web/chat/recommend' };
    },
    async navigateTo(opts) {
      calls.push({ command: 'navigateTo', ...opts });
      return { ok: true };
    },
    async selectRecommendJob(opts) {
      calls.push({ command: 'selectRecommendJob', ...opts });
      return { ok: true, alreadySelected: false };
    },
    async inspectRecommendState(opts) {
      calls.push({ command: 'inspectRecommendState', ...opts });
      const result = stateSequence[stateIndex] || { ok: true, detailOpen: true };
      stateIndex += 1;
      return result;
    },
    async inspectRecommendList(opts) {
      calls.push({ command: 'inspectRecommendList', ...opts });
      return listResult;
    },
    async clickRecommendGreetByCoords(opts) {
      calls.push({ command: 'clickRecommendGreetByCoords', ...opts });
      return greetResults[greetIndex++] || { ok: true, greeted: true };
    },
    async clickRecommendGreet(opts) {
      calls.push({ command: 'clickRecommendGreet', ...opts });
      return greetResults[greetIndex++] || { ok: true, greeted: true, alreadyChatting: false };
    }
  };
}

function createMockAgentService() {
  const events = [];
  const candidates = [];
  const actions = [];
  const completions = [];
  const failures = [];

  return {
    events,
    candidates,
    actions,
    completions,
    failures,
    async _getJobNanobotContext(jobKey) {
      return {
        jobName: '测试岗位',
        bossEncryptJobId: 'enc-job-1',
        city: '重庆',
        salary: '8-9K',
        jdText: '面点师岗位描述',
        customRequirement: null
      };
    },
    async recordRunEvent(payload) {
      events.push(payload);
      return { ok: true };
    },
    async upsertCandidate(payload) {
      candidates.push(payload);
      return { ok: true, personId: 1, candidateId: candidates.length };
    },
    async findLatestCandidateByGeekId() {
      return null;
    },
    async recordAction(payload) {
      actions.push(payload);
      return { ok: true, actionId: actions.length };
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
    async evaluateCandidate() {
      return decisions[index++] || { action: 'greet', tier: 'A', reason: 'good match', facts: {} };
    }
  };
}

function makeCandidateList(items) {
  return {
    ok: true,
    total: items.length,
    candidates: items.map((item, i) => ({
      index: i,
      geekId: item.geekId || `geek-${i + 1}`,
      text: item.text || `8-9K ${item.name || `候选人${i + 1}`} 3年经验`,
      alreadyChatting: item.alreadyChatting || false,
      hasGreetBtn: item.hasGreetBtn !== false,
      greetBtnText: item.alreadyChatting ? '继续沟通' : '打招呼',
      greetX: item.greetX || 500 + i * 10,
      greetY: item.greetY || 100 + i * 50
    }))
  };
}

test('SourceLoopService completes successfully with 3 greets from list', async () => {
  const bossCliRunner = createMockBossCliRunner({
    listResult: makeCandidateList([
      { geekId: 'geek-1', name: '张三' },
      { geekId: 'geek-2', name: '李四' },
      { geekId: 'geek-3', name: '王五' }
    ])
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'greet', tier: 'A', reason: 'good', facts: {} },
    { action: 'greet', tier: 'A', reason: 'good', facts: {} },
    { action: 'greet', tier: 'A', reason: 'good', facts: {} }
  ]);

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 3,
    candidateDelayMin: 0,
    candidateDelayMax: 0
  });

  const result = await service.run({ runId: 100, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.achievedCount, 3);
  assert.equal(result.stats.greeted, 3);
  assert.equal(agentService.actions.length, 3);
  assert.equal(agentService.candidates.length, 3);
});

test('SourceLoopService skips candidates when LLM says skip', async () => {
  const bossCliRunner = createMockBossCliRunner({
    listResult: makeCandidateList([
      { geekId: 'geek-1', name: '张三' },
      { geekId: 'geek-2', name: '李四' },
      { geekId: 'geek-3', name: '王五' }
    ])
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'skip', tier: 'C', reason: '无经验', facts: {} },
    { action: 'skip', tier: 'C', reason: '城市不符', facts: {} },
    { action: 'greet', tier: 'A', reason: '匹配', facts: {} }
  ]);

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 5,
    candidateDelayMin: 0,
    candidateDelayMax: 0
  });

  const result = await service.run({ runId: 101, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.achievedCount, 1);
  assert.equal(result.stats.skipped, 2);
  assert.equal(agentService.actions.length, 1);
  assert.equal(agentService.candidates.length, 3);
});

test('SourceLoopService fails when browser bind fails', async () => {
  const bossCliRunner = createMockBossCliRunner({
    bindResult: null
  });
  bossCliRunner.bindTarget = async () => { throw new Error('cdp_connect_failed'); };

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator();

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 5,
    candidateDelayMin: 0,
    candidateDelayMax: 0
  });

  const result = await service.run({ runId: 102, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'browser_bind_failed');
  assert.equal(agentService.failures.length, 1);
});

test('SourceLoopService fails when recommend list is empty', async () => {
  const bossCliRunner = createMockBossCliRunner({
    listResult: { ok: true, total: 0, candidates: [] }
  });
  bossCliRunner.inspectRecommendList = async () => { throw new Error('boss_recommend_no_cards'); };

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator();

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 5,
    candidateDelayMin: 0,
    candidateDelayMax: 0
  });

  const result = await service.run({ runId: 103, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, false);
  assert.equal(agentService.failures.length, 1);
});

test('SourceLoopService handles already-chatting candidates', async () => {
  const bossCliRunner = createMockBossCliRunner({
    listResult: makeCandidateList([
      { geekId: 'geek-1', name: '张三', alreadyChatting: true },
      { geekId: 'geek-2', name: '李四' },
      { geekId: 'geek-3', name: '王五' }
    ])
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'greet', tier: 'A', reason: 'good', facts: {} },
    { action: 'greet', tier: 'A', reason: 'good', facts: {} }
  ]);

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 5,
    candidateDelayMin: 0,
    candidateDelayMax: 0
  });

  const result = await service.run({ runId: 104, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.alreadyChatting, 1);
  assert.equal(result.stats.greeted, 2);
});

test('SourceLoopService records checkpoint events', async () => {
  const bossCliRunner = createMockBossCliRunner({
    listResult: makeCandidateList([
      { geekId: 'geek-1', name: '张三' }
    ])
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator();

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 5,
    candidateDelayMin: 0,
    candidateDelayMax: 0
  });

  await service.run({ runId: 105, jobKey: '测试岗位_abc' });

  const checkpoints = agentService.events.filter((e) => e.eventType === 'source_checkpoint');
  assert.equal(checkpoints.length, 1);
});

test('SourceLoopService continues on LLM failure with skip default', async () => {
  const bossCliRunner = createMockBossCliRunner({
    listResult: makeCandidateList([
      { geekId: 'geek-1', name: '张三' },
      { geekId: 'geek-2', name: '李四' }
    ])
  });

  const agentService = createMockAgentService();
  let evalCount = 0;
  const llmEvaluator = {
    async evaluateCandidate() {
      evalCount++;
      if (evalCount === 1) throw new Error('api_timeout');
      return { action: 'greet', tier: 'A', reason: 'good', facts: {} };
    }
  };

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 5,
    candidateDelayMin: 0,
    candidateDelayMax: 0
  });

  const result = await service.run({ runId: 106, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.errors, 1);
  assert.equal(result.stats.greeted, 1);
});

test('SourceLoopService DB dedup skips already-greeted candidates', async () => {
  const bossCliRunner = createMockBossCliRunner({
    listResult: makeCandidateList([
      { geekId: 'geek-existing', name: '已打招呼' },
      { geekId: 'geek-new', name: '新候选人' }
    ])
  });

  const agentService = createMockAgentService();
  agentService.findLatestCandidateByGeekId = async (geekId) => {
    if (geekId === 'geek-existing') {
      return { lifecycleStatus: 'greeted' };
    }
    return null;
  };

  const llmEvaluator = createMockLlmEvaluator([
    { action: 'greet', tier: 'A', reason: 'good', facts: {} }
  ]);

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 5,
    candidateDelayMin: 0,
    candidateDelayMax: 0
  });

  const result = await service.run({ runId: 107, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.alreadyChatting, 1);
  assert.equal(result.stats.greeted, 1);
});
