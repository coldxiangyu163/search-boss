const shared = require('./run-contracts/shared');
const source = require('./run-contracts/source');
const chat = require('./run-contracts/chat');
const followup = require('./run-contracts/followup');
const download = require('./run-contracts/download');
const sync = require('./run-contracts/sync');

function buildSchedulePrompt({ mode, runId, jobKey, jobContext = {}, deterministicContextPrompt = '' }) {
  if (mode === 'followup') {
    return [
      `/boss-sourcing --job "${jobKey}" --followup --run-id "${runId}"`,
      deterministicContextPrompt,
      shared.buildProjectRootPrompt(),
      shared.buildExactJobKeyPrompt(jobKey),
      source.buildEnterpriseKnowledgePrompt(jobContext.enterpriseKnowledge),
      chat.buildChatWriteContractPrompt(),
      shared.buildRunContractPrompt(runId),
      shared.buildNoRepoIntrospectionPrompt(),
      shared.buildBootstrapSequencePrompt(mode),
      shared.buildCliUsagePrompt(mode),
      chat.buildChatQueueGoalPrompt(mode),
      chat.buildAttachmentHandoffPrompt(runId, mode),
      shared.buildFailureEvidencePrompt(),
      followup.buildAttachmentTerminalProgressPrompt(mode),
      shared.buildCompletionPrompt()
    ].filter(Boolean).join('\n');
  }

  if (mode === 'chat') {
    return [
      `/boss-sourcing --job "${jobKey}" --chat --run-id "${runId}"`,
      deterministicContextPrompt,
      shared.buildProjectRootPrompt(),
      shared.buildExactJobKeyPrompt(jobKey),
      source.buildEnterpriseKnowledgePrompt(jobContext.enterpriseKnowledge),
      chat.buildChatWriteContractPrompt(),
      shared.buildRunContractPrompt(runId),
      shared.buildNoRepoIntrospectionPrompt(),
      shared.buildBootstrapSequencePrompt(mode),
      shared.buildCliUsagePrompt(mode),
      chat.buildChatQueueGoalPrompt(mode),
      chat.buildAttachmentHandoffPrompt(runId, mode),
      shared.buildFailureEvidencePrompt(),
      followup.buildAttachmentTerminalProgressPrompt(mode),
      shared.buildCompletionPrompt()
    ].filter(Boolean).join('\n');
  }

  if (mode === 'download') {
    return [
      `/boss-sourcing --job "${jobKey}" --download --run-id "${runId}"`,
      deterministicContextPrompt,
      shared.buildProjectRootPrompt(),
      shared.buildExactJobKeyPrompt(jobKey),
      download.buildDownloadWriteContractPrompt(),
      shared.buildRunContractPrompt(runId),
      shared.buildNoRepoIntrospectionPrompt(),
      shared.buildBootstrapSequencePrompt(mode),
      shared.buildCliUsagePrompt(mode),
      chat.buildAttachmentHandoffPrompt(runId, mode),
      shared.buildFailureEvidencePrompt(),
      followup.buildAttachmentTerminalProgressPrompt(mode),
      shared.buildCompletionPrompt()
    ].filter(Boolean).join('\n');
  }

  if (mode === 'status') {
    return [
      `/boss-sourcing --status --job "${jobKey}" --run-id "${runId}"`,
      shared.buildProjectRootPrompt(),
      shared.buildExactJobKeyPrompt(jobKey),
      shared.buildRunContractPrompt(runId),
      shared.buildNoRepoIntrospectionPrompt(),
      shared.buildBootstrapSequencePrompt(mode),
      shared.buildCliUsagePrompt(mode),
      shared.buildFailureEvidencePrompt(),
      shared.buildCompletionPrompt()
    ].join('\n');
  }

  return [
    `/boss-sourcing --job "${jobKey}" --source --run-id "${runId}"`,
    deterministicContextPrompt,
    shared.buildProjectRootPrompt(),
    shared.buildExactJobKeyPrompt(jobKey),
    source.buildCustomRequirementPrompt(jobContext.customRequirement),
    source.buildEnterpriseKnowledgePrompt(jobContext.enterpriseKnowledge),
    source.buildSourceWriteContractPrompt(),
    shared.buildRunContractPrompt(runId),
    shared.buildNoRepoIntrospectionPrompt(),
    shared.buildBootstrapSequencePrompt(mode),
    shared.buildCliUsagePrompt(mode),
    shared.buildFailureEvidencePrompt(),
    shared.buildCompletionPrompt(),
    source.buildSourceRecoveryPrompt(jobContext),
    source.buildTerminalFailPrompt(),
    source.buildSourceQuotaPrompt(),
    source.buildSourceStateGuardPrompt()
  ].filter(Boolean).join('\n');
}

function buildSyncPrompt({ runId }) {
  return [
    `/boss-sourcing --sync --run-id "${runId}"`,
    shared.buildProjectRootPrompt(),
    sync.buildSyncScopePrompt(),
    sync.buildSyncStabilityPrompt(),
    sync.buildSyncWriteContractPrompt(),
    shared.buildRunContractPrompt(runId),
    shared.buildNoRepoIntrospectionPrompt(),
    shared.buildBootstrapSequencePrompt('sync'),
    shared.buildCliUsagePrompt(),
    shared.buildFailureEvidencePrompt(),
    shared.buildCompletionPrompt()
  ].join('\n');
}

module.exports = {
  buildSchedulePrompt,
  buildSyncPrompt
};
