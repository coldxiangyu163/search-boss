#!/usr/bin/env node
'use strict';

const { LicenseService } = require('../src/services/license-service');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);

function usage() {
  console.log(`
search-boss 企业版授权生成工具

用法:
  node scripts/generate-license.js <命令> [参数]

命令:
  keygen [--output <目录>]              生成 Ed25519 密钥对（首次使用前执行一次）
  fingerprint                           获取当前机器的硬件指纹
  generate --customer <名称> [选项]     生成授权文件

generate 选项:
  --customer <名称>         客户名称 (必填)
  --fingerprint <值>        绑定的硬件指纹 (默认: * 表示不绑定)
  --expires <日期>          过期日期, 格式 YYYY-MM-DD (默认: 1年后)
  --max-hr <数量>           最大 HR 账号数 (默认: 0 表示不限)
  --features <列表>         功能列表, 逗号分隔
  --output <路径>           输出文件路径 (默认: license/license.key)
  --private-key-file <路径> 私钥文件路径 (默认读取环境变量)

示例:
  # 获取目标机器指纹
  node scripts/generate-license.js fingerprint

  # 生成绑定指纹的授权 (有效期1年, 最多10个HR)
  node scripts/generate-license.js generate \\
    --customer "某某公司" \\
    --fingerprint "abc123..." \\
    --expires 2027-04-03 \\
    --max-hr 10

  # 生成不绑定机器的授权
  node scripts/generate-license.js generate \\
    --customer "测试客户" \\
    --fingerprint "*"

私钥来源:
  优先级 1: --private-key-file
  优先级 2: LICENSE_PRIVATE_KEY_FILE
  优先级 3: LICENSE_PRIVATE_KEY
`);
}

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--customer' && args[i + 1]) opts.customer = args[++i];
    else if (args[i] === '--fingerprint' && args[i + 1]) opts.fingerprint = args[++i];
    else if (args[i] === '--expires' && args[i + 1]) opts.expires = args[++i];
    else if (args[i] === '--max-hr' && args[i + 1]) opts.maxHr = Number(args[++i]);
    else if (args[i] === '--features' && args[i + 1]) opts.features = args[++i].split(',');
    else if (args[i] === '--output' && args[i + 1]) opts.output = args[++i];
    else if (args[i] === '--private-key-file' && args[i + 1]) opts.privateKeyFile = args[++i];
  }
  return opts;
}

function readPrivateKey(opts) {
  const filePath = opts.privateKeyFile || process.env.LICENSE_PRIVATE_KEY_FILE;
  if (filePath) {
    return fs.readFileSync(path.resolve(filePath), 'utf8');
  }

  if (process.env.LICENSE_PRIVATE_KEY) {
    return process.env.LICENSE_PRIVATE_KEY;
  }

  throw new Error('缺少私钥，请通过 --private-key-file、LICENSE_PRIVATE_KEY_FILE 或 LICENSE_PRIVATE_KEY 提供');
}

const command = args[0];

if (command === 'keygen') {
  const opts = parseArgs(args.slice(1));
  const outputDir = opts.output || path.resolve(__dirname, '../.keys');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const privatePath = path.join(outputDir, 'license-private.pem');
  const publicPath = path.join(outputDir, 'license-public.pem');

  if (fs.existsSync(privatePath)) {
    console.error(`错误: 私钥已存在 ${privatePath}`);
    console.error('如需重新生成，请先手动删除旧密钥文件');
    process.exit(1);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  fs.writeFileSync(privatePath, privateKey, { mode: 0o600 });
  fs.writeFileSync(publicPath, publicKey);

  console.log('Ed25519 密钥对已生成:');
  console.log(`  私钥: ${privatePath} (妥善保管，切勿泄露)`);
  console.log(`  公钥: ${publicPath}`);
  console.log('');
  console.log('下一步:');
  console.log('  1. 将公钥内容替换到 src/services/license-service.js 的 VENDOR_PUBLIC_KEY');
  console.log('  2. 生成授权时通过 --private-key-file 指定私钥:');
  console.log(`     node scripts/generate-license.js generate --customer "客户名" --private-key-file ${privatePath}`);
  console.log('  3. 或设置环境变量:');
  console.log(`     export LICENSE_PRIVATE_KEY_FILE=${privatePath}`);

} else if (command === 'fingerprint') {
  const fp = LicenseService.getHardwareFingerprint();
  console.log('当前机器硬件指纹:');
  console.log(fp);
  console.log('\n将此值提供给授权生成方，用于 --fingerprint 参数');

} else if (command === 'generate') {
  const opts = parseArgs(args.slice(1));

  if (!opts.customer) {
    console.error('错误: --customer 参数必填');
    process.exit(1);
  }

  const oneYearLater = new Date();
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

  const expiresAt = opts.expires || oneYearLater.toISOString().split('T')[0] + 'T23:59:59Z';
  const privateKey = readPrivateKey(opts);

  const license = LicenseService.generateLicense({
    customerName: opts.customer,
    fingerprint: opts.fingerprint || '*',
    expiresAt,
    maxHrAccounts: opts.maxHr || 0,
    features: opts.features || [],
    privateKey
  });

  const outputPath = opts.output || path.resolve(__dirname, '../license/license.key');
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, license, 'utf8');

  console.log('授权文件已生成:');
  console.log(`  文件: ${outputPath}`);
  console.log(`  客户: ${opts.customer}`);
  console.log(`  指纹: ${opts.fingerprint || '* (不绑定)'}`);
  console.log(`  过期: ${expiresAt}`);
  console.log(`  HR上限: ${opts.maxHr || '不限'}`);
  if (opts.features?.length) {
    console.log(`  功能: ${opts.features.join(', ')}`);
  }

} else {
  usage();
}
