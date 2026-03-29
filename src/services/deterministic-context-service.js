class DeterministicContextService {
  constructor({ bossCliRunner = null, bossContextStore = null, getJobContext = null, recordRunEvent = null }) {
    this.bossCliRunner = bossCliRunner;
    this.bossContextStore = bossContextStore;
    this.getJobContext = getJobContext;
    this.recordRunEvent = recordRunEvent;
  }

  async buildPrompt({ runId, jobKey, mode }) {
    if (!this.bossCliRunner || !runId) {
      return '';
    }

    const needsJobContext = mode === 'source' || mode === 'followup' || mode === 'chat' || mode === 'download';
    const jobContext = needsJobContext && this.getJobContext
      ? await this.getJobContext(jobKey)
      : null;
    let bindResult = null;

    try {
      bindResult = await this.bossCliRunner.bindTarget({
        runId,
        mode,
        jobKey,
        jobId: jobContext?.bossEncryptJobId || null
      });
      await this.#record({
        runId,
        eventId: `phase:${runId}:target_bound`,
        occurredAt: new Date().toISOString(),
        eventType: 'phase_changed',
        stage: 'deterministic_bootstrap',
        message: 'target bound',
        payload: {
          phase: 'target_bound',
          mode,
          jobKey,
          targetId: bindResult?.session?.targetId || null
        }
      });
    } catch (error) {
      await this.#record({
        runId,
        eventId: `boss-cli-bind-failed:${runId}:${mode}`,
        occurredAt: new Date().toISOString(),
        eventType: 'boss_cli_command_failed',
        stage: 'deterministic_bootstrap',
        message: error.message,
        payload: { mode, jobKey, command: 'target bind' }
      });
    }

    let contextFilePath = null;
    let contextSnapshot = null;

    if (bindResult && this.bossCliRunner.getContextSnapshot) {
      try {
        contextSnapshot = await this.bossCliRunner.getContextSnapshot({
          runId,
          jobId: jobContext?.bossEncryptJobId || null
        });

        if (this.bossContextStore) {
          const saved = await this.bossContextStore.saveContext(runId, {
            mode,
            jobKey,
            targetId: bindResult?.session?.targetId || null,
            pageState: contextSnapshot?.page?.shell || 'unknown',
            page: contextSnapshot?.page || {},
            job: contextSnapshot?.job || {},
            candidate: contextSnapshot?.candidate || {},
            thread: contextSnapshot?.thread || {},
            attachment: contextSnapshot?.attachment || {},
            suggestedCommands: buildSuggestedCommands(mode),
            checkpoints: {
              targetBound: true,
              contextSnapshotCaptured: true
            }
          });
          contextFilePath = saved.filePath;
        }

        await this.#record({
          runId,
          eventId: `context-snapshot:${runId}:${mode}`,
          occurredAt: new Date().toISOString(),
          eventType: 'context_snapshot_captured',
          stage: 'deterministic_bootstrap',
          message: 'context snapshot captured',
          payload: {
            phase: contextSnapshot?.page?.shell || 'unknown',
            mode,
            jobKey,
            contextFilePath,
            snapshot: contextSnapshot
          }
        });
      } catch (error) {
        await this.#record({
          runId,
          eventId: `boss-cli-context-snapshot-failed:${runId}:${mode}`,
          occurredAt: new Date().toISOString(),
          eventType: 'boss_cli_command_failed',
          stage: 'deterministic_bootstrap',
          message: error.message,
          payload: { mode, jobKey, command: 'context-snapshot' }
        });
      }
    }

    if (!contextSnapshot) {
      return '';
    }

    await this.#record({
      runId,
      eventId: `boss-cli-context-ready:${runId}:${mode}`,
      occurredAt: new Date().toISOString(),
      eventType: 'boss_cli_command_succeeded',
      stage: 'deterministic_bootstrap',
      message: 'boss cli deterministic context ready',
      payload: {
        mode,
        jobKey,
        command: 'context-snapshot',
        targetId: bindResult?.session?.targetId || null
      }
    });

    return buildDeterministicContextPrompt({
      mode,
      bindResult,
      contextSnapshot,
      contextFilePath
    });
  }

  async #record(payload) {
    if (!this.recordRunEvent) {
      return;
    }

    await this.recordRunEvent(payload);
  }
}

function buildSuggestedCommands(mode = '') {
  if (mode === 'source') {
    return ['recommend-state', 'recommend-detail', 'recommend-next-candidate'];
  }

  if (mode === 'chat' || mode === 'followup') {
    return ['chatlist', 'chat-open-thread', 'chat-thread-state', 'chatmsg', 'attachment-state', 'resume-preview-meta'];
  }

  if (mode === 'download') {
    return ['chatlist', 'chat-open-thread', 'chat-thread-state', 'attachment-state', 'resume-panel'];
  }

  return [];
}

function buildDeterministicContextPrompt({ mode, bindResult, contextSnapshot, contextFilePath }) {
  const lines = [
    'Deterministic browser context: current BOSS tab already bound.',
    `Bound targetId=${bindResult?.session?.targetId || 'unknown'} url=${bindResult?.session?.tabUrl || 'unknown'}`
  ];

  if (contextFilePath) {
    lines.push(`Deterministic context file: ${contextFilePath}`);
    lines.push('Read this context file before deciding whether the current UI matches the expected queue, job, or thread.');
  }

  if (contextSnapshot) {
    lines.push(`Context snapshot: shell=${contextSnapshot.page?.shell || 'unknown'} title=${contextSnapshot.page?.title || ''} url=${contextSnapshot.page?.url || ''}`);
    lines.push(`Context snapshot facts: jobId=${contextSnapshot.job?.encryptJobId || ''} match=${String(contextSnapshot.job?.matchesRunJob)} candidate=${contextSnapshot.candidate?.name || ''} geekId=${contextSnapshot.candidate?.bossEncryptGeekId || ''} attachmentPresent=${String(contextSnapshot.attachment?.present)}`);
  }

  const suggestedCommands = buildSuggestedCommands(mode);
  if (suggestedCommands.length > 0) {
    lines.push('Suggested command order:');
    for (const [index, command] of suggestedCommands.entries()) {
      lines.push(`${index + 1}. ${command}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  DeterministicContextService
};
