const fs = require('node:fs/promises');
const path = require('node:path');

class BossContextStore {
  constructor({ contextDir }) {
    this.contextDir = contextDir;
  }

  getContextPath(runId) {
    return path.join(this.contextDir, `boss-context-${runId}.json`);
  }

  async saveContext(runId, context) {
    await fs.mkdir(this.contextDir, { recursive: true });
    const payload = {
      ...context,
      runId: String(runId),
      updatedAt: new Date().toISOString()
    };
    const filePath = this.getContextPath(runId);
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
    return {
      filePath,
      context: payload
    };
  }
}

module.exports = {
  BossContextStore
};
