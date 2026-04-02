class TaskLock {
  constructor() {
    this._holders = new Map();
  }

  tryAcquire({ runId, jobKey, taskType, hrAccountId }) {
    const lockKey = hrAccountId ? `hr:${hrAccountId}` : '__global__';

    if (this._holders.has(lockKey)) {
      return false;
    }

    this._holders.set(lockKey, {
      runId,
      jobKey,
      taskType,
      hrAccountId: hrAccountId || null,
      acquiredAt: new Date().toISOString()
    });

    return true;
  }

  release(runId) {
    for (const [key, holder] of this._holders) {
      if (holder.runId === runId) {
        this._holders.delete(key);
        return;
      }
    }
  }

  getHolder(hrAccountId) {
    if (hrAccountId) {
      const holder = this._holders.get(`hr:${hrAccountId}`);
      return holder ? { ...holder } : null;
    }
    const first = this._holders.values().next().value;
    return first ? { ...first } : null;
  }

  isBusy(hrAccountId) {
    if (hrAccountId) {
      return this._holders.has(`hr:${hrAccountId}`);
    }
    return this._holders.size > 0;
  }

  getAllHolders() {
    const result = [];
    for (const holder of this._holders.values()) {
      result.push({ ...holder });
    }
    return result;
  }
}

module.exports = { TaskLock };
