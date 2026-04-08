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

  async clickRecommendGreet({ runId }) {
    return this.#run([
      'recommend-greet',
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

  async selectChatJobFilter({ runId, jobName }) {
    return this.#run([
      'chat-select-job',
      '--run-id',
      String(runId),
      '--job-name',
      String(jobName)
    ]);
  }

  async selectChatUnreadFilter({ runId }) {
    return this.#run([
      'chat-select-unread',
      '--run-id',
      String(runId)
    ]);
  }

  async inspectVisibleChatList({ runId, limit = 30 }) {
    return this.#run([
      'chat-visible-list',
      '--run-id',
      String(runId),
      '--limit',
      String(limit)
    ]);
  }

  async bringToFront({ runId }) {
    return this.#run(['bring-to-front', '--run-id', String(runId)]);
  }

  async inspectRecommendList({ runId, limit = 10 }) {
    return this.#run([
      'recommend-list',
      '--run-id',
      String(runId),
      '--limit',
      String(limit)
    ]);
  }

  async clickRecommendGreetByCoords({ runId, x, y }) {
    return this.#run([
      'recommend-greet-coords',
      '--run-id',
      String(runId),
      '--x',
      String(x),
      '--y',
      String(y)
    ]);
  }

  async scrollCardIntoView({ runId, cardIndex }) {
    return this.#run([
      'recommend-scroll-card',
      '--run-id', String(runId),
      '--card-index', String(cardIndex)
    ]);
  }

  async switchRecommendToLatest({ runId }) {
    return this.#run(['recommend-switch-latest', '--run-id', String(runId)]);
  }

  async clickAtCoords({ runId, x, y }) {
    return this.#run([
      'click-at-coords',
      '--run-id', String(runId),
      '--x', String(x),
      '--y', String(y)
    ]);
  }

  async closeRecommendPopup({ runId }) {
    return this.#run(['recommend-close-popup', '--run-id', String(runId)]);
  }

  async switchRecommendToGridView({ runId }) {
    return this.#run(['recommend-switch-grid', '--run-id', String(runId)]);
  }

  async selectRecommendJob({ runId, jobName }) {
    return this.#run([
      'recommend-select-job',
      '--run-id',
      String(runId),
      '--job-name',
      String(jobName)
    ]);
  }

  async clickFirstRecommendCard({ runId }) {
    return this.#run([
      'recommend-click-first-card',
      '--run-id',
      String(runId)
    ]);
  }

  async readOpenThreadMessages({ runId, limit = 20 }) {
    return this.#run([
      'chat-read-messages',
      '--run-id',
      String(runId),
      '--limit',
      String(limit)
    ]);
  }

  async clickChatRow({ runId, index, dataId }) {
    const args = ['chat-click-row', '--run-id', String(runId)];
    if (index !== undefined) {
      args.push('--index', String(index));
    }
    if (dataId) {
      args.push('--data-id', String(dataId));
    }
    return this.#run(args);
  }

  async navigateTo({ runId, url }) {
    return this.#run([
      'navigate',
      '--run-id',
      String(runId),
      '--url',
      String(url)
    ]);
  }

  async sendChatMessage({ runId, text }) {
    return this.#run([
      'chat-send-message',
      '--run-id',
      String(runId),
      '--text',
      String(text)
    ]);
  }

  async clickRequestResume({ runId }) {
    return this.#run([
      'chat-request-resume',
      '--run-id',
      String(runId)
    ]);
  }

  async clickExchangeAction({ runId, actionText = '求简历' }) {
    return this.#run([
      'chat-exchange-action',
      '--run-id',
      String(runId),
      '--action-text',
      String(actionText)
    ]);
  }

  async inspectResumeRequestState({ runId }) {
    return this.#run([
      'chat-request-resume-state',
      '--run-id',
      String(runId)
    ]);
  }

  async inspectAttachmentState({ runId }) {
    return this.#run([
      'attachment-state',
      '--run-id',
      String(runId)
    ]);
  }

  async inspectResumeConsentState({ runId }) {
    return this.#run([
      'resume-consent-state',
      '--run-id',
      String(runId)
    ]);
  }

  async acceptResumeConsent({ runId }) {
    return this.#run([
      'resume-accept-consent',
      '--run-id',
      String(runId)
    ]);
  }

  async resumeDownload({ runId, outputPath }) {
    return this.#run([
      'resume-download',
      '--run-id',
      String(runId),
      '--output-path',
      String(outputPath)
    ]);
  }

  async getResumePreviewMeta({ runId }) {
    return this.#run([
      'resume-preview-meta',
      '--run-id',
      String(runId)
    ]);
  }

  async closeResumeDetail({ runId }) {
    return this.#run([
      'resume-close-detail',
      '--run-id',
      String(runId)
    ]);
  }

  async scrapeRecruitData({ runId }) {
    return this.#run([
      'recruit-data',
      '--run-id',
      String(runId)
    ]);
  }

  async setupResumeCanvasCapture({ runId }) {
    return this.#run([
      'recommend-setup-canvas-capture',
      '--run-id',
      String(runId)
    ]);
  }

  async resetResumeCanvasCapture({ runId }) {
    return this.#run([
      'recommend-reset-canvas-capture',
      '--run-id',
      String(runId)
    ]);
  }

  async scrollAndReadResumeDetail({ runId }) {
    return this.#run([
      'recommend-scroll-read-detail',
      '--run-id',
      String(runId)
    ]);
  }

  async applyRecommendFilters({ runId, filters }) {
    return this.#run([
      'recommend-apply-filters',
      '--run-id',
      String(runId),
      '--filters',
      JSON.stringify(filters)
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
