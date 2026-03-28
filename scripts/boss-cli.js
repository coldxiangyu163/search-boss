const { loadConfig } = require('../src/config');
const { BossCdpClient } = require('../src/services/boss-cdp-client');
const { BossSessionStore } = require('../src/services/boss-session-store');
const browserCommands = require('../src/services/boss-browser-commands');

async function executeCli(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    envFilePath,
    dependencies = {}
  } = {}
) {
  try {
    const options = parseArgs(argv);
    const config = loadConfig({ env, envFilePath });
    const resolvedDependencies = createDependencies({ config, dependencies });
    const payload = await runCommand({
      options,
      config,
      ...resolvedDependencies
    });

    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return { exitCode: 0, stdout: JSON.stringify(payload) };
  } catch (error) {
    const message = error.message || String(error);
    stderr.write(`${message}\n`);
    return { exitCode: 1, stderr: message };
  }
}

function parseArgs(argv) {
  const [first, second, ...rest] = argv;

  if (!first) {
    throw new Error('Missing command');
  }

  if (first === 'target') {
    if (!second || second.startsWith('--')) {
      throw new Error('Missing subcommand');
    }

    return parseOptions(rest, {
      command: first,
      subcommand: second
    });
  }

  return parseOptions(second ? [second, ...rest] : rest, {
    command: first
  });
}

function parseOptions(args, initialOptions) {
  const options = { ...initialOptions };

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];

    if (!key.startsWith('--')) {
      throw new Error(`Unexpected argument: ${key}`);
    }

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }

    options[toCamelCase(key.slice(2))] = value;
    index += 1;
  }

  return options;
}

function createDependencies({ config, dependencies }) {
  return {
    cdpClient: dependencies.cdpClient || new BossCdpClient({
      endpoint: config.bossCdpEndpoint
    }),
    sessionStore: dependencies.sessionStore || new BossSessionStore({
      sessionDir: config.bossCliSessionDir
    }),
    browserCommands: dependencies.browserCommands || browserCommands
  };
}

