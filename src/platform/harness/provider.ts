import type { ModelProvider } from '@purista/harness';
import { anthropic } from '@purista/harness-anthropic';
import { openai } from '@purista/harness-openai';
import type { ModelPricing } from '../../features/model-operations/model-operations.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import type { ProviderName } from '../configuration/environment.js';

export { type ProviderName, ProviderNameSchema } from '../configuration/environment.js';

/** Stable provider-side cache routing metadata; it never contains repository content. */
export function providerCacheRoutingKey(input: {
  provider: ProviderName;
  model: string;
}): string | undefined {
  return input.provider === 'openai' ? `security-reviewer:${input.model}` : undefined;
}

/** Harness uses `0` for an explicitly disabled deadline; provider adapters require omission. */
export function providerRequestTimeout(timeoutMs: number | undefined): number | undefined {
  return timeoutMs === undefined || timeoutMs === 0 ? undefined : timeoutMs;
}

/** Creates an explicitly configured optional provider without persisting credentials. */
export function createConfiguredProvider(input: {
  provider: ProviderName;
  apiKeyEnvironmentVariable?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  /** Propagates the bounded model deadline into the provider SDK transport. */
  requestTimeoutMs?: number;
}): ModelProvider {
  const environmentVariable =
    input.apiKeyEnvironmentVariable ??
    (input.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');
  const apiKey = (input.environment ?? process.env)[environmentVariable];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new SecurityReviewerError(
      'provider-failure',
      `The configured provider API key environment variable ${environmentVariable} is not set.`,
    );
  }
  const timeout = providerRequestTimeout(input.requestTimeoutMs);
  return input.provider === 'openai'
    ? openai({ apiKey, api: 'responses', ...(timeout === undefined ? {} : { timeout }) })
    : anthropic({ apiKey, ...(timeout === undefined ? {} : { timeout }) });
}

/** A resolved route holds a live provider only in memory; persisted artifacts use a fingerprint. */
export function createConfiguredModelRoute(input: {
  provider: ProviderName;
  model: string;
  apiKeyEnvironmentVariable?: string;
  modelPricing: ModelPricing;
  environment?: Readonly<Record<string, string | undefined>>;
  requestTimeoutMs?: number;
}) {
  return Object.freeze({
    provider: input.provider,
    model: input.model,
    modelProvider: createConfiguredProvider(input),
    modelPricing: input.modelPricing,
    modelCacheRoutingKey: providerCacheRoutingKey({ provider: input.provider, model: input.model }),
  });
}
