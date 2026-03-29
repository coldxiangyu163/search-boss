const path = require('node:path');

function buildProjectRootPrompt() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const cliPath = path.join(projectRoot, 'scripts', 'agent-callback-cli.js');

  return `本次运行只使用当前项目目录：PROJECT_ROOT="${projectRoot}"；回写 CLI="${cliPath}"。不要猜测或探测其它历史路径。`;
}

function buildRunContractPrompt(runId) {
  return [
    `运行契约：必须复用调用方提供的 RUN_ID=${runId}；禁止创建 replacement run，禁止调用 createRun 或 /api/agent/runs。`,
    `所有写操作必须使用 agent-callback-cli.js 并显式传入 --run-id "${runId}"。`
  ].join('');
}

function buildNoRepoIntrospectionPrompt() {
  return '调用方已经显式给定 PROJECT_ROOT、RUN_ID 和回写 CLI；不要再 list_dir 项目根目录，也不要读取 AGENTS.md、tests/*、旧 tmp/run-*.json、历史失败文件或历史 session 来推断契约。';
}

function buildBootstrapSequencePrompt(mode = '') {
  if (mode === 'source') {
    return '固定启动顺序：先读 boss-sourcing SKILL 做路由；source 只继续读 boss-source-greet SKILL、boss-sourcing/references/runtime-contract.md、boss-source-greet/references/browser-states.md。不要再读 chat/followup 的页面 reference，也不要用 find、rg、python、rglob 重新定位这些固定路径。';
  }

  if (mode === 'chat' || mode === 'followup' || mode === 'download') {
    return '固定启动顺序：先读 boss-sourcing SKILL 做路由；chat/followup/download 只继续读 boss-chat-followup SKILL、boss-sourcing/references/runtime-contract.md、boss-chat-followup/references/browser-states.md。不要再读 source 的页面 reference，也不要用 find、rg、python、rglob 重新定位这些固定路径。';
  }

  return '固定启动顺序：先读 boss-sourcing SKILL；run-scoped 流程只额外读取 boss-sourcing/references/runtime-contract.md。引用路径已固定时，禁止再用 find、rg、python、rglob 或其它目录扫描去重新定位这些 reference。';
}

