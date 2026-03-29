function buildSyncWriteContractPrompt() {
  return '回写格式固定：bootstrap 先写 run-event；jobs-batch 直接写 jobs 数组，不要为确认 payload 再读取 job-service.js 或 tests/api.test.js。每个 job 至少包含 { jobKey, encryptJobId, jobName, city, salary, status, jdText?, metadata? }。';
}

function buildSyncScopePrompt() {
  return '只执行岗位同步：采集职位列表和职位详情，并调用 /api/agent/jobs/batch 回写本地后台。禁止进入推荐牛人、打招呼、聊天跟进、下载简历。';
}

function buildSyncStabilityPrompt() {
  return '稳定性优先：以职位列表接口和当前页面可稳定读取的数据为准；如果详情接口中的 job 或 jdText 为空，允许保留空 jdText，并把原始详情放进 metadata/detailRaw，禁止为了补齐 JD 再打开编辑页、提取 HttpOnly cookie、写临时抓取脚本、复用浏览器 cookie 发起 Node 请求，或绕过 agent-callback-cli.js / 本地网络护栏。';
}

module.exports = {
  buildSyncWriteContractPrompt,
  buildSyncScopePrompt,
  buildSyncStabilityPrompt
};
