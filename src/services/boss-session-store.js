const fs = require('node:fs/promises');
const path = require('node:path');

class BossSessionStore {
  constructor({ sessionDir }) {
    this.sessionDir = sessionDir;
  }

  async loadSession(runId) {
    const sessionPath = this.getSessionPath(runId);
    const content = await fs.readFile(sessionPath, 'utf8');
    return JSON.parse(content);
  }

  async saveSession(runId, session) {
    await fs.mkdir(this.sessionDir, { recursive: true });
    const nextSession = {
      ...session,
      runId: String(runId),
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(
      this.getSessionPath(runId),
      JSON.stringify(nextSession, null, 2)
    );

    return nextSession;
  }

  async bindTarget(runId, data) {
    return this.saveSession(runId, {
      runId: String(runId),
      targetId: data.targetId,
      tabUrl: data.tabUrl || null,
      jobKey: data.jobKey || null,
      jobId: data.jobId || null,
      mode: data.mode || null,
      selectedUid: data.selectedUid || null,
      epoch: 0,
      lastOwner: data.lastOwner || 'boss-cli'
    });
  }

  async bumpEpoch(runId, owner) {
    const session = await this.loadSession(runId);

    return this.saveSession(runId, {
      ...session,
      epoch: Number(session.epoch || 0) + 1,
      lastOwner: owner
    });
  }

  async assertEpoch(runId, expectedEpoch) {
    const session = await this.loadSession(runId);

    if (session.epoch !== expectedEpoch) {
      throw new Error('boss_session_epoch_mismatch');
    }

    return session;
  }

  getSessionPath(runId) {
    return path.join(this.sessionDir, `boss-session-${runId}.json`);
  }
}

module.exports = {
  BossSessionStore
};
