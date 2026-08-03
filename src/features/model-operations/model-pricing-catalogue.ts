import { type ModelPricing, ModelPricingSchema } from './model-operations.schema.js';
import { modelPricingSnapshot } from './model-pricing-snapshot.js';

type SnapshotPrice = Readonly<{
  provider: string;
  inputPerMillion: number;
  cachedInputPerMillion?: number;
  outputPerMillion: number;
}>;

const supplementalPrices = {
  'openai:gpt-5.3-codex': {
    inputPerMillion: 1.75,
    cachedInputPerMillion: 0.175,
    outputPerMillion: 14,
  },
} as const;

const snapshotEntries = Object.entries(modelPricingSnapshot.models) as ReadonlyArray<
  readonly [string, SnapshotPrice]
>;

/** Resolves only an exact normalized provider/model entry from the bundled snapshot. */
export function catalogueModelPricing(input: {
  provider: string | undefined;
  model: string | undefined;
}): ModelPricing {
  const provider = input.provider?.trim().toLowerCase();
  const model = input.model?.trim().toLowerCase();
  if (
    provider === undefined ||
    model === undefined ||
    provider.length === 0 ||
    model.length === 0
  ) {
    return ModelPricingSchema.parse({});
  }
  const supplemental = Object.entries(supplementalPrices).find(
    ([key]) => key === `${provider}:${model}`,
  )?.[1];
  const snapshot = snapshotEntries.find(
    ([modelName, price]) =>
      price.provider.toLowerCase() === provider && modelName.toLowerCase() === model,
  )?.[1];
  const snapshotPrice =
    snapshot === undefined
      ? undefined
      : (({ provider: _provider, ...price }: SnapshotPrice) => price)(snapshot);
  const price = supplemental ?? snapshotPrice;
  return ModelPricingSchema.parse(price === undefined ? {} : { ...price, source: 'catalogue' });
}
