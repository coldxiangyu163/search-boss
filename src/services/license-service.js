const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LICENSE_ALGORITHM = 'aes-256-cbc';
const LICENSE_SECRET = 'sb-enterprise-license-2026-secret-key';

class LicenseService {
  constructor({ licensePath } = {}) {
    this.licensePath = licensePath
      || process.env.LICENSE_FILE
      || path.resolve(__dirname, '../../license/license.key');
    this._cache = null;
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

  static generateLicense({ customerName, fingerprint, expiresAt, maxHrAccounts = 0, features = [] }) {
    const payload = {
      v: 1,
      customer: customerName,
      fingerprint,
      expiresAt,
      maxHrAccounts,
      features,
      issuedAt: new Date().toISOString()
    };

    const json = JSON.stringify(payload);
    const key = crypto.createHash('sha256').update(LICENSE_SECRET).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(LICENSE_ALGORITHM, key, iv);
    let encrypted = cipher.update(json, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const hmac = crypto.createHmac('sha256', LICENSE_SECRET)
      .update(iv.toString('base64') + '.' + encrypted)
      .digest('base64');

    return `${iv.toString('base64')}.${encrypted}.${hmac}`;
  }

  _decrypt(licenseStr) {
    const parts = licenseStr.trim().split('.');
    if (parts.length !== 3) {
      throw new Error('license_format_invalid');
    }

    const [ivB64, encrypted, hmac] = parts;

    const expectedHmac = crypto.createHmac('sha256', LICENSE_SECRET)
      .update(ivB64 + '.' + encrypted)
      .digest('base64');

    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'base64'), Buffer.from(expectedHmac, 'base64'))) {
      throw new Error('license_tampered');
    }

    const key = crypto.createHash('sha256').update(LICENSE_SECRET).digest();
    const iv = Buffer.from(ivB64, 'base64');
    const decipher = crypto.createDecipheriv(LICENSE_ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  }

  validate() {
    if (this._cache && this._cache.checkedAt > Date.now() - 60_000) {
      return this._cache.result;
    }

    const result = this._doValidate();
    this._cache = { result, checkedAt: Date.now() };
    return result;
  }

  _doValidate() {
    if (!fs.existsSync(this.licensePath)) {
      return { valid: false, error: 'license_file_not_found', message: '未找到授权文件' };
    }

    let payload;
    try {
      const content = fs.readFileSync(this.licensePath, 'utf8');
      payload = this._decrypt(content);
    } catch (err) {
      return { valid: false, error: 'license_decrypt_failed', message: '授权文件解密失败: ' + err.message };
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
      if (expires < new Date()) {
        return {
          valid: false,
          error: 'license_expired',
          message: `授权已过期 (${payload.expiresAt})`,
          expiresAt: payload.expiresAt
        };
      }
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

function licenseMiddleware(licenseService) {
  return (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/api/auth/')) {
      return next();
    }

    const result = licenseService.validate();
    if (!result.valid) {
      return res.status(403).json({
        error: result.error,
        message: result.message
      });
    }

    req.license = result;
    next();
  };
}

module.exports = {
  LicenseService,
  licenseMiddleware
};
