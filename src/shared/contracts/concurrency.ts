import { z } from 'zod';

/** Queue capacity for independent vectors and candidate-aware dispatch; never a work cap. */
export const MaxParallelVectorsSchema = z.number().int().positive();
export type MaxParallelVectors = z.infer<typeof MaxParallelVectorsSchema>;
