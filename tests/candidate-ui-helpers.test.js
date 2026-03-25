const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatLifecycleStatus,
  formatResumeState,
  formatGuardStatus,
  buildCandidateTimeline
} = require('../public/candidate-ui-helpers');

test('candidate UI helpers format lifecycle and resume labels', () => {
  assert.equal(formatLifecycleStatus('responded'), '已回复');
  assert.equal(formatLifecycleStatus('resume_downloaded'), '简历已下载');
  assert.equal(formatResumeState('not_requested'), '未索取');
  assert.equal(formatResumeState('downloaded'), '已下载');
  assert.equal(formatGuardStatus('active'), '正常跟进');
  assert.equal(formatGuardStatus('manual_hold'), '人工接管');
});

test('candidate UI helpers build a reverse chronological timeline', () => {
  const timeline = buildCandidateTimeline({
    actions: [
      {
        action_type: 'resume_request_sent',
        created_at: '2026-03-25T10:00:00.000Z'
      }
    ],
    messages: [
      {
        direction: 'inbound',
        content_text: '我发你简历了',
        sent_at: '2026-03-25T11:00:00.000Z'
      }
    ],
    attachments: [
      {
        file_name: 'resume.pdf',
        status: 'downloaded',
        downloaded_at: '2026-03-25T12:00:00.000Z',
        created_at: '2026-03-25T11:30:00.000Z'
      }
    ],
    last_resume_requested_at: '2026-03-25T10:00:00.000Z',
    resume_downloaded_at: '2026-03-25T12:00:00.000Z'
  });

  assert.equal(timeline[0].type, 'attachment');
  assert.equal(timeline[0].title, '简历已下载');
  assert.equal(timeline[1].type, 'message');
  assert.equal(timeline[2].type, 'action');
});
