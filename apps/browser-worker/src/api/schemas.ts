import { z } from 'zod';

const profileUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      return ['instagram.com', 'www.instagram.com'].includes(new URL(value).hostname);
    } catch {
      return false;
    }
  }, 'Instagram URL required');

export const searchSchema = z.object({
  query: z.string().trim().min(2).max(150),
  maximumProfiles: z.number().int().min(1).max(100),
});

export const analyzeSchema = z.object({
  profileUrl,
  niche: z.string().trim().min(2).max(100),
  location: z.string().trim().max(100),
  requiredKeywords: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  excludedKeywords: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
});

export const messageSchema = z.object({
  profileUrl,
  message: z.string().trim().min(1).max(900),
  executionId: z.string().uuid(),
  approvalToken: z.string().uuid().optional(),
  approved: z.boolean().optional(),
  dryRun: z.boolean().default(true),
  mode: z.enum(['approval', 'automatic']).default('approval'),
});

export const approvalSchema = z.object({
  outreachMessageId: z.string().uuid(),
  approvalToken: z.string().uuid(),
  approved: z.literal(true),
});
