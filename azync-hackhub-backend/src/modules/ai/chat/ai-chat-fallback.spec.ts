import { buildEvidenceFallback } from './ai-chat-fallback';

const evidence = [
  {
    id: 'repo',
    type: 'GITHUB_REPOSITORY',
    status: 'VERIFIED',
    reference: 'https://github.com/org/repo',
    sourceRevision: 'abc',
    facts: { commitSha: 'abc', treeEntryCount: 20 },
  },
  {
    id: 'tests',
    type: 'GITHUB_TEST_SIGNAL',
    status: 'VERIFIED',
    reference: 'https://github.com/org/repo/tree/abc',
    sourceRevision: 'abc',
    facts: {
      executionStatus: 'NOT_RUN',
      testFilePaths: ['a.test.ts'],
      workflowPaths: ['ci.yml'],
    },
  },
  {
    id: 'demo',
    type: 'DEMO_URL',
    status: 'VERIFIED',
    reference: 'https://github.com/org/repo/blob/abc/demo.html',
    facts: { reachable: false, statusCode: 404 },
  },
  {
    id: 'tx',
    type: 'SOLANA_TRANSACTION',
    status: 'VERIFIED',
    reference: 'signature',
    facts: {
      cluster: 'devnet',
      slot: 42,
      succeeded: true,
      finalized: true,
      supportsProjectIntegration: false,
    },
  },
  {
    id: 'claim',
    type: 'SOLANA_ACCOUNT',
    status: 'UNVERIFIED',
    reference: 'https://explorer.solana.com/tx/claim',
    facts: { evidenceRole: 'PARTICIPANT_PROJECT_CLAIM' },
  },
];

describe('local judge chat evidence fallback', () => {
  it('separates test files, CI execution, demo reachability and platform proof', () => {
    const result = buildEvidenceFallback({
      question: 'Assess technical quality, CI, demo, and Solana proof',
      projectName: 'Campus Return',
      rubric: [{ name: 'Technical quality' }],
      evidence,
    });
    expect(result.answer).toContain('NOT_RUN');
    expect(result.answer).toContain('HTTP 404');
    expect(result.answer).toContain('does not prove project runtime behavior');
    expect(result.answer).toContain('Technical quality');
    expect(result.evidenceIds).toEqual(
      expect.arrayContaining(['repo', 'tests', 'demo', 'tx', 'claim']),
    );
    expect(result.uncertainty).toContain('unverified');
  });

  it('refuses a cross-team comparison without a second submission context', () => {
    const result = buildEvidenceFallback({
      question: 'Compare the two teams',
      projectName: 'Campus Return',
      rubric: [],
      evidence,
    });
    expect(result.answer).toContain('cannot compare two teams');
    expect(result.evidenceIds).toEqual([]);
  });

  it('answers a Vietnamese judge in Vietnamese when the provider is unavailable', () => {
    const result = buildEvidenceFallback({
      question: 'Bằng chứng nào chứng minh chất lượng kỹ thuật và CI?',
      projectName: 'Campus Return',
      rubric: [{ name: 'Technical quality' }],
      evidence,
    });
    expect(result.answer).toContain('Bằng chứng có trong snapshot này');
    expect(result.answer).toContain('không chứng minh CI đã chạy thành công');
    expect(result.uncertainty).toContain('chưa được xác minh');
  });

  it('recognizes common Vietnamese questions typed without diacritics', () => {
    const result = buildEvidenceFallback({
      question: 'So sanh hai doi',
      projectName: 'Campus Return',
      rubric: [],
      evidence,
    });
    expect(result.answer).toContain('chưa thể so sánh hai đội');
  });
});
