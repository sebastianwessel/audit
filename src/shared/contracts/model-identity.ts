import { z } from 'zod';

/**
 * Content-free identifiers recorded for a model route. These are provider
 * labels, not configured-provider allowlists; configuration owns that policy.
 */
export const ModelRouteIdentifierSchema = z.string().trim().min(1).max(160);
export const ModelProviderIdentifierSchema = ModelRouteIdentifierSchema;
export const ModelIdentifierSchema = ModelRouteIdentifierSchema;

export const ModelRouteIdentitySchema = z.strictObject({
  provider: ModelProviderIdentifierSchema,
  model: ModelIdentifierSchema,
});

export type ModelProviderIdentifier = z.infer<typeof ModelProviderIdentifierSchema>;
export type ModelIdentifier = z.infer<typeof ModelIdentifierSchema>;
export type ModelRouteIdentity = z.infer<typeof ModelRouteIdentitySchema>;