function buildCliUsagePrompt(mode = '') {
  if (mode === 'chat' || mode === 'followup') {
    return 'CLI 规则：回写只使用 node "$PROJECT_ROOT/scripts/agent-callback-cli.js" 的既有命令；禁止执行 --help、裸命令探测，或通过源码/测试反推参数。先 mkdir -p tmp sessions，再执行 dashboard-summary 验证后台。bootstrap 回写必须使用 run-event --file，禁止调用不存在的 bootstrap 子命令。聊天模式只允许使用 chat 相关 CLI：必要时用 node "$PROJECT_ROOT/scripts/boss-cli.js" chatlist --run-id "$RUN_ID" 读取当前职位聊天列表，用 chat-open-thread --run-id "$RUN_ID" --uid "$BOSS_ENCRYPT_UID" 打开指定线程，用 chat-thread-state --run-id "$RUN_ID" 验证当前线程状态，用 chatmsg --run-id "$RUN_ID" --uid "$BOSS_ENCRYPT_UID" 读取当前线程消息，用 attachment-state --run-id "$RUN_ID" 或 resume-panel --run-id "$RUN_ID" 读取附件按钮/附件卡片状态；需要恢复附件预览参数时，使用 resume-preview-meta --run-id "$RUN_ID"；只有在 chat-thread-state 明确返回 threadOpen=true 且 activeUid 非空之后，才允许发送跟进、索要简历、下载或进入附件 handoff；若 activeUid 为空，必须先回到 chatlist / chat-open-thread 恢复线程身份，禁止盲发。禁止调用 recommend-state、recommend-detail、recommend-pager，禁止把推荐页锚点用于沟通线程判断。';
  }

  if (mode === 'download') {
    return 'CLI 规则：回写只使用 node "$PROJECT_ROOT/scripts/agent-callback-cli.js" 的既有命令；禁止执行 --help、裸命令探测，或通过源码/测试反推参数。先 mkdir -p tmp sessions，再执行 dashboard-summary 验证后台。bootstrap 回写必须使用 run-event --file，禁止调用不存在的 bootstrap 子命令。下载/补扫模式只允许使用 chat 相关 CLI：必要时用 node "$PROJECT_ROOT/scripts/boss-cli.js" chatlist --run-id "$RUN_ID" 读取当前职位聊天列表，用 chat-open-thread --run-id "$RUN_ID" --uid "$BOSS_ENCRYPT_UID" 打开指定线程，用 chat-thread-state --run-id "$RUN_ID" 验证当前线程状态，用 chatmsg --run-id "$RUN_ID" --uid "$BOSS_ENCRYPT_UID" 读取当前线程消息，用 attachment-state --run-id "$RUN_ID" 或 resume-panel --run-id "$RUN_ID" 读取附件按钮/附件卡片状态；需要恢复附件预览参数时，使用 resume-preview-meta --run-id "$RUN_ID"；只有在 chat-thread-state 明确返回 threadOpen=true 且 activeUid 非空之后，才允许发送跟进、索要简历、下载或进入附件 handoff；若 activeUid 为空，必须先回到 chatlist / chat-open-thread 恢复线程身份，禁止盲发。禁止调用 recommend-state、recommend-detail、recommend-pager，禁止把推荐页锚点用于沟通线程判断。';
  }

  return 'CLI 规则：回写只使用 node "$PROJECT_ROOT/scripts/agent-callback-cli.js" 的既有命令；禁止执行 --help、裸命令探测，或通过源码/测试反推参数。先 mkdir -p tmp sessions，再执行 dashboard-summary 验证后台。bootstrap 回写必须使用 run-event --file，禁止调用不存在的 bootstrap 子命令。推荐详情推进优先使用确定性 CLI：先用 node "$PROJECT_ROOT/scripts/boss-cli.js" recommend-state --run-id "$RUN_ID" 读取 detailOpen/nextVisible/similarCandidatesVisible；若需要轻量读取当前详情候选人的姓名/履历摘要，使用 node "$PROJECT_ROOT/scripts/boss-cli.js" recommend-detail --run-id "$RUN_ID"；进入下一位候选人时优先使用 node "$PROJECT_ROOT/scripts/boss-cli.js" recommend-next-candidate --run-id "$RUN_ID"。仅当必须显式翻上一页或回退时，才使用 recommend-pager --direction next|prev；它会发送真实鼠标事件，不是 DOM click。';
}

function buildFailureEvidencePrompt() {
  return '失败判定：只有在本次 run 内完成后台探活、bootstrap 回写，并亲自尝试 Chrome/MCP 读取（至少 list_pages，必要时再 new_page）之后，才允许 run-fail；禁止复用旧失败文件或历史结论直接终止。';
}

function buildCompletionPrompt() {
  return '结束前必须显式调用 run-complete 或 run-fail；不要输出“如果你继续”之类等待确认的阶段性总结。遇到阻塞时先继续 recover，确实无法完成再 run-fail。';
}

function buildExactJobKeyPrompt(jobKey) {
  return `本次任务的唯一后端岗位标识是 JOB_KEY="${jobKey}"。禁止根据 jobName、encryptJobId、页面标题或短 id 重新拼接、改写或替换 jobKey；如果页面恢复后落到其他岗位，必须先切回该 JOB_KEY 对应岗位再继续。`;
}

module.exports = {
  buildProjectRootPrompt,
  buildRunContractPrompt,
  buildNoRepoIntrospectionPrompt,
  buildBootstrapSequencePrompt,
  buildCliUsagePrompt,
  buildFailureEvidencePrompt,
  buildCompletionPrompt,
  buildExactJobKeyPrompt
};
