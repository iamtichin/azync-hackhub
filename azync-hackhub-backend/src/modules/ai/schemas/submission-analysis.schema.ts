import { z } from 'zod';

const EvidenceIdSchema = z.string().min(1).max(128);

export const HackathonRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const RubricCriterionSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000),
    weight: z.number().min(0).max(1),
    minScore: z.number(),
    maxScore: z.number(),
  })
  .strict()
  .refine((item) => item.maxScore >= item.minScore, {
    message: 'maxScore must be greater than or equal to minScore',
  });

export const SubmissionSummarySchema = z
  .object({
    problem: z.string().trim().min(10).max(500),
    solution: z.string().trim().min(10).max(500),
    targetUsers: z.string().trim().min(5).max(200),
  })
  .strict();

export const RequirementCheckSchema = z
  .object({
    requirementId: z.string().min(1).max(128),
    status: z.enum(['PASS', 'FAIL', 'UNCERTAIN']),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(10).max(500),
    evidenceIds: z.array(EvidenceIdSchema).max(20),
  })
  .strict();

export const RubricAnalysisSchema = z
  .object({
    rubricId: z.string().min(1).max(128),
    suggestedScore: z.number().nonnegative(),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(10).max(500),
    evidenceIds: z.array(EvidenceIdSchema).max(20),
  })
  .strict();

export const ConcernSchema = z
  .object({
    severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    description: z.string().trim().min(10).max(300),
  })
  .strict();

export const SubmissionAnalysisResponseSchema = z
  .object({
    summary: SubmissionSummarySchema,
    technologies: z.array(z.string().trim().min(1).max(100)).max(20),
    requirements: z.array(RequirementCheckSchema).max(100),
    rubricAnalysis: z.array(RubricAnalysisSchema).max(50),
    concerns: z.array(ConcernSchema).max(10),
    judgeQuestions: z.array(z.string().trim().min(5).max(300)).max(5),
  })
  .strict();

export type HackathonRule = z.infer<typeof HackathonRuleSchema>;
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;
export type SubmissionAnalysisResponse = z.infer<
  typeof SubmissionAnalysisResponseSchema
>;

export const SUBMISSION_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'technologies',
    'requirements',
    'rubricAnalysis',
    'concerns',
    'judgeQuestions',
  ],
  properties: {
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['problem', 'solution', 'targetUsers'],
      properties: {
        problem: { type: 'string' },
        solution: { type: 'string' },
        targetUsers: { type: 'string' },
      },
    },
    technologies: { type: 'array', items: { type: 'string' } },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'requirementId',
          'status',
          'confidence',
          'reason',
          'evidenceIds',
        ],
        properties: {
          requirementId: { type: 'string' },
          status: { enum: ['PASS', 'FAIL', 'UNCERTAIN'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    rubricAnalysis: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'rubricId',
          'suggestedScore',
          'confidence',
          'reason',
          'evidenceIds',
        ],
        properties: {
          rubricId: { type: 'string' },
          suggestedScore: { type: 'number', minimum: 0 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    concerns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'description'],
        properties: {
          severity: { enum: ['HIGH', 'MEDIUM', 'LOW'] },
          description: { type: 'string' },
        },
      },
    },
    judgeQuestions: { type: 'array', items: { type: 'string' } },
  },
} as const;
