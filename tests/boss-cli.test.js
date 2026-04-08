const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

test('target bind persists optional run-scoped job metadata in the session', async () => {
  const writes = [];

  const result = await executeCli(
    ['target', 'bind', '--run-id', '230', '--job-key', '面点师傅（B0038011）_8eca6cad', '--job-id', 'enc-job-1'],
    {
      stdout: createWritable(),
      stderr: createWritable(),
      env: {
        DATABASE_URL: 'postgresql://example',
        AGENT_TOKEN: 'token',
        NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
      },
      dependencies: {
        cdpClient: {
          resolveBossTarget: async () => ({
            id: 'boss-1',
            url: 'https://www.zhipin.com/web/chat/index'
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
    }
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(writes[0], {
    runId: '230',
    payload: {
      targetId: 'boss-1',
      tabUrl: 'https://www.zhipin.com/web/chat/index',
      jobKey: '面点师傅（B0038011）_8eca6cad',
      jobId: 'enc-job-1',
      mode: null,
      lastOwner: 'boss-cli'
    }
  });
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

test('joblist reads all jobs through data/list API using the bound target', async () => {
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
            zpData: {
              data: [
                {
                  jobName: '健康顾问',
                  lowSalary: 8,
                  highSalary: 10,
                  locationName: '重庆',
                  jobStatus: 0,
                  encryptId: 'enc-job-1'
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
  assert.equal(calls[0].targetId, 'boss-1');
  assert.equal(
    calls[0].url,
    'https://www.zhipin.com/wapi/zpjob/job/data/list?type=5'
  );
  assert.equal(payload.jobs[0].jobName, '健康顾问');
  assert.equal(payload.jobs[0].salary, '8-10K');
  assert.equal(payload.jobs[0].status, 'online');
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

test('recommend-pager triggers a real-click pager action on the bound target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['recommend-pager', '--run-id', '10', '--direction', 'next'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '10',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        clickRecommendPager: async (payload) => {
          calls.push(payload);
          return {
            ok: true,
            direction: 'next',
            x: 120,
            y: 240
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].targetId, 'boss-1');
  assert.equal(calls[0].direction, 'next');
  assert.equal(payload.direction, 'next');
  assert.equal(payload.x, 120);
});

test('recommend-state returns deterministic recommend detail signals for the bound target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['recommend-state', '--run-id', '11'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '11',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        inspectRecommendState: async (payload) => {
          calls.push(payload);
          return {
            ok: true,
            detailOpen: true,
            nextVisible: true,
            prevVisible: true,
            similarCandidatesVisible: true
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].targetId, 'boss-1');
  assert.equal(payload.detailOpen, true);
  assert.equal(payload.nextVisible, true);
  assert.equal(payload.similarCandidatesVisible, true);
});

test('recommend-detail returns deterministic nested detail summary for the bound target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['recommend-detail', '--run-id', '12'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '12',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        inspectRecommendDetail: async (payload) => {
          calls.push(payload);
          return {
            ok: true,
            name: '王庭',
            currentActionText: '继续沟通',
            hasExperienceSection: true,
            hasEducationSection: true
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].targetId, 'boss-1');
  assert.equal(payload.name, '王庭');
  assert.equal(payload.currentActionText, '继续沟通');
  assert.equal(payload.hasExperienceSection, true);
});

test('context-snapshot returns normalized structured page facts for the bound target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['context-snapshot', '--run-id', '12', '--job-id', 'enc-job-1'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '12',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        inspectContextSnapshot: async (payload) => {
          calls.push(payload);
          return {
            ok: true,
            page: {
              url: 'https://www.zhipin.com/web/chat/recommend?jobid=enc-job-1',
              title: '推荐牛人',
              shell: 'recommend'
            },
            job: {
              encryptJobId: 'enc-job-1',
              jobName: '健康顾问',
              matchesRunJob: true
            },
            candidate: {
              bossEncryptGeekId: 'geek-1',
              name: '王庭',
              inDetail: true
            },
            thread: {
              encryptUid: 'uid-1',
              isUnread: false
            },
            attachment: {
              present: false,
              buttonEnabled: false
            }
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].targetId, 'boss-1');
  assert.equal(calls[0].jobId, 'enc-job-1');
  assert.equal(payload.page.shell, 'recommend');
  assert.equal(payload.job.matchesRunJob, true);
  assert.equal(payload.candidate.name, '王庭');
});

test('recommend-next-candidate reuses the pager helper and returns the resulting direction', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['recommend-next-candidate', '--run-id', '14'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '14',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        clickRecommendPager: async (payload) => {
          calls.push(payload);
          return {
            ok: true,
            direction: 'next',
            x: 88,
            y: 99
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);
  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].direction, 'next');
  assert.equal(payload.direction, 'next');
});

test('chat-open-thread opens a chat row for the bound target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['chat-open-thread', '--run-id', '15', '--uid', 'enc-uid-9'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '15',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        openChatThread: async (payload) => {
          calls.push(payload);
          return {
            ok: true,
            uid: 'enc-uid-9',
            opened: true
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);
  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].uid, 'enc-uid-9');
  assert.equal(payload.opened, true);
});

