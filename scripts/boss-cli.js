const { loadConfig } = require('../src/config');
const { BossCdpClient } = require('../src/services/boss-cdp-client');
const { BossSessionStore } = require('../src/services/boss-session-store');
const browserCommands = require('../src/services/boss-browser-commands');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

    const booleanFlags = ['--prefer-chat'];
    if (booleanFlags.includes(key)) {
      options[toCamelCase(key.slice(2))] = true;
      continue;
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
      urlPrefix: config.bossCdpTargetUrlPrefix,
      preferUrl: options.preferChat ? '/web/chat/index' : null
    });
    const session = await sessionStore.bindTarget(options.runId, {
      targetId: target.id,
      tabUrl: target.url,
      jobKey: options.jobKey || null,
      jobId: options.jobId || null,
      mode: options.mode || null,
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
      url: 'https://www.zhipin.com/wapi/zpjob/job/data/list?type=5'
    });

    return {
      ok: true,
      jobs: Array.isArray(data?.zpData?.data)
        ? data.zpData.data.map((job) => ({
          jobName: job.jobName || '',
          salary: job.lowSalary && job.highSalary ? `${job.lowSalary}-${job.highSalary}K` : '',
          city: job.locationName || '',
          status: Number(job.jobStatus) === 0 ? 'online' : 'closed',
          encryptJobId: job.encryptId || ''
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

  if (options.command === 'recommend-pager') {
    const session = await sessionStore.loadSession(options.runId);
    const direction = options.direction || 'next';
    const result = await browserCommands.clickRecommendPager({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      direction
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'recommend-next-candidate') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.clickRecommendPager({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      direction: 'next'
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'recommend-state') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.inspectRecommendState({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'recommend-detail') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.inspectRecommendDetail({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'recommend-greet') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.clickRecommendGreet({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'context-snapshot') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.inspectContextSnapshot({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      jobId: options.jobId || null
    });

    result.thread = await enrichThreadIdentity({
      result: result.thread,
      session,
      browserCommands,
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'job-detail') {
    const session = await sessionStore.loadSession(options.runId);
    const editData = await browserCommands.bossFetch({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      url: `https://www.zhipin.com/wapi/zpjob/job/edit?encJobId=${encodeURIComponent(options.jobId)}`
    });

    if (!editData?.zpData?.job) {
      throw new Error('boss_job_not_found');
    }

    return {
      ok: true,
      job: normalizeJobEditDetail(editData)
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

  if (options.command === 'chat-open-thread') {
    const session = await sessionStore.loadSession(options.runId);
    const friend = typeof browserCommands.bossFetch === 'function'
      ? await findFriendByUid({
        browserCommands,
        cdpClient,
        targetId: session.targetId,
        urlPrefix: config.bossCdpTargetUrlPrefix,
        encryptUid: options.uid,
        jobId: session.jobId || '0'
      })
      : null;
    const result = await browserCommands.openChatThread({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      uid: options.uid,
      friendName: friend?.name || '',
      jobName: friend?.jobName || '',
      lastTime: friend?.lastTime || '',
      lastMessage: friend?.lastMessageInfo?.text || ''
    });

    if (result?.opened && typeof sessionStore.saveSession === 'function') {
      await sessionStore.saveSession(options.runId, {
        ...session,
        selectedUid: options.uid,
        lastOwner: 'boss-cli'
      });
    }

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'chat-thread-state') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.inspectChatThreadState({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    if (!result.activeUid && result.threadOpen) {
      const enriched = await enrichThreadIdentity({
        result,
        session,
        browserCommands,
        cdpClient,
        targetId: session.targetId,
        urlPrefix: config.bossCdpTargetUrlPrefix
      });
      Object.assign(result, enriched);
    }

    if (result.threadOpen && !result.activeUid) {
      throw new Error('boss_chat_active_uid_unresolved');
    }

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'chat-select-job') {
    const session = await sessionStore.loadSession(options.runId);
    if (!options.jobName) {
      throw new Error('Missing value for --job-name');
    }

    const result = await browserCommands.selectChatJobFilter({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      jobName: options.jobName
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'chat-select-unread') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.selectChatUnreadFilter({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'chat-visible-list') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.inspectVisibleChatList({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      limit: Number(options.limit || 30)
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'bring-to-front') {
    const session = await sessionStore.loadSession(options.runId);
    await browserCommands.bringToFront({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });
    return { ok: true };
  }

  if (options.command === 'recommend-list') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.inspectRecommendList({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      limit: Number(options.limit || 10)
    });
    return { ok: true, ...result };
  }

  if (options.command === 'recommend-greet-coords') {
    const session = await sessionStore.loadSession(options.runId);
    if (!options.x || !options.y) {
      throw new Error('Missing --x or --y');
    }
    const result = await browserCommands.clickRecommendGreetByCoords({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      x: Number(options.x),
      y: Number(options.y)
    });
    return { ok: true, ...result };
  }

  if (options.command === 'recommend-scroll-card') {
    const session = await sessionStore.loadSession(options.runId);
    if (options.cardIndex === undefined) {
      throw new Error('Missing --card-index');
    }
    const result = await browserCommands.scrollRecommendCardIntoView({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      cardIndex: Number(options.cardIndex)
    });
    return { ok: true, ...result };
  }

  if (options.command === 'recommend-switch-latest') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.switchRecommendToLatest({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });
    return { ok: true, ...result };
  }

  if (options.command === 'click-at-coords') {
    const session = await sessionStore.loadSession(options.runId);
    if (!options.x || !options.y) {
      throw new Error('Missing --x or --y');
    }
    const result = await browserCommands.clickAtCoords({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      x: Number(options.x),
      y: Number(options.y)
    });
    return { ok: true, ...result };
  }

  if (options.command === 'recommend-close-popup') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.closeRecommendPopup({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });
    return { ok: true, ...result };
  }

  if (options.command === 'recommend-switch-grid') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.switchRecommendToGridView({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });
    return { ok: true, ...result };
  }

  if (options.command === 'recommend-select-job') {
    const session = await sessionStore.loadSession(options.runId);
    if (!options.jobName) {
      throw new Error('Missing value for --job-name');
    }
    const result = await browserCommands.selectRecommendJob({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      jobName: options.jobName
    });
    return { ok: true, ...result };
  }

  if (options.command === 'recommend-click-first-card') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.clickFirstRecommendCard({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });
    return { ok: true, ...result };
  }

  if (options.command === 'chat-read-messages') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.readOpenThreadMessages({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      limit: Number(options.limit || 20)
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'chat-click-row') {
    const session = await sessionStore.loadSession(options.runId);
    const index = options.index !== undefined ? Number(options.index) : undefined;
    const dataId = options['data-id'] || undefined;

    const result = await browserCommands.clickChatRow({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      index,
      dataId
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'navigate') {
    const session = await sessionStore.loadSession(options.runId);
    if (!options.url) {
      throw new Error('Missing value for --url');
    }

    const result = await browserCommands.navigateTo({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      url: options.url
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'chat-send-message') {
    const session = await sessionStore.loadSession(options.runId);
    if (!options.text) {
      throw new Error('Missing value for --text');
    }

    const result = await browserCommands.sendChatMessage({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      text: options.text
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'chat-request-resume') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.clickRequestResume({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'chat-request-resume-state') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.inspectResumeRequestState({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
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

  if (options.command === 'attachment-state') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.inspectAttachmentState({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'resume-consent-state') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.inspectResumeConsentState({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'resume-accept-consent') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.acceptResumeConsent({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'resume-preview-meta') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.inspectResumePreviewMeta({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'resume-download') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.downloadResumeAttachment({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });
    const outputPath = options.outputPath;
    if (!outputPath) {
      throw new Error('Missing value for --output-path');
    }
    const absoluteOutputPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
    const bytes = Buffer.from(result.base64, 'base64');
    fs.writeFileSync(absoluteOutputPath, bytes);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

    return {
      ok: true,
      fileName: result.fileName,
      mimeType: result.mimeType,
      fileSize: result.fileSize,
      sha256,
      storedPath: absoluteOutputPath,
      sourceUrl: result.sourceUrl
    };
  }

  if (options.command === 'resume-close-detail') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.closeResumeDetail({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });

    return {
      ok: true,
      ...result
    };
  }

  if (options.command === 'recommend-setup-canvas-capture') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.setupResumeCanvasCapture({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });
    return { ok: true, ...result };
  }

  if (options.command === 'recommend-reset-canvas-capture') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.resetResumeCanvasCapture({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });
    return { ok: true, ...result };
  }

  if (options.command === 'recommend-scroll-read-detail') {
    const session = await sessionStore.loadSession(options.runId);
    const result = await browserCommands.scrollAndReadResumeDetail({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix
    });
    return { ok: true, ...result };
  }

  if (options.command === 'recruit-data') {
    const session = await sessionStore.loadSession(options.runId);
    const data = await browserCommands.bossFetch({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      url: 'https://www.zhipin.com/wapi/zpboss/h5/weeklyReportV3/recruitDataCenter/get.json?jobId=0&platform=1&date='
    });

    if (!data?.zpData?.todayData) {
      throw new Error('boss_recruit_data_unavailable');
    }

    return {
      ok: true,
      ...normalizeRecruitApiData(data.zpData)
    };
  }

  if (options.command === 'recommend-apply-filters') {
    const session = await sessionStore.loadSession(options.runId);
    if (!options.filters) {
      throw new Error('Missing value for --filters');
    }
    const filters = JSON.parse(options.filters);
    const result = await browserCommands.applyRecommendFilters({
      cdpClient,
      targetId: session.targetId,
      urlPrefix: config.bossCdpTargetUrlPrefix,
      filters
    });
    return { ok: true, ...result };
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
  encryptUid,
  jobId = '0'
}) {
  const data = await browserCommands.bossFetch({
    cdpClient,
    targetId,
    urlPrefix,
    url: `https://www.zhipin.com/wapi/zprelation/friend/getBossFriendListV2.json?page=1&status=0&jobId=${encodeURIComponent(jobId)}`
  });

  return normalizeFriendList(data).find((friend) => friend.encryptUid === encryptUid) || null;
}

async function enrichThreadIdentity({ result, session, browserCommands, cdpClient, targetId, urlPrefix }) {
  if (!result) {
    return result;
  }

  if (result.encryptUid || result.activeUid) {
    return result;
  }

  const fallbackUid = session?.selectedUid || '';
  if (fallbackUid) {
    return {
      ...result,
      encryptUid: result.encryptUid || fallbackUid,
      activeUid: result.activeUid || fallbackUid
    };
  }

  const inferredUid = typeof browserCommands.bossFetch === 'function'
    ? await inferUidFromThreadMetadata({
      result,
      session,
      browserCommands,
      cdpClient,
      targetId,
      urlPrefix
    })
    : '';

  if (inferredUid) {
    return {
      ...result,
      encryptUid: result.encryptUid || inferredUid,
      activeUid: result.activeUid || inferredUid
    };
  }

  return result;
}

async function inferUidFromThreadMetadata({ result, session, browserCommands, cdpClient, targetId, urlPrefix }) {
  const thread = result?.activeThread || result?.thread || {};
  const threadName = String(thread.name || '').trim();
  const threadJobName = String(thread.jobName || '').trim();
  const threadLastTime = String(thread.lastTime || '').trim();

  if (!threadName && !threadJobName && !threadLastTime) {
    return '';
  }

  const data = await browserCommands.bossFetch({
    cdpClient,
    targetId,
    urlPrefix,
    url: `https://www.zhipin.com/wapi/zprelation/friend/getBossFriendListV2.json?page=1&status=0&jobId=${encodeURIComponent(session?.jobId || '0')}`
  });

  const matches = normalizeFriendList(data).filter((friend) => {
    if (threadName && friend.name !== threadName) {
      return false;
    }
    if (threadJobName && friend.jobName !== threadJobName) {
      return false;
    }
    if (threadLastTime && friend.lastTime !== threadLastTime) {
      return false;
    }
    return true;
  });

  return matches.length === 1 ? (matches[0].encryptUid || '') : '';
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

function normalizeRecruitApiData(zpData) {
  const d = zpData.todayData || {};
  const rights = zpData.dailyRightStates || {};
  const viewRight = rights.viewRightState?.progressBarList?.[0] || {};
  const chatRight = rights.chatRightState?.progressBarList?.[0] || {};

  return {
    metrics: {
      viewed: { value: d.view ?? 0, delta: d.viewCTY ?? 0 },
      viewedMe: { value: d.viewed ?? 0, delta: d.viewedCTY ?? 0 },
      greeted: { value: d.chatInitiative ?? 0, delta: d.chatInitiativeCTY ?? 0 },
      newGreetings: { value: d.contactMe ?? 0, delta: d.contactMeCTY ?? 0 },
      chatted: { value: d.chat ?? 0, delta: d.chatCTY ?? 0 },
      resumesReceived: { value: d.resume ?? 0, delta: d.resumeCTY ?? 0 },
      contactExchanged: { value: d.exchangePhoneAndWeiXin ?? 0, delta: d.exchangePhoneAndWeiXinCTY ?? 0 },
      interviewAccepted: { value: d.interviewAccept ?? 0, delta: d.interviewAcceptCTY ?? 0 }
    },
    quotas: {
      view: { used: viewRight.usedCount ?? 0, total: viewRight.limitCount ?? 0 },
      chat: { used: chatRight.usedCount ?? 0, total: chatRight.limitCount ?? 0 }
    },
    scrapedAt: new Date().toISOString()
  };
}

function normalizeJobEditDetail(data) {
  const zpData = data?.zpData || {};
  const job = zpData.job || {};
  const skillList = Array.isArray(zpData.skillList) ? zpData.skillList : [];
  const jobPoi = zpData.jobPoi || {};
  const brandInfo = zpData.brandInfo || zpData.proxyRecruitData || {};

  const experienceMap = { 101: '不限', 103: '1年以内', 104: '1-3年', 105: '3-5年', 106: '5-10年', 107: '10年以上' };
  const degreeMap = { 200: '不限', 201: '初中及以下', 202: '中专/中技', 203: '高中', 204: '大专', 205: '本科', 206: '硕士', 207: '博士' };

  const salaryDesc = (job.lowSalary && job.highSalary)
    ? `${job.lowSalary}-${job.highSalary}K`
    : '';

  return {
    name: job.jobName || '',
    salary: salaryDesc,
    experience: experienceMap[job.experience] || '',
    degree: degreeMap[job.degree] || '',
    city: job.locationName || zpData.cityName || '',
    district: [jobPoi.area, jobPoi.businessName].filter(Boolean).join('·'),
    description: job.postDescription || '',
    skills: skillList.join(', '),
    welfare: '',
    bossName: '',
    bossTitle: '',
    activeTime: '',
    company: brandInfo.brandName || brandInfo.name || '',
    industry: brandInfo.industryName || '',
    scale: '',
    stage: '',
    address: jobPoi.address || job.addressText || '',
    url: job.encryptId
      ? `https://www.zhipin.com/job_detail/${job.encryptId}.html`
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
