import { AnalysisBusinessValidator } from './analysis-business.validator';

describe('AnalysisBusinessValidator', () => {
  const validator = new AnalysisBusinessValidator();
  const rules = [
    { id: 'rule-1', name: 'Rule', description: 'Rule description' },
  ];
  const rubric = [
    {
      id: 'rubric-1',
      name: 'Quality',
      description: 'Quality description',
      weight: 1,
      minScore: 0,
      maxScore: 10,
    },
  ];

  it('accepts exact coverage with grounded positive findings', () => {
    const errors = validator.validate(
      {
        summary: {
          problem: 'A sufficiently clear problem statement',
          solution: 'A sufficiently clear solution statement',
          targetUsers: 'Hackathon organizers',
        },
        technologies: [],
        requirements: [
          {
            requirementId: 'rule-1',
            status: 'PASS',
            confidence: 0.8,
            reason: 'Verified by deterministic evidence item.',
            evidenceIds: ['ev-1'],
          },
        ],
        rubricAnalysis: [
          {
            rubricId: 'rubric-1',
            suggestedScore: 7,
            confidence: 0.7,
            reason: 'Supported by deterministic evidence item.',
            evidenceIds: ['ev-1'],
          },
        ],
        concerns: [],
        judgeQuestions: [],
      },
      rules,
      rubric,
      new Set(['ev-1']),
    );
    expect(errors).toEqual([]);
  });

  it('rejects unknown IDs, missing coverage, ungrounded PASS and score overflow', () => {
    const errors = validator.validate(
      {
        summary: {
          problem: 'A sufficiently clear problem statement',
          solution: 'A sufficiently clear solution statement',
          targetUsers: 'Hackathon organizers',
        },
        technologies: [],
        requirements: [
          {
            requirementId: 'unknown',
            status: 'PASS',
            confidence: 1,
            reason: 'This has no deterministic evidence support.',
            evidenceIds: [],
          },
        ],
        rubricAnalysis: [
          {
            rubricId: 'rubric-1',
            suggestedScore: 11,
            confidence: 1,
            reason: 'This score exceeds the configured maximum.',
            evidenceIds: [],
          },
        ],
        concerns: [],
        judgeQuestions: [],
      },
      rules,
      rubric,
      new Set(),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'Unknown requirementId: unknown',
        'Missing requirementId: rule-1',
        'PASS requires verified evidence: unknown',
        'Score outside bounds for rubric-1',
      ]),
    );
  });
});
