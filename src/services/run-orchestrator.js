const { buildSchedulePrompt, buildSyncPrompt } = require('./prompt-contract-builder');

class RunOrchestrator {
  constructor({ agentService }) {
    this.agentService = agentService;
  }

  async runSchedule({ runId, jobKey, mode }) {
    if (!this.agentService.nanobotRunner) {
      throw new Error('nanobot_runner_not_configured');
    }

    const deterministicContextPrompt = await this.agentService._buildDeterministicContextPrompt({ runId, jobKey, mode });
    const jobContext = mode === 'source'
      ? await this.agentService._getJobNanobotContext(jobKey)
      : {};
    const message = buildSchedulePrompt({
      mode,
      runId,
      jobKey,
      jobContext,
      deterministicContextPrompt
    });

    return this.agentService._runNanobotWithStreaming({ runId, message });
  }

  async runJobSync({ runId }) {
    if (this.agentService.bossCliRunner && this.agentService.jobService) {
      try {
        return await this.agentService._runDeterministicJobSync({ runId });
      } catch (error) {
        if (!this.agentService.nanobotRunner) {
          throw error;
        }

        await this.agentService.recordRunEvent({
          runId,
          eventId: `boss-cli-sync-fallback:${runId}`,
          occurredAt: new Date().toISOString(),
          eventType: 'boss_cli_fallback_to_nanobot',
          stage: 'deterministic_sync',
          message: 'boss cli sync fallback to nanobot',
          payload: { reason: error.message }
        });
      }
    }

    if (!this.agentService.nanobotRunner) {
      throw new Error('nanobot_runner_not_configured');
    }

    const message = buildSyncPrompt({ runId });
    return this.agentService._runNanobotWithStreaming({ runId, message });
  }
}

module.exports = {
  RunOrchestrator
};
