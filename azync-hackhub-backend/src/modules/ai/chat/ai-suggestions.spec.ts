import {
  buildContextualSuggestions,
  selectGhostSuggestion,
} from './ai-suggestions';

describe('context-aware judge chat suggestions', () => {
  it('uses human evidence labels and asks about CI and cNFT limitations', () => {
    const suggestions = buildContextualSuggestions({
      projectName: 'NekoSync',
      hackathonName: 'Solana Hack 2026',
      rules: [{ name: 'Public repository' }],
      rubric: [{ name: 'Technical execution' }],
      analysis: {
        requirements: [
          { requirementId: 'on-chain-proof', status: 'UNCERTAIN' },
        ],
        judgeQuestions: ['Can the team show the end-to-end mint flow?'],
      },
      evidence: [
        {
          type: 'SOLANA_ACCOUNT',
          status: 'UNVERIFIED',
          facts: { evidenceRole: 'PARTICIPANT_PROJECT_CLAIM' },
        },
        { type: 'GITHUB_TEST_SIGNAL', status: 'VERIFIED' },
        { type: 'SOLANA_TRANSACTION', status: 'VERIFIED' },
      ],
    });
    const text = suggestions.join(' ');
    expect(text).toContain('NekoSync');
    expect(text).toContain('on-chain-proof');
    expect(text).toContain('Technical execution');
    expect(text).toContain('team-provided Solana transaction');
    expect(text).toContain('CI results');
    expect(text).toContain('what does it not prove');
  });

  it('returns only the suffix that Tab should accept', () => {
    expect(
      selectGhostSuggestion(
        ['Evaluate NekoSync against the current rubric.'],
        'Evaluate',
      ),
    ).toEqual({
      suggestion: 'Evaluate NekoSync against the current rubric.',
      completion: ' NekoSync against the current rubric.',
    });
    expect(
      selectGhostSuggestion(['A relevant suggestion'], 'no match'),
    ).toEqual({
      suggestion: null,
      completion: null,
    });
  });
});
