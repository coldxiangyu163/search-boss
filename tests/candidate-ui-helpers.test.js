const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatLifecycleStatus,
  formatResumeState,
  formatGuardStatus,
  buildCandidateTimeline,
  buildCandidateEvaluation,
  buildResumePreviewUrl,
  isResumeDownloadable,
  buildCandidateDownloadQuery
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

test('candidate UI helpers normalize followup model evaluation from workflow metadata', () => {
  const evaluation = buildCandidateEvaluation({
    profile_metadata: {
      decision: 'greet',
      priority: 'A',
      reasoning: 'source match',
      facts: { city: '重庆' }
    },
    workflow_metadata: {
      followupDecision: {
        action: 'request_resume',
        reason: '候选人与岗位画像匹配',
        requirementEvidence: [
          '3-5年经验符合岗位要求',
          '今日活跃且明确表达兴趣'
        ],
        source: 'llm'
      },
      filterGate: {
        unsupportedFilters: ['jobIntent']
      }
    }
  });

  assert.equal(evaluation.kind, 'followup');
  assert.equal(evaluation.action, 'request_resume');
  assert.equal(evaluation.label, '索要简历');
  assert.equal(evaluation.reason, '候选人与岗位画像匹配');
  assert.deepEqual(evaluation.requirementEvidence, [
    '3-5年经验符合岗位要求',
    '今日活跃且明确表达兴趣'
  ]);
  assert.deepEqual(evaluation.unsupportedFilters, ['jobIntent']);
});

test('candidate UI helpers build preview urls only for stored resumes paths', () => {
  assert.equal(
    buildResumePreviewUrl('resumes/java_backend/张三.pdf'),
    '/api/resume-preview?path=resumes%2Fjava_backend%2F%E5%BC%A0%E4%B8%89.pdf'
  );
  assert.equal(buildResumePreviewUrl('tmp/outside.pdf'), '');
  assert.equal(buildResumePreviewUrl('../resumes/escape.pdf'), '');
});


test('candidate UI helpers detect downloadable resumes', () => {
  assert.equal(isResumeDownloadable({ resume_path: 'resumes/java_backend/张三.pdf' }), true);
  assert.equal(isResumeDownloadable({ resume_path: 'tmp/outside.pdf' }), false);
  assert.equal(isResumeDownloadable({ attachments: [{ stored_path: 'resumes/java_backend/李四.pdf' }] }), true);
  assert.equal(isResumeDownloadable({ attachments: [{ stored_path: '../escape.pdf' }] }), false);
});

test('candidate UI helpers build download mode query from current filters', () => {
  assert.deepEqual(
    buildCandidateDownloadQuery({
      jobKey: 'java_backend',
      status: 'responded',
      resumeState: '',
      keyword: '张三',
      page: 3,
      pageSize: 50
    }),
    {
      jobKey: 'java_backend',
      status: 'responded',
      resumeState: 'downloaded',
      keyword: '张三',
      page: 1,
      pageSize: 50
    }
  );
});
