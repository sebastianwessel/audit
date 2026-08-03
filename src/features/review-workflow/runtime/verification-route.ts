import type { ModelProvider } from '@purista/harness';
import type { z } from 'zod';
import { Sha256Schema, sha256 } from '../../../shared/contracts/core.js';
import type { ModelPricing, ModelRoute } from '../../model-operations/model-operations.js';
import { verificationProtocolFingerprint } from '../prompt-protocol.js';

export const VerificationRouteFingerprintSchema = Sha256Schema;
export type VerificationRouteFingerprint = z.infer<typeof VerificationRouteFingerprintSchema>;

export type ResolvedVerificationRoute = Readonly<{
  route: ModelRoute;
  modelProvider: ModelProvider;
  modelName: string | undefined;
  modelPricing: ModelPricing;
  modelCacheRoutingKey: string | undefined;
  cacheRoutingEnabled: boolean;
  fingerprint: VerificationRouteFingerprint;
}>;

/** Binds checkpoint reuse to the non-secret verifier identity and exact verifier protocol. */
export function createVerificationRouteFingerprint(input: {
  route: ModelRoute;
  provider: string;
  model: string;
}): VerificationRouteFingerprint {
  return VerificationRouteFingerprintSchema.parse(
    sha256(
      JSON.stringify({
        route: input.route,
        provider: input.provider.trim().toLowerCase(),
        model: input.model.trim().toLowerCase(),
        verificationProtocolFingerprint,
      }),
    ),
  );
}
