const test = require('node:test');
const assert = require('node:assert/strict');

const { executeCli, parseArgs } = require('../scripts/boss-cli');

test('parseArgs requires a command group and subcommand', () => {
  assert.throws(
    () => parseArgs([]),
    /Missing command/
  );

  assert.throws(
    () => parseArgs(['target']),
    /Missing subcommand/
  );
});

test('target bind stores the current boss target in the session', async () => {
  const writes = [];
  const stdout = createWritable();
  const stderr = createWritable();

  const result = await executeCli(['target', 'bind', '--run-id', '92'], {
    stdout,
    stderr,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      cdpClient: {
        resolveBossTarget: async () => ({
          id: 'boss-1',
          url: 'https://www.zhipin.com/web/chat/recommend?jobid=1'
        })
      },
      sessionStore: {
        bindTarget: async (runId, payload) => {
          writes.push({ runId, payload });
          return {
            runId,
            ...payload,
            epoch: 0,
            lastOwner: 'boss-cli'
          };
        }
      }
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].runId, '92');
  assert.equal(writes[0].payload.targetId, 'boss-1');
  assert.match(stdout.output, /"targetId": "boss-1"/);
  assert.equal(stderr.output, '');
});

test('target inspect returns the bound session plus the current url', async () => {
  const stdout = createWritable();

  const result = await executeCli(['target', 'inspect', '--run-id', '41'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '41',
          targetId: 'boss-1',
          epoch: 3,
          lastOwner: 'chrome-devtools'
        })
      },
      browserCommands: {
        getUrl: async () => 'https://www.zhipin.com/web/chat/index'
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.session.targetId, 'boss-1');
  assert.equal(payload.currentUrl, 'https://www.zhipin.com/web/chat/index');
});

test('joblist reads jobs through bossFetch using the bound target', async () => {
  const calls = [];
  const stdout = createWritable();

  const result = await executeCli(['joblist', '--run-id', '7'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '7',
          targetId: 'boss-1',
          epoch: 2
        })
      },
      browserCommands: {
        bossFetch: async (payload) => {
          calls.push(payload);
          return {
            zpData: [
              {
                jobName: '健康顾问',
                salaryDesc: '8-10K',
                address: '重庆',
                jobOnlineStatus: 1,
                encryptJobId: 'enc-job-1'
              }
            ]
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].targetId, 'boss-1');
  assert.equal(
    calls[0].url,
    'https://www.zhipin.com/wapi/zpjob/job/chatted/jobList'
  );
  assert.equal(payload.jobs[0].jobName, '健康顾问');
  assert.equal(payload.jobs[0].encryptJobId, 'enc-job-1');
});

test('recommend returns structured candidate rows from the current target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['recommend', '--run-id', '9', '--limit', '1'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '9',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        bossFetch: async (payload) => {
          calls.push(payload.url);
          if (payload.url.includes('/friend/label/get')) {
            return {
              code: 0,
              zpData: {
                labels: [{ labelId: 1, label: '活跃' }]
              }
            };
          }

          return {
            zpData: {
              friendList: [
                {
                  name: '张三',
                  jobName: '健康顾问',
                  lastTime: '刚刚',
                  relationLabelList: [1],
                  encryptUid: 'enc-uid-1',
                  securityId: 'sec-1',
                  encryptJobId: 'enc-job-1'
                }
              ]
            }
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /friend\/label\/get/);
  assert.match(calls[1], /greetRecSortList/);
  assert.equal(payload.candidates[0].name, '张三');
  assert.equal(payload.candidates[0].labels, '活跃');
});

test('chatlist reads the friend list for the bound target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['chatlist', '--run-id', '13', '--job-id', 'enc-job-1', '--page', '2', '--limit', '1'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '13',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        bossFetch: async (payload) => {
          calls.push(payload.url);
          return {
            zpData: {
              friendList: [
                {
                  name: '李四',
                  jobName: '健康顾问',
                  lastMessageInfo: { text: '你好' },
                  lastTime: '10:00',
                  encryptUid: 'enc-uid-2',
                  securityId: 'sec-2'
                }
              ]
            }
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.match(calls[0], /page=2/);
  assert.match(calls[0], /jobId=enc-job-1/);
  assert.equal(payload.chats[0].name, '李四');
  assert.equal(payload.chats[0].lastMessage, '你好');
});

