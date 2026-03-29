function buildCustomRequirementPrompt(customRequirement) {
  if (!customRequirement) {
    return '如数据库中没有额外岗位定制要求，仅按 BOSS 职位信息正常执行寻源。';
  }

  return [
    '执行寻源匹配时，除 BOSS 职位信息外，还必须叠加本地数据库维护的岗位定制要求；该要求不会同步回 BOSS，但会影响候选人筛选与判断。',
    `岗位定制要求：${customRequirement}`
  ].join('\n');
}

function buildSourceRecoveryPrompt({ jobName, bossEncryptJobId }) {
  const normalizedJobName = String(jobName || '').trim();
  const recommendUrl = bossEncryptJobId
    ? `https://www.zhipin.com/web/chat/recommend?jobid=${bossEncryptJobId}`
    : '';
  const recoveryTail = '如果当前落在错误岗位的候选人详情里，先安全退出详情：只能使用页面上明确可见的返回/关闭控件，或在 fresh snapshot 证明详情仍开着时尝试一次 Escape；点击“不合适/提交”不等于详情已关闭。只有确认工作经历/教育经历等详情区块已经消失，且推荐列表重新可见后，才允许切换岗位或进入下一个候选人。恢复过程中禁止点击收藏、分享、共享、举报等无关工具图标，也不要把无文案小图标猜成返回入口。';

  if (recommendUrl && normalizedJobName) {
    return `岗位恢复规则：如果当前不在推荐牛人壳层，先通过页面可见导航进入推荐牛人；进入推荐牛人后，只允许通过页面可见的岗位切换 UI 切回目标岗位并确认标题回到“${normalizedJobName}”。若外层 recommend URL 已是目标岗位，但页面标题或可见岗位名仍指向其他岗位，只能视为未恢复成功，必须继续 wait_for / snapshot / job-list recover，再做一次最终复核。` +
      '如果 iframe src 暂时还是 jobid=null，但可见岗位条、当前详情和候选人信息都已稳定指向目标岗位，这只是弱负信号，不能单独作为 run-fail 依据；只有当 jobid=null 与可见岗位漂移/缺失同时成立时，才算未恢复成功。' +
      `禁止使用 Page.navigate、evaluate_script(...click())、或注入脚本直接修改 iframe.src、history、location、class 等页面状态来强行纠偏。${recoveryTail}`;
  }

  if (recommendUrl) {
    return '岗位恢复规则：如果当前不在推荐牛人壳层，先通过页面可见导航进入推荐牛人；进入推荐牛人后，只允许通过页面可见的岗位切换 UI 切回目标岗位。若外层 recommend URL 已是目标岗位，但页面标题或可见岗位名仍指向其他岗位，只能视为未恢复成功，必须继续 wait_for / snapshot / job-list recover，再做一次最终复核。' +
      '如果 iframe src 暂时还是 jobid=null，但可见岗位条、当前详情和候选人信息都已稳定指向目标岗位，这只是弱负信号，不能单独作为 run-fail 依据；只有当 jobid=null 与可见岗位漂移/缺失同时成立时，才算未恢复成功。' +
      `禁止使用 Page.navigate、evaluate_script(...click())、或注入脚本直接修改 iframe.src、history、location、class 等页面状态来强行纠偏。${recoveryTail}`;
  }

  return '岗位恢复规则：如果当前不在推荐牛人壳层，先通过页面可见导航进入推荐牛人；进入推荐牛人后，只允许通过页面可见的岗位切换 UI 切回目标岗位。若外层 recommend URL 已是目标岗位，但页面标题或可见岗位名仍指向其他岗位，只能视为未恢复成功，必须继续 wait_for / snapshot / job-list recover，再做一次最终复核。' +
    '如果 iframe src 暂时还是 jobid=null，但可见岗位条、当前详情和候选人信息都已稳定指向目标岗位，这只是弱负信号，不能单独作为 run-fail 依据；只有当 jobid=null 与可见岗位漂移/缺失同时成立时，才算未恢复成功。' +
    `禁止使用 Page.navigate、evaluate_script(...click())、或注入脚本直接修改 iframe.src、history、location、class 等页面状态来强行纠偏。${recoveryTail}`;
}

function buildSourceWriteContractPrompt() {
  return '回写格式固定：run-candidate 必须直接写顶层 { jobKey, bossEncryptGeekId, name, status, city?, education?, experience?, school?, metadata? }；其中 metadata 承载 decision/priority/facts/reasoning。run-action(greet_sent) 必须直接写顶层 { actionType, jobKey, bossEncryptGeekId, dedupeKey, payload }；不要写 candidate.displayName 这类嵌套自定义结构，也不要读取 tests/api.test.js 或 src/services/*.js 反推字段。';
}

function buildSourceQuotaPrompt() {
  return '执行目标：单次 source run 默认目标是成功打招呼 5 人。已沟通/继续沟通的不计入新增完成数；不要因为刚完成 1 人或当前一屏候选人偏弱就提前 run-complete，而是继续滚动、翻页、换批次筛选，直到本轮新增 greet_sent 达到 5 人，或已被当前页面证据证明暂无更多合格候选人，或出现明确阻塞。若最终少于 5 人就结束，run-complete summary 必须显式写出 targetCount=5、achievedCount 和不足原因。';
}

function buildSourceStateGuardPrompt() {
  return '执行寻源打招呼时，只允许真实可见 UI 交互推进页面；禁止 Page.navigate、mcp_chrome-devtools_navigate_page 的 url/reload、evaluate_script(...click())、以及脚本改 iframe/location/history/class。只有看到工作经历/教育经历等详情区块，才算进入候选人详情；直渲染的 `.resume-detail-wrap` 加详情区块也算 detail open，不要求一定有嵌套 iframe。只有确认详情区块消失且推荐列表重新可见，才算回到列表态；点击“不合适/提交”不等于详情已关闭。greet_sent 后或列表/详情发生重排后，旧 uid 一律作废，下一次点击前必须 fresh snapshot。低于 quota 时，若页面出现相似牛人/推荐区，不得直接把它当 blocker；必须先用 recommend-state 重新确认 detailOpen 与 nextVisible。翻到下一位候选人时优先用 recommend-next-candidate，不要默认依赖 verbose snapshot 或 reload；翻页后再用 recommend-detail 轻量确认新候选人的姓名/履历摘要。若新候选人的详情未被重新证明，禁止退化成列表按钮直接打招呼。错误岗位恢复时，禁止把收藏、分享、共享、举报等无关图标当作返回入口。未达到 targetCount=5 时，不得仅因“当前页偏慢/候选人偏少”而 run-complete；summary 必须从本轮 events.jsonl 实算。';
}

function buildTerminalFailPrompt() {
  return 'run-fail 规则：run-fail 一律先写 tmp/run-fail.json 再执行 --file；禁止尝试内联 --message。只有在当前页面证据连续证明目标岗位无法恢复后，才允许终止 source run。';
}

module.exports = {
  buildCustomRequirementPrompt,
  buildSourceRecoveryPrompt,
  buildSourceWriteContractPrompt,
  buildSourceQuotaPrompt,
  buildSourceStateGuardPrompt,
  buildTerminalFailPrompt
};
