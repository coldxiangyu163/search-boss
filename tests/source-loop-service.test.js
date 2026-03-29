const test = require('node:test');
const assert = require('node:assert/strict');

const { SourceLoopService } = require('../src/services/source-loop-service');

function createMockBossCliRunner({
  detailSequence = [],
  stateSequence = [],
  greetResults = [],
  bindResult = { ok: true, session: { targetId: 'tab-1' } }
} = {}) {
  let detailIndex = 0;
  let stateIndex = 0;
  let greetIndex = 0;
  const calls = [];

  return {
    calls,
    async bindTarget(opts) {
      calls.push({ command: 'bindTarget', ...opts });
      return bindResult;
    },
    async inspectRecommendState(opts) {
      calls.push({ command: 'inspectRecommendState', ...opts });
      const result = stateSequence[stateIndex] || { ok: true, detailOpen: true, nextVisible: true };
      stateIndex += 1;
      return result;
    },
    async inspectRecommendDetail(opts) {
      calls.push({ command: 'inspectRecommendDetail', ...opts });
      const result = detailSequence[detailIndex];
      if (!result) {
        throw new Error('boss_recommend_detail_empty');
      }
      detailIndex += 1;
      return result;
    },
    async clickRecommendGreet(opts) {
      calls.push({ command: 'clickRecommendGreet', ...opts });
      return greetResults[greetIndex++] || { ok: true, greeted: true, alreadyChatting: false };
    },
    async recommendNextCandidate(opts) {
      calls.push({ command: 'recommendNextCandidate', ...opts });
      return { ok: true, direction: 'next' };
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

test('SourceLoopService completes successfully with 3 greets', async () => {
  const bossCliRunner = createMockBossCliRunner({
    detailSequence: [
      { ok: true, bossEncryptGeekId: 'geek-1', name: '张三', detailText: '5年经验' },
      { ok: true, bossEncryptGeekId: 'geek-2', name: '李四', detailText: '3年经验' },
      { ok: true, bossEncryptGeekId: 'geek-3', name: '王五', detailText: '7年经验' }
    ],
    stateSequence: [
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: false }
    ]
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'greet', tier: 'A', reason: 'match', facts: {} },
    { action: 'greet', tier: 'B', reason: 'decent', facts: {} },
    { action: 'greet', tier: 'A', reason: 'strong', facts: {} }
  ]);

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 3
  });

  const result = await service.run({ runId: 100, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.achievedCount, 3);
  assert.equal(agentService.completions.length, 1);
  assert.equal(agentService.failures.length, 0);
  assert.equal(agentService.actions.length, 3);
  assert.equal(agentService.candidates.length, 3);

  for (const action of agentService.actions) {
    assert.equal(action.actionType, 'greet_sent');
  }
});

test('SourceLoopService skips candidates when LLM says skip', async () => {
  const bossCliRunner = createMockBossCliRunner({
    detailSequence: [
      { ok: true, bossEncryptGeekId: 'geek-1', name: '张三', detailText: '无经验' },
      { ok: true, bossEncryptGeekId: 'geek-2', name: '李四', detailText: '城市不符' },
      { ok: true, bossEncryptGeekId: 'geek-3', name: '王五', detailText: '匹配' }
    ],
    stateSequence: [
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: false }
    ]
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
    targetCount: 5
  });

  const result = await service.run({ runId: 101, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.achievedCount, 1);
  assert.equal(result.stats.skipped, 2);
  assert.equal(result.stats.reason, 'candidate_pool_exhausted');
  assert.equal(agentService.actions.length, 1);
  assert.equal(agentService.candidates.length, 3);
});

test('SourceLoopService fails when browser bind fails', async () => {
  const bossCliRunner = createMockBossCliRunner();
  bossCliRunner.bindTarget = async () => {
    throw new Error('boss_target_not_found');
  };

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator();

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 5
  });

  const result = await service.run({ runId: 102, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'browser_bind_failed');
  assert.equal(agentService.failures.length, 1);
  assert.match(agentService.failures[0].message, /browser_bind_failed/);
});

