const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  LicenseService,
  getHrAccountLicenseStatus
} = require('../src/services/license-service');

function createKeyPair() {
  return crypto.generateKeyPairSync('ed25519');
}

test('getHardwareFingerprint returns a consistent sha256 hex string', () => {
  const fp1 = LicenseService.getHardwareFingerprint();
  const fp2 = LicenseService.getHardwareFingerprint();
  assert.equal(fp1, fp2);
  assert.match(fp1, /^[0-9a-f]{64}$/);
});

test('generateLicense requires a private key', () => {
  assert.throws(
    () => LicenseService.generateLicense({
      customerName: 'test-corp',
      fingerprint: '*',
      expiresAt: '2099-12-31T23:59:59Z'
    }),
    /license_private_key_missing/
  );
});

test('generateLicense produces a signed 2-part token', () => {
  const { privateKey } = createKeyPair();
  const license = LicenseService.generateLicense({
    customerName: 'test-corp',
    fingerprint: '*',
    expiresAt: '2099-12-31T23:59:59Z',
    maxHrAccounts: 5,
    privateKey
  });

  const parts = license.split('.');
  assert.equal(parts.length, 2);
});

test('validate succeeds with valid wildcard license', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');
  const { publicKey, privateKey } = createKeyPair();

  const license = LicenseService.generateLicense({
    customerName: 'test-corp',
    fingerprint: '*',
    expiresAt: '2099-12-31T23:59:59Z',
    maxHrAccounts: 10,
    privateKey
  });

  fs.writeFileSync(licensePath, license);

  const svc = new LicenseService({ licensePath, publicKey });
  const result = svc.validate();

  assert.equal(result.valid, true);
  assert.equal(result.customer, 'test-corp');
  assert.equal(result.maxHrAccounts, 10);

  fs.rmSync(tmpDir, { recursive: true });
});

test('validate fails when license file is missing', () => {
  const svc = new LicenseService({ licensePath: '/tmp/nonexistent-license.key' });
  const result = svc.validate();

  assert.equal(result.valid, false);
  assert.equal(result.error, 'license_file_not_found');
});

test('validate fails when license is expired', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');
  const { publicKey, privateKey } = createKeyPair();

  const license = LicenseService.generateLicense({
    customerName: 'expired-corp',
    fingerprint: '*',
    expiresAt: '2020-01-01T00:00:00Z',
    privateKey
  });

  fs.writeFileSync(licensePath, license);

  const svc = new LicenseService({ licensePath, publicKey });
  const result = svc.validate();

  assert.equal(result.valid, false);
  assert.equal(result.error, 'license_expired');

  fs.rmSync(tmpDir, { recursive: true });
});

test('validate fails when fingerprint does not match', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');
  const { publicKey, privateKey } = createKeyPair();

  const license = LicenseService.generateLicense({
    customerName: 'wrong-machine',
    fingerprint: 'aaaa' + '0'.repeat(60),
    expiresAt: '2099-12-31T23:59:59Z',
    privateKey
  });

  fs.writeFileSync(licensePath, license);

  const svc = new LicenseService({ licensePath, publicKey });
  const result = svc.validate();

  assert.equal(result.valid, false);
  assert.equal(result.error, 'license_fingerprint_mismatch');

  fs.rmSync(tmpDir, { recursive: true });
});

test('validate fails when license content is tampered', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');
  const { publicKey, privateKey } = createKeyPair();

  const license = LicenseService.generateLicense({
    customerName: 'tampered',
    fingerprint: '*',
    expiresAt: '2099-12-31T23:59:59Z',
    privateKey
  });

  const [payload, signature] = license.split('.');
  const tampered = `${payload.slice(0, -4)}XXXX.${signature}`;
  fs.writeFileSync(licensePath, tampered);

  const svc = new LicenseService({ licensePath, publicKey });
  const result = svc.validate();

  assert.equal(result.valid, false);
  assert.equal(result.error, 'license_decrypt_failed');

  fs.rmSync(tmpDir, { recursive: true });
});

test('validate returns warning when license expires within 30 days', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');
  const { publicKey, privateKey } = createKeyPair();

  const soon = new Date();
  soon.setDate(soon.getDate() + 15);

  const license = LicenseService.generateLicense({
    customerName: 'expiring-corp',
    fingerprint: '*',
    expiresAt: soon.toISOString(),
    privateKey
  });

  fs.writeFileSync(licensePath, license);

  const svc = new LicenseService({ licensePath, publicKey });
  const result = svc.validate();

  assert.equal(result.valid, true);
  assert.ok(result.warning);
  assert.equal(result.warning.expiresSoon, true);
  assert.ok(result.daysRemaining <= 16);
  assert.ok(result.daysRemaining >= 14);

  fs.rmSync(tmpDir, { recursive: true });
});