test('chatmsg resolves the friend and fetches message history', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['chatmsg', '--run-id', '21', '--uid', 'enc-uid-3', '--page', '1'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '21',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        bossFetch: async (payload) => {
          calls.push(payload.url);
          if (payload.url.includes('getBossFriendListV2')) {
            return {
              zpData: {
                friendList: [
                  {
                    uid: 1001,
                    name: '王五',
                    encryptUid: 'enc-uid-3',
                    securityId: 'sec-3'
                  }
                ]
              }
            };
          }

          return {
            zpData: {
              messages: [
                {
                  type: 1,
                  text: '你好',
                  time: '2026-03-28T10:00:00.000Z',
                  from: { uid: 1001, name: '王五' }
                }
              ]
            }
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.match(calls[0], /getBossFriendListV2/);
  assert.match(calls[1], /historyMsg/);
  assert.match(calls[1], /securityId=sec-3/);
  assert.equal(payload.messages[0].type, 'text');
  assert.equal(payload.messages[0].text, '你好');
});

test('job-detail resolves securityId from joblist and fetches structured detail', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['job-detail', '--run-id', '31', '--job-id', 'enc-job-9'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '31',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        bossFetch: async (payload) => {
          calls.push(payload.url);

          if (payload.url.includes('/zpjob/job/chatted/jobList')) {
            return {
              zpData: [
                {
                  encryptJobId: 'enc-job-9',
                  securityId: 'sec-job-9',
                  jobName: '健康顾问'
                }
              ]
            };
          }

          return {
            zpData: {
              jobInfo: {
                jobName: '健康顾问',
                salaryDesc: '8-10K',
                experienceName: '3-5年',
                degreeName: '本科',
                locationName: '重庆',
                areaDistrict: '渝北',
                businessDistrict: '两江新区',
                postDescription: '负责客户跟进',
                showSkills: ['销售', '沟通'],
                address: '渝兴广场',
                encryptId: 'enc-job-9'
              },
              bossInfo: {
                name: '王经理',
                title: '招聘主管',
                activeTimeDesc: '今日活跃'
              },
              brandComInfo: {
                brandName: '北京好还',
                industryName: '互联网',
                scaleName: '1000-9999人',
                stageName: 'D轮及以上',
                labels: ['五险一金', '带薪培训']
              }
            }
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.match(calls[0], /jobList/);
  assert.match(calls[1], /securityId=sec-job-9/);
  assert.equal(payload.job.name, '健康顾问');
  assert.equal(payload.job.salary, '8-10K');
  assert.equal(payload.job.welfare, '五险一金, 带薪培训');
  assert.equal(payload.job.url, 'https://www.zhipin.com/job_detail/enc-job-9.html');
});

test('resume-panel scrapes the currently opened right panel from the bound target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['resume-panel', '--run-id', '55', '--uid', 'enc-uid-7'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '55',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        evaluateJson: async (payload) => {
          calls.push(payload);
          return {
            name: '谢东林',
            gender: '男',
            age: '29岁',
            experience: '5-10年',
            degree: '本科',
            activeTime: '今日活跃',
            workHistory: ['2021-至今 重庆某公司 面点师'],
            education: ['2014-2018 重庆工商大学 本科'],
            jobChatting: '健康顾问',
            expect: '重庆 8-10K'
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].targetId, 'boss-1');
  assert.match(calls[0].expression, /base-info-single-container|base-info-content/);
  assert.equal(payload.resume.name, '谢东林');
  assert.equal(payload.resume.jobChatting, '健康顾问');
  assert.equal(payload.resume.expect, '重庆 8-10K');
});

function createWritable() {
  return {
    output: '',
    write(chunk) {
      this.output += chunk;
    }
  };
}