test('SourceLoopService fails when recommend detail not open at start', async () => {
  const bossCliRunner = createMockBossCliRunner({
    stateSequence: [
      { ok: true, detailOpen: false, nextVisible: false }
    ]
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator();

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 5
  });

  const result = await service.run({ runId: 103, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'recommend_detail_not_open');
  assert.equal(agentService.failures.length, 1);
});

test('SourceLoopService stops at maxSkips', async () => {
  const details = [];
  const states = [];
  for (let i = 0; i < 12; i++) {
    details.push({
      ok: true,
      bossEncryptGeekId: `geek-${i}`,
      name: `候选人${i}`,
      detailText: '不匹配'
    });
    states.push({ ok: true, detailOpen: true, nextVisible: true });
    states.push({ ok: true, detailOpen: true, nextVisible: true });
  }

  const bossCliRunner = createMockBossCliRunner({
    detailSequence: details,
    stateSequence: states
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator(
    details.map(() => ({ action: 'skip', tier: 'C', reason: '不匹配', facts: {} }))
  );

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 5,
    maxSkips: 10
  });

  const result = await service.run({ runId: 104, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.achievedCount, 0);
  assert.equal(result.stats.reason, 'max_skips_reached');
});

test('SourceLoopService handles already-chatting candidates', async () => {
  const bossCliRunner = createMockBossCliRunner({
    detailSequence: [
      { ok: true, bossEncryptGeekId: 'geek-1', name: '张三', detailText: '已沟通' },
      { ok: true, bossEncryptGeekId: 'geek-2', name: '李四', detailText: '新候选人' }
    ],
    stateSequence: [
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: false }
    ],
    greetResults: [
      { ok: true, greeted: true, alreadyChatting: true, resultText: '继续沟通' },
      { ok: true, greeted: true, alreadyChatting: false, resultText: '' }
    ]
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'greet', tier: 'B', reason: 'try', facts: {} },
    { action: 'greet', tier: 'A', reason: 'match', facts: {} }
  ]);

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 2
  });

  const result = await service.run({ runId: 105, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.greeted, 1);
  assert.equal(result.stats.alreadyChatting, 1);
  assert.equal(agentService.actions.length, 1);
});

test('SourceLoopService records checkpoint events', async () => {
  const bossCliRunner = createMockBossCliRunner({
    detailSequence: [
      { ok: true, bossEncryptGeekId: 'geek-1', name: '张三', detailText: '匹配' }
    ],
    stateSequence: [
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: false }
    ]
  });

  const agentService = createMockAgentService();
  const llmEvaluator = createMockLlmEvaluator([
    { action: 'greet', tier: 'A', reason: 'match', facts: {} }
  ]);

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 1
  });

  await service.run({ runId: 106, jobKey: '测试岗位_abc' });

  const checkpoints = agentService.events.filter((e) => e.eventType === 'source_checkpoint');
  assert.ok(checkpoints.length >= 1);
  assert.equal(checkpoints[0].payload.greeted, 1);
});

test('SourceLoopService continues on LLM failure with skip default', async () => {
  const bossCliRunner = createMockBossCliRunner({
    detailSequence: [
      { ok: true, bossEncryptGeekId: 'geek-1', name: '张三', detailText: '匹配' },
      { ok: true, bossEncryptGeekId: 'geek-2', name: '李四', detailText: '匹配' }
    ],
    stateSequence: [
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: true },
      { ok: true, detailOpen: true, nextVisible: false }
    ]
  });

  const agentService = createMockAgentService();
  let callCount = 0;
  const llmEvaluator = {
    async evaluateCandidate() {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('llm_timeout');
      }
      return { action: 'greet', tier: 'A', reason: 'match', facts: {} };
    }
  };

  const service = new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: 1
  });

  const result = await service.run({ runId: 107, jobKey: '测试岗位_abc' });

  assert.equal(result.ok, true);
  assert.equal(result.stats.greeted, 1);
  assert.equal(result.stats.skipped, 1);
});