test('chat-open-thread persists selected uid after a successful open', async () => {
  const writes = [];
  const stdout = createWritable();

  const result = await executeCli(['chat-open-thread', '--run-id', '15', '--uid', 'enc-uid-9'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '15',
          targetId: 'boss-1',
          epoch: 0,
          selectedUid: null,
          lastOwner: 'boss-cli'
        }),
        saveSession: async (runId, session) => {
          writes.push({ runId, session });
          return session;
        }
      },
      browserCommands: {
        bossFetch: async () => ({
          zpData: {
            friendList: [
              {
                encryptUid: 'enc-uid-9',
                name: '谢小洪',
                jobName: '面点师傅（B0038011）',
                lastTime: '13:50',
                lastMessageInfo: { text: '你好' }
              }
            ]
          }
        }),
        openChatThread: async () => ({
          ok: true,
          uid: 'enc-uid-9',
          opened: true
        })
      }
    }
  });

  const payload = JSON.parse(stdout.output);
  assert.equal(result.exitCode, 0);
  assert.equal(payload.opened, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].runId, '15');
  assert.equal(writes[0].session.selectedUid, 'enc-uid-9');
});

test('chat-thread-state returns normalized thread facts for the bound target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['chat-thread-state', '--run-id', '16'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '16',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        inspectChatThreadState: async (payload) => {
          calls.push(payload);
          return {
            ok: true,
            threadOpen: true,
            activeUid: 'enc-uid-3',
            attachmentPresent: true
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);
  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].targetId, 'boss-1');
  assert.equal(payload.threadOpen, true);
  assert.equal(payload.attachmentPresent, true);
});

test('chat-thread-state falls back to the session selected uid when the DOM omits activeUid', async () => {
  const stdout = createWritable();

  const result = await executeCli(['chat-thread-state', '--run-id', '16'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '16',
          targetId: 'boss-1',
          epoch: 0,
          selectedUid: 'enc-uid-3'
        })
      },
      browserCommands: {
        inspectChatThreadState: async () => ({
          ok: true,
          threadOpen: true,
          activeUid: '',
          attachmentPresent: true
        })
      }
    }
  });

  const payload = JSON.parse(stdout.output);
  assert.equal(result.exitCode, 0);
  assert.equal(payload.threadOpen, true);
  assert.equal(payload.activeUid, 'enc-uid-3');
});

test('chat-thread-state infers active uid from visible thread metadata when selected uid is missing', async () => {
  const stdout = createWritable();

  const result = await executeCli(['chat-thread-state', '--run-id', '16'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '16',
          targetId: 'boss-1',
          epoch: 0,
          selectedUid: null,
          jobId: 'enc-job-1'
        })
      },
      browserCommands: {
        inspectChatThreadState: async () => ({
          ok: true,
          threadOpen: true,
          activeUid: '',
          attachmentPresent: false,
          activeThread: {
            name: '谢小洪',
            jobName: '面点师傅（B0038011）',
            lastTime: '13:50'
          }
        }),
        bossFetch: async () => ({
          zpData: {
            friendList: [
              {
                encryptUid: 'f987eab72b3a61211nZ-2du5F1pW',
                name: '谢小洪',
                jobName: '面点师傅（B0038011）',
                lastTime: '13:50',
                securityId: 'sec-1'
              }
            ]
          }
        })
      }
    }
  });

  const payload = JSON.parse(stdout.output);
  assert.equal(result.exitCode, 0);
  assert.equal(payload.activeUid, 'f987eab72b3a61211nZ-2du5F1pW');
});

test('chat-thread-state fails fast when the active thread remains unresolved', async () => {
  const stdout = createWritable();
  const stderr = createWritable();

  const result = await executeCli(['chat-thread-state', '--run-id', '16'], {
    stdout,
    stderr,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '16',
          targetId: 'boss-1',
          epoch: 0,
          selectedUid: null,
          jobId: 'enc-job-1'
        })
      },
      browserCommands: {
        inspectChatThreadState: async () => ({
          ok: true,
          threadOpen: true,
          activeUid: '',
          attachmentPresent: false,
          activeThread: {
            name: '谢小洪',
            jobName: '面点师傅（B0038011）',
            lastTime: '13:50'
          }
        }),
        bossFetch: async () => ({
          zpData: {
            friendList: []
          }
        })
      }
    }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(stdout.output, '');
  assert.match(stderr.output, /boss_chat_active_uid_unresolved/);
});

test('attachment-state returns attachment facts for the bound target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['attachment-state', '--run-id', '17'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      sessionStore: {
        loadSession: async () => ({
          runId: '17',
          targetId: 'boss-1',
          epoch: 0
        })
      },
      browserCommands: {
        inspectAttachmentState: async (payload) => {
          calls.push(payload);
          return {
            ok: true,
            present: true,
            buttonEnabled: true,
            fileName: 'resume.pdf'
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);
  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].targetId, 'boss-1');
  assert.equal(payload.present, true);
  assert.equal(payload.fileName, 'resume.pdf');
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

