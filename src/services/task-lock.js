class TaskLock {
  constructor({ staleMs = 15 * 60 * 1000, clock = () => Date.now() } = {}) {
    this._holders = new Map();
    this._staleMs = staleMs;
    this._clock = clock;
  }

  tryAcquire({ runId, jobKey, taskType, hrAccountId }) {
    const lockKey = hrAccountId ? `hr:${hrAccountId}` : '__global__';

    if (this._holders.has(lockKey)) {
      return false;
    }

    const nowMs = this._clock();
    this._holders.set(lockKey, {
      runId,
      jobKey,
      taskType,
      hrAccountId: hrAccountId || null,
      acquiredAt: new Date(nowMs).toISOString(),
      acquiredAtMs: nowMs,
      heartbeatAtMs: nowMs
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

  heartbeat(runId) {
    if (runId === undefined || runId === null) return false;
    const nowMs = this._clock();
    for (const holder of this._holders.values()) {
      if (holder.runId === runId) {
        holder.heartbeatAtMs = nowMs;
        return true;
      }
    }
    return false;
  }

  reapStale({ staleMs, now } = {}) {
    const effectiveStaleMs = Number.isFinite(staleMs) ? staleMs : this._staleMs;
    if (!Number.isFinite(effectiveStaleMs) || effectiveStaleMs <= 0) {
      return [];
    }
    const nowMs = Number.isFinite(now) ? now : this._clock();
    const reaped = [];
    for (const [key, holder] of this._holders) {
      const lastActive = Number.isFinite(holder.heartbeatAtMs)
        ? holder.heartbeatAtMs
        : (Number.isFinite(holder.acquiredAtMs) ? holder.acquiredAtMs : nowMs);
      const idleMs = nowMs - lastActive;
      if (idleMs >= effectiveStaleMs) {
        reaped.push({ ...holder, idleMs });
        this._holders.delete(key);
      }
    }
    return reaped;
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
