'use strict';

function createLoginAttemptTracker(options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 5;
  const lockoutMs = Number(options.lockoutMs) || 15 * 60 * 1000;
  const attemptWindowMs = Number(options.attemptWindowMs) || 30 * 60 * 1000;
  const store = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.lockedUntil && entry.lockedUntil > now) continue;
      if (entry.lastFailedAt && now - entry.lastFailedAt > attemptWindowMs) {
        store.delete(key);
      }
    }
  }, Math.min(60000, attemptWindowMs));
  if (cleanup.unref) cleanup.unref();

  function normalizeKey(email) {
    return String(email || '').trim().toLowerCase();
  }

  function getStatus(email) {
    const key = normalizeKey(email);
    if (!key) return { locked: false, attempts: 0 };
    const entry = store.get(key);
    if (!entry) return { locked: false, attempts: 0 };
    const now = Date.now();
    if (entry.lockedUntil && entry.lockedUntil > now) {
      return { locked: true, attempts: entry.attempts, lockedUntil: entry.lockedUntil };
    }
    if (entry.lockedUntil && entry.lockedUntil <= now) {
      store.delete(key);
      return { locked: false, attempts: 0 };
    }
    if (entry.lastFailedAt && now - entry.lastFailedAt > attemptWindowMs) {
      store.delete(key);
      return { locked: false, attempts: 0 };
    }
    return { locked: false, attempts: entry.attempts || 0 };
  }

  function recordFailure(email) {
    const key = normalizeKey(email);
    if (!key) return { locked: false, attempts: 0 };
    const now = Date.now();
    const prev = store.get(key);
    const attempts = prev && prev.lastFailedAt && now - prev.lastFailedAt < attemptWindowMs
      ? (prev.attempts || 0) + 1
      : 1;
    const entry = { attempts, lastFailedAt: now, lockedUntil: null };
    if (attempts >= maxAttempts) {
      entry.lockedUntil = now + lockoutMs;
    }
    store.set(key, entry);
    return {
      locked: Boolean(entry.lockedUntil),
      attempts,
      attemptsLeft: Math.max(0, maxAttempts - attempts),
      lockedUntil: entry.lockedUntil
    };
  }

  function recordSuccess(email) {
    const key = normalizeKey(email);
    if (!key) return;
    store.delete(key);
  }

  function reset() {
    store.clear();
  }

  return {
    getStatus,
    recordFailure,
    recordSuccess,
    reset,
    maxAttempts,
    lockoutMs,
    _store: store
  };
}

module.exports = { createLoginAttemptTracker };
