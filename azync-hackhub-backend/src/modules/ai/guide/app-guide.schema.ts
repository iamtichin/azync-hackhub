import { z } from 'zod';
import { APP_GUIDE_ROUTES } from './app-guide.knowledge';

export const AppGuideResponseSchema = z
  .object({
    answer: z.string().trim().min(1).max(6000),
    relatedRoutes: z.array(z.enum(APP_GUIDE_ROUTES)).max(5),
    suggestedQuestions: z.array(z.string().trim().min(2).max(200)).max(4),
  })
  .strict();

export type AppGuideResponse = z.infer<typeof AppGuideResponseSchema>;

export const APP_GUIDE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'relatedRoutes', 'suggestedQuestions'],
  properties: {
    answer: { type: 'string' },
    relatedRoutes: { type: 'array', items: { enum: APP_GUIDE_ROUTES } },
    suggestedQuestions: { type: 'array', items: { type: 'string' } },
  },
} as const;
