const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { LicenseService } = require('../src/services/license-service');

test('getHardwareFingerprint returns a consistent sha256 hex string', () => {
  const fp1 = LicenseService.getHardwareFingerprint();
  const fp2 = LicenseService.getHardwareFingerprint();
  assert.equal(fp1, fp2);
  assert.match(fp1, /^[0-9a-f]{64}$/);
});

test('generateLicense produces a 3-part base64 token', () => {
  const license = LicenseService.generateLicense({
    customerName: 'test-corp',
    fingerprint: '*',
    expiresAt: '2099-12-31T23:59:59Z',
    maxHrAccounts: 5
  });

  const parts = license.split('.');
  assert.equal(parts.length, 3);
});

test('validate succeeds with valid wildcard license', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');

  const license = LicenseService.generateLicense({
    customerName: 'test-corp',
    fingerprint: '*',
    expiresAt: '2099-12-31T23:59:59Z',
    maxHrAccounts: 10
  });

  fs.writeFileSync(licensePath, license);

  const svc = new LicenseService({ licensePath });
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

  const license = LicenseService.generateLicense({
    customerName: 'expired-corp',
    fingerprint: '*',
    expiresAt: '2020-01-01T00:00:00Z'
  });

  fs.writeFileSync(licensePath, license);

  const svc = new LicenseService({ licensePath });
  const result = svc.validate();

  assert.equal(result.valid, false);
  assert.equal(result.error, 'license_expired');

  fs.rmSync(tmpDir, { recursive: true });
});

test('validate fails when fingerprint does not match', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');

  const license = LicenseService.generateLicense({
    customerName: 'wrong-machine',
    fingerprint: 'aaaa' + '0'.repeat(60),
    expiresAt: '2099-12-31T23:59:59Z'
  });

  fs.writeFileSync(licensePath, license);

  const svc = new LicenseService({ licensePath });
  const result = svc.validate();

  assert.equal(result.valid, false);
  assert.equal(result.error, 'license_fingerprint_mismatch');

  fs.rmSync(tmpDir, { recursive: true });
});

test('validate fails when license content is tampered', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');

  const license = LicenseService.generateLicense({
    customerName: 'tampered',
    fingerprint: '*',
    expiresAt: '2099-12-31T23:59:59Z'
  });

  const tampered = license.slice(0, -5) + 'XXXXX';
  fs.writeFileSync(licensePath, tampered);

  const svc = new LicenseService({ licensePath });
  const result = svc.validate();

  assert.equal(result.valid, false);
  assert.equal(result.error, 'license_decrypt_failed');

  fs.rmSync(tmpDir, { recursive: true });
});

test('validate succeeds with matching hardware fingerprint', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  const licensePath = path.join(tmpDir, 'license.key');

  const fp = LicenseService.getHardwareFingerprint();

  const license = LicenseService.generateLicense({
    customerName: 'bound-corp',
    fingerprint: fp,
    expiresAt: '2099-12-31T23:59:59Z',
    maxHrAccounts: 3,
    features: ['source', 'followup']
  });

  fs.writeFileSync(licensePath, license);

  const svc = new LicenseService({ licensePath });
  const result = svc.validate();

  assert.equal(result.valid, true);
  assert.equal(result.customer, 'bound-corp');
  assert.equal(result.maxHrAccounts, 3);
  assert.deepEqual(result.features, ['source', 'followup']);

  fs.rmSync(tmpDir, { recursive: true });
});
