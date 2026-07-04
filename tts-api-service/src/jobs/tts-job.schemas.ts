/**
 * Zod request schemas for TTS job endpoints (skills.md: parse in the controller,
 * never in the service). Length is intentionally NOT capped here so oversized
 * text maps to 413 in the service, not a generic 400.
 */
import { z } from 'zod';

/** Bengali script block is U+0980–U+09FF. Require at least one Bengali letter. */
const BENGALI_PATTERN = /[ঀ-৿]/;

export const createTtsJobSchema = z.object({
  text: z
    .string({ required_error: 'text is required', invalid_type_error: 'text must be a string' })
    .trim()
    .min(1, 'text must not be empty')
    .refine((value) => BENGALI_PATTERN.test(value), 'text must contain valid Bengali'),
});

export type CreateTtsJobInput = z.infer<typeof createTtsJobSchema>;

export const listJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;

export const jobIdParamSchema = z.object({
  jobId: z.string().uuid('jobId must be a valid id'),
});

export type JobIdParam = z.infer<typeof jobIdParamSchema>;
