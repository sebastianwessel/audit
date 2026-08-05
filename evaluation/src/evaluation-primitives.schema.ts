import { z } from 'zod';

/** Shared evaluator-only vocabulary; target-language support remains unrestricted. */
export const CorpusVariantSchema = z.enum(['vulnerable', 'patched', 'benign']);
export const FixtureDifficultySchema = z.enum(['easy', 'medium', 'hard']);

export const LanguageTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9+._-]*$/iu)
  .transform((value) => value.toLowerCase());

export type CorpusVariant = z.infer<typeof CorpusVariantSchema>;
