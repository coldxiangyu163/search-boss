function buildChatWriteContractPrompt() {
  return '回写格式固定：消息用 run-message；再次索简历前先 followup-decision；动作用 run-action；附件用 run-attachment；每次回写都显式携带 attemptId、eventId、sequence、jobKey。';
}

function buildChatQueueGoalPrompt(mode = '') {
  if (mode !== 'chat' && mode !== 'followup') {
    return '';
  }

  return '执行目标：当前 run 必须持续处理 JOB_KEY 对应职位下的未读线程，直到当前未读队列被清空，或页面证据证明出现不可恢复阻塞。处理完单个线程后的回复、求简历、附件 handoff 都不构成完成条件；只要未读里还有下一条，就必须回到未读列表继续，不得打一条就 run-complete。';
}

function buildAttachmentHandoffPrompt(runId, mode = '') {
  if (mode === 'download') {
    return '';
  }

  return `附件 handoff 模板：若当前线程已确认存在附件或预览，followup 模式才允许切换到 boss-resume-ingest，这本身不是 run-fail 理由。调用 boss-resume-ingest 时必须复用同一个 RUN_ID、JOB_KEY 和 BOSS_CONTEXT_FILE。模板固定为：/boss-resume-ingest --run-id "${runId}"；JOB_KEY="$JOB_KEY"；BOSS_CONTEXT_FILE="$PROJECT_ROOT/tmp/boss-context-${runId}.json"；bossEncryptGeekId="$BOSS_ENCRYPT_GEEK_ID"；candidateId="$CANDIDATE_ID"；candidateName="$CANDIDATE_NAME"；并明确说明当前线程里的附件是已可见、已预览还是仅由 deterministic context 提示。若 candidateId 缺失，先用 list-candidates --job-key "$JOB_KEY" 解析身份，再进入 ingest；只有 ingest handoff 自身出现不可恢复证据时，才允许 run-fail。download 模式不要把 boss-resume-ingest 当成成功路径，而应在同一父 run 内直接完成下载并写回 downloaded 证据。禁止创建 replacement run，禁止让 sub-skill 在已有 context file 时重新猜岗位、线程或候选人。`;
}

module.exports = {
  buildChatWriteContractPrompt,
  buildChatQueueGoalPrompt,
  buildAttachmentHandoffPrompt
};
