class TaskLock {
  constructor() {
    this._holder = null;
  }

  tryAcquire({ runId, jobKey, taskType }) {
    if (this._holder) {
      return false;
    }

    this._holder = {
      runId,
      jobKey,
      taskType,
      acquiredAt: new Date().toISOString()
    };

    return true;
  }

  release(runId) {
    if (!this._holder) return;
    if (this._holder.runId !== runId) return;
    this._holder = null;
  }

  getHolder() {
    return this._holder ? { ...this._holder } : null;
  }

  isBusy() {
    return this._holder !== null;
  }
}

module.exports = { TaskLock };
