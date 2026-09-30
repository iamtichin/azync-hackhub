import { z } from 'zod';

export const AiChatResponseSchema = z
  .object({
    answer: z.string().trim().min(1).max(6000),
    evidenceIds: z.array(z.string().min(1).max(128)).max(20),
    uncertainty: z.string().trim().max(1000).nullable(),
  })
  .strict();

export type AiChatResponse = z.infer<typeof AiChatResponseSchema>;

export const AI_CHAT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'evidenceIds', 'uncertainty'],
  properties: {
    answer: { type: 'string' },
    evidenceIds: { type: 'array', items: { type: 'string' } },
    uncertainty: { type: ['string', 'null'] },
  },
} as const;