test('job-detail fetches structured detail from job edit API', async () => {
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

          return {
            zpData: {
              job: {
                encryptId: 'enc-job-9',
                jobName: '健康顾问',
                lowSalary: 8,
                highSalary: 10,
                experience: 105,
                degree: 205,
                locationName: '重庆',
                postDescription: '负责客户跟进',
                addressText: '渝兴广场'
              },
              skillList: ['销售', '沟通'],
              jobPoi: {
                address: '重庆渝北区渝兴广场',
                area: '渝北',
                businessName: '两江新区'
              },
              brandInfo: {
                brandName: '北京好还',
                industryName: '互联网'
              }
            }
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.match(calls[0], /zpjob\/job\/edit\?encJobId=enc-job-9/);
  assert.equal(payload.job.name, '健康顾问');
  assert.equal(payload.job.salary, '8-10K');
  assert.equal(payload.job.description, '负责客户跟进');
  assert.equal(payload.job.skills, '销售, 沟通');
  assert.equal(payload.job.address, '重庆渝北区渝兴广场');
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

test('resume-preview-meta returns preview identifiers from the bound target', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['resume-preview-meta', '--run-id', '55'], {
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
        inspectResumePreviewMeta: async (payload) => {
          calls.push(payload);
          return {
            ok: true,
            canPreview: true,
            encryptGeekId: 'geek-1',
            encryptResumeId: 'resume-1',
            encryptAuthorityId: 'authority-1',
            previewType: 1
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].targetId, 'boss-1');
  assert.equal(payload.canPreview, true);
  assert.equal(payload.encryptAuthorityId, 'authority-1');
});

test('resume-download writes browser-authenticated PDF bytes to disk and returns metadata', async () => {
  const stdout = createWritable();
  const outputPath = path.join(os.tmpdir(), `boss-resume-download-${Date.now()}.pdf`);

  try {
    const result = await executeCli(['resume-download', '--run-id', '55', '--output-path', outputPath], {
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
          downloadResumeAttachment: async () => ({
            ok: true,
            fileName: '曾艳简历.pdf',
            mimeType: 'application/pdf',
            fileSize: 3,
            base64: Buffer.from('ABC').toString('base64'),
            sourceUrl: 'https://www.zhipin.com/wflow/zpgeek/download/preview4boss/foo'
          })
        }
      }
    });

    const payload = JSON.parse(stdout.output);
    assert.equal(result.exitCode, 0);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'ABC');
    assert.equal(payload.fileName, '曾艳简历.pdf');
    assert.equal(payload.storedPath, outputPath);
    assert.equal(payload.sha256.length, 64);
  } finally {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }
});

test('resume-close-detail closes resume preview for the bound target', async () => {
  const stdout = createWritable();

  const result = await executeCli(['resume-close-detail', '--run-id', '55'], {
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
        closeResumeDetail: async () => ({
          ok: true,
          closed: true,
          method: 'close_button'
        })
      }
    }
  });

  const payload = JSON.parse(stdout.output);
  assert.equal(result.exitCode, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.closed, true);
  assert.equal(payload.method, 'close_button');
});

test('recruit-data fetches BOSS recruit data via API', async () => {
  const stdout = createWritable();
  const calls = [];

  const result = await executeCli(['recruit-data', '--run-id', '200'], {
    stdout,
    env: {
      DATABASE_URL: 'postgresql://example',
      AGENT_TOKEN: 'token',
      NANOBOT_CONFIG_PATH: '/tmp/nanobot.json'
    },
    dependencies: {
      cdpClient: {},
      sessionStore: {
        loadSession: async () => ({
          targetId: 'boss-1',
          tabUrl: 'https://www.zhipin.com/web/chat/index'
        })
      },
      browserCommands: {
        bossFetch: async (payload) => {
          calls.push(payload.url);
          return {
            zpData: {
              todayData: {
                view: 93,
                viewCTY: 70,
                viewed: 65,
                viewedCTY: 20,
                chatInitiative: 33,
                chatInitiativeCTY: 19,
                contactMe: 4,
                contactMeCTY: -3,
                chat: 50,
                chatCTY: 15,
                resume: 8,
                resumeCTY: 6,
                exchangePhoneAndWeiXin: 0,
                exchangePhoneAndWeiXinCTY: 0,
                interviewAccept: 0,
                interviewAcceptCTY: 0
              },
              dailyRightStates: {
                viewRightState: { progressBarList: [{ usedCount: 83, limitCount: 100 }] },
                chatRightState: { progressBarList: [{ usedCount: 33, limitCount: 50 }] }
              }
            }
          };
        }
      }
    }
  });

  const payload = JSON.parse(stdout.output);
  assert.equal(result.exitCode, 0);
  assert.equal(payload.ok, true);
  assert.match(calls[0], /recruitDataCenter\/get\.json/);
  assert.equal(payload.metrics.viewed.value, 93);
  assert.equal(payload.metrics.greeted.value, 33);
  assert.equal(payload.metrics.resumesReceived.value, 8);
  assert.equal(payload.quotas.chat.used, 33);
  assert.equal(payload.quotas.chat.total, 50);
});

function createWritable() {
  return {
    output: '',
    write(chunk) {
      this.output += chunk;
    }
  };
}
