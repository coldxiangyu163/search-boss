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

  async bindTarget({ runId }) {
    return this.#run(['target', 'bind', '--run-id', String(runId)]);
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

  async getResumePanel({ runId, uid }) {
    return this.#run([
      'resume-panel',
      '--run-id',
      String(runId),
      '--uid',
      String(uid)
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
