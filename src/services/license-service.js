const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WARNING_DAYS = 30;
const CACHE_TTL_MS = 60_000;
const VENDOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi7smF4jqVPZ7pA4Q/Plr8XnFyEyd1r6LtehChdmbPMM=
-----END PUBLIC KEY-----`;

class LicenseService {
  constructor({ licensePath, publicKey = VENDOR_PUBLIC_KEY } = {}) {
    this.licensePath = licensePath
      || process.env.LICENSE_FILE
      || path.resolve(__dirname, '../../license/license.key');
    this.publicKey = publicKey;
    this._cache = null;
    this._lastFileHash = null;
  }

  static getHardwareFingerprint() {
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
    const interfaces = os.networkInterfaces();
    const macs = [];

    for (const iface of Object.values(interfaces)) {
      for (const info of iface) {
        if (!info.internal && info.mac && info.mac !== '00:00:00:00:00:00') {
          macs.push(info.mac);
        }
      }
    }

    macs.sort();
    const raw = `${os.hostname()}|${cpuModel}|${os.totalmem()}|${macs.join(',')}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  static generateLicense({
    customerName,
    fingerprint,
    expiresAt,
    maxHrAccounts = 0,
    features = [],
    privateKey
  }) {
    if (!privateKey) {
      throw new Error('license_private_key_missing');
    }

    const payload = {
      v: 1,
      customer: customerName,
      fingerprint,
      expiresAt,
      maxHrAccounts,
      features,
      issuedAt: new Date().toISOString()
    };

    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    const signature = crypto.sign(
      null,
      Buffer.from(encodedPayload),
      privateKey
    );

    return `${encodedPayload}.${encodeBase64Url(signature)}`;
  }

  validate() {
    const fileChanged = this._hasFileChanged();
    if (fileChanged) {
      this._cache = null;
    }

    if (this._cache && this._cache.checkedAt > Date.now() - CACHE_TTL_MS) {
      return this._cache.result;
    }

    const result = this._doValidate();
    this._cache = { result, checkedAt: Date.now() };
    return result;
  }

  reload() {
    this._cache = null;
    this._lastFileHash = null;
    return this.validate();
  }

  _hasFileChanged() {
    try {
      if (!fs.existsSync(this.licensePath)) return this._lastFileHash !== null;
      const content = fs.readFileSync(this.licensePath, 'utf8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (this._lastFileHash === null) {
        this._lastFileHash = hash;
        return false;
      }
      if (hash !== this._lastFileHash) {
        this._lastFileHash = hash;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  _doValidate() {
    if (!fs.existsSync(this.licensePath)) {
      return { valid: false, error: 'license_file_not_found', message: '未找到授权文件' };
    }

    let payload;
    try {
      const content = fs.readFileSync(this.licensePath, 'utf8');
      payload = decodeAndVerifyLicense(content, this.publicKey);
    } catch (err) {
      return { valid: false, error: 'license_decrypt_failed', message: `授权文件校验失败: ${err.message}` };
    }

    if (payload.fingerprint && payload.fingerprint !== '*') {
      const currentFingerprint = LicenseService.getHardwareFingerprint();
      if (payload.fingerprint !== currentFingerprint) {
        return {
          valid: false,
          error: 'license_fingerprint_mismatch',
          message: '授权文件与当前机器不匹配',
          expected: payload.fingerprint,
          actual: currentFingerprint
        };
      }
    }

    if (payload.expiresAt) {
      const expires = new Date(payload.expiresAt);
      const now = new Date();

      if (expires < now) {
        return {
          valid: false,
          error: 'license_expired',
          message: `授权已过期 (${payload.expiresAt})`,
          expiresAt: payload.expiresAt
        };
      }

      const daysRemaining = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
      const warning = daysRemaining <= WARNING_DAYS
        ? { expiresSoon: true, daysRemaining, message: `授权将在 ${daysRemaining} 天后到期` }
        : null;

      return {
        valid: true,
        customer: payload.customer,
        expiresAt: payload.expiresAt,
        maxHrAccounts: payload.maxHrAccounts || 0,
        features: payload.features || [],
        issuedAt: payload.issuedAt,
        daysRemaining,
        ...(warning && { warning })
      };
    }

    return {
      valid: true,
      customer: payload.customer,
      expiresAt: payload.expiresAt,
      maxHrAccounts: payload.maxHrAccounts || 0,
      features: payload.features || [],
      issuedAt: payload.issuedAt
    };
  }
}

async function getHrAccountLicenseStatus({ pool, license }) {
  const limit = Number(license?.maxHrAccounts || 0);

  if (!license?.valid || !Number.isFinite(limit) || limit <= 0) {
    return { allowed: true, limit: 0, activeCount: null };
  }

  const result = await pool.query(
    "select count(*) from hr_accounts where status = 'active'"
  );
  const activeCount = Number(result.rows[0]?.count || 0);

  if (activeCount >= limit) {
    return {
      allowed: false,
      error: 'license_hr_account_limit_reached',
      message: `授权允许的 HR 账号数量已达上限（${limit}个）`,
      limit,
      activeCount
    };
  }

  return {
    allowed: true,
    limit,
    activeCount
  };
}

function licenseMiddleware(licenseService) {
  return (req, res, next) => {
    const ext = req.path.split('.').pop();
    if (req.path === '/health'
      || req.path.startsWith('/api/auth/')
      || req.path === '/api/license'
      || req.path === '/api/license/reload'
      || req.path.startsWith('/api/setup/')
      || req.path === '/setup.html'
      || req.path === '/login.html'
      || ['css', 'js', 'png', 'jpg', 'svg', 'ico', 'woff', 'woff2'].includes(ext)) {
      return next();
    }

    const result = licenseService.validate();
    if (!result.valid) {
      return res.status(403).json({
        error: result.error,
        message: result.message
      });
    }

    if (result.warning) {
      res.set('X-License-Warning', result.warning.message);
      res.set('X-License-Days-Remaining', String(result.daysRemaining));
    }

    req.license = result;
    next();
  };
}

function decodeAndVerifyLicense(licenseStr, publicKey) {
  const parts = licenseStr.trim().split('.');
  if (parts.length !== 2) {
    throw new Error('license_format_invalid');
  }

  const [encodedPayload, encodedSignature] = parts;
  const signature = decodeBase64Url(encodedSignature);
  const verified = crypto.verify(
    null,
    Buffer.from(encodedPayload),
    publicKey,
    signature
  );

  if (!verified) {
    throw new Error('license_signature_invalid');
  }

  return JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'));
}

function encodeBase64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return buffer.toString('base64url');
}

function decodeBase64Url(value) {
  return Buffer.from(value, 'base64url');
}

module.exports = {
  LicenseService,
  VENDOR_PUBLIC_KEY,
  getHrAccountLicenseStatus,
  licenseMiddleware
};
