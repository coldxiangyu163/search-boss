const { executeCli } = require('../../scripts/boss-cli');

class BossCliRunner {
  constructor({
    executeCliImpl = executeCli,
    env = process.env,
    envFilePath
  } = {}) {
    this.executeCliImpl = executeCliImpl;
    this.env = env;
    this.envFilePath = envFilePath;
  }

  async bindTarget({ runId, mode = null, jobKey = null, jobId = null }) {
    const args = ['target', 'bind', '--run-id', String(runId)];
    if (mode && mode !== 'source' && mode !== 'sync') {
      args.push('--prefer-chat');
    }
    if (mode) {
      args.push('--mode', String(mode));
    }
    if (jobKey) {
      args.push('--job-key', String(jobKey));
    }
    if (jobId) {
      args.push('--job-id', String(jobId));
    }
    const result = await this.#run(args);

    if (jobKey || jobId) {
      result.session = {
        ...(result.session || {}),
        jobKey: jobKey || result.session?.jobKey || null,
        jobId: jobId || result.session?.jobId || null,
        mode: mode || result.session?.mode || null
      };
    }

    return result;
  }

  async inspectTarget({ runId }) {
    return this.#run(['target', 'inspect', '--run-id', String(runId)]);
  }

  async listJobs({ runId }) {
    return this.#run(['joblist', '--run-id', String(runId)]);
  }

  async listRecommendations({ runId, limit = 5 }) {
    return this.#run(['recommend', '--run-id', String(runId), '--limit', String(limit)]);
  }

  async clickRecommendPager({ runId, direction = 'next' }) {
    return this.#run([
      'recommend-pager',
      '--run-id',
      String(runId),
      '--direction',
      String(direction)
    ]);
  }

  async recommendNextCandidate({ runId }) {
    return this.#run([
      'recommend-next-candidate',
      '--run-id',
      String(runId)
    ]);
  }

  async inspectRecommendState({ runId }) {
    return this.#run([
      'recommend-state',
      '--run-id',
      String(runId)
    ]);
  }

  async inspectRecommendDetail({ runId }) {
    return this.#run([
      'recommend-detail',
      '--run-id',
      String(runId)
    ]);
  }

  async getContextSnapshot({ runId, jobId = null }) {
    const args = [
      'context-snapshot',
      '--run-id',
      String(runId)
    ];

    if (jobId) {
      args.push('--job-id', String(jobId));
    }

    return this.#run(args);
  }

  async getJobDetail({ runId, jobId }) {
    return this.#run(['job-detail', '--run-id', String(runId), '--job-id', String(jobId)]);
  }

  async listChats({ runId, limit = 5, jobId = '0' }) {
    return this.#run([
      'chatlist',
      '--run-id',
      String(runId),
      '--job-id',
      String(jobId),
      '--limit',
      String(limit)
    ]);
  }

  async listMessages({ runId, uid, page = 1 }) {
    return this.#run([
      'chatmsg',
      '--run-id',
      String(runId),
      '--uid',
      String(uid),
      '--page',
      String(page)
    ]);
  }

  async openChatThread({ runId, uid }) {
    return this.#run([
      'chat-open-thread',
      '--run-id',
      String(runId),
      '--uid',
      String(uid)
    ]);
  }

  async inspectChatThreadState({ runId }) {
    return this.#run([
      'chat-thread-state',
      '--run-id',
      String(runId)
    ]);
  }

  async getResumePanel({ runId, uid }) {
    return this.#run([
      'resume-panel',
      '--run-id',
      String(runId),
      '--uid',
      String(uid)
    ]);
  }

  async inspectAttachmentState({ runId }) {
    return this.#run([
      'attachment-state',
      '--run-id',
      String(runId)
    ]);
  }

  async getResumePreviewMeta({ runId }) {
    return this.#run([
      'resume-preview-meta',
      '--run-id',
      String(runId)
    ]);
  }

  async #run(argv) {
    const result = await this.executeCliImpl(argv, {
      env: this.env,
      envFilePath: this.envFilePath
    });

    if (!result || result.exitCode !== 0) {
      throw new Error(result?.stderr || 'boss_cli_command_failed');
    }

    if (!result.stdout) {
      throw new Error('boss_cli_stdout_missing');
    }

    return JSON.parse(result.stdout);
  }
}

module.exports = {
  BossCliRunner
};
