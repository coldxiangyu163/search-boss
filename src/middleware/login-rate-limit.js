'use strict';

function resolveClientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip
    || (req.connection && req.connection.remoteAddress)
    || (req.socket && req.socket.remoteAddress)
    || 'unknown';
}

function createLoginRateLimit(options = {}) {
  const windowMs = Number(options.windowMs) || 15 * 60 * 1000;
  const max = Number(options.max) || 20;
  const disabled = options.disabled === true;
  const buckets = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
      const fresh = bucket.filter((t) => now - t < windowMs);
      if (fresh.length === 0) {
        buckets.delete(ip);
      } else if (fresh.length !== bucket.length) {
        buckets.set(ip, fresh);
      }
    }
  }, Math.min(60000, windowMs));
  if (cleanup.unref) cleanup.unref();

  const middleware = (req, res, next) => {
    if (disabled) return next();
    const ip = resolveClientIp(req);
    const now = Date.now();
    const prev = buckets.get(ip) || [];
    const bucket = prev.filter((t) => now - t < windowMs);

    if (bucket.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((bucket[0] + windowMs - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'too_many_attempts',
        message: '登录尝试过于频繁，请稍后再试',
        retryAfter
      });
    }

    bucket.push(now);
    buckets.set(ip, bucket);
    next();
  };

  middleware.reset = () => buckets.clear();
  middleware._buckets = buckets;
  return middleware;
}

module.exports = { createLoginRateLimit, resolveClientIp };
