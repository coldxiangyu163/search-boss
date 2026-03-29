const test = require('node:test');
const assert = require('node:assert/strict');

const { LlmEvaluator, buildCandidateEvalPrompt, parseCandidateDecision } = require('../src/services/llm-evaluator');

test('parseCandidateDecision parses valid greet decision', () => {
  const result = parseCandidateDecision(
    '{"action":"greet","tier":"A","reason":"城市匹配，经验丰富","facts":{"city":"北京","experience":"5年"}}'
  );

  assert.equal(result.action, 'greet');
  assert.equal(result.tier, 'A');
  assert.equal(result.reason, '城市匹配，经验丰富');
  assert.deepEqual(result.facts, { city: '北京', experience: '5年' });
});

test('parseCandidateDecision parses valid skip decision', () => {
  const result = parseCandidateDecision(
    '{"action":"skip","tier":"C","reason":"城市不匹配","facts":{"city":"上海","redFlags":["城市不符"]}}'
  );

  assert.equal(result.action, 'skip');
  assert.equal(result.tier, 'C');
});

test('parseCandidateDecision strips markdown code fences', () => {
  const result = parseCandidateDecision(
    '```json\n{"action":"greet","tier":"B","reason":"ok","facts":{}}\n```'
  );

  assert.equal(result.action, 'greet');
  assert.equal(result.tier, 'B');
});

test('parseCandidateDecision defaults to skip on invalid action', () => {
  const result = parseCandidateDecision('{"action":"maybe","tier":"B","reason":"unsure","facts":{}}');

  assert.equal(result.action, 'skip');
  assert.equal(result.reason, 'llm_invalid_action');
});

test('parseCandidateDecision defaults to skip on invalid JSON', () => {
  const result = parseCandidateDecision('this is not json');

  assert.equal(result.action, 'skip');
  assert.match(result.reason, /llm_parse_failed/);
});

test('buildCandidateEvalPrompt includes job and candidate info', () => {
  const prompt = buildCandidateEvalPrompt({
    jobRequirement: '岗位名称：健康顾问',
    candidateDetail: { name: '张三', detailText: '5年健康管理经验，本科学历' },
    customRequirement: '需要有营养师资格证'
  });

  assert.match(prompt, /健康顾问/);
  assert.match(prompt, /张三/);
  assert.match(prompt, /5年健康管理经验/);
  assert.match(prompt, /营养师资格证/);
});

test('buildCandidateEvalPrompt works without custom requirement', () => {
  const prompt = buildCandidateEvalPrompt({
    jobRequirement: '岗位名称：前端工程师',
    candidateDetail: { name: '李四', detailText: 'React专家' },
    customRequirement: null
  });

  assert.match(prompt, /前端工程师/);
  assert.match(prompt, /李四/);
  assert.ok(!prompt.includes('岗位定制要求'));
});

test('LlmEvaluator evaluateCandidate calls API and parses response', async () => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '{"action":"greet","tier":"A","reason":"good match","facts":{"city":"北京"}}'
          }
        }]
      })
    };
  };

  const evaluator = new LlmEvaluator({
    apiBase: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
    requestImpl: mockFetch
  });

  const result = await evaluator.evaluateCandidate({
    jobRequirement: '岗位名称：测试',
    candidateDetail: { name: '王五', detailText: '测试工程师' },
    customRequirement: null
  });

  assert.equal(result.action, 'greet');
  assert.equal(result.tier, 'A');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /example\.com\/v1\/chat\/completions/);

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'test-model');
  assert.equal(body.messages.length, 2);
});

test('LlmEvaluator throws on API error', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 429,
    text: async () => 'rate limited'
  });

  const evaluator = new LlmEvaluator({
    apiBase: 'https://example.com/v1',
    apiKey: 'test-key',
    requestImpl: mockFetch
  });

  await assert.rejects(
    () => evaluator.evaluateCandidate({
      jobRequirement: '测试',
      candidateDetail: { name: '测试', detailText: '' },
      customRequirement: null
    }),
    /llm_request_failed:429/
  );
});