test('validate returns no warning when license has more than 30 days', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');
  const { publicKey, privateKey } = createKeyPair();

  const license = LicenseService.generateLicense({
    customerName: 'safe-corp',
    fingerprint: '*',
    expiresAt: '2099-12-31T23:59:59Z',
    privateKey
  });

  fs.writeFileSync(licensePath, license);

  const svc = new LicenseService({ licensePath, publicKey });
  const result = svc.validate();

  assert.equal(result.valid, true);
  assert.equal(result.warning, undefined);
  assert.ok(result.daysRemaining > 30);

  fs.rmSync(tmpDir, { recursive: true });
});

test('reload picks up new license file without restart', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');
  const { publicKey, privateKey } = createKeyPair();

  const oldLicense = LicenseService.generateLicense({
    customerName: 'old-corp',
    fingerprint: '*',
    expiresAt: '2020-01-01T00:00:00Z',
    privateKey
  });
  fs.writeFileSync(licensePath, oldLicense);

  const svc = new LicenseService({ licensePath, publicKey });
  assert.equal(svc.validate().valid, false);
  assert.equal(svc.validate().error, 'license_expired');

  const newLicense = LicenseService.generateLicense({
    customerName: 'renewed-corp',
    fingerprint: '*',
    expiresAt: '2099-12-31T23:59:59Z',
    maxHrAccounts: 20,
    privateKey
  });
  fs.writeFileSync(licensePath, newLicense);

  const result = svc.reload();
  assert.equal(result.valid, true);
  assert.equal(result.customer, 'renewed-corp');
  assert.equal(result.maxHrAccounts, 20);

  fs.rmSync(tmpDir, { recursive: true });
});

test('validate auto-detects file change within cache window', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');
  const { publicKey, privateKey } = createKeyPair();

  const expiredLicense = LicenseService.generateLicense({
    customerName: 'auto-detect',
    fingerprint: '*',
    expiresAt: '2020-01-01T00:00:00Z',
    privateKey
  });
  fs.writeFileSync(licensePath, expiredLicense);

  const svc = new LicenseService({ licensePath, publicKey });
  assert.equal(svc.validate().valid, false);

  const freshLicense = LicenseService.generateLicense({
    customerName: 'auto-detect-renewed',
    fingerprint: '*',
    expiresAt: '2099-12-31T23:59:59Z',
    privateKey
  });
  fs.writeFileSync(licensePath, freshLicense);

  const result = svc.validate();
  assert.equal(result.valid, true);
  assert.equal(result.customer, 'auto-detect-renewed');

  fs.rmSync(tmpDir, { recursive: true });
});

test('validate succeeds with matching hardware fingerprint', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');
  const { publicKey, privateKey } = createKeyPair();

  const fp = LicenseService.getHardwareFingerprint();

  const license = LicenseService.generateLicense({
    customerName: 'bound-corp',
    fingerprint: fp,
    expiresAt: '2099-12-31T23:59:59Z',
    maxHrAccounts: 3,
    features: ['source', 'followup'],
    privateKey
  });

  fs.writeFileSync(licensePath, license);

  const svc = new LicenseService({ licensePath, publicKey });
  const result = svc.validate();

  assert.equal(result.valid, true);
  assert.equal(result.customer, 'bound-corp');
  assert.equal(result.maxHrAccounts, 3);
  assert.deepEqual(result.features, ['source', 'followup']);

  fs.rmSync(tmpDir, { recursive: true });
});

test('getHrAccountLicenseStatus allows creation when license has no cap', async () => {
  const result = await getHrAccountLicenseStatus({
    pool: {
      async query() {
        throw new Error('should not query without a cap');
      }
    },
    license: { valid: true, maxHrAccounts: 0 }
  });

  assert.deepEqual(result, { allowed: true, limit: 0, activeCount: null });
});

test('getHrAccountLicenseStatus blocks creation when active HR accounts reach the license cap', async () => {
  const result = await getHrAccountLicenseStatus({
    pool: {
      async query(sql) {
        assert.match(sql, /from hr_accounts/i);
        return { rows: [{ count: '3' }] };
      }
    },
    license: { valid: true, maxHrAccounts: 3 }
  });

  assert.equal(result.allowed, false);
  assert.equal(result.error, 'license_hr_account_limit_reached');
  assert.equal(result.limit, 3);
  assert.equal(result.activeCount, 3);
});