async function runCommand({ options, config, cdpClient, sessionStore, browserCommands }) {
  validateRequired(options);

  if (options.command === 'target' && options.subcommand === 'bind') {
    const target = await cdpClient.resolveBossTarget({
      targetId: options.targetId || null,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });
    const session = await sessionStore.bindTarget(options.runId, {
      targetId: target.id,
      tabUrl: target.url,
      lastOwner: 'boss-cli'
    });

    return { ok: true, session };
  }

  if (options.command === 'target' && options.subcommand === 'inspect') {
    const session = await sessionStore.loadSession(options.runId);
    const currentUrl = await browserCommands.getUrl({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return { ok: true, session, currentUrl };
  }

  if (options.command === 'joblist') {
    const session = await sessionStore.loadSession(options.runId);
    const data = await browserCommands.bossFetch({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      url: 'https://www.zhipin.com/wapi/zpjob/job/chatted/jobList'
    });

    return {
      ok: true,
      jobs: Array.isArray(data?.zpData)
        ? data.zpData.map((job) => ({
          jobName: job.jobName || '',
          salary: job.salaryDesc || '',
          city: job.address || '',
          status: Number(job.jobOnlineStatus) === 1 ? 'online' : 'closed',
          encryptJobId: job.encryptJobId || ''
        }))
        : []
    };
  }

  if (options.command === 'recommend') {
    const session = await sessionStore.loadSession(options.runId);
    const labelData = await browserCommands.bossFetch({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      url: 'https://www.zhipin.com/wapi/zprelation/friend/label/get'
    });
    const recommendData = await browserCommands.bossFetch({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      url: 'https://www.zhipin.com/wapi/zprelation/friend/greetRecSortList'
    });
    const labelMap = buildLabelMap(labelData?.zpData?.labels);
    const limit = Number(options.limit || 20);
    const friends = normalizeFriendList(recommendData);

    return {
      ok: true,
      candidates: friends.slice(0, limit).map((friend) => ({
        name: friend.name || '',
        jobName: friend.jobName || '',
        lastTime: friend.lastTime || '',
        labels: (friend.relationLabelList || [])
          .map((labelId) => labelMap.get(labelId) || String(labelId))
          .join(', '),
        encryptUid: friend.encryptUid || '',
        securityId: friend.securityId || '',
        encryptJobId: friend.encryptJobId || ''
      }))
    };
  }

  if (options.command === 'job-detail') {
    const session = await sessionStore.loadSession(options.runId);
    const jobListData = await browserCommands.bossFetch({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      url: 'https://www.zhipin.com/wapi/zpjob/job/chatted/jobList'
    });
    const job = normalizeJobList(jobListData).find((item) => item.encryptJobId === options.jobId);

    if (!job || !job.securityId) {
      throw new Error('boss_job_not_found');
    }

    const detailData = await browserCommands.bossFetch({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      url: `https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(job.securityId)}`
    });

    return {
      ok: true,
      job: normalizeJobDetail(detailData)
    };
  }

  if (options.command === 'chatlist') {
    const session = await sessionStore.loadSession(options.runId);
    const page = Number(options.page || 1);
    const limit = Number(options.limit || 20);
    const jobId = options.jobId || '0';
    const data = await browserCommands.bossFetch({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      url: `https://www.zhipin.com/wapi/zprelation/friend/getBossFriendListV2.json?page=${page}&status=0&jobId=${encodeURIComponent(jobId)}`
    });

    return {
      ok: true,
      chats: normalizeFriendList(data).slice(0, limit).map((friend) => ({
        name: friend.name || '',
        jobName: friend.jobName || '',
        lastMessage: friend.lastMessageInfo?.text || '',
        lastTime: friend.lastTime || '',
        encryptUid: friend.encryptUid || '',
        securityId: friend.securityId || ''
      }))
    };
  }

  if (options.command === 'chatmsg') {
    const session = await sessionStore.loadSession(options.runId);
    const page = Number(options.page || 1);
    const friend = await findFriendByUid({
      browserCommands,
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      encryptUid: options.uid
    });

    if (!friend) {
      throw new Error('boss_chat_friend_not_found');
    }

    const history = await browserCommands.bossFetch({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      url: `https://www.zhipin.com/wapi/zpchat/boss/historyMsg?gid=${encodeURIComponent(friend.uid)}&securityId=${encodeURIComponent(friend.securityId || '')}&page=${page}&c=20&src=0`
    });

    return {
      ok: true,
      messages: normalizeMessages(history, friend)
    };
  }

  if (options.command === 'resume-panel') {
    const session = await sessionStore.loadSession(options.runId);
    const resume = await browserCommands.evaluateJson({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      expression: buildResumePanelExpression()
    });

    return {
      ok: true,
      resume
    };
  }

  throw new Error(`Unknown command: ${options.command}${options.subcommand ? ` ${options.subcommand}` : ''}`);
}

function validateRequired(options) {
  if (!options.runId) {
    throw new Error('Missing required argument: --run-id');
  }
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function buildLabelMap(labels) {
  const map = new Map();

  if (!Array.isArray(labels)) {
    return map;
  }

  for (const label of labels) {
    map.set(label.labelId, label.label || String(label.labelId));
  }

  return map;
}

function normalizeFriendList(data) {
  if (Array.isArray(data?.zpData?.friendList)) {
    return data.zpData.friendList;
  }

  if (Array.isArray(data?.friendList)) {
    return data.friendList;
  }

  return [];
}

function normalizeJobList(data) {
  if (Array.isArray(data?.zpData)) {
    return data.zpData;
  }

  if (Array.isArray(data?.zpData?.jobList)) {
    return data.zpData.jobList;
  }

  return [];
}

async function findFriendByUid({
  browserCommands,
  cdpClient,
  targetId,
  urlPrefix,
  encryptUid
}) {
  const data = await browserCommands.bossFetch({
    cdpClient,
    targetId,
    urlPrefix,
    url: 'https://www.zhipin.com/wapi/zprelation/friend/getBossFriendListV2.json?page=1&status=0&jobId=0'
  });

  return normalizeFriendList(data).find((friend) => friend.encryptUid === encryptUid) || null;
}

function normalizeJobDetail(data) {
  const zpData = data?.zpData || {};
  const jobInfo = zpData.jobInfo || {};
  const bossInfo = zpData.bossInfo || {};
  const brandComInfo = zpData.brandComInfo || {};

  return {
    name: jobInfo.jobName || '',
    salary: jobInfo.salaryDesc || '',
    experience: jobInfo.experienceName || '',
    degree: jobInfo.degreeName || '',
    city: jobInfo.locationName || '',
    district: [jobInfo.areaDistrict, jobInfo.businessDistrict].filter(Boolean).join('·'),
    description: jobInfo.postDescription || '',
    skills: Array.isArray(jobInfo.showSkills) ? jobInfo.showSkills.join(', ') : '',
    welfare: Array.isArray(brandComInfo.labels) ? brandComInfo.labels.join(', ') : '',
    bossName: bossInfo.name || '',
    bossTitle: bossInfo.title || '',
    activeTime: bossInfo.activeTimeDesc || '',
    company: brandComInfo.brandName || bossInfo.brandName || '',
    industry: brandComInfo.industryName || '',
    scale: brandComInfo.scaleName || '',
    stage: brandComInfo.stageName || '',
    address: jobInfo.address || '',
    url: jobInfo.encryptId
      ? `https://www.zhipin.com/job_detail/${jobInfo.encryptId}.html`
      : ''
  };
}

function buildResumePanelExpression() {
  return `(() => {
    const container = document.querySelector('.base-info-single-container') || document.querySelector('.base-info-content');
    if (!container) {
      throw new Error('boss_resume_panel_not_found');
    }

    const pickText = (selector) => {
      const el = container.querySelector(selector);
      return el ? (el.textContent || '').trim() : '';
    };

    const detailDiv = container.querySelector('.base-info-single-detial');
    let gender = '';
    let age = '';
    let experience = '';
    let degree = '';

    if (detailDiv) {
      const uses = detailDiv.querySelectorAll('use');
      for (const useEl of uses) {
        const href = useEl.getAttribute('xlink:href') || useEl.getAttribute('href') || '';
        if (href.includes('icon-men')) gender = '男';
        if (href.includes('icon-women')) gender = '女';
      }

      for (const child of Array.from(detailDiv.children)) {
        const text = (child.textContent || '').trim();
        if (!text) continue;
        if (/\\d+岁/.test(text)) age = text;
        else if (/年|经验|应届/.test(text)) experience = text;
        else if (['博士', '硕士', '本科', '大专', '高中', '中专', '中技', '初中'].some((item) => text.includes(item))) degree = text;
      }
    }

    const collectList = (selector) => Array.from(container.querySelectorAll(selector))
      .map((item) => (item.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean);

    const positionContent = container.querySelector('.position-content');
    return JSON.stringify({
      name: pickText('.base-name'),
      gender,
      age,
      experience,
      degree,
      activeTime: pickText('.active-time'),
      workHistory: collectList('.experience-content.detail-list li'),
      education: collectList('.experience-content.detail-list li .value'),
      jobChatting: positionContent ? ((positionContent.querySelector('.position-name')?.textContent || '').trim()) : '',
      expect: positionContent ? ((positionContent.querySelector('.position-item.expect .value')?.textContent || '').trim()) : ''
    });
  })()`;
}

function normalizeMessages(data, friend) {
  const messages = data?.zpData?.messages || data?.zpData?.historyMsgList || [];
  const typeMap = new Map([
    [1, 'text'],
    [2, 'image'],
    [3, 'greeting'],
    [4, 'resume'],
    [5, 'system'],
    [6, 'card'],
    [7, 'voice'],
    [8, 'video'],
    [9, 'emoji']
  ]);

  return messages.map((message) => {
    const from = message.from || {};
    const fromSelf = typeof from === 'object' ? from.uid !== friend.uid : false;

    return {
      from: fromSelf ? 'me' : (from.name || friend.name || ''),
      type: typeMap.get(message.type) || `other:${message.type}`,
      text: message.text || message.body?.text || '',
      time: message.time || ''
    };
  });
}

if (require.main === module) {
  executeCli(process.argv.slice(2)).then((result) => {
    process.exitCode = result.exitCode;
  });
}

module.exports = {
  executeCli,
  parseArgs
};
