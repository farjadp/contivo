import { z } from 'zod';

import { ContentChannel, ContentItemSchema, ContentTone } from '../domain/content';

// ─── Request ──────────────────────────────────────────────────────────────────

export const GenerateInstantContentRequest = z.object({
  topic: z
    .string()
    .min(3, 'Topic must be at least 3 characters')
    .max(500, 'Topic must be under 500 characters'),
  channel: ContentChannel,
  tone: ContentTone.optional(),
  additionalContext: z.string().max(1000).optional(),
});
export type GenerateInstantContentRequest = z.infer<typeof GenerateInstantContentRequest>;

// ─── Response ─────────────────────────────────────────────────────────────────

export const GenerateInstantContentResponse = z.object({
  contentItem: ContentItemSchema,
  creditsUsed: z.number().int(),
  creditsRemaining: z.number().int(),
});
export type GenerateInstantContentResponse = z.infer<typeof GenerateInstantContentResponse>;
