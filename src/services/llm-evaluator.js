class LlmEvaluator {
  constructor({
    apiBase = 'https://www.openclaudecode.cn/v1',
    apiKey,
    model = 'gpt-5.4',
    maxTokens = 1024,
    temperature = 0.3,
    requestImpl = fetch
  } = {}) {
    this.apiBase = apiBase.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.requestImpl = requestImpl;
  }

  async evaluateCandidate({ jobRequirement, candidateDetail, customRequirement, enterpriseKnowledge }) {
    const systemPrompt = [
      '你是一个招聘专家，负责判断候选人与岗位的匹配度。',
      '只输出纯 JSON，不要添加任何解释文字。'
    ].join('\n');

    const userPrompt = buildCandidateEvalPrompt({
      jobRequirement,
      candidateDetail,
      customRequirement,
      enterpriseKnowledge
    });

    const raw = await this.chat({ systemPrompt, userPrompt });
    return parseCandidateDecision(raw);
  }

  async chat({ systemPrompt, userPrompt }) {
    const url = `${this.apiBase}/chat/completions`;
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };

    const response = await this.requestImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': 'search-boss/source-loop'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`llm_request_failed:${response.status}:${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('llm_empty_response');
    }

    return content.trim();
  }
}

function buildCandidateEvalPrompt({ jobRequirement, candidateDetail, customRequirement, enterpriseKnowledge }) {
  const lines = [
    '## 岗位信息',
    jobRequirement || '(无详细岗位信息)',
    ''
  ];

  if (customRequirement) {
    lines.push('## 岗位定制要求', customRequirement, '');
  }

  if (enterpriseKnowledge) {
    lines.push('## 企业知识库', enterpriseKnowledge, '');
  }

  lines.push(
    '## 候选人信息',
    `姓名：${candidateDetail.name || '未知'}`,
    ''
  );

  if (candidateDetail.detailText) {
    lines.push(candidateDetail.detailText.slice(0, 2000), '');
  }

  lines.push(
    '## 判断要求',
    '根据岗位要求和候选人信息，判断是否应该打招呼。',
    '硬性约束优先：城市、工作经验年限、学历、目标职能方向、明显不匹配项。',
    '返回纯 JSON（不要 markdown 代码块）：',
    '{"action":"greet"|"skip","tier":"A"|"B"|"C","reason":"简要原因","facts":{"city":"...","experience":"...","education":"...","matchPoints":["..."],"redFlags":["..."]}}'
  );

  return lines.join('\n');
}

function parseCandidateDecision(raw) {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const decision = JSON.parse(cleaned);
    const action = String(decision.action || '').toLowerCase();

    if (action !== 'greet' && action !== 'skip') {
      return {
        action: 'skip',
        tier: 'C',
        reason: 'llm_invalid_action',
        facts: decision.facts || {},
        raw: cleaned
      };
    }

    return {
      action,
      tier: String(decision.tier || 'C').toUpperCase(),
      reason: String(decision.reason || ''),
      facts: decision.facts || {},
      raw: cleaned
    };
  } catch (error) {
    return {
      action: 'skip',
      tier: 'C',
      reason: `llm_parse_failed:${error.message}`,
      facts: {},
      raw: cleaned
    };
  }
}

module.exports = {
  LlmEvaluator,
  buildCandidateEvalPrompt,
  parseCandidateDecision
};
